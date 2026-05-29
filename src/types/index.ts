/**
 * AFS Advocates — Core Type Definitions
 * Single source of truth for all data shapes used across the system.
 * Every engine, storage layer, and component imports from here.
 */

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
  role:                'Claimant' | 'Defendant' | 'Appellant' | 'Respondent' | string;
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

export interface ApiRequestOptions {
  system?:    string;
  userMsg?:   string;
  messages?:  ApiMessage[];
  maxTokens?: number;
  mcpDrive?:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI STATE
// ─────────────────────────────────────────────────────────────────────────────

export type AppView =
  | 'gate'        // password screen
  | 'home'        // mode selector
  | 'docket'      // case docket overlay
  | 'engine'      // active case dashboard
  | 'resolver';   // Research Resolver standalone tool

export type DashTabId =
  | 'overview' | 'intelligence' | 'appeal' | 'builder' | 'docket'
  | 'evidence' | 'filings' | 'timeline' | 'research' | 'san'
  | 'briefme' | 'inheritance' | 'blindspots' | 'crossexam'
  | 'compliance' | 'authority' | 'risk' | 'warroom' | 'console'
  | 'criminal' | 'matrimonial';
