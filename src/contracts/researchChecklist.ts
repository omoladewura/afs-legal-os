/**
 * AFS Legal OS — Contract Engine — [RESEARCH NEEDED] Checklist Generator
 *
 * Roadmap ref: 2e (Contract Engine — Draft Mode)
 *
 * Given a clause's subject area, emits the per-authority-type research
 * queries counsel needs to run: statute, common_law, regulator,
 * sector_trigger, case_law_trend — one ResearchNeededQuery per type, per
 * clause (see ContractClause.research_needed in types.ts).
 *
 * Standalone, testable independent of 2d: `generateResearchChecklists()`
 * takes plain clause facts (clause_number, clause_text, jurisdiction) and
 * a contract type — no dependency on knowledge_tier, no read from
 * contract_clauses, no read of a Pass0Result. A caller (a test, a future
 * batch job, 2d's own output) can hand it fabricated clause input directly.
 * `runResearchChecklistGeneration()` below is the integration wrapper that
 * loads real RESEARCH_NEEDED clauses from storage and persists the result —
 * that wrapper is what actually depends on 2d having run, not the generator
 * itself.
 *
 * Accepts an array of clauses (not just one) so a contract with several
 * RESEARCH_NEEDED clauses can be checklisted in a single AI call, same
 * batching-for-efficiency reasoning as 2d's Step 2 — passing an array of
 * length 1 is exactly how a unit test exercises the single-clause case.
 *
 * Exported as plain async functions — no React/hook dependency — same
 * convention as pass0.ts / clauseRegister.ts / knowledgeTier.ts.
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { loadContractClauses, saveContractClause } from '@/storage/helpers';
import type { ContractClause, ResearchNeededQuery } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

const AUTHORITY_TYPES = ['statute', 'common_law', 'regulator', 'sector_trigger', 'case_law_trend'] as const;
type AuthorityType = (typeof AUTHORITY_TYPES)[number];

export interface ResearchChecklistClauseInput {
  clause_number: string;
  clause_text:   string;
  /** "{COUNTRY}" or "{COUNTRY}-{STATE}" — same shape as ContractClause.jurisdiction. */
  jurisdiction:  string;
}

export interface ResearchChecklistInput {
  clauses:        ResearchChecklistClauseInput[];
  /** Optional — improves query specificity. */
  contract_type?: string;
}

export interface ResearchChecklistEntry {
  clause_number: string;
  queries:       ResearchNeededQuery[];   // always exactly 5 — one per AUTHORITY_TYPES entry
}

export interface ResearchChecklistResult {
  ok:       boolean;
  entries:  ResearchChecklistEntry[];
  /** Set only when ok is false. */
  error?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const CHECKLIST_SYSTEM = `You are Contract Engine Draft Mode, [RESEARCH NEEDED] Checklist Generator.
You receive one or more contract clauses that were tagged RESEARCH_NEEDED
because the library had no authority on file for them. Your job is not to
answer the legal question — it is to generate the research queries counsel
should run to find the answer.

For EACH clause, emit EXACTLY 5 queries, one for each of these authority
types, tailored to that specific clause's subject matter and jurisdiction:

  "statute"          — a query aimed at finding the governing statute or
                        statutory provision, if any, on this clause's subject.
  "common_law"        — a query aimed at finding the common-law/case-law
                        doctrine governing this subject, independent of
                        statute.
  "regulator"          — a query aimed at finding any regulator guidance,
                        rules, or circulars bearing on this subject (leave
                        broad/generic only if the subject plainly has no
                        regulator angle — do not invent a regulator that
                        doesn't plausibly exist for this subject).
  "sector_trigger"     — a query aimed at finding sector-specific rules that
                        would apply if the deal falls into a regulated
                        sector (e.g. finance, health, data, real estate) —
                        phrased so it surfaces sector triggers, not just
                        general contract law.
  "case_law_trend"     — a query aimed at finding recent case law trend or
                        judicial attitude on this subject, to catch drift
                        away from older settled authority.

Each query is specific enough that pasting it into a legal research tool
returns useful results — not a generic restatement of the clause. Include
the jurisdiction in each query. Do not answer the legal question yourself.
Do not wrap the JSON in markdown code fences — return raw JSON only.

Return EXACTLY this shape, nothing else, one checklist entry per input
clause, same clause_number values, each with exactly 5 queries covering
all 5 authority types:
{
  "checklists": [
    {
      "clause_number": string,
      "queries": [
        { "authority_type": "statute", "query": string },
        { "authority_type": "common_law", "query": string },
        { "authority_type": "regulator", "query": string },
        { "authority_type": "sector_trigger", "query": string },
        { "authority_type": "case_law_trend", "query": string }
      ]
    },
    ...
  ]
}`;

function buildUserMsg(input: ResearchChecklistInput): string {
  const lines: string[] = [];
  if (input.contract_type) lines.push(`Contract type: ${input.contract_type}`);
  lines.push('');
  lines.push('CLAUSES (research checklist needed for each):');
  for (const c of input.clauses) {
    lines.push(`[${c.clause_number}] (jurisdiction: ${c.jurisdiction}) ${c.clause_text}`);
  }
  return lines.join('\n');
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseChecklists(raw: string, expectedNumbers: Set<string>): ResearchChecklistEntry[] | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const checklists = parsed.checklists;
    if (!Array.isArray(checklists) || checklists.length === 0) return null;

    const out: ResearchChecklistEntry[] = [];
    for (const entry of checklists) {
      const clauseNumber = (entry as Record<string, unknown>)?.clause_number;
      const queries       = (entry as Record<string, unknown>)?.queries;
      if (typeof clauseNumber !== 'string' || !clauseNumber.trim()) return null;
      if (!Array.isArray(queries) || queries.length !== AUTHORITY_TYPES.length) return null;

      const seen = new Set<string>();
      const parsedQueries: ResearchNeededQuery[] = [];
      for (const q of queries) {
        const authorityType = (q as Record<string, unknown>)?.authority_type;
        const queryText     = (q as Record<string, unknown>)?.query;
        if (typeof authorityType !== 'string' || !AUTHORITY_TYPES.includes(authorityType as AuthorityType)) return null;
        if (typeof queryText !== 'string' || !queryText.trim()) return null;
        if (seen.has(authorityType)) return null;   // duplicate authority_type — malformed
        seen.add(authorityType);
        parsedQueries.push({ authority_type: authorityType as AuthorityType, query: queryText.trim() });
      }
      if (seen.size !== AUTHORITY_TYPES.length) return null;   // missing a type

      out.push({ clause_number: clauseNumber.trim(), queries: parsedQueries });
    }

    // Every requested clause_number must have a checklist entry.
    const returnedNumbers = new Set(out.map(e => e.clause_number));
    for (const n of expectedNumbers) {
      if (!returnedNumbers.has(n)) return null;
    }

    return out;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE CORE — testable independent of 2d and of storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a 5-query research checklist per clause. Never throws — a
 * failed AI call or malformed response degrades to `ok: false` with a
 * user-facing `error` string, same convention as the rest of the Contract
 * Engine. Pure function of its input: no storage read, no storage write,
 * no dependency on 2d having run. Pass a single-element `clauses` array to
 * exercise the single-clause case in a test.
 */
export async function generateResearchChecklists(
  input: ResearchChecklistInput,
): Promise<ResearchChecklistResult> {
  if (input.clauses.length === 0) {
    return { ok: false, entries: [], error: 'No clauses provided' };
  }

  const expectedNumbers = new Set(input.clauses.map(c => c.clause_number));

  let entries: ResearchChecklistEntry[] | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      CHECKLIST_SYSTEM,
      userMsg:     buildUserMsg(input),
      maxTokens:   3000,
      skipLibrary: true,   // generating research queries, not answering from the library
    }));
    entries = parseChecklists(text, expectedNumbers);
  } catch (e) {
    return { ok: false, entries: [], error: classifyError(e) };
  }

  if (!entries) {
    return { ok: false, entries: [], error: 'Could not parse research checklist from AI response' };
  }

  return { ok: true, entries };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION WRAPPER — loads RESEARCH_NEEDED clauses from storage, persists result
// ─────────────────────────────────────────────────────────────────────────────

export interface ResearchChecklistRunResult {
  contract_id: string;
  clauses:     ContractClause[];   // full updated register, all clauses, in clause_number order
  tagged:      number;             // count of clauses newly given a checklist this run
  ok:          boolean;
  /** Set only when ok is false. */
  error?:      string;
}

function blankRunResult(contractId: string, error: string): ResearchChecklistRunResult {
  return { contract_id: contractId, clauses: [], tagged: 0, ok: false, error };
}

/**
 * Loads every clause on file for `contract_id`, finds those tagged
 * RESEARCH_NEEDED (by 2d) that don't yet have a `research_needed`
 * checklist, generates checklists for all of them in one batched call via
 * generateResearchChecklists(), and persists each via saveContractClause().
 *
 * Idempotent-ish, same convention as 2d: clauses that already carry a
 * `research_needed` array are left untouched and re-returned as-is.
 */
export async function runResearchChecklistGeneration(
  contract_id: string,
  contract_type?: string,
): Promise<ResearchChecklistRunResult> {
  let clauses: ContractClause[];
  try {
    clauses = await loadContractClauses(contract_id);
  } catch (e) {
    return blankRunResult(contract_id, classifyError(e));
  }

  if (clauses.length === 0) {
    return blankRunResult(contract_id, 'No clauses on file for this contract — run 2c first');
  }

  const pending = clauses.filter(
    c => c.knowledge_tier === 'RESEARCH_NEEDED' && c.research_needed == null,
  );
  if (pending.length === 0) {
    return { contract_id, clauses, tagged: 0, ok: true };
  }

  const checklistResult = await generateResearchChecklists({
    clauses: pending.map(c => ({
      clause_number: c.clause_number,
      clause_text:   c.clause_text,
      jurisdiction:  c.jurisdiction,
    })),
    contract_type,
  });

  if (!checklistResult.ok) {
    return blankRunResult(contract_id, checklistResult.error ?? 'Checklist generation failed');
  }

  const queriesByNumber = new Map(checklistResult.entries.map(e => [e.clause_number, e.queries]));
  const now = new Date().toISOString();
  const toSave: ContractClause[] = [];
  for (const clause of pending) {
    const queries = queriesByNumber.get(clause.clause_number);
    if (!queries) {
      return blankRunResult(contract_id, `Missing checklist for clause ${clause.clause_number}`);
    }
    toSave.push({ ...clause, research_needed: queries, updated_at: now });
  }

  const saveResults = await Promise.all(toSave.map(saveContractClause));
  const failedCount = saveResults.filter(ok => !ok).length;
  if (failedCount === toSave.length) {
    return blankRunResult(contract_id, 'Generated checklists but failed to save them — check storage');
  }

  const savedById = new Map(toSave.map(c => [c.id, c]));
  const finalClauses = clauses
    .map(c => savedById.get(c.id) ?? c)
    .sort((a, b) => a.clause_number.localeCompare(b.clause_number, undefined, { numeric: true }));

  return {
    contract_id,
    clauses: finalClauses,
    tagged:  toSave.length,
    ok:      true,
    ...(failedCount > 0
      ? { error: `${failedCount} of ${toSave.length} newly-checklisted clauses failed to save locally` }
      : {}),
  };
}
