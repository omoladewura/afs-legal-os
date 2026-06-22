/**
 * AFS Legal OS — Cross-Examination Dry-Path Fallback Logic
 * Phase 4E — File 1 of 2
 *
 * OUTPUT PATH:
 *   src/utils/crossExamDryPath.ts
 *
 * ─── BUILD ORDER — must be respected ───────────────────────────────────────
 *
 *  ① src/types/crossExam.ts                        (Phase 3A — already built)
 *     Exports: CrossExamNode, CrossExamTreeRecord, CrossExamTier,
 *              SessionStep, TopicWalkState
 *
 *  ② src/storage/db.ts                             (Phase 3A — already built)
 *
 *  ③ src/storage/crossExamHelpers.ts               (Phase 3B — already built)
 *
 *  ④ src/engines/trial/CrossExamWalker.tsx         (Phase 4A — already built)
 *
 *  ⑤ src/engines/trial/CrossExamTopicSwitcher.tsx  (Phase 4B — already built)
 *
 *  ⑥ src/engines/trial/CrossExamSessionLog.tsx     (Phase 4C — already built)
 *
 *  ⑦ THIS FILE  ← Phase 4E, step 1
 *     No imports from any Phase 4 React component.
 *     Zero side-effects. Pure functions only.
 *     Must be created before CrossExamWalkerWithFallback.tsx (step 2 below).
 *
 *  ⑧ src/engines/trial/CrossExamWalkerWithFallback.tsx
 *     (Phase 4E step 2 — imports this file + CrossExamWalker)
 *
 * ─── PURPOSE ────────────────────────────────────────────────────────────────
 *
 * When the walker reaches a terminal node or exhausts a branch, it must not
 * simply show a blank "topic finished" screen.  Phase 4E requires:
 *
 *   (a) DISTINGUISH two terminal states:
 *         • "admission reached — STOP HERE"  (terminalKind === 'admission_reached')
 *         • "content exhausted — topic finished" (terminalKind === 'content_exhausted'
 *           or node is null, meaning the branch fell off the tree)
 *
 *   (b) When the state is "content exhausted" (not admission-reached), surface
 *       the STRONGEST UNUSED question from the same topic-tree so counsel has
 *       somewhere to go without rummaging through the full tree manually.
 *
 * "Unused" means: the node's id does not appear in the session's completedSteps
 * for this topic.  "Strongest" is determined by the scoring function below.
 *
 * ─── SCORING ────────────────────────────────────────────────────────────────
 *
 *  Score is a plain integer (higher = stronger). Priority order:
 *
 *    1. Tier weight        (climax > escalation > opener > recovery > contradiction)
 *    2. Has expectedAnswer (+10)  — grounded proposition is always more useful
 *    3. Has detour         (+5)   — pre-built contradiction path available
 *    4. Is NOT a manual node (+2) — generated questions are better anchored
 *    5. Tie-break: alphabetical node id (stable, deterministic)
 *
 * This is intentionally simple — counsel is in court, not reading a score card.
 * The function surfaces one best candidate; the UI only shows that one.
 *
 * ─── EXPORTS ────────────────────────────────────────────────────────────────
 *
 *  scoreDryPathNode(node)                — integer score for a single node
 *  findStrongestUnusedNode(tree, usedIds) — returns best unused CrossExamNode | null
 *  classifyTerminalState(node)           — returns 'admission_reached' | 'content_exhausted'
 *  collectUsedNodeIds(topicState)        — extracts used node ids from a TopicWalkState
 *
 * ─── CONSUMED BY ────────────────────────────────────────────────────────────
 *
 *  src/engines/trial/CrossExamWalkerWithFallback.tsx  (Phase 4E step 2)
 *  src/engines/trial/CrossExamSessionLog.tsx          (Phase 4C — read-only, no change)
 *
 * ─── DOES NOT TOUCH ─────────────────────────────────────────────────────────
 *
 *  Dexie / IndexedDB — no side-effects, no persistence.
 *  React — no components, no hooks.
 *  Contradiction Mapper — that is Phase 4D / 5A.
 */

import type {
  CrossExamNode,
  CrossExamTreeRecord,
  CrossExamTier,
  TopicWalkState,
} from '@/types/crossExam';

// ─────────────────────────────────────────────────────────────────────────────
// Tier weights
// ─────────────────────────────────────────────────────────────────────────────

const TIER_WEIGHT: Record<CrossExamTier, number> = {
  climax:          40,
  escalation:      30,
  opener:          20,
  recovery:        10,
  contradiction:    5,
};

// ─────────────────────────────────────────────────────────────────────────────
// scoreDryPathNode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an integer priority score for a candidate fallback node.
 * Higher = stronger = shown first.
 *
 * Only non-terminal nodes are candidates (terminal nodes are endpoints, not
 * questions counsel can jump to mid-cross).  The caller is responsible for
 * filtering out terminal nodes before scoring — this function does not guard
 * against it so it can be used in tight loops without double-checking.
 */
export function scoreDryPathNode(node: CrossExamNode): number {
  let score = TIER_WEIGHT[node.tier] ?? 0;

  if (node.expectedAnswer !== undefined)    score += 10;
  if (node.contradictionDetour !== undefined) score += 5;
  if (!node.isManual)                       score += 2;

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// findStrongestUnusedNode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans every node in `tree` and returns the highest-scoring one that:
 *   • Is NOT in `usedNodeIds`
 *   • Is NOT terminal (terminal nodes are endpoints, not re-enterable questions)
 *   • Is NOT a contradiction-detour node injected mid-session (isManual may
 *     be true for those; contradiction detour nodes are identified by tier
 *     'contradiction' AND having no yesNext/noNext leading back into the main
 *     tree — but we keep it simple: detour nodes are still valid fallbacks if
 *     they are high-scoring enough, so we do NOT exclude them here)
 *
 * Returns null when all nodes have been walked or the tree is empty — which
 * means the topic is genuinely exhausted and no fallback exists.
 *
 * Tie-breaking is by node id (alphabetical, ascending) for determinism.
 */
export function findStrongestUnusedNode(
  tree:        CrossExamTreeRecord,
  usedNodeIds: ReadonlySet<string>,
): CrossExamNode | null {
  let best:      CrossExamNode | null = null;
  let bestScore: number               = -Infinity;

  for (const node of Object.values(tree.nodes)) {
    // Skip terminal nodes — they are endpoints, not re-entry questions.
    if (node.terminal) continue;

    // Skip nodes already walked this session.
    if (usedNodeIds.has(node.id)) continue;

    const score = scoreDryPathNode(node);

    if (
      score > bestScore ||
      (score === bestScore && best !== null && node.id < best.id)
    ) {
      best      = node;
      bestScore = score;
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyTerminalState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given the node the walker has landed on (or null if it fell off the tree),
 * returns the terminal classification that the UI should display.
 *
 * Phase 4E requires these two states to be visually distinct:
 *
 *   'admission_reached'  — counsel should STOP; the goal was achieved.
 *                          Show a prominent green signal.
 *
 *   'content_exhausted'  — the branch ran out; show the fallback question
 *                          if one exists, or "topic finished" if not.
 *
 * A null node (walker position fell off the tree entirely) is always
 * 'content_exhausted' because no admission was explicitly reached.
 */
export type TerminalState = 'admission_reached' | 'content_exhausted';

export function classifyTerminalState(node: CrossExamNode | null): TerminalState {
  if (node === null) return 'content_exhausted';
  if (!node.terminal) {
    // Caller should only call this when the node IS terminal or null,
    // but guard defensively.
    return 'content_exhausted';
  }
  return node.terminalKind === 'admission_reached'
    ? 'admission_reached'
    : 'content_exhausted';
}

// ─────────────────────────────────────────────────────────────────────────────
// collectUsedNodeIds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the set of node ids that have already been walked in a given
 * TopicWalkState.  This is the source-of-truth "used" set that
 * findStrongestUnusedNode consumes.
 *
 * Includes ALL steps regardless of answer — SKIPPED steps count as used
 * because counsel has already seen that question this session.
 *
 * The returned Set is a new object on every call (safe to cache if needed,
 * but this is not the caller's concern here).
 */
export function collectUsedNodeIds(topicState: TopicWalkState): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const step of topicState.completedSteps) {
    ids.add(step.nodeId);
  }
  // Also treat the current position as "used" — it is either what is currently
  // shown (not yet tapped) or already exhausted.  Either way, the fallback
  // should not re-offer the node the walker is already sitting on.
  if (topicState.currentNodeId !== null) {
    ids.add(topicState.currentNodeId);
  }
  return ids;
}
