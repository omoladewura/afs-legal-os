/**
 * AFS Legal OS — CrossExamTopicSwitcher
 * Phase 4B: Topic switcher
 *
 * BUILD ORDER:
 *   1. src/types/crossExam.ts                          (Phase 3A — done)
 *   2. src/storage/db.ts                                (Phase 3A — done)
 *   3. src/storage/crossExamHelpers.ts                  (Phase 3B — done)
 *   4. src/engines/trial/CrossExamWalker.tsx            (Phase 4A — done)
 *   5. THIS FILE                                        ← Phase 4B
 *
 * PURPOSE:
 *   Lets counsel move between a witness's topic-trees live, mid-cross.
 *   Each topic keeps its own current node position independently — jumping
 *   from "Custody arrangement" to "Financial disclosure" and back must land
 *   exactly where each topic was left, not at the root.
 *
 *   This file owns the position map and renders ONE CrossExamWalker in
 *   controlled mode per active topic (only the visible one is mounted).
 *   It does not persist anything to Dexie — that is Phase 4F (autosave),
 *   which will wrap onStep / activeTopicId changes from outside this
 *   component without altering it. It does not log session steps — that is
 *   4C. It does not handle contradiction detours — that is 4D.
 *
 * PROPS:
 *   trees           — all CrossExamTreeRecord for this witness (Phase 3
 *                     output). Only trialReady trees are selectable.
 *   activeTopicId   — optional controlled active topic (for Phase 4F resume)
 *   initialTopicId  — initial active topic when uncontrolled
 *   positions       — optional controlled position map { topicId: nodeId | null }
 *   onTopicChange    — fired when counsel taps a different topic tab
 *   onStep          — forwarded from CrossExamWalker; fired on every tap
 *                     with the active topicId attached
 *
 * CONSUMED BY:
 *   - Phase 4 Courtroom Walker screen (top-level session UI)
 *   - Phase 4F Auto-save (wraps onStep / onTopicChange to persist to Dexie)
 */

import { useState, useCallback, useMemo } from 'react';
import type { CrossExamTreeRecord } from '@/types/crossExam';
import { T } from '@/constants/tokens';
import { CrossExamWalker, type WalkerStepEvent } from '@/engines/trial/CrossExamWalker';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export type TopicPositionMap = Record<string, string | null>;

export interface TopicStepEvent extends WalkerStepEvent {
  topicId: string;
}

export interface CrossExamTopicSwitcherProps {
  trees: CrossExamTreeRecord[];

  /** Controlled active topic — if provided, parent owns which topic is shown. */
  activeTopicId?: string | null;
  /** Initial active topic when uncontrolled. Defaults to the first trial-ready tree. */
  initialTopicId?: string | null;

  /** Controlled position map — if provided, parent owns all topic positions. */
  positions?: TopicPositionMap;

  onTopicChange?: (topicId: string) => void;
  onStep?: (e: TopicStepEvent) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic tab
// ─────────────────────────────────────────────────────────────────────────────

function TopicTab({
  label,
  active,
  finished,
  onTap,
}: {
  label: string;
  active: boolean;
  finished: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      style={{
        flexShrink:   0,
        fontSize:     13,
        fontWeight:   active ? 700 : 400,
        color:        active ? '#ffffff' : T.text,
        background:   active ? '#1a3a6a' : T.card,
        border:       `1px solid ${active ? '#1a3a6a' : T.bdr}`,
        borderRadius: 6,
        padding:      '10px 16px',
        cursor:       'pointer',
        fontFamily:   "'Times New Roman', Times, serif",
        whiteSpace:   'nowrap',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
      {finished && <span style={{ marginLeft: 6, opacity: 0.7 }}>⊘</span>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamTopicSwitcher({
  trees,
  activeTopicId,
  initialTopicId,
  positions,
  onTopicChange,
  onStep,
}: CrossExamTopicSwitcherProps) {
  // Only trial-ready trees are usable live in court.
  const usableTrees = useMemo(() => trees.filter(t => t.trialReady), [trees]);

  const controlledTopic = activeTopicId !== undefined;
  const [internalTopicId, setInternalTopicId] = useState<string | null>(
    initialTopicId ?? usableTrees[0]?.topicId ?? null
  );
  const currentTopicId = controlledTopic ? activeTopicId : internalTopicId;

  // Per-topic position map — uncontrolled fallback, keyed by topicId.
  // Each topic's position is independent of every other topic's.
  const [internalPositions, setInternalPositions] = useState<TopicPositionMap>({});
  const controlledPositions = positions !== undefined;
  const positionMap = controlledPositions ? positions : internalPositions;

  const selectTopic = useCallback(
    (topicId: string) => {
      onTopicChange?.(topicId);
      if (!controlledTopic) setInternalTopicId(topicId);
    },
    [controlledTopic, onTopicChange]
  );

  const handleStep = useCallback(
    (e: WalkerStepEvent) => {
      if (!currentTopicId) return;
      onStep?.({ ...e, topicId: currentTopicId });
      if (!controlledPositions) {
        setInternalPositions(prev => ({ ...prev, [currentTopicId]: e.nextId }));
      }
    },
    [currentTopicId, controlledPositions, onStep]
  );

  const activeTree = usableTrees.find(t => t.topicId === currentTopicId) ?? null;

  // ── No trial-ready topics ─────────────────────────────────────────────────
  if (usableTrees.length === 0) {
    return (
      <div style={{ padding: 24, color: T.mute, fontSize: 13, fontStyle: 'italic' }}>
        No trial-ready topics for this witness yet. Validate and mark a topic
        trial-ready in Trial Engine before starting a courtroom session.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topic tab strip */}
      <div
        style={{
          display:    'flex',
          gap:        8,
          padding:    '12px 16px',
          overflowX:  'auto',
          borderBottom: `1px solid ${T.bdr}`,
          flexShrink: 0,
        }}
      >
        {usableTrees.map(t => {
          const pos = positionMap[t.topicId];
          // A topic is "finished" once its walker has reached a null position
          // (i.e. it has been started — pos !== undefined — and is now exhausted).
          const finished = pos === null && positionMap[t.topicId] !== undefined;
          return (
            <TopicTab
              key={t.topicId}
              label={t.topicLabel}
              active={t.topicId === currentTopicId}
              finished={finished}
              onTap={() => selectTopic(t.topicId)}
            />
          );
        })}
      </div>

      {/* Active topic's walker — only the visible topic is mounted.
          Its position is read from / written to positionMap[topicId] only,
          so switching tabs and coming back restores exactly where it was. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTree ? (
          <CrossExamWalker
            key={activeTree.topicId}
            tree={activeTree}
            currentNodeId={
              positionMap[activeTree.topicId] !== undefined
                ? positionMap[activeTree.topicId]
                : activeTree.rootNodeId
            }
            onStep={handleStep}
          />
        ) : (
          <div style={{ padding: 24, color: T.mute, fontSize: 13, fontStyle: 'italic' }}>
            Select a topic above.
          </div>
        )}
      </div>
    </div>
  );
}
