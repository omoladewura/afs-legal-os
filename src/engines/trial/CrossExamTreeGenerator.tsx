/**
 * AFS Legal OS — CrossExamTreeGenerator
 * Phase 3C: Exhaustive-layer tree generation
 *
 * BUILD ORDER (3C):
 *   1. src/types/crossExam.ts                        (Phase 3A — done)
 *   2. src/storage/db.ts                             (Phase 3A — done)
 *   3. src/storage/crossExamHelpers.ts               (Phase 3B — done)
 *   4. src/engines/trial/CrossExamTopicSelector.tsx  (Phase 3B — done)
 *   5. src/engines/TrialEngine.tsx patch             (Phase 3B — done)
 *   6. THIS FILE                                      ← Phase 3C
 *
 * PURPOSE:
 *   Replaces the Phase 3C placeholder in CrossExaminationTab.
 *   Receives pendingStubs (CrossExamTreeRecord[]) from the parent —
 *   one stub per topic the counsel selected. For each stub it:
 *     1. Fires one batched AI call with the witness statement + locked
 *        Case Theory + topic label as context.
 *     2. Parses the JSON response into CrossExamNode records.
 *     3. Writes the nodes to Dexie via patchTreeNodes().
 *     4. Marks that topic complete and moves to the next.
 *   When all topics are done, calls onComplete() so CrossExaminationTab
 *   can switch back to the audit/topic view.
 *
 * GENERATION RULES (from Phase 3C/3D spec):
 *   - One batched call per topic (not per node).
 *   - First 3–4 fully distinct levels ("exhaustive layer"):
 *       opener → escalation → climax, with recovery branches.
 *   - Anchored to witness statement + locked Case Theory.
 *   - Every node must have a declared purpose (theory_element or
 *     opposing_weakness) — the Phase 3E validator will gate on this,
 *     but we pre-fill it during generation to avoid empty trees.
 *   - expectedAnswer is left unset at this stage — Phase 3D′ fills it
 *     after the citation pass.
 *
 * AI CONTRACT:
 *   The prompt instructs the model to return ONLY a JSON object with
 *   shape { rootNodeId: string; nodes: Record<string, CrossExamNode> }.
 *   We strip markdown fences and parse; if parsing fails the topic is
 *   marked as errored and generation continues with the next topic.
 *
 * CONSUMED BY:
 *   - src/engines/TrialEngine.tsx  CrossExaminationTab
 *     (replaces the crossView === 'generating' placeholder)
 */

import { useState, useEffect, useRef } from 'react';
import type { Case, CaseTheoryRecord } from '@/types';
import type { CrossExamTreeRecord, CrossExamNode, CrossExamTier, NodePurpose } from '@/types/crossExam';
import { T } from '@/constants/tokens';
import { patchTreeNodes } from '@/storage/crossExamHelpers';
import { callClaudeText } from '@/services/api';
import { uid } from '@/storage/helpers';
import { runConvergencePass, runDetourPass } from '@/engines/trial/crossExamGenerationPasses';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TopicStatus =
  | 'pending'
  | 'generating'     // 3C exhaustive layer
  | 'converging'     // 3D convergence layer
  | 'detouring'      // 3D′ contradiction detours
  | 'done'
  | 'error';

interface TopicProgress {
  stub:    CrossExamTreeRecord;
  status:  TopicStatus;
  nodeCount: number;
  error?:  string;
}

// Raw shape the AI returns — validated before casting to CrossExamNode
interface RawNode {
  id?:             string;
  question?:       string;
  yesNext?:        string | null;
  noNext?:         string | null;
  terminal?:       boolean;
  terminalKind?:   string;
  purpose?:        NodePurpose;
  tier?:           CrossExamTier;
  expectedAnswer?: string;
}

interface RawTree {
  rootNodeId: string;
  nodes:      Record<string, RawNode>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamTreeGeneratorProps {
  activeCase:      Case;
  witnessId:       string;
  witnessName:     string;
  /** Full statement text — registry or local paste */
  witnessStatement: string;
  theory:          CaseTheoryRecord | null;
  pendingStubs:    CrossExamTreeRecord[];
  onComplete:      (generatedTrees: CrossExamTreeRecord[]) => void;
  onBack:          () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a Nigerian senior trial advocate generating a structured cross-examination decision tree.
Your output is parsed by machine — return ONLY valid JSON, no markdown fences, no commentary.
Every question must be phrased for a closed Yes/No answer suitable for use in a Nigerian court.
Apply the Evidence Act 2011 (Nigeria) throughout.`;
}

function buildUserPrompt(
  activeCase: Case,
  witnessName: string,
  witnessStatement: string,
  theory: CaseTheoryRecord | null,
  stub: CrossExamTreeRecord,
): string {
  const theoryBlock = theory
    ? [
        `Core Proposition: ${theory.core_proposition}`,
        `Elements: ${theory.elements.map(e => e.element).join(' | ')}`,
        `Opposing Theory: ${theory.opposing_theory}`,
        `Theory Killer: ${theory.theory_killer}`,
        `Weakest Link: ${theory.weakest_link}`,
      ].join('\n')
    : 'No locked Case Theory — generate questions that attack credibility and expose weaknesses.';

  const intelBlock = (() => {
    const ext = activeCase.intelligence_data?.extraction;
    if (!ext) return 'No intelligence extraction available.';
    const parts: string[] = [];
    if (ext.established_facts?.length)
      parts.push(`Established Facts:\n${ext.established_facts.map(f => `- ${f}`).join('\n')}`);
    if (ext.disputed_areas?.length)
      parts.push(`Disputed Areas:\n${ext.disputed_areas.map(d => `- ${d}`).join('\n')}`);
    if (ext.legal_issues?.length)
      parts.push(`Legal Issues:\n${ext.legal_issues.map(l => `- ${l}`).join('\n')}`);
    return parts.join('\n\n') || 'No structured intelligence extracted.';
  })();

  const purposeOptions = theory
    ? theory.elements.map(e => `{ "kind": "theory_element", "elementLabel": "${e.element}" }`)
    : [];
  purposeOptions.push(`{ "kind": "opposing_weakness", "weaknessLabel": "<label>" }`);

  return `CASE: ${activeCase.caseName}
COURT: ${activeCase.court || 'Not specified'}

CASE THEORY (LOCKED):
${theoryBlock}

CASE INTELLIGENCE:
${intelBlock}

WITNESS: ${witnessName}
CROSS-EXAMINATION TOPIC: ${stub.topicLabel}
TOPIC SOURCE: ${stub.topicSource}
POLARITY: ${stub.polarity === 'YES_advances' ? 'YES answers advance our theory' : 'NO answers advance our theory'}

WITNESS STATEMENT:
${witnessStatement || 'No statement provided — generate questions based on case intelligence and topic.'}

TASK:
Generate a cross-examination decision tree for the topic "${stub.topicLabel}".

RULES:
1. 3–4 fully distinct levels deep (opener → escalation → climax, with recovery branches).
2. Aim for 12–20 nodes total. Do not exceed 30.
3. Every node must have a "purpose" field — choose from:
${purposeOptions.join('\n')}
4. "tier" must be one of: "opener", "escalation", "climax", "recovery", "contradiction"
5. "terminal" nodes must have "terminalKind": "admission_reached" or "content_exhausted"
6. "yesNext" and "noNext" are node IDs (strings) or null for terminal nodes.
7. Do NOT set "expectedAnswer" — leave it absent. Phase 3D will fill it.
8. All node IDs must be unique UUID-style strings.
9. Root node is the first opener question — the gentlest commitment question that establishes the premise.

RETURN FORMAT (JSON only, no fences):
{
  "rootNodeId": "<id of the first node>",
  "nodes": {
    "<node-id>": {
      "id": "<node-id>",
      "question": "<question text>",
      "yesNext": "<node-id or null>",
      "noNext": "<node-id or null>",
      "terminal": false,
      "purpose": { "kind": "theory_element", "elementLabel": "<element>" },
      "tier": "opener"
    }
  }
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser — defensive: cleans any model that returns ```json fences
// ─────────────────────────────────────────────────────────────────────────────

function parseTreeResponse(raw: string): RawTree | null {
  try {
    const clean = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(clean) as RawTree;
    if (!parsed.rootNodeId || !parsed.nodes || typeof parsed.nodes !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Coerce raw AI node into a typed CrossExamNode, filling gaps defensively */
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

  const purpose: NodePurpose = raw.purpose && (
    (raw.purpose.kind === 'theory_element' && (raw.purpose as { kind: 'theory_element'; elementLabel: string }).elementLabel) ||
    (raw.purpose.kind === 'opposing_weakness' && (raw.purpose as { kind: 'opposing_weakness'; weaknessLabel: string }).weaknessLabel)
  ) ? raw.purpose : fallbackPurpose;

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

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: TopicStatus }) {
  if (status === 'done')      return <span style={{ color: T.ok,   fontSize: 14 }}>✓</span>;
  if (status === 'error')     return <span style={{ color: T.err,  fontSize: 14 }}>✕</span>;
  if (status === 'generating' || status === 'converging' || status === 'detouring') return <Spinner />;
  return <span style={{ color: T.mute, fontSize: 13 }}>–</span>;
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 12, height: 12,
      border: `2px solid ${T.bdr}`,
      borderTopColor: '#8a1a1a',
      borderRadius: '50%',
      animation: 'spin .7s linear infinite',
      verticalAlign: 'middle',
    }} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamTreeGenerator({
  activeCase,
  witnessId,
  witnessName,
  witnessStatement,
  theory,
  pendingStubs,
  onComplete,
  onBack,
}: CrossExamTreeGeneratorProps) {
  const caseId = activeCase.id;

  const [progress, setProgress] = useState<TopicProgress[]>(
    pendingStubs.map(stub => ({ stub, status: 'pending', nodeCount: 0 }))
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  const [finished, setFinished]     = useState(false);
  const [overallError, setOverallError] = useState('');

  // Prevent double-fire in React StrictMode
  const generatingRef = useRef(false);

  // ── Generation loop ────────────────────────────────────────────────────────

  useEffect(() => {
    if (generatingRef.current) return;
    if (pendingStubs.length === 0) {
      setFinished(true);
      onComplete([]);
      return;
    }
    generatingRef.current = true;
    runGeneration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runGeneration() {
    const completedTrees: CrossExamTreeRecord[] = [];

    for (let i = 0; i < pendingStubs.length; i++) {
      const stub = pendingStubs[i];
      setCurrentIdx(i);

      // Mark this topic as generating
      setProgress(prev =>
        prev.map((p, idx) => idx === i ? { ...p, status: 'generating' } : p)
      );

      try {
        const raw = await callClaudeText({
          system:      buildSystemPrompt(),
          userMsg:     buildUserPrompt(activeCase, witnessName, witnessStatement, theory, stub),
          maxTokens:   4000,
          skipLibrary: true,
        });

        const parsed = parseTreeResponse(raw);
        if (!parsed) throw new Error('AI returned unparseable JSON.');

        // Build a fallback purpose from the theory or topic label
        const fallbackPurpose: NodePurpose = theory?.elements?.[0]
          ? { kind: 'theory_element', elementLabel: theory.elements[0].element }
          : { kind: 'opposing_weakness', weaknessLabel: stub.topicLabel };

        // Coerce all nodes defensively
        const nodes: Record<string, CrossExamNode> = {};
        for (const [id, rawNode] of Object.entries(parsed.nodes)) {
          const node = coerceNode({ ...rawNode, id }, fallbackPurpose);
          nodes[node.id] = node;
        }

        if (!parsed.rootNodeId || !nodes[parsed.rootNodeId]) {
          throw new Error('Root node ID missing or not found in nodes map.');
        }

        // Write exhaustive layer to Dexie
        await patchTreeNodes(caseId, witnessId, stub.topicId, nodes, parsed.rootNodeId);

        // ── Phase 3D — Convergence layer ──────────────────────────────────
        setProgress(prev =>
          prev.map((p, idx) => idx === i ? { ...p, status: 'converging', nodeCount: Object.keys(nodes).length } : p)
        );

        const mergedNodes = await runConvergencePass(
          activeCase,
          witnessId,
          witnessName,
          witnessStatement,
          theory,
          { ...stub, nodes, rootNodeId: parsed.rootNodeId },
          nodes,
        );

        // ── Phase 3D′ — Contradiction-detour pass ─────────────────────────
        setProgress(prev =>
          prev.map((p, idx) => idx === i ? { ...p, status: 'detouring', nodeCount: Object.keys(mergedNodes).length } : p)
        );

        const finalNodes = await runDetourPass(
          activeCase,
          witnessId,
          witnessName,
          witnessStatement,
          { ...stub, nodes: mergedNodes, rootNodeId: parsed.rootNodeId },
          mergedNodes,
        );

        const nodeCount = Object.keys(finalNodes).length;
        completedTrees.push({ ...stub, nodes: finalNodes, rootNodeId: parsed.rootNodeId });

        setProgress(prev =>
          prev.map((p, idx) => idx === i ? { ...p, status: 'done', nodeCount } : p)
        );

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setProgress(prev =>
          prev.map((p, idx) => idx === i ? { ...p, status: 'error', error: msg } : p)
        );
        // Log but continue with remaining topics
        console.error(`[3C] Tree generation failed for topic "${stub.topicLabel}":`, err);
      }
    }

    setFinished(true);
    onComplete(completedTrees);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const doneCount  = progress.filter(p => p.status === 'done').length;
  const errorCount = progress.filter(p => p.status === 'error').length;
  const totalCount = progress.length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'Times New Roman', Times, serif" }}>

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.7 }}>
          {finished
            ? `Generation complete — ${doneCount} of ${totalCount} topic${totalCount === 1 ? '' : 's'} built successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}.`
            : `Building cross-examination trees for ${witnessName} (3 passes per topic: tree → depth → citations). Do not close this tab.`}
        </div>
      </div>

      {/* Progress list */}
      <div style={{
        border: `1px solid ${T.bdr}`,
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 24,
      }}>
        {progress.map((p, i) => (
          <div key={p.stub.topicId} style={{
            display:    'flex',
            alignItems: 'center',
            gap:        12,
            padding:    '12px 16px',
            borderTop:  i > 0 ? `1px solid ${T.bdrL}` : 'none',
            background: p.status === 'generating' ? '#fdf8f8'
                      : p.status === 'done'       ? T.bg
                      : p.status === 'error'      ? '#fff8f8'
                      : T.card,
          }}>
            {/* Status icon */}
            <div style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>
              <StatusIcon status={p.status} />
            </div>

            {/* Topic label */}
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, color: T.text }}>{p.stub.topicLabel}</span>
              {p.status === 'done' && (
                <span style={{ fontSize: 11, color: T.mute, marginLeft: 10 }}>
                  {p.nodeCount} node{p.nodeCount === 1 ? '' : 's'}
                </span>
              )}
              {p.status === 'error' && p.error && (
                <div style={{ fontSize: 11, color: T.err, marginTop: 3 }}>
                  {p.error}
                </div>
              )}
            </div>

            {/* Status label */}
            <div style={{ fontSize: 11, color: T.mute, flexShrink: 0 }}>
              {p.status === 'pending'    && 'Queued'}
              {p.status === 'generating' && 'Building tree…'}
              {p.status === 'converging' && 'Extending deeper…'}
              {p.status === 'detouring'  && 'Citation pass…'}
              {p.status === 'done'       && 'Done'}
              {p.status === 'error'      && 'Failed'}
            </div>
          </div>
        ))}
      </div>

      {/* Overall error */}
      {overallError && (
        <div style={{
          padding:      '10px 14px',
          background:   '#fff0f0',
          border:       `1px solid ${T.err}`,
          borderRadius: 5,
          fontSize:     12,
          color:        T.err,
          marginBottom: 16,
        }}>
          {overallError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {finished && (
          <button
            onClick={onBack}
            style={{
              fontSize:   13,
              fontWeight: 700,
              fontFamily: "'Times New Roman', Times, serif",
              color:      T.bg,
              background: '#8a1a1a',
              border:     '1px solid #8a1a1a',
              borderRadius: 5,
              padding:    '10px 22px',
              cursor:     'pointer',
            }}
          >
            ← Back to Topic Selection
          </button>
        )}

        {!finished && (
          <span style={{ fontSize: 12, color: T.mute, fontStyle: 'italic' }}>
            Generating topic {currentIdx + 1} of {totalCount}…
          </span>
        )}

        {finished && errorCount > 0 && (
          <span style={{ fontSize: 12, color: T.err }}>
            {errorCount} topic{errorCount === 1 ? '' : 's'} failed — retry by re-selecting them in Topic Selection.
          </span>
        )}

        {finished && errorCount === 0 && (
          <span style={{ fontSize: 12, color: T.ok }}>
            All trees ready. Review them in Topic Selection before going to court.
          </span>
        )}
      </div>

    </div>
  );
}
