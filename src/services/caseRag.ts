/**
 * AFS Legal OS — Case History RAG Service  (Phase 6)
 *
 * Mirrors statuteRag.ts exactly, but queries the case's own history
 * (digest fragments, docket summaries, evidence summaries) instead of
 * the statute library.
 *
 * WHY THIS EXISTS
 * ───────────────
 * For small/young cases, useIntelligence() + the Phase 5 digest is
 * sufficient — the whole context fits in a single prompt block.
 *
 * For multi-year, multi-issue cases the digest grows beyond what can
 * be usefully cached or even read. Phase 6 gates on a size threshold
 * (CASE_RAG_THRESHOLD) and, for cases above it, retrieves only the
 * chunks semantically relevant to the current engine's query instead
 * of the full history.
 *
 * ─── HOW TO ACTIVATE ────────────────────────────────────────────────────────
 * 1. Create the Vectorize index:
 *      npx wrangler vectorize create afs-case-history --dimensions=768 --metric=cosine
 *
 * 2. Add the binding to workers/rag-worker/wrangler.toml (already done — see
 *    Phase 6 wrangler patch at the bottom of this file).
 *
 * 3. Deploy the updated worker (now has /case-embed and /case-query routes).
 *
 * 4. Set CASE_RAG_ENDPOINT below to your Worker URL.
 *    The same Worker URL as STATUTE_RAG_ENDPOINT — just different paths.
 *
 * ─── WORKER CONTRACT ─────────────────────────────────────────────────────────
 *
 * POST /case-embed
 *   Body: { caseId: string, chunkId: string, text: string, type: CaseChunkType }
 *   Returns: { ok: true }
 *
 * POST /case-query
 *   Body: { caseId: string, query: string, topK?: number }
 *   Returns: { results: CaseChunk[] }
 *
 * ─── INGESTION ───────────────────────────────────────────────────────────────
 * Call indexCaseChunks() from:
 *   - compressIntelligence() after writing the digest (so each compression
 *     produces a fresh indexed chunk).
 *   - CaseDocketTab.silentCompress() after folding entries into
 *     compressed_summary (so docket history is queryable, not just current).
 *
 * ─── SIZE THRESHOLD ──────────────────────────────────────────────────────────
 * shouldUseCaseRag() returns true when:
 *   - digest length > CASE_RAG_THRESHOLD chars, OR
 *   - docket entry count > CASE_RAG_ENTRY_THRESHOLD
 *
 * Below the threshold: useIntelligence() serves the full digest as before.
 * Above the threshold: engines call queryCaseHistory() and inject only the
 * relevant chunks, keeping the prompt lean.
 *
 * ─── WRANGLER PATCH (workers/rag-worker/wrangler.toml) ──────────────────────
 * Add this block below the existing [[vectorize]] stanza:
 *
 *   [[vectorize]]
 *   binding     = "CASE_HISTORY"
 *   index_name  = "afs-case-history"
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Base URL of the deployed Cloudflare Worker.
 * Leave empty during development — all calls silently no-op.
 * Same base as STATUTE_RAG_ENDPOINT; routes differ (/case-embed, /case-query).
 */
export const CASE_RAG_ENDPOINT = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';

/** localStorage key for the shared Worker auth secret (same as statute RAG). */
const CASE_RAG_SECRET_KEY = 'afs_rag_secret';

/**
 * Digest character length above which we switch from full-digest injection
 * to RAG-scoped retrieval. ~4 000 chars ≈ ~600 tokens — comfortable single
 * cached block. Above it, the digest starts to crowd out the prompt.
 */
export const CASE_RAG_THRESHOLD = 4_000;

/**
 * Docket entry count above which we also engage RAG, even if the digest is
 * short. A case with 30+ entries has almost certainly run for months and
 * deserves retrieval-scoped context.
 */
export const CASE_RAG_ENTRY_THRESHOLD = 25;

function getRagSecret(): string {
  try { return localStorage.getItem(CASE_RAG_SECRET_KEY) || ''; } catch { return ''; }
}

export function isCaseRagConfigured(): boolean {
  return Boolean(CASE_RAG_ENDPOINT);
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * What kind of case content a chunk represents.
 * Stored as metadata on every Vectorize vector so queries can be filtered
 * by type when only a subset is relevant.
 */
export type CaseChunkType =
  | 'digest'          // Intelligence digest snapshot (Phase 5 output)
  | 'docket_summary'  // Compressed docket summary block
  | 'evidence'        // Evidence vault AI analysis snippet
  | 'argument'        // Saved argument / written address excerpt
  | 'intel_package';  // Raw intPkg output from IntelligenceEngine

export interface CaseChunk {
  chunkId:   string;          // Unique ID within this case  (e.g. "digest-2025-03-01")
  caseId:    string;          // FK — which case this belongs to
  type:      CaseChunkType;
  text:      string;          // The actual content
  createdAt: string;          // ISO timestamp — used to prefer newer chunks
  score:     number;          // Cosine similarity 0–1 (set by worker on retrieval)
}

export interface CaseRagResult {
  chunks:  CaseChunk[];
  query:   string;
  skipped: boolean;           // true if endpoint not configured or call failed
  error?:  string;
}

// ── Size threshold guard ───────────────────────────────────────────────────────

/**
 * Returns true when this case is large enough to benefit from RAG-scoped
 * context retrieval rather than full-digest injection.
 *
 * Pass the Case object (or the two relevant scalars).
 * Both thresholds are conservative — err on the side of using the digest
 * until the case clearly outgrows it.
 */
export function shouldUseCaseRag(params: {
  digestLength:  number;   // activeCase.intelligence_data?.digest?.length ?? 0
  docketEntries: number;   // activeCase.recent_entries?.length ?? 0
}): boolean {
  if (!isCaseRagConfigured()) return false;
  return (
    params.digestLength  > CASE_RAG_THRESHOLD ||
    params.docketEntries > CASE_RAG_ENTRY_THRESHOLD
  );
}

// ── Ingestion ─────────────────────────────────────────────────────────────────

/**
 * Embeds one case chunk and upserts it into the `afs-case-history` Vectorize
 * index via the Worker's /case-embed route.
 *
 * Call this from:
 *   - compressIntelligence() after writing each digest snapshot
 *   - CaseDocketTab.silentCompress() after folding docket entries
 *   - EvidenceVault after persisting an AI analysis result
 *
 * Fire-and-forget safe — all errors are caught and logged; never throws.
 */
export async function indexCaseChunk(chunk: Omit<CaseChunk, 'score'>): Promise<void> {
  if (!CASE_RAG_ENDPOINT) return;
  if (!chunk.text?.trim()) return;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = getRagSecret();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    await fetch(`${CASE_RAG_ENDPOINT}/case-embed`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        caseId:    chunk.caseId,
        chunkId:   chunk.chunkId,
        text:      chunk.text.slice(0, 4096), // Vectorize embedding input cap
        type:      chunk.type,
        createdAt: chunk.createdAt,
      }),
    });
  } catch {
    // Indexing is best-effort — never surface errors.
  }
}

/**
 * Convenience wrapper: indexes an array of chunks in sequence.
 * Used when first activating RAG for a case that already has history.
 */
export async function indexCaseChunks(chunks: Array<Omit<CaseChunk, 'score'>>): Promise<void> {
  for (const chunk of chunks) {
    await indexCaseChunk(chunk);
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

/**
 * Queries the case's own history index for chunks relevant to `query`.
 *
 * - Scoped to this case via `caseId` metadata filter — never leaks
 *   one case's history into another.
 * - Falls back gracefully: if the endpoint is unconfigured, the call fails,
 *   or no chunks score above 0.50, returns { skipped: true }.
 * - Callers should fall back to the full digest when skipped === true.
 */
export async function queryCaseHistory(
  caseId: string,
  query:  string,
  options: { topK?: number; type?: CaseChunkType } = {},
): Promise<CaseRagResult> {
  if (!CASE_RAG_ENDPOINT || !caseId || !query.trim()) {
    return { chunks: [], query, skipped: true };
  }

  const { topK = 5, type } = options;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = getRagSecret();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const res = await fetch(`${CASE_RAG_ENDPOINT}/case-query`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        caseId:  caseId.trim(),
        query:   query.trim(),
        topK,
        ...(type ? { type } : {}),
      }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => `HTTP ${res.status}`);
      return { chunks: [], query, skipped: true, error: `Case RAG error ${res.status}: ${msg}` };
    }

    const data   = await res.json() as { results?: CaseChunk[] };
    const chunks = (data.results || []).filter(c => c.score > 0.50);

    return { chunks, query, skipped: chunks.length === 0 };

  } catch (e) {
    return {
      chunks:  [],
      query,
      skipped: true,
      error:   `Case RAG unreachable: ${(e as Error).message}`,
    };
  }
}

// ── Prompt formatting ─────────────────────────────────────────────────────────

/**
 * Formats retrieved case chunks into a block for injection into AI system
 * prompts — replaces or supplements the full digest when a case is large.
 *
 * Returns empty string if no chunks (callers fall back to full digest).
 */
export function formatCaseHistoryForPrompt(chunks: CaseChunk[], caseName: string): string {
  if (!chunks.length) return '';

  // Sort: highest score first, ties broken by newest createdAt
  const sorted = [...chunks].sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.02) return b.score - a.score;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const lines: string[] = [
    '══ CASE HISTORY — RETRIEVED CONTEXT ══',
    `(Semantic retrieval from ${caseName} case history. Most relevant chunks shown.)`,
    '(These are compressed summaries of earlier case stages — treat as authoritative internal record.)',
    '',
  ];

  sorted.forEach((c, i) => {
    const typeLabel: Record<CaseChunkType, string> = {
      digest:         'Intelligence Digest',
      docket_summary: 'Docket Summary',
      evidence:       'Evidence Analysis',
      argument:       'Saved Argument',
      intel_package:  'Intelligence Package',
    };
    lines.push(`[CASE HISTORY ${i + 1} — ${typeLabel[c.type] ?? c.type}]`);
    lines.push(`Recorded: ${c.createdAt.slice(0, 10)}`);
    lines.push('');
    lines.push(c.text);
    lines.push(`[/CASE HISTORY ${i + 1}]`);
    lines.push('');
  });

  lines.push('══ END OF CASE HISTORY ══');
  lines.push('');
  return lines.join('\n');
}

/**
 * Builds the RAG query string from the engine's context.
 * Mirrors buildRagQuery() in statuteRag.ts but draws from intelligence data.
 */
export function buildCaseRagQuery(params: {
  engineHint?:   string;   // e.g. "Written Address", "Cross Examination"
  legalIssues?:  string[];
  argIssue?:     string;
  caseName:      string;
}): string {
  const parts: string[] = [];
  if (params.argIssue?.trim())            parts.push(params.argIssue.trim());
  if (params.legalIssues?.length)         parts.push(params.legalIssues.slice(0, 3).join('. '));
  if (params.engineHint?.trim())          parts.push(params.engineHint.trim());
  if (!parts.length && params.caseName)   parts.push(params.caseName);
  return parts.join(' ').slice(0, 500);
}
