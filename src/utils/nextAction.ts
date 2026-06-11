/**
 * AFS Legal OS V2 — Dynamic Next Action Computation (Phase 3)
 *
 * Computes the role-specific "Next Action" string from actual matter state:
 *   1. Uses matter.current_stage if explicitly set.
 *   2. Otherwise, infers the current stage by scanning docket entry titles
 *      against STAGE_KEYWORDS to find the highest-index matched stage.
 *   3. Maps the detected stage to the next-action string from STAGE_NEXT_ACTIONS.
 *   4. Falls back to ROLE_DEFAULT_NEXT_ACTION for legacy/unstaged matters.
 *
 * Returns both the next action text and detected stage metadata so callers
 * can display urgency flags, stage labels, and stage progress in the UI.
 */

import type { Case, DocketEntry, Deadline, CounselRole } from '@/types';
import {
  ROLE_STAGES,
  ROLE_DEFAULT_NEXT_ACTION,
  STAGE_KEYWORDS,
  STAGE_NEXT_ACTIONS,
  STAGE_URGENCY,
} from '@/constants/roleWorkspace';

export interface NextActionResult {
  /** The action text to display in the Next Action strip. */
  action:          string;
  /** The detected/set current stage ID (null for legacy/unstaged). */
  currentStageId:  string | null;
  /** Human-readable label for the detected stage. */
  currentStageLabel: string | null;
  /** The next stage after the current one, or null if at the end. */
  nextStageLabel:  string | null;
  /** Source of detection: 'explicit' | 'inferred' | 'default' */
  source:          'explicit' | 'inferred' | 'default';
  /** Stage index (0-based) among the role's stage chain. -1 if unknown. */
  stageIndex:      number;
  /** Total number of stages in the role's chain. */
  totalStages:     number;
  /** Urgency metadata for the current stage, if any. */
  urgency:         { level: 'HIGH' | 'MEDIUM'; note: string } | null;
  /** Whether there are overdue deadlines. */
  hasOverdueDeadlines: boolean;
  /** Count of overdue deadlines. */
  overdueCount:    number;
}

/**
 * Main function: compute the dynamic next action for a matter.
 */
export function computeNextAction(
  activeCase: Case,
  entries:    DocketEntry[],
  deadlines:  Deadline[],
): NextActionResult {
  const role = activeCase.counsel_role as CounselRole | undefined;

  // Legacy / no role — return generic default
  if (!role) {
    return buildDefault(null, entries, deadlines);
  }

  const stages    = ROLE_STAGES[role] ?? [];
  const totalStages = stages.length;

  // ── Check overdue deadlines ─────────────────────────────────────────────────
  const now = new Date();
  const overdueDeadlines = (deadlines ?? []).filter(
    d => d.status !== 'Dismissed' && new Date(d.date) < now
  );
  const overdueCount = overdueDeadlines.length;

  // ── Determine current stage ID ──────────────────────────────────────────────
  let currentStageId: string | null = null;
  let source: NextActionResult['source'] = 'default';

  // 1. Explicit: matter.current_stage is set
  if (activeCase.current_stage) {
    currentStageId = activeCase.current_stage;
    source = 'explicit';
  }

  // 2. Inferred: scan docket entries against stage keywords
  if (!currentStageId && entries.length > 0) {
    currentStageId = inferStageFromEntries(role, stages, entries);
    if (currentStageId) source = 'inferred';
  }

  // ── Resolve stage metadata ──────────────────────────────────────────────────
  const stageIndex  = currentStageId
    ? stages.findIndex(s => s.id === currentStageId)
    : -1;

  const currentStageLabel = stageIndex >= 0
    ? stages[stageIndex].label
    : null;

  const nextStageLabel = stageIndex >= 0 && stageIndex < stages.length - 1
    ? stages[stageIndex + 1].label
    : null;

  const urgency = currentStageId
    ? (STAGE_URGENCY[currentStageId] ?? null)
    : null;

  // ── Compute action text ─────────────────────────────────────────────────────
  let action: string;

  if (currentStageId && STAGE_NEXT_ACTIONS[role]?.[currentStageId]) {
    action = STAGE_NEXT_ACTIONS[role][currentStageId];
  } else if (overdueDeadlines.length > 0) {
    // Overdue deadline takes priority over generic default
    const dl = overdueDeadlines[0];
    action = `⚠ Overdue: "${dl.label}" — address immediately.`;
  } else {
    action = ROLE_DEFAULT_NEXT_ACTION[role];
    source = 'default';
  }

  return {
    action,
    currentStageId,
    currentStageLabel,
    nextStageLabel,
    source,
    stageIndex,
    totalStages,
    urgency,
    hasOverdueDeadlines: overdueCount > 0,
    overdueCount,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildDefault(
  role: CounselRole | null,
  _entries: DocketEntry[],
  deadlines: Deadline[],
): NextActionResult {
  const now = new Date();
  const overdueDeadlines = (deadlines ?? []).filter(
    d => d.status !== 'Dismissed' && new Date(d.date) < now
  );
  const overdueCount = overdueDeadlines.length;

  return {
    action:             role ? ROLE_DEFAULT_NEXT_ACTION[role] : 'Open a matter to begin.',
    currentStageId:     null,
    currentStageLabel:  null,
    nextStageLabel:     null,
    source:             'default',
    stageIndex:         -1,
    totalStages:        0,
    urgency:            null,
    hasOverdueDeadlines: overdueCount > 0,
    overdueCount,
  };
}

/**
 * Scans docket entry titles against STAGE_KEYWORDS to find the
 * highest-index (most advanced) stage in the role's chain that has
 * matching entries. Returns the stage ID or null.
 */
function inferStageFromEntries(
  role:    CounselRole,
  stages:  typeof ROLE_STAGES[CounselRole],
  entries: DocketEntry[],
): string | null {
  // Build a lowercase corpus of all entry titles + notes
  const corpus = entries
    .map(e => `${e.docTitle} ${e.notes ?? ''} ${e.docType ?? ''}`.toLowerCase())
    .join(' ');

  // Walk stages from last to first — find the most advanced matched stage
  for (let i = stages.length - 1; i >= 0; i--) {
    const stage    = stages[i];
    const keywords = STAGE_KEYWORDS[stage.id] ?? [];
    const matched  = keywords.some(kw => corpus.includes(kw.toLowerCase()));
    if (matched) return stage.id;
  }

  return null;
}

/**
 * Returns how many stages are completed (i.e. stages before the current one)
 * and how many are upcoming (after current).
 */
export function getStageProgress(result: NextActionResult): {
  completed: number;
  current:   number;
  upcoming:  number;
} {
  if (result.stageIndex < 0) {
    return { completed: 0, current: 0, upcoming: result.totalStages };
  }
  return {
    completed: result.stageIndex,
    current:   1,
    upcoming:  result.totalStages - result.stageIndex - 1,
  };
}
