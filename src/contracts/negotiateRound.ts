/**
 * AFS Legal OS — Contract Engine — Negotiate Mode — Round Flow
 *
 * Roadmap ref: 4b (Contract Engine — Negotiate Mode) — final step of Negotiate Mode.
 *
 * Reads the prior round's clauses, produces this round's positions in
 * response to counterparty input, and reuses 2d/2e/2f for any new/changed
 * clauses only — per the roadmap, exactly as written.
 *
 * HOW "reuses 2d/2e/2f for new/changed clauses only" ACTUALLY WORKS — this
 * is the crux of the module, so it's worth being explicit: 2d
 * (runKnowledgeTierResolution), 2e (runResearchChecklistGeneration), and 2f
 * (runFlaggingPass) were ALREADY built idempotent — each one only processes
 * clauses whose relevant field is still null, and leaves already-tagged
 * clauses untouched (see their own file headers: "Idempotent-ish"). So this
 * module doesn't need any new "only touch changed clauses" logic of its
 * own. It just has to make the true statement be true: when a clause's text
 * changes this round, its knowledge_tier / flag_tier / research_needed are
 * reset to null (Step 3 below) BEFORE calling 2d/2e/2f — those now-null
 * fields are the only ones 2d/2e/2f will find pending, so calling all three
 * unmodified, over the WHOLE register, correctly re-tags only what changed.
 * Unrevised clauses keep their round-1 (or whatever prior round's) tags
 * untouched and are never re-sent to the AI.
 *
 * Flow:
 *   Step 1 — load the current register (the "prior round's clauses").
 *   Step 2 — ONE AI call: given counterparty_input + the current register +
 *            (if available) the Client Position Profile, decide which
 *            clauses need to change THIS round and draft their revised
 *            text. Most clauses in most rounds don't change — the AI is
 *            instructed to return only the clauses it's actually revising,
 *            not the full register.
 *   Step 3 — commit those revisions via 4a's runRoundAdvance() (round_number
 *            + history), then null out knowledge_tier/flag_tier/
 *            research_needed on exactly the clauses that actually advanced.
 *   Step 4 — 2d → 2e → 2f, unmodified, over the whole contract_id — see
 *            above for why this only touches the reset clauses.
 *
 * If the AI decides nothing needs to change this round (e.g. the
 * counterparty accepted everything), Steps 3-4 are skipped entirely — no
 * wasted storage writes or AI calls over an unchanged register.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts / clauseRegister.ts / flaggingPass.ts / reviewAnalysis.ts.
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { loadContractClauses, saveContractClause } from '@/storage/helpers';
import type { ClientPositionProfile, ContractClause } from './types';
import { runRoundAdvance, type ClauseRoundUpdate } from './roundAdvance';
import { runKnowledgeTierResolution } from './knowledgeTier';
import { runResearchChecklistGeneration } from './researchChecklist';
import { runFlaggingPass } from './flaggingPass';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NegotiateRoundInput {
  contract_id: string;

  /** Free text — the counterparty's counter-proposal, redlines, or negotiation notes driving this round. */
  counterparty_input: string;

  /** May be null — negotiate mode is usable without one, same convention as 2a/2c/2f. */
  profile: ClientPositionProfile | null;

  /** Optional — improves prompt context, same convention as 2c/2d/2e. */
  contract_type?: string;
}

export interface NegotiateRoundResult {
  contract_id: string;

  /** Full updated register after this round, in clause_number order. */
  clauses: ContractClause[];

  /** Clause numbers actually advanced this round (empty if the AI proposed no changes). */
  revised_clause_numbers: string[];

  /** Non-null exactly when no Client Position Profile was supplied — same convention as 2f. Null if this round made no changes (2f never ran). */
  missing_profile_warning: string | null;

  ok: boolean;
  /** Set only when ok is false. */
  error?: string;
}

interface RawRevision {
  clause_number:   string;
  new_clause_text: string;
  note:            string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — AI CALL: DECIDE + DRAFT THIS ROUND'S REVISIONS
// ─────────────────────────────────────────────────────────────────────────────

const NEGOTIATE_SYSTEM = `You are Contract Engine Negotiate Mode, generating this round's revised
clause positions in response to the counterparty's input. You receive the
current clause register — every clause already has drafting-ready text
from a prior round — and, if available, counsel's Client Position Profile.

Your job, clause by clause: decide whether THIS ROUND'S counterparty input
actually requires a change to that clause. Most clauses in most rounds do
NOT change. Only return an entry for a clause you are actually revising —
never return a clause just to restate it unchanged, and never "improve" a
clause the counterparty didn't raise.

For each clause you ARE revising:
- new_clause_text is complete, drafting-ready prose for the FULL revised
  clause — not a redline, not a diff, not a summary of the change.
- note is one sentence: what changed and why. This is stored permanently
  on the clause's negotiation history and counsel will read it later to
  remember why a clause moved — be specific (e.g. "Reduced indemnity cap
  from unlimited to 12 months' fees per counterparty's pushback", not
  "Updated per feedback").
- If a Client Position Profile is supplied, respect it exactly as in Draft
  mode: deal_breakers are never conceded, concessions_available may be
  traded if it helps close the round, risk_posture governs how one-sidedly
  you draft, special_instructions are followed exactly.
- Never invent facts not present in the counterparty input or the profile.

Do not wrap the JSON in markdown code fences — return raw JSON only.

Return EXACTLY this shape, nothing else. The "revisions" array may be EMPTY
if nothing in this round's counterparty input warrants any clause change:
{
  "revisions": [
    { "clause_number": string, "new_clause_text": string, "note": string },
    ...
  ]
}`;

function buildNegotiateUserMsg(
  clauses: ContractClause[],
  counterpartyInput: string,
  profile: ClientPositionProfile | null,
  contractType?: string,
): string {
  const lines: string[] = [];
  if (contractType) lines.push(`Contract type: ${contractType}`);

  if (profile) {
    lines.push('');
    lines.push('CLIENT POSITION PROFILE:');
    lines.push(`Client role: ${profile.client_role}`);
    lines.push(`Risk posture: ${profile.risk_posture}`);
    if (profile.priorities.length)           lines.push(`Priorities (ranked): ${profile.priorities.join('; ')}`);
    if (profile.deal_breakers.length)        lines.push(`Deal-breakers: ${profile.deal_breakers.join('; ')}`);
    if (profile.concessions_available.length) lines.push(`Concessions available: ${profile.concessions_available.join('; ')}`);
    if (profile.special_instructions?.trim()) lines.push(`Special instructions: ${profile.special_instructions.trim()}`);
  }

  lines.push('');
  lines.push('CURRENT CLAUSE REGISTER (prior round):');
  for (const c of clauses) {
    lines.push(`[${c.clause_number}] (round ${c.round_number}) ${c.clause_text}`);
  }

  lines.push('');
  lines.push('COUNTERPARTY INPUT THIS ROUND:');
  lines.push(counterpartyInput.trim());

  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. Empty array is valid (zero revisions this round). */
function parseRevisions(raw: string, knownClauseNumbers: Set<string>): RawRevision[] | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const revisions = parsed.revisions;
    if (!Array.isArray(revisions)) return null;

    const out: RawRevision[] = [];
    const seen = new Set<string>();
    for (const r of revisions) {
      const clauseNumber = (r as Record<string, unknown>)?.clause_number;
      const newText       = (r as Record<string, unknown>)?.new_clause_text;
      const note           = (r as Record<string, unknown>)?.note;
      if (typeof clauseNumber !== 'string' || !clauseNumber.trim()) return null;
      if (typeof newText !== 'string' || !newText.trim())             return null;
      if (typeof note !== 'string')                                    return null;
      const trimmedNumber = clauseNumber.trim();
      if (!knownClauseNumbers.has(trimmedNumber)) return null;   // hallucinated clause number
      if (seen.has(trimmedNumber)) return null;                  // duplicate entry for same clause
      seen.add(trimmedNumber);
      out.push({ clause_number: trimmedNumber, new_clause_text: newText.trim(), note: note.trim() });
    }
    return out;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function blankResult(contractId: string, error: string): NegotiateRoundResult {
  return {
    contract_id: contractId,
    clauses:     [],
    revised_clause_numbers: [],
    missing_profile_warning: null,
    ok: false,
    error,
  };
}

/**
 * Runs one Negotiate-mode round: drafts this round's revisions, commits
 * them (4a), and re-tags only the changed clauses via 2d/2e/2f. Never
 * throws — a failed AI call, malformed response, or storage failure
 * degrades to `ok: false` with a user-facing `error` string, same
 * convention as the rest of the Contract Engine.
 */
export async function runNegotiateRound(
  input: NegotiateRoundInput,
): Promise<NegotiateRoundResult> {
  const { contract_id, profile, contract_type } = input;
  const counterpartyInput = input.counterparty_input.trim();

  if (!counterpartyInput) {
    return blankResult(contract_id, 'No counterparty input provided for this round');
  }

  // ── Step 1 — load the prior round's clauses ────────────────────────────────
  let clauses: ContractClause[];
  try {
    clauses = await loadContractClauses(contract_id);
  } catch (e) {
    return blankResult(contract_id, classifyError(e));
  }
  if (clauses.length === 0) {
    return blankResult(contract_id, 'No clauses on file for this contract — run 2c (Draft) or 3d (Review) first');
  }

  // ── Step 2 — AI call: decide + draft this round's revisions ────────────────
  const knownClauseNumbers = new Set(clauses.map(c => c.clause_number));
  let revisions: RawRevision[] | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      NEGOTIATE_SYSTEM,
      userMsg:     buildNegotiateUserMsg(clauses, counterpartyInput, profile, contract_type),
      maxTokens:   4000,
      skipLibrary: true,   // reasoning about clause vs. counterparty input, not a library query — see 2f/2d for the same choice
    }));
    revisions = parseRevisions(text, knownClauseNumbers);
  } catch (e) {
    return blankResult(contract_id, classifyError(e));
  }

  if (!revisions) {
    return blankResult(contract_id, 'Could not parse this round\u2019s revisions from AI response');
  }

  if (revisions.length === 0) {
    // Nothing to change this round — return the register as-is, no writes.
    return {
      contract_id,
      clauses,
      revised_clause_numbers: [],
      missing_profile_warning: null,
      ok: true,
    };
  }

  // ── Step 3a — commit revisions via 4a (round_number + history) ─────────────
  const updates: ClauseRoundUpdate[] = revisions.map(r => ({
    clause_number:   r.clause_number,
    new_clause_text: r.new_clause_text,
    note:            r.note,
  }));

  const advanceResult = await runRoundAdvance(contract_id, updates);
  if (!advanceResult.ok) {
    return blankResult(contract_id, advanceResult.error || 'Round advance (4a) failed');
  }

  const advancedNumbers = new Set(
    advanceResult.outcomes.filter(o => o.changed).map(o => o.clause_number),
  );

  if (advancedNumbers.size === 0) {
    // AI proposed revisions, but every one turned out identical to the
    // existing text (4a's no-op guard) — nothing actually changed.
    return {
      contract_id,
      clauses: advanceResult.clauses,
      revised_clause_numbers: [],
      missing_profile_warning: null,
      ok: true,
    };
  }

  // ── Step 3b — reset tier fields on exactly the advanced clauses ────────────
  // This is what makes 2d/2e/2f below "touch only new/changed clauses" —
  // see file header. Clauses not in advancedNumbers keep their prior tags
  // and are left completely alone.
  const toReset = advanceResult.clauses.filter(c => advancedNumbers.has(c.clause_number));
  const now = new Date().toISOString();
  const resetClauses: ContractClause[] = toReset.map((c) => {
    const { research_needed, ...rest } = c;
    return { ...rest, knowledge_tier: null, flag_tier: null, updated_at: now };
  });

  const resetSaveResults = await Promise.all(resetClauses.map(saveContractClause));
  const failedResetCount = resetSaveResults.filter(ok => !ok).length;
  if (failedResetCount === resetClauses.length) {
    return blankResult(contract_id, 'Advanced clause rounds but failed to reset tiers for re-tagging — check storage');
  }

  // ── Step 4 — 2d → 2e → 2f, unmodified, over the whole contract ─────────────
  const tierResult = await runKnowledgeTierResolution({ contract_id, contract_type });
  if (!tierResult.ok) {
    return blankResult(contract_id, tierResult.error || 'Knowledge-tier resolution (2d) failed');
  }

  const checklistResult = await runResearchChecklistGeneration(contract_id, contract_type);
  if (!checklistResult.ok) {
    return blankResult(contract_id, checklistResult.error || 'Research-needed checklist generation (2e) failed');
  }

  const flaggingResult = await runFlaggingPass(contract_id, profile);
  if (!flaggingResult.ok) {
    return blankResult(contract_id, flaggingResult.error || 'Flagging pass (2f) failed');
  }

  return {
    contract_id,
    clauses: flaggingResult.clauses,
    revised_clause_numbers: Array.from(advancedNumbers),
    missing_profile_warning: flaggingResult.missing_profile_warning,
    ok: true,
    ...(failedResetCount > 0
      ? { error: `${failedResetCount} of ${resetClauses.length} advanced clauses failed to reset for re-tagging` }
      : {}),
  };
}
