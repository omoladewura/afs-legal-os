/**
 * AFS Advocates — Legal Reference Constants
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
  'Active', 'Pending', 'Adjourned', 'Closed', 'Settled',
  'Struck Out', 'Judgment Delivered', 'On Appeal', 'Discontinued',
];

export const CASE_DOC_TYPES: string[] = [
  'Writ of Summons', 'Statement of Claim', 'Statement of Defence', 'Reply',
  'Motion on Notice', 'Ex-Parte Motion', 'Affidavit', 'Counter-Affidavit',
  'Written Address', 'Brief of Argument', 'Judgment', 'Order', 'Ruling',
  'Notice of Appeal', 'Grounds of Appeal', 'Record of Appeal',
  'Originating Summons', 'Witness Statement', 'Exhibit', 'Other',
];

export const DEADLINE_TYPES: string[] = [
  'Limitation Period', 'Filing Deadline', 'Response Deadline',
  'Compliance Date', 'Appeal Window', 'Hearing Date', 'Payment Deadline', 'Custom',
];

export const STATUS_C: Record<string, { bg: string; bdr: string; col: string }> = {
  'Filed':             { bg: '#0a0a14', bdr: '#1e1e3a', col: '#5a5a8a' },
  'Served':            { bg: '#081810', bdr: '#1a3828', col: '#40a868' },
  'Pending':           { bg: '#1a1400', bdr: '#4a3800', col: '#c09030' },
  'Adjourned':         { bg: '#1a0e08', bdr: '#5a2010', col: '#d06040' },
  'Ruled Upon':        { bg: '#0a0818', bdr: '#2a1848', col: '#8060c0' },
  'Withdrawn':         { bg: '#0f0f0f', bdr: '#2a2a2a', col: '#505050' },
  'Dismissed':         { bg: '#1a0808', bdr: '#4a1818', col: '#c05050' },
  'Judgment':          { bg: '#0a1410', bdr: '#1a3828', col: '#30a870' },
  'Settled':           { bg: '#081418', bdr: '#183848', col: '#3090b0' },
  'On Appeal':         { bg: '#14080a', bdr: '#3a1828', col: '#b04070' },
};
