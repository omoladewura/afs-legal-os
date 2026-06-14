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
    'applications',
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
    'synthesis',
  ],
  defendant_side: [
    'overview',
    'alerts',
    'copilot',
    'pleadings',
    'motions',
    'applications',
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
    'synthesis',
  ],
  prosecution: [
    'overview',
    'alerts',
    'copilot',
    'charge_arraignment',
    'plea',
    'prosecution_case',
    'no_case',
    'applications',
    'defence_case',
    'final_address',
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
    'synthesis',
  ],
  defence: [
    'overview',
    'alerts',
    'copilot',
    'charge_arraignment',
    'plea',
    'prosecution_case',
    'no_case',
    'applications',
    'defence_case',
    'final_address',
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
    'synthesis',
  ],
  petitioner_side: [
    'overview',
    'intelligence',
    'petition_answer',
    'forms_documents',
    'custody',
    'maintenance',
    'property',
    'ancillary_applications',
    'crossexam',
    'evidence',
    'builder',
    'risk',
    'decree_enforcement',
    'appeal',
    'research',
    'copilot',
  ],
  respondent_side: [
    'overview',
    'intelligence',
    'petition_answer',
    'forms_documents',
    'custody',
    'maintenance',
    'property',
    'ancillary_applications',
    'crossexam',
    'evidence',
    'builder',
    'risk',
    'decree_enforcement',
    'appeal',
    'research',
    'copilot',
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
  petitioner_side: [
    { label: 'Draft Petition',       icon: '✍', tab: 'petition_answer',        accent: '#7060c0', hint: 'Petition Form 6 — dissolution, nullity, or judicial separation' },
    { label: 'File Forms',           icon: '📋', tab: 'forms_documents',        accent: '#7060c0', hint: 'Form 3A, Form 6, verifying affidavit, ancillary forms' },
    { label: 'Intelligence',         icon: '⚡', tab: 'intelligence',           accent: '#7060c0', hint: 'MCA case analysis — facts, bar, grounds' },
    { label: 'Ancillary Relief',     icon: '⚖', tab: 'ancillary_applications', accent: '#7060c0', hint: 'Maintenance pendente lite, custody, property, injunctions' },
    { label: 'Decree Tracker',       icon: '📅', tab: 'decree_enforcement',     accent: '#7060c0', hint: 'Nisi → Absolute timeline and enforcement' },
  ],
  respondent_side: [
    { label: 'File Answer',          icon: '🛡', tab: 'petition_answer',        accent: '#c07030', hint: 'Answer to Petition Form 15 — oppose dissolution or cross-petition' },
    { label: 'File Forms',           icon: '📋', tab: 'forms_documents',        accent: '#c07030', hint: 'Acknowledgement Form 11, Answer Form 15, Cross-Petition Form 15A' },
    { label: 'Intelligence',         icon: '⚡', tab: 'intelligence',           accent: '#c07030', hint: 'MCA defence analysis — bars, condonation, cross-petition' },
    { label: 'Ancillary Relief',     icon: '⚖', tab: 'ancillary_applications', accent: '#c07030', hint: 'Maintenance, custody, property — respondent applications' },
    { label: 'Decree Tracker',       icon: '📅', tab: 'decree_enforcement',     accent: '#c07030', hint: 'Monitor nisi and absolute timeline' },
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
  petitioner_side: [
    { id: 'pre_filing',       label: 'Pre-Filing',             icon: '◦', desc: 'Client intake. Confirm grounds and facts under s.15(2) MCA. Check two-year bar under s.30 MCA. Obtain Form 3A reconciliation certificate (O.2 r.2 MCR).' },
    { id: 'leave_application', label: 'Leave Application',     icon: '◦', desc: 'If marriage is less than 2 years old — apply ex-parte for leave under s.30 MCA, O.4 rr.1–2 MCR. Swear supporting affidavit. Obtain leave order before filing.' },
    { id: 'petition_filed',   label: 'Petition Filed',         icon: '◦', desc: 'Draft and file Petition Form 6 (O.5 MCR) with verifying affidavit (O.5 r.10 MCR). Attach Form 3A. Specify relief type and s.15(2) dissolution fact(s) or nullity ground.' },
    { id: 'service',          label: 'Service',                icon: '◦', desc: 'Serve Respondent with petition and Notice of Petition Form 8/8A. Serve co-respondent if adultery fact pleaded (s.32 MCA, O.9 rr.2–3 MCR). File proof of service.' },
    { id: 'awaiting_answer',  label: 'Awaiting Answer',        icon: '◦', desc: 'Monitor Respondent's Acknowledgement of Service Form 11 (O.6 r.3 MCR). Check whether Answer Form 15 is filed within time. Consider undefended set-down if no answer.' },
    { id: 'reply_rejoinder',  label: 'Reply / Rejoinder',      icon: '◦', desc: 'File Reply to Answer Form 17 (O.7 r.4(5) MCR) if required. Address any cross-petition. File Discretion Statement Form 30 in sealed envelope if discretion is required (O.11 rr.28–29 MCR).' },
    { id: 'comp_conference',  label: 'Compulsory Conference',  icon: '◦', desc: 'Attend compulsory conference under O.11 MCR. ADR available for ancillary reliefs only — not for dissolution or nullity. Obtain financial disclosure at conference.' },
    { id: 'set_down',         label: 'Set Down',               icon: '◦', desc: 'File Request to Set Down Form 31 (undefended) or Form 32 (defended) under O.11 r.39 MCR. Confirm all pleadings closed. Obtain hearing date.' },
    { id: 'hearing',          label: 'Hearing',                icon: '◦', desc: 'Present petition. Call and examine petitioner and supporting witnesses. Tender exhibits. Address s.15(2) dissolution fact or nullity ground. Apply for ancillary reliefs.' },
    { id: 'reconciliation',   label: 'Reconciliation Window',  icon: '◦', desc: 'Court may attempt reconciliation under s.10 MCA. Attendance required. Note: reconciliation is mandatory procedure, not a bar to dissolution if grounds persist.' },
    { id: 'decree_nisi',      label: 'Decree Nisi',            icon: '◦', desc: 'Decree nisi granted on proof of dissolution fact. Record date. Advise on s.57/s.58 MCA pathway to absolute. Note appeal window against nisi — s.241(1)(f)(iv) CFRN.' },
    { id: 'decree_absolute',  label: 'Decree Absolute',        icon: '◦', desc: 'Apply to make decree absolute under s.57 MCA (28 days if children order made) or s.58 MCA (3 months if no children order). File application. Serve Respondent. Attend perfection.' },
    { id: 'post_decree',      label: 'Post-Decree',            icon: '◦', desc: 'Enforce ancillary relief orders — maintenance by attachment or Magistrate Court (s.2(1)(b) MCA), property transfer compliance, custody enforcement, contempt for non-compliance.' },
    { id: 'appeal',           label: 'Appeal',                 icon: '◦', desc: 'Appeal against decree nisi as of right under s.241(1)(f)(iv) CFRN. No appeal against decree absolute — s.241(2) CFRN is an absolute bar. Court of Appeal matrimonial division procedure applies.' },
  ],
  respondent_side: [
    { id: 'petition_received', label: 'Petition Received',     icon: '◦', desc: 'Receive Petition Form 6 and Notice Form 8/8A. Assess service regularity. File Acknowledgement of Service Form 11 (O.6 r.3 MCR). Advise on grounds for Answer and any cross-petition.' },
    { id: 'answer_filed',      label: 'Answer Filed',          icon: '◦', desc: 'Draft and file Answer to Petition Form 15 (O.5 r.29 MCR). Oppose dissolution fact alleged. Raise any available bars — condonation (ss.26–27 MCA), connivance (s.28 MCA), unreasonable delay. Consider cross-petition Form 15A.' },
    { id: 'reply_rejoinder',   label: 'Reply / Rejoinder',     icon: '◦', desc: 'Respond to Petitioner's Reply Form 17. File Rejoinder if required. Ensure cross-petition pleadings are complete. Check Discretion Statement filing if applicable.' },
    { id: 'comp_conference',   label: 'Compulsory Conference', icon: '◦', desc: 'Attend compulsory conference under O.11 MCR. Obtain full financial disclosure. ADR available only for ancillary reliefs. Agree welfare arrangements for children where possible.' },
    { id: 'ancillary_response', label: 'Ancillary Response',   icon: '◦', desc: 'File Respondent's position on maintenance (s.70 MCA), property (O.11 MCR), custody (s.71 MCA), and any injunctions. Challenge pendente lite applications if excessive.' },
    { id: 'hearing',           label: 'Hearing',               icon: '◦', desc: 'Challenge Petitioner's evidence of dissolution fact. Cross-examine Petitioner and supporting witnesses. Call own witnesses on facts and ancillary reliefs. Present cross-petition if filed.' },
    { id: 'decree_nisi',       label: 'Decree Nisi',           icon: '◦', desc: 'If decree nisi granted — assess grounds of appeal under s.241(1)(f)(iv) CFRN. File Notice of Appeal within time if instructed. Note effect of pending appeal on nisi becoming absolute.' },
    { id: 'decree_absolute',   label: 'Decree Absolute',       icon: '◦', desc: 'Monitor Petitioner's application for absolute. Raise any objection — pending appeal, non-compliance with children order. Note: Respondent may also apply for absolute — s.58 MCA.' },
    { id: 'compliance',        label: 'Compliance',            icon: '◦', desc: 'Comply with ancillary relief orders — maintenance payments, property transfer, custody arrangements. Monitor enforcement risk. Apply for variation under s.45 or s.70 MCA if circumstances change.' },
    { id: 'appeal',            label: 'Appeal',                icon: '◦', desc: 'Appeal against decree nisi as of right under s.241(1)(f)(iv) CFRN. No appeal against decree absolute — s.241(2) CFRN is an absolute bar. Pursue Court of Appeal matrimonial division procedure.' },
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
  petitioner_side: {
    positionLabel:   "Petitioner's Position",
    positionDesc:    'Advancing the petition — proving dissolution fact, obtaining decree, and securing ancillary reliefs under the MCA.',
    nextActionLabel: 'Next Petitioner Action',
    riskLabel:       'Petitioner Risk Flags',
    accentColor:     '#7060c0',
    icon:            '⚖',
  },
  respondent_side: {
    positionLabel:   "Respondent's Position",
    positionDesc:    'Resisting or managing the petition — filing Answer, raising bars, cross-petitioning, and protecting ancillary interests under the MCA.',
    nextActionLabel: 'Next Respondent Action',
    riskLabel:       'Respondent Risk Flags',
    accentColor:     '#c07030',
    icon:            '🛡',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT NEXT ACTIONS — shown when no explicit stage is set
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_DEFAULT_NEXT_ACTION: Record<CounselRole, string> = {
  claimant_side:   'Draft and file originating process to commence the action.',
  defendant_side:  'Enter appearance within time and assess the originating process.',
  prosecution:     'Review investigation file and advise on charge readiness.',
  defence:         'Review charge for defects and apply for bail if in custody.',
  petitioner_side: 'Obtain Form 3A reconciliation certificate, confirm s.15(2) dissolution fact, check two-year bar under s.30 MCA, then draft and file Petition Form 6.',
  respondent_side: 'File Acknowledgement of Service Form 11 within time, assess petition for defects and available bars, then advise on Answer and cross-petition.',
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
  petitioner_side: [
    { label: 'Two-year bar (s.30 MCA) — confirm marriage is at least 2 years old or leave obtained before filing.',  severity: 'HIGH' },
    { label: 'Form 3A reconciliation certificate must accompany every petition (O.2 r.2 MCR) — do not file without it.', severity: 'HIGH' },
    { label: 'Adultery fact selected — co-respondent must be joined (s.32 MCA, O.9 rr.2–3 MCR) before hearing.',    severity: 'HIGH' },
    { label: 'Condonation risk — any post-knowledge cohabitation may bar the petition under ss.26–27 MCA.',          severity: 'HIGH' },
    { label: 'Decree nisi to absolute deadline — track s.57 (28 days) or s.58 (3 months) path and do not miss it.', severity: 'MEDIUM' },
    { label: 'Jurisdiction: petition must be filed in State High Court, not Federal High Court.',                      severity: 'MEDIUM' },
    { label: 'Verify correct s.15(2) letter assignment — there are 8 facts, (a) through (h), not 6.',               severity: 'MEDIUM' },
    { label: 'No appeal lies against decree absolute — s.241(2) CFRN. All appeal grounds must be raised against nisi.', severity: 'LOW' },
  ],
  respondent_side: [
    { label: 'Acknowledgement of Service Form 11 deadline — file within time or risk undefended hearing.',           severity: 'HIGH' },
    { label: 'Answer filing deadline — failure to file Form 15 in time may result in undefended set-down.',          severity: 'HIGH' },
    { label: 'Condonation defence — assess carefully whether ss.26–27 MCA bars apply before pleading.',             severity: 'MEDIUM' },
    { label: 'Connivance defence — assess s.28 MCA; note petitioner's own conduct.',                                 severity: 'MEDIUM' },
    { label: 'Cross-petition opportunity — assess whether Respondent has independent grounds under s.15(2) MCA.',   severity: 'MEDIUM' },
    { label: 'Nullity bars (ss.35–37 MCA) — check whether Respondent's own disability bars a voidable nullity petition.', severity: 'MEDIUM' },
    { label: 'Appeal against nisi must be filed within time — no appeal lies against decree absolute (s.241(2) CFRN).', severity: 'LOW' },
    { label: 'Monitor Petitioner's application for absolute — Respondent may object if appeal pending or children order unresolved.', severity: 'LOW' },
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
  petitioner_side: [
    { id: 'intelligence',          icon: '⚡', label: 'MCA Intelligence',    desc: 'Marriage facts, s.15(2) analysis, two-year bar, condonation risk' },
    { id: 'petition_answer',       icon: '📜', label: 'Petition Engine',     desc: 'Draft Petition Form 6, verifying affidavit, nullity petition' },
    { id: 'forms_documents',       icon: '📋', label: 'Forms Engine',        desc: 'All 14 MCR statutory forms generated to filing standard' },
    { id: 'custody',               icon: '👧', label: 'Custody Engine',      desc: 'Children welfare, custody application, s.71 MCA orders' },
    { id: 'maintenance',           icon: '💰', label: 'Maintenance Engine',  desc: 'Pendente lite (s.70 MCA), permanent maintenance, variation' },
    { id: 'property',              icon: '🏠', label: 'Property Engine',     desc: 'Matrimonial property, financial disclosure, transfer orders' },
    { id: 'crossexam',             icon: '⚔',  label: 'Cross-Exam',          desc: 'Cross of Respondent to establish s.15(2) dissolution fact' },
    { id: 'decree_enforcement',    icon: '📅', label: 'Decree Tracker',      desc: 'Nisi → Absolute pathway, s.57/s.58 deadlines, enforcement' },
    { id: 'appeal',                icon: '↑',  label: 'Appeal Engine',       desc: 'Appeal against nisi — s.241(1)(f)(iv) CFRN; hard bar on absolute' },
  ],
  respondent_side: [
    { id: 'intelligence',          icon: '⚡', label: 'MCA Intelligence',    desc: 'Petition analysis, bar assessment, condonation and connivance' },
    { id: 'petition_answer',       icon: '🛡', label: 'Answer Engine',       desc: 'Answer Form 15, Cross-Petition Form 15A, Acknowledgement Form 11' },
    { id: 'forms_documents',       icon: '📋', label: 'Forms Engine',        desc: 'All 14 MCR statutory forms generated to filing standard' },
    { id: 'custody',               icon: '👧', label: 'Custody Engine',      desc: 'Children welfare, custody response, s.71 MCA orders' },
    { id: 'maintenance',           icon: '💰', label: 'Maintenance Engine',  desc: 'Respondent maintenance claims, s.70 MCA, variation' },
    { id: 'property',              icon: '🏠', label: 'Property Engine',     desc: 'Matrimonial property response, disclosure, Respondent's share' },
    { id: 'crossexam',             icon: '⚔',  label: 'Cross-Exam',          desc: 'Cross of Petitioner to challenge dissolution fact and corroboration' },
    { id: 'decree_enforcement',    icon: '📅', label: 'Decree Tracker',      desc: 'Monitor nisi, absolute pathway, compliance obligations' },
    { id: 'appeal',                icon: '↑',  label: 'Appeal Engine',       desc: 'Appeal against nisi — s.241(1)(f)(iv) CFRN; hard bar on absolute' },
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

  // Matrimonial stage IDs
  pre_filing:          ['client intake', 'reconciliation certificate', 'form 3a', 'two-year bar', 'two year bar', 's.30', 'leave to present'],
  leave_application:   ['leave application', 'ex-parte', 'ex parte', 'leave granted', 'leave to petition', 'o.4', 'motion ex-parte'],
  petition_filed:      ['petition filed', 'form 6', 'petition for dissolution', 'filed petition', 'verifying affidavit', 'petition presented'],
  awaiting_answer:     ['acknowledgement of service', 'form 11', 'awaiting answer', 'answer period', 'undefended', 'no answer filed'],
  reply_rejoinder:     ['reply to answer', 'form 17', 'rejoinder', 'cross-petition', 'form 15a', 'discretion statement', 'form 30'],
  comp_conference:     ['compulsory conference', 'conciliation conference', 'o.11 conference', 'financial disclosure', 'conference order'],
  set_down:            ['set down', 'form 31', 'form 32', 'request to set down', 'hearing date fixed', 'fixed for hearing'],
  reconciliation:      ['reconciliation', 's.10 mca', 'reconciliation attempt', 'reconciliation session'],
  decree_nisi:         ['decree nisi', 'nisi granted', 'nisi pronounced', 'conditional decree'],
  decree_absolute:     ['decree absolute', 'absolute granted', 'absolute pronounced', 'marriage dissolved', 'application for absolute'],
  post_decree:         ['post-decree', 'maintenance arrears', 'enforcement of order', 'property transfer compliance', 'contempt', 'post decree'],
  petition_received:   ['petition received', 'served with petition', 'process received matrimonial', 'form 8', 'notice of petition'],
  answer_filed:        ['answer filed', 'form 15', 'answer to petition', 'respondent answer', 'cross-petition filed'],
  ancillary_response:  ['ancillary response', 'respondent ancillary', 'maintenance response', 'custody response', 'property response'],
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
  petitioner_side: {
    pre_filing:        'Obtain Form 3A reconciliation certificate. Confirm s.15(2) dissolution fact. Check two-year bar under s.30 MCA.',
    leave_application: 'After leave granted — draft and file Petition Form 6 with verifying affidavit and Form 3A attachment.',
    petition_filed:    'Effect service on Respondent with petition and Notice Form 8/8A. Serve co-respondent if adultery fact pleaded.',
    service:           'Monitor Acknowledgement of Service Form 11. Check whether Answer Form 15 is filed. Consider undefended set-down if no answer.',
    awaiting_answer:   'If no answer filed — file Request to Set Down Form 31 for undefended hearing. If answer filed — prepare Reply Form 17.',
    reply_rejoinder:   'File Discretion Statement Form 30 if required. Attend compulsory conference under O.11 MCR.',
    comp_conference:   'Obtain full financial disclosure. File Request to Set Down Form 32 for defended hearing.',
    set_down:          'Prepare for hearing. Finalise witnesses, exhibits, and opening address. Confirm Form 3A on record.',
    hearing:           'Await decree nisi. Record date immediately. Calculate absolute deadline — s.57 (28 days) or s.58 (3 months).',
    reconciliation:    'Continue with petition after reconciliation attempt. Confirm grounds subsist.',
    decree_nisi:       'Calculate decree absolute deadline. Apply to make absolute under s.57 or s.58 MCA. Serve Respondent.',
    decree_absolute:   'Enforce ancillary relief orders. Commence maintenance enforcement if arrears arise. Proceed to post-decree compliance.',
    post_decree:       'Monitor compliance. Apply for attachment of earnings or Magistrate Court enforcement for maintenance arrears. File contempt if non-compliance persists.',
    appeal:            'File Appellant\'s Brief within time. Note: no appeal lies against decree absolute under s.241(2) CFRN.',
  },
  respondent_side: {
    petition_received:  'File Acknowledgement of Service Form 11 within time. Assess petition for defects. Advise on Answer and available bars.',
    answer_filed:       'Prepare for compulsory conference. Assemble financial disclosure. Pursue cross-petition pleadings if filed.',
    reply_rejoinder:    'Attend compulsory conference under O.11 MCR. Finalise ancillary position. Obtain financial disclosure.',
    comp_conference:    'File ancillary response. Prepare for hearing. Finalise witness list for defended hearing.',
    ancillary_response: 'Prepare for hearing. Cross-examine Petitioner witnesses. Present Answer and cross-petition evidence.',
    hearing:            'Await decree nisi. Assess grounds of appeal. File Notice of Appeal within time if instructed.',
    decree_nisi:        'If not appealing — monitor Petitioner\'s application for absolute. Identify any objection. Consider Respondent\'s own absolute application under s.58 MCA.',
    decree_absolute:    'Comply with ancillary relief orders. Monitor maintenance obligations. Apply for variation under s.45 or s.70 MCA if circumstances change.',
    compliance:         'Continue compliance. Flag any enforcement risk. Apply for variation promptly if financial circumstances change.',
    appeal:             'File Appellant\'s Brief within time. Note: no appeal lies against decree absolute under s.241(2) CFRN.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE URGENCY FLAGS — certain stages carry inherent urgency text
// Shown as a sub-label in the Next Action strip when at that stage.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_URGENCY: Partial<Record<string, { level: 'HIGH' | 'MEDIUM'; note: string }>> = {
  // Civil / criminal urgency flags
  service_received: { level: 'HIGH',   note: 'Appearance deadline running — do not delay.' },
  appearance:       { level: 'HIGH',   note: 'Default judgment risk if pleadings not filed in time.' },
  arraignment:      { level: 'HIGH',   note: 'ACJA remand clock starts from arraignment date.' },
  plea:             { level: 'MEDIUM', note: 'Track ACJA 90-day period from plea date.' },
  prosecution_case: { level: 'MEDIUM', note: 'Assess no-case threshold after each prosecution witness.' },
  no_case:          { level: 'HIGH',   note: 'No-case submission is a primary defence right — file without delay.' },
  judgment:         { level: 'HIGH',   note: 'Appeal and enforcement deadlines begin from judgment date.' },
  sentencing:       { level: 'HIGH',   note: 'Appeal deadline runs from sentence — file Notice of Appeal immediately.' },
  // Matrimonial urgency flags
  leave_application: { level: 'HIGH',   note: 'Two-year bar applies — do not file petition until leave is obtained.' },
  petition_filed:    { level: 'HIGH',   note: 'Service must be effected promptly. Co-respondent must be joined if adultery pleaded.' },
  awaiting_answer:   { level: 'MEDIUM', note: 'Monitor Acknowledgement of Service Form 11 — undefended set-down available if no answer filed.' },
  decree_nisi:       { level: 'HIGH',   note: 'Calculate absolute deadline now — s.57 (28 days) or s.58 (3 months). Do not let it lapse.' },
  petition_received: { level: 'HIGH',   note: 'Acknowledgement of Service Form 11 deadline running — file within time.' },
  answer_filed:      { level: 'HIGH',   note: 'Answer filing deadline — failure risks undefended hearing proceeding against Respondent.' },
};
