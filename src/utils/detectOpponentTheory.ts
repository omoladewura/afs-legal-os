/**
 * AFS Legal OS — detectOpponentTheory()
 * Phase 3A — Shared opponent theory extraction utility.
 *
 * Single source of truth for reading the opposing side's theory from any
 * text source. Called by:
 *   - Phase 3B (ApplicationsEngine — Mover track): extracts respondent's
 *     theory from counter-affidavit or written address in opposition.
 *   - Phase 3C (ApplicationsEngine — Respondent track): extracts mover's
 *     theory from the originating motion and supporting affidavit.
 *   - Phase 3G-iii (TrialEngine / CrossExamSessionManager): runs on the
 *     structured contradiction statement produced by a live Yes/No mismatch,
 *     feeding the theory update pipeline (unlock → merge → relock, same as 3D).
 *
 * DESIGN NOTES
 * ────────────
 * • Pure async function — no React hooks, no component context. Import and
 *   call anywhere.
 * • Uses callClaude + withRetry directly (same pattern as IntelligenceEngine)
 *   rather than the hook-based useAI, because it must be callable outside
 *   React components (e.g. from CrossExamSessionManager's handleStep callback).
 * • Returns DetectedOpponentTheory — a lightweight read, NOT a full
 *   CaseTheoryRecord. The CaseTheoryRecord is the counsel-locked operative
 *   theory; DetectedOpponentTheory is an AI read of what the opponent is
 *   actually arguing right now. Callers use it to propose a theory update via
 *   the unlock → merge → relock flow (Phase 3D), not to replace the locked
 *   theory directly.
 * • source drives the prompt framing and shapes which questions the AI asks:
 *     'written_address'        — formal argument document (motion, brief, FWA)
 *     'affidavit'              — sworn factual statement
 *     'counter_affidavit'      — respondent's sworn reply
 *     'contradiction_statement'— auto-generated statement from a live
 *                                cx_contradictions entry (Phase 3G-iii)
 * • confidence is the AI's self-assessed 0–100 read quality. < 40 means the
 *   text was too sparse to extract a reliable theory; callers should surface
 *   a low-confidence warning rather than silently merging.
 * • key_arguments is capped at 5 — the most salient points, not a transcript.
 *   Callers needing exhaustive extraction should use the full Intelligence
 *   Engine pipeline instead.
 */

import { callClaude, withRetry } from '@/services/api';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type DetectionSource =
  | 'written_address'
  | 'affidavit'
  | 'counter_affidavit'
  | 'contradiction_statement';

/**
 * Lightweight structured read of the opponent's theory.
 * NOT a CaseTheoryRecord — this is a snapshot of what the opponent is
 * currently arguing, extracted from a single document or statement.
 *
 * Used as input to the Phase 3D unlock → merge → relock flow: the calling
 * engine presents this to counsel alongside the current locked theory, and
 * counsel decides whether to adopt, adapt, or discard the detected update.
 */
export interface DetectedOpponentTheory {
  /** One sentence. What is the opponent ultimately trying to establish? */
  core_proposition: string;

  /**
   * Up to 5 key arguments the opponent is making, in order of prominence.
   * Each is a complete sentence stating the argument, not a heading or label.
   */
  key_arguments: string[];

  /**
   * The single factual or legal point that, if disproved or distinguished,
   * collapses the opponent's position. May be null if the text is too sparse.
   */
  theory_killer_target: string | null;

  /**
   * Categorises the opponent's theory type — helps callers decide how to
   * frame the counter-argument:
   *   'substantive'   — disputes the legal merits (cause of action, liability)
   *   'procedural'    — attacks process, competence, jurisdiction, or form
   *   'evidentiary'   — challenges the evidence base
   *   'mixed'         — more than one of the above
   */
  theory_type: 'substantive' | 'procedural' | 'evidentiary' | 'mixed';

  /**
   * AI self-assessed confidence in the extraction, 0–100.
   * < 40: text too sparse — surface a warning, do not auto-merge.
   * 40–69: moderate — show to counsel for review before merging.
   * 70–100: high — safe to present as a merge candidate.
   */
  confidence: number;

  /**
   * One-sentence explanation of what limited the confidence, or null if
   * confidence >= 70. Shown to counsel when confidence is low or moderate.
   */
  confidence_note: string | null;

  /**
   * ISO timestamp of extraction — lets callers show "detected 2 mins ago"
   * and lets the 3D merge log record when the read was taken.
   */
  detected_at: string;

  /** The source type passed by the caller — echoed back for logging. */
  source: DetectionSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-SPECIFIC PROMPT FRAGMENTS
// ─────────────────────────────────────────────────────────────────────────────

function sourceContext(source: DetectionSource): {
  docLabel: string;
  instruction: string;
} {
  switch (source) {
    case 'written_address':
      return {
        docLabel: 'WRITTEN ADDRESS / BRIEF',
        instruction:
          'This is a formal legal argument document. Extract the theory the author is advancing — what they are trying to persuade the court to find. Focus on the legal propositions, the authorities relied upon, and the conclusion sought.',
      };
    case 'affidavit':
      return {
        docLabel: 'SUPPORTING AFFIDAVIT',
        instruction:
          'This is a sworn factual statement. Extract the factual theory — the version of events the deponent is asserting under oath. Identify what facts they are asking the court to accept as established, and what legal consequence they imply those facts should produce.',
      };
    case 'counter_affidavit':
      return {
        docLabel: 'COUNTER-AFFIDAVIT',
        instruction:
          'This is the respondent\'s sworn reply to the applicant\'s motion. Extract the theory underlying the resistance — what the respondent says actually happened, which of the applicant\'s factual claims they dispute, and what outcome they are seeking from the court.',
      };
    case 'contradiction_statement':
      return {
        docLabel: 'CONTRADICTION STATEMENT (live cross-examination)',
        instruction:
          'This is an auto-generated statement recording a live Yes/No mismatch in cross-examination: the question posed, the expected answer, and the actual answer given. Extract what the witness\'s actual answer reveals about the opponent\'s theory — what position the witness is now asserting, and how it departs from the pre-loaded theory. core_proposition should frame the witness\'s revealed position as a competing factual claim.',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the opponent's theory from a document or statement.
 *
 * @param text      The raw text to analyse (written address, affidavit,
 *                  counter-affidavit, or contradiction statement).
 * @param source    Which type of document this is — drives prompt framing.
 * @param caseCtx   Optional brief case context string (caseName, court, parties)
 *                  injected into the prompt to ground the extraction.
 *
 * @returns         DetectedOpponentTheory — see type definition above.
 * @throws          On AI call failure or JSON parse failure after repair.
 *                  Callers should catch and surface a non-blocking error
 *                  (never let this crash the calling engine's primary flow).
 */
export async function detectOpponentTheory(
  text: string,
  source: DetectionSource,
  caseCtx?: string,
): Promise<DetectedOpponentTheory> {
  if (!text || text.trim().length < 20) {
    // Return a zero-confidence stub rather than throwing — lets callers treat
    // an empty/trivial input gracefully without a try-catch at every call site.
    return {
      core_proposition:    'Insufficient text to extract theory.',
      key_arguments:       [],
      theory_killer_target: null,
      theory_type:         'substantive',
      confidence:          0,
      confidence_note:     'Text was too short or empty for extraction.',
      detected_at:         new Date().toISOString(),
      source,
    };
  }

  const { docLabel, instruction } = sourceContext(source);
  const ctxBlock = caseCtx ? `\nCASE CONTEXT: ${caseCtx}\n` : '';

  const raw = await withRetry(() =>
    callClaude({
      system: `You are a senior trial advocate at an AFS Legal OS terminal, reading the opponent's document to extract their theory of the case for a Nigerian court.
${ctxBlock}
DOCUMENT TYPE: ${docLabel}
INSTRUCTION: ${instruction}

Your task: Extract the opponent's theory as structured JSON. Be precise and specific — avoid generic labels like "the plaintiff claims breach" and instead state the actual proposition (e.g. "The plaintiff claims that the defendant's failure to deliver the consignment by 15 March 2024 constitutes a repudiation of Clause 5 of the Supply Agreement").

Output ONLY valid JSON — no preamble, no markdown fences, no explanation. Exactly:
{
  "core_proposition": "One complete sentence stating the opponent's ultimate position.",
  "key_arguments": [
    "First argument — complete sentence.",
    "Second argument — complete sentence."
  ],
  "theory_killer_target": "The single fact, document, or admission that if disproved collapses their position. Null if the text is too sparse.",
  "theory_type": "substantive | procedural | evidentiary | mixed",
  "confidence": 0,
  "confidence_note": "One sentence explaining what limited confidence, or null if confidence >= 70."
}

Rules:
- key_arguments: maximum 5 entries, most prominent first. Complete sentences only.
- theory_type: pick the dominant type; use "mixed" only when two or more are genuinely co-equal.
- confidence: 0–100 integer. Base it on text richness and clarity of legal argument:
    0–39  = too sparse, fragmented, or off-topic to extract reliably
    40–69 = moderate — argument is present but incomplete or ambiguous
    70–100 = high — clear, detailed argument with identifiable propositions
- confidence_note: required when confidence < 70; null otherwise.
- theory_killer_target: specific named fact/document/admission, not a generic observation. Null if not determinable.
- Output ONLY the JSON object. Nothing before or after it.`,
      userMsg: `${docLabel}:\n\n${text}`,
      maxTokens: 1200,
      skipLibrary: true,
    }),
  );

  // ── Parse ────────────────────────────────────────────────────────────────
  let cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) {
    throw new Error(`detectOpponentTheory: no JSON object found in response (source: ${source}).`);
  }
  cleaned = cleaned.slice(s, e + 1);

  let parsed: Omit<DetectedOpponentTheory, 'detected_at' | 'source'>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Light repair pass — strip control characters, trailing commas
    const repaired = cleaned
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    parsed = JSON.parse(repaired);
  }

  // ── Normalise and return ─────────────────────────────────────────────────
  return {
    core_proposition:    parsed.core_proposition    ?? 'Unable to extract core proposition.',
    key_arguments:       (parsed.key_arguments      ?? []).slice(0, 5),
    theory_killer_target: parsed.theory_killer_target ?? null,
    theory_type:         parsed.theory_type          ?? 'substantive',
    confidence:          typeof parsed.confidence === 'number'
                           ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
                           : 0,
    confidence_note:     parsed.confidence_note     ?? null,
    detected_at:         new Date().toISOString(),
    source,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — callable by any engine that renders a DetectedOpponentTheory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable label for the confidence level.
 * Use in UI badges next to the detected theory card.
 */
export function confidenceLabel(confidence: number): {
  label: string;
  color: string;
} {
  if (confidence >= 70) return { label: 'High confidence',     color: '#40b068' };
  if (confidence >= 40) return { label: 'Moderate confidence', color: '#c0a030' };
  return                       { label: 'Low confidence',      color: '#c05050' };
}

/**
 * Returns true if the detected theory should be presented to counsel as a
 * merge candidate. Below 40, callers should show the raw result with a
 * prominent warning rather than surfacing a merge prompt.
 */
export function isMergeCandidate(detected: DetectedOpponentTheory): boolean {
  return detected.confidence >= 40;
}

/**
 * Formats a DetectedOpponentTheory for injection into an AI system prompt
 * (e.g. when building the mover or respondent's written address, so the AI
 * knows what it is arguing against).
 *
 * Keeps it compact — the calling engine's own intelligence context is larger
 * and more authoritative; this is a supplement, not a replacement.
 */
export function formatDetectedTheoryForPrompt(
  detected: DetectedOpponentTheory,
  partyLabel: string = 'Opponent',
): string {
  const lines: string[] = [
    `${partyLabel.toUpperCase()} DETECTED THEORY (${detected.source.replace(/_/g, ' ')}, confidence ${detected.confidence}/100):`,
    `Core position: ${detected.core_proposition}`,
  ];
  if (detected.key_arguments.length > 0) {
    lines.push('Key arguments:');
    detected.key_arguments.forEach((a, i) => lines.push(`  ${i + 1}. ${a}`));
  }
  if (detected.theory_killer_target) {
    lines.push(`Pressure point: ${detected.theory_killer_target}`);
  }
  if (detected.confidence < 70 && detected.confidence_note) {
    lines.push(`Note: ${detected.confidence_note}`);
  }
  return lines.join('\n');
}
