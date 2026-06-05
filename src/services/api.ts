/**
 * AFS Advocates — Anthropic API Service
 *
 * All Claude calls route through your Cloudflare RAG Worker.
 * The Worker holds the Anthropic API key — no device ever needs it.
 * The Worker also runs RAG (embed → Vectorize → inject) before every call.
 *
 * If the Worker URL is not configured, falls back to direct Anthropic call
 * using the locally stored API key (graceful degradation).
 */

import type { ApiMessage, ApiRequestOptions } from '@/types';
import { queryLibrary, deriveQuery, getWorkerUrl } from './library';

// ── Configuration ─────────────────────────────────────────────────────────────

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const API_KEY_STORAGE_KEY = 'afs_api_key';

function getApiKey(): string {
  try { return localStorage.getItem(API_KEY_STORAGE_KEY) || ''; } catch { return ''; }
}

export function saveApiKey(key: string): void {
  try { localStorage.setItem(API_KEY_STORAGE_KEY, key.trim()); } catch { /* ignore */ }
}

export function hasApiKey(): boolean {
  // Has key OR has worker URL (worker holds the key server-side)
  return Boolean(getApiKey()) || Boolean(getWorkerUrl());
}

// ── Drive MCP ─────────────────────────────────────────────────────────────────

const DRIVE_MCP_SERVER = {
  type: 'url',
  url:  'https://drivemcp.googleapis.com/mcp/v1',
  name: 'google-drive',
};

// ── API Error ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Library injection ─────────────────────────────────────────────────────────

function injectLibrary(original: string | undefined, libraryBlock: string): string {
  if (!libraryBlock) return original || '';
  const base = original ? original.trim() : '';
  return base ? `${libraryBlock}\n${base}` : libraryBlock;
}

// ── Worker call (preferred — key never in browser) ────────────────────────────

async function callViaWorker(
  workerUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${workerUrl}/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(`Worker unreachable: ${(e as Error).message}`);
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

// ── Direct Anthropic call (fallback — requires local API key) ─────────────────

async function callDirect(body: Record<string, unknown>): Promise<string> {
  const key = getApiKey();
  if (!key) throw new ApiError('No API key configured. Enter your Anthropic API key in Settings.');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':                              'application/json',
        'x-api-key':                                 key,
        'anthropic-version':                         '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
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

// ── Core call function ─────────────────────────────────────────────────────────

export async function callClaude(opts: ApiRequestOptions): Promise<string> {
  const {
    system,
    userMsg,
    messages,
    maxTokens   = 1500,
    mcpDrive    = false,
    skipLibrary = true,
    libraryOpts = {},
  } = opts;

  const workerUrl = getWorkerUrl();

  if (!workerUrl && !getApiKey()) {
    throw new ApiError('No API key configured. Enter your Anthropic API key in Settings.');
  }

  // ── STEP 1: Query your library ────────────────────────────────────────────
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

  // ── STEP 2: Build messages array ──────────────────────────────────────────
  const msgs: ApiMessage[] = messages
    ?? (userMsg ? [{ role: 'user', content: userMsg }] : []);

  if (msgs.length === 0) {
    throw new ApiError('No messages provided to callClaude.');
  }

  // ── STEP 3: Build request body ────────────────────────────────────────────
  const body: Record<string, unknown> = {
    model:      CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages:   msgs,
  };

  if (enrichedSystem) body.system      = enrichedSystem;
  if (mcpDrive)       body.mcp_servers = [DRIVE_MCP_SERVER];

  // ── STEP 4: Call via Worker (preferred) or direct (fallback) ─────────────
   return callDirect(body);
}
