/**
 * AFS Advocates — Storage Layer (Dexie / IndexedDB)
 *
 * WHY THIS EXISTS:
 * The original app used raw localStorage with giant JSON blobs.
 * That approach fails on large case histories (QuotaExceededError),
 * is slow to serialise, and is hard to query or migrate.
 *
 * This module provides a structured IndexedDB backend via Dexie.
 * - cases          — case records (no binary data)
 * - docket_entries — each docket entry as its own record
 * - deadlines      — deadline records per case
 * - evidence_meta  — evidence file metadata (no binary data)
 * - evidence_files — binary file storage (base64)
 * - blind_spots    — all blind-spot module data per case
 * - research_items — saved research per case
 * - arg_versions   — argument builder versions per case
 *
 * MIGRATION NOTE:
 * localStorage data from the original app is migrated on first run.
 * See src/storage/migrate.ts for the migration logic.
 */

import Dexie, { type Table } from 'dexie';
import type {
  Case,
  DocketEntry,
  Deadline,
  EvidenceItem,
  ArgumentVersion,
} from '@/types';

// ── Supplementary record types stored in their own tables ─────────────────────

export interface EvidenceFile {
  id:   string;   // same as EvidenceItem.id
  data: string;   // base64 data URL
}

export interface BlindSpotRecord {
  id:     string;   // `${caseId}_${module}`
  caseId: string;
  module: string;
  data:   unknown;  // module-specific object — typed within each engine
}

export interface ResearchRecord {
  id:       string;
  caseId:   string;
  query:    string;
  type:     string;
  result:   string;
  note:     string;
  savedAt:  string;
}

// ── Database class ─────────────────────────────────────────────────────────────

export class AfsDatabase extends Dexie {
  cases!:          Table<Case,           string>;
  docket_entries!: Table<DocketEntry,    string>;
  deadlines!:      Table<Deadline,       string>;
  evidence_meta!:  Table<EvidenceItem,   string>;
  evidence_files!: Table<EvidenceFile,   string>;
  blind_spots!:    Table<BlindSpotRecord, string>;
  research!:       Table<ResearchRecord, string>;
  arg_versions!:   Table<ArgumentVersion & { caseId: string }, string>;

  constructor() {
    super('afs_legal_os');

    this.version(1).stores({
      cases:          '&id, caseName, createdAt',
      docket_entries: '&id, caseId, dateFiled, status',
      deadlines:      '&id, caseId, date, status',
      evidence_meta:  '&id, caseId, category, timestamp',
      evidence_files: '&id',
      blind_spots:    '&id, caseId, module',
      research:       '&id, caseId, type, savedAt',
      arg_versions:   '&id, caseId, createdAt',
    });

    // V2 — adds matter_track and counsel_role indexes so the dashboard can
    // filter matters by track and role without a full table scan.
    this.version(2).stores({
      cases: '&id, caseName, createdAt, matter_track, counsel_role',
    });
  }
}

/** Singleton database instance — import this everywhere */
export const db = new AfsDatabase();
