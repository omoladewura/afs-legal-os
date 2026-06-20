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
 * Phase 5 (Build Plan v2):
 *   Tab 2 — Witness Register — fully implemented.
 *
 * Phase 6 (Build Plan v2):
 *   Tab 3 — Examination-in-Chief — fully implemented.
 *   Three-sided Witness Preparation Bundle: counsel question script (Side A) ·
 *   witness study pack (Side B) · anticipated cross-examination prep (Side C).
 *
 * Phase 7 (Build Plan v2):
 *   Tab 4 — Cross-Examination — fully implemented.
 *   Witness Statement Importer (line-numbered, Witness Register or local paste) ·
 *   Statement Audit (claims, internal/case contradictions, omissions, strategic
 *   purpose) · Theory-Breach Question Generator across four tactical tiers
 *   (Theory Destroyers · Credibility Shakers · Evidence Exclusion · Cleanup).
 *
 *   Tabs 5–7 (Contradiction Mapper, Impeachment Arsenal, Live Courtroom Mode)
 *   remain ComingSoon placeholders — implemented in Phase 8.
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
import { saveCaseTheory, lockCaseTheory, unlockCaseTheory, loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
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
    desc:  'Witness Statement Importer with line-numbered review · Statement Audit (claims, contradictions, omissions, strategic purpose) · Theory-Breach Question Generator across four tactical tiers.',
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
// PHASE 5 — WITNESS REGISTER TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface TrialWitness {
  id:                  string;
  side:                'own' | 'opposing';
  name:                string;
  designation:         string;   // e.g. "PW1", "DW2", "CW1"
  role_in_case:        string;   // e.g. "Arresting officer", "Eye witness"
  expected_testimony:  string;
  exhibit_list:        string;
  call_order:          number;   // 1-based; mirrors array position
  // Own witnesses only
  strengths:           string;
  coaching_notes:      string;
  // Opposing witnesses only
  vulnerabilities:     string;
  statement_text:      string;   // Full witness statement on oath
  statement_uploaded:  boolean;
  // Both
  status:              'pending' | 'testified' | 'withdrawn';
  notes:               string;
}

interface WitnessStore {
  own:       TrialWitness[];
  opposing:  TrialWitness[];
}

const WITNESS_STORE_KEY = 'trial_witnesses';

function blankWitness(side: 'own' | 'opposing', order: number): TrialWitness {
  return {
    id: uid(), side, name: '', designation: '', role_in_case: '',
    expected_testimony: '', exhibit_list: '', call_order: order,
    strengths: '', coaching_notes: '', vulnerabilities: '',
    statement_text: '', statement_uploaded: false,
    status: 'pending', notes: '',
  };
}

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
// PHASE 5 — WITNESS REGISTER TAB
// ─────────────────────────────────────────────────────────────────────────────

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TrialWitness['status'] }) {
  const MAP = {
    pending:   { label: 'Pending',   bg: '#f0f0f0', color: '#555555' },
    testified: { label: 'Testified', bg: '#e8f4e8', color: '#2a6a3a' },
    withdrawn: { label: 'Withdrawn', bg: '#fdf0f0', color: '#8a1a1a' },
  };
  const s = MAP[status];
  return (
    <span style={{
      fontSize: 9, padding: '2px 7px', borderRadius: 2,
      background: s.bg, color: s.color,
      fontFamily: "'Times New Roman', Times, serif",
      fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  );
}

// ── Single witness card ────────────────────────────────────────────────────────

interface WitnessCardProps {
  witness:      TrialWitness;
  index:        number;
  total:        number;
  expanded:     boolean;
  onToggle:     () => void;
  onChange:     (updated: TrialWitness) => void;
  onRemove:     () => void;
  // drag
  onDragStart:  (idx: number) => void;
  onDragOver:   (e: React.DragEvent, idx: number) => void;
  onDrop:       (idx: number) => void;
}

function WitnessCard({
  witness, index, expanded, onToggle, onChange, onRemove,
  onDragStart, onDragOver, onDrop,
}: WitnessCardProps) {
  const isOwn = witness.side === 'own';
  const accent = isOwn ? '#1a5a30' : '#7a1a1a';

  function field(key: keyof TrialWitness, val: string | boolean) {
    onChange({ ...witness, [key]: val });
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      style={{
        border: `1px solid ${T.bdr}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 5,
        marginBottom: 8,
        background: '#ffffff',
        cursor: 'default',
      }}
    >
      {/* ── Collapsed header ── */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 11, color: T.mute, cursor: 'grab',
          fontFamily: "'Times New Roman', Times, serif",
          flexShrink: 0,
        }} title="Drag to reorder">
          ⠿
        </span>
        <span style={{
          fontSize: 10, color: '#ffffff',
          background: accent, borderRadius: 2,
          padding: '1px 7px', fontFamily: "'Times New Roman', Times, serif",
          fontWeight: 700, letterSpacing: '.06em', flexShrink: 0,
        }}>
          {witness.designation || `#${index + 1}`}
        </span>
        <span style={{
          fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif",
          fontWeight: witness.name ? 600 : 400,
          color: witness.name ? T.text : T.mute,
          flexGrow: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {witness.name || 'Unnamed witness'}
        </span>
        {witness.role_in_case && (
          <span style={{
            fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
            flexShrink: 0, display: 'none',
          }} className="role-label">
            {witness.role_in_case}
          </span>
        )}
        <StatusBadge status={witness.status} />
        <span style={{
          fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
          flexShrink: 0,
        }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* ── Expanded fields ── */}
      {expanded && (
        <div style={{ padding: '4px 14px 16px', borderTop: `1px solid ${T.bdrL}` }}>

          {/* Row 1: Name, Designation, Role */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: 10, marginTop: 12 }}>
            <div>
              <label style={S.label}>Full Name</label>
              <input style={S.inp} value={witness.name}
                onChange={e => field('name', e.target.value)}
                placeholder="e.g. Chukwudi Okafor" />
            </div>
            <div>
              <label style={S.label}>Designation</label>
              <input style={S.inp} value={witness.designation}
                onChange={e => field('designation', e.target.value)}
                placeholder={isOwn ? 'DW1' : 'PW1'} />
            </div>
            <div>
              <label style={S.label}>Role in Case</label>
              <input style={S.inp} value={witness.role_in_case}
                onChange={e => field('role_in_case', e.target.value)}
                placeholder="Eye witness / Arresting officer / Expert" />
            </div>
          </div>

          {/* Status */}
          <div style={{ marginTop: 10 }}>
            <label style={S.label}>Status</label>
            <select
              style={{ ...S.sel, width: 'auto', minWidth: 180 }}
              value={witness.status}
              onChange={e => field('status', e.target.value as TrialWitness['status'])}
            >
              <option value="pending">Pending</option>
              <option value="testified">Testified</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>

          {/* Expected testimony */}
          <div style={{ marginTop: 10 }}>
            <label style={S.label}>Expected Testimony</label>
            <textarea style={{ ...S.ta, minHeight: 80 }}
              value={witness.expected_testimony}
              onChange={e => field('expected_testimony', e.target.value)}
              placeholder="What this witness will say in evidence…" />
          </div>

          {/* Exhibit list */}
          <div style={{ marginTop: 10 }}>
            <label style={S.label}>Exhibits This Witness Introduces</label>
            <textarea style={{ ...S.ta, minHeight: 50 }}
              value={witness.exhibit_list}
              onChange={e => field('exhibit_list', e.target.value)}
              placeholder="Exhibit A (Purchase agreement), Exhibit B (Bank statement)…" />
          </div>

          {/* Own-witness fields */}
          {isOwn && (
            <>
              <div style={{ marginTop: 10 }}>
                <label style={S.label}>Strengths</label>
                <textarea style={{ ...S.ta, minHeight: 60 }}
                  value={witness.strengths}
                  onChange={e => field('strengths', e.target.value)}
                  placeholder="What makes this witness credible and compelling…" />
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={S.label}>Coaching Notes (Confidential)</label>
                <textarea style={{ ...S.ta, minHeight: 60 }}
                  value={witness.coaching_notes}
                  onChange={e => field('coaching_notes', e.target.value)}
                  placeholder="Demeanour notes, areas to avoid, preparation reminders…" />
              </div>
            </>
          )}

          {/* Opposing-witness fields */}
          {!isOwn && (
            <>
              <div style={{ marginTop: 10 }}>
                <label style={S.label}>Known Vulnerabilities</label>
                <textarea style={{ ...S.ta, minHeight: 60 }}
                  value={witness.vulnerabilities}
                  onChange={e => field('vulnerabilities', e.target.value)}
                  placeholder="Prior inconsistent statements, motive to lie, relationship to other parties, gaps in knowledge…" />
              </div>

              {/* Statement toggle */}
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ ...S.label, margin: 0 }}>Witness Statement on Oath</label>
                  {!witness.statement_uploaded ? (
                    <button
                      onClick={() => field('statement_uploaded', true)}
                      style={{
                        background: 'transparent', border: `1px solid ${T.bdr}`,
                        color: T.dim, borderRadius: 3, padding: '3px 10px',
                        fontSize: 11, cursor: 'pointer',
                        fontFamily: "'Times New Roman', Times, serif",
                      }}
                    >
                      Load Statement
                    </button>
                  ) : (
                    <button
                      onClick={() => { field('statement_uploaded', false); field('statement_text', ''); }}
                      style={{
                        background: 'transparent', border: 'none',
                        color: T.mute, fontSize: 11, cursor: 'pointer',
                        fontFamily: "'Times New Roman', Times, serif",
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {witness.statement_uploaded ? (
                  <textarea
                    style={{ ...S.ta, minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
                    value={witness.statement_text}
                    onChange={e => field('statement_text', e.target.value)}
                    placeholder="Paste the full witness statement on oath here.\n\nThis is the document served on you — paste it verbatim. Tab 4 (Cross-Examination) reads this to run the statement audit and generate theory-breach questions."
                  />
                ) : (
                  <div style={{
                    padding: '12px 14px', background: '#fafaf8',
                    border: `1px dashed ${T.bdr}`, borderRadius: 4,
                  }}>
                    <p style={{ fontSize: 12, color: T.mute, margin: 0, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                      Statement not loaded. Click "Load Statement" to paste the witness statement on oath.
                      If formal statement has not yet been served, load notes of expected evidence instead.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Notes */}
          <div style={{ marginTop: 10 }}>
            <label style={S.label}>Notes</label>
            <textarea style={{ ...S.ta, minHeight: 50 }}
              value={witness.notes}
              onChange={e => field('notes', e.target.value)}
              placeholder="Any additional notes for this witness…" />
          </div>

          {/* Remove */}
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onRemove} style={{
              background: 'transparent', border: `1px solid ${T.bdr}`,
              color: '#8a1a1a', borderRadius: 3, padding: '5px 12px',
              fontSize: 11, cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              Remove Witness
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Witness panel (Own or Opposing) ──────────────────────────────────────────

interface WitnessPanelProps {
  side:      'own' | 'opposing';
  witnesses: TrialWitness[];
  onChange:  (witnesses: TrialWitness[]) => void;
  role:      TrialRole;
}

function WitnessPanel({ side, witnesses, onChange, role }: WitnessPanelProps) {
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);

  const isOwn   = side === 'own';
  const accent  = isOwn ? '#1a5a30' : '#7a1a1a';
  const heading = isOwn ? 'Own Witnesses' : 'Opposing Witnesses';

  // Auto-suggest designation prefix based on role and side
  function nextDesignation(): string {
    const total = witnesses.length + 1;
    if (isOwn) {
      return role === 'prosecution_claimant' ? `PW${total}` : `DW${total}`;
    } else {
      return role === 'prosecution_claimant' ? `DW${total}` : `PW${total}`;
    }
  }

  function addWitness() {
    const w = blankWitness(side, witnesses.length + 1);
    w.designation = nextDesignation();
    const next = [...witnesses, w];
    onChange(next);
    setExpandedId(w.id);
  }

  function updateWitness(id: string, updated: TrialWitness) {
    onChange(witnesses.map(w => w.id === id ? updated : w));
  }

  function removeWitness(id: string) {
    const next = witnesses
      .filter(w => w.id !== id)
      .map((w, i) => ({ ...w, call_order: i + 1 }));
    onChange(next);
    if (expandedId === id) setExpandedId(null);
  }

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────
  function handleDragStart(idx: number) {
    setDragFromIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, _idx: number) {
    e.preventDefault();
  }

  function handleDrop(toIdx: number) {
    if (dragFromIdx === null || dragFromIdx === toIdx) return;
    const next = [...witnesses];
    const [moved] = next.splice(dragFromIdx, 1);
    next.splice(toIdx, 0, moved);
    // Update call_order to match new position
    onChange(next.map((w, i) => ({ ...w, call_order: i + 1 })));
    setDragFromIdx(null);
  }

  return (
    <div style={{
      border: `1px solid ${T.bdr}`,
      borderTop: `3px solid ${accent}`,
      borderRadius: 5, padding: '16px 16px 20px',
    }}>
      {/* Panel heading */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 13, color: accent, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, margin: 0 }}>
            {heading}
          </p>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: '2px 0 0' }}>
            {witnesses.length === 0
              ? 'No witnesses added yet'
              : `${witnesses.length} witness${witnesses.length !== 1 ? 'es' : ''} — drag ⠿ to reorder`}
          </p>
        </div>
        <button
          onClick={addWitness}
          style={{
            background: accent, border: 'none', color: '#ffffff',
            borderRadius: 4, padding: '7px 16px', fontSize: 12,
            cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, flexShrink: 0,
          }}
        >
          + Add Witness
        </button>
      </div>

      {/* Witness cards */}
      {witnesses.length === 0 ? (
        <div style={{
          padding: '20px 14px', textAlign: 'center',
          border: `1px dashed ${T.bdr}`, borderRadius: 4,
        }}>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: 0, fontStyle: 'italic' }}>
            {isOwn
              ? 'Add your witnesses to build the examination-in-chief plan.'
              : 'Add opposing witnesses and load their statements on oath for cross-examination.'}
          </p>
        </div>
      ) : (
        witnesses.map((w, i) => (
          <WitnessCard
            key={w.id}
            witness={w}
            index={i}
            total={witnesses.length}
            expanded={expandedId === w.id}
            onToggle={() => setExpandedId(expandedId === w.id ? null : w.id)}
            onChange={updated => updateWitness(w.id, updated)}
            onRemove={() => removeWitness(w.id)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))
      )}
    </div>
  );
}

// ── Witness Register Tab ──────────────────────────────────────────────────────

interface WitnessRegisterTabProps {
  activeCase: Case;
  role:       TrialRole;
}

export function WitnessRegisterTab({ activeCase, role }: WitnessRegisterTabProps) {
  const caseId = activeCase.id;

  const [ownWitnesses,      setOwnWitnesses]      = useState<TrialWitness[]>([]);
  const [opposingWitnesses, setOpposingWitnesses] = useState<TrialWitness[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [saving,            setSaving]            = useState(false);
  const [saveMsg,           setSaveMsg]           = useState('');
  const [error,             setError]             = useState('');

  // Load from storage on mount
  useEffect(() => {
    loadBlindSpot<WitnessStore>(caseId, WITNESS_STORE_KEY).then(stored => {
      if (stored) {
        setOwnWitnesses(stored.own ?? []);
        setOpposingWitnesses(stored.opposing ?? []);
      }
      setLoading(false);
    });
  }, [caseId]);

  async function saveAll() {
    setSaving(true);
    setError('');
    const ok = await saveBlindSpot(caseId, WITNESS_STORE_KEY, {
      own:      ownWitnesses,
      opposing: opposingWitnesses,
    });
    setSaving(false);
    if (ok) {
      setSaveMsg('Saved.');
      setTimeout(() => setSaveMsg(''), 3000);
    } else {
      setError('Save failed — please try again.');
    }
  }

  const totalWitnesses = ownWitnesses.length + opposingWitnesses.length;

  if (loading) {
    return (
      <div style={{ padding: 32, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13 }}>
        Loading witness register…
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, margin: 0 }}>
          Central witness database for this matter. All trial tabs — Examination-in-Chief,
          Cross-Examination, and Live Courtroom Mode — read from this register.
          Enter witness data once here; it flows everywhere.
          Drag <strong>⠿</strong> to set call order.
        </p>
      </div>

      {/* Two panels side by side on wide screens, stacked on narrow */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16,
        marginBottom: 20,
      }}>
        <WitnessPanel
          side="own"
          witnesses={ownWitnesses}
          onChange={setOwnWitnesses}
          role={role}
        />
        <WitnessPanel
          side="opposing"
          witnesses={opposingWitnesses}
          onChange={setOpposingWitnesses}
          role={role}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBlock message={error} onDismiss={() => setError('')} />
        </div>
      )}

      {/* Save bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        paddingTop: 16, borderTop: `1px solid ${T.bdrL}`,
      }}>
        <button
          onClick={saveAll}
          disabled={saving}
          style={{ ...S.btn, width: 'auto', marginTop: 0, padding: '9px 28px' }}
        >
          {saving ? 'Saving…' : 'Save Witness Register'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 12, color: '#2a6a3a', fontFamily: "'Times New Roman', Times, serif" }}>
            {saveMsg}
          </span>
        )}
        {totalWitnesses > 0 && (
          <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginLeft: 'auto' }}>
            {ownWitnesses.length} own · {opposingWitnesses.length} opposing
          </span>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6 — EXAMINATION-IN-CHIEF + WITNESS PREPARATION BUNDLE
// ─────────────────────────────────────────────────────────────────────────────

// ── Bundle storage schema ─────────────────────────────────────────────────────

interface ExamBundle {
  objective:          string;
  keyFacts:           string;
  weaknesses:         string;
  priorStatements:    string;
  exhibits:           string;
  sideA:              string;   // Counsel question script
  sideB:              string;   // Witness study pack
  sideC:              string;   // Anticipated cross prep
}

function emptyBundle(): ExamBundle {
  return {
    objective: '', keyFacts: '', weaknesses: '',
    priorStatements: '', exhibits: '',
    sideA: '', sideB: '', sideC: '',
  };
}

function bundleKey(witnessId: string): string {
  return `trial_chief_${witnessId}`;
}

// ── Print helper ──────────────────────────────────────────────────────────────

function printSide(
  caseName:    string,
  designation: string,
  sideLabel:   string,
  content:     string,
  confidential: boolean,
) {
  const win = window.open('', '_blank');
  if (!win) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${esc(sideLabel)} — ${esc(designation)}</title>
    <style>
      body{font-family:'Times New Roman',Times,serif;max-width:780px;margin:36px auto;
           line-height:1.85;color:#111;font-size:13px;}
      h1{font-size:17px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:6px;}
      .meta{font-size:11px;color:#555;margin-bottom:20px;}
      .conf{color:#8a1a1a;font-weight:700;letter-spacing:.12em;font-size:10px;
            border:2px solid #8a1a1a;padding:4px 12px;display:inline-block;margin-bottom:14px;
            text-transform:uppercase;}
      pre{white-space:pre-wrap;font-family:'Times New Roman',Times,serif;
          font-size:13px;line-height:1.85;margin:0;}
      @media print{body{margin:20mm;}}
    </style></head><body>
    ${confidential ? '<div class="conf">Confidential — Counsel Eyes Only — Not to be brought to Court</div>' : ''}
    <h1>${esc(sideLabel)}</h1>
    <div class="meta">${esc(caseName)} · ${esc(designation)}</div>
    <pre>${esc(content)}</pre>
    </body></html>`);
  win.document.close();
  win.print();
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif",
      fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
      marginTop: 22, marginBottom: 8, paddingBottom: 6,
      borderBottom: `1px solid ${T.bdrL}`,
    }}>
      {children}
    </p>
  );
}

// ── Output panel for a generated side ─────────────────────────────────────────

interface SidePanelProps {
  label:       string;
  content:     string;
  confidential?: boolean;
  onPrint:     () => void;
  loading:     boolean;
  disabled:    boolean;
  onGenerate:  () => void;
  generateLabel: string;
  hint:        string;
}

function SidePanel({
  label, content, confidential, onPrint,
  loading, disabled, onGenerate, generateLabel, hint,
}: SidePanelProps) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
        <div>
          <SectionLabel>{label}</SectionLabel>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: '4px 0 0', fontStyle: 'italic' }}>
            {hint}
          </p>
        </div>
        {content && (
          <button
            onClick={onPrint}
            style={{
              background: 'transparent', border: `1px solid ${T.bdr}`,
              color: T.dim, borderRadius: 4, padding: '6px 14px',
              fontSize: 11, cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
              flexShrink: 0, marginLeft: 12,
            }}
          >
            {confidential ? '⎙ Print (Confidential)' : '⎙ Print'}
          </button>
        )}
      </div>

      <button
        onClick={onGenerate}
        disabled={loading || disabled}
        style={disabled || loading ? { ...S.btnOff, marginTop: 0 } : { ...S.btn, marginTop: 0, width: 'auto', padding: '9px 22px' }}
      >
        {loading ? `Generating ${label}…` : generateLabel}
      </button>

      {content && (
        <div style={{
          marginTop: 14,
          background: confidential ? '#fdfaf5' : '#fafaf8',
          border: confidential ? '1px solid #e0c888' : `1px solid ${T.bdr}`,
          borderRadius: 5, padding: '14px 18px',
          maxHeight: 520, overflowY: 'auto',
        }}>
          {confidential && (
            <p style={{
              fontSize: 9, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
              marginBottom: 10, marginTop: 0,
            }}>
              Confidential — For Witness Preparation Only — Not to be brought to Court
            </p>
          )}
          <pre style={{
            whiteSpace: 'pre-wrap', fontFamily: "'Times New Roman', Times, serif",
            fontSize: 13, lineHeight: 1.85, color: T.text, margin: 0,
          }}>
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── ExamInChiefTab ─────────────────────────────────────────────────────────────

interface ExamInChiefTabProps {
  activeCase: Case;
  role:       TrialRole;
}

function ExamInChiefTab({ activeCase, role }: ExamInChiefTabProps) {
  const caseId = activeCase.id;
  const ai     = useAI(activeCase);
  const { theory, hasTheory } = useCaseTheory(caseId);

  // Witness list (own witnesses only)
  const [ownWitnesses, setOwnWitnesses] = useState<TrialWitness[]>([]);
  const [loadingWitnesses, setLoadingWitnesses] = useState(true);

  // Selected witness
  const [selectedId, setSelectedId] = useState<string>('');

  // Bundle inputs
  const [objective,       setObjective]       = useState('');
  const [keyFacts,        setKeyFacts]        = useState('');
  const [weaknesses,      setWeaknesses]      = useState('');
  const [priorStatements, setPriorStatements] = useState('');
  const [exhibits,        setExhibits]        = useState('');

  // Generated sides
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [sideC, setSideC] = useState('');

  // Loading states
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [loadingC, setLoadingC] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const [error,   setError]   = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  // Load own witnesses from register
  useEffect(() => {
    loadBlindSpot<WitnessStore>(caseId, WITNESS_STORE_KEY).then(stored => {
      setOwnWitnesses(stored?.own ?? []);
      setLoadingWitnesses(false);
    });
  }, [caseId]);

  // When witness selected: pre-fill inputs + load saved bundle
  const selectedWitness = ownWitnesses.find(w => w.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId || !selectedWitness) return;

    // Pre-fill from witness profile
    setExhibits(selectedWitness.exhibit_list ?? '');
    setWeaknesses(selectedWitness.coaching_notes ?? '');

    // Load any previously saved bundle
    loadBlindSpot<ExamBundle>(caseId, bundleKey(selectedId)).then(saved => {
      if (saved) {
        setObjective(saved.objective ?? '');
        setKeyFacts(saved.keyFacts ?? '');
        setWeaknesses(saved.weaknesses ?? selectedWitness.coaching_notes ?? '');
        setPriorStatements(saved.priorStatements ?? '');
        setExhibits(saved.exhibits ?? selectedWitness.exhibit_list ?? '');
        setSideA(saved.sideA ?? '');
        setSideB(saved.sideB ?? '');
        setSideC(saved.sideC ?? '');
      } else {
        // Fresh witness — reset generated sides
        setSideA(''); setSideB(''); setSideC('');
        setObjective(''); setKeyFacts('');
        setPriorStatements('');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Theory string for AI injection ──────────────────────────────────────────
  function theoryBlock(): string {
    if (!theory) return 'No locked Case Theory — proceed without theory context.';
    return [
      `Core Proposition: ${theory.core_proposition}`,
      `Elements to establish: ${theory.elements.map(e => e.element).join(' | ')}`,
      `Narrative Theme: ${theory.narrative_theme}`,
      `Weakest Link: ${theory.weakest_link}`,
    ].join('\n');
  }

  // ── 6D — Generate Side A ────────────────────────────────────────────────────

  async function generateSideA() {
    if (!selectedWitness) return;
    setLoadingA(true); setError('');
    const result = await ai.ask({
      system: `You are a Nigerian senior counsel preparing examination-in-chief.
Evidence Act 2011 s.221: questions in examination-in-chief must be non-leading.
Every question must serve the locked Case Theory or establish foundation for a question that does.
Build the case brick by brick toward the core proposition.
Structure output EXACTLY as shown — three titled sections with numbered questions.`,

      userMsg: `LOCKED CASE THEORY:
${theoryBlock()}

WITNESS PROFILE:
Name: ${selectedWitness.name} | Designation: ${selectedWitness.designation}
Role: ${selectedWitness.role_in_case}
Expected testimony: ${selectedWitness.expected_testimony}
Strengths: ${selectedWitness.strengths}

EXAMINATION OBJECTIVE:
${objective || 'Not specified — use witness profile and theory to determine.'}

KEY FACTS THIS WITNESS WILL PROVE:
${keyFacts || 'Not specified.'}

EXHIBITS THIS WITNESS INTRODUCES:
${exhibits || 'None listed.'}

KNOWN WEAKNESSES (opposing counsel will probe these):
${weaknesses || 'None noted.'}

PRIOR STATEMENTS (testimony must be consistent with these):
${priorStatements || 'None noted.'}

Generate the full examination-in-chief question script in this exact format:

FOUNDATION QUESTIONS
(Establish identity, relationship to case, credibility, basis of knowledge)

Q1. [Question]
    Purpose: [counsel-only note — what this establishes]

Q2. [Question]
    Purpose: [note]

EVIDENCE QUESTIONS
(Elicit the core testimony in logical progression)

Q[N]. [Question]
     Purpose: [note]

THEORY ANCHORING QUESTIONS
(Directly establish the Case Theory elements — map each to a specific element)

Q[N]. [Question]
     Theory element: [which CaseTheory element this advances]
     Purpose: [note]`,
    });
    setLoadingA(false);
    if (result) setSideA(result);
    else setError('Side A generation failed. Check connection and retry.');
  }

  // ── 6E — Generate Side B ────────────────────────────────────────────────────

  async function generateSideB() {
    if (!selectedWitness || !sideA) return;
    setLoadingB(true); setError('');
    const result = await ai.ask({
      system: `You are a Nigerian senior counsel preparing a witness for trial.
Generate a witness study pack. For every question in the examination-in-chief script,
produce: the question, a verbatim ideal answer, a plain English note explaining why
that answer matters, and a specific do-not-say note about what to avoid in that answer.
The witness takes this document home. Write the ideal answers in first person.
Plain English — no legal jargon in the witness-facing content.
Clearly mark each question block.`,

      userMsg: `WITNESS: ${selectedWitness.name} (${selectedWitness.designation})
CASE: ${activeCase.caseName}
EXAMINATION OBJECTIVE: ${objective}

EXAMINATION-IN-CHIEF SCRIPT (Side A):
${sideA}

Generate the full witness study pack in this format for EVERY question:

─────────────────────────────────────
Q[number]: [The question]

IDEAL ANSWER:
[Verbatim suggested answer in first person — the exact words that give the best evidence]

WHY THIS MATTERS:
[One or two sentences in plain English — what this answer establishes for our case]

DO NOT SAY:
[Specific trap for this question — what answer would hurt us and why]
─────────────────────────────────────`,
    });
    setLoadingB(false);
    if (result) setSideB(result);
    else setError('Side B generation failed.');
  }

  // ── 6F — Generate Side C ────────────────────────────────────────────────────

  async function generateSideC() {
    if (!selectedWitness || !sideA) return;
    setLoadingC(true); setError('');
    const result = await ai.ask({
      system: `You are opposing counsel — aggressive, methodical, expert in Nigerian evidence law.
You have just read this witness's examination-in-chief. Your goal is to identify and
exploit every vulnerability. You know the Evidence Act 2011 inside out.
Generate the most damaging cross-examination questions possible.
Then produce a vulnerability map.
Be specific. Rate danger HIGH / MEDIUM / LOW.`,

      userMsg: `WITNESS: ${selectedWitness.name} (${selectedWitness.designation})
ROLE: ${selectedWitness.role_in_case}

WHAT THIS WITNESS WILL SAY IN CHIEF:
${sideA}

WITNESS KNOWN WEAKNESSES (from file):
${weaknesses || 'None disclosed.'}

PRIOR STATEMENTS (consistency risk):
${priorStatements || 'None disclosed.'}

CASE THEORY WE ARE DEFENDING AGAINST (opposing side's theory to attack):
${theoryBlock()}

Generate the anticipated cross-examination in this format:

TOP 10 MOST DAMAGING CROSS-EXAMINATION QUESTIONS

Q1. [The question opposing counsel will ask]
Danger Rating: HIGH / MEDIUM / LOW
Why dangerous: [What this question is trying to destroy]
Coached response: [Exactly how the witness should answer to survive this]
What NOT to do: [The answer that would damage our case]

Q2. [Continue for all 10]

─────────────────────────────────────
WITNESS VULNERABILITY MAP

Three core weaknesses opposing counsel will probe:

1. [Weakness] → Defensive posture
2. [Weakness] → Defensive posture
3. [Weakness] → Defensive posture`,
    });
    setLoadingC(false);
    if (result) setSideC(result);
    else setError('Side C generation failed.');
  }

  // ── Save bundle ──────────────────────────────────────────────────────────────

  async function saveBundle() {
    if (!selectedId) return;
    setSaving(true);
    const bundle: ExamBundle = {
      objective, keyFacts, weaknesses, priorStatements, exhibits,
      sideA, sideB, sideC,
    };
    const ok = await saveBlindSpot(caseId, bundleKey(selectedId), bundle);
    setSaving(false);
    if (ok) { setSaveMsg('Bundle saved.'); setTimeout(() => setSaveMsg(''), 3000); }
    else setError('Save failed.');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loadingWitnesses) {
    return <div style={{ padding: 32, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13 }}>Loading witnesses…</div>;
  }

  const noWitnesses = ownWitnesses.length === 0;
  const noTheoryWarn = !hasTheory;

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* Warnings */}
      {noWitnesses && (
        <div style={{ padding: '14px 18px', background: '#fff8f0', border: '1px solid #e0b888', borderRadius: 5, marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            No own witnesses in the register. Add witnesses in the <strong>Witness Register</strong> tab first.
          </p>
        </div>
      )}
      {noTheoryWarn && !noWitnesses && (
        <div style={{ padding: '12px 16px', background: '#fdf6e8', border: '1px solid #e0cfa0', borderRadius: 5, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            Case Theory not locked — generated questions will not be theory-anchored. Lock theory in the Case Theory Brief tab for best results.
          </p>
        </div>
      )}

      {/* 6A — Witness selector */}
      <SectionLabel>A — Select Witness</SectionLabel>
      {noWitnesses ? (
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
          Add own witnesses to the register to begin.
        </p>
      ) : (
        <select
          style={{ ...S.sel, maxWidth: 420 }}
          value={selectedId}
          onChange={e => {
            setSelectedId(e.target.value);
            setSideA(''); setSideB(''); setSideC('');
          }}
        >
          <option value="">— Select a witness —</option>
          {ownWitnesses.map(w => (
            <option key={w.id} value={w.id}>
              {w.designation ? `${w.designation} — ` : ''}{w.name || 'Unnamed'} ({w.role_in_case || 'role not set'})
            </option>
          ))}
        </select>
      )}

      {/* Witness profile summary */}
      {selectedWitness && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: '#f7f9fd', border: '1px solid #b8cfe8', borderRadius: 5,
        }}>
          <p style={{ fontSize: 11, color: '#1a3a6a', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            <strong>{selectedWitness.designation}</strong> · {selectedWitness.name} · {selectedWitness.role_in_case} ·{' '}
            Status: <strong>{selectedWitness.status}</strong>
            {selectedWitness.expected_testimony && ` · ${selectedWitness.expected_testimony.slice(0, 80)}${selectedWitness.expected_testimony.length > 80 ? '…' : ''}`}
          </p>
        </div>
      )}

      {selectedWitness && (
        <>
          {/* 6B — Examination objective */}
          <div style={{ marginTop: 20 }}>
            <SectionLabel>B — Examination Objective</SectionLabel>
            <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: '0 0 8px', fontStyle: 'italic' }}>
              What must this witness establish to advance the Case Theory? This anchors every question.
            </p>
            <textarea
              style={{ ...S.ta, minHeight: 70 }}
              value={objective}
              onChange={e => setObjective(e.target.value)}
              placeholder="e.g. DW2 must establish that the Accused was at the Ariaria Market, Aba, at 14:30 on 3 May 2025 — the precise time PW2 claims to have seen him at the scene of the offence."
            />
          </div>

          {/* 6C — Additional inputs */}
          <div style={{ marginTop: 6 }}>
            <SectionLabel>C — Additional Inputs</SectionLabel>

            <label style={S.label}>Key Facts This Witness Will Prove</label>
            <textarea
              style={{ ...S.ta, minHeight: 80, marginBottom: 12 }}
              value={keyFacts}
              onChange={e => setKeyFacts(e.target.value)}
              placeholder="List the specific factual propositions this witness will establish in evidence…"
            />

            <label style={S.label}>Known Weaknesses (Opposing Counsel Will Probe These)</label>
            <textarea
              style={{ ...S.ta, minHeight: 70, marginBottom: 12 }}
              value={weaknesses}
              onChange={e => setWeaknesses(e.target.value)}
              placeholder="Prior relationship with accused, discrepancy with earlier statement, limited line of sight…"
            />

            <label style={S.label}>Prior Statements (Testimony Must Be Consistent With These)</label>
            <textarea
              style={{ ...S.ta, minHeight: 60, marginBottom: 12 }}
              value={priorStatements}
              onChange={e => setPriorStatements(e.target.value)}
              placeholder="Statement to police 4 May 2025, proof of evidence dated 10 June 2025…"
            />

            <label style={S.label}>Exhibits This Witness Introduces</label>
            <textarea
              style={{ ...S.ta, minHeight: 50 }}
              value={exhibits}
              onChange={e => setExhibits(e.target.value)}
              placeholder="Pre-populated from Witness Register — edit if needed…"
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{ marginTop: 14 }}>
              <ErrorBlock message={error} onDismiss={() => setError('')} />
            </div>
          )}

          {/* 6D — Side A */}
          <SidePanel
            label="Side A — Counsel's Examination-in-Chief Script"
            content={sideA}
            onPrint={() => printSide(activeCase.caseName, selectedWitness.designation || selectedWitness.name, "Side A — Counsel's Examination-in-Chief Script", sideA, false)}
            loading={loadingA}
            disabled={!objective.trim() && !keyFacts.trim()}
            onGenerate={generateSideA}
            generateLabel="Generate Side A — Counsel Script"
            hint="Numbered questions in three tiers: Foundation · Evidence · Theory Anchoring. Purpose notes visible to counsel only."
          />

          {/* 6E — Side B */}
          <SidePanel
            label="Side B — Witness Study Pack"
            content={sideB}
            confidential
            onPrint={() => printSide(activeCase.caseName, selectedWitness.designation || selectedWitness.name, 'Side B — Witness Study Pack', sideB, true)}
            loading={loadingB}
            disabled={!sideA}
            onGenerate={generateSideB}
            generateLabel={sideA ? 'Generate Side B — Witness Study Pack' : 'Generate Side A first'}
            hint="For every question: ideal answer in the witness's own words · why it matters (plain English) · specific do-not-say note. Witness takes this home."
          />

          {/* 6F — Side C */}
          <SidePanel
            label="Side C — Anticipated Cross-Examination"
            content={sideC}
            confidential
            onPrint={() => printSide(activeCase.caseName, selectedWitness.designation || selectedWitness.name, 'Side C — Anticipated Cross-Examination Preparation', sideC, true)}
            loading={loadingC}
            disabled={!sideA}
            onGenerate={generateSideC}
            generateLabel={sideA ? 'Generate Side C — Anticipated Cross' : 'Generate Side A first'}
            hint="AI switches role to opposing counsel. Top 10 most damaging questions · danger ratings · coached responses · witness vulnerability map."
          />

          {/* 6G — Save */}
          {(sideA || sideB || sideC) && (
            <div style={{
              marginTop: 28, paddingTop: 16, borderTop: `1px solid ${T.bdrL}`,
              display: 'flex', gap: 14, alignItems: 'center',
            }}>
              <button
                onClick={saveBundle}
                disabled={saving}
                style={{ ...S.btn, width: 'auto', marginTop: 0, padding: '9px 24px' }}
              >
                {saving ? 'Saving…' : '↓ Save Bundle'}
              </button>
              {saveMsg && (
                <span style={{ fontSize: 12, color: '#2a6a3a', fontFamily: "'Times New Roman', Times, serif" }}>
                  {saveMsg}
                </span>
              )}
              <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginLeft: 'auto' }}>
                Saved per witness under trial_chief_{'{witnessId}'}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7 — CROSS-EXAMINATION: STATEMENT AUDIT + THEORY-BREACH QUESTION GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

// ── Bundle storage schema ─────────────────────────────────────────────────────

interface CrossExamBundle {
  statementText: string;   // local paste — only persisted when Witness Register has no statement
  audit:         string;   // 7A — Statement Audit output
  questions:     string;   // 7B — Theory-Breach Question Bank output
}

function crossBundleKey(witnessId: string): string {
  return `trial_cross_${witnessId}`;
}

// ── Line-numbered statement viewer (7A) ────────────────────────────────────────

function LineNumberedStatement({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div style={{
      background: '#fafaf8', border: `1px solid ${T.bdr}`, borderRadius: 5,
      padding: '12px 14px', maxHeight: 320, overflowY: 'auto',
      fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
    }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex' }}>
          <span style={{
            width: 32, textAlign: 'right', marginRight: 12,
            color: T.mute, flexShrink: 0, userSelect: 'none',
          }}>
            {i + 1}
          </span>
          <span style={{ whiteSpace: 'pre-wrap', color: T.text, flex: 1 }}>
            {line || '\u00A0'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── CrossExaminationTab ──────────────────────────────────────────────────────

interface CrossExaminationTabProps {
  activeCase: Case;
  role:       TrialRole;
}

function CrossExaminationTab({ activeCase, role: _role }: CrossExaminationTabProps) {
  const caseId = activeCase.id;
  const ai     = useAI(activeCase);
  const { fullContext } = useIntelligence(activeCase);
  const { theory, hasTheory } = useCaseTheory(caseId);

  // Opposing witnesses (from Witness Register)
  const [opposingWitnesses, setOpposingWitnesses] = useState<TrialWitness[]>([]);
  const [loadingWitnesses,  setLoadingWitnesses]  = useState(true);

  // Selected witness
  const [selectedId, setSelectedId] = useState('');

  // Local paste fallback — only used when the register has no statement
  const [localStatement, setLocalStatement] = useState('');

  // Generated outputs
  const [audit,     setAudit]     = useState('');
  const [questions, setQuestions] = useState('');

  // Loading / save state
  const [loadingAudit,     setLoadingAudit]     = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [saveMsg,          setSaveMsg]          = useState('');
  const [error,            setError]            = useState('');

  // Load opposing witnesses from register
  useEffect(() => {
    loadBlindSpot<WitnessStore>(caseId, WITNESS_STORE_KEY).then(stored => {
      setOpposingWitnesses(stored?.opposing ?? []);
      setLoadingWitnesses(false);
    });
  }, [caseId]);

  const selectedWitness = opposingWitnesses.find(w => w.id === selectedId) ?? null;

  // When witness selected: load any previously saved bundle
  useEffect(() => {
    if (!selectedId) return;
    loadBlindSpot<CrossExamBundle>(caseId, crossBundleKey(selectedId)).then(saved => {
      setLocalStatement(saved?.statementText ?? '');
      setAudit(saved?.audit ?? '');
      setQuestions(saved?.questions ?? '');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 7A — the statement that drives everything: registry first, local paste as fallback
  const registryStatement = (selectedWitness?.statement_text ?? '').trim();
  const effectiveStatement = registryStatement || localStatement;

  // ── Theory string for AI injection ──────────────────────────────────────────
  function theoryBlock(): string {
    if (!theory) return 'No locked Case Theory — proceed without theory context.';
    return [
      `Core Proposition: ${theory.core_proposition}`,
      `Elements to establish: ${theory.elements.map(e => `${e.element} (authority: ${e.authority || 'n/a'})`).join(' | ')}`,
      `Opposing Theory: ${theory.opposing_theory}`,
      `Theory Killer: ${theory.theory_killer}`,
      `Weakest Link: ${theory.weakest_link}`,
    ].join('\n');
  }

  // ── 7A — Audit Statement ─────────────────────────────────────────────────────

  async function auditStatement() {
    if (!selectedWitness || !effectiveStatement.trim()) return;
    setLoadingAudit(true); setError('');
    const result = await ai.ask({
      system: `You are a Nigerian senior counsel conducting a forensic audit of an opposing witness's statement on oath, in preparation for cross-examination.
Read with suspicion — every sentence may conceal more than it reveals.
Be precise and specific. Quote or reference exact wording where it matters.
Structure output EXACTLY as instructed — five titled sections.`,

      userMsg: `CASE: ${activeCase.caseName} | COURT: ${activeCase.court || 'Not specified'}

CASE INTELLIGENCE CONTEXT:
${fullContext || 'No intelligence package recorded.'}

WITNESS: ${selectedWitness.name} (${selectedWitness.designation})
ROLE IN CASE: ${selectedWitness.role_in_case}
KNOWN VULNERABILITIES (Witness Register): ${selectedWitness.vulnerabilities || 'None noted.'}

FULL STATEMENT ON OATH:
${effectiveStatement}

Produce a structured Statement Audit in this exact format:

CLAIMS MADE
Numbered list of every material factual claim the statement makes.

INTERNAL CONTRADICTIONS
Contradictions within the statement itself — between paragraphs, dates, sequences, or figures. Reference the conflicting parts directly. If none, state "None identified."

CONTRADICTIONS WITH KNOWN CASE FACTS
Contradictions between this statement and the established facts / intelligence on this case. If none, state "None identified."

WHAT THE STATEMENT CONSPICUOUSLY AVOIDS SAYING
Gaps, omissions, and evasions — what a complete and honest account would have addressed but this one does not.

STRATEGIC PURPOSE OF THE STATEMENT
What is this witness's statement trying to establish for the other side? What function does it serve in their case theory?`,
    });
    setLoadingAudit(false);
    if (result) setAudit(result);
    else setError('Statement audit failed. Check connection and retry.');
  }

  // ── 7B — Theory-Breach Question Generator ────────────────────────────────────

  async function generateCrossExamination() {
    if (!selectedWitness || !audit) return;
    setLoadingQuestions(true); setError('');
    const result = await ai.ask({
      system: `You are a Nigerian senior trial advocate preparing the cross-examination of an opposing witness.
Apply the Evidence Act 2011 throughout.
Every question must serve a specific tactical purpose: destroying the opposing case theory,
shaking credibility, excluding inadmissible evidence, or locking in a helpful admission.
Be surgical and exact — write the precise question text counsel will read aloud in court.
Structure output EXACTLY as instructed — four numbered tiers.`,

      userMsg: `LOCKED CASE THEORY:
${theoryBlock()}

WITNESS: ${selectedWitness.name} (${selectedWitness.designation})
ROLE IN CASE: ${selectedWitness.role_in_case}
KNOWN VULNERABILITIES (Witness Register): ${selectedWitness.vulnerabilities || 'None noted.'}

STATEMENT AUDIT:
${audit}

CASE INTELLIGENCE CONTEXT:
${fullContext || 'No intelligence package recorded.'}

Generate the cross-examination question bank in this exact format:

TIER 1 — THEORY DESTROYERS
Questions that directly undermine the opposing case theory or advance ours.
Q1. [Exact question text] → Purpose: [what this destroys or advances]

TIER 2 — CREDIBILITY SHAKERS
Contradiction exploitation, prior inconsistent statements, motive to lie.
Q[N]. [Exact question text] → Contradiction exploited: [which one, from the audit]

TIER 3 — EVIDENCE EXCLUSION
Admissibility attacks — hearsay, lack of foundation, secondary evidence rule.
Q[N]. [Exact question text] → Evidence Act provision invoked: [section]

TIER 4 — CLEANUP
Securing admissions that help our case; locking the witness into positions.
Q[N]. [Exact question text] → Admission secured: [what it locks in]`,
    });
    setLoadingQuestions(false);
    if (result) setQuestions(result);
    else setError('Cross-examination question generation failed.');
  }

  // ── Save bundle ──────────────────────────────────────────────────────────────

  async function saveBundle() {
    if (!selectedId) return;
    setSaving(true);
    const bundle: CrossExamBundle = {
      statementText: registryStatement ? '' : localStatement,
      audit, questions,
    };
    const ok = await saveBlindSpot(caseId, crossBundleKey(selectedId), bundle);
    setSaving(false);
    if (ok) { setSaveMsg('Saved.'); setTimeout(() => setSaveMsg(''), 3000); }
    else setError('Save failed.');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loadingWitnesses) {
    return <div style={{ padding: 32, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13 }}>Loading witnesses…</div>;
  }

  const noWitnesses = opposingWitnesses.length === 0;

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* Warnings */}
      {noWitnesses && (
        <div style={{ padding: '14px 18px', background: '#fff8f0', border: '1px solid #e0b888', borderRadius: 5, marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            No opposing witnesses in the register. Add them in the <strong>Witness Register</strong> tab first.
          </p>
        </div>
      )}
      {!hasTheory && !noWitnesses && (
        <div style={{ padding: '12px 16px', background: '#fdf6e8', border: '1px solid #e0cfa0', borderRadius: 5, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#7a4a00', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            Case Theory not locked — generated questions will not be theory-anchored. Lock theory in the Case Theory Brief tab for best results.
          </p>
        </div>
      )}

      {/* 7A — Witness selector */}
      <SectionLabel>A — Select Opposing Witness</SectionLabel>
      {noWitnesses ? (
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
          Add opposing witnesses to the register to begin.
        </p>
      ) : (
        <select
          style={{ ...S.sel, maxWidth: 420 }}
          value={selectedId}
          onChange={e => {
            setSelectedId(e.target.value);
            setAudit(''); setQuestions(''); setLocalStatement(''); setError('');
          }}
        >
          <option value="">— Select an opposing witness —</option>
          {opposingWitnesses.map(w => (
            <option key={w.id} value={w.id}>
              {w.designation ? `${w.designation} — ` : ''}{w.name || 'Unnamed'} ({w.role_in_case || 'role not set'})
            </option>
          ))}
        </select>
      )}

      {/* Witness profile summary */}
      {selectedWitness && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: '#f7f9fd', border: '1px solid #b8cfe8', borderRadius: 5,
        }}>
          <p style={{ fontSize: 11, color: '#1a3a6a', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            <strong>{selectedWitness.designation}</strong> · {selectedWitness.name} · {selectedWitness.role_in_case} ·{' '}
            Status: <strong>{selectedWitness.status}</strong>
            {selectedWitness.vulnerabilities && ` · Vulnerabilities: ${selectedWitness.vulnerabilities.slice(0, 70)}${selectedWitness.vulnerabilities.length > 70 ? '…' : ''}`}
          </p>
        </div>
      )}

      {selectedWitness && (
        <>
          {/* Witness Statement Importer */}
          <div style={{ marginTop: 20 }}>
            <SectionLabel>Witness Statement on Oath</SectionLabel>
            {registryStatement ? (
              <>
                <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: '0 0 8px', fontStyle: 'italic' }}>
                  Loaded from the Witness Register. Edit it there if it needs to change.
                </p>
                <LineNumberedStatement text={registryStatement} />
              </>
            ) : (
              <>
                <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: '0 0 8px', fontStyle: 'italic' }}>
                  No statement on oath loaded in the Witness Register for this witness. Paste it here — or notes of expected evidence if the formal statement has not yet been served.
                </p>
                <textarea
                  style={{ ...S.ta, minHeight: 180, fontFamily: 'monospace', fontSize: 12 }}
                  value={localStatement}
                  onChange={e => setLocalStatement(e.target.value)}
                  placeholder="Paste the witness statement on oath, or notes of expected evidence…"
                />
                {localStatement.trim() && (
                  <div style={{ marginTop: 10 }}>
                    <LineNumberedStatement text={localStatement} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ marginTop: 14 }}>
              <ErrorBlock message={error} onDismiss={() => setError('')} />
            </div>
          )}

          {/* 7A — Statement Audit */}
          <SidePanel
            label="Statement Audit"
            content={audit}
            onPrint={() => printSide(activeCase.caseName, selectedWitness.designation || selectedWitness.name, 'Statement Audit', audit, false)}
            loading={loadingAudit}
            disabled={!effectiveStatement.trim()}
            onGenerate={auditStatement}
            generateLabel="Audit Statement"
            hint="Claims made · internal contradictions · contradictions with case intelligence · conspicuous omissions · the statement's strategic purpose."
          />

          {/* 7B — Theory-Breach Question Generator */}
          <SidePanel
            label="Theory-Breach Question Bank"
            content={questions}
            onPrint={() => printSide(activeCase.caseName, selectedWitness.designation || selectedWitness.name, 'Cross-Examination — Theory-Breach Question Bank', questions, false)}
            loading={loadingQuestions}
            disabled={!audit}
            onGenerate={generateCrossExamination}
            generateLabel={audit ? 'Generate Cross-Examination' : 'Audit the statement first'}
            hint="Four tiers: Theory Destroyers · Credibility Shakers · Evidence Exclusion · Cleanup."
          />

          {/* Save */}
          {(audit || questions || localStatement.trim()) && (
            <div style={{
              marginTop: 28, paddingTop: 16, borderTop: `1px solid ${T.bdrL}`,
              display: 'flex', gap: 14, alignItems: 'center',
            }}>
              <button
                onClick={saveBundle}
                disabled={saving}
                style={{ ...S.btn, width: 'auto', marginTop: 0, padding: '9px 24px' }}
              >
                {saving ? 'Saving…' : '↓ Save'}
              </button>
              {saveMsg && (
                <span style={{ fontSize: 12, color: '#2a6a3a', fontFamily: "'Times New Roman', Times, serif" }}>
                  {saveMsg}
                </span>
              )}
              <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginLeft: 'auto' }}>
                Saved per witness under trial_cross_{'{witnessId}'}
              </span>
            </div>
          )}
        </>
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
      return (
        <WitnessRegisterTab
          activeCase={activeCase}
          role={role}
        />
      );
    case 'exam_in_chief':
      return (
        <ExamInChiefTab
          activeCase={activeCase}
          role={role}
        />
      );
    case 'cross_examination':
      return (
        <CrossExaminationTab
          activeCase={activeCase}
          role={role}
        />
      );
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
