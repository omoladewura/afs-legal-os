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

/**
 * Argument Template — Trial Engine Consolidation, Phase 2.
 *
 * A reusable, case-agnostic argument skeleton for a given (appType,
 * jurisdiction, court_level) combination. Not scoped to a single case —
 * stored in its own global table so it can be applied across any matter.
 * Local-only (no D1 sync), same as arg_versions: these are large analytical
 * documents and the dual-write pattern isn't wired up for non-case-scoped
 * tables yet.
 */
export interface ArgumentTemplate {
  id:                  string;
  appType:             string;        // e.g. "Bail Application" — matches AppTypeConfig.label
  jurisdiction:         string;       // e.g. "Delta State" | "FCT" | "Federal"
  court_level:          string;       // e.g. "High Court" | "Magistrate"
  skeleton:             string;       // Reusable argument body (markdown) — no case-specific facts
  statutory_basis:      string;       // e.g. "s.35 CFRN, s.158 ACJL..."
  leading_authorities:  string;       // Comma-separated
  tests:                string;       // Applicable legal tests verbatim
  law_delta:            string;       // getJurisdictionDelta() output captured at creation time
  needsCaseTheory:      boolean;      // Mirrors the appType's flag in AppTypeConfig
  created_at:           string;
  updated_at:           string;
}

// ── Database class ─────────────────────────────────────────────────────────────

export class AfsDatabase extends Dexie {
  declare cases:              Table<Case,           string>;
  declare docket_entries:     Table<DocketEntry,    string>;
  declare deadlines:          Table<Deadline,       string>;
  declare evidence_meta:      Table<EvidenceItem,   string>;
  declare evidence_files:     Table<EvidenceFile,   string>;
  declare blind_spots:        Table<BlindSpotRecord, string>;
  declare research:           Table<ResearchRecord, string>;
  declare arg_versions:       Table<ArgumentVersion & { caseId: string }, string>;
  declare argument_templates: Table<ArgumentTemplate, string>;

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

    // Trial Engine Consolidation, Phase 1 — no schema/version bump needed.
    // case_theory_structured / case_theory_locked / case_theory_locked_at /
    // case_theory_score / case_theory_version / case_theory_history live as
    // plain fields on the Case record (see src/types/index.ts). They are
    // never queried via .where() so they don't need a Dexie index — Dexie
    // stores whatever shape is put() into a table regardless of the
    // declared index string. Read/write only through loadCaseTheory /
    // saveCaseTheory / lockCaseTheory / unlockCaseTheory in
    // src/storage/helpers.ts so the lock/version/history invariants hold.

    // V3 — Trial Engine Consolidation, Phase 2. New, wholly separate table
    // for reusable Argument Templates — not scoped to any case, so it has
    // its own indexes rather than piggybacking on blind_spots.
    this.version(3).stores({
      argument_templates: '&id, appType, jurisdiction, court_level, created_at',
    });
  }
}

/** Singleton database instance — import this everywhere */
export const db = new AfsDatabase();
