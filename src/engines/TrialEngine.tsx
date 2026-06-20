/**
 * AFS Legal OS — Trial Engine
 *
 * Phase 3 (Trial Engine Consolidation — Build Plan v2):
 *   Unified engine absorbing CrossExamEngine and all examination tabs.
 *
 * Phase 4 (Build Plan v2):
 *   Tab 1 — Case Theory Brief — fully implemented.
 *   Intelligence Package display · Library-grounded Legal Foundation ·
 *   AI-proposed CaseTheoryRecord (structured JSON) · Five-dimension score ·
 *   Inline editing of all fields · Re-Score · Lock with modal · Unlock with reason.
 *
 *   Tabs 2–7 render ComingSoon placeholders — implemented in Phases 5–8.
 *
 * Role detection: reads activeCase.counsel_role.
 *   prosecution / claimant_side → Prosecution/Claimant mode
 *   defence / defendant_side    → Defence/Defendant mode
 *
 * Storage: trial_ prefixed keys (additive). cx_ keys remain readable.
 *
 * @see CrossExamEngine.tsx  — deprecated stub (Phase 3D)
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case, CaseTheoryRecord } from '@/types';
import { T, S } from '@/constants/tokens';
import { CaseTheoryBanner, Md, ErrorBlock } from '@/components/common/ui';
import { useCaseTheory } from '@/hooks/useCaseTheory';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { saveCaseTheory, lockCaseTheory, unlockCaseTheory } from '@/storage/helpers';
import { getJurisdictionDelta } from '@/law/registry';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type TrialTab =
  | 'theory_brief'
  | 'witness_register'
  | 'exam_in_chief'
  | 'cross_examination'
  | 'contradiction_mapper'
  | 'impeachment_arsenal'
  | 'live_courtroom';

interface TabDef {
  id:    TrialTab;
  label: string;
  icon:  string;
  desc:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const TRIAL_TABS: TabDef[] = [
  {
    id:    'theory_brief',
    icon:  '◈',
    label: 'Case Theory Brief',
    desc:  'Build, score, and lock your case theory. Library-grounded, AI-proposed, fully editable. Locked theory propagates to every downstream tab.',
  },
  {
    id:    'witness_register',
    icon:  '◉',
    label: 'Witness Register',
    desc:  'Central witness database. Own witnesses and opposing witnesses. Load witness statements on oath. Set call order.',
  },
  {
    id:    'exam_in_chief',
    icon:  '✍',
    label: 'Examination-in-Chief',
    desc:  'Three-sided witness preparation bundle: counsel question script · witness study pack · anticipated cross-examination preparation.',
  },
  {
    id:    'cross_examination',
    icon:  '⚔',
    label: 'Cross-Examination',
    desc:  'Statement audit, theory-breach question generator, contradiction mapper, impeachment arsenal, live courtroom mode.',
  },
  {
    id:    'contradiction_mapper',
    icon:  '⟲',
    label: 'Contradiction Mapper',
    desc:  'Log and categorise statement contradictions. Map each contradiction to the cross-examination question that exploits it.',
  },
  {
    id:    'impeachment_arsenal',
    icon:  '§',
    label: 'Impeachment Arsenal',
    desc:  'Evidence Act 2011 admissibility analysis. Prior inconsistent statement deployment. Credibility attack framework.',
  },
  {
    id:    'live_courtroom',
    icon:  '⬛',
    label: 'Live Courtroom Mode',
    desc:  'Real-time AI advice as witness answers are typed. Theory-aware next-question guidance.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ROLE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

type TrialRole = 'prosecution_claimant' | 'defence_defendant' | 'unknown';

function detectTrialRole(activeCase: Case): TrialRole {
  const r = activeCase.counsel_role;
  if (r === 'prosecution' || r === 'claimant_side') return 'prosecution_claimant';
  if (r === 'defence'     || r === 'defendant_side') return 'defence_defendant';
  return 'unknown';
}

const ROLE_LABEL: Record<TrialRole, string> = {
  prosecution_claimant: 'Prosecution / Claimant',
  defence_defendant:    'Defence / Defendant',
  unknown:              'Role not set',
};

const ROLE_COLOR: Record<TrialRole, string> = {
  prosecution_claimant: '#7a4a00',
  defence_defendant:    '#1a5a30',
  unknown:              '#555555',
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY — PARSE AI THEORY JSON
// ─────────────────────────────────────────────────────────────────────────────

function parseTheoryJSON(raw: string): CaseTheoryRecord | null {
  try {
    const clean = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    // Find first { and last } to handle leading prose
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(clean.slice(start, end + 1));
    if (!parsed.core_proposition || !Array.isArray(parsed.elements)) return null;
    // Ensure score_breakdown always has a total
    if (!parsed.score_breakdown) {
      parsed.score_breakdown = {
        legal_sufficiency: 0, evidence_coverage: 0, vulnerability: 0,
        narrative_coherence: 0, jurisdictional_precision: 0, total: 0,
      };
    }
    parsed.score_breakdown.total =
      (parsed.score_breakdown.legal_sufficiency ?? 0) +
      (parsed.score_breakdown.evidence_coverage ?? 0) +
      (parsed.score_breakdown.vulnerability ?? 0) +
      (parsed.score_breakdown.narrative_coherence ?? 0) +
      (parsed.score_breakdown.jurisdictional_precision ?? 0);
    if (!Array.isArray(parsed.gap_report)) parsed.gap_report = [];
    return parsed as CaseTheoryRecord;
  } catch {
    return null;
  }
}

function emptyTheory(): CaseTheoryRecord {
  return {
    core_proposition: '',
    elements: [{ element: '', evidence: '', authority: '', risk: '' }],
    opposing_theory: '',
    theory_killer: '',
    weakest_link: '',
    narrative_theme: '',
    gap_report: [],
    score_breakdown: {
      legal_sufficiency: 0, evidence_coverage: 0, vulnerability: 0,
      narrative_coherence: 0, jurisdictional_precision: 0, total: 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Score bar ─────────────────────────────────────────────────────────────────

interface ScoreBarProps {
  label: string;
  value: number;
  max:   number;
}
function ScoreBar({ label, value, max }: ScoreBarProps) {
  const pct  = Math.min(100, Math.max(0, (value / max) * 100));
  const color = pct >= 75 ? '#2a6a3a' : pct >= 50 ? '#7a4a00' : '#8a1a1a';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
          {value}/{max}
        </span>
      </div>
      <div style={{ height: 4, background: '#eeeeee', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .4s ease' }} />
      </div>
    </div>
  );
}

// ── Score display ─────────────────────────────────────────────────────────────

interface ScoreDisplayProps { breakdown: CaseTheoryRecord['score_breakdown']; }
function ScoreDisplay({ breakdown }: ScoreDisplayProps) {
  const total = breakdown.total;
  const totalColor = total >= 80 ? '#2a6a3a' : total >= 60 ? '#7a4a00' : '#8a1a1a';
  return (
    <div style={{
      background: '#fafaf8',
      border: `1px solid ${T.bdr}`,
      borderRadius: 5,
      padding: '16px 20px',
      marginBottom: 20,
    }}>
      <p style={{ ...S.h3, marginTop: 0, marginBottom: 12 }}>Theory Score</p>
      <ScoreBar label="Legal Sufficiency"         value={breakdown.legal_sufficiency}        max={20} />
      <ScoreBar label="Evidence Coverage"          value={breakdown.evidence_coverage}         max={20} />
      <ScoreBar label="Vulnerability"              value={breakdown.vulnerability}             max={20} />
      <ScoreBar label="Narrative Coherence"        value={breakdown.narrative_coherence}       max={20} />
      <ScoreBar label="Jurisdictional Precision"   value={breakdown.jurisdictional_precision}  max={20} />
      <div style={{
        marginTop: 14, paddingTop: 10,
        borderTop: `1px solid ${T.bdr}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
          Total
        </span>
        <span style={{ fontSize: 22, color: totalColor, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
          {total}/100
        </span>
      </div>
    </div>
  );
}

// ── Elements editor ───────────────────────────────────────────────────────────

interface ElementsEditorProps {
  elements: CaseTheoryRecord['elements'];
  locked:   boolean;
  onChange: (elements: CaseTheoryRecord['elements']) => void;
}
function ElementsEditor({ elements, locked, onChange }: ElementsEditorProps) {
  function update(idx: number, field: string, val: string) {
    const next = elements.map((el, i) => i === idx ? { ...el, [field]: val } : el);
    onChange(next);
  }
  function add() {
    onChange([...elements, { element: '', evidence: '', authority: '', risk: '' }]);
  }
  function remove(idx: number) {
    onChange(elements.filter((_, i) => i !== idx));
  }

  const fieldStyle: React.CSSProperties = {
    ...S.ta, minHeight: 60, fontSize: 12, marginBottom: 6,
  };

  return (
    <div>
      {elements.map((el, i) => (
        <div key={i} style={{
          border: `1px solid ${T.bdr}`,
          borderRadius: 5,
          padding: '14px 16px',
          marginBottom: 10,
          background: '#fdfdfb',
          position: 'relative',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              Element {i + 1}
            </span>
            {!locked && elements.length > 1 && (
              <button onClick={() => remove(i)} style={{
                background: 'transparent', border: 'none', color: T.err,
                fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
              }}>
                Remove
              </button>
            )}
          </div>
          <label style={S.label}>Element to establish</label>
          <textarea style={fieldStyle} value={el.element} disabled={locked}
            onChange={e => update(i, 'element', e.target.value)}
            placeholder="The legal or factual element that must be proved…" />
          <label style={S.label}>Evidence that proves it</label>
          <textarea style={fieldStyle} value={el.evidence} disabled={locked}
            onChange={e => update(i, 'evidence', e.target.value)}
            placeholder="Specific evidence, exhibit reference, or witness testimony…" />
          <label style={S.label}>Authority (statute or case)</label>
          <textarea style={{ ...fieldStyle, minHeight: 44 }} value={el.authority} disabled={locked}
            onChange={e => update(i, 'authority', e.target.value)}
            placeholder="s.135 Evidence Act 2011 / Buhari v INEC [2011] 1 NWLR…" />
          <label style={S.label}>Risk if not proved</label>
          <textarea style={{ ...fieldStyle, minHeight: 44 }} value={el.risk} disabled={locked}
            onChange={e => update(i, 'risk', e.target.value)}
            placeholder="What collapses in our case if this element fails…" />
        </div>
      ))}
      {!locked && (
        <button onClick={add} style={{
          background: 'transparent', border: `1px dashed ${T.bdr}`,
          color: T.dim, borderRadius: 4, padding: '8px 16px',
          fontSize: 12, fontFamily: "'Times New Roman', Times, serif",
          cursor: 'pointer', width: '100%',
        }}>
          + Add Element
        </button>
      )}
    </div>
  );
}

// ── Gap report editor ─────────────────────────────────────────────────────────

interface GapReportEditorProps {
  gaps:     CaseTheoryRecord['gap_report'];
  locked:   boolean;
  onChange: (gaps: CaseTheoryRecord['gap_report']) => void;
}
function GapReportEditor({ gaps, locked, onChange }: GapReportEditorProps) {
  function resolve(idx: number) {
    onChange(gaps.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...gaps, { element: '', needed: '', suggested_action: '' }]);
  }
  function update(idx: number, field: string, val: string) {
    onChange(gaps.map((g, i) => i === idx ? { ...g, [field]: val } : g));
  }

  if (gaps.length === 0 && locked) {
    return (
      <div style={{ padding: '12px 14px', background: '#f0f8f0', border: '1px solid #b0d8b0', borderRadius: 4 }}>
        <span style={{ fontSize: 12, color: '#2a6a3a', fontFamily: "'Times New Roman', Times, serif" }}>
          No open gaps — theory is complete.
        </span>
      </div>
    );
  }

  return (
    <div>
      {gaps.map((g, i) => (
        <div key={i} style={{
          background: '#fff8f0', border: '1px solid #e0b888',
          borderLeft: '3px solid #c07820',
          borderRadius: 4, padding: '12px 14px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              ⚠ Gap {i + 1}
            </span>
            {!locked && (
              <button onClick={() => resolve(i)} style={{
                background: 'transparent', border: '1px solid #2a6a3a',
                color: '#2a6a3a', borderRadius: 3, padding: '2px 8px',
                fontSize: 10, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
              }}>
                Mark Resolved ✓
              </button>
            )}
          </div>
          <label style={S.label}>Element</label>
          <textarea style={{ ...S.ta, minHeight: 44, fontSize: 12, marginBottom: 6 }}
            value={g.element} disabled={locked}
            onChange={e => update(i, 'element', e.target.value)}
            placeholder="What element is unresolved…" />
          <label style={S.label}>What is needed</label>
          <textarea style={{ ...S.ta, minHeight: 44, fontSize: 12, marginBottom: 6 }}
            value={g.needed} disabled={locked}
            onChange={e => update(i, 'needed', e.target.value)}
            placeholder="The specific authority, document, or evidence needed…" />
          <label style={S.label}>Suggested action</label>
          <textarea style={{ ...S.ta, minHeight: 44, fontSize: 12 }}
            value={g.suggested_action} disabled={locked}
            onChange={e => update(i, 'suggested_action', e.target.value)}
            placeholder="Specific task — e.g. 'Research Court of Appeal decisions on s.131 Evidence Act'…" />
        </div>
      ))}
      {!locked && (
        <button onClick={add} style={{
          background: 'transparent', border: `1px dashed #e0b888`,
          color: '#7a4a00', borderRadius: 4, padding: '8px 16px',
          fontSize: 12, fontFamily: "'Times New Roman', Times, serif",
          cursor: 'pointer', width: '100%',
        }}>
          + Add Gap Item
        </button>
      )}
    </div>
  );
}

// ── Lock modal ────────────────────────────────────────────────────────────────

interface LockModalProps {
  score:    number;
  version:  number;
  onConfirm: () => void;
  onCancel:  () => void;
  loading:   boolean;
}
function LockModal({ score, version, onConfirm, onCancel, loading }: LockModalProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000,
    }}>
      <div style={{
        background: '#ffffff', border: `1px solid ${T.bdr}`,
        borderRadius: 6, padding: '28px 32px', maxWidth: 480, width: '90%',
        fontFamily: "'Times New Roman', Times, serif",
      }}>
        <h3 style={{ fontSize: 17, color: T.text, fontWeight: 700, marginBottom: 12, marginTop: 0 }}>
          Lock Case Theory
        </h3>
        <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.65, marginBottom: 6 }}>
          You are locking this theory at <strong>{score}/100</strong> (Version {version + 1}).
        </p>
        <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.65, marginBottom: 20 }}>
          Downstream engines — Final Written Address, ArgumentBuilder, and flagged
          Application types — will use this theory from this point forward.
          To change it later you must unlock it, and all previously generated
          drafts will carry a version mismatch warning.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={{
            background: 'transparent', border: `1px solid ${T.bdr}`,
            color: T.dim, borderRadius: 4, padding: '9px 20px',
            fontSize: 13, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} style={{
            background: '#1a5a30', border: 'none',
            color: '#ffffff', borderRadius: 4, padding: '9px 22px',
            fontSize: 13, cursor: loading ? 'wait' : 'pointer',
            fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
          }}>
            {loading ? 'Locking…' : 'Lock Theory ✓'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Unlock modal ──────────────────────────────────────────────────────────────

interface UnlockModalProps {
  note:     string;
  onNote:   (s: string) => void;
  onConfirm: () => void;
  onCancel:  () => void;
  loading:   boolean;
}
function UnlockModal({ note, onNote, onConfirm, onCancel, loading }: UnlockModalProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000,
    }}>
      <div style={{
        background: '#ffffff', border: `1px solid ${T.bdr}`,
        borderRadius: 6, padding: '28px 32px', maxWidth: 480, width: '90%',
        fontFamily: "'Times New Roman', Times, serif",
      }}>
        <h3 style={{ fontSize: 17, color: T.text, fontWeight: 700, marginBottom: 12, marginTop: 0 }}>
          Unlock Case Theory
        </h3>
        <p style={{ fontSize: 13, color: '#7a4a00', lineHeight: 1.65, marginBottom: 14 }}>
          Unlocking will pause theory propagation to all downstream engines until
          the theory is re-locked. All previously generated drafts will carry a
          version mismatch warning.
        </p>
        <label style={{ ...S.label, marginBottom: 6 }}>Reason for unlocking (required)</label>
        <textarea
          value={note}
          onChange={e => onNote(e.target.value)}
          style={{ ...S.ta, minHeight: 80, marginBottom: 16 }}
          placeholder="e.g. New evidence obtained from PW3's statement served 14 June 2026 — revising element 2…"
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={{
            background: 'transparent', border: `1px solid ${T.bdr}`,
            color: T.dim, borderRadius: 4, padding: '9px 20px',
            fontSize: 13, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
          }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !note.trim()}
            style={{
              background: note.trim() ? '#7a4a00' : '#dddddd',
              border: 'none', color: note.trim() ? '#ffffff' : '#aaaaaa',
              borderRadius: 4, padding: '9px 22px', fontSize: 13,
              cursor: loading || !note.trim() ? 'not-allowed' : 'pointer',
              fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
            }}
          >
            {loading ? 'Unlocking…' : 'Unlock Theory'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — CASE THEORY BRIEF TAB
// ─────────────────────────────────────────────────────────────────────────────

interface CaseTheoryBriefTabProps {
  activeCase:    Case;
  role:          TrialRole;
  theoryReload:  () => void;   // reloads the TrialEngine banner after mutations
}

function CaseTheoryBriefTab({ activeCase, role, theoryReload }: CaseTheoryBriefTabProps) {
  const caseId = activeCase.id;
  const ai     = useAI(activeCase);
  const { fullContext, hasIntel, raw } = useIntelligence(activeCase);

  // Local instance of useCaseTheory — drives this tab's rendering
  const { theory, locked, score, loading, reload } = useCaseTheory(caseId);

  // Local editable draft — initialized once from stored theory
  const [draft,     setDraft]     = useState<CaseTheoryRecord | null>(null);
  const [initiated, setInitiated] = useState(false);

  useEffect(() => {
    if (!loading && !initiated) {
      setDraft(theory ? { ...theory } : null);
      setInitiated(true);
    }
  }, [loading, theory, initiated]);

  // Legal Foundation (4B)
  const [legalFoundation,    setLegalFoundation]    = useState('');
  const [legalFdnLoading,    setLegalFdnLoading]    = useState(false);

  // Status flags
  const [proposeLoading,     setProposeLoading]     = useState(false);
  const [rescoreLoading,     setRescoreLoading]     = useState(false);
  const [saveLoading,        setSaveLoading]        = useState(false);
  const [lockLoading,        setLockLoading]        = useState(false);
  const [unlockLoading,      setUnlockLoading]      = useState(false);
  const [lockModalOpen,      setLockModalOpen]      = useState(false);
  const [unlockModalOpen,    setUnlockModalOpen]    = useState(false);
  const [unlockNote,         setUnlockNote]         = useState('');
  const [error,              setError]              = useState('');
  const [saveMsg,            setSaveMsg]            = useState('');

  const mutReload = useCallback(() => {
    reload();
    theoryReload();
  }, [reload, theoryReload]);

  // ── 4B — Pull Legal Foundation ────────────────────────────────────────────

  async function pullLegalFoundation() {
    setLegalFdnLoading(true);
    setError('');
    const jurisdelta = getJurisdictionDelta(
      activeCase.matter_track ?? 'civil',
      activeCase.court ?? '',
    );
    const result = await ai.ask({
      system: `You are a Nigerian senior advocate and legal analyst.
Extract the legal foundation for this matter from the intelligence package.
Be precise. Where the intelligence package does not provide sufficient evidence
for an element, flag it explicitly as a GAP.

Jurisdiction delta (override generic defaults with these):
${jurisdelta || 'No jurisdiction-specific delta available — apply general Nigerian law.'}`,
      userMsg: `Case: ${activeCase.caseName}
Court: ${activeCase.court ?? 'Not specified'}
Matter track: ${activeCase.matter_track ?? 'Not specified'}
Role: ${role === 'prosecution_claimant' ? 'Prosecution/Claimant' : role === 'defence_defendant' ? 'Defence/Defendant' : 'Unknown'}

INTELLIGENCE PACKAGE:
${fullContext || 'No intelligence package generated yet.'}

Return the following as plain text (no JSON):

## APPLICABLE CAUSE OF ACTION / CHARGES
List each legal element that must be proved, with the governing authority.

## BURDEN AND STANDARD OF PROOF
State who bears the burden, the standard, and the governing authority.

## LEADING AUTHORITIES
List statutes and cases that directly govern this matter.

## GAP REPORT
For each element where the intelligence package does not provide sufficient
evidence or authority: element | what is needed | specific suggested action.
If no gaps, state "No gaps identified."`,
    });
    setLegalFdnLoading(false);
    if (result) setLegalFoundation(result);
    else setError('Legal Foundation pull failed — check connection and retry.');
  }

  // ── 4C — Propose Case Theory ──────────────────────────────────────────────

  async function proposeTheory() {
    setProposeLoading(true);
    setError('');
    const result = await ai.ask({
      system: `You are a Nigerian senior advocate with 30 years trial experience.
You think in terms of winning propositions, not legal summaries.
Crystallise a case theory that is legally sufficient, evidence-grounded,
and simple enough for a judge to hold in mind through a complex trial.

CRITICAL: Return ONLY a JSON object with EXACTLY this structure — no preamble,
no markdown, no backticks, no explanation. Pure JSON only:
{
  "core_proposition": "One sentence. The single thing that if proved wins.",
  "elements": [
    {
      "element": "Legal/factual element to establish",
      "evidence": "Specific evidence that proves it",
      "authority": "Statute or case that supports it",
      "risk": "Risk if this element is not proved"
    }
  ],
  "opposing_theory": "Other side's case in one sentence",
  "theory_killer": "The one fact or document that defeats their theory",
  "weakest_link": "Our least confident element and our contingency",
  "narrative_theme": "The human story for the judge — non-legal language",
  "gap_report": [
    {
      "element": "Element with unresolved gap",
      "needed": "Specific authority, document, or evidence needed",
      "suggested_action": "Specific task — e.g. name a specific research task or document to obtain"
    }
  ],
  "score_breakdown": {
    "legal_sufficiency": 0,
    "evidence_coverage": 0,
    "vulnerability": 0,
    "narrative_coherence": 0,
    "jurisdictional_precision": 0,
    "total": 0
  }
}

Score each dimension 0–20. Total must equal the sum of the five dimensions.`,
      userMsg: `Case: ${activeCase.caseName}
Court: ${activeCase.court ?? 'Not specified'}
Role: ${role === 'prosecution_claimant' ? 'Prosecution/Claimant' : 'Defence/Defendant'}

INTELLIGENCE PACKAGE:
${fullContext}

LEGAL FOUNDATION:
${legalFoundation}

Produce the full CaseTheoryRecord JSON now.`,
    });
    setProposeLoading(false);
    if (!result) {
      setError('Theory proposal failed — check connection and retry.');
      return;
    }
    const parsed = parseTheoryJSON(result);
    if (!parsed) {
      setError('AI returned malformed JSON. Try again or start from a blank theory and edit manually.');
      return;
    }
    setDraft(parsed);
  }

  // ── Re-Score ──────────────────────────────────────────────────────────────

  async function rescoreTheory() {
    if (!draft) return;
    setRescoreLoading(true);
    setError('');
    const result = await ai.ask({
      system: `You are a Nigerian senior advocate scoring a case theory.
Return ONLY a JSON object with this structure — no preamble, no markdown:
{
  "legal_sufficiency": 0,
  "evidence_coverage": 0,
  "vulnerability": 0,
  "narrative_coherence": 0,
  "jurisdictional_precision": 0,
  "total": 0
}
Score each dimension 0–20. Total must equal the sum of all five.`,
      userMsg: `Case theory to score:

Core Proposition: ${draft.core_proposition}
Elements: ${draft.elements.map(e => `${e.element} [Evidence: ${e.evidence}] [Authority: ${e.authority}]`).join('\n')}
Opposing Theory: ${draft.opposing_theory}
Theory Killer: ${draft.theory_killer}
Weakest Link: ${draft.weakest_link}
Narrative Theme: ${draft.narrative_theme}
Open Gaps: ${draft.gap_report.length}

Court: ${activeCase.court ?? 'Not specified'}
Role: ${role}`,
    });
    setRescoreLoading(false);
    if (!result) { setError('Re-score failed.'); return; }
    try {
      const clean = result.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const sb = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
      sb.total = (sb.legal_sufficiency ?? 0) + (sb.evidence_coverage ?? 0) +
        (sb.vulnerability ?? 0) + (sb.narrative_coherence ?? 0) + (sb.jurisdictional_precision ?? 0);
      setDraft(prev => prev ? { ...prev, score_breakdown: sb } : prev);
    } catch {
      setError('Re-score returned malformed data — score not updated.');
    }
  }

  // ── Save Draft ────────────────────────────────────────────────────────────

  async function saveDraft() {
    if (!draft) return;
    setSaveLoading(true);
    setError('');
    setSaveMsg('');
    try {
      await saveCaseTheory(caseId, draft);
      mutReload();
      setSaveMsg('Draft saved.');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch {
      setError('Save failed — please try again.');
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Lock ──────────────────────────────────────────────────────────────────

  async function handleLock() {
    if (!draft) return;
    setLockLoading(true);
    setError('');
    try {
      // Save current draft first, then lock
      await saveCaseTheory(caseId, draft);
      await lockCaseTheory(caseId);
      setLockModalOpen(false);
      mutReload();
    } catch {
      setError('Lock failed — please try again.');
    } finally {
      setLockLoading(false);
    }
  }

  // ── Unlock ────────────────────────────────────────────────────────────────

  async function handleUnlock() {
    if (!unlockNote.trim()) return;
    setUnlockLoading(true);
    setError('');
    try {
      await unlockCaseTheory(caseId, unlockNote.trim());
      setUnlockModalOpen(false);
      setUnlockNote('');
      mutReload();
    } catch {
      setError('Unlock failed — please try again.');
    } finally {
      setUnlockLoading(false);
    }
  }

  // Sync draft with theory when theory changes after lock/unlock (reset to stored)
  useEffect(() => {
    if (!loading && initiated && (lockLoading || unlockLoading)) {
      // After lock/unlock the theory in storage is the authoritative version
      if (theory) setDraft({ ...theory });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theory, loading]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function updateDraftField(field: keyof CaseTheoryRecord, value: unknown) {
    setDraft(prev => prev ? { ...prev, [field]: value } : prev);
  }

  const version = (activeCase as any).case_theory_version ?? 0;
  const currentScore = draft?.score_breakdown?.total ?? score ?? 0;

  // ── Section heading ────────────────────────────────────────────────────────
  const sectionHead = (label: string): React.CSSProperties => ({
    fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif",
    fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
    marginTop: 28, marginBottom: 10, paddingBottom: 6,
    borderBottom: `1px solid ${T.bdrL}`,
  });

  if (loading) {
    return <div style={{ padding: 32, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* ── 4A: Intelligence Package ───────────────────────────────────────── */}
      <div>
        <p style={sectionHead('A — Intelligence Package')}>A — Intelligence Package</p>
        {hasIntel && raw.intPkg ? (
          <div style={{
            background: '#fafaf8', border: `1px solid ${T.bdr}`,
            borderRadius: 5, padding: '14px 18px', marginBottom: 4,
            maxHeight: 260, overflowY: 'auto',
          }}>
            <Md text={raw.intPkg} />
          </div>
        ) : (
          <div style={{
            padding: '20px 18px', background: '#fff8f8',
            border: '1px solid #e8c0c0', borderRadius: 5, marginBottom: 4,
          }}>
            <p style={{ fontSize: 13, color: '#8a1a1a', margin: 0, fontFamily: "'Times New Roman', Times, serif" }}>
              No Intelligence Package found. Run the <strong>Intelligence Engine</strong> through
              Step 5 before building the Case Theory.
            </p>
          </div>
        )}
        {raw.digest_at && (
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: '4px 0 0' }}>
            Last updated: {new Date(raw.digest_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* ── 4B: Legal Foundation ──────────────────────────────────────────── */}
      <div>
        <p style={sectionHead('B — Legal Foundation')}>B — Legal Foundation</p>
        <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 12 }}>
          Pull the statutory elements, burden of proof, leading authorities, and
          jurisdiction-specific rules for this matter. The AI reads the Intelligence
          Package and the Law Registry to produce the raw material for the theory proposal.
        </p>
        <button
          onClick={pullLegalFoundation}
          disabled={legalFdnLoading || !hasIntel}
          style={{
            ...(hasIntel ? S.btn : S.btnOff),
            width: 'auto', marginTop: 0, padding: '9px 22px',
          }}
        >
          {legalFdnLoading ? 'Pulling Legal Foundation…' : 'Pull Legal Foundation'}
        </button>
        {!hasIntel && (
          <p style={{ fontSize: 11, color: '#8a1a1a', fontFamily: "'Times New Roman', Times, serif", marginTop: 6 }}>
            Run Intelligence Engine first.
          </p>
        )}
        {legalFoundation && (
          <div style={{
            marginTop: 14, background: '#f7f9fd', border: `1px solid #b8cfe8`,
            borderRadius: 5, padding: '14px 18px',
          }}>
            <p style={{ fontSize: 10, color: '#1a3a6a', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Legal Foundation — Read Only
            </p>
            <Md text={legalFoundation} />
          </div>
        )}
      </div>

      {/* ── 4C: Propose Case Theory ───────────────────────────────────────── */}
      {legalFoundation && !draft && (
        <div style={{ marginTop: 20 }}>
          <p style={sectionHead('C — Propose Case Theory')}>C — Propose Case Theory</p>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 12 }}>
            AI will propose a complete structured Case Theory — core proposition,
            elements with evidence and authority, opposing theory, theory killer,
            weakest link, narrative theme, gap report, and initial score.
            All fields are editable before locking.
          </p>
          <button
            onClick={proposeTheory}
            disabled={proposeLoading}
            style={{ ...S.btn, width: 'auto', padding: '9px 22px', marginTop: 0 }}
          >
            {proposeLoading ? 'Proposing Case Theory…' : 'Propose Case Theory →'}
          </button>
        </div>
      )}

      {/* Manual start if no legal foundation pulled yet but theory also doesn't exist */}
      {!legalFoundation && !draft && hasIntel && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setDraft(emptyTheory())}
            style={{
              background: 'transparent', border: `1px solid ${T.bdr}`,
              color: T.dim, borderRadius: 4, padding: '9px 20px',
              fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
              marginTop: 10,
            }}
          >
            Or start with a blank theory →
          </button>
        </div>
      )}

      {/* Option to propose after foundation but draft already exists */}
      {legalFoundation && draft && !locked && (
        <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={proposeTheory}
            disabled={proposeLoading}
            style={{
              background: 'transparent', border: `1px solid ${T.bdr}`,
              color: T.dim, borderRadius: 4, padding: '8px 18px',
              fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            {proposeLoading ? 'Re-Proposing…' : '↺ Re-Propose from Foundation'}
          </button>
          <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
            This will overwrite the current draft fields.
          </span>
        </div>
      )}

      {/* ── 4D+4E: Score + Editable Fields ───────────────────────────────── */}
      {draft && (
        <div style={{ marginTop: 24 }}>

          {/* Score */}
          <ScoreDisplay breakdown={draft.score_breakdown} />

          {/* Gaps — shown prominently if any exist */}
          {draft.gap_report.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 11, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                ⚠ Open Gaps — {draft.gap_report.length} unresolved
              </p>
              <GapReportEditor
                gaps={draft.gap_report}
                locked={locked}
                onChange={gaps => updateDraftField('gap_report', gaps)}
              />
            </div>
          )}

          {/* Core Proposition */}
          <p style={sectionHead('Core Proposition')}>Core Proposition</p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, fontStyle: 'italic' }}>
            One sentence. The single thing that if proved wins this matter.
          </p>
          <textarea
            style={{ ...S.ta, minHeight: 80, fontWeight: 700, fontSize: 14 }}
            value={draft.core_proposition}
            disabled={locked}
            onChange={e => updateDraftField('core_proposition', e.target.value)}
            placeholder="If the Prosecution proves beyond reasonable doubt that the Accused…"
          />

          {/* Elements */}
          <p style={sectionHead('Elements to Establish')}>Elements to Establish</p>
          <ElementsEditor
            elements={draft.elements}
            locked={locked}
            onChange={els => updateDraftField('elements', els)}
          />

          {/* Opposing Theory */}
          <p style={sectionHead('Opposing Theory')}>Opposing Theory</p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, fontStyle: 'italic' }}>
            The other side's case in one sentence.
          </p>
          <textarea
            style={{ ...S.ta, minHeight: 60 }}
            value={draft.opposing_theory}
            disabled={locked}
            onChange={e => updateDraftField('opposing_theory', e.target.value)}
            placeholder="The Defence will argue that…"
          />

          {/* Theory Killer */}
          <p style={sectionHead('Theory Killer')}>Theory Killer</p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, fontStyle: 'italic' }}>
            The one fact or document that defeats their theory entirely.
          </p>
          <textarea
            style={{ ...S.ta, minHeight: 60 }}
            value={draft.theory_killer}
            disabled={locked}
            onChange={e => updateDraftField('theory_killer', e.target.value)}
            placeholder="Exhibit B (CCTV footage timestamped 14:32) directly contradicts the alibi…"
          />

          {/* Weakest Link */}
          <p style={sectionHead('Weakest Link')}>Weakest Link</p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, fontStyle: 'italic' }}>
            Our least confident element and our contingency if it fails.
          </p>
          <textarea
            style={{ ...S.ta, minHeight: 60 }}
            value={draft.weakest_link}
            disabled={locked}
            onChange={e => updateDraftField('weakest_link', e.target.value)}
            placeholder="Element 3 (identification) is weakest — PW2 gave a fleeting observation. Contingency: circumstantial chain via Exhibits A, C, and D is still sufficient."
          />

          {/* Narrative Theme */}
          <p style={sectionHead('Narrative Theme')}>Narrative Theme</p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, fontStyle: 'italic' }}>
            The human story for the judge — non-legal language.
          </p>
          <textarea
            style={{ ...S.ta, minHeight: 80 }}
            value={draft.narrative_theme}
            disabled={locked}
            onChange={e => updateDraftField('narrative_theme', e.target.value)}
            placeholder="This is a case about a vulnerable elderly woman whose life savings were systematically diverted by a trusted employee who exploited her declining health…"
          />

          {/* Gap Report (full editor if none shown above) */}
          {draft.gap_report.length === 0 && (
            <div style={{ marginTop: 28 }}>
              <p style={sectionHead('Gap Report')}>Gap Report</p>
              <GapReportEditor
                gaps={draft.gap_report}
                locked={locked}
                onChange={gaps => updateDraftField('gap_report', gaps)}
              />
            </div>
          )}

          {/* Error display */}
          {error && (
            <div style={{ marginTop: 14 }}>
              <ErrorBlock message={error} onDismiss={() => setError('')} />
            </div>
          )}

          {/* Action bar */}
          {!locked && (
            <div style={{
              marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap',
              alignItems: 'center', paddingTop: 16, borderTop: `1px solid ${T.bdrL}`,
            }}>
              <button
                onClick={rescoreTheory}
                disabled={rescoreLoading}
                style={{
                  background: 'transparent', border: `1px solid ${T.bdr}`,
                  color: T.dim, borderRadius: 4, padding: '9px 18px',
                  fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                {rescoreLoading ? 'Scoring…' : '◎ Re-Score'}
              </button>
              <button
                onClick={saveDraft}
                disabled={saveLoading}
                style={{
                  background: 'transparent', border: `1px solid ${T.bdr}`,
                  color: T.dim, borderRadius: 4, padding: '9px 18px',
                  fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                {saveLoading ? 'Saving…' : '↓ Save Draft'}
              </button>
              {saveMsg && (
                <span style={{ fontSize: 12, color: '#2a6a3a', fontFamily: "'Times New Roman', Times, serif" }}>
                  {saveMsg}
                </span>
              )}
              <button
                onClick={() => setLockModalOpen(true)}
                style={{
                  background: '#1a5a30', border: 'none',
                  color: '#ffffff', borderRadius: 4, padding: '9px 22px',
                  fontSize: 13, cursor: 'pointer',
                  fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                  marginLeft: 'auto',
                }}
              >
                Lock Theory ✓
              </button>
            </div>
          )}

          {/* Unlock bar (when locked) */}
          {locked && (
            <div style={{
              marginTop: 24, display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', paddingTop: 16, borderTop: `1px solid ${T.bdrL}`,
            }}>
              <span style={{ fontSize: 12, color: '#2a6a3a', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
                ✓ Theory locked — v{version} · {currentScore}/100
              </span>
              <button
                onClick={() => setUnlockModalOpen(true)}
                style={{
                  background: 'transparent', border: '1px solid #7a4a00',
                  color: '#7a4a00', borderRadius: 4, padding: '8px 18px',
                  fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Unlock Theory
              </button>
            </div>
          )}

          {error && !saveLoading && !proposeLoading && !rescoreLoading && (
            <div style={{ marginTop: 12 }}>
              <ErrorBlock message={error} onDismiss={() => setError('')} />
            </div>
          )}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {lockModalOpen && (
        <LockModal
          score={currentScore}
          version={version}
          onConfirm={handleLock}
          onCancel={() => setLockModalOpen(false)}
          loading={lockLoading}
        />
      )}
      {unlockModalOpen && (
        <UnlockModal
          note={unlockNote}
          onNote={setUnlockNote}
          onConfirm={handleUnlock}
          onCancel={() => { setUnlockModalOpen(false); setUnlockNote(''); }}
          loading={unlockLoading}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMING SOON PLACEHOLDER (Phases 5–8)
// ─────────────────────────────────────────────────────────────────────────────

interface ComingSoonProps {
  tab:   TabDef;
  phase: number;
}

function ComingSoon({ tab, phase }: ComingSoonProps) {
  return (
    <div style={{
      padding: '48px 32px',
      textAlign: 'center',
      border: `1px dashed ${T.bdr}`,
      borderRadius: 6,
      background: '#fafafa',
    }}>
      <div style={{ fontSize: 28, marginBottom: 14, opacity: 0.35 }}>{tab.icon}</div>
      <h3 style={{
        fontSize: 16, color: T.text,
        fontFamily: "'Times New Roman', Times, serif",
        fontWeight: 700, marginBottom: 10,
      }}>
        {tab.label}
      </h3>
      <p style={{
        fontSize: 13, color: T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        lineHeight: 1.6, maxWidth: 480, margin: '0 auto 18px',
      }}>
        {tab.desc}
      </p>
      <span style={{
        display: 'inline-block', fontSize: 10, color: T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        letterSpacing: '.14em', textTransform: 'uppercase',
        border: `1px solid ${T.bdr}`, borderRadius: 3, padding: '3px 10px',
      }}>
        Implemented in Phase {phase}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB CONTENT ROUTER
// ─────────────────────────────────────────────────────────────────────────────

interface TabContentProps {
  tab:          TrialTab;
  activeCase:   Case;
  role:         TrialRole;
  theoryReload: () => void;
}

function TabContent({ tab, activeCase, role, theoryReload }: TabContentProps) {
  const tabDef = TRIAL_TABS.find(t => t.id === tab)!;

  switch (tab) {
    case 'theory_brief':
      return (
        <CaseTheoryBriefTab
          activeCase={activeCase}
          role={role}
          theoryReload={theoryReload}
        />
      );
    case 'witness_register':
      return <ComingSoon tab={tabDef} phase={5} />;
    case 'exam_in_chief':
      return <ComingSoon tab={tabDef} phase={6} />;
    case 'cross_examination':
      return <ComingSoon tab={tabDef} phase={7} />;
    case 'contradiction_mapper':
    case 'impeachment_arsenal':
    case 'live_courtroom':
      return <ComingSoon tab={tabDef} phase={8} />;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIAL ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function TrialEngine({ activeCase }: Props) {
  const [activeTab, setActiveTab] = useState<TrialTab>('theory_brief');

  const trialRole  = detectTrialRole(activeCase);
  const roleColor  = ROLE_COLOR[trialRole];
  const roleLabel  = ROLE_LABEL[trialRole];

  // CaseTheoryBanner state — drives the persistent banner above tab nav
  const caseTheory = useCaseTheory(activeCase.id);

  // Callback passed into CaseTheoryBriefTab so banner refreshes after mutations
  const handleTheoryMutation = useCallback(() => {
    caseTheory.reload();
  }, [caseTheory]);

  return (
    <div>

      {/* ── Engine header ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h2 style={{
            fontSize: 20, color: T.text,
            fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, margin: 0,
          }}>
            Trial Engine
          </h2>
          <span style={{
            fontSize: 9, padding: '2px 9px', borderRadius: 2,
            fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
            border: `1px solid ${roleColor}22`,
            background: `${roleColor}11`,
            color: roleColor,
          }}>
            {roleLabel}
          </span>
        </div>
        <p style={{
          fontSize: 12, color: T.mute,
          fontFamily: "'Times New Roman', Times, serif",
          margin: 0, lineHeight: 1.5,
        }}>
          Unified examination and cross-examination engine. Case Theory Brief ·
          Witness Register · Examination-in-Chief · Cross-Examination ·
          Contradiction Mapper · Impeachment Arsenal · Live Courtroom Mode.
        </p>
      </div>

      {/* ── Case Theory Banner — always visible ───────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <CaseTheoryBanner
          theory={caseTheory.theory}
          locked={caseTheory.locked}
          score={caseTheory.score}
          hasTheory={caseTheory.hasTheory}
          onOpenTheory={() => setActiveTab('theory_brief')}
        />
      </div>

      {/* ── Tab navigation ────────────────────────────────────────────────── */}
      <div
        className="tab-scroll"
        style={{ margin: '0 0 22px', gap: 2, paddingBottom: 0 }}
      >
        {TRIAL_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.desc}
              style={{
                flexShrink:    0,
                background:    isActive ? '#e8e8e8' : 'transparent',
                border:        '1px solid transparent',
                borderBottom:  isActive ? '2px solid #e8e8e8' : '1px solid transparent',
                marginBottom:  isActive ? '-2px' : '0',
                color:         isActive ? '#111111' : '#888888',
                borderRadius:  '3px 3px 0 0',
                padding:       '6px 14px',
                fontSize:      12,
                fontFamily:    "'Times New Roman', Times, serif",
                cursor:        'pointer',
                letterSpacing: '.03em',
                fontWeight:    isActive ? 700 : 400,
                transition:    'background .15s, color .15s',
                whiteSpace:    'nowrap',
                display:       'flex',
                alignItems:    'center',
                gap:           5,
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                  (e.currentTarget as HTMLElement).style.color = '#333333';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#888888';
                }
              }}
            >
              <span style={{ fontSize: 11 }}>{tab.icon}</span>
              {tab.label}
              {tab.id === 'theory_brief' && caseTheory.hasTheory && (
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: '#2a6a3a', display: 'inline-block', flexShrink: 0,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active tab content ────────────────────────────────────────────── */}
      <TabContent
        tab={activeTab}
        activeCase={activeCase}
        role={trialRole}
        theoryReload={handleTheoryMutation}
      />

    </div>
  );
}
