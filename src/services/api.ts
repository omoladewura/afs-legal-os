import type { ApiMessage, ApiRequestOptions } from '@/types';
import { queryLibrary, deriveQuery }           from './library';

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const API_KEY_STORAGE_KEY = 'afs_api_key';
const FALLBACK_KEY = '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';

function getApiKey(): string {
  try { return localStorage.getItem(API_KEY_STORAGE_KEY) || FALLBACK_KEY; } catch { return FALLBACK_KEY; }
}

export function saveApiKey(key: string): void {
  try { localStorage.setItem(API_KEY_STORAGE_KEY, key.trim()); } catch { /* ignore */ }
}

export function hasApiKey(): boolean {
  return true;
}

const DRIVE_MCP_SERVER = {
  type: 'url',
  url:  'https://drivemcp.googleapis.com/mcp/v1',
  name: 'google-drive',
};

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type':                              'application/json',
    'x-api-key':                                 getApiKey(),
    'anthropic-version':                         '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function injectLibrary(original: string | undefined, libraryBlock: string): string {
  if (!libraryBlock) return original || '';
  const base = original ? original.trim() : '';
  return base ? `${libraryBlock}\n${base}` : libraryBlock;
}

export async function callClaude(opts: ApiRequestOptions): Promise<string> {
  const {
    system,
    userMsg,
    messages,
    maxTokens   = 1500,
    mcpDrive    = false,
    skipLibrary = false,
    libraryOpts = {},
  } = opts;

  let enrichedSystem = system;

  if (!skipLibrary) {
    const firstUserText = userMsg
      ?? (Array.isArray(messages) && messages.length > 0
           ? (typeof messages[messages.length - 1].content === 'string'
               ? messages[messages.length - 1].content as string
               : '')
           : '');

    const query = deriveQuery(system, firstUserText, libraryOpts.queryHint);

    if (query.trim()) {
      const ctx = await queryLibrary(query, {
        topK:      libraryOpts.topK      ?? 8,
        namespace: libraryOpts.namespace,
        filter:    libraryOpts.filter,
        threshold: libraryOpts.threshold ?? 0.70,
      });

      if (ctx.ok && ctx.block) {
        enrichedSystem = injectLibrary(system, ctx.block);
      }
    }
  }

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

  if (enrichedSystem) body.system      = enrichedSystem;
  if (mcpDrive)       body.mcp_servers = [DRIVE_MCP_SERVER];

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: buildHeaders(),
      body:    JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(`Network error: ${(e as Error).message}`);
  }

  const data = await res.json();

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  return (data.content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');
}
