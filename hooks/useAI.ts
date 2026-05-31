/**
 * AFS Advocates — useAI Hook
 *
 * Shared hook for making AI calls with consistent loading/error state.
 * Every engine uses this instead of managing its own fetch state.
 *
 * Usage:
 *   const { call, loading, error, clearError } = useAI();
 *   const result = await call({ system: '...', userMsg: '...' });
 */

import { useState, useCallback } from 'react';
import { callClaude, ApiError } from '@/services/api';
import type { ApiRequestOptions } from '@/types';

interface UseAIReturn {
  call:       (opts: ApiRequestOptions) => Promise<string | null>;
  loading:    boolean;
  error:      string;
  clearError: () => void;
}

export function useAI(): UseAIReturn {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const call = useCallback(async (opts: ApiRequestOptions): Promise<string | null> => {
    setLoading(true);
    setError('');
    try {
      const result = await callClaude(opts);
      return result;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message ?? 'Unknown error';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return { call, loading, error, clearError };
}
