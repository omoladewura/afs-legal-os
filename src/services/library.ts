/**
 * AFS Advocates — Library RAG Service
 *
 * Every AI call in the system runs through here FIRST.
 * This queries your Cloudflare Vectorize index to retrieve relevant
 * authorities, statutes, precedents, and research notes before
 * the prompt reaches Claude.
 *
 * The result is injected as a mandatory section in every system prompt —
 * so Claude ALWAYS reasons from your library first, then supplements
 * from its own knowledge where your library is silent.
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────────
 *
 *  1. queryLibrary(queryText, opts) embeds the query text via your
 *     Cloudflare Worker's /embed endpoint, then queries Vectorize.
 *
 *  2. The top-k results are formatted as a structured LIBRARY CONTEXT block.
 *
 *  3. callClaude() in api.ts prepends this block to the system prompt
 *     before every single request — no engine needs to change.
 *
 * ── YOUR CLOUDFLARE WORKER ───────────────────────────────────────────────────
 *
 *  Your Worker must expose two endpoints:
 *
 *  POST /embed
 *    Body:  { text: string }
 *    Reply: { embedding: number[] }
 *
 *  POST /query
 *    Body:  { embedding: number[], topK: number, namespace?: string,
 *             filter?: Record<string, string> }
 *    Reply: { matches: VectorizeMatch[] }
 *
 *  Each vector in your index should have metadata shaped like:
 *    {
 *      type:       'authority' | 'statute' | 'research' | 'pleading' | 'precedent',
 *      title:      string,   // e.g. "Adeleke v. INEC (2023) SC"
 *      body:       string,   // the full text chunk
 *      citation?:  string,
 *      court?:     string,
 *      year?:      string,
 *      statSection?: string, // e.g. "Evidence Act 2011 s.83"
 *      caseId?:    string,   // restrict to a specific matter
 *      tags?:      string,   // comma-separated
 *    }
 *
 * ── CONFIGURATION ─────────────────────────────────────────────────────────────
 *  Set your Worker URL in localStorage key: afs_worker_url
 *  e.g.  https://afs-legal-rag.your-subdomain.workers.dev
 *
 *  Optional: set afs_worker_token for Bearer auth if your Worker is protected.
 */

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEYS
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_URL_KEY   = 'afs_worker_url';
const WORKER_TOKEN_KEY = 'afs_worker_token';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface LibraryMatch {
  score:    number;
  metadata: {
    type:        string;
    title:       string;
    body:        string;
    citation?:   string;
    court?:      string;
    year?:       string;
    statSection?: string;
    caseId?:     string;
    tags?:       string;
  };
}

export interface LibraryQueryOpts {
  /** How many results to pull. Default: 8. Increase for complex queries. */
  topK?:       number;
  /** Optional Vectorize namespace (e.g. 'statutes', 'authorities', 'research') */
  namespace?:  string;
  /** Optional metadata filter — e.g. { caseId: 'abc123' } or { type: 'statute' } */
  filter?:     Record<string, string>;
  /** Minimum similarity score to include (0–1). Default: 0.70 */
  threshold?:  number;
}

export interface LibraryContext {
  /** Formatted block ready to inject into a system prompt */
  block:   string;
  /** Raw matches for inspection / debugging */
  matches: LibraryMatch[];
  /** Whether the library was reachable */
  ok:      boolean;
  /** Error message if not ok */
  error?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getWorkerUrl(): string {
  try { return localStorage.getItem(WORKER_URL_KEY) || ''; } catch { return ''; }
}

export function saveWorkerUrl(url: string): void {
  try { localStorage.setItem(WORKER_URL_KEY, url.trim()); } catch { /* ignore */ }
}

export function getWorkerToken(): string {
  try { return localStorage.getItem(WORKER_TOKEN_KEY) || ''; } catch { return ''; }
}

export function saveWorkerToken(token: string): void {
  try { localStorage.setItem(WORKER_TOKEN_KEY, token.trim()); } catch { /* ignore */ }
}

export function hasWorkerUrl(): boolean {
  return Boolean(getWorkerUrl());
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADERS
// ─────────────────────────────────────────────────────────────────────────────

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getWorkerToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMBED
// ─────────────────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const url = getWorkerUrl();
  if (!url) throw new Error('No Worker URL configured');

  const res  = await fetch(`${url}/embed`, {
    method:  'POST',
    headers: workerHeaders(),
    body:    JSON.stringify({ text: text.slice(0, 2000) }), // cap for embedding
  });
  if (!res.ok) throw new Error(`Embed failed: HTTP ${res.status}`);
  const data = await res.json() as { embedding: number[] };
  return data.embedding;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY VECTORIZE
// ─────────────────────────────────────────────────────────────────────────────

async function vectorQuery(
  embedding: number[],
  opts:      LibraryQueryOpts,
): Promise<LibraryMatch[]> {
  const url = getWorkerUrl();
  const body: Record<string, unknown> = {
    embedding,
    topK:      opts.topK      ?? 8,
    returnMetadata: 'all',
  };
  if (opts.namespace) body.namespace = opts.namespace;
  if (opts.filter)    body.filter    = opts.filter;

  const res  = await fetch(`${url}/query`, {
    method:  'POST',
    headers: workerHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Vectorize query failed: HTTP ${res.status}`);
  const data = await res.json() as { matches: LibraryMatch[] };

  const threshold = opts.threshold ?? 0.70;
  return (data.matches || []).filter(m => m.score >= threshold);
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT RESULTS → SYSTEM PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function formatLibraryBlock(matches: LibraryMatch[]): string {
  if (matches.length === 0) return '';

  // Group by type for a cleaner structured block
  const authorities = matches.filter(m => m.metadata.type === 'authority');
  const statutes    = matches.filter(m => m.metadata.type === 'statute');
  const research    = matches.filter(m => m.metadata.type === 'research');
  const pleadings   = matches.filter(m => m.metadata.type === 'pleading');
  const precedents  = matches.filter(m => m.metadata.type === 'precedent');
  const other       = matches.filter(m =>
    !['authority','statute','research','pleading','precedent'].includes(m.metadata.type)
  );

  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════════╗',
    '║          AFS LIBRARY — MANDATORY FIRST REFERENCE                ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    'INSTRUCTION: The following materials are retrieved from AFS Advocates\'',
    'private legal library. You MUST reason from these first. Do not contradict',
    'them. Where they are silent, supplement from general knowledge but clearly',
    'distinguish library-sourced reasoning from your own inference.',
    '',
  ];

  function renderGroup(label: string, icon: string, items: LibraryMatch[]) {
    if (!items.length) return;
    lines.push(`── ${icon} ${label.toUpperCase()} (${items.length}) ──`);
    items.forEach((m, i) => {
      const md = m.metadata;
      lines.push(`${i + 1}. ${md.title}`);
      if (md.citation)    lines.push(`   Citation:  ${md.citation}`);
      if (md.court)       lines.push(`   Court:     ${md.court}${md.year ? ` (${md.year})` : ''}`);
      if (md.statSection) lines.push(`   Section:   ${md.statSection}`);
      lines.push(`   ${md.body.slice(0, 500)}${md.body.length > 500 ? '…' : ''}`);
      lines.push('');
    });
  }

  renderGroup('Case Authorities',     '§', authorities);
  renderGroup('Statutes & Provisions', '⚖', statutes);
  renderGroup('Research Notes',        '◉', research);
  renderGroup('Precedent Documents',   '↑', precedents);
  renderGroup('Pleadings & Drafts',    '◈', pleadings);
  renderGroup('Other Library Materials','·', other);

  lines.push('══ END OF LIBRARY CONTEXT ══');
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — queryLibrary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query your Cloudflare Vectorize library with the given query text.
 * Returns a LibraryContext with a formatted block ready to inject
 * into any system prompt, plus the raw matches.
 *
 * Never throws — always returns ok: false with an error message
 * so a failed library lookup degrades gracefully without breaking generation.
 */
export async function queryLibrary(
  queryText: string,
  opts:      LibraryQueryOpts = {},
): Promise<LibraryContext> {
  if (!hasWorkerUrl()) {
    return {
      block:   '',
      matches: [],
      ok:      false,
      error:   'No Cloudflare Worker URL configured (Settings → Library)',
    };
  }

  try {
    const embedding = await embed(queryText);
    const matches   = await vectorQuery(embedding, opts);
    const block     = formatLibraryBlock(matches);

    return { block, matches, ok: true };
  } catch (err) {
    console.warn('[AFS Library] Query failed:', err);
    return {
      block:   '',
      matches: [],
      ok:      false,
      error:   (err as Error).message || 'Library query failed',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE — build a query string from engine context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a semantic query string from whatever the engine is working on.
 * Pass the system prompt, user message, or a summary — we'll use the
 * first 600 chars as the embedding query.
 */
export function deriveQuery(
  system?:  string,
  userMsg?: string,
  extra?:   string,
): string {
  const parts = [extra, userMsg, system].filter(Boolean) as string[];
  return parts.map(p => p.slice(0, 200)).join(' ').slice(0, 600);
}
