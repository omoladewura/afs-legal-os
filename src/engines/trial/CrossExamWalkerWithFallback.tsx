/**
 * AFS Legal OS — CrossExamWalkerWithFallback
 * Phase 4E — File 2 of 2
 *
 * OUTPUT PATH:
 *   src/engines/trial/CrossExamWalkerWithFallback.tsx
 *
 * ─── BUILD ORDER — must be respected ───────────────────────────────────────
 *
 *  ① src/types/crossExam.ts                        (Phase 3A — already built)
 *  ② src/storage/db.ts                             (Phase 3A — already built)
 *  ③ src/storage/crossExamHelpers.ts               (Phase 3B — already built)
 *  ④ src/engines/trial/CrossExamWalker.tsx         (Phase 4A — already built)
 *  ⑤ src/engines/trial/CrossExamTopicSwitcher.tsx  (Phase 4B — already built)
 *  ⑥ src/engines/trial/CrossExamSessionLog.tsx     (Phase 4C — already built)
 *  ⑦ src/utils/crossExamDryPath.ts                 (Phase 4E step 1 — built above)
 *     MUST EXIST before this file is compiled.
 *
 *  ⑧ THIS FILE  ← Phase 4E step 2
 *
 * ─── PURPOSE ────────────────────────────────────────────────────────────────
 *
 * Wraps CrossExamWalker (Phase 4A) to add the dry-path fallback behaviour
 * required by Phase 4E:
 *
 *   (a) When the walker reaches a TERMINAL node or a null position, this
 *       wrapper intercepts and classifies the state as either
 *       'admission_reached' or 'content_exhausted'.
 *
 *   (b) For 'admission_reached': shows a prominent green "STOP HERE" card.
 *       No further question is surfaced — the goal was achieved.
 *
 *   (c) For 'content_exhausted': calls findStrongestUnusedNode() using the
 *       topic's walk state.  If a candidate exists, shows a "STRONGEST
 *       UNUSED QUESTION" card with a "Jump here" tap target.  If no unused
 *       node remains, shows "Topic fully exhausted."
 *
 * This component is a drop-in replacement for CrossExamWalker in any parent
 * that has access to a TopicWalkState.  It preserves all CrossExamWalker
 * props (tree, currentNodeId, initialNodeId, onStep) and adds:
 *
 *   topicState   — the current TopicWalkState for this topic (used to derive
 *                  the "used node ids" set for the fallback scorer).
 *   onFallbackJump — called when counsel taps "Jump here" on the fallback card.
 *                    The parent (Phase 4F) is responsible for persisting the
 *                    new position to Dexie.  This component does not write.
 *
 * ─── WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────
 *
 *  • Does NOT write to Dexie (Phase 4F owns all persistence).
 *  • Does NOT log session steps (Phase 4C/4F own the log).
 *  • Does NOT handle contradiction detour triggering (Phase 4D).
 *  • Does NOT auto-save (Phase 4F).
 *  • Does NOT manage session identity / caseId / witnessId.
 *
 * ─── CONSUMED BY ────────────────────────────────────────────────────────────
 *
 *  Phase 4F (auto-save session manager) — replaces CrossExamWalker as the
 *  inner walker in the full courtroom UI.  Phase 4F wraps onStep and
 *  onFallbackJump to persist every position change.
 *
 *  Phase 4B CrossExamTopicSwitcher may also swap CrossExamWalker for this
 *  component once Phase 4F wires it in — no change to CrossExamTopicSwitcher
 *  itself is required.
 */

import { useState, useCallback, useMemo } from 'react';
import type {
  CrossExamTreeRecord,
  CrossExamNode,
  TopicWalkState,
} from '@/types/crossExam';
import { CrossExamWalker, type WalkerStepEvent } from '@/engines/trial/CrossExamWalker';
import {
  classifyTerminalState,
  collectUsedNodeIds,
  findStrongestUnusedNode,
} from '@/utils/crossExamDryPath';
import { T } from '@/constants/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamWalkerWithFallbackProps {
  /** The topic tree to walk */
  tree: CrossExamTreeRecord;

  /** Controlled walker position. If provided, this component is fully controlled. */
  currentNodeId?: string | null;

  /** Initial position when uncontrolled. Defaults to tree.rootNodeId. */
  initialNodeId?: string | null;

  /**
   * The live TopicWalkState for this topic.
   * Used to derive the "used node ids" set for dry-path scoring.
   * Must be kept up-to-date by the parent (Phase 4F) after each step.
   */
  topicState: TopicWalkState;

  /**
   * Fired on every YES/NO tap — same signature as CrossExamWalker's onStep.
   * Phase 4F hooks here to log the step and persist to Dexie.
   */
  onStep?: (e: WalkerStepEvent) => void;

  /**
   * Fired when counsel taps "Jump here" on the dry-path fallback card.
   * Receives the CrossExamNode that was selected as the strongest unused node.
   * Phase 4F persists the new position; this component does not write to Dexie.
   */
  onFallbackJump?: (node: CrossExamNode) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admission-reached card — prominent green stop signal
// ─────────────────────────────────────────────────────────────────────────────

function AdmissionReachedCard() {
  return (
    <div
      style={{
        margin:        '32px 16px',
        padding:       '28px 24px',
        background:    '#f0faf3',
        border:        '2px solid #2a6a3a',
        borderRadius:  12,
        textAlign:     'center',
      }}
    >
      <div
        style={{
          fontSize:     32,
          marginBottom: 12,
          lineHeight:   1,
        }}
      >
        ⊠
      </div>
      <div
        style={{
          fontSize:   18,
          fontWeight: 700,
          color:      '#2a6a3a',
          fontFamily: "'Times New Roman', Times, serif",
          marginBottom: 8,
        }}
      >
        Admission Reached — Stop Here
      </div>
      <div
        style={{
          fontSize:   13,
          color:      '#2a6a3a',
          fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.6,
          opacity:    0.85,
        }}
      >
        The strategic goal for this line was achieved.
        Do not press further on this question —
        move to the next topic or close cross-examination.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Content-exhausted / fallback card
// ─────────────────────────────────────────────────────────────────────────────

function ContentExhaustedCard({
  fallbackNode,
  onJump,
}: {
  fallbackNode: CrossExamNode | null;
  onJump:       (node: CrossExamNode) => void;
}) {
  if (!fallbackNode) {
    // Genuinely nothing left — topic is fully walked.
    return (
      <div
        style={{
          margin:    '32px 16px',
          padding:   '24px 20px',
          background: T.card,
          border:    `1px solid ${T.bdr}`,
          borderRadius: 10,
          textAlign:  'center',
        }}
      >
        <div
          style={{
            fontSize:     24,
            marginBottom: 10,
            color:        T.mute,
          }}
        >
          ⊘
        </div>
        <div
          style={{
            fontSize:   15,
            fontWeight: 600,
            color:      T.text,
            fontFamily: "'Times New Roman', Times, serif",
            marginBottom: 6,
          }}
        >
          Topic Fully Exhausted
        </div>
        <div
          style={{
            fontSize:   13,
            color:      T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            lineHeight: 1.6,
          }}
        >
          Every question in this topic has been walked.
          Switch to another topic or end cross-examination.
        </div>
      </div>
    );
  }

  // There is a fallback — surface the strongest unused question.
  return (
    <div
      style={{
        margin:       '24px 16px',
        padding:      '20px 20px',
        background:   '#fafaf7',
        border:       `1px solid ${T.bdr}`,
        borderRadius: 10,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize:     10,
          fontWeight:   700,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          color:        T.mute,
          fontFamily:   "'Times New Roman', Times, serif",
          marginBottom: 12,
        }}
      >
        Branch exhausted — Strongest unused question
      </div>

      {/* Tier badge */}
      <div
        style={{
          display:       'inline-block',
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color:         '#1a3a6a',
          background:    '#e8eef7',
          borderRadius:  4,
          padding:       '3px 8px',
          marginBottom:  12,
          fontFamily:    "'Times New Roman', Times, serif",
        }}
      >
        {fallbackNode.tier}
      </div>

      {/* The question */}
      <div
        style={{
          fontSize:   17,
          lineHeight: 1.6,
          color:      T.text,
          fontFamily: "'Times New Roman', Times, serif",
          fontWeight: fallbackNode.tier === 'climax' ? 700 : 400,
          marginBottom: 18,
        }}
      >
        {fallbackNode.question}
      </div>

      {/* Purpose tag */}
      {fallbackNode.purpose.kind === 'theory_element' && (
        <div
          style={{
            fontSize:   11,
            color:      T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            marginBottom: 16,
            fontStyle:  'italic',
          }}
        >
          Advances theory element: {fallbackNode.purpose.elementLabel}
        </div>
      )}
      {fallbackNode.purpose.kind === 'opposing_weakness' && (
        <div
          style={{
            fontSize:   11,
            color:      T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            marginBottom: 16,
            fontStyle:  'italic',
          }}
        >
          Attacks weakness: {fallbackNode.purpose.weaknessLabel}
        </div>
      )}

      {/* Expected-answer grounding note */}
      {fallbackNode.expectedAnswer !== undefined && (
        <div
          style={{
            fontSize:     11,
            color:        '#2a6a3a',
            fontFamily:   "'Times New Roman', Times, serif",
            marginBottom: 16,
          }}
        >
          Expected answer: <strong>{fallbackNode.expectedAnswer}</strong>
          {fallbackNode.expectedAnswerSource
            ? ` — ${fallbackNode.expectedAnswerSource}`
            : ''}
        </div>
      )}

      {/* Jump button — large tap target (≥ 48 px) */}
      <button
        onClick={() => onJump(fallbackNode)}
        style={{
          display:       'block',
          width:         '100%',
          minHeight:     52,
          fontSize:      15,
          fontWeight:    700,
          letterSpacing: '.04em',
          color:         '#ffffff',
          background:    '#1a3a6a',
          border:        'none',
          borderRadius:  8,
          cursor:        'pointer',
          fontFamily:    "'Times New Roman', Times, serif",
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Jump to this question →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamWalkerWithFallback({
  tree,
  currentNodeId,
  initialNodeId,
  topicState,
  onStep,
  onFallbackJump,
}: CrossExamWalkerWithFallbackProps) {
  const controlled = currentNodeId !== undefined;

  // Internal position — only used when not controlled.
  const [internalNodeId, setInternalNodeId] = useState<string | null>(
    initialNodeId ?? tree.rootNodeId ?? null,
  );

  const nodeId  = controlled ? currentNodeId : internalNodeId;
  const node: CrossExamNode | null = useMemo(
    () => (nodeId ? tree.nodes[nodeId] ?? null : null),
    [nodeId, tree.nodes],
  );

  // Decide whether the walker is in a "dry path" state.
  // A dry path triggers when:
  //   (a) the current node is terminal (admission or exhaustion), OR
  //   (b) nodeId is null (position fell off the tree)
  const isDryPath: boolean = node === null || node.terminal;

  // Derive used-node set and best fallback candidate — only computed when
  // actually in a dry path state to avoid wasted work during the main walk.
  const usedNodeIds: ReadonlySet<string> = useMemo(
    () => (isDryPath ? collectUsedNodeIds(topicState) : new Set<string>()),
    [isDryPath, topicState],
  );

  const fallbackNode: CrossExamNode | null = useMemo(() => {
    if (!isDryPath) return null;
    if (node?.terminalKind === 'admission_reached') return null; // don't surface fallback after win
    return findStrongestUnusedNode(tree, usedNodeIds);
  }, [isDryPath, node, tree, usedNodeIds]);

  // Step handler — updates internal position if uncontrolled, then fires
  // onStep so Phase 4F can log + persist.
  const handleStep = useCallback(
    (e: WalkerStepEvent) => {
      if (!controlled) setInternalNodeId(e.nextId);
      onStep?.(e);
    },
    [controlled, onStep],
  );

  // Fallback jump — parent (Phase 4F) owns persistence.
  const handleFallbackJump = useCallback(
    (candidate: CrossExamNode) => {
      if (!controlled) setInternalNodeId(candidate.id);
      onFallbackJump?.(candidate);
    },
    [controlled, onFallbackJump],
  );

  // ── Tree not yet generated ────────────────────────────────────────────────
  if (!tree.rootNodeId || Object.keys(tree.nodes).length === 0) {
    return (
      <div style={{ padding: 24, color: T.mute, fontSize: 13, fontStyle: 'italic' }}>
        This topic has not been generated yet.
      </div>
    );
  }

  // ── Dry-path state ────────────────────────────────────────────────────────
  if (isDryPath) {
    const terminalState = classifyTerminalState(node);

    if (terminalState === 'admission_reached') {
      return <AdmissionReachedCard />;
    }

    // content_exhausted — show fallback if available, otherwise topic-done
    return (
      <ContentExhaustedCard
        fallbackNode={fallbackNode}
        onJump={handleFallbackJump}
      />
    );
  }

  // ── Active walk — delegate entirely to CrossExamWalker (Phase 4A) ─────────
  // Pass currentNodeId only when controlled so Walker handles its own state
  // correctly in uncontrolled mode.
  return (
    <CrossExamWalker
      tree={tree}
      {...(controlled
        ? { currentNodeId }
        : { initialNodeId: internalNodeId ?? tree.rootNodeId })}
      onStep={handleStep}
    />
  );
}
