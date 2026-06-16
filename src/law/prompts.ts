/**
 * AFS Legal OS — Law Prompts (Law Change Risk Mitigation)
 *
 * All legal assertions currently buried in AI system prompt strings,
 * extracted into a typed array.
 *
 * getPrompt(id) returns the assertion text for injection into system prompts.
 * Synchronous — prompt text is not dynamically overridable via the admin UI
 * in this version. Updating prompt text requires editing this file directly,
 * which ensures a human review step before any change goes live.
 *
 * 19 prompt assertions (keyed).
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptEntry {
  id:           string;
  label:        string;
  value:        string;
  engines:      string[];
  source:       string;
  lastVerified: string;   // YYYY-MM-DD
  notes?:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT REGISTRY — 19 entries
// ─────────────────────────────────────────────────────────────────────────────

export const PROMPT_REGISTRY: PromptEntry[] = [

  // ── ACJA ──────────────────────────────────────────────────────────────────

  {
    id:           'acja_no_case_standard',
    label:        'ACJA No-Case Submission standard',
    value:        'The test for a no-case submission under ACJA 2015 s.303(1) is whether there is evidence on which a reasonable tribunal, properly directing itself, could convict — not whether the prosecution has proved its case beyond reasonable doubt. The court does not weigh evidence at this stage. Apply the authorities in Ajidagba v. State (1981) 1 NCLR 91, Ibeziako v. Commissioner of Police (1963), and Tongo v. COP.',
    engines:      ['NoCaseSubmission.tsx', 'ProsecutionCase.tsx'],
    source:       's.303(1) ACJA 2015; Ajidagba v. State (1981); Ibeziako v. COP (1963)',
    lastVerified: '2025-01-01',
    notes:        'Standard is well-settled. Update only if Supreme Court departs from the Ajidagba formulation.',
  },

  {
    id:           'acja_plea_bargain_requirements',
    label:        'ACJA plea bargain formal requirements',
    value:        'Under ACJA 2015 s.270, a plea bargain agreement must be in writing and signed by the accused personally, prosecution counsel, and defence counsel before it is filed with the court. The court is not bound to accept the agreed sentence — it retains full sentencing discretion. The agreement must state: the offence(s) pleading to, counts to be withdrawn, agreed sentence (if any), restitution obligations, and any cooperation undertakings.',
    engines:      ['PleaEngine.tsx'],
    source:       's.270 Administration of Criminal Justice Act 2015',
    lastVerified: '2025-01-01',
  },

  {
    id:           'acja_90_day_trial_target',
    label:        'ACJA 90-day trial commencement / progress target',
    value:        'Under s.396 ACJA 2015, where an accused is in custody, trial must commence within 30 days of arraignment. The 90-day mark from arraignment is the conventional monitoring point under s.396(3) ACJA for overall trial progress. Repeated failure to make substantive progress at each hearing grounds an application for discharge (not necessarily acquittal) under ACJA.',
    engines:      ['AlertsEngine.tsx', 'SentencingEngine.tsx'],
    source:       's.396, s.396(3) Administration of Criminal Justice Act 2015',
    lastVerified: '2025-01-01',
  },

  {
    id:           'acja_remand_right',
    label:        'ACJA s.296 bail review right after 30-day remand',
    value:        'Under s.296 ACJA 2015, an accused held on remand for 30 days without trial commencement has a right to apply for bail. This right is periodic — it renews every 30 days. A bail application under s.296 is distinct from the ordinary bail application at arraignment. Grounds include: failure of prosecution to present witnesses, absence of co-accused, or administrative delay.',
    engines:      ['AlertsEngine.tsx'],
    source:       's.296 Administration of Criminal Justice Act 2015',
    lastVerified: '2025-01-01',
  },

  {
    id:           'acja_caution_s15',
    label:        'ACJA s.15 caution before confessional statement',
    value:        'Under s.15 ACJA 2015, before recording a confessional statement, the recording officer must caution the suspect in the following terms: "You are not obliged to say anything unless you wish to do so, but anything you say will be taken down in writing and may be used in evidence." A confessional statement recorded without the ACJA s.15 caution is liable to exclusion on a voir dire. Additionally, s.17 ACJA requires the statement to be made before a superior police officer or magistrate if the accused is in police custody for more than 24 hours.',
    engines:      ['ProsecutionCase.tsx'],
    source:       's.15, s.17 Administration of Criminal Justice Act 2015',
    lastVerified: '2025-01-01',
    notes:        'Critical admissibility gate for confessions. Verify caution wording against current ACJA text.',
  },

  // ── EVIDENCE ACT ──────────────────────────────────────────────────────────

  {
    id:           'evidence_act_s84_electronic',
    label:        'Evidence Act 2011 s.84 — electronic evidence admissibility',
    value:        'Under s.84 Evidence Act 2011, a statement contained in a document produced by a computer is admissible as evidence of any fact stated in it if the following conditions are satisfied: (a) the document was produced by the computer during a period when it was used regularly to store or process information for activities regularly carried on over that period; (b) during that period, information of the kind contained in the statement was regularly supplied to the computer in the ordinary course of those activities; (c) throughout the material part of that period the computer was operating properly; (d) the information in the statement reproduces or is derived from information supplied to the computer in the ordinary course of those activities. A certificate under s.84(2) must be produced by a person who occupies a responsible position in relation to the operation of the computer, identifying the document and describing the manner in which it was produced. Failure to produce the s.84(2) certificate renders electronic evidence inadmissible — no matter how probative.',
    engines:      ['ComplianceEngine.tsx', 'ProsecutionCase.tsx'],
    source:       's.84 Evidence Act 2011 (as amended)',
    lastVerified: '2025-01-01',
    notes:        'Pivotal in fraud, cybercrime, and financial crime cases. Update if Evidence Act is amended.',
  },

  {
    id:           'evidence_act_s115_hearsay',
    label:        'Evidence Act 2011 s.115 — hearsay and sources of information and belief in affidavits',
    value:        'Under s.115 Evidence Act 2011, an affidavit shall be confined to facts within the personal knowledge of the deponent. Where the deponent deposes to facts based on information received from another person or on belief, the deponent must state the source of the information and the grounds for the belief. Any hearsay paragraph in an affidavit that does not comply with s.115 is objectionable and may be struck out on a motion to strike. The court will typically disregard non-compliant paragraphs rather than strike the entire affidavit.',
    engines:      ['ComplianceEngine.tsx'],
    source:       's.115 Evidence Act 2011',
    lastVerified: '2025-01-01',
  },

  // ── MCA — DISSOLUTION FACTS ───────────────────────────────────────────────

  {
    id:           'mca_dissolution_facts',
    label:        'MCA s.15 dissolution — one ground, eight facts',
    value:        'There is ONE ground for dissolution of marriage under the Matrimonial Causes Act Cap M7 LFN 2004: irretrievable breakdown of marriage (s.15(1) MCA). The eight matters in s.15(2)(a)–(h) are FACTS that prove irretrievable breakdown — they are not separate grounds. The eight facts in correct order are: (a) wilful and persistent refusal to consummate the marriage; (b) adultery and intolerability; (c) unreasonable behaviour (read with s.16 MCA); (d) desertion for at least one continuous year; (e) living apart for at least two years, respondent consents; (f) living apart for at least three years (no consent required); (g) failure to comply with a decree of restitution of conjugal rights; (h) presumed death — absence for seven years.',
    engines:      ['MatrimonialEngine.tsx'],
    source:       's.15 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
    notes:        'Common drafting error: pleading s.15(2)(b) adultery as a standalone ground. It is a fact, not a ground.',
  },

  {
    id:           'mca_s30_two_year_bar',
    label:        'MCA s.30 — two-year bar on dissolution petitions',
    value:        'Under s.30 Matrimonial Causes Act Cap M7 LFN 2004, no petition for dissolution of marriage may be presented within two years of the date of the marriage, except with the leave of the court. Leave may only be granted where the petitioner would suffer exceptional hardship, or where the respondent has been guilty of exceptional depravity, in allowing the petition to be presented within the two-year period. The two-year bar is strict and jurisdictional — failure to obtain leave is a nullity.',
    engines:      ['MatrimonialEngine.tsx'],
    source:       's.30 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
  },

  {
    id:           'mca_s32_co_respondent',
    label:        'MCA s.32 — joinder of co-respondent in adultery cases',
    value:        'Under s.32 Matrimonial Causes Act Cap M7 LFN 2004, where the ground relied on in a dissolution petition includes adultery, the petitioner must join the alleged adulterer or adulteress as a co-respondent unless: (a) the co-respondent is not identified or cannot be found; (b) the petition also relies on separation facts under s.15(2)(e) or (f) and the court grants leave to dispense with joinder; or (c) the court is otherwise satisfied that joinder is impracticable. Failure to join where required may result in the petition being struck out or the adultery fact being excluded.',
    engines:      ['MatrimonialEngine.tsx'],
    source:       's.32 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
  },

  {
    id:           'mca_condonation_ss2627',
    label:        'MCA ss.26–27 — condonation bars for adultery and unreasonable behaviour',
    value:        'Under s.26 Matrimonial Causes Act Cap M7 LFN 2004, adultery is condoned if the petitioner, knowing of the adultery, has cohabited with the respondent. Under s.27, unreasonable behaviour may also be condoned by continued cohabitation. Condonation is a complete bar to relying on the condoned conduct as a fact under s.15(2). However, condonation of adultery may be revived if the respondent commits further matrimonial offences. The court will examine the facts of post-discovery cohabitation with care — mere continued residence in the same home for practical reasons does not automatically constitute condonation.',
    engines:      ['MatrimonialEngine.tsx'],
    source:       'ss.26–27 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
  },

  {
    id:           'mca_nullity_bars_ss3537',
    label:        'MCA ss.35–37 — bars to nullity decrees',
    value:        'Under ss.35–37 Matrimonial Causes Act Cap M7 LFN 2004, the court may refuse a nullity decree on the following bars: (a) s.35 — approbation: where the petitioner, knowing the grounds for nullity, has freely and voluntarily behaved in a manner leading the respondent to believe that the petitioner would not apply for nullity, and it would be unjust to grant a decree (applies to voidable marriages only); (b) s.36 — lapse of time: where the petition has not been presented within one year of the marriage in cases of absence of consent or defects in the marriage ceremony (unless the petitioner was unaware of the defect); (c) s.37 — third-party interests: where innocent third parties would be prejudiced by a decree of nullity. These bars apply to voidable marriages only — a void marriage may be declared void without regard to them.',
    engines:      ['MatrimonialEngine.tsx'],
    source:       'ss.35–37 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
  },

  // ── MCA — DECREE ENFORCEMENT ──────────────────────────────────────────────

  {
    id:           'mca_s57_absolute_rule',
    label:        'MCA s.57 — decree absolute path where children welfare order made (28 days)',
    value:        'Under s.57 Matrimonial Causes Act Cap M7 LFN 2004, where the court made a children welfare arrangement order at the time of granting a decree nisi, the petitioner CANNOT apply to make the decree absolute until: (a) 28 days have elapsed from the date of the decree nisi; AND (b) the court is satisfied as to the welfare of the children of the marriage — whichever is later. The satisfaction requirement may involve filing an affidavit of welfare or obtaining a welfare report. NEVER confuse s.57 (children welfare order made) with s.58 (no children welfare order).',
    engines:      ['DecreeEnforcementEngine.tsx'],
    source:       's.57 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
    notes:        'The 28-day minimum is subject to override via the Law Registry (id: mca_s57_absolute_days).',
  },

  {
    id:           'mca_s58_absolute_rule',
    label:        'MCA s.58 — decree absolute path where no children welfare order (3 months)',
    value:        'Under s.58 Matrimonial Causes Act Cap M7 LFN 2004, where NO children welfare arrangement order was made at the time of granting the decree nisi, the petitioner may apply to make the decree absolute after 3 months from the date of the decree nisi. The 3-month period runs from the date of the decree nisi order itself, not from any subsequent ruling. NEVER confuse s.58 (no children welfare order) with s.57 (children welfare order made — 28-day path).',
    engines:      ['DecreeEnforcementEngine.tsx'],
    source:       's.58 Matrimonial Causes Act Cap M7 LFN 2004',
    lastVerified: '2025-01-01',
    notes:        'The 3-month period is subject to override via the Law Registry (id: mca_s58_absolute_months).',
  },

  {
    id:           'cfrn_s241_2_appeal_absolute_bar',
    label:        'CFRN s.241(2) — no appeal against decree absolute',
    value:        'Section 241(2) of the Constitution of the Federal Republic of Nigeria 1999 (as amended) provides that no appeal shall lie from a decree absolute of dissolution of marriage. This is a hard constitutional bar with no exceptions — it cannot be circumvented by framing the appeal as a challenge to the procedure, the evidence, or the jurisdiction. A party aggrieved by the grant of a decree absolute may only challenge the decree nisi itself (provided they have not allowed time to lapse) or seek to set aside the decree absolute on the ground of fraud or lack of jurisdiction.',
    engines:      ['DecreeEnforcementEngine.tsx'],
    source:       's.241(2) Constitution of the Federal Republic of Nigeria 1999 (as amended)',
    lastVerified: '2025-01-01',
    notes:        'Constitutional provision — can only change via constitutional amendment. High certainty.',
  },

  {
    id:           'mca_maintenance_magistrate',
    label:        'MCA maintenance enforcement — magistrate court jurisdiction',
    value:        'Post-decree maintenance orders under the Matrimonial Causes Act Cap M7 LFN 2004 may be registered in and enforced by a Magistrate Court of competent jurisdiction under the Maintenance Orders Act or the applicable State maintenance enforcement legislation. Enforcement options include: attachment of earnings (direct deduction from salary), sequestration of assets under Order 17 Rule 4 of the Matrimonial Causes Rules 1983, contempt proceedings, and committal proceedings. Non-compliance with a maintenance order is contempt of court regardless of which court made the order.',
    engines:      ['DecreeEnforcementEngine.tsx'],
    source:       'MCA Cap M7; Matrimonial Causes Rules 1983 Order 17 Rule 4; Maintenance Orders Act',
    lastVerified: '2025-01-01',
  },

  {
    id:           'mca_s241_1_f_iv_appeal_nisi',
    label:        'CFRN s.241(1)(f)(iv) — appeal against decree nisi',
    value:        'An appeal against a decree nisi of dissolution lies as of right under s.241(1)(f)(iv) of the Constitution of the Federal Republic of Nigeria 1999 (as amended). The time for filing a Notice of Appeal against a decree nisi is 90 days from the date of the decree, pursuant to s.25(2) Court of Appeal Act Cap C36 LFN 2004. Once the decree is made absolute, the constitutional bar in s.241(2) applies and no further appeal is available in respect of the dissolution itself.',
    engines:      ['roleWorkspace (description strings)'],
    source:       's.241(1)(f)(iv) CFRN 1999; s.25(2) Court of Appeal Act Cap C36 LFN 2004',
    lastVerified: '2025-01-01',
  },

  // ── FREP ──────────────────────────────────────────────────────────────────

  {
    id:           'frep_5_day_counter_window',
    label:        'FREP 5-day counter-affidavit window from service',
    value:        'Under the Fundamental Rights (Enforcement Procedure) Rules 2009, Order III, a respondent to a FREP application has 5 days from service of the application to file: (i) a Counter-Affidavit and Written Address (where the respondent disputes the facts); or (ii) a Written Address only (where the respondent intends to oppose on points of law alone and does not dispute the facts). Failure to file a Counter-Affidavit within 5 days means the facts deposed to in the Applicant\'s Affidavit in Support stand admitted. The applicant should monitor the docket closely and flag non-filing immediately.',
    engines:      ['AlertsEngine.tsx'],
    source:       'Fundamental Rights (Enforcement Procedure) Rules 2009, Order III',
    lastVerified: '2025-01-01',
    notes:        'The 5-day period is subject to override via the Law Registry (id: frep_counter_affidavit_days).',
  },

  {
    id:           'frep_7_day_listing_target',
    label:        'FREP 7-day listing target after filing',
    value:        'Under the Fundamental Rights (Enforcement Procedure) Rules 2009, Order II, a FREP application should be listed for hearing within 7 days of filing. The urgency is built into the procedure. If the matter is not listed within 7 days, counsel should write formally to the Chief Registrar requesting an urgent hearing date, citing the constitutional rights at stake and the FREP Rules. The 7-day target is a procedural benchmark — failure to meet it is a registry matter, not a jurisdictional defect, but delay should be formally recorded and resisted.',
    engines:      ['AlertsEngine.tsx'],
    source:       'Fundamental Rights (Enforcement Procedure) Rules 2009, Order II',
    lastVerified: '2025-01-01',
    notes:        'The 7-day period is subject to override via the Law Registry (id: frep_listing_target_days).',
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP
// ─────────────────────────────────────────────────────────────────────────────

const _promptMap = new Map<string, PromptEntry>(
  PROMPT_REGISTRY.map(e => [e.id, e]),
);

/**
 * Returns the prompt assertion text for injection into a system prompt.
 * Returns an empty string if the id is not found (safe to interpolate).
 */
export function getPrompt(id: string): string {
  return _promptMap.get(id)?.value ?? '';
}

/**
 * Returns the full entry (for admin UI).
 */
export function getPromptEntry(id: string): PromptEntry | undefined {
  return _promptMap.get(id);
}
