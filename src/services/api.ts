import type { ApiMessage, ApiRequestOptions, ApiUsage } from '@/types';
import { writeDraftChunk, clearDraftBuffer, getAllDraftBuffers } from '@/storage/helpers';

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

/**
 * Phase 9D — Offline detection.
 *
 * Fired whenever a Worker fetch fails with a network error (i.e. the device
 * is offline or the Worker is unreachable). `App.tsx` listens for this event
 * to show the persistent offline banner, independent of individual engine
 * error states so the banner appears regardless of which engine is active.
 *
 * We use a plain CustomEvent on `window` rather than a shared module-level
 * signal so that the api.ts module stays side-effect-free and any component
 * can listen without importing from this module.
 */
export function emitWorkerOffline(): void {
  window.dispatchEvent(new CustomEvent('afs:worker-offline'));
}
export function emitWorkerOnline(): void {
  window.dispatchEvent(new CustomEvent('afs:worker-online'));
}

/**
 * Phase 7D — Resilient call wrapper for one-shot (non-streaming) callClaude calls.
 *
 * Retries up to `maxAttempts` times on transient network errors or 5xx responses.
 * Waits `baseDelayMs * 2^attempt` between retries (exponential backoff, capped at 8 s).
 * Does NOT retry on 4xx (bad request, auth failure) — those are permanent errors.
 *
 * Usage:
 *   const { text } = await withRetry(() => callClaude(opts));
 *
 * Step 2 (extraction), Step 2b (audit), Step 5b (risk verdict), and
 * Step 5 authority grounding all use this. Step 5 package generation uses
 * streaming + Phase 7C resume instead.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 800,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry client errors — they won't resolve on retry
      if (err instanceof ApiError && err.status !== undefined && err.status < 500) throw err;
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, 8000);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Convenience wrapper for callers that only need the text and don't
 * participate in token telemetry (direct callers outside useAI).
 */
export async function callClaudeText(opts: ApiRequestOptions): Promise<string> {
  const { text } = await callClaude(opts);
  return text;
}

// ── Internal: build and fetch a streaming response ────────────────────────────
// Shared between the initial stream and the resume path.
// Returns the assembled text and final usage — does NOT touch draft_buffer.

async function fetchStream(
  body: Record<string, unknown>,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; usage: ApiUsage }> {
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch (e) {
    emitWorkerOffline();
    throw new ApiError(`Network error: ${(e as Error).message}`);
  }

  if (!res.ok || res.headers.get('Content-Type')?.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    const msg = (data as any).error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  emitWorkerOnline();

  if (!res.body) throw new ApiError('Streaming response had no body');

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();

  let assembled = '';
  let eventType = '';
  let usage: ApiUsage = { input_tokens: 0, output_tokens: 0 };
  let lineBuffer = '';

  const processLine = (line: string) => {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
      return;
    }
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (raw === '[DONE]') return;

    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return; }

    if (eventType === 'content_block_delta') {
      const delta = payload.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        assembled += delta.text;
        onChunk(delta.text);
      }
    } else if (eventType === 'message_delta') {
      const u = payload.usage as Record<string, unknown> | undefined;
      if (u) {
        usage = {
          input_tokens:                (u.input_tokens                as number) ?? usage.input_tokens,
          output_tokens:               (u.output_tokens               as number) ?? usage.output_tokens,
          cache_read_input_tokens:     u.cache_read_input_tokens     as number | undefined,
          cache_creation_input_tokens: u.cache_creation_input_tokens as number | undefined,
        };
      }
    } else if (eventType === 'message_start') {
      const msg = payload.message as Record<string, unknown> | undefined;
      const u   = msg?.usage   as Record<string, unknown> | undefined;
      if (u) {
        usage = {
          input_tokens:                (u.input_tokens                as number) ?? 0,
          output_tokens:               (u.output_tokens               as number) ?? 0,
          cache_read_input_tokens:     u.cache_read_input_tokens     as number | undefined,
          cache_creation_input_tokens: u.cache_creation_input_tokens as number | undefined,
        };
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    const tail = decoder.decode();
    if (tail) {
      for (const line of tail.split('\n')) processLine(line);
    }
  } finally {
    reader.releaseLock();
  }

  return { text: assembled, usage };
}

export async function callClaude(opts: ApiRequestOptions): Promise<{ text: string; usage: ApiUsage }> {
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
    onChunk,
    onResumed,
    streamCaseId = null,
    streamEngine,
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
    body.skip_library = true;
  } else {
    body.engine = libraryOpts.queryHint || 'unknown';
    if (libraryOpts.namespace)  body.jurisdiction  = libraryOpts.namespace;
    if (libraryOpts.filter)     body.rag_filter    = libraryOpts.filter;
    if (libraryOpts.topK)       body.rag_top_k     = libraryOpts.topK;
    if (libraryOpts.threshold)  body.rag_threshold = libraryOpts.threshold;
  }

  if (system) {
    body.system = [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ];
  }
  if (mcpDrive) body.mcp_servers = [{
    type: 'url',
    url:  'https://drivemcp.googleapis.com/mcp/v1',
    name: 'google-drive',
  }];
  if (counsel_role) body.counsel_role = counsel_role;
  if (matter_track) body.matter_track = matter_track;

  // ── One-shot path (no onChunk) ────────────────────────────────────────────
  if (!onChunk) {
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
      emitWorkerOffline();
      throw new ApiError(`Network error: ${(e as Error).message}`);
    }

    const data = await res.json();
    if (!res.ok || (data as any).error) {
      const msg = (data as any).error?.message ?? `HTTP ${res.status}`;
      throw new ApiError(msg, res.status);
    }

    emitWorkerOnline();

    const text = ((data as any).content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');

    const usage: ApiUsage = {
      input_tokens:                (data as any).usage?.input_tokens                ?? 0,
      output_tokens:               (data as any).usage?.output_tokens               ?? 0,
      cache_read_input_tokens:     (data as any).usage?.cache_read_input_tokens,
      cache_creation_input_tokens: (data as any).usage?.cache_creation_input_tokens,
    };

    return { text, usage };
  }

  // ── Streaming path ────────────────────────────────────────────────────────
  const callId    = crypto.randomUUID();
  const engineTag = streamEngine ?? (opts.libraryOpts as any)?.queryHint ?? 'unknown';
  const startedAt = new Date().toISOString();
  const prompt    = typeof opts.userMsg === 'string'
    ? opts.userMsg
    : (opts.messages?.filter(m => m.role === 'user').pop()?.content ?? '');

  let assembled = '';
  let usage: ApiUsage = { input_tokens: 0, output_tokens: 0 };

  // Wrap onChunk to also maintain the draft_buffer checkpoint on every delta
  const trackingChunk = (chunk: string) => {
    assembled += chunk;
    onChunk(chunk);
    writeDraftChunk({
      callId,
      engine:    engineTag,
      caseId:    streamCaseId,
      partial:   assembled,
      startedAt,
      prompt:    String(prompt).slice(0, 4096),
    });
  };

  try {
    const result = await fetchStream(body, trackingChunk);
    // fetchStream assembled text into `assembled` via trackingChunk, but it
    // also returns the full text — use fetchStream's return for usage.
    // assembled is already correct from the tracking callback.
    usage = result.usage;

    // Stream completed cleanly — remove the checkpoint record
    await clearDraftBuffer(callId);
    return { text: assembled, usage };

  } catch (streamErr) {
    // ── Phase 7C: mid-stream connection failure ────────────────────────────
    // Check whether we captured a partial before the connection dropped.
    // We read from draft_buffer rather than `assembled` to be safe — the
    // buffer write is the durable record; assembled may be incomplete if the
    // error fired before the last chunk was appended.
    let savedPartial = assembled; // use in-memory as primary, buffer as fallback

    try {
      const buffers = await getAllDraftBuffers();
      const rec = buffers.find(b => b.callId === callId);
      if (rec?.partial && rec.partial.length >= savedPartial.length) {
        savedPartial = rec.partial;
      }
    } catch { /* ignore — we'll use whatever assembled holds */ }

    if (!savedPartial) {
      // Nothing was saved at all — re-throw as a plain failure
      await clearDraftBuffer(callId);
      throw streamErr;
    }

    // We have a partial. Attempt resume via assistant-prefill turn.
    // The resume request sends the original messages plus an assistant turn
    // containing the partial output, followed by a user instruction to
    // continue seamlessly from that exact point.
    const resumeMessages: ApiMessage[] = [
      ...msgs,
      { role: 'assistant', content: savedPartial },
      {
        role: 'user',
        content:
          'Continue writing from exactly where you stopped. ' +
          'Do not repeat any text already written. ' +
          'Do not add any preamble, heading, or transition — ' +
          'just continue the sentence or section mid-stream.',
      },
    ];

    const resumeBody: Record<string, unknown> = {
      ...body,
      messages: resumeMessages,
    };

    // Signal the UI that a resume is happening before the first new chunk
    onResumed?.();

    let resumeResult: { text: string; usage: ApiUsage };
    try {
      resumeResult = await fetchStream(resumeBody, onChunk);
    } catch (resumeErr) {
      // Resume also failed — give up, leave the buffer so the user can retry
      throw resumeErr;
    }

    // Concatenate: the partial that was already delivered to onChunk + the
    // resumed continuation (already delivered to onChunk by fetchStream).
    const fullText = savedPartial + resumeResult.text;

    // Merge usage — add token counts from both legs
    const mergedUsage: ApiUsage = {
      input_tokens:  usage.input_tokens  + resumeResult.usage.input_tokens,
      output_tokens: usage.output_tokens + resumeResult.usage.output_tokens,
      // cache stats come from the initial leg only (resume doesn't hit cache)
      cache_read_input_tokens:     usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    };

    // Resume succeeded — clear the buffer
    await clearDraftBuffer(callId);

    return { text: fullText, usage: mergedUsage };
  }
}
