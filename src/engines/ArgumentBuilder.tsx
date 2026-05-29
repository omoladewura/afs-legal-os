/**
 * AFS Advocates — Argument Builder Module
 * Phase 2 — Full implementation
 *
 * Three sub-tabs:
 *   1. Import Intelligence — select items from the Intelligence Engine output
 *   2. Build & Generate   — choose argument type, add context, generate
 *   3. Version History    — every saved draft, retrieve / copy / delete
 *
 * Google Drive RAG toggle. Intelligence import is always structured,
 * never raw narration. [RESEARCH NEEDED] tags for unverified citations.
 * Every draft saveable to IndexedDB per case.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Case, ArgumentVersion } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { Spinner, RoleBadge, Md } from '@/components/common/ui';
import { copyToClipboard, uid } from '@/utils';
import { loadArgVersions, saveArgVersion, deleteArgVersion } from '@/storage/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// ARGUMENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

const AB_ARG_TYPES = [
  { id: 'written_address_trial',     label: 'Written Address (Trial)',           icon: '⚖',  hint: 'Issue-based argument at trial — law, facts, conclusion. IRAC structure throughout.' },
  { id: 'written_address_interlocu', label: 'Written Address (Interlocutory)',   icon: '⚡',  hint: 'In support of or opposition to a motion — three-step: law, facts, prayer.' },
  { id: 'final_address',             label: 'Final Written Address',             icon: '📜',  hint: 'Closing address at end of trial — evidence summarised, judgment made inevitable.' },
  { id: 'appellants_brief',          label: "Appellant's Brief Section",         icon: '↑',   hint: 'Issue-based appellate argument — error of law or fact, why judgment must be set aside.' },
  { id: 'respondents_brief',         label: "Respondent's Brief Section",        icon: '↓',   hint: 'Defend the judgment below — uphold findings, distinguish errors, address every ground.' },
  { id: 'legal_arguments',           label: 'Legal Arguments (Pleadings)',       icon: '§',   hint: 'Structured legal arguments underpinning pleadings — elements, burden, authority.' },
  { id: 'opening_statement',         label: 'Opening Statement',                 icon: '◉',   hint: 'Roadmap for the court — what the case is about, what we will prove, and how.' },
  { id: 'objection_argument',        label: 'Objection / Preliminary Objection', icon: '✗',   hint: 'Jurisdictional or threshold objection — before the substance is heard.' },
  { id: 'reply_address',             label: 'Reply on Points of Law',            icon: '↩',   hint: "Responding only to new legal points raised in opposing counsel's address — no new facts." },
  { id: 'strategy_argument',         label: 'Case Strategy Argument',            icon: '◈',   hint: 'Internal strategic brief — options, probability, recommended approach and sequence.' },
] as const;

type ArgTypeId = typeof AB_ARG_TYPES[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────
// PROPS & LOCAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

interface IntelExtraction {
  legal_issues?:   string[];
  disputed_areas?: string[];
  gaps_identified?: string[];
  initial_risks?:  Array<{ risk: string; severity: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED LOCAL STYLES
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#07070f', border: '1px solid #1e1e2e',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Cormorant Garamond', serif", outline: 'none', boxSizing: 'border-box',
};
const lbS: React.CSSProperties = {
  fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif',
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};
const ACC = '#c4a030';

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ArgumentBuilder({ activeCase }: Props) {
  const caseId = activeCase.id;
  const intel   = activeCase.intelligence_data as unknown as {
    rawFacts?: string;
    intPkg?:   string;
    extraction?: IntelExtraction;
  } | undefined;
  const appeal  = activeCase.appeal_data;

  // ── Sub-tab ───────────────────────────────────────────────────────────────
  const [abTab, setAbTab] = useState<'import' | 'build' | 'history'>('import');

  // ── Intelligence import selections ───────────────────────────────────────
  const [selFacts,    setSelFacts]    = useState(true);
  const [selIntPkg,   setSelIntPkg]   = useState(true);
  const [selIssues,   setSelIssues]   = useState<number[]>([]);
  const [selDisputed, setSelDisputed] = useState<number[]>([]);
  const [selGaps,     setSelGaps]     = useState<number[]>([]);
  const [selRisks,    setSelRisks]    = useState<number[]>([]);
  const [extraCtx,    setExtraCtx]    = useState('');

  // ── Build config ──────────────────────────────────────────────────────────
  const [argType,    setArgType]    = useState<ArgTypeId | ''>('');
  const [argIssue,   setArgIssue]   = useState('');
  const [driveRAG,   setDriveRAG]   = useState(false);

  // ── Generation ────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState('');
  const [draft,      setDraft]      = useState('');

  // ── Version history ───────────────────────────────────────────────────────
  const [versions,  setVersions]  = useState<ArgumentVersion[]>([]);
  const [viewVer,   setViewVer]   = useState<ArgumentVersion | null>(null);
  const [versLoading, setVersLoading] = useState(true);

  // ── Copy ──────────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // Load versions on mount
  useEffect(() => {
    loadArgVersions(caseId).then(v => { setVersions(v); setVersLoading(false); });
  }, [caseId]);

  // ── Extracted intel ───────────────────────────────────────────────────────
  const ex         = intel?.extraction || {} as IntelExtraction;
  const legalIss   = ex.legal_issues    || [];
  const disputed   = ex.disputed_areas  || [];
  const gaps       = ex.gaps_identified || [];
  const risks      = ex.initial_risks   || [];
  const hasIntel   = !!(intel?.rawFacts || intel?.intPkg || legalIss.length);

  function toggleArr(arr: number[], setArr: React.Dispatch<React.SetStateAction<number[]>>, idx: number) {
    setArr(a => a.includes(idx) ? a.filter(x => x !== idx) : [...a, idx]);
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  function buildPrompt(): string {
    const c = activeCase;
    const lines: string[] = [];
    lines.push(`CASE: ${c.caseName}`);
    lines.push(`SUIT NO: ${c.suitNo || 'Not specified'}`);
    lines.push(`COURT: ${c.court || 'Not specified'}`);
    lines.push(`ROLE: ${c.role || 'Claimant'} — we act for the ${c.role || 'Claimant'}`);
    lines.push(`CLAIMANTS: ${c.claimants.map(p => p.name).filter(Boolean).join(', ') || 'Not specified'}`);
    lines.push(`DEFENDANTS: ${c.defendants.map(p => p.name).filter(Boolean).join(', ') || 'Not specified'}`);

    if (hasIntel) {
      lines.push('\n══ VETTED INTELLIGENCE — IMPORTED ITEMS ══');
      lines.push('(These items have passed through the Intelligence Engine — structured findings, not raw narration.)');
      if (selFacts  && intel?.rawFacts) lines.push(`\nVERIFIED FACTS:\n${intel.rawFacts}`);
      if (selIntPkg && intel?.intPkg)   lines.push(`\nINTELLIGENCE PACKAGE:\n${intel.intPkg}`);
      if (selIssues.length)   lines.push(`\nSELECTED LEGAL ISSUES:\n${selIssues.map(i => `- ${legalIss[i]}`).join('\n')}`);
      if (selDisputed.length) lines.push(`\nSELECTED DISPUTED AREAS:\n${selDisputed.map(i => `- ${disputed[i]}`).join('\n')}`);
      if (selGaps.length)     lines.push(`\nSELECTED EVIDENCE GAPS:\n${selGaps.map(i => `- ${gaps[i]}`).join('\n')}`);
      if (selRisks.length)    lines.push(`\nSELECTED RISKS:\n${selRisks.map(i => `- [${risks[i]?.severity || 'Risk'}] ${risks[i]?.risk || String(risks[i])}`).join('\n')}`);
    }

    if (appeal?.grounds) {
      const groundsText = Array.isArray(appeal.grounds)
        ? (appeal.grounds as string[]).map((g, i) => `${i + 1}. ${g}`).join('\n')
        : String(appeal.grounds);
      lines.push(`\nGROUNDS OF APPEAL:\n${groundsText}`);
    }

    if (extraCtx.trim())  lines.push(`\nLAWYER'S ADDITIONAL CONTEXT (counsel's notes, not client narration):\n${extraCtx.trim()}`);
    if (argIssue.trim())  lines.push(`\nSPECIFIC ISSUE / FOCUS FOR THIS ARGUMENT:\n${argIssue.trim()}`);

    return lines.join('\n');
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function generate() {
    if (!argType || generating) return;
    setGenerating(true); setGenError(''); setDraft('');

    const typeObj = AB_ARG_TYPES.find(t => t.id === argType);
    const context = buildPrompt();
    const prompt =
`You are drafting a ${typeObj?.label || argType} for Nigerian litigation. Using ONLY the vetted intelligence provided below (never raw client narration — the intelligence engine has already processed and structured these findings), produce a rigorous, authoritative legal argument suitable for submission to a Nigerian court.

FORMAT YOUR OUTPUT:
- Use ## headings for major sections
- Use sub-headings (###) for argument sub-points
- Apply IRAC structure within each issue (Issue → Rule → Application → Conclusion)
- Where you cite a case, use the format: [Case Name] (Year) Court
- Where you cannot confirm a specific authority, write [RESEARCH NEEDED: describe the type of authority required] — NEVER invent citations
- Be direct, persuasive, and precise — write as a senior Nigerian advocate addressing the court directly
- Document type guidance: ${typeObj?.hint || ''}
- Role posture: we represent the ${activeCase.role || 'Claimant'} — apply ${activeCase.role || 'Claimant'} strategy throughout

VETTED CASE INTELLIGENCE:
${context}

Now produce the ${typeObj?.label || argType}:`;

    try {
      const text = await callClaude({
        system: 'You are Senior Counsel at AFS Advocates, a Nigerian litigation firm. You produce court-ready legal arguments grounded in Nigerian law, procedure, and practice. You never invent case citations — where you need an authority, you flag it as [RESEARCH NEEDED: description]. You write with the authority and precision of a silk addressing a superior court. You always structure arguments with clear headings, IRAC logic, and a definitive conclusion.',
        userMsg: prompt,
        maxTokens: 4000,
        mcpDrive: driveRAG,
      });
      setDraft(text.trim());
      setAbTab('build');
    } catch (e) {
      setGenError((e as Error).message || 'Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Save version ──────────────────────────────────────────────────────────
  async function saveVersion() {
    if (!draft.trim()) return;
    const typeObj = AB_ARG_TYPES.find(t => t.id === argType);
    const ver: ArgumentVersion = {
      id:        uid(),
      label:     typeObj?.label || argType,
      argType:   argType,
      argIssue:  argIssue.trim(),
      content:   draft,
      createdAt: new Date().toISOString(),
      driveRAG,
      selCount:  selIssues.length + selDisputed.length + selGaps.length + selRisks.length
                 + (selFacts ? 1 : 0) + (selIntPkg ? 1 : 0),
    };
    const ok = await saveArgVersion(caseId, ver);
    if (ok) {
      setVersions(prev => [ver, ...prev]);
      alert('Saved to version history.');
    }
  }

  async function handleDeleteVersion(id: string) {
    if (!window.confirm('Delete this version? This cannot be recovered.')) return;
    await deleteArgVersion(id);
    setVersions(prev => prev.filter(v => v.id !== id));
    if (viewVer?.id === id) setViewVer(null);
  }

  async function handleCopy(text: string) {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Import summary ────────────────────────────────────────────────────────
  const importedCount =
    (selFacts && intel?.rawFacts ? 1 : 0) +
    (selIntPkg && intel?.intPkg ? 1 : 0) +
    selIssues.length + selDisputed.length + selGaps.length + selRisks.length;

  // ── CheckItem ─────────────────────────────────────────────────────────────
  function CheckItem({ checked, onChange, label, sub }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    sub?: string;
  }) {
    return (
      <div
        onClick={() => onChange(!checked)}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 13px', background: checked ? '#0d0d1c' : '#080808', border: `1px solid ${checked ? ACC + '44' : '#111120'}`, borderRadius: 6, cursor: 'pointer', transition: 'all .15s', marginBottom: 6 }}
      >
        <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${checked ? ACC : '#2a2a42'}`, background: checked ? ACC : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, transition: 'all .15s' }}>
          {checked && <span style={{ color: '#05050c', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, color: checked ? T.text : T.mute, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.6, wordBreak: 'break-word', margin: 0 }}>{label}</p>
          {sub && <p style={{ fontSize: 10, color: '#3a3a52', fontFamily: 'Inter, sans-serif', marginTop: 3, lineHeight: 1.5 }}>{sub}</p>}
        </div>
      </div>
    );
  }

  // ── Sub-tabs ───────────────────────────────────────────────────────────────
  const SUB_TABS = [
    { id: 'import'  as const, label: '1 · Import Intelligence', icon: '⬇' },
    { id: 'build'   as const, label: '2 · Build & Generate',    icon: '✍' },
    { id: 'history' as const, label: 'Version History',         icon: '📚' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22, paddingBottom: 20, borderBottom: `1px solid ${T.bdr}` }}>
        <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#120a00,#080400)', border: '1px solid #3a2a08', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, boxShadow: '0 0 20px #c4a03014' }}>✍</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600 }}>Argument Builder · Step 10</span>
            <RoleBadge role={activeCase.role || 'Claimant'} />
            {versions.length > 0 && (
              <span style={{ fontSize: 8, color: '#40a860', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', border: '1px solid #1a4028', background: '#02100a', padding: '1px 7px', borderRadius: 2, textTransform: 'uppercase' }}>
                {versions.length} Version{versions.length > 1 ? 's' : ''} Saved
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 24, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, letterSpacing: '.02em', marginBottom: 5, lineHeight: 1.2 }}>
            Argument Builder
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', lineHeight: 1.65 }}>
            Imports ONLY vetted intelligence — never raw narration. Select your facts and legal issues, pick the argument type, and generate a court-ready structured argument. Every draft saved to version history. Nothing lost.
          </p>
        </div>
      </div>

      {/* No intelligence warning */}
      {!hasIntel && (
        <div style={{ background: '#0e0a04', border: '1px solid #3a2808', borderRadius: 8, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⚠</span>
          <div>
            <p style={{ fontSize: 13, color: '#c09040', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 3 }}>No vetted intelligence yet</p>
            <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
              Run the ⚡ Intelligence Engine first. The Argument Builder imports from its structured output — never from raw client narration. You can still add Lawyer Context below and generate with that alone.
            </p>
          </div>
        </div>
      )}

      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 18, background: '#050508', border: '1px solid #111120', borderRadius: 7, padding: 3 }}>
        {SUB_TABS.map(sub => (
          <button
            key={sub.id}
            onClick={() => setAbTab(sub.id)}
            style={{ flex: 1, background: abTab === sub.id ? '#0d0d1c' : 'transparent', border: `1px solid ${abTab === sub.id ? ACC : 'transparent'}`, color: abTab === sub.id ? ACC : T.mute, borderRadius: 5, padding: '7px 8px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600, transition: 'all .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, whiteSpace: 'nowrap' }}
          >
            <span style={{ opacity: .8 }}>{sub.icon}</span>{sub.label}
            {sub.id === 'history' && versions.length > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: ACC, display: 'inline-block', flexShrink: 0 }} />}
            {sub.id === 'build'   && draft             && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#40a860', display: 'inline-block', flexShrink: 0 }} />}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          TAB 1 — IMPORT INTELLIGENCE
      ══════════════════════════════════════════ */}
      {abTab === 'import' && (
        <div style={{ animation: 'fadeUp .25s ease' }}>
          <p style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 16 }}>
            Select Items to Import into This Argument
          </p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.6, marginBottom: 18 }}>
            Only items that have passed through the Intelligence Engine appear here. Raw client narration is excluded — arguments must be built on structured, vetted findings.
          </p>

          {hasIntel ? (
            <>
              {/* Case Facts */}
              {intel?.rawFacts && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ ...lbS, marginBottom: 8 }}>Verified Case Facts</p>
                  <CheckItem
                    checked={selFacts}
                    onChange={v => setSelFacts(v)}
                    label="Verified Case Facts (full)"
                    sub={intel.rawFacts.slice(0, 160) + (intel.rawFacts.length > 160 ? '…' : '')}
                  />
                </div>
              )}

              {/* Intelligence Package */}
              {intel?.intPkg && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ ...lbS, marginBottom: 8 }}>Intelligence Package</p>
                  <CheckItem
                    checked={selIntPkg}
                    onChange={v => setSelIntPkg(v)}
                    label="Full Intelligence Package"
                    sub="Complete structured output — facts, disputes, missing evidence, legal issues, claims, risks."
                  />
                </div>
              )}

              {/* Legal Issues */}
              {legalIss.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={lbS}>Legal Issues ({legalIss.length})</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setSelIssues(legalIss.map((_, i) => i))} style={{ background: 'transparent', border: '1px solid #2a2208', color: ACC, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>All</button>
                      <button onClick={() => setSelIssues([])} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>None</button>
                    </div>
                  </div>
                  {legalIss.map((iss, i) => (
                    <CheckItem key={i} checked={selIssues.includes(i)} onChange={() => toggleArr(selIssues, setSelIssues, i)} label={iss} />
                  ))}
                </div>
              )}

              {/* Disputed Areas */}
              {disputed.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={lbS}>Disputed Areas ({disputed.length})</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setSelDisputed(disputed.map((_, i) => i))} style={{ background: 'transparent', border: '1px solid #2a2208', color: ACC, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>All</button>
                      <button onClick={() => setSelDisputed([])} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>None</button>
                    </div>
                  </div>
                  {disputed.map((d, i) => (
                    <CheckItem key={i} checked={selDisputed.includes(i)} onChange={() => toggleArr(selDisputed, setSelDisputed, i)} label={d} />
                  ))}
                </div>
              )}

              {/* Evidence Gaps */}
              {gaps.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={lbS}>Evidence Gaps ({gaps.length})</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setSelGaps(gaps.map((_, i) => i))} style={{ background: 'transparent', border: '1px solid #2a2208', color: ACC, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>All</button>
                      <button onClick={() => setSelGaps([])} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>None</button>
                    </div>
                  </div>
                  {gaps.map((g, i) => (
                    <CheckItem key={i} checked={selGaps.includes(i)} onChange={() => toggleArr(selGaps, setSelGaps, i)} label={g} />
                  ))}
                </div>
              )}

              {/* Risks */}
              {risks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={lbS}>Identified Risks ({risks.length})</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setSelRisks(risks.map((_, i) => i))} style={{ background: 'transparent', border: '1px solid #2a2208', color: ACC, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>All</button>
                      <button onClick={() => setSelRisks([])} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>None</button>
                    </div>
                  </div>
                  {risks.map((r, i) => (
                    <CheckItem key={i} checked={selRisks.includes(i)} onChange={() => toggleArr(selRisks, setSelRisks, i)}
                      label={`[${r.severity || 'Risk'}] ${r.risk || String(r)}`} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ background: '#080808', border: '1px solid #111120', borderRadius: 8, padding: '28px', textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 34, opacity: .06, marginBottom: 14 }}>⚡</div>
              <p style={{ fontSize: 16, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 8 }}>No intelligence data to import.</p>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.65, maxWidth: 420, margin: '0 auto' }}>
                Run the <strong style={{ color: T.dim }}>⚡ Intelligence Engine</strong> tab first. Your vetted facts, legal issues, disputes, gaps, and risks will appear here as checkboxes.
              </p>
            </div>
          )}

          {/* Lawyer's Additional Context */}
          <div style={{ background: '#0d0d18', border: `1px solid ${T.bdr}`, borderRadius: 8, padding: '18px 20px', marginBottom: 20 }}>
            <label style={lbS}>Lawyer's Additional Context</label>
            <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.55, marginBottom: 10 }}>
              Counsel's own instructions or notes — not from client narration. E.g. recently discovered evidence, specific instructions from client, strategic constraints.
            </p>
            <textarea
              value={extraCtx}
              onChange={e => setExtraCtx(e.target.value)}
              rows={4}
              placeholder="e.g. Client confirms payment was made 3 March 2024 — receipt found last week. Do not concede on the limitation point. Opposing counsel is likely to raise Adesanya v. Unibadan — we must pre-empt that."
              style={{ ...iS, resize: 'vertical', lineHeight: 1.75 }}
            />
          </div>

          <button
            onClick={() => setAbTab('build')}
            style={{ width: '100%', background: `linear-gradient(135deg,${ACC},#a07820)`, color: '#05050c', border: 'none', borderRadius: 7, padding: '13px 24px', fontSize: 16, fontFamily: "'Cormorant Garamond', serif", cursor: 'pointer', fontWeight: 600, letterSpacing: '.04em' }}
          >
            Continue to Build & Generate →
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB 2 — BUILD & GENERATE
      ══════════════════════════════════════════ */}
      {abTab === 'build' && (
        <div style={{ animation: 'fadeUp .25s ease' }}>
          <p style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 16 }}>
            Argument Configuration
          </p>

          {/* Argument type grid */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ ...lbS, marginBottom: 10 }}>Argument Type <span style={{ color: '#b06060' }}>*</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {AB_ARG_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setArgType(t.id)}
                  style={{ background: argType === t.id ? '#0d0d1c' : '#080808', border: `1px solid ${argType === t.id ? ACC : '#181828'}`, borderRadius: 7, padding: '11px 14px', textAlign: 'left', cursor: 'pointer', transition: 'all .15s' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, opacity: argType === t.id ? 1 : .6 }}>{t.icon}</span>
                    <span style={{ fontSize: 12, color: argType === t.id ? T.text : T.mute, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, lineHeight: 1.2 }}>{t.label}</span>
                  </div>
                  <p style={{ fontSize: 9, color: argType === t.id ? T.dim : '#2a2a42', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, margin: 0 }}>{t.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Specific issue */}
          <div style={{ marginBottom: 20 }}>
            <label style={lbS}>Specific Issue / Focus (Optional)</label>
            <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.5, marginBottom: 8 }}>
              State the precise legal or factual issue. More specific = sharper output.
            </p>
            <textarea
              value={argIssue}
              onChange={e => setArgIssue(e.target.value)}
              rows={3}
              placeholder="e.g. 'Whether the failure to serve the defendant personally invalidates the judgment' — or 'Argue time was of the essence and the claimant's breach is fatal to their claim'"
              style={{ ...iS, resize: 'vertical', lineHeight: 1.75 }}
            />
          </div>

          {/* Drive RAG toggle */}
          <div style={{ background: '#0d0d18', border: `1px solid ${T.bdr}`, borderRadius: 8, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 3 }}>Google Drive RAG</p>
              <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                Search your Drive for past briefs, research notes, and authorities on the same issue before generating. Enriches the argument with your existing work.
              </p>
            </div>
            <button
              onClick={() => setDriveRAG(v => !v)}
              style={{ background: driveRAG ? '#0d0d1c' : 'transparent', border: `1px solid ${driveRAG ? ACC + '50' : '#1e1e2e'}`, color: driveRAG ? ACC : T.mute, borderRadius: 5, padding: '7px 16px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: driveRAG ? ACC : '#2a2a3e', transition: 'background .15s', display: 'inline-block', flexShrink: 0 }} />
              {driveRAG ? 'Drive: Active' : 'Drive: Off'}
            </button>
          </div>

          {/* Import summary */}
          {hasIntel && (
            <div style={{ background: '#080808', border: '1px solid #111120', borderRadius: 7, padding: '12px 16px', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Imported Intelligence</p>
                <button onClick={() => setAbTab('import')} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 3, padding: '2px 9px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif', letterSpacing: '.04em' }}>← Edit Import</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selFacts   && intel?.rawFacts && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>Facts</span>}
                {selIntPkg  && intel?.intPkg   && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>Intelligence Package</span>}
                {selIssues.length   > 0 && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>{selIssues.length} Legal Issue{selIssues.length > 1 ? 's' : ''}</span>}
                {selDisputed.length > 0 && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>{selDisputed.length} Disputed Area{selDisputed.length > 1 ? 's' : ''}</span>}
                {selGaps.length     > 0 && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>{selGaps.length} Evidence Gap{selGaps.length > 1 ? 's' : ''}</span>}
                {selRisks.length    > 0 && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>{selRisks.length} Risk{selRisks.length > 1 ? 's' : ''}</span>}
                {extraCtx.trim()        && <span style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', border: '1px solid #2a2208', padding: '2px 8px', borderRadius: 2 }}>+ Counsel's Context</span>}
                {importedCount === 0 && !extraCtx.trim() && (
                  <span style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', fontStyle: 'italic' }}>Nothing selected — go to Import tab to select items.</span>
                )}
              </div>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={!argType || generating}
            style={{ width: '100%', background: !argType || generating ? '#0e0e18' : `linear-gradient(135deg,${ACC},#a07820)`, color: !argType || generating ? T.mute : '#05050c', border: !argType || generating ? '1px solid #1e1e2e' : 'none', borderRadius: 7, padding: '14px 24px', fontSize: 17, fontFamily: "'Cormorant Garamond', serif", cursor: !argType || generating ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em', transition: 'all .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            {generating
              ? <><Spinner size={14} /> Drafting argument…</>
              : argType
                ? <>✍ Generate {AB_ARG_TYPES.find(t => t.id === argType)?.label || 'Argument'}</>
                : <>Select an argument type above to continue</>
            }
          </button>

          {genError && (
            <div style={{ marginTop: 12, background: '#1a0808', border: '1px solid #4a1818', borderRadius: 6, padding: '11px 16px', color: '#c07070', fontSize: 13, fontFamily: 'Inter, sans-serif', lineHeight: 1.55 }}>
              {genError}
            </div>
          )}

          {/* Draft output */}
          {draft && (
            <div style={{ marginTop: 24, animation: 'fadeUp .35s ease' }}>
              <div style={{ background: '#0a0a14', border: `1px solid ${ACC}33`, borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: 9, color: '#40a860', fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>✓ Draft Ready — Unsaved</p>
                  <p style={{ fontSize: 16, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400 }}>
                    {AB_ARG_TYPES.find(t => t.id === argType)?.label}
                  </p>
                  {argIssue && (
                    <p style={{ fontSize: 12, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginTop: 3 }}>
                      {argIssue.slice(0, 90)}{argIssue.length > 90 ? '…' : ''}
                    </p>
                  )}
                  {driveRAG && (
                    <span style={{ fontSize: 8, color: '#4a7ed0', fontFamily: 'Inter, sans-serif', border: '1px solid #1a3060', background: '#040c18', padding: '1px 6px', borderRadius: 2, marginTop: 5, display: 'inline-block' }}>Drive RAG used</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleCopy(draft)}
                    style={{ background: copied ? '#071808' : 'transparent', border: `1px solid ${copied ? '#1a4018' : '#1e1e2e'}`, color: copied ? '#40a858' : T.mute, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', transition: 'all .2s' }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={saveVersion}
                    style={{ background: '#100d02', border: `1px solid ${ACC}44`, color: ACC, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    💾 Save Version
                  </button>
                  <button
                    onClick={generate}
                    style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}
                  >
                    ↻ Regenerate
                  </button>
                </div>
              </div>

              <div style={{ background: '#0a0a12', border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '24px 28px' }}>
                <Md text={draft} />
              </div>

              <p style={{ fontSize: 10, color: '#1e1e2e', fontFamily: 'Inter, sans-serif', marginTop: 10, textAlign: 'center', lineHeight: 1.7 }}>
                AI-generated from vetted intelligence. Verify every authority before filing. [RESEARCH NEEDED] tags require confirmed Nigerian citations before court use.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB 3 — VERSION HISTORY
      ══════════════════════════════════════════ */}
      {abTab === 'history' && (
        <div style={{ animation: 'fadeUp .25s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <p style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600 }}>
              Version History — {versions.length} Saved Draft{versions.length !== 1 ? 's' : ''}
            </p>
            {viewVer && (
              <button onClick={() => setViewVer(null)} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 4, padding: '5px 12px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}>
                ← All Versions
              </button>
            )}
          </div>

          {/* Version detail */}
          {viewVer ? (
            <div style={{ animation: 'fadeUp .2s ease' }}>
              <div style={{ background: '#0a0a14', border: `1px solid ${ACC}33`, borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: 9, color: ACC, fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Saved Version</p>
                  <p style={{ fontSize: 16, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400 }}>{viewVer.label}</p>
                  {viewVer.argIssue && (
                    <p style={{ fontSize: 12, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginTop: 3 }}>{viewVer.argIssue.slice(0, 90)}</p>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                    <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif' }}>
                      {new Date(viewVer.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {viewVer.driveRAG && (
                      <span style={{ fontSize: 8, color: '#4a7ed0', fontFamily: 'Inter, sans-serif', border: '1px solid #1a3060', background: '#040c18', padding: '1px 6px', borderRadius: 2 }}>Drive RAG</span>
                    )}
                    <span style={{ fontSize: 8, color: T.mute, fontFamily: 'Inter, sans-serif', border: '1px solid #111120', padding: '1px 6px', borderRadius: 2 }}>
                      {viewVer.content.length.toLocaleString()} chars
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleCopy(viewVer.content)}
                    style={{ background: copied ? '#071808' : 'transparent', border: `1px solid ${copied ? '#1a4018' : '#1e1e2e'}`, color: copied ? '#40a858' : T.mute, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', transition: 'all .2s' }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => { setDraft(viewVer.content); setArgType(viewVer.argType as ArgTypeId); setArgIssue(viewVer.argIssue || ''); setAbTab('build'); }}
                    style={{ background: '#100d02', border: `1px solid ${ACC}44`, color: ACC, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}
                  >
                    Load into Builder
                  </button>
                  <button
                    onClick={() => handleDeleteVersion(viewVer.id)}
                    style={{ background: 'transparent', border: '1px solid #2a1a1a', color: '#6a3030', borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ background: '#0a0a12', border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '24px 28px' }}>
                <Md text={viewVer.content} />
              </div>
            </div>

          ) : versLoading ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}><Spinner size={24} /></div>

          ) : versions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 24px', background: '#080808', border: '1px solid #111120', borderRadius: 10 }}>
              <div style={{ fontSize: 40, opacity: .06, marginBottom: 16 }}>📚</div>
              <p style={{ fontSize: 20, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 8 }}>No versions saved yet.</p>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.65, maxWidth: 380, margin: '0 auto' }}>
                Generate an argument in the Build tab, then click <strong style={{ color: T.dim }}>Save Version</strong>. Every saved draft will appear here — retrieve, copy, load back, or delete at any time.
              </p>
            </div>

          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {versions.map((ver, i) => (
                <div
                  key={ver.id}
                  style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 9, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14, transition: 'border-color .15s', cursor: 'default' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#2a2208')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#181828')}
                >
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: ACC, flexShrink: 0, marginTop: 7, opacity: i === 0 ? 0.8 : 0.35 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600 }}>{ver.label}</span>
                      {i === 0 && <span style={{ fontSize: 8, color: '#40a860', fontFamily: 'Inter, sans-serif', border: '1px solid #1a4028', background: '#020e06', padding: '1px 6px', borderRadius: 2 }}>Latest</span>}
                      {ver.driveRAG && <span style={{ fontSize: 8, color: '#4a7ed0', fontFamily: 'Inter, sans-serif', border: '1px solid #1a3060', background: '#040c18', padding: '1px 6px', borderRadius: 2 }}>Drive RAG</span>}
                    </div>
                    {ver.argIssue && (
                      <p style={{ fontSize: 11, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 4, lineHeight: 1.5 }}>
                        {ver.argIssue.slice(0, 100)}{ver.argIssue.length > 100 ? '…' : ''}
                      </p>
                    )}
                    <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif' }}>
                      {new Date(ver.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {ver.content.length.toLocaleString()} characters
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexShrink: 0, alignItems: 'center' }}>
                    <button
                      onClick={() => setViewVer(ver)}
                      style={{ background: 'transparent', border: `1px solid ${ACC}44`, color: ACC, borderRadius: 4, padding: '5px 12px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', whiteSpace: 'nowrap' }}
                    >
                      View →
                    </button>
                    <button
                      onClick={() => handleDeleteVersion(ver.id)}
                      style={{ background: 'transparent', border: '1px solid #2a1a1a', color: '#6a3030', borderRadius: 4, padding: '5px 9px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
