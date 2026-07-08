import React, { useState, useCallback, useEffect } from 'react';
import type { ArgumentVersion, CaseTheoryRecord } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { useCaseContext } from '@/hooks/useCaseContext';
import { useCaseTheory } from '@/hooks/useCaseTheory';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { getPartyLabels } from '@/utils/getPartyLabels';
import { queryStatutes, isRagConfigured } from '@/services/statuteRag';
import { callClaude, withRetry } from '@/services/api';
import { loadArgVersions, saveArgVersion, deleteArgVersion, loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { getLawSync } from '@/law/registry';
import { Md, Spinner, ErrorBlock, CaseTheoryBanner } from '@/components/common/ui';
import { copyToClipboard, uid } from '@/utils';
import { ClauseBankPicker } from './ClauseBank';
import {
  FAIR_HEARING_REFERENCE,
  CIVIL_FWA_SEQUENCE,
  CRIMINAL_FWA_SEQUENCE,
} from '@/constants/legal';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#070710', border: '1px solid #cccccc',
  borderRadius: 5, color: '#e0dcd0', padding: '11px 14px', fontSize: 15,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.82, minHeight: 110 };
const labelS: React.CSSProperties = {
  fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 6,
};
const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #14141e',
  borderRadius: 8, padding: '20px 22px', marginBottom: 16,
};
const hS: React.CSSProperties = {
  fontSize: 20, color: T.text, fontWeight: 400,
  fontFamily: "'Times New Roman', Times, serif", marginBottom: 6, letterSpacing: '.02em',
};
const dimS: React.CSSProperties = {
  fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  lineHeight: 1.6, marginBottom: 14,
};

const ACC = '#4a7ed0';

// Phase 2C — small colored pill showing warrant_type, and a red/amber flag
// when rebuttal is empty on an otherwise-complete issue. Same styling as the
// equivalent pills added in ApplicationsEngine's IssueBuilder.
const WARRANT_TYPE_BADGE_COLOR: Record<'rule' | 'standard' | 'principle', { bg: string; fg: string }> = {
  rule:      { bg: '#132a1a', fg: '#40a060' },
  standard:  { bg: '#182a3a', fg: '#4090d0' },
  principle: { bg: '#2a1a30', fg: '#a060c0' },
};
function WarrantTypeBadge({ type }: { type: 'rule' | 'standard' | 'principle' }) {
  const c = WARRANT_TYPE_BADGE_COLOR[type] ?? WARRANT_TYPE_BADGE_COLOR.rule;
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
      textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10,
      background: c.bg, color: c.fg,
    }}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}
function FragileFlag() {
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
      padding: '2px 8px', borderRadius: 10, background: '#3a1808', color: '#d08040',
    }}>
      ⚠ Fragile — no rebuttal
    </span>
  );
}
function isIssueComplete(iss: { claim: string; warrant: string; grounds: string; conclusion: string }): boolean {
  return !!(iss.claim.trim() && iss.warrant.trim() && iss.grounds.trim() && iss.conclusion.trim());
}

// Phase 3A — defeasible branching, per issue. Unlike ApplicationsEngine's
// generateIssue() (one issue per call, so warrant_type can drive a single
// Layer-5 system instruction), generate() here drafts every issue in one
// call and issues can have different warrant_types — so the framing has to
// travel inline with each issue block in issuesText rather than as one
// top-level instruction.
function warrantTypeFraming(warrantType: 'rule' | 'standard' | 'principle'): string {
  switch (warrantType) {
    case 'standard':
      return 'weighted balancing test — weigh each relevant factor against the facts and reach a conclusion on the balance; do NOT claim certainty or present the outcome as automatic (use "on balance" / "the weight of the factors favours", not "clearly" / "undoubtedly")';
    case 'principle':
      return "equitable, conduct-based standard — frame the argument around the parties' conduct and what conscience/fairness requires, not a fixed if-then test";
    case 'rule':
    default:
      return 'strict if-then test — state the rule precisely, show plainly whether the facts satisfy it, and reach a definite conclusion without hedging';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE THEORY INJECTION — Trial Engine Consolidation, Phase 9A
//
// Final Written Address is flagged needsCaseTheory: true (always) in the
// build plan's Decision 1 table. Every draft call below (civil, criminal,
// reply) prepends this block to the system prompt whenever a locked theory
// exists. Lighter, narrative-style context (just the core proposition) is
// used elsewhere (ApplicationsEngine, Phase 9D); the full structured record
// is appropriate here because the Final Address is the document the theory
// is most directly built to win.
// ─────────────────────────────────────────────────────────────────────────────

function buildTheoryInjection(theory: CaseTheoryRecord): string {
  const base = `LOCKED CASE THEORY:
Core Proposition: ${theory.core_proposition}
Elements to Establish: ${theory.elements.map(e => e.element).join('; ')}
Opposing Theory: ${theory.opposing_theory}
Theory Killer: ${theory.theory_killer}
Narrative Theme: ${theory.narrative_theme}

Every issue argued in this Final Written Address must advance the Core Proposition or defeat the Opposing Theory. Do not raise issues that are neutral to this theory. Every submission must serve the verdict we are driving toward.

`;

  // Phase 10 — Library Query Log Inheritance.
  // Surface the log so the Final Address engine knows exactly which library
  // sources grounded every proposition in the Intelligence Package and which
  // laws the engine ran without at lock time. Arguments must not assume
  // those gaps were filled. Open gaps are flagged with [LIBRARY GAP].
  const log = theory.library_query_log;
  if (!log || (log.phases.length === 0 && log.open_gaps.length === 0)) return base;

  const logLines: string[] = [
    '── LIBRARY QUERY LOG (Phase 10 Inheritance) ──',
  ];

  if (log.phases.length > 0) {
    logLines.push('Sources consulted during Intelligence Engine pipeline:');
    log.phases.forEach(p => {
      logLines.push(`  ${p.retrieved ? '✓' : '○'} ${p.phase}: ${p.source_note}`);
    });
    logLines.push('');
  }

  if (log.open_gaps.length > 0) {
    logLines.push('⚑ Open gaps — statutes absent from library at lock time:');
    logLines.push('  Do not cite or rely on these laws. Mark any submission that would');
    logLines.push('  depend on them with [LIBRARY GAP: <statute name>].');
    logLines.push('');
    log.open_gaps.forEach(g => {
      logLines.push(`  ⚑ ${g.name} (needed for: ${g.reason})`);
    });
    logLines.push('');
  }

  logLines.push(`Log assembled: ${new Date(log.assembled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  if (theory.lock_version) logLines.push(`Theory lock version: ${theory.lock_version}`);
  logLines.push('');

  return base + logLines.join('\n') + '\n';
}

function Btn({ onClick, loading, disabled, label, accent = '#40a860' }: {
  onClick: () => void; loading: boolean; disabled?: boolean; label: string; accent?: string;
}) {
  const off = disabled && !loading;
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      background: loading || off ? '#101018' : `linear-gradient(135deg,#000000,${accent})`,
      color: loading || off ? '#2a2a38' : '#f0ece0',
      border: 'none', borderRadius: 6, padding: '11px 26px',
      fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
      cursor: loading || off ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function SubTabBar({ tabs, active, onSelect, accent }: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  accent: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24 }}>
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <button key={t.id} onClick={() => onSelect(t.id)} style={{
            background: isActive ? `${accent}18` : 'transparent',
            border: `1px solid ${isActive ? `${accent}50` : '#cccccc'}`,
            color: isActive ? accent : '#888888',
            borderRadius: 5, padding: '7px 16px', fontSize: 11,
            fontFamily: "'Times New Roman', Times, serif",
            cursor: 'pointer', fontWeight: 600, letterSpacing: '.06em',
            transition: 'all .15s', whiteSpace: 'nowrap',
          }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE TYPES
// ─────────────────────────────────────────────────────────────────────────────

type StageId = 'draft' | 'research' | 'validate' | 'synthesise';

type DraftSubTab = 'intel' | 'build' | 'reply' | 'status' | 'versions';

type FilingStatus = 'Not Filed' | 'Draft Ready' | 'Filed' | 'Adopted' | 'Adoption Denied';

interface FWAStatus {
  status:      FilingStatus;
  dateFiled:   string;
  dateAdopted: string;
  notes:       string;
}

interface Authority {
  id:         string;
  caseName:   string;
  citation:   string;
  court:      string;
  year:       string;
  principle:  string;
  bindingFor: string;
  validated:  boolean;
  validation: string;
  addedAt:    string;
}

const STAGES: { id: StageId; number: number; icon: string; label: string; color: string }[] = [
  { id: 'draft',      number: 1, icon: '✍',  label: 'Draft',      color: '#4a7ed0' },
  { id: 'research',   number: 2, icon: '🔍', label: 'Research',   color: '#c4a030' },
  { id: 'validate',   number: 3, icon: '§',  label: 'Validate',   color: '#c07030' },
  { id: 'synthesise', number: 4, icon: '◉',  label: 'Synthesise', color: '#40a878' },
];

const STATUS_OPTS: FilingStatus[] = ['Not Filed', 'Draft Ready', 'Filed', 'Adopted', 'Adoption Denied'];
const STATUS_COLORS: Record<FilingStatus, { bg: string; col: string; bdr: string }> = {
  'Not Filed':       { bg: '#101018', col: '#505080', bdr: '#202030' },
  'Draft Ready':     { bg: '#181000', col: '#b08030', bdr: '#3a2800' },
  'Filed':           { bg: '#0d1800', col: '#50c050', bdr: '#285000' },
  'Adopted':         { bg: '#071810', col: '#40b068', bdr: '#1a4028' },
  'Adoption Denied': { bg: '#1a0808', col: '#c05050', bdr: '#4a1818' },
};

const NIGERIAN_COURTS = [
  'Supreme Court', 'Court of Appeal', 'Federal High Court',
  'High Court (State)', 'National Industrial Court', 'Other',
];

// ─── Dexie-backed persistence helpers ────────────────────────────────────────
// Originally used localStorage (fwa_/ave_ keys). Migrated to saveBlindSpot
// in Phase 2D — localStorage is evicted under storage pressure and is
// unavailable after PWA reinstall, both of which occur offline.
//
// One-shot migration: if Dexie has no value but localStorage does, copy it
// across so existing users don't lose their draft/status/auths.

async function fwaLoad<T>(caseId: string, key: string, def: T): Promise<T> {
  const result = await loadBlindSpot<Record<string, unknown>>(caseId, `fwa_${key}`, undefined as any);
  if (result !== null && result !== undefined) return result as unknown as T;
  // Migration shim — carry over from localStorage if present
  try {
    const ls = localStorage.getItem(`fwa_${caseId}_${key}`);
    if (ls) {
      const parsed = JSON.parse(ls) as T;
      await saveBlindSpot(caseId, `fwa_${key}`, parsed);
      localStorage.removeItem(`fwa_${caseId}_${key}`);
      return parsed;
    }
  } catch { /**/ }
  return def;
}

async function fwaSave(caseId: string, key: string, val: unknown): Promise<void> {
  await saveBlindSpot(caseId, `fwa_${key}`, val);
}

async function aveLoad<T>(caseId: string, key: string, def: T): Promise<T> {
  const result = await loadBlindSpot<Record<string, unknown>>(caseId, `ave_${key}`, undefined as any);
  if (result !== null && result !== undefined) return result as unknown as T;
  try {
    const ls = localStorage.getItem(`ave_${caseId}_${key}`);
    if (ls) {
      const parsed = JSON.parse(ls) as T;
      await saveBlindSpot(caseId, `ave_${key}`, parsed);
      localStorage.removeItem(`ave_${caseId}_${key}`);
      return parsed;
    }
  } catch { /**/ }
  return def;
}

async function aveSave(caseId: string, key: string, val: unknown): Promise<void> {
  await saveBlindSpot(caseId, `ave_${key}`, val);
}

function defaultStatus(): FWAStatus {
  return { status: 'Not Filed', dateFiled: '', dateAdopted: '', notes: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE BAR
// ─────────────────────────────────────────────────────────────────────────────

function PipelineBar({ activeStage, onStageClick }: {
  activeStage: StageId;
  onStageClick: (id: StageId) => void;
}) {
  const activeIndex = STAGES.findIndex(s => s.id === activeStage);
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.bdr}`,
      borderRadius: 10, padding: '16px 18px', marginBottom: 16,
    }}>
      <div style={{
        fontSize: 9, color: T.dim, fontFamily: "'Times New Roman', Times, serif",
        letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14,
      }}>
        Final Written Address — Pipeline
      </div>
      <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
        <div style={{
          position: 'absolute', top: '50%', left: '10%', right: '10%',
          height: 1, background: T.bdr, transform: 'translateY(-50%)', zIndex: 0,
        }} />
        {STAGES.map((stage, i) => {
          const active   = stage.id === activeStage;
          const complete = i < activeIndex;
          const col      = active ? stage.color : complete ? '#40a878' : T.mute;
          return (
            <button key={stage.id} onClick={() => onStageClick(stage.id)} style={{
              flex: 1, background: active ? `${stage.color}12` : complete ? '#071a0e' : T.bg,
              border: `1px solid ${active ? stage.color + '55' : complete ? '#1a4028' : T.bdr}`,
              borderRadius: 7, padding: '12px 10px', textAlign: 'center',
              cursor: 'pointer', position: 'relative', zIndex: 1, margin: '0 4px',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: active ? stage.color : complete ? '#40a878' : T.bdr,
                color: '#fff', fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 7px',
              }}>
                {complete ? '✓' : stage.number}
              </div>
              <div style={{
                fontSize: 12, color: col,
                fontFamily: "'Times New Roman', Times, serif",
                fontWeight: active ? 700 : 400,
              }}>
                {stage.icon} {stage.label}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{
        marginTop: 10, fontSize: 10, color: T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        fontStyle: 'italic', textAlign: 'center',
      }}>
        Stage 1 → Stage 2 → Stage 3 → Stage 4 · Civil and criminal diverge at Stage 1 only
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

const FWA_SENIOR_COUNSEL_SYSTEM = `You are Senior Counsel at AFS Advocates, a Nigerian litigation firm. You produce court-ready legal arguments grounded in Nigerian law, procedure, and practice. You NEVER invent case citations, names, years, volumes, or law reports — fabricating authorities is a professional disciplinary offence. Where you need a case authority, you output a structured [RESEARCH NEEDED]...[/RESEARCH NEEDED] block with the exact LawPavilion search terms specified in the instruction. Where statute sections are provided from the firm's verified library, you cite them directly. You write with the authority and precision of a silk addressing a superior court. You always structure arguments with clear headings, IRAC logic, and a definitive conclusion.`;

const RESEARCH_BLOCK_INSTRUCTION = `Where you need a case authority but cannot be certain it exists, output a RESEARCH BLOCK in this EXACT format (no deviations):

[RESEARCH NEEDED]
Proposition: [the exact legal proposition this authority must establish — one sentence]
Area of law: [e.g. Land Law / Contract / Criminal Procedure / Evidence / Constitutional Law]
Court level needed: [Supreme Court | Court of Appeal | High Court — specify which is strongest for this point]
LawPavilion search 1: [3–5 keyword phrase optimised for LawPavilion full-text search]
LawPavilion search 2: [alternative keyword phrase — different angle on the same point]
LawPavilion search 3: [narrower phrase using legal terms of art for this proposition]
What the case must decide: [one sentence — what the ratio or holding must say to support the argument]
[/RESEARCH NEEDED]

NEVER invent a case name, citation, year, volume, or law report. If in doubt, output the RESEARCH BLOCK.`;

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SUB-TAB: INTEL
// ─────────────────────────────────────────────────────────────────────────────

function IntelTab({ activeCase }: { activeCase: Case }) {
  const { hasIntel, fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  return (
    <div>
      {!hasIntel && (
        <div style={{
          padding: '14px 18px', background: '#1a0e00', border: '1px solid #4a3800',
          borderLeft: '3px solid #c4a030', borderRadius: '0 8px 8px 0', marginBottom: 18,
        }}>
          <p style={{ fontSize: 13, color: '#c4a030', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
            ⚠ No intelligence package detected. Run the Intelligence Engine first for best results.
            The drafter will still work but will rely solely on case fields rather than vetted intelligence.
          </p>
        </div>
      )}
      {hasIntel && (
        <div style={{
          padding: '10px 16px', background: '#071a0e', border: '1px solid #1a4028',
          borderLeft: '3px solid #40b068', borderRadius: '0 8px 8px 0', marginBottom: 18,
        }}>
          <p style={{ fontSize: 11, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", margin: 0, fontWeight: 700, letterSpacing: '.08em' }}>
            ✓ Intelligence Package loaded — will be injected into all AI calls
          </p>
        </div>
      )}
      <div style={cardS}>
        <h3 style={hS}>Case Intelligence</h3>
        <p style={dimS}>Everything the engine knows about this case. This is injected automatically into every AI call in Stages 1–4.</p>
        <pre style={{
          background: '#06060e', border: '1px solid #1a1a2a', borderRadius: 6,
          padding: '14px 16px', fontSize: 11, color: '#c0bcc0',
          fontFamily: "'Times New Roman', Times, serif", whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', lineHeight: 1.7, maxHeight: 500, overflowY: 'auto',
        }}>
          {fullContext || '(No intelligence data found for this case.)'}
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — PROCEDURAL BANNER
// ─────────────────────────────────────────────────────────────────────────────

function ProceduralBanner({ activeCase }: { activeCase: Case }) {
  const isCriminal = activeCase.matter_track === 'criminal';
  const sequence   = isCriminal ? CRIMINAL_FWA_SEQUENCE : CIVIL_FWA_SEQUENCE;
  const defDays    = getLawSync('civil_fwa_defendant_days');
  const clmDays    = getLawSync('civil_fwa_claimant_days');
  const replyDays  = getLawSync('civil_fwa_reply_days');
  const prosDays   = getLawSync('criminal_fwa_prosecution_days');

  return (
    <div style={{
      background: '#0a0a14', border: '1px solid #2a2a40',
      borderRadius: 8, padding: '16px 18px', marginBottom: 18,
    }}>
      <div style={{
        fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif",
        letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12,
      }}>
        Procedural Sequence — {isCriminal ? 'Criminal' : 'Civil'} Final Written Address
      </div>
      {sequence.map(step => (
        <div key={step.step} style={{
          display: 'flex', gap: 12, marginBottom: 10, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%', background: ACC,
            color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {step.step}
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
              {step.party} — {step.action}
            </div>
            <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
              {step.note}
            </div>
          </div>
        </div>
      ))}
      {!isCriminal && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px solid #1a1a2a',
          fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
        }}>
          Day counts (from Law Registry — verify against court's rules):{' '}
          Defendant files within <strong style={{ color: T.text }}>{defDays || 'N/A'}</strong> days ·{' '}
          Claimant responds within <strong style={{ color: T.text }}>{clmDays || 'N/A'}</strong> days ·{' '}
          Reply within <strong style={{ color: T.text }}>{replyDays || 'N/A'}</strong> days
        </div>
      )}
      {isCriminal && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px solid #1a1a2a',
          fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
        }}>
          Prosecution response window (from Law Registry):{' '}
          <strong style={{ color: T.text }}>{prosDays || 'N/A'}</strong> days after receiving Defence address.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SUB-TAB: BUILD (Civil)
// ─────────────────────────────────────────────────────────────────────────────

interface IssueEntry {
  id:           string;
  claim:        string;
  grounds:      string;
  warrant:      string;
  warrant_type: 'rule' | 'standard' | 'principle';
  qualifier:    string;
  rebuttal:     string;
  conclusion:   string;
}

function CivilDrafterTab({ activeCase, onDraftSaved }: {
  activeCase: Case;
  onDraftSaved: (draft: string) => void;
}) {
  const { ask, loading, error } = useAI(activeCase);
  // Phase 4A — separate ask() for rebuttal generation; per-issue loading since
  // multiple IssueEntry rows exist at once (unlike ApplicationsEngine's single draftIssue).
  const { ask: rebuttalAsk } = useAI(activeCase);
  const [rebuttalLoadingId, setRebuttalLoadingId] = useState<string | null>(null);
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  const labels = getPartyLabels(activeCase);

  // Phase 9A — locked Case Theory, read locally so this tab can inject and
  // run the Theory Consistency Check independently of the engine shell.
  const { theory, locked, score, hasTheory, loading: theoryLoading } = useCaseTheory(activeCase.id);

  const [issues,      setIssues]      = useState<IssueEntry[]>([
    { id: uid(), claim: '', grounds: '', warrant: '', warrant_type: 'rule', qualifier: '', rebuttal: '', conclusion: '' },
  ]);
  const [extraCtx,    setExtraCtx]    = useState('');
  const [draft,       setDraft]       = useState('');
  const [showClausePicker, setShowClausePicker] = useState(false);
  const [ragFetching, setRagFetching] = useState(false);
  const [ragError,    setRagError]    = useState('');

  // Phase 9A — Theory Consistency Check result for the assembled draft
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkResult,  setCheckResult]  = useState('');
  const { ask: checkAsk } = useAI(activeCase);

  async function runTheoryCheck() {
    if (!theory || !draft.trim()) return;
    setCheckRunning(true);
    setCheckResult('');
    const result = await checkAsk({
      system: 'You are a senior Nigerian advocate reviewing a completed Final Written Address against the locked Case Theory for drift. Be specific and surgical.',
      userMsg: `LOCKED CASE THEORY:
Core Proposition: ${theory.core_proposition}
Elements to Establish: ${theory.elements.map(e => e.element).join('; ')}
Opposing Theory: ${theory.opposing_theory}
Theory Killer: ${theory.theory_killer}

DRAFT FINAL WRITTEN ADDRESS:
${draft}

For each issue or major submission in the draft, state whether it advances the Core Proposition, defeats the Opposing Theory, or is neutral to the theory. Flag every submission that is neutral or drifts off-theory with a specific note on how to fix it — name the issue, explain the gap, and suggest the precise addition or reframing needed. If every issue is theory-consistent, say so plainly. Be concise — a short flagged list, not a rewritten draft.`,
      maxTokens: 1200,
    });
    setCheckRunning(false);
    if (result) setCheckResult(result.trim());
  }

  function addIssue() {
    setIssues(prev => [...prev, { id: uid(), claim: '', grounds: '', warrant: '', warrant_type: 'rule', qualifier: '', rebuttal: '', conclusion: '' }]);
  }
  function removeIssue(id: string) {
    setIssues(prev => prev.filter(i => i.id !== id));
  }
  function updateIssue(id: string, field: keyof IssueEntry, val: string) {
    setIssues(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i));
  }

  // Phase 4A — AI rebuttal generation. Mirrors runTheoryCheck's shape (senior counsel
  // persona system prompt, single ask() call, result trimmed straight into state).
  // Output lands in the issue's rebuttal field, left editable — not auto-locked.
  async function generateRebuttal(id: string) {
    const iss = issues.find(i => i.id === id);
    if (!iss || !iss.claim.trim() || !iss.grounds.trim()) return;
    setRebuttalLoadingId(id);
    const result = await rebuttalAsk({
      system: 'You are senior counsel stress-testing a colleague\'s argument before a Nigerian court. Be exacting and adversarial in your analysis, not diplomatic.',
      userMsg: `CLAIM: ${iss.claim}
GROUNDS: ${iss.grounds}
WARRANT: ${iss.warrant || '[not yet supplied]'}
WARRANT TYPE: ${iss.warrant_type}

Identify the single strongest fact or doctrine that defeats this argument. Then state whether, and how, the Grounds above already answer it — or whether it remains unaddressed. Be concise: 3-5 sentences, no headings, no restating the claim back.`,
      maxTokens: 400,
    });
    setRebuttalLoadingId(null);
    if (result) updateIssue(id, 'rebuttal', result.trim());
  }

  async function generate() {
    const validIssues = issues.filter(i => i.claim.trim());
    if (!validIssues.length) return;

    const isMatrimonial = activeCase.originating_process === 'petition_matrimonial';

    let statuteSections = '';
    if (isRagConfigured()) {
      setRagFetching(true);
      setRagError('');
      const ragQuery = validIssues.map(i => i.claim).join(' ');
      try {
        const ragResult = await queryStatutes(ragQuery, { topK: 6 });
        if (!ragResult.skipped && ragResult.chunks.length > 0) {
          statuteSections = ragResult.chunks.map((c: any, i: number) =>
            `[STATUTE ${i + 1}] Section ${c.section}, ${c.actName}\n${c.text}\n[/STATUTE ${i + 1}]`
          ).join('\n\n');
        }
        if (ragResult.error) setRagError(ragResult.error);
      } catch { /**/ }
      setRagFetching(false);
    }

    const issuesText = validIssues.map((iss, i) => `
CLAIM ${i + 1}: ${iss.claim}
Warrant (${iss.warrant_type}): ${iss.warrant || '[counsel to supply]'}
Argue this warrant as a ${warrantTypeFraming(iss.warrant_type)}.
Grounds: ${iss.grounds || '[counsel to supply]'}
${iss.qualifier.trim() ? `Qualifier: ${iss.qualifier.trim()} — hedge the conclusion accordingly; do not assert flatly beyond what this qualifier permits.\n` : ''}Conclusion: ${iss.conclusion || '[counsel to supply]'}
${iss.rebuttal.trim() ? `Anticipate and answer the following objection before moving to the next issue: ${iss.rebuttal.trim()}\n` : ''}`).join('\n');

    // ── Matrimonial-specific prompt branch ────────────────────────────────
    const matrimonialData = (activeCase as any).matrimonial_data;
    const matrimonialBlock = matrimonialData ? `
MATRIMONIAL DATA:
Dissolution Fact (s.15(2) MCA): ${matrimonialData.dissolution_fact ?? '[not specified]'}
Particulars: ${matrimonialData.particulars ?? '[not specified]'}
Two-Year Bar Status (s.30 MCA): ${matrimonialData.two_year_bar_status ?? '[not specified]'}
Ancillary Relief Claims: ${matrimonialData.ancillary_relief ?? '[not specified]'}
` : '';

    const userMsg = isMatrimonial
      ? `Draft a Final Written Address for matrimonial cause proceedings under the Matrimonial Causes Act (MCA).

CASE: ${activeCase.caseName}
PETITION NO: ${activeCase.suitNo || 'Not specified'}
COURT: ${activeCase.court || 'Not specified'}
COUNSEL ROLE: We act for the ${labels.ourSide}
PETITIONER: ${activeCase.claimants?.map((p: any) => p.name).filter(Boolean).join(', ') || 'Not specified'}
RESPONDENT: ${activeCase.defendants?.map((p: any) => p.name).filter(Boolean).join(', ') || 'Not specified'}

${statuteSections ? `VERIFIED STATUTE SECTIONS FROM FIRM LIBRARY:\n${statuteSections}\n\nCite these directly and accurately. Format: Section [X], [Full Act Name].` : ''}
${matrimonialBlock}
${extraCtx.trim() ? `COUNSEL'S ADDITIONAL NOTES:\n${extraCtx.trim()}` : ''}

STRUCTURE THE FINAL WRITTEN ADDRESS AS FOLLOWS:

1. PRELIMINARY — identify the nature of the petition and the relief sought.

2. DISSOLUTION FACT — establish the ground for dissolution under s.15(2) MCA:
   state which fact is relied upon, the particulars proved in evidence, and why
   the court is satisfied the marriage has broken down irretrievably.

3. TWO-YEAR BAR — address s.30 MCA (whether the two-year bar applies, its
   status on the facts, and any application to dispense with it if relevant).

4. ANCILLARY RELIEF — address each head of ancillary relief claimed:
   property settlement, maintenance, custody, and any other orders sought.
   Apply the applicable MCA provisions and authorities to the facts.

5. AUTHORITIES — cite relevant MCA provisions and Nigerian matrimonial causes
   case law. Mark any uncertain citations [RESEARCH NEEDED].

6. DECREE NISI PRAYER — close with the specific prayers sought, including
   Decree Nisi, ancillary orders, and costs.

${RESEARCH_BLOCK_INSTRUCTION}

FORMAT:
- Cover heading: IN THE [COURT] / PETITION NO: [X] / IN THE MATTER OF THE PETITION OF [PETITIONER] / FINAL WRITTEN ADDRESS
- Use ## for major sections, ### for sub-points
- End with: CONCLUSION AND PRAYERS
- Sign-off block: Respectfully submitted, [Counsel], AFS Advocates

Produce the complete Matrimonial Final Written Address now.`
      : `Draft a Final Written Address for Nigerian court proceedings.

CASE: ${activeCase.caseName}
SUIT NO: ${activeCase.suitNo || 'Not specified'}
COURT: ${activeCase.court || 'Not specified'}
COUNSEL ROLE: We act for the ${labels.ourSide}
CLAIMANTS: ${activeCase.claimants?.map((p: any) => p.name).filter(Boolean).join(', ') || 'Not specified'}
DEFENDANTS: ${activeCase.defendants?.map((p: any) => p.name).filter(Boolean).join(', ') || 'Not specified'}

${statuteSections ? `VERIFIED STATUTE SECTIONS FROM FIRM LIBRARY:\n${statuteSections}\n\nCite these directly and accurately. Format: Section [X], [Full Act Name].` : ''}

ARGUMENT ISSUES (Toulmin structure — counsel's pre-built framework):
${issuesText}

${extraCtx.trim() ? `COUNSEL'S ADDITIONAL NOTES:\n${extraCtx.trim()}` : ''}

${RESEARCH_BLOCK_INSTRUCTION}

FORMAT:
- Cover heading: IN THE [COURT] / SUIT NO: [X] / BETWEEN: [PARTIES] / FINAL WRITTEN ADDRESS
- Use ## for major sections, ### for argument sub-points
- Apply Toulmin structure within each issue (Claim → Warrant → Grounds → Conclusion)
- End with: CONCLUSION AND RELIEF SOUGHT
- Sign-off block: Respectfully submitted, [Counsel], AFS Advocates

Produce the complete Final Written Address now.`;

    const result = await ask({
      system: (hasTheory && theory ? buildTheoryInjection(theory) : '') + FWA_SENIOR_COUNSEL_SYSTEM + fullContext,
      userMsg,
      maxTokens: 4000,
      matter_track: activeCase.matter_track,
      counsel_role: activeCase.counsel_role,
    });

    if (result) {
      setDraft(result.trim());
      onDraftSaved(result.trim());
      setCheckResult('');
    }
  }

  return (
    <div>
      <CaseTheoryBanner
        theory={theory}
        locked={locked}
        score={score}
        hasTheory={hasTheory}
        loading={theoryLoading}
      />
      <div style={cardS}>
        <h3 style={hS}>{activeCase.originating_process === 'petition_matrimonial' ? 'Matrimonial — Final Written Address' : 'Civil / FREP — Final Written Address'}</h3>
        <p style={dimS}>
          Build the argument issue by issue using Toulmin structure. The engine drafts the complete
          Final Written Address from your framework. Statute RAG fires automatically.
        </p>

        {issues.map((iss, idx) => (
          <div key={iss.id} style={{
            background: '#06060e', border: '1px solid #1e1e30',
            borderRadius: 7, padding: '16px 18px', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  Issue {idx + 1}
                </span>
                <WarrantTypeBadge type={iss.warrant_type} />
                {isIssueComplete(iss) && !iss.rebuttal.trim() && <FragileFlag />}
              </div>
              {issues.length > 1 && (
                <button onClick={() => removeIssue(iss.id)} style={{
                  background: 'transparent', border: '1px solid #3a1a1a', color: '#804040',
                  borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontSize: 10,
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                  remove
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {(['claim', 'warrant'] as const).map(field => (
                <div key={field}>
                  <label style={labelS}>{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                  <textarea
                    style={{ ...taS, minHeight: 60 }}
                    value={iss[field]}
                    onChange={e => updateIssue(iss.id, field, e.target.value)}
                    placeholder={
                      field === 'claim' ? 'State the issue for determination — e.g. Whether the Defendant breached the contract by...' :
                                          'State the warrant — the statute, standard, or principle that licenses the claim'
                    }
                  />
                </div>
              ))}

              {/* Phase 2B — warrant_type select, with inline help per option */}
              <div>
                <label style={labelS}>Warrant Type</label>
                <select
                  style={iS}
                  value={iss.warrant_type}
                  onChange={e => updateIssue(iss.id, 'warrant_type', e.target.value)}
                >
                  <option value="rule">Rule</option>
                  <option value="standard">Standard</option>
                  <option value="principle">Principle</option>
                </select>
                <div style={{ fontSize: 11, color: T.mute, marginTop: 5, lineHeight: 1.5 }}>
                  {iss.warrant_type === 'rule'
                    ? "Strict if-then — the rule either applies on these facts or it doesn't."
                    : iss.warrant_type === 'standard'
                    ? 'Weighted balancing — several factors are weighed; no single one is dispositive.'
                    : 'Equitable conduct — conscience/fairness-based, not a fixed test.'}
                </div>
              </div>

              <div>
                <label style={labelS}>Grounds</label>
                <textarea
                  style={{ ...taS, minHeight: 60 }}
                  value={iss.grounds}
                  onChange={e => updateIssue(iss.id, 'grounds', e.target.value)}
                  placeholder="State the grounds — the facts of this case that satisfy the warrant; cite evidence, exhibits, witnesses"
                />
              </div>

              {/* Phase 2B — optional qualifier, short input rather than textarea */}
              <div>
                <label style={labelS}>Qualifier (optional)</label>
                <input
                  type="text"
                  style={iS}
                  value={iss.qualifier}
                  onChange={e => updateIssue(iss.id, 'qualifier', e.target.value)}
                  placeholder="e.g. presumptively, unless rebutted."
                />
              </div>

              <div>
                <label style={labelS}>Conclusion</label>
                <textarea
                  style={{ ...taS, minHeight: 60 }}
                  value={iss.conclusion}
                  onChange={e => updateIssue(iss.id, 'conclusion', e.target.value)}
                  placeholder="State the conclusion on this issue — what the court should find"
                />
              </div>

              {/* Phase 4A — rebuttal field with wired AI-generate button; gated on Claim + Grounds present (4C) */}
              <div>
                <label style={labelS}>Rebuttal (strongest objection this claim must survive)</label>
                <textarea
                  style={{ ...taS, minHeight: 60 }}
                  value={iss.rebuttal}
                  onChange={e => updateIssue(iss.id, 'rebuttal', e.target.value)}
                  placeholder="e.g. Delay in bringing this application — counsel to fill in manually, or use Generate"
                />
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => generateRebuttal(iss.id)}
                    disabled={rebuttalLoadingId === iss.id || !iss.claim.trim() || !iss.grounds.trim()}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${rebuttalLoadingId === iss.id || !iss.claim.trim() || !iss.grounds.trim() ? '#3a2a4a' : '#8060c0'}`,
                      color: rebuttalLoadingId === iss.id || !iss.claim.trim() || !iss.grounds.trim() ? '#5a4a6a' : '#c0a0f0',
                      borderRadius: 4, padding: '5px 12px', fontSize: 11,
                      cursor: rebuttalLoadingId === iss.id || !iss.claim.trim() || !iss.grounds.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    {rebuttalLoadingId === iss.id ? '⟳ Generating…' : '✨ AI-Generate Rebuttal'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}


        <button onClick={addIssue} style={{
          background: 'transparent', border: `1px dashed ${ACC}50`, color: ACC,
          borderRadius: 5, padding: '8px 20px', fontSize: 11,
          fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
          marginBottom: 16, display: 'block',
        }}>
          + Add Issue
        </button>

        <label style={labelS}>Counsel's Additional Notes (optional)</label>
        <textarea
          style={{ ...taS, minHeight: 80, marginBottom: 14 }}
          value={extraCtx}
          onChange={e => setExtraCtx(e.target.value)}
          placeholder="Any additional context, specific evidence to highlight, or strategic points not captured above."
        />

        {ragFetching && (
          <div style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8 }}>
            ⟳ Querying statute library…
          </div>
        )}
        {ragError && (
          <div style={{ fontSize: 11, color: '#c07070', fontFamily: "'Times New Roman', Times, serif", marginBottom: 8 }}>
            RAG: {ragError}
          </div>
        )}

        <Btn
          onClick={generate}
          loading={loading}
          disabled={!issues.some(i => i.claim.trim())}
          label="Draft Final Written Address"
          accent={ACC}
        />
        <button
          onClick={() => setShowClausePicker(true)}
          style={{
            marginTop: 8, background: 'none', border: `1px solid ${T.bdr}`,
            color: T.dim, borderRadius: 4, padding: '6px 14px', fontSize: 12,
            cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          📚 Pull from Clause Bank
        </button>
        {showClausePicker && (
          <ClauseBankPicker
            onClose={() => setShowClausePicker(false)}
            onPull={(text) => setExtraCtx(c => c ? `${c}\n\n${text}` : text)}
          />
        )}
        {error && <ErrorBlock message={error} />}
      </div>

      {draft && (
        <div style={cardS}>
          <h3 style={hS}>Final Written Address (Draft)</h3>
          <p style={dimS}>Edit before filing. Resolve all [RESEARCH NEEDED] blocks in Stage 2. Verify all authorities in Stage 3.</p>
          <textarea
            style={{ ...taS, minHeight: 700, fontSize: 13 }}
            value={draft}
            onChange={e => { setDraft(e.target.value); onDraftSaved(e.target.value); }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => copyToClipboard(draft)} style={{
              background: 'transparent', border: '1px solid #cccccc', color: T.mute,
              borderRadius: 5, padding: '6px 16px', fontSize: 11,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>
              Copy
            </button>
            <button onClick={() => {
              const sel = window.getSelection()?.toString() || '';
              const text = sel.trim() || draft;
              if (text) { import('./ClauseBank').then(({ saveFragment }) => { saveFragment({ text, type: 'submission', courtLevel: 'any', matterTrack: 'any' }); }); }
            }} style={{
              background: 'transparent', border: `1px solid ${T.bdr}`,
              color: T.dim, borderRadius: 5, padding: '6px 16px',
              fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>
              📚 Save to Clause Bank
            </button>
            <button onClick={() => { setDraft(''); onDraftSaved(''); }} style={{
              background: 'transparent', border: '1px solid #301818',
              color: '#c05050', borderRadius: 5, padding: '6px 16px',
              fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>
              clear draft ×
            </button>
          </div>
          {hasTheory && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={runTheoryCheck}
                disabled={checkRunning || !draft}
                style={{
                  background: 'transparent', border: `1px solid ${ACC}50`,
                  color: ACC, borderRadius: 5, padding: '6px 16px', fontSize: 11,
                  fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
                }}
              >
                {checkRunning ? 'Checking…' : 'Theory Consistency Check'}
              </button>
            </div>
          )}
          {checkResult && (
            <div style={{
              marginTop: 14, padding: '14px 16px',
              background: '#070714', border: `1px solid ${ACC}30`,
              borderRadius: 6,
            }}>
              <div style={{
                fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif",
                fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8,
              }}>
                Theory Consistency Check
              </div>
              <Md text={checkResult} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SUB-TAB: BUILD (Criminal)
// ─────────────────────────────────────────────────────────────────────────────

function CriminalDrafterTab({ activeCase, onDraftSaved }: {
  activeCase: Case;
  onDraftSaved: (draft: string) => void;
}) {
  const { ask, loading, error } = useAI(activeCase);
  const { ask: checkAsk }       = useAI(activeCase);
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  const isPros = activeCase.counsel_role === 'prosecution';
  const accent = isPros ? '#c04040' : '#4a7ed0';

  // Phase 9A — locked Case Theory
  const { theory, locked, score, hasTheory, loading: theoryLoading } = useCaseTheory(activeCase.id);

  const [context,      setContext]      = useState('');
  const [draft,        setDraft]        = useState('');
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkResult,  setCheckResult]  = useState('');

  const intPkg = (activeCase as any).intelligence_data?.intPkg ?? '';

  async function runTheoryCheck() {
    if (!theory || !draft.trim()) return;
    setCheckRunning(true);
    setCheckResult('');
    const result = await checkAsk({
      system: 'You are a senior Nigerian advocate reviewing a completed Final Written Address against the locked Case Theory for drift. Be specific and surgical.',
      userMsg: `LOCKED CASE THEORY:
Core Proposition: ${theory.core_proposition}
Elements to Establish: ${theory.elements.map(e => e.element).join('; ')}
Opposing Theory: ${theory.opposing_theory}
Theory Killer: ${theory.theory_killer}

DRAFT FINAL WRITTEN ADDRESS:
${draft}

For each issue or major submission in the draft, state whether it advances the Core Proposition, defeats the Opposing Theory, or is neutral to the theory. Flag every neutral or off-theory submission with a specific note: name the issue, explain the gap, and suggest the precise fix. If every issue is theory-consistent, say so plainly. Concise flagged list, not a rewritten draft.`,
      maxTokens: 1200,
    });
    setCheckRunning(false);
    if (result) setCheckResult(result.trim());
  }

  async function generate() {
    const userMsg = isPros
      ? `Draft a prosecution Final Written Address for: ${activeCase.caseName} at ${activeCase.court}.

Intelligence Package: ${intPkg ? intPkg.slice(0, 1000) : '[not available]'}

Prosecution context (proved counts, witnesses, exhibits, defence highlights):
${context || '[not provided — generate from case intelligence above]'}

Structure:
1. Introduction — formal caption; prosecution closed its case and invites conviction
2. Summary of Prosecution Case — what was proved
3. Issues for Determination — key factual and legal issues
4. Evidence Analysis per Count — for each count: charge, essential ingredients, prosecution evidence per ingredient, defence challenge response, conclusion (proved beyond reasonable doubt)
5. Defence Evidence Assessment — why defence evidence fails to raise reasonable doubt
6. Witness Credibility — prosecution witnesses credible; address inconsistencies pre-emptively
7. Legal Submissions — admissibility, standard of proof, applicable statute
8. Authorities — Nigerian authorities on the submissions
9. Conclusion and Prayer — invite conviction on named counts

${RESEARCH_BLOCK_INSTRUCTION}`
      : `Draft a defence Final Written Address for: ${activeCase.caseName} at ${activeCase.court}.

Intelligence Package: ${intPkg ? intPkg.slice(0, 1000) : '[not available]'}

Defence analysis (prosecution gaps, credibility failures, no-case grounds, defence witnesses):
${context || '[not provided — generate from case intelligence above]'}

Structure:
1. Introduction — formal caption; accused presumed innocent until proved guilty beyond reasonable doubt
2. Burden and Standard of Proof — principle, burden never shifts; cite authorities
3. Summary of Prosecution's Failures — what prosecution failed to prove
4. Issues for Determination — key factual and legal issues
5. Evidence Analysis per Count — for each count: charge, essential ingredients, specific ingredient(s) prosecution failed to prove, specific testimonial or exhibit failures, conclusion (prosecution failed to prove beyond reasonable doubt)
6. Credibility of Prosecution Witnesses — inconsistencies, contradictions, interest in outcome
7. Defence Evidence — what defence witnesses established
8. Points of Law — admissibility, jurisdiction, constitutional rights
9. Authorities — Nigerian criminal authorities
10. Conclusion and Prayer — discharge and acquit on all counts / named counts

${RESEARCH_BLOCK_INSTRUCTION}`;

    const result = await ask({
      system: (hasTheory && theory ? buildTheoryInjection(theory) : '') + `You are a Nigerian ${isPros ? 'prosecution' : 'criminal defence'} counsel drafting a final written address for filing at the close of a criminal trial. Apply ACJA 2015, Evidence Act 2011, and the criminal procedure of the relevant court. Use formal Nigerian court drafting.` + FWA_SENIOR_COUNSEL_SYSTEM + fullContext,
      userMsg,
      maxTokens: 4000,
      matter_track: activeCase.matter_track,
      counsel_role: activeCase.counsel_role,
    });

    if (result) {
      setDraft(result.trim());
      onDraftSaved(result.trim());
      setCheckResult('');
    }
  }

  return (
    <div>
      <CaseTheoryBanner
        theory={theory}
        locked={locked}
        score={score}
        hasTheory={hasTheory}
        loading={theoryLoading}
      />
      <div style={cardS}>
        <h3 style={hS}>{isPros ? 'Prosecution' : 'Defence'} Final Written Address</h3>
        <div style={{
          padding: '12px 16px', background: `${accent}08`,
          border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
          fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
        }}>
          <strong style={{ color: accent }}>{isPros ? 'Prosecution Standard' : 'Defence Standard'}</strong>
          {isPros
            ? ' — The prosecution must prove each essential ingredient of each count beyond reasonable doubt. Demonstrate, ingredient by ingredient, that this standard has been met.'
            : ' — The defence does not prove innocence. Demonstrate that the prosecution has failed to eliminate reasonable doubt on at least one essential ingredient of each count.'}
        </div>
        <label style={labelS}>
          {isPros
            ? 'Prosecution Case Summary — Proved Counts, Key Witnesses, Exhibits, Defence Highlights'
            : 'Defence Analysis — Prosecution Gaps, Credibility Failures, Defence Evidence, Points of Law'}
        </label>
        <textarea
          style={{ ...taS, minHeight: 200, marginBottom: 14 }}
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder={isPros
            ? 'Counts in the charge and which are fully proved\nKey prosecution witnesses (PW1, PW2...) and what each proved\nExhibits admitted (Exh. A, B...) and what they establish\nDefence witnesses and why their evidence fails\nAny inconsistencies to address pre-emptively'
            : 'Each count and the specific ingredient(s) prosecution failed to prove\nProsecution witnesses who were inconsistent or discredited\nAny admissibility objections\nNo-case grounds that survived\nDefence witnesses called and what they established\nConstitutional rights violations if any'}
        />
        <Btn
          onClick={generate}
          loading={loading}
          disabled={!context.trim() && !intPkg}
          label={`Draft ${isPros ? 'Prosecution' : 'Defence'} Final Address`}
          accent={accent}
        />
        {error && <ErrorBlock message={error} />}
      </div>

      {draft && (
        <div style={cardS}>
          <h3 style={hS}>{isPros ? 'Prosecution' : 'Defence'} Final Written Address (Draft)</h3>
          <p style={dimS}>Edit before filing. Verify all authorities.</p>
          <textarea
            style={{ ...taS, minHeight: 700, fontSize: 13 }}
            value={draft}
            onChange={e => { setDraft(e.target.value); onDraftSaved(e.target.value); }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button onClick={() => copyToClipboard(draft)} style={{
              background: 'transparent', border: '1px solid #cccccc', color: T.mute,
              borderRadius: 5, padding: '6px 16px', fontSize: 11,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>Copy</button>
            <button onClick={() => { setDraft(''); onDraftSaved(''); }} style={{
              background: 'transparent', border: '1px solid #301818', color: '#c05050',
              borderRadius: 5, padding: '6px 16px', fontSize: 11,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>clear ×</button>
          </div>
          {hasTheory && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={runTheoryCheck}
                disabled={checkRunning || !draft}
                style={{
                  background: 'transparent', border: `1px solid ${accent}50`,
                  color: accent, borderRadius: 5, padding: '6px 16px', fontSize: 11,
                  fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
                }}
              >
                {checkRunning ? 'Checking…' : 'Theory Consistency Check'}
              </button>
            </div>
          )}
          {checkResult && (
            <div style={{
              marginTop: 14, padding: '14px 16px',
              background: '#070714', border: `1px solid ${accent}30`,
              borderRadius: 6,
            }}>
              <div style={{
                fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif",
                fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8,
              }}>
                Theory Consistency Check
              </div>
              <Md text={checkResult} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SUB-TAB: REPLY
// ─────────────────────────────────────────────────────────────────────────────

function ReplyTab({ activeCase }: { activeCase: Case }) {
  const { ask, loading, error } = useAI(activeCase);
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  const isPros     = activeCase.counsel_role === 'prosecution';
  const isCriminal = activeCase.matter_track === 'criminal';
  const accent     = isCriminal
    ? (isPros ? '#c04040' : '#4a7ed0')
    : ACC;

  // Phase 9A — light theory injection (core proposition only)
  const { theory, hasTheory } = useCaseTheory(activeCase.id);

  const [replyContext, setReplyContext] = useState('');
  const [replyDraft,   setReplyDraft]   = useState('');

  async function generate() {
    if (!replyContext.trim()) return;
    const result = await ask({
      system: (hasTheory && theory
        ? `CASE THEORY CONTEXT:\nCore Proposition: ${theory.core_proposition}\nThis Reply must not undermine the Core Proposition.\n\n`
        : '') + `You are a Nigerian advocate drafting a Reply on Points of Law. A reply is strictly limited to new points of law raised by the opposing side in their Final Written Address. You cannot re-argue the case, introduce new facts, or repeat your original address. Be precise and cite authority.` + fullContext,
      userMsg: `Draft a Reply on Points of Law for: ${activeCase.caseName}.

New points of law raised by the ${isCriminal ? (isPros ? 'defence' : 'prosecution') : 'opposing party'} (paste or summarise each point):
${replyContext}

Structure:
1. Introduction — nature and scope of the right of reply (limited to new points of law only)
2. New Points of Law Identified — list the specific new legal points raised
3. Reply per Point — for each new legal point: (a) restate the opposing submission, (b) cite the correct authority, (c) explain why the opposing submission is wrong in law
4. Conclusion — maintain the prayer from the Final Address

${RESEARCH_BLOCK_INSTRUCTION}

The reply must not introduce new facts or re-argue the evidence. It is confined to law only.`,
      maxTokens: 2500,
      matter_track: activeCase.matter_track,
      counsel_role: activeCase.counsel_role,
    });
    if (result) setReplyDraft(result.trim());
  }

  return (
    <div style={cardS}>
      <h3 style={hS}>Reply on Points of Law</h3>
      <p style={dimS}>
        Strictly confined to new points of law raised in the opposing side's Final Written Address.
        Cannot be used to re-argue the case or introduce new facts.
      </p>
      <div style={{
        padding: '12px 16px', background: `${accent}08`,
        border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
        fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
      }}>
        <strong style={{ color: accent }}>Scope of Reply</strong>
        {' '}— Available as of right where the opposing side raises a new point of law not in your original address.
        Strictly law only — no new evidence, no new facts.
      </div>
      <label style={labelS}>New Points of Law from Opposing Address (summarise each)</label>
      <textarea
        style={{ ...taS, minHeight: 180, marginBottom: 14 }}
        value={replyContext}
        onChange={e => setReplyContext(e.target.value)}
        placeholder="Paste or summarise each new point of law raised that was not in your own original address. Include the specific legal proposition, how they argued it, and any authority they cited."
      />
      <Btn onClick={generate} loading={loading} disabled={!replyContext.trim()} label="Draft Reply on Points of Law" accent={accent} />
      {error && <ErrorBlock message={error} />}
      {replyDraft && (
        <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${accent}30`, borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              Reply on Points of Law — Draft
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => copyToClipboard(replyDraft)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 3, padding: '4px 12px', fontSize: 10, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>Copy</button>
              <button onClick={() => setReplyDraft('')} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>clear ×</button>
            </div>
          </div>
          <Md text={replyDraft} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SUB-TAB: STATUS
// ─────────────────────────────────────────────────────────────────────────────

function StatusTab({ activeCase }: { activeCase: Case }) {
  const [status, setStatus] = useState<FWAStatus>(defaultStatus());

  useEffect(() => {
    fwaLoad<FWAStatus>(activeCase.id, 'status', defaultStatus()).then(setStatus);
  }, [activeCase.id]);

  function update(field: keyof FWAStatus, value: string | FilingStatus) {
    const next = { ...status, [field]: value };
    setStatus(next);
    fwaSave(activeCase.id, 'status', next);
  }

  const col = STATUS_COLORS[status.status];

  return (
    <div style={cardS}>
      <h3 style={hS}>Filing & Adoption Status</h3>
      <p style={dimS}>Track the filing and adoption status of the Final Written Address.</p>

      <div style={{
        marginBottom: 22, padding: '18px 20px',
        background: col.bg, border: `2px solid ${col.bdr}`, borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, color: col.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          Current Status
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_OPTS.map(o => (
            <button key={o} onClick={() => update('status', o)} style={{
              background:    status.status === o ? `${col.col}20` : 'transparent',
              border:        `1px solid ${status.status === o ? col.col : '#404050'}`,
              color:         status.status === o ? col.col : '#707080',
              borderRadius:  5, padding: '7px 14px', fontSize: 11,
              fontFamily:    "'Times New Roman', Times, serif",
              cursor:        'pointer', fontWeight: status.status === o ? 700 : 400,
            }}>
              {o}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelS}>Date Filed</label>
          <input type="date" style={iS} value={status.dateFiled} onChange={e => update('dateFiled', e.target.value)} />
        </div>
        <div>
          <label style={labelS}>Date of Adoption Hearing</label>
          <input type="date" style={iS} value={status.dateAdopted} onChange={e => update('dateAdopted', e.target.value)} />
        </div>
      </div>

      <label style={labelS}>Notes</label>
      <textarea
        style={{ ...taS, minHeight: 80 }}
        value={status.notes}
        onChange={e => update('notes', e.target.value)}
        placeholder="e.g. Filed and served 10 June 2025. Adoption adjourned to 20 June 2025."
      />

      {status.status === 'Adopted' && (
        <div style={{ marginTop: 18, padding: '14px 18px', background: '#071810', border: '1px solid #285000', borderRadius: 6 }}>
          <p style={{ fontSize: 13, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
            ✓ Address adopted. The matter is with the court for judgment. Monitor judgment date.
          </p>
        </div>
      )}

      {status.status === 'Adoption Denied' && (
        <div style={{
          marginTop: 18, padding: '18px 20px',
          background: '#1a0808', border: '2px solid #c0404060',
          borderLeft: '4px solid #c04040', borderRadius: '0 8px 8px 0',
        }}>
          <div style={{ fontSize: 10, color: '#c04040', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 10 }}>
            ⚠ Fair Hearing Alert — Adoption Denied
          </div>
          <p style={{ fontSize: 13, color: '#e08080', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 12 }}>
            <strong>{FAIR_HEARING_REFERENCE.provision}</strong>
          </p>
          <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 14 }}>
            {FAIR_HEARING_REFERENCE.principle}
          </p>
          <div style={{ fontSize: 10, color: '#c04040', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Supporting Authorities
          </div>
          {FAIR_HEARING_REFERENCE.cases.map((c, i) => (
            <div key={i} style={{
              background: '#200808', border: '1px solid #4a1818',
              borderRadius: 5, padding: '10px 14px', marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, color: '#e08080', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 4 }}>
                {c.citation}
              </div>
              <div style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                {c.point}
              </div>
            </div>
          ))}
          <div style={{
            marginTop: 12, padding: '10px 14px', background: '#1a1008',
            border: '1px solid #4a3808', borderRadius: 5,
            fontSize: 10, color: '#c4a030', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6,
          }}>
            ⚠ {FAIR_HEARING_REFERENCE.caveat}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SUB-TAB: VERSION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

function VersionsTab({ activeCase, currentDraft, onRestoreDraft }: {
  activeCase: Case;
  currentDraft: string;
  onRestoreDraft: (draft: string) => void;
}) {
  const [versions,  setVersions]  = useState<ArgumentVersion[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [savingNow, setSavingNow] = useState(false);
  const [viewId,    setViewId]    = useState<string | null>(null);

  useEffect(() => {
    loadArgVersions(activeCase.id)
      .then(v => { setVersions(v); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeCase.id]);

  async function saveNow() {
    if (!currentDraft.trim()) return;
    setSavingNow(true);
    const ver: ArgumentVersion = {
      id:        uid(),
      label:     'Final Written Address',
      argType:   'final_address',
      argIssue:  '',
      content:   currentDraft,
      createdAt: new Date().toISOString(),
      driveRAG:  false,
      selCount:  0,
    };
    await saveArgVersion(activeCase.id, ver);
    setVersions(prev => [ver, ...prev]);
    setSavingNow(false);
  }

  async function deleteVer(id: string) {
    await deleteArgVersion(id);
    setVersions(prev => prev.filter(v => v.id !== id));
    if (viewId === id) setViewId(null);
  }

  const viewed = viewId ? versions.find(v => v.id === viewId) : null;

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Spinner size={14} /></div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <Btn onClick={saveNow} loading={savingNow} disabled={!currentDraft.trim()} label="Save Current Draft" accent={ACC} />
        <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
          {versions.length} version{versions.length !== 1 ? 's' : ''} saved
        </span>
      </div>

      {versions.length === 0 && (
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          No saved versions yet. Generate a draft and click Save Current Draft.
        </p>
      )}

      {versions.map(ver => (
        <div key={ver.id} style={{
          background: viewId === ver.id ? `${ACC}08` : T.card,
          border: `1px solid ${viewId === ver.id ? ACC + '50' : T.bdr}`,
          borderRadius: 7, padding: '14px 16px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                {ver.label}
              </div>
              <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 3 }}>
                {new Date(ver.createdAt).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => setViewId(viewId === ver.id ? null : ver.id)} style={{
                background: 'transparent', border: `1px solid ${T.bdr}`, color: T.mute,
                borderRadius: 3, padding: '4px 10px', fontSize: 10,
                fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              }}>
                {viewId === ver.id ? 'hide' : 'view'}
              </button>
              <button onClick={() => { onRestoreDraft(ver.content); setViewId(null); }} style={{
                background: `${ACC}14`, border: `1px solid ${ACC}40`, color: ACC,
                borderRadius: 3, padding: '4px 10px', fontSize: 10,
                fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              }}>
                restore
              </button>
              <button onClick={() => deleteVer(ver.id)} style={{
                background: 'transparent', border: '1px solid #3a1a1a', color: '#804040',
                borderRadius: 3, padding: '4px 10px', fontSize: 10,
                fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              }}>
                ×
              </button>
            </div>
          </div>
          {viewId === ver.id && viewed && (
            <pre style={{
              marginTop: 12, background: '#06060e', border: '1px solid #1a1a2a',
              borderRadius: 5, padding: '12px 14px', fontSize: 11, color: '#c0bcc0',
              fontFamily: "'Times New Roman', Times, serif", whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', lineHeight: 1.7, maxHeight: 400, overflowY: 'auto',
            }}>
              {viewed.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 — TYPES & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedBlock {
  proposition:        string;
  areaOfLaw:          string;
  courtLevel:         string;
  searches:           string[];
  whatCaseMustDecide: string;
}

interface CaseEntry {
  id:       string;
  citation: string;
  text:     string;
}

function parseResearchBlock(raw: string): ParsedBlock | null {
  if (!raw.includes('[RESEARCH NEEDED]')) return null;
  const get = (label: string): string => {
    const re = new RegExp(`${label}:\\s*([^\\n]+)`, 'i');
    return (raw.match(re)?.[1] || '').trim();
  };
  const searches = [
    get('LawPavilion search 1'),
    get('LawPavilion search 2'),
    get('LawPavilion search 3'),
  ].filter(Boolean);
  if (!searches.length) return null;
  return {
    proposition:        get('Proposition'),
    areaOfLaw:          get('Area of law'),
    courtLevel:         get('Court level needed'),
    searches,
    whatCaseMustDecide: get('What the case must decide'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 — COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function Stage2Research({ activeCase }: { activeCase: Case }) {
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  const [resTab,        setResTab]        = useState<'finder' | 'resolver'>('finder');

  // Finder state
  const [block,         setBlock]         = useState('');
  const [parsed,        setParsed]        = useState<ParsedBlock | null>(null);
  const [extraSearches, setExtraSearches] = useState<string[]>([]);
  const [finderLoading, setFinderLoading] = useState(false);
  const [finderError,   setFinderError]   = useState('');
  const [copiedIdx,     setCopiedIdx]     = useState<number | null>(null);

  // Resolver state
  const [resBlock,      setResBlock]      = useState('');
  const [argPara,       setArgPara]       = useState('');
  const [cases,         setCases]         = useState<CaseEntry[]>([{ id: uid(), citation: '', text: '' }]);
  const [resolving,     setResolving]     = useState(false);
  const [resolveResult, setResolveResult] = useState('');
  const [resolveError,  setResolveError]  = useState('');

  function parseBlock() {
    const result = parseResearchBlock(block);
    if (!result) {
      setFinderError('No valid [RESEARCH NEEDED] block detected — check format.');
      return;
    }
    setFinderError('');
    setParsed(result);
    setExtraSearches([]);
  }

  async function generateMoreSearches() {
    if (!parsed) return;
    setFinderLoading(true);
    try {
      const text = await withRetry(() => callClaude({
        system: 'You are a Nigerian legal research expert specialising in LawPavilion searches. Generate precise, effective search queries for finding Nigerian case law.' + fullContext,
        userMsg: `Generate 4 additional LawPavilion search queries for this legal research need.

Proposition: ${parsed.proposition}
Area of law: ${parsed.areaOfLaw}
Court level: ${parsed.courtLevel}
What the case must decide: ${parsed.whatCaseMustDecide}

Existing searches:
${parsed.searches.join('\n')}

Generate 4 NEW search phrases — different angles, synonyms, alternative legal terms of art, or related doctrines that might surface relevant cases in LawPavilion. Output ONLY the 4 search phrases, one per line, no numbering, no explanation.`,
        maxTokens: 300,
      }));
      setExtraSearches(
        text.trim()
          .split('\n')
          .map(l => l.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 4),
      );
    } catch (e) {
      setFinderError((e as Error).message || 'Failed to generate searches.');
    }
    setFinderLoading(false);
  }

  function copySearch(q: string, idx: number) {
    copyToClipboard(q);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function addCase() {
    setCases(prev => [...prev, { id: uid(), citation: '', text: '' }]);
  }
  function removeCase(id: string) {
    setCases(prev => prev.filter(c => c.id !== id));
  }
  function updateCase(id: string, field: keyof CaseEntry, val: string) {
    setCases(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c));
  }

  async function resolve() {
    const valid = cases.filter(c => c.citation.trim() || c.text.trim());
    if (!resBlock.trim() || !argPara.trim() || !valid.length) return;
    setResolving(true);
    setResolveError('');
    setResolveResult('');
    try {
      const text = await withRetry(() => callClaude({
        system: 'You are Senior Counsel at AFS Advocates. You rewrite argument paragraphs using real cases provided by the instructing solicitor. You cite accurately in Nigerian format. You output only the rewritten paragraph — nothing else.' + fullContext,
        userMsg: `You are resolving a [RESEARCH NEEDED] placeholder in a legal argument.

[RESEARCH NEEDED] BLOCK:
${resBlock}

ORIGINAL ARGUMENT PARAGRAPH (containing the block):
${argPara}

REAL CASES FOUND:
${valid.map((c, i) => `CASE ${i + 1}: ${c.citation}\n${c.text}`).join('\n\n')}

Rewrite the argument paragraph with the real Nigerian case citations inserted in place of the [RESEARCH NEEDED] block. Use Nigerian citation format. Output ONLY the rewritten paragraph.`,
        maxTokens: 2000,
      }));
      setResolveResult(text.trim());
    } catch (e) {
      setResolveError((e as Error).message || 'Failed to resolve citations.');
    }
    setResolving(false);
  }

  const allSearches = [...(parsed?.searches || []), ...extraSearches];

  return (
    <div>
      <SubTabBar
        tabs={[
          { id: 'finder',   label: '⚡ Case Finder' },
          { id: 'resolver', label: '§ Resolver'     },
        ]}
        active={resTab}
        onSelect={id => setResTab(id as 'finder' | 'resolver')}
        accent="#c4a030"
      />

      {/* ── FINDER ── */}
      {resTab === 'finder' && (
        <div>
          <div style={{
            background: '#080a04', border: '1px solid #2a3010',
            borderLeft: '3px solid #8ab020', borderRadius: '0 8px 8px 0',
            padding: '14px 18px', marginBottom: 20,
          }}>
            <p style={{
              fontSize: 11, color: '#8ab040',
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 700, marginBottom: 4,
              letterSpacing: '.08em', textTransform: 'uppercase',
            }}>
              ⚡ Under Pressure Workflow
            </p>
            <p style={{
              fontSize: 13, color: T.dim,
              fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65,
            }}>
              Copy a [RESEARCH NEEDED] block from Stage 1 draft → paste below →
              get instant LawPavilion queries → copy one → search in LawPavilion →
              find real case → come back to Resolver tab.
            </p>
          </div>

          <div style={cardS}>
            <label style={labelS}>Paste [RESEARCH NEEDED] block *</label>
            <textarea
              style={{ ...taS, minHeight: 200, fontSize: 12 }}
              value={block}
              onChange={e => {
                setBlock(e.target.value);
                setParsed(null);
                setExtraSearches([]);
                setFinderError('');
              }}
              placeholder={
                '[RESEARCH NEEDED]\nProposition: ...\nArea of law: ...\nCourt level needed: ...\nLawPavilion search 1: ...\nLawPavilion search 2: ...\nLawPavilion search 3: ...\nWhat the case must decide: ...\n[/RESEARCH NEEDED]'
              }
            />
            <Btn
              onClick={parseBlock}
              loading={false}
              disabled={!block.trim()}
              label="Parse Block"
              accent="#c4a030"
            />
            {finderError && <ErrorBlock message={finderError} />}
          </div>

          {parsed && (
            <div style={cardS}>
              <h3 style={hS}>Search Queries</h3>
              <p style={dimS}>
                Copy a query → paste into LawPavilion → find the case → return to Resolver tab.
              </p>

              {/* Parsed summary */}
              <div style={{
                background: '#06060e', border: '1px solid #1e1e30',
                borderRadius: 6, padding: '12px 14px', marginBottom: 14,
                fontSize: 11, color: T.mute,
                fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
              }}>
                <div><strong style={{ color: T.sub }}>Proposition:</strong> {parsed.proposition}</div>
                <div><strong style={{ color: T.sub }}>Area:</strong> {parsed.areaOfLaw}</div>
                <div><strong style={{ color: T.sub }}>Court level:</strong> {parsed.courtLevel}</div>
                <div><strong style={{ color: T.sub }}>Case must decide:</strong> {parsed.whatCaseMustDecide}</div>
              </div>

              <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                {allSearches.map((q, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 8, alignItems: 'center',
                    background: '#06060e', border: '1px solid #1e1e30',
                    borderRadius: 5, padding: '10px 14px',
                  }}>
                    <span style={{
                      flex: 1, fontSize: 13, color: T.text,
                      fontFamily: "'Times New Roman', Times, serif",
                    }}>
                      {q}
                    </span>
                    <button
                      onClick={() => copySearch(q, i)}
                      style={{
                        background:   copiedIdx === i ? '#071a0e' : 'transparent',
                        border:       `1px solid ${copiedIdx === i ? '#285000' : '#cccccc'}`,
                        color:        copiedIdx === i ? '#40b068' : T.mute,
                        borderRadius: 3, padding: '4px 12px', fontSize: 10,
                        fontFamily:   "'Times New Roman', Times, serif", cursor: 'pointer',
                      }}
                    >
                      {copiedIdx === i ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>

              <Btn
                onClick={generateMoreSearches}
                loading={finderLoading}
                disabled={false}
                label="Generate 4 More Searches"
                accent="#c4a030"
              />
            </div>
          )}
        </div>
      )}

      {/* ── RESOLVER ── */}
      {resTab === 'resolver' && (
        <div>
          <div style={cardS}>
            <h3 style={hS}>Citation Resolver</h3>
            <p style={dimS}>
              Paste the [RESEARCH NEEDED] block + the argument paragraph it came from +
              the real cases you found. AI rewrites the paragraph with real citations.
            </p>

            <label style={labelS}>[RESEARCH NEEDED] Block *</label>
            <textarea
              style={{ ...taS, minHeight: 160, fontSize: 12, marginBottom: 14 }}
              value={resBlock}
              onChange={e => setResBlock(e.target.value)}
              placeholder="[RESEARCH NEEDED]...  [/RESEARCH NEEDED]"
            />

            <label style={labelS}>Argument Paragraph (containing the block) *</label>
            <textarea
              style={{ ...taS, minHeight: 120, marginBottom: 14 }}
              value={argPara}
              onChange={e => setArgPara(e.target.value)}
              placeholder="Paste the full argument paragraph that contains the [RESEARCH NEEDED] block."
            />

            <label style={labelS}>Cases Found</label>
            {cases.map((c, idx) => (
              <div key={c.id} style={{
                background: '#06060e', border: '1px solid #1e1e30',
                borderRadius: 6, padding: '14px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    fontSize: 11, color: T.text,
                    fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: 600, minWidth: 20,
                  }}>
                    {idx + 1}.
                  </span>
                  <input
                    value={c.citation}
                    onChange={e => updateCase(c.id, 'citation', e.target.value)}
                    placeholder="Citation — e.g. Sken-Consult v. Ukey (1981) 1 SC 6"
                    style={{ ...iS, flex: 1, fontSize: 13 }}
                  />
                  {cases.length > 1 && (
                    <button
                      onClick={() => removeCase(c.id)}
                      style={{
                        background: 'transparent', border: '1px solid #3a1a1a',
                        color: '#804040', borderRadius: 3, padding: '4px 8px',
                        cursor: 'pointer', fontSize: 10,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <textarea
                  value={c.text}
                  onChange={e => updateCase(c.id, 'text', e.target.value)}
                  rows={3}
                  placeholder="Paste the holding, ratio, or relevant passage."
                  style={{ ...taS, fontSize: 12 }}
                />
              </div>
            ))}

            <button
              onClick={addCase}
              style={{
                background: 'transparent', border: '1px dashed #c4a03050',
                color: '#c4a030', borderRadius: 4, padding: '6px 16px',
                fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                cursor: 'pointer', marginBottom: 14,
              }}
            >
              + Add Case
            </button>

            <div style={{ display: 'block' }}>
              <Btn
                onClick={resolve}
                loading={resolving}
                disabled={!resBlock.trim() || !argPara.trim() || !cases.some(c => c.citation.trim() || c.text.trim())}
                label="Resolve Citations"
                accent="#c4a030"
              />
            </div>

            {resolveError && <ErrorBlock message={resolveError} />}

            {resolveResult && (
              <div style={{
                marginTop: 18, background: '#06060e',
                border: '1px solid #c4a03030', borderRadius: 7,
                padding: '16px 18px',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: 10,
                }}>
                  <span style={{
                    fontSize: 10, color: '#c4a030',
                    fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                  }}>
                    Resolved Paragraph
                  </span>
                  <button
                    onClick={() => copyToClipboard(resolveResult)}
                    style={{
                      background: 'transparent', border: '1px solid #cccccc',
                      color: T.mute, borderRadius: 3, padding: '4px 12px',
                      fontSize: 10, cursor: 'pointer',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    Copy
                  </button>
                </div>
                <div style={{
                  fontSize: 14, color: T.text,
                  fontFamily: "'Times New Roman', Times, serif",
                  lineHeight: 1.9, whiteSpace: 'pre-wrap',
                }}>
                  {resolveResult}
                </div>
                <p style={{
                  marginTop: 14, fontSize: 10, color: T.mute,
                  fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6,
                }}>
                  Verify every citation before filing — confirm case name, year, volume, page,
                  and that the holding matches.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3 — HELPERS & SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────────────────────


const VALIDATE_SYSTEM = `You are a Nigerian litigation authority validator. You know the Nigerian court hierarchy, the NWLR, SCNLR, FWLR, and key decisions of the Supreme Court and Court of Appeal. You distinguish ratio decidendi from obiter dicta. You flag overruled, distinguished, or limited authorities. You never fabricate citations. When unsure, say so explicitly and flag for verification.`;

const QUICK_SYSTEM = `You are a Nigerian legal research assistant. You provide research guidance on Nigerian law. You flag uncertainty clearly. You never fabricate case names or citations — where you cannot verify a case exists you say so and provide LawPavilion search terms instead. All output is guidance only and must be independently verified.`;

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3 — COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function Stage3Validate({ activeCase }: { activeCase: Case }) {
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  const [valTab, setValTab] = useState<'library' | 'conflicts' | 'quick'>('library');

  // ── Authority Library state ────────────────────────────────────────────────
  const [auths,      setAuths]      = useState<Authority[]>([]);

  useEffect(() => {
    aveLoad<Authority[]>(activeCase.id, 'auths', []).then(setAuths);
  }, [activeCase.id]);

  const [authForm,   setAuthForm]   = useState({
    caseName: '', citation: '', court: '', year: '', principle: '', bindingFor: '',
  });
  const [valLoading, setValLoading] = useState(false);
  const [valResult,  setValResult]  = useState('');
  const [valError,   setValError]   = useState('');
  const [selAuthId,  setSelAuthId]  = useState<string | null>(null);

  function persistAuths(list: Authority[]) {
    setAuths(list);
    aveSave(activeCase.id, 'auths', list);
  }

  function addAuth() {
    if (!authForm.caseName.trim()) return;
    const a: Authority = {
      ...authForm,
      id:         uid(),
      validated:  false,
      validation: '',
      addedAt:    new Date().toISOString(),
    };
    persistAuths([...auths, a]);
    setAuthForm({ caseName: '', citation: '', court: '', year: '', principle: '', bindingFor: '' });
  }

  async function validateAuth(auth: Authority) {
    setSelAuthId(auth.id);
    setValLoading(true);
    setValError('');
    setValResult('');
    const role    = activeCase.counsel_role ?? '';
    const track   = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
    const roleCtx = role ? ` You are advising ${role} counsel on a ${track} matter.` : '';
    try {
      const text = await withRetry(() => callClaude({
        system: VALIDATE_SYSTEM + roleCtx + fullContext,
        userMsg: `Nigerian litigation — authority validation analysis.

CASE: ${auth.caseName}
CITATION: ${auth.citation || 'Not provided'}
COURT: ${auth.court || 'Not specified'}
YEAR: ${auth.year || 'Not specified'}
CLAIMED PRINCIPLE: ${auth.principle || 'Not specified'}
ISSUE IT SUPPORTS: ${auth.bindingFor || 'Not specified'}

Validate this authority:

## COURT & HIERARCHY
Which court? Where in the Nigerian hierarchy? Binding on which courts?

## BINDING FORCE ANALYSIS
Binding, persuasive, or limited persuasive value? For what proposition exactly?

## RATIO vs OBITER
What is the ratio decidendi? Any obiter dicta that might be misused?

## CURRENT STATUS
Overruled, distinguished, or limited in subsequent decisions? Still good law?

## STRENGTH RATING
STRONG / ARGUABLE / WEAK — with reasons.

## OPPOSITION ATTACK
How would opposing counsel attack or distinguish this authority?

## RECOMMENDATION
How to deploy this authority most effectively.`,
        maxTokens: 1400,
        matter_track: activeCase.matter_track,
        counsel_role: activeCase.counsel_role,
      }));
      setValResult(text);
      persistAuths(
        auths.map(a => a.id === auth.id ? { ...a, validated: true, validation: text } : a),
      );
    } catch (e) {
      setValError((e as Error).message || 'API error.');
    }
    setValLoading(false);
  }

  // ── Conflict Resolver state ────────────────────────────────────────────────
  const [conflIssue,  setConflIssue]  = useState('');
  const [conflList,   setConflList]   = useState('');
  const [conflLoad,   setConflLoad]   = useState(false);
  const [conflResult, setConflResult] = useState('');
  const [conflError,  setConflError]  = useState('');

  async function resolveConflicts() {
    if (!conflIssue.trim()) return;
    setConflLoad(true);
    setConflError('');
    setConflResult('');
    const authList = conflList.trim() ||
      auths.map(a => `${a.caseName} (${a.citation}) — ${a.court} — ${a.principle}`).join('\n');
    try {
      const text = await withRetry(() => callClaude({
        system: '' + fullContext,
        userMsg: `LEGAL ISSUE: ${conflIssue}

AUTHORITIES:
${authList}

Analyse for conflicts:

## HIERARCHY MAP
Map each authority to its position in the Nigerian court hierarchy.

## CONFLICT IDENTIFICATION
Any direct conflicts between these authorities? On what proposition?

## RECONCILIATION ANALYSIS
Can apparent conflicts be reconciled? Different facts? Different issue? Earlier vs later decision?

## DOMINANT AUTHORITY
Which should prevail and why?

## DISTINGUISHING WEAK AUTHORITIES
How to distinguish or limit authorities opponent would rely on.

## DEPLOYMENT STRATEGY
How to present these authorities to court most effectively.

## RESEARCH GAPS
Additional authorities to source.`,
        maxTokens: 1500,
        matter_track: activeCase.matter_track,
        counsel_role: activeCase.counsel_role,
      }));
      setConflResult(text);
    } catch (e) {
      setConflError((e as Error).message || 'API error.');
    }
    setConflLoad(false);
  }

  // ── Quick Research state ───────────────────────────────────────────────────
  const [qQuery,  setQQuery]  = useState('');
  const [qLoad,   setQLoad]   = useState(false);
  const [qResult, setQResult] = useState('');
  const [qError,  setQError]  = useState('');

  async function runQuick() {
    if (!qQuery.trim()) return;
    setQLoad(true);
    setQError('');
    setQResult('');
    const role    = activeCase.counsel_role ?? '';
    const track   = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
    const roleCtx = role
      ? ` You are advising ${role} counsel on a ${track} matter. Tailor research to their position and flag both supportive and hostile authorities.`
      : '';
    try {
      const text = await withRetry(() => callClaude({
        system: QUICK_SYSTEM + roleCtx + fullContext,
        userMsg: `Nigerian law research query: ${qQuery}

## LEADING NIGERIAN AUTHORITIES
Key Supreme Court and Court of Appeal decisions on this point. For each: case name, approximate citation if known (flag if unverified), court, holding, binding strength.

## STATUTORY PROVISION
Key statutory provisions under Nigerian law governing this point.

## CURRENT STATE OF THE LAW
Settled position in Nigeria? Any tension or uncertainty?

## RESEARCH GUIDANCE
Where to find and verify: LawPavilion PRIMA, NigeriaLII, CasePrint, NWLR, official law reports.

## IMPORTANT CAVEAT
This is AI-generated research guidance only. All authorities must be independently verified before reliance in court.`,
        maxTokens: 1400,
        matter_track: activeCase.matter_track,
        counsel_role: activeCase.counsel_role,
      }));
      setQResult(text);
    } catch (e) {
      setQError((e as Error).message || 'API error.');
    }
    setQLoad(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Research-only disclaimer */}
      <div style={{
        padding: '12px 16px', background: '#06080e',
        border: '1px solid #c04040', borderLeft: '3px solid #804040',
        borderRadius: '0 6px 6px 0', marginBottom: 18,
      }}>
        <p style={{
          fontSize: 12, color: '#c07070',
          fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.65, margin: 0,
        }}>
          ⚠ Research guidance only. All authorities must be independently verified on
          LawPavilion, NigeriaLII, or official law reports before reliance in any court filing.
        </p>
      </div>

      <SubTabBar
        tabs={[
          { id: 'library',   label: '§ Authority Library'  },
          { id: 'conflicts', label: '⚖ Conflict Resolver'  },
          { id: 'quick',     label: '🔍 Quick Research'    },
        ]}
        active={valTab}
        onSelect={id => setValTab(id as 'library' | 'conflicts' | 'quick')}
        accent="#c07030"
      />

      {/* ── AUTHORITY LIBRARY ── */}
      {valTab === 'library' && (
        <div>
          {/* Add-authority form */}
          <div style={cardS}>
            <h3 style={hS}>Add Authority</h3>
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
              gap: 10, marginBottom: 10,
            }}>
              <div>
                <label style={labelS}>Case Name *</label>
                <input
                  value={authForm.caseName}
                  onChange={e => setAuthForm(f => ({ ...f, caseName: e.target.value }))}
                  placeholder="e.g. Adesanya v Governor of Lagos State"
                  style={iS}
                />
              </div>
              <div>
                <label style={labelS}>Citation</label>
                <input
                  value={authForm.citation}
                  onChange={e => setAuthForm(f => ({ ...f, citation: e.target.value }))}
                  placeholder="(1981) 2 NCLR 358"
                  style={iS}
                />
              </div>
              <div>
                <label style={labelS}>Year</label>
                <input
                  value={authForm.year}
                  onChange={e => setAuthForm(f => ({ ...f, year: e.target.value }))}
                  placeholder="1981"
                  style={iS}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelS}>Court</label>
                <select
                  value={authForm.court}
                  onChange={e => setAuthForm(f => ({ ...f, court: e.target.value }))}
                  style={iS}
                >
                  <option value="">Select court</option>
                  {NIGERIAN_COURTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelS}>Binding For (issue)</label>
                <input
                  value={authForm.bindingFor}
                  onChange={e => setAuthForm(f => ({ ...f, bindingFor: e.target.value }))}
                  placeholder="e.g. Locus standi of non-parties"
                  style={iS}
                />
              </div>
            </div>
            <label style={labelS}>Principle Relied On</label>
            <textarea
              style={{ ...taS, minHeight: 70, marginBottom: 12 }}
              value={authForm.principle}
              onChange={e => setAuthForm(f => ({ ...f, principle: e.target.value }))}
              placeholder="State the ratio or principle you are relying on from this case."
            />
            <Btn
              onClick={addAuth}
              loading={false}
              disabled={!authForm.caseName.trim()}
              label="Add to Library"
              accent="#c07030"
            />
          </div>

          {auths.length === 0 && (
            <p style={{
              fontSize: 13, color: T.mute,
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              No authorities added yet.
            </p>
          )}

          {auths.map(auth => (
            <div key={auth.id} style={{
              background: selAuthId === auth.id ? '#06080e' : T.card,
              border: `1px solid ${selAuthId === auth.id ? '#c0703040' : T.bdr}`,
              borderRadius: 7, padding: '14px 16px', marginBottom: 8,
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', gap: 10, marginBottom: 6,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 13, color: T.text,
                    fontFamily: "'Times New Roman', Times, serif", fontWeight: 600,
                  }}>
                    {auth.caseName}
                  </div>
                  <div style={{
                    fontSize: 11, color: T.mute,
                    fontFamily: "'Times New Roman', Times, serif",
                  }}>
                    {auth.citation} · {auth.court} · {auth.year}
                  </div>
                  {auth.principle && (
                    <div style={{
                      fontSize: 10, color: T.dim,
                      fontFamily: "'Times New Roman', Times, serif",
                      marginTop: 3, lineHeight: 1.5,
                    }}>
                      {auth.principle}
                    </div>
                  )}
                  {auth.validated && (
                    <div style={{
                      fontSize: 10, color: '#40b068',
                      fontFamily: "'Times New Roman', Times, serif",
                      marginTop: 3, fontWeight: 700,
                    }}>
                      ✓ Validated
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => validateAuth(auth)}
                    style={{
                      background: '#c0703014', border: '1px solid #c0703040',
                      color: '#c07030', borderRadius: 3, padding: '4px 10px',
                      fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                      cursor: 'pointer',
                    }}
                  >
                    {valLoading && selAuthId === auth.id ? '⟳' : 'Validate'}
                  </button>
                  <button
                    onClick={() => persistAuths(auths.filter(a => a.id !== auth.id))}
                    style={{
                      background: 'transparent', border: '1px solid #3a1a1a',
                      color: '#804040', borderRadius: 3, padding: '4px 8px',
                      cursor: 'pointer', fontSize: 10,
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Validation result for this authority */}
              {valResult && selAuthId === auth.id && !valLoading && (
                <div style={{
                  marginTop: 10, background: '#06060e',
                  border: '1px solid #1e1e30', borderRadius: 5,
                  padding: '12px 14px',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'flex-end', marginBottom: 8,
                  }}>
                    <button
                      onClick={() => copyToClipboard(valResult)}
                      style={{
                        background: 'transparent', border: '1px solid #cccccc',
                        color: T.mute, borderRadius: 3, padding: '4px 12px',
                        fontSize: 10, cursor: 'pointer',
                        fontFamily: "'Times New Roman', Times, serif",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <Md text={valResult} />
                </div>
              )}
              {valError && selAuthId === auth.id && <ErrorBlock message={valError} />}
            </div>
          ))}
        </div>
      )}

      {/* ── CONFLICT RESOLVER ── */}
      {valTab === 'conflicts' && (
        <div style={cardS}>
          <h3 style={hS}>Conflict Resolver</h3>
          <p style={dimS}>
            List all authorities on a legal issue — including those that might conflict.
            The engine maps hierarchy, identifies conflicts, and builds a deployment strategy.
          </p>
          <label style={labelS}>Legal Issue *</label>
          <input
            value={conflIssue}
            onChange={e => setConflIssue(e.target.value)}
            placeholder="e.g. Whether the High Court has jurisdiction where pre-action notice to AG was not served"
            style={{ ...iS, marginBottom: 12 }}
          />
          <label style={labelS}>Authorities to Analyse (or leave blank to use library)</label>
          <textarea
            style={{ ...taS, minHeight: 120, marginBottom: 14 }}
            value={conflList}
            onChange={e => setConflList(e.target.value)}
            placeholder={`One per line — e.g.\nTukur v. Government of Gongola State (1989) — Supreme Court\nOkafor v. A-G Anambra State (1991) — Supreme Court`}
          />
          <Btn
            onClick={resolveConflicts}
            loading={conflLoad}
            disabled={!conflIssue.trim()}
            label="Analyse Conflicts"
            accent="#c07030"
          />
          {conflError && <ErrorBlock message={conflError} />}
          {conflResult && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                  onClick={() => copyToClipboard(conflResult)}
                  style={{
                    background: 'transparent', border: '1px solid #cccccc',
                    color: T.mute, borderRadius: 3, padding: '4px 12px',
                    fontSize: 10, cursor: 'pointer',
                    fontFamily: "'Times New Roman', Times, serif",
                  }}
                >
                  Copy
                </button>
              </div>
              <Md text={conflResult} />
            </div>
          )}
        </div>
      )}

      {/* ── QUICK RESEARCH ── */}
      {valTab === 'quick' && (
        <div style={cardS}>
          <h3 style={hS}>Quick Research</h3>
          <p style={dimS}>
            Ad-hoc Nigerian law research. Starting point only —
            verify everything independently before filing.
          </p>
          <label style={labelS}>Research Question *</label>
          <textarea
            style={{ ...taS, minHeight: 100, marginBottom: 14 }}
            value={qQuery}
            onChange={e => setQQuery(e.target.value)}
            placeholder="e.g. What is the current position on whether a liquidated company can be a party to litigation in Nigeria?"
          />
          <Btn
            onClick={runQuick}
            loading={qLoad}
            disabled={!qQuery.trim()}
            label="Research"
            accent="#c07030"
          />
          {qError && <ErrorBlock message={qError} />}
          {qResult && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                  onClick={() => copyToClipboard(qResult)}
                  style={{
                    background: 'transparent', border: '1px solid #cccccc',
                    color: T.mute, borderRadius: 3, padding: '4px 12px',
                    fontSize: 10, cursor: 'pointer',
                    fontFamily: "'Times New Roman', Times, serif",
                  }}
                >
                  Copy
                </button>
              </div>
              <Md text={qResult} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4 — SYNTHESISE
// ─────────────────────────────────────────────────────────────────────────────

type SynthesisMode = 'civil' | 'criminal' | 'appeal';

interface SynthesisResult {
  mode:      SynthesisMode;
  theory:    string;
  timestamp: string;
  caseId:    string;
}

function detectSynthMode(activeCase: Case): SynthesisMode {
  if (activeCase.appeal_data?.package) return 'appeal';
  if (activeCase.matter_track === 'criminal') return 'criminal';
  return 'civil';
}

function synthModeLabel(mode: SynthesisMode): string {
  if (mode === 'appeal')   return 'Appeal Master Theory';
  if (mode === 'criminal') return 'Criminal Master Defence Theory';
  return 'Civil Master Case Theory';
}

function checkSynthReadiness(
  activeCase: Case,
  mode: SynthesisMode,
  hasDraft: boolean,
  hasAuths: boolean,
): { id: string; label: string; met: boolean; goTo: string }[] {
  const hasIntelPkg = Boolean(activeCase.intelligence_data?.intPkg && activeCase.intelligence_data.intPkg.length > 50);

  if (mode === 'appeal') return [
    { id: 'intel', label: 'Intelligence Package generated',        met: hasIntelPkg, goTo: 'intelligence' },
    { id: 'draft', label: 'Final Written Address draft generated', met: hasDraft,    goTo: 'draft'        },
  ];
  return [
    { id: 'intel', label: 'Intelligence Package generated',        met: hasIntelPkg, goTo: 'intelligence' },
    { id: 'draft', label: 'Final Written Address draft generated', met: hasDraft,    goTo: 'draft'        },
    { id: 'auths', label: 'Authorities added to library (Stage 3)', met: hasAuths,   goTo: 'validate'     },
  ];
}

function Stage4Synthesise({ activeCase, onNavigateToStage }: {
  activeCase: Case;
  onNavigateToStage: (stage: StageId) => void;
}) {
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'FinalWrittenAddress' });
  const { ask, loading: aiLoading, error: aiError } = useAI(activeCase);

  const mode = detectSynthMode(activeCase);

  // hasDraft and hasAuths must come from Dexie — not localStorage — so they
  // survive offline, PWA reinstall, and storage eviction.
  const [hasDraft, setHasDraft] = useState(false);
  const [hasAuths, setHasAuths] = useState(false);

  useEffect(() => {
    fwaLoad<string>(activeCase.id, 'draft_saved', '').then(d => setHasDraft(!!d));
    aveLoad<Authority[]>(activeCase.id, 'auths', []).then(a => setHasAuths(a.length > 0));
  }, [activeCase.id]);

  const readiness = checkSynthReadiness(activeCase, mode, hasDraft, hasAuths);
  const allReady  = readiness.every(r => r.met);

  const [result,     setResult]     = useState<SynthesisResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied,     setCopied]     = useState(false);

  useEffect(() => {
    fwaLoad<SynthesisResult | null>(activeCase.id, 'synthesis', null).then(setResult);
  }, [activeCase.id]);

  async function generate() {
    setGenerating(true);

    const draftFromStorage = await fwaLoad<string>(activeCase.id, 'draft_saved', '');
    const authsRaw = await aveLoad<Authority[]>(activeCase.id, 'auths', []);
    const authorityLibrarySummary = authsRaw.map(a =>
      `${a.caseName} (${a.citation}) — ${a.court} — ${a.principle}`
    ).join('\n') || '(no authorities in library)';

    const isCriminal = activeCase.matter_track === 'criminal';

    const sections = isCriminal
      ? "1. THE DECISIVE ISSUE\n2. THE DEFENCE THEORY OF FACTS\n3. THE PROSECUTION'S FATAL WEAKNESSES (ingredient by ingredient)\n4. AUTHORITY DEPLOYMENT\n5. RISK ASSESSMENT\n6. IMMEDIATE ACTIONS"
      : "1. THE DECISIVE ISSUE\n2. THE WINNING THEORY OF FACTS\n3. THE LEGAL FRAMEWORK\n4. AUTHORITY DEPLOYMENT\n5. RISK-ADJUSTED STRATEGY\n6. IMMEDIATE ACTIONS";

    const userMsg = `You are NOT generating new legal analysis. You are finding the single coherent case theory that reconciles ALL the engine outputs provided.

CRITICAL: Where inputs contradict each other, surface the contradiction EXPLICITLY. Do NOT resolve contradictions silently.

CASE: ${activeCase.caseName}
COURT: ${activeCase.court || 'Not specified'}
MATTER TRACK: ${activeCase.matter_track || 'civil'}
COUNSEL ROLE: ${activeCase.counsel_role || 'Not specified'}

INTELLIGENCE PACKAGE:
${activeCase.intelligence_data?.intPkg || '(not available)'}

FINAL WRITTEN ADDRESS DRAFT (Stage 1):
${draftFromStorage ? draftFromStorage.slice(0, 4000) : '(not available)'}

AUTHORITY LIBRARY (Stage 3):
${authorityLibrarySummary}

Produce the ${synthModeLabel(mode)} in exactly these sections:

${sections}

Output only the sections. No preamble. No disclaimer.`;

    const raw = await ask({
      system: 'You are a senior Nigerian advocate. Respond in plain structured text suitable for law chambers. No markdown fences. Use numbered sections exactly as instructed.' + fullContext,
      userMsg,
      maxTokens: 3000,
      matter_track: activeCase.matter_track,
      counsel_role: activeCase.counsel_role,
    });

    if (raw) {
      const newResult: SynthesisResult = {
        mode, theory: raw.trim(), timestamp: new Date().toISOString(), caseId: activeCase.id,
      };
      fwaSave(activeCase.id, 'synthesis', newResult);
      setResult(newResult);
    }
    setGenerating(false);
  }

  async function handleCopy() {
    if (!result) return;
    await copyToClipboard(`${synthModeLabel(result.mode)}\n${activeCase.caseName || ''}\nGenerated: ${new Date(result.timestamp).toLocaleString()}\n\n${result.theory}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>{synthModeLabel(mode)}</h3>
        <p style={dimS}>
          Reads Intelligence Package + Stage 1 draft + Stage 3 authority library.
          Surfaces contradictions explicitly. Does not generate new analysis — finds the coherent theory.
        </p>

        {/* Readiness checklist */}
        <div style={{ marginBottom: 20 }}>
          {readiness.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: item.met ? '#071810' : '#1a1000',
                border: `1px solid ${item.met ? '#285000' : '#4a3800'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: item.met ? '#40b068' : '#b08030',
              }}>
                {item.met ? '✓' : '!'}
              </div>
              <span style={{ fontSize: 12, color: item.met ? T.sub : '#b08030', fontFamily: "'Times New Roman', Times, serif", flex: 1 }}>
                {item.label}
              </span>
              {!item.met && (
                <button onClick={() => onNavigateToStage(item.goTo as StageId)} style={{
                  background: 'transparent', border: '1px solid #4a3800', color: '#b08030',
                  borderRadius: 3, padding: '3px 10px', fontSize: 10,
                  fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
                }}>
                  Go →
                </button>
              )}
            </div>
          ))}
        </div>

        <Btn
          onClick={generate}
          loading={generating || aiLoading}
          disabled={!allReady}
          label={result ? 'Regenerate Master Theory' : 'Generate Master Case Theory'}
          accent="#40a878"
        />

        {!allReady && (
          <p style={{ fontSize: 11, color: '#b08030', fontFamily: "'Times New Roman', Times, serif", marginTop: 8, lineHeight: 1.6 }}>
            Complete the checklist above before generating.
          </p>
        )}

        {aiError && <ErrorBlock message={aiError} />}
      </div>

      {result && (
        <div style={cardS}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: '#40a878', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }}>
                {synthModeLabel(result.mode)}
              </div>
              <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                Generated: {new Date(result.timestamp).toLocaleString()}
              </div>
            </div>
            <button onClick={handleCopy} style={{
              background: copied ? '#071810' : 'transparent',
              border: `1px solid ${copied ? '#285000' : '#cccccc'}`,
              color: copied ? '#40b068' : T.mute,
              borderRadius: 3, padding: '5px 14px', fontSize: 10,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{
            background: '#06060e', border: '1px solid #1a1a2a', borderRadius: 6,
            padding: '18px 20px', fontSize: 13, color: T.text,
            fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.85,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {result.theory}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5C — FINAL ADDRESS HANDOFF BANNER
//
// Visible at the top of FinalWrittenAddressEngine when:
//   (a) trial_stage === 'defence_case_closed'   → trial formally concluded
//   (b) OR case_theory_locked === true          → theory is in place
//
// Shows:
//   1. Trial status strip — green if trial concluded, amber if theory-only
//   2. What is flowing in: locked theory (core proposition), trial stage,
//      any unresolved cx_contradictions not yet promoted to theory
//   3. Drafting readiness checklist — all the inputs FWA needs to produce
//      a theory-tight, contradiction-aware Final Written Address
//   4. If trial NOT yet concluded — a soft warning (not a gate)
// ─────────────────────────────────────────────────────────────────────────────

interface FWAHandoffBannerProps {
  activeCase: Case;
  theory:     CaseTheoryRecord | null;
  hasTheory:  boolean;
}

function FWAHandoffBanner({ activeCase, theory, hasTheory }: FWAHandoffBannerProps) {
  const trialConcluded = activeCase.trial_stage === 'defence_case_closed';
  const hasIntelPkg    = Boolean(activeCase.intelligence_data?.intPkg);
  const theoryLocked   = activeCase.case_theory_locked === true;

  const [pendingContradictions, setPendingContradictions] = React.useState<number>(0);

  React.useEffect(() => {
    loadBlindSpot<unknown[]>(activeCase.id, 'cx_contradictions', []).then(list => {
      if (!Array.isArray(list)) { setPendingContradictions(0); return; }
      const pending = (list as any[]).filter((m: any) =>
        typeof m?.notes === 'string' &&
        m.notes.includes('[AUTO:') &&
        !m.notes.includes('[THEORY_QUEUED]')
      ).length;
      setPendingContradictions(pending);
    });
  }, [activeCase.id]);

  if (!hasTheory && !trialConcluded) return null;

  const bannerColor = trialConcluded ? '#1a5a30' : '#7a4a00';
  const bannerBg    = trialConcluded ? '#f0f8f2' : '#fdf6e8';
  const bannerBdr   = trialConcluded ? '#a8d0b8' : '#e0cfa0';

  const STAGE_LABEL: Record<string, string> = {
    own_case_open:       'Own case open (examination underway)',
    own_case_closed:     'Own case closed',
    defence_case_open:   'Opposing case open (cross-examination underway)',
    defence_case_closed: 'Both cases closed — trial concluded',
  };

  return (
    <div style={{
      background:   bannerBg,
      border:       `1px solid ${bannerBdr}`,
      borderLeft:   `3px solid ${bannerColor}`,
      borderRadius: '0 6px 6px 0',
      padding:      '14px 18px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
          fontFamily: "'Times New Roman', Times, serif",
          textTransform: 'uppercase', color: bannerColor,
        }}>
          {trialConcluded ? '\u2713 Trial Concluded \u2014 Final Address Ready' : '\u26a0 Trial In Progress'}
        </span>
        {activeCase.trial_stage && (
          <span style={{
            fontSize: 10,
            fontFamily: "'Times New Roman', Times, serif",
            color: bannerColor,
          }}>
            {'\u00b7'} {STAGE_LABEL[activeCase.trial_stage] ?? activeCase.trial_stage}
          </span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 8,
        marginBottom: pendingContradictions > 0 || !trialConcluded ? 12 : 0,
      }}>
        <div style={{ padding: '8px 12px', background: '#ffffff', border: `1px solid ${hasIntelPkg ? '#a8d0b8' : '#e0cfa0'}`, borderRadius: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', fontFamily: "'Times New Roman', Times, serif", textTransform: 'uppercase', color: hasIntelPkg ? '#1a5a30' : '#7a4a00', marginBottom: 3 }}>
            {hasIntelPkg ? '\u2713' : '\u2717'} Intelligence Package
          </div>
          <div style={{ fontSize: 11, fontFamily: "'Times New Roman', Times, serif", color: hasIntelPkg ? '#2a6a3a' : '#8a5a00' }}>
            {hasIntelPkg ? 'Ready \u2014 will be injected into all AI calls' : 'Not generated \u2014 run Intelligence Engine'}
          </div>
        </div>

        <div style={{ padding: '8px 12px', background: '#ffffff', border: `1px solid ${theoryLocked ? '#a8d0b8' : '#e0cfa0'}`, borderRadius: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', fontFamily: "'Times New Roman', Times, serif", textTransform: 'uppercase', color: theoryLocked ? '#1a5a30' : '#7a4a00', marginBottom: 3 }}>
            {theoryLocked ? '\u2713' : '\u2717'} Case Theory
          </div>
          <div style={{ fontSize: 11, fontFamily: "'Times New Roman', Times, serif", color: theoryLocked ? '#1a5a30' : '#8a5a00', lineHeight: 1.4 }}>
            {theoryLocked && theory?.core_proposition
              ? theory.core_proposition.length > 90
                ? theory.core_proposition.slice(0, 90) + '\u2026'
                : theory.core_proposition
              : 'Not locked \u2014 lock theory in Trial Engine first'}
          </div>
        </div>

        <div style={{ padding: '8px 12px', background: '#ffffff', border: `1px solid ${trialConcluded ? '#a8d0b8' : '#e0cfa0'}`, borderRadius: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', fontFamily: "'Times New Roman', Times, serif", textTransform: 'uppercase', color: trialConcluded ? '#1a5a30' : '#7a4a00', marginBottom: 3 }}>
            {trialConcluded ? '\u2713' : '\u23f3'} Trial Stage
          </div>
          <div style={{ fontSize: 11, fontFamily: "'Times New Roman', Times, serif", color: trialConcluded ? '#2a6a3a' : '#8a5a00' }}>
            {activeCase.trial_stage
              ? STAGE_LABEL[activeCase.trial_stage]
              : 'Trial not yet started \u2014 advance stages in Trial Engine'}
          </div>
        </div>
      </div>

      {pendingContradictions > 0 && (
        <div style={{ padding: '8px 12px', background: '#fff8f0', border: '1px solid #e0b888', borderRadius: 4, marginBottom: 8 }}>
          <p style={{ fontSize: 11, fontFamily: "'Times New Roman', Times, serif", color: '#7a4a00', margin: 0, lineHeight: 1.55 }}>
            {'\u26a0'} <strong>{pendingContradictions} live contradiction{pendingContradictions !== 1 ? 's' : ''}</strong> from cross-examination not yet promoted to the Case Theory. Go to <strong>Trial Engine {'\u2192'} Contradiction Mapper</strong> to promote them before drafting.
          </p>
        </div>
      )}

      {!trialConcluded && hasTheory && (
        <div style={{ padding: '8px 12px', background: '#fffbf0', border: '1px solid #e8d090', borderRadius: 4 }}>
          <p style={{ fontSize: 11, fontFamily: "'Times New Roman', Times, serif", color: '#7a5a00', margin: 0, lineHeight: 1.55 }}>
            Trial is not yet concluded. You can begin drafting now \u2014 the engine will use the current locked theory \u2014 but the Final Address should be filed only after both cases are closed and all live contradictions have been promoted.
          </p>
        </div>
      )}
    </div>
  );
}


interface Props { activeCase: Case; }

export function FinalWrittenAddressEngine({ activeCase }: Props) {
  const [activeStage,  setActiveStage]  = useState<StageId>('draft');
  const [draftSubTab,  setDraftSubTab]  = useState<DraftSubTab>('intel');
  const [currentDraft, setCurrentDraft] = useState('');

  const isCriminal = activeCase.matter_track === 'criminal';

  // Phase 9A — top-level theory banner, visible across all stages
  const { theory, locked, score, hasTheory, loading: theoryLoading } = useCaseTheory(activeCase.id);

  // Persist draft for Stage 4 to read
  function handleDraftSaved(draft: string) {
    setCurrentDraft(draft);
    fwaSave(activeCase.id, 'draft_saved', draft);
  }

  const stageIndex = STAGES.findIndex(s => s.id === activeStage);
  const goNext = () => { const n = STAGES[stageIndex + 1]; if (n) setActiveStage(n.id); };
  const goPrev = () => { const p = STAGES[stageIndex - 1]; if (p) setActiveStage(p.id); };

  const draftSubTabs: { id: DraftSubTab; label: string }[] = [
    { id: 'intel',    label: '1 — Import Intelligence' },
    { id: 'build',    label: '2 — Build & Generate' },
    { id: 'reply',    label: '3 — Reply on Points of Law' },
    { id: 'status',   label: '4 — Status' },
    { id: 'versions', label: '5 — Version History' },
  ];

  const currentStageColor = STAGES[stageIndex]?.color ?? ACC;

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Phase 5C — Trial Handoff Banner */}
      <FWAHandoffBanner
        activeCase={activeCase}
        theory={theory}
        hasTheory={hasTheory}
      />

      {/* Pipeline bar */}
      <PipelineBar activeStage={activeStage} onStageClick={setActiveStage} />

      {/* Phase 9A — Case Theory banner, always visible across all stages */}
      <CaseTheoryBanner
        theory={theory}
        locked={locked}
        score={score}
        hasTheory={hasTheory}
        loading={theoryLoading}
      />

      {/* Stage nav */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '10px 14px',
        background: `${currentStageColor}08`, border: `1px solid ${currentStageColor}30`,
        borderRadius: 7, borderLeft: `3px solid ${currentStageColor}`,
      }}>
        <div style={{ fontSize: 12, color: currentStageColor, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
          Stage {stageIndex + 1} — {STAGES[stageIndex]?.label}
          {activeStage === 'draft' && (
            <span style={{ fontSize: 10, color: T.mute, fontWeight: 400, marginLeft: 10 }}>
              {isCriminal ? '⚖ Criminal route' : '§ Civil/FREP route'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {stageIndex > 0 && (
            <button onClick={goPrev} style={{
              background: T.bg, border: `1px solid ${T.bdr}`, color: T.mute,
              borderRadius: 5, padding: '5px 12px', fontSize: 11,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>← Prev</button>
          )}
          {stageIndex < STAGES.length - 1 && (
            <button onClick={goNext} style={{
              background: `${currentStageColor}12`, border: `1px solid ${currentStageColor}40`,
              color: currentStageColor, borderRadius: 5, padding: '5px 12px', fontSize: 11,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}>Next →</button>
          )}
        </div>
      </div>

      {/* ── STAGE 1 — DRAFT ──────────────────────────────────────────────────── */}
      {activeStage === 'draft' && (
        <div>
          <ProceduralBanner activeCase={activeCase} />
          <SubTabBar
            tabs={draftSubTabs}
            active={draftSubTab}
            onSelect={id => setDraftSubTab(id as DraftSubTab)}
            accent={ACC}
          />
          {draftSubTab === 'intel'    && <IntelTab activeCase={activeCase} />}
          {draftSubTab === 'build'    && !isCriminal && (
            <CivilDrafterTab activeCase={activeCase} onDraftSaved={handleDraftSaved} />
          )}
          {draftSubTab === 'build'    && isCriminal && (
            <CriminalDrafterTab activeCase={activeCase} onDraftSaved={handleDraftSaved} />
          )}
          {draftSubTab === 'reply'    && <ReplyTab activeCase={activeCase} />}
          {draftSubTab === 'status'   && <StatusTab activeCase={activeCase} />}
          {draftSubTab === 'versions' && (
            <VersionsTab
              activeCase={activeCase}
              currentDraft={currentDraft}
              onRestoreDraft={handleDraftSaved}
            />
          )}
        </div>
      )}

      {/* ── STAGE 2 — RESEARCH ────────────────────────────────────────────────── */}
      {activeStage === 'research' && (
        <Stage2Research activeCase={activeCase} />
      )}

      {/* ── STAGE 3 — VALIDATE ────────────────────────────────────────────────── */}
      {activeStage === 'validate' && (
        <Stage3Validate activeCase={activeCase} />
      )}

      {/* ── STAGE 4 — SYNTHESISE ──────────────────────────────────────────────── */}
      {activeStage === 'synthesise' && (
        <Stage4Synthesise activeCase={activeCase} onNavigateToStage={setActiveStage} />
      )}

    </div>
  );
}
 
