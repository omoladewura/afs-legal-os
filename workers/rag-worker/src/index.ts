export interface Env {
  ANTHROPIC_API_KEY: string;
  AUTH_TOKEN: string;
  AI: any;
  VECTORIZE: any;
  DB: D1Database;
  R2: R2Bucket;
}

const CORS = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

function json(data: any, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS(origin) },
  });
}

function authorized(req: Request, env: Env) {
  if (!env.AUTH_TOKEN) return true;
  const header = req.headers.get('Authorization') || '';
  return header === `Bearer ${env.AUTH_TOKEN}`;
}

// ── /embed ────────────────────────────────────────────────────────────────────
async function handleEmbed(req: Request, env: Env) {
  const origin = req.headers.get('Origin') || '*';
  const body: any = await req.json();
  if (!body.text) return json({ error: 'text is required' }, 400, origin);
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [body.text.slice(0, 2048)],
  });
  return json({ embedding: result.data[0] }, 200, origin);
}

// ── /query ────────────────────────────────────────────────────────────────────
async function handleQuery(req: Request, env: Env) {
  const origin = req.headers.get('Origin') || '*';
  const body: any = await req.json();
  if (!body.embedding || !Array.isArray(body.embedding))
    return json({ error: 'embedding array is required' }, 400, origin);
  const queryOpts: any = {
    topK: Math.min(body.topK ?? 8, 20),
    returnMetadata: 'all',
  };
  if (body.namespace) queryOpts.namespace = body.namespace;
  if (body.filter) queryOpts.filter = body.filter;
  const results = await env.VECTORIZE.query(body.embedding, queryOpts);
  return json({ matches: results.matches }, 200, origin);
}

// ── /chat ─────────────────────────────────────────────────────────────────────
async function handleChat(req: Request, env: Env) {
  const origin = req.headers.get('Origin') || '*';
  const body: any = await req.json();

  if (!body.messages || !Array.isArray(body.messages))
    return json({ error: 'messages array is required' }, 400, origin);

  // 1. Embed the last user message for RAG
  let ragBlock = '';
  try {
    const lastUser = [...body.messages].reverse().find((m: any) => m.role === 'user');
    const userText = typeof lastUser?.content === 'string'
      ? lastUser.content
      : lastUser?.content?.find((c: any) => c.type === 'text')?.text || '';

    if (userText.trim()) {
      const embedResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: [userText.slice(0, 2048)],
      });
      const embedding = embedResult.data[0];

      const queryOpts: any = { topK: 8, returnMetadata: 'all' };
      if (body.jurisdiction) queryOpts.filter = { jurisdiction: body.jurisdiction };

      const vectorResults = await env.VECTORIZE.query(embedding, queryOpts);
      const matches = vectorResults.matches || [];

      if (matches.length > 0) {
        const chunks = await Promise.all(
          matches
            .filter((m: any) => m.score >= 0.70)
            .slice(0, 8)
            .map(async (m: any) => {
              try {
                const key = m.metadata?.r2_key || m.id;
                const obj = await env.R2.get(key);
                if (obj) return await obj.text();
              } catch {}
              return m.metadata?.text || '';
            })
        );
        const validChunks = chunks.filter(Boolean);
        if (validChunks.length > 0) {
          ragBlock = `[RETRIEVED LEGAL SOURCES]\n${validChunks.join('\n---\n')}\n[END RETRIEVED SOURCES]\n\n`;
        }
      }
    }
  } catch (e) {
    // RAG failure is non-fatal — continue without it
  }

  // 2. Build system prompt with RAG injected
  const systemPrompt = ragBlock
    ? `${ragBlock}${body.system || ''}`
    : (body.system || '');

  // 3. Call Anthropic
  const payload: any = {
    model: body.model || 'claude-sonnet-4-6',
    max_tokens: body.max_tokens || 1500,
    messages: body.messages,
  };
  if (systemPrompt) payload.system = systemPrompt;
  if (body.mcp_servers) payload.mcp_servers = body.mcp_servers;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  // 4. Log to D1
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tokens = (data as any).usage?.input_tokens + (data as any).usage?.output_tokens || 0;
    await env.DB.prepare(
      'INSERT INTO query_log (id, engine, query_hash, tokens_used, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, body.engine || 'unknown', body.query_hash || '', tokens, now).run();
  } catch {}

  return json(data, res.status, origin);
}

// ── /cases ────────────────────────────────────────────────────────────────────
async function handleCases(req: Request, env: Env) {
  const origin = req.headers.get('Origin') || '*';
  const url = new URL(req.url);
  const method = req.method;

  if (method === 'GET') {
    const results = await env.DB.prepare(
      'SELECT * FROM cases ORDER BY updated_at DESC'
    ).all();
    return json({ cases: results.results }, 200, origin);
  }

  if (method === 'POST') {
    const body: any = await req.json();
    const id = body.id || crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO cases (id, title, client, matter_type, court, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, client=excluded.client,
         matter_type=excluded.matter_type, court=excluded.court,
         status=excluded.status, notes=excluded.notes, updated_at=excluded.updated_at`
    ).bind(
      id, body.title || 'Untitled', body.client || '',
      body.matter_type || '', body.court || '',
      body.status || 'active', body.notes || '', now, now
    ).run();
    return json({ id, ok: true }, 200, origin);
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400, origin);
    await env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'Method not allowed' }, 405, origin);
}

// ── Main router ───────────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') || '*';

    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS(origin) });

    if (!authorized(req, env))
      return json({ error: 'Unauthorized' }, 401, origin);

    const url = new URL(req.url);
    switch (url.pathname) {
      case '/embed': return handleEmbed(req, env);
      case '/query': return handleQuery(req, env);
      case '/chat':  return handleChat(req, env);
      case '/cases': return handleCases(req, env);
      default:       return json({ error: 'Not found' }, 404, origin);
    }
  },
};
