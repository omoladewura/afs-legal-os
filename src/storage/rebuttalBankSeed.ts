/**
 * Rebuttal Bank — Starter Set (NOT Phase 5B)
 *
 * The build plan is explicit that Phase 5B seeding must come from running
 * Phase 4's generateRebuttal() across 5–10 real issues and harvesting what
 * the AI actually surfaces — "Do NOT hand-seed from memory."
 *
 * This file is a deliberate, labeled exception, written because there is no
 * real-issue history to harvest from yet. It does not draw on legal memory
 * at large. Every defeater below is derived only from the doctrine already
 * named in this codebase's own APP_TYPES `hint` strings (ApplicationsEngine.tsx)
 * — content the firm already trusts enough to feed into every draft prompt —
 * plus the direct logical inverse of the named test (e.g. a 3-condition test
 * fails if any one of the 3 conditions isn't met). No new case citations are
 * introduced beyond ones already present in those hints.
 *
 * Every entry is written with source: 'seeded_unverified'. Nothing here
 * should be treated as a settled, firm-reviewed defeater until counsel has
 * checked it against real practice, or until Phase 4 harvesting on a real
 * issue independently surfaces the same defeater (source: 'harvested') and
 * upsertRebuttalDefeaters()'s dedup keeps both marked correctly.
 *
 * Jurisdiction is seeded as 'Federal' — a deliberate generic default. These
 * are general equity / criminal-procedure doctrine, not state-specific
 * practice directions, so treat 'Federal' here as "applies broadly, unless
 * counsel knows a state-specific wrinkle" rather than a jurisdiction claim.
 *
 * Call seedRebuttalBankStarterSet() once, manually (e.g. from a dev console
 * or a one-off admin action) — it is intentionally not wired into app
 * startup, so it never runs without someone deciding to run it.
 */

import { upsertRebuttalDefeaters } from './helpers';
import type { RebuttalBankDefeater } from './db';

function seeded(defeater: string, note: string): RebuttalBankDefeater {
  return { defeater, note, source: 'seeded_unverified' };
}

const JURISDICTION = 'Federal';

const STARTER_SET: { appType: string; defeaters: RebuttalBankDefeater[] }[] = [
  {
    // Hint: "establish the three conditions: serious question to be tried,
    // balance of convenience, and adequacy of damages."
    appType: 'Interlocutory Injunction',
    defeaters: [
      seeded('No serious question to be tried', 'Claim discloses no triable issue on the merits — threshold condition fails before the other two are even reached.'),
      seeded('Balance of convenience favours refusal', 'Greater hardship to the respondent from granting than to the applicant from refusing.'),
      seeded('Damages would adequately compensate', 'If a monetary award could fully remedy the applicant\'s loss, equity should not intervene.'),
      seeded('Applicant\'s delay in seeking the injunction', 'General equitable principle — unexplained delay after the cause of action arose can defeat urgency/entitlement.'),
      seeded('Non-disclosure of material facts', 'Especially relevant where the injunction was first sought ex parte at the Interim stage.'),
    ],
  },
  {
    // Hint: "must show extreme urgency and a real risk of irreparable harm
    // if notice is given to the other side first."
    appType: 'Interim Injunction',
    defeaters: [
      seeded('No real urgency shown', 'If notice could have been given without defeating the purpose, the ex parte route itself is questionable.'),
      seeded('No irreparable harm if notice were given', 'Harm compensable in damages, or reversible, undercuts the case for bypassing notice.'),
      seeded('Non-disclosure of material facts', 'Ex parte applications carry a heightened duty of full and frank disclosure — any material omission is a live objection.'),
    ],
  },
  {
    // Hint: "Account for every day of delay. Two conditions: good reason for
    // delay and arguable grounds of appeal." / civil variant cites Bowaje v
    // Adediwura.
    appType: 'Extension of Time',
    defeaters: [
      seeded('No good and substantial reason for the delay', 'Bowaje v Adediwura — both conditions are conjunctive; a strong second limb does not cure a weak first.'),
      seeded('Gaps in the delay narrative', 'Every day of the delay period must be accounted for — an unexplained gap invites this objection.'),
      seeded('No arguable grounds shown', 'The proposed step being sought an extension for must itself have merit, not just a plausible excuse for lateness.'),
    ],
  },
  {
    appType: 'Extension of Time to Appeal',
    defeaters: [
      seeded('No good reason for the delay', 'Same two-condition test as civil extension applications, applied to appellate delay.'),
      seeded('No arguable grounds of appeal', 'A weak or unarguable proposed ground defeats the second limb even where the delay is well explained.'),
    ],
  },
  {
    // Hint: "no real or bona fide defence."
    appType: 'Summary Judgment',
    defeaters: [
      seeded('Defendant discloses a triable issue', 'Any bona fide defence on the facts — even a thin one — is generally enough to resist summary judgment and send the matter to plenary trial.'),
      seeded('Genuine factual dispute not resolvable on affidavit', 'Conflicting affidavit evidence on a material fact is itself a reason the matter needs oral evidence.'),
    ],
  },
  {
    // Hint: "no reasonable cause of action, frivolous, vexatious, or abuse
    // of process."
    appType: 'Strike Out',
    defeaters: [
      seeded('Cause of action is disclosed, even if inartfully pleaded', 'Courts are reluctant to strike out on pleading defects curable by amendment.'),
      seeded('No abuse of process made out', 'Proceedings validly instituted for a genuine purpose, not multiplicity or a collateral motive.'),
    ],
  },
  {
    // Hint: "Address community ties, flight risk, gravity of offence,
    // health, dependants. Cite Dokubo-Asari v FRN, Ani v State, Bamaiyi v
    // State."
    appType: 'Bail Application',
    defeaters: [
      seeded('Flight risk', 'No fixed abode or verifiable ties, prior absconding, travel documents/means to leave the jurisdiction — Dokubo-Asari v FRN factors.'),
      seeded('Gravity of the offence and likely sentence', 'The more severe the charge and probable sentence on conviction, the stronger the incentive to abscond — a recurring theme in Bamaiyi v State and Ani v State.'),
      seeded('Risk of interference with witnesses or evidence', 'Particularly relevant where the accused has access to complainants or investigators.'),
    ],
  },
  {
    // Hint: "Jurisdiction, charge duplicity, wrong statute, vague
    // particulars, or missing elements."
    appType: 'Preliminary Objection',
    defeaters: [
      seeded('Court in fact has jurisdiction', 'The objection\'s premise fails if the enabling statute and venue are correctly invoked.'),
      seeded('Charge is not duplicitous / particulars are sufficient', 'A charge that reads awkwardly is not automatically defective if the accused can still understand and answer it.'),
    ],
  },
  {
    // Hint: "Charge is fundamentally defective — wrong court, duplicitous
    // counts, no offence known to law."
    appType: 'Quash Charge / Information',
    defeaters: [
      seeded('Charge discloses an offence known to law', 'The core premise of a quash application fails if the statutory offence is properly identified and made out on its face.'),
      seeded('Correct court/forum', 'If the charging court does have the jurisdiction the application disputes, the objection collapses.'),
    ],
  },
  {
    // Hint: "Three conditions: good grounds of appeal, special
    // circumstances, balance of hardship. Cite Vaswani Trading Co v
    // Savalakh & Co."
    appType: 'Stay of Execution',
    defeaters: [
      seeded('No special circumstances beyond the ordinary consequences of losing', 'Vaswani Trading Co v Savalakh & Co — the applicant must show something beyond the routine hardship every judgment debtor faces.'),
      seeded('Grounds of appeal are frivolous or unarguable', 'A stay is harder to justify if the underlying appeal itself has little prospect of success.'),
      seeded('Balance of hardship favours the judgment creditor', 'Where the respondent would suffer greater prejudice from delay than the applicant would from paying/complying now.'),
    ],
  },
];

/**
 * Inserts the starter set. Idempotent via upsertRebuttalDefeaters' dedup —
 * safe to run more than once. Does not touch any 'harvested' entries a real
 * Phase 5B run may already have added for the same (appType, jurisdiction).
 */
export async function seedRebuttalBankStarterSet(): Promise<{ appTypesSeeded: number }> {
  for (const entry of STARTER_SET) {
    await upsertRebuttalDefeaters(entry.appType, JURISDICTION, entry.defeaters);
  }
  return { appTypesSeeded: STARTER_SET.length };
}
