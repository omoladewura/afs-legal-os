/**
 * AFS Legal OS — compressIntelligence
 *
 * Phase 5 — Extend the Digest Pattern to Intelligence Data
 *
 * Mirrors the silentCompress() pattern from CaseDocketTab exactly, but
 * applies it to intelligence_data instead of docket entries.
 *
 * WHAT IT DOES
 * ────────────
 * Folds established_facts / disputed_areas / legal_issues / initial_risks
 * into a single tight `digest` string stored on intelligence_data.
 *
 * Once digest exists, useIntelligence() serves it instead of re-rendering
 * the raw arrays on every AI call — same precedence rule as intPkg over rawFacts.
 *
 * WHEN TO CALL
 * ────────────
 * Called from CaseDashboard.onSaveIntel() when:
 *   1. stage reaches 5 (intPkg generated — all raw arrays populated)
 *   2. digest_at is absent or older than 24 hours (prevents redundant runs)
 *
 * The raw arrays are NOT deleted — CaseOverview, IntelligenceEngine, and any
 * direct-access component still reads them. Only the AI-facing context block
 * (returned by useIntelligence) switches to the digest.
 *
 * USAGE
 * ─────
 *   import { maybeCompressIntelligence } from '@/services/compressIntelligence';
 *
 *   // In CaseDashboard.onSaveIntel, after saving:
 *   await maybeCompressIntelligence(updatedCase, saveCase, updateActiveCase);
 */

import type { Case, IntelligenceData } from '@/types';
import { callClaude, withRetry } from '@/services/api';
import { indexCaseChunk } from '@/services/caseRag';

// Re-compress at most once per 24 hours, even if stage stays at 5.
const DIGEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns true if a fresh digest should be generated for this case.
 * Conditions (all must hold):
 *   - intelligence_data exists
 *   - stage === 5 (intPkg generated — full pipeline complete)
 *   - intPkg is non-empty (the package itself is the quality gate)
 *   - either no digest exists yet, or the existing one is older than DIGEST_TTL_MS
 */
export function shouldCompress(intel: IntelligenceData | undefined): boolean {
  if (!intel) return false;
  if ((intel as any).stage !== 5) return false;
  if (!intel.intPkg?.trim()) return false;

  if (!intel.digest_at) return true;
  const age = Date.now() - new Date(intel.digest_at).getTime();
  return age > DIGEST_TTL_MS;
}

/**
 * Builds the AI prompt payload from the current intelligence arrays.
 * Returns null if there is nothing meaningful to compress.
 */
function buildCompressPrompt(intel: IntelligenceData, caseName: string): string | null {
  const extraction = intel.extraction;
  const facts    = extraction?.established_facts ?? [];
  const disputed = extraction?.disputed_areas    ?? [];
  const issues   = extraction?.legal_issues      ?? [];
  const risks    = intel.extraction?.initial_risks ?? [];
  const gaps     = extraction?.gaps_identified   ?? [];

  const hasContent = facts.length || disputed.length || issues.length || risks.length;
  if (!hasContent) return null;

  const lines: string[] = [`CASE: ${caseName}`];

  if (facts.length) {
    lines.push('\nESTABLISHED FACTS:');
    facts.forEach(f => lines.push(`• ${f}`));
  }
  if (disputed.length) {
    lines.push('\nDISPUTED AREAS:');
    disputed.forEach(d => lines.push(`• ${d}`));
  }
  if (issues.length) {
    lines.push('\nLEGAL ISSUES:');
    issues.forEach(i => lines.push(`• ${i}`));
  }
  if (risks.length) {
    lines.push('\nRISK REGISTER:');
    risks.forEach(r => lines.push(`• [${r.severity}] ${r.risk}`));
  }
  if (gaps.length) {
    lines.push('\nIDENTIFIED GAPS:');
    gaps.forEach(g => lines.push(`• ${g}`));
  }

  if (intel.digest) {
    lines.push('\nEXISTING DIGEST (merge this with the above):');
    lines.push(intel.digest);
  }

  return lines.join('\n');
}

/**
 * Generates and persists an intelligence digest.
 *
 * @param activeCase     Current case object (post-save, so intel already updated)
 * @param saveCase       Storage helper: persists the full case
 * @param updateActiveCase  Store setter: updates in-memory case without re-load
 */
export async function compressIntelligence(
  activeCase: Case,
  saveCase: (c: Case) => Promise<void>,
  updateActiveCase: (patch: Partial<Case>) => void,
): Promise<void> {
  const intel = activeCase.intelligence_data;
  if (!intel) return;

  const prompt = buildCompressPrompt(intel, activeCase.caseName);
  if (!prompt) return;

  try {
    const digest = await withRetry(() => callClaude({
      system:
        'You are a Nigerian litigation intelligence analyst. ' +
        'Compress the provided case intelligence into a concise, high-density digest ' +
        'for injection into AI legal drafting prompts. ' +
        'Preserve every material fact, legal issue, risk, and gap. ' +
        'Write in tight prose paragraphs — no bullet points, no headers. ' +
        'Target 200–350 words. Omit nothing of legal significance. ' +
        'If an existing digest is provided, merge it with the new data; ' +
        'do not repeat points already captured.',
      userMsg: prompt,
      maxTokens: 600,
      skipLibrary: true,
    }));

    if (!digest?.trim()) return;

    const now = new Date().toISOString();
    const patch: Partial<Case> = {
      intelligence_data: {
        ...intel,
        digest:    digest.trim(),
        digest_at: now,
      },
    };

    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });

    // Phase 6 — Index this digest snapshot into the case history RAG index
    // so it can be retrieved by engines when the case grows beyond the digest
    // threshold. Fire-and-forget; indexCaseChunk() never throws.
    indexCaseChunk({
      caseId:    activeCase.id,
      chunkId:   `digest-${now.slice(0, 10)}`,
      type:      'digest',
      text:      digest.trim(),
      createdAt: now,
    });
  } catch {
    // Compression is best-effort — never surface errors to the user.
    // The case will simply continue serving raw arrays via useIntelligence.
  }
}

/**
 * Convenience wrapper: runs compressIntelligence only when shouldCompress() is true.
 * Drop this into onSaveIntel — it is safe to call on every save.
 */
export async function maybeCompressIntelligence(
  activeCase: Case,
  saveCase: (c: Case) => Promise<void>,
  updateActiveCase: (patch: Partial<Case>) => void,
): Promise<void> {
  if (!shouldCompress(activeCase.intelligence_data)) return;
  await compressIntelligence(activeCase, saveCase, updateActiveCase);
}
