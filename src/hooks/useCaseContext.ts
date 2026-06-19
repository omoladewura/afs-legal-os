/**
 * AFS Legal OS — useCaseContext Hook  (Phase 6)
 *
 * Drop-in upgrade from useIntelligence for heavy-drafting engines.
 * Returns the same shape as useIntelligence PLUS an async-enriched
 * `fullContext` that automatically substitutes retrieved case history
 * chunks when the case is large enough to benefit from RAG.
 *
 * ─── WHY A SEPARATE HOOK ─────────────────────────────────────────────────────
 * useIntelligence() is synchronous and called in the render body.
 * RAG retrieval is async (fetch to Cloudflare Worker). Mixing async I/O
 * into a render-phase hook requires useEffect + useState — which would
 * bloat useIntelligence and change its contract for the 50 call sites
 * that don't need RAG enrichment.
 *
 * This hook wraps useIntelligence: it immediately returns the synchronous
 * fullContext (digest-based) so the engine can render before RAG resolves,
 * then swaps in the RAG-enriched context once the retrieval completes.
 *
 * ─── THRESHOLD GATE ──────────────────────────────────────────────────────────
 * shouldUseCaseRag() (from caseRag.ts) checks:
 *   - digest length > 4 000 chars, OR
 *   - docket entry count > 25
 *
 * Below the threshold: fullContext is identical to useIntelligence's output.
 * Above it: retrieved chunks replace the digest in fullContext.
 * Small/young cases never pay an extra network call.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 * // Before (useIntelligence):
 * const { fullContext, hasIntel } = useIntelligence(activeCase);
 *
 * // After (useCaseContext) — same destructuring, no other changes:
 * const { fullContext, hasIntel, ragLoading } = useCaseContext(activeCase, {
 *   query: argIssue || legalIssues[0] || activeCase?.caseName || '',
 *   engine: 'ArgumentBuilder',
 * });
 *
 * Optionally show a subtle indicator while RAG is loading:
 *   {ragLoading && <span style={{ fontSize: 10, color: '#888' }}>⟳ enriching context…</span>}
 *
 * ─── SCOPE ───────────────────────────────────────────────────────────────────
 * Pass `scope` exactly as you would to useIntelligence. Defaults to 'full'.
 * RAG enrichment only runs when scope is 'full' or 'issues' — procedural
 * engines on 'facts' scope don't benefit from case history retrieval.
 */

import { useState, useEffect, useRef } from 'react';
import type { Case } from '@/types';
import { useIntelligence, type IntelligenceScope, type IntelOutput } from '@/hooks/useIntelligence';
import {
  shouldUseCaseRag,
  queryCaseHistory,
  formatCaseHistoryForPrompt,
  buildCaseRagQuery,
  isCaseRagConfigured,
} from '@/services/caseRag';

// ── Output type ───────────────────────────────────────────────────────────────

export interface CaseContextOutput extends IntelOutput {
  /** True while the async RAG retrieval is in flight. */
  ragLoading: boolean;
  /** True when RAG was engaged (case exceeded threshold) even if retrieval returned nothing. */
  ragEngaged: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCaseContext(
  activeCase: Case | null,
  opts: {
    /** The query used for RAG retrieval — typically argIssue, legalIssues[0], or engine name. */
    query:   string;
    /** Optional: engine label injected into buildCaseRagQuery for better retrieval. */
    engine?: string;
  },
  scope: IntelligenceScope = 'full',
): CaseContextOutput {

  // 1. Always get the synchronous baseline from useIntelligence
  const base = useIntelligence(activeCase, scope);

  // 2. RAG state — starts with the synchronous fullContext so the engine
  //    can render immediately without waiting for the retrieval.
  const [enrichedContext, setEnrichedContext] = useState<string | null>(null);
  const [ragLoading,      setRagLoading]      = useState(false);
  const [ragEngaged,      setRagEngaged]      = useState(false);

  // Track the last query+caseId so we re-fetch when they change
  const lastFetchKey = useRef<string>('');

  useEffect(() => {
    // Only enrich on 'full' or 'issues' scope
    if (scope === 'facts') return;
    if (!activeCase?.id) return;
    if (!isCaseRagConfigured()) return;

    const digestLength  = activeCase.intelligence_data?.digest?.length ?? 0;
    const docketEntries = activeCase.recent_entries?.length ?? 0;

    if (!shouldUseCaseRag({ digestLength, docketEntries })) return;

    const legalIssues = (activeCase.intelligence_data as any)?.legal_issues ?? [];
    const ragQuery = buildCaseRagQuery({
      argIssue:    opts.query,
      engineHint:  opts.engine,
      legalIssues: Array.isArray(legalIssues) ? legalIssues.slice(0, 3) : [],
      caseName:    activeCase.caseName,
    });

    if (!ragQuery.trim()) return;

    const fetchKey = `${activeCase.id}::${ragQuery}`;
    if (fetchKey === lastFetchKey.current) return; // already fetched this combo
    lastFetchKey.current = fetchKey;

    setRagLoading(true);
    setRagEngaged(true);

    queryCaseHistory(activeCase.id, ragQuery, { topK: 5 })
      .then(result => {
        if (!result.skipped && result.chunks.length > 0) {
          const ragBlock = formatCaseHistoryForPrompt(result.chunks, activeCase.caseName);

          // Build enriched fullContext:
          //   - Replace the digest section with retrieved chunks (more targeted)
          //   - Keep the counsel block unchanged
          const enriched = ragBlock + '\n\n' + base.counselBlock;
          setEnrichedContext(enriched);
        } else {
          // RAG returned nothing useful — keep the baseline fullContext
          setEnrichedContext(null);
        }
      })
      .catch(() => {
        // Network error — fall back to baseline silently
        setEnrichedContext(null);
      })
      .finally(() => {
        setRagLoading(false);
      });

  }, [activeCase?.id, opts.query, opts.engine, scope]);

  // Reset when case changes
  useEffect(() => {
    setEnrichedContext(null);
    setRagEngaged(false);
    setRagLoading(false);
    lastFetchKey.current = '';
  }, [activeCase?.id]);

  return {
    ...base,
    fullContext: enrichedContext ?? base.fullContext,
    ragLoading,
    ragEngaged,
  };
}
