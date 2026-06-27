/**
 * AFS Advocates — Matrimonial Dashboard Tab Constants
 *
 * Phase 2A (Pipeline consolidation): 12 → 4 tabs.
 * Matrimonial cases now run the same 4-engine pipeline as civil cases:
 *   Intelligence → Pleadings → Trial → Written Address
 *
 * Retired tabs (engines stay in codebase as background services):
 *   case_command, inheritance, petition_answer, matrimonial, ancillary_applications,
 *   forms_documents, evidence, strategy_hub, decree_enforcement, appeal, copilot
 *
 * Background service mapping:
 *   MIntelligence.tsx        → called by IntelligenceEngine (Phase 3A)
 *   MFormsEngine.tsx         → called by MatrimonialPetitionEngine (Phase 4A)
 *   MApplications.tsx        → retired; all 9 types ported to ApplicationsEngine (Phase 7A)
 *   DecreeEnforcementEngine  → MatrimonialDashboard reads decree_nisi_date, renders badge
 *   MAppeal.tsx              → MatrimonialDashboard reads decree_stage, renders badge
 *   MatrimonialEngine.tsx    → retired as tab; dead route in CaseDashboard
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

export type MTabId =
  | 'intelligence'
  | 'pleadings'
  | 'trial'
  | 'written_address';

export interface MTab {
  id:          MTabId;
  icon:        string;
  label:       string;
  description: string;
}

export const MATRIMONIAL_TABS: MTab[] = [
  {
    id:          'intelligence',
    icon:        '◈',
    label:       'Intelligence',
    description: 'IntelligenceEngine with MCA extraction layer — marriage timeline, s.15(2) facts in play, two-year bar, condonation risk, co-respondent, cross-petition detection, decree stage, gaps and risks. One paste; everything downstream pre-loaded.',
  },
  {
    id:          'pleadings',
    icon:        '§',
    label:       'Pleadings',
    description: 'PleadingsEngine (matrimonial_petition track) — Petitioner: MCR Form 1/6, Certificate of Compliance, Verifying Affidavit, Non-Collusion Affidavit, s.30 Leave Motion, Co-Respondent Notice. Respondent: Form 10 Notice of Appearance, Form 11A Answer, Condonation Plea, s.30 Bar Objection, Form 11B Cross-Petition.',
  },
  {
    id:          'trial',
    icon:        '⚖',
    label:       'Trial',
    description: 'TrialEngine — role-mapped: petitioner_side → prosecution_claimant; respondent_side → defence_defendant. Full hearing preparation, examination, and evidence workflow.',
  },
  {
    id:          'written_address',
    icon:        '✍',
    label:       'Written Address',
    description: 'FinalWrittenAddressEngine — adapts to matter_track. When cross_petition_filed is true, intelligence package carries cross-petition facts and AI generates two issues streams automatically.',
  },
];
