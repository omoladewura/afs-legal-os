/**
 * AFS Advocates — Anthropic API Service
 *
 * Thin, clean wrapper around the Anthropic /v1/messages endpoint.
 * All AI calls in the system route through here — never raw fetch().
 *
 * ARCHITECTURE NOTE:
 * This is intentionally simple. A single callClaude() function handles
 * all AI requests. Engine-specific prompts live in the engine files,
 * not here. This keeps the service layer portable and testable.
 *
 * SECURITY NOTE:
 * This is a personal-use local-first app. The API key lives in
 * localStorage (user-entered, never hardcoded). The Anthropic header
 * 'anthropic-dangerous-direct-browser-access' is required for direct
 * browser calls to the API.
 */

import type { ApiMessage, ApiRequestOptions } from '@/types';

// ── Configuration ─────────────────────────────────────────────────────────────

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const API_KEY_STORAGE_KEY = 'afs_api_key';

/** Read the API key from localStorage at call time (so changes take effect immediately) */
function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  } catch { /* ignore */ }
}

export function hasApiKey(): boolean {
  return Boolean(getApiKey());
}

// ── Drive MCP ─────────────────────────────────────────────────────────────────

const DRIVE_MCP_SERVER = {
  type: 'url',
  url:  'https://drivemcp.googleapis.com/mcp/v1',
  name: 'google-drive',
};

// ── Headers ───────────────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type':                           'application/json',
    'x-api-key':                              getApiKey(),
    'anthropic-version':                      '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

// ── API Error ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Core call function ────────────────────────────────────────────────────────

/**
 * Make a request to the Anthropic /v1/messages API.
 * Returns the full text response as a string.
 * Throws ApiError on failure.
 */
export async function callClaude(opts: ApiRequestOptions): Promise<string> {
  const { system, userMsg, messages, maxTokens = 1500, mcpDrive = false } = opts;

  if (!getApiKey()) {
    throw new ApiError('No API key configured. Enter your Anthropic API key in Settings.');
  }

  // Build messages array
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

  if (system)    body.system      = system;
  if (mcpDrive)  body.mcp_servers = [DRIVE_MCP_SERVER];

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
