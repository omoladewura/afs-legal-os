/**
 * AFS Advocates — Matrimonial Track Types
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 *
 * All section references are to the MCA unless otherwise stated.
 */

// ─────────────────────────────────────────────────────────────────────────────
// RELIEF TYPE — s.11 MCA
// ─────────────────────────────────────────────────────────────────────────────

/** The principal relief sought in the petition. */
export type MatrimonialReliefType =
  | 'dissolution'           // s.15 MCA — irretrievable breakdown
  | 'nullity_void'          // s.3  MCA — void marriage
  | 'nullity_voidable'      // s.5  MCA — voidable marriage
  | 'judicial_separation'   // s.39 MCA
  | 'restitution_conjugal'  // s.47 MCA — RCR
  | 'jactitation';          // s.55 MCA — jactitation of marriage

// ─────────────────────────────────────────────────────────────────────────────
// DISSOLUTION FACTS — s.15(2) MCA (all 8, correct letter assignments)
// The sole ground is irretrievable breakdown s.15(1).
// The eight facts are EVIDENCE of breakdown, not separate grounds.
// ─────────────────────────────────────────────────────────────────────────────

export type DissolutionFact =
  | 'a_wilful_refusal_consummate'       // s.15(2)(a) — wilful and persistent refusal to consummate
  | 'b_adultery_intolerability'         // s.15(2)(b) — adultery plus intolerability
  | 'c_unreasonable_behaviour'          // s.15(2)(c) — unreasonable behaviour (s.16 MCA standard)
  | 'd_desertion_one_year'              // s.15(2)(d) — desertion for at least 1 continuous year
  | 'e_separation_two_years_consent'    // s.15(2)(e) — living apart 2 years, respondent consents
  | 'f_separation_three_years'          // s.15(2)(f) — living apart 3 years, no consent required
  | 'g_non_compliance_rcr'              // s.15(2)(g) — non-compliance with restitution of conjugal rights decree
  | 'h_presumed_death_seven_years';     // s.15(2)(h) — presumed death, absent 7 years

/** Human-readable labels for dissolution facts. */
export const DISSOLUTION_FACT_LABELS: Record<DissolutionFact, string> = {
  a_wilful_refusal_consummate:    's.15(2)(a) — Wilful and persistent refusal to consummate',
  b_adultery_intolerability:      's.15(2)(b) — Adultery and intolerability',
  c_unreasonable_behaviour:       's.15(2)(c) — Unreasonable behaviour',
  d_desertion_one_year:           's.15(2)(d) — Desertion (at least 1 continuous year)',
  e_separation_two_years_consent: 's.15(2)(e) — Living apart 2 years (respondent consents)',
  f_separation_three_years:       's.15(2)(f) — Living apart 3 years (no consent required)',
  g_non_compliance_rcr:           's.15(2)(g) — Non-compliance with RCR decree',
  h_presumed_death_seven_years:   's.15(2)(h) — Presumed death (absent 7 years)',
};

// ─────────────────────────────────────────────────────────────────────────────
// NULLITY GROUNDS
// ─────────────────────────────────────────────────────────────────────────────

/** Void marriage grounds — s.3 MCA */
export type NullityVoidGround =
  | 'not_of_marriageable_age'         // s.3(1)(a) — party not of marriageable age
  | 'prohibited_relationship'         // s.3(1)(b) — within prohibited degrees of consanguinity or affinity
  | 'prior_subsisting_marriage'       // s.3(1)(c) — either party already married
  | 'not_male_and_female'             // s.3(1)(d) — parties not male and female
  | 'solemnized_by_unauthorized'      // s.3(1)(e) — not solemnized by authorized person/in authorized form
  | 'insufficient_notice';            // s.3(1)(f) — insufficient notice of intended marriage

/** Voidable marriage grounds — s.5 MCA */
export type NullityVoidableGround =
  | 'non_consummation_incapacity'     // s.5(1)(a) — incapacity to consummate
  | 'non_consummation_wilful_refusal' // s.5(1)(b) — wilful refusal to consummate
  | 'unsound_mind'                    // s.5(1)(c) — party of unsound mind
  | 'mental_disorder'                 // s.5(1)(d) — mental disorder rendering unfit for marriage
  | 'venereal_disease'                // s.5(1)(e) — communicable venereal disease at time of marriage
  | 'pregnancy_by_other'             // s.5(1)(f) — wife pregnant by person other than husband
  | 'duress_or_fraud';               // s.5(1)(g) — consent obtained by duress or fraud

// ─────────────────────────────────────────────────────────────────────────────
// MINTELLIGENCE EXTRACTION TYPES — Phase 9A
// Promoted from MIntelligence.tsx so every engine can import them without
// depending on the intelligence engine file directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarriageTimeline {
  marriage_date:        string;
  marriage_place:       string;
  marriage_type:        string;
  cohabitation_end:     string;
  cohabitation_history: string;
}

export interface S152FactInPlay {
  fact:     string; // e.g. "s.15(2)(b) — Adultery and intolerability"
  evidence: string;
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'UNKNOWN';
}

export interface TwoYearBar {
  marriage_date:   string;
  bar_applies:     boolean;
  exception:       string | null;
  exception_basis: string;
  leave_required:  boolean;
  leave_obtained:  boolean;
}

export interface ChildRecord {
  name:                string;
  age:                 string;
  current_arrangement: string;
  welfare_concern:     string;
}

export interface FinancialPicture {
  assets_known:          string[];
  maintenance_needs:     string;
  pendente_lite_urgency: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  disclosure_gaps:       string[];
}

export interface MExtractionResult {
  marriage_timeline:  MarriageTimeline;
  relief_sought:      string;
  dissolution_facts:  S152FactInPlay[];
  two_year_bar:       TwoYearBar;
  children:           ChildRecord[];
  financial_picture:  FinancialPicture;
  condonation_risk:   { risk: boolean; basis: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' };
  connivance_risk:    { risk: boolean; basis: string };
  co_respondent:      { named: boolean; name: string; service_feasible: boolean };
  decree_stage:       string;
  gaps_and_risks:     Array<{ issue: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILDREN
// ─────────────────────────────────────────────────────────────────────────────

export interface MatrimonialChild {
  id:                  string;
  name:                string;
  dob:                 string;   // YYYY-MM-DD
  current_arrangement: string;   // who the child lives with
  welfare_concern?:    string;   // any flagged welfare issue
}

// ─────────────────────────────────────────────────────────────────────────────
// MATRIMONIAL CASE DATA — the structured state slot on Case
// Stored in matrimonial_data on the Case object.
// Never touches blindSpots.
// ─────────────────────────────────────────────────────────────────────────────

export interface MatrimonialCaseData {
  // Core relief
  relief_type?:                MatrimonialReliefType;

  // Marriage particulars
  marriage_date?:              string;   // YYYY-MM-DD
  marriage_place?:             string;
  marriage_type?:              'statutory' | 'customary' | 'church' | 'islamic' | 'other';

  // Two-year bar — s.30 MCA
  // true when marriage_date is within 2 years of today
  two_year_bar_applies?:       boolean;
  // Exception identified that may displace the bar
  two_year_bar_exception?:     'wilful_refusal' | 'adultery' | 'rape_sodomy_bestiality' | null;
  leave_granted?:              boolean;  // leave obtained under s.30 MCA

  // Dissolution
  dissolution_facts?:          DissolutionFact[];

  // Nullity
  void_grounds?:               NullityVoidGround[];
  voidable_grounds?:           NullityVoidableGround[];

  // Co-respondent — s.32 MCA, O.9 rr.2–3 MCR
  co_respondent_joined?:       boolean;
  co_respondent_name?:         string;

  // Bars and declarations
  condonation_risk?:           boolean;
  connivance_risk?:            boolean;
  collusion_risk?:             boolean;
  discretion_statement_required?: boolean;  // Form 30, O.11 rr.28–29 MCR

  // Decree timeline
  decree_nisi_date?:           string;   // YYYY-MM-DD
  // s.57 path: children welfare order made — 28 days to apply for absolute
  // s.58 path: no children order — 3 months
  decree_absolute_path?:       's57_28_days' | 's58_3_months';
  decree_absolute_deadline?:   string;   // YYYY-MM-DD (computed)

  // Children — s.71 MCA
  children?:                   MatrimonialChild[];

  // ── Phase 9 — MIntelligence upstream fields ──────────────────────────────
  // Written by MIntelligence; read by every other matrimonial engine.
  // Present → engines pre-populate. Absent → engines work as before (no regression).
  intelligence_extraction?: MExtractionResult; // written after Step 2
  intelligence_package?:    string;             // written after Step 5 (full narrative)
  intelligence_run_at?:     string;             // ISO timestamp of last run
  intelligence_version?:    number;             // incremented on each re-run

  // ── Cross-Petition ────────────────────────────────────────────────────────
  // Set when respondent files a cross-petition under O.11 MCR Form 11 Part B.
  // cross_petition_filed_by is fixed to 'respondent' (only party who may file).
  cross_petition_filed?:        boolean;
  cross_petition_facts?:        DissolutionFact[];
  cross_petition_relief?:       MatrimonialReliefType;
  cross_petition_filed_by?:     'respondent';
  cross_petition_activated_at?: string;  // ISO timestamp when activated in UI

  // Timestamps
  _createdAt?:                 string;
  _updatedAt?:                 string;
}
