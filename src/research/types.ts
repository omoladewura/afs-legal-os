/**
 * AFS Legal OS — Research Assistant — Session State Types
 *
 * Kept in its own module, same pattern as src/contracts/types.ts,
 * src/matrimonial/types.ts, and src/law/registry.ts — domain-specific
 * shapes live next to the domain, not crammed into src/types/index.ts.
 *
 * Roadmap ref: 6b (Research Assistant)
 *
 * STORAGE SHAPE ONLY — this file defines the shape of a research session,
 * nothing else. No storage/helpers.ts read/write functions, no D1
 * migration, no Dexie table. Unlike the Contract Engine (1b/1c/1f), the
 * Research Assistant roadmap section has no persistence step at all — 6d
 * wires 6b's shape and 6c's generator into a dashboard entry point, but
 * whether/how a session round-trips to storage is not yet a decided
 * question and is deliberately not answered here. Treat ResearchSession
 * as an in-memory shape a caller (initially: React state in 6d) can hold;
 * a future roadmap item can add persistence against this same shape
 * without changing it, the same way 1b's D1 migration was written against
 * ClientPositionProfile after the interface already existed.
 *
 * EXHAUSTION SIGNAL — per the 6a decision: exhaustion is an explicit
 * verdict Supo (the single-prompt generator, 6c) returns on every turn,
 * not a heuristic derived from query count or keyword overlap. See 6a's
 * decision note and pass0.ts / knowledgeTier.ts for the same
 * structured-verdict convention elsewhere in the codebase. `exhausted` and
 * `exhausted_reasoning` therefore live on each ResearchQueryFinding (Supo's
 * per-turn judgment), and `status` on ResearchSession is the caller-facing
 * rollup 6c/6d set once Supo's `exhausted` comes back true. A hard
 * query-count safety valve (in case Supo never signals exhaustion) is a
 * concern for 6c's generator loop, not for this shape — this file has no
 * opinion on what the cap is or where it's enforced.
 */

// ─────────────────────────────────────────────────────────────────────────────
// QUERY / FINDINGS ENTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One turn of the research loop: a single query Supo generated (from the
 * problem statement + prior findings), and what came back. Findings are
 * synthesized text, not raw source dumps — 6c owns exactly what shape that
 * synthesis takes; this interface only commits to it being a string.
 *
 * Ordered, append-only within a session — never mutated after being
 * written, oldest first, same convention as ContractClause.history in
 * contracts/types.ts.
 */
export interface ResearchQueryFinding {
  id: string;

  /** The query Supo generated this turn — derived from the problem statement on turn 1, from the prior entry's findings on every turn after. */
  query: string;

  /** Supo's synthesized findings for this query. Empty string until the turn completes. */
  findings: string;

  /**
   * Supo's explicit judgment, this turn: has enough been gathered to
   * consider the problem statement resolved? Per the 6a decision, this is
   * asked-and-answered by the model on every turn, not inferred by a
   * heuristic. False on every turn except (at most) the last one in a
   * session.
   */
  exhausted: boolean;

  /** One or two sentences — why Supo does or doesn't consider the problem resolved as of this turn. Always present, not just when exhausted is true, so counsel can see the reasoning that kept the session going. */
  exhausted_reasoning: string;

  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rollup status for a session, caller-facing (6d's dashboard entry point
 * reads this to decide what to render/enable):
 *   'active'    — still generating turns; the loop can continue.
 *   'exhausted' — the most recent entry's `exhausted` came back true; the
 *                 loop stops here unless counsel explicitly restarts it.
 *   'abandoned' — counsel stopped the session manually before Supo signalled
 *                 exhaustion (e.g. good enough already, or changing topic).
 *                 Distinct from 'exhausted' so a later read can tell the
 *                 difference between "Supo said done" and "counsel said done".
 */
export type ResearchSessionStatus = 'active' | 'exhausted' | 'abandoned';

/**
 * One research session: a problem statement plus the ordered turns taken
 * to resolve it. `entries` is the ordered {query, findings} list — the
 * whole point of 6b. `problem_statement` is fixed at session start; it is
 * NOT rewritten by later turns (Supo's queries evolve from findings, but
 * the original question counsel asked stays the fixed target the
 * exhaustion judgment is measured against).
 */
export interface ResearchSession {
  id: string;

  /** Counsel's original question — see doc comment above for why this never changes after creation. */
  problem_statement: string;

  /** Ordered, oldest first. Empty until 6c generates the first turn. */
  entries: ResearchQueryFinding[];

  status: ResearchSessionStatus;

  created_at: string;
  updated_at: string;
}
