/**
 * AFS Legal OS — Cross-Examination Tree Types
 * Phase 3A: Schema
 *
 * BUILD ORDER NOTE:
 * This file (1 of 2) must exist before src/storage/db.ts is patched (2 of 2).
 * It has zero imports from the rest of the codebase — it is the root of the
 * cross-examination dependency tree.
 *
 * CONSUMED BY:
 *   - src/storage/db.ts          (table declaration)
 *   - Phase 3B topic-selection UI
 *   - Phase 3C/3D generation logic
 *   - Phase 3E validator
 *   - Phase 3F review/edit UI
 *   - Phase 4 Courtroom Walker
 *   - Phase 5 post-session integration
 */

// ─────────────────────────────────────────────────────────────────────────────
// Node tier — controls visual hierarchy in the tree walker
// ─────────────────────────────────────────────────────────────────────────────

export type CrossExamTier =
  | 'opener'          // First commitment question in a line — establishes the premise
  | 'escalation'      // Deepens the line toward the target admission
  | 'climax'          // The admission / contradiction-trigger question itself
  | 'recovery'        // Fallback branch when the witness evades or hedges
  | 'contradiction';  // Pre-built detour node — fires on unexpected answer

// ─────────────────────────────────────────────────────────────────────────────
// Strategic purpose tag — every node must carry exactly one
// (Validator gate 2: "Declared strategic purpose gate")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A node is tagged to EITHER a Case Theory element it advances
 * OR a specific opposing weakness it attacks — never neither.
 */
export type NodePurpose =
  | { kind: 'theory_element'; elementLabel: string }   // references CaseTheoryRecord element
  | { kind: 'opposing_weakness'; weaknessLabel: string };

// ─────────────────────────────────────────────────────────────────────────────
// Contradiction detour — pre-built when expectedAnswer is set
// (Phase 3D′)
// ─────────────────────────────────────────────────────────────────────────────

export interface ContradictionDetour {
  /**
   * The citation reference to surface to counsel.
   * e.g. "Witness Statement, para 14" or "Exhibit C, p.3"
   */
  citationRef: string;

  /**
   * The declarative "I put it to you…" question.
   * Never echoes the witness's answer verbatim.
   * Avoids double-negative formulations.
   */
  putToYouQuestion: string;

  /**
   * Credibility-challenge question to follow immediately.
   * Does not assume yes/no — counsel decides at runtime.
   */
  credibilityQuestion: string;

  /**
   * The node id to rejoin in the main tree after the detour completes.
   * Typically the yesNext or noNext of the node that triggered the detour.
   */
  rejoinNodeId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core tree node
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamNode {
  /** UUID — unique within the tree */
  id: string;

  /**
   * The question counsel puts to the witness.
   * Phrased for a closed Yes/No answer.
   */
  question: string;

  /**
   * The answer the witness is *expected* to give based on:
   *   (a) witness statement / deposition
   *   (b) established_facts from Intelligence Engine extraction
   * Required before a tree is marked trial-ready (Validator gate 1).
   * When the live answer diverges from this, contradictionDetour fires.
   */
  expectedAnswer?: 'YES' | 'NO';

  /**
   * Source grounding for expectedAnswer.
   * Must reference a real document / exhibit / established fact.
   * e.g. "Witness Statement §12" | "Exhibit B, p.4" | "Established fact #3"
   */
  expectedAnswerSource?: string;

  /**
   * Next node id when witness answers YES.
   * null = terminal node (admission reached or topic exhausted).
   */
  yesNext: string | null;

  /**
   * Next node id when witness answers NO.
   * null = terminal node.
   */
  noNext: string | null;

  /** Whether this node ends a branch. Counsel is shown a stop prompt. */
  terminal: boolean;

  /**
   * What a terminal node means strategically.
   * Only meaningful when terminal === true.
   */
  terminalKind?: 'admission_reached' | 'content_exhausted';

  /** Strategic purpose — required for Validator gate 2 */
  purpose: NodePurpose;

  /** Tier controls visual hierarchy in the courtroom walker */
  tier: CrossExamTier;

  /**
   * Pre-built contradiction detour.
   * Present whenever expectedAnswer is set and the citation pass
   * (Phase 3D′) has completed for this node.
   * Fires when the live answer ≠ expectedAnswer.
   */
  contradictionDetour?: ContradictionDetour;

  /**
   * Whether this node was inserted manually by counsel during a live session.
   * Manual nodes are logged but not part of the generated tree.
   */
  isManual?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic tree (one per witness × topic combination)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-topic Yes/No polarity flag.
 * Controls which answer colour (YES = red, NO = green) moves toward the
 * target admission for this entire topic.
 * Counsel can override per topic in the review UI (Phase 3F).
 */
export type TopicPolarity = 'YES_advances' | 'NO_advances';

/**
 * Validator result for a single node.
 * Produced by the Phase 3E validator before a tree is marked trial-ready.
 */
export interface NodeValidationResult {
  nodeId:           string;
  knownAnswerGate:  'PASS' | 'FAIL' | 'WARN';  // WARN = has source but weak grounding
  purposeGate:      'PASS' | 'FAIL';
  messages:         string[];  // human-readable explanations of failures / warnings
}

/**
 * Full validator result for one topic tree.
 */
export interface TreeValidationResult {
  trialReady:   boolean;  // true only when all nodes PASS both gates
  nodeResults:  NodeValidationResult[];
  summaryFail:  string[];  // aggregated failure messages for the UI banner
}

/**
 * The persisted record for one topic's cross-examination tree.
 * Stored in Dexie table `cross_exam_trees`, keyed by (caseId, witnessId, topicId).
 */
export interface CrossExamTreeRecord {
  /** Composite key: `${caseId}::${witnessId}::${topicId}` */
  id: string;

  caseId:    string;
  witnessId: string;  // references a witness id in the case's witness list
  topicId:   string;  // slug derived from topic label, e.g. "prior-inconsistent-statement"

  /** Human-readable topic label shown in the topic switcher */
  topicLabel: string;

  /**
   * Source of this topic — from Intelligence Engine extraction or manually added.
   * 'disputed_area' | 'legal_issue' | 'manual'
   */
  topicSource: 'disputed_area' | 'legal_issue' | 'manual';

  /** All nodes in this tree, keyed by node id for O(1) lookup during walk */
  nodes: Record<string, CrossExamNode>;

  /** The id of the root node (first question in this topic) */
  rootNodeId: string;

  /**
   * Per-topic polarity — which answer direction moves toward the admission.
   * Default: 'YES_advances'. Counsel can override in Phase 3F.
   */
  polarity: TopicPolarity;

  /**
   * True once the tree has passed both validator gates (Phase 3E)
   * and counsel has approved it for courtroom use.
   */
  trialReady: boolean;

  /** Last validator result — stored so the review UI can show it without re-running */
  lastValidation?: TreeValidationResult;

  /**
   * Whether Phase 3D′ (contradiction-detour generation) is complete for
   * every node that has an expectedAnswer set.
   */
  detoursComplete: boolean;

  /** ISO timestamp of initial generation */
  generatedAt: string;

  /** ISO timestamp of last edit (manual node insert, polarity override, etc.) */
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session — live courtroom walk (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One step in the session log — question shown, answer chosen, any notes.
 */
export interface SessionStep {
  /** The node id that was displayed */
  nodeId: string;

  /** The question text at time of display (snapshot — guards against later edits) */
  questionSnapshot: string;

  /** The answer counsel recorded */
  answer: 'YES' | 'NO' | 'SKIPPED';

  /**
   * True when answer ≠ expectedAnswer and the contradiction detour fired.
   * The detour steps are logged as subsequent SessionSteps with their own nodeIds.
   */
  contradictionFired: boolean;

  /** Freehand notes counsel typed for this question */
  notes: string;

  /** ISO timestamp when this step was logged */
  loggedAt: string;
}

/**
 * Per-topic walk state — persisted continuously so the session can resume
 * after a crash, lock screen, or forced app close (Phase 4F).
 */
export interface TopicWalkState {
  topicId:        string;
  currentNodeId:  string | null;  // null = topic not yet started or fully exhausted
  completedSteps: SessionStep[];
  finished:       boolean;
}

/**
 * The full session record for one cross-examination session.
 * Stored in Dexie table `cross_exam_sessions`, keyed by id.
 * Auto-saved on every step (Phase 4F).
 */
export interface CrossExamSessionRecord {
  /** UUID */
  id: string;

  caseId:    string;
  witnessId: string;

  /** ISO timestamp the session was started */
  startedAt: string;

  /** ISO timestamp the session was closed (null if still open) */
  endedAt: string | null;

  /**
   * Walk state per topic — keyed by topicId.
   * Allows counsel to switch topics mid-cross and resume each independently.
   */
  topicStates: Record<string, TopicWalkState>;

  /**
   * The topicId currently displayed in the walker UI.
   * Persisted so the active topic is restored on resume.
   */
  activeTopicId: string | null;

  /**
   * True once Phase 5A has fed this session's full log to Contradiction Mapper.
   * Prevents double-feeding on multiple closes.
   */
  fedToContradictionMapper: boolean;
}
