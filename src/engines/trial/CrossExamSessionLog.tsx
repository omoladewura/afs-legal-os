/**
 * AFS Legal OS — CrossExamSessionLog
 * Phase 4C: Session log
 *
 * BUILD ORDER — must respect this sequence exactly:
 *   1. src/types/crossExam.ts                          (Phase 3A — done)
 *      Defines: SessionStep, TopicWalkState, CrossExamSessionRecord,
 *               CrossExamTreeRecord, CrossExamNode
 *   2. src/storage/db.ts                                (Phase 3A — done)
 *      Declares: cross_exam_sessions table
 *   3. src/storage/crossExamHelpers.ts                  (Phase 3B — done)
 *      Provides: saveSession, createSession, loadOpenSession
 *   4. src/engines/trial/CrossExamWalker.tsx            (Phase 4A — done)
 *      Defines: WalkerStepEvent, CrossExamWalkerProps
 *   5. src/engines/trial/CrossExamTopicSwitcher.tsx     (Phase 4B — done)
 *      Defines: TopicStepEvent, TopicPositionMap
 *   6. THIS FILE                                        ← Phase 4C
 *      No further files depend on this yet; Phases 4D/4F will consume
 *      the exported types below without modifying this file.
 *
 * PURPOSE:
 *   Displays the full path counsel has walked so far in the current
 *   session — every question asked, every YES/NO recorded, plus a
 *   freehand notes field attached to each step.
 *
 *   Two distinct responsibilities:
 *     (a) READ — render the session log as a scrollable list, most-recent
 *         step first. Each row shows question text, answer badge, tier,
 *         topic label, and the notes textarea.
 *     (b) WRITE — counsel can type notes against any step at any time,
 *         including steps from earlier in the session. Changes call
 *         onNotesChange so Phase 4F (autosave) persists them to Dexie
 *         without this component touching IndexedDB directly.
 *
 * WHAT THIS FILE DOES NOT DO:
 *   - Does not write to Dexie (that is Phase 4F).
 *   - Does not handle contradiction detour triggering (that is Phase 4D).
 *   - Does not manage session state (stepss are pushed in by the parent).
 *   - Does not autosave (Phase 4F wraps the parent and handles persistence).
 *
 * PROPS:
 *   steps        — the flat ordered list of SessionStep recorded so far.
 *                  Provided by the parent (Phase 4F session manager).
 *   trees        — all CrossExamTreeRecord for this witness, used to look
 *                  up question text and topic labels without re-reading Dexie.
 *   onNotesChange — called when counsel edits a note; parent writes to Dexie.
 *   emptyMessage  — optional override for the "no steps yet" placeholder.
 *
 * LOG ENTRY SHAPE (from src/types/crossExam.ts — shown here for reference):
 *   interface SessionStep {
 *     nodeId:             string;
 *     questionSnapshot:   string;
 *     answer:             'YES' | 'NO' | 'SKIPPED';
 *     contradictionFired: boolean;
 *     notes:              string;
 *     loggedAt:           string;
 *   }
 *
 * CONSUMED BY:
 *   - Phase 4 Courtroom Walker screen (side-panel or modal log drawer)
 *   - Phase 4F Auto-save (wraps onNotesChange to persist notes to Dexie)
 *   - Phase 5B Printable paper backup (reads completedSteps from all topics)
 */

import { useCallback } from 'react';
import type { SessionStep, CrossExamTreeRecord, CrossExamTier } from '@/types/crossExam';
import { T, S } from '@/constants/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamSessionLogProps {
  /**
   * Flat ordered list of all steps recorded so far in this session,
   * across all topics. Order matches the real walk order (oldest first).
   * The component renders reversed (most-recent first) for courtroom use.
   */
  steps: SessionStep[];

  /**
   * All topic-trees for this witness.
   * Used to resolve topicLabel and tier for display without a Dexie call.
   */
  trees: CrossExamTreeRecord[];

  /**
   * Called when counsel edits the notes field on a step.
   * Receives the step's nodeId and the new notes string.
   * Phase 4F handles the Dexie write; this component stays stateless.
   */
  onNotesChange: (nodeId: string, notes: string) => void;

  /**
   * Optional text to show when no steps have been logged yet.
   * Defaults to a courtroom-appropriate prompt.
   */
  emptyMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Human-readable tier labels for the log. */
const TIER_LABEL: Record<CrossExamTier, string> = {
  opener:        'Opener',
  escalation:    'Escalation',
  climax:        'Climax',
  recovery:      'Recovery',
  contradiction: 'Contradiction detour',
};

/** Answer badge colours. */
const ANSWER_COLOUR: Record<SessionStep['answer'], string> = {
  YES:     '#a02020',  // red — matches TapTarget YES
  NO:      '#1a6a3a',  // green — matches TapTarget NO
  SKIPPED: '#555555',
};

/**
 * Format an ISO loggedAt timestamp into a short, courtroom-legible string.
 * e.g. "14:33:07"
 */
function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toTimeString().slice(0, 8);
  } catch {
    return '—';
  }
}

/**
 * Look up the topic label and tier for a node across the loaded trees.
 * Returns nulls when the node cannot be found (e.g. manual node added
 * on the fly — Phase 4G — which is not in any tree).
 */
function resolveNodeMeta(
  nodeId: string,
  trees: CrossExamTreeRecord[],
): { topicLabel: string | null; tier: CrossExamTier | null } {
  for (const tree of trees) {
    const node = tree.nodes[nodeId];
    if (node) return { topicLabel: tree.topicLabel, tier: node.tier };
  }
  return { topicLabel: null, tier: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Log row
// ─────────────────────────────────────────────────────────────────────────────

interface LogRowProps {
  step:      SessionStep;
  index:     number;   // display index (1-based, based on reversed order)
  total:     number;
  topicLabel: string | null;
  tier:      CrossExamTier | null;
  onNotesChange: (nodeId: string, notes: string) => void;
}

function LogRow({ step, index, total, topicLabel, tier, onNotesChange }: LogRowProps) {
  const handleNotes = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onNotesChange(step.nodeId, e.target.value);
    },
    [step.nodeId, onNotesChange],
  );

  return (
    <div
      style={{
        borderBottom:  `1px solid ${T.bdrL}`,
        padding:       '16px 0',
        display:       'flex',
        flexDirection: 'column',
        gap:           10,
      }}
    >
      {/* Row header — step number, time, topic, tier */}
      <div
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        8,
          flexWrap:   'wrap',
        }}
      >
        {/* Step counter — shows most-recent first (index 1 = last step) */}
        <span
          style={{
            fontSize:    10,
            fontWeight:  700,
            color:       T.mute,
            fontFamily:  "'Times New Roman', Times, serif",
            letterSpacing: '.08em',
            minWidth:    28,
          }}
        >
          #{total - index + 1}
        </span>

        {/* Time */}
        <span
          style={{
            fontSize:   11,
            color:      T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtTime(step.loggedAt)}
        </span>

        {/* Topic label */}
        {topicLabel && (
          <span
            style={{
              fontSize:     10,
              fontWeight:   700,
              color:        T.info ?? '#1a3a6a',
              fontFamily:   "'Times New Roman', Times, serif",
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              background:   '#eef1f8',
              borderRadius: 3,
              padding:      '2px 6px',
            }}
          >
            {topicLabel}
          </span>
        )}

        {/* Tier */}
        {tier && (
          <span
            style={{
              fontSize:     10,
              color:        T.dim,
              fontFamily:   "'Times New Roman', Times, serif",
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}
          >
            {TIER_LABEL[tier]}
          </span>
        )}

        {/* Manual flag (Phase 4G nodes) */}
        {!topicLabel && (
          <span
            style={{
              fontSize:     10,
              color:        T.warn,
              fontFamily:   "'Times New Roman', Times, serif",
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}
          >
            manual override
          </span>
        )}

        {/* Contradiction badge */}
        {step.contradictionFired && (
          <span
            style={{
              fontSize:     10,
              fontWeight:   700,
              color:        '#8a1a1a',
              fontFamily:   "'Times New Roman', Times, serif",
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              background:   '#faeaea',
              borderRadius: 3,
              padding:      '2px 6px',
            }}
          >
            ⚑ contradiction
          </span>
        )}

        {/* Answer badge — right-aligned */}
        <span style={{ marginLeft: 'auto' }}>
          <span
            style={{
              display:      'inline-block',
              minWidth:     48,
              textAlign:    'center',
              fontFamily:   "'Times New Roman', Times, serif",
              fontSize:     13,
              fontWeight:   700,
              letterSpacing: '.1em',
              color:        '#ffffff',
              background:   ANSWER_COLOUR[step.answer],
              borderRadius: 4,
              padding:      '3px 10px',
            }}
          >
            {step.answer}
          </span>
        </span>
      </div>

      {/* Question text — snapshot taken at walk time */}
      <div
        style={{
          fontSize:   16,
          lineHeight: 1.5,
          color:      T.text,
          fontFamily: "'Times New Roman', Times, serif",
          fontStyle:  'italic',
        }}
      >
        {step.questionSnapshot}
      </div>

      {/* Notes textarea — counsel can annotate any step at any time */}
      <div>
        <span style={{ ...S.label, marginBottom: 4 }}>Notes</span>
        <textarea
          value={step.notes}
          onChange={handleNotes}
          placeholder="Add note for this question…"
          rows={2}
          style={{
            ...S.ta,
            minHeight:   56,
            fontSize:    13,
            lineHeight:  1.6,
            resize:      'vertical',
            // Touch-friendly minimum
            padding:     '10px 12px',
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamSessionLog({
  steps,
  trees,
  onNotesChange,
  emptyMessage = 'No questions logged yet — start walking the tree.',
}: CrossExamSessionLogProps) {
  // Render most-recent step first so counsel sees the current position at the top.
  const reversed = [...steps].reverse();

  if (steps.length === 0) {
    return (
      <div
        style={{
          padding:   32,
          textAlign: 'center',
          color:     T.mute,
          fontSize:  13,
          fontStyle: 'italic',
          fontFamily: "'Times New Roman', Times, serif",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
      }}
    >
      {/* Header bar — step count */}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'space-between',
          padding:       '10px 16px',
          borderBottom:  `1px solid ${T.bdr}`,
          flexShrink:    0,
          background:    T.card,
        }}
      >
        <span
          style={{
            ...S.label,
            marginBottom: 0,
            fontSize:     11,
          }}
        >
          Session log
        </span>
        <span
          style={{
            fontSize:   12,
            color:      T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {steps.length} question{steps.length !== 1 ? 's' : ''} recorded
        </span>
      </div>

      {/* Scrollable log list */}
      <div
        style={{
          flex:       1,
          overflowY:  'auto',
          padding:    '0 16px',
          // Momentum scrolling on iOS
          WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        }}
      >
        {reversed.map((step, idx) => {
          const { topicLabel, tier } = resolveNodeMeta(step.nodeId, trees);
          return (
            <LogRow
              key={`${step.nodeId}-${step.loggedAt}`}
              step={step}
              index={idx + 1}
              total={steps.length}
              topicLabel={topicLabel}
              tier={tier}
              onNotesChange={onNotesChange}
            />
          );
        })}

        {/* Bottom spacer — prevents last row from sitting against the keyboard on mobile */}
        <div style={{ height: 32 }} />
      </div>
    </div>
  );
}
