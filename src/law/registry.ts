/**
 * AFS Legal OS — Law Registry (Law Change Risk Mitigation)
 *
 * 22 entries covering every hard-coded day count found in the codebase.
 * Resolver checks IndexedDB override first, compiled default second.
 *
 * API:
 *   getLawSync(id)      → string  (for useMemo / render — reads in-memory cache)
 *   getLaw(id)          → Promise<string>  (for critical deadline paths)
 *   setLaw(id, value, note) → writes override + audit entry atomically
 *   resetLaw(id, note)  → removes override + logs the reset
 *   getAllOverrides()    → Map<string, string> (for applyLawOverrides batch)
 */

import { lawDb } from './db';

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY ENTRY TYPE
// ─────────────────────────────────────────────────────────────────────────────

export type ValueType = 'days' | 'months' | 'minutes' | 'number';
export type Category  = 'period' | 'cap';

export interface LawEntry {
  id:           string;
  label:        string;
  default:      string;
  valueType:    ValueType;
  category:     Category;
  source:       string;
  jurisdiction: string;
  lastVerified: string;   // YYYY-MM-DD — drives stale badge in admin UI
  notes?:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY — 22 entries
// ─────────────────────────────────────────────────────────────────────────────

export const LAW_REGISTRY: LawEntry[] = [

  // ── CIVIL — APPEARANCE ────────────────────────────────────────────────────

  {
    id:           'civil_appearance_lagos',
    label:        'Enter appearance — within jurisdiction (days)',
    default:      '8',
    valueType:    'days',
    category:     'period',
    source:       'Order 9 Rule 1, Lagos High Court Civil Procedure Rules 2019',
    jurisdiction: 'Lagos',
    lastVerified: '2025-01-01',
    notes:        'Defendant served within Lagos jurisdiction has 8 days to enter appearance or face default judgment.',
  },

  {
    id:           'civil_appearance_outside',
    label:        'Enter appearance — service outside jurisdiction (days)',
    default:      '30',
    valueType:    'days',
    category:     'period',
    source:       'Order 9 Rule 1, Lagos High Court Civil Procedure Rules 2019',
    jurisdiction: 'Lagos',
    lastVerified: '2025-01-01',
    notes:        'Defendant served outside Lagos jurisdiction has 30 days to enter appearance.',
  },

  // ── CIVIL — PLEADINGS ─────────────────────────────────────────────────────

  {
    id:           'civil_sod_after_soc',
    label:        'File Statement of Defence after Statement of Claim (days)',
    default:      '42',
    valueType:    'days',
    category:     'period',
    source:       'Lagos High Court Civil Procedure Rules 2019',
    jurisdiction: 'Lagos',
    lastVerified: '2025-01-01',
    notes:        'Defendant has 42 days (6 weeks) from service of the Statement of Claim to file a Statement of Defence.',
  },

  {
    id:           'civil_reply_after_sod',
    label:        'File Reply to Statement of Defence (days)',
    default:      '14',
    valueType:    'days',
    category:     'period',
    source:       'Lagos High Court Civil Procedure Rules 2019',
    jurisdiction: 'Lagos',
    lastVerified: '2025-01-01',
    notes:        'Claimant may file a Reply within 14 days of service of the Statement of Defence. Not mandatory.',
  },

  // ── CIVIL — APPEALS ───────────────────────────────────────────────────────

  {
    id:           'civil_appeal_hc_to_ca',
    label:        'Notice of Appeal — High Court to Court of Appeal (days)',
    default:      '90',
    valueType:    'days',
    category:     'period',
    source:       's.25(2) Court of Appeal Act Cap C36 LFN 2004',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Notice of Appeal against a High Court final judgment must be filed within 90 days of judgment.',
  },

  {
    id:           'civil_interlocutory_appeal',
    label:        'Notice of Appeal against interlocutory ruling (days)',
    default:      '14',
    valueType:    'days',
    category:     'period',
    source:       'Court of Appeal Rules 2021, Order 7',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Notice of Appeal against an interlocutory ruling must be filed within 14 days. Strictly enforced.',
  },

  {
    id:           'civil_appeal_magistrate_hc',
    label:        'Notice of Appeal — Magistrate Court to High Court (days)',
    default:      '30',
    valueType:    'days',
    category:     'period',
    source:       "Magistrates' Courts Act (Lagos)",
    jurisdiction: 'Lagos',
    lastVerified: '2025-01-01',
    notes:        'Appeal from Magistrate Court to High Court must be filed within 30 days of judgment.',
  },

  {
    id:           'civil_appeal_ca_to_sc',
    label:        'Notice of Appeal — Court of Appeal to Supreme Court (days)',
    default:      '90',
    valueType:    'days',
    category:     'period',
    source:       'Supreme Court Act Cap S15 LFN 2004',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Notice of Appeal to the Supreme Court from a Court of Appeal decision must be filed within 90 days.',
  },

  // ── CRIMINAL — CUSTODY & ARRAIGNMENT ─────────────────────────────────────

  {
    id:           'criminal_arraignment_custody',
    label:        'Arraign accused after arrest — s.293 ACJA (days)',
    default:      '1',
    valueType:    'days',
    category:     'period',
    source:       's.293 Administration of Criminal Justice Act 2015',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        '24-hour custody rule — treated as 1 calendar day. Violation grounds a FREP application.',
  },

  {
    id:           'criminal_remand_review',
    label:        'Apply for bail review after remand — s.296 ACJA (days)',
    default:      '30',
    valueType:    'days',
    category:     'period',
    source:       's.296 Administration of Criminal Justice Act 2015',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Accused held on remand for 30 days without trial commencement may apply for bail. Renews every 30 days.',
  },

  {
    id:           'criminal_trial_commencement',
    label:        'Trial commencement after arraignment in custody — s.396 ACJA (days)',
    default:      '30',
    valueType:    'days',
    category:     'period',
    source:       's.396 Administration of Criminal Justice Act 2015',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Where accused is in custody, trial must commence within 30 days of arraignment.',
  },

  {
    id:           'criminal_prosecution_close',
    label:        'ACJA 90-day trial target from arraignment (days)',
    default:      '90',
    valueType:    'days',
    category:     'period',
    source:       's.396(3) Administration of Criminal Justice Act 2015',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        '90-day monitoring point. Prosecution must ensure each hearing produces substantive progress.',
  },

  // ── CRIMINAL — APPEALS ────────────────────────────────────────────────────

  {
    id:           'criminal_appeal_conviction_hc',
    label:        'Notice of Appeal against conviction/sentence — High Court (days)',
    default:      '30',
    valueType:    'days',
    category:     'period',
    source:       's.437 Administration of Criminal Justice Act 2015; s.25 Criminal Procedure Act Cap C41 LFN 2004',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'One of the most commonly missed criminal deadlines. Extension requires motion with affidavit explaining every day of delay.',
  },

  {
    id:           'criminal_appeal_magistrate',
    label:        'Notice of Appeal — Magistrate criminal conviction (days)',
    default:      '30',
    valueType:    'days',
    category:     'period',
    source:       "Magistrates' Courts Act (Lagos)",
    jurisdiction: 'Lagos',
    lastVerified: '2025-01-01',
    notes:        'Appeal from magistrate criminal conviction to the High Court must be filed within 30 days.',
  },

  {
    id:           'criminal_appeal_ca_to_sc',
    label:        'Notice of Appeal — Criminal, Court of Appeal to Supreme Court (days)',
    default:      '90',
    valueType:    'days',
    category:     'period',
    source:       'Supreme Court Act Cap S15 LFN 2004',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Notice of Appeal from a Court of Appeal criminal judgment to the Supreme Court — 90 days.',
  },

  // ── MATRIMONIAL ───────────────────────────────────────────────────────────

  {
    id:           'mca_s57_absolute_days',
    label:        'Decree absolute — s.57 MCA (children welfare order made) (days)',
    default:      '28',
    valueType:    'days',
    category:     'period',
    source:       's.57 Matrimonial Causes Act Cap M7 LFN 2004',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Where a children welfare arrangement order was made at decree nisi, the minimum period before applying for absolute is 28 days.',
  },

  {
    id:           'mca_s58_absolute_months',
    label:        'Decree absolute — s.58 MCA (no children welfare order) (months)',
    default:      '3',
    valueType:    'months',
    category:     'period',
    source:       's.58 Matrimonial Causes Act Cap M7 LFN 2004',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Where no children welfare arrangement order was made, the minimum period is 3 months from decree nisi.',
  },

  // ── FREP ──────────────────────────────────────────────────────────────────

  {
    id:           'frep_counter_affidavit_days',
    label:        'FREP counter-affidavit / written address (days)',
    default:      '5',
    valueType:    'days',
    category:     'period',
    source:       'Fundamental Rights (Enforcement Procedure) Rules 2009, Order III',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Respondent has 5 days from service to file Counter-Affidavit + Written Address. Failure = facts admitted.',
  },

  {
    id:           'frep_reply_days',
    label:        'FREP reply on points of law (days)',
    default:      '5',
    valueType:    'days',
    category:     'period',
    source:       'Fundamental Rights (Enforcement Procedure) Rules 2009, Order III',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Applicant has 5 days from receipt of respondent Written Address to file a Reply on Points of Law.',
  },

  {
    id:           'frep_listing_target_days',
    label:        'FREP listing target after filing (days)',
    default:      '7',
    valueType:    'days',
    category:     'period',
    source:       'Fundamental Rights (Enforcement Procedure) Rules 2009, Order II',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'FREP application should be listed for hearing within 7 days of filing. Registry follow-up if not.',
  },

  {
    id:           'frep_oral_address_cap_minutes',
    label:        'FREP oral address time cap (minutes)',
    default:      '20',
    valueType:    'minutes',
    category:     'cap',
    source:       'Fundamental Rights (Enforcement Procedure) Rules 2009',
    jurisdiction: 'Federal',
    lastVerified: '2025-01-01',
    notes:        'Each party is limited to 20 minutes for oral address at the hearing unless extended by court.',
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY CACHE (populated on first async read; kept in sync on writes)
// ─────────────────────────────────────────────────────────────────────────────

const _cache = new Map<string, string>();
let _cacheReady = false;

async function _ensureCache(): Promise<void> {
  if (_cacheReady) return;
  const overrides = await lawDb.overrides.toArray();
  for (const ov of overrides) {
    _cache.set(ov.id, ov.value);
  }
  _cacheReady = true;
}

function _defaultFor(id: string): string {
  const entry = LAW_REGISTRY.find(e => e.id === id);
  return entry ? entry.default : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronous read — uses in-memory cache.
 * Returns the override value if one exists, otherwise the compiled default.
 * Safe to call inside useMemo / render after applyLawOverrides() has run.
 */
export function getLawSync(id: string): string {
  return _cache.has(id) ? (_cache.get(id) as string) : _defaultFor(id);
}

/**
 * Async read — ensures cache is populated from IndexedDB first.
 * Use for critical deadline paths where IndexedDB must be the source of truth.
 */
export async function getLaw(id: string): Promise<string> {
  await _ensureCache();
  return _cache.has(id) ? (_cache.get(id) as string) : _defaultFor(id);
}

/**
 * Write override + append audit entry atomically.
 * Returns the old value (before the change) for audit purposes.
 */
export async function setLaw(id: string, newValue: string, note: string): Promise<void> {
  const oldValue = getLawSync(id) || _defaultFor(id);
  const now = new Date().toISOString();

  await lawDb.transaction('rw', lawDb.overrides, lawDb.audit, async () => {
    await lawDb.overrides.put({ id, value: newValue, changedAt: now, note });
    await lawDb.audit.put({
      id:        `${id}_${Date.now()}`,
      ruleId:    id,
      oldValue,
      newValue,
      changedAt: now,
      note,
    });
  });

  // Update cache
  _cache.set(id, newValue);
}

/**
 * Remove override (revert to compiled default) and log the reset.
 */
export async function resetLaw(id: string, note: string): Promise<void> {
  const oldValue = getLawSync(id);
  const defaultValue = _defaultFor(id);
  const now = new Date().toISOString();

  await lawDb.transaction('rw', lawDb.overrides, lawDb.audit, async () => {
    await lawDb.overrides.delete(id);
    await lawDb.audit.put({
      id:        `${id}_reset_${Date.now()}`,
      ruleId:    id,
      oldValue,
      newValue:  `RESET → ${defaultValue}`,
      changedAt: now,
      note,
    });
  });

  // Update cache
  _cache.delete(id);
}

/**
 * Returns all active overrides as a Map<id, value>.
 * Used by applyLawOverrides() to batch-patch PERIOD_RULES.
 */
export async function getAllOverrides(): Promise<Map<string, string>> {
  const overrides = await lawDb.overrides.toArray();
  const map = new Map<string, string>();
  for (const ov of overrides) {
    map.set(ov.id, ov.value);
    _cache.set(ov.id, ov.value);  // keep cache in sync
  }
  _cacheReady = true;
  return map;
}

/**
 * Returns the full audit log for a specific rule (newest first).
 */
export async function getAuditLog(ruleId: string) {
  return lawDb.audit
    .where('ruleId').equals(ruleId)
    .sortBy('changedAt')
    .then(entries => entries.reverse());
}

/**
 * Returns the full audit log for all rules (newest first).
 */
export async function getAllAuditLog() {
  return lawDb.audit
    .orderBy('changedAt')
    .reverse()
    .toArray();
}
