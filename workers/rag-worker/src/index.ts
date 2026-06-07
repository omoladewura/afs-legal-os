/**
 * AFS Advocates — Cloudflare Worker: Legal Library RAG + Case Sync + Claude Chat
 *
 * Endpoints:
 *
 *   POST /chat                      — proxy Claude API call (key never in browser)
 *   POST /embed                     — embed a query string via Workers AI
 *   POST /query                     — query Vectorize with an embedding vector
 *   POST /ingest                    — process unprocessed PDFs from R2 into Vectorize
 *
 *   GET  /cases                     — load all cases from D1
 *   PUT  /case                      — upsert a case in D1
 *   DELETE /case?id=x               — delete a case and all related records
 *
 *   GET  /entries?caseId=x          — load docket entries for a case
 *   PUT  /entry                     — upsert a docket entry
 *   DELETE /entry?id=x              — delete a docket entry
 *
 *   GET  /deadlines?caseId=x        — load deadlines for a case
 *   PUT  /deadline                  — upsert a deadline
 *   DELETE /deadline?id=x           — delete a deadline
 *
 *   GET  /research?caseId=x         — load research records for a case
 *   PUT  /research                  — upsert a research record
 *   DELETE /research?id=x           — delete a research record
 *
 *   GET  /evidence/meta?caseId=x    — load evidence metadata
 *   PUT  /evidence/meta             — upsert evidence metadata
 *   DELETE /evidence/meta?id=x      — delete evidence metadata
 *   POST /evidence/file             — upload evidence file to R2
 *   GET  /evidence/file?id=x        — get evidence file from R2
 *   DELETE /evidence/file?id=x      — delete evidence file from R2
 */

export interface Env {
  VECTORIZE:          Vectorize;
  AI:                 Ai;
  DB:                 D1Database;
  R2:                 R2Bucket;
  AUTH_TOKEN?:        string;
  ANTHROPIC_API_KEY?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cors(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

// ── Database Setup ────────────────────────────────────────────────────────────

async function ensureTables(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS cases (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entries (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS deadlines (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS evidence_meta (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS processed_files (
    key          TEXT PRIMARY KEY,
    doc_title    TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    doc_type     TEXT NOT NULL,
    chunk_count  INTEGER NOT NULL,
    processed_at TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'ok'
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS failed_files (
    key        TEXT PRIMARY KEY,
    reason     TEXT NOT NULL,
    failed_at  TEXT NOT NULL
  )`).run();
}

// ── PDF Text Extraction ───────────────────────────────────────────────────────

/**
 * Extracts text from a PDF ArrayBuffer using a pure-JS approach.
 * Works reliably on text-based PDFs (government statutes, legislation sites).
 * Returns empty string if extraction fails — caller handles logging.
 */
function extractTextFromPDF(buffer: ArrayBuffer): string {
  try {
    const bytes = new Uint8Array(buffer);
    const raw   = new TextDecoder('latin1').decode(bytes);

    // Collect all text found in PDF stream objects
    const textParts: string[] = [];

    // Match BT...ET blocks (PDF text blocks)
    const btEtRegex = /BT([\s\S]*?)ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btEtRegex.exec(raw)) !== null) {
      const block = btMatch[1];

      // Extract strings from parentheses: (Hello World) Tj
      const parenRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|TJ|'|")/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = parenRegex.exec(block)) !== null) {
        const s = pMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\n')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
        if (s.trim().length > 0) textParts.push(s);
      }

      // Extract hex strings: <48656c6c6f> Tj
      const hexRegex = /<([0-9a-fA-F]+)>\s*(?:Tj|TJ)/g;
      let hMatch: RegExpExecArray | null;
      while ((hMatch = hexRegex.exec(block)) !== null) {
        const hex = hMatch[1];
        let s = '';
        for (let i = 0; i < hex.length; i += 2) {
          s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
        if (s.trim().length > 0) textParts.push(s);
      }
    }

    // Join and clean up
    let text = textParts.join(' ');

    // Collapse excessive whitespace but preserve paragraph breaks
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  } catch {
    return '';
  }
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Splits text into chunks of ~500 words with ~50-word overlap.
 * Returns array of chunk strings.
 */
function chunkText(text: string, chunkWords = 500, overlapWords = 50): string[] {
  const words  = text.split(/\s+/).filter(w => w.length > 0);
  const chunks: string[] = [];

  if (words.length === 0) return chunks;

  let start = 0;
  while (start < words.length) {
    const end   = Math.min(start + chunkWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 20) chunks.push(chunk); // skip tiny fragments
    if (end >= words.length) break;
    start = end - overlapWords;
  }

  return chunks;
}

// ── Metadata Parsing ──────────────────────────────────────────────────────────

/**
 * Derives jurisdiction and doc_type from the R2 key path.
 * Key structure: NG/Statutes/filename.pdf → jurisdiction=NG, doc_type=Statutes
 * Falls back to 'Unknown' if path doesn't match expected structure.
 */
function parseKeyMetadata(key: string): { jurisdiction: string; doc_type: string; doc_title: string } {
  const parts = key.split('/');

  // Expected: JURISDICTION/DocType/filename.pdf
  const jurisdiction = parts.length >= 3 ? parts[0] : 'Unknown';
  const doc_type     = parts.length >= 3 ? parts[1] : 'Unknown';
  const filename     = parts[parts.length - 1];
  const doc_title    = filename
    .replace(/\.[^.]+$/, '')          // remove extension
    .replace(/[_-]/g, ' ')            // underscores/hyphens → spaces
    .replace(/\s+/g, ' ')
    .trim();

  return { jurisdiction, doc_type, doc_title };
}

// ── Ingest Handler ────────────────────────────────────────────────────────────

async function handleIngest(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);

  const startTime = Date.now();
  const processed: string[] = [];
  const failed:    { key: string; reason: string }[] = [];
  const skipped:   string[] = [];

  try {
    // List all objects in R2 (excluding chunks/ and evidence/ prefixes — those are pipeline outputs)
    const listed = await env.R2.list({ limit: 1000 });
    const allKeys = (listed.objects || [])
      .map(o => o.key)
      .filter(k =>
        !k.startsWith('chunks/') &&
        !k.startsWith('evidence/') &&
        !k.startsWith('OCR-Queue/') &&
        (k.toLowerCase().endsWith('.pdf') || k.toLowerCase().endsWith('.txt'))
      );

    if (allKeys.length === 0) {
      return json({ ok: true, message: 'No documents found in library folders', processed: [], failed: [], skipped: [] }, 200, origin);
    }

    // Check which files are already processed
    const placeholders = allKeys.map(() => '?').join(',');
    const alreadyRows  = await env.DB.prepare(
      `SELECT key FROM processed_files WHERE key IN (${placeholders}) AND status = 'ok'`
    ).bind(...allKeys).all();
    const alreadyDone  = new Set((alreadyRows.results || []).map((r: Record<string, unknown>) => r.key as string));

    const toProcess = allKeys.filter(k => !alreadyDone.has(k));

    if (toProcess.length === 0) {
      return json({
        ok: true,
        message: 'All documents already processed. Upload new PDFs to R2 to add them.',
        processed: [],
        failed: [],
        skipped: [...alreadyDone],
      }, 200, origin);
    }

    // Process each file
    for (const key of toProcess) {
      try {
        // Fetch from R2
        const obj = await env.R2.get(key);
        if (!obj) {
          failed.push({ key, reason: 'File not found in R2' });
          continue;
        }

        const { jurisdiction, doc_type, doc_title } = parseKeyMetadata(key);
        let text = '';

        if (key.toLowerCase().endsWith('.txt')) {
          // Plain text — read directly
          text = await obj.text();
        } else {
          // PDF — extract text
          const buffer = await obj.arrayBuffer();
          text = extractTextFromPDF(buffer);
        }

        if (!text || text.trim().length < 50) {
          // Extraction failed or returned almost nothing
          const reason = 'Text extraction returned insufficient content. File may be scanned — run OCR first.';
          failed.push({ key, reason });
          await env.DB.prepare(
            'INSERT OR REPLACE INTO failed_files (key, reason, failed_at) VALUES (?, ?, ?)'
          ).bind(key, reason, new Date().toISOString()).run();
          continue;
        }

        // Chunk the text
        const chunks = chunkText(text);
        if (chunks.length === 0) {
          failed.push({ key, reason: 'No chunks produced after splitting' });
          continue;
        }

        // Embed and upload each chunk
        let successfulChunks = 0;
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          // Generate embedding via Workers AI
          const embedResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
            text: [chunk.slice(0, 2048)],
          }) as { data: number[][] };

          const embedding = embedResult.data[0];
          if (!embedding || embedding.length === 0) continue;

          // Build vector ID and metadata
          const vectorId  = `${key.replace(/[^a-zA-Z0-9]/g, '_')}_chunk_${i}`;
          const chunkKey  = `chunks/${key}/chunk_${i}.txt`;

          // Store chunk text in R2
          await env.R2.put(chunkKey, chunk, {
            httpMetadata: { contentType: 'text/plain' },
          });

          // Upload vector to Vectorize
          await env.VECTORIZE.upsert([{
            id:       vectorId,
            values:   embedding,
            metadata: {
              doc_title,
              jurisdiction,
              doc_type,
              chunk_index:   i,
              total_chunks:  chunks.length,
              source_file:   key,
              chunk_key:     chunkKey,
              upload_date:   new Date().toISOString(),
            },
          }]);

          successfulChunks++;
        }

        // Log as processed
        await env.DB.prepare(
          'INSERT OR REPLACE INTO processed_files (key, doc_title, jurisdiction, doc_type, chunk_count, processed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(key, doc_title, jurisdiction, doc_type, successfulChunks, new Date().toISOString(), 'ok').run();

        processed.push(key);

      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ key, reason });
        await env.DB.prepare(
          'INSERT OR REPLACE INTO failed_files (key, reason, failed_at) VALUES (?, ?, ?)'
        ).bind(key, reason, new Date().toISOString()).run();
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return json({
      ok:        true,
      elapsed_s: elapsed,
      summary: {
        total_in_library: allKeys.length,
        already_done:     alreadyDone.size,
        processed_now:    processed.length,
        failed:           failed.length,
      },
      processed,
      failed,
      skipped: [...alreadyDone],
    }, 200, origin);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ ok: false, error: msg }, 500, origin);
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

async function handleChat(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'API key not configured' }, 500, origin);
  }

  const body = await req.json() as Record<string, unknown>;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      body.model      ?? 'claude-sonnet-4-6',
      max_tokens: body.max_tokens ?? 1500,
      system:     body.system,
      messages:   body.messages,
    }),
  });

  const data = await res.json();
  return json(data, res.status, origin);
}

// ── Embed ─────────────────────────────────────────────────────────────────────

async function handleEmbed(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const body = await req.json() as { text?: string };
  if (!body.text) return json({ error: 'text is required' }, 400, origin);
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [body.text.slice(0, 2048)],
  }) as { data: number[][] };
  return json({ embedding: result.data[0] }, 200, origin);
}

// ── Query ─────────────────────────────────────────────────────────────────────

async function handleQuery(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const body = await req.json() as {
    embedding?:      number[];
    topK?:           number;
    namespace?:      string;
    filter?:         Record<string, string>;
  };
  if (!body.embedding || !Array.isArray(body.embedding)) {
    return json({ error: 'embedding array is required' }, 400, origin);
  }
  const queryOpts: VectorizeQueryOptions = {
    topK:           Math.min(body.topK ?? 8, 20),
    returnMetadata: 'all',
  };
  if (body.namespace) queryOpts.namespace = body.namespace;
  if (body.filter)    queryOpts.filter    = body.filter;
  const results = await env.VECTORIZE.query(body.embedding, queryOpts);
  return json({ matches: results.matches }, 200, origin);
}

// ── Cases ─────────────────────────────────────────────────────────────────────

async function handleGetCases(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const rows = await env.DB.prepare('SELECT data FROM cases ORDER BY json_extract(data, "$.createdAt") DESC').all();
  const cases = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ cases }, 200, origin);
}

async function handlePutCase(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string };
  if (!body.id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO cases (id, data) VALUES (?, ?)')
    .bind(body.id, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteCase(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM entries WHERE case_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM deadlines WHERE case_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM research WHERE case_id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Entries ───────────────────────────────────────────────────────────────────

async function handleGetEntries(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare('SELECT data FROM entries WHERE case_id = ? ORDER BY json_extract(data, "$.dateFiled") DESC').bind(caseId).all();
  const entries = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ entries }, 200, origin);
}

async function handlePutEntry(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO entries (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteEntry(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

async function handleGetDeadlines(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare('SELECT data FROM deadlines WHERE case_id = ? ORDER BY json_extract(data, "$.date") ASC').bind(caseId).all();
  const deadlines = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ deadlines }, 200, origin);
}

async function handlePutDeadline(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO deadlines (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteDeadline(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM deadlines WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Research ──────────────────────────────────────────────────────────────────

async function handleGetResearch(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare('SELECT data FROM research WHERE case_id = ? ORDER BY json_extract(data, "$.savedAt") DESC').bind(caseId).all();
  const records = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ records }, 200, origin);
}

async function handlePutResearch(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO research (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteResearch(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM research WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Evidence Metadata (D1) ────────────────────────────────────────────────────

async function handleGetEvidenceMeta(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url    = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare(
    'SELECT data FROM evidence_meta WHERE case_id = ? ORDER BY json_extract(data, "$.timestamp") DESC'
  ).bind(caseId).all();
  const items = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ items }, 200, origin);
}

async function handlePutEvidenceMeta(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO evidence_meta (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteEvidenceMeta(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM evidence_meta WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Evidence Files (R2) ───────────────────────────────────────────────────────

async function handleUploadEvidenceFile(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const url    = new URL(req.url);
  const id     = url.searchParams.get('id');
  const caseId = url.searchParams.get('caseId');
  if (!id || !caseId) return json({ error: 'id and caseId are required' }, 400, origin);

  const contentType = req.headers.get('Content-Type') || 'application/octet-stream';
  const key = `evidence/${caseId}/${id}`;

  await env.R2.put(key, req.body, {
    httpMetadata: { contentType },
  });

  return json({ ok: true, key }, 200, origin);
}

async function handleGetEvidenceFile(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const url    = new URL(req.url);
  const id     = url.searchParams.get('id');
  const caseId = url.searchParams.get('caseId');
  if (!id || !caseId) return json({ error: 'id and caseId are required' }, 400, origin);

  const key = `evidence/${caseId}/${id}`;
  const obj = await env.R2.get(key);
  if (!obj) return json({ error: 'File not found' }, 404, origin);

  const headers = new Headers(cors(origin));
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${id}"`);
  return new Response(obj.body, { status: 200, headers });
}

async function handleDeleteEvidenceFile(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const url    = new URL(req.url);
  const id     = url.searchParams.get('id');
  const caseId = url.searchParams.get('caseId');
  if (!id || !caseId) return json({ error: 'id and caseId are required' }, 400, origin);

  await env.R2.delete(`evidence/${caseId}/${id}`);
  return json({ ok: true }, 200, origin);
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') || '*';

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (!authorized(req, env)) {
      return json({ error: 'Unauthorized' }, 401, origin);
    }

    const url    = new URL(req.url);
    const path   = url.pathname;
    const method = req.method;

    if (method === 'POST' && path === '/chat')   return handleChat(req, env);
    if (method === 'POST' && path === '/embed')  return handleEmbed(req, env);
    if (method === 'POST' && path === '/query')  return handleQuery(req, env);
    if (method === 'POST' && path === '/ingest') return handleIngest(req, env);

    if (method === 'GET'    && path === '/cases')     return handleGetCases(req, env);
    if (method === 'PUT'    && path === '/case')      return handlePutCase(req, env);
    if (method === 'DELETE' && path === '/case')      return handleDeleteCase(req, env);

    if (method === 'GET'    && path === '/entries')   return handleGetEntries(req, env);
    if (method === 'PUT'    && path === '/entry')     return handlePutEntry(req, env);
    if (method === 'DELETE' && path === '/entry')     return handleDeleteEntry(req, env);

    if (method === 'GET'    && path === '/deadlines') return handleGetDeadlines(req, env);
    if (method === 'PUT'    && path === '/deadline')  return handlePutDeadline(req, env);
    if (method === 'DELETE' && path === '/deadline')  return handleDeleteDeadline(req, env);

    if (method === 'GET'    && path === '/research')  return handleGetResearch(req, env);
    if (method === 'PUT'    && path === '/research')  return handlePutResearch(req, env);
    if (method === 'DELETE' && path === '/research')  return handleDeleteResearch(req, env);

    if (method === 'GET'    && path === '/evidence/meta')   return handleGetEvidenceMeta(req, env);
    if (method === 'PUT'    && path === '/evidence/meta')   return handlePutEvidenceMeta(req, env);
    if (method === 'DELETE' && path === '/evidence/meta')   return handleDeleteEvidenceMeta(req, env);
    if (method === 'POST'   && path === '/evidence/file')   return handleUploadEvidenceFile(req, env);
    if (method === 'GET'    && path === '/evidence/file')   return handleGetEvidenceFile(req, env);
    if (method === 'DELETE' && path === '/evidence/file')   return handleDeleteEvidenceFile(req, env);

    return json({ error: 'Not found' }, 404, origin);
  },
};
