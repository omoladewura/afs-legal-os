/**
 * AFS Legal OS V2 — Role Workspace Constants
 *
 * Defines which tabs are shown, what quick actions appear, and what procedural
 * stages exist for each combination of matter_track + counsel_role.
 *
 * This is the single source of truth for role-adaptive workspace layout.
 * Every tab bar, quick action strip, and timeline derives from these tables.
 */

import type { MatterTrack, CounselRole } from '@/types';
import type { DashTabId } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TAB VISIBILITY — which tabs show for each role
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps counsel_role → ordered list of DashTabIds to display.
 * Tabs not listed here are hidden from the tab bar for that role.
 * 'overview' is always first. 'console' and 'san' are always available.
 */
export const ROLE_TABS: Record<CounselRole, DashTabId[]> = {
  claimant_side: [
    'overview',
    'alerts',
    'copilot',
    'pleadings',
    'motions',
    'enforcement',
    'timeline',
    'docket',
    'filings',
    'evidence',
    'intelligence',
    'builder',
    'crossexam',
    'compliance',
    'risk',
    'appeal',
    'blindspots',
    'briefme',
    'warroom',
    'research',
    'authority',
    'san',
    'console',
  ],
  defendant_side: [
    'overview',
    'alerts',
    'copilot',
    'pleadings',
    'motions',
    'enforcement',
    'timeline',
    'docket',
    'filings',
    'evidence',
    'intelligence',
    'builder',
    'crossexam',
    'compliance',
    'risk',
    'appeal',
    'blindspots',
    'briefme',
    'warroom',
    'research',
    'authority',
    'san',
    'console',
  ],
  prosecution: [
    'overview',
    'alerts',
    'copilot',
    'charge_arraignment',
    'plea',
    'prosecution_case',
    'no_case',
    'sentencing',
    'timeline',
    'docket',
    'filings',
    'evidence',
    'intelligence',
    'builder',
    'crossexam',
    'compliance',
    'risk',
    'appeal',
    'blindspots',
    'briefme',
    'warroom',
    'research',
    'authority',
    'san',
    'console',
  ],
  defence: [
    'overview',
    'alerts',
    'copilot',
    'charge_arraignment',
    'plea',
    'prosecution_case',
    'no_case',
    'sentencing',
    'timeline',
    'docket',
    'filings',
    'evidence',
    'intelligence',
    'builder',
    'crossexam',
    'criminal',
    'compliance',
    'risk',
    'appeal',
    'blindspots',
    'briefme',
    'warroom',
    'research',
    'authority',
    'san',
    'console',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// QUICK ACTIONS — role-specific action buttons in the dashboard header
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickAction {
  label:   string;
  icon:    string;
  tab:     DashTabId;
  accent:  string;
  hint:    string;
}

export const ROLE_QUICK_ACTIONS: Record<CounselRole, QuickAction[]> = {
  claimant_side: [
    { label: 'File Pleading',     icon: '✍', tab: 'pleadings',    accent: '#4090d0', hint: 'SoC, Reply, or Counterclaim Response' },
    { label: 'Create Motion',     icon: '⚖', tab: 'motions',      accent: '#4090d0', hint: 'Default, Summary, Injunction' },
    { label: 'Evidence',          icon: '📁', tab: 'evidence',     accent: '#4090d0', hint: 'Upload & organise proof' },
    { label: 'Intelligence',      icon: '⚡', tab: 'intelligence', accent: '#4090d0', hint: 'AI case analysis' },
    { label: 'Start Enforcement', icon: '→',  tab: 'enforcement',  accent: '#4090d0', hint: 'Execute judgment' },
  ],
  defendant_side: [
    { label: 'File Defence',     icon: '🛡', tab: 'pleadings',    accent: '#c06060', hint: 'SoD, Counterclaim, Preliminary Objection' },
    { label: 'File Objection',   icon: '✗',  tab: 'motions',      accent: '#c06060', hint: 'Preliminary objection, Strike out, Stay' },
    { label: 'Evidence',         icon: '📁', tab: 'evidence',     accent: '#c06060', hint: 'Upload & organise defence' },
    { label: 'Intelligence',     icon: '⚡', tab: 'intelligence', accent: '#c06060', hint: 'AI case analysis' },
    { label: 'Seek Stay',        icon: '⏸', tab: 'enforcement',  accent: '#c06060', hint: 'Stay of execution pending appeal' },
  ],
  prosecution: [
    { label: 'Charge & Arraignment', icon: '⚖', tab: 'charge_arraignment', accent: '#c09030', hint: 'Build charge, validate counts, record arraignment' },
    { label: 'Plea',                 icon: '⚖', tab: 'plea',               accent: '#c09030', hint: 'Record plea, route to prosecution case or sentencing' },
    { label: 'Prosecution Case',     icon: '👤', tab: 'prosecution_case',   accent: '#c09030', hint: 'Opening address, witness schedule, exhibit register' },
    { label: 'No-Case Response',     icon: '⚖', tab: 'no_case',            accent: '#c09030', hint: 'Respond to no-case submission' },
    { label: 'Build Address',        icon: '✍', tab: 'builder',            accent: '#c09030', hint: 'Opening / Sentencing address' },
  ],
  defence: [
    { label: 'Charge & Arraignment', icon: '⚖', tab: 'charge_arraignment', accent: '#40a860', hint: 'Analyse charge defects, objection grounds, arraignment' },
    { label: 'Plea Advice',          icon: '⚖', tab: 'plea',               accent: '#40a860', hint: 'Plea options, plea bargain, routing' },
    { label: 'Prosecution Case',     icon: '⚔', tab: 'prosecution_case',   accent: '#40a860', hint: 'Track witnesses, no-case threshold, cross-exam prep' },
    { label: 'No-Case Submission',   icon: '✗',  tab: 'no_case',            accent: '#40a860', hint: 'Draft and file no-case submission' },
    { label: 'Bail Application',     icon: '🔓', tab: 'criminal',           accent: '#40a860', hint: 'Draft or track bail' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURAL STAGES — shown in Timeline per role
// ─────────────────────────────────────────────────────────────────────────────

export interface ProceduralStage {
  id:      string;
  label:   string;
  desc:    string;        // what this side must do at this stage
  icon:    string;
}

export const ROLE_STAGES: Record<CounselRole, ProceduralStage[]> = {
  claimant_side: [
    { id: 'pre_action',      label: 'Pre-Action',          icon: '◦', desc: 'Client intake, cause of action confirmed, pre-action letters sent.' },
    { id: 'commencement',    label: 'Commencement',        icon: '◦', desc: 'Draft and file originating process (Writ, OS, OM, Petition).' },
    { id: 'service',         label: 'Service',             icon: '◦', desc: 'Effect service on defendant, file proof of service.' },
    { id: 'appearance',      label: 'Appearance',          icon: '◦', desc: 'Monitor defendant appearance. Flag default if none entered.' },
    { id: 'pleadings',       label: 'Pleadings',           icon: '◦', desc: 'File Statement of Claim. Respond to Counterclaim if raised.' },
    { id: 'interlocutory',   label: 'Interlocutory',       icon: '◦', desc: 'Injunctions, summary judgment, default judgment, joinder applications.' },
    { id: 'cmc',             label: 'CMC / Pre-Trial',     icon: '◦', desc: 'Attend conference, identify issues, consider ADR.' },
    { id: 'trial',           label: 'Trial',               icon: '◦', desc: 'Open case. Call and examine witnesses. Tender exhibits.' },
    { id: 'judgment',        label: 'Judgment',            icon: '◦', desc: 'Monitor reliefs granted. Prepare for enforcement.' },
    { id: 'enforcement',     label: 'Enforcement',         icon: '◦', desc: 'Execute enforcement mechanism appropriate to judgment obtained.' },
    { id: 'appeal',          label: 'Appeal',              icon: '◦', desc: 'File Notice of Appeal, compile records, file Appellant\'s Brief.' },
  ],
  defendant_side: [
    { id: 'service_received', label: 'Service Received',   icon: '◦', desc: 'Receive originating process. Assess regularity of service.' },
    { id: 'appearance',       label: 'Enter Appearance',   icon: '◦', desc: 'Enter unconditional or conditional appearance within time.' },
    { id: 'pleadings',        label: 'Pleadings',          icon: '◦', desc: 'File Statement of Defence. Consider Counterclaim. Assess preliminary objection.' },
    { id: 'interlocutory',    label: 'Applications',       icon: '◦', desc: 'Stay, strike out, preliminary objection, security for costs.' },
    { id: 'cmc',              label: 'CMC / Pre-Trial',    icon: '◦', desc: 'Attend conference, identify issues, consider ADR.' },
    { id: 'trial',            label: 'Trial',              icon: '◦', desc: 'Cross-examine claimant witnesses. Open own case and call witnesses.' },
    { id: 'judgment',         label: 'Judgment',           icon: '◦', desc: 'Assess grounds of appeal. Advise client on compliance.' },
    { id: 'appeal',           label: 'Appeal',             icon: '◦', desc: 'File Notice of Appeal, Appellant\'s Brief, or Respondent\'s Brief.' },
  ],
  prosecution: [
    { id: 'investigation',    label: 'Investigation',      icon: '◦', desc: 'Supervise investigation. Review evidence. Advise on charge readiness.' },
    { id: 'charge',           label: 'Charge Filed',       icon: '◦', desc: 'Draft and file Charge/Information. Validate counts and jurisdiction.' },
    { id: 'arraignment',      label: 'Arraignment',        icon: '◦', desc: 'Confirm accused present and charge read. Address any bail application.' },
    { id: 'plea',             label: 'Plea',               icon: '◦', desc: 'Note plea. Route to prosecution case (Not Guilty) or sentencing (Guilty).' },
    { id: 'prosecution_case', label: 'Prosecution Case',   icon: '◦', desc: 'Open case. Call witnesses. Tender exhibits. Close prosecution.' },
    { id: 'no_case_response', label: 'No-Case Response',   icon: '◦', desc: 'Respond to no-case submission. Defend evidence sufficiency.' },
    { id: 'final_address',    label: 'Final Address',      icon: '◦', desc: 'File prosecution reply address.' },
    { id: 'judgment',         label: 'Judgment',           icon: '◦', desc: 'If acquittal — consider appeal. If conviction — prepare sentencing submissions.' },
    { id: 'sentencing',       label: 'Sentencing',         icon: '◦', desc: 'Address court on appropriate sentence. Emphasise aggravating factors.' },
    { id: 'appeal',           label: 'Appeal',             icon: '◦', desc: 'Prosecution appeal against acquittal or inadequate sentence.' },
  ],
  defence: [
    { id: 'investigation',    label: 'Investigation',      icon: '◦', desc: 'Monitor investigation. Secure bail. Advise client on rights.' },
    { id: 'charge_review',    label: 'Charge Review',      icon: '◦', desc: 'Review charge for defects. Assess preliminary objection grounds.' },
    { id: 'arraignment',      label: 'Arraignment',        icon: '◦', desc: 'Ensure proper arraignment. Take plea. Apply for bail.' },
    { id: 'plea',             label: 'Plea',               icon: '◦', desc: 'Advise on plea. Consider plea bargain. File preliminary objection if applicable.' },
    { id: 'prosecution_case', label: 'Prosecution Case',   icon: '◦', desc: 'Cross-examine each prosecution witness. Monitor no-case threshold.' },
    { id: 'no_case',          label: 'No-Case Submission', icon: '◦', desc: 'Draft and file no-case submission. Identify counts not proved.' },
    { id: 'defence_case',     label: 'Defence Case',       icon: '◦', desc: 'Call witnesses or rest on prosecution case. Manage defence evidence.' },
    { id: 'final_address',    label: 'Final Address',      icon: '◦', desc: 'File defence address. Reply on points of law if applicable.' },
    { id: 'judgment',         label: 'Judgment',           icon: '◦', desc: 'If conviction — prepare allocutus. If acquittal — ensure release.' },
    { id: 'sentencing',       label: 'Sentencing / Allocutus', icon: '◦', desc: 'Deliver allocutus. Address mitigating factors. Seek lenient sentence.' },
    { id: 'appeal',           label: 'Appeal',             icon: '◦', desc: 'Appeal against conviction and/or sentence. Bail pending appeal.' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW POSITION SUMMARY — role-specific text for the Overview tab header
// ─────────────────────────────────────────────────────────────────────────────

export interface RolePositionConfig {
  positionLabel:   string;  // e.g. "Claimant's Position"
  positionDesc:    string;  // short description of role objective
  nextActionLabel: string;  // label for the "Next Action" strip
  riskLabel:       string;  // label for the risk/flag section
  accentColor:     string;  // from COUNSEL_ROLE_COLORS
  icon:            string;
}

export const ROLE_POSITION_CONFIG: Record<CounselRole, RolePositionConfig> = {
  claimant_side: {
    positionLabel:   "Claimant's Position",
    positionDesc:    'Advancing the claim — driving pleadings, applications, trial, and enforcement.',
    nextActionLabel: 'Next Claimant Action',
    riskLabel:       'Claimant Risk Flags',
    accentColor:     '#4090d0',
    icon:            '⚔',
  },
  defendant_side: {
    positionLabel:   "Defendant's Position",
    positionDesc:    'Resisting or managing the claim — filing defences, applications, and challenges.',
    nextActionLabel: 'Next Defence Action',
    riskLabel:       'Defendant Risk Flags',
    accentColor:     '#c06060',
    icon:            '🛡',
  },
  prosecution: {
    positionLabel:   'Prosecution Position',
    positionDesc:    'Building and presenting the case — proving each count beyond reasonable doubt.',
    nextActionLabel: 'Next Prosecution Step',
    riskLabel:       'Prosecution Risk Flags',
    accentColor:     '#c09030',
    icon:            '⚖',
  },
  defence: {
    positionLabel:   'Defence Position',
    positionDesc:    'Protecting the accused — challenging prosecution evidence at every stage.',
    nextActionLabel: 'Next Defence Action',
    riskLabel:       'Defence Risk Flags',
    accentColor:     '#40a860',
    icon:            '🛡',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT NEXT ACTIONS — shown when no explicit stage is set
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_DEFAULT_NEXT_ACTION: Record<CounselRole, string> = {
  claimant_side:  'Draft and file originating process to commence the action.',
  defendant_side: 'Enter appearance within time and assess the originating process.',
  prosecution:    'Review investigation file and advise on charge readiness.',
  defence:        'Review charge for defects and apply for bail if in custody.',
};

// ─────────────────────────────────────────────────────────────────────────────
// RISK FLAGS — static role-aware risk prompts shown in the Overview
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_RISK_FLAGS: Record<CounselRole, Array<{ label: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>> = {
  claimant_side: [
    { label: 'Confirm limitation period has not expired before filing.',          severity: 'HIGH' },
    { label: 'Monitor whether defendant has entered appearance — default may be available.', severity: 'MEDIUM' },
    { label: 'Ensure Statement of Claim discloses all necessary particulars.',    severity: 'MEDIUM' },
    { label: 'Identify the correct enforcement mechanism before judgment is perfected.', severity: 'LOW' },
  ],
  defendant_side: [
    { label: 'Appearance deadline: failure to appear risks default judgment.',    severity: 'HIGH' },
    { label: 'Statement of Defence filing deadline — do not let it lapse.',       severity: 'HIGH' },
    { label: 'Assess whether a preliminary objection or strike-out is available.', severity: 'MEDIUM' },
    { label: 'Counterclaim opportunity — assess whether cross-relief should be sought.', severity: 'LOW' },
  ],
  prosecution: [
    { label: 'ACJA 90-day trial period — ensure strict compliance.',              severity: 'HIGH' },
    { label: 'Every exhibit must be properly tendered and marked — check admissibility.', severity: 'HIGH' },
    { label: 'Witness inconsistencies between statements must be addressed before cross-examination.', severity: 'MEDIUM' },
    { label: 'Counts must each have evidence satisfying every essential ingredient.', severity: 'MEDIUM' },
  ],
  defence: [
    { label: 'ACJA remand period — monitor and apply for bail if approaching deadline.', severity: 'HIGH' },
    { label: 'Monitor no-case threshold after each prosecution witness.',           severity: 'HIGH' },
    { label: 'Assess charge for defects — preliminary objection grounds.',          severity: 'MEDIUM' },
    { label: 'Appeal deadline runs from date of conviction — track immediately.',   severity: 'MEDIUM' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// MODULE GRID — role-aware module display for the Overview readiness grid
// ─────────────────────────────────────────────────────────────────────────────

export interface RoleModule {
  id:    DashTabId;
  icon:  string;
  label: string;
  desc:  string;  // role-specific description
}

export const ROLE_MODULES: Record<CounselRole, RoleModule[]> = {
  claimant_side: [
    { id: 'pleadings',    icon: '📜', label: 'Pleadings',     desc: 'Draft SoC, monitor SoD, flag default judgment opportunity' },
    { id: 'motions',      icon: '⚖',  label: 'Motions',       desc: 'Default, summary judgment, injunction applications' },
    { id: 'enforcement',  icon: '→',  label: 'Enforcement',   desc: 'Writ of FIFA, garnishee, recovery tracking' },
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',  desc: 'Claim strength analysis and evidence gaps' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',      desc: 'Evidence proving each head of claim' },
    { id: 'crossexam',   icon: '⚔',  label: 'Cross-Exam',    desc: 'Cross of defendant witnesses' },
    { id: 'risk',        icon: '■',  label: 'Risk Analytics', desc: 'Limitation, default, enforcement risks' },
    { id: 'appeal',      icon: '↑',  label: 'Appeal Engine',  desc: 'Appellant\'s or Respondent\'s brief' },
  ],
  defendant_side: [
    { id: 'pleadings',    icon: '📜', label: 'Pleadings',     desc: 'Draft SoD, build counterclaim, preliminary objection grounds' },
    { id: 'motions',      icon: '⚖',  label: 'Applications',  desc: 'Strike out, stay, preliminary objection, security for costs' },
    { id: 'enforcement',  icon: '→',  label: 'Enforcement',   desc: 'Stay of execution, compliance tracking, appeal grounds' },
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',  desc: 'Defence strength and available objections' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',      desc: 'Evidence answering each cause of action' },
    { id: 'crossexam',   icon: '⚔',  label: 'Cross-Exam',    desc: 'Cross of claimant witnesses' },
    { id: 'risk',        icon: '■',  label: 'Risk Analytics', desc: 'Default exposure, appeal grounds' },
    { id: 'appeal',      icon: '↑',  label: 'Appeal Engine',  desc: 'Appellant\'s or Respondent\'s brief' },
  ],
  prosecution: [
    { id: 'intelligence',     icon: '⚡', label: 'Intelligence',     desc: 'Count-by-count evidence analysis' },
    { id: 'prosecution_case', icon: '⚖', label: 'Prosecution Case', desc: 'Opening address, witnesses, exhibits, sufficiency' },
    { id: 'no_case',          icon: '⚖', label: 'No-Case Response', desc: 'Respond to no-case submission per count' },
    { id: 'sentencing',       icon: '⚖', label: 'Sentencing',       desc: 'Aggravating factors, sentencing address, appeal' },
    { id: 'evidence',         icon: '📁', label: 'Evidence',         desc: 'Exhibits and witnesses by count' },
    { id: 'builder',          icon: '✍',  label: 'Arg Builder',      desc: 'Opening address, sentencing submissions' },
    { id: 'crossexam',        icon: '⚔',  label: 'Cross-Exam',       desc: 'Cross of defence witnesses' },
    { id: 'compliance',       icon: '⚙',  label: 'Compliance',       desc: 'ACJA compliance status' },
    { id: 'appeal',           icon: '↑',  label: 'Appeal Engine',    desc: 'Appeal against acquittal or sentence' },
  ],
  defence: [
    { id: 'intelligence',     icon: '⚡', label: 'Intelligence',    desc: 'Prosecution case weaknesses and gaps' },
    { id: 'prosecution_case', icon: '⚔', label: 'Prosecution Case', desc: 'Witness tracker, no-case threshold, cross-exam prep' },
    { id: 'no_case',          icon: '⚖', label: 'No-Case Sub.',     desc: 'Draft submission, authorities, ruling tracker' },
    { id: 'sentencing',       icon: '⚖', label: 'Sentencing',       desc: 'Allocutus, mitigation address, appeal deadline' },
    { id: 'evidence',         icon: '📁', label: 'Evidence',         desc: 'Defence witnesses and exhibits' },
    { id: 'builder',          icon: '✍',  label: 'Arg Builder',      desc: 'Defence address, allocutus' },
    { id: 'crossexam',        icon: '⚔',  label: 'Cross-Exam',       desc: 'Cross of prosecution witnesses' },
    { id: 'criminal',         icon: '⚖',  label: 'Criminal Engine',  desc: 'Charge analysis, bail tracking, no-case' },
    { id: 'appeal',           icon: '↑',  label: 'Appeal Engine',    desc: 'Appeal against conviction or sentence' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE KEYWORD MAP — auto-detects current stage from docket entry titles
// Maps stage IDs → arrays of keywords. If a docket entry title contains any
// of these keywords (case-insensitive), that stage is considered "seen".
// The highest-index seen stage becomes the detected current stage.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_KEYWORDS: Record<string, string[]> = {
  // Civil — shared stage IDs
  pre_action:       ['pre-action', 'letter before action', 'pre action', 'demand letter', 'client intake'],
  commencement:     ['writ', 'originating summons', 'originating motion', 'petition', 'filed originating', 'commenced'],
  service:          ['service', 'served', 'proof of service', 'bailiff', 'substituted service'],
  service_received: ['process received', 'writ received', 'summons received', 'service received'],
  appearance:       ['memorandum of appearance', 'conditional appearance', 'appearance entered', 'entered appearance'],
  pleadings:        ['statement of claim', 'statement of defence', 'soc', 'sod', 'counterclaim', 'reply', 'pleadings'],
  interlocutory:    ['motion', 'application', 'injunction', 'interlocutory', 'default judgment', 'summary judgment', 'strike out', 'preliminary objection', 'stay'],
  cmc:              ['cmc', 'case management', 'pre-trial', 'pre trial', 'conference', 'adr', 'mediation'],
  trial:            ['trial', 'hearing commenced', 'opening address', 'witness', 'examination', 'cross-examination', 'exhibit', 'tendered'],
  judgment:         ['judgment', 'ruling', 'order made', 'decided', 'judgment delivered'],
  enforcement:      ['enforcement', 'garnishee', 'writ of fifa', 'sheriff', 'execution', 'recovery'],
  appeal:           ['notice of appeal', 'appeal filed', 'appellant brief', 'respondent brief', 'appeal brief'],

  // Criminal stage IDs
  investigation:    ['investigation', 'police station', 'detention', 'dpp', 'fiat', 'proof of evidence review'],
  charge:           ['charge', 'information filed', 'charge filed', 'information', 'count'],
  charge_review:    ['charge defect', 'charge review', 'preliminary objection to charge'],
  arraignment:      ['arraignment', 'arraigned', 'charge read', 'plea taken', 'bail application'],
  plea:             ['plea', 'not guilty', 'guilty', 'plea bargain', 'allocutus'],
  prosecution_case: ['prosecution opens', 'prosecution witness', 'pw1', 'pw2', 'pw3', 'pw4', 'proof of evidence', 'opening address', 'close of prosecution'],
  no_case:          ['no-case', 'no case submission', 'submission of no case', 'no case to answer'],
  no_case_response: ['no-case response', 'prosecution response to no-case', 'respond to no-case'],
  defence_case:     ['defence witness', 'dw1', 'dw2', 'defence opens', 'close of defence', 'defence case'],
  final_address:    ['final address', 'written address', 'defence address', 'prosecution address', 'reply on points'],
  sentencing:       ['sentencing', 'sentence', 'allocutus', 'mitigation', 'conviction'],
};

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC NEXT ACTIONS — stage-aware next action strings per role
// Keys are stage IDs from ROLE_STAGES. The value is what counsel must do NEXT
// (i.e. the action at the FOLLOWING stage, not the current one).
// Falls back to ROLE_DEFAULT_NEXT_ACTION if no stage match is found.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_NEXT_ACTIONS: Record<CounselRole, Record<string, string>> = {
  claimant_side: {
    pre_action:    'Draft and file the originating process to commence the action.',
    commencement:  'Effect service on the defendant and file proof of service.',
    service:       'Monitor whether the defendant has entered appearance. Default opportunity may arise.',
    appearance:    'File your Statement of Claim within the required timeframe.',
    pleadings:     'Consider interlocutory applications — default judgment, injunction, or summary judgment.',
    interlocutory: 'Attend CMC. Identify issues for trial. Consider ADR.',
    cmc:           'Prepare for trial. Finalise witness list, exhibits, and opening address.',
    trial:         'Await judgment. Monitor reliefs being considered.',
    judgment:      'Activate enforcement. Select and execute enforcement mechanism.',
    enforcement:   'Monitor enforcement progress and recovery. Apply for further orders if needed.',
    appeal:        'File Appellant\'s Brief or Respondent\'s Brief within time.',
  },
  defendant_side: {
    service_received: 'Enter appearance within time — failure risks default judgment.',
    appearance:       'File your Statement of Defence. Assess preliminary objection grounds.',
    pleadings:        'Consider applications — strike out, stay of proceedings, or security for costs.',
    interlocutory:    'Attend CMC. Identify issues for trial. Consider ADR or settlement.',
    cmc:              'Prepare for trial. Cross-examination of claimant witnesses. Own witness list.',
    trial:            'Await judgment. Identify grounds of appeal if adverse.',
    judgment:         'File Notice of Appeal within time. Advise client on compliance.',
    appeal:           'File Appellant\'s Brief or Respondent\'s Brief within time.',
  },
  prosecution: {
    investigation:    'Finalise investigation file. Advise on charge readiness and file charge.',
    charge:           'Arrange arraignment. Confirm accused present. Address bail application.',
    arraignment:      'Note the plea. Open prosecution case. File proof of evidence.',
    plea:             'Open prosecution case. File and serve witness schedule. Prepare exhibits.',
    prosecution_case: 'Monitor close of prosecution. Prepare to respond to no-case submission.',
    no_case_response: 'Await ruling on no-case submission. If overruled — defence case proceeds.',
    defence_case:     'Cross-examine defence witnesses. Prepare final address.',
    final_address:    'Await judgment. If conviction — prepare sentencing submissions.',
    judgment:         'File sentencing submissions. Address aggravating factors.',
    sentencing:       'Calculate appeal deadline. Consider appeal against sentence if inadequate.',
    appeal:           'File Respondent\'s Brief within time. Resist appeal against conviction.',
  },
  defence: {
    investigation:    'Secure bail. Monitor investigation. Advise client on rights under ACJA.',
    charge_review:    'Attend arraignment. Take plea. Apply for bail. Flag charge defects.',
    arraignment:      'Advise client on plea options. Consider plea bargain. File preliminary objection if applicable.',
    plea:             'Track prosecution witnesses. Prepare cross-examination for first prosecution witness.',
    prosecution_case: 'Assess no-case threshold after each prosecution witness. Draft no-case submission.',
    no_case:          'Await ruling. If discharged — ensure client\'s release. If overruled — prepare defence case.',
    defence_case:     'Finalise defence witnesses. Prepare final address.',
    final_address:    'Await judgment. If conviction — prepare allocutus immediately.',
    judgment:         'Deliver allocutus. Address mitigation. Calculate appeal deadline from today.',
    sentencing:       'File Notice of Appeal within time. Apply for bail pending appeal.',
    appeal:           'File Appellant\'s Brief. Apply for bail pending appeal if custody continues.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE URGENCY FLAGS — certain stages carry inherent urgency text
// Shown as a sub-label in the Next Action strip when at that stage.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_URGENCY: Partial<Record<string, { level: 'HIGH' | 'MEDIUM'; note: string }>> = {
  service_received: { level: 'HIGH',   note: 'Appearance deadline running — do not delay.' },
  appearance:       { level: 'HIGH',   note: 'Default judgment risk if pleadings not filed in time.' },
  arraignment:      { level: 'HIGH',   note: 'ACJA remand clock starts from arraignment date.' },
  plea:             { level: 'MEDIUM', note: 'Track ACJA 90-day period from plea date.' },
  prosecution_case: { level: 'MEDIUM', note: 'Assess no-case threshold after each prosecution witness.' },
  no_case:          { level: 'HIGH',   note: 'No-case submission is a primary defence right — file without delay.' },
  judgment:         { level: 'HIGH',   note: 'Appeal and enforcement deadlines begin from judgment date.' },
  sentencing:       { level: 'HIGH',   note: 'Appeal deadline runs from sentence — file Notice of Appeal immediately.' },
};
