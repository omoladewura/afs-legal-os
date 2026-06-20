/**
 * AFS Legal OS — useCaseTheory Hook
 * Trial Engine Consolidation, Phase 1.
 *
 * Single source of truth for reading the locked/unlocked Case Theory state
 * for a given case. Every engine that propagates theory (TrialEngine,
 * FinalWrittenAddressEngine, ArgumentBuilder Trial/Civil tracks, and any
 * ApplicationsEngine appType flagged needsCaseTheory: true) should read
 * through this hook rather than poking at activeCase.case_theory_* directly,
 * so loading state and reloads after save/lock/unlock stay consistent.
 *
 * USAGE:
 *   const { theory, locked, score, hasTheory, loading, reload } = useCaseTheory(activeCase?.id);
 *
 *   if (loading) return <LoadingBlock />;
 *   <CaseTheoryBanner theory={theory} locked={locked} score={score} hasTheory={hasTheory} />
 *
 *   // After a save/lock/unlock elsewhere in the same screen:
 *   await saveCaseTheory(caseId, updated);
 *   reload();
 *
 * NOTE: hasTheory is true only when the theory is BOTH locked and non-null —
 * mirrors hasCaseTheory() in storage/helpers.ts. An unlocked theory still
 * has `theory` populated (so counsel can see/edit it) but hasTheory is false,
 * which is the signal downstream engines use to withhold propagation.
 */

import { useState, useEffect, useCallback } from 'react';
import type { CaseTheoryRecord } from '@/types';
import { loadCaseTheory } from '@/storage/helpers';
import { loadCase } from '@/storage/helpers';

export interface UseCaseTheoryOutput {
  theory:    CaseTheoryRecord | null;
  locked:    boolean;
  score:     number | null;
  /** locked AND theory is not null — the gate downstream engines must check */
  hasTheory: boolean;
  loading:   boolean;
  /** Re-fetch from storage — call after any save/lock/unlock */
  reload:    () => void;
}

export function useCaseTheory(caseId: string | null | undefined): UseCaseTheoryOutput {
  const [theory,  setTheory]  = useState<CaseTheoryRecord | null>(null);
  const [locked,  setLocked]  = useState(false);
  const [score,   setScore]   = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick,    setTick]    = useState(0);

  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!caseId) {
      setTheory(null);
      setLocked(false);
      setScore(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Single case load — theory, lock state, and score all live on the
      // Case record, so one fetch covers all three rather than calling
      // loadCaseTheory() + a separate lock/score lookup.
      const c = await loadCase(caseId);
      if (cancelled) return;
      setTheory(c?.case_theory_structured ?? null);
      setLocked(c?.case_theory_locked === true);
      setScore(c?.case_theory_score ?? null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [caseId, tick]);

  const hasTheory = locked && !!theory;

  return { theory, locked, score, hasTheory, loading, reload };
}
