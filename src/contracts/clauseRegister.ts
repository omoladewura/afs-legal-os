/**
 * AFS Legal OS — Contract Engine — Clause Register Generation
 *
 * Roadmap ref: 2c (Contract Engine — Draft Mode)
 *
 * Given facts + the Client Position Profile (2a) + the Pass 0 result (2b),
 * generates the initial clause register: an ordered list of
 * { clause_number, clause_text } pairs, persisted as `contract_clauses`
 * rows via the 1f dual-write helpers.
 *
 * Deliberately out of scope here, per the roadmap:
 *   - knowledge_tier tagging          → 2d
 *   - [RESEARCH NEEDED] checklist     → 2e
 *   - flag_tier (STATUTORY / GENERAL_PRUDENCE / CLIENT_INSTRUCTION)
 *                                     → 2f
 * Every row this module writes leaves `knowledge_tier` and `flag_tier` as
 * `null` — later steps read rows back out, tag them, and call
 * saveContractClause() again per-clause. This module never sets those
 * fields to anything other than null.
 *
 * Library/RAG is deliberately NOT queried again here. Pass 0 already ran
 * the governing-law library check (2b); its summary is passed into the
 * drafting prompt as context. Calling `skipLibrary: true` on this call
 * keeps clause generation itself from being reshaped by whatever the
 * library happens to return — the same reasoning 2b documents for keeping
 * classification separate from the library step. Per-clause library
 * grounding is 2d's job, not this one's.
 *
 * Exported as a plain async function — no React/hook dependency — same
 * convention as pass0.ts, callable from a form handler, a test, or a
 * future batch job identically.
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { cid, saveContractClause, deleteContractClausesForContract } from '@/storage/helpers';
import type { ClientPositionProfile, ContractClause } from './types';
import type { Pass0Result } from './pass0';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ClauseRegisterInput {
  contract_id: string;
  facts:       string;

  /** May be null — 2a is optional; a missing profile just means less steering context. */
  profile: ClientPositionProfile | null;

  /** Must be a successful (ok: true) Pass 0 result — see runClauseRegisterGeneration guard below. */
  pass0: Pass0Result;

  /**
   * When true (default), any existing contract_clauses rows for this
   * contract_id are deleted before the new register is written — a fresh
   * Draft-mode run replaces the prior register rather than appending to it.
   * Pass false for a caller that wants to append instead (not used by
   * Draft mode today, but kept as an explicit opt-out rather than a
   * hidden always-on behaviour).
   */
  replaceExisting?: boolean;
}

export interface ClauseRegisterResult {
  contract_id: string;
  clauses:     ContractClause[];
  ok:          boolean;
  /** Set only when ok is false. */
  error?:      string;
}

interface RawClause {
  clause_number: string;
  clause_text:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const CLAUSE_REGISTER_SYSTEM = `You are Contract Engine Draft Mode, generating the initial clause register
for a contract. You receive the confirmed contract type, jurisdiction, the
facts of the deal, and (if available) counsel's Client Position Profile.
Your job is to produce a complete, ordered set of clauses for this
contract — clause text only. Do not add commentary, citations, or
knowledge-tier labels of any kind — that tagging is done by a later pass,
not by you. Do not wrap the JSON in markdown code fences — return raw JSON
only.

Return EXACTLY this shape, nothing else:
{
  "clauses": [
    { "clause_number": string, "clause_text": string },
    ...
  ]
}

Rules:
- clause_number follows standard legal drafting numbering (e.g. "1", "2",
  "2.1", "2.2", "3") in document order — the array order IS the document
  order, so sort it correctly the first time.
- Cover the full contract: recitals/definitions through boilerplate
  (governing law, notices, entire agreement, counterparts) as appropriate
  to the contract type — not just the commercially negotiated terms.
- clause_text is complete, drafting-ready prose for that clause, not a
  placeholder or a summary of what the clause should say.
- If a Client Position Profile is supplied, reflect its risk_posture,
  priorities, deal_breakers, and concessions_available in how each
  relevant clause is drafted (e.g. an aggressive risk_posture drafts
  indemnities and liability caps more one-sidedly in the client's favour;
  deal_breakers must be protected outright, never left negotiable).
- If special_instructions are supplied, follow them exactly.
- Never invent facts that are not in the input — where a detail is
  missing, draft the clause with a clearly bracketed placeholder
  (e.g. "[NOTICE ADDRESS]") rather than inventing one.
- Write every clause for the stated candidate_jurisdiction's legal
  conventions and terminology.`;

function buildUserMsg(input: ClauseRegisterInput): string {
  const { facts, profile, pass0 } = input;
  const lines: string[] = [];

  lines.push(`Contract type: ${pass0.contract_type}`);
  lines.push(`Candidate jurisdiction: ${pass0.candidate_jurisdiction} (confidence: ${pass0.jurisdiction_confidence})`);
  if (pass0.governing_law_library_hit && pass0.governing_law_summary) {
    lines.push(`Governing law reference on file: ${pass0.governing_law_summary}`);
  }

  if (profile) {
    lines.push('');
    lines.push('CLIENT POSITION PROFILE:');
    lines.push(`Client role: ${profile.client_role}`);
    lines.push(`Risk posture: ${profile.risk_posture}`);
    if (profile.priorities.length)              lines.push(`Priorities (ranked): ${profile.priorities.join('; ')}`);
    if (profile.deal_breakers.length)            lines.push(`Deal-breakers: ${profile.deal_breakers.join('; ')}`);
    if (profile.concessions_available.length)    lines.push(`Concessions available: ${profile.concessions_available.join('; ')}`);
    if (profile.prior_relationship?.trim())      lines.push(`Prior relationship with counterparty: ${profile.prior_relationship.trim()}`);
    if (profile.commercial_context?.trim())      lines.push(`Commercial context: ${profile.commercial_context.trim()}`);
    if (profile.special_instructions?.trim())    lines.push(`Special instructions: ${profile.special_instructions.trim()}`);
  }

  lines.push('');
  lines.push('FACTS:');
  lines.push(facts.trim());

  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseClauseRegister(raw: string): RawClause[] | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const clauses = parsed.clauses;

    if (!Array.isArray(clauses) || clauses.length === 0) return null;

    const out: RawClause[] = [];
    for (const c of clauses) {
      const clauseNumber = (c as Record<string, unknown>)?.clause_number;
      const clauseText   = (c as Record<string, unknown>)?.clause_text;
      if (typeof clauseNumber !== 'string' || !clauseNumber.trim()) return null;
      if (typeof clauseText !== 'string' || !clauseText.trim())     return null;
      out.push({ clause_number: clauseNumber.trim(), clause_text: clauseText.trim() });
    }
    return out;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function blankResult(contractId: string, error: string): ClauseRegisterResult {
  return {
    contract_id: contractId,
    clauses:     [],
    ok:          false,
    error,
  };
}

/**
 * Generates and persists the initial clause register for a contract.
 * Never throws — a failed AI call, a malformed response, or a storage
 * failure degrades to `ok: false` with a user-facing `error` string, same
 * convention as runPass0() / queryLibrary().
 *
 * Requires `input.pass0.ok === true` — Pass 0 must have successfully
 * classified contract type + jurisdiction before drafting starts. This is
 * a hard precondition, not a soft warning, because every clause is written
 * for a specific jurisdiction's conventions.
 */
export async function runClauseRegisterGeneration(
  input: ClauseRegisterInput,
): Promise<ClauseRegisterResult> {
  const facts = input.facts.trim();
  if (!facts) {
    return blankResult(input.contract_id, 'No facts provided');
  }
  if (!input.pass0.ok) {
    return blankResult(
      input.contract_id,
      input.pass0.error || 'Pass 0 must complete successfully before generating the clause register',
    );
  }

  let rawClauses: RawClause[] | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      CLAUSE_REGISTER_SYSTEM,
      userMsg:     buildUserMsg(input),
      maxTokens:   4000,
      skipLibrary: true,   // per-clause library grounding is 2d's job — see file header
    }));
    rawClauses = parseClauseRegister(text);
  } catch (e) {
    return blankResult(input.contract_id, classifyError(e));
  }

  if (!rawClauses) {
    return blankResult(input.contract_id, 'Could not parse clause register from AI response');
  }

  const replaceExisting = input.replaceExisting !== false;
  if (replaceExisting) {
    await deleteContractClausesForContract(input.contract_id);
  }

  const now = new Date().toISOString();
  const clauses: ContractClause[] = rawClauses.map((c) => ({
    id:              cid(),
    contract_id:     input.contract_id,
    clause_number:   c.clause_number,
    clause_text:     c.clause_text,
    jurisdiction:    input.pass0.candidate_jurisdiction,
    knowledge_tier:  null,
    flag_tier:       null,
    round_number:    1,
    history: [{
      round_number: 1,
      clause_text:  c.clause_text,
      changed_at:   now,
      changed_by:   'draft',
    }],
    created_at: now,
    updated_at: now,
  }));

  const saveResults = await Promise.all(clauses.map(saveContractClause));
  const failedCount = saveResults.filter(ok => !ok).length;
  if (failedCount === clauses.length) {
    return blankResult(input.contract_id, 'Generated clause register but failed to save it — check storage');
  }

  return {
    contract_id: input.contract_id,
    clauses,
    ok:          true,
    ...(failedCount > 0
      ? { error: `${failedCount} of ${clauses.length} clauses failed to save locally` }
      : {}),
  };
}
