/**
 * AFS Advocates — Cloudflare Worker: Legal Library RAG + Case Sync + Claude Chat
 *
 * Endpoints:
 *
 *   POST /chat                      — proxy Claude API call (key never in browser)
 *   POST /embed                     — embed a query string via Workers AI
 *   POST /query                     — query Vectorize with an embedding vector
 *
 *   GET  /cases                     — load all cases from D1
 *   PUT  /case                      — upsert a case in D1
 *   DELETE /case?id=x               — delete a case and all related records
 *
 *   GET  /entries?caseId=x          — load docket entries for a case
 *   PUT  /entry                     — upsert a docket entry
 *   DELETE /entry?id=x              — delete a docket entry
 *
 *   GET  /deadlines?caseId=x        — load deadlines for a case
 *   PUT  /deadline                  — upsert a deadline
 *   DELETE /deadline?id=x           — delete a deadline
 *
 *   GET  /research?caseId=x         — load research records for a case
 *   PUT  /research                  — upsert a research record
 *   DELETE /research?id=x           — delete a research record
 */

export interface Env {
  VECTORIZE:          Vectorize;
  AI:                 Ai;
  DB:                 D1Database;
  R2:                 R2Bucket;
  AUTH_TOKEN?:        string;
  ANTHROPIC_API_KEY?: string;
}

function cors(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200, origin?: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

function authorized(req: Request, env: Env): boolean {
  if (!env.AUTH_TOKEN) return true;
  const header = req.headers.get('Authorization') || '';
  return header === `Bearer ${env.AUTH_TOKEN}`;
}

async function ensureTables(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS cases (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entries (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS deadlines (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS evidence_meta (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'API key not configured' }, 500, origin);
  }

  const body = await req.json() as Record<string, unknown>;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      body.model      ?? 'claude-sonnet-4-5',
      max_tokens: body.max_tokens ?? 1500,
      system:     body.system,
      messages:   body.messages,
    }),
  });

  const data = await res.json();
  return json(data, res.status, origin);
}

async function handleEmbed(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const body = await req.json() as { text?: string };
  if (!body.text) return json({ error: 'text is required' }, 400, origin);
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [body.text.slice(0, 2048)],
  }) as { data: number[][] };
  return json({ embedding: result.data[0] }, 200, origin);
}

async function handleQuery(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const body = await req.json() as {
    embedding?:      number[];
    topK?:           number;
    namespace?:      string;
    filter?:         Record<string, string>;
  };
  if (!body.embedding || !Array.isArray(body.embedding)) {
    return json({ error: 'embedding array is required' }, 400, origin);
  }
  const queryOpts: VectorizeQueryOptions = {
    topK:           Math.min(body.topK ?? 8, 20),
    returnMetadata: 'all',
  };
  if (body.namespace) queryOpts.namespace = body.namespace;
  if (body.filter)    queryOpts.filter    = body.filter;
  const results = await env.VECTORIZE.query(body.embedding, queryOpts);
  return json({ matches: results.matches }, 200, origin);
}

async function handleGetCases(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const rows = await env.DB.prepare('SELECT data FROM cases ORDER BY json_extract(data, "$.createdAt") DESC').all();
  const cases = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ cases }, 200, origin);
}

async function handlePutCase(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string };
  if (!body.id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO cases (id, data) VALUES (?, ?)')
    .bind(body.id, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteCase(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM entries WHERE case_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM deadlines WHERE case_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM research WHERE case_id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

async function handleGetEntries(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare('SELECT data FROM entries WHERE case_id = ? ORDER BY json_extract(data, "$.dateFiled") DESC').bind(caseId).all();
  const entries = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ entries }, 200, origin);
}

async function handlePutEntry(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO entries (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteEntry(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

async function handleGetDeadlines(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare('SELECT data FROM deadlines WHERE case_id = ? ORDER BY json_extract(data, "$.date") ASC').bind(caseId).all();
  const deadlines = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ deadlines }, 200, origin);
}

async function handlePutDeadline(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO deadlines (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteDeadline(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM deadlines WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

async function handleGetResearch(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare('SELECT data FROM research WHERE case_id = ? ORDER BY json_extract(data, "$.savedAt") DESC').bind(caseId).all();
  const records = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ records }, 200, origin);
}

async function handlePutResearch(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO research (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteResearch(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM research WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Evidence Metadata (D1) ────────────────────────────────────────────────────

async function handleGetEvidenceMeta(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url    = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare(
    'SELECT data FROM evidence_meta WHERE case_id = ? ORDER BY json_extract(data, "$.timestamp") DESC'
  ).bind(caseId).all();
  const items = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ items }, 200, origin);
}

async function handlePutEvidenceMeta(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO evidence_meta (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteEvidenceMeta(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM evidence_meta WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Evidence Files (R2) ───────────────────────────────────────────────────────

async function handleUploadEvidenceFile(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const url    = new URL(req.url);
  const id     = url.searchParams.get('id');
  const caseId = url.searchParams.get('caseId');
  if (!id || !caseId) return json({ error: 'id and caseId are required' }, 400, origin);

  const contentType = req.headers.get('Content-Type') || 'application/octet-stream';
  const key = `evidence/${caseId}/${id}`;

  await env.R2.put(key, req.body, {
    httpMetadata: { contentType },
  });

  return json({ ok: true, key }, 200, origin);
}

async function handleGetEvidenceFile(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const url    = new URL(req.url);
  const id     = url.searchParams.get('id');
  const caseId = url.searchParams.get('caseId');
  if (!id || !caseId) return json({ error: 'id and caseId are required' }, 400, origin);

  const key = `evidence/${caseId}/${id}`;
  const obj = await env.R2.get(key);
  if (!obj) return json({ error: 'File not found' }, 404, origin);

  const headers = new Headers(cors(origin));
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${id}"`);
  return new Response(obj.body, { status: 200, headers });
}

async function handleDeleteEvidenceFile(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const url    = new URL(req.url);
  const id     = url.searchParams.get('id');
  const caseId = url.searchParams.get('caseId');
  if (!id || !caseId) return json({ error: 'id and caseId are required' }, 400, origin);

  await env.R2.delete(`evidence/${caseId}/${id}`);
  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') || '*';

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (!authorized(req, env)) {
      return json({ error: 'Unauthorized' }, 401, origin);
    }

    const url    = new URL(req.url);
    const path   = url.pathname;
    const method = req.method;

    if (method === 'POST' && path === '/chat')   return handleChat(req, env);
    if (method === 'POST' && path === '/embed')  return handleEmbed(req, env);
    if (method === 'POST' && path === '/query')  return handleQuery(req, env);

    if (method === 'GET'    && path === '/cases')     return handleGetCases(req, env);
    if (method === 'PUT'    && path === '/case')      return handlePutCase(req, env);
    if (method === 'DELETE' && path === '/case')      return handleDeleteCase(req, env);

    if (method === 'GET'    && path === '/entries')   return handleGetEntries(req, env);
    if (method === 'PUT'    && path === '/entry')     return handlePutEntry(req, env);
    if (method === 'DELETE' && path === '/entry')     return handleDeleteEntry(req, env);

    if (method === 'GET'    && path === '/deadlines') return handleGetDeadlines(req, env);
    if (method === 'PUT'    && path === '/deadline')  return handlePutDeadline(req, env);
    if (method === 'DELETE' && path === '/deadline')  return handleDeleteDeadline(req, env);

    if (method === 'GET'    && path === '/research')  return handleGetResearch(req, env);
    if (method === 'PUT'    && path === '/research')  return handlePutResearch(req, env);
    if (method === 'DELETE' && path === '/research')  return handleDeleteResearch(req, env);

    if (method === 'GET'    && path === '/evidence/meta')   return handleGetEvidenceMeta(req, env);
    if (method === 'PUT'    && path === '/evidence/meta')   return handlePutEvidenceMeta(req, env);
    if (method === 'DELETE' && path === '/evidence/meta')   return handleDeleteEvidenceMeta(req, env);
    if (method === 'POST'   && path === '/evidence/file')   return handleUploadEvidenceFile(req, env);
    if (method === 'GET'    && path === '/evidence/file')   return handleGetEvidenceFile(req, env);
    if (method === 'DELETE' && path === '/evidence/file')   return handleDeleteEvidenceFile(req, env);

    return json({ error: 'Not found' }, 404, origin);
  },
};
