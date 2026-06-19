/**
 * AFS Advocates — useAI Hook
 *
 * Shared hook for making AI calls with consistent loading/error state.
 * Every engine uses this instead of managing its own fetch state.
 *
 * V2 upgrade: accepts an optional `activeCase` argument.
 * When provided, every `ask()` call automatically:
 *   1. Injects matter_track + counsel_role into the request body
 *      so the Cloudflare Worker can filter Vectorize retrieval to
 *      role-appropriate library materials.
 *   2. Builds the correct role-aware LibraryQueryOpts (namespace,
 *      filter, topK, threshold, queryHint) from roleLibrary.ts.
 *   3. Falls back to the role-aware system prompt if the caller
 *      does not provide one explicitly.
 *
 * Usage (with role-awareness):
 *   const ai = useAI(activeCase);
 *   const { ask, loading, error } = ai;
 *   const result = await ask({ userMsg: '...' });          // role injected automatically
 *   const result = await ask({ system: '...', userMsg: '...' }); // explicit system override
 *
 * Usage (without case — legacy / utility calls):
 *   const { ask } = useAI();
 *   const result = await ask({ system: '...', userMsg: '...' });
 */

import { useState, useCallback } from 'react';
import { callClaude, ApiError } from '@/services/api';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { buildRoleLibraryOpts, deriveRoleHint } from '@/utils/roleLibrary';
import { appendTokenLog } from '@/storage/helpers';
import type { ApiRequestOptions, Case } from '@/types';

interface UseAIReturn {
  /** Make an AI call. Role fields are injected automatically if activeCase was provided. */
  ask:        (opts: ApiRequestOptions) => Promise<string | null>;
  /** Alias for ask — for components that use the older 'call' name. */
  call:       (opts: ApiRequestOptions) => Promise<string | null>;
  loading:    boolean;
  error:      string;
  clearError: () => void;
}

export function useAI(activeCase?: Case): UseAIReturn {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const ask = useCallback(async (opts: ApiRequestOptions): Promise<string | null> => {
    setLoading(true);
    setError('');
    try {
      let finalOpts = opts;

      // If we have an active case, enrich the request with role context
      if (activeCase) {
        const { matter_track, counsel_role } = activeCase;

        // Build role-aware library opts — merges with any caller-supplied opts
        const roleLibraryOpts = buildRoleLibraryOpts(
          matter_track,
          counsel_role,
          deriveRoleHint(
            typeof opts.userMsg === 'string' ? opts.userMsg : '',
            opts.libraryOpts?.queryHint,
          ),
        );

        // Caller-supplied libraryOpts override role defaults where specified
        const mergedLibraryOpts = {
          ...roleLibraryOpts,
          ...opts.libraryOpts,
          // queryHint: combine both hints for best retrieval
          queryHint: [roleLibraryOpts.queryHint, opts.libraryOpts?.queryHint]
            .filter(Boolean)
            .join(' ')
            .slice(0, 300) || roleLibraryOpts.queryHint,
        };

        // Fall back to role system prompt if caller didn't supply one
        const system = opts.system
          ?? buildRoleSystemPrompt(matter_track, counsel_role);

        finalOpts = {
          ...opts,
          system,
          libraryOpts:  mergedLibraryOpts,
          matter_track: opts.matter_track ?? matter_track,
          counsel_role: opts.counsel_role ?? counsel_role,
        };
      }

      const { text, usage } = await callClaude(finalOpts);

      // Fire-and-forget token telemetry — never blocks the caller
      if (activeCase?.id) {
        const engineHint = finalOpts.libraryOpts?.queryHint ?? 'unknown';
        appendTokenLog(activeCase.id, engineHint, usage);
      }

      return text;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message ?? 'Unknown error';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeCase]);

  const clearError = useCallback(() => setError(''), []);

  return { ask, call: ask, loading, error, clearError };
}
