/**
 * AFS Advocates — Anthropic API Service
 *
 * Thin, clean wrapper around the Anthropic /v1/messages endpoint.
 * All AI calls in the system route through here — never raw fetch().
 *
 * ── LIBRARY-FIRST ARCHITECTURE ───────────────────────────────────────────────
 *
 * Every callClaude() call now runs a Cloudflare Vectorize RAG query
 * BEFORE building the request body. The top matching materials from
 * your private legal library are prepended to the system prompt.
 *
 * This means EVERY engine — ArgumentBuilder, CrossExamEngine,
 * IntelligenceEngine, CriminalDefence, MatrimonialEngine, BriefMe,
 * CommandConsole, SanMode (via callClaude), ResearchResolver, all of
 * them — consults your library first, automatically.
 *
 * No engine file needs to change.
 *
 * ── GRACEFUL DEGRADATION ─────────────────────────────────────────────────────
 *
 * If the library is unreachable or not configured, callClaude() proceeds
 * with the original prompt unchanged. The library layer never blocks generation.
 *
 * ── CONTROLLING RAG DEPTH ────────────────────────────────────────────────────
 *
 * Pass libraryOpts in ApiRequestOptions to tune per-call:
 *   { topK: 12, filter: { type: 'statute' }, threshold: 0.75 }
 *
 * Pass skipLibrary: true to bypass for non-legal utility calls
 * (e.g. password-check calls, pure formatting tasks).
 */

import type { ApiMessage, ApiRequestOptions } from '@/types';
import { queryLibrary, deriveQuery }           from './library';

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
    'Content-Type':                              'application/json',
    'x-api-key':                                 getApiKey(),
    'anthropic-version':                         '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

// ── API Error ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Library injection ─────────────────────────────────────────────────────────

/**
 * Prepend the library RAG block to a system prompt string.
 * If the library returned nothing, returns the original system string unchanged.
 */
function injectLibrary(original: string | undefined, libraryBlock: string): string {
  if (!libraryBlock) return original || '';
  const base = original ? original.trim() : '';
  return base
    ? `${libraryBlock}\n${base}`
    : libraryBlock;
}

// ── Core call function ─────────────────────────────────────────────────────────

/**
 * Make a request to the Anthropic /v1/messages API.
 * Returns the full text response as a string.
 * Throws ApiError on failure.
 *
 * Library RAG runs automatically on every call unless skipLibrary: true.
 */
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

  if (!getApiKey()) {
    throw new ApiError('No API key configured. Enter your Anthropic API key in Settings.');
  }

  // ── STEP 1: Query your library ────────────────────────────────────────────
  let enrichedSystem = system;

  if (!skipLibrary) {
    // Build a semantic query from whatever context we have.
    // Priority: extra hint > first user message > system prompt.
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
      // If ctx.ok is false, we silently continue with the original system prompt.
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

  // ── STEP 4: Call Claude ───────────────────────────────────────────────────
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
