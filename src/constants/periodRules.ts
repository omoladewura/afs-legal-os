/**
 * AFS Legal OS — Period Rules (Phase E)
 *
 * Statute-verified table of every procedurally significant time period
 * in Nigerian litigation (civil and criminal). Used by the period computer
 * to compute real deadline dates from extracted docket anchors.
 *
 * SOURCES
 * ───────
 * Civil:
 *   - Lagos High Court Civil Procedure Rules 2019 (HCR)
 *   - Court of Appeal Rules 2021
 *   - Court of Appeal Act Cap C36 LFN 2004, s. 25
 *   - Supreme Court Act Cap S15 LFN 2004
 *   - Magistrates' Courts Act (Lagos)
 *
 * Criminal:
 *   - Administration of Criminal Justice Act 2015 (ACJA)
 *   - Criminal Procedure Act (CPA) Cap C41 LFN 2004, s. 25
 *   - Criminal Procedure Code (CPC) (Northern states)
 *   - Magistrates' Courts Act (Lagos)
 *   - Supreme Court Act Cap S15 LFN 2004
 *
 * RULE
 * ────
 * Only rules whose trigger event can be objectively extracted from a
 * DocketEntry are included here. Rules that depend on facts not visible
 * in the docket (e.g. limitation periods computed from the cause of
 * action date) are documented in comments but not included.
 */

import type { MatterTrack, CounselRole } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export interface PeriodRule {
  /** Unique kebab-case identifier used as the key in computed output. */
  id: string;

  /** Human-readable description shown in the alert card. */
  label: string;

  /** Which matter track this rule applies to, or 'both'. */
  track: MatterTrack | 'both';

  /** Which counsel role this rule is most relevant to, or 'both'. */
  role: CounselRole | 'both';

  /**
   * The name of the trigger event (as used in ExtractedAnchor.eventType).
   * Must match a key in TRIGGER_KEYWORDS below.
   */
  triggerEvent: string;

  /**
   * Keywords used to locate the trigger event in docket entries.
   * Matched case-insensitively against docTitle + notes + docType.
   */
  triggerKeywords: string[];

  /** Number of calendar days from the trigger event to the deadline. */
  days: number;

  /** Governing statute / rule citation. */
  authority: string;

  /**
   * Which court levels this rule applies to.
   * Used to filter rules when the matter's court is known.
   */
  court_levels: string[];

  /**
   * true  → missing this deadline is fatal to the claim / appeal / right.
   * false → directory or non-fatal.
   */
  fatal: boolean;

  /** Additional notes for the alert body. */
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD RULES TABLE
// ─────────────────────────────────────────────────────────────────────────────

export const PERIOD_RULES: PeriodRule[] = [

  // ── CIVIL — APPEARANCE ────────────────────────────────────────────────────

  {
    id:              'civil_appearance_lagos',
    label:           'Enter appearance (within jurisdiction)',
    track:           'civil',
    role:            'defendant_side',
    triggerEvent:    'service',
    triggerKeywords: [
      'service', 'served', 'process served', 'writ served',
      'originating summons served', 'motion served', 'endorsement of service',
    ],
    days:            8,
    authority:       'Order 9 Rule 1, Lagos High Court Civil Procedure Rules 2019',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           true,
    notes:           'Failure to enter appearance within 8 days of service within jurisdiction exposes the defendant to default judgment.',
  },

  {
    id:              'civil_appearance_outside',
    label:           'Enter appearance (service outside jurisdiction)',
    track:           'civil',
    role:            'defendant_side',
    triggerEvent:    'service_outside',
    triggerKeywords: [
      'service outside jurisdiction', 'substituted service', 'service outside lagos',
      'service by substitution',
    ],
    days:            30,
    authority:       'Order 9 Rule 1, Lagos High Court Civil Procedure Rules 2019',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           true,
    notes:           'Thirty days for defendant served outside jurisdiction to enter appearance.',
  },

  // ── CIVIL — PLEADINGS ─────────────────────────────────────────────────────

  {
    id:              'civil_sod_after_soc',
    label:           'File Statement of Defence',
    track:           'civil',
    role:            'defendant_side',
    triggerEvent:    'soc_served',
    triggerKeywords: [
      'statement of claim served', 'soc served', 'statement of claim filed and served',
      'service of statement of claim',
    ],
    days:            42,
    authority:       'Lagos High Court Civil Procedure Rules 2019',
    court_levels:    ['High Court'],
    fatal:           true,
    notes:           'Defendant has 42 days (6 weeks) from service of the Statement of Claim to file a Statement of Defence.',
  },

  {
    id:              'civil_reply_after_sod',
    label:           'File Reply to Statement of Defence',
    track:           'civil',
    role:            'claimant_side',
    triggerEvent:    'sod_served',
    triggerKeywords: [
      'statement of defence served', 'sod served', 'statement of defence filed and served',
      'service of statement of defence',
    ],
    days:            14,
    authority:       'Lagos High Court Civil Procedure Rules 2019',
    court_levels:    ['High Court'],
    fatal:           false,
    notes:           'Claimant may file a Reply within 14 days of service of the Statement of Defence. Not mandatory but recommended to avoid deemed admission.',
  },

  // ── CIVIL — APPEALS ───────────────────────────────────────────────────────

  {
    id:              'civil_appeal_hc_to_ca',
    label:           'File Notice of Appeal (High Court → Court of Appeal)',
    track:           'civil',
    role:            'both',
    triggerEvent:    'judgment',
    triggerKeywords: [
      'judgment', 'judgment delivered', 'judgment entered', 'judgment of court',
      'final judgment', 'court delivers judgment',
    ],
    days:            90,
    authority:       's. 25(2) Court of Appeal Act Cap C36 LFN 2004',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           true,
    notes:           'Notice of Appeal against a High Court final judgment must be filed within 90 days of the judgment. Extension requires a motion on notice with affidavit explaining every day of delay (Bowaje v Adediwura).',
  },

  {
    id:              'civil_interlocutory_appeal',
    label:           'File Notice of Appeal against interlocutory ruling',
    track:           'civil',
    role:            'both',
    triggerEvent:    'ruling',
    triggerKeywords: [
      'ruling', 'ruling delivered', 'interlocutory ruling', 'court rules',
      'ruling on motion', 'ruling on application',
    ],
    days:            14,
    authority:       'Court of Appeal Rules 2021, Order 7',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           true,
    notes:           'Notice of Appeal against an interlocutory ruling must be filed within 14 days. This is frequently missed and is strictly enforced.',
  },

  {
    id:              'civil_appeal_magistrate_hc',
    label:           'File Notice of Appeal (Magistrate Court → High Court)',
    track:           'civil',
    role:            'both',
    triggerEvent:    'magistrate_judgment',
    triggerKeywords: [
      'magistrate judgment', 'magistrate court judgment', 'magistrate delivers judgment',
      'judgment magistrate',
    ],
    days:            30,
    authority:       'Magistrates\' Courts Act (Lagos)',
    court_levels:    ['Magistrate Court'],
    fatal:           true,
    notes:           'Appeal from Magistrate Court to High Court must be filed within 30 days of judgment.',
  },

  {
    id:              'civil_appeal_ca_to_sc',
    label:           'File Notice of Appeal (Court of Appeal → Supreme Court)',
    track:           'civil',
    role:            'both',
    triggerEvent:    'ca_judgment',
    triggerKeywords: [
      'court of appeal judgment', 'ca judgment', 'court of appeal delivers judgment',
      'judgment of the court of appeal',
    ],
    days:            90,
    authority:       'Supreme Court Act Cap S15 LFN 2004',
    court_levels:    ['Court of Appeal'],
    fatal:           true,
    notes:           'Notice of Appeal to the Supreme Court from a Court of Appeal decision must be filed within 90 days.',
  },

  // ── CRIMINAL — CUSTODY & ARRAIGNMENT ─────────────────────────────────────

  {
    id:              'criminal_arraignment_custody',
    label:           'Arraign accused (s. 293 ACJA — 24-hour custody rule)',
    track:           'criminal',
    role:            'prosecution',
    triggerEvent:    'arrest',
    triggerKeywords: [
      'arrest', 'arrested', 'accused arrested', 'client arrested',
      'suspect arrested', 'arrest of accused',
    ],
    days:            1, // 24 hours = treated as 1 calendar day
    authority:       's. 293 Administration of Criminal Justice Act 2015',
    court_levels:    ['Magistrate Court', 'High Court'],
    fatal:           true,
    notes:           'Under s. 293 ACJA 2015, a person arrested must be charged and taken before a court within 24 hours (or the next working day). Violation grounds a fundamental rights enforcement application.',
  },

  {
    id:              'criminal_remand_review',
    label:           'Apply for bail review (30-day remand period — s. 296 ACJA)',
    track:           'criminal',
    role:            'defence',
    triggerEvent:    'remand',
    triggerKeywords: [
      'remand', 'remanded in custody', 'bail refused', 'bail denied',
      'remand order', 'accused remanded',
    ],
    days:            30,
    authority:       's. 296 Administration of Criminal Justice Act 2015',
    court_levels:    ['Magistrate Court', 'High Court'],
    fatal:           false,
    notes:           'An accused held on remand for 30 days without trial commencement has a right to apply for bail under s. 296 ACJA 2015. This is a periodic right — it renews every 30 days.',
  },

  {
    id:              'criminal_trial_commencement',
    label:           'Trial must commence (s. 396 ACJA — 30-day rule from arraignment in custody)',
    track:           'criminal',
    role:            'both',
    triggerEvent:    'arraignment',
    triggerKeywords: [
      'arraignment', 'arraigned', 'accused arraigned', 'plea taken',
      'charged before court', 'charge read', 'first appearance',
    ],
    days:            30,
    authority:       's. 396 Administration of Criminal Justice Act 2015',
    court_levels:    ['Magistrate Court', 'High Court'],
    fatal:           false,
    notes:           'Where the accused is in custody, s. 396 ACJA 2015 requires trial to commence within 30 days of arraignment. Repeated breach grounds an application for discharge (not necessarily acquittal).',
  },

  // ── CRIMINAL — APPEALS ────────────────────────────────────────────────────

  {
    id:              'criminal_appeal_conviction_hc',
    label:           'File Notice of Appeal against conviction / sentence (30 days)',
    track:           'criminal',
    role:            'defence',
    triggerEvent:    'conviction',
    triggerKeywords: [
      'conviction', 'convicted', 'guilty', 'guilty verdict', 'convicted of',
      'sentence', 'sentenced', 'sentencing', 'custodial sentence',
      'term of imprisonment', 'fine imposed',
    ],
    days:            30,
    authority:       's. 437 Administration of Criminal Justice Act 2015; s. 25 Criminal Procedure Act Cap C41 LFN 2004',
    court_levels:    ['High Court', 'Magistrate Court'],
    fatal:           true,
    notes:           'Notice of Appeal against conviction or sentence from the High Court must be filed within 30 days. This is one of the most commonly missed criminal deadlines. Extension requires a motion with affidavit explaining every day of delay.',
  },

  {
    id:              'criminal_appeal_magistrate',
    label:           'File Notice of Appeal (Magistrate criminal conviction)',
    track:           'criminal',
    role:            'defence',
    triggerEvent:    'magistrate_conviction',
    triggerKeywords: [
      'magistrate conviction', 'convicted magistrate', 'magistrate guilty',
      'magistrate sentence', 'magistrate court conviction',
    ],
    days:            30,
    authority:       'Magistrates\' Courts Act (Lagos)',
    court_levels:    ['Magistrate Court'],
    fatal:           true,
    notes:           'Appeal from magistrate criminal conviction to the High Court must be filed within 30 days of conviction or sentence.',
  },

  {
    id:              'criminal_appeal_ca_to_sc',
    label:           'File Notice of Appeal (Criminal — Court of Appeal → Supreme Court)',
    track:           'criminal',
    role:            'both',
    triggerEvent:    'ca_criminal_judgment',
    triggerKeywords: [
      'court of appeal criminal judgment', 'ca criminal judgment',
      'court of appeal dismisses appeal', 'court of appeal allows appeal',
      'ca judgment criminal',
    ],
    days:            90,
    authority:       'Supreme Court Act Cap S15 LFN 2004',
    court_levels:    ['Court of Appeal'],
    fatal:           true,
    notes:           'Notice of Appeal from a Court of Appeal criminal judgment to the Supreme Court must be filed within 90 days.',
  },

  // ── CIVIL — FINAL WRITTEN ADDRESS ────────────────────────────────────────

  {
    id:              'civil_fwa_defendant_days',
    label:           'File Final Written Address — Defendant (after close of evidence)',
    track:           'civil',
    role:            'defendant_side',
    triggerEvent:    'close_of_evidence',
    triggerKeywords: [
      'close of evidence', 'evidence closed', 'defendant closes case',
      'defence closes case', 'evidence concluded', 'final written address ordered',
      'parties to file written address', 'address ordered',
    ],
    days:            21,
    authority:       'High Court Civil Procedure Rules (e.g. Order 35, FCT High Court Civil Procedure Rules; Federal High Court Rules) — verify local rule',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           false,
    notes:           'Defendant files first. Denying a party the right to file or adopt an address raises a fair hearing concern under s.36 CFRN 1999. Verify the exact day-count against the practice direction of the court seised.',
  },

  {
    id:              'civil_fwa_claimant_days',
    label:           "File Final Written Address — Claimant (after service of Defendant's address)",
    track:           'civil',
    role:            'claimant_side',
    triggerEvent:    'defendant_fwa_served',
    triggerKeywords: [
      "defendant's written address served", 'defendant written address filed',
      'defendant address served', 'written address served on claimant',
      'service of defendant written address',
    ],
    days:            21,
    authority:       'High Court Civil Procedure Rules (e.g. Order 35, FCT High Court Civil Procedure Rules; Federal High Court Rules) — verify local rule',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           false,
    notes:           "Claimant files within 21 days of receiving the Defendant's Final Written Address. Verify the exact day-count against the practice direction of the court seised.",
  },

  {
    id:              'civil_fwa_reply_days',
    label:           "File Reply on Points of Law — Defendant (after service of Claimant's address)",
    track:           'civil',
    role:            'defendant_side',
    triggerEvent:    'claimant_fwa_served',
    triggerKeywords: [
      "claimant's written address served", 'claimant written address filed',
      'claimant address served', 'written address served on defendant',
      'service of claimant written address', 'reply on points of law ordered',
    ],
    days:            7,
    authority:       'High Court Civil Procedure Rules (e.g. Order 35, FCT High Court Civil Procedure Rules; Federal High Court Rules) — verify local rule',
    court_levels:    ['High Court', 'Federal High Court'],
    fatal:           false,
    notes:           "Confined strictly to new points of law raised in the Claimant's address — no new facts, no re-argument of evidence.",
  },

  // ── CRIMINAL — FINAL WRITTEN ADDRESS (ACJA / ACJL) ───────────────────────

  {
    id:              'criminal_fwa_prosecution_days',
    label:           "File Final Written Address — Prosecution (after Defence address)",
    track:           'criminal',
    role:            'prosecution',
    triggerEvent:    'defence_fwa_served',
    triggerKeywords: [
      "defence written address filed", 'defence address served',
      "defendant's written address served", 'written address served on prosecution',
      'service of defence written address', 'criminal written address ordered',
      'parties to file written address',
    ],
    days:            21,
    authority:       's.293–294 Administration of Criminal Justice Act 2015 (or equivalent regional ACJL) — exact window is practice-direction specific, commonly 14–21 days',
    court_levels:    ['High Court', 'Federal High Court', 'Magistrate Court'],
    fatal:           false,
    notes:           "Defence files first once the case for the defence is closed. Prosecution's window commonly ranges 14–21 days depending on the court's practice direction — 21 days is the conservative upper-bound default; verify locally.",
  },

  // ── CRIMINAL — PROSECUTION TIMELINE MANAGEMENT ───────────────────────────

  {
    id:              'criminal_prosecution_close',
    label:           'ACJA 90-day trial target — monitor from arraignment',
    track:           'criminal',
    role:            'prosecution',
    triggerEvent:    'arraignment',
    triggerKeywords: [
      'arraignment', 'arraigned', 'accused arraigned', 'plea taken',
      'charged before court', 'charge read', 'first appearance',
    ],
    days:            90,
    authority:       's. 396(3) Administration of Criminal Justice Act 2015',
    court_levels:    ['High Court', 'Magistrate Court'],
    fatal:           false,
    notes:           'ACJA 2015 sets a target of completing trial within a reasonable time. The 90-day mark is the conventional monitoring point. Prosecution must ensure each hearing produces substantive progress.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all rules applicable to a given track + role combination. */
export function getRulesForContext(
  track: MatterTrack,
  role:  CounselRole,
): PeriodRule[] {
  return PERIOD_RULES.filter(r => {
    const trackMatch = r.track === 'both' || r.track === track;
    const roleMatch  = r.role  === 'both' || r.role  === role;
    return trackMatch && roleMatch;
  });
}

/** Returns a single rule by ID, or undefined. */
export function getRuleById(id: string): PeriodRule | undefined {
  return PERIOD_RULES.find(r => r.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAW REGISTRY — RUNTIME OVERRIDE PATCHER (Phase: Law Change Risk Mitigation)
// ─────────────────────────────────────────────────────────────────────────────

import { getAllOverrides } from '@/law/registry';

/**
 * Patches PERIOD_RULES[].days in place with any values stored in the Law Registry.
 * Must be called once on app mount (via App.tsx useEffect) before any engine reads
 * the rules. The period computer (periodComputer.ts) reads PERIOD_RULES identically
 * — the patched .days values are transparent to it.
 *
 * Non-fatal: if IndexedDB is unavailable, compiled defaults stand.
 */
export async function applyLawOverrides(): Promise<void> {
  try {
    const overrides = await getAllOverrides();
    for (const rule of PERIOD_RULES) {
      const ov = overrides.get(rule.id);
      if (ov !== undefined) {
        const n = parseInt(ov, 10);
        if (!isNaN(n)) rule.days = n;
      }
    }
  } catch {
    // Non-fatal — compiled defaults stand
  }
}
