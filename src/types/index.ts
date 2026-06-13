/**
 * AFS Advocates — Core Type Definitions
 * Single source of truth for all data shapes used across the system.
 * Every engine, storage layer, and component imports from here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// MATTER TRACK & COUNSEL ROLE — THE TWO GOVERNING FIELDS
// These two fields are set at matter creation and are permanent.
// Every engine, tab, document, AI output, and risk alert derives from them.
// ─────────────────────────────────────────────────────────────────────────────

/** The track of the matter — civil or criminal. */
export type MatterTrack = 'civil' | 'criminal' | 'matrimonial' | 'election' | 'frep';

/**
 * The lawyer's role on this matter.
 * Civil:    claimant_side | defendant_side
 * Criminal: prosecution   | defence
 */
export type CounselRole =
  | 'claimant_side'
  | 'defendant_side'
  | 'prosecution'
  | 'defence';

// ─────────────────────────────────────────────────────────────────────────────
// ORIGINATING PROCESS — set at creation, drives party labels + engine routing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The originating process for civil matters.
 * Drives party designations (Claimant/Applicant/Petitioner etc.) and
 * which engines are foregrounded in the workspace.
 * Criminal matters do not have an originating process — field is undefined.
 */
export type OriginatingProcess =
  | 'writ_of_summons'          // Claimant v Defendant  — HC general civil
  | 'originating_summons'      // Applicant v Respondent — HC uncontested/interpretation
  | 'originating_motion'       // Applicant v Respondent — HC motion-based origination
  | 'petition_matrimonial'     // Petitioner v Respondent — Matrimonial Causes Act
  | 'petition_election'        // Petitioner v Respondent/INEC — Electoral Act
  | 'frep'                     // Applicant v Respondent — Fundamental Rights (O.I FHC Rules)
  | 'other';                   // Custom — lawyer specifies

export interface OriginatingProcessConfig {
  id:            OriginatingProcess;
  label:         string;           // shown in dropdown
  courtNote:     string;           // e.g. "High Court Rules Order 3"
  partyALabel:   string;           // e.g. "Claimant" | "Applicant" | "Petitioner"
  partyBLabel:   string;           // e.g. "Defendant" | "Respondent"
  partyAPlural:  string;
  partyBPlural:  string;
  track:         MatterTrack;      // which matter_track this maps to
  primaryEngine?: string;          // engine tab to foreground (e.g. 'matrimonial')
  description:   string;
}

export const ORIGINATING_PROCESSES: OriginatingProcessConfig[] = [
  {
    id:           'writ_of_summons',
    label:        'Writ of Summons',
    courtNote:    'Order 3 Rule 1, Lagos High Court Rules / FCT HCR',
    partyALabel:  'Claimant',
    partyBLabel:  'Defendant',
    partyAPlural: 'Claimants',
    partyBPlural: 'Defendants',
    track:        'civil',
    description:  'General civil action — liquidated or unliquidated claims, tort, contract.',
  },
  {
    id:           'originating_summons',
    label:        'Originating Summons',
    courtNote:    'Order 3 Rule 4, Lagos HCR — interpretation of documents, uncontested facts',
    partyALabel:  'Applicant',
    partyBLabel:  'Respondent',
    partyAPlural: 'Applicants',
    partyBPlural: 'Respondents',
    track:        'civil',
    description:  'Questions of law or document interpretation where facts are not in dispute.',
  },
  {
    id:           'originating_motion',
    label:        'Originating Motion',
    courtNote:    'Order 3 Rule 5, Lagos HCR — statutory applications',
    partyALabel:  'Applicant',
    partyBLabel:  'Respondent',
    partyAPlural: 'Applicants',
    partyBPlural: 'Respondents',
    track:        'civil',
    description:  'Statutory applications where the enabling legislation prescribes a motion.',
  },
  {
    id:           'petition_matrimonial',
    label:        'Petition — Matrimonial Causes',
    courtNote:    'Matrimonial Causes Act Cap M7 LFN 2004',
    partyALabel:  'Petitioner',
    partyBLabel:  'Respondent',
    partyAPlural: 'Petitioners',
    partyBPlural: 'Respondents',
    track:        'matrimonial',
    primaryEngine: 'matrimonial',
    description:  'Dissolution of marriage, nullity, judicial separation, and ancillary reliefs.',
  },
  {
    id:           'petition_election',
    label:        'Petition — Election',
    courtNote:    'Electoral Act 2022 s.133 / Election Tribunal Rules',
    partyALabel:  'Petitioner',
    partyBLabel:  'Respondent',
    partyAPlural: 'Petitioners',
    partyBPlural: 'Respondents (including INEC)',
    track:        'election',
    description:  'Election petition challenging the conduct or result of an election.',
  },
  {
    id:           'frep',
    label:        'Fundamental Rights Enforcement',
    courtNote:    'Fundamental Rights (Enforcement Procedure) Rules 2009 — O.I FHC / HC',
    partyALabel:  'Applicant',
    partyBLabel:  'Respondent',
    partyAPlural: 'Applicants',
    partyBPlural: 'Respondents',
    track:        'frep',
    description:  'Enforcement of Chapter IV rights — liberty, dignity, fair hearing, privacy.',
  },
  {
    id:           'other',
    label:        'Other / Custom',
    courtNote:    'Specify in matter details',
    partyALabel:  'Party A',
    partyBLabel:  'Party B',
    partyAPlural: 'Parties A',
    partyBPlural: 'Parties B',
    track:        'civil',
    description:  'Any other originating process not listed above.',
  },
];

/** Lookup helper — returns config for a given originating process id */
export function getOriginatingProcess(id: OriginatingProcess | undefined): OriginatingProcessConfig {
  return ORIGINATING_PROCESSES.find(p => p.id === id) ?? ORIGINATING_PROCESSES[0];
}

/** Human-readable labels for display throughout the UI. */
export const MATTER_TRACK_LABELS: Record<string, string> = {
  civil:       'Civil',
  criminal:    'Criminal',
  matrimonial: 'Matrimonial',
  election:    'Election',
  frep:        'Fundamental Rights',
};

export const COUNSEL_ROLE_LABELS: Record<CounselRole, string> = {
  claimant_side: 'Claimant Side',
  defendant_side: 'Defendant Side',
  prosecution:   'Prosecution',
  defence:       'Defence',
};

/** Accent colours for role badges throughout the UI — white newspaper canvas. */
export const COUNSEL_ROLE_COLORS: Record<CounselRole, { bg: string; bdr: string; col: string }> = {
  claimant_side:  { bg: '#edf3fb', bdr: '#b8cfe8', col: '#1a4a8a' },
  defendant_side: { bg: '#fbeaea', bdr: '#e0b8b8', col: '#7a1a1a' },
  prosecution:    { bg: '#fdf3e0', bdr: '#e0cfa0', col: '#7a4a00' },
  defence:        { bg: '#e8f5ee', bdr: '#a8d0b8', col: '#1a5a30' },
};

/** Track accent colours — white newspaper canvas. */
export const MATTER_TRACK_COLORS: Record<string, { bg: string; bdr: string; col: string }> = {
  civil:       { bg: '#f3f0fb', bdr: '#ccc0e8', col: '#4a3080' },
  criminal:    { bg: '#fdf0e8', bdr: '#e0c8a0', col: '#7a4000' },
  matrimonial: { bg: '#fbeaf3', bdr: '#e0b8d0', col: '#7a1a4a' },
  election:    { bg: '#eaf3ea', bdr: '#b8d0b8', col: '#1a4a1a' },
  frep:        { bg: '#fdf5e0', bdr: '#e0d0a0', col: '#6a4a00' },
};

/**
 * Given a matter_track, returns the valid CounselRole values for that track.
 */
export function rolesForTrack(track: MatterTrack | string): CounselRole[] {
  if (track === 'criminal') return ['prosecution', 'defence'];
  // civil, matrimonial, election, frep — all use claimant/defendant side roles
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
  matter_track?:       MatterTrack | string;
  counsel_role?:       CounselRole;

  /**
   * THE ORIGINATING PROCESS — set at creation for civil/special matters.
   * Drives party labels (Claimant vs Applicant vs Petitioner etc.),
   * which engines are foregrounded, and which court rules apply.
   * Undefined for criminal matters.
   */
  originating_process?: OriginatingProcess;

  /**
   * Custom party labels — used when originating_process === 'other'
   * or when the court rules for the specific court differ from defaults.
   */
  custom_party_a_label?: string;
  custom_party_b_label?: string;

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
  appeal_data?:        AppealData;
  inheritance_data?:   InheritanceData;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE VAULT
// ─────────────────────────────────────────────────────────────────────────────

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
  type:        'text' | 'image';
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
  queryHint?:  string;
  topK?:       number;
  namespace?:  string;
  filter?:     Record<string, string>;
  threshold?:  number;
}

export interface ApiRequestOptions {
  system?:       string;
  userMsg?:      string;
  messages?:     ApiMessage[];
  maxTokens?:    number;
  mcpDrive?:     boolean;
  skipLibrary?:  boolean;
  libraryOpts?:  LibraryQueryOpts;
  matter_track?: MatterTrack | string;
  counsel_role?: CounselRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI STATE
// ─────────────────────────────────────────────────────────────────────────────

export type AppView =
  | 'gate'
  | 'home'
  | 'docket'
  | 'engine'
  | 'resolver'
  | 'san'
  | 'settings';

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
