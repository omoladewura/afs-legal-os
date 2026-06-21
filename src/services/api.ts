import type { ApiMessage, ApiRequestOptions, ApiUsage } from '@/types';
import { writeDraftChunk, clearDraftBuffer } from '@/storage/helpers';

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
 * Convenience wrapper for callers that only need the text and don't
 * participate in token telemetry (direct callers outside useAI).
 * Usage: replace `await callClaude(opts)` with `await callClaudeText(opts)`.
 */
export async function callClaudeText(opts: ApiRequestOptions): Promise<string> {
  const { text } = await callClaude(opts);
  return text;
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

  // Signal the Worker to stream when a chunk callback is provided
  if (onChunk) body.stream = true;

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

  // ── One-shot path (no onChunk) ────────────────────────────────────────────
  if (!onChunk) {
    const data = await res.json();

    if (!res.ok || (data as any).error) {
      const msg = (data as any).error?.message ?? `HTTP ${res.status}`;
      throw new ApiError(msg, res.status);
    }

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
  // The Worker returns text/event-stream. Each SSE line is:
  //   event: <event_type>
  //   data: <json_payload>
  //
  // We care about two event types:
  //   content_block_delta  → delta.type === 'text_delta' → delta.text is the chunk
  //   message_delta        → carries stop_reason + final usage figures
  //
  // All other event types (message_start, content_block_start,
  // content_block_stop, message_stop, ping) are parsed but ignored.
  //
  // Error before stream: the Worker returns a normal JSON error response
  // (same shape as the one-shot error path) — we detect this via Content-Type.
  if (!res.ok || res.headers.get('Content-Type')?.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    const msg = (data as any).error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  if (!res.body) {
    throw new ApiError('Streaming response had no body');
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();

  // Stable ID for this call's draft_buffer record
  const callId    = crypto.randomUUID();
  const engineTag = streamEngine ?? (opts.libraryOpts as any)?.queryHint ?? 'unknown';
  const startedAt = new Date().toISOString();
  const prompt    = typeof opts.userMsg === 'string'
    ? opts.userMsg
    : (opts.messages?.filter(m => m.role === 'user').pop()?.content ?? '');

  let assembled = '';
  let eventType = '';
  let usage: ApiUsage = { input_tokens: 0, output_tokens: 0 };

  // SSE lines arrive as: "event: <type>\ndata: <json>\n\n"
  // We accumulate raw bytes into a line buffer and process complete lines.
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
        // Write the full accumulated partial on every chunk — the buffer
        // record always contains the complete text so a resume path can
        // read it directly without replaying individual deltas.
        writeDraftChunk({
          callId,
          engine:    engineTag,
          caseId:    streamCaseId,
          partial:   assembled,
          startedAt,
          prompt:    String(prompt).slice(0, 4096),
        });
      }
    } else if (eventType === 'message_delta') {
      // Final usage is on the message_delta event, not message_start
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
      // message_start carries the initial usage snapshot (input tokens, cache stats)
      const msg = payload.message as Record<string, unknown> | undefined;
      const u   = msg?.usage as Record<string, unknown> | undefined;
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

      // Split on newlines, keeping empty lines (they delimit SSE events)
      const lines = lineBuffer.split('\n');
      // Last element may be incomplete — hold it back in the buffer
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        processLine(line);
      }
    }

    // Flush any remaining bytes in the decoder
    const tail = decoder.decode();
    if (tail) {
      for (const line of tail.split('\n')) {
        processLine(line);
      }
    }

    // Stream completed cleanly — remove the checkpoint record
    await clearDraftBuffer(callId);
  } finally {
    reader.releaseLock();
  }

  return { text: assembled, usage };
}
