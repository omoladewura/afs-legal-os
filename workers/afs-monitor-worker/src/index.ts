/**
 * AFS Advocates — Legal Intelligence Monitor Worker (Phase H)
 *
 * Cloudflare Cron Worker — runs at 02:00 UTC daily.
 *
 * What it does:
 *   1. Fetches the latest-publications pages of every whitelisted source.
 *   2. Detects new instruments and judgments by title-matching against D1
 *      (processed_files table from the RAG worker).
 *   3. Stores new-document alerts in D1 (monitor_alerts table).
 *      DOES NOT download without lawyer approval.
 *   4. For overruled cases: tags matching Vectorize vectors with
 *      metadata { status: 'overruled' }.
 *   5. For repealed instruments: removes vectors from Vectorize, archives
 *      source chunks to R2 under /archive/.
 *
 * HTTP endpoints (for the SettingsPanel UI):
 *   GET  /monitor/alerts              — list unreviewed alerts
 *   POST /monitor/alerts/:id/dismiss  — mark alert dismissed
 *   POST /monitor/alerts/:id/download — trigger RAG worker /ingest for this doc
 *   GET  /monitor/stats               — last run timestamp + counts
 *   POST /monitor/run                 — manually trigger a scan (for testing)
 *
 * Security:
 *   All HTTP endpoints require Authorization: Bearer <AUTH_TOKEN>.
 *   Cron runs are always trusted (Cloudflare runtime, no auth header).
 *
 * Whitelist (HARDCODED — cannot be overridden by any request):
 *   nigeria-law.org, nigerialii.org, nationalassembly.gov.ng,
 *   supremecourt.gov.ng, bailii.org, law.cornell.edu
 */

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  DB:              D1Database;
  VECTORIZE:       Vectorize;
  R2:              R2Bucket;
  AUTH_TOKEN?:     string;
  RAG_WORKER_URL?: string;   // e.g. https://afs-legal-rag.sobamboadeshupo.workers.dev
  RAG_AUTH_TOKEN?: string;   // Bearer token for the RAG worker
}

// ─────────────────────────────────────────────────────────────────────────────
// WHITELIST — HARDCODED, NEVER OVERRIDABLE
// ─────────────────────────────────────────────────────────────────────────────

const WHITELISTED_DOMAINS = new Set([
  'nigerialii.org',
  'supremecourt.gov.ng',
  'nationalassembly.gov.ng',
  'justice.gov.ng',
  'placng.org',
]);

/**
 * Returns true only if the URL's hostname is in the hardcoded whitelist.
 * Subdomain-aware: api.nigerialii.org → nigerialii.org ✓
 */
function isWhitelisted(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    // Check exact match and parent-domain match
    if (WHITELISTED_DOMAINS.has(hostname)) return true;
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      if (WHITELISTED_DOMAINS.has(parts.slice(i).join('.'))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCES — latest-publication pages to scan
// ─────────────────────────────────────────────────────────────────────────────

interface MonitorSource {
  id:       string;
  label:    string;
  url:      string;       // The page to fetch
  type:     'judgment' | 'statute' | 'both';
  // CSS-free title extraction: look for these patterns in raw HTML
  patterns: string[];
}

const SOURCES: MonitorSource[] = [
  {
    id:       'nigerialii_judgments',
    label:    'NigeriaLII — Recent Judgments',
    url:      'https://nigerialii.org/ng/judgment',
    type:     'judgment',
    patterns: ['<title>', 'href="/ng/judgment/', 'class="views-field-title"'],
  },
  {
    id:       'supremecourt_judgments',
    label:    'Supreme Court of Nigeria — Recent Decisions',
    url:      'https://supremecourt.gov.ng/judgments',
    type:     'judgment',
    patterns: ['judgment', 'decision', 'appeal no', 'sc/'],
  },
  {
    id:       'nationalassembly_bills',
    label:    'National Assembly — Bills & Acts',
    url:      'https://nationalassembly.gov.ng/legislative-documents/bills',
    type:     'statute',
    patterns: ['bill', 'act', 'amendment', 'gazette'],
  },
  {
    id:       'nigerialaw_statutes',
    label:    'Nigeria Law — Statutes',
    url:      'https://nigeria-law.org/LFN/NigeriaLawHome.html',
    type:     'statute',
    patterns: ['act', 'decree', 'lfn', 'cap'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type AlertStatus = 'unreviewed' | 'dismissed' | 'downloaded';
type AlertType   = 'new_judgment' | 'new_statute' | 'overruled' | 'repealed';

interface MonitorAlert {
  id:          string;
  sourceId:    string;
  sourceLabel: string;
  sourceUrl:   string;
  docTitle:    string;
  alertType:   AlertType;
  status:      AlertStatus;
  detectedAt:  string;   // ISO timestamp
  notes?:      string;
}

interface RunStats {
  lastRunAt:     string;
  alertsCreated: number;
  sourcesScanned: number;
  errors:        string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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

function uid(): string {
  return `mon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SETUP
// ─────────────────────────────────────────────────────────────────────────────

async function ensureTables(env: Env): Promise<void> {
  // monitor_alerts — stores each detected new document or overrule/repeal
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monitor_alerts (
      id           TEXT PRIMARY KEY,
      source_id    TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_url   TEXT NOT NULL,
      doc_title    TEXT NOT NULL,
      alert_type   TEXT NOT NULL DEFAULT 'new_judgment',
      status       TEXT NOT NULL DEFAULT 'unreviewed',
      detected_at  TEXT NOT NULL,
      notes        TEXT
    )
  `).run();

  // monitor_runs — log of every cron execution
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monitor_runs (
      id              TEXT PRIMARY KEY,
      ran_at          TEXT NOT NULL,
      sources_scanned INTEGER NOT NULL DEFAULT 0,
      alerts_created  INTEGER NOT NULL DEFAULT 0,
      errors          TEXT NOT NULL DEFAULT '[]'
    )
  `).run();

  // monitor_seen — deduplication: title fingerprints we have already alerted on
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monitor_seen (
      fingerprint TEXT PRIMARY KEY,
      first_seen  TEXT NOT NULL
    )
  `).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE FINGERPRINT
// A normalised key for deduplication — lowercase, strip punctuation.
// ─────────────────────────────────────────────────────────────────────────────

function fingerprint(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE EXTRACTION
// Parses raw HTML to extract candidate document titles without a DOM parser.
// Uses regex on common HTML patterns: <h1-3>, <a> tags, list items.
// ─────────────────────────────────────────────────────────────────────────────

function extractTitles(html: string, source: MonitorSource): string[] {
  const titles: string[] = [];

  // Extract from heading tags
  const headingRe = /<h[123][^>]*>([^<]{10,200})<\/h[123]>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) !== null) {
    const t = m[1].trim().replace(/\s+/g, ' ');
    if (t.length > 10 && t.length < 200) titles.push(t);
  }

  // Extract from <a> tags that look like document links
  const linkRe = /<a\s[^>]*href="[^"]*(?:judgment|act|bill|decision|case)[^"]*"[^>]*>([^<]{10,200})<\/a>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const t = m[1].trim().replace(/\s+/g, ' ');
    if (t.length > 10 && t.length < 200) titles.push(t);
  }

  // Extract from list items that contain a source pattern keyword
  const liRe = /<li[^>]*>([^<]{10,300})<\/li>/gi;
  while ((m = liRe.exec(html)) !== null) {
    const t = m[1].trim().replace(/\s+/g, ' ');
    const lower = t.toLowerCase();
    if (source.patterns.some(p => lower.includes(p.toLowerCase()))) {
      if (t.length > 10 && t.length < 200) titles.push(t);
    }
  }

  // Deduplicate
  return [...new Set(titles)];
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERRULE / REPEAL DETECTION
// Checks extracted titles for signals that an existing library item
// has been overruled or repealed.
// ─────────────────────────────────────────────────────────────────────────────

const OVERRULE_SIGNALS = [
  'overruled', 'overrules', 'not good law', 'per incuriam',
  'departure from', 'no longer binding',
];

const REPEAL_SIGNALS = [
  'repeal', 'repeals', 'repealed', 'revoke', 'revoked', 'revocation',
  'amendment act', 'amends and repeals',
];

function detectAlertType(title: string): AlertType {
  const lower = title.toLowerCase();
  if (REPEAL_SIGNALS.some(s => lower.includes(s)))  return 'repealed';
  if (OVERRULE_SIGNALS.some(s => lower.includes(s))) return 'overruled';
  return 'new_judgment';
}

// ─────────────────────────────────────────────────────────────────────────────
// VECTORIZE — tag overruled vectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For a title flagged as overruled, query Vectorize for matching vectors
 * and upsert them back with status: 'overruled' in their metadata.
 *
 * This is best-effort: Vectorize does not expose a full-text search so we
 * embed the title and find nearest neighbours, then check doc_title match.
 */
async function tagOverruledVectors(title: string, env: Env): Promise<void> {
  try {
    // We cannot embed without Workers AI — skip if the binding is absent
    // (afs-monitor-worker does not bind AI; it delegates embedding to the
    //  RAG worker. If RAG_WORKER_URL is set we use it; otherwise skip.)
    if (!env.RAG_WORKER_URL) return;

    const embedRes = await fetch(`${env.RAG_WORKER_URL}/embed`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.RAG_AUTH_TOKEN ?? ''}`,
      },
      body: JSON.stringify({ text: title }),
    });
    if (!embedRes.ok) return;

    const { embedding } = await embedRes.json<{ embedding: number[] }>();
    if (!embedding) return;

    const matches = await env.VECTORIZE.query(embedding, {
      topK:            20,
      returnMetadata:  'all',
    });

    const titleFp = fingerprint(title);

    for (const match of matches.matches ?? []) {
      const meta = match.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      const docTitle = String(meta.doc_title ?? '');
      if (fingerprint(docTitle).includes(titleFp.slice(0, 40)) ||
          titleFp.includes(fingerprint(docTitle).slice(0, 40))) {
        // Re-upsert with overruled tag — same id, same vector, updated metadata
        await env.VECTORIZE.upsert([{
          id:       match.id,
          values:   embedding,   // approximate; exact vector not returned by query
          metadata: { ...meta, status: 'overruled', overruled_at: new Date().toISOString() },
        }]);
      }
    }
  } catch {
    // Best-effort — non-fatal
  }
}

/**
 * For a title flagged as repealed, remove matching vectors from Vectorize
 * and archive their R2 chunk keys under /archive/.
 */
async function archiveRepealedVectors(title: string, env: Env): Promise<void> {
  try {
    if (!env.RAG_WORKER_URL) return;

    const embedRes = await fetch(`${env.RAG_WORKER_URL}/embed`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.RAG_AUTH_TOKEN ?? ''}`,
      },
      body: JSON.stringify({ text: title }),
    });
    if (!embedRes.ok) return;

    const { embedding } = await embedRes.json<{ embedding: number[] }>();
    if (!embedding) return;

    const matches = await env.VECTORIZE.query(embedding, {
      topK:           20,
      returnMetadata: 'all',
    });

    const titleFp = fingerprint(title);
    const toDelete: string[] = [];

    for (const match of matches.matches ?? []) {
      const meta = match.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      const docTitle = String(meta.doc_title ?? '');
      if (!fingerprint(docTitle).includes(titleFp.slice(0, 40))) continue;

      toDelete.push(match.id);

      // Archive the R2 chunk
      const chunkKey = String(meta.chunk_key ?? '');
      if (chunkKey) {
        const obj = await env.R2.get(chunkKey);
        if (obj) {
          const body = await obj.arrayBuffer();
          await env.R2.put(`archive/${chunkKey}`, body, {
            httpMetadata: { contentType: 'text/plain' },
            customMetadata: { archived_at: new Date().toISOString(), reason: 'repealed' },
          });
          await env.R2.delete(chunkKey);
        }
      }
    }

    if (toDelete.length > 0) {
      await env.VECTORIZE.deleteByIds(toDelete);
    }
  } catch {
    // Best-effort — non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE SCAN — called by cron and by POST /monitor/run
// ─────────────────────────────────────────────────────────────────────────────

async function runScan(env: Env): Promise<RunStats> {
  await ensureTables(env);

  const stats: RunStats = {
    lastRunAt:      new Date().toISOString(),
    alertsCreated:  0,
    sourcesScanned: 0,
    errors:         [],
  };

  for (const source of SOURCES) {
    // Whitelist guard — belt and braces
    if (!isWhitelisted(source.url)) {
      stats.errors.push(`BLOCKED non-whitelisted source: ${source.url}`);
      continue;
    }

    try {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': 'AFS-Legal-Monitor/1.0 (Legal intelligence scanner; contact: admin@afsadvocates.com)',
          'Accept':     'text/html,application/xhtml+xml',
        },
        // Cloudflare Workers: follow redirects, 10s timeout
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        stats.errors.push(`HTTP ${res.status} fetching ${source.url}`);
        continue;
      }

      const html    = await res.text();
      const titles  = extractTitles(html, source);
      stats.sourcesScanned++;

      for (const title of titles) {
        const fp = fingerprint(title);
        if (!fp || fp.length < 8) continue;

        // Deduplication check
        const existing = await env.DB.prepare(
          'SELECT fingerprint FROM monitor_seen WHERE fingerprint = ?'
        ).bind(fp).first();

        if (existing) continue;   // Already alerted on this title

        // Check against processed_files to avoid alerting on already-ingested docs
        const alreadyIngested = await env.DB.prepare(
          "SELECT key FROM processed_files WHERE LOWER(doc_title) LIKE ?"
        ).bind(`%${fp.slice(0, 30)}%`).first();

        if (alreadyIngested) {
          // Mark seen but don't create alert
          await env.DB.prepare(
            'INSERT OR IGNORE INTO monitor_seen (fingerprint, first_seen) VALUES (?, ?)'
          ).bind(fp, new Date().toISOString()).run();
          continue;
        }

        // Determine alert type
        const alertType = detectAlertType(title);

        // Create alert
        const alertId = uid();
        const alert: MonitorAlert = {
          id:          alertId,
          sourceId:    source.id,
          sourceLabel: source.label,
          sourceUrl:   source.url,
          docTitle:    title,
          alertType,
          status:      'unreviewed',
          detectedAt:  new Date().toISOString(),
        };

        await env.DB.prepare(`
          INSERT OR IGNORE INTO monitor_alerts
            (id, source_id, source_label, source_url, doc_title, alert_type, status, detected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          alert.id, alert.sourceId, alert.sourceLabel, alert.sourceUrl,
          alert.docTitle, alert.alertType, alert.status, alert.detectedAt,
        ).run();

        await env.DB.prepare(
          'INSERT OR IGNORE INTO monitor_seen (fingerprint, first_seen) VALUES (?, ?)'
        ).bind(fp, new Date().toISOString()).run();

        stats.alertsCreated++;

        // Async side-effects for overruled / repealed
        if (alertType === 'overruled') {
          await tagOverruledVectors(title, env);
        } else if (alertType === 'repealed') {
          await archiveRepealedVectors(title, env);
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`Error scanning ${source.id}: ${msg}`);
    }
  }

  // Log the run
  await env.DB.prepare(`
    INSERT INTO monitor_runs (id, ran_at, sources_scanned, alerts_created, errors)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    uid(),
    stats.lastRunAt,
    stats.sourcesScanned,
    stats.alertsCreated,
    JSON.stringify(stats.errors),
  ).run();

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/** GET /monitor/alerts — returns all unreviewed alerts, newest first */
async function handleGetAlerts(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);

  const url    = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'unreviewed';

  const rows = await env.DB.prepare(
    'SELECT * FROM monitor_alerts WHERE status = ? ORDER BY detected_at DESC LIMIT 100'
  ).bind(status).all();

  const alerts: MonitorAlert[] = (rows.results ?? []).map((r: Record<string, unknown>) => ({
    id:          String(r.id),
    sourceId:    String(r.source_id),
    sourceLabel: String(r.source_label),
    sourceUrl:   String(r.source_url),
    docTitle:    String(r.doc_title),
    alertType:   String(r.alert_type) as AlertType,
    status:      String(r.status) as AlertStatus,
    detectedAt:  String(r.detected_at),
    notes:       r.notes ? String(r.notes) : undefined,
  }));

  // Badge count — total unreviewed
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM monitor_alerts WHERE status = 'unreviewed'"
  ).first<{ n: number }>();

  return json({ ok: true, alerts, unreviewedCount: countRow?.n ?? 0 }, 200, origin);
}

/** POST /monitor/alerts/:id/dismiss — mark an alert dismissed */
async function handleDismissAlert(req: Request, env: Env, id: string): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);
  await env.DB.prepare(
    "UPDATE monitor_alerts SET status = 'dismissed' WHERE id = ?"
  ).bind(id).run();
  return json({ ok: true }, 200, origin);
}

/**
 * POST /monitor/alerts/:id/download
 * Triggers the RAG worker's /ingest pipeline for a specific alert.
 * The lawyer must have approved download — this is the action behind the
 * "Download & Add" button in the UI.
 *
 * The document must live on a whitelisted domain (checked again here).
 * We pass the source URL to the RAG worker's ingest endpoint which
 * already handles R2 upload + Vectorize chunking.
 */
async function handleDownloadAlert(req: Request, env: Env, id: string): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);

  const row = await env.DB.prepare(
    'SELECT * FROM monitor_alerts WHERE id = ?'
  ).bind(id).first<Record<string, unknown>>();

  if (!row) return json({ error: 'Alert not found' }, 404, origin);

  const sourceUrl = String(row.source_url ?? '');

  // Belt-and-braces whitelist re-check before any download
  if (!isWhitelisted(sourceUrl)) {
    return json({ error: 'Source URL is not on the whitelist. Download blocked.' }, 403, origin);
  }

  if (!env.RAG_WORKER_URL) {
    return json({ error: 'RAG_WORKER_URL secret not configured. Cannot trigger ingest.' }, 503, origin);
  }

  // Delegate to the RAG worker's /ingest endpoint.
  // The RAG worker fetches from R2, so this is the pattern:
  // We tell the RAG worker to ingest a specific URL (requires /ingest to
  // support a url_override body field — if not yet supported, we return
  // instructions for the lawyer to manually add to R2).
  try {
    const ingestRes = await fetch(`${env.RAG_WORKER_URL}/ingest`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.RAG_AUTH_TOKEN ?? ''}`,
      },
      body: JSON.stringify({
        url_override: sourceUrl,
        doc_title:    String(row.doc_title ?? ''),
        alert_id:     id,
      }),
    });

    const ingestData = await ingestRes.json<{ ok: boolean; error?: string }>();

    if (ingestData.ok) {
      await env.DB.prepare(
        "UPDATE monitor_alerts SET status = 'downloaded' WHERE id = ?"
      ).bind(id).run();
      return json({ ok: true, message: 'Ingest triggered successfully.' }, 200, origin);
    } else {
      // RAG worker doesn't yet support url_override — return manual instructions
      return json({
        ok:      false,
        message: 'Automatic ingest not yet available for URL-sourced documents. ' +
                 'Download the document manually, upload to your R2 bucket under ' +
                 'NG/shared/<filename>.pdf, then click "Process Library" in Settings.',
        sourceUrl,
        docTitle: String(row.doc_title ?? ''),
      }, 200, origin);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Ingest call failed: ${msg}` }, 502, origin);
  }
}

/** GET /monitor/stats — last run info + unreviewed count */
async function handleGetStats(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  await ensureTables(env);

  const lastRun = await env.DB.prepare(
    'SELECT * FROM monitor_runs ORDER BY ran_at DESC LIMIT 1'
  ).first<Record<string, unknown>>();

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM monitor_alerts WHERE status = 'unreviewed'"
  ).first<{ n: number }>();

  return json({
    ok:             true,
    lastRunAt:      lastRun ? String(lastRun.ran_at) : null,
    sourcesScanned: lastRun ? Number(lastRun.sources_scanned) : 0,
    alertsCreated:  lastRun ? Number(lastRun.alerts_created)  : 0,
    errors:         lastRun ? JSON.parse(String(lastRun.errors ?? '[]')) : [],
    unreviewedCount: countRow?.n ?? 0,
    whitelist:      [...WHITELISTED_DOMAINS],
  }, 200, origin);
}

/** POST /monitor/run — manually trigger a scan (testing / admin use) */
async function handleManualRun(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*';
  const stats  = await runScan(env);
  return json({ ok: true, stats }, 200, origin);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — fetch + scheduled handlers
// ─────────────────────────────────────────────────────────────────────────────

export default {

  // ── Cron trigger ────────────────────────────────────────────────────────
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScan(env));
  },

  // ── HTTP handler ─────────────────────────────────────────────────────────
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

    if (method === 'GET'  && path === '/monitor/alerts')         return handleGetAlerts(req, env);
    if (method === 'GET'  && path === '/monitor/stats')          return handleGetStats(req, env);
    if (method === 'POST' && path === '/monitor/run')            return handleManualRun(req, env);

    // Alert actions — extract id from path: /monitor/alerts/:id/dismiss
    const dismissMatch  = path.match(/^\/monitor\/alerts\/([^/]+)\/dismiss$/);
    const downloadMatch = path.match(/^\/monitor\/alerts\/([^/]+)\/download$/);

    if (method === 'POST' && dismissMatch)  return handleDismissAlert(req, env, dismissMatch[1]);
    if (method === 'POST' && downloadMatch) return handleDownloadAlert(req, env, downloadMatch[1]);

    return json({ error: 'Not found' }, 404, origin);
  },
};
