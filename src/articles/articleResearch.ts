/**
 * AFS Legal OS — Article Generator — Research Bridge
 *
 * Roadmap ref: 7c (Article Generator) — wires 7b's topic (2b's own module)
 * into the Research Assistant (6b/6c) as the starting `problem_statement`.
 * No new logic — same "just routing" convention as 3d wiring Review mode
 * into 2d/2e/2f. Everything here already exists: `selectNextTopic()` (7b)
 * and `createResearchSession()` (6c). This file only connects the two.
 *
 * Does NOT run any research turns itself. `startArticleResearch()` hands
 * back a fresh, empty `ResearchSession` (0 entries, status 'active') —
 * exactly what `createResearchSession()` alone would produce — plus the
 * `ArticleTopicLogEntry` that seeded it. Running turns is `runResearchTurn()`
 * (6c), called by whatever screen owns the session next, same as 6d's
 * dashboard does for a manually-typed problem statement. Keeping topic
 * selection and turn execution as separate steps here means a caller can
 * inspect/reject the selected topic (e.g. re-roll) before spending any
 * research-turn AI calls on it.
 *
 * PROBLEM STATEMENT SHAPE — 7b's topic is already specific and concrete
 * (see topicSelector.ts's prompt rules), so it's used close to verbatim.
 * The practice area is appended in parentheses only because
 * ResearchSession (6b) has no separate `area` field to carry it in — this
 * is the one place that context would otherwise be lost between 7b and 6c.
 */

import { createResearchSession } from '@/research/queryGenerator';
import type { ResearchSession } from '@/research/types';
import { selectNextTopic } from './topicSelector';
import type { ArticleTopicLogEntry } from './types';

export interface StartArticleResearchResult {
  ok: boolean;
  session?: ResearchSession;
  topicEntry?: ArticleTopicLogEntry;
  /** Set only when ok is false — propagated from 7b's selectNextTopic(). */
  error?: string;
}

function buildProblemStatement(entry: ArticleTopicLogEntry): string {
  return `${entry.topic} (${entry.area})`;
}

/**
 * Selects the next article topic (7b) and creates a fresh Research
 * Assistant session (6c) seeded with it. Never throws — a failed topic
 * selection degrades to `ok: false` with 7b's own error message, same
 * convention as every other `runXxx`/`selectXxx` export in this codebase.
 */
export async function startArticleResearch(): Promise<StartArticleResearchResult> {
  const topicResult = await selectNextTopic();
  if (!topicResult.ok || !topicResult.entry) {
    return { ok: false, error: topicResult.error || 'Topic selection failed' };
  }

  const session = createResearchSession(buildProblemStatement(topicResult.entry));

  return { ok: true, session, topicEntry: topicResult.entry };
}
