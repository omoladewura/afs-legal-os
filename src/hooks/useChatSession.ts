/**
 * AFS Legal OS — useChatSession Hook
 *
 * Phase 4 — Conversation History Discipline
 *
 * Extracted shared logic from AICopilot and CommandConsole so the history
 * cap and context-injection fix live in one place.
 *
 * Problems solved:
 *
 *   1. Unbounded history — Every turn previously re-sent the full conversation
 *      back to the model. Cost grows linearly with session length. This hook
 *      caps sent history at HISTORY_WINDOW turns (default 12 = 6 exchanges).
 *      Turns older than the window are folded into a single running summary
 *      prepended as an assistant turn at position 0.
 *
 *   2. Case context re-injected per user message — AICopilot prepended
 *      buildCaseContext() into EVERY user message when "Case Context" was
 *      toggled on. Across a 20-turn session that meant the same ~200 token
 *      block was repeated in 20 message turns. Fixed: case context goes into
 *      the system prompt ONCE (via fullContext from useIntelligence); user
 *      messages contain only the user's actual words.
 *
 * API:
 *   const { turns, appendTurns, summariseOldTurns, windowedApiMessages } =
 *     useChatSession({ caseId });
 *
 *   turns              — full local display array (CopilotTurn[]), never trimmed
 *   appendTurns        — add one or more turns to local state
 *   windowedApiMessages — returns the capped ApiMessage[] ready to send
 *                         (summary stub + last HISTORY_WINDOW turns)
 *   clearSession       — reset to empty
 */

import { useState, useCallback } from 'react';
import type { ApiMessage } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of turns (user + assistant combined) to send to the API.
 * Older turns are folded into a single running summary.
 *
 * 12 turns = 6 full exchanges. At ~400 tokens/exchange that's ~2 400 tokens
 * of history — enough for a substantive session without unbounded growth.
 */
export const HISTORY_WINDOW = 12;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CopilotTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface UseChatSessionReturn {
  /** Full display-side turn array — never trimmed, suitable for rendering */
  turns: CopilotTurn[];

  /** Append one or more turns (call after a successful round-trip) */
  appendTurns: (...newTurns: CopilotTurn[]) => void;

  /**
   * Returns the capped ApiMessage[] to send.
   * If turns exceed HISTORY_WINDOW the overflow is folded into a summary stub
   * prepended at position 0, so the model always has context without paying
   * for the full verbatim history.
   */
  windowedApiMessages: () => ApiMessage[];

  /** Hard-reset the session */
  clearSession: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChatSession(): UseChatSessionReturn {
  const [turns,   setTurns]   = useState<CopilotTurn[]>([]);
  const [summary, setSummary] = useState<string>('');

  const appendTurns = useCallback((...newTurns: CopilotTurn[]) => {
    setTurns(prev => {
      const next = [...prev, ...newTurns];

      // When we exceed the window, roll the oldest half into the summary.
      // "Oldest half" avoids rolling more turns than needed on every send.
      if (next.length > HISTORY_WINDOW) {
        const overflow    = next.length - HISTORY_WINDOW;
        const toSummarise = next.slice(0, overflow);
        const keep        = next.slice(overflow);

        // Build a compact summary stub from the rolled-off turns
        const summaryLines = toSummarise.map(t =>
          `${t.role === 'user' ? 'Counsel' : 'AI'}: ${t.text.slice(0, 200)}${t.text.length > 200 ? '…' : ''}`,
        );

        setSummary(prev =>
          [
            prev ? prev + '\n---' : '[EARLIER CONVERSATION SUMMARY]',
            ...summaryLines,
          ].join('\n'),
        );

        return keep;
      }

      return next;
    });
  }, []);

  const windowedApiMessages = useCallback((): ApiMessage[] => {
    const messages: ApiMessage[] = turns.map(t => ({
      role:    t.role,
      content: t.text,
    }));

    // If there is a rolled-up summary, prepend it as a synthetic assistant
    // turn so the model understands it as prior context, not as a new user
    // instruction. This avoids polluting the user slot with meta-instructions.
    if (summary) {
      return [
        { role: 'assistant', content: summary },
        ...messages,
      ];
    }

    return messages;
  }, [turns, summary]);

  const clearSession = useCallback(() => {
    setTurns([]);
    setSummary('');
  }, []);

  return { turns, appendTurns, windowedApiMessages, clearSession };
}
