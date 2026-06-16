/**
 * AFS Legal OS — Law Registry Database (Law Change Risk Mitigation)
 *
 * Standalone Dexie database for law overrides and audit log.
 * Kept separate from the main storage/db.ts so the law system is
 * self-contained and the main schema version is untouched.
 *
 * Tables:
 *   overrides — one row per rule that has been changed; live store
 *   audit     — append-only log of every change, forever
 */

import Dexie, { type Table } from 'dexie';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface LawOverride {
  /** Matches registry key e.g. 'criminal_appeal_conviction_hc' */
  id:        string;
  /** Always stored as string; cast on read */
  value:     string;
  /** ISO timestamp */
  changedAt: string;
  /** Mandatory: why this was changed */
  note:      string;
}

export interface LawAuditEntry {
  /** uid */
  id:        string;
  /** Which rule was changed */
  ruleId:    string;
  oldValue:  string;
  newValue:  string;
  changedAt: string;
  note:      string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────────────────────────────────────

class LawDatabase extends Dexie {
  declare overrides: Table<LawOverride,   string>;
  declare audit:     Table<LawAuditEntry, string>;

  constructor() {
    super('afs_law_registry');
    this.version(1).stores({
      overrides: '&id, changedAt',
      audit:     '&id, ruleId, changedAt',
    });
  }
}

export const lawDb = new LawDatabase();
