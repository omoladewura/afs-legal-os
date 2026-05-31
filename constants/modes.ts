/**
 * AFS Advocates — Litigation Modes
 * All litigation mode definitions. Each mode corresponds to a document
 * type or workflow. The ArgumentBuilder routes to these modes.
 *
 * Fields:
 *   id      — unique key used for routing and storage
 *   icon    — single character or emoji displayed on the mode card
 *   label   — display name
 *   sub     — subtitle / role context
 *   desc    — short description of documents produced
 *   accent  — colour used for the mode card border/icon
 *   group   — mode group id (see MODE_GROUPS)
 *   type    — optional "tool" for smart tool modes vs document modes
 */

export interface Mode {
  id:     string;
  icon:   string;
  label:  string;
  sub:    string;
  desc:   string;
  accent: string;
  group:  string;
  type?:  'tool';
}

export const MODES: Mode[] = [
  // ── Pleadings & Originating Process ────────────────────────────────────────
  { id: 'pretrial',           icon: '§',  label: 'Pre-Trial Filing',              sub: 'You Are Filing Suit',           desc: 'Writ · Statement of Claim · Witness Proofs · Pre-Action Checklist · Litigation Timeline',             accent: '#4a7ed0', group: 'pleadings' },
  { id: 'defence',            icon: '🛡', label: 'Statement of Defence',          sub: 'You Are the Defendant',         desc: 'Statement of Defence · Specific Denials · Preliminary Objections · Defence Checklist',               accent: '#c06040', group: 'pleadings' },
  { id: 'reply_sod',          icon: '↩',  label: 'Reply to Statement of Defence', sub: 'Claimant Replies',              desc: 'Reply · Joinder of Issue · Defence to Counterclaim',                                                accent: '#4a7ed0', group: 'pleadings' },
  { id: 'counterclaim',       icon: '⚔',  label: 'Counterclaim',                  sub: 'Defendant Strikes Back',        desc: 'Statement of Counterclaim · Relief on Counterclaim · Defence to Counterclaim',                       accent: '#c04080', group: 'pleadings' },
  { id: 'third_party',        icon: '→',  label: 'Third-Party Notice',            sub: 'Bringing in a Third Party',     desc: 'Third-Party Notice · Statement of Claim against Third Party · Contribution / Indemnity',              accent: '#40a868', group: 'pleadings' },
  // ── Interlocutory ──────────────────────────────────────────────────────────
  { id: 'interlocutory_file',    icon: '⚡', label: 'File Interlocutory',        sub: 'You Are the Applicant',         desc: 'Motion Paper · Supporting Affidavit · Written Address · Counter-Strike · Weakness Radar',             accent: '#c4a030', group: 'interlocutory' },
  { id: 'interlocutory_respond', icon: '🛡', label: 'Respond to Interlocutory',  sub: 'You Are the Respondent',        desc: 'Counter-Affidavit · Written Address in Opposition · Reply on Points of Law',                         accent: '#c06040', group: 'interlocutory' },
  // ── Trial ──────────────────────────────────────────────────────────────────
  { id: 'trial',              icon: '⚖',  label: 'Trial & Final Address',         sub: 'Inside the Courtroom',          desc: 'Witness Statements · EIC · Cross-Examination · Re-Examination · Objection Bank · Final Address',      accent: '#40a868', group: 'trial' },
  { id: 'no_case',            icon: '✗',  label: 'No-Case Submission',            sub: "At Close of Claimant's Case",   desc: 'The most surgical document in litigation — Submission · Rebuttal · Ruling Analysis',                  accent: '#8050d0', group: 'trial' },
  { id: 'amendment',          icon: '✎',  label: 'Amendment of Pleadings',        sub: 'During Trial',                  desc: 'Application to Amend · Amended Pleading · Opposition to Amendment',                                  accent: '#40a868', group: 'trial' },
  // ── Appeal ─────────────────────────────────────────────────────────────────
  { id: 'appeal_appellant',   icon: '↑',  label: 'Appeal — Appellant',            sub: 'You Are Appealing',             desc: "Judgment Dissector · Grounds · Issues · Appellant's Brief · Reply Brief",                            accent: '#8050d0', group: 'appeal' },
  { id: 'appeal_respondent',  icon: '↓',  label: 'Appeal — Respondent',           sub: 'They Are Appealing',            desc: "Preliminary Objection · Respondent's Issues · Respondent's Brief · Cross-Appeal",                    accent: '#c04080', group: 'appeal' },
  // ── Specialised ────────────────────────────────────────────────────────────
  { id: 'bail',               icon: '⚖',  label: 'Bail Application',              sub: 'Criminal Proceedings',          desc: "Bail Application · Affidavit in Support · Written Address · Prosecution's Opposition",                accent: '#c04080', group: 'specialised' },
  { id: 'garnishee',          icon: '💰', label: 'Garnishee Proceedings',         sub: 'Post-Judgment Recovery',        desc: "Order Nisi Application · Order Absolute · Garnishee's Opposition",                                  accent: '#4a7ed0', group: 'specialised' },
  { id: 'enforcement',        icon: '⚡', label: 'Writ of Fifa / Enforcement',    sub: 'Enforcing Your Judgment',       desc: 'Writ of Fieri Facias · Enforcement Application · Judgment Debtor Summons',                            accent: '#c4a030', group: 'specialised' },
  { id: 'contempt',           icon: '⚠',  label: 'Contempt Proceedings',          sub: 'Breach of Court Order',         desc: 'Motion to Commit · Affidavit of Disobedience · Written Address · Contemnor\'s Response',              accent: '#c06040', group: 'specialised' },
  { id: 'election_petition',  icon: '🗳', label: 'Election Petition',             sub: 'Electoral Disputes',            desc: 'Petition · Written Address · Respondent\'s Reply · Pre-Hearing Report · Witness Proofs',              accent: '#8050d0', group: 'specialised' },
  { id: 'winding_up',         icon: '⊗',  label: 'Winding-Up Petition',           sub: 'Company Insolvency',            desc: 'Petition · Supporting Affidavit · Written Address · Opposition to Petition',                         accent: '#c04080', group: 'specialised' },
  { id: 'fundamental_rights', icon: '§',  label: 'Fundamental Rights Enforcement',sub: 'Chapter IV CFRN',               desc: 'Originating Motion · Affidavit · Written Address · Respondent\'s Response',                           accent: '#40a868', group: 'specialised' },
  { id: 'arbitration',        icon: '⚖',  label: 'Arbitration Statement of Case', sub: 'Arbitral Proceedings',          desc: 'Statement of Case · Defence & Counterclaim · Reply · Hearing Bundle · Award Enforcement',             accent: '#4a7ed0', group: 'specialised' },
  // ── Settlement ─────────────────────────────────────────────────────────────
  { id: 'consent_judgment',   icon: '✓',  label: 'Consent Judgment',              sub: 'By Agreement',                  desc: 'Terms of Settlement · Consent Judgment Draft · Enforcement Clause',                                  accent: '#40a868', group: 'settlement' },
  { id: 'deed_settlement',    icon: '§',  label: 'Deed of Settlement',            sub: 'Formal Settlement Agreement',   desc: 'Recitals · Full Terms · Execution Block · Confidentiality Clause',                                   accent: '#4a7ed0', group: 'settlement' },
  { id: 'discontinuance',     icon: '✕',  label: 'Notice of Discontinuance',      sub: 'Ending the Proceedings',        desc: 'Notice of Discontinuance · Costs Terms · Consent Order',                                            accent: '#5a5a78', group: 'settlement' },
  // ── Practice Documents ─────────────────────────────────────────────────────
  { id: 'retainer',           icon: '📋', label: 'Client Retainer',               sub: 'Engagement Letter',             desc: 'Retainer Letter · Fee Agreement · Scope of Instructions · Client Authority',                         accent: '#4a7ed0', group: 'practice' },
  { id: 'legal_opinion',      icon: '⚖',  label: 'Legal Opinion',                 sub: 'Formal Client Advice',          desc: 'Executive Summary · Full Legal Opinion · Risk Register — in plain language the client can act on',   accent: '#c4a030', group: 'practice' },
  { id: 'strategy_memo',      icon: '◈',  label: 'Case Strategy Memo',            sub: "Counsel's Internal Brief",      desc: 'Strategic Overview · Options Analysis · Tactical Sequence · Risk-Benefit',                           accent: '#40a868', group: 'practice' },
  { id: 'risk_assessment',    icon: '⚠',  label: 'Risk Assessment Memo',          sub: 'Honest Probability Analysis',   desc: 'Case Strength · Key Vulnerabilities · Probability Assessment · Recommendation',                      accent: '#c06040', group: 'practice' },
  { id: 'demand_letter',      icon: '✉',  label: 'Demand / Pre-Action Letter',    sub: 'Before You File',               desc: 'Formal Demand · Legal Basis · Deadline for Response · Consequences of Non-Compliance',               accent: '#c4a030', group: 'practice' },
  { id: 'progress_report',    icon: '📊', label: 'Progress Report to Client',     sub: 'Client Update',                 desc: 'Case Status · Recent Developments · Next Steps · What Client Must Do Now',                          accent: '#40a868', group: 'practice' },
  // ── Smart Tools ────────────────────────────────────────────────────────────
  { id: 'case_strength',       icon: '◉', label: 'Case Strength Meter',          sub: 'Before You File Anything',      desc: 'Paste the facts — honest probability with every vulnerability that could lose the case.',             accent: '#c4a030', type: 'tool', group: 'tools' },
  { id: 'deadline_calc',       icon: '⏱', label: 'Court Deadline Calculator',    sub: 'Never Miss a Date',             desc: 'Cause of action + trigger date → every limitation and procedural deadline under Nigerian rules.',     accent: '#4a7ed0', type: 'tool', group: 'tools' },
  { id: 'settlement_analyser', icon: '⚖', label: 'Settlement vs Litigation',     sub: 'Cost-Benefit Analysis',         desc: 'Litigation outcome vs realistic settlement range — what should your client actually do?',             accent: '#40a868', type: 'tool', group: 'tools' },
  { id: 'judge_brief',         icon: '◈', label: 'Judge-Mode Brief',             sub: 'Court-Specific Rewrite',        desc: "Same argument, rewritten knowing this specific court's tendencies and what moves this judge.",         accent: '#8050d0', type: 'tool', group: 'tools' },
  { id: 'case_research',       icon: '🔍', label: 'Case Law Research',            sub: 'Nigerian Legal Authorities',    desc: 'Search Nigerian case law by topic, principle, or statute — citations, holdings, platform links.',    accent: '#c4a030', type: 'tool', group: 'tools' },
  { id: 'research_resolver',   icon: '◎', label: 'Research Resolver',            sub: 'Cite What You Found',           desc: 'Paste a [RESEARCH] block, the paragraph it belongs to, and the cases you found — get the paragraph rewritten with real Nigerian citations.', accent: '#c4a030', type: 'tool', group: 'tools' },
];

export interface ModeGroup {
  id:    string;
  label: string;
  color: string;
}

export const MODE_GROUPS: ModeGroup[] = [
  { id: 'pleadings',     label: 'Pleadings & Originating Process', color: '#4a7ed0' },
  { id: 'interlocutory', label: 'Interlocutory Applications',       color: '#c4a030' },
  { id: 'trial',         label: 'Trial',                            color: '#40a868' },
  { id: 'appeal',        label: 'Appeal',                           color: '#8050d0' },
  { id: 'specialised',   label: 'Specialised Proceedings',          color: '#c06040' },
  { id: 'settlement',    label: 'Settlement & Conclusion',          color: '#5a9a70' },
  { id: 'practice',      label: 'Practice Documents',               color: '#4a7ed0' },
  { id: 'tools',         label: 'Smart Tools',                      color: '#c4a030' },
];
