/**
 * AFS Legal OS — Research Assistant — Query/Findings Generator ("Supo")
 *
 * Roadmap ref: 6c (Research Assistant) — the entire core engine; everything
 * else in section 6 is UI/storage around this one function.
 *
 * ONE model call per turn produces the complete next ResearchQueryFinding:
 *   - the next query (derived from the problem statement on turn 1, from
 *     the PRIOR entry's findings on every turn after — never a restatement
 *     of the problem statement past turn 1)
 *   - findings for that query (a grounded synthesis, not a source dump)
 *   - an explicit exhaustion verdict + one-line reasoning
 *
 * EXHAUSTION SIGNAL — per the 6a decision, exhaustion is Supo's own
 * judgment call, asked and answered on every turn as part of the same
 * structured JSON response, not inferred from query count or keyword
 * overlap. See research/types.ts's doc comment on ResearchQueryFinding for
 * the full rationale.
 *
 * SAFETY VALVE — the 6a decision also calls for a heuristic backstop in
 * case Supo never signals exhaustion (a topic where every turn plausibly
 * finds "one more thing"). MAX_TURNS enforces that here, deterministically,
 * with no extra AI call: if accepting this turn's entry would put the
 * session at the cap, `exhausted` is forced true and a note is appended to
 * `exhausted_reasoning` — Supo's own reasoning is kept, not discarded, so
 * counsel can still see what Supo actually thought.
 *
 * NOT YET WIRED — per research/types.ts's file header, there is no
 * persistence layer for research sessions yet. This function reads and
 * returns a ResearchSession purely in memory; it does not read or write
 * storage. It also does not query the internal library/Vectorize RAG
 * (services/library.ts) — Supo reasons from general legal knowledge here,
 * flagging what needs verification, same convention as the existing
 * CaseResearch.tsx topic-search flow. Library grounding for Research
 * Assistant, if wanted, is a future roadmap item, not silently folded in.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts / clauseRegister.ts / knowledgeTier.ts.
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { uid } from '@/utils';
import type { ResearchQueryFinding, ResearchSession } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY VALVE — see file header
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_RESEARCH_TURNS = 8;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface RunResearchTurnResult {
  /** The session with the new turn appended (or unchanged — see guard clauses below). */
  session: ResearchSession;
  /** True iff a new entry was actually appended this call. */
  advanced: boolean;
  ok: boolean;
  /** Set only when ok is false. */
  error?: string;
}

interface RawTurn {
  query:                string;
  findings:             string;
  exhausted:            boolean;
  exhausted_reasoning:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const TURN_SYSTEM = `You are Supo, the AFS Legal OS Research Assistant. You work a single
problem statement one turn at a time. Each turn you address exactly ONE
research query and report your findings on it — then you judge, honestly,
whether enough has now been gathered to consider the problem statement
resolved.

RULES FOR THE QUERY:
- On the FIRST turn (no prior entries), the query is the most natural
  starting angle on the problem statement itself.
- On every turn AFTER the first, the query must be derived from the
  PRIOR turn's findings — following up on a gap, an unresolved thread, a
  named authority worth checking, or the next angle the prior findings
  surfaced. Never simply restate the problem statement or repeat a prior
  query.
- The query should be specific enough that it reads like something counsel
  could paste into a legal research tool, not a vague restatement of the
  topic.

RULES FOR FINDINGS:
- Answer the query directly, in your own synthesized words — doctrine,
  relevant authority types, practical considerations. Do not pad with
  generic commentary.
- Where you are relying on general legal knowledge rather than a specific
  verified source, say so plainly. Never invent a case name, citation, or
  statute section.

RULES FOR THE EXHAUSTION VERDICT:
- Judge against the ORIGINAL problem statement, not just this turn's
  query — has the problem statement, as a whole, now been sufficiently
  addressed across all turns so far (this one included)?
- Default to false unless you can articulate specifically what would be
  redundant about another turn. A single turn's findings are almost never
  enough on their own.
- exhausted_reasoning is required on every turn, not just when exhausted is
  true — one or two sentences on why you did or didn't consider the
  problem resolved as of this turn.

Do not wrap the JSON in markdown code fences — return raw JSON only.

Return EXACTLY this shape, nothing else:
{
  "query": string,
  "findings": string,
  "exhausted": boolean,
  "exhausted_reasoning": string
}`;

function buildUserMsg(session: ResearchSession): string {
  const lines: string[] = [];
  lines.push(`PROBLEM STATEMENT:`);
  lines.push(session.problem_statement.trim());

  if (session.entries.length === 0) {
    lines.push('');
    lines.push('No prior turns — this is turn 1.');
  } else {
    lines.push('');
    lines.push('PRIOR TURNS (oldest first):');
    session.entries.forEach((e, i) => {
      lines.push(`Turn ${i + 1} query: ${e.query}`);
      lines.push(`Turn ${i + 1} findings: ${e.findings}`);
    });
  }

  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseTurn(raw: string): RawTurn | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;

    const query               = parsed.query;
    const findings             = parsed.findings;
    const exhausted            = parsed.exhausted;
    const exhaustedReasoning   = parsed.exhausted_reasoning;

    if (
      typeof query === 'string' && query.trim() &&
      typeof findings === 'string' && findings.trim() &&
      typeof exhausted === 'boolean' &&
      typeof exhaustedReasoning === 'string' && exhaustedReasoning.trim()
    ) {
      return {
        query:               query.trim(),
        findings:            findings.trim(),
        exhausted,
        exhausted_reasoning: exhaustedReasoning.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function unchanged(session: ResearchSession, error?: string): RunResearchTurnResult {
  return { session, advanced: false, ok: !error, error };
}

/**
 * Runs one turn of the Research Assistant loop against `session`, appending
 * the new entry and rolling `status` up to 'exhausted' if Supo's (or the
 * safety valve's) verdict says so. Never throws — a failed AI call or a
 * malformed response degrades to `ok: false` with the session returned
 * unchanged, same convention as runPass0() / runKnowledgeTierResolution().
 *
 * No-ops (ok: true, advanced: false) if the session is not 'active' —
 * calling this again on an exhausted or abandoned session is not an error,
 * it just doesn't do anything, same "idempotent-ish" convention as the
 * Contract Engine's 2d/2e/2f.
 */
export async function runResearchTurn(session: ResearchSession): Promise<RunResearchTurnResult> {
  if (session.status !== 'active') {
    return unchanged(session);
  }
  if (!session.problem_statement.trim()) {
    return unchanged(session, 'Session has no problem statement');
  }

  let raw: RawTurn | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      TURN_SYSTEM,
      userMsg:     buildUserMsg(session),
      maxTokens:   1400,
      skipLibrary: true,   // Supo reasons from general knowledge this turn — see file header
    }));
    raw = parseTurn(text);
  } catch (e) {
    return unchanged(session, classifyError(e));
  }

  if (!raw) {
    return unchanged(session, 'Could not parse this turn\u2019s query/findings from AI response');
  }

  const now = new Date().toISOString();
  const willHitCap = session.entries.length + 1 >= MAX_RESEARCH_TURNS;

  const entry: ResearchQueryFinding = {
    id:        uid(),
    query:     raw.query,
    findings:  raw.findings,
    exhausted: raw.exhausted || willHitCap,
    exhausted_reasoning: willHitCap && !raw.exhausted
      ? `${raw.exhausted_reasoning} (forced — reached the maximum of ${MAX_RESEARCH_TURNS} research turns without an explicit exhaustion signal.)`
      : raw.exhausted_reasoning,
    created_at: now,
  };

  const updatedSession: ResearchSession = {
    ...session,
    entries:    [...session.entries, entry],
    status:     entry.exhausted ? 'exhausted' : 'active',
    updated_at: now,
  };

  return { session: updatedSession, advanced: true, ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION FACTORY — convenience for 6d, not itself part of the core loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a fresh, empty ResearchSession for a new problem statement.
 * Pure/synchronous — no AI call, no storage. `runResearchTurn()` is what
 * actually populates `entries`.
 */
export function createResearchSession(problemStatement: string): ResearchSession {
  const now = new Date().toISOString();
  return {
    id:                 uid(),
    problem_statement:  problemStatement.trim(),
    entries:            [],
    status:             'active',
    created_at:          now,
    updated_at:          now,
  };
}
