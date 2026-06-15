/**
 * AFS Advocates — Core Type Definitions
 * Single source of truth for all data shapes used across the system.
 * Every engine, storage layer, and component imports from here.
 */

// Re-export matrimonial types so engines can import from '@/types'
export type { MatrimonialCaseData, MatrimonialChild, MatrimonialReliefType, DissolutionFact, NullityVoidGround, NullityVoidableGround } from '@/matrimonial/types';
import type { MatrimonialCaseData } from '@/matrimonial/types';

// ─────────────────────────────────────────────────────────────────────────────
// MATTER TRACK & COUNSEL ROLE — THE TWO GOVERNING FIELDS
// These two fields are set at matter creation and are permanent.
// Every engine, tab, document, AI output, and risk alert derives from them.
// ─────────────────────────────────────────────────────────────────────────────

/** The track of the matter — civil, criminal, or matrimonial. */
export type MatterTrack = 'civil' | 'criminal' | 'matrimonial';

/**
 * The lawyer's role on this matter.
 * Civil:        claimant_side   | defendant_side
 * Criminal:     prosecution     | defence
 * Matrimonial:  petitioner_side | respondent_side
 * FREP:         frep_applicant  | frep_respondent
 */
export type CounselRole =
  | 'claimant_side'
  | 'defendant_side'
  | 'prosecution'
  | 'defence'
  | 'petitioner_side'
  | 'respondent_side'
  | 'frep_applicant'
  | 'frep_respondent';

/** Human-readable labels for display throughout the UI. */
export const MATTER_TRACK_LABELS: Record<MatterTrack, string> = {
  civil:        'Civil',
  criminal:     'Criminal',
  matrimonial:  'Matrimonial',
};

export const COUNSEL_ROLE_LABELS: Record<CounselRole, string> = {
  claimant_side:   'Claimant Side',
  defendant_side:  'Defendant Side',
  prosecution:     'Prosecution',
  defence:         'Defence',
  petitioner_side: 'Petitioner Side',
  respondent_side: 'Respondent Side',
  frep_applicant:  'Applicant (FREP)',
  frep_respondent: 'Respondent (FREP)',
};

/** Accent colours for role badges throughout the UI — white newspaper canvas. */
export const COUNSEL_ROLE_COLORS: Record<CounselRole, { bg: string; bdr: string; col: string }> = {
  claimant_side:   { bg: '#edf3fb', bdr: '#b8cfe8', col: '#1a4a8a' },
  defendant_side:  { bg: '#fbeaea', bdr: '#e0b8b8', col: '#7a1a1a' },
  prosecution:     { bg: '#fdf3e0', bdr: '#e0cfa0', col: '#7a4a00' },
  defence:         { bg: '#e8f5ee', bdr: '#a8d0b8', col: '#1a5a30' },
  petitioner_side: { bg: '#f5edfb', bdr: '#ccb8e8', col: '#4a1a7a' },
  respondent_side: { bg: '#fbedf5', bdr: '#e8b8d4', col: '#7a1a4a' },
  frep_applicant:  { bg: '#edf5f0', bdr: '#a8d4bc', col: '#1a5a38' },
  frep_respondent: { bg: '#fdf0ea', bdr: '#e0c0a8', col: '#7a3010' },
};

/** Track accent colours — white newspaper canvas. */
export const MATTER_TRACK_COLORS: Record<MatterTrack, { bg: string; bdr: string; col: string }> = {
  civil:       { bg: '#f3f0fb', bdr: '#ccc0e8', col: '#4a3080' },
  criminal:    { bg: '#fdf0e8', bdr: '#e0c8a0', col: '#7a4000' },
  matrimonial: { bg: '#f5edfb', bdr: '#ccb8e8', col: '#4a1a7a' },
};

/**
 * Given a matter_track, returns the valid CounselRole values for that track.
 *
 * Note: FREP roles (frep_applicant / frep_respondent) are not returned here
 * because FREP cases share the 'civil' matter_track. Role selection for FREP
 * matters is gated on originating_process === 'frep' in the case-creation
 * flow (HomePage / CaseDashboard), which presents frep_applicant and
 * frep_respondent instead of claimant_side / defendant_side.
 */
export function rolesForTrack(track: MatterTrack): CounselRole[] {
  if (track === 'criminal')    return ['prosecution', 'defence'];
  if (track === 'matrimonial') return ['petitioner_side', 'respondent_side'];
  return ['claimant_side', 'defendant_side'];
}

/**
 * Returns the two valid CounselRole values for a given originating_process.
 * Use this instead of rolesForTrack() anywhere the originating_process is known.
 */
export function rolesForOriginatingProcess(op: OriginatingProcess | string | undefined): CounselRole[] {
  if (op === 'frep')               return ['frep_applicant', 'frep_respondent'];
  if (op === 'petition_matrimonial') return ['petitioner_side', 'respondent_side'];
  const cfg = getOriginatingProcess(op);
  if (cfg.track === 'criminal')    return ['prosecution', 'defence'];
  return ['claimant_side', 'defendant_side'];
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE & DOCKET
// ─────────────────────────────────────────────────────────────────────────────

export interface Party {
  id:   string;
  name: string;
}

export interface DocketEntry {
  id:                string;
  caseId:            string;        // FK → Case.id
  dateFiled:         string;        // YYYY-MM-DD
  filedBy:           string;
  docTitle:          string;
  notes:             string;
  docType:           string;
  nextAdjournedDate: string;
  status:            string;
  attachment:        FileAttachment | null;
  createdAt:         string;        // ISO timestamp
}

export interface FileAttachment {
  name: string;
  type: string;
  data: string;   // base64 data URL
  size: number;
}

export interface Deadline {
  id:          string;
  label:       string;
  date:        string;   // YYYY-MM-DD
  type:        string;
  status:      string;   // 'Active' | 'Dismissed'
  notes:       string;
  aiGenerated: boolean;
  caseId:      string;
}

export interface IntelligenceData {
  // Pipeline state
  stage:        number;
  rawFacts:     string;
  intPkg:       string;

  // Step 2 extraction output (structured JSON from AI)
  extraction?: {
    timeline?:           Array<{ date: string; event: string; significance?: string }>;
    established_facts?:  string[];
    disputed_areas?:     string[];
    legal_issues?:       string[];
    evidence_mentioned?: string[];
    gaps_identified?:    string[];
    initial_risks?:      Array<{ risk: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  };

  // Step 3 follow-up Q&A
  followUpQs?: Array<{ id: string; question: string; purpose?: string }>;
  followUpAs?: Record<string, string>;

  // Step 4 evidence matrix
  evidenceM?: Array<{
    issue:              string;
    evidence_needed:    string[];
    evidence_available: string[];
    evidence_missing:   string[];
    priority:           'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    notes?:             string;
  }>;

  // Flat fields kept for backwards compatibility with other engines
  // that read intelligence_data.facts / legal_issues etc.
  facts?:        string;
  legal_issues?: string;
  disputes?:     string;
  risks?:        string;
}

export interface AppealData {
  court:           string;
  role:            'appellant' | 'respondent';
  judgmentText:    string;
  lowerRecord:     string;
  extractedGrounds: string;
  crossLevelIssues: string;
  package:         string;
  // timestamps
  _createdAt?:     string;
}

export interface InheritanceRisk {
  risk:     string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  detail:   string;
  action:   string;
}

export interface InheritanceData {
  _auditDate:    string;
  _uploadNames?: string[];

  state_of_case: string;
  what_was_done: string[];

  gap_report: {
    not_done:     string[];
    errors_made:  string[];
    too_late:     string[];
    can_be_saved: string[];
  };

  risk_register: InheritanceRisk[];

  inheritance_package: {
    current_posture:              string;
    immediate_actions:            string[];
    remaining_steps:              string[];
    strategy_options:             string;
    recommended_starting_posture: string;
  };
}

export interface Case {
  id:                  string;
  caseName:            string;
  court:               string;
  suitNo:              string;
  dateCommenced:       string;

  /**
   * THE TWO GOVERNING FIELDS — set at creation, permanent.
   * matter_track drives which procedural chain the matter follows.
   * counsel_role drives every tab, engine output, AI prompt, and risk alert.
   *
   * Legacy matters (created before V2) will not have these fields set.
   * All code that reads them must handle undefined gracefully by falling
   * back to neutral / civil / claimant_side defaults.
   */
  matter_track?:       MatterTrack;
  counsel_role?:       CounselRole;

  /** Legacy role field — kept for backwards compatibility with V1 data. */
  role:                'Claimant' | 'Defendant' | 'Appellant' | 'Respondent' | string;

  /**
   * The current procedural stage ID — matches a ProceduralStage.id from ROLE_STAGES.
   * Set manually via the "Update Stage" action or auto-detected from docket entries.
   * Used by ProceduralTimeline and computeNextAction to show correct stage highlighting.
   */
  current_stage?:      string;

  claimants:           Party[];
  defendants:          Party[];
  createdAt:           string;
  compressed_summary:  string;
  recent_entries:      DocketEntry[];
  deadlines?:          Deadline[];
  intelligence_data?:  IntelligenceData;

  /**
   * Counsel instructions — free-form strategy notes and directives added by the lawyer.
   * Injected into every engine's AI calls via useIntelligence().
   */
  counsel_instructions?: string;

  /**
   * Originating process — civil matters only.
   * Drives party labels across all engines.
   */
  originating_process?:    OriginatingProcess;

  /**
   * Counsel override labels — takes priority over originating_process derived labels.
   * Set per-case when the default label doesn't fit (e.g. "1st Petitioner").
   */
  custom_party_a_label?:   string;
  custom_party_b_label?:   string;
  appeal_data?:        AppealData;
  inheritance_data?:   InheritanceData;

  /**
   * Matrimonial structured state — populated by MIntelligence and all
   * matrimonial engines. Stored in its own slot; never touches blindSpots.
   * Two reads on case load, parallelised with Promise.all.
   */
  matrimonial_data?:   MatrimonialCaseData;

  /**
   * FREP structured state — populated at intake for Fundamental Rights
   * Enforcement Proceedings matters (originating_process === 'frep').
   * Absent on all non-FREP matters; never read or written by civil /
   * criminal / matrimonial engines.
   */
  frep_data?:          FrepData;
}

// ─────────────────────────────────────────────────────────────────────────────
// FREP — FUNDAMENTAL RIGHTS ENFORCEMENT PROCEEDINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capacity / representation of the applicant in a FREP matter.
 * Set at intake; drives party label rendering and estate-claim warnings.
 */
export type FrepCapacity =
  | 'self'
  | 'next_friend'         // infant / minor
  | 'guardian_ad_litem'   // person without legal capacity
  | 'corporate'
  | 'association'
  | 'public_interest';

/**
 * Originating process mode chosen for the FREP application.
 * Defaults to originating_motion. Locked once the matter reaches
 * the application_filed stage (mode_locked: true).
 */
export type FrepMode = 'originating_motion' | 'originating_summons';

/**
 * Parallel status of any ex parte / interim relief order.
 * Tracked as a badge in FOverview alongside the main procedural stage.
 * Runs independently of the main application stage — an interim order
 * can be 'granted' while the main matter is still at 'awaiting_response'.
 */
export type FrepInterimReliefStatus = 'not_sought' | 'pending' | 'granted' | 'discharged';

/**
 * Output of the FIntelligence jurisdiction gate (Step 0).
 * 'pass'  — matter is within FREP jurisdiction; proceed to drafting.
 * 'flag'  — potential jurisdiction concern; counsel advised but not hard-blocked.
 * 'fail'  — matter appears outside FREP jurisdiction; strong warning surfaced.
 * null    — gate has not yet been run.
 */
export type FrepJurisdictionGate = 'pass' | 'flag' | 'fail' | null;

/**
 * Branch taken by the respondent's opposition.
 * Determines which documents the Applications Engine generates on the
 * respondent side and whether silence on the applicant's affidavit
 * constitutes an admission.
 *
 * 'factual'  → Counter-Affidavit + Written Address required (5-day window).
 * 'law_only' → Written Address only; PO grounds folded in; silence = admission.
 * null       → not yet determined; engine prompts respondent to select.
 */
export type FrepRespondentOppositionType = 'factual' | 'law_only' | null;

/**
 * Structured FREP-specific state for a Case.
 * Populated at intake and updated throughout the matter lifecycle.
 * Stored in Case.frep_data; absent on non-FREP matters.
 */
export interface FrepData {
  // ── Intake fields (set at case creation) ──────────────────────────────────
  /** Capacity / representation of the applicant. */
  capacity:                   FrepCapacity;
  /** Originating process mode. Defaults to 'originating_motion'. */
  mode:                       FrepMode;
  /** True once the matter reaches application_filed stage. Mode selector disabled. */
  mode_locked:                boolean;
  /** True if ex parte / urgency relief is sought alongside the main application. */
  ex_parte_sought:            boolean;

  // ── Parallel interim relief tracker (§A1) ─────────────────────────────────
  /**
   * Status of any ex parte / interim order.
   * Shown as a badge in FOverview independently of the main stage.
   * Set to 'discharged' automatically when the main ruling records
   * "Discharge of Interim Order" as one of the reliefs granted.
   */
  interim_relief_status:      FrepInterimReliefStatus;

  // ── Amendment tracking (§B5) ──────────────────────────────────────────────
  /** ISO date by which an amendment to the Statement must be filed. Null if no amendment granted. */
  amendment_deadline:         string | null;
  /** True once the amended Statement has been filed within the deadline. */
  amendment_filed:            boolean;

  // ── Jurisdiction gate output (§C) ─────────────────────────────────────────
  /** Result of the FIntelligence jurisdiction gate. */
  jurisdiction_gate:          FrepJurisdictionGate;
  /** Human-readable explanation when gate is 'flag' or 'fail'. */
  jurisdiction_flag_reason:   string | null;
  /** Court identified by the gate (e.g. 'Federal High Court'). */
  jurisdiction_court:         string | null;
  /** Division identified by the gate (e.g. 'Lagos Division'). */
  jurisdiction_division:      string | null;

  // ── Respondent opposition branch (§A3) ────────────────────────────────────
  /**
   * Whether the respondent's opposition is factual (Counter-Affidavit required)
   * or law-only (Written Address only; no Counter-Affidavit needed).
   * Null until respondent counsel selects the branch.
   */
  respondent_opposition_type: FrepRespondentOppositionType;
}



export interface EvidenceItem {
  id:        string;
  caseId:    string;
  category:  string;
  filename:  string;
  fileType:  string;
  fileSize:  number;
  notes:     string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARGUMENT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export interface ArgumentVersion {
  id:        string;
  label:     string;
  argType:   string;
  argIssue:  string;
  content:   string;
  createdAt: string;
  driveRAG:  boolean;
  selCount:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAN MODE
// ─────────────────────────────────────────────────────────────────────────────

export interface SanMessage {
  role:    'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type:        'text' | 'image' | 'document';
  text?:       string;
  source?:     { type: 'base64'; media_type: string; data: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORITY VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface Authority {
  id:          string;
  caseName:    string;
  citation:    string;
  court:       string;
  year:        string;
  principle:   string;
  bindingFor:  string;
  addedAt:     string;
  validated:   boolean;
  validation?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-EXAMINATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface WitnessProfile {
  id:          string;
  name:        string;
  role:        string;
  summary:     string;
  weakness:    string;
  strategy:    string;
  questions:   string;
  addedAt:     string;
}

export interface ImpeachmentWeapon {
  id:      string;
  witness: string;
  type:    string;
  weapon:  string;
  impact:  string;
  addedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLIND SPOTS
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictCheck {
  parties:    string;
  counsel:    string;
  result:     string;
  cleared:    boolean;
  checkedAt?: string;
}

export interface SettlementOffer {
  id:          string;
  side:        'ours' | 'theirs';
  amount:      string;
  description: string;
  date:        string;
  status:      'Live' | 'Accepted' | 'Rejected' | 'Lapsed';
}

export interface ClientComm {
  id:           string;
  type:         string;
  summary:      string;
  instructions: string;
  date:         string;
  flagged:      boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskResult {
  verdict:        string;
  recommendation: string;
  stage:          string;
  timestamp:      string;
  scores:         Record<string, number>;
  reasoning:      Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiMessage {
  role:    'user' | 'assistant';
  content: string | ContentBlock[];
}

/** Options for per-call library RAG tuning */
export interface LibraryQueryOpts {
  /** Extra semantic hint to improve embedding quality (e.g. "cross-examination Nigerian Evidence Act") */
  queryHint?:  string;
  /** How many Vectorize results to pull. Default: 8 */
  topK?:       number;
  /** Vectorize namespace (e.g. 'statutes', 'authorities') */
  namespace?:  string;
  /** Metadata filter e.g. { type: 'statute' } or { caseId: 'abc123' } */
  filter?:     Record<string, string>;
  /** Minimum similarity score 0–1. Default: 0.70 */
  threshold?:  number;
}

export interface ApiRequestOptions {
  system?:       string;
  userMsg?:      string;
  messages?:     ApiMessage[];
  maxTokens?:    number;
  mcpDrive?:     boolean;
  /**
   * Set true to bypass the library RAG layer entirely.
   * Use only for non-legal utility calls (formatting, password checks, etc.)
   */
  skipLibrary?:  boolean;
  /**
   * Per-call library options — tune topK, namespace, filter, threshold.
   * Defaults are sensible for general legal queries.
   */
  libraryOpts?:  LibraryQueryOpts;
  /**
   * THE TWO GOVERNING FIELDS — passed to the Cloudflare Worker so it can
   * filter Vectorize retrieval to role-appropriate library materials.
   * Set automatically by useAI() when activeCase is provided.
   * Engines using callClaude() directly should set these explicitly.
   */
  matter_track?: MatterTrack;
  counsel_role?: CounselRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI STATE
// ─────────────────────────────────────────────────────────────────────────────

export type AppView =
  | 'gate'        // password screen
  | 'home'        // mode selector
  | 'docket'      // case docket overlay
  | 'engine'      // active case dashboard (civil / criminal)
  | 'matrimonial' // matrimonial case workspace
  | 'resolver'    // Research Resolver standalone tool
  | 'san'         // SAN Mode standalone
  | 'settings';   // Settings panel (library management, system info) 

export type DashTabId =
  | 'overview' | 'intelligence' | 'appeal' | 'builder' | 'docket'
  | 'evidence' | 'filings' | 'timeline' | 'research' | 'san'
  | 'briefme' | 'inheritance' | 'blindspots' | 'crossexam'
  | 'compliance' | 'authority' | 'risk' | 'warroom' | 'console'
  | 'criminal' | 'matrimonial' | 'copilot'
  // Phase 6A — Criminal procedural engines
  | 'charge_arraignment' | 'plea'
  // Phase 6B — Core trial engines
  | 'prosecution_case' | 'no_case'
  // Phase 6C — Sentencing Engine
  | 'sentencing'
  // Phase 7 — Civil Engines
  | 'pleadings' | 'motions' | 'enforcement'
  // Phase 7 Automation — Role-specific Alerts
  | 'alerts'
  // Phase A — Missing Criminal Engines
  | 'defence_case' | 'final_address'
  // Phase B — Applications Engine
  | 'applications'
  // Phase D — Synthesis Engine
  | 'synthesis';

// ─────────────────────────────────────────────────────────────────────────────
// ORIGINATING PROCESS
// ─────────────────────────────────────────────────────────────────────────────

export type OriginatingProcess =
  | 'writ_of_summons'
  | 'originating_summons'
  | 'originating_motion'
  | 'petition_matrimonial'
  | 'petition_election'
  | 'frep'
  | 'other';

export interface OriginatingProcessConfig {
  id:           OriginatingProcess;
  label:        string;
  partyALabel:  string;
  partyBLabel:  string;
  partyAPlural: string;
  partyBPlural: string;
  /** Derived matter_track for this originating process */
  track:        'civil' | 'criminal' | 'matrimonial';
}

export const ORIGINATING_PROCESSES: OriginatingProcessConfig[] = [
  {
    id:           'writ_of_summons',
    label:        'Writ of Summons',
    partyALabel:  'Claimant',
    partyBLabel:  'Defendant',
    partyAPlural: 'Claimants',
    partyBPlural: 'Defendants',
    track:        'civil',
  },
  {
    id:           'originating_summons',
    label:        'Originating Summons',
    partyALabel:  'Applicant',
    partyBLabel:  'Respondent',
    partyAPlural: 'Applicants',
    partyBPlural: 'Respondents',
    track:        'civil',
  },
  {
    id:           'originating_motion',
    label:        'Originating Motion',
    partyALabel:  'Applicant',
    partyBLabel:  'Respondent',
    partyAPlural: 'Applicants',
    partyBPlural: 'Respondents',
    track:        'civil',
  },
  {
    id:           'petition_matrimonial',
    label:        'Petition (Matrimonial)',
    partyALabel:  'Petitioner',
    partyBLabel:  'Respondent',
    partyAPlural: 'Petitioners',
    partyBPlural: 'Respondents',
    track:        'matrimonial',
  },
  {
    id:           'petition_election',
    label:        'Petition (Election)',
    partyALabel:  'Petitioner',
    partyBLabel:  'Respondent',
    partyAPlural: 'Petitioners',
    partyBPlural: 'Respondents',
    track:        'civil',
  },
  {
    id:           'frep',
    label:        'Fundamental Rights (FREP)',
    partyALabel:  'Applicant',
    partyBLabel:  'Respondent',
    partyAPlural: 'Applicants',
    partyBPlural: 'Respondents',
    track:        'civil',
  },
  {
    id:           'other',
    label:        'Other / Custom',
    partyALabel:  'Party A',
    partyBLabel:  'Party B',
    partyAPlural: 'Party A',
    partyBPlural: 'Party B',
    track:        'civil',
  },
];

const _origProcMap = new Map(ORIGINATING_PROCESSES.map(p => [p.id, p]));

export function getOriginatingProcess(
  id?: OriginatingProcess | string,
): OriginatingProcessConfig {
  return _origProcMap.get(id as OriginatingProcess)
    ?? ORIGINATING_PROCESSES[0]; // default: writ_of_summons
}
