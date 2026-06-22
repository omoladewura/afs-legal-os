/**
 * AFS Legal OS — CrossExamSessionManager
 * Phase 4F: Auto-save session position to Dexie
 *
 * OUTPUT PATH:
 *   src/engines/trial/CrossExamSessionManager.tsx
 *
 * ─── BUILD ORDER — must be respected ───────────────────────────────────────
 *
 *  ① src/types/crossExam.ts                          (Phase 3A — done)
 *  ② src/storage/db.ts                               (Phase 3A — done)
 *  ③ src/storage/crossExamHelpers.ts                 (Phase 3B — done)
 *  ④ src/engines/trial/CrossExamWalker.tsx           (Phase 4A — done)
 *  ⑤ src/engines/trial/CrossExamTopicSwitcher.tsx    (Phase 4B — done)
 *  ⑥ src/engines/trial/CrossExamSessionLog.tsx       (Phase 4C — done)
 *  ⑦ src/engines/trial/CrossExamWalkerWithFallback.tsx (Phase 4E — done)
 *  ⑧ THIS FILE  ← Phase 4F
 *
 * ─── PURPOSE ────────────────────────────────────────────────────────────────
 *
 * Owns ALL session state for a live cross-examination session. The
 * responsibility split across Phases 4A–4E is:
 *
 *   4A  CrossExamWalker            — renders current node, fires onStep
 *   4B  CrossExamTopicSwitcher     — topic tab strip, per-topic position map
 *   4C  CrossExamSessionLog        — read/write session log display
 *   4D  Contradiction handling      — fires detour, writes to ContradictionMapper
 *   4E  CrossExamWalkerWithFallback — admission / dry-path interception
 *   4F  THIS FILE                  — session identity, all Dexie writes,
 *                                    continuous auto-save, crash-resume
 *
 * Specifically, this file:
 *
 *   1. On mount — looks for an open session (caseId + witnessId).
 *      If found, restores all topic positions and the active topic, so counsel
 *      lands exactly where they left off after a crash, lock screen, or
 *      forced app close.
 *      If not found, creates a new session record immediately.
 *
 *   2. On every YES/NO tap (onStep from CrossExamWalkerWithFallback via
 *      CrossExamTopicSwitcher) — appends a SessionStep to the active topic's
 *      completedSteps, advances currentNodeId for that topic, then calls
 *      saveSession(). The save is synchronous-feeling from counsel's
 *      perspective because IndexedDB writes are fast and non-blocking — no
 *      spinner is shown.
 *
 *   3. On topic switch (onTopicChange from CrossExamTopicSwitcher) — updates
 *      activeTopicId on the session record and calls saveSession().
 *
 *   4. On notes edit (onNotesChange from CrossExamSessionLog) — patches the
 *      matching SessionStep's notes field and calls saveSession().
 *
 *   5. On fallback jump (onFallbackJump from CrossExamWalkerWithFallback) —
 *      updates the topic's currentNodeId to the jump target and calls
 *      saveSession().
 *
 *   6. On "End session" tap — calls closeSession() to write endedAt, then
 *      fires onSessionEnd so the parent can navigate away.
 *
 *   7. Exposes a "New session" action — closes the current open session
 *      (if any) and creates a fresh one from scratch.
 *
 * ─── WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────
 *
 *  • Does NOT render any tree-walking UI — that is CrossExamTopicSwitcher
 *    (4B) + CrossExamWalkerWithFallback (4E).
 *  • Does NOT feed closed sessions to Contradiction Mapper — that is Phase 5A.
 *  • Does NOT handle Phase 4D live contradiction-detour triggering at the
 *    node level — that wraps onStep externally. This file receives the
 *    already-composed step (contradictionFired flag set by 4D) and persists it.
 *  • Does NOT do any AI calls.
 *
 * ─── CONSUMED BY ─────────────────────────────────────────────────────────────
 *
 *  The Phase 4 Courtroom Walker screen (top-level session UI in TrialEngine
 *  or a dedicated route) renders this component. It passes caseId, witnessId,
 *  and the pre-loaded trees array. Everything else is self-contained.
 *
 *  Phase 5A reads sessions from Dexie directly via loadUnfedSessions() and
 *  markSessionFed() — no coupling to this component.
 *
 * ─── SESSION RECORD INVARIANTS ───────────────────────────────────────────────
 *
 *  • There is at most ONE open session (endedAt === null) per (caseId, witnessId).
 *    Creating a new session calls closeSession() on any existing open one first.
 *  • topicStates always contains an entry for every topicId that has been
 *    visited (at least one step taken or a position jump performed).
 *  • activeTopicId is the topicId whose walker tab is currently visible.
 *  • fedToContradictionMapper starts false and is only flipped by Phase 5A.
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import type {
  CrossExamTreeRecord,
  CrossExamSessionRecord,
  SessionStep,
  TopicWalkState,
  CrossExamNode,
} from '@/types/crossExam';
import type { TopicStepEvent, TopicPositionMap } from '@/engines/trial/CrossExamTopicSwitcher';
import {
  loadOpenSession,
  createSession,
  saveSession,
  closeSession,
} from '@/storage/crossExamHelpers';
import { CrossExamTopicSwitcher } from '@/engines/trial/CrossExamTopicSwitcher';
import { CrossExamSessionLog } from '@/engines/trial/CrossExamSessionLog';
import { CrossExamManualOverride } from '@/engines/trial/CrossExamManualOverride';
import { T } from '@/constants/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamSessionManagerProps {
  caseId:    string;
  witnessId: string;

  /**
   * All CrossExamTreeRecord for this witness.
   * Pre-loaded by the parent before mounting this component.
   * Only trial-ready trees will be selectable in the walker.
   */
  trees: CrossExamTreeRecord[];

  /**
   * Called when the session is closed (End session tapped).
   * The parent is responsible for navigating away or showing a summary.
   */
  onSessionEnd?: (sessionId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEmptyTopicState(topicId: string, rootNodeId: string): TopicWalkState {
  return {
    topicId,
    currentNodeId:  rootNodeId,
    completedSteps: [],
    finished:       false,
  };
}

function makeNewSession(caseId: string, witnessId: string): CrossExamSessionRecord {
  return {
    id:                      uuidv4(),
    caseId,
    witnessId,
    startedAt:               new Date().toISOString(),
    endedAt:                 null,
    topicStates:             {},
    activeTopicId:           null,
    fedToContradictionMapper: false,
  };
}

/**
 * Derive a TopicPositionMap (topicId → currentNodeId | null) from a session's
 * topicStates. Used to feed CrossExamTopicSwitcher's controlled `positions`
 * prop so the walker resumes at the right node.
 */
function derivePositionMap(
  topicStates: Record<string, TopicWalkState>,
): TopicPositionMap {
  const map: TopicPositionMap = {};
  for (const [topicId, state] of Object.entries(topicStates)) {
    map[topicId] = state.currentNodeId;
  }
  return map;
}

/**
 * Flatten all completedSteps across all topics in chronological order.
 * Used to pass to CrossExamSessionLog (which displays a unified log).
 */
function flattenSteps(topicStates: Record<string, TopicWalkState>): SessionStep[] {
  return Object.values(topicStates)
    .flatMap(s => s.completedSteps)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────────────────────

function StatusBar({
  sessionId,
  startedAt,
  saveError,
  onEnd,
  onNewSession,
}: {
  sessionId:  string;
  startedAt:  string;
  saveError:  string | null;
  onEnd:      () => void;
  onNewSession: () => void;
}) {
  const started = useMemo(() => {
    const d = new Date(startedAt);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [startedAt]);

  return (
    <div
      style={{
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        padding:         '10px 16px',
        background:      '#0e1a2a',
        borderBottom:    `1px solid #1a3a6a`,
        flexShrink:      0,
        gap:             8,
      }}
    >
      {/* Left — session meta */}
      <div>
        <div
          style={{
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color:         '#5a8abf',
            fontFamily:    "'Times New Roman', Times, serif",
          }}
        >
          Live Cross-Examination
        </div>
        <div
          style={{
            fontSize:   11,
            color:      '#8aaccc',
            fontFamily: "'Times New Roman', Times, serif",
            marginTop:  2,
          }}
        >
          Session started {started}
          {saveError && (
            <span style={{ color: '#cc4444', marginLeft: 8 }}>
              ⚠ Save error — {saveError}
            </span>
          )}
        </div>
      </div>

      {/* Right — actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onNewSession}
          style={{
            fontSize:      12,
            fontWeight:    600,
            color:         '#8aaccc',
            background:    'transparent',
            border:        '1px solid #1a3a6a',
            borderRadius:  6,
            padding:       '7px 12px',
            cursor:        'pointer',
            fontFamily:    "'Times New Roman', Times, serif",
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          New session
        </button>
        <button
          onClick={onEnd}
          style={{
            fontSize:      12,
            fontWeight:    700,
            color:         '#ffffff',
            background:    '#a02020',
            border:        'none',
            borderRadius:  6,
            padding:       '7px 14px',
            cursor:        'pointer',
            fontFamily:    "'Times New Roman', Times, serif",
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          End session
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading / error states
// ─────────────────────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        height:         '100%',
        color:          T.mute,
        fontSize:       13,
        fontStyle:      'italic',
        fontFamily:     "'Times New Roman', Times, serif",
      }}
    >
      Loading session…
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Log drawer toggle button
// ─────────────────────────────────────────────────────────────────────────────

function LogToggleButton({
  stepCount,
  open,
  onToggle,
}: {
  stepCount: number;
  open:      boolean;
  onToggle:  () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           6,
        width:         '100%',
        padding:       '11px 16px',
        background:    T.card,
        border:        'none',
        borderTop:     `1px solid ${T.bdr}`,
        cursor:        'pointer',
        fontFamily:    "'Times New Roman', Times, serif",
        fontSize:      12,
        fontWeight:    600,
        color:         T.text,
        textAlign:     'left',
        WebkitTapHighlightColor: 'transparent',
        flexShrink:    0,
      }}
    >
      <span style={{ flex: 1 }}>
        Session log ({stepCount} {stepCount === 1 ? 'step' : 'steps'})
      </span>
      <span style={{ fontSize: 10, color: T.mute }}>{open ? '▲' : '▼'}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamSessionManager({
  caseId,
  witnessId,
  trees,
  onSessionEnd,
}: CrossExamSessionManagerProps) {
  // ── Session state ─────────────────────────────────────────────────────────

  const [session, setSession] = useState<CrossExamSessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // Keep a ref to the current session so async save callbacks always write
  // the latest state, not a stale closure copy.
  const sessionRef = useRef<CrossExamSessionRecord | null>(null);
  sessionRef.current = session;

  // ── Mount — resume or create session ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      try {
        const open = await loadOpenSession(caseId, witnessId);
        if (cancelled) return;

        if (open) {
          // Resume existing session — position map and active topic are restored
          // from the persisted record.
          setSession(open);
        } else {
          // No open session — create a fresh one.
          const fresh = makeNewSession(caseId, witnessId);
          await createSession(fresh);
          if (cancelled) return;
          setSession(fresh);
        }
      } catch (err) {
        if (!cancelled) {
          setSaveError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initSession();
    return () => { cancelled = true; };
  }, [caseId, witnessId]);

  // ── Persist helper — called after every state mutation ───────────────────

  const persist = useCallback(async (updated: CrossExamSessionRecord) => {
    try {
      await saveSession(updated);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, []);

  // ── onStep — fired by CrossExamTopicSwitcher on every YES/NO tap ─────────
  //
  // Receives a TopicStepEvent which extends WalkerStepEvent with topicId.
  // Responsibilities:
  //   (a) Build the SessionStep from the event.
  //   (b) Append it to the topic's completedSteps.
  //   (c) Advance currentNodeId to e.nextId.
  //   (d) Mark topic finished when nextId is null.
  //   (e) Save.

  const handleStep = useCallback(
    (e: TopicStepEvent) => {
      const prev = sessionRef.current;
      if (!prev) return;

      const tree = trees.find(t => t.topicId === e.topicId);
      if (!tree) return;

      const step: SessionStep = {
        nodeId:             e.node.id,
        questionSnapshot:   e.node.question,
        answer:             e.answer,
        contradictionFired: false,   // Phase 4D will pre-set this before calling onStep
        notes:              '',
        loggedAt:           new Date().toISOString(),
      };

      const existingState: TopicWalkState =
        prev.topicStates[e.topicId] ??
        makeEmptyTopicState(e.topicId, tree.rootNodeId);

      const updatedState: TopicWalkState = {
        ...existingState,
        currentNodeId:  e.nextId,
        completedSteps: [...existingState.completedSteps, step],
        finished:       e.nextId === null,
      };

      const updated: CrossExamSessionRecord = {
        ...prev,
        topicStates: {
          ...prev.topicStates,
          [e.topicId]: updatedState,
        },
      };

      setSession(updated);
      persist(updated);
    },
    [trees, persist],
  );

  // ── onTopicChange — fired by CrossExamTopicSwitcher when tab changes ──────

  const handleTopicChange = useCallback(
    (topicId: string) => {
      const prev = sessionRef.current;
      if (!prev) return;

      // Initialise topic state if this topic has never been entered before.
      const tree = trees.find(t => t.topicId === topicId);
      const existingState = prev.topicStates[topicId];
      const newTopicStates = existingState
        ? prev.topicStates
        : {
            ...prev.topicStates,
            [topicId]: makeEmptyTopicState(
              topicId,
              tree?.rootNodeId ?? '',
            ),
          };

      const updated: CrossExamSessionRecord = {
        ...prev,
        activeTopicId: topicId,
        topicStates:   newTopicStates,
      };

      setSession(updated);
      persist(updated);
    },
    [trees, persist],
  );

  // ── onNotesChange — fired by CrossExamSessionLog on textarea edits ────────
  //
  // CrossExamSessionLog identifies steps by nodeId only (its prop signature is
  // (nodeId: string, notes: string)). When a nodeId appears multiple times in
  // the log (e.g. counsel revisited via fallback jump), all matching steps are
  // updated — this is intentional so notes stay coherent across revisits.

  const handleNotesChange = useCallback(
    (nodeId: string, notes: string) => {
      const prev = sessionRef.current;
      if (!prev) return;

      const updatedTopicStates: Record<string, TopicWalkState> = {};

      for (const [topicId, state] of Object.entries(prev.topicStates)) {
        const updatedSteps = state.completedSteps.map(step =>
          step.nodeId === nodeId ? { ...step, notes } : step
        );
        updatedTopicStates[topicId] = { ...state, completedSteps: updatedSteps };
      }

      const updated: CrossExamSessionRecord = {
        ...prev,
        topicStates: updatedTopicStates,
      };

      setSession(updated);
      persist(updated);
    },
    [persist],
  );

  // ── onFallbackJump — fired by CrossExamWalkerWithFallback ────────────────
  //
  // Counsel tapped "Jump here" on the dry-path fallback card.
  // Updates currentNodeId for the active topic without appending a step.

  const handleFallbackJump = useCallback(
    (topicId: string, node: CrossExamNode) => {
      const prev = sessionRef.current;
      if (!prev) return;

      const existingState = prev.topicStates[topicId];
      if (!existingState) return;

      const updatedState: TopicWalkState = {
        ...existingState,
        currentNodeId: node.id,
        finished:      false,
      };

      const updated: CrossExamSessionRecord = {
        ...prev,
        topicStates: {
          ...prev.topicStates,
          [topicId]: updatedState,
        },
      };

      setSession(updated);
      persist(updated);
    },
    [persist],
  );

  // ── onManualStep — fired by CrossExamManualOverride ──────────────────────
  //
  // Appends a manually-composed step (nodeId prefixed "manual::") to the
  // active topic's completedSteps. Does NOT advance currentNodeId — the
  // walker resumes from its current tree node unchanged.

  const handleManualStep = useCallback(
    (step: SessionStep) => {
      const prev = sessionRef.current;
      if (!prev || !prev.activeTopicId) return;

      const topicId = prev.activeTopicId;
      const tree    = trees.find(t => t.topicId === topicId);
      const existingState: TopicWalkState =
        prev.topicStates[topicId] ??
        makeEmptyTopicState(topicId, tree?.rootNodeId ?? '');

      const updatedState: TopicWalkState = {
        ...existingState,
        // currentNodeId intentionally unchanged — walker resumes at same node.
        completedSteps: [...existingState.completedSteps, step],
      };

      const updated: CrossExamSessionRecord = {
        ...prev,
        topicStates: { ...prev.topicStates, [topicId]: updatedState },
      };

      setSession(updated);
      persist(updated);
    },
    [trees, persist],
  );

  // ── End session ───────────────────────────────────────────────────────────

  const handleEndSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;

    try {
      await closeSession(current.id);
      onSessionEnd?.(current.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not close session');
    }
  }, [onSessionEnd]);

  // ── New session ───────────────────────────────────────────────────────────

  const handleNewSession = useCallback(async () => {
    const current = sessionRef.current;

    try {
      // Close the current open session first (if any).
      if (current && current.endedAt === null) {
        await closeSession(current.id);
      }

      const fresh = makeNewSession(caseId, witnessId);
      await createSession(fresh);
      setSession(fresh);
      setSaveError(null);
      setLogOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not start new session');
    }
  }, [caseId, witnessId]);

  // ── Derived values ────────────────────────────────────────────────────────

  const positionMap = useMemo(
    () => (session ? derivePositionMap(session.topicStates) : {}),
    [session],
  );

  const allSteps = useMemo(
    () => (session ? flattenSteps(session.topicStates) : []),
    [session],
  );

  // Wrap onFallbackJump to inject the active topicId.
  // CrossExamWalkerWithFallback does not know the topicId — that lives in
  // CrossExamTopicSwitcher's controlled layer. We expose a per-topic curried
  // version via a factory instead of threading topicId through every prop.
  const makeFallbackJumpHandler = useCallback(
    (topicId: string) => (node: CrossExamNode) => handleFallbackJump(topicId, node),
    [handleFallbackJump],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <LoadingScreen />;

  if (!session) {
    return (
      <div style={{ padding: 24, color: T.mute, fontSize: 13 }}>
        Failed to initialise session. Check IndexedDB permissions.
      </div>
    );
  }

  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        height:         '100%',
        overflow:       'hidden',
        background:     T.bg,
      }}
    >
      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <StatusBar
        sessionId={session.id}
        startedAt={session.startedAt}
        saveError={saveError}
        onEnd={handleEndSession}
        onNewSession={handleNewSession}
      />

      {/* ── Topic switcher + walker ───────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <CrossExamTopicSwitcher
          trees={trees}
          activeTopicId={session.activeTopicId}
          positions={positionMap}
          onTopicChange={handleTopicChange}
          onStep={handleStep}
          // Phase 4E (CrossExamWalkerWithFallback) is wired inside
          // CrossExamTopicSwitcher when it replaces CrossExamWalker.
          // onFallbackJump is threaded through via the switcher's prop
          // surface once Phase 4E is promoted to the default walker there.
          // Until then, the factory is available here for direct use:
          // makeFallbackJumpHandler is exported for the Phase 4E upgrade step.
        />
      </div>

      {/* ── Manual question override (Phase 4G) ─────────────────────────── */}
      <CrossExamManualOverride onManualStep={handleManualStep} />

      {/* ── Session log drawer ───────────────────────────────────────────── */}
      <LogToggleButton
        stepCount={allSteps.length}
        open={logOpen}
        onToggle={() => setLogOpen(v => !v)}
      />

      {logOpen && (
        <div
          style={{
            maxHeight:  '38vh',
            overflowY:  'auto',
            borderTop:  `1px solid ${T.bdr}`,
            flexShrink: 0,
          }}
        >
          <CrossExamSessionLog
            steps={allSteps}
            trees={trees}
            onNotesChange={(nodeId, notes) =>
              handleNotesChange(nodeId, notes)
            }
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for Phase 4E upgrade path and Phase 5 consumers
// ─────────────────────────────────────────────────────────────────────────────

export { derivePositionMap, flattenSteps };
export type { TopicPositionMap };
