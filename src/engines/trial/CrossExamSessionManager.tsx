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
 * Owns ALL session state for a live cross-examination session.
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
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
import { CrossExamPostSession, CrossExamPrintPanel } from '@/engines/trial/CrossExamPostSession';
import { T } from '@/constants/tokens';

export interface CrossExamSessionManagerProps {
  caseId:    string;
  witnessId: string;
  trees: CrossExamTreeRecord[];
  onSessionEnd?: (sessionId: string) => void;
  witnessLabels?: Map<string, string>;
  caseName?: string;
  witnessName?: string;
}

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
    id:                      crypto.randomUUID(),
    caseId,
    witnessId,
    startedAt:               new Date().toISOString(),
    endedAt:                 null,
    topicStates:             {},
    activeTopicId:           null,
    fedToContradictionMapper: false,
  };
}

function derivePositionMap(topicStates: Record<string, TopicWalkState>): TopicPositionMap {
  const map: TopicPositionMap = {};
  for (const [topicId, state] of Object.entries(topicStates)) {
    map[topicId] = state.currentNodeId;
  }
  return map;
}

function flattenSteps(topicStates: Record<string, TopicWalkState>): SessionStep[] {
  return Object.values(topicStates)
    .flatMap(s => s.completedSteps)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}

function StatusBar({ sessionId, startedAt, saveError, onEnd, onNewSession }: {
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#0e1a2a', borderBottom: `1px solid #1a3a6a`, flexShrink: 0, gap: 8 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#5a8abf', fontFamily: "'Times New Roman', Times, serif" }}>
          Live Cross-Examination
        </div>
        <div style={{ fontSize: 11, color: '#8aaccc', fontFamily: "'Times New Roman', Times, serif", marginTop: 2 }}>
          Session started {started}
          {saveError && <span style={{ color: '#cc4444', marginLeft: 8 }}>⚠ Save error — {saveError}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onNewSession} style={{ minHeight: 48, fontSize: 13, fontWeight: 600, color: '#8aaccc', background: 'transparent', border: '1px solid #1a3a6a', borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
          New session
        </button>
        <button onClick={onEnd} style={{ minHeight: 48, fontSize: 14, fontWeight: 700, color: '#ffffff', background: '#a02020', border: 'none', borderRadius: 6, padding: '0 18px', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
          End session
        </button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.mute, fontSize: 13, fontStyle: 'italic', fontFamily: "'Times New Roman', Times, serif" }}>
      Loading session…
    </div>
  );
}

function LogToggleButton({ stepCount, open, onToggle }: {
  stepCount: number;
  open:      boolean;
  onToggle:  () => void;
}) {
  return (
    <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 48, width: '100%', padding: '0 16px', background: T.card, border: 'none', borderTop: `1px solid ${T.bdr}`, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", fontSize: 13, fontWeight: 600, color: T.text, textAlign: 'left', touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent', flexShrink: 0 }}>
      <span style={{ flex: 1 }}>Session log ({stepCount} {stepCount === 1 ? 'step' : 'steps'})</span>
      <span style={{ fontSize: 10, color: T.mute }}>{open ? '▲' : '▼'}</span>
    </button>
  );
}

export function CrossExamSessionManager({
  caseId, witnessId, trees, onSessionEnd, witnessLabels, caseName = '', witnessName = '',
}: CrossExamSessionManagerProps) {
  const [session, setSession] = useState<CrossExamSessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [lastEndedSessionId, setLastEndedSessionId] = useState<string | null>(null);
  const sessionRef = useRef<CrossExamSessionRecord | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    let cancelled = false;
    async function initSession() {
      try {
        const open = await loadOpenSession(caseId, witnessId);
        if (cancelled) return;
        if (open) {
          setSession(open);
        } else {
          const fresh = makeNewSession(caseId, witnessId);
          await createSession(fresh);
          if (cancelled) return;
          setSession(fresh);
        }
      } catch (err) {
        if (!cancelled) setSaveError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    initSession();
    return () => { cancelled = true; };
  }, [caseId, witnessId]);

  const persist = useCallback(async (updated: CrossExamSessionRecord) => {
    try {
      await saveSession(updated);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, []);

  const handleStep = useCallback((e: TopicStepEvent) => {
    const prev = sessionRef.current;
    if (!prev) return;
    const tree = trees.find(t => t.topicId === e.topicId);
    if (!tree) return;
    const step: SessionStep = {
      nodeId: e.node.id, questionSnapshot: e.node.question, answer: e.answer,
      contradictionFired: false, notes: '', loggedAt: new Date().toISOString(),
    };
    const existingState: TopicWalkState = prev.topicStates[e.topicId] ?? makeEmptyTopicState(e.topicId, tree.rootNodeId);
    const updatedState: TopicWalkState = { ...existingState, currentNodeId: e.nextId, completedSteps: [...existingState.completedSteps, step], finished: e.nextId === null };
    const updated: CrossExamSessionRecord = { ...prev, topicStates: { ...prev.topicStates, [e.topicId]: updatedState } };
    setSession(updated);
    persist(updated);
  }, [trees, persist]);

  const handleTopicChange = useCallback((topicId: string) => {
    const prev = sessionRef.current;
    if (!prev) return;
    const tree = trees.find(t => t.topicId === topicId);
    const existingState = prev.topicStates[topicId];
    const newTopicStates = existingState ? prev.topicStates : { ...prev.topicStates, [topicId]: makeEmptyTopicState(topicId, tree?.rootNodeId ?? '') };
    const updated: CrossExamSessionRecord = { ...prev, activeTopicId: topicId, topicStates: newTopicStates };
    setSession(updated);
    persist(updated);
  }, [trees, persist]);

  const handleNotesChange = useCallback((nodeId: string, notes: string) => {
    const prev = sessionRef.current;
    if (!prev) return;
    const updatedTopicStates: Record<string, TopicWalkState> = {};
    for (const [topicId, state] of Object.entries(prev.topicStates)) {
      const updatedSteps = state.completedSteps.map(step => step.nodeId === nodeId ? { ...step, notes } : step);
      updatedTopicStates[topicId] = { ...state, completedSteps: updatedSteps };
    }
    const updated: CrossExamSessionRecord = { ...prev, topicStates: updatedTopicStates };
    setSession(updated);
    persist(updated);
  }, [persist]);

  const handleFallbackJump = useCallback((topicId: string, node: CrossExamNode) => {
    const prev = sessionRef.current;
    if (!prev) return;
    const existingState = prev.topicStates[topicId];
    if (!existingState) return;
    const updatedState: TopicWalkState = { ...existingState, currentNodeId: node.id, finished: false };
    const updated: CrossExamSessionRecord = { ...prev, topicStates: { ...prev.topicStates, [topicId]: updatedState } };
    setSession(updated);
    persist(updated);
  }, [persist]);

  const handleManualStep = useCallback((step: SessionStep) => {
    const prev = sessionRef.current;
    if (!prev || !prev.activeTopicId) return;
    const topicId = prev.activeTopicId;
    const tree = trees.find(t => t.topicId === topicId);
    const existingState: TopicWalkState = prev.topicStates[topicId] ?? makeEmptyTopicState(topicId, tree?.rootNodeId ?? '');
    const updatedState: TopicWalkState = { ...existingState, completedSteps: [...existingState.completedSteps, step] };
    const updated: CrossExamSessionRecord = { ...prev, topicStates: { ...prev.topicStates, [topicId]: updatedState } };
    setSession(updated);
    persist(updated);
  }, [trees, persist]);

  const handleEndSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      await closeSession(current.id);
      setLastEndedSessionId(current.id);
      onSessionEnd?.(current.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not close session');
    }
  }, [onSessionEnd]);

  const handleNewSession = useCallback(async () => {
    const current = sessionRef.current;
    try {
      if (current && current.endedAt === null) await closeSession(current.id);
      const fresh = makeNewSession(caseId, witnessId);
      await createSession(fresh);
      setSession(fresh);
      setSaveError(null);
      setLogOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not start new session');
    }
  }, [caseId, witnessId]);

  const positionMap = useMemo(() => (session ? derivePositionMap(session.topicStates) : {}), [session]);
  const allSteps = useMemo(() => (session ? flattenSteps(session.topicStates) : []), [session]);
  const makeFallbackJumpHandler = useCallback((topicId: string) => (node: CrossExamNode) => handleFallbackJump(topicId, node), [handleFallbackJump]);

  if (loading) return <LoadingScreen />;
  if (!session) return <div style={{ padding: 24, color: T.mute, fontSize: 13 }}>Failed to initialise session. Check IndexedDB permissions.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: T.bg, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <StatusBar sessionId={session.id} startedAt={session.startedAt} saveError={saveError} onEnd={handleEndSession} onNewSession={handleNewSession} />
      <CrossExamPostSession caseId={caseId} triggerSessionId={lastEndedSessionId} witnessLabels={witnessLabels} />
      <CrossExamPrintPanel trees={trees} caseName={caseName} witnessName={witnessName} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <CrossExamTopicSwitcher trees={trees} activeTopicId={session.activeTopicId} positions={positionMap} onTopicChange={handleTopicChange} onStep={handleStep} />
      </div>
      <CrossExamManualOverride onManualStep={handleManualStep} />
      <LogToggleButton stepCount={allSteps.length} open={logOpen} onToggle={() => setLogOpen(v => !v)} />
      {logOpen && (
        <div style={{ maxHeight: '38vh', overflowY: 'auto', borderTop: `1px solid ${T.bdr}`, flexShrink: 0 }}>
          <CrossExamSessionLog steps={allSteps} trees={trees} onNotesChange={(nodeId, notes) => handleNotesChange(nodeId, notes)} />
        </div>
      )}
    </div>
  );
}

export { derivePositionMap, flattenSteps };
export type { TopicPositionMap };
