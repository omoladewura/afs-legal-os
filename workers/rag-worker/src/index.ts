/**
 * AFS Advocates — Cloudflare Worker: Legal Library RAG + Case Sync + Claude Chat
 *
 * V2 Upgrade — Role-Aware RAG:
 *   /chat now performs server-side RAG before calling Anthropic.
 *   It reads counsel_role + matter_track from the request body,
 *   queries Vectorize with a role-scoped filter, injects the retrieved
 *   library block into the system prompt, then calls Claude.
 *
 *   Prompt caching: client `system` content (callClaude) arrives as a
 *   content-block array with cache_control on the cacheable block (role
 *   prompt + case intelligence context). The library block from RAG is
 *   query-dependent, so it's appended AFTER that block, uncached — see
 *   handleChat() for why the order matters for cache hits.
 *
 *   /ingest now tags every vector with counsel_role + matter_track
 *   derived from the R2 key path:
 *     NG/civil_claimant/HighCourtRules.pdf        → counsel_role: claimant_side,    matter_track: civil
 *     NG/criminal_defence/ACJA2015.pdf            → counsel_role: defence,           matter_track: criminal
 *     NG/matrimonial_shared/MCA_Cap_M7.pdf        → counsel_role: shared,            matter_track: matrimonial
 *     NG/matrimonial_petitioner/PracticeGuide.pdf → counsel_role: petitioner_side,   matter_track: matrimonial
 *     NG/matrimonial_respondent/DefenceGuide.pdf  → counsel_role: respondent_side,   matter_track: matrimonial
 *     NG/shared/EvidenceAct2011.pdf               → counsel_role: shared,            matter_track: shared
 *
 * R2 FOLDER CONVENTION (tag your documents by folder):
 *   JURISDICTION/civil_claimant/        → claimant-side civil materials
 *   JURISDICTION/civil_defendant/       → defendant-side civil materials
 *   JURISDICTION/criminal_prosecution/  → prosecution materials
 *   JURISDICTION/criminal_defence/      → defence materials
 *   JURISDICTION/matrimonial_shared/    → MCA, MCR, Marriage Act, Child's Rights Act
 *   JURISDICTION/matrimonial_petitioner/→ petitioner practice guides and petition precedents
 *   JURISDICTION/matrimonial_respondent/→ respondent defence guides and answer precedents
 *   JURISDICTION/shared/                → both tracks, all roles (Evidence Act, Court hierarchy)
 *   JURISDICTION/Statutes/              → legacy — treated as shared
 *   JURISDICTION/Authorities/           → legacy — treated as shared
 *
 * Endpoints:
 *   POST /chat     — role-aware RAG + Claude proxy
 *   POST /embed    — embed a query string via Workers AI
 *   POST /query    — query Vectorize with an embedding vector
 *   POST /ingest   — process PDFs from R2 into Vectorize with role tags
 *
 *   POST /case-embed   — Phase 6: embed one case history chunk into afs-case-history
 *   POST /case-query   — Phase 6: retrieve relevant chunks for this case + query
 *
 *   GET  /cases                     — load all cases from D1
 *   PUT  /case                      — upsert a case in D1
 *   DELETE /case?id=x               — delete a case and all related records
 *   GET  /entries?caseId=x          — load docket entries for a case
 *   PUT  /entry                     — upsert a docket entry
 *   DELETE /entry?id=x              — delete a docket entry
 *   GET  /deadlines?caseId=x        — load deadlines for a case
 *   PUT  /deadline                  — upsert a deadline
 *   DELETE /deadline?id=x           — delete a deadline
 *   GET  /research?caseId=x         — load research records for a case
 *   PUT  /research                  — upsert a research record
 *   DELETE /research?id=x           — delete a research record
 *   GET  /applications?caseId=x     — load application packages for a case (Phase B)
 *   PUT  /application               — upsert an application package (Phase B)
 *   DELETE /application?id=x        — delete an application package (Phase B)
 *   GET  /evidence/meta?caseId=x    — load evidence metadata
 *   PUT  /evidence/meta             — upsert evidence metadata
 *   DELETE /evidence/meta?id=x      — delete evidence metadata
 *   POST /evidence/file             — upload evidence file to R2
 *   GET  /evidence/file?id=x        — get evidence file from R2
 *   DELETE /evidence/file?id=x      — delete evidence file from R2
 */

export interface Env {
  VECTORIZE:          Vectorize;
  /** Phase 6 — Case History RAG index (afs-case-history) */
  CASE_HISTORY:       Vectorize;
  AI:                 Ai;
  DB:                 D1Database;
  R2:                 R2Bucket;
  AUTH_TOKEN?:        string;
  ANTHROPIC_API_KEY?: string;
  /**
   * Phase 9F — Web Push secrets (set via `wrangler secret put`):
   *   VAPID_PUBLIC_KEY   — base64url-encoded P-256 public key
   *   VAPID_PRIVATE_KEY  — base64url-encoded P-256 private key
   *   VAPID_SUBJECT      — mailto: or https: contact URI
   *
   * Generate a key pair once:
   *   node -e "
   *     const { webcrypto } = require('crypto');
   *     webcrypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey'])
   *       .then(async kp => {
   *         const pub  = Buffer.from(await webcrypto.subtle.exportKey('raw',  kp.publicKey)).toString('base64url');
   *         const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8',kp.privateKey)).toString('base64url');
   *         console.log('VAPID_PUBLIC_KEY=' + pub);
   *         console.log('VAPID_PRIVATE_KEY=' + priv);
   *       });
   *   "
   * Then:
   *   wrangler secret put VAPID_PUBLIC_KEY  --name afs-legal-rag
   *   wrangler secret put VAPID_PRIVATE_KEY --name afs-legal-rag
   *   wrangler secret put VAPID_SUBJECT     --name afs-legal-rag   (e.g. mailto:admin@afslegal.com)
   */
  VAPID_PUBLIC_KEY?:  string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?:     string;
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

// ── Role → Vectorize Filter ───────────────────────────────────────────────────

type CounselRole  = 'claimant_side' | 'defendant_side' | 'prosecution' | 'defence' | 'petitioner_side' | 'respondent_side';
type MatterTrack  = 'civil' | 'criminal' | 'matrimonial';

/**
 * Maps a counsel_role to its Vectorize metadata filter.
 * The filter uses OR logic via an array: role-specific docs + shared docs.
 * Vectorize filter syntax: { counsel_role: { $in: ['claimant_side', 'shared'] } }
 */
function buildRoleFilter(counselRole: CounselRole): Record<string, unknown> {
  // Include role-specific AND shared documents
  return { counsel_role: { $in: [counselRole, 'shared'] } };
}

/**
 * Maps a counsel_role to the most relevant Vectorize namespace.
 * Falls back gracefully — if the namespace doesn't exist, Vectorize
 * returns empty matches without erroring.
 */
function roleToNamespace(counselRole?: CounselRole, matterTrack?: MatterTrack): string | undefined {
  if (counselRole === 'claimant_side')    return 'civil_claimant';
  if (counselRole === 'defendant_side')   return 'civil_defendant';
  if (counselRole === 'prosecution')      return 'criminal_prosecution';
  if (counselRole === 'defence')          return 'criminal_defence';
  if (counselRole === 'petitioner_side')  return 'matrimonial_petitioner';
  if (counselRole === 'respondent_side')  return 'matrimonial_respondent';
  if (matterTrack === 'civil')            return 'civil_shared';
  if (matterTrack === 'criminal')         return 'criminal_shared';
  if (matterTrack === 'matrimonial')      return 'matrimonial_shared';
  return undefined;
}

// ── Library Block Formatter ───────────────────────────────────────────────────

interface VectorMatch {
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Formats Vectorize matches into a structured block for injection
 * into the Claude system prompt. Role-aware header included.
 */
function formatLibraryBlock(matches: VectorMatch[], counselRole?: string): string {
  // Fix 3 — lower similarity threshold for statutory documents so provisions are not lost
  const relevant = matches.filter(m => {
    const isStatute = m.metadata?.is_statute === true || String(m.metadata?.doc_type ?? '').includes('Statute');
    const threshold = isStatute ? 0.60 : 0.68;
    return (m.score ?? 0) >= threshold && m.metadata?.doc_title;
  });
  if (relevant.length === 0) return '';

  const roleLabel = counselRole
    ? `(filtered for ${counselRole.replace('_', ' ')} perspective)`
    : '';

  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════════╗',
    `║     AFS LIBRARY — MANDATORY FIRST REFERENCE ${roleLabel.padEnd(Math.max(0, 18 - roleLabel.length))}║`,
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    'INSTRUCTION: The following materials are retrieved from AFS Advocates\'',
    'private legal library and are filtered to your role on this matter.',
    'You MUST reason from these first. Do not contradict them. Where they',
    'are silent, supplement from general knowledge but clearly distinguish',
    'library-sourced reasoning from your own inference.',
    '',
  ];

  relevant.forEach((m, i) => {
    const md = m.metadata!;
    lines.push(`[LIBRARY ${i + 1}]`);
    lines.push(`Title:      ${md.doc_title}`);
    if (md.jurisdiction) lines.push(`Jurisdiction: ${md.jurisdiction}`);
    if (md.doc_type)     lines.push(`Type:       ${md.doc_type}`);
    if (md.counsel_role && md.counsel_role !== 'shared') {
      lines.push(`Role scope: ${String(md.counsel_role).replace('_', ' ')}`);
    }
    if (md.chunk_text) {
      // Fix 2 — statutory documents get a 2000-char window; all others keep 600
      const isStatute = md.is_statute === true || String(md.doc_type ?? '').includes('Statute');
      const limit = isStatute ? 2000 : 600;
      lines.push(`\n${String(md.chunk_text).slice(0, limit)}${String(md.chunk_text).length > limit ? '…' : ''}`);
    }
    lines.push(`[/LIBRARY ${i + 1}]`);
    lines.push('');
  });

  lines.push('══ END OF LIBRARY CONTEXT ══');
  lines.push('');
  return lines.join('\n');
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS applications (
    id      TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    data    TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    keys_auth   TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    created_at  TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS processed_files (
    key          TEXT PRIMARY KEY,
    doc_title    TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    doc_type     TEXT NOT NULL,
    counsel_role TEXT NOT NULL DEFAULT 'shared',
    matter_track TEXT NOT NULL DEFAULT 'shared',
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

function extractTextFromPDF(buffer: ArrayBuffer): string {
  try {
    const bytes = new Uint8Array(buffer);
    const raw   = new TextDecoder('latin1').decode(bytes);
    const textParts: string[] = [];

    const btEtRegex = /BT([\s\S]*?)ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btEtRegex.exec(raw)) !== null) {
      const block = btMatch[1];

      const parenRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|TJ|'|")/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = parenRegex.exec(block)) !== null) {
        const s = pMatch[1]
          .replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
          .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
        if (s.trim().length > 0) textParts.push(s);
      }

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

    let text = textParts.join(' ');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  } catch {
    return '';
  }
}

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkText(text: string, chunkWords = 500, overlapWords = 50): string[] {
  const words  = text.split(/\s+/).filter(w => w.length > 0);
  const chunks: string[] = [];
  if (words.length === 0) return chunks;
  let start = 0;
  while (start < words.length) {
    const end   = Math.min(start + chunkWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 20) chunks.push(chunk);
    if (end >= words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

// ── Section-Aware Chunking (Fix 1) ───────────────────────────────────────────

/**
 * Detects whether text looks like a statute by checking for section-number
 * patterns: "1.", "1A.", "15(2).", "s.15", "Section 15", etc.
 */
function looksLikeStatute(text: string): boolean {
  const sectionPatterns = [
    /^\s*\d+[A-Z]?\.\s/m,              // "1. " "15A. " at line start
    /^\s*s\.\s*\d+/im,                 // "s.15" or "s. 15" at line start
    /^\s*Section\s+\d+/im,             // "Section 15"
    /\(\d+\)\s*[A-Z]/,                 // "(2) The court..."
  ];
  return sectionPatterns.some(re => re.test(text.slice(0, 5000)));
}

/**
 * Splits a statute into per-section chunks so each provision becomes its own
 * vector. Falls back to regular word-window chunking if no section boundaries
 * are detected.
 */
function chunkStatute(text: string): string[] {
  // Split on lines that look like section headings
  const sectionBoundary = /(?=^\s*(?:\d+[A-Z]?\.|\(?\d+\)?)\s+[A-Z])/m;
  const rawSections = text.split(sectionBoundary).map(s => s.trim()).filter(s => s.length > 20);

  if (rawSections.length < 3) {
    // Not enough section breaks found — fall back to word-window
    return chunkText(text);
  }

  // Merge very short sections (under 80 chars) with the next one
  const merged: string[] = [];
  let carry = '';
  for (const sec of rawSections) {
    const combined = carry ? `${carry}\n\n${sec}` : sec;
    if (combined.length < 80 && rawSections.indexOf(sec) < rawSections.length - 1) {
      carry = combined;
    } else {
      merged.push(combined);
      carry = '';
    }
  }
  if (carry) merged.push(carry);

  return merged;
}



/**
 * Derives jurisdiction, doc_type, doc_title, counsel_role, and matter_track
 * from the R2 key path.
 *
 * Key conventions:
 *   NG/civil_claimant/HighCourtRules.pdf      → counsel_role: claimant_side, matter_track: civil
 *   NG/civil_defendant/HighCourtRules.pdf     → counsel_role: defendant_side, matter_track: civil
 *   NG/criminal_prosecution/ACJA2015.pdf      → counsel_role: prosecution, matter_track: criminal
 *   NG/criminal_defence/ACJA2015.pdf          → counsel_role: defence, matter_track: criminal
 *   NG/shared/EvidenceAct2011.pdf             → counsel_role: shared, matter_track: shared
 *   NG/Statutes/SomeAct.pdf                   → counsel_role: shared, matter_track: shared (legacy)
 *   NG/Authorities/SomeCase.pdf               → counsel_role: shared, matter_track: shared (legacy)
 */
function parseKeyMetadata(key: string): {
  jurisdiction: string;
  doc_type:     string;
  doc_title:    string;
  counsel_role: string;
  matter_track: string;
  is_statute:   boolean;
} {
  const parts        = key.split('/');
  const jurisdiction = parts.length >= 3 ? parts[0] : 'NG';
  const folderName   = parts.length >= 3 ? parts[1] : parts[0];
  const filename     = parts[parts.length - 1];
  const doc_title    = filename
    .replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();

  // Map folder name → counsel_role + matter_track
  const folderLower = folderName.toLowerCase();
  let counsel_role = 'shared';
  let matter_track = 'shared';
  let doc_type     = folderName;

  if (folderLower === 'civil_claimant'  || folderLower === 'claimant') {
    counsel_role = 'claimant_side'; matter_track = 'civil';
    doc_type     = 'Civil — Claimant Side';
  } else if (folderLower === 'civil_defendant' || folderLower === 'defendant') {
    counsel_role = 'defendant_side'; matter_track = 'civil';
    doc_type     = 'Civil — Defendant Side';
  } else if (folderLower === 'criminal_prosecution' || folderLower === 'prosecution') {
    counsel_role = 'prosecution'; matter_track = 'criminal';
    doc_type     = 'Criminal — Prosecution';
  } else if (folderLower === 'criminal_defence' || folderLower === 'criminal_defense' || folderLower === 'defence' || folderLower === 'defense') {
    counsel_role = 'defence'; matter_track = 'criminal';
    doc_type     = 'Criminal — Defence';
  } else if (folderLower === 'civil' || folderLower === 'civil_shared') {
    counsel_role = 'shared'; matter_track = 'civil';
    doc_type     = 'Civil — Shared';
  } else if (folderLower === 'criminal' || folderLower === 'criminal_shared') {
    counsel_role = 'shared'; matter_track = 'criminal';
    doc_type     = 'Criminal — Shared';
  } else if (folderLower === 'matrimonial_shared') {
    counsel_role = 'shared'; matter_track = 'matrimonial';
    doc_type     = 'Matrimonial — Statute';          // all shared matrimonial docs are statutes
  } else if (folderLower === 'matrimonial_petitioner') {
    counsel_role = 'petitioner_side'; matter_track = 'matrimonial';
    doc_type     = 'Matrimonial — Petitioner Side';
  } else if (folderLower === 'matrimonial_respondent') {
    counsel_role = 'respondent_side'; matter_track = 'matrimonial';
    doc_type     = 'Matrimonial — Respondent Side';
  } else {
    // Legacy folders: Statutes, Authorities, shared, etc. → shared on both tracks
    counsel_role = 'shared'; matter_track = 'shared';
    doc_type     = folderName;
  }

  // A document is a statute when its doc_type includes 'Statute', or it lives in
  // a Statutes legacy folder, or the filename matches a known Act naming pattern.
  const is_statute =
    doc_type.includes('Statute') ||
    folderLower === 'statutes' ||
    /Act\d{4}|_Act_|Act\.pdf$/i.test(filename);

  return { jurisdiction, doc_type, doc_title, counsel_role, matter_track, is_statute };
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
    const listed  = await env.R2.list({ limit: 1000 });
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

    const placeholders = allKeys.map(() => '?').join(',');
    const alreadyRows  = await env.DB.prepare(
      `SELECT key FROM processed_files WHERE key IN (${placeholders}) AND status = 'ok'`
    ).bind(...allKeys).all();
    const alreadyDone  = new Set((alreadyRows.results || []).map((r: Record<string, unknown>) => r.key as string));
    const toProcess    = allKeys.filter(k => !alreadyDone.has(k));

    if (toProcess.length === 0) {
      return json({
        ok: true,
        message: 'All documents already processed. Upload new PDFs to R2 to add them.',
        processed: [], failed: [], skipped: [...alreadyDone],
      }, 200, origin);
    }

    for (const key of toProcess) {
      try {
        const obj = await env.R2.get(key);
        if (!obj) { failed.push({ key, reason: 'File not found in R2' }); continue; }

        const { jurisdiction, doc_type, doc_title, counsel_role, matter_track, is_statute } = parseKeyMetadata(key);
        let text = '';

        if (key.toLowerCase().endsWith('.txt')) {
          text = await obj.text();
        } else {
          const buffer = await obj.arrayBuffer();
          text = extractTextFromPDF(buffer);
        }

        if (!text || text.trim().length < 50) {
          const reason = 'Text extraction returned insufficient content. File may be scanned — run OCR first.';
          failed.push({ key, reason });
          await env.DB.prepare(
            'INSERT OR REPLACE INTO failed_files (key, reason, failed_at) VALUES (?, ?, ?)'
          ).bind(key, reason, new Date().toISOString()).run();
          continue;
        }

        // Fix 1 — section-aware chunking for statute documents
        const useStatuteChunker = is_statute || looksLikeStatute(text);
        const chunks = useStatuteChunker ? chunkStatute(text) : chunkText(text);
        if (chunks.length === 0) { failed.push({ key, reason: 'No chunks produced after splitting' }); continue; }

        let successfulChunks = 0;
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          const embedResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
            text: [chunk.slice(0, 2048)],
          }) as { data: number[][] };

          const embedding = embedResult.data[0];
          if (!embedding || embedding.length === 0) continue;

          const vectorId  = `${key.split('/').pop()!.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_${i}`;
          const chunkKey  = `chunks/${key}/chunk_${i}.txt`;

          // Store chunk text in R2 so it can be retrieved for the library block
          await env.R2.put(chunkKey, chunk, {
            httpMetadata: { contentType: 'text/plain' },
          });

          // ── ROLE-TAGGED VECTOR ──────────────────────────────────────────
          // counsel_role and matter_track are now stored on every vector.
          // This is what buildRoleFilter() queries against at retrieval time.
          await env.VECTORIZE.upsert([{
            id:       vectorId,
            values:   embedding,
            metadata: {
              doc_title,
              jurisdiction,
              doc_type,
              counsel_role,     // 'claimant_side' | 'defendant_side' | 'prosecution' | 'defence' | 'petitioner_side' | 'respondent_side' | 'shared'
              matter_track,     // 'civil' | 'criminal' | 'matrimonial' | 'shared'
              is_statute:    useStatuteChunker,
              chunk_index:   i,
              total_chunks:  chunks.length,
              source_file:   key,
              chunk_key:     chunkKey,
              upload_date:   new Date().toISOString(),
            },
          }]);

          successfulChunks++;
        }

        await env.DB.prepare(
          'INSERT OR REPLACE INTO processed_files (key, doc_title, jurisdiction, doc_type, counsel_role, matter_track, chunk_count, processed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(key, doc_title, jurisdiction, doc_type, counsel_role, matter_track, successfulChunks, new Date().toISOString(), 'ok').run();

        processed.push(`${key} [${counsel_role} / ${matter_track}]`);

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
      ok: true, elapsed_s: elapsed,
      summary: {
        total_in_library: allKeys.length,
        already_done:     alreadyDone.size,
        processed_now:    processed.length,
        failed:           failed.length,
      },
      processed, failed, skipped: [...alreadyDone],
    }, 200, origin);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ ok: false, error: msg }, 500, origin);
  }
}

// ── Chat (Role-Aware RAG) ─────────────────────────────────────────────────────

async function handleChat(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'API key not configured' }, 500, origin);
  }

  const body = await req.json() as Record<string, unknown>;

  // ── Extract role fields sent by api.ts ────────────────────────────────────
  const skipLibrary  = body.skip_library === true;
  const counselRole   = body.counsel_role  as CounselRole | undefined;
  const matterTrack   = body.matter_track  as MatterTrack | undefined;
  const ragFilter     = body.rag_filter    as Record<string, unknown> | undefined;
  const ragTopK       = typeof body.rag_top_k    === 'number' ? body.rag_top_k    : 8;
  const ragThreshold  = typeof body.rag_threshold === 'number' ? body.rag_threshold : 0.68;
  const queryHint     = body.engine        as string | undefined;

  // ── Build RAG query from last user message ────────────────────────────────
  let libraryBlock = '';
  const messages = body.messages as Array<{ role: string; content: string }> | undefined;
  const lastUserMsg = messages?.filter(m => m.role === 'user').pop()?.content ?? '';

  const queryText = [queryHint, lastUserMsg].filter(Boolean).join(' ').slice(0, 600);

  // skip_library bypasses this entire block — no embed call, no Vectorize
  // query, no R2 fetches. Used by calls (e.g. structured JSON extraction
  // from facts the user already typed in) that have no use for retrieved
  // legal materials and shouldn't pay for or risk being derailed by them.
  if (!skipLibrary && queryText.trim()) {
    try {
      // 1. Embed the query
      const embedResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: [queryText.slice(0, 2048)],
      }) as { data: number[][] };

      const embedding = embedResult.data[0];

      if (embedding && embedding.length > 0) {
        // 2. Build role-scoped Vectorize query options
        const queryOpts: VectorizeQueryOptions = {
          topK:           Math.min(ragTopK, 20),
          returnMetadata: 'all',
        };

        // Apply role filter — if counsel_role is provided, use it.
        // Fall back to caller-supplied rag_filter, then no filter (shared only).
        if (counselRole) {
          queryOpts.filter = buildRoleFilter(counselRole) as VectorizeVectorMetadataFilter;
        } else if (ragFilter) {
          queryOpts.filter = ragFilter as VectorizeVectorMetadataFilter;
        }

        // Apply namespace if available
        const ns = roleToNamespace(counselRole, matterTrack);
        if (ns) queryOpts.namespace = ns;

        // 3. Query Vectorize
        const results = await env.VECTORIZE.query(embedding, queryOpts);
        const matches  = (results.matches || []) as VectorMatch[];

        // 4. For each match, fetch the chunk text from R2
        const enrichedMatches = await Promise.all(
          matches
            .filter(m => (m.score ?? 0) >= ragThreshold)
            .slice(0, ragTopK)
            .map(async (m) => {
              const chunkKey = m.metadata?.chunk_key as string | undefined;
              if (chunkKey) {
                try {
                  const obj = await env.R2.get(chunkKey);
                  if (obj) {
                    const text = await obj.text();
                    return { ...m, metadata: { ...m.metadata, chunk_text: text } };
                  }
                } catch { /* chunk missing — use metadata only */ }
              }
              return m;
            })
        );

        // 5. Format library block for system prompt injection
        libraryBlock = formatLibraryBlock(enrichedMatches, counselRole);
      }
    } catch {
      // RAG failed — proceed without library context rather than blocking the call
      libraryBlock = '';
    }
  }

  // ── Build system prompt ──────────────────────────────────────────────────
  // body.system arrives as either:
  //   - a plain string   — legacy direct /chat callers (AICopilot, EvidenceVault,
  //     SanMode, InheritanceMode, BillionsVoiceWidget) that don't go through
  //     callClaude. Behaviour for these is unchanged.
  //   - a content-block array with cache_control on the cacheable block —
  //     sent by callClaude (src/services/api.ts) since prompt caching.
  //
  // The RAG library block is query-dependent (it's derived from the live
  // user message) and therefore changes nearly every call. Anthropic's
  // prompt cache is a PREFIX cache: a cache_control breakpoint only hits if
  // every token before it is byte-identical to a previous request. Putting
  // the volatile library block before the cacheable client block — as this
  // worker used to — meant the client's stable role+intelligence content
  // never actually got a cache hit, because the bytes in front of it kept
  // changing. So the library block must be appended AFTER the cacheable
  // block, never before, and never itself carries cache_control.
  const rawSystem = body.system as string | Array<{ type: string; text: string; cache_control?: unknown }> | undefined;

  let effectiveSystem: typeof rawSystem;
  if (Array.isArray(rawSystem)) {
    effectiveSystem = libraryBlock
      ? [...rawSystem, { type: 'text', text: libraryBlock }]
      : rawSystem;
  } else {
    const baseSystem = rawSystem ?? '';
    effectiveSystem = libraryBlock
      ? `${libraryBlock}\n\n${baseSystem}`
      : (baseSystem || undefined);
  }

  // ── Stream or one-shot ────────────────────────────────────────────────────
  // When body.stream === true the client wants SSE forwarded verbatim.
  // The Worker pipes the Anthropic SSE stream straight through without
  // buffering — the frontend is responsible for parsing the event stream.
  // When body.stream is absent or false, behaviour is unchanged (one-shot
  // JSON, fully backwards-compatible with all existing callClaude callers).
  const useStream = body.stream === true;

  const anthropicBody: Record<string, unknown> = {
    model:      body.model      ?? 'claude-sonnet-4-6',
    max_tokens: body.max_tokens ?? 1500,
    system:     effectiveSystem,
    messages:   body.messages,
  };
  if (useStream) anthropicBody.stream = true;

  // No anthropic-beta header needed — prompt caching is GA; cache_control
  // on a content block is sufficient on its own.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(anthropicBody),
  });

  if (!useStream) {
    // Existing path — parse JSON and return it unchanged.
    const data = await res.json();
    return json(data, res.status, origin);
  }

  // ── Streaming path — pipe SSE from Anthropic to the client ───────────────
  // The Anthropic SSE wire format uses these event types:
  //   message_start        — carries model + usage snapshot
  //   content_block_start  — opens a text block (index 0 for text output)
  //   content_block_delta  — carries { delta: { type: 'text_delta', text: '…' } }
  //   content_block_stop   — closes the block
  //   message_delta        — carries stop_reason + final usage
  //   message_stop         — stream is complete
  //
  // We forward the raw SSE bytes unchanged. The frontend (callClaude in
  // streaming mode) is responsible for parsing these events.
  //
  // Error handling: if Anthropic returns a non-2xx *before* streaming starts,
  // read the body as JSON and return it as a normal error response so the
  // frontend's existing error path works unchanged.
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return json(errData, res.status, origin);
  }

  if (!res.body) {
    return json({ error: 'Anthropic returned no body' }, 502, origin);
  }

  const sseHeaders = new Headers({
    'Content-Type':                 'text/event-stream',
    'Cache-Control':                'no-cache',
    'X-Accel-Buffering':            'no',
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });

  return new Response(res.body, { status: 200, headers: sseHeaders });
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
    embedding?: number[];
    topK?:      number;
    namespace?: string;
    filter?:    Record<string, unknown>;
  };
  if (!body.embedding || !Array.isArray(body.embedding)) {
    return json({ error: 'embedding array is required' }, 400, origin);
  }
  const queryOpts: VectorizeQueryOptions = {
    topK:           Math.min(body.topK ?? 8, 20),
    returnMetadata: 'all',
  };
  if (body.namespace) queryOpts.namespace = body.namespace;
  if (body.filter)    queryOpts.filter    = body.filter as VectorizeVectorMetadataFilter;
  const results = await env.VECTORIZE.query(body.embedding, queryOpts);
  return json({ matches: results.matches }, 200, origin);
}

// ── Case History RAG (Phase 6) ────────────────────────────────────────────────
//
// Two routes that mirror /embed and /query but operate on the CASE_HISTORY
// Vectorize index (afs-case-history) instead of the statute library.
//
// Every vector is tagged with { caseId } in metadata so retrievals are always
// scoped to a single case — one case can never surface another's history.
//
// Ingestion (/case-embed):
//   Called by the client (caseRag.ts → indexCaseChunk) after:
//   - compressIntelligence() writes a new digest snapshot
//   - CaseDocketTab.silentCompress() folds docket entries
//   - EvidenceVault persists an AI analysis result
//
// Retrieval (/case-query):
//   Called by the client (caseRag.ts → queryCaseHistory) when
//   shouldUseCaseRag() returns true for this case.

async function handleCaseEmbed(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';

  if (!env.CASE_HISTORY) {
    return json({ error: 'CASE_HISTORY Vectorize binding not configured — add [[vectorize]] block to wrangler.toml' }, 503, origin);
  }

  const body = await req.json() as {
    caseId?:    string;
    chunkId?:   string;
    text?:      string;
    type?:      string;
    createdAt?: string;
  };

  if (!body.caseId || !body.chunkId || !body.text?.trim()) {
    return json({ error: 'caseId, chunkId, and text are required' }, 400, origin);
  }

  try {
    // 1. Embed the chunk text
    const embedResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [body.text.slice(0, 2048)],
    }) as { data: number[][] };

    const embedding = embedResult.data[0];
    if (!embedding || embedding.length === 0) {
      return json({ error: 'Embedding failed — no vector returned' }, 500, origin);
    }

    // 2. Upsert into CASE_HISTORY — vector ID is "caseId:chunkId" to allow
    //    safe re-indexing (upsert overwrites the same ID on re-run).
    const vectorId = `${body.caseId}:${body.chunkId}`.slice(0, 96).replace(/[^a-zA-Z0-9:_-]/g, '_');

    await env.CASE_HISTORY.upsert([{
      id:       vectorId,
      values:   embedding,
      metadata: {
        caseId:    body.caseId,
        chunkId:   body.chunkId,
        type:      body.type ?? 'digest',
        createdAt: body.createdAt ?? new Date().toISOString(),
        // Store the text itself in metadata (max 10KB) so we don't need R2
        // for case chunks. Case chunks are much smaller than statute PDFs.
        text:      body.text.slice(0, 8192),
      },
    }]);

    return json({ ok: true, vectorId }, 200, origin);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ ok: false, error: msg }, 500, origin);
  }
}

async function handleCaseQuery(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';

  if (!env.CASE_HISTORY) {
    return json({ error: 'CASE_HISTORY Vectorize binding not configured' }, 503, origin);
  }

  const body = await req.json() as {
    caseId?: string;
    query?:  string;
    topK?:   number;
    type?:   string;  // optional CaseChunkType filter
  };

  if (!body.caseId || !body.query?.trim()) {
    return json({ error: 'caseId and query are required' }, 400, origin);
  }

  try {
    // 1. Embed the query
    const embedResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [body.query.slice(0, 2048)],
    }) as { data: number[][] };

    const embedding = embedResult.data[0];
    if (!embedding || embedding.length === 0) {
      return json({ results: [] }, 200, origin);
    }

    // 2. Query CASE_HISTORY scoped to this case
    const filter: Record<string, unknown> = { caseId: body.caseId };
    if (body.type) filter.type = body.type;

    const queryOpts: VectorizeQueryOptions = {
      topK:           Math.min(body.topK ?? 5, 10),
      returnMetadata: 'all',
      filter:         filter as VectorizeVectorMetadataFilter,
    };

    const results = await env.CASE_HISTORY.query(embedding, queryOpts);

    // 3. Shape into CaseChunk[] — text is stored directly in metadata
    const chunks = (results.matches || [])
      .filter(m => (m.score ?? 0) > 0.50 && m.metadata?.text)
      .map(m => ({
        chunkId:   m.metadata!.chunkId as string,
        caseId:    m.metadata!.caseId  as string,
        type:      m.metadata!.type    as string,
        text:      m.metadata!.text    as string,
        createdAt: m.metadata!.createdAt as string,
        score:     m.score ?? 0,
      }));

    return json({ results: chunks }, 200, origin);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ results: [], error: msg }, 500, origin);
  }
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
  await env.R2.put(key, req.body, { httpMetadata: { contentType } });
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

// ── Applications (D1) ─────────────────────────────────────────────────────────

async function handleGetApplications(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url    = new URL(req.url);
  const caseId = url.searchParams.get('caseId');
  if (!caseId) return json({ error: 'caseId is required' }, 400, origin);
  const rows = await env.DB.prepare(
    'SELECT data FROM applications WHERE case_id = ? ORDER BY json_extract(data, "$.createdAt") DESC'
  ).bind(caseId).all();
  const records = (rows.results || []).map((r: Record<string, unknown>) => JSON.parse(r.data as string));
  return json({ records }, 200, origin);
}

async function handlePutApplication(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const body = await req.json() as { id?: string; caseId?: string };
  if (!body.id || !body.caseId) return json({ error: 'id and caseId are required' }, 400, origin);
  await env.DB.prepare('INSERT OR REPLACE INTO applications (id, case_id, data) VALUES (?, ?, ?)')
    .bind(body.id, body.caseId, JSON.stringify(body)).run();
  return json({ ok: true }, 200, origin);
}

async function handleDeleteApplication(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400, origin);
  await env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}

// ── Phase 9F — Web Push Pipeline ─────────────────────────────────────────────
//
// Three endpoints complete the background push pipeline:
//
//   GET  /push/vapid-public-key  — returns VAPID_PUBLIC_KEY so the client can
//                                  create a PushSubscription tied to this server
//   POST /push/subscribe         — stores the PushSubscription JSON in D1 so
//                                  this Worker can reach the device when the app
//                                  is closed (called by subscribeToPush() in
//                                  src/services/pushSubscription.ts Phase 9E)
//   POST /push/send              — dispatches a push notification to all stored
//                                  subscriptions (or a single caseId-scoped one)
//                                  called by the monitor worker's cron (Phase 9F)
//
// VAPID signing uses the Web Crypto API (available in all Cloudflare Workers
// runtimes) to avoid the node-webpush npm dependency which doesn't run in
// the Workers edge environment.
//
// SECRETS REQUIRED (set via `wrangler secret put`):
//   VAPID_PUBLIC_KEY   — base64url P-256 public key (see Env comment above)
//   VAPID_PRIVATE_KEY  — base64url P-256 private key in PKCS#8 format
//   VAPID_SUBJECT      — mailto: or https: contact URI
//
// D1 TABLE REQUIRED:
//   push_subscriptions (endpoint TEXT PRIMARY KEY, keys_auth TEXT, keys_p256dh TEXT, created_at TEXT)
//   Added to ensureTables() below.

// ── VAPID JWT + encryption helpers ───────────────────────────────────────────

function b64uEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const raw  = atob(b64);
  const out  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Builds a VAPID Authorization header value for a given push endpoint.
 * Uses ES256 (ECDSA P-256 + SHA-256) as required by RFC 8292.
 *
 * The JWT header+payload are base64url-encoded and signed with the
 * VAPID private key. The resulting token is returned as the full
 * `vapid t=…,k=…` Authorization header value.
 */
async function buildVapidAuth(
  endpoint:   string,
  publicKey:  string,
  privateKey: string,
  subject:    string,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const exp      = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h TTL

  const header  = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uEncode(new TextEncoder().encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const sigInput = new TextEncoder().encode(`${header}.${payload}`);

  // Import PKCS#8 private key
  const privKeyBytes = b64uDecode(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', privKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  );

  // Sign with ECDSA P-256 / SHA-256 → raw 64-byte (r||s) signature
  const sigRaw = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, sigInput);
  const sig    = b64uEncode(sigRaw);

  const token = `${header}.${payload}.${sig}`;
  return `vapid t=${token},k=${publicKey}`;
}

/**
 * Sends a single web push message to one PushSubscription.
 *
 * Uses the VAPID Authentication Scheme (RFC 8292) and encrypts the payload
 * with the aesgcm scheme (RFC 8188 / draft-ietf-webpush-encryption) as
 * implemented by all major browser push services (FCM, Mozilla, WebKit).
 *
 * Payload encryption summary:
 *   1. Generate an ephemeral ECDH key pair on P-256
 *   2. Derive shared secret from ephemeral private + subscriber p256dh public
 *   3. Derive content encryption key + nonce via HKDF-SHA256
 *   4. Encrypt the payload with AES-128-GCM
 *   5. Pack salt + ephemeral public key + ciphertext into the body
 *
 * Returns the push service HTTP status code. 201 = delivered,
 * 404/410 = subscription gone (caller should delete it).
 */
async function sendWebPush(
  subscription: { endpoint: string; keys: { auth: string; p256dh: string } },
  payloadObj:   Record<string, unknown>,
  vapidPublic:  string,
  vapidPrivate: string,
  vapidSubject: string,
): Promise<number> {
  const payloadJson = JSON.stringify(payloadObj);
  const plaintext   = new TextEncoder().encode(payloadJson);

  // ── Key material ──────────────────────────────────────────────────────────
  const authSecret  = b64uDecode(subscription.keys.auth);     // 16 bytes
  const receiverPub = b64uDecode(subscription.keys.p256dh);   // 65 bytes uncompressed P-256

  // Import receiver's p256dh as EC public key
  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, [],
  );

  // Generate ephemeral ECDH key pair for this message
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveKey', 'deriveBits'],
  );

  // Derive shared secret (ECDH between ephemeral private and receiver public)
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey },
    ephemeralPair.privateKey, 256,
  );

  // Export ephemeral public key (65-byte uncompressed)
  const ephemeralPubRaw = await crypto.subtle.exportKey('raw', ephemeralPair.publicKey);

  // ── HKDF to derive CEK + nonce (aesgcm scheme) ───────────────────────────
  // PRK = HMAC-SHA256(auth_secret, shared_secret || "WebPush: info\0" || receiver_pub || ephemeral_pub)
  const infoSuffix = new Uint8Array([
    ...new TextEncoder().encode('WebPush: info\x00'),
    ...new Uint8Array(receiverPub),
    ...new Uint8Array(ephemeralPubRaw),
  ]);

  const hmacKey = await crypto.subtle.importKey(
    'raw', authSecret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const ikm = new Uint8Array([
    ...new Uint8Array(sharedSecret),
    ...infoSuffix,
  ]);
  const prkBuffer = await crypto.subtle.sign('HMAC', hmacKey, ikm);
  const prk = await crypto.subtle.importKey(
    'raw', prkBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );

  // Salt: 16 random bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // CEK = first 16 bytes of HMAC-SHA256(PRK, salt || info_cek || 0x01)
  const infoCek = new Uint8Array([
    ...new TextEncoder().encode('Content-Encoding: aesgcm\x00'),
    0x01,
  ]);
  const cekFull = await crypto.subtle.sign('HMAC', prk, new Uint8Array([...salt, ...infoCek]));
  const cekBytes = new Uint8Array(cekFull).slice(0, 16);

  // Nonce = first 12 bytes of HMAC-SHA256(PRK, salt || info_nonce || 0x01)
  const infoNonce = new Uint8Array([
    ...new TextEncoder().encode('Content-Encoding: nonce\x00'),
    0x01,
  ]);
  const nonceFull = await crypto.subtle.sign('HMAC', prk, new Uint8Array([...salt, ...infoNonce]));
  const nonceBytes = new Uint8Array(nonceFull).slice(0, 12);

  // ── AES-128-GCM encryption ────────────────────────────────────────────────
  const cek = await crypto.subtle.importKey('raw', cekBytes, 'AES-GCM', false, ['encrypt']);

  // Padding: 2-byte zero-length padding prefix (aesgcm scheme)
  const padded = new Uint8Array([0, 0, ...plaintext]);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBytes }, cek, padded);

  // ── Build body: salt(16) || rs(4, big-endian, = 4096) || keylen(1) || pubkey(65) || ciphertext ──
  const rs = 4096;
  const body = new Uint8Array(16 + 4 + 1 + 65 + new Uint8Array(ciphertext).length);
  let offset = 0;
  body.set(salt, offset);              offset += 16;
  body[offset++] = (rs >> 24) & 0xff;
  body[offset++] = (rs >> 16) & 0xff;
  body[offset++] = (rs >>  8) & 0xff;
  body[offset++] = (rs      ) & 0xff;
  body[offset++] = 65;                  // keylen
  body.set(new Uint8Array(ephemeralPubRaw), offset); offset += 65;
  body.set(new Uint8Array(ciphertext), offset);

  // ── VAPID Authorization header ────────────────────────────────────────────
  const authorization = await buildVapidAuth(
    subscription.endpoint, vapidPublic, vapidPrivate, vapidSubject,
  );

  // ── POST to the push service ──────────────────────────────────────────────
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':     authorization,
      'Content-Type':      'application/octet-stream',
      'Content-Encoding':  'aesgcm',
      'Encryption':        `salt=${b64uEncode(salt.buffer)}`,
      'Crypto-Key':        `dh=${b64uEncode(ephemeralPubRaw)};p256ecdsa=${vapidPublic}`,
      'TTL':               '86400',
    },
    body: body,
  });

  return res.status;
}

// ── Push endpoint handlers ────────────────────────────────────────────────────

/** GET /push/vapid-public-key — returns the VAPID public key for client subscription */
function handleGetVapidPublicKey(req: Request, env: Env): Response {
  const origin = req.headers.get('Origin') || '*';
  if (!env.VAPID_PUBLIC_KEY) {
    return json({ error: 'VAPID_PUBLIC_KEY secret not configured. Run: wrangler secret put VAPID_PUBLIC_KEY --name afs-legal-rag' }, 503, origin);
  }
  return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, origin);
}

/**
 * POST /push/subscribe — stores a PushSubscription sent by the client.
 * Body: { endpoint, keys: { auth, p256dh } }
 * Called by subscribeToPush() in src/services/pushSubscription.ts.
 */
async function handlePushSubscribe(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);

  const body = await req.json() as {
    endpoint?: string;
    keys?: { auth?: string; p256dh?: string };
  };

  if (!body.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
    return json({ error: 'endpoint, keys.auth, and keys.p256dh are required' }, 400, origin);
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_auth, keys_p256dh, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(body.endpoint, body.keys.auth, body.keys.p256dh, new Date().toISOString()).run();

  return json({ ok: true }, 200, origin);
}

/**
 * POST /push/send — dispatches a push notification to stored subscriptions.
 *
 * Body:
 *   title      string  — notification title (required)
 *   body       string  — notification body  (required)
 *   severity?  string  — CRITICAL | HIGH | MEDIUM | LOW (default LOW)
 *   caseId?    string  — if provided, also sets the deep-link URL
 *   tab?       string  — tab to open in the app (default 'alerts')
 *   actionUrl? string  — explicit deep-link override
 *
 * Called by the monitor worker's cron on critical deadline events,
 * and optionally by the client (AlertsEngine) when a user taps
 * "Notify all devices" on a CRITICAL alert (Phase 9F extension).
 *
 * Stale subscriptions (410 Gone) are deleted automatically.
 */
async function handlePushSend(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return json({
      error: 'VAPID secrets not fully configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.',
    }, 503, origin);
  }

  const body = await req.json() as {
    title?:     string;
    body?:      string;
    severity?:  string;
    caseId?:    string;
    tab?:       string;
    actionUrl?: string;
  };

  if (!body.title || !body.body) {
    return json({ error: 'title and body are required' }, 400, origin);
  }

  // Load all stored subscriptions from D1
  const rows = await env.DB.prepare(
    'SELECT endpoint, keys_auth, keys_p256dh FROM push_subscriptions'
  ).all();

  const subscriptions = (rows.results || []) as Array<{
    endpoint: string; keys_auth: string; keys_p256dh: string;
  }>;

  if (subscriptions.length === 0) {
    return json({ ok: true, sent: 0, failed: 0, removed: 0, message: 'No subscriptions registered' }, 200, origin);
  }

  const payload: Record<string, unknown> = {
    title:     body.title,
    body:      body.body,
    severity:  body.severity  ?? 'LOW',
    caseId:    body.caseId    ?? null,
    tab:       body.tab       ?? 'alerts',
    actionUrl: body.actionUrl ?? (body.caseId ? `/#engine?case=${body.caseId}&tab=alerts` : '/#home'),
  };

  let sent = 0, failed = 0, removed = 0;
  const staleEndpoints: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async sub => {
      try {
        const status = await sendWebPush(
          { endpoint: sub.endpoint, keys: { auth: sub.keys_auth, p256dh: sub.keys_p256dh } },
          payload,
          env.VAPID_PUBLIC_KEY!,
          env.VAPID_PRIVATE_KEY!,
          env.VAPID_SUBJECT!,
        );

        if (status === 201 || status === 200) {
          sent++;
        } else if (status === 404 || status === 410) {
          // Subscription is gone — mark for cleanup
          staleEndpoints.push(sub.endpoint);
          removed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    })
  );

  // Clean up stale subscriptions
  for (const endpoint of staleEndpoints) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run().catch(() => {});
  }

  return json({ ok: true, sent, failed, removed }, 200, origin);
}

// ── Main fetch handler ────────────────────────────────────────────────────────

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

    if (method === 'POST' && path === '/chat')        return handleChat(req, env);
    if (method === 'POST' && path === '/embed')       return handleEmbed(req, env);
    if (method === 'POST' && path === '/query')       return handleQuery(req, env);
    if (method === 'POST' && path === '/ingest')      return handleIngest(req, env);
    // Phase 6 — Case History RAG
    if (method === 'POST' && path === '/case-embed')  return handleCaseEmbed(req, env);
    if (method === 'POST' && path === '/case-query')  return handleCaseQuery(req, env);

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

    if (method === 'GET'    && path === '/applications') return handleGetApplications(req, env);
    if (method === 'PUT'    && path === '/application')  return handlePutApplication(req, env);
    if (method === 'DELETE' && path === '/application')  return handleDeleteApplication(req, env);

    if (method === 'GET'    && path === '/evidence/meta')   return handleGetEvidenceMeta(req, env);
    if (method === 'PUT'    && path === '/evidence/meta')   return handlePutEvidenceMeta(req, env);
    if (method === 'DELETE' && path === '/evidence/meta')   return handleDeleteEvidenceMeta(req, env);
    if (method === 'POST'   && path === '/evidence/file')   return handleUploadEvidenceFile(req, env);
    if (method === 'GET'    && path === '/evidence/file')   return handleGetEvidenceFile(req, env);
    if (method === 'DELETE' && path === '/evidence/file')   return handleDeleteEvidenceFile(req, env);

    // Phase 9F — Web Push Pipeline
    if (method === 'GET'  && path === '/push/vapid-public-key') return handleGetVapidPublicKey(req, env);
    if (method === 'POST' && path === '/push/subscribe')        return handlePushSubscribe(req, env);
    if (method === 'POST' && path === '/push/send')             return handlePushSend(req, env);

    return json({ error: 'Not found' }, 404, origin);
  },
};
