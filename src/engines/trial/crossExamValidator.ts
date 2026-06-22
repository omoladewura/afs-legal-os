/**
 * AFS Legal OS — Cross-Examination Tree Validator
 * Phase 3E: Validator
 *
 * BUILD ORDER:
 *   1. src/types/crossExam.ts                        (Phase 3A — done)
 *   2. src/storage/db.ts                             (Phase 3A — done)
 *   3. src/storage/crossExamHelpers.ts               (Phase 3B — done)
 *   4. src/engines/trial/CrossExamTopicSelector.tsx  (Phase 3B — done)
 *   5. src/engines/trial/CrossExamTreeGenerator.tsx  (Phase 3C — done)
 *   6. src/engines/trial/crossExamGenerationPasses.ts (Phase 3D/3D′ — done)
 *   7. THIS FILE                                      ← Phase 3E (build first)
 *   8. src/engines/trial/CrossExamValidatorPanel.tsx  ← Phase 3E UI (build after)
 *
 * PURPOSE:
 *   Two hard gates that must both pass before a tree is marked trial-ready:
 *
 *   Gate 1 — Known Answer Gate
 *     Every node's expectedAnswer must be grounded in witness statement,
 *     exhibit, or established fact. Nodes with no expectedAnswer get a WARN
 *     (not FAIL) — the Phase 3D′ citation pass may not have reached them.
 *     Nodes with an expectedAnswer but no expectedAnswerSource get a FAIL.
 *
 *   Gate 2 — Declared Strategic Purpose Gate
 *     Every node must carry a purpose tag of either:
 *       { kind: 'theory_element', elementLabel: string }  — non-empty label
 *       { kind: 'opposing_weakness', weaknessLabel: string } — non-empty label
 *     Any node missing a purpose, or with a purpose whose label is empty /
 *     placeholder text, FAILS gate 2.
 *
 *   In addition: orphan detection.
 *     Nodes not reachable from the root (via yesNext / noNext traversal) are
 *     flagged as WARN on both gates — they cannot be reached in the walker and
 *     indicate a generation error.
 *
 * OUTPUT:
 *   validateTree() returns a TreeValidationResult (defined in crossExam.ts).
 *   trialReady is true only when ALL nodes PASS both gates (no FAIL anywhere).
 *   WARNs do not block trial-readiness — they are informational.
 *
 * SIDE EFFECTS:
 *   None — this is a pure function. The caller (CrossExamValidatorPanel) is
 *   responsible for writing the result to Dexie via patchValidation().
 *
 * CONSUMED BY:
 *   - src/engines/trial/CrossExamValidatorPanel.tsx  (Phase 3E UI)
 *   - src/engines/trial/CrossExamTopicSelector.tsx   (shows trial-ready badge)
 */

import type {
  CrossExamNode,
  CrossExamTreeRecord,
  NodeValidationResult,
  TreeValidationResult,
} from '@/types/crossExam';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Placeholder texts that indicate the AI failed to fill a purpose label */
const PLACEHOLDER_LABELS = new Set([
  '<label>',
  '<element>',
  'undefined',
  'null',
  '',
]);

function isPurposeLabelEmpty(label: string | undefined): boolean {
  if (!label) return true;
  return PLACEHOLDER_LABELS.has(label.trim().toLowerCase());
}

/**
 * Walk the tree from rootNodeId and collect every reachable node id.
 * Handles cycles defensively (treats them as exhausted branches).
 */
function reachableNodeIds(
  nodes: Record<string, CrossExamNode>,
  rootNodeId: string,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [rootNodeId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodes[id];
    if (!node) continue;

    if (node.yesNext && !visited.has(node.yesNext)) queue.push(node.yesNext);
    if (node.noNext  && !visited.has(node.noNext))  queue.push(node.noNext);

    // Contradiction detour rejoin nodes are also reachable
    if (node.contradictionDetour?.rejoinNodeId) {
      const rj = node.contradictionDetour.rejoinNodeId;
      if (!visited.has(rj)) queue.push(rj);
    }
  }

  return visited;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-node validation
// ─────────────────────────────────────────────────────────────────────────────

function validateNode(
  node: CrossExamNode,
  isOrphan: boolean,
): NodeValidationResult {
  const messages: string[] = [];
  let knownAnswerGate: NodeValidationResult['knownAnswerGate'] = 'PASS';
  let purposeGate: NodeValidationResult['purposeGate'] = 'PASS';

  // ── Orphan ────────────────────────────────────────────────────────────────
  if (isOrphan) {
    messages.push('Orphan node — not reachable from the root. Check yesNext / noNext links in the generating node.');
    knownAnswerGate = 'WARN';
    purposeGate     = 'WARN';
    return { nodeId: node.id, knownAnswerGate, purposeGate, messages };
  }

  // ── Gate 1: Known Answer ──────────────────────────────────────────────────
  if (!node.expectedAnswer) {
    // Phase 3D′ citation pass may not have run yet or found no grounding —
    // WARN, not FAIL: trial may proceed if counsel accepts the uncertainty.
    knownAnswerGate = 'WARN';
    messages.push('No expected answer set. Run the citation pass (Phase 3D′) or manually set expectedAnswer in the review panel.');
  } else if (!node.expectedAnswerSource || node.expectedAnswerSource.trim() === '') {
    // Has an expectedAnswer but no source — this is ungrounded.
    knownAnswerGate = 'FAIL';
    messages.push('Expected answer is set but has no source grounding. Provide a witness statement reference, exhibit citation, or established fact reference.');
  }
  // If expectedAnswer + expectedAnswerSource both present → PASS (default)

  // ── Gate 2: Strategic Purpose ─────────────────────────────────────────────
  if (!node.purpose) {
    purposeGate = 'FAIL';
    messages.push('Node has no purpose tag. Every node must be tagged to a Case Theory element or opposing weakness.');
  } else if (node.purpose.kind === 'theory_element') {
    const lbl = (node.purpose as { kind: 'theory_element'; elementLabel: string }).elementLabel;
    if (isPurposeLabelEmpty(lbl)) {
      purposeGate = 'FAIL';
      messages.push('theory_element purpose has an empty or placeholder elementLabel. Set a specific Case Theory element.');
    }
  } else if (node.purpose.kind === 'opposing_weakness') {
    const lbl = (node.purpose as { kind: 'opposing_weakness'; weaknessLabel: string }).weaknessLabel;
    if (isPurposeLabelEmpty(lbl)) {
      purposeGate = 'FAIL';
      messages.push('opposing_weakness purpose has an empty or placeholder weaknessLabel. Set a specific weakness label.');
    }
  } else {
    purposeGate = 'FAIL';
    messages.push(`Unknown purpose kind: "${(node.purpose as { kind: string }).kind}". Must be "theory_element" or "opposing_weakness".`);
  }

  return { nodeId: node.id, knownAnswerGate, purposeGate, messages };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree-level validator — the main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a cross-examination tree record.
 *
 * Pure function — no Dexie, no network, no React.
 * Returns a TreeValidationResult that the caller can write to Dexie
 * via patchValidation().
 *
 * trialReady is true only when every node passes both gates with no FAIL.
 * WARNs do not block trial readiness — they are surfaced in the review UI.
 */
export function validateTree(tree: CrossExamTreeRecord): TreeValidationResult {
  const nodes       = tree.nodes;
  const rootNodeId  = tree.rootNodeId;
  const nodeList    = Object.values(nodes);

  // Edge case: empty tree
  if (nodeList.length === 0 || !rootNodeId) {
    return {
      trialReady:  false,
      nodeResults: [],
      summaryFail: ['Tree has no nodes. Generate the tree first (Phase 3C).'],
    };
  }

  // Edge case: rootNodeId not in nodes map
  if (!nodes[rootNodeId]) {
    return {
      trialReady:  false,
      nodeResults: [],
      summaryFail: [`Root node "${rootNodeId}" is not present in the nodes map. The tree may be corrupt — regenerate it.`],
    };
  }

  // Walk the tree to find reachable nodes
  const reachable = reachableNodeIds(nodes, rootNodeId);

  // Validate each node
  const nodeResults: NodeValidationResult[] = nodeList.map(node =>
    validateNode(node, !reachable.has(node.id))
  );

  // Aggregate failures
  const hasFail = nodeResults.some(
    r => r.knownAnswerGate === 'FAIL' || r.purposeGate === 'FAIL'
  );

  // Build summary messages for the UI banner
  const summaryFail: string[] = [];

  const failedKnownAnswer = nodeResults.filter(r => r.knownAnswerGate === 'FAIL');
  const warnKnownAnswer   = nodeResults.filter(r => r.knownAnswerGate === 'WARN');
  const failedPurpose     = nodeResults.filter(r => r.purposeGate === 'FAIL');
  const orphans           = nodeResults.filter(r =>
    r.knownAnswerGate === 'WARN' && r.purposeGate === 'WARN' &&
    r.messages.some(m => m.startsWith('Orphan'))
  );

  if (failedKnownAnswer.length > 0) {
    summaryFail.push(
      `${failedKnownAnswer.length} node${failedKnownAnswer.length === 1 ? '' : 's'} failed Gate 1 (known answer ungrounded).`
    );
  }
  if (failedPurpose.length > 0) {
    summaryFail.push(
      `${failedPurpose.length} node${failedPurpose.length === 1 ? '' : 's'} failed Gate 2 (no declared strategic purpose).`
    );
  }
  if (orphans.length > 0) {
    summaryFail.push(
      `${orphans.length} orphan node${orphans.length === 1 ? '' : 's'} not reachable from the root — check tree links.`
    );
  }
  if (warnKnownAnswer.length > 0 && failedKnownAnswer.length === 0) {
    // Info-level warning — doesn't block trial readiness
    summaryFail.push(
      `${warnKnownAnswer.length} node${warnKnownAnswer.length === 1 ? '' : 's'} have no expected answer (WARN, not FAIL). Consider running the citation pass.`
    );
  }

  return {
    trialReady:  !hasFail,
    nodeResults,
    summaryFail,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience re-exports for the UI panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count nodes by gate result — used to render summary badges in the review UI.
 */
export interface ValidationSummary {
  total:        number;
  passBoth:     number;
  warnOnly:     number;
  failAny:      number;
  orphanCount:  number;
}

export function summariseValidation(result: TreeValidationResult): ValidationSummary {
  const total    = result.nodeResults.length;
  let passBoth   = 0;
  let warnOnly   = 0;
  let failAny    = 0;
  let orphanCount = 0;

  for (const r of result.nodeResults) {
    const isOrphan = r.messages.some(m => m.startsWith('Orphan'));
    if (isOrphan) { orphanCount++; continue; }

    const hasFail = r.knownAnswerGate === 'FAIL' || r.purposeGate === 'FAIL';
    const hasWarn = r.knownAnswerGate === 'WARN' || r.purposeGate === 'WARN';

    if (hasFail)         failAny++;
    else if (hasWarn)    warnOnly++;
    else                 passBoth++;
  }

  return { total, passBoth, warnOnly, failAny, orphanCount };
}
