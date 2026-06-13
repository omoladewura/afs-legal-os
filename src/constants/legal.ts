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

export const COURTS: string[] = [
  'Magistrate Court', 'Customary Court', 'High Court (State)',
  'High Court (Federal / FHC)', 'National Industrial Court',
  'Court of Appeal', 'Supreme Court', 'Election Petitions Tribunal',
  'Tribunal', 'Arbitral Panel',
];

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

export const STATUS_C: Record<string, { bg: string; bdr: string; col: string }> = {
  'Filed':    { col: '#4a7ed0', bg: '#080e1a', bdr: '#1a2a4a' },
  'Active':   { col: '#40a868', bg: '#081810', bdr: '#1a4028' },
  'Adjourned':{ col: '#c4a030', bg: '#1a1400', bdr: '#4a3800' },
  'Judgment': { col: '#8050d0', bg: '#0e0818', bdr: '#2a1050' },
  'Appeal':   { col: '#c06040', bg: '#1a0e08', bdr: '#5a2010' },
  'Settled':  { col: '#5a9a70', bg: '#081410', bdr: '#1a3828' },
  'Closed':   { col: '#5a5a78', bg: '#0a0a12', bdr: '#1a1a28' },
};
