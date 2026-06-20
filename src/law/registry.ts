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

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION DELTA — Phase 2B
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jurisdiction → procedural instrument lookup.
 *
 * Maps a court name / jurisdiction string to the governing criminal procedure
 * instrument and any division-level practice directions that depart from the
 * federal default (ACJA 2015).
 *
 * Matching is case-insensitive and substring-based so that values like
 * "Delta State High Court, Asaba Division" match the "delta" key.
 *
 * Kept as a plain object literal (not a Dexie table) because this data
 * changes only when statutes are amended — not at runtime. Counsel can
 * update the law_delta field on a saved ArgumentTemplate if a division
 * practice direction changes.
 */

interface JurisdictionProfile {
  /** Display name used in the output string */
  name:              string;
  /** Primary criminal procedure statute (if criminal appType) */
  criminal_statute?: string;
  /** Primary civil procedure rules */
  civil_rules?:      string;
  /** Bail-specific provision (criminal) */
  bail_provision?:   string;
  /** Any notes on how this jurisdiction departs from the federal default */
  departures:        string[];
  /** Division-level practice directions (if any) */
  division_notes:    string[];
}

const JURISDICTION_PROFILES: Record<string, JurisdictionProfile> = {
  federal: {
    name:             'Federal (ACJA 2015)',
    criminal_statute: 'Administration of Criminal Justice Act 2015 (ACJA)',
    civil_rules:      'Federal High Court (Civil Procedure) Rules 2019',
    bail_provision:   'ss.158–168 ACJA 2015',
    departures:       [],
    division_notes:   [],
  },
  lagos: {
    name:             'Lagos State',
    criminal_statute: 'Administration of Criminal Justice Law (ACJL) Lagos 2015',
    civil_rules:      'Lagos High Court Civil Procedure Rules 2019',
    bail_provision:   'ss.13–20 ACJL Lagos 2015',
    departures: [
      'ACJL Lagos 2015 governs — not ACJA 2015. Provisions differ on remand periods (s.50 ACJL vs s.296 ACJA).',
      'Bail application under s.13 ACJL is addressed to the High Court directly if Magistrate declines.',
      'Civil: Order 9 Rule 1 — defendant within jurisdiction has 8 days to enter appearance; outside jurisdiction 30 days.',
      'Civil: 42 days to file Statement of Defence from service of Statement of Claim.',
    ],
    division_notes: [
      'Lagos Division: Probate matters handled by the Probate Registry — separate filing queue and hearing list.',
      'Ikeja Division: Commercial list (Judge-in-Charge rotation) — all commercial applications go to assigned judge.',
    ],
  },
  delta: {
    name:             'Delta State',
    criminal_statute: 'Administration of Criminal Justice Law (ACJL) Delta State 2017',
    civil_rules:      'Delta State High Court (Civil Procedure) Rules 2009 (as amended)',
    bail_provision:   'ss.158–162 ACJL Delta 2017',
    departures: [
      'ACJL Delta 2017 governs — not ACJA 2015.',
      's.162(3) ACJL Delta adds a residency requirement for sureties not present in ACJA: surety must be resident in Delta State.',
      'Bail pending appeal: the test in Delta courts follows Dokubo-Asari v FRN but s.162 Delta ACJL imposes additional surety vetting.',
      'Civil: Delta High Court Rules 2009 apply. Default judgment timelines differ slightly from Lagos — verify current rules with Delta Registry.',
    ],
    division_notes: [
      'Asaba Division: Practice direction requires that any surety on a bail application produce evidence of land ownership or a verifiable fixed address within the Asaba metropolitan area. Residential tenancy agreements are NOT accepted as evidence of fixed address.',
      'Warri Division: Commercial matters are filed with the Chief Registrar and assigned to a designated commercial judge. Separate hearing diary.',
      'Sapele Division: Limited judicial staff — interlocutory applications are listed fortnightly, not weekly.',
    ],
  },
  rivers: {
    name:             'Rivers State',
    criminal_statute: 'Administration of Criminal Justice Law (ACJL) Rivers State 2015',
    civil_rules:      'Rivers State High Court (Civil Procedure) Rules 2010 (as amended)',
    bail_provision:   'ss.129–145 ACJL Rivers 2015',
    departures: [
      'ACJL Rivers 2015 governs — not ACJA 2015.',
      'No-case submission procedure under Rivers ACJL follows the Layiwola standard as applied in Port Harcourt Division.',
      'Civil: Rivers rules require pre-trial conference within 21 days of close of pleadings — non-compliance may lead to striking out.',
    ],
    division_notes: [
      'Port Harcourt Division: Commercial list is active. Applications on the commercial list must include a case management questionnaire filed alongside the originating process.',
    ],
  },
  abuja: {
    name:             'FCT / Abuja',
    criminal_statute: 'Administration of Criminal Justice Act 2015 (ACJA) — applies directly as federal territory',
    civil_rules:      'FCT High Court (Civil Procedure) Rules 2018',
    bail_provision:   'ss.158–168 ACJA 2015',
    departures: [
      'ACJA 2015 applies directly — no state ACJL equivalent.',
      'FCT High Court Rules 2018 govern civil procedure. Note: default judgment within the FCT follows Order 18 FCT Rules — differs from Lagos Order 9.',
      'Fundamental rights applications in FCT are listed on a dedicated FREP day (usually Tuesdays — confirm with Registry).',
    ],
    division_notes: [
      'Abuja Division (main): Chief Judge maintains a fast-track commercial list. Applications must be certified as commercial at filing.',
      'Gwagwalada Division: Smaller bench — most interlocutory applications heard on Thursdays.',
    ],
  },
  kano: {
    name:             'Kano State',
    criminal_statute: 'Administration of Criminal Justice Law (ACJL) Kano State 2019',
    civil_rules:      'Kano State High Court (Civil Procedure) Rules 2014 (as amended)',
    bail_provision:   'ss.100–115 ACJL Kano 2019',
    departures: [
      'ACJL Kano 2019 governs — note this is a later enactment than some other state ACJLs.',
      'Bail in terrorism-related charges is governed by s.27 Terrorism Prevention Act 2011 — ACJL provisions are displaced.',
    ],
    division_notes: [],
  },
  enugu: {
    name:             'Enugu State',
    criminal_statute: 'Administration of Criminal Justice Law (ACJL) Enugu State 2017',
    civil_rules:      'Enugu State High Court (Civil Procedure) Rules 2006 (as amended)',
    bail_provision:   'ss.135–148 ACJL Enugu 2017',
    departures: [
      'ACJL Enugu 2017 governs. Note residency requirement for sureties under s.140 Enugu ACJL (similar to Delta).',
    ],
    division_notes: [
      'Enugu Division: No-case submission hearings are listed on a dedicated day — check with Registry before filing.',
    ],
  },
};

/**
 * APP TYPE → relevant registry rule IDs.
 *
 * Drives which LAW_REGISTRY entries are surfaced in the delta output.
 * Keys are lower-cased trimmed substrings matched against AppTypeConfig.label.
 * A registry entry is included if its jurisdiction matches AND its id appears
 * in any of the matching key arrays.
 */
const APP_TYPE_RULE_HINTS: Array<{ match: string; ruleIds: string[] }> = [
  {
    match:   'bail',
    ruleIds: ['criminal_arraignment_custody', 'criminal_remand_review', 'criminal_trial_commencement'],
  },
  {
    match:   'appeal',
    ruleIds: [
      'civil_appeal_hc_to_ca', 'civil_interlocutory_appeal',
      'civil_appeal_magistrate_hc', 'civil_appeal_ca_to_sc',
      'criminal_appeal_conviction_hc', 'criminal_appeal_magistrate', 'criminal_appeal_ca_to_sc',
    ],
  },
  {
    match:   'extension of time',
    ruleIds: ['civil_appeal_hc_to_ca', 'civil_interlocutory_appeal', 'criminal_appeal_conviction_hc'],
  },
  {
    match:   'stay',
    ruleIds: ['civil_appeal_hc_to_ca', 'civil_interlocutory_appeal'],
  },
  {
    match:   'fundamental rights',
    ruleIds: ['frep_counter_affidavit_days', 'frep_reply_days', 'frep_listing_target_days', 'frep_oral_address_cap_minutes'],
  },
  {
    match:   'injunction',
    ruleIds: ['civil_appearance_lagos', 'civil_sod_after_soc'],
  },
  {
    match:   'pleadings',
    ruleIds: ['civil_appearance_lagos', 'civil_appearance_outside', 'civil_sod_after_soc', 'civil_reply_after_sod'],
  },
  {
    match:   'default judgment',
    ruleIds: ['civil_appearance_lagos', 'civil_appearance_outside'],
  },
  {
    match:   'committal',
    ruleIds: ['criminal_arraignment_custody', 'criminal_remand_review'],
  },
  {
    match:   'no-case',
    ruleIds: ['criminal_trial_commencement', 'criminal_prosecution_close'],
  },
  {
    match:   'final written address',
    ruleIds: [
      'civil_appearance_lagos', 'civil_sod_after_soc',
      'criminal_trial_commencement', 'criminal_prosecution_close',
      'frep_oral_address_cap_minutes',
    ],
  },
  {
    match:   'matrimonial',
    ruleIds: ['mca_s57_absolute_days', 'mca_s58_absolute_months'],
  },
  {
    match:   'decree',
    ruleIds: ['mca_s57_absolute_days', 'mca_s58_absolute_months'],
  },
];

/**
 * Resolve a court/jurisdiction string to a `JurisdictionProfile`.
 *
 * Accepts whatever the user typed in the `court` field — e.g.
 * "Delta State High Court, Asaba Division", "High Court of the FCT",
 * "Kano State High Court". Returns the best-match profile or null.
 */
function resolveJurisdictionProfile(courtOrJurisdiction: string): JurisdictionProfile | null {
  const lower = courtOrJurisdiction.toLowerCase();
  // Priority-ordered keyword checks — more specific first
  if (lower.includes('delta'))   return JURISDICTION_PROFILES.delta;
  if (lower.includes('lagos'))   return JURISDICTION_PROFILES.lagos;
  if (lower.includes('rivers') || lower.includes('port harcourt')) return JURISDICTION_PROFILES.rivers;
  if (lower.includes('fct') || lower.includes('abuja') || lower.includes('federal capital'))
    return JURISDICTION_PROFILES.abuja;
  if (lower.includes('kano'))    return JURISDICTION_PROFILES.kano;
  if (lower.includes('enugu'))   return JURISDICTION_PROFILES.enugu;
  if (lower.includes('federal') || lower.includes('fhc'))
    return JURISDICTION_PROFILES.federal;
  return null;
}

/**
 * Resolve relevant `LawEntry` records for a given appType label.
 * Returns all matching entries from LAW_REGISTRY — including current
 * override values from the in-memory cache so the delta reflects any
 * counsel-set overrides, not just compiled defaults.
 */
function resolveRelevantRules(appTypeLabel: string): Array<LawEntry & { currentValue: string }> {
  const lower = appTypeLabel.trim().toLowerCase();
  const matchedIds = new Set<string>();

  for (const hint of APP_TYPE_RULE_HINTS) {
    if (lower.includes(hint.match)) {
      for (const id of hint.ruleIds) matchedIds.add(id);
    }
  }

  if (matchedIds.size === 0) return [];

  return LAW_REGISTRY
    .filter(e => matchedIds.has(e.id))
    .map(e => ({
      ...e,
      currentValue: getLawSync(e.id) || e.default,
    }));
}

/**
 * **Phase 2B — `getJurisdictionDelta`**
 *
 * Returns a formatted, prompt-ready string describing the jurisdiction-specific
 * procedural position for a given `(appType, courtOrJurisdiction)` combination.
 *
 * The output is injected into every ApplicationsEngine draft call so that the
 * AI is aware of:
 *  - Which governing statute applies (ACJA vs state ACJL)
 *  - Departures from the federal default that affect this appType
 *  - Division-level practice directions for the specific court named
 *  - Current law values (including any overrides set by counsel)
 *
 * This function is synchronous (reads the in-memory cache, not IndexedDB)
 * so it is safe to call inside render paths and before async operations.
 *
 * @param appType          — The `AppTypeConfig.label` string (e.g. "Bail Application")
 * @param courtOrJurisdiction — The `Case.court` value (e.g. "Delta State High Court, Asaba Division")
 * @returns A markdown-formatted string for direct injection into a system prompt,
 *          or an empty string if neither the appType nor the jurisdiction resolves
 *          to any known rules or profile (callers should proceed with generic RAG
 *          generation when the string is empty).
 */
export function getJurisdictionDelta(appType: string, courtOrJurisdiction: string): string {
  const profile = resolveJurisdictionProfile(courtOrJurisdiction || '');
  const rules   = resolveRelevantRules(appType || '');

  // If we know nothing about either, return empty — caller falls back to RAG
  if (!profile && rules.length === 0) return '';

  const lines: string[] = [];

  lines.push(`## JURISDICTION DELTA: ${appType} — ${courtOrJurisdiction}`);
  lines.push('');
  lines.push('The following jurisdiction-specific rules apply to this draft. These OVERRIDE any generic Nigerian law defaults you would otherwise apply. Where a rule below conflicts with general practice, the rule below prevails.');
  lines.push('');

  // ── Governing Statute ─────────────────────────────────────────────────────
  if (profile) {
    lines.push(`### Governing Instruments — ${profile.name}`);
    if (profile.criminal_statute)
      lines.push(`- **Criminal Procedure:** ${profile.criminal_statute}`);
    if (profile.civil_rules)
      lines.push(`- **Civil Procedure:** ${profile.civil_rules}`);
    if (profile.bail_provision)
      lines.push(`- **Bail Provision:** ${profile.bail_provision}`);
    lines.push('');
  }

  // ── Departures from Federal Default ───────────────────────────────────────
  if (profile && profile.departures.length > 0) {
    lines.push('### Departures from Federal Default (ACJA 2015 / Federal Rules)');
    for (const d of profile.departures) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  // ── Division-Level Practice Directions ────────────────────────────────────
  const matchingDivisionNotes = profile
    ? profile.division_notes.filter(note => {
        // Only include notes for the specific division mentioned in courtOrJurisdiction
        const lower = courtOrJurisdiction.toLowerCase();
        const noteWords = note.split(':')[0].toLowerCase().split(' ');
        return noteWords.some(w => w.length > 3 && lower.includes(w));
      })
    : [];

  if (matchingDivisionNotes.length > 0) {
    lines.push('### Division-Level Practice Directions (THIS COURT)');
    for (const n of matchingDivisionNotes) {
      lines.push(`- ${n}`);
    }
    lines.push('');
  } else if (profile && profile.division_notes.length > 0) {
    // Court string didn't match any division precisely — surface all division notes
    lines.push('### Practice Directions (All Divisions — Confirm Applicable Division)');
    for (const n of profile.division_notes) {
      lines.push(`- ${n}`);
    }
    lines.push('');
  }

  // ── Relevant Procedural Timelines ─────────────────────────────────────────
  if (rules.length > 0) {
    lines.push('### Applicable Procedural Timelines');
    for (const rule of rules) {
      const unit = rule.valueType === 'months' ? 'months'
                 : rule.valueType === 'minutes' ? 'minutes'
                 : 'days';
      lines.push(`- **${rule.label}:** ${rule.currentValue} ${unit}`);
      lines.push(`  *(Source: ${rule.source} | Jurisdiction: ${rule.jurisdiction})*`);
      if (rule.notes) {
        lines.push(`  *Note: ${rule.notes}*`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*This delta was generated from the AFS Law Registry. Any override values set by counsel are reflected above. Verify against current instruments before filing.*');

  return lines.join('\n');
}
