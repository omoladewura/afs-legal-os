/**
 * AFS Legal OS — Contract Engine — Flagging Pass
 *
 * Roadmap ref: 2f (Contract Engine — Draft Mode) — final step of Draft Mode.
 *
 * Applies FlagTier to every clause on file for a contract:
 *   STATUTORY           — mandatory, statute leaves no room to vary.
 *   GENERAL_PRUDENCE     — standard practice, could be varied on instruction.
 *   CLIENT_INSTRUCTION   — driven directly by a Client Position Profile field
 *                         (risk_posture, priorities, deal_breakers,
 *                         concessions_available, special_instructions).
 *
 * FlagTier is distinct from KnowledgeTier (2d): KnowledgeTier says how a
 * clause's *content* was sourced (library / general knowledge / research
 * needed); FlagTier says how *binding* it is on the client relative to
 * their stated position — see the doc comment on FlagTier in types.ts.
 *
 * Also produces the missing-profile warning banner: when no Client
 * Position Profile (2a) is on file for the contract, CLIENT_INSTRUCTION
 * is not a reachable tier (there is no profile to be driven by) and the
 * Draft output should carry a visible warning saying so. This is a
 * contract-level banner, not a per-clause field, so it's returned
 * alongside the clause list rather than written onto any ContractClause row.
 *
 * Two-step flow per clause, same separation-of-concerns pattern as 2d:
 *   Step 1 — deterministic, no AI call. Any clause already tagged
 *            knowledge_tier === 'STATUTORY_LIBRARY' is flagged STATUTORY
 *            immediately: 2d already established it's grounded in a
 *            library authority, and a library-grounded statutory clause
 *            leaves no room to vary regardless of client instruction.
 *   Step 2 — for the remaining clauses:
 *              - if no profile is on file, there is nothing for
 *                CLIENT_INSTRUCTION to be driven by, so every remaining
 *                clause is flagged GENERAL_PRUDENCE deterministically —
 *                no AI call needed, and the missing-profile banner
 *                explains why CLIENT_INSTRUCTION never appears.
 *              - if a profile IS on file, ONE batched AI call decides
 *                GENERAL_PRUDENCE vs CLIENT_INSTRUCTION for all remaining
 *                clauses together, same batching-for-efficiency reasoning
 *                as 2d's Step 2 / 2e.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts / clauseRegister.ts / knowledgeTier.ts / researchChecklist.ts.
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { loadContractClauses, saveContractClause } from '@/storage/helpers';
import type { ClientPositionProfile, ContractClause, FlagTier } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const MISSING_PROFILE_WARNING =
  'No Client Position Profile is on file for this contract. Clauses below ' +
  'reflect standard drafting judgment only — risk posture, priorities, ' +
  'deal-breakers, and concessions have not been incorporated, so no clause ' +
  'can be flagged [CLIENT INSTRUCTION]. Complete the Client Position ' +
  'Profile (Step 2a) and re-run the flagging pass to enable client-specific ' +
  'flagging.';

export interface FlaggingPassResult {
  contract_id: string;
  clauses:     ContractClause[];    // full updated register, all clauses, in clause_number order
  tagged:      number;              // count of clauses newly flagged this run
  /** Non-null exactly when no Client Position Profile is on file. Render as a banner in Draft output. */
  missing_profile_warning: string | null;
  ok:          boolean;
  /** Set only when ok is false. */
  error?:      string;
}

interface ClientInstructionVerdict {
  clause_number: string;
  tier:          'GENERAL_PRUDENCE' | 'CLIENT_INSTRUCTION';
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 (profile present) — BATCH CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

const FLAG_SYSTEM = `You are Contract Engine Draft Mode, Flagging Pass — Step 2.
You receive a Client Position Profile and a list of contract clauses that
are NOT statute-grounded (that determination was already made upstream —
do not second-guess it). For each clause, decide whether it is:

  "CLIENT_INSTRUCTION" — this clause's content is driven directly by a
    specific field of the Client Position Profile: it enacts a stated
    priority, protects a deal-breaker, reflects the stated risk_posture in
    how one-sidedly it's drafted, offers or withholds a listed concession,
    or follows a special_instruction. If you can point to the specific
    profile field that shaped this clause's wording, it belongs here.

  "GENERAL_PRUDENCE" — standard drafting practice that would appear in this
    clause roughly the same way regardless of this particular client's
    stated position — boilerplate, conventional risk allocation, or terms
    that follow from the deal facts rather than from anything in the
    profile.

Do not draft or rewrite any clause text. Do not explain your reasoning
outside the JSON. Do not wrap the JSON in markdown code fences — return raw
JSON only.

Return EXACTLY this shape, nothing else, one verdict per input clause,
same clause_number values, any order:
{
  "verdicts": [
    { "clause_number": string, "tier": "GENERAL_PRUDENCE" | "CLIENT_INSTRUCTION" },
    ...
  ]
}`;

function buildFlagUserMsg(clauses: ContractClause[], profile: ClientPositionProfile): string {
  const lines: string[] = [];
  lines.push('CLIENT POSITION PROFILE:');
  lines.push(`Client role: ${profile.client_role}`);
  lines.push(`Risk posture: ${profile.risk_posture}`);
  if (profile.priorities.length)              lines.push(`Priorities (ranked): ${profile.priorities.join('; ')}`);
  if (profile.deal_breakers.length)            lines.push(`Deal-breakers: ${profile.deal_breakers.join('; ')}`);
  if (profile.concessions_available.length)    lines.push(`Concessions available: ${profile.concessions_available.join('; ')}`);
  if (profile.special_instructions?.trim())    lines.push(`Special instructions: ${profile.special_instructions.trim()}`);

  lines.push('');
  lines.push('CLAUSES (none are statute-grounded — classify GENERAL_PRUDENCE vs CLIENT_INSTRUCTION):');
  for (const c of clauses) {
    lines.push(`[${c.clause_number}] ${c.clause_text}`);
  }
  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseVerdicts(raw: string): ClientInstructionVerdict[] | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const verdicts = parsed.verdicts;
    if (!Array.isArray(verdicts) || verdicts.length === 0) return null;

    const out: ClientInstructionVerdict[] = [];
    for (const v of verdicts) {
      const clauseNumber = (v as Record<string, unknown>)?.clause_number;
      const tier         = (v as Record<string, unknown>)?.tier;
      if (typeof clauseNumber !== 'string' || !clauseNumber.trim()) return null;
      if (tier !== 'GENERAL_PRUDENCE' && tier !== 'CLIENT_INSTRUCTION') return null;
      out.push({ clause_number: clauseNumber.trim(), tier });
    }
    return out;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function blankResult(contractId: string, error: string): FlaggingPassResult {
  return {
    contract_id: contractId,
    clauses:     [],
    tagged:      0,
    missing_profile_warning: null,
    ok:          false,
    error,
  };
}

/**
 * Runs the Flagging Pass over every clause currently on file for
 * `contract_id`, using `profile` (nullable — pass the 2a record, or null
 * if none exists yet). Never throws — a failed AI call, malformed
 * response, or storage failure degrades to `ok: false` with a user-facing
 * `error` string, same convention as the rest of the Contract Engine.
 *
 * Idempotent-ish, same convention as 2d/2e: clauses that already carry a
 * non-null flag_tier are left untouched and re-returned as-is.
 */
export async function runFlaggingPass(
  contract_id: string,
  profile: ClientPositionProfile | null,
): Promise<FlaggingPassResult> {
  let clauses: ContractClause[];
  try {
    clauses = await loadContractClauses(contract_id);
  } catch (e) {
    return blankResult(contract_id, classifyError(e));
  }

  if (clauses.length === 0) {
    return blankResult(contract_id, 'No clauses on file for this contract — run 2c first');
  }
  if (clauses.every(c => c.knowledge_tier == null)) {
    return blankResult(contract_id, 'No clauses have a knowledge tier yet — run 2d first');
  }

  const missingProfileWarning = profile ? null : MISSING_PROFILE_WARNING;

  const pending = clauses.filter(c => c.flag_tier == null);
  if (pending.length === 0) {
    return { contract_id, clauses, tagged: 0, missing_profile_warning: missingProfileWarning, ok: true };
  }

  // ── Step 1 — deterministic STATUTORY tag from 2d's knowledge_tier ─────────
  const flagged: ContractClause[] = [];
  const remaining: ContractClause[] = [];

  for (const clause of pending) {
    if (clause.knowledge_tier === 'STATUTORY_LIBRARY') {
      flagged.push({ ...clause, flag_tier: 'STATUTORY' as FlagTier });
    } else {
      remaining.push(clause);
    }
  }

  // ── Step 2 — remaining clauses ──────────────────────────────────────────
  if (remaining.length > 0) {
    if (!profile) {
      // No profile on file — nothing for CLIENT_INSTRUCTION to be driven
      // by. Deterministic, no AI call needed.
      for (const clause of remaining) {
        flagged.push({ ...clause, flag_tier: 'GENERAL_PRUDENCE' as FlagTier });
      }
    } else {
      let verdicts: ClientInstructionVerdict[] | null;
      try {
        const { text } = await withRetry(() => callClaude({
          system:      FLAG_SYSTEM,
          userMsg:     buildFlagUserMsg(remaining, profile),
          maxTokens:   2000,
          skipLibrary: true,   // reasoning about clause vs. profile, not a library query
        }));
        verdicts = parseVerdicts(text);
      } catch (e) {
        return blankResult(contract_id, classifyError(e));
      }

      if (!verdicts) {
        return blankResult(contract_id, 'Could not parse flag-tier verdicts from AI response');
      }

      const verdictByNumber = new Map(verdicts.map(v => [v.clause_number, v.tier]));
      for (const clause of remaining) {
        const tier = verdictByNumber.get(clause.clause_number);
        if (!tier) {
          return blankResult(
            contract_id,
            `AI response was missing a verdict for clause ${clause.clause_number}`,
          );
        }
        flagged.push({ ...clause, flag_tier: tier as FlagTier });
      }
    }
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const toSave = flagged.map(c => ({ ...c, updated_at: now }));
  const saveResults = await Promise.all(toSave.map(saveContractClause));
  const failedCount = saveResults.filter(ok => !ok).length;
  if (failedCount === toSave.length) {
    return blankResult(contract_id, 'Resolved flag tiers but failed to save them — check storage');
  }

  const savedById = new Map(toSave.map(c => [c.id, c]));
  const finalClauses = clauses
    .map(c => savedById.get(c.id) ?? c)
    .sort((a, b) => a.clause_number.localeCompare(b.clause_number, undefined, { numeric: true }));

  return {
    contract_id,
    clauses: finalClauses,
    tagged:  toSave.length,
    missing_profile_warning: missingProfileWarning,
    ok:      true,
    ...(failedCount > 0
      ? { error: `${failedCount} of ${toSave.length} newly-flagged clauses failed to save locally` }
      : {}),
  };
}
