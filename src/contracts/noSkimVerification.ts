/**
 * AFS Legal OS — Contract Engine — Review Mode — No-Skim Verification
 *
 * Roadmap ref: 3c (Contract Engine — Review Mode)
 *
 * Applied to 3a/3b output (`DocumentIngestResult.text` from
 * reviewIngest.ts). Answers one question: did whatever downstream Review
 * analysis ran over this document actually address every clause in it, or
 * did it skim — quietly dropping clauses from a long contract rather than
 * working through all of them?
 *
 * clause-count-in  — the number of clauses actually present in the source
 *                     document, per this module's own count.
 * clauses-addressed-out — the clause numbers the downstream analysis pass
 *                     claims to have covered.
 * A mismatch (clauses present but not addressed) is the "skim" this module
 * exists to catch.
 *
 * DELIBERATE DESIGN CHOICE — clause-count-in is computed WITHOUT any AI
 * call. It's a plain regex split over the extracted text. The whole point
 * of a no-skim check is to be a ground truth the reviewing pass can't
 * quietly under-report against — if the "in" count were itself produced by
 * an AI call, the same failure mode (an AI skimming a long document) could
 * shrink both sides of the comparison together and the check would catch
 * nothing. So this module has no dependency on callClaude, no dependency
 * on the library, and no storage read/write — pure text in, structured
 * result out. That also makes it trivially unit-testable, same spirit as
 * researchChecklist.ts's standalone core.
 *
 * LEAF-CLAUSE COUNTING — legal documents number hierarchically (e.g. "1"
 * "Definitions" containing "1.1", "1.2"). Counting every level would count
 * the same substantive content twice (once under the parent heading, once
 * under each child). This module counts LEAVES only — a clause with no
 * more specific numbered child is a leaf; a bare heading like "1." that
 * exists only to introduce "1.1"/"1.2" is not. A clause with no
 * sub-numbering at all (e.g. "4. Governing Law" with no "4.1") is itself a
 * leaf. This matches how counsel actually works through a contract:
 * clause-by-clause at whatever the finest numbered granularity is.
 *
 * KNOWN LIMITATION — this is a regex heuristic over plain extracted text,
 * not a real document-structure parser. It expects decimal clause
 * numbering at the start of a line ("1.", "2.3", "4.1.2") and will under-
 * count documents that number clauses by letter, roman numeral, or
 * unnumbered heading only. That's an acceptable false-negative for a
 * warning check — 3d (routing to 2d/2e/2f) is unaffected by this module's
 * output either way.
 *
 * Deliberately out of scope here, per the roadmap:
 *   - wiring into 2d/2e/2f (knowledge tiers, research-needed, flagging)
 *                                     → 3d
 *
 * Exported as plain (synchronous, where possible) functions — no
 * React/hook dependency — same convention as pass0.ts / clauseRegister.ts /
 * knowledgeTier.ts / researchChecklist.ts / flaggingPass.ts.
 */

import type { DocumentIngestResult } from './reviewIngest';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedClauseMarker {
  clause_number: string;   // e.g. "3.2" — same shape as ContractClause.clause_number
  clause_text:   string;   // text run from this marker up to the next marker (or end of document)
}

export interface NoSkimVerificationInput {
  contract_id: string;

  /** Ground-truth leaf clauses, e.g. from extractLeafClauses(). */
  clauses_in: ExtractedClauseMarker[];

  /**
   * Clause numbers the downstream Review analysis claims to have addressed.
   * Deliberately just strings, not ContractClause[] — 3d hasn't wired
   * Review through 2d/2e/2f yet, and this module shouldn't need to know
   * what shape that wiring eventually takes. Any caller that has a list of
   * clause numbers it processed can run this check.
   */
  clauses_addressed_out: string[];
}

export interface NoSkimVerificationResult {
  contract_id: string;

  clause_count_in:  number;
  clause_count_out: number;

  /** In clauses_in but NOT in clauses_addressed_out — the actual skim. */
  missing_clause_numbers: string[];
  /** In clauses_addressed_out but NOT in clauses_in — addressed something that isn't there (stale run, wrong contract_id, hallucinated number). Flagged, not silently ignored. */
  extra_clause_numbers: string[];

  /** True iff missing_clause_numbers is empty. extra_clause_numbers do not fail the check on their own — see doc comment on the field. */
  passed: boolean;

  /** Non-null exactly when passed is false. Render as a banner in Review output. */
  warning: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE CORE — deterministic clause-marker extraction, no AI, no storage
// ─────────────────────────────────────────────────────────────────────────────

// Matches a line-leading decimal clause number ("1", "2.3", "4.1.2"),
// optionally followed by a literal "." or ")", then whitespace, then the
// start of the clause's own text. Top-level numbers ("1.") and dotted
// sub-numbers ("1.1") both match — the trailing punctuation is optional
// specifically so "1.1 Landlord..." (no trailing dot after the number)
// still matches.
const CLAUSE_MARKER_RE = /^[ \t]*(\d{1,3}(?:\.\d{1,3}){0,4})[.)]?[ \t]+(?=\S)/gm;

/**
 * Splits extracted contract text into every numbered clause marker found,
 * document order, PARENTS INCLUDED (e.g. both "1" and "1.1"). Pure,
 * synchronous, no AI, no storage. Exported mainly so extractLeafClauses()
 * and tests can inspect the raw marker set; most callers want
 * extractLeafClauses() instead.
 */
export function extractClauseMarkers(fullText: string): ExtractedClauseMarker[] {
  const text = (fullText ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];

  const markers: { clause_number: string; start: number; textStart: number }[] = [];
  CLAUSE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_MARKER_RE.exec(text)) !== null) {
    markers.push({ clause_number: m[1], start: m.index, textStart: m.index + m[0].length });
  }

  const out: ExtractedClauseMarker[] = [];
  for (let i = 0; i < markers.length; i++) {
    const cur  = markers[i];
    const next = markers[i + 1];
    const end  = next ? next.start : text.length;
    const clauseText = text.slice(cur.textStart, end).trim();
    if (clauseText) out.push({ clause_number: cur.clause_number, clause_text: clauseText });
  }
  return out;
}

/**
 * Same as extractClauseMarkers(), filtered down to LEAVES only — see file
 * header for why leaves, not every level, are the ground-truth count.
 * This is the function 3c's verification check is meant to be fed from.
 */
export function extractLeafClauses(fullText: string): ExtractedClauseMarker[] {
  const all = extractClauseMarkers(fullText);
  return all.filter(c =>
    !all.some(other => other.clause_number !== c.clause_number
      && other.clause_number.startsWith(`${c.clause_number}.`)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICATION — clause-count-in vs clauses-addressed-out
// ─────────────────────────────────────────────────────────────────────────────

function buildWarning(missing: string[], countIn: number, countOut: number): string {
  const list = missing.join(', ');
  return (
    `No-skim check failed: ${missing.length} of ${countIn} clause(s) in the ` +
    `source document were not addressed in Review output (only ${countOut} ` +
    `clause(s) were covered). Unaddressed: ${list}. Do not rely on this ` +
    `Review output until every clause has been covered — re-run Review, or ` +
    `check the missing clauses manually.`
  );
}

/**
 * Compares clause-count-in (the document's own numbered clauses) against
 * clauses-addressed-out (what a downstream Review pass claims to have
 * covered). Pure function — no AI, no storage, never throws. Safe to call
 * with an empty clauses_in (e.g. a document this module's regex couldn't
 * parse) — that degrades to a pass with count 0, not a false failure,
 * since there's nothing to have skimmed.
 */
export function verifyNoSkim(input: NoSkimVerificationInput): NoSkimVerificationResult {
  const { contract_id, clauses_in, clauses_addressed_out } = input;

  const inNumbers  = clauses_in.map(c => c.clause_number);
  const inSet      = new Set(inNumbers);
  const outSet     = new Set(clauses_addressed_out);

  const missing = inNumbers.filter(n => !outSet.has(n));
  const extra   = clauses_addressed_out.filter(n => !inSet.has(n));

  const passed = missing.length === 0;

  return {
    contract_id,
    clause_count_in:  inNumbers.length,
    clause_count_out: clauses_addressed_out.length,
    missing_clause_numbers: missing,
    extra_clause_numbers:   extra,
    passed,
    warning: passed ? null : buildWarning(missing, inNumbers.length, clauses_addressed_out.length),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE — applies the check directly to 3a/3b's DocumentIngestResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs extraction + verification in one call, taking 3a/3b's
 * DocumentIngestResult directly, per the roadmap's "applied to 3a/3b
 * output" framing. If ingestion itself failed (ok: false — e.g. a scanned
 * PDF with no text layer), there is no text to check clauses against, so
 * this degrades to passed: true / clause_count_in: 0 rather than a
 * confusing false failure — the ingest error is the thing to surface to
 * counsel, not a no-skim warning about a document that was never read.
 */
export function runNoSkimVerification(
  contract_id: string,
  ingestResult: DocumentIngestResult,
  clauses_addressed_out: string[],
): NoSkimVerificationResult {
  if (!ingestResult.ok || !ingestResult.text.trim()) {
    return {
      contract_id,
      clause_count_in:  0,
      clause_count_out: clauses_addressed_out.length,
      missing_clause_numbers: [],
      extra_clause_numbers:   [],
      passed: true,
      warning: null,
    };
  }

  const clauses_in = extractLeafClauses(ingestResult.text);
  return verifyNoSkim({ contract_id, clauses_in, clauses_addressed_out });
}
