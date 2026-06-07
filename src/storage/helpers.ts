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
import type { Case, DocketEntry, Deadline, EvidenceItem, ArgumentVersion } from '@/types';
import type { BlindSpotRecord, ResearchRecord } from './db';

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

export async function loadBlindSpot<T>(caseId: string, module: string, fallback: T): Promise<T> {
  try {
    const rec = await db.blind_spots.get(`afs_bs_${module}_${caseId}`);
    return (rec?.data as T) ?? fallback;
  } catch (e) {
    console.error('[Storage] loadBlindSpot failed', e);
    return fallback;
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
