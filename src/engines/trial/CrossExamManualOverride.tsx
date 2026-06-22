/**
 * AFS Legal OS — CrossExamManualOverride
 * Phase 4G: In-session manual question insertion
 *
 * OUTPUT PATH:
 *   src/engines/trial/CrossExamManualOverride.tsx
 *
 * ─── BUILD ORDER ─────────────────────────────────────────────────────────────
 *
 *  ① src/types/crossExam.ts                          (Phase 3A — done)
 *     Defines: SessionStep (with isManual flag on CrossExamNode)
 *  ② src/engines/trial/CrossExamSessionManager.tsx   (Phase 4F — done)
 *     Consumes this component; patch described at bottom of this file.
 *  ③ THIS FILE                                        ← Phase 4G
 *
 * ─── PURPOSE ──────────────────────────────────────────────────────────────────
 *
 * Allows counsel to insert a custom question at any point during a live
 * cross-examination session without leaving the walker UI. The question is
 * logged to the session as a manual SessionStep and persisted to Dexie
 * immediately via the same `onManualStep` callback surface used for normal
 * tree steps.
 *
 * A manual step differs from a tree step in two ways:
 *   (a) nodeId is a freshly-generated UUID prefixed "manual::" so
 *       CrossExamSessionLog's resolveNodeMeta() returns null for topicLabel
 *       and tier — the log renders it with "manual override" badge (already
 *       in CrossExamSessionLog from Phase 4C).
 *   (b) The step does NOT advance any topic's currentNodeId. The walker
 *       resumes from wherever it was before the manual question.
 *
 * INTERACTION MODEL:
 *   - A floating "+ Custom Question" button sits in the bottom-left of the
 *     session screen (above the YES/NO tap targets, below the status bar).
 *   - Tapping it opens a modal overlay with a large textarea, YES / NO /
 *     SKIPPED answer selector, and a "Log question" confirm button.
 *   - On confirm the modal closes, the step is logged, and the walker
 *     immediately returns to the current tree node.
 *   - The modal can be dismissed without logging (tap outside or X button).
 *
 * WHAT THIS FILE DOES NOT DO:
 *   - Does NOT write to Dexie directly — calls onManualStep, which is
 *     handled by CrossExamSessionManager (Phase 4F).
 *   - Does NOT alter the tree or advance currentNodeId.
 *   - Does NOT trigger contradiction detection (manual questions are
 *     out-of-tree; contradiction logic only applies to known nodes).
 *
 * ─── PROPS ───────────────────────────────────────────────────────────────────
 *
 *   onManualStep — called with the completed SessionStep when counsel
 *                  confirms. CrossExamSessionManager appends it to the
 *                  active topic's completedSteps and persists.
 *
 * ─── PATCH REQUIRED IN CrossExamSessionManager.tsx ──────────────────────────
 *
 * See the "PATCH NOTES" block at the bottom of this file for the exact
 * lines to add. Summary:
 *   1. Import CrossExamManualOverride.
 *   2. Add handleManualStep callback (appends step, persists, no position change).
 *   3. Render <CrossExamManualOverride onManualStep={handleManualStep} />
 *      inside the main column, between the topic switcher and log toggle.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { SessionStep } from '@/types/crossExam';
import { T, S } from '@/constants/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamManualOverrideProps {
  /**
   * Called when counsel confirms a manual question.
   * CrossExamSessionManager appends the step to the active topic's
   * completedSteps and calls saveSession().
   */
  onManualStep: (step: SessionStep) => void;
}

type AnswerChoice = 'YES' | 'NO' | 'SKIPPED';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ANSWER_OPTIONS: { value: AnswerChoice; label: string; colour: string }[] = [
  { value: 'YES',     label: 'YES',     colour: '#a02020' },
  { value: 'NO',      label: 'NO',      colour: '#1a6a3a' },
  { value: 'SKIPPED', label: 'SKIPPED', colour: '#555555' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Answer selector — matches the YES/NO palette from CrossExamWalker
// ─────────────────────────────────────────────────────────────────────────────

function AnswerSelector({
  value,
  onChange,
}: {
  value:    AnswerChoice;
  onChange: (v: AnswerChoice) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {ANSWER_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex:          1,
            minHeight:     52,
            fontSize:      15,
            fontWeight:    700,
            letterSpacing: '.1em',
            color:         value === opt.value ? '#ffffff' : opt.colour,
            background:    value === opt.value ? opt.colour : 'transparent',
            border:        `2px solid ${opt.colour}`,
            borderRadius:  8,
            cursor:        'pointer',
            fontFamily:    "'Times New Roman', Times, serif",
            transition:    'background .15s, color .15s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal overlay
// ─────────────────────────────────────────────────────────────────────────────

function ManualOverrideModal({
  onConfirm,
  onDismiss,
}: {
  onConfirm: (question: string, answer: AnswerChoice, notes: string) => void;
  onDismiss: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer,   setAnswer]   = useState<AnswerChoice>('YES');
  const [notes,    setNotes]    = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the question textarea when the modal opens.
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, []);

  const canConfirm = question.trim().length > 0;

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(question.trim(), answer, notes.trim());
  }, [canConfirm, question, answer, notes, onConfirm]);

  // Dismiss on backdrop tap (but not on modal content tap).
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onDismiss();
    },
    [onDismiss],
  );

  return (
    /* Backdrop */
    <div
      onClick={handleBackdropClick}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,.55)',
        zIndex:         1000,
        display:        'flex',
        alignItems:     'flex-end',   // sheet slides up from bottom — mobile-native feel
        justifyContent: 'center',
        padding:        '0 0 env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Sheet */}
      <div
        style={{
          width:         '100%',
          maxWidth:      560,
          background:    T.card,
          borderRadius:  '14px 14px 0 0',
          padding:       '20px 20px 28px',
          display:       'flex',
          flexDirection: 'column',
          gap:           16,
          boxShadow:     '0 -4px 24px rgba(0,0,0,.25)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontSize:      13,
              fontWeight:    700,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color:         T.text,
              fontFamily:    "'Times New Roman', Times, serif",
            }}
          >
            Manual Question
          </span>
          <button
            onClick={onDismiss}
            style={{
              background:  'transparent',
              border:      'none',
              cursor:      'pointer',
              fontSize:    22,
              color:       T.mute,
              lineHeight:  1,
              padding:     '4px 8px',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>

        {/* Question textarea */}
        <div>
          <span style={{ ...S.label, marginBottom: 6 }}>Question to put to the witness</span>
          <textarea
            ref={textareaRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Type your question here…"
            rows={4}
            style={{
              ...S.ta,
              fontSize:   17,
              lineHeight: 1.55,
              fontFamily: "'Times New Roman', Times, serif",
              fontStyle:  'italic',
              resize:     'vertical',
              minHeight:  96,
            }}
          />
        </div>

        {/* Answer selector */}
        <div>
          <span style={{ ...S.label, marginBottom: 6 }}>Witness answer received</span>
          <AnswerSelector value={answer} onChange={setAnswer} />
        </div>

        {/* Notes (optional) */}
        <div>
          <span style={{ ...S.label, marginBottom: 6 }}>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add a note for this question…"
            rows={2}
            style={{
              ...S.ta,
              fontSize:   13,
              lineHeight: 1.6,
              resize:     'vertical',
              minHeight:  52,
            }}
          />
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          style={{
            width:         '100%',
            minHeight:     54,
            fontSize:      15,
            fontWeight:    700,
            letterSpacing: '.08em',
            color:         canConfirm ? '#ffffff' : T.mute,
            background:    canConfirm ? '#1a3a6a' : T.bdrL,
            border:        'none',
            borderRadius:  10,
            cursor:        canConfirm ? 'pointer' : 'not-allowed',
            fontFamily:    "'Times New Roman', Times, serif",
            transition:    'background .15s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Log question
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating trigger button
// ─────────────────────────────────────────────────────────────────────────────

function ManualTriggerButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           7,
        padding:       '10px 16px',
        background:    'transparent',
        border:        `1px solid ${T.bdr}`,
        borderLeft:    'none',
        borderRight:   'none',
        width:         '100%',
        cursor:        'pointer',
        fontFamily:    "'Times New Roman', Times, serif",
        fontSize:      12,
        fontWeight:    600,
        color:         T.dim,
        textAlign:     'left',
        flexShrink:    0,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
      <span>Insert custom question</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamManualOverride({
  onManualStep,
}: CrossExamManualOverrideProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleConfirm = useCallback(
    (question: string, answer: AnswerChoice, notes: string) => {
      const step: SessionStep = {
        // Prefix "manual::" so CrossExamSessionLog's resolveNodeMeta()
        // misses every tree lookup and falls through to the "manual override"
        // badge path — no special handling needed there.
        nodeId:             `manual::${uuidv4()}`,
        questionSnapshot:   question,
        answer,
        contradictionFired: false,
        notes,
        loggedAt:           new Date().toISOString(),
      };
      onManualStep(step);
      setModalOpen(false);
    },
    [onManualStep],
  );

  return (
    <>
      <ManualTriggerButton onOpen={() => setModalOpen(true)} />
      {modalOpen && (
        <ManualOverrideModal
          onConfirm={handleConfirm}
          onDismiss={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH NOTES — CrossExamSessionManager.tsx (Phase 4F)
// ─────────────────────────────────────────────────────────────────────────────
//
// THREE changes required. All are additive — nothing is removed.
//
// ① ADD IMPORT (after the CrossExamSessionLog import line):
//
//   import { CrossExamManualOverride } from '@/engines/trial/CrossExamManualOverride';
//
//
// ② ADD handleManualStep CALLBACK (after handleFallbackJump, before handleEndSession):
//
//   /**
//    * onManualStep — fired by CrossExamManualOverride when counsel confirms.
//    * Appends the manual step to the ACTIVE topic's completedSteps.
//    * Does NOT advance currentNodeId — the walker resumes from its current node.
//    */
//   const handleManualStep = useCallback(
//     (step: SessionStep) => {
//       const prev = sessionRef.current;
//       if (!prev || !prev.activeTopicId) return;
//
//       const topicId = prev.activeTopicId;
//       const tree    = trees.find(t => t.topicId === topicId);
//       const existingState = prev.topicStates[topicId]
//         ?? makeEmptyTopicState(topicId, tree?.rootNodeId ?? '');
//
//       const updatedState: TopicWalkState = {
//         ...existingState,
//         // currentNodeId intentionally unchanged — walker resumes at same node.
//         completedSteps: [...existingState.completedSteps, step],
//       };
//
//       const updated: CrossExamSessionRecord = {
//         ...prev,
//         topicStates: { ...prev.topicStates, [topicId]: updatedState },
//       };
//
//       setSession(updated);
//       persist(updated);
//     },
//     [trees, persist],
//   );
//
//
// ③ RENDER (inside the main column <div>, between the topic-switcher div
//    and the <LogToggleButton>):
//
//   <CrossExamManualOverride onManualStep={handleManualStep} />
//
// ─────────────────────────────────────────────────────────────────────────────
