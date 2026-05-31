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

export const STATUS_C: Record<string, string> = {
  'Filed':    '#4a7ed0',
  'Active':   '#40a868',
  'Adjourned':'#c4a030',
  'Judgment': '#8050d0',
  'Appeal':   '#c06040',
  'Settled':  '#5a9a70',
  'Closed':   '#5a5a78',
};
