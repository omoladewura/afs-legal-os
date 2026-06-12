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
export type MatterTrack = 'civil' | 'criminal';

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

/** Human-readable labels for display throughout the UI. */
export const MATTER_TRACK_LABELS: Record<MatterTrack, string> = {
  civil:    'Civil',
  criminal: 'Criminal',
};

export const COUNSEL_ROLE_LABELS: Record<CounselRole, string> = {
  claimant_side: 'Claimant Side',
  defendant_side: 'Defendant Side',
  prosecution:   'Prosecution',
  defence:       'Defence',
};

/** Accent colours for role badges throughout the UI. */
export const COUNSEL_ROLE_COLORS: Record<CounselRole, { bg: string; bdr: string; col: string }> = {
  claimant_side:  { bg: '#071828', bdr: '#1a4060', col: '#4090d0' },
  defendant_side: { bg: '#180808', bdr: '#401820', col: '#c06060' },
  prosecution:    { bg: '#181000', bdr: '#403000', col: '#c09030' },
  defence:        { bg: '#071a0e', bdr: '#1a4028', col: '#40a860' },
};

/** Track accent colours. */
export const MATTER_TRACK_COLORS: Record<MatterTrack, { bg: string; bdr: string; col: string }> = {
  civil:    { bg: '#0a0818', bdr: '#201840', col: '#8060c0' },
  criminal: { bg: '#180a00', bdr: '#402000', col: '#c07030' },
};

/**
 * Given a matter_track, returns the valid CounselRole values for that track.
 */
export function rolesForTrack(track: MatterTrack): CounselRole[] {
  return track === 'civil'
    ? ['claimant_side', 'defendant_side']
    : ['prosecution', 'defence'];
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
}

// ─────────────────────────────────────────────────────────────────────────────
// UI STATE
// ─────────────────────────────────────────────────────────────────────────────

export type AppView =
  | 'gate'        // password screen
  | 'home'        // mode selector
  | 'docket'      // case docket overlay
  | 'engine'      // active case dashboard
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
  | 'pleadings' | 'motions' | 'enforcement';
