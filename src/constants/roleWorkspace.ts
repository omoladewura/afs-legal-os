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
    { label: 'File Pleading',     icon: '✍', tab: 'filings',      accent: '#4090d0', hint: 'SoC, Reply, or Motion' },
    { label: 'Create Motion',     icon: '⚖', tab: 'builder',      accent: '#4090d0', hint: 'Default, Summary, Injunction' },
    { label: 'Evidence',          icon: '📁', tab: 'evidence',     accent: '#4090d0', hint: 'Upload & organise proof' },
    { label: 'Intelligence',      icon: '⚡', tab: 'intelligence', accent: '#4090d0', hint: 'AI case analysis' },
    { label: 'Start Enforcement', icon: '→',  tab: 'compliance',   accent: '#4090d0', hint: 'Execute judgment' },
  ],
  defendant_side: [
    { label: 'File Defence',     icon: '🛡', tab: 'filings',      accent: '#c06060', hint: 'SoD, Objection, Counterclaim' },
    { label: 'File Objection',   icon: '✗',  tab: 'builder',      accent: '#c06060', hint: 'Preliminary objection, Strike out' },
    { label: 'Evidence',         icon: '📁', tab: 'evidence',     accent: '#c06060', hint: 'Upload & organise defence' },
    { label: 'Intelligence',     icon: '⚡', tab: 'intelligence', accent: '#c06060', hint: 'AI case analysis' },
    { label: 'Seek Stay',        icon: '⏸', tab: 'compliance',   accent: '#c06060', hint: 'Stay of proceedings or execution' },
  ],
  prosecution: [
    { label: 'Schedule Witness',   icon: '👤', tab: 'crossexam',    accent: '#c09030', hint: 'Witness schedule & prep' },
    { label: 'Tender Exhibit',     icon: '📎', tab: 'evidence',     accent: '#c09030', hint: 'Link exhibit to count' },
    { label: 'Intelligence',       icon: '⚡', tab: 'intelligence', accent: '#c09030', hint: 'Case strength analysis' },
    { label: 'Build Address',      icon: '✍', tab: 'builder',      accent: '#c09030', hint: 'Opening / Sentencing address' },
    { label: 'ACJA Compliance',    icon: '⚙', tab: 'compliance',   accent: '#c09030', hint: 'Check 90-day compliance' },
  ],
  defence: [
    { label: 'Bail Application', icon: '🔓', tab: 'criminal',     accent: '#40a860', hint: 'Draft or track bail' },
    { label: 'No-Case Sub.',     icon: '✗',  tab: 'builder',      accent: '#40a860', hint: 'Draft no-case submission' },
    { label: 'Cross-Examine',   icon: '⚔',  tab: 'crossexam',    accent: '#40a860', hint: 'Prep prosecution witnesses' },
    { label: 'Intelligence',    icon: '⚡', tab: 'intelligence', accent: '#40a860', hint: 'AI defence analysis' },
    { label: 'Prepare Allocutus', icon: '✍', tab: 'builder',    accent: '#40a860', hint: 'Mitigation submissions' },
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
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',   desc: 'Claim strength analysis and evidence gaps' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',       desc: 'Evidence proving each head of claim' },
    { id: 'filings',      icon: '📋', label: 'Filings',        desc: 'Pleadings, motions, and orders filed' },
    { id: 'builder',      icon: '✍',  label: 'Arg Builder',    desc: 'SoC, motions, claimant address' },
    { id: 'crossexam',    icon: '⚔',  label: 'Cross-Exam',     desc: 'Cross of defendant witnesses' },
    { id: 'compliance',   icon: '⚙',  label: 'Compliance',     desc: 'Procedural compliance audit' },
    { id: 'risk',         icon: '■',  label: 'Risk Analytics', desc: 'Limitation, default, enforcement risks' },
    { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',  desc: 'Appellant\'s or Respondent\'s brief' },
  ],
  defendant_side: [
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',   desc: 'Defence strength and available objections' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',       desc: 'Evidence answering each cause of action' },
    { id: 'filings',      icon: '📋', label: 'Filings',        desc: 'Appearance, SoD, objections filed' },
    { id: 'builder',      icon: '✍',  label: 'Arg Builder',    desc: 'SoD, objections, defendant address' },
    { id: 'crossexam',    icon: '⚔',  label: 'Cross-Exam',     desc: 'Cross of claimant witnesses' },
    { id: 'compliance',   icon: '⚙',  label: 'Compliance',     desc: 'Procedural compliance audit' },
    { id: 'risk',         icon: '■',  label: 'Risk Analytics', desc: 'Default exposure, appeal grounds' },
    { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',  desc: 'Appellant\'s or Respondent\'s brief' },
  ],
  prosecution: [
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',   desc: 'Count-by-count evidence analysis' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',       desc: 'Exhibits and witnesses by count' },
    { id: 'filings',      icon: '📋', label: 'Filings',        desc: 'Charge, proof of evidence, addresses' },
    { id: 'builder',      icon: '✍',  label: 'Arg Builder',    desc: 'Opening address, sentencing submissions' },
    { id: 'crossexam',    icon: '⚔',  label: 'Cross-Exam',     desc: 'Cross of defence witnesses' },
    { id: 'compliance',   icon: '⚙',  label: 'Compliance',     desc: 'ACJA compliance status' },
    { id: 'risk',         icon: '■',  label: 'Risk Analytics', desc: 'Weak counts, inadmissible evidence' },
    { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',  desc: 'Appeal against acquittal or sentence' },
  ],
  defence: [
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',   desc: 'Prosecution case weaknesses and gaps' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',       desc: 'Defence witnesses and exhibits' },
    { id: 'filings',      icon: '📋', label: 'Filings',        desc: 'Bail, objections, no-case submission' },
    { id: 'builder',      icon: '✍',  label: 'Arg Builder',    desc: 'No-case submission, defence address, allocutus' },
    { id: 'crossexam',    icon: '⚔',  label: 'Cross-Exam',     desc: 'Cross of prosecution witnesses' },
    { id: 'criminal',     icon: '⚖',  label: 'Criminal Engine', desc: 'Charge analysis, bail tracking, no-case' },
    { id: 'compliance',   icon: '⚙',  label: 'Compliance',     desc: 'ACJA rights and remand compliance' },
    { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',  desc: 'Appeal against conviction or sentence' },
  ],
};
