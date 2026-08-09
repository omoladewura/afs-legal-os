/**
 * AFS Legal OS — Contract Engine — Pass 0
 *
 * Roadmap ref: 2b (Contract Engine — Draft Mode)
 *
 * Given contract type (optional hint) + facts, identifies:
 *   1. contract_type          — confirmed/refined, not just echoed back
 *   2. candidate_jurisdiction — whole-contract, per the 1a decision
 * ...then checks the library for governing law in that jurisdiction.
 *
 * Output only. No clause generation, no writes to contract_clauses — this
 * is purely: facts in, classification + governing-law signal out. 2c reads
 * this result as one of its inputs when generating the clause register.
 *
 * Two-step flow, deliberately kept separate rather than one combined call:
 *   Step 1 — classify contract_type + candidate_jurisdiction from facts
 *            alone (skipLibrary: true). Keeping the library OUT of this
 *            call means jurisdiction isn't biased toward whatever happens
 *            to be well-represented in the library — it's read from what
 *            counsel actually typed.
 *   Step 2 — once a candidate jurisdiction exists, queryLibrary() directly
 *            with a `{ jurisdiction }` filter (per the 1d/library.ts doc
 *            comment) to see whether the library has governing-law
 *            authorities for that jurisdiction. This is a signal for 2c/2d,
 *            not a knowledge-tier tag — that tagging is 2d's job, applied
 *            per clause, not once per contract.
 *
 * Exported as a plain async function — no React/hook dependency — so it's
 * callable from a form handler, a test, or a future batch job identically.
 */

import { callClaude, withRetry, classifyError } from '@/services/api';
import { queryLibrary, type LibraryMatch } from '@/services/library';
import type { ClientPositionProfile } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type JurisdictionConfidence = 'high' | 'medium' | 'low';

export interface Pass0Input {
  contract_id: string;
  facts:       string;

  /** Counsel's guess at contract type, if any — confirmed or corrected, not echoed blindly. */
  contract_type_hint?: string;

  /**
   * Optional — when supplied, `jurisdiction_preference` seeds the jurisdiction
   * call (facts still take precedence if they contradict it), and `client_role`
   * gives the model a bit more context on which side of the deal counsel sits.
   */
  profile?: ClientPositionProfile | null;
}

export interface Pass0Result {
  contract_id: string;

  contract_type:            string;
  candidate_jurisdiction:   string;   // "{COUNTRY}" or "{COUNTRY}-{STATE}", e.g. "NG" or "NG-LA"
  jurisdiction_confidence:  JurisdictionConfidence;
  jurisdiction_reasoning:   string;

  /** True if the library returned any matches above threshold for this jurisdiction. */
  governing_law_library_hit: boolean;
  /** One-line summary of the top library match — '' if governing_law_library_hit is false. */
  governing_law_summary:     string;
  /** Raw matches for downstream use (2c/2d) — not just the summary. */
  library_matches:           LibraryMatch[];

  ok:     boolean;
  /** Set only when ok is false — classification failed outright. */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — CLASSIFY CONTRACT TYPE + CANDIDATE JURISDICTION
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFY_SYSTEM = `You are Pass 0 of the AFS Legal OS Contract Engine — a fast classification
step that runs before any clause drafting. Your only job is to read the facts
counsel has typed and return a single JSON object. Do not draft any contract
language. Do not explain your reasoning outside the JSON. Do not wrap the JSON
in markdown code fences — return raw JSON only.

Return EXACTLY this shape, nothing else:
{
  "contract_type": string,               // e.g. "Commercial Lease Agreement", "Employment Contract"
  "candidate_jurisdiction": string,       // "{COUNTRY}" or "{COUNTRY}-{STATE}", e.g. "NG" or "NG-LA"
  "jurisdiction_confidence": "high" | "medium" | "low",
  "jurisdiction_reasoning": string        // one or two sentences — why this jurisdiction
}

Rules:
- If counsel supplied a contract type hint, confirm or correct it based on the
  facts — do not just echo it back uncritically.
- If a jurisdiction preference was supplied and the facts don't contradict it,
  use it and mark confidence "high". If you're inferring jurisdiction from the
  facts alone (parties' location, currency, references to local law), mark
  confidence "medium". If the facts give no jurisdiction signal at all, make
  your best guess, mark confidence "low", and say so plainly in
  jurisdiction_reasoning.
- candidate_jurisdiction is whole-contract, not per-clause — one value for the
  entire agreement, never a range or a list.
- Never invent facts that are not in the input.`;

function buildClassifyUserMsg(input: Pass0Input): string {
  const lines: string[] = [];

  if (input.contract_type_hint?.trim()) {
    lines.push(`Counsel's contract type hint: ${input.contract_type_hint.trim()}`);
  }
  if (input.profile?.jurisdiction_preference) {
    lines.push(`Client Position Profile jurisdiction preference: ${input.profile.jurisdiction_preference}`);
  }
  if (input.profile?.client_role) {
    lines.push(`Client's role in this deal: ${input.profile.client_role}`);
  }

  lines.push('');
  lines.push('FACTS:');
  lines.push(input.facts.trim());

  return lines.join('\n');
}

interface RawClassification {
  contract_type:           string;
  candidate_jurisdiction:  string;
  jurisdiction_confidence: JurisdictionConfidence;
  jurisdiction_reasoning:  string;
}

/** Strips optional markdown code fences and validates the required shape. Never throws. */
function parseClassification(raw: string): RawClassification | null {
  try {
    const stripped = raw.trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;

    const contractType  = parsed.contract_type;
    const jurisdiction   = parsed.candidate_jurisdiction;
    const confidence     = parsed.jurisdiction_confidence;
    const reasoning       = parsed.jurisdiction_reasoning;

    if (
      typeof contractType === 'string' && contractType.trim() &&
      typeof jurisdiction === 'string' && jurisdiction.trim() &&
      typeof reasoning === 'string' &&
      (confidence === 'high' || confidence === 'medium' || confidence === 'low')
    ) {
      return {
        contract_type:           contractType.trim(),
        candidate_jurisdiction:  jurisdiction.trim(),
        jurisdiction_confidence: confidence,
        jurisdiction_reasoning:  reasoning.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — CHECK LIBRARY FOR GOVERNING LAW
// ─────────────────────────────────────────────────────────────────────────────

function buildGoverningLawQuery(contractType: string, facts: string): string {
  return `governing law applicable statute ${contractType} ${facts}`.slice(0, 300);
}

function summarizeGoverningLaw(matches: LibraryMatch[]): string {
  if (matches.length === 0) return '';
  const top = matches[0];
  const parts = [top.metadata.title];
  if (top.metadata.citation)         parts.push(`(${top.metadata.citation})`);
  else if (top.metadata.statSection) parts.push(`(${top.metadata.statSection})`);
  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function blankResult(contractId: string, error: string): Pass0Result {
  return {
    contract_id:               contractId,
    contract_type:              '',
    candidate_jurisdiction:     '',
    jurisdiction_confidence:    'low',
    jurisdiction_reasoning:     '',
    governing_law_library_hit:  false,
    governing_law_summary:      '',
    library_matches:            [],
    ok:                          false,
    error,
  };
}

/**
 * Runs Pass 0 for a contract matter. Never throws — a failed AI call or
 * library lookup degrades to `ok: false` with a user-facing `error` string,
 * same convention as queryLibrary().
 */
export async function runPass0(input: Pass0Input): Promise<Pass0Result> {
  const facts = input.facts.trim();
  if (!facts) {
    return blankResult(input.contract_id, 'No facts provided');
  }

  // ── Step 1 — classify contract type + candidate jurisdiction ──────────────
  let classification: RawClassification | null;
  try {
    const { text } = await withRetry(() => callClaude({
      system:      CLASSIFY_SYSTEM,
      userMsg:     buildClassifyUserMsg(input),
      maxTokens:   600,
      skipLibrary: true,   // facts-only classification — see file header
    }));
    classification = parseClassification(text);
  } catch (e) {
    return blankResult(input.contract_id, classifyError(e));
  }

  if (!classification) {
    return blankResult(input.contract_id, 'Could not parse contract type / jurisdiction from AI response');
  }

  // ── Step 2 — check library for governing law in that jurisdiction ─────────
  const libResult = await queryLibrary(
    buildGoverningLawQuery(classification.contract_type, facts),
    {
      filter:    { jurisdiction: classification.candidate_jurisdiction },
      topK:      5,
      threshold: 0.68,
    },
  );

  const governingLawHit = libResult.ok && libResult.matches.length > 0;

  return {
    contract_id:                input.contract_id,
    contract_type:               classification.contract_type,
    candidate_jurisdiction:      classification.candidate_jurisdiction,
    jurisdiction_confidence:     classification.jurisdiction_confidence,
    jurisdiction_reasoning:      classification.jurisdiction_reasoning,
    governing_law_library_hit:   governingLawHit,
    governing_law_summary:       governingLawHit ? summarizeGoverningLaw(libResult.matches) : '',
    library_matches:              libResult.matches,
    ok:                           true,
  };
}
