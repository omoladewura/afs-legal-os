/**
 * AFS Legal OS — Article Generator — Final-Format Generator
 *
 * Roadmap ref: 7d (Article Generator) — the last step in the chain:
 *   7a (topics table) → 7b (topic selector) → 7c (wired into 6c as
 *   problem_statement) → 7d (this file): takes Supo's gathered research
 *   (the ResearchSession 7c started and the caller ran to exhaustion via
 *   6c's runResearchTurn) + house style rules, and produces one copy-ready
 *   draft.
 *
 * NO CONNECTION TO THE PUBLIC SITE — per the roadmap item itself. This
 * function returns a draft in memory; it does not publish, post, or push
 * anywhere. There is also no D1 table for drafts (7a only ever created
 * article_topics_log) — the roadmap didn't ask for draft persistence, so
 * none is added here. Same "don't silently fold in a decision nobody made"
 * convention as pass0.ts declining to invent a knowledge-tier tag.
 *
 * STYLE RULES — "dramatized storytelling, pre-AI rhythm" per the roadmap
 * item's own wording. Encoded directly in the system prompt below as a set
 * of concrete dos/don'ts rather than a vague adjective, same reasoning as
 * every other prompt in this codebase (see pass0.ts, queryGenerator.ts):
 * a model instructed to "be dramatic" tends toward generic AI voice anyway
 * unless told specifically what NOT to sound like.
 *
 * GROUNDING — the draft is built ONLY from what's in `session.entries`
 * (Supo's actual findings), not from the model's own general knowledge on
 * top of them. The prompt is explicit that ungrounded claims are not
 * permitted, and that findings Supo flagged as general-knowledge/uncertain
 * must not be dramatized into settled fact.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts / runResearchTurn() / selectNextTopic().
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { uid } from '@/utils';
import type { ResearchSession } from '@/research/types';
import type { ArticleTopicLogEntry } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ArticleDraft {
  id: string;
  topic_id: string;   // ArticleTopicLogEntry.id — links the draft back to its topic
  area: string;
  topic: string;
  title: string;
  body: string;       // full copy-ready article text
  created_at: string;
}

export interface GenerateArticleDraftResult {
  ok: boolean;
  draft?: ArticleDraft;
  /** Set only when ok is false. */
  error?: string;
}

interface RawDraft {
  title: string;
  body:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_SYSTEM = `You are the writer for AFS Legal OS's Article Generator. You take grounded
legal research — a sequence of queries and findings gathered by Supo, the
Research Assistant — and turn it into ONE finished, copy-ready article.

STYLE — dramatized storytelling, pre-AI rhythm:
- Open with a scene, a tension, or a concrete stake — never a dictionary-
  style definition of the topic, never "In today's legal landscape...".
- Vary sentence length deliberately — short sentences land points; longer
  ones carry argument and nuance. Avoid the flat, evenly-paced rhythm of
  generic AI prose.
- Write like a human legal writer, not a summarizer. No "it's important to
  note", no "in conclusion", no bullet-pointed takeaways, no meta-commentary
  about the article itself.
- Prose throughout — no headers, no numbered lists, no bullet points, unless
  the research itself concerns a numbered statutory list that genuinely
  needs to be reproduced as one.
- End with a real closing beat, not a summary paragraph restating what was
  already said.

GROUNDING — non-negotiable:
- Base every legal claim on the findings you are given. Do not introduce
  authorities, cases, or statutory provisions that are not in the findings.
- Where a finding relied on general legal knowledge rather than a verified
  source, do not dramatize it into a settled fact — keep the same
  qualification the finding gave it, just in narrative prose instead of a
  flagged note.
- If the findings leave a gap, write around it honestly rather than
  inventing something to fill it.

Do not wrap the JSON in markdown code fences — return raw JSON only.

Return EXACTLY this shape, nothing else:
{
  "title": string,
  "body": string
}`;

function buildDraftUserMsg(session: ResearchSession, topicEntry: ArticleTopicLogEntry): string {
  const lines: string[] = [];
  lines.push(`AREA: ${topicEntry.area}`);
  lines.push(`TOPIC: ${topicEntry.topic}`);
  lines.push('');
  lines.push(`RESEARCH GATHERED (${session.entries.length} turn${session.entries.length === 1 ? '' : 's'}, oldest first):`);
  session.entries.forEach((e, i) => {
    lines.push('');
    lines.push(`Turn ${i + 1} query: ${e.query}`);
    lines.push(`Turn ${i + 1} findings: ${e.findings}`);
  });
  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseDraft(raw: string): RawDraft | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const title = parsed.title;
    const body  = parsed.body;
    if (typeof title === 'string' && title.trim() && typeof body === 'string' && body.trim()) {
      return { title: title.trim(), body: body.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the final copy-ready draft from a research session and the
 * topic that seeded it. Never throws — a failed AI call, a malformed
 * response, or a session with no findings all degrade to `ok: false` with
 * a user-facing `error`, same convention as runPass0() / selectNextTopic().
 *
 * Does not require `session.status === 'exhausted'` — a session counsel
 * stopped early ('abandoned', via 6d's "Stop Here") still has real findings
 * worth drafting from. What's required is at least one entry; an empty
 * session has nothing to ground a draft in.
 */
export async function generateArticleDraft(
  session: ResearchSession,
  topicEntry: ArticleTopicLogEntry,
): Promise<GenerateArticleDraftResult> {
  if (session.entries.length === 0) {
    return { ok: false, error: 'Research session has no findings to draft from' };
  }

  let raw: RawDraft | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      DRAFT_SYSTEM,
      userMsg:     buildDraftUserMsg(session, topicEntry),
      maxTokens:   4000,
      skipLibrary: true,   // drafting from Supo's findings, not a fresh library lookup
    }));
    raw = parseDraft(text);
  } catch (e) {
    return { ok: false, error: classifyError(e) };
  }

  if (!raw) {
    return { ok: false, error: 'Could not parse a draft from AI response' };
  }

  const draft: ArticleDraft = {
    id:         uid(),
    topic_id:   topicEntry.id,
    area:       topicEntry.area,
    topic:      topicEntry.topic,
    title:      raw.title,
    body:       raw.body,
    created_at: new Date().toISOString(),
  };

  return { ok: true, draft };
}
