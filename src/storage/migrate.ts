/**
 * AFS Advocates — Storage Migration
 *
 * Migrates existing localStorage data (from the original monolithic app)
 * into the new IndexedDB (Dexie) structure on first run.
 *
 * This runs once on app startup. After migration, a flag is set so it
 * never runs again. The original localStorage data is left in place as
 * a backup until the user explicitly clears it.
 *
 * MIGRATION MAP:
 *   localStorage 'afs_cases_v2'         → db.cases (case records only, entries stripped)
 *   entries in each case                → db.docket_entries
 *   deadlines in each case              → db.deadlines
 *   'afs_ev_meta_{caseId}'              → db.evidence_meta
 *   'afs_ev_{fileId}'                   → db.evidence_files
 *   'afs_bs_{module}_{caseId}'          → db.blind_spots
 *   'afs_clr_{caseId}'                  → db.research
 *   'afs_ab_versions_{caseId}'          → db.arg_versions
 */

import { db } from './db';
import type { Case, DocketEntry, Deadline } from '@/types';

const MIGRATION_FLAG = 'afs_migrated_v1';

export async function migrateFromLocalStorage(): Promise<void> {
  // Already migrated — skip
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;
  } catch { return; }

  console.info('[AFS Migration] Starting localStorage → IndexedDB migration…');

  try {
    await migrateCases();
    await migrateEvidence();
    await migrateBlindSpots();
    await migrateResearch();
    await migrateArgVersions();

    localStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
    console.info('[AFS Migration] Complete. localStorage data preserved as backup.');
  } catch (err) {
    console.error('[AFS Migration] Failed:', err);
    // Non-fatal — app still works, just uses fresh state
  }
}

async function migrateCases(): Promise<void> {
  const raw = localStorage.getItem('afs_cases_v2');
  if (!raw) return;

  const cases: Case[] = JSON.parse(raw);
  if (!Array.isArray(cases) || cases.length === 0) return;

  for (const c of cases) {
    // Migrate case record (without entries — those go to their own table)
    const { recent_entries, deadlines, ...caseRecord } = c;

    // §12 — Seed frep_data on existing FREP cases that predate the FrepData interface
    if (caseRecord.originating_process === 'frep' && !caseRecord.frep_data) {
      (caseRecord as typeof caseRecord & { frep_data: unknown }).frep_data = {
        capacity:                   'self',
        mode:                       'originating_motion',
        mode_locked:                false,
        ex_parte_sought:            false,
        interim_relief_status:      'not_sought',
        amendment_deadline:         null,
        amendment_filed:            false,
        jurisdiction_gate:          null,
        jurisdiction_flag_reason:   null,
        jurisdiction_court:         null,
        jurisdiction_division:      null,
        respondent_opposition_type: null,
      };
    }

    await db.cases.put({ ...caseRecord, recent_entries: [], deadlines: [] });

    // Migrate docket entries
    const entries: DocketEntry[] = recent_entries || [];
    for (const entry of entries) {
      await db.docket_entries.put({ ...entry });
    }

    // Migrate deadlines
    const dl: Deadline[] = deadlines || [];
    for (const d of dl) {
      await db.deadlines.put({ ...d, caseId: c.id });
    }
  }

  console.info(`[AFS Migration] Cases: ${cases.length} migrated.`);
}

async function migrateEvidence(): Promise<void> {
  // Evidence meta keys are 'afs_ev_meta_{caseId}'
  // Evidence file keys are 'afs_ev_{fileId}'
  const keys = Object.keys(localStorage);

  const metaKeys = keys.filter(k => k.startsWith('afs_ev_meta_'));
  for (const key of metaKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        for (const item of items) {
          await db.evidence_meta.put(item);
        }
      }
    } catch { /* skip corrupted */ }
  }

  const fileKeys = keys.filter(k => k.startsWith('afs_ev_') && !k.startsWith('afs_ev_meta_'));
  for (const key of fileKeys) {
    try {
      const data = localStorage.getItem(key);
      if (!data) continue;
      const id = key.replace('afs_ev_', '');
      await db.evidence_files.put({ id, data });
    } catch { /* skip corrupted */ }
  }

  console.info(`[AFS Migration] Evidence: ${metaKeys.length} meta sets, ${fileKeys.length} files migrated.`);
}

async function migrateBlindSpots(): Promise<void> {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('afs_bs_'));
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      // Key format: afs_bs_{module}_{caseId}
      const withoutPrefix = key.replace('afs_bs_', '');
      // module names are: conflict, witnesses, counsel, judge, settlement, comms, interlocutory
      const knownModules = ['conflict', 'witnesses', 'counsel', 'judge', 'settlement', 'comms', 'interlocutory'];
      const module = knownModules.find(m => withoutPrefix.startsWith(m + '_'));
      if (!module) continue;
      const caseId = withoutPrefix.replace(module + '_', '');
      const data = JSON.parse(raw);
      await db.blind_spots.put({ id: key, caseId, module, data });
    } catch { /* skip corrupted */ }
  }
  console.info(`[AFS Migration] Blind spots: ${keys.length} records migrated.`);
}

async function migrateResearch(): Promise<void> {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('afs_clr_'));
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const caseId = key.replace('afs_clr_', '');
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        for (const item of items) {
          await db.research.put({ ...item, caseId });
        }
      }
    } catch { /* skip corrupted */ }
  }
  console.info(`[AFS Migration] Research: ${keys.length} case libraries migrated.`);
}

async function migrateArgVersions(): Promise<void> {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('afs_ab_versions_'));
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const caseId = key.replace('afs_ab_versions_', '');
      const versions = JSON.parse(raw);
      if (Array.isArray(versions)) {
        for (const v of versions) {
          await db.arg_versions.put({ ...v, caseId });
        }
      }
    } catch { /* skip corrupted */ }
  }
  console.info(`[AFS Migration] Argument versions: ${keys.length} case libraries migrated.`);
}
