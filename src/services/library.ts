const WORKER_URL   = 'https://afs-legal-rag.sobambodeshupo.workers.dev';
const WORKER_TOKEN = 'AFS2026SecureToken99';

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
  topK?:       number;
  namespace?:  string;
  filter?:     Record<string, string>;
  threshold?:  number;
}

export interface LibraryContext {
  block:   string;
  matches: LibraryMatch[];
  ok:      boolean;
  error?:  string;
}

export function getWorkerUrl(): string { return WORKER_URL; }
export function getWorkerToken(): string { return WORKER_TOKEN; }
export function hasWorkerUrl(): boolean { return true; }
export function saveWorkerUrl(_url: string): void {}
export function saveWorkerToken(_token: string): void {}

function workerHeaders(): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${WORKER_TOKEN}`,
  };
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${WORKER_URL}/embed`, {
    method:  'POST',
    headers: workerHeaders(),
    body:    JSON.stringify({ text: text.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Embed failed: HTTP ${res.status}`);
  const data = await res.json() as { embedding: number[] };
  return data.embedding;
}

async function vectorQuery(
  embedding: number[],
  opts:      LibraryQueryOpts,
): Promise<LibraryMatch[]> {
  const body: Record<string, unknown> = {
    embedding,
    topK:           opts.topK ?? 8,
    returnMetadata: 'all',
  };
  if (opts.namespace) body.namespace = opts.namespace;
  if (opts.filter)    body.filter    = opts.filter;

  const res = await fetch(`${WORKER_URL}/query`, {
    method:  'POST',
    headers: workerHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Vectorize query failed: HTTP ${res.status}`);
  const data = await res.json() as { matches: LibraryMatch[] };

  const threshold = opts.threshold ?? 0.70;
  return (data.matches || []).filter(m => m.score >= threshold);
}

function formatLibraryBlock(matches: LibraryMatch[]): string {
  if (matches.length === 0) return '';

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

  renderGroup('Case Authorities',      '§', authorities);
  renderGroup('Statutes & Provisions', '⚖', statutes);
  renderGroup('Research Notes',        '◉', research);
  renderGroup('Precedent Documents',   '↑', precedents);
  renderGroup('Pleadings & Drafts',    '◈', pleadings);
  renderGroup('Other Library Materials','·', other);

  lines.push('══ END OF LIBRARY CONTEXT ══');
  lines.push('');

  return lines.join('\n');
}

export async function queryLibrary(
  queryText: string,
  opts:      LibraryQueryOpts = {},
): Promise<LibraryContext> {
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

export function deriveQuery(
  system?:  string,
  userMsg?: string,
  extra?:   string,
): string {
  const parts = [extra, userMsg, system].filter(Boolean) as string[];
  return parts.map(p => p.slice(0, 200)).join(' ').slice(0, 600);
}
