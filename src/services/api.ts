import type { ApiMessage, ApiRequestOptions } from '@/types';

export const CLAUDE_MODEL = 'claude-sonnet-4-5';

const WORKER_URL = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const AUTH_TOKEN = 'AFS2026SecureToken99';

export function saveApiKey(key: string): void {
  try { localStorage.setItem('afs_api_key', key.trim()); } catch { }
}

export function hasApiKey(): boolean {
  return true;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function callClaude(opts: ApiRequestOptions): Promise<string> {
  const {
    system,
    userMsg,
    messages,
    maxTokens    = 1500,
    mcpDrive     = false,
    skipLibrary  = false,
    libraryOpts  = {},
    matter_track,
    counsel_role,
  } = opts;

  const msgs: ApiMessage[] = messages
    ?? (userMsg ? [{ role: 'user', content: userMsg }] : []);

  if (msgs.length === 0) {
    throw new ApiError('No messages provided to callClaude.');
  }

  const body: Record<string, unknown> = {
    model:      CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages:   msgs,
  };

  if (skipLibrary) {
    // Tell the worker to bypass RAG entirely — no embed call, no Vectorize
    // query, no R2 fetches, no irrelevant library text injected into system.
    body.skip_library = true;
  } else {
    body.engine = libraryOpts.queryHint || 'unknown';
    if (libraryOpts.namespace)  body.jurisdiction  = libraryOpts.namespace;
    if (libraryOpts.filter)     body.rag_filter    = libraryOpts.filter;
    if (libraryOpts.topK)       body.rag_top_k     = libraryOpts.topK;
    if (libraryOpts.threshold)  body.rag_threshold = libraryOpts.threshold;
  }

  if (system) {
    // Mark the system prompt as cacheable. By convention every call site
    // builds `system` from buildRoleSystemPrompt() + case intelligence
    // context (fullContext) — content that repeats byte-for-byte across many
    // calls in a session. The volatile part (current draft / instruction)
    // already lives in `messages` below, which is sent fresh and untouched.
    // cache_control flags this block so Anthropic serves repeats from cache
    // at ~10% of base input price instead of full price every call.
    body.system = [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ];
  }
  if (mcpDrive)     body.mcp_servers = [{
    type: 'url',
    url:  'https://drivemcp.googleapis.com/mcp/v1',
    name: 'google-drive',
  }];
  // Role context — sent to Worker for role-aware retrieval and logging
  if (counsel_role)   body.counsel_role  = counsel_role;
  if (matter_track)   body.matter_track  = matter_track;

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(`Network error: ${(e as Error).message}`);
  }

  const data = await res.json();

  if (!res.ok || (data as any).error) {
    const msg = (data as any).error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  return ((data as any).content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');
}
