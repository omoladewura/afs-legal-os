/**
 * AFS Advocates — Storage Helpers
 *
 * Clean async functions for every storage operation.
 * Components call these — never the db object directly.
 * This layer is where storage errors are caught and logged.
 *
 * If a function returns null / [] / false, the component should
 * show a storage error message rather than silently failing.
 */

import { db } from './db';
import type { Case, DocketEntry, Deadline, EvidenceItem, ArgumentVersion } from '@/types';
import type { BlindSpotRecord, ResearchRecord } from './db';

// ── ID generators ──────────────────────────────────────────────────────────────

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function cid(): string {
  return 'c_' + uid();
}

// ── Cases ─────────────────────────────────────────────────────────────────────

export async function loadCases(): Promise<Case[]> {
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
    await db.cases.put(c);
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
    return true;
  } catch (e) {
    console.error('[Storage] deleteCase failed', e);
    return false;
  }
}

// ── Docket Entries ────────────────────────────────────────────────────────────

export async function loadEntries(caseId: string): Promise<DocketEntry[]> {
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
    return true;
  } catch (e) {
    console.error('[Storage] saveEntry failed', e);
    return false;
  }
}

export async function deleteEntry(id: string): Promise<boolean> {
  try {
    await db.docket_entries.delete(id);
    return true;
  } catch (e) {
    console.error('[Storage] deleteEntry failed', e);
    return false;
  }
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

export async function loadDeadlines(caseId: string): Promise<Deadline[]> {
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
    return true;
  } catch (e) {
    console.error('[Storage] saveDeadline failed', e);
    return false;
  }
}

export async function deleteDeadline(id: string): Promise<boolean> {
  try {
    await db.deadlines.delete(id);
    return true;
  } catch (e) {
    console.error('[Storage] deleteDeadline failed', e);
    return false;
  }
}

// ── Evidence ──────────────────────────────────────────────────────────────────

export async function loadEvidenceMeta(caseId: string): Promise<EvidenceItem[]> {
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
    return true;
  } catch (e) {
    console.error('[Storage] saveEvidenceMeta failed', e);
    return false;
  }
}

export async function saveEvidenceFile(id: string, data: string): Promise<boolean> {
  try {
    await db.evidence_files.put({ id, data });
    return true;
  } catch (e) {
    console.error('[Storage] saveEvidenceFile failed — storage may be full', e);
    return false;
  }
}

export async function loadEvidenceFile(id: string): Promise<string | null> {
  try {
    const rec = await db.evidence_files.get(id);
    return rec?.data ?? null;
  } catch (e) {
    console.error('[Storage] loadEvidenceFile failed', e);
    return null;
  }
}

export async function deleteEvidenceFile(id: string): Promise<boolean> {
  try {
    await db.evidence_files.delete(id);
    await db.evidence_meta.delete(id);
    return true;
  } catch (e) {
    console.error('[Storage] deleteEvidenceFile failed', e);
    return false;
  }
}

// ── Blind Spots ───────────────────────────────────────────────────────────────

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
    return true;
  } catch (e) {
    console.error('[Storage] saveResearchItem failed', e);
    return false;
  }
}

export async function deleteResearchItem(id: string): Promise<boolean> {
  try {
    await db.research.delete(id);
    return true;
  } catch (e) {
    console.error('[Storage] deleteResearchItem failed', e);
    return false;
  }
}

// ── Argument Versions ─────────────────────────────────────────────────────────

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
