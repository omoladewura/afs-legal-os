/**
 * AFS Advocates — Legal Reference Constants
 * Courts, practice areas, and jurisdictions used across the system.
 */

export const AREAS: string[] = [
  'Contract Law', 'Tort Law / Negligence', 'Criminal Law', 'Constitutional Law',
  'Family Law', 'Land / Property Law', 'Company & Commercial Law', 'Employment Law',
  'Administrative & Public Law', 'Law of Evidence', 'Civil Procedure',
  'Equity & Trusts', 'Conveyancing', 'Probate & Succession', 'Debt Recovery',
  'Intellectual Property', 'Banking & Finance', 'Tax Law', 'Election Petitions',
  'Maritime Law', 'Arbitration & ADR', 'Human Rights', 'Insurance Law',
  'Construction Law', 'Shipping & Carriage', 'Insolvency & Winding Up',
];

export const JURISDICTIONS: string[] = [
  'Nigeria (Federal High Court)', 'Nigeria (Lagos State)', 'Nigeria (Rivers State)',
  'Nigeria (Abuja / FCT)', 'Nigeria (Kano State)', 'Nigeria (Ogun State)',
  'Nigeria (Delta State)', 'Nigeria (Other State High Court)', 'Ghana', 'Kenya',
  'South Africa', 'United Kingdom', 'India', 'General / Common Law',
];

// Tree order:
//   SUPERIOR COURTS OF RECORD
//     1. High Court (State)
//     2. High Court (FCT)
//     3. Federal High Court
//     4. National Industrial Court (NICN)
//   LOWER COURTS OF SUMMARY JURISDICTION
//     5. Customary Court          ← before Magistrate Court
//     6. Magistrate Court (Southern Nigeria)
//     7. Small Claims Court
//   SPECIALIZED TRIBUNALS & PANELS
//     8. Election Petitions Tribunal
//     9. Tax Appeal Tribunal
//    10. Investments & Securities Tribunal (IST)
//    11. Arbitral Panel (AMA)
export const COURTS: string[] = [
  'High Court (State)',
  'High Court (FCT)',
  'Federal High Court',
  'National Industrial Court',
  'Customary Court',
  'Magistrate Court',
  'Small Claims Court',
  'Election Petitions Tribunal',
  'Tax Appeal Tribunal',
  'Investments & Securities Tribunal',
  'Arbitral Panel',
];

/**
 * Court → valid originating processes mapping.
 * Drives the Originating Process dropdown in New Matter form.
 * Only shows processes valid for the selected court.
 *
 * Values must align 1-to-1 with OriginatingProcess union in src/types/index.ts.
 */
export const COURT_ORIGINATING_PROCESSES: Record<string, string[]> = {
  // ── Superior Courts of Record ──────────────────────────────────────────────

  'High Court (State)': [
    'Writ of Summons',          // Mode 1 — Writ Track
    'Originating Summons',      // Mode 2 — Originating Summons Track
    'Originating Motion',       // Mode 3 — Originating Motion Track (General / FREP)
    'Petition',                 // Mode 4 — Petition Track (Matrimonial)
  ],

  'High Court (FCT)': [
    'Writ of Summons',
    'Originating Summons',
    'Originating Motion',       // Mode 3 — Originating Motion Track (General / FREP)
    'Petition',                 // Mode 4 — Petition Track (Matrimonial)
  ],

  'Federal High Court': [
    'Writ of Summons',          // General Civil — Writ Track
    'Originating Summons',      // General Civil — Originating Summons Track
    'Petition',                 // Petition Track — sub-type: Winding-Up Petition (CAMA)
  ],

  'National Industrial Court': [
    'NICN Complaint',           // Mode 1 — Complaint Form 1 (employment disputes)
    'NICN Originating Summons', // Mode 2 — Originating Summons Form 2 (CBA/Contract)
    'NICN Judicial Review',     // Mode 3 — Application for Judicial Review
    'NICN Notice of Appeal',    // Mode 4 — Notice of Appeal
  ],

  // ── Lower Courts of Summary Jurisdiction ──────────────────────────────────

  'Customary Court': [
    'Customary Summons',        // Application for Civil Summons
  ],

  'Magistrate Court': [
    'Magistrate Plaint',        // Track A — Ordinary Summons
    'Magistrate Default',       // Track B — Default Summons (Debt Recovery)
  ],

  'Small Claims Court': [
    'Small Claims',             // Form SCA 2 / SCA 3 track
  ],

  // ── Specialized Tribunals & Panels ────────────────────────────────────────

  'Election Petitions Tribunal': [
    'Election Petition',        // Form TF 001
  ],

  'Tax Appeal Tribunal': [
    'Tax Appeal',               // Notice of Appeal (TAT Form 1)
  ],

  'Investments & Securities Tribunal': [
    'IST Application',          // Originating Application / Notice of Appeal
  ],

  'Arbitral Panel': [
    'Notice of Arbitration',    // Phase 1 — Pre-Panel
  ],
};

export const CASE_STATUSES: string[] = [
  'Filed', 'Active', 'Adjourned', 'Judgment', 'Appeal', 'Settled', 'Closed',
];

export const CASE_DOC_TYPES: string[] = [
  'Writ / Originating Process', 'Statement of Claim', 'Statement of Defence',
  'Reply', 'Motion / Application', 'Affidavit', 'Written Address',
  'Witness Statement', 'Brief of Argument', 'Judgment', 'Order', 'Other',
];

export const DEADLINE_TYPES: string[] = [
  'Filing Deadline', 'Service Deadline', 'Response Deadline', 'Hearing Date',
  'Court Date', 'Limitation Deadline', 'Payment Deadline', 'Other',
];

// ─────────────────────────────────────────────────────────────────────────────
// FINAL WRITTEN ADDRESS — PROCEDURAL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const FAIR_HEARING_REFERENCE = {
  provision:   's.36(1) Constitution of the Federal Republic of Nigeria 1999 (as amended)',
  principle:   'Every person is entitled to a fair hearing within a reasonable time by a court or other tribunal. Denying a party the opportunity to file or adopt their Final Written Address may constitute a breach of the right to fair hearing.',
  cases: [
    {
      citation: 'Bosah v. Oji (2002) 6 NWLR (Pt. 763) 345 (CA) — VERIFY CITATION',
      point:    'Refusal to hear an address before delivering judgment can render the judgment a nullity for breach of fair hearing.',
    },
    {
      citation: 'Obodo v. Olomu (1987) 3 NWLR (Pt. 59) 111 (SC) — VERIFY CITATION',
      point:    'The right to be heard is fundamental; a party must be given a reasonable opportunity to present its case including written submissions.',
    },
  ],
  caveat: 'CITATION VERIFICATION REQUIRED — confirm case names, volumes, and holdings in LawPavilion or equivalent before filing.',
} as const;

export const CIVIL_FWA_SEQUENCE: readonly {
  step:    number;
  party:   string;
  action:  string;
  note:    string;
}[] = [
  {
    step:   1,
    party:  'Defendant / Respondent',
    action: 'Files Final Written Address',
    note:   'Defendant files first after close of evidence. Day-count: see civil_fwa_defendant_days in Law Registry.',
  },
  {
    step:   2,
    party:  'Claimant / Plaintiff',
    action: 'Files Final Written Address',
    note:   "Claimant files after receiving Defendant's address. Day-count: see civil_fwa_claimant_days in Law Registry.",
  },
  {
    step:   3,
    party:  'Defendant / Respondent',
    action: 'Files Reply on Points of Law (if any)',
    note:   "Optional but strategic. Restricted to new points of law in Claimant's address only — no new facts, no re-argument. Day-count: see civil_fwa_reply_days in Law Registry.",
  },
  {
    step:   4,
    party:  'Both parties',
    action: 'Adoption / Oral Address (if directed by court)',
    note:   'Court may direct oral adoption. Denial of adoption opportunity may ground a fair hearing objection — see FAIR_HEARING_REFERENCE.',
  },
] as const;

export const CRIMINAL_FWA_SEQUENCE: readonly {
  step:    number;
  party:   string;
  action:  string;
  note:    string;
}[] = [
  {
    step:   1,
    party:  'Defence / Accused',
    action: 'Files Final Written Address',
    note:   'Defence files first once the case for the defence is formally closed.',
  },
  {
    step:   2,
    party:  'Prosecution',
    action: 'Files Final Written Address in Response',
    note:   "Prosecution responds after receiving Defence address. Day-count: see criminal_fwa_prosecution_days in Law Registry (commonly 14–21 days — verify locally).",
  },
  {
    step:   3,
    party:  'Both parties',
    action: 'Adoption / Oral Address (if directed by court)',
    note:   'Court may direct oral adoption. Right to adopt is protected under s.36 CFRN 1999 — see FAIR_HEARING_REFERENCE.',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_C: Record<string, { bg: string; bdr: string; col: string }> = {
  'Filed':    { col: '#4a7ed0', bg: '#080e1a', bdr: '#1a2a4a' },
  'Active':   { col: '#40a868', bg: '#081810', bdr: '#1a4028' },
  'Adjourned':{ col: '#c4a030', bg: '#1a1400', bdr: '#4a3800' },
  'Judgment': { col: '#8050d0', bg: '#0e0818', bdr: '#2a1050' },
  'Appeal':   { col: '#c06040', bg: '#1a0e08', bdr: '#5a2010' },
  'Settled':  { col: '#5a9a70', bg: '#081410', bdr: '#1a3828' },
  'Closed':   { col: '#5a5a78', bg: '#0a0a12', bdr: '#1a1a28' },
};
