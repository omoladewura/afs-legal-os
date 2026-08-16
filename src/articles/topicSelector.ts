/**
 * AFS Legal OS — Article Generator — Topic Selector
 *
 * Roadmap ref: 7b (Article Generator)
 *
 * Picks the next article topic: random + cross-area + checked against 7a's
 * `article_topics_log` table for no-repeat. Two-part selection, deliberately
 * kept as two steps rather than one AI call doing everything:
 *
 *   Step 1 — AREA (local, no AI call). Pull recent log entries, exclude
 *            whichever areas appear in the most recent AREA_LOOKBACK
 *            entries, and pick randomly from what's left. This is what
 *            makes it "cross-area" — a run of Contract Law topics can't
 *            repeat back-to-back-to-back. If every area has been used
 *            recently (small log, or AREAS itself is small), the exclusion
 *            relaxes rather than fails: pick randomly from the full list.
 *
 *   Step 2 — TOPIC (one AI call). Given the chosen area and the recent
 *            topic strings (not just from that area — the full recent
 *            window), generate ONE specific, narrow topic that isn't a
 *            restatement of anything recently covered. "No-repeat" is
 *            enforced two ways: the prompt is told what to avoid, and a
 *            local case-insensitive exact/near-match check rejects an
 *            obviously identical result rather than trusting the model
 *            alone — same "don't just trust the model" convention as
 *            MAX_RESEARCH_TURNS backstopping Supo's exhaustion verdict in
 *            research/queryGenerator.ts.
 *
 * On success, the new topic is logged to 7a's table (logArticleTopic) before
 * being returned, so the very next call already sees it in "recent" — same
 * append-then-return order as runResearchTurn() appending before returning.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts / runResearchTurn().
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { uid } from '@/utils';
import { loadArticleTopicsLog, logArticleTopic } from '@/storage/helpers';
import { AREAS } from '@/constants/legal';
import type { ArticleTopicLogEntry } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

/** How many of the most recent log entries to pull for both checks below. */
const RECENT_WINDOW = 30;

/** How many of the most-recent entries' areas are excluded from this pick. */
const AREA_LOOKBACK = 5;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface TopicSelectionResult {
  ok: boolean;
  entry?: ArticleTopicLogEntry;
  /** Set only when ok is false. */
  error?: string;
}

interface RawTopic {
  topic: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — AREA
// ─────────────────────────────────────────────────────────────────────────────

function pickArea(recent: ArticleTopicLogEntry[]): string {
  const recentlyUsed = new Set(recent.slice(0, AREA_LOOKBACK).map(e => e.area));
  const candidates = AREAS.filter(a => !recentlyUsed.has(a));
  const pool = candidates.length > 0 ? candidates : AREAS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — TOPIC
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_SYSTEM = `You generate ONE article topic for AFS Legal OS's Article Generator. You will
be given a practice area and a list of topics recently covered (across all
areas, not just this one). Return a single specific, narrow topic within the
given area — something a practitioner would recognise as a distinct angle,
not a restatement of the practice area itself and not equivalent in
substance to anything on the recent-topics list.

Do not wrap the JSON in markdown code fences — return raw JSON only.

Return EXACTLY this shape, nothing else:
{
  "topic": string
}

Rules:
- The topic must sit within the given area, but be specific enough to
  actually write an article about — a real question, tension, or recent
  development, not a textbook chapter title.
- Never propose a topic that is a close paraphrase of anything on the
  recent-topics list.`;

function buildTopicUserMsg(area: string, recentTopics: string[]): string {
  const lines: string[] = [];
  lines.push(`AREA: ${area}`);
  if (recentTopics.length > 0) {
    lines.push('');
    lines.push('RECENTLY COVERED TOPICS (avoid restating any of these):');
    recentTopics.forEach(t => lines.push(`- ${t}`));
  } else {
    lines.push('');
    lines.push('No prior topics logged yet.');
  }
  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseTopic(raw: string): RawTopic | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const topic = parsed.topic;
    if (typeof topic === 'string' && topic.trim()) {
      return { topic: topic.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

/** Case-insensitive exact/near-match backstop — see file header. */
function isNearDuplicate(candidate: string, recentTopics: string[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const c = norm(candidate);
  return recentTopics.some(t => norm(t) === c);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects and logs the next article topic. Never throws — a failed AI call,
 * a malformed response, or an exact-duplicate result all degrade to
 * `ok: false` with a user-facing `error`, same convention as runPass0() /
 * runResearchTurn(). Does not retry the duplicate case itself — surfacing
 * it lets 7c's caller decide whether to re-run, same as any other failure.
 */
export async function selectNextTopic(): Promise<TopicSelectionResult> {
  const recent = await loadArticleTopicsLog(RECENT_WINDOW);
  const recentTopics = recent.map(e => e.topic);
  const area = pickArea(recent);

  let raw: RawTopic | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      TOPIC_SYSTEM,
      userMsg:     buildTopicUserMsg(area, recentTopics),
      maxTokens:   300,
      skipLibrary: true,   // topic selection is a naming exercise, not legal research
    }));
    raw = parseTopic(text);
  } catch (e) {
    return { ok: false, error: classifyError(e) };
  }

  if (!raw) {
    return { ok: false, error: 'Could not parse a topic from AI response' };
  }

  if (isNearDuplicate(raw.topic, recentTopics)) {
    return { ok: false, error: `Generated topic duplicates a recent entry: "${raw.topic}"` };
  }

  const now = new Date().toISOString();
  const entry: ArticleTopicLogEntry = {
    id:         uid(),
    topic:      raw.topic,
    area,
    created_at: now,
  };

  await logArticleTopic(entry);

  return { ok: true, entry };
}
