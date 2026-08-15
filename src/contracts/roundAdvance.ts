/**
 * AFS Legal OS — Contract Engine — Negotiate Mode — Round-Tracking
 *
 * Roadmap ref: 4a (Contract Engine — Negotiate Mode)
 *
 * Increments `round_number` and appends to `history` on `contract_clauses`
 * rows. The schema for this already exists from 1c — `ContractClause.round_number`
 * and `ContractClause.history` were added at foundation time specifically so
 * 4a would be a write against an existing shape, not a migration. See the
 * doc comment on ContractClause in types.ts.
 *
 * Round-tracking is CLAUSE-SCOPED, not contract-scoped: each clause carries
 * its own round_number and history, so different clauses in the same
 * contract can sit at different rounds (a clause both sides agreed on in
 * round 1 has no reason to advance just because a contested clause reached
 * round 3). This module never bumps a clause that hasn't actually changed —
 * see `advanceClauseRound()` below — so accepted/settled clauses don't
 * accumulate identical, noise history entries every time a round turns over.
 *
 * Deliberately out of scope here, per the roadmap:
 *   - generating the next round's positions from the prior round     → 4b
 *   - re-running 2d/2e/2f for any new/changed clauses                → 4b
 * This module only records a round change once new clause text exists —
 * it does not decide what that new text should be.
 *
 * Exported as plain functions — `advanceClauseRound()` is synchronous, pure,
 * no AI, no storage (same "deterministic core" reasoning as noSkimVerification.ts:
 * versioning history is bookkeeping, not something that should ever need a
 * network call or be able to fail unpredictably). `runRoundAdvance()` is the
 * async integration wrapper that loads/persists against real storage — same
 * two-layer convention as researchChecklist.ts / clauseRegister.ts.
 */

import { loadContractClauses, saveContractClause } from '@/storage/helpers';
import { classifyError } from '@/services/api';
import type { ClauseHistoryEntry, ContractClause } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE CORE — deterministic, no AI, no storage
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvanceClauseRoundOptions {
  /** Optional — what changed and why, stored on the new history entry. */
  note?: string;
  /**
   * When true, append a new round even if `newClauseText` is identical to
   * the clause's current text (e.g. explicitly re-affirming a position in
   * a new round rather than proposing new text). Default false — identical
   * text is treated as "nothing changed this round," not a new round.
   */
  force?: boolean;
}

export interface AdvanceClauseRoundResult {
  clause:  ContractClause;   // the advanced clause if changed, or the input clause unchanged otherwise
  changed: boolean;          // true iff round_number was bumped and a history entry appended
}

/**
 * Given a clause and its proposed next-round text, either advances it
 * (round_number + 1, new ClauseHistoryEntry appended, clause_text updated)
 * or leaves it untouched if the text is unchanged and `force` wasn't set.
 * Pure and synchronous — does not read or write storage; `runRoundAdvance()`
 * below is the storage-backed wrapper most callers want.
 */
export function advanceClauseRound(
  clause: ContractClause,
  newClauseText: string,
  opts: AdvanceClauseRoundOptions = {},
): AdvanceClauseRoundResult {
  const trimmedNew = newClauseText.trim();
  const unchanged = trimmedNew === clause.clause_text.trim();

  if (unchanged && !opts.force) {
    return { clause, changed: false };
  }

  const now = new Date().toISOString();
  const nextRound = clause.round_number + 1;

  const entry: ClauseHistoryEntry = {
    round_number: nextRound,
    clause_text:  trimmedNew,
    changed_at:   now,
    changed_by:   'negotiate',
    ...(opts.note?.trim() ? { note: opts.note.trim() } : {}),
  };

  const advanced: ContractClause = {
    ...clause,
    clause_text:  trimmedNew,
    round_number: nextRound,
    history:      [...clause.history, entry],
    updated_at:   now,
  };

  return { clause: advanced, changed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION WRAPPER — loads clauses from storage, advances, persists
// ─────────────────────────────────────────────────────────────────────────────

export interface ClauseRoundUpdate {
  clause_number:   string;
  new_clause_text: string;
  note?:           string;
  /** Per-update override of the module default — see AdvanceClauseRoundOptions.force. */
  force?:          boolean;
}

export interface RoundAdvanceOutcome {
  clause_number:    string;
  changed:          boolean;
  round_number:     number;   // the clause's round_number after this call (unchanged if changed is false)
}

export interface RoundAdvanceResult {
  contract_id: string;
  clauses:     ContractClause[];        // full updated register, all clauses, in clause_number order
  outcomes:    RoundAdvanceOutcome[];   // one per requested update, in request order
  not_found:   string[];                // clause_numbers in the update list not on file for this contract
  advanced:    number;                  // count of clauses actually advanced (changed: true)
  ok:          boolean;
  /** Set only when ok is false. */
  error?:      string;
}

function blankResult(contractId: string, error: string): RoundAdvanceResult {
  return {
    contract_id: contractId,
    clauses:     [],
    outcomes:    [],
    not_found:   [],
    advanced:    0,
    ok:          false,
    error,
  };
}

/**
 * Loads every clause on file for `contract_id`, applies `advanceClauseRound()`
 * for each requested update, persists whichever clauses actually changed,
 * and returns the full updated register. Never throws — a storage failure
 * degrades to `ok: false` with a user-facing `error` string, same convention
 * as the rest of the Contract Engine.
 *
 * A `clause_number` in `updates` that doesn't exist on this contract is
 * reported in `not_found` rather than failing the whole call — 4b (which
 * calls this per new/changed clause after generating next-round positions)
 * shouldn't have one stale clause_number abort an otherwise-valid batch.
 */
export async function runRoundAdvance(
  contract_id: string,
  updates: ClauseRoundUpdate[],
): Promise<RoundAdvanceResult> {
  if (updates.length === 0) {
    return blankResult(contract_id, 'No round updates provided');
  }

  let clauses: ContractClause[];
  try {
    clauses = await loadContractClauses(contract_id);
  } catch (e) {
    return blankResult(contract_id, classifyError(e));
  }

  if (clauses.length === 0) {
    return blankResult(contract_id, 'No clauses on file for this contract — run 2c (Draft) or 3d (Review) first');
  }

  const byNumber = new Map(clauses.map(c => [c.clause_number, c]));
  const outcomes: RoundAdvanceOutcome[] = [];
  const not_found: string[] = [];
  const toSave: ContractClause[] = [];
  const advancedById = new Map<string, ContractClause>();

  for (const update of updates) {
    const existing = byNumber.get(update.clause_number);
    if (!existing) {
      not_found.push(update.clause_number);
      continue;
    }

    // Apply on top of any earlier advance already made to this clause
    // within the same batch, so a caller can't silently overwrite an
    // in-batch change by listing the same clause_number twice.
    const base = advancedById.get(existing.id) ?? existing;
    const { clause: result, changed } = advanceClauseRound(base, update.new_clause_text, {
      note:  update.note,
      force: update.force,
    });

    if (changed) {
      advancedById.set(existing.id, result);
      toSave.push(result);
    }

    outcomes.push({
      clause_number: update.clause_number,
      changed,
      round_number:  result.round_number,
    });
  }

  if (toSave.length === 0) {
    return {
      contract_id,
      clauses:   clauses.sort((a, b) => a.clause_number.localeCompare(b.clause_number, undefined, { numeric: true })),
      outcomes,
      not_found,
      advanced: 0,
      ok: true,
    };
  }

  const saveResults = await Promise.all(toSave.map(saveContractClause));
  const failedCount = saveResults.filter(ok => !ok).length;
  if (failedCount === toSave.length) {
    return blankResult(contract_id, 'Advanced clause rounds but failed to save them — check storage');
  }

  const savedById = new Map(toSave.map(c => [c.id, c]));
  const finalClauses = clauses
    .map(c => savedById.get(c.id) ?? c)
    .sort((a, b) => a.clause_number.localeCompare(b.clause_number, undefined, { numeric: true }));

  return {
    contract_id,
    clauses:  finalClauses,
    outcomes,
    not_found,
    advanced: toSave.length,
    ok:       true,
    ...(failedCount > 0
      ? { error: `${failedCount} of ${toSave.length} advanced clauses failed to save locally` }
      : {}),
  };
}
