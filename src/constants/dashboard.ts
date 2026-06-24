/**
 * AFS Advocates — Dashboard Tabs
 * Master Plan Phase 5 — Four tab sets rewritten with merged engines slotted in.
 *
 * New tabs added:
 *   case_command      — Phase 1 (replaces overview)
 *   strategy_hub      — Phase 1A rename (was case_intelligence)
 *   written_address   — Phase 3 (replaces builder + final_address)
 *   copilot           — Phase 4 (now includes Command Console)
 *
 * Tab counts after merge:
 *   Civil        17 → 11
 *   Criminal     17 → 15
 *   FREP         12 →  9
 *   Matrimonial  16 → 11
 *
 * Phase 2A — Civil Matter Tree tab sets added:
 *   TABS_WINDING_UP, TABS_NICN, TABS_CUSTOMARY, TABS_MAGISTRATE,
 *   TABS_SMALL_CLAIMS, TABS_ELECTION_PETITION, TABS_TAX_APPEAL,
 *   TABS_IST, TABS_ARBITRATION
 */

export interface DashTab {
  id:    string;
  icon:  string;
  label: string;
  desc:  string | null;
  step:  number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER TAB REGISTRY
// All tabs that exist anywhere in the system. Tab sets reference these by id.
// ─────────────────────────────────────────────────────────────────────────────

export const DASH_TABS: DashTab[] = [

  // ── Legacy tabs (retained for backward compat + engines not yet removed) ──
  { id: 'overview',     icon: '◉',  label: 'Overview',            desc: null, step: null },
  { id: 'builder',      icon: '✍',  label: 'Argument Builder',    desc: null, step: null },
  { id: 'final_address',icon: '✍',  label: 'Final Address',       desc: null, step: null },
  { id: 'blindspots',   icon: '◈',  label: 'Blind Spots',         desc: null, step: null },
  { id: 'warroom',      icon: '⬛', label: 'War Room',             desc: null, step: null },
  { id: 'briefme',      icon: '🎯', label: 'Brief Me',            desc: null, step: null },
  { id: 'console',      icon: '>',  label: 'Command Console',     desc: null, step: null },
  { id: 'risk',         icon: '■',  label: 'Risk Analytics',      desc: null, step: null },
  { id: 'compliance',   icon: '⚙',  label: 'Compliance Engine',   desc: null, step: null },
  { id: 'timeline',     icon: '⏳', label: 'Timeline',            desc: null, step: null },
  { id: 'alerts',       icon: '🔔', label: 'Alerts',              desc: null, step: null },
  { id: 'authority',    icon: '§',  label: 'Authority Validator', desc: null, step: null },
  { id: 'synthesis',    icon: '◎',  label: 'Case Theory',         desc: null, step: null },
  { id: 'research',     icon: '🔍', label: 'Research',            desc: null, step: null },
  { id: 'filings',      icon: '📋', label: 'Filings',             desc: null, step: null },
  { id: 'san',          icon: '⭐', label: 'SAN Mode',            desc: null, step: null },
  { id: 'criminal',     icon: '⚖', label: 'Criminal Defence',    desc: null, step: null },
  { id: 'matrimonial',  icon: '⚖', label: 'Matrimonial Causes',  desc: null, step: null },

  // ── Phase 1 — Case Command (replaces overview) ────────────────────────────
  {
    id:    'case_command',
    icon:  '◈',
    label: 'Case Command',
    desc:  'Single scrollable command centre. Position strip · Next Action · Stage Timeline · Compliance Audit · Risk Score · Alerts · Quick Actions. Everything that answers: where does this case stand right now.',
    step:  null,
  },

  // ── Phase 1A — Strategy Hub (renamed from case_intelligence) ────────────
  {
    id:    'strategy_hub',
    icon:  '⬛',
    label: 'Strategy Hub',
    desc:  'Three-mode intelligence centre. Mode 1 — Intelligence Layer (Conflict, Judge, Counsel, Settlement, Comms, Witnesses, Interlocutory). Mode 2 — Strategic Cockpit (Case Theory, Posture, Witness Map, Contradictions, Appellate). Mode 3 — Brief Me (one-click pre-hearing brief).',
    step:  null,
  },

  // ── Phase 3 — Written Address (replaces builder + final_address) ─────────
  {
    id:    'written_address',
    icon:  '✍',
    label: 'Written Address',
    desc:  'Four-stage pipeline. Stage 1 — Draft (ArgumentBuilder for civil/FREP; FinalAddressEngine for criminal). Stage 2 — Research (ResearchResolver). Stage 3 — Validate (AuthorityValidator). Stage 4 — Synthesise (SynthesisEngine → Master Case Theory).',
    step:  null,
  },

  // ── Shared engines (unchanged, present across multiple tab sets) ──────────
  {
    id:    'intelligence',
    icon:  '⚡',
    label: 'Intelligence Engine',
    desc:  'AI-powered 5-step intake pipeline — raw facts through structured Intelligence Package. Facts, disputes, missing evidence, legal issues, claims, and risks. Role-aware throughout.',
    step:  null,
  },
  {
    id:    'inheritance',
    icon:  '⟳',
    label: 'Inheritance Mode',
    desc:  'Mid-case handover intelligence. Upload everything from the previous lawyer — AI runs a forensic State-of-Case Audit.',
    step:  null,
  },
  {
    id:    'pleadings',
    icon:  '📜',
    label: 'Pleadings',
    desc:  'Civil pleadings engine. Claimant: draft Statement of Claim, monitor SoD, flag default judgment opportunity. Defendant: draft Statement of Defence, build counterclaim, identify preliminary objection grounds.',
    step:  null,
  },
  {
    id:    'applications',
    icon:  '⚡',
    label: 'Applications',
    desc:  'Universal applications drafter — Civil and Criminal. Intent-driven four-step workflow: describe what you need → AI classifies → confirm package → generate complete documents.',
    step:  null,
  },
  {
    id:    'arg_templates',
    icon:  '◧',
    label: 'Argument Templates',
    desc:  'Trial Engine Consolidation, Phase 2. Build and manage reusable argument skeletons for recurring application types. Pull jurisdiction delta from the Law Registry, AI-draft a framework, save it, and apply it across any matter — only case-specific facts change each time.',
    step:  null,
  },
  {
    id:    'evidence',
    icon:  '📁',
    label: 'Evidence Vault',
    desc:  'Upload and categorise every case document — contracts, affidavits, receipts, chats, audio, photos, court orders, expert reports. Timestamped, previewable, and linked to intelligence outputs.',
    step:  7,
  },
  {
    id:    'crossexam',
    icon:  '⚔',
    label: 'Cross-Examination',
    desc:  'Build and execute comprehensive cross-examination strategies. Witness profiler, impeachment planner, contradiction mapper, question sequencer, and live courtroom mode.',
    step:  null,
  },
  // ── Trial Engine (Build Plan v2, Phase 3) ────────────────────────────────
  {
    id:    'trial',
    icon:  '⚔',
    label: 'Trial Engine',
    desc:  'Unified trial engine. Case Theory Brief · Witness Register · Examination-in-Chief · Cross-Examination · Contradiction Mapper · Impeachment Arsenal · Live Courtroom Mode.',
    step:  null,
  },
  {
    id:    'enforcement',
    icon:  '→',
    label: 'Enforcement',
    desc:  'Civil enforcement engine. Select enforcement mechanism, draft Writ of FIFA or Garnishee Order Nisi, track recovery, seek stay of execution.',
    step:  null,
  },
  {
    id:    'appeal',
    icon:  '↑',
    label: 'Appeal Engine',
    desc:  'Appellate intelligence. Grounds of appeal, brief sections, and cross-appeal strategy.',
    step:  null,
  },
  {
    id:    'copilot',
    icon:  '✦',
    label: 'AI Copilot',
    desc:  'Role-aware AI litigation copilot. Chat Mode: role-aware conversation with full case context. Command Mode: strategic posture switcher + routing pipeline (12 quick commands, two-step classify→execute, per-case log).',
    step:  null,
  },
  {
    id:    'docket',
    icon:  '⚖',
    label: 'Docket',
    desc:  'Case docket — log every filing, order, and hearing. Anchor for computed statutory deadlines.',
    step:  null,
  },

  // ── Criminal procedural engines ───────────────────────────────────────────
  {
    id:    'charge_arraignment',
    icon:  '⚖',
    label: 'Charge & Arraignment',
    desc:  'Prosecution: build and validate counts. Defence: analyse charge defects and generate preliminary objection grounds.',
    step:  null,
  },
  {
    id:    'plea',
    icon:  '⚖',
    label: 'Plea',
    desc:  'Prosecution: record plea per count and generate routing analysis. Defence: plea advice, plea bargain analysis, and routing confirmation.',
    step:  null,
  },
  {
    id:    'prosecution_case',
    icon:  '⚖',
    label: 'Prosecution Case',
    desc:  'Prosecution: opening address, witness schedule, exhibit register, evidence sufficiency audit. Defence: prosecution witness tracker, no-case threshold meter, objection log, cross-examination preparation.',
    step:  null,
  },
  {
    id:    'no_case',
    icon:  '⚖',
    label: 'No-Case Submission',
    desc:  'Defence: draft submission per count (Ajidagba/Ibeziako standard), build authorities, track ruling. Prosecution: draft response, build per-count evidence summary.',
    step:  null,
  },
  {
    id:    'defence_case',
    icon:  '⚖',
    label: 'Defence Case',
    desc:  'Defence: election, register defence witnesses, examination-in-chief drafter, close of defence. Prosecution: cross-examination tracker per defence witness.',
    step:  null,
  },
  {
    id:    'sentencing',
    icon:  '⚖',
    label: 'Sentencing',
    desc:  'Prosecution: aggravating factors builder, sentencing address drafter. Defence: allocutus drafter, mitigation address (Ogundipe factors), ACJA appeal deadline countdown.',
    step:  null,
  },

  // ── Matrimonial engines ───────────────────────────────────────────────────
  {
    id:    'petition_answer',
    icon:  '📜',
    label: 'Petition & Answer',
    desc:  'Matrimonial petition drafting and answer engine under the Matrimonial Causes Act.',
    step:  null,
  },
  {
    id:    'matrimonial_engine',
    icon:  '⚖',
    label: 'Matrimonial Engine',
    desc:  'Full matrimonial engine — custody, maintenance, property, ancillary relief, compulsory conference.',
    step:  null,
  },
  {
    id:    'forms_documents',
    icon:  '📋',
    label: 'Forms & Documents',
    desc:  'Matrimonial Causes Rules forms — Form 6 (Petition), Form 8/8A (Notice), Form 11 (AoS), Form 15 (Answer), Form 17 (Reply), Form 30 (Discretion Statement), Form 31/32 (Set Down).',
    step:  null,
  },
  {
    id:    'decree_enforcement',
    icon:  '→',
    label: 'Decree & Enforcement',
    desc:  'Decree nisi to absolute pipeline. Ancillary relief enforcement. Maintenance enforcement. Post-decree compliance monitoring.',
    step:  null,
  },

  // ── Phase 2A — Civil Matter Tree tab definitions ──────────────────────────

  // Winding Up
  {
    id:    'winding_up',
    icon:  '⚖',
    label: 'Winding-Up Engine',
    desc:  'CAMA winding-up petition engine. Pre-filing: 21-day Statutory Demand Notice. For: Petition + Affidavit in Verification + Notice of Proposed Liquidator + Gazette Evidence. Against: Memo of Appearance + Affidavit in Opposition + Written Address. Third Party: Notice of Intention to Appear + Affidavit of Debt.',
    step:  null,
  },

  // NICN
  {
    id:    'nicn_pleadings',
    icon:  '📜',
    label: 'NICN Pleadings',
    desc:  'National Industrial Court pleadings engine. Complaint Form 1 (employment disputes), Originating Summons Form 2 (CBA/Contract Interpretation), Judicial Review, and Notice of Appeal tracks. Document checklist + AI drafter per mode.',
    step:  null,
  },

  // Customary Court
  {
    id:    'customary_pleadings',
    icon:  '📜',
    label: 'Customary Court Pleadings',
    desc:  'Customary Court civil summons engine. For: Application for Civil Summons + Substance of Complaint + Customary Summons Wrapper. Against: Notice of Appearance + Statement of Defence (optional — oral defence permitted).',
    step:  null,
  },

  // Magistrate Court
  {
    id:    'magistrate_pleadings',
    icon:  '📜',
    label: 'Magistrate Court Pleadings',
    desc:  'Magistrate Court (Southern Nigeria) pleadings engine. Track A — Ordinary Summons: Praecipe (Form 1) + Particulars of Claim + Plaint Note (Form 2) + Witness Statements. Track B — Default Summons (Debt Recovery): Praecipe + Particulars + Plaint Note / Notice of Intention to Defend + Affidavit of Good Defence.',
    step:  null,
  },

  // Small Claims
  {
    id:    'small_claims_pleadings',
    icon:  '📜',
    label: 'Small Claims Pleadings',
    desc:  'Small Claims Court (Fast-Track Magistrate) engine. Pre-filing: Form SCA 1 (7-Day Letter of Demand). For: Form SCA 2 + Form SCA 3 + Annexed Receipts/Evidence. Against: Form SCA 5 (Admission/Defence/Counterclaim).',
    step:  null,
  },

  // Election Petitions Tribunal
  {
    id:    'election_petition_pleadings',
    icon:  '📜',
    label: 'Election Petition Pleadings',
    desc:  'Election Petitions Tribunal engine. Pre-filing: 21-day window from declaration of result (Electoral Act 2022 s.134). For: Petition (Form TF 001) + Grounds + Certificates of Return + Witness List + Pre-trial Depositions + Evidence Schedule + Written Address. Against: Reply to Petition + matching witness/evidence bundle.',
    step:  null,
  },

  // Tax Appeal Tribunal
  {
    id:    'tax_appeal_pleadings',
    icon:  '📜',
    label: 'Tax Appeal Pleadings',
    desc:  'Tax Appeal Tribunal engine. Pre-filing: 30-day objection window from assessment notice. For: Notice of Appeal (TAT Form 1) + Grounds + Statement of Facts + List of Documents + Written Submission. Against: Respondent Statement of Facts + Documents + Written Submission in Opposition.',
    step:  null,
  },

  // Investments & Securities Tribunal
  {
    id:    'ist_pleadings',
    icon:  '📜',
    label: 'IST Pleadings',
    desc:  'Investments & Securities Tribunal engine. For: Originating Application / Notice of Appeal + Statement of Facts + Grounds + Witness List + Witness Statements + Evidence Schedule + Written Address. Against: Statement of Defence / Reply + matching witness/evidence bundle.',
    step:  null,
  },

  // Arbitral Panel
  {
    id:    'arbitration_pleadings',
    icon:  '📜',
    label: 'Arbitration Pleadings',
    desc:  'Arbitral Panel (AMA) engine. Phase 1: Notice of Arbitration (Pre-Panel). Phase 2: Statement of Claim / Statement of Defence. Phase 3: Closing Written Addresses → Final Award.',
    step:  null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — pull DashTab objects by id, preserving order
// ─────────────────────────────────────────────────────────────────────────────

function tabs(...ids: string[]): DashTab[] {
  return ids.map(id => {
    const t = DASH_TABS.find(t => t.id === id);
    if (!t) throw new Error(`dashboard.ts: unknown tab id "${id}"`);
    return t;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING TAB SETS (untouched)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CIVIL — Writ of Summons, Originating Summons, Originating Motion,
 * petition_election, and any other civil process not explicitly mapped.
 */
export const TABS_WRIT: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'trial',
  'strategy_hub',
  'written_address',
  'enforcement',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * CRIMINAL — 15 tabs
 */
export const TABS_CRIMINAL: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'charge_arraignment',
  'plea',
  'prosecution_case',
  'no_case',
  'defence_case',
  'trial',
  'evidence',
  'applications',
  'arg_templates',
  'strategy_hub',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * FREP — Fundamental Rights Enforcement Proceedings.
 */
export const TABS_FREP: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'applications',
  'arg_templates',
  'evidence',
  'trial',
  'strategy_hub',
  'written_address',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * MATRIMONIAL
 */
export const TABS_MATRIMONIAL: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'petition_answer',
  'matrimonial_engine',
  'applications',
  'arg_templates',
  'forms_documents',
  'evidence',
  'trial',
  'strategy_hub',
  'decree_enforcement',
  'appeal',
  'copilot',
);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2A — NEW TAB SETS (Civil Matter Tree)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WINDING UP — Federal High Court, CAMA winding-up petition track.
 */
export const TABS_WINDING_UP: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'winding_up',
  'applications',
  'arg_templates',
  'evidence',
  'trial',
  'strategy_hub',
  'written_address',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * NICN — National Industrial Court (all four modes share this set).
 * nicn_complaint / nicn_originating_summons / nicn_judicial_review / nicn_appeal
 */
export const TABS_NICN: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'nicn_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'trial',
  'strategy_hub',
  'written_address',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * CUSTOMARY COURT
 */
export const TABS_CUSTOMARY: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'customary_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'strategy_hub',
  'written_address',
  'copilot',
  'synthesis',
);

/**
 * MAGISTRATE COURT — covers both Track A (ordinary) and Track B (default/debt).
 * magistrate_plaint / magistrate_default
 */
export const TABS_MAGISTRATE: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'magistrate_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'strategy_hub',
  'written_address',
  'copilot',
  'synthesis',
);

/**
 * SMALL CLAIMS COURT
 */
export const TABS_SMALL_CLAIMS: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'small_claims_pleadings',
  'applications',
  'evidence',
  'strategy_hub',
  'copilot',
  'synthesis',
);

/**
 * ELECTION PETITIONS TRIBUNAL
 */
export const TABS_ELECTION_PETITION: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'election_petition_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'trial',
  'strategy_hub',
  'written_address',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * TAX APPEAL TRIBUNAL
 */
export const TABS_TAX_APPEAL: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'tax_appeal_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'strategy_hub',
  'written_address',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * INVESTMENTS & SECURITIES TRIBUNAL (IST)
 */
export const TABS_IST: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'ist_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'trial',
  'strategy_hub',
  'written_address',
  'appeal',
  'copilot',
  'synthesis',
);

/**
 * ARBITRAL PANEL (AMA)
 */
export const TABS_ARBITRATION: DashTab[] = tabs(
  'case_command',
  'intelligence',
  'inheritance',
  'arbitration_pleadings',
  'applications',
  'arg_templates',
  'evidence',
  'strategy_hub',
  'written_address',
  'copilot',
  'synthesis',
);

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER — returns correct tab set for a given originating_process
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the correct tab set for a given originating_process value.
 * Falls back to TABS_WRIT for any civil process not explicitly mapped.
 * Criminal matters (no originating_process) → TABS_CRIMINAL.
 */
export function getTabsForOriginatingProcess(
  originating_process: string | undefined,
): DashTab[] {
  if (!originating_process) return TABS_CRIMINAL;

  switch (originating_process) {
    // ── Existing ────────────────────────────────────────────────────────────
    case 'frep':
      return TABS_FREP;
    // petition_matrimonial → routed to MatrimonialDashboard in App.tsx

    // ── Phase 2A — Civil Matter Tree ────────────────────────────────────────
    case 'winding_up_petition':
      return TABS_WINDING_UP;

    case 'nicn_complaint':
    case 'nicn_originating_summons':
    case 'nicn_judicial_review':
    case 'nicn_appeal':
      return TABS_NICN;

    case 'customary_summons':
      return TABS_CUSTOMARY;

    case 'magistrate_plaint':
    case 'magistrate_default':
      return TABS_MAGISTRATE;

    case 'small_claims':
      return TABS_SMALL_CLAIMS;

    case 'election_petition':
      return TABS_ELECTION_PETITION;

    case 'tax_appeal':
      return TABS_TAX_APPEAL;

    case 'ist_application':
      return TABS_IST;

    case 'arbitration_notice':
      return TABS_ARBITRATION;

    default:
      return TABS_WRIT;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supporting constants (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/** Case document types for the docket entry form */
export const CASE_DOC_TYPES: string[] = [
  'Pleading', 'Application / Motion', 'Affidavit', 'Written Address',
  'Court Order', 'Judgment', 'Correspondence', 'Brief of Argument',
  'Petition', 'Record of Proceedings', 'Expert Report', 'Other',
];

/** Case filing statuses */
export const CASE_STATUSES: string[] = [
  'Filed', 'Served', 'Awaiting Response', 'Pending Hearing',
  'Adjourned', 'Decided', 'Complied With', 'Contested',
  'Struck Out', 'Withdrawn', 'Settled',
];

/** Status colour mapping for docket entries */
export const STATUS_COLORS: Record<string, { bg: string; bdr: string; col: string }> = {
  'Filed':             { bg: '#081828', bdr: '#1a3a58', col: '#5090d0' },
  'Served':            { bg: '#071a14', bdr: '#1a4030', col: '#40a878' },
  'Awaiting Response': { bg: '#1a1400', bdr: '#3a3000', col: '#b09040' },
  'Pending Hearing':   { bg: '#120a20', bdr: '#281848', col: '#9060c0' },
  'Adjourned':         { bg: '#1a0e00', bdr: '#3a2200', col: '#b07030' },
  'Decided':           { bg: '#071810', bdr: '#1a4028', col: '#40b068' },
  'Complied With':     { bg: '#071810', bdr: '#1a4028', col: '#40b068' },
  'Contested':         { bg: '#180808', bdr: '#401818', col: '#c05050' },
  'Struck Out':        { bg: '#101018', bdr: '#202030', col: '#505068' },
  'Withdrawn':         { bg: '#101018', bdr: '#202030', col: '#505068' },
  'Settled':           { bg: '#0b0902', bdr: '#2a2208', col: '#c4a030' },
};

/** Deadline types for the deadline engine */
export const DEADLINE_TYPES: string[] = [
  'Limitation Period', 'Filing Deadline', 'Response Deadline',
  'Compliance Date', 'Appeal Window', 'Hearing Date',
  'Payment Deadline', 'Custom',
];
