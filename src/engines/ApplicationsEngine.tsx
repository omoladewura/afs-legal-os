/**
 * AFS Legal OS V2 — Applications Engine (Phase 1 Rebuild)
 *
 * Universal applications drafter. Available to all four roles across
 * civil and criminal matters. Five-stage linear workflow:
 *
 *   Stage 1 — Application Type     : Quick-fill type picker (civil/criminal/appeal)
 *   Stage 2 — Application Facts    : Parties, relief, grounds, affidavit facts
 *   Stage 3 — Argument Builder     : Issue-by-issue IRAC → Written Address + Reply sub-tab
 *   Stage 4 — Assemble Package     : One AI call builds full document package
 *   Stage 5 — Applications Tracker : Status log for every application in the matter
 *
 * Statute RAG fires automatically at Stage 3. Intelligence context injected throughout.
 * Storage: saveBlindSpot `applications_v2_${caseId}` + `app_tracker_${caseId}`.
 * Worker D1: PUT /application | GET /applications?caseId=x | DELETE /application?id=x
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
import { Md, ErrorBlock, TypeDeleteModal } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS, MATTER_TRACK_COLORS } from '@/types';
import {
  queryStatutes,
  formatStatutesForPrompt,
  buildRagQuery,
  isRagConfigured,
  type StatuteChunk,
} from '@/services/statuteRag';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type MainTab         = 'new' | 'tracker';
type Stage           = 1 | 2 | 3 | 4 | 5;
type TrackFilter     = 'all' | 'civil' | 'criminal' | 'appeal';
type AppStatus       = 'Drafting' | 'Filed' | 'Served' | 'Awaiting Hearing' | 'Heard' | 'Granted' | 'Refused' | 'Withdrawn';
type ApplicationRole = 'mover' | 'respondent';

// Mover track sub-tabs
type MoverSubTab = 'written_address' | 'opposing_response' | 'further_better' | 'reply_law';
// Respondent track sub-tabs
type RespondentSubTab = 'counter_affidavit' | 'written_address_opp' | 'further_better_resp';

export interface AppTypeConfig {
  id:      string;
  label:   string;
  icon:    string;
  track:   'civil' | 'criminal' | 'appeal' | 'all';
  package: string[];
  hint:    string;
  /**
   * Trial Engine Consolidation, Phase 1 — Decision 1.
   *
   * Whether a locked Case Theory is injected into this appType's draft
   * calls (Phase 9 wires the actual injection; this flag is set here so
   * the catalogue carries it from the start).
   *
   *   true  + locked theory exists → theory is injected
   *   true  + no locked theory     → soft warning shown, drafting proceeds
   *   false                        → never injected, regardless of theory state
   *
   * These are defaults from the build plan's Decision 1 table. Counsel can
   * override per session in the engine UI (Phase 9). Provisional defaults
   * applied here, extending the plan's explicit table to every current
   * catalogue entry:
   *   - Generic notice/ex-parte/opposition motions are vehicles, not
   *     inherently theory-bearing → false.
   *   - Injunctions (interim & interlocutory) → true, per the plan.
   *   - Bail, Extension of Time, Stay (civil/criminal/appeal), Default
   *     Judgment, Substituted Service, Security for Costs, Preliminary
   *     Objection, Quash Charge, Regularise Records → false — procedural/
   *     technical applications argued on their own discrete test, not on
   *     the merits theory of the case.
   *   - Summary Judgment and Strike Out → true — both turn on whether the
   *     pleaded/evidenced case discloses a sustainable claim or defence,
   *     i.e. they engage the case theory's elements directly.
   */
  needsCaseTheory: boolean;
}

interface ArgumentIssue {
  id:          string;
  issue:       string;
  rule:        string;
  application: string;
  conclusion:  string;
  draft:       string;
}

// Paragraph-level response entry for counter-affidavit drafting
interface AffidavitParaResponse {
  id:        string;
  paraNum:   string;   // paragraph number(s) in the other affidavit
  paraText:  string;   // what that paragraph says
  stance:    'admit' | 'deny' | 'not_known';
  response:  string;   // counsel's own facts in response (if denying / new facts)
}

// Further & Better Affidavit ground
interface FBGround {
  id:        string;
  basis:     'own_affidavit' | 'counter_affidavit';
  paraRef:   string;   // paragraph(s) in the referenced affidavit
  paraText:  string;   // what those paragraphs say
  newFact:   string;   // the new fact / exhibit being introduced
  exhibit:   string;   // exhibit label e.g. "Exhibit C"
}

interface AppFacts {
  parties:           string;
  reliefSought:      string;
  grounds:           string;
  deponent:          string;
  keyFacts:          string;
  additionalContext: string;
}

// Everything generated in Stage 3 — persisted with the record
interface Stage3Data {
  applicationRole:     ApplicationRole | null;
  // Mover track
  issues:              ArgumentIssue[];
  writtenAddress:      string;
  opposingFiled:       boolean;
  counterAffidavitIn:  string;   // paste of opposing counter-affidavit
  writtenAddressIn:    string;   // paste of opposing written address
  fbGrounds:           FBGround[];
  furtherBetterDraft:  string;
  replyLawPoints:      string;   // counsel's input: which legal points to rebut
  replyLawDraft:       string;
  // Respondent track
  applicantAffidavit:  string;   // paste of applicant's supporting affidavit
  paraResponses:       AffidavitParaResponse[];
  respondentNewFacts:  string;
  respondentDeponent:  string;
  respondentExhibits:  string;
  counterAffidavitDraft: string;
  respIssues:          ArgumentIssue[];
  writtenAddressOpp:   string;
  respOpposingFiled:   boolean;
  respFBGrounds:       FBGround[];
  respFBDraft:         string;
}

interface ApplicationRecord {
  id:        string;
  caseId:    string;
  appType:   string;
  facts:     AppFacts;
  stage3:    Stage3Data;
  documents: string;
  createdAt: string;
}

interface TrackerEntry {
  id:          string;
  appType:     string;
  filedDate:   string;
  hearingDate: string;
  status:      AppStatus;
  ruling:      string;
  notes:       string;
}

interface SavedData    { history: ApplicationRecord[]; }
interface TrackerData  { entries: TrackerEntry[]; }

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION TYPE CATALOGUE
// ─────────────────────────────────────────────────────────────────────────────

export const APP_TYPES: AppTypeConfig[] = [
  // Civil
  { id: 'civil_motion_on_notice', label: 'Motion on Notice', icon: '📋', track: 'civil',
    package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Formal application with notice to the other side — grounds, supporting affidavit, reliefs sought.',
    needsCaseTheory: false },
  { id: 'civil_motion_ex_parte', label: 'Motion Ex Parte', icon: '⚡', track: 'civil',
    package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Urgent application without notice — where giving notice would defeat the purpose or cause irreparable harm.',
    needsCaseTheory: false },
  { id: 'civil_opposition', label: 'Opposition to Motion', icon: '↩', track: 'civil',
    package: ['Counter-Affidavit', 'Written Address in Opposition', 'List of Authorities'],
    hint: 'Opposing an application — counter-affidavit challenging the supporting affidavit and a written address in opposition.',
    needsCaseTheory: false },
  { id: 'civil_interim_injunction', label: 'Interim Injunction', icon: '⏳', track: 'civil',
    package: ['Motion Ex Parte', 'Supporting Affidavit', 'Certificate of Urgency', 'Written Address in Support', 'List of Authorities'],
    hint: 'Short-lived order made ex parte to preserve the status quo pending the hearing of the motion on notice for interlocutory injunction — must show extreme urgency and a real risk of irreparable harm if notice is given to the other side first.',
    needsCaseTheory: true },
  { id: 'civil_interlocutory_injunction', label: 'Interlocutory Injunction', icon: '🚫', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'Undertaking as to Damages', 'List of Authorities'],
    hint: 'On notice, pending the determination of the substantive suit — establish the three conditions: serious question to be tried, balance of convenience, and adequacy of damages. Mandatory or Mareva variants apply the same test with their added requirements.',
    needsCaseTheory: true },
  { id: 'civil_substituted_service', label: 'Substituted Service', icon: '📬', track: 'civil',
    package: ['Motion Ex Parte', 'Affidavit of Attempted/Difficulty of Service', 'Written Address in Support', 'List of Authorities'],
    hint: 'Leave to serve by substituted means — affidavit must show personal service is impracticable (evading service, unknown whereabouts, etc.) and propose a mode reasonably likely to bring the process to the respondent\'s notice (courier, email, newspaper publication, or posting at last known address).',
    needsCaseTheory: false },
  { id: 'civil_default_judgment', label: 'Default Judgment', icon: '⚖', track: 'civil',
    package: ['Motion on Notice', 'Affidavit of Service', 'Written Address in Support', 'List of Authorities'],
    hint: 'Judgment in default of appearance or defence — prove service, show no defence filed, establish entitlement.',
    needsCaseTheory: false },
  { id: 'civil_strike_out', label: 'Strike Out', icon: '✕', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Strike out — no reasonable cause of action, frivolous, vexatious, or abuse of process.',
    needsCaseTheory: true },
  { id: 'civil_stay', label: 'Stay of Proceedings', icon: '⏸', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Stay pending appeal, arbitration, or related proceedings.',
    needsCaseTheory: false },
  { id: 'civil_security_costs', label: 'Security for Costs', icon: '💰', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Security for costs — impecunious or foreign claimant, no fixed place of business in jurisdiction.',
    needsCaseTheory: false },
  { id: 'civil_extension_time', label: 'Extension of Time', icon: '⏰', track: 'civil',
    package: ['Motion on Notice', 'Affidavit Explaining Delay', 'Written Address in Support', 'List of Authorities'],
    hint: 'Extension of time — account for every day of delay; apply Bowaje v Adediwura two-condition test.',
    needsCaseTheory: false },
  { id: 'civil_summary_judgment', label: 'Summary Judgment', icon: '⚖', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Summary judgment where defendant has no real or bona fide defence — Ord 11 or equivalent. Address each purported defence and why it fails.',
    needsCaseTheory: true },
  // Criminal
  { id: 'crim_bail', label: 'Bail Application', icon: '🔓', track: 'criminal',
    package: ['Formal Application', 'Affidavit in Support', 'Written Address', 'Proposed Bail Conditions', 'List of Authorities'],
    hint: 'Address community ties, flight risk, gravity of offence, health, dependants. Cite Dokubo-Asari v FRN, Ani v State, Bamaiyi v State.',
    needsCaseTheory: false },
  { id: 'crim_prelim_obj', label: 'Preliminary Objection', icon: '🛡', track: 'criminal',
    package: ['Notice of Preliminary Objection', 'Written Address', 'List of Authorities'],
    hint: 'Jurisdiction, charge duplicity, wrong statute, vague particulars, or missing elements.',
    needsCaseTheory: false },
  { id: 'crim_stay', label: 'Stay of Proceedings (Criminal)', icon: '⏸', track: 'criminal',
    package: ['Motion on Notice', 'Affidavit', 'Written Address', 'List of Authorities'],
    hint: 'Stay pending constitutional challenge, interlocutory appeal, or related civil proceedings.',
    needsCaseTheory: false },
  { id: 'crim_quash', label: 'Quash Charge / Information', icon: '🗑', track: 'criminal',
    package: ['Application to Quash', 'Written Address', 'List of Authorities'],
    hint: 'Charge is fundamentally defective — wrong court, duplicitous counts, no offence known to law.',
    needsCaseTheory: false },
  // Appeal
  { id: 'appeal_extension', label: 'Extension of Time to Appeal', icon: '⏰', track: 'appeal',
    package: ['Motion on Notice', 'Affidavit Explaining Delay', 'Written Address in Support', 'Proposed Notice of Appeal', 'List of Authorities'],
    hint: 'Account for every day of delay. Two conditions: good reason for delay and arguable grounds of appeal.',
    needsCaseTheory: false },
  { id: 'appeal_stay_execution', label: 'Stay of Execution', icon: '⏸', track: 'appeal',
    package: ['Motion on Notice', 'Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Three conditions: good grounds of appeal, special circumstances, balance of hardship. Cite Vaswani Trading Co v Savalakh & Co.',
    needsCaseTheory: false },
  { id: 'appeal_regularise', label: 'Regularise Records / Deem Notice Filed', icon: '📄', track: 'appeal',
    package: ['Motion on Notice', 'Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Regularise steps in appellate proceedings — deem notice of appeal as properly filed, extend time to compile records.',
    needsCaseTheory: false },
];

const DEFAULT_FACTS: AppFacts = {
  parties: '', reliefSought: '', grounds: '', deponent: '', keyFacts: '', additionalContext: '',
};

const MODULE      = 'applications_v2';
const TRACKER_MOD = 'app_tracker';
const WORKER_URL   = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const WORKER_TOKEN = 'AFS2026SecureToken99';
const APP_STATUSES: AppStatus[] = ['Drafting', 'Filed', 'Served', 'Awaiting Hearing', 'Heard', 'Granted', 'Refused', 'Withdrawn'];

// ─────────────────────────────────────────────────────────────────────────────
// WORKER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function workerSave(record: ApplicationRecord): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/application`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WORKER_TOKEN}` },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* offline — local save is source of truth */ }
}

async function workerLoad(caseId: string): Promise<ApplicationRecord[]> {
  try {
    const res = await fetch(`${WORKER_URL}/applications?caseId=${encodeURIComponent(caseId)}`, {
      headers: { 'Authorization': `Bearer ${WORKER_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { records?: ApplicationRecord[] };
    return data.records ?? [];
  } catch { return []; }
}

async function workerDelete(id: string): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/application?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${WORKER_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* offline */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Btn({
  label, onClick, loading = false, accent = '#4090d0', off = false, small = false,
}: {
  label: string; onClick: () => void; loading?: boolean; accent?: string; off?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || off}
      style={{
        background: loading || off ? '#101018' : `linear-gradient(135deg,#000000,${accent})`,
        color:   loading || off ? '#2a2a38' : '#f0ece0',
        border: 'none', borderRadius: 6,
        padding: small ? '7px 16px' : '11px 26px',
        fontSize: small ? 12 : 14,
        fontFamily: "'Times New Roman', Times, serif",
        cursor: loading || off ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function StepBadge({ n, active, done }: { n: number; active: boolean; done?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: '50%',
      background: done ? '#40a060' : active ? '#4090d0' : '#181828',
      color: (done || active) ? '#fff' : '#505068',
      fontWeight: 700, fontSize: 12,
      border: `1px solid ${done ? '#40a060' : active ? '#4090d0' : '#282840'}`,
      flexShrink: 0,
    }}>
      {done ? '✓' : n}
    </span>
  );
}

function SLabel({ text }: { text: string }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, color: '#808098',
      fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6,
    }}>{text}</label>
  );
}

function TA({
  value, onChange, placeholder = '', rows = 4, disabled = false,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      style={{
        width: '100%', background: '#0a0a14', border: '1px solid #1e1e34',
        borderRadius: 6, padding: '10px 12px', color: '#e8e4d8', fontSize: 13,
        fontFamily: "'Times New Roman', Times, serif", resize: 'vertical',
        boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function MandatoryNotice() {
  return (
    <div style={{
      background: '#1a1000', border: '1px solid #5a3800', borderRadius: 6,
      padding: '10px 14px', marginTop: 18, fontSize: 12, color: '#c09040', lineHeight: 1.6,
    }}>
      <strong>⚠ Counsel Review Required.</strong> All documents are AI-generated starting points.
      Review and settle every document before filing. Any affidavit must be duly sworn before
      a Commissioner for Oaths or other competent authority.
    </div>
  );
}

function StatusBadge({ status }: { status: AppStatus }) {
  const map: Record<AppStatus, string> = {
    Drafting:          '#8060c0',
    Filed:             '#4090d0',
    Served:            '#40a0c0',
    'Awaiting Hearing':'#c09030',
    Heard:             '#c09030',
    Granted:           '#40a860',
    Refused:           '#c05050',
    Withdrawn:         '#505068',
  };
  const col = map[status] ?? '#606070';
  return (
    <span style={{
      fontSize: 9, color: col, border: `1px solid ${col}40`, borderRadius: 3,
      padding: '1px 6px', fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700,
    }}>
      {status}
    </span>
  );
}

function StatuteChunksPanel({ chunks, error }: { chunks: StatuteChunk[]; error?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (error) return (
    <div style={{ background: '#0e0a04', border: '1px solid #2a1808', borderRadius: 6, padding: '10px 14px', marginBottom: 14 }}>
      <p style={{ fontSize: 11, color: '#808098', fontFamily: "'Times New Roman', Times, serif" }}>⚠ Statute RAG: {error}</p>
    </div>
  );
  if (!chunks.length) return null;
  return (
    <div style={{ background: '#050d06', border: '1px solid #1a3020', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 14 : 0 }}>
        <span style={{ fontSize: 10, color: '#40b060', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>
          § Statute RAG — {chunks.length} section{chunks.length !== 1 ? 's' : ''} retrieved
        </span>
        <button onClick={() => setExpanded(v => !v)}
          style={{ background: 'transparent', border: '1px solid #1a3020', color: '#40b060', borderRadius: 3, padding: '3px 10px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
          {expanded ? 'Collapse' : 'Preview ↓'}
        </button>
      </div>
      {expanded && chunks.map((c, i) => (
        <div key={i} style={{ background: '#030a04', border: '1px solid #0e2014', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: '#40b060', fontWeight: 700 }}>{c.section}</span>
            <span style={{ fontSize: 10, color: '#505068' }}>{c.actName}</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#303048', border: '1px solid #0a1a10', padding: '1px 5px', borderRadius: 2 }}>{Math.round(c.score * 100)}%</span>
          </div>
          <p style={{ fontSize: 12, color: '#a0a0b8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {c.text.slice(0, 280)}{c.text.length > 280 ? '…' : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3 — ARGUMENT BUILDER (dual-track: Mover / Respondent to Application)
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared: issue-by-issue IRAC builder (used by both tracks) ────────────────

interface IssueBuilderProps {
  activeCase:      Case;
  appType:         AppTypeConfig;
  facts:           AppFacts;
  issues:          ArgumentIssue[];
  onIssuesChange:  (v: ArgumentIssue[]) => void;
  writtenAddress:  string;
  onAddressChange: (v: string) => void;
  side:            'support' | 'opposition';
  systemCtx:       string;
}

function IssueBuilder({
  activeCase, appType, facts, issues, onIssuesChange,
  writtenAddress, onAddressChange, side, systemCtx,
}: IssueBuilderProps) {
  const { ask, loading, error, clearError } = useAI(activeCase);
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [draftIssue,      setDraftIssue]      = useState<ArgumentIssue | null>(null);
  const [statuteChunks,   setStatuteChunks]   = useState<StatuteChunk[]>([]);
  const [statuteRagError, setStatuteRagError] = useState('');
  const [ragFetching,     setRagFetching]     = useState(false);
  const [deleteModal,     setDeleteModal]     = useState<string | null>(null);

  const sideLabel = side === 'support' ? 'Written Address in Support' : 'Written Address in Opposition';

  function startNew() {
    setDraftIssue({ id: uid(), issue: '', rule: '', application: '', conclusion: '', draft: '' });
    setEditingId(null);
  }
  function startEdit(iss: ArgumentIssue) { setDraftIssue({ ...iss }); setEditingId(iss.id); }
  function cancelEdit() { setDraftIssue(null); setEditingId(null); clearError(); }
  function removeIssue(id: string) {
    setDeleteModal(id);
  }
  function confirmRemoveIssue() {
    if (!deleteModal) return;
    onIssuesChange(issues.filter(i => i.id !== deleteModal));
    setDeleteModal(null);
  }

  async function generateIssue() {
    if (!draftIssue) return;
    setStatuteChunks([]); setStatuteRagError('');
    let statuteSections = '';
    if (isRagConfigured() && draftIssue.issue) {
      setRagFetching(true);
      const ragResult = await queryStatutes(
        buildRagQuery({ argIssue: draftIssue.issue, argType: 'written_address_application', legalIssues: [draftIssue.issue], caseName: activeCase.caseName }),
        { topK: 5 },
      );
      setRagFetching(false);
      if (!ragResult.skipped && ragResult.chunks.length > 0) {
        setStatuteChunks(ragResult.chunks);
        statuteSections = formatStatutesForPrompt(ragResult.chunks);
      } else if (ragResult.error) { setStatuteRagError(ragResult.error); }
    }

    const prompt = `Draft one issue of a ${sideLabel} for a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'} | ROLE: ${activeCase.counsel_role ?? 'claimant_side'}
POSITION IN THIS APPLICATION: ${side === 'support' ? 'We filed this application — arguing in support' : 'We are opposing this application — arguing against it'}

ISSUE: ${draftIssue.issue}
RULE OF LAW: ${draftIssue.rule}
APPLICATION TO FACTS: ${draftIssue.application}
CONCLUSION: ${draftIssue.conclusion}

APPLICATION FACTS:
Relief Sought: ${facts.reliefSought}
Grounds: ${facts.grounds}
Key Facts: ${facts.keyFacts}

${statuteSections ? 'VERIFIED STATUTE SECTIONS (cite directly — these are confirmed):\n' + statuteSections + '\n' : ''}

RULES:
- IRAC: Issue heading → Rule → Application to Facts → Conclusion
- ${statuteSections ? 'Cite provided statute sections directly.' : 'Cite statutes by name and section only — do not invent text.'}
- Cases you are CERTAIN exist: [Case Name] (Year) Court — [holding]
- Cases you need but cannot verify — use EXACTLY:
[RESEARCH NEEDED]
Proposition: [one sentence — what this authority must establish]
Area of law: [e.g. Contract / Land Law / Criminal Procedure / Evidence / Constitutional Law]
Court level needed: [Supreme Court | Court of Appeal | High Court]
LawPavilion search 1: [3–5 keyword phrase]
LawPavilion search 2: [alternative angle]
LawPavilion search 3: [narrower term of art]
What the case must decide: [required ratio/holding in one sentence]
[/RESEARCH NEEDED]
- NEVER invent a case name, citation, year, volume, or law report.
- Begin immediately with the issue heading.`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting one issue of a Written Address for a Nigerian court. NEVER invent case citations. Use [RESEARCH NEEDED] blocks for uncertain authority.',
      userMsg: prompt, maxTokens: 2000,
      libraryOpts: { queryHint: `${appType.label} ${draftIssue.issue} Nigerian court`, topK: 6 },
    });
    if (result) setDraftIssue(prev => prev ? { ...prev, draft: result.trim() } : prev);
  }

  function saveIssue() {
    if (!draftIssue) return;
    if (editingId) { onIssuesChange(issues.map(i => i.id === editingId ? draftIssue : i)); }
    else { onIssuesChange([...issues, draftIssue]); }
    setDraftIssue(null); setEditingId(null); clearError();
  }

  async function assembleAddress() {
    if (!issues.length) return;
    const issueBlocks = issues.map((iss, i) =>
      `ISSUE ${i + 1}: ${iss.issue}\nRule: ${iss.rule}\nApplication: ${iss.application}\nConclusion: ${iss.conclusion}${iss.draft ? '\n\nDRAFTED ARGUMENT:\n' + iss.draft : ''}`
    ).join('\n\n---\n\n');

    const prompt = `Assemble a complete ${sideLabel} for a ${appType.label} from these issue arguments.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
POSITION: ${side === 'support' ? 'We are the Applicant/Mover — urging the court to GRANT the application' : 'We are the Respondent — urging the court to REFUSE the application'}

STRUCTURE:
1. INTRODUCTION — introducing the application and our position
2. ISSUES FOR DETERMINATION — numbered list
3. ARGUMENTS — each issue in sequence, refined and elevated from the drafts below
4. CONCLUSION AND RELIEF SOUGHT — why the court should ${side === 'support' ? 'grant' : 'refuse'} the application; reliefs in numbered form

ISSUE ARGUMENTS:
${issueBlocks}

APPLICATION FACTS:
${facts.reliefSought ? 'Relief Sought: ' + facts.reliefSought : ''}
${facts.grounds ? 'Grounds: ' + facts.grounds : ''}
${facts.keyFacts ? 'Key Facts: ' + facts.keyFacts : ''}

- Never invent case citations. Use [RESEARCH NEEDED] blocks.
- Write as senior counsel addressing a superior court.
- Begin with the INTRODUCTION heading.`;

    const result = await ask({
      system: systemCtx, userMsg: prompt, maxTokens: 3500,
      libraryOpts: { queryHint: `${appType.label} written address Nigerian court procedure`, topK: 8 },
    });
    if (result) onAddressChange(result.trim());
  }

  return (
    <div>
      {deleteModal && (
        <TypeDeleteModal
          label="issue"
          onConfirm={confirmRemoveIssue}
          onCancel={() => setDeleteModal(null)}
        />
      )}

      <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
        Build the {sideLabel} issue by issue. Each issue uses IRAC — Issue → Rule → Application → Conclusion.
        Statute RAG fires automatically. When all issues are ready, assemble into the full Written Address.
      </div>

      {error && <ErrorBlock message={error} />}

      {/* Issue list */}
      {issues.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {issues.map((iss, i) => (
            <div key={iss.id} style={{
              background: '#080814', border: `1px solid ${editingId === iss.id ? '#4090d0' : '#1e1e34'}`,
              borderRadius: 7, padding: '14px 16px', marginBottom: 10,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#4090d0', fontWeight: 600, marginBottom: 4 }}>
                  Issue {i + 1}: {iss.issue || '(untitled)'}
                </div>
                {iss.rule && <div style={{ fontSize: 12, color: '#808098', marginBottom: 2 }}>Rule: {iss.rule.slice(0, 80)}{iss.rule.length > 80 ? '…' : ''}</div>}
                {iss.draft && <div style={{ fontSize: 11, color: '#40a060', marginTop: 4 }}>✓ Argument drafted</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => startEdit(iss)}
                  style={{ background: 'transparent', border: '1px solid #2a2a40', color: '#808098', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "\'Times New Roman\', Times, serif" }}>Edit</button>
                <button onClick={() => removeIssue(iss.id)}
                  style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Issue editor */}
      {draftIssue ? (
        <div style={{ background: '#080814', border: '1px solid #4090d030', borderRadius: 8, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
            {editingId ? 'Edit Issue' : 'New Issue'}
          </div>
          <div style={{ marginBottom: 12 }}>
            <SLabel text="Issue (legal question for determination)" />
            <TA value={draftIssue.issue} onChange={v => setDraftIssue(p => p ? { ...p, issue: v } : p)}
              placeholder="e.g. Whether the defendant's failure to file a defence within time entitles the claimant to judgment in default"
              rows={2} disabled={loading} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <SLabel text="Rule of Law (statute / principle)" />
            <TA value={draftIssue.rule} onChange={v => setDraftIssue(p => p ? { ...p, rule: v } : p)}
              placeholder="e.g. Order 8 Rule 7, Federal High Court (Civil Procedure) Rules 2019"
              rows={2} disabled={loading} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <SLabel text="Application to Facts" />
            <TA value={draftIssue.application} onChange={v => setDraftIssue(p => p ? { ...p, application: v } : p)}
              placeholder="How the rule applies to the specific facts of this case…"
              rows={3} disabled={loading} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <SLabel text="Conclusion" />
            <TA value={draftIssue.conclusion} onChange={v => setDraftIssue(p => p ? { ...p, conclusion: v } : p)}
              placeholder="What the court is urged to find / do on this issue…"
              rows={2} disabled={loading} />
          </div>

          {isRagConfigured() && !ragFetching && (
            <div style={{ fontSize: 11, color: '#40b060', marginBottom: 8 }}>§ Statute RAG active — retrieves sections automatically on generation.</div>
          )}
          {ragFetching && <div style={{ fontSize: 11, color: '#40b060', marginBottom: 8 }}>⟳ Searching statute library…</div>}
          <StatuteChunksPanel chunks={statuteChunks} error={statuteRagError} />

          {draftIssue.draft && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Argument drafted — review below</div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 6, padding: '14px 16px', lineHeight: 1.85, fontSize: 13, maxHeight: 360, overflowY: 'auto' }}>
                <Md text={draftIssue.draft} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn label={draftIssue.draft ? '↻ Re-generate' : '✍ Generate Argument'}
              onClick={generateIssue} loading={loading} accent="#4090d0" off={!draftIssue.issue.trim()} />
            <Btn label={editingId ? '✓ Update Issue' : '✓ Save Issue'}
              onClick={saveIssue} accent="#40a060" off={!draftIssue.issue.trim()} />
            <button onClick={cancelEdit}
              style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 12, fontFamily: "\'Times New Roman\', Times, serif" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <Btn label="+ Add Issue" onClick={startNew} accent="#4090d0" />
        </div>
      )}

      {/* Assemble */}
      {issues.length > 0 && !draftIssue && (
        <div style={{ borderTop: '1px solid #181828', paddingTop: 20 }}>
          {writtenAddress && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ {sideLabel} assembled</div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', lineHeight: 1.85, fontSize: 13, maxHeight: 320, overflowY: 'auto' }}>
                <Md text={writtenAddress} />
              </div>
            </div>
          )}
          <Btn
            label={writtenAddress ? `↻ Re-assemble ${sideLabel}` : `⚖ Assemble ${sideLabel}`}
            onClick={assembleAddress} loading={loading} accent="#4090d0"
          />
        </div>
      )}
    </div>
  );
}

// ── Shared: Further & Better Affidavit builder ─────────────────────────────

interface FBBuilderProps {
  activeCase:        Case;
  appType:           AppTypeConfig;
  facts:             AppFacts;
  ownAffidavitLabel: string;   // "Supporting Affidavit" | "Counter-Affidavit"
  otherAffidavitIn:  string;   // the opposing affidavit text
  fbGrounds:         FBGround[];
  onFBGroundsChange: (v: FBGround[]) => void;
  fbDraft:           string;
  onFBDraftChange:   (v: string) => void;
  systemCtx:         string;
}

function FBBuilder({
  activeCase, appType, facts, ownAffidavitLabel, otherAffidavitIn,
  fbGrounds, onFBGroundsChange, fbDraft, onFBDraftChange, systemCtx,
}: FBBuilderProps) {
  const { ask, loading, error } = useAI(activeCase);
  const [editGround, setEditGround] = useState<FBGround | null>(null);
  const [editingId,  setEditingId]  = useState<string | null>(null);

  function startNew() {
    setEditGround({ id: uid(), basis: 'own_affidavit', paraRef: '', paraText: '', newFact: '', exhibit: '' });
    setEditingId(null);
  }
  function startEdit(g: FBGround) { setEditGround({ ...g }); setEditingId(g.id); }
  function cancelEdit() { setEditGround(null); setEditingId(null); }
  function removeGround(id: string) { onFBGroundsChange(fbGrounds.filter(g => g.id !== id)); }

  function saveGround() {
    if (!editGround || !editGround.paraRef.trim()) return;
    if (editingId) { onFBGroundsChange(fbGrounds.map(g => g.id === editingId ? editGround : g)); }
    else { onFBGroundsChange([...fbGrounds, editGround]); }
    setEditGround(null); setEditingId(null);
  }

  async function generateFB() {
    if (!fbGrounds.length) return;
    const groundBlocks = fbGrounds.map((g, i) => {
      const ref = g.basis === 'own_affidavit'
        ? `Paragraph${g.paraRef.includes(',') ? 's' : ''} ${g.paraRef} of our ${ownAffidavitLabel}`
        : `Paragraph${g.paraRef.includes(',') ? 's' : ''} ${g.paraRef} of opposing counsel's affidavit`;
      return `Ground ${i + 1}:
Basis: ${ref}
What that paragraph says: ${g.paraText}
New fact / response: ${g.newFact}
${g.exhibit ? 'Exhibit: ' + g.exhibit : ''}`;
    }).join('\n\n');

    const prompt = `Draft a Further and Better Affidavit for a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}
DEPONENT: ${facts.deponent || 'the deponent'}

BACKGROUND:
This Further and Better Affidavit is filed pursuant to and in addition to the ${ownAffidavitLabel} already filed in support of / in this application.
${otherAffidavitIn ? 'The opposing party has filed a Counter-Affidavit. Portions of it are addressed below.' : ''}

GROUNDS FOR THIS FURTHER AND BETTER AFFIDAVIT:
${groundBlocks}

DRAFTING RULES — MANDATORY:
1. Opening paragraph must: identify the deponent, state their capacity, reference the original ${ownAffidavitLabel} by filing date (if known) or as "the ${ownAffidavitLabel} already filed herein", and state the purpose of this further affidavit.
2. Each ground becomes one or more numbered paragraphs. Each paragraph must explicitly state its connection:
   - If premised on the ${ownAffidavitLabel}: "Further and better stating paragraph [X] of our ${ownAffidavitLabel}, I state that..."
   - If responding to the Counter-Affidavit: "As to paragraph [X] of the Counter-Affidavit deposed to by [deponent], I say that the same is false/misleading/incomplete in that..."
3. New facts stated in first-person deponent voice. Present tense where appropriate, past tense for past events.
4. Exhibits: "There is now produced and shown to me marked Exhibit [X] a copy of [document description]."
5. Correct jurat: "Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________ Commissioner for Oaths / Notary Public"
6. Heading: "FURTHER AND BETTER AFFIDAVIT" — with full court heading, case name, suit number, parties.
7. Do not introduce facts unrelated to the grounds listed above.
8. Do not introduce legal argument — this is an affidavit, not a written address.

Draft the Further and Better Affidavit now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Further and Better Affidavit for a Nigerian court. This is a sworn document — no legal argument, only facts. Every paragraph must have a clear basis (premised on own affidavit or responding to counter-affidavit paragraph). Use correct Nigerian affidavit format.',
      userMsg: prompt, maxTokens: 2500,
    });
    if (result) onFBDraftChange(result.trim());
  }

  const basisOptions: { value: FBGround['basis']; label: string }[] = [
    { value: 'own_affidavit',     label: `Premised on our ${ownAffidavitLabel}` },
    { value: 'counter_affidavit', label: "Responding to Counter-Affidavit paragraph(s)" },
  ];

  return (
    <div>
      <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
        A Further and Better Affidavit must be premised on specific paragraphs of your own affidavit (to expand or add exhibits)
        or must directly respond to specific paragraphs of the opposing Counter-Affidavit (to deny or correct facts).
        Add each ground separately below.
      </div>

      {error && <ErrorBlock message={error} />}

      {/* Ground list */}
      {fbGrounds.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {fbGrounds.map((g, i) => (
            <div key={g.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '14px 16px', marginBottom: 10, display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#4090d0', fontWeight: 600, marginBottom: 4 }}>
                  Ground {i + 1} — {g.basis === 'own_affidavit' ? `Our ${ownAffidavitLabel} ¶${g.paraRef}` : `Counter-Affidavit ¶${g.paraRef}`}
                </div>
                {g.exhibit && <div style={{ fontSize: 11, color: '#c09040' }}>Exhibit: {g.exhibit}</div>}
                <div style={{ fontSize: 12, color: '#808098', marginTop: 2 }}>{g.newFact.slice(0, 80)}{g.newFact.length > 80 ? '…' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => startEdit(g)}
                  style={{ background: 'transparent', border: '1px solid #2a2a40', color: '#808098', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "\'Times New Roman\', Times, serif" }}>Edit</button>
                <button onClick={() => removeGround(g.id)}
                  style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ground editor */}
      {editGround ? (
        <div style={{ background: '#080814', border: '1px solid #c0904030', borderRadius: 8, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
            {editingId ? 'Edit Ground' : 'New Ground'}
          </div>

          <div style={{ marginBottom: 14 }}>
            <SLabel text="Basis of this ground" />
            <div style={{ display: 'flex', gap: 8 }}>
              {basisOptions.map(opt => (
                <button key={opt.value} onClick={() => setEditGround(p => p ? { ...p, basis: opt.value } : p)}
                  style={{
                    background: editGround.basis === opt.value ? '#0a1020' : 'transparent',
                    border: `1px solid ${editGround.basis === opt.value ? '#4090d0' : '#282840'}`,
                    color: editGround.basis === opt.value ? '#4090d0' : '#505068',
                    borderRadius: 5, padding: '7px 14px', fontSize: 12, cursor: 'pointer',
                    fontFamily: "\'Times New Roman\', Times, serif",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <SLabel text={`Paragraph number(s) in the ${editGround.basis === 'own_affidavit' ? `${ownAffidavitLabel}` : 'Counter-Affidavit'} being referenced`} />
            <TA value={editGround.paraRef} onChange={v => setEditGround(p => p ? { ...p, paraRef: v } : p)}
              placeholder="e.g. 5 / or 5, 6 and 7" rows={1} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <SLabel text="What those paragraph(s) say (brief summary)" />
            <TA value={editGround.paraText} onChange={v => setEditGround(p => p ? { ...p, paraText: v } : p)}
              placeholder={editGround.basis === 'own_affidavit'
                ? "e.g. Paragraph 5 states that the claimant paid the sum of ₦5,000,000 on 3 March 2024 but does not exhibit the payment receipt"
                : "e.g. Paragraph 5 of the Counter-Affidavit alleges that the defendant never received the goods, which is false"}
              rows={3} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <SLabel text={editGround.basis === 'own_affidavit' ? "New fact or exhibit being introduced (what this ground adds)" : "Your response — the true facts"} />
            <TA value={editGround.newFact} onChange={v => setEditGround(p => p ? { ...p, newFact: v } : p)}
              placeholder={editGround.basis === 'own_affidavit'
                ? "e.g. The receipt was omitted from the original affidavit. A copy of the receipt is now exhibited hereto as Exhibit C"
                : "e.g. The defendant received the goods on 5 March 2024 as evidenced by the delivery note signed by the defendant's store manager now exhibited as Exhibit D"}
              rows={4} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Exhibit label (if any)" />
            <TA value={editGround.exhibit} onChange={v => setEditGround(p => p ? { ...p, exhibit: v } : p)}
              placeholder="e.g. Exhibit C (continue from the original affidavit's exhibit sequence)"
              rows={1} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn label={editingId ? '✓ Update Ground' : '✓ Save Ground'} onClick={saveGround} accent="#c09040" off={!editGround.paraRef.trim() || !editGround.newFact.trim()} />
            <button onClick={cancelEdit}
              style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 12, fontFamily: "\'Times New Roman\', Times, serif" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <Btn label="+ Add Ground" onClick={startNew} accent="#c09040" />
        </div>
      )}

      {/* Draft & output */}
      {fbGrounds.length > 0 && !editGround && (
        <div style={{ borderTop: '1px solid #181828', paddingTop: 20 }}>
          {fbDraft && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Further and Better Affidavit drafted</div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', lineHeight: 1.85, fontSize: 13, maxHeight: 360, overflowY: 'auto' }}>
                <Md text={fbDraft} />
              </div>
            </div>
          )}
          <Btn label={fbDraft ? '↻ Re-draft Further & Better Affidavit' : '✍ Draft Further & Better Affidavit'}
            onClick={generateFB} loading={loading} accent="#c09040" />
        </div>
      )}
    </div>
  );
}

// ── Full Stage 3 component ─────────────────────────────────────────────────

interface ArgBuilderProps {
  activeCase: Case;
  appType:    AppTypeConfig;
  facts:      AppFacts;
  stage3:     Stage3Data;
  onStage3:   (v: Stage3Data) => void;
  systemCtx:  string;
}

function ArgumentBuilderStage({ activeCase, appType, facts, stage3, onStage3, systemCtx }: ArgBuilderProps) {
  const { ask, loading, error } = useAI(activeCase);

  // ── Role selection — who are we in THIS application?
  if (!stage3.applicationRole) {
    return (
      <div>
        <div style={{ fontSize: 14, color: '#808098', marginBottom: 24, lineHeight: 1.7 }}>
          In a Nigerian court, any party — claimant, defendant, prosecution, accused, appellant, or respondent on appeal —
          can file an application at any stage of proceedings. Your role in the main suit does not determine your role in this application.
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
          In this application, I am:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {([
            {
              role: 'mover' as const,
              icon: '⚡',
              title: 'Applicant / Mover',
              desc: 'I filed this motion. I am urging the court to grant the reliefs I seek. I will file: Motion Paper + Supporting Affidavit + Written Address in Support. If opposed, I may later file a Further & Better Affidavit and a Reply on Points of Law.',
            },
            {
              role: 'respondent' as const,
              icon: '🛡',
              title: 'Respondent to Application',
              desc: 'I am opposing this motion filed by the other party. I will file: Counter-Affidavit + Written Address in Opposition. I may also file a Further & Better Affidavit if the Applicant introduces new facts after my Counter-Affidavit.',
            },
          ]).map(opt => (
            <button key={opt.role} onClick={() => onStage3({ ...stage3, applicationRole: opt.role })}
              style={{
                background: '#080814', border: '1px solid #1e1e34', borderRadius: 8,
                padding: '18px 20px', textAlign: 'left', cursor: 'pointer',
                display: 'flex', alignItems: 'flex-start', gap: 14,
              }}>
              <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{opt.icon}</span>
              <div>
                <div style={{ fontSize: 14, color: '#f0ece0', fontWeight: 700, marginBottom: 6 }}>{opt.title}</div>
                <div style={{ fontSize: 12, color: '#808098', lineHeight: 1.65 }}>{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: '#404058', lineHeight: 1.6 }}>
          Note: Being the claimant or defendant in the main suit does not determine which role you occupy here.
          A defendant can bring a motion; a claimant can be the respondent to a motion brought by the defendant.
        </div>
      </div>
    );
  }

  const role = stage3.applicationRole;

  // ── Tab definitions
  const moverTabs: { id: MoverSubTab; label: string; locked?: boolean }[] = [
    { id: 'written_address',    label: `⚖ Written Address in Support (${stage3.issues.length} issue${stage3.issues.length !== 1 ? 's' : ''})` },
    { id: 'opposing_response',  label: '📥 Opposing Response' },
    { id: 'further_better',     label: '✍ Further & Better Affidavit', locked: !stage3.opposingFiled },
    { id: 'reply_law',          label: '↩ Reply on Points of Law',     locked: !stage3.opposingFiled || !stage3.writtenAddressIn.trim() },
  ];

  const respondentTabs: { id: RespondentSubTab; label: string }[] = [
    { id: 'counter_affidavit',    label: `✍ Counter-Affidavit (${stage3.paraResponses.length} para${stage3.paraResponses.length !== 1 ? 's' : ''})` },
    { id: 'written_address_opp',  label: `⚖ Written Address in Opposition (${stage3.respIssues.length} issue${stage3.respIssues.length !== 1 ? 's' : ''})` },
    { id: 'further_better_resp',  label: '✍ Further & Better Affidavit' },
  ];

  const [moverTab,     setMoverTab]     = useState<MoverSubTab>('written_address');
  const [respondentTab, setRespondentTab] = useState<RespondentSubTab>('counter_affidavit');

  // ── Counter-Affidavit builder state (Respondent track)
  const [editPara,    setEditPara]    = useState<AffidavitParaResponse | null>(null);
  const [editParaId,  setEditParaId]  = useState<string | null>(null);

  function startNewPara() {
    setEditPara({ id: uid(), paraNum: '', paraText: '', stance: 'deny', response: '' });
    setEditParaId(null);
  }
  function startEditPara(p: AffidavitParaResponse) { setEditPara({ ...p }); setEditParaId(p.id); }
  function cancelParaEdit() { setEditPara(null); setEditParaId(null); }
  function removePara(id: string) { onStage3({ ...stage3, paraResponses: stage3.paraResponses.filter(p => p.id !== id) }); }
  function savePara() {
    if (!editPara || !editPara.paraNum.trim()) return;
    if (editParaId) { onStage3({ ...stage3, paraResponses: stage3.paraResponses.map(p => p.id === editParaId ? editPara : p) }); }
    else { onStage3({ ...stage3, paraResponses: [...stage3.paraResponses, editPara] }); }
    setEditPara(null); setEditParaId(null);
  }

  async function generateCounterAffidavit() {
    const paraBlocks = stage3.paraResponses.map(p =>
      `Para ${p.paraNum}: "${p.paraText}" → ${p.stance === 'admit' ? 'ADMIT' : p.stance === 'deny' ? 'DENY' : 'NOT WITHIN MY KNOWLEDGE'}${p.response ? ' — ' + p.response : ''}`
    ).join('\n');

    const prompt = `Draft a Counter-Affidavit opposing a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}
DEPONENT: ${stage3.respondentDeponent || facts.deponent || 'the Respondent'}

APPLICANT'S SUPPORTING AFFIDAVIT:
${stage3.applicantAffidavit || '(Counsel to confirm the content of the Supporting Affidavit)'}

PARAGRAPH-BY-PARAGRAPH RESPONSES:
${paraBlocks}

${stage3.respondentNewFacts ? 'ADDITIONAL FACTS (respondent\'s own evidence):\n' + stage3.respondentNewFacts : ''}
${stage3.respondentExhibits ? 'EXHIBITS:\n' + stage3.respondentExhibits : ''}

DRAFTING RULES — MANDATORY:
1. Heading: "COUNTER-AFFIDAVIT" with full court heading, case name, suit number, parties.
2. Opening paragraph: deponent's full name, address, occupation, and that they make this affidavit in opposition to the application.
3. For each paragraph of the Supporting Affidavit:
   - ADMIT: "Paragraph [X] of the Supporting Affidavit is admitted."
   - DENY: "Paragraph [X] of the Supporting Affidavit is denied. The true position is that..." (then state the true facts)
   - NOT WITHIN KNOWLEDGE: "As to paragraph [X] of the Supporting Affidavit, the Deponent is not in a position to admit or deny the same as it is not within the Deponent's personal knowledge."
4. Additional facts (respondent's own evidence): numbered paragraphs in first-person voice.
5. Exhibits: "There is now produced and shown to me marked Exhibit [X] a copy of [document]."
6. Jurat: "Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________ Commissioner for Oaths"
7. No legal argument — only facts. Legal arguments go in the Written Address in Opposition.
8. All facts stated on personal knowledge unless stated otherwise.

Draft the Counter-Affidavit now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Counter-Affidavit for a Nigerian court. Sworn document — facts only, no legal argument. Every paragraph must be based on personal knowledge or stated otherwise. Use correct Nigerian affidavit format.',
      userMsg: prompt, maxTokens: 2500,
    });
    if (result) onStage3({ ...stage3, counterAffidavitDraft: result.trim() });
  }

  async function generateReplyLaw() {
    if (!stage3.writtenAddressIn.trim()) return;
    const prompt = `Draft a Reply on Points of Law to a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}

OUR WRITTEN ADDRESS IN SUPPORT (what we have already argued):
${stage3.writtenAddress.slice(0, 2500)}

OPPOSING COUNSEL'S WRITTEN ADDRESS IN OPPOSITION (what they filed):
${stage3.writtenAddressIn}

POINTS COUNSEL WANTS TO SPECIFICALLY REBUT:
${stage3.replyLawPoints || '(Respond to all new or contested legal points raised by opposing counsel)'}

STRICT RULES FOR A REPLY ON POINTS OF LAW — MANDATORY:
1. A Reply on Points of Law is STRICTLY LIMITED to new or contested legal points raised in opposing counsel's Written Address that were not already addressed in our Written Address, or that require a direct response.
2. This document must NOT introduce new facts. Any new facts must be in a Further and Better Affidavit.
3. This document must NOT raise new arguments not provoked by opposing counsel's Written Address.
4. If a point raised by opposing counsel was already fully addressed in our Written Address in Support, a brief reinforcement is permitted — but do not re-argue the whole case.
5. Structure: Brief Introduction (1 paragraph) → Point-by-point response → Closing paragraph urging the court to grant the reliefs.
6. Never invent case citations. Use [RESEARCH NEEDED] blocks where authority is needed but uncertain.
7. Write as senior counsel — direct, precise, confident. Not defensive.
8. If opposing counsel raised no new legal points, state this clearly and invite the court to discountenance their address on those points.

Draft the Reply on Points of Law now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Reply on Points of Law — a strictly limited document responding only to new legal points raised by opposing counsel. No new facts. No new arguments beyond what opposing counsel provoked. NEVER invent case citations.',
      userMsg: prompt, maxTokens: 2000,
      libraryOpts: { queryHint: `reply points of law ${appType.label} Nigerian court`, topK: 5 },
    });
    if (result) onStage3({ ...stage3, replyLawDraft: result.trim() });
  }

  // ── MOVER TRACK RENDER
  if (role === 'mover') {
    return (
      <div>
        {/* Role badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 12, color: '#4090d0', background: '#4090d010', border: '1px solid #4090d030', borderRadius: 4, padding: '4px 12px', fontFamily: "\'Times New Roman\', Times, serif" }}>
            ⚡ Applicant / Mover
          </span>
          <button onClick={() => onStage3({ ...stage3, applicationRole: null })}
            style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 11, fontFamily: "\'Times New Roman\', Times, serif" }}>
            ← Change role
          </button>
        </div>

        {/* Sub-tab strip */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid #181828', overflowX: 'auto' }}>
          {moverTabs.map(t => (
            <button key={t.id}
              onClick={() => { if (!t.locked) setMoverTab(t.id); }}
              style={{
                background: moverTab === t.id ? '#181828' : 'transparent',
                color: t.locked ? '#2a2a40' : moverTab === t.id ? '#f0ece0' : '#505068',
                border: 'none', borderBottom: moverTab === t.id ? '2px solid #4090d0' : '2px solid transparent',
                padding: '8px 16px', fontSize: 12, cursor: t.locked ? 'not-allowed' : 'pointer',
                fontFamily: "\'Times New Roman\', Times, serif",
                fontWeight: moverTab === t.id ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
              {t.label}{t.locked ? ' 🔒' : ''}
            </button>
          ))}
        </div>

        {/* A — Written Address in Support */}
        {moverTab === 'written_address' && (
          <IssueBuilder
            activeCase={activeCase} appType={appType} facts={facts}
            issues={stage3.issues} onIssuesChange={v => onStage3({ ...stage3, issues: v })}
            writtenAddress={stage3.writtenAddress} onAddressChange={v => onStage3({ ...stage3, writtenAddress: v })}
            side="support" systemCtx={systemCtx}
          />
        )}

        {/* B — Opposing Response */}
        {moverTab === 'opposing_response' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
              Did opposing counsel file a response to your application?
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              {([
                { val: true,  label: 'Yes — they filed a Counter-Affidavit and/or Written Address in Opposition' },
                { val: false, label: 'No — the application is unopposed' },
              ] as const).map(opt => (
                <button key={String(opt.val)} onClick={() => onStage3({ ...stage3, opposingFiled: opt.val })}
                  style={{
                    background: stage3.opposingFiled === opt.val ? '#080f1a' : '#080814',
                    border: `1px solid ${stage3.opposingFiled === opt.val ? '#4090d0' : '#1e1e34'}`,
                    borderRadius: 7, padding: '12px 16px', fontSize: 12, cursor: 'pointer',
                    color: stage3.opposingFiled === opt.val ? '#f0ece0' : '#808098',
                    fontFamily: "\'Times New Roman\', Times, serif", textAlign: 'left', flex: 1,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>

            {stage3.opposingFiled === false && (
              <div style={{ background: '#050d06', border: '1px solid #1a3020', borderRadius: 7, padding: '14px 18px', fontSize: 13, color: '#60a060', lineHeight: 1.65 }}>
                ✓ The application is unopposed. No Counter-Affidavit, Further & Better Affidavit, or Reply on Points of Law is required.
                Proceed to assemble the full package in Stage 4.
              </div>
            )}

            {stage3.opposingFiled === true && (
              <div>
                <div style={{ marginBottom: 18 }}>
                  <SLabel text="Their Counter-Affidavit — paste or summarise the facts they are alleging or denying" />
                  <TA value={stage3.counterAffidavitIn}
                    onChange={v => onStage3({ ...stage3, counterAffidavitIn: v })}
                    placeholder="Paste or summarise the paragraphs in opposing counsel's Counter-Affidavit — what facts are they denying? What new facts are they introducing? This feeds into your Further & Better Affidavit."
                    rows={8} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <SLabel text="Their Written Address in Opposition — paste or summarise their legal arguments" />
                  <TA value={stage3.writtenAddressIn}
                    onChange={v => onStage3({ ...stage3, writtenAddressIn: v })}
                    placeholder="Paste or summarise the legal points, cases, and statutory arguments made in opposing counsel's Written Address in Opposition. This feeds into your Reply on Points of Law."
                    rows={8} />
                </div>
                <div style={{ fontSize: 12, color: '#40a060' }}>
                  ✓ Further & Better Affidavit and Reply on Points of Law tabs are now unlocked.
                </div>
              </div>
            )}
          </div>
        )}

        {/* C — Further & Better Affidavit (Mover) */}
        {moverTab === 'further_better' && (
          <FBBuilder
            activeCase={activeCase} appType={appType} facts={facts}
            ownAffidavitLabel="Supporting Affidavit"
            otherAffidavitIn={stage3.counterAffidavitIn}
            fbGrounds={stage3.fbGrounds} onFBGroundsChange={v => onStage3({ ...stage3, fbGrounds: v })}
            fbDraft={stage3.furtherBetterDraft} onFBDraftChange={v => onStage3({ ...stage3, furtherBetterDraft: v })}
            systemCtx={systemCtx}
          />
        )}

        {/* D — Reply on Points of Law */}
        {moverTab === 'reply_law' && (
          <div>
            <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.65 }}>
              A Reply on Points of Law responds only to <strong style={{ color: '#c0c0d8' }}>new or contested legal points</strong> raised
              in opposing counsel's Written Address in Opposition. It must not introduce new facts — those go in the Further & Better Affidavit.
              It must not raise new arguments not provoked by opposing counsel.
            </div>

            {error && <ErrorBlock message={error} />}

            <div style={{ marginBottom: 16 }}>
              <SLabel text="Specific legal points you want to rebut (optional — if blank, AI responds to all new points)" />
              <TA value={stage3.replyLawPoints}
                onChange={v => onStage3({ ...stage3, replyLawPoints: v })}
                placeholder="e.g. Opposing counsel cited Kalu v Odili for a proposition it does not support. They also argued that Order 26 Rule 3 bars this application — that is a misreading of the rule. Address both specifically."
                rows={5} />
            </div>

            {stage3.replyLawDraft && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Reply on Points of Law drafted</div>
                <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '18px 20px', lineHeight: 1.85, fontSize: 13, maxHeight: 400, overflowY: 'auto' }}>
                  <Md text={stage3.replyLawDraft} />
                </div>
              </div>
            )}

            <Btn label={stage3.replyLawDraft ? '↻ Re-draft Reply on Points of Law' : '↩ Draft Reply on Points of Law'}
              onClick={generateReplyLaw} loading={loading} accent="#4090d0" />
          </div>
        )}
      </div>
    );
  }

  // ── RESPONDENT TRACK RENDER
  return (
    <div>
      {/* Role badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 12, color: '#c09040', background: '#c0904010', border: '1px solid #c0904030', borderRadius: 4, padding: '4px 12px', fontFamily: "\'Times New Roman\', Times, serif" }}>
          🛡 Respondent to Application
        </span>
        <button onClick={() => onStage3({ ...stage3, applicationRole: null })}
          style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 11, fontFamily: "\'Times New Roman\', Times, serif" }}>
          ← Change role
        </button>
      </div>

      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid #181828', overflowX: 'auto' }}>
        {respondentTabs.map(t => (
          <button key={t.id} onClick={() => setRespondentTab(t.id)}
            style={{
              background: respondentTab === t.id ? '#181828' : 'transparent',
              color: respondentTab === t.id ? '#f0ece0' : '#505068',
              border: 'none', borderBottom: respondentTab === t.id ? '2px solid #c09040' : '2px solid transparent',
              padding: '8px 16px', fontSize: 12, cursor: 'pointer',
              fontFamily: "\'Times New Roman\', Times, serif",
              fontWeight: respondentTab === t.id ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* A — Counter-Affidavit */}
      {respondentTab === 'counter_affidavit' && (
        <div>
          <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
            Build the Counter-Affidavit paragraph by paragraph. For each paragraph of the applicant's Supporting Affidavit,
            state whether you admit it, deny it, or whether it is not within your knowledge. Add your own facts after.
          </div>

          {error && <ErrorBlock message={error} />}

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Applicant's Supporting Affidavit (paste here for reference)" />
            <TA value={stage3.applicantAffidavit}
              onChange={v => onStage3({ ...stage3, applicantAffidavit: v })}
              placeholder="Paste the applicant's Supporting Affidavit here. This feeds your paragraph-by-paragraph responses below and the AI uses it to draft the Counter-Affidavit correctly."
              rows={6} />
          </div>

          {/* Para responses */}
          {stage3.paraResponses.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {stage3.paraResponses.map((p, i) => (
                <div key={p.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '12px 16px', marginBottom: 8, display: 'flex', gap: 12, justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#4090d0', fontWeight: 600 }}>¶{p.paraNum}</span>
                      <span style={{
                        fontSize: 10, borderRadius: 3, padding: '1px 6px', fontWeight: 700,
                        color: p.stance === 'admit' ? '#40a060' : p.stance === 'deny' ? '#c05050' : '#c09040',
                        border: `1px solid ${p.stance === 'admit' ? '#40a06040' : p.stance === 'deny' ? '#c0505040' : '#c0904040'}`,
                      }}>
                        {p.stance === 'admit' ? 'ADMIT' : p.stance === 'deny' ? 'DENY' : 'NOT KNOWN'}
                      </span>
                    </div>
                    {p.response && <div style={{ fontSize: 12, color: '#808098' }}>{p.response.slice(0, 80)}{p.response.length > 80 ? '…' : ''}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => startEditPara(p)}
                      style={{ background: 'transparent', border: '1px solid #2a2a40', color: '#808098', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "\'Times New Roman\', Times, serif" }}>Edit</button>
                    <button onClick={() => removePara(p.id)}
                      style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Para editor */}
          {editPara ? (
            <div style={{ background: '#080814', border: '1px solid #c0504030', borderRadius: 8, padding: '18px 20px', marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
                {editParaId ? 'Edit Paragraph Response' : 'New Paragraph Response'}
              </div>
              <div style={{ marginBottom: 12 }}>
                <SLabel text="Paragraph number(s) in the Supporting Affidavit" />
                <TA value={editPara.paraNum} onChange={v => setEditPara(p => p ? { ...p, paraNum: v } : p)} placeholder="e.g. 5 / or 5, 6 and 7" rows={1} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <SLabel text="What those paragraph(s) allege" />
                <TA value={editPara.paraText} onChange={v => setEditPara(p => p ? { ...p, paraText: v } : p)}
                  placeholder="e.g. Paragraph 5 alleges that the defendant received the sum of ₦2,000,000 from the claimant on 10 January 2024" rows={3} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <SLabel text="Stance" />
                <div style={{ display: 'flex', gap: 8 }}>
                  {([
                    { val: 'admit'    as const, label: 'Admit',          col: '#40a060' },
                    { val: 'deny'     as const, label: 'Deny',           col: '#c05050' },
                    { val: 'not_known'as const, label: 'Not within my knowledge', col: '#c09040' },
                  ]).map(opt => (
                    <button key={opt.val} onClick={() => setEditPara(p => p ? { ...p, stance: opt.val } : p)}
                      style={{
                        background: editPara.stance === opt.val ? '#080f1a' : 'transparent',
                        border: `1px solid ${editPara.stance === opt.val ? opt.col : '#282840'}`,
                        color: editPara.stance === opt.val ? opt.col : '#505068',
                        borderRadius: 5, padding: '6px 12px', fontSize: 11, cursor: 'pointer',
                        fontFamily: "\'Times New Roman\', Times, serif",
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {(editPara.stance === 'deny') && (
                <div style={{ marginBottom: 16 }}>
                  <SLabel text="Your response — the true facts" />
                  <TA value={editPara.response} onChange={v => setEditPara(p => p ? { ...p, response: v } : p)}
                    placeholder="e.g. The true position is that the defendant never received any payment from the claimant. No such payment was made on 10 January 2024 or at any time thereafter."
                    rows={4} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn label={editParaId ? '✓ Update' : '✓ Save Paragraph'} onClick={savePara} accent="#c09040" off={!editPara.paraNum.trim()} />
                <button onClick={cancelParaEdit}
                  style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 12, fontFamily: "\'Times New Roman\', Times, serif" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 20 }}>
              <Btn label="+ Add Paragraph Response" onClick={startNewPara} accent="#c09040" />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Respondent's additional facts (own evidence not in applicant's affidavit)" />
            <TA value={stage3.respondentNewFacts}
              onChange={v => onStage3({ ...stage3, respondentNewFacts: v })}
              placeholder="State any new facts the respondent wants to place before the court — facts not addressed in the applicant's affidavit. These will be added as numbered paragraphs after the paragraph-by-paragraph responses."
              rows={5} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Deponent (who is swearing this Counter-Affidavit)" />
            <TA value={stage3.respondentDeponent}
              onChange={v => onStage3({ ...stage3, respondentDeponent: v })}
              placeholder="e.g. Chukwuemeka Obi, the Respondent / a clerk in the employ of counsel for the Respondent"
              rows={1} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <SLabel text="Exhibits (labels and descriptions)" />
            <TA value={stage3.respondentExhibits}
              onChange={v => onStage3({ ...stage3, respondentExhibits: v })}
              placeholder="e.g. Exhibit A — letter dated 15 January 2024; Exhibit B — bank statement showing no credit on 10 January 2024"
              rows={3} />
          </div>

          {stage3.counterAffidavitDraft && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Counter-Affidavit drafted</div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', lineHeight: 1.85, fontSize: 13, maxHeight: 380, overflowY: 'auto' }}>
                <Md text={stage3.counterAffidavitDraft} />
              </div>
            </div>
          )}

          <Btn label={stage3.counterAffidavitDraft ? '↻ Re-draft Counter-Affidavit' : '✍ Draft Counter-Affidavit'}
            onClick={generateCounterAffidavit} loading={loading}
            off={stage3.paraResponses.length === 0 && !stage3.respondentNewFacts.trim()}
            accent="#c09040" />
        </div>
      )}

      {/* B — Written Address in Opposition */}
      {respondentTab === 'written_address_opp' && (
        <IssueBuilder
          activeCase={activeCase} appType={appType} facts={facts}
          issues={stage3.respIssues} onIssuesChange={v => onStage3({ ...stage3, respIssues: v })}
          writtenAddress={stage3.writtenAddressOpp} onAddressChange={v => onStage3({ ...stage3, writtenAddressOpp: v })}
          side="opposition" systemCtx={systemCtx}
        />
      )}

      {/* C — Further & Better Affidavit (Respondent) */}
      {respondentTab === 'further_better_resp' && (
        <div>
          <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
            As respondent, you file a Further & Better Affidavit if the applicant has filed a Further & Better Affidavit
            after your Counter-Affidavit that introduces new facts requiring a response, OR if you omitted facts or exhibits
            from your original Counter-Affidavit.
          </div>
          <FBBuilder
            activeCase={activeCase} appType={appType} facts={facts}
            ownAffidavitLabel="Counter-Affidavit"
            otherAffidavitIn={stage3.furtherBetterDraft}
            fbGrounds={stage3.respFBGrounds} onFBGroundsChange={v => onStage3({ ...stage3, respFBGrounds: v })}
            fbDraft={stage3.respFBDraft} onFBDraftChange={v => onStage3({ ...stage3, respFBDraft: v })}
            systemCtx={systemCtx}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5 — APPLICATIONS TRACKER
// ─────────────────────────────────────────────────────────────────────────────

function ApplicationsTracker({ caseId }: { caseId: string }) {
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [loaded,  setLoaded]  = useState(false);
  const [newType,    setNewType]    = useState('');
  const [newFiled,   setNewFiled]   = useState('');
  const [newHearing, setNewHearing] = useState('');
  const [newStatus,  setNewStatus]  = useState<AppStatus>('Drafting');
  const [newNotes,   setNewNotes]   = useState('');

  useEffect(() => {
    loadBlindSpot<TrackerData>(caseId, TRACKER_MOD, { entries: [] })
      .then(d => { setEntries(d.entries ?? []); setLoaded(true); });
  }, [caseId]);

  async function persist(updated: TrackerEntry[]) {
    setEntries(updated);
    await saveBlindSpot(caseId, TRACKER_MOD, { entries: updated });
  }

  function addEntry() {
    if (!newType.trim()) return;
    persist([...entries, {
      id: uid(), appType: newType, filedDate: newFiled,
      hearingDate: newHearing, status: newStatus, ruling: '', notes: newNotes,
    }]);
    setNewType(''); setNewFiled(''); setNewHearing(''); setNewNotes(''); setNewStatus('Drafting');
  }

  const allTypes = [
    'Motion on Notice', 'Motion Ex Parte', 'Bail Application', 'Preliminary Objection',
    'Injunction', 'Stay of Proceedings', 'Stay of Execution', 'Default Judgment',
    'Strike Out', 'Security for Costs', 'Extension of Time', 'Extension of Time to Appeal',
    'Regularise Records', 'Quash Charge', 'Opposition to Motion', 'Other',
  ];

  if (!loaded) return <div style={{ color: '#505068', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading tracker…</div>;

  return (
    <div>
      {entries.length === 0 && (
        <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 8, padding: '20px', marginBottom: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#505068', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>No applications tracked yet. Add one below.</p>
        </div>
      )}

      {entries.map(entry => (
        <div key={entry.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 8, padding: '16px 18px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 14, color: '#f0ece0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{entry.appType}</span>
                <StatusBadge status={entry.status} />
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {entry.filedDate   && <span style={{ fontSize: 11, color: '#808098' }}>Filed: {entry.filedDate}</span>}
                {entry.hearingDate && <span style={{ fontSize: 11, color: '#808098' }}>Hearing: {entry.hearingDate}</span>}
              </div>
              {entry.notes   && <p style={{ fontSize: 12, color: '#a0a0b8', fontFamily: "'Times New Roman', Times, serif", margin: '6px 0 0', lineHeight: 1.5 }}>{entry.notes}</p>}
              {entry.ruling  && <p style={{ fontSize: 12, color: '#4090d0', fontFamily: "'Times New Roman', Times, serif", margin: '6px 0 0' }}>Ruling: {entry.ruling}</p>}
            </div>
            <button onClick={() => { if (!confirm('Remove?')) return; persist(entries.filter(e => e.id !== entry.id)); }}
              style={{ background: 'transparent', border: '1px solid #2a0808', color: '#804040', fontSize: 11, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>
              ×
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={entry.status} onChange={e => persist(entries.map(en => en.id === entry.id ? { ...en, status: e.target.value as AppStatus } : en))}
              style={{ background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 4, padding: '4px 8px', color: '#c0c0d8', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              {APP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={entry.ruling} onChange={e => persist(entries.map(en => en.id === entry.id ? { ...en, ruling: e.target.value } : en))}
              placeholder="Ruling / outcome…"
              style={{ background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 4, padding: '4px 10px', color: '#e8e4d8', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", outline: 'none', flex: 1, minWidth: 140 }} />
          </div>
        </div>
      ))}

      {/* Add form */}
      <div style={{ background: '#080814', border: '1px solid #4090d020', borderRadius: 8, padding: '18px 20px', marginTop: 8 }}>
        <div style={{ fontSize: 11, color: '#4090d0', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: '1px solid #4090d020', paddingBottom: 8 }}>
          Add Application to Tracker
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <SLabel text="Application Type" />
            <select value={allTypes.includes(newType) || !newType ? newType : '_other'} onChange={e => setNewType(e.target.value === '_other' ? '' : e.target.value)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: newType ? '#e8e4d8' : '#505068', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              <option value="">Select type…</option>
              {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <SLabel text="Status" />
            <select value={newStatus} onChange={e => setNewStatus(e.target.value as AppStatus)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              {APP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <SLabel text="Date Filed" />
            <input type="date" value={newFiled} onChange={e => setNewFiled(e.target.value)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div>
            <SLabel text="Hearing Date" />
            <input type="date" value={newHearing} onChange={e => setNewHearing(e.target.value)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", boxSizing: 'border-box', outline: 'none' }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <SLabel text="Notes" />
          <input value={newNotes} onChange={e => setNewNotes(e.target.value)}
            placeholder="Optional notes, adjourn date, outcome…"
            style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", boxSizing: 'border-box', outline: 'none' }} />
        </div>
        <Btn label="Add to Tracker" onClick={addEntry} accent="#4090d0" off={!newType.trim()} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ApplicationsEngine({ activeCase }: Props) {
  const { ask, loading, error, clearError } = useAI(activeCase);
  const { fullContext } = useIntelligence(activeCase, 'facts');
  const systemCtx = buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role) + fullContext;

  const [mainTab,     setMainTab]     = useState<MainTab>('new');
  const [stage,       setStage]       = useState<Stage>(1);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>('all');

  // Stage 1
  const [selectedType,    setSelectedType]    = useState<AppTypeConfig | null>(null);
  const [customTypeText,  setCustomTypeText]  = useState('');

  // Stage 2
  const [facts, setFacts] = useState<AppFacts>({ ...DEFAULT_FACTS });

  // Stage 3 — all mover + respondent state in one object
  const [stage3, setStage3] = useState<Stage3Data>({
    applicationRole:      null,
    issues:               [],
    writtenAddress:       '',
    opposingFiled:        false,
    counterAffidavitIn:   '',
    writtenAddressIn:     '',
    fbGrounds:            [],
    furtherBetterDraft:   '',
    replyLawPoints:       '',
    replyLawDraft:        '',
    applicantAffidavit:   '',
    paraResponses:        [],
    respondentNewFacts:   '',
    respondentDeponent:   '',
    respondentExhibits:   '',
    counterAffidavitDraft:'',
    respIssues:           [],
    writtenAddressOpp:    '',
    respOpposingFiled:    false,
    respFBGrounds:        [],
    respFBDraft:          '',
  });

  // Stage 4
  const [generated, setGenerated] = useState('');

  // History
  const [history,        setHistory]        = useState<ApplicationRecord[]>([]);
  const [historyLoaded,  setHistoryLoaded]  = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ApplicationRecord | null>(null);

  const roleColor  = COUNSEL_ROLE_COLORS[activeCase.counsel_role ?? 'claimant_side'];
  const trackColor = MATTER_TRACK_COLORS[activeCase.matter_track ?? 'civil'];

  // Load history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await workerLoad(activeCase.id);
      if (!cancelled) {
        if (remote.length > 0) {
          setHistory(remote);
          await saveBlindSpot(activeCase.id, MODULE, { history: remote });
        } else {
          const local = await loadBlindSpot<SavedData>(activeCase.id, MODULE, { history: [] });
          if (!cancelled) setHistory(local.history ?? []);
        }
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCase.id]);

  async function persistHistory(updated: ApplicationRecord[]) {
    setHistory(updated);
    await saveBlindSpot(activeCase.id, MODULE, { history: updated });
  }

  // Stage 4 — Assemble full package
  const handleAssemble = useCallback(async () => {
    if (!selectedType) return;
    setGenerated('');

    const claimants  = activeCase.claimants.map(p => p.name).join(', ') || 'Claimant';
    const defendants = activeCase.defendants.map(p => p.name).join(', ') || 'Defendant';
    const track      = activeCase.matter_track ?? 'civil';
    const isCriminal = track === 'criminal';
    const partyBlock = isCriminal
      ? `Prosecution: ${claimants}\nDefendant/Accused: ${defendants}`
      : `Claimant(s): ${claimants}\nDefendant(s): ${defendants}`;

    const role         = stage3.applicationRole;
    const isMover      = role === 'mover' || role === null;
    const isRespondent = role === 'respondent';

    // Embed any documents already drafted in Stage 3
    const docSections: string[] = [];
    if (isMover) {
      if (stage3.writtenAddress)     docSections.push(`WRITTEN ADDRESS IN SUPPORT (already drafted — use as-is):\n${stage3.writtenAddress.slice(0,2500)}`);
      if (stage3.furtherBetterDraft) docSections.push(`FURTHER AND BETTER AFFIDAVIT (already drafted — use as-is):\n${stage3.furtherBetterDraft.slice(0,2000)}`);
      if (stage3.replyLawDraft)      docSections.push(`REPLY ON POINTS OF LAW (already drafted — use as-is):\n${stage3.replyLawDraft.slice(0,2000)}`);
    }
    if (isRespondent) {
      if (stage3.counterAffidavitDraft) docSections.push(`COUNTER-AFFIDAVIT (already drafted — use as-is):\n${stage3.counterAffidavitDraft.slice(0,2000)}`);
      if (stage3.writtenAddressOpp)     docSections.push(`WRITTEN ADDRESS IN OPPOSITION (already drafted — use as-is):\n${stage3.writtenAddressOpp.slice(0,2500)}`);
      if (stage3.respFBDraft)           docSections.push(`FURTHER AND BETTER AFFIDAVIT (already drafted — use as-is):\n${stage3.respFBDraft.slice(0,2000)}`);
    }

    // Build package description
    const packageDescription = isRespondent
      ? [
          stage3.counterAffidavitDraft    ? 'Counter-Affidavit (pre-drafted)' : 'Counter-Affidavit',
          stage3.writtenAddressOpp        ? 'Written Address in Opposition (pre-drafted)' : 'Written Address in Opposition',
          stage3.respFBDraft              ? 'Further and Better Affidavit (pre-drafted)' : '',
        ].filter(Boolean).join(', ')
      : [
          ...selectedType.package,
          stage3.furtherBetterDraft ? 'Further and Better Affidavit (pre-drafted)' : '',
          stage3.replyLawDraft      ? 'Reply on Points of Law (pre-drafted)' : '',
        ].filter(Boolean).join(', ');

    const prompt = `Assemble a complete application package for a Nigerian court. Draft every document in full — no placeholders. Court-ready.

CASE: ${activeCase.caseName}
SUIT NO: ${activeCase.suitNo || '[Suit No. TBA]'}
COURT: ${activeCase.court}
${partyBlock}
MATTER TRACK: ${track}
COUNSEL ROLE IN THIS APPLICATION: ${isRespondent ? 'Respondent to Application — opposing the motion' : 'Applicant / Mover — we filed this motion'}
APPLICATION TYPE: ${selectedType.label}
DOCUMENTS TO ASSEMBLE: ${packageDescription}

APPLICATION FACTS:
Parties: ${facts.parties || activeCase.caseName}
${facts.reliefSought    ? 'Relief Sought: ' + facts.reliefSought : ''}
${facts.grounds         ? 'Grounds: ' + facts.grounds : ''}
${facts.deponent        ? 'Affidavit Deponent: ' + facts.deponent : ''}
${facts.keyFacts        ? 'Key Facts: ' + facts.keyFacts : ''}
${facts.additionalContext ? 'Additional Context: ' + facts.additionalContext : ''}

${docSections.length ? '=== PRE-DRAFTED DOCUMENTS (embed as-is) ===\n' + docSections.join('\n\n---\n\n') + '\n=== END PRE-DRAFTED DOCUMENTS ===' : ''}
${String(activeCase.intelligence_data?.intPkg ?? '').slice(0, 1200) ? 'INTELLIGENCE PACKAGE:\n' + String(activeCase.intelligence_data?.intPkg ?? '').slice(0, 1200) : ''}

ASSEMBLY RULES — MANDATORY:
1. Output every document in full, in filing sequence, with a clear bold heading for each.
2. Pre-drafted documents: embed them exactly as provided — do not re-draft or paraphrase.
3. Documents not yet drafted: draft from the facts above using correct Nigerian format.
4. Every document gets full Nigerian court heading: court name, suit number, parties, date line.
5. Affidavit format: numbered paragraphs, first-person deponent voice, jurat: "Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________ Commissioner for Oaths"
6. Counter-Affidavit: paragraph-by-paragraph responses (admit/deny/not within knowledge) + respondent's new facts.
7. Further & Better Affidavit: every paragraph references the specific paragraph of the principal affidavit or counter-affidavit it is premised on or responding to.
8. Written Address: Introduction → Issues for Determination → Arguments (IRAC) → Conclusion and Relief. ${isRespondent ? 'Urge court to REFUSE the application.' : 'Urge court to GRANT the application.'}
9. Reply on Points of Law: responds ONLY to new legal points raised by opposing counsel — no new facts.
10. Bail: community ties, flight risk, gravity of offence, health, dependants.
11. Extension of time: account for every day of delay — Bowaje v Adediwura two-condition test.
12. Stay of execution: good grounds of appeal, special circumstances, balance of hardship.
13. Separate each document with: ---
14. NEVER fabricate case citations. Use [RESEARCH NEEDED] blocks for uncertain authority.

Begin with the first document heading now:`;

    const result = await ask({
      system: systemCtx,
      userMsg: prompt,
      maxTokens: 4500,
      libraryOpts: { queryHint: `${selectedType.label} Nigerian court applications procedure`, topK: 10 },
    });

    if (result) {
      setGenerated(result.trim());
      setStage(4);
    }
  }, [selectedType, facts, stage3, ask, activeCase, systemCtx]);

  const handleSave = useCallback(async () => {
    if (!selectedType || !generated) return;
    const record: ApplicationRecord = {
      id: uid(), caseId: activeCase.id, appType: selectedType.label,
      facts, stage3, documents: generated,
      createdAt: new Date().toISOString(),
    };
    const updated = [record, ...history];
    await persistHistory(updated);
    await workerSave(record);
    alert('Package saved to history.');
  }, [selectedType, generated, facts, stage3, history, activeCase.id]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this application package?')) return;
    const updated = history.filter(r => r.id !== id);
    await persistHistory(updated);
    await workerDelete(id);
    if (selectedRecord?.id === id) setSelectedRecord(null);
  }, [history, selectedRecord]);

  const DEFAULT_STAGE3: Stage3Data = {
    applicationRole: null, issues: [], writtenAddress: '', opposingFiled: false,
    counterAffidavitIn: '', writtenAddressIn: '', fbGrounds: [], furtherBetterDraft: '',
    replyLawPoints: '', replyLawDraft: '', applicantAffidavit: '', paraResponses: [],
    respondentNewFacts: '', respondentDeponent: '', respondentExhibits: '',
    counterAffidavitDraft: '', respIssues: [], writtenAddressOpp: '',
    respOpposingFiled: false, respFBGrounds: [], respFBDraft: '',
  };

  const resetWorkflow = useCallback(() => {
    setStage(1); setSelectedType(null); setCustomTypeText('');
    setFacts({ ...DEFAULT_FACTS }); setStage3({ ...DEFAULT_STAGE3 });
    setGenerated(''); clearError();
  }, [clearError]);

  const filteredTypes = APP_TYPES.filter(t => trackFilter === 'all' || t.track === trackFilter || t.track === 'all');
  const canGoToStage2 = !!selectedType;
  const canGoToStage3 = canGoToStage2 && !!(facts.reliefSought.trim() || facts.grounds.trim());
  const stageLabels   = ['Type', 'Facts', 'Arguments', 'Assemble', 'Track'];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 28px', fontFamily: "'Times New Roman', Times, serif", color: '#e8e4d8' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <span style={{ fontSize: 26, color: '#4090d0' }}>⚡</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f0ece0', letterSpacing: '.02em' }}>
            Applications Engine
          </div>
          <div style={{ fontSize: 12, color: '#6a6a88', marginTop: 2 }}>
            Draft complete application packages — Civil · Criminal · Appeal
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: roleColor.bg, border: `1px solid ${roleColor.bdr}`, color: roleColor.col }}>
            {activeCase.counsel_role?.replace('_', ' ').toUpperCase()}
          </span>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: trackColor.bg, border: `1px solid ${trackColor.bdr}`, color: trackColor.col }}>
            {(activeCase.matter_track ?? 'civil').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Main tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #181828' }}>
        {([['new', '⚡ New Application'], ['tracker', `📋 Tracker`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setMainTab(id as MainTab); if (id === 'tracker') setSelectedRecord(null); }}
            style={{
              background: mainTab === id ? '#181828' : 'transparent',
              color: mainTab === id ? '#f0ece0' : '#505068',
              border: 'none', borderBottom: mainTab === id ? '2px solid #4090d0' : '2px solid transparent',
              padding: '8px 18px', fontSize: 13, cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: mainTab === id ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>

      {/* ══ NEW APPLICATION TAB ══ */}
      {mainTab === 'new' && (
        <div>
          {/* Stage progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            {([1, 2, 3, 4, 5] as const).map((n, i) => (
              <React.Fragment key={n}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: n < stage ? 'pointer' : 'default' }}
                  onClick={() => { if (n < stage) setStage(n); }}
                >
                  <StepBadge n={n} active={stage === n} done={stage > n} />
                  <span style={{ fontSize: 11, color: stage >= n ? '#c8c0b0' : '#404058' }}>{stageLabels[i]}</span>
                </div>
                {i < 4 && <div style={{ flex: 1, height: 1, background: stage > n ? '#4090d0' : '#181828' }} />}
              </React.Fragment>
            ))}
          </div>

          {error && <ErrorBlock message={error} />}

          {/* ── STAGE 1 — Application Type ── */}
          {stage === 1 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={1} active={true} /> &nbsp; Select Application Type
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18 }}>
                Click a type to pre-fill the document package. The engine will build the correct set of documents automatically.
              </div>

              {/* Track filter */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                {(['all', 'civil', 'criminal', 'appeal'] as const).map(t => (
                  <button key={t} onClick={() => setTrackFilter(t)}
                    style={{
                      background: trackFilter === t ? '#181828' : 'transparent',
                      border: trackFilter === t ? '1px solid #4090d0' : '1px solid #282840',
                      color: trackFilter === t ? '#4090d0' : '#505068',
                      borderRadius: 4, padding: '5px 12px', fontSize: 11, cursor: 'pointer',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}>
                    {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Type cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {filteredTypes.map(type => (
                  <button key={type.id} onClick={() => setSelectedType(type)}
                    style={{
                      background: selectedType?.id === type.id ? '#080f1a' : '#080814',
                      border: `1px solid ${selectedType?.id === type.id ? '#4090d0' : '#1e1e34'}`,
                      borderRadius: 7, padding: '12px 16px', textAlign: 'left',
                      cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                    }}>
                    <span style={{ fontSize: 20, opacity: selectedType?.id === type.id ? 1 : 0.5, flexShrink: 0, marginTop: 2 }}>{type.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: selectedType?.id === type.id ? '#f0ece0' : '#a0a0c0', fontWeight: 600, marginBottom: 3 }}>
                        {type.label}
                      </div>
                      <div style={{ fontSize: 11, color: selectedType?.id === type.id ? '#808098' : '#404058', lineHeight: 1.55, marginBottom: 6 }}>
                        {type.hint}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {type.package.map((doc, i) => (
                          <span key={i} style={{ fontSize: 10, color: '#4090d0', background: '#4090d010', border: '1px solid #4090d030', borderRadius: 3, padding: '1px 6px' }}>{doc}</span>
                        ))}
                      </div>
                    </div>
                    {selectedType?.id === type.id && <span style={{ fontSize: 14, color: '#4090d0', flexShrink: 0, marginTop: 2 }}>✓</span>}
                  </button>
                ))}
              </div>

              {/* Custom type fallback */}
              <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '14px 16px', marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: '#808098', marginBottom: 8 }}>Not listed above? Describe the application:</div>
                <TA value={customTypeText} onChange={setCustomTypeText}
                  placeholder="e.g. Application to set aside a default judgment entered against my client — they were not properly served"
                  rows={3} />
                {customTypeText.trim() && (
                  <div style={{ marginTop: 10 }}>
                    <Btn label="Use Custom Description →" accent="#4090d0"
                      onClick={() => setSelectedType({
                        id: 'custom', label: customTypeText.slice(0, 60).trim(), icon: '📄', track: 'all',
                        package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
                        hint: customTypeText,
                      })} />
                  </div>
                )}
              </div>

              <Btn label="Continue to Facts →" onClick={() => setStage(2)} off={!canGoToStage2} accent="#4090d0" />
            </div>
          )}

          {/* ── STAGE 2 — Application Facts ── */}
          {stage === 2 && selectedType && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={2} active={true} /> &nbsp; Application Facts
              </div>

              {/* Type reminder */}
              <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{selectedType.icon}</span>
                <div>
                  <div style={{ fontSize: 13, color: '#4090d0', fontWeight: 600 }}>{selectedType.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {selectedType.package.map((doc, i) => (
                      <span key={i} style={{ fontSize: 10, color: '#4090d0', background: '#4090d010', border: '1px solid #4090d030', borderRadius: 3, padding: '1px 6px' }}>{doc}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
                The Intelligence Engine context is already loaded. Add only what is specific to this application.
              </div>

              <div style={{ marginBottom: 14 }}>
                <SLabel text="Parties (if different from case file)" />
                <TA value={facts.parties} onChange={v => setFacts(p => ({ ...p, parties: v }))}
                  placeholder={`${activeCase.claimants[0]?.name ?? 'Claimant'} v ${activeCase.defendants[0]?.name ?? 'Defendant'}`}
                  rows={2} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <SLabel text="Relief Sought *" />
                <TA value={facts.reliefSought} onChange={v => setFacts(p => ({ ...p, reliefSought: v }))}
                  placeholder="An order that… / A declaration that… / An injunction restraining… / Costs of this application"
                  rows={4} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <SLabel text="Grounds *" />
                <TA value={facts.grounds} onChange={v => setFacts(p => ({ ...p, grounds: v }))}
                  placeholder="Set out the legal and factual grounds. Each ground on a new line."
                  rows={4} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <SLabel text="Affidavit Deponent" />
                <TA value={facts.deponent} onChange={v => setFacts(p => ({ ...p, deponent: v }))}
                  placeholder="e.g. Chukwuemeka Obi, the Claimant / a clerk in the employ of counsel"
                  rows={2} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <SLabel text="Key Facts" />
                <TA value={facts.keyFacts} onChange={v => setFacts(p => ({ ...p, keyFacts: v }))}
                  placeholder="Chronological narrative of material facts — dates, events, documents, communications. These will be sworn to in the affidavit."
                  rows={6} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <SLabel text="Additional Context (counsel's instructions)" />
                <TA value={facts.additionalContext} onChange={v => setFacts(p => ({ ...p, additionalContext: v }))}
                  placeholder="Strategic constraints, recent developments, what opposing counsel is likely to argue…"
                  rows={3} />
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Btn label="← Back" onClick={() => setStage(1)} accent="#505068" small />
                <Btn label="Continue to Arguments →" onClick={() => setStage(3)} off={!canGoToStage3} accent="#4090d0" />
                <Btn label="Skip to Assemble" onClick={() => { setStage(4); handleAssemble(); }}
                  off={!canGoToStage3} loading={loading} accent="#808098" small />
              </div>
            </div>
          )}

          {/* ── STAGE 3 — Argument Builder ── */}
          {stage === 3 && selectedType && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={3} active={true} /> &nbsp; Argument Builder — Written Address
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
                First, tell the engine your role in this application — Applicant/Mover or Respondent.
                The correct document set will appear based on your role and whether the other side has filed a response.
              </div>

              <ArgumentBuilderStage
                activeCase={activeCase} appType={selectedType} facts={facts}
                stage3={stage3} onStage3={setStage3}
                systemCtx={systemCtx}
              />

              <div style={{ display: 'flex', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #181828', flexWrap: 'wrap' }}>
                <Btn label="← Back to Facts" onClick={() => setStage(2)} accent="#505068" small />
                <Btn label="Assemble Full Package →" onClick={() => { setStage(4); handleAssemble(); }} loading={loading} accent="#4090d0" />
              </div>
            </div>
          )}

          {/* ── STAGE 4 — Generated Package ── */}
          {stage === 4 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0' }}>
                  <StepBadge n={4} active={!generated} done={!!generated} /> &nbsp;
                  {loading ? 'Assembling Package…' : `Package — ${selectedType?.label}`}
                </div>
                {generated && !loading && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn label="Save to History" onClick={handleSave} accent="#40a060" small />
                    <Btn label="↻ Re-assemble"   onClick={handleAssemble} loading={loading} accent="#4090d0" small />
                    <Btn label="← Edit Arguments" onClick={() => setStage(3)} accent="#505068" small />
                    <Btn label="New Application"  onClick={resetWorkflow} accent="#808098" small />
                  </div>
                )}
              </div>

              {loading && (
                <div style={{ color: '#4090d0', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
                  ⟳ Drafting {selectedType?.package.join(' · ')}…
                </div>
              )}

              {error && !loading && <ErrorBlock message={error} />}

              {generated && !loading && (
                <div>
                  <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '20px 22px', lineHeight: 1.85, fontSize: 13 }}>
                    <Md text={generated} />
                  </div>

                  <MandatoryNotice />
                </div>
              )}
            </div>
          )}

          {/* ── STAGE 5 — Tracker (accessible via stage bar click) ── */}
          {stage === 5 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={5} active={true} /> &nbsp; Applications Tracker
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18 }}>
                Track every application filed in this matter — status, dates, rulings.
              </div>
              <ApplicationsTracker caseId={activeCase.id} />
            </div>
          )}
        </div>
      )}

      {/* ══ TRACKER TAB ══ */}
      {mainTab === 'tracker' && (
        <div>
          <div style={{ fontSize: 14, color: '#808098', marginBottom: 20, lineHeight: 1.6 }}>
            Track every application filed in this matter. Update status as proceedings advance.
          </div>
          <ApplicationsTracker caseId={activeCase.id} />

          {/* Saved drafts */}
          {historyLoaded && history.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: 13, color: '#4090d0', fontWeight: 700, marginBottom: 14, borderBottom: '1px solid #181828', paddingBottom: 8 }}>
                Saved Drafts ({history.length})
              </div>

              {!selectedRecord ? (
                <div>
                  {history.map(rec => (
                    <div key={rec.id}
                      style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      onClick={() => setSelectedRecord(rec)}>
                      <div>
                        <div style={{ fontSize: 14, color: '#4090d0', fontWeight: 600, marginBottom: 4 }}>{rec.appType}</div>
                        <div style={{ fontSize: 12, color: '#808098' }}>
                          {new Date(rec.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); handleDelete(rec.id); }}
                        style={{ background: 'none', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}>✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <button onClick={() => setSelectedRecord(null)}
                    style={{ background: 'none', border: 'none', color: '#4090d0', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12 }}>
                    ← Back to list
                  </button>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f0ece0', marginBottom: 4 }}>{selectedRecord.appType}</div>
                  <div style={{ fontSize: 12, color: '#505068', marginBottom: 16 }}>
                    {new Date(selectedRecord.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                  <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '20px 22px', lineHeight: 1.85, fontSize: 13 }}>
                    <Md text={selectedRecord.documents} />
                  </div>
                  <MandatoryNotice />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
