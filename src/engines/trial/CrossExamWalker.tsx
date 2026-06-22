/**
 * AFS Legal OS — CrossExamWalker
 * Phase 4A: Tree Walker core
 *
 * BUILD ORDER:
 *   1. src/types/crossExam.ts                          (Phase 3A — done)
 *   2. src/storage/db.ts                                (Phase 3A — done)
 *   3. src/storage/crossExamHelpers.ts                  (Phase 3B — done)
 *   4. THIS FILE                                        ← Phase 4A
 *
 * PURPOSE:
 *   The in-courtroom tree walker. Given a single trial-ready
 *   CrossExamTreeRecord, displays the current node's question and two large
 *   tap targets (YES / NO). Tapping jumps to the next node purely from the
 *   in-memory node map — no network call, no Dexie read, no delay.
 *
 *   Phase 4A is deliberately narrow: it knows nothing about sessions,
 *   topic-switching, contradiction detours, dry-path fallback, autosave, or
 *   manual question insertion. Those are Phases 4B–4G and will wrap this
 *   component / extend its callback surface without altering this core
 *   walking mechanic.
 *
 * PROPS:
 *   tree         — the CrossExamTreeRecord to walk (must be trial-ready)
 *   currentNodeId — optional controlled position; if omitted, the walker
 *                   manages its own position starting at tree.rootNodeId
 *   onStep        — optional callback fired after every tap, before the
 *                   internal jump completes its render. Future phases
 *                   (4C session log, 4D contradiction handling, 4F autosave)
 *                   hook in here without this file needing to change.
 *
 * CONSUMED BY:
 *   - Phase 4B Topic switcher (renders one CrossExamWalker per active topic)
 *   - Phase 4F Auto-save (wraps onStep to persist position to Dexie)
 */

import { useState, useCallback, useMemo } from 'react';
import type { CrossExamNode, CrossExamTreeRecord } from '@/types/crossExam';
import { T } from '@/constants/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface WalkerStepEvent {
  node:   CrossExamNode;
  answer: 'YES' | 'NO';
  nextId: string | null;
}

export interface CrossExamWalkerProps {
  tree: CrossExamTreeRecord;
  /** Controlled position — if provided, the walker is fully controlled by the parent. */
  currentNodeId?: string | null;
  /** Initial position when uncontrolled. Defaults to tree.rootNodeId. */
  initialNodeId?: string | null;
  onStep?: (e: WalkerStepEvent) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tap target — large, high-contrast, touch-only (full styling pass is 4H;
// this is a functional baseline sized correctly from the start)
// ─────────────────────────────────────────────────────────────────────────────

function TapTarget({
  label,
  colour,
  onTap,
}: {
  label: string;
  colour: string;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      style={{
        flex:         1,
        minHeight:    72,
        fontSize:     22,
        fontWeight:   700,
        letterSpacing: '.08em',
        color:        '#ffffff',
        background:   colour,
        border:       'none',
        borderRadius: 10,
        cursor:       'pointer',
        fontFamily:   "'Times New Roman', Times, serif",
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamWalker({
  tree,
  currentNodeId,
  initialNodeId,
  onStep,
}: CrossExamWalkerProps) {
  const controlled = currentNodeId !== undefined;

  const [internalNodeId, setInternalNodeId] = useState<string | null>(
    initialNodeId ?? tree.rootNodeId ?? null
  );

  const nodeId = controlled ? currentNodeId : internalNodeId;
  const node: CrossExamNode | null = useMemo(
    () => (nodeId ? tree.nodes[nodeId] ?? null : null),
    [nodeId, tree.nodes]
  );

  const jump = useCallback(
    (answer: 'YES' | 'NO') => {
      if (!node) return;
      const nextId = answer === 'YES' ? node.yesNext : node.noNext;
      onStep?.({ node, answer, nextId });
      if (!controlled) setInternalNodeId(nextId);
    },
    [node, controlled, onStep]
  );

  // ── No tree generated / no position ───────────────────────────────────────
  if (!tree.rootNodeId || Object.keys(tree.nodes).length === 0) {
    return (
      <div style={{ padding: 24, color: T.mute, fontSize: 13, fontStyle: 'italic' }}>
        This topic has not been generated yet.
      </div>
    );
  }

  // ── Topic exhausted / no current node ─────────────────────────────────────
  if (!node) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 600, marginBottom: 6 }}>
          Topic finished
        </div>
        <div style={{ fontSize: 12, color: T.mute }}>
          No further question on this branch.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Question */}
      <div
        style={{
          flex:       1,
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding:    '32px 20px',
          textAlign:  'center',
        }}
      >
        <div>
          <div
            style={{
              fontSize:   24,
              lineHeight: 1.5,
              color:      T.text,
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: node.tier === 'climax' ? 700 : 400,
            }}
          >
            {node.question}
          </div>

          {node.terminal && (
            <div
              style={{
                marginTop: 16,
                fontSize:  13,
                fontWeight: 700,
                color: node.terminalKind === 'admission_reached' ? '#2a6a3a' : T.mute,
              }}
            >
              {node.terminalKind === 'admission_reached'
                ? '⊠ Admission reached — stop here'
                : '⊘ Content exhausted — topic finished'}
            </div>
          )}
        </div>
      </div>

      {/* Tap targets */}
      <div style={{ display: 'flex', gap: 12, padding: '0 16px 24px' }}>
        <TapTarget label="YES" colour="#a02020" onTap={() => jump('YES')} />
        <TapTarget label="NO" colour="#1a6a3a" onTap={() => jump('NO')} />
      </div>
    </div>
  );
}
