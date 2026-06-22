/**
 * AFS Legal OS — Cross-Examination Generation Passes
 * Phase 3D: Convergence-layer generation
 * Phase 3D′: Contradiction-detour generation
 *
 * BUILD ORDER (3D):
 *   1–5. Phases 3A–3C complete (types, db, helpers, selector, generator)
 *   6. THIS FILE                          ← Phase 3D / 3D′
 *   7. CrossExamTreeGenerator.tsx updated ← calls these passes
 *
 * TWO EXPORTED PASSES:
 *
 *   runConvergencePass(...)
 *     Phase 3D — takes the exhaustive-layer nodes from 3C and fires a
 *     second batched AI call per topic to extend deeper, merging shared
 *     continuations toward ~100 nodes/topic. Returns the merged node map.
 *
 *   runDetourPass(...)
 *     Phase 3D′ — for every node in the merged tree, sends a citation
 *     pass to the AI: given the witness statement, does the statement
 *     already address the fact this question is probing?
 *     - If YES → sets expectedAnswer + expectedAnswerSource + generates
 *       a pre-built ContradictionDetour (citation → "I put it to you…"
 *       → credibility challenge → rejoin).
 *     - If NO  → leaves expectedAnswer unset (validator will WARN, not FAIL).
 *     Returns the patched node map and calls setDetoursComplete() on Dexie.
 *
 * BOTH PASSES:
 *   - Are pure async functions — no React state, no UI.
 *   - Are called sequentially inside CrossExamTreeGenerator.runGeneration().
 *   - Write their output to Dexie immediately (patchTreeNodes / patchNode /
 *     setDetoursComplete) so a mid-run crash loses at most one topic.
 *   - Are designed to be idempotent: re-running after a crash is safe.
 */

import type { CrossExamNode, CrossExamTreeRecord, ContradictionDetour, CrossExamTier, NodePurpose } from '@/types/crossExam';
import type { Case, CaseTheoryRecord } from '@/types';
import { callClaudeText } from '@/services/api';
import { patchTreeNodes, patchNode, setDetoursComplete } from '@/storage/crossExamHelpers';
import { uid } from '@/storage/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface RawNode {
  id?:           string;
  question?:     string;
  yesNext?:      string | null;
  noNext?:       string | null;
  terminal?:     boolean;
  terminalKind?: string;
  purpose?:      NodePurpose;
  tier?:         CrossExamTier;
}

interface RawConvergenceResult {
  /** Merged nodes — includes all original nodes plus new deeper nodes */
  nodes: Record<string, RawNode>;
  /** rootNodeId is unchanged — only leaf/terminal nodes are extended */
  rootNodeId: string;
}

interface RawDetourResult {
  nodeId:              string;
  addressedInStatement: boolean;
  expectedAnswer?:     'YES' | 'NO';
  expectedAnswerSource?: string;
  detour?: {
    citationRef:         string;
    putToYouQuestion:    string;
    credibilityQuestion: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function stripFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function coerceNode(raw: RawNode, fallbackPurpose: NodePurpose): CrossExamNode {
  const validTiers: CrossExamTier[] = ['opener', 'escalation', 'climax', 'recovery', 'contradiction'];
  const tier: CrossExamTier = validTiers.includes(raw.tier as CrossExamTier)
    ? (raw.tier as CrossExamTier)
    : 'escalation';

  const terminal = raw.terminal === true;
  const terminalKind = terminal
    ? (raw.terminalKind === 'admission_reached' || raw.terminalKind === 'content_exhausted'
        ? (raw.terminalKind as 'admission_reached' | 'content_exhausted')
        : 'content_exhausted')
    : undefined;

  const purpose: NodePurpose =
    raw.purpose &&
    ((raw.purpose.kind === 'theory_element' &&
      (raw.purpose as { kind: 'theory_element'; elementLabel: string }).elementLabel) ||
      (raw.purpose.kind === 'opposing_weakness' &&
        (raw.purpose as { kind: 'opposing_weakness'; weaknessLabel: string }).weaknessLabel))
      ? raw.purpose
      : fallbackPurpose;

  return {
    id:          raw.id || uid(),
    question:    raw.question || '(Question not generated)',
    yesNext:     raw.yesNext ?? null,
    noNext:      raw.noNext ?? null,
    terminal,
    terminalKind,
    purpose,
    tier,
  };
}

function buildFallbackPurpose(theory: CaseTheoryRecord | null, topicLabel: string): NodePurpose {
  return theory?.elements?.[0]
    ? { kind: 'theory_element', elementLabel: theory.elements[0].element }
    : { kind: 'opposing_weakness', weaknessLabel: topicLabel };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3D — Convergence-layer generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialise the current node map into a compact representation the AI can
 * reason about without exceeding the context window.
 * Format: one line per node — id | tier | question [→ YES:id NO:id]
 */
function serializeNodesCompact(nodes: Record<string, CrossExamNode>): string {
  return Object.values(nodes)
    .map(n => {
      const nav = n.terminal
        ? `[TERMINAL:${n.terminalKind ?? 'exhausted'}]`
        : `→ YES:${n.yesNext ?? 'null'} NO:${n.noNext ?? 'null'}`;
      return `${n.id} | ${n.tier} | ${n.question} ${nav}`;
    })
    .join('\n');
}

function buildConvergenceSystemPrompt(): string {
  return `You are a Nigerian senior trial advocate extending a cross-examination decision tree.
Your output is parsed by machine — return ONLY valid JSON, no markdown fences, no commentary.
Every question must be phrased for a closed Yes/No answer suitable for a Nigerian court.
Apply the Evidence Act 2011 (Nigeria) throughout.`;
}

function buildConvergenceUserPrompt(
  activeCase: Case,
  witnessName: string,
  witnessStatement: string,
  theory: CaseTheoryRecord | null,
  stub: CrossExamTreeRecord,
  existingNodes: Record<string, CrossExamNode>,
): string {
  const theoryBlock = theory
    ? [
        `Core Proposition: ${theory.core_proposition}`,
        `Elements: ${theory.elements.map(e => e.element).join(' | ')}`,
        `Opposing Theory: ${theory.opposing_theory}`,
      ].join('\n')
    : 'No locked Case Theory.';

  const existingCount = Object.keys(existingNodes).length;
  const terminalNodes = Object.values(existingNodes).filter(n => n.terminal);
  const terminalIds   = terminalNodes.map(n => n.id).join(', ');

  return `CASE: ${activeCase.caseName}
COURT: ${activeCase.court || 'Not specified'}

CASE THEORY:
${theoryBlock}

WITNESS: ${witnessName}
TOPIC: ${stub.topicLabel}
POLARITY: ${stub.polarity === 'YES_advances' ? 'YES answers advance our theory' : 'NO answers advance our theory'}

WITNESS STATEMENT (excerpt for context):
${witnessStatement ? witnessStatement.slice(0, 2000) : 'No statement provided.'}

EXISTING TREE (${existingCount} nodes — root: ${stub.rootNodeId}):
${serializeNodesCompact(existingNodes)}

TASK — CONVERGENCE LAYER:
Extend this tree deeper. Target: ~100 nodes total (currently ${existingCount}).
Rules:
1. Do NOT modify existing nodes. Only ADD new nodes.
2. Every current terminal node (IDs: ${terminalIds || 'none'}) should become non-terminal
   UNLESS it is "admission_reached" — those stay terminal.
3. New nodes must connect to existing terminal nodes via their yesNext / noNext.
   To connect: update the terminal node's yesNext or noNext to point to a new node id.
   Return the updated terminal nodes alongside all new nodes.
4. Merge shared continuations — different topic branches that reach the same strategic
   destination can share deep convergence nodes (point multiple nodesNext to the same id).
5. Every new node needs: id, question, yesNext, noNext, terminal, purpose, tier.
6. "purpose" must be one of:
   ${theory ? theory.elements.map(e => `{ "kind": "theory_element", "elementLabel": "${e.element}" }`).join('\n   ') : ''}
   { "kind": "opposing_weakness", "weaknessLabel": "<label>" }
7. Do NOT set "expectedAnswer" on any node.

RETURN FORMAT (JSON only, no fences):
Return the COMPLETE merged node map — all original nodes (with any terminal updates)
plus all new nodes. rootNodeId is unchanged.
{
  "rootNodeId": "${stub.rootNodeId}",
  "nodes": {
    "<all-node-ids>": { ... }
  }
}`;
}

/**
 * Phase 3D — Convergence pass for a single topic tree.
 * Takes the 3C nodes, extends them deeper, writes result to Dexie.
 * Returns the merged node map.
 */
export async function runConvergencePass(
  activeCase:       Case,
  witnessId:        string,
  witnessName:      string,
  witnessStatement: string,
  theory:           CaseTheoryRecord | null,
  stub:             CrossExamTreeRecord,
  existingNodes:    Record<string, CrossExamNode>,
): Promise<Record<string, CrossExamNode>> {
  const caseId          = activeCase.id;
  const fallbackPurpose = buildFallbackPurpose(theory, stub.topicLabel);

  const raw = await callClaudeText({
    system:      buildConvergenceSystemPrompt(),
    userMsg:     buildConvergenceUserPrompt(activeCase, witnessName, witnessStatement, theory, stub, existingNodes),
    maxTokens:   6000,
    skipLibrary: true,
  });

  let parsed: RawConvergenceResult;
  try {
    parsed = JSON.parse(stripFences(raw)) as RawConvergenceResult;
    if (!parsed.nodes || typeof parsed.nodes !== 'object') throw new Error('No nodes in response');
  } catch {
    // Convergence failed — return original nodes unchanged, do not throw
    console.warn(`[3D] Convergence parse failed for topic "${stub.topicLabel}" — keeping 3C nodes.`);
    return existingNodes;
  }

  // Coerce all nodes (both original and new)
  const mergedNodes: Record<string, CrossExamNode> = {};
  for (const [id, rawNode] of Object.entries(parsed.nodes)) {
    // Preserve expectedAnswer + contradictionDetour from existing nodes
    const existing = existingNodes[id];
    const coerced  = coerceNode({ ...rawNode, id }, fallbackPurpose);
    if (existing?.expectedAnswer)       coerced.expectedAnswer       = existing.expectedAnswer;
    if (existing?.expectedAnswerSource) coerced.expectedAnswerSource  = existing.expectedAnswerSource;
    if (existing?.contradictionDetour)  coerced.contradictionDetour  = existing.contradictionDetour;
    mergedNodes[coerced.id] = coerced;
  }

  // Ensure rootNodeId still exists in merged map
  const rootNodeId = parsed.rootNodeId || stub.rootNodeId;
  if (!mergedNodes[rootNodeId]) {
    console.warn(`[3D] Root node ${rootNodeId} missing from convergence result — using 3C nodes.`);
    return existingNodes;
  }

  await patchTreeNodes(caseId, witnessId, stub.topicId, mergedNodes, rootNodeId);
  return mergedNodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3D′ — Contradiction-detour generation
// ─────────────────────────────────────────────────────────────────────────────

function buildDetourSystemPrompt(): string {
  return `You are a Nigerian senior trial advocate performing a citation and detour analysis.
Your output is parsed by machine — return ONLY valid JSON array, no markdown fences, no commentary.
Rules for "I put it to you…" questions:
  - Never echo the witness's own answer back as a literal yes/no.
  - Never create ambiguous double-negatives.
  - The question is declarative and confrontational: "I put it to you that [fact]."
  - The credibility challenge is a follow-up that does not assume yes/no.`;
}

/**
 * Build a single batched prompt that analyses ALL nodes at once.
 * Batching avoids N serial AI calls — one call per tree instead of per node.
 * The AI returns a JSON array, one entry per node.
 */
function buildDetourUserPrompt(
  witnessName:      string,
  witnessStatement: string,
  nodes:            CrossExamNode[],
): string {
  const nodeList = nodes.map((n, i) =>
    `${i + 1}. NODE_ID: ${n.id}\n   QUESTION: ${n.question}`
  ).join('\n\n');

  return `WITNESS: ${witnessName}

FULL WITNESS STATEMENT:
${witnessStatement || 'No statement provided — mark all nodes as not addressed.'}

NODES TO ANALYSE (${nodes.length} total):
${nodeList}

TASK:
For each node, determine whether the witness statement already addresses the fact
that the question is probing.

"Addressed" means: the statement contains a specific claim, date, denial, or admission
that directly relates to what the question is testing. Generic statements or silence
do not count as addressed.

If addressed:
  - Set addressedInStatement: true
  - Set expectedAnswer: "YES" or "NO" (what the witness is likely to answer given the statement)
  - Set expectedAnswerSource: the specific paragraph, sentence, or phrase in the statement
    that grounds this (e.g. "Witness Statement, para 3: 'I was at home all evening'")
  - Generate detour:
      citationRef: short reference counsel reads aloud (e.g. "Witness Statement, paragraph 3")
      putToYouQuestion: "I put it to you that [the contradicting fact]." — never echoes her answer,
        never double-negative, always declarative
      credibilityQuestion: a follow-up that presses the contradiction without assuming an answer

If not addressed:
  - Set addressedInStatement: false
  - Omit expectedAnswer, expectedAnswerSource, detour

RETURN FORMAT (JSON array, no fences):
[
  {
    "nodeId": "<node-id>",
    "addressedInStatement": true,
    "expectedAnswer": "YES",
    "expectedAnswerSource": "Witness Statement, para 3: '...'",
    "detour": {
      "citationRef": "Witness Statement, paragraph 3",
      "putToYouQuestion": "I put it to you that ...",
      "credibilityQuestion": "..."
    }
  },
  {
    "nodeId": "<node-id>",
    "addressedInStatement": false
  }
]`;
}

/**
 * Phase 3D′ — Contradiction-detour pass for a single topic tree.
 * Batches ALL nodes into one AI call, parses results, patches each node
 * that gets an expectedAnswer, then marks detoursComplete on the record.
 * Returns the patched node map.
 */
export async function runDetourPass(
  activeCase:       Case,
  witnessId:        string,
  witnessName:      string,
  witnessStatement: string,
  stub:             CrossExamTreeRecord,
  nodes:            Record<string, CrossExamNode>,
): Promise<Record<string, CrossExamNode>> {
  const caseId = activeCase.id;

  // Only process nodes that don't already have a detour (idempotent)
  const nodesToProcess = Object.values(nodes).filter(n => !n.contradictionDetour);

  if (!witnessStatement.trim() || nodesToProcess.length === 0) {
    await setDetoursComplete(caseId, witnessId, stub.topicId);
    return nodes;
  }

  // Batch in groups of 30 to stay within token limits
  const BATCH_SIZE = 30;
  const updatedNodes = { ...nodes };

  for (let start = 0; start < nodesToProcess.length; start += BATCH_SIZE) {
    const batch = nodesToProcess.slice(start, start + BATCH_SIZE);

    let raw: string;
    try {
      raw = await callClaudeText({
        system:      buildDetourSystemPrompt(),
        userMsg:     buildDetourUserPrompt(witnessName, witnessStatement, batch),
        maxTokens:   4000,
        skipLibrary: true,
      });
    } catch {
      console.warn(`[3D′] Detour batch ${start}–${start + BATCH_SIZE} failed for topic "${stub.topicLabel}" — skipping batch.`);
      continue;
    }

    let results: RawDetourResult[];
    try {
      results = JSON.parse(stripFences(raw)) as RawDetourResult[];
      if (!Array.isArray(results)) throw new Error('Not an array');
    } catch {
      console.warn(`[3D′] Detour parse failed for batch — skipping.`);
      continue;
    }

    for (const result of results) {
      const node = updatedNodes[result.nodeId];
      if (!node) continue;
      if (!result.addressedInStatement) continue;
      if (!result.expectedAnswer || !result.detour) continue;

      // Validate rejoinNodeId — use the node's own yes/no continuation
      const rejoinNodeId = node.yesNext ?? node.noNext ?? node.id;

      const detour: ContradictionDetour = {
        citationRef:         result.detour.citationRef         || 'Witness Statement',
        putToYouQuestion:    result.detour.putToYouQuestion     || 'I put it to you that this is incorrect.',
        credibilityQuestion: result.detour.credibilityQuestion  || 'Why does your statement say otherwise?',
        rejoinNodeId,
      };

      const patched: CrossExamNode = {
        ...node,
        expectedAnswer:       result.expectedAnswer as 'YES' | 'NO',
        expectedAnswerSource: result.expectedAnswerSource || '',
        contradictionDetour:  detour,
      };

      updatedNodes[node.id] = patched;

      // Write each patched node immediately — crash-safe
      await patchNode(caseId, witnessId, stub.topicId, patched);
    }
  }

  await setDetoursComplete(caseId, witnessId, stub.topicId);
  return updatedNodes;
}
