export interface Env {
  VECTORIZE: Vectorize;
  AI: Ai;
  AUTH_TOKEN?: string;
}

function cors(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    embedding?: number[];
    topK?: number;
    namespace?: string;
    filter?: Record<string, string>;
  };
  if (!body.embedding || !Array.isArray(body.embedding)) {
    return json({ error: 'embedding array is required' }, 400, origin);
  }
  const queryOpts: VectorizeQueryOptions = {
    topK: Math.min(body.topK ?? 8, 20),
    returnMetadata: 'all',
  };
  if (body.namespace) queryOpts.namespace = body.namespace;
  if (body.filter) queryOpts.filter = body.filter;
  const results = await env.VECTORIZE.query(body.embedding, queryOpts);
  return json({ matches: results.matches }, 200, origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') || '*';
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }
    if (!authorized(req, env)) {
      return json({ error: 'Unauthorized' }, 401, origin);
    }
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/embed': return handleEmbed(req, env);
      case '/query': return handleQuery(req, env);
      default: return json({ error: 'Not found' }, 404, origin);
    }
  },
};
