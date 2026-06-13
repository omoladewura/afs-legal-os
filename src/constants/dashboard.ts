/**
 * AFS Advocates — Dashboard Tabs
 * Defines every tab available inside a case dashboard.
 * Each entry maps to a lazy-loaded engine component.
 */

export interface DashTab {
  id:    string;
  icon:  string;
  label: string;
  desc:  string | null;
  step:  number | null;
}

export const DASH_TABS: DashTab[] = [
  { id: 'overview',     icon: '◉',  label: 'Overview',            desc: null,                step: null },
  { id: 'intelligence', icon: '⚡', label: 'Intelligence Engine', desc: 'AI-powered 5-step intake pipeline — raw facts through structured Intelligence Package. Facts, disputes, missing evidence, legal issues, claims, and risks. Role-aware throughout.', step: null },
  { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',       desc: null,                step: null },
  { id: 'builder',      icon: '✍',  label: 'Argument Builder',    desc: null,                step: null },
  { id: 'docket',       icon: '⚖',  label: 'Docket',              desc: null,                step: null },
  { id: 'evidence',     icon: '📁', label: 'Evidence Vault',      desc: 'Upload and categorise every case document — contracts, affidavits, receipts, chats, audio, photos, court orders, expert reports. Timestamped, previewable, and linked to intelligence outputs.', step: 7 },
  { id: 'filings',      icon: '📋', label: 'Filings',             desc: 'Track every filed process — status, service, response deadlines.', step: null },
  { id: 'timeline',     icon: '⏳', label: 'Timeline',            desc: 'Visual chronological view of the entire case.', step: null },
  { id: 'research',     icon: '🔍', label: 'Research',            desc: 'Case law research tied directly to this matter — Nigerian authorities, statute analysis.', step: null },
  { id: 'san',          icon: '⭐', label: 'SAN Mode',            desc: "Your AI Senior Advocate — accepts text and images, returns structured Option A / B / C paths, relevant Nigerian and international authorities, landmines on each path, and SAN's recommendation.", step: null },
  { id: 'briefme',      icon: '🎯', label: 'Brief Me',            desc: "One-click pre-hearing briefing. Pulls from docket, filings, evidence, and intelligence.", step: 9 },
  { id: 'inheritance',  icon: '⟳',  label: 'Inheritance Mode',    desc: 'Mid-case handover intelligence. Upload everything from the previous lawyer — AI runs a forensic State-of-Case Audit.', step: null },
  { id: 'blindspots',   icon: '◈',  label: 'Blind Spots',         desc: 'Seven intelligence modules: Conflict of Interest · Witness Management · Opposing Counsel Profiler · Judge/Court Tendencies · Settlement Tracker + BATNA · Client Communication Log · Interlocutory Tracker.', step: null },
  { id: 'crossexam',    icon: '⚔',  label: 'Cross-Examination',   desc: 'Build and execute comprehensive cross-examination strategies. Witness profiler, impeachment planner, contradiction mapper, question sequencer, and live courtroom mode.', step: null },
  { id: 'compliance',   icon: '⚙',  label: 'Compliance Engine',   desc: 'Procedural compliance audit for every stage of Nigerian litigation.', step: null },
  { id: 'authority',    icon: '§',  label: 'Authority Validator',  desc: 'Validate case authorities before filing — verify binding strength, detect overruled cases.', step: null },
  { id: 'risk',         icon: '■',  label: 'Risk Analytics',       desc: 'Numerical risk scoring across eight strategic dimensions.', step: null },
  { id: 'warroom',      icon: '⬛', label: 'War Room',             desc: 'The strategic cockpit. Aggregates every module into one operational view.', step: null },
  { id: 'console',      icon: '>',  label: 'Command Console',      desc: 'The Litigation OS Terminal. Issue any natural-language command.', step: null },
  { id: 'criminal',     icon: '⚖', label: 'Criminal Defence',     desc: 'Dedicated criminal defence intelligence. Charge analysis, arrest legality, prosecution evidence attack.', step: null },
  { id: 'matrimonial',  icon: '⚖', label: 'Matrimonial Causes',   desc: 'Standalone matrimonial causes intelligence under the Matrimonial Causes Act Cap M7 LFN 2004.', step: null },
  { id: 'copilot',      icon: '✦',  label: 'AI Copilot',           desc: 'Role-aware AI litigation copilot. Every response is framed from your exact position on this matter — claimant, defendant, prosecution, or defence.', step: null },
  // ── Phase 6A — Criminal Procedural Engines ──────────────────────────────────
  { id: 'charge_arraignment', icon: '⚖', label: 'Charge & Arraignment', desc: 'Prosecution: build and validate counts. Defence: analyse charge defects and generate preliminary objection grounds. Both roles: record arraignment proceedings.', step: null },
  { id: 'plea',               icon: '⚖', label: 'Plea',                 desc: 'Prosecution: record plea per count and generate routing analysis. Defence: plea advice, plea bargain analysis, and routing confirmation.', step: null },
  // ── Phase 6B — Core Trial Engines ───────────────────────────────────────────
  { id: 'prosecution_case',   icon: '⚖', label: 'Prosecution Case',     desc: 'Prosecution: opening address, witness schedule, exhibit register, and evidence sufficiency audit. Defence: prosecution witness tracker, no-case threshold meter per count, objection log, and cross-examination preparation.', step: null },
  { id: 'no_case',            icon: '⚖', label: 'No-Case Submission',   desc: 'Defence: draft submission per count (Ajidagba/Ibeziako standard), build authorities, and track ruling. Prosecution: draft response, build per-count evidence summary, and route from ruling outcome.', step: null },
  // ── Phase 6C — Sentencing Engine ────────────────────────────────────────────
  { id: 'sentencing',         icon: '⚖', label: 'Sentencing',            desc: 'Prosecution: aggravating factors builder, sentencing address drafter, and appeal assessment. Defence: allocutus drafter, mitigation address (Ogundipe factors), and ACJA appeal deadline countdown.', step: null },
  // ── Phase 7 — Civil Engines ──────────────────────────────────────────────
  { id: 'pleadings',    icon: '📜', label: 'Pleadings',    desc: 'Civil pleadings engine. Claimant: draft Statement of Claim, monitor SoD, flag default judgment opportunity, respond to counterclaim. Defendant: draft Statement of Defence, build counterclaim, identify preliminary objection grounds.', step: null },
  { id: 'motions',      icon: '⚖',  label: 'Motions',      desc: 'Civil motions and applications engine. Claimant: default judgment, summary judgment, injunction. Defendant: preliminary objection, strike out, stay of proceedings, security for costs. Track all applications.', step: null },
  { id: 'enforcement',  icon: '→',  label: 'Enforcement',  desc: 'Civil enforcement engine. Claimant: select enforcement mechanism, draft Writ of FIFA or Garnishee Order Nisi, track recovery. Defendant: seek stay of execution, track compliance obligations, develop appeal grounds.', step: null },
  // ── Phase 7 Automation — Role-specific Alerts ───────────────────────────────
  { id: 'alerts', icon: '🔔', label: 'Alerts', desc: 'Role-specific automated alert system. Monitors matter state, deadlines, and docket entries to surface precisely targeted alerts from your exact position — claimant, defendant, prosecution, or defence. Static rule-based alerts plus AI-generated intelligence alerts from docket narrative.', step: null },
  // ── Phase A — Missing Criminal Engines ──────────────────────────────────────
  { id: 'defence_case',  icon: '⚖', label: 'Defence Case',    desc: 'Dual-role. Defence: election (call witnesses or rest), register defence witnesses (DW1, DW2…), examination-in-chief drafter, and close of defence. Prosecution: cross-examination tracker per defence witness, defence evidence monitor (admissibility), and record close of defence.', step: null },
  { id: 'final_address', icon: '✍', label: 'Final Address',   desc: 'Dual-role. Draft, file, and track the final written address after close of evidence. Prosecution: built from proved counts, witnesses, exhibits. Defence: built from prosecution gaps, credibility failures, surviving no-case grounds. Both sides: reply on points of law.', step: null },
  // ── Phase B — Applications Engine ────────────────────────────────────────────
  { id: 'applications', icon: '⚡', label: 'Applications', desc: 'Universal applications drafter — Civil and Criminal. Intent-driven four-step workflow: describe what you need → AI classifies → confirm package → generate complete documents. Supports motions ex parte/on notice, opposition, bail, preliminary objection, stay of proceedings, extension of time, stay of execution, and regularisation of records.', step: null },
];

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
