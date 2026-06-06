import type { ApiMessage, ApiRequestOptions } from '@/types';

export const CLAUDE_MODEL = 'claude-sonnet-4-6';

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
    maxTokens   = 1500,
    mcpDrive    = false,
    libraryOpts = {},
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
    engine:     libraryOpts.queryHint || 'unknown',
  };

  if (system)    body.system = system;
  if (mcpDrive)  body.mcp_servers = [{
    type: 'url',
    url:  'https://drivemcp.googleapis.com/mcp/v1',
    name: 'google-drive',
  }];
  if (libraryOpts.namespace) body.jurisdiction = libraryOpts.namespace;

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
