/**
 * AFS Legal OS — CrossExamValidatorPanel
 * Phase 3E: Validator UI
 * Phase 3F: Review / edit UI (inline — polarity override + manual note per node)
 *
 * BUILD ORDER:
 *   1. src/types/crossExam.ts                              (Phase 3A — done)
 *   2. src/storage/db.ts                                   (Phase 3A — done)
 *   3. src/storage/crossExamHelpers.ts                     (Phase 3B — done)
 *   4. src/engines/trial/CrossExamTopicSelector.tsx        (Phase 3B — done)
 *   5. src/engines/trial/CrossExamTreeGenerator.tsx        (Phase 3C — done)
 *   6. src/engines/trial/crossExamGenerationPasses.ts      (Phase 3D/3D′ — done)
 *   7. src/engines/trial/crossExamValidator.ts             (Phase 3E — build first)
 *   8. THIS FILE                                           ← Phase 3E UI / 3F
 *   9. Patch CrossExamTopicSelector.tsx                    (wire in validator + panel)
 *
 * PURPOSE:
 *   Rendered inside CrossExamTopicSelector when counsel clicks "Validate & Review"
 *   on a topic tree that has been generated (Phase 3C/3D/3D′ complete).
 *
 *   Section A — Validator Banner:
 *     Runs validateTree() on mount and on every manual edit.
 *     Shows pass/warn/fail summary badges.
 *     "Mark Trial-Ready" button enabled only when trialReady === true.
 *     Writes result to Dexie via patchValidation().
 *
 *   Section B — Node-by-node review (Phase 3F):
 *     Lists every node with its question, tier, purpose, expectedAnswer.
 *     Shows per-node gate results (✓ / ⚠ / ✕).
 *     Inline edit: counsel can set expectedAnswerSource on a FAIL node
 *     without re-generating (writes via patchNode()).
 *     Polarity override: toggle YES_advances / NO_advances for the whole topic.
 *     Manual trial-ready override: if all WARNs are acceptable, counsel can
 *     force-mark the tree trial-ready after reviewing.
 *
 * PROPS:
 *   tree          — the full CrossExamTreeRecord (loaded by parent)
 *   activeCase    — the active Case (for caseId)
 *   onClose       — called when counsel clicks "← Back"
 *   onTrialReady  — called when counsel marks the tree trial-ready
 *                   (parent refreshes its tree list from Dexie)
 *
 * CONSUMED BY:
 *   - src/engines/trial/CrossExamTopicSelector.tsx
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import type {
  CrossExamTreeRecord,
  CrossExamNode,
  NodeValidationResult,
  TopicPolarity,
} from '@/types/crossExam';
import { T, S } from '@/constants/tokens';
import {
  patchValidation,
  patchNode,
  setTrialReady,
  setTopicPolarity,
} from '@/storage/crossExamHelpers';
import { validateTree, summariseValidation } from '@/engines/trial/crossExamValidator';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamValidatorPanelProps {
  tree:         CrossExamTreeRecord;
  activeCase:   Case;
  onClose:      () => void;
  onTrialReady: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function GatePill({ result }: { result: 'PASS' | 'FAIL' | 'WARN' }) {
  const colour = result === 'PASS' ? T.ok : result === 'WARN' ? '#8a5a00' : T.err;
  const label  = result === 'PASS' ? '✓ PASS' : result === 'WARN' ? '⚠ WARN' : '✕ FAIL';
  return (
    <span style={{
      fontSize:     10,
      fontWeight:   700,
      color:        colour,
      fontFamily:   "'Times New Roman', Times, serif",
      letterSpacing: '.06em',
      padding:      '2px 6px',
      border:       `1px solid ${colour}`,
      borderRadius: 3,
      display:      'inline-block',
    }}>
      {label}
    </span>
  );
}

function TierBadge({ tier }: { tier: CrossExamNode['tier'] }) {
  const colours: Record<string, string> = {
    opener:       '#1a3a6a',
    escalation:   '#4a1a8a',
    climax:       '#8a1a1a',
    recovery:     '#1a5a30',
    contradiction:'#7a4a00',
  };
  return (
    <span style={{
      fontSize:     9,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color:        colours[tier] ?? T.mute,
      fontFamily:   "'Times New Roman', Times, serif",
      fontWeight:   700,
    }}>
      {tier}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Node row — inline source edit for Gate 1 FAILs
// ─────────────────────────────────────────────────────────────────────────────

interface NodeRowProps {
  node:          CrossExamNode;
  nodeResult:    NodeValidationResult;
  caseId:        string;
  witnessId:     string;
  topicId:       string;
  onNodePatched: (updated: CrossExamNode) => void;
}

function NodeRow({
  node,
  nodeResult,
  caseId,
  witnessId,
  topicId,
  onNodePatched,
}: NodeRowProps) {
  const [editingSource, setEditingSource] = useState(false);
  const [sourceText, setSourceText]       = useState(node.expectedAnswerSource ?? '');
  const [saving, setSaving]               = useState(false);

  const purposeLabel = node.purpose
    ? node.purpose.kind === 'theory_element'
      ? `Theory: ${(node.purpose as { kind: 'theory_element'; elementLabel: string }).elementLabel}`
      : `Weakness: ${(node.purpose as { kind: 'opposing_weakness'; weaknessLabel: string }).weaknessLabel}`
    : '(no purpose)';

  async function saveSource() {
    setSaving(true);
    const updated: CrossExamNode = { ...node, expectedAnswerSource: sourceText.trim() };
    await patchNode(caseId, witnessId, topicId, updated);
    setSaving(false);
    setEditingSource(false);
    onNodePatched(updated);
  }

  const rowBg =
    nodeResult.knownAnswerGate === 'FAIL' || nodeResult.purposeGate === 'FAIL'
      ? '#fff8f8'
      : nodeResult.knownAnswerGate === 'WARN' || nodeResult.purposeGate === 'WARN'
      ? '#fffdf0'
      : T.bg;

  return (
    <div style={{
      padding:    '12px 14px',
      background: rowBg,
      borderBottom: `1px solid ${T.bdrL}`,
    }}>
      {/* Question + tier */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
        <TierBadge tier={node.tier} />
        <span style={{
          fontSize:   13,
          color:      T.text,
          fontFamily: "'Times New Roman', Times, serif",
          flex:       1,
          lineHeight: 1.55,
        }}>
          {node.question}
        </span>
        {node.terminal && (
          <span style={{
            fontSize:   10,
            color:      node.terminalKind === 'admission_reached' ? T.ok : T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            flexShrink: 0,
          }}>
            {node.terminalKind === 'admission_reached' ? '⊠ Admission' : '⊘ Exhausted'}
          </span>
        )}
      </div>

      {/* Gates row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>Gate 1:</span>
        <GatePill result={nodeResult.knownAnswerGate} />
        <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginLeft: 8 }}>Gate 2:</span>
        <GatePill result={nodeResult.purposeGate} />
        {node.contradictionDetour && (
          <span style={{ fontSize: 10, color: '#4a1a8a', fontFamily: "'Times New Roman', Times, serif", marginLeft: 8 }}>
            ⚡ Detour ready
          </span>
        )}
      </div>

      {/* Purpose */}
      <div style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 4 }}>
        {purposeLabel}
      </div>

      {/* Expected answer */}
      {node.expectedAnswer && (
        <div style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 4 }}>
          Expected: <strong>{node.expectedAnswer}</strong>
          {node.expectedAnswerSource
            ? ` — ${node.expectedAnswerSource}`
            : <span style={{ color: T.err }}> (no source)</span>}
        </div>
      )}

      {/* Failure messages */}
      {nodeResult.messages.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {nodeResult.messages.map((msg, i) => (
            <div key={i} style={{
              fontSize:   11,
              color:      msg.startsWith('Orphan') ? '#7a4a00' : T.err,
              fontFamily: "'Times New Roman', Times, serif",
              marginBottom: 2,
            }}>
              {msg}
            </div>
          ))}
        </div>
      )}

      {/* Inline source fix — only shown for Gate 1 FAIL */}
      {nodeResult.knownAnswerGate === 'FAIL' && node.expectedAnswer && (
        <div style={{ marginTop: 8 }}>
          {!editingSource ? (
            <button
              onClick={() => setEditingSource(true)}
              style={{
                fontSize:   11,
                color:      '#8a1a1a',
                background: 'transparent',
                border:     '1px solid #8a1a1a',
                borderRadius: 3,
                padding:    '3px 10px',
                cursor:     'pointer',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Fix: add source →
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={{ ...S.inp, fontSize: 12, padding: '6px 10px', flex: 1 }}
                value={sourceText}
                onChange={e => setSourceText(e.target.value)}
                placeholder='e.g. "Witness Statement, para 3" or "Exhibit B, p.4"'
                autoFocus
              />
              <button
                onClick={saveSource}
                disabled={saving || !sourceText.trim()}
                style={{
                  fontSize:   11,
                  color:      T.bg,
                  background: saving ? T.mute : '#2a6a3a',
                  border:     'none',
                  borderRadius: 3,
                  padding:    '6px 14px',
                  cursor:     saving ? 'default' : 'pointer',
                  fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingSource(false); setSourceText(node.expectedAnswerSource ?? ''); }}
                style={{
                  fontSize:   11,
                  color:      T.mute,
                  background: 'transparent',
                  border:     'none',
                  cursor:     'pointer',
                  fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamValidatorPanel({
  tree: initialTree,
  activeCase,
  onClose,
  onTrialReady,
}: CrossExamValidatorPanelProps) {
  const caseId    = activeCase.id;
  const witnessId = initialTree.witnessId;
  const topicId   = initialTree.topicId;

  // Local mutable copy of the tree — updated as counsel edits nodes
  const [tree, setTree] = useState<CrossExamTreeRecord>(initialTree);

  // Validator result
  const [validationResult, setValidationResult] = useState(() => validateTree(initialTree));
  const [summary, setSummary]                   = useState(() => summariseValidation(validateTree(initialTree)));

  // UI state
  const [markingReady, setMarkingReady]   = useState(false);
  const [readyMsg, setReadyMsg]           = useState('');
  const [polarity, setPolarity]           = useState<TopicPolarity>(initialTree.polarity);
  const [savingPolarity, setSavingPolarity] = useState(false);
  const [filterFail, setFilterFail]       = useState(false);

  // Re-run validator whenever the tree's node map changes
  const revalidate = useCallback((updatedTree: CrossExamTreeRecord) => {
    const result = validateTree(updatedTree);
    setValidationResult(result);
    setSummary(summariseValidation(result));
    // Write to Dexie (fire-and-forget — no await needed in the callback chain)
    patchValidation(caseId, witnessId, topicId, result).catch(console.error);
  }, [caseId, witnessId, topicId]);

  // Initial validation write on mount
  useEffect(() => {
    patchValidation(caseId, witnessId, topicId, validationResult).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Node patch callback ────────────────────────────────────────────────────
  function handleNodePatched(updated: CrossExamNode) {
    setTree(prev => {
      const updatedTree: CrossExamTreeRecord = {
        ...prev,
        nodes: { ...prev.nodes, [updated.id]: updated },
      };
      revalidate(updatedTree);
      return updatedTree;
    });
  }

  // ── Mark trial-ready ───────────────────────────────────────────────────────
  async function handleMarkTrialReady(forceReady: boolean) {
    setMarkingReady(true);
    await setTrialReady(caseId, witnessId, topicId, forceReady);
    setMarkingReady(false);
    if (forceReady) {
      setReadyMsg('Marked trial-ready. This tree will be available in the Courtroom Walker.');
      onTrialReady();
    }
  }

  // ── Polarity toggle ────────────────────────────────────────────────────────
  async function handlePolarityChange(newPolarity: TopicPolarity) {
    setSavingPolarity(true);
    await setTopicPolarity(caseId, witnessId, topicId, newPolarity);
    setPolarity(newPolarity);
    setSavingPolarity(false);
  }

  // ── Node list — sorted: FAILs first, then WARNs, then PASSes ─────────────
  const nodeResultMap = new Map<string, NodeValidationResult>(
    validationResult.nodeResults.map(r => [r.nodeId, r])
  );

  const allNodes = Object.values(tree.nodes);

  function nodeScore(nodeId: string): number {
    const r = nodeResultMap.get(nodeId);
    if (!r) return 0;
    if (r.knownAnswerGate === 'FAIL' || r.purposeGate === 'FAIL') return 2;
    if (r.knownAnswerGate === 'WARN' || r.purposeGate === 'WARN') return 1;
    return 0;
  }

  const sortedNodes = [...allNodes].sort((a, b) => nodeScore(b.id) - nodeScore(a.id));
  const displayedNodes = filterFail
    ? sortedNodes.filter(n => nodeScore(n.id) > 0)
    : sortedNodes;

  // ── Colours ────────────────────────────────────────────────────────────────
  const bannerBg    = validationResult.trialReady ? '#f0f8f2' : '#fff8f8';
  const bannerBdr   = validationResult.trialReady ? '#2a6a3a' : '#c08080';
  const bannerColor = validationResult.trialReady ? T.ok     : T.err;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Times New Roman', Times, serif" }}>

      {/* Back */}
      <button
        onClick={onClose}
        style={{
          fontSize:   12,
          color:      T.dim,
          background: 'transparent',
          border:     'none',
          cursor:     'pointer',
          fontFamily: "'Times New Roman', Times, serif",
          padding:    '0 0 16px',
          display:    'block',
        }}
      >
        ← Back to Topic Selection
      </button>

      {/* Title */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, color: T.text, fontWeight: 600, marginBottom: 4 }}>
          {tree.topicLabel}
        </div>
        <div style={{ fontSize: 11, color: T.mute, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {tree.topicSource} · {allNodes.length} node{allNodes.length === 1 ? '' : 's'}
          {tree.detoursComplete ? ' · Detours complete' : ''}
        </div>
      </div>

      {/* ── Validator Banner ─────────────────────────────────────────────── */}
      <div style={{
        background:   bannerBg,
        border:       `1px solid ${bannerBdr}`,
        borderRadius: 6,
        padding:      '14px 18px',
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: bannerColor, marginBottom: 10 }}>
          {validationResult.trialReady ? '✓ Both gates passed — tree is trial-ready' : '✕ Validation issues found'}
        </div>

        {/* Summary badges */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: T.ok }}>
            ✓ {summary.passBoth} pass
          </span>
          <span style={{ fontSize: 12, color: '#8a5a00' }}>
            ⚠ {summary.warnOnly} warn
          </span>
          <span style={{ fontSize: 12, color: T.err }}>
            ✕ {summary.failAny} fail
          </span>
          {summary.orphanCount > 0 && (
            <span style={{ fontSize: 12, color: '#7a4a00' }}>
              ◌ {summary.orphanCount} orphan
            </span>
          )}
        </div>

        {/* Failure messages */}
        {validationResult.summaryFail.map((msg, i) => (
          <div key={i} style={{ fontSize: 12, color: T.err, marginBottom: 3 }}>
            {msg}
          </div>
        ))}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {validationResult.trialReady && !tree.trialReady && (
            <button
              onClick={() => handleMarkTrialReady(true)}
              disabled={markingReady}
              style={{
                fontSize:   12,
                fontWeight: 700,
                color:      T.bg,
                background: '#2a6a3a',
                border:     'none',
                borderRadius: 4,
                padding:    '8px 20px',
                cursor:     markingReady ? 'default' : 'pointer',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              {markingReady ? 'Marking…' : '⊠ Mark Trial-Ready'}
            </button>
          )}

          {tree.trialReady && (
            <span style={{ fontSize: 12, color: T.ok, fontWeight: 700 }}>
              ⊠ This tree is marked trial-ready.
            </span>
          )}

          {/* Force-mark even with WARNs (only if no FAILs) */}
          {!validationResult.trialReady && summary.failAny === 0 && summary.warnOnly > 0 && !tree.trialReady && (
            <button
              onClick={() => handleMarkTrialReady(true)}
              disabled={markingReady}
              style={{
                fontSize:   12,
                color:      '#8a5a00',
                background: 'transparent',
                border:     '1px solid #8a5a00',
                borderRadius: 4,
                padding:    '7px 16px',
                cursor:     markingReady ? 'default' : 'pointer',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Accept warnings & mark trial-ready
            </button>
          )}

          {readyMsg && (
            <span style={{ fontSize: 12, color: T.ok, fontFamily: "'Times New Roman', Times, serif" }}>
              {readyMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Phase 3F — Polarity override ──────────────────────────────────── */}
      <div style={{
        border:       `1px solid ${T.bdr}`,
        borderRadius: 6,
        padding:      '12px 16px',
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 11, color: T.mute, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Topic Polarity
        </div>
        <div style={{ fontSize: 12, color: T.dim, marginBottom: 10 }}>
          Which answer direction advances our theory for this topic?
          In the courtroom walker, YES = red tap, NO = green tap.
          Set polarity so the "advancing" answer is the green tap.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {(['YES_advances', 'NO_advances'] as const).map(p => (
            <button
              key={p}
              onClick={() => handlePolarityChange(p)}
              disabled={savingPolarity}
              style={{
                fontSize:   12,
                fontWeight: polarity === p ? 700 : 400,
                color:      polarity === p ? T.bg : T.text,
                background: polarity === p ? '#1a3a6a' : T.card,
                border:     `1px solid ${polarity === p ? '#1a3a6a' : T.bdr}`,
                borderRadius: 4,
                padding:    '7px 16px',
                cursor:     savingPolarity ? 'default' : 'pointer',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              {p === 'YES_advances' ? 'YES advances' : 'NO advances'}
            </button>
          ))}
          {savingPolarity && (
            <span style={{ fontSize: 11, color: T.mute, alignSelf: 'center' }}>Saving…</span>
          )}
        </div>
      </div>

      {/* ── Node list ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 600, flex: 1 }}>
          Node Review ({displayedNodes.length} of {allNodes.length})
        </div>
        <button
          onClick={() => setFilterFail(f => !f)}
          style={{
            fontSize:   11,
            color:      filterFail ? T.bg : T.dim,
            background: filterFail ? '#8a1a1a' : T.card,
            border:     `1px solid ${filterFail ? '#8a1a1a' : T.bdr}`,
            borderRadius: 3,
            padding:    '4px 12px',
            cursor:     'pointer',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          {filterFail ? 'Show all nodes' : 'Show issues only'}
        </button>
      </div>

      {displayedNodes.length === 0 && (
        <div style={{ padding: 20, color: T.mute, fontSize: 13, fontStyle: 'italic' }}>
          {filterFail ? 'No issues found — all nodes passed.' : 'No nodes in this tree.'}
        </div>
      )}

      <div style={{
        border:       `1px solid ${T.bdr}`,
        borderRadius: 6,
        overflow:     'hidden',
        marginBottom: 32,
      }}>
        {displayedNodes.map(node => {
          const nodeResult = nodeResultMap.get(node.id) ?? {
            nodeId:          node.id,
            knownAnswerGate: 'WARN' as const,
            purposeGate:     'WARN' as const,
            messages:        ['Node not found in validator result — re-run validation.'],
          };
          return (
            <NodeRow
              key={node.id}
              node={node}
              nodeResult={nodeResult}
              caseId={caseId}
              witnessId={witnessId}
              topicId={topicId}
              onNodePatched={handleNodePatched}
            />
          );
        })}
      </div>

    </div>
  );
}
