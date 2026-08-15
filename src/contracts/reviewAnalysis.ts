/**
 * AFS Legal OS — Contract Engine — Review Mode — Analysis Routing
 *
 * Roadmap ref: 3d (Contract Engine — Review Mode) — final step of Review Mode.
 *
 * Wires Review mode into the Draft-mode engines it was always meant to
 * reuse: 2d (Knowledge-Tier Resolution), 2e (Research-Needed Checklist),
 * 2f (Flagging Pass). Per the roadmap, this is deliberately NO NEW LOGIC —
 * runKnowledgeTierResolution(), runResearchChecklistGeneration(), and
 * runFlaggingPass() are called exactly as Draft mode calls them, completely
 * unmodified. What this module adds is the glue those three functions need
 * to have anything to run on:
 *
 *   1. Turn the 3a/3b ingestion result (one long string of contract text)
 *      into `contract_clauses` rows — 2d/2e/2f, like every other Contract
 *      Engine step, operate on ContractClause[] loaded from storage by
 *      contract_id, not on raw text. Uses 3c's extractLeafClauses() as the
 *      splitter, so the exact same clause boundaries used for the no-skim
 *      check are what gets persisted and analyzed — one extraction, not two
 *      independent ones that could disagree with each other.
 *   2. Run 2d → 2e → 2f in sequence over those rows.
 *   3. Run 3c's verifyNoSkim() as the final step, comparing the clauses
 *      extracted from the source document against the clauses that made it
 *      through the full 2d/2e/2f pipeline — confirming the routing itself
 *      didn't drop anything along the way, independent of whether the
 *      document was skimmed at ingestion.
 *
 * OUT OF SCOPE, deliberately — Review mode has no Pass 0 (2b) equivalent
 * anywhere in the roadmap. Draft mode derives jurisdiction from facts
 * counsel types; Review mode has an already-drafted document instead of
 * "facts," and nothing in the roadmap through 3d assigns a step to
 * detecting jurisdiction from that document. So `jurisdiction` is a
 * required caller-supplied input here, not something this module infers.
 * If Review mode later needs its own jurisdiction detection, that's a new
 * roadmap item, not silently folded into 3d.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts / clauseRegister.ts / knowledgeTier.ts /
 * researchChecklist.ts / flaggingPass.ts.
 */

import { cid, saveContractClause, deleteContractClausesForContract } from '@/storage/helpers';
import { classifyError } from '@/services/api';
import type { ClientPositionProfile, ContractClause } from './types';
import type { DocumentIngestResult } from './reviewIngest';
import { extractLeafClauses, verifyNoSkim, type NoSkimVerificationResult } from './noSkimVerification';
import { runKnowledgeTierResolution } from './knowledgeTier';
import { runResearchChecklistGeneration } from './researchChecklist';
import { runFlaggingPass } from './flaggingPass';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewAnalysisInput {
  contract_id: string;

  /** 3a/3b output — must be ok: true with non-empty text. */
  ingestResult: DocumentIngestResult;

  /**
   * Whole-contract, per the 1a decision — same shape as elsewhere:
   * "{COUNTRY}" or "{COUNTRY}-{STATE}", e.g. "NG" or "NG-LA". Required —
   * see file header for why Review mode doesn't infer this itself.
   */
  jurisdiction: string;

  /** Optional — passed straight through to 2d/2e for prompt context. */
  contract_type?: string;

  /** Optional — passed straight through to 2f. Null/omitted → 2f's missing-profile warning applies, same as Draft mode. */
  profile?: ClientPositionProfile | null;

  /**
   * When true (default), any existing contract_clauses rows for this
   * contract_id are deleted before the ingested document's clauses are
   * written — a fresh Review-mode run replaces the prior register, same
   * convention as 2c's `replaceExisting`.
   */
  replaceExisting?: boolean;
}

export interface ReviewAnalysisResult {
  contract_id: string;

  /** Final register after 2d → 2e → 2f, in clause_number order. */
  clauses: ContractClause[];

  /** 3c's check comparing the source document's clauses against what survived the full pipeline. */
  no_skim: NoSkimVerificationResult;

  /** Non-null exactly when no Client Position Profile was supplied — same convention as 2f. */
  missing_profile_warning: string | null;

  ok: boolean;
  /** Set only when ok is false. */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function blankResult(contractId: string, error: string): ReviewAnalysisResult {
  return {
    contract_id: contractId,
    clauses:     [],
    no_skim: {
      contract_id: contractId,
      clause_count_in:  0,
      clause_count_out: 0,
      missing_clause_numbers: [],
      extra_clause_numbers:   [],
      passed:  false,
      warning: null,
    },
    missing_profile_warning: null,
    ok: false,
    error,
  };
}

/**
 * Runs full Review-mode analysis for an ingested document: splits it into
 * clauses (3c), persists them, routes them through 2d → 2e → 2f exactly as
 * Draft mode does, then runs the no-skim check against the final result.
 * Never throws — a bad ingest result, a failed sub-step, or a storage
 * failure degrades to `ok: false` with a user-facing `error` string, same
 * convention as the rest of the Contract Engine.
 *
 * Each of 2d/2e/2f is a hard precondition for the next: if any one comes
 * back `ok: false`, this stops immediately and surfaces that step's error
 * rather than continuing with a partially-tagged register.
 */
export async function runReviewAnalysis(
  input: ReviewAnalysisInput,
): Promise<ReviewAnalysisResult> {
  const { contract_id, ingestResult, contract_type, profile } = input;
  const jurisdiction = input.jurisdiction?.trim();

  if (!ingestResult.ok || !ingestResult.text.trim()) {
    return blankResult(
      contract_id,
      ingestResult.error || 'Ingested document has no text to analyze — run 3a/3b first',
    );
  }
  if (!jurisdiction) {
    return blankResult(contract_id, 'Jurisdiction is required for Review mode analysis');
  }

  // ── Step 1 — split into leaf clauses (3c's extractor, shared with the
  //             final no-skim check below) and persist as contract_clauses ──
  const leaves = extractLeafClauses(ingestResult.text);
  if (leaves.length === 0) {
    return blankResult(
      contract_id,
      'Could not detect any numbered clauses in the ingested document — check the source formatting',
    );
  }

  const replaceExisting = input.replaceExisting !== false;
  if (replaceExisting) {
    await deleteContractClausesForContract(contract_id);
  }

  const now = new Date().toISOString();
  const clauseRows: ContractClause[] = leaves.map((leaf) => ({
    id:              cid(),
    contract_id,
    clause_number:   leaf.clause_number,
    clause_text:     leaf.clause_text,
    jurisdiction,
    knowledge_tier:  null,
    flag_tier:       null,
    round_number:    1,
    history: [{
      round_number: 1,
      clause_text:  leaf.clause_text,
      changed_at:   now,
      changed_by:   'review',
    }],
    created_at: now,
    updated_at: now,
  }));

  let saveResults: boolean[];
  try {
    saveResults = await Promise.all(clauseRows.map(saveContractClause));
  } catch (e) {
    return blankResult(contract_id, classifyError(e));
  }
  const failedSaveCount = saveResults.filter(ok => !ok).length;
  if (failedSaveCount === clauseRows.length) {
    return blankResult(contract_id, 'Extracted clauses from the document but failed to save them — check storage');
  }

  // ── Step 2 — route through 2d → 2e → 2f, unmodified ────────────────────────
  const tierResult = await runKnowledgeTierResolution({ contract_id, contract_type });
  if (!tierResult.ok) {
    return blankResult(contract_id, tierResult.error || 'Knowledge-tier resolution (2d) failed');
  }

  const checklistResult = await runResearchChecklistGeneration(contract_id, contract_type);
  if (!checklistResult.ok) {
    return blankResult(contract_id, checklistResult.error || 'Research-needed checklist generation (2e) failed');
  }

  const flaggingResult = await runFlaggingPass(contract_id, profile ?? null);
  if (!flaggingResult.ok) {
    return blankResult(contract_id, flaggingResult.error || 'Flagging pass (2f) failed');
  }

  // ── Step 3 — no-skim check: source document clauses vs. what survived
  //             the full 2d/2e/2f pipeline ──────────────────────────────────
  const noSkim = verifyNoSkim({
    contract_id,
    clauses_in:             leaves,
    clauses_addressed_out:  flaggingResult.clauses.map(c => c.clause_number),
  });

  return {
    contract_id,
    clauses: flaggingResult.clauses,
    no_skim: noSkim,
    missing_profile_warning: flaggingResult.missing_profile_warning,
    ok: true,
    ...(failedSaveCount > 0
      ? { error: `${failedSaveCount} of ${clauseRows.length} extracted clauses failed to save locally` }
      : {}),
  };
}
