/**
 * AFS Advocates — Storage Helpers
 *
 * Dual-write storage: every save goes to both IndexedDB (local) and D1
 * via the Cloudflare Worker (cloud). Every load tries D1 first; if the
 * Worker is unreachable (offline / cold start), IndexedDB is used silently.
 *
 * This means:
 *  - Open on phone → cases load from D1
 *  - Open on laptop → same cases, automatically
 *  - Go offline → IndexedDB keeps everything working
 *  - Come back online → next save syncs back to D1
 */

import { db } from './db';
import type { Case, DocketEntry, Deadline, EvidenceItem, ArgumentVersion, CaseTheoryRecord, CaseTheoryHistoryEntry, CaseSummary, CloneableApplicationRecord } from '@/types';
import type { MatrimonialCaseData, MExtractionResult } from '@/matrimonial/types';
import type { BlindSpotRecord, ResearchRecord, ArgumentTemplate } from './db';

// ── Config ────────────────────────────────────────────────────────────────────

const WORKER_URL   = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const WORKER_TOKEN = 'AFS2026SecureToken99';

function syncHeaders(): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${WORKER_TOKEN}`,
  };
}

async function syncGet(path: string): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${WORKER_URL}${path}`, {
        method:  'GET',
        headers: syncHeaders(),
        signal:  controller.signal,
      });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;   // offline or cold — fall back to IndexedDB
  }
}

async function syncPut(path: string, body: unknown): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 6000);
    try {
      await fetch(`${WORKER_URL}${path}`, {
        method:  'PUT',
        headers: syncHeaders(),
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // sync failed silently — IndexedDB already has the data
  }
}

async function syncDelete(path: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 6000);
    try {
      await fetch(`${WORKER_URL}${path}`, {
        method:  'DELETE',
        headers: syncHeaders(),
        signal:  controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // sync failed silently
  }
}

// ── ID generators ──────────────────────────────────────────────────────────────

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function cid(): string {
  return 'c_' + uid();
}

// ── Cases ─────────────────────────────────────────────────────────────────────

export async function loadCases(): Promise<Case[]> {
  // Try D1 first — gives cross-device sync
  const remote = await syncGet('/cases') as { cases?: Case[] } | null;
  if (remote?.cases && remote.cases.length > 0) {
    // Update local IndexedDB to match D1 (background, non-blocking)
    Promise.all(remote.cases.map(c => db.cases.put(c))).catch(() => {});
    return remote.cases;
  }
  // Fall back to IndexedDB
  try {
    return await db.cases.orderBy('createdAt').reverse().toArray();
  } catch (e) {
    console.error('[Storage] loadCases failed', e);
    return [];
  }
}

export async function loadCase(id: string): Promise<Case | null> {
  try {
    return await db.cases.get(id) ?? null;
  } catch (e) {
    console.error('[Storage] loadCase failed', e);
    return null;
  }
}

export async function saveCase(c: Case): Promise<boolean> {
  try {
    // Write to IndexedDB immediately
    await db.cases.put(c);
    // Sync to D1 in background
    syncPut('/case', c);
    return true;
  } catch (e) {
    console.error('[Storage] saveCase failed', e);
    return false;
  }
}

export async function deleteCase(id: string): Promise<boolean> {
  try {
    await db.transaction('rw',
      db.cases, db.docket_entries, db.deadlines,
      db.evidence_meta, db.evidence_files, db.blind_spots, db.research, db.arg_versions,
      async () => {
        await db.cases.delete(id);
        await db.docket_entries.where('caseId').equals(id).delete();
        await db.deadlines.where('caseId').equals(id).delete();
        const evIds = await db.evidence_meta
          .where('caseId').equals(id)
          .primaryKeys();
        await db.evidence_files.bulkDelete(evIds as string[]);
        await db.evidence_meta.where('caseId').equals(id).delete();
        await db.blind_spots.where('caseId').equals(id).delete();
        await db.research.where('caseId').equals(id).delete();
        await db.arg_versions.where('caseId').equals(id).delete();
      }
    );
    // Sync delete to D1 — this cascades entries/deadlines/research server-side
    syncDelete(`/case?id=${encodeURIComponent(id)}`);
    return true;
  } catch (e) {
    console.error('[Storage] deleteCase failed', e);
    return false;
  }
}

// ── Docket Entries ────────────────────────────────────────────────────────────

export async function loadEntries(caseId: string): Promise<DocketEntry[]> {
  const remote = await syncGet(`/entries?caseId=${encodeURIComponent(caseId)}`) as { entries?: DocketEntry[] } | null;
  if (remote?.entries && remote.entries.length > 0) {
    Promise.all(remote.entries.map(e => db.docket_entries.put(e))).catch(() => {});
    return remote.entries;
  }
  try {
    return await db.docket_entries
      .where('caseId').equals(caseId)
      .sortBy('dateFiled')
      .then(arr => arr.reverse());
  } catch (e) {
    console.error('[Storage] loadEntries failed', e);
    return [];
  }
}

export async function saveEntry(entry: DocketEntry): Promise<boolean> {
  try {
    await db.docket_entries.put(entry);
    syncPut('/entry', entry);
    return true;
  } catch (e) {
    console.error('[Storage] saveEntry failed', e);
    return false;
  }
}

export async function deleteEntry(id: string): Promise<boolean> {
  try {
    await db.docket_entries.delete(id);
    syncDelete(`/entry?id=${encodeURIComponent(id)}`);
    return true;
  } catch (e) {
    console.error('[Storage] deleteEntry failed', e);
    return false;
  }
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

export async function loadDeadlines(caseId: string): Promise<Deadline[]> {
  const remote = await syncGet(`/deadlines?caseId=${encodeURIComponent(caseId)}`) as { deadlines?: Deadline[] } | null;
  if (remote?.deadlines && remote.deadlines.length > 0) {
    Promise.all(remote.deadlines.map(d => db.deadlines.put(d))).catch(() => {});
    return remote.deadlines;
  }
  try {
    return await db.deadlines.where('caseId').equals(caseId).sortBy('date');
  } catch (e) {
    console.error('[Storage] loadDeadlines failed', e);
    return [];
  }
}

export async function saveDeadline(dl: Deadline): Promise<boolean> {
  try {
    await db.deadlines.put(dl);
    syncPut('/deadline', dl);
    return true;
  } catch (e) {
    console.error('[Storage] saveDeadline failed', e);
    return false;
  }
}

export async function deleteDeadline(id: string): Promise<boolean> {
  try {
    await db.deadlines.delete(id);
    syncDelete(`/deadline?id=${encodeURIComponent(id)}`);
    return true;
  } catch (e) {
    console.error('[Storage] deleteDeadline failed', e);
    return false;
  }
}

// ── Evidence ──────────────────────────────────────────────────────────────────
// Metadata → D1 (synced). Files → R2 via Worker (synced). IndexedDB is local fallback.

export async function loadEvidenceMeta(caseId: string): Promise<EvidenceItem[]> {
  const remote = await syncGet(`/evidence/meta?caseId=${encodeURIComponent(caseId)}`) as { items?: EvidenceItem[] } | null;
  if (remote?.items && remote.items.length > 0) {
    Promise.all(remote.items.map(e => db.evidence_meta.put(e))).catch(() => {});
    return remote.items;
  }
  try {
    return await db.evidence_meta
      .where('caseId').equals(caseId)
      .sortBy('timestamp')
      .then(arr => arr.reverse());
  } catch (e) {
    console.error('[Storage] loadEvidenceMeta failed', e);
    return [];
  }
}

export async function saveEvidenceMeta(items: EvidenceItem[]): Promise<boolean> {
  try {
    await db.evidence_meta.bulkPut(items);
    // Sync each item to D1
    for (const item of items) {
      syncPut('/evidence/meta', item);
    }
    return true;
  } catch (e) {
    console.error('[Storage] saveEvidenceMeta failed', e);
    return false;
  }
}

export async function saveEvidenceFile(id: string, data: string, caseId: string): Promise<boolean> {
  try {
    // Save to IndexedDB immediately (local fallback)
    await db.evidence_files.put({ id, data });

    // Upload to R2 via Worker — convert base64 data URL to binary
    try {
      const base64 = data.includes(',') ? data.split(',')[1] : data;
      const mimeMatch = data.match(/data:([^;]+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s for file upload
      try {
        await fetch(`${WORKER_URL}/evidence/file?id=${encodeURIComponent(id)}&caseId=${encodeURIComponent(caseId)}`, {
          method: 'POST',
          headers: { ...syncHeaders(), 'Content-Type': mime },
          body: binary,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // R2 upload failed silently — file still in IndexedDB
    }

    return true;
  } catch (e) {
    console.error('[Storage] saveEvidenceFile failed — storage may be full', e);
    return false;
  }
}

export async function loadEvidenceFile(id: string, caseId?: string): Promise<string | null> {
  // Try R2 first if caseId provided
  if (caseId) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(
          `${WORKER_URL}/evidence/file?id=${encodeURIComponent(id)}&caseId=${encodeURIComponent(caseId)}`,
          { method: 'GET', headers: syncHeaders(), signal: controller.signal }
        );
        if (res.ok) {
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // fall through to IndexedDB
    }
  }
  // Fallback to IndexedDB
  try {
    const rec = await db.evidence_files.get(id);
    return rec?.data ?? null;
  } catch (e) {
    console.error('[Storage] loadEvidenceFile failed', e);
    return null;
  }
}

export async function deleteEvidenceFile(id: string, caseId?: string): Promise<boolean> {
  try {
    await db.evidence_files.delete(id);
    await db.evidence_meta.delete(id);
    if (caseId) {
      syncDelete(`/evidence/file?id=${encodeURIComponent(id)}&caseId=${encodeURIComponent(caseId)}`);
      syncDelete(`/evidence/meta?id=${encodeURIComponent(id)}`);
    }
    return true;
  } catch (e) {
    console.error('[Storage] deleteEvidenceFile failed', e);
    return false;
  }
}

// ── Blind Spots ───────────────────────────────────────────────────────────────
// Blind spot data is session-specific analytical output — local only is fine.

export async function loadBlindSpot<T>(caseId: string, module: string, fallback?: T): Promise<T | null> {
  try {
    const rec = await db.blind_spots.get(`afs_bs_${module}_${caseId}`);
    return (rec?.data as T) ?? fallback ?? null;
  } catch (e) {
    console.error('[Storage] loadBlindSpot failed', e);
    return fallback ?? null;
  }
}

export async function saveBlindSpot(caseId: string, module: string, data: unknown): Promise<boolean> {
  try {
    await db.blind_spots.put({
      id: `afs_bs_${module}_${caseId}`,
      caseId,
      module,
      data,
    });
    return true;
  } catch (e) {
    console.error('[Storage] saveBlindSpot failed', e);
    return false;
  }
}

// ── Research ──────────────────────────────────────────────────────────────────

export async function loadResearch(caseId: string): Promise<ResearchRecord[]> {
  const remote = await syncGet(`/research?caseId=${encodeURIComponent(caseId)}`) as { records?: ResearchRecord[] } | null;
  if (remote?.records && remote.records.length > 0) {
    Promise.all(remote.records.map(r => db.research.put(r))).catch(() => {});
    return remote.records;
  }
  try {
    return await db.research
      .where('caseId').equals(caseId)
      .sortBy('savedAt')
      .then(arr => arr.reverse());
  } catch (e) {
    console.error('[Storage] loadResearch failed', e);
    return [];
  }
}

export async function saveResearchItem(item: ResearchRecord): Promise<boolean> {
  try {
    await db.research.put(item);
    syncPut('/research', item);
    return true;
  } catch (e) {
    console.error('[Storage] saveResearchItem failed', e);
    return false;
  }
}

export async function deleteResearchItem(id: string): Promise<boolean> {
  try {
    await db.research.delete(id);
    syncDelete(`/research?id=${encodeURIComponent(id)}`);
    return true;
  } catch (e) {
    console.error('[Storage] deleteResearchItem failed', e);
    return false;
  }
}

// ── Argument Versions ─────────────────────────────────────────────────────────
// Argument versions are large analytical documents — local only for now.

export async function loadArgVersions(caseId: string): Promise<ArgumentVersion[]> {
  try {
    const rows = await db.arg_versions
      .where('caseId').equals(caseId)
      .sortBy('createdAt')
      .then(arr => arr.reverse());
    return rows.map(({ caseId: _c, ...v }) => v as ArgumentVersion);
  } catch (e) {
    console.error('[Storage] loadArgVersions failed', e);
    return [];
  }
}

export async function saveArgVersion(caseId: string, version: ArgumentVersion): Promise<boolean> {
  try {
    await db.arg_versions.put({ ...version, caseId });
    return true;
  } catch (e) {
    console.error('[Storage] saveArgVersion failed', e);
    return false;
  }
}

export async function deleteArgVersion(id: string): Promise<boolean> {
  try {
    await db.arg_versions.delete(id);
    return true;
  } catch (e) {
    console.error('[Storage] deleteArgVersion failed', e);
    return false;
  }
}

// ── Matrimonial Data ──────────────────────────────────────────────────────────
// Matrimonial structured state — stored in its own blindSpot slot with key
// 'matrimonial'. Never conflicts with other modules. Parallelise reads with
// Promise.all when loading case data.
//
// Key: afs_bs_matrimonial_<caseId>
// This deliberately reuses the blind_spots table as a generic key-value store
// so no schema migration is required. The 'matrimonial' module key is reserved
// and must never be used by any other module.

const MATRIMONIAL_MODULE = 'matrimonial';

export async function loadMatrimonialData(caseId: string): Promise<MatrimonialCaseData | null> {
  try {
    const rec = await db.blind_spots.get(`afs_bs_${MATRIMONIAL_MODULE}_${caseId}`);
    return (rec?.data as MatrimonialCaseData) ?? null;
  } catch (e) {
    console.error('[Storage] loadMatrimonialData failed', e);
    return null;
  }
}

export async function saveMatrimonialData(
  caseId: string,
  data: MatrimonialCaseData,
): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    await db.blind_spots.put({
      id: `afs_bs_${MATRIMONIAL_MODULE}_${caseId}`,
      caseId,
      module: MATRIMONIAL_MODULE,
      data: { ...data, _updatedAt: now },
    });
    return true;
  } catch (e) {
    console.error('[Storage] saveMatrimonialData failed', e);
    return false;
  }
}

/**
 * Load matrimonial data in parallel with blind spots for efficient case load.
 * Usage:
 *   const [blindSpotData, matrimonialData] = await Promise.all([
 *     loadBlindSpot(caseId, 'someModule', fallback),
 *     loadMatrimonialData(caseId),
 *   ]);
 */
export async function loadCaseWithMatrimonialData(
  caseId: string,
): Promise<{ case: Case | null; matrimonialData: MatrimonialCaseData | null }> {
  const [caseRecord, matrimonialData] = await Promise.all([
    loadCase(caseId),
    loadMatrimonialData(caseId),
  ]);
  return { case: caseRecord, matrimonialData };
}

/**
 * Phase 8B — Token Telemetry
 *
 * Appends a token usage entry for a given case/engine call to IndexedDB.
 * Capped at 500 entries per case (oldest dropped first) so it never bloats.
 * Fire-and-forget — never throws to the caller.
 */
const TOKEN_LOG_CAP = 500;

export async function appendTokenLog(
  caseId: string,
  engine: string,
  usage: import('@/types').ApiUsage,
): Promise<void> {
  try {
    const key = `token_log_${caseId}`;
    const rec = await db.blind_spots.get(key);
    const existing: import('@/types').TokenLogEntry[] =
      Array.isArray((rec?.data as any)) ? (rec!.data as import('@/types').TokenLogEntry[]) : [];

    const entry: import('@/types').TokenLogEntry = {
      ts: new Date().toISOString(),
      engine,
      usage,
    };

    const updated = [...existing, entry].slice(-TOKEN_LOG_CAP);

    await db.blind_spots.put({
      id: key,
      caseId,
      module: 'token_log',
      data: updated,
    });
  } catch {
    // Always silent — telemetry must never surface errors to the user
  }
}

export async function loadTokenLog(caseId: string): Promise<import('@/types').TokenLogEntry[]> {
  try {
    const key = `token_log_${caseId}`;
    const rec = await db.blind_spots.get(key);
    return Array.isArray(rec?.data) ? (rec!.data as import('@/types').TokenLogEntry[]) : [];
  } catch {
    return [];
  }
}

 /**
 * Merges the intelligence fields into any existing MatrimonialCaseData without
 * overwriting structural fields (marriage_date, relief_type, children, etc.).
 * Increments intelligence_version on every call so engines can detect re-runs.
 *
 * Called twice by MIntelligence:
 *   1. After Step 2 extraction (intPackage = '') — makes extraction immediately
 *      available to other engines even if the associate stops early.
 *   2. After Step 5 package generation (intPackage = full narrative text).
 */
export async function writeIntelligenceToCase(
  caseId: string,
  extraction: MExtractionResult,
  intPackage: string,
): Promise<boolean> {
  try {
    const existing = await loadMatrimonialData(caseId) ?? {};
    await saveMatrimonialData(caseId, {
      ...existing,
      intelligence_extraction: extraction,
      intelligence_package:    intPackage || existing.intelligence_package,
      intelligence_run_at:     new Date().toISOString(),
      intelligence_version:    ((existing.intelligence_version ?? 0) + 1),
    });
    return true;
  } catch (e) {
    console.error('[Storage] writeIntelligenceToCase failed', e);
    return false;
  }
}

// ── Case Theory ───────────────────────────────────────────────────────────────
// Trial Engine Consolidation, Phase 1.
//
// The Case Theory record lives directly on the Case record (case_theory_*
// fields), not in its own table or blind_spots slot — it must be available
// wherever a Case is already loaded (TrialEngine, FinalWrittenAddressEngine,
// ArgumentBuilder, ApplicationsEngine) without an extra round trip.
//
// Every write goes through saveCase() so the existing dual-write (IndexedDB +
// D1 background sync) behaviour applies for free. Always read-modify-write
// against a freshly loaded Case to avoid clobbering unrelated fields that may
// have changed elsewhere (docket entries, deadlines, etc. are stored in their
// own tables, but intelligence_data / counsel_instructions / matter fields
// live on the same Case object).

export async function loadCaseTheory(caseId: string): Promise<CaseTheoryRecord | null> {
  try {
    const c = await loadCase(caseId);
    return c?.case_theory_structured ?? null;
  } catch (e) {
    console.error('[Storage] loadCaseTheory failed', e);
    return null;
  }
}

/**
 * Saves a theory draft. Does NOT lock it and does NOT touch case_theory_score —
 * score is written explicitly by the caller (after an AI re-score) as part of
 * theory.score_breakdown.total, read back out via hasCaseTheory()/loadCaseTheory().
 * Saving an already-locked theory is allowed (editing post-lock is still just
 * an edit) but does not itself change the lock state — call unlockCaseTheory()
 * first if the intent is to revise a locked theory.
 */
export async function saveCaseTheory(caseId: string, theory: CaseTheoryRecord): Promise<void> {
  try {
    const c = await loadCase(caseId);
    if (!c) {
      console.error('[Storage] saveCaseTheory failed — case not found', caseId);
      return;
    }
    await saveCase({
      ...c,
      case_theory_structured: theory,
      case_theory_score:      theory.score_breakdown?.total ?? c.case_theory_score ?? null,
    });
  } catch (e) {
    console.error('[Storage] saveCaseTheory failed', e);
  }
}

/**
 * Locks the current theory for propagation to downstream engines.
 * No-ops silently (with a console error) if no theory has been saved yet —
 * callers should disable the Lock button until case_theory_structured exists.
 * Increments case_theory_version on every lock (not on every save).
 */
export async function lockCaseTheory(caseId: string): Promise<void> {
  try {
    const c = await loadCase(caseId);
    if (!c) {
      console.error('[Storage] lockCaseTheory failed — case not found', caseId);
      return;
    }
    if (!c.case_theory_structured) {
      console.error('[Storage] lockCaseTheory failed — no theory to lock', caseId);
      return;
    }
    const now = new Date().toISOString();
    await saveCase({
      ...c,
      case_theory_locked:    true,
      case_theory_locked_at: now,
      case_theory_version:   (c.case_theory_version ?? 0) + 1,
    });
  } catch (e) {
    console.error('[Storage] lockCaseTheory failed', e);
  }
}

/**
 * Unlocks the theory so it can be revised. Requires a reason note — appended
 * to case_theory_history as a new entry pairing the lock/unlock timestamps
 * for that version. The theory record and score remain visible (callers
 * should show the amber "not locked" banner, not hide the data).
 */
export async function unlockCaseTheory(caseId: string, note: string): Promise<void> {
  try {
    const c = await loadCase(caseId);
    if (!c) {
      console.error('[Storage] unlockCaseTheory failed — case not found', caseId);
      return;
    }
    const now = new Date().toISOString();
    const historyEntry: CaseTheoryHistoryEntry = {
      version:     c.case_theory_version ?? 0,
      locked_at:   c.case_theory_locked_at ?? '',
      unlocked_at: now,
      note:        note || '(no reason given)',
    };
    await saveCase({
      ...c,
      case_theory_locked:    false,
      case_theory_history:   [...(c.case_theory_history ?? []), historyEntry],
    });
  } catch (e) {
    console.error('[Storage] unlockCaseTheory failed', e);
  }
}

/**
 * True only if the theory is locked AND the structured record exists.
 * This is the gate every downstream engine must check before reading
 * case_theory_structured — an unlocked or absent theory must never be
 * injected into a draft, even if the data is technically present.
 */
export async function hasCaseTheory(caseId: string): Promise<boolean> {
  try {
    const c = await loadCase(caseId);
    return !!(c?.case_theory_locked === true && c?.case_theory_structured);
  } catch (e) {
    console.error('[Storage] hasCaseTheory failed', e);
    return false;
  }
}

// ── Argument Templates ───────────────────────────────────────────────────────
// Trial Engine Consolidation, Phase 2.
//
// Not scoped to a case — these live in their own global Dexie table
// (argument_templates) and are reused across every matter of the same
// appType/jurisdiction/court_level. Local-only, same as arg_versions:
// no D1 sync wired up yet for non-case-scoped tables.

export async function loadArgumentTemplates(): Promise<ArgumentTemplate[]> {
  try {
    return await db.argument_templates
      .orderBy('created_at')
      .reverse()
      .toArray();
  } catch (e) {
    console.error('[Storage] loadArgumentTemplates failed', e);
    return [];
  }
}

export async function saveArgumentTemplate(t: ArgumentTemplate): Promise<boolean> {
  try {
    await db.argument_templates.put(t);
    return true;
  } catch (e) {
    console.error('[Storage] saveArgumentTemplate failed', e);
    return false;
  }
}

export async function deleteArgumentTemplate(id: string): Promise<boolean> {
  try {
    await db.argument_templates.delete(id);
    return true;
  } catch (e) {
    console.error('[Storage] deleteArgumentTemplate failed', e);
    return false;
  }
}

/**
 * Case-insensitive, trimmed exact match on (appType, jurisdiction).
 * Returns the most recently updated match if more than one exists for the
 * same pair (shouldn't normally happen — the New Template form should
 * overwrite rather than duplicate — but this keeps lookups deterministic
 * either way). Returns null if no template exists for this combination —
 * callers should fall back to full RAG generation, exactly as they did
 * before templates existed.
 */
export async function findArgumentTemplate(
  appType: string,
  jurisdiction: string,
): Promise<ArgumentTemplate | null> {
  try {
    if (!appType.trim() || !jurisdiction.trim()) return null;
    const all = await db.argument_templates.toArray();
    const matches = all.filter(t =>
      t.appType.trim().toLowerCase() === appType.trim().toLowerCase() &&
      t.jurisdiction.trim().toLowerCase() === jurisdiction.trim().toLowerCase()
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return matches[0];
  } catch (e) {
    console.error('[Storage] findArgumentTemplate failed', e);
    return null;
  }
}

// ── Case Summary & Clone Draft ────────────────────────────────────────────────
// Trial Engine Consolidation, Phase 10D.
//
// loadAllCases() — lightweight case list for the Clone Draft target selector.
// cloneApplicationToCase() — copies an ApplicationRecord to a target case,
// clearing all case-specific content so counsel fills in only the new facts.
//
// Both are local-only (no D1 round trip): the selector doesn't need cross-
// device sync, and the clone write uses saveBlindSpot which is already local.

/**
 * Returns a lightweight summary of every case in the local IndexedDB, sorted
 * most-recently-created first. Used to populate the Clone Draft target
 * dropdown. No D1 round trip — the selector is a local UI concern.
 */
export async function loadAllCases(): Promise<CaseSummary[]> {
  try {
    const all = await db.cases.orderBy('createdAt').reverse().toArray();
    return all.map(c => ({
      id:            c.id,
      caseName:      c.caseName,
      matter_track:  c.matter_track,
      counsel_role:  c.counsel_role,
      jurisdiction:  c.court,   // court is the closest proxy for jurisdiction on the Case record
      createdAt:     c.createdAt,
    }));
  } catch (e) {
    console.error('[Storage] loadAllCases failed', e);
    return [];
  }
}

/**
 * Deep-copies an ApplicationRecord to a target case's Applications history.
 *
 * Preserved:  appType, facts object keys (structure only)
 * Cleared:    all fact values, stage3 (entirely case-specific), documents
 * Set:        new id, new caseId, new createdAt, _clone_notice in facts
 *
 * Saves via saveBlindSpot under module 'applications_v2' — the same key that
 * ApplicationsEngine uses (MODULE = 'applications_v2') — so the cloned record
 * appears in the target case's Saved Drafts panel immediately on next load.
 *
 * Returns the cloned record so the caller can reference its id for
 * navigation / display purposes.
 */
export async function cloneApplicationToCase(params: {
  sourceRecord:   CloneableApplicationRecord;
  targetCaseId:   string;
  sourceCaseName: string;
}): Promise<CloneableApplicationRecord> {
  const { sourceRecord, targetCaseId, sourceCaseName } = params;
  const now = new Date().toISOString();
  const dateLabel = new Date().toLocaleDateString('en-NG', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Clear every fact value; preserve the keys so the facts form renders all fields
  const clearedFacts: Record<string, string> = {};
  for (const key of Object.keys(sourceRecord.facts)) {
    clearedFacts[key] = '';
  }
  clearedFacts['_clone_notice'] =
    `Cloned from "${sourceCaseName}" on ${dateLabel} — review and update all facts before drafting.`;

  const cloned: CloneableApplicationRecord = {
    id:        uid(),
    caseId:    targetCaseId,
    appType:   sourceRecord.appType,
    facts:     clearedFacts,
    stage3:    {},    // Stage3Data is entirely case-specific — cleared on clone
    documents: '',    // Generated output is case-specific — never carries over
    createdAt: now,
  };

  // Prepend to the target case's existing Applications history
  const existing = await loadBlindSpot<{ history: CloneableApplicationRecord[] }>(
    targetCaseId, 'applications_v2', { history: [] },
  );
  const updated = { history: [cloned, ...(existing?.history ?? [])] };
  await saveBlindSpot(targetCaseId, 'applications_v2', updated);

  return cloned;
}

