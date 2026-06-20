/**
 * AFS Advocates — Matrimonial Dashboard Tab Constants
 *
 * Phase 7 (Engine consolidation): 16 → 11 tabs.
 * Matrimonial cases NEVER use the civil CaseDashboard tab set.
 *
 * Removed tab IDs: custody, maintenance, property (now inside MatrimonialEngine),
 *                  risk (absorbed into CaseCommand), research (absorbed into
 *                  WrittenAddressEngine), builder (absorbed into WrittenAddressEngine).
 * Added tab IDs:   case_command, strategy_hub, written_address, inheritance.
 *
 * New tab order matches Master Plan Phase 5 matrimonial tab set:
 *   Case Command → Intelligence → Inheritance → Petition & Answer
 *   → Matrimonial Engine → Applications → Forms & Documents
 *   → Evidence Vault → Case Intelligence → Decree & Enforcement → Appeal → Copilot
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

export type MTabId =
  | 'case_command'
  | 'intelligence'
  | 'inheritance'
  | 'petition_answer'
  | 'matrimonial'
  | 'ancillary_applications'
  | 'forms_documents'
  | 'evidence'
  | 'strategy_hub'
  | 'decree_enforcement'
  | 'appeal'
  | 'copilot';

export interface MTab {
  id:          MTabId;
  icon:        string;
  label:       string;
  /** Which phase builds this engine. 'ready' = available now. */
  phase:       'ready' | 5 | 6 | 7;
  /** Short description shown in placeholder panels. */
  description: string;
}

export const MATRIMONIAL_TABS: MTab[] = [
  {
    id:          'case_command',
    icon:        '⊕',
    label:       'Case Command',
    phase:       'ready',
    description: 'Position strip, next action, stage timeline, compliance audit, risk score, alerts, and quick actions — all in one scrollable view.',
  },
  {
    id:          'intelligence',
    icon:        '◈',
    label:       'Intelligence',
    phase:       'ready',
    description: 'MIntelligence — 5-step MCA-specific extraction: marriage timeline, s.15(2) facts in play, two-year bar, children, financial picture, condonation risk, co-respondent, decree stage, gaps and risks.',
  },
  {
    id:          'inheritance',
    icon:        '⌖',
    label:       'Inheritance',
    phase:       'ready',
    description: 'InheritanceMode — shared engine, as-is.',
  },
  {
    id:          'petition_answer',
    icon:        '§',
    label:       'Petition / Answer',
    phase:       'ready',
    description: 'Petition Builder and Respondent Defence — promoted from MatrimonialEngine sub-tabs.',
  },
  {
    id:          'matrimonial',
    icon:        '⚖',
    label:       'Matrimonial Engine',
    phase:       'ready',
    description: 'MatrimonialEngine — 8 sub-tabs: custody, maintenance, property, and ancillary relief. Untouched.',
  },
  {
    id:          'ancillary_applications',
    icon:        '⬛',
    label:       'Applications',
    phase:       'ready',
    description: 'Ancillary applications — maintenance pendente lite, interim custody, leave under s.30 MCA.',
  },
  {
    id:          'forms_documents',
    icon:        '📄',
    label:       'Forms & Documents',
    phase:       'ready',
    description: 'MFormsEngine — all 14 MCR statutory forms generated to filing standard: Form 3A, 6, 7, 8/8A, 11, 15, 15A, 17, 30, 31, 32, 33, 42/43, 60.',
  },
  {
    id:          'evidence',
    icon:        '🗂',
    label:       'Evidence',
    phase:       'ready',
    description: 'EvidenceVault — shared engine, as-is.',
  },
  {
    id:          'strategy_hub',
    icon:        '◉',
    label:       'Strategy Hub',
    phase:       'ready',
    description: 'StrategyHub — three modes: Intelligence Layer (BlindSpots), Strategic Cockpit (WarRoom), Brief Me.',
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
    id:          'copilot',
    icon:        '✦',
    label:       'AI Copilot',
    phase:       'ready',
    description: 'AICopilot — shared engine, role-aware via existing role prompt system.',
  },
];
