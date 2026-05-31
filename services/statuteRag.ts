/**
 * AFS Advocates — Statute RAG Service
 *
 * Connects ArgumentBuilder to your Cloudflare Workers AI + Vectorize
 * statute pipeline. One function: queryStatutes(query) → StatuteChunk[].
 *
 * ─── HOW TO ACTIVATE ────────────────────────────────────────────────────────
 * When your Cloudflare Worker is deployed:
 *   1. Set STATUTE_RAG_ENDPOINT below to your Worker's URL
 *      e.g. 'https://afs-rag.your-subdomain.workers.dev/query'
 *   2. If you add auth, set STATUTE_RAG_SECRET to match your Worker's
 *      expected header value (store it in localStorage like the API key).
 *   3. That's it. ArgumentBuilder calls this automatically on every generation.
 *
 * ─── CLOUDFLARE WORKER CONTRACT ─────────────────────────────────────────────
 * Your Worker must accept:
 *   POST /query
 *   Content-Type: application/json
 *   Body: { query: string, topK?: number, areaOfLaw?: string }
 *
 * And return:
 *   { results: StatuteChunk[] }
 *
 * Where StatuteChunk matches the interface below.
 *
 * ─── WORKER IMPLEMENTATION SKETCH ───────────────────────────────────────────
 * Inside your Cloudflare Worker (wrangler):
 *
 *   export default {
 *     async fetch(req, env) {
 *       const { query, topK = 5, areaOfLaw } = await req.json();
 *
 *       // 1. Embed the query using Workers AI
 *       const { data } = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
 *         text: [query],
 *       });
 *       const queryVector = data[0];
 *
 *       // 2. Search Vectorize
 *       const matches = await env.VECTORIZE.query(queryVector, {
 *         topK,
 *         filter: areaOfLaw ? { areaOfLaw } : undefined,
 *         returnMetadata: true,
 *       });
 *
 *       // 3. Shape results
 *       const results = matches.matches.map(m => ({
 *         actName:    m.metadata.actName,
 *         section:    m.metadata.section,
 *         sectionTitle: m.metadata.sectionTitle,
 *         text:       m.metadata.text,
 *         areaOfLaw:  m.metadata.areaOfLaw,
 *         score:      m.score,
 *       }));
 *
 *       return Response.json({ results });
 *     }
 *   }
 *
 * ─── INGESTION SKETCH (for loading your PDFs) ───────────────────────────────
 * Use a one-time script (Node.js or Python) to:
 *   1. Parse each Act PDF into sections (by section number heading)
 *   2. For each section, call Workers AI to embed the text
 *   3. Insert into Vectorize with metadata:
 *      { actName, section, sectionTitle, text, areaOfLaw }
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Set this to your deployed Cloudflare Worker URL when ready.
 * Leave as empty string during development — RAG will be silently skipped.
 */
export const STATUTE_RAG_ENDPOINT = '';

/**
 * Optional: bearer token / shared secret your Worker validates.
 * Store in localStorage under this key, same pattern as the API key.
 */
const STATUTE_RAG_SECRET_KEY = 'afs_rag_secret';

function getRagSecret(): string {
  try { return localStorage.getItem(STATUTE_RAG_SECRET_KEY) || ''; } catch { return ''; }
}

export function saveRagSecret(secret: string): void {
  try { localStorage.setItem(STATUTE_RAG_SECRET_KEY, secret.trim()); } catch { /* ignore */ }
}

export function isRagConfigured(): boolean {
  return Boolean(STATUTE_RAG_ENDPOINT);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StatuteChunk {
  actName:       string;   // e.g. "Companies and Allied Matters Act 2020"
  section:       string;   // e.g. "Section 131"
  sectionTitle:  string;   // e.g. "Incorporation of company"
  text:          string;   // The actual section text
  areaOfLaw:     string;   // e.g. "Company Law"
  score:         number;   // Cosine similarity 0–1
}

export interface StatuteRagResult {
  chunks:  StatuteChunk[];
  query:   string;
  skipped: boolean;   // true if endpoint not configured or call failed gracefully
  error?:  string;
}

// ── Core query function ───────────────────────────────────────────────────────

/**
 * Query the statute RAG pipeline.
 *
 * - If STATUTE_RAG_ENDPOINT is empty, returns { skipped: true } immediately.
 * - If the call fails for any reason, returns { skipped: true, error } so the
 *   caller can proceed without statutes rather than blocking generation.
 * - Never throws — all errors are caught and surfaced via the result object.
 */
export async function queryStatutes(
  query:      string,
  options:    { topK?: number; areaOfLaw?: string } = {},
): Promise<StatuteRagResult> {
  if (!STATUTE_RAG_ENDPOINT || !query.trim()) {
    return { chunks: [], query, skipped: true };
  }

  const { topK = 5, areaOfLaw } = options;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const secret = getRagSecret();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const res = await fetch(STATUTE_RAG_ENDPOINT, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ query: query.trim(), topK, areaOfLaw }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => `HTTP ${res.status}`);
      return { chunks: [], query, skipped: true, error: `RAG error ${res.status}: ${msg}` };
    }

    const data = await res.json() as { results?: StatuteChunk[] };
    const chunks = (data.results || []).filter(c => c.score > 0.5); // relevance threshold

    return { chunks, query, skipped: false };

  } catch (e) {
    return {
      chunks:  [],
      query,
      skipped: true,
      error:   `RAG unreachable: ${(e as Error).message}`,
    };
  }
}

// ── Format for prompt injection ───────────────────────────────────────────────

/**
 * Formats retrieved statute chunks into a clean block for injection into
 * the ArgumentBuilder prompt. Returns empty string if no chunks.
 */
export function formatStatutesForPrompt(chunks: StatuteChunk[]): string {
  if (!chunks.length) return '';

  const lines: string[] = [
    '══ VERIFIED STATUTE SECTIONS — RETRIEVED FROM YOUR LIBRARY ══',
    '(These sections were retrieved by semantic search from your verified statute collection.',
    ' Cite them directly and accurately — do NOT paraphrase the section text.)',
    '',
  ];

  chunks.forEach((c, i) => {
    lines.push(`[STATUTE ${i + 1}]`);
    lines.push(`Act: ${c.actName}`);
    lines.push(`${c.section}${c.sectionTitle ? ` — ${c.sectionTitle}` : ''}`);
    lines.push(`Area of Law: ${c.areaOfLaw}`);
    lines.push(`Text:`);
    lines.push(c.text);
    lines.push(`[/STATUTE ${i + 1}]`);
    lines.push('');
  });

  lines.push(
    'When citing these statutes in the argument, use this format:',
    'Section [X], [Full Act Name] — "[relevant portion of section text]"',
    'Never modify or paraphrase the section text when quoting.',
  );

  return lines.join('\n');
}

/**
 * Builds the RAG query string from the argument context.
 * Combines the legal issue + argument type to maximise retrieval relevance.
 */
export function buildRagQuery(params: {
  argIssue:   string;
  argType:    string;
  legalIssues: string[];
  caseName:   string;
}): string {
  const parts: string[] = [];
  if (params.argIssue.trim())         parts.push(params.argIssue.trim());
  if (params.legalIssues.length)      parts.push(params.legalIssues.slice(0, 3).join('. '));
  if (parts.length === 0 && params.caseName) parts.push(params.caseName);
  return parts.join(' ').slice(0, 500); // Vectorize query length limit
}
