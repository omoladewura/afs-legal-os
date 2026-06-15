/**
 * AFS Advocates — Matrimonial Dashboard Tab Constants
 *
 * 16 top-level tabs for the MatrimonialDashboard.
 * Matrimonial cases NEVER use the civil CaseDashboard tab set.
 *
 * Tabs 3, 5, 6, 7 are engines promoted from MatrimonialEngine sub-tabs.
 * Tabs 9, 10, 15, 16 are shared engines wired directly.
 * Tabs 1, 2, 4, 8, 11, 12, 13, 14 are new matrimonial-specific engines
 * built in Phases 5 and 6 — rendered as clearly-labelled placeholders
 * until those phases land.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

export type MTabId =
  | 'overview'
  | 'intelligence'
  | 'petition_answer'
  | 'forms_documents'
  | 'custody'
  | 'maintenance'
  | 'property'
  | 'ancillary_applications'
  | 'crossexam'
  | 'evidence'
  | 'builder'
  | 'risk'
  | 'decree_enforcement'
  | 'appeal'
  | 'research'
  | 'copilot';

export interface MTab {
  id:          MTabId;
  icon:        string;
  label:       string;
  /** Which phase builds this engine. 'ready' = available now. */
  phase:       'ready' | 5 | 6;
  /** Short description shown in placeholder panels. */
  description: string;
}

export const MATRIMONIAL_TABS: MTab[] = [
  {
    id:          'overview',
    icon:        '⊕',
    label:       'Overview',
    phase:       'ready',
    description: 'Case overview — parties, marriage particulars, relief type, two-year bar status, procedural stage, and risk register summary.',
  },
  {
    id:          'intelligence',
    icon:        '◈',
    label:       'Intelligence',
    phase:       'ready',
    description: 'MIntelligence — 5-step MCA-specific extraction: marriage timeline, s.15(2) facts in play, two-year bar, children, financial picture, condonation risk, co-respondent, decree stage, gaps and risks.',
  },
  {
    id:          'petition_answer',
    icon:        '§',
    label:       'Petition / Answer',
    phase:       'ready',
    description: 'Petition Builder and Respondent Defence — promoted from MatrimonialEngine sub-tabs.',
  },
  {
    id:          'forms_documents',
    icon:        '📄',
    label:       'Forms & Documents',
    phase:       'ready',
    description: 'MFormsEngine — all 14 MCR statutory forms generated to filing standard: Form 3A, 6, 7, 8/8A, 11, 15, 15A, 17, 30, 31, 32, 33, 42/43, 60.',
  },
  {
    id:          'custody',
    icon:        '👶',
    label:       'Custody',
    phase:       'ready',
    description: 'Custody & Guardianship — welfare-of-child paramount principle, interim orders, contact arrangements.',
  },
  {
    id:          'maintenance',
    icon:        '⚖',
    label:       'Maintenance',
    phase:       'ready',
    description: 'Maintenance — pendente lite, periodical payments, lump sum, children maintenance.',
  },
  {
    id:          'property',
    icon:        '🏛',
    label:       'Property',
    phase:       'ready',
    description: 'Property Settlement — title-follows-ownership, contributions, settlement zone.',
  },
  {
    id:          'ancillary_applications',
    icon:        '⬛',
    label:       'Applications',
    phase:       'ready',
    description: 'Ancillary applications — maintenance pendente lite, interim custody, leave under s.30 MCA.',
  },
  {
    id:          'crossexam',
    icon:        '✦',
    label:       'Cross-Exam',
    phase:       'ready',
    description: 'CrossExamEngine — shared engine extended in Phase 3 with matrimonial-specific prompts for petitioner_side and respondent_side.',
  },
  {
    id:          'evidence',
    icon:        '🗂',
    label:       'Evidence',
    phase:       'ready',
    description: 'EvidenceVault — shared engine, as-is.',
  },
  {
    id:          'builder',
    icon:        '✍',
    label:       'Argument Builder',
    phase:       'ready',
    description: 'MArgumentBuilder — verifying affidavit, leave affidavit, written address, pre-populated from MIntelligence.',
  },
  {
    id:          'risk',
    icon:        '⚠',
    label:       'Risk',
    phase:       'ready',
    description: 'MRisk — 8-dimension risk register, pre-populated from MIntelligence extraction.',
  },
  {
    id:          'decree_enforcement',
    icon:        '⚡',
    label:       'Decree & Enforcement',
    phase:       'ready',
    description: 'DecreeEnforcementEngine — tracks decree nisi date, computes s.57 (28-day) or s.58 (3-month) absolute deadline, drafts application to make absolute, handles post-absolute enforcement (maintenance arrears, property transfer, contempt, custody non-compliance).',
  },
  {
    id:          'appeal',
    icon:        '▲',
    label:       'Appeal',
    phase:       'ready',
    description: 'MAppeal — hard block on appealing decree absolute (s.241(2) CFRN). As-of-right appeal against decree nisi (s.241(1)(f)(iv) CFRN). Court of Appeal matrimonial division procedure.',
  },
  {
    id:          'research',
    icon:        '◎',
    label:       'Research',
    phase:       'ready',
    description: 'CaseResearch — shared engine, as-is.',
  },
  {
    id:          'copilot',
    icon:        '✦',
    label:       'AI Copilot',
    phase:       'ready',
    description: 'AICopilot — shared engine, role-aware via existing role prompt system.',
  },
];
