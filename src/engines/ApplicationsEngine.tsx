// Build Plan v2 — Phase 10 complete. 20 June 2026.
// Phase 4 integrity audit complete. 29 June 2026.
// getLawSync wiring: Phase 10C (getJurisdictionDeltaSync → buildDraftSystemPrompt Layer 2).
// Clone Draft: Phases 10D (data layer) + 10E (UI — clone button, modal, clone notice).
// Phase 10F-ii integration smoke test: PASS (20 x checks, zero TypeScript errors).
// PromptPreview removed. CrossExamEngine stub retained pending Check 4 (live production test).

/**
 * AFS Legal OS V2 — Applications Engine (Phase 1 Rebuild)
 *
 * Universal applications drafter. Available to all four roles across
 * civil and criminal matters. Five-stage linear workflow:
 *
 *   Stage 1 — Application Type     : Quick-fill type picker (civil/criminal/appeal)
 *   Stage 2 — Application Facts    : Parties, relief, grounds, affidavit facts
 *   Stage 3 — Argument Builder     : Issue-by-issue IRAC → Written Address + Reply sub-tab
 *   Stage 4 — Assemble Package     : One AI call builds full document package
 *   Stage 5 — Applications Tracker : Status log for every application in the matter
 *
 * Statute RAG fires automatically at Stage 3. Intelligence context injected throughout.
 * Storage: saveBlindSpot `applications_v2_${caseId}` + `app_tracker_${caseId}`.
 * Worker D1: PUT /application | GET /applications?caseId=x | DELETE /application?id=x
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { loadBlindSpot, saveBlindSpot, uid, cloneApplicationToCase, loadAllCases } from '@/storage/helpers';
import { Md, ErrorBlock, TypeDeleteModal, CaseTheoryBanner } from '@/components/common/ui';
import { useCaseTheory } from '@/hooks/useCaseTheory';
import type { CaseTheoryRecord, CaseSummary } from '@/types';
import { COUNSEL_ROLE_COLORS, MATTER_TRACK_COLORS } from '@/types';
import { AUTH_TOKEN } from '@/services/api';
import {
  queryStatutes,
  formatStatutesForPrompt,
  buildRagQuery,
  isRagConfigured,
  type StatuteChunk,
} from '@/services/statuteRag';
import { ArgumentTemplateManager } from './ArgumentTemplateManager';
import { db } from '@/storage/db';
import type { ArgumentTemplate } from '@/storage/db';
import { getJurisdictionDeltaSync } from '@/law/registry';
import {
  detectOpponentTheory,
  confidenceLabel,
  isMergeCandidate,
  // formatDetectedTheoryForPrompt — used in Phase 3C (Respondent prompt injection) and 3D (merge preview)
  formatDetectedTheoryForPrompt,
  type DetectedOpponentTheory,
} from '@/utils/detectOpponentTheory';
import { unlockCaseTheory, saveCaseTheory, lockCaseTheory } from '@/storage/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT CONSOLIDATION — buildDraftSystemPrompt (Phase 10B)
// Case theory injection (Phase 9D) is Layer 4 of this function.
// ─────────────────────────────────────────────────────────────────────────────

interface BuildDraftSystemPromptParams {
  /** Role + intelligence context — the base layer (always required). */
  systemCtx:        string;
  /** AppTypeConfig — governs needsCaseTheory and label for logging. */
  appType:          AppTypeConfig;
  /**
   * Saved ArgumentTemplate for this appType × jurisdiction (Phase 2).
   * Pass null when no template match exists or when the call type does not
   * use templates (assembleAddress, generateReplyLaw, generateCounterAffidavit).
   */
  template:         ArgumentTemplate | null;
  /**
   * Locked CaseTheoryRecord (Phase 9D).
   * Pass null when appType.needsCaseTheory is false, or when the theory
   * is not locked, or when the call type should not carry theory context.
   * Callers are responsible for the gate — this function always injects
   * when theory is non-null, with no second-guessing.
   */
  theory:           CaseTheoryRecord | null;
  /**
   * Jurisdiction delta string from getJurisdictionDeltaSync (Phase 10A).
   * Pass '' in Phase 10B — wired to a live call in Phase 10C.
   * When empty, Layer 2 is silently omitted.
   */
  lawDelta:         string;
  /**
   * Per-call instruction appended as Layer 5 (optional).
   * e.g. 'You are drafting one issue of a Written Address for a Nigerian court.
   * NEVER invent case citations. Use [RESEARCH NEEDED] blocks.'
   * When omitted, the assembled prompt ends after Layer 4.
   */
  callInstruction?: string;
}

/**
 * Assembles the system prompt for every ApplicationsEngine draft call.
 *
 * Layer order (always preserved):
 *   1 — systemCtx          (role + intelligence context — always present)
 *   2 — lawDelta           (jurisdiction delta — omitted when empty string)
 *   3 — template skeleton  (argument framework — omitted when template is null)
 *   4 — theory context     (case theory — omitted when theory is null)
 *   5 — callInstruction    (per-call task instruction — omitted when undefined)
 *
 * BACKWARD-COMPATIBILITY GUARANTEE:
 * When called with lawDelta='', template=null, theory=null, callInstruction=undefined,
 * output equals: systemCtx
 * When called with the same inputs plus callInstruction=X:
 * output equals: systemCtx + '\n' + X
 * Both are equivalent to what the pre-refactor call sites produced for those conditions.
 */
function buildDraftSystemPrompt({
  systemCtx,
  appType,
  template,
  theory,
  lawDelta,
  callInstruction,
}: BuildDraftSystemPromptParams): string {
  const layers: string[] = [];

  // ── Layer 1: role + intelligence context (always present) ─────────────────
  layers.push(systemCtx);

  // ── Layer 2: jurisdiction delta (omitted when empty) ──────────────────────
  if (lawDelta && lawDelta.trim().length > 0) {
    layers.push(lawDelta.trim());
  }

  // ── Layer 3: argument template skeleton (omitted when null) ───────────────
  if (template !== null) {
    layers.push(
      `ARGUMENT FRAMEWORK (pre-approved skeleton for ${template.appType} in ${template.jurisdiction}):\n` +
      template.skeleton +
      `\n\nStatutory Basis: ${template.statutory_basis}` +
      `\nApplicable Tests: ${template.tests}` +
      `\nLeading Authorities: ${template.leading_authorities}` +
      (template.law_delta ? `\nJurisdiction Notes: ${template.law_delta}` : '') +
      '\n\nINSTRUCTION: Use this framework as the structure for the argument. Merge the case-specific facts supplied below into this framework. Do not re-derive the legal framework from scratch.',
    );
  }

  // ── Layer 4: case theory context (omitted when null) ──────────────────────
  if (theory !== null) {
    const elementList = theory.elements
      .map((e, i) => `  ${i + 1}. ${e.element}`)
      .join('\n');
    layers.push(
      `CASE THEORY CONTEXT (relevant to this application):\n` +
      `Core Proposition: ${theory.core_proposition}\n` +
      `Elements to Establish:\n${elementList}\n` +
      `This application must be argued in a manner consistent with and advancing the Core Proposition above.`,
    );
  }

  // ── Layer 5: per-call task instruction (omitted when undefined) ───────────
  if (callInstruction) {
    layers.push(callInstruction);
  }

  return layers.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type MainTab         = 'new' | 'tracker' | 'templates';
type Stage           = 1 | 2 | 3 | 4 | 5;
type TrackFilter     = 'all' | 'civil' | 'criminal' | 'appeal' | 'frep' | 'matrimonial';
type AppStatus       = 'Drafting' | 'Filed' | 'Served' | 'Awaiting Hearing' | 'Heard' | 'Granted' | 'Refused' | 'Withdrawn';
type ApplicationRole = 'mover' | 'respondent';

// Mover track sub-tabs
type MoverSubTab = 'originating_process' | 'supporting_affidavit' | 'written_address' | 'opposing_response' | 'further_better' | 'reply_law';
// Respondent track sub-tabs
type RespondentSubTab = 'counter_affidavit' | 'written_address_opp' | 'further_better_resp';

export interface AppTypeConfig {
  id:      string;
  label:   string;
  icon:    string;
  track:   'civil' | 'criminal' | 'appeal' | 'all' | 'frep' | 'matrimonial';
  package: string[];
  hint:    string;
  /**
   * Trial Engine Consolidation, Phase 1 — Decision 1.
   *
   * Whether a locked Case Theory is injected into this appType's draft
   * calls (Phase 9 wires the actual injection; this flag is set here so
   * the catalogue carries it from the start).
   *
   *   true  + locked theory exists → theory is injected
   *   true  + no locked theory     → soft warning shown, drafting proceeds
   *   false                        → never injected, regardless of theory state
   *
   * These are defaults from the build plan's Decision 1 table. Counsel can
   * override per session in the engine UI (Phase 9). Provisional defaults
   * applied here, extending the plan's explicit table to every current
   * catalogue entry:
   *   - Generic notice/ex-parte/opposition motions are vehicles, not
   *     inherently theory-bearing → false.
   *   - Injunctions (interim & interlocutory) → true, per the plan.
   *   - Bail, Extension of Time, Stay (civil/criminal/appeal), Default
   *     Judgment, Substituted Service, Security for Costs, Preliminary
   *     Objection, Quash Charge, Regularise Records → false — procedural/
   *     technical applications argued on their own discrete test, not on
   *     the merits theory of the case.
   *   - Summary Judgment and Strike Out → true — both turn on whether the
   *     pleaded/evidenced case discloses a sustainable claim or defence,
   *     i.e. they engage the case theory's elements directly.
   */
  needsCaseTheory: boolean;
}

interface ArgumentIssue {
  id:          string;
  issue:       string;
  rule:        string;
  application: string;
  conclusion:  string;
  draft:       string;
}

// Paragraph-level response entry for counter-affidavit drafting
interface AffidavitParaResponse {
  id:        string;
  paraNum:   string;   // paragraph number(s) in the other affidavit
  paraText:  string;   // what that paragraph says
  stance:    'admit' | 'deny' | 'not_known';
  response:  string;   // counsel's own facts in response (if denying / new facts)
}

// Further & Better Affidavit ground
interface FBGround {
  id:        string;
  basis:     'own_affidavit' | 'counter_affidavit';
  paraRef:   string;   // paragraph(s) in the referenced affidavit
  paraText:  string;   // what those paragraphs say
  newFact:   string;   // the new fact / exhibit being introduced
  exhibit:   string;   // exhibit label e.g. "Exhibit C"
}

interface AppFacts {
  parties:           string;
  reliefSought:      string;
  grounds:           string;
  deponent:          string;
  keyFacts:          string;
  additionalContext: string;
  // AI-derived from intPkg — counsel confirms/edits
  autoReliefs:       string;
  autoGrounds:       string;
  autoKeyFacts:      string;
}

// Everything generated in Stage 3 — persisted with the record
interface Stage3Data {
  applicationRole:     ApplicationRole | null;
  // Mover track
  origProcessContext:  string; // Tab 0 — Originating Summons/Application paper itself (questions/grounds/reliefs), counsel instructions
  origProcessDraft:    string; // Tab 0 — drafted Originating Summons/Application
  supportingAffidavitDraft: string; // Tab 1 — Supporting Affidavit pre-draft
  // Mover FB supplement fields
  supplementInstructions:   string;
  supplementExhibits:       string;
  issues:              ArgumentIssue[];
  writtenAddress:      string;
  opposingFiled:       boolean;
  counterAffidavitIn:  string;   // paste of opposing counter-affidavit
  writtenAddressIn:    string;   // paste of opposing written address
  fbGrounds:           FBGround[];
  furtherBetterDraft:  string;
  replyLawPoints:      string;   // counsel's input: which legal points to rebut
  replyLawDraft:       string;
  // Mover track — Further & Better
  furtherBetterTrigger: 'supplement' | 'counter_counter' | 'both' | null;
  moverFBParaResponses: AffidavitParaResponse[]; // client rebuttal para-by-para against counter-affidavit
  // Respondent track — intake (from Stage 2)
  motionPaperIn:             string;  // Motion Paper / Notice of Motion as served
  applicantWrittenAddressIn: string;  // Applicant's Written Address in Support
  // Respondent track — affidavit
  applicantAffidavit:  string;   // paste of applicant's supporting affidavit
  paraResponses:       AffidavitParaResponse[];
  respondentNewFacts:  string;
  respondentDeponent:  string;
  respondentExhibits:  string;
  counterAffidavitDraft: string;
  respIssues:          ArgumentIssue[];
  writtenAddressOpp:   string;
  respOpposingFiled:   boolean;
  // Respondent track — Further Counter-Affidavit (replaces respFBGrounds/respFBDraft)
  leaveObtained:       boolean;
  applicantFBIn:       string;   // Applicant's Further & Better Affidavit paste
  respFCParaResponses: AffidavitParaResponse[]; // client instructions para-by-para
  respFCDraft:         string;   // Further Counter-Affidavit draft
}

interface ApplicationRecord {
  id:        string;
  caseId:    string;
  appType:   string;
  facts:     AppFacts;
  stage3:    Stage3Data;
  documents: string;
  createdAt: string;
}

interface TrackerEntry {
  id:          string;
  appType:     string;
  filedDate:   string;
  hearingDate: string;
  status:      AppStatus;
  ruling:      string;
  notes:       string;
}

interface SavedData    { history: ApplicationRecord[]; }
interface TrackerData  { entries: TrackerEntry[]; }

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION TYPE CATALOGUE
// ─────────────────────────────────────────────────────────────────────────────

export const APP_TYPES: AppTypeConfig[] = [
  // Civil
  { id: 'civil_motion_on_notice', label: 'Motion on Notice', icon: '📋', track: 'civil',
    package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Formal application with notice to the other side — grounds, supporting affidavit, reliefs sought.',
    needsCaseTheory: false },
  { id: 'civil_motion_ex_parte', label: 'Motion Ex Parte', icon: '⚡', track: 'civil',
    package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Urgent application without notice — where giving notice would defeat the purpose or cause irreparable harm.',
    needsCaseTheory: false },
  { id: 'civil_opposition', label: 'Opposition to Motion', icon: '↩', track: 'civil',
    package: ['Counter-Affidavit', 'Written Address in Opposition', 'List of Authorities'],
    hint: 'Opposing an application — counter-affidavit challenging the supporting affidavit and a written address in opposition.',
    needsCaseTheory: false },
  { id: 'civil_interim_injunction', label: 'Interim Injunction', icon: '⏳', track: 'civil',
    package: ['Motion Ex Parte', 'Supporting Affidavit', 'Certificate of Urgency', 'Written Address in Support', 'List of Authorities'],
    hint: 'Short-lived order made ex parte to preserve the status quo pending the hearing of the motion on notice for interlocutory injunction — must show extreme urgency and a real risk of irreparable harm if notice is given to the other side first.',
    needsCaseTheory: true },
  { id: 'civil_interlocutory_injunction', label: 'Interlocutory Injunction', icon: '🚫', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'Undertaking as to Damages', 'List of Authorities'],
    hint: 'On notice, pending the determination of the substantive suit — establish the three conditions: serious question to be tried, balance of convenience, and adequacy of damages. Mandatory or Mareva variants apply the same test with their added requirements.',
    needsCaseTheory: true },
  { id: 'civil_substituted_service', label: 'Substituted Service', icon: '📬', track: 'civil',
    package: ['Motion Ex Parte', 'Affidavit of Attempted/Difficulty of Service', 'Written Address in Support', 'List of Authorities'],
    hint: 'Leave to serve by substituted means — affidavit must show personal service is impracticable (evading service, unknown whereabouts, etc.) and propose a mode reasonably likely to bring the process to the respondent\'s notice (courier, email, newspaper publication, or posting at last known address).',
    needsCaseTheory: false },
  { id: 'civil_default_judgment', label: 'Default Judgment', icon: '⚖', track: 'civil',
    package: ['Motion on Notice', 'Affidavit of Service', 'Written Address in Support', 'List of Authorities'],
    hint: 'Judgment in default of appearance or defence — prove service, show no defence filed, establish entitlement.',
    needsCaseTheory: false },
  { id: 'civil_strike_out', label: 'Strike Out', icon: '✕', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Strike out — no reasonable cause of action, frivolous, vexatious, or abuse of process.',
    needsCaseTheory: true },
  { id: 'civil_stay', label: 'Stay of Proceedings', icon: '⏸', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Stay pending appeal, arbitration, or related proceedings.',
    needsCaseTheory: false },
  { id: 'civil_security_costs', label: 'Security for Costs', icon: '💰', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Security for costs — impecunious or foreign claimant, no fixed place of business in jurisdiction.',
    needsCaseTheory: false },
  { id: 'civil_extension_time', label: 'Extension of Time', icon: '⏰', track: 'civil',
    package: ['Motion on Notice', 'Affidavit Explaining Delay', 'Written Address in Support', 'List of Authorities'],
    hint: 'Extension of time — account for every day of delay; apply Bowaje v Adediwura two-condition test.',
    needsCaseTheory: false },
  { id: 'civil_summary_judgment', label: 'Summary Judgment', icon: '⚖', track: 'civil',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Summary judgment where defendant has no real or bona fide defence — Ord 11 or equivalent. Address each purported defence and why it fails.',
    needsCaseTheory: true },
  { id: 'civil_originating_summons', label: 'Originating Summons', icon: '📜', track: 'civil',
    package: ['Originating Summons', 'Affidavit in Support', 'Written Address in Support', 'List of Authorities'],
    hint: 'Paper-trial originating process for questions of law or document construction unlikely to involve disputed facts — no pleadings, decided on affidavit evidence and written address alone. Questions for determination must be answerable as legal propositions; each question needs a corresponding relief. Opposition uses the Counter-Affidavit / Written Address in Opposition tabs below.',
    needsCaseTheory: true },
  { id: 'civil_originating_application', label: 'Originating Application', icon: '📑', track: 'civil',
    package: ['Originating Application', 'Affidavit in Support', 'Written Address in Support', 'List of Authorities'],
    hint: 'Paper-trial originating process under rules that prescribe "Originating Application" rather than Originating Summons (e.g. NICN, FCT Civil Procedure) — same paper-trial logic: affidavit evidence and written address, no pleadings or oral trial. Opposition uses the Counter-Affidavit / Written Address in Opposition tabs below.',
    needsCaseTheory: true },
  // Criminal
  { id: 'crim_bail', label: 'Bail Application', icon: '🔓', track: 'criminal',
    package: ['Formal Application', 'Affidavit in Support', 'Written Address', 'Proposed Bail Conditions', 'List of Authorities'],
    hint: 'Address community ties, flight risk, gravity of offence, health, dependants. Cite Dokubo-Asari v FRN, Ani v State, Bamaiyi v State.',
    needsCaseTheory: false },
  { id: 'crim_prelim_obj', label: 'Preliminary Objection', icon: '🛡', track: 'criminal',
    package: ['Notice of Preliminary Objection', 'Written Address', 'List of Authorities'],
    hint: 'Jurisdiction, charge duplicity, wrong statute, vague particulars, or missing elements.',
    needsCaseTheory: false },
  { id: 'crim_stay', label: 'Stay of Proceedings (Criminal)', icon: '⏸', track: 'criminal',
    package: ['Motion on Notice', 'Affidavit', 'Written Address', 'List of Authorities'],
    hint: 'Stay pending constitutional challenge, interlocutory appeal, or related civil proceedings.',
    needsCaseTheory: false },
  { id: 'crim_quash', label: 'Quash Charge / Information', icon: '🗑', track: 'criminal',
    package: ['Application to Quash', 'Written Address', 'List of Authorities'],
    hint: 'Charge is fundamentally defective — wrong court, duplicitous counts, no offence known to law.',
    needsCaseTheory: false },
  // Appeal
  { id: 'appeal_extension', label: 'Extension of Time to Appeal', icon: '⏰', track: 'appeal',
    package: ['Motion on Notice', 'Affidavit Explaining Delay', 'Written Address in Support', 'Proposed Notice of Appeal', 'List of Authorities'],
    hint: 'Account for every day of delay. Two conditions: good reason for delay and arguable grounds of appeal.',
    needsCaseTheory: false },
  { id: 'appeal_stay_execution', label: 'Stay of Execution', icon: '⏸', track: 'appeal',
    package: ['Motion on Notice', 'Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Three conditions: good grounds of appeal, special circumstances, balance of hardship. Cite Vaswani Trading Co v Savalakh & Co.',
    needsCaseTheory: false },
  { id: 'appeal_regularise', label: 'Regularise Records / Deem Notice Filed', icon: '📄', track: 'appeal',
    package: ['Motion on Notice', 'Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Regularise steps in appellate proceedings — deem notice of appeal as properly filed, extend time to compile records.',
    needsCaseTheory: false },

  // ── FREP — Fundamental Rights Enforcement Proceedings ────────────────────
  // Phase 3F: FREP originating documents via ApplicationsEngine.
  // Order reflects filing sequence: Applicant originating process first,
  // then interim/ex parte relief, then opposition, then reply.
  { id: 'frep_originating_motion', label: 'FREP — Originating Motion', icon: '⚖', track: 'frep',
    package: [
      'Originating Motion on Notice',
      'Statement (Facts, Grounds, Reliefs)',
      'Supporting Affidavit',
      'Written Address in Support',
      'List of Authorities',
    ],
    hint: 'Primary originating process for FREP under the Fundamental Rights (Enforcement Procedure) Rules 2009. ' +
          'Combines Statement + Supporting Affidavit + Written Address. Court issues Form 1 to all Respondents. ' +
          'Plead each right violated (CFRN provision), the act/omission of each Respondent, and the specific relief sought.',
    needsCaseTheory: true },

  { id: 'frep_originating_summons', label: 'FREP — Originating Summons', icon: '📋', track: 'frep',
    package: [
      'Originating Summons',
      'Statement (Facts, Grounds, Reliefs)',
      'Supporting Affidavit',
      'Written Address in Support',
      'List of Authorities',
    ],
    hint: 'Alternative originating process where the sole or principal question turns on construction of the Constitution or a statute — ' +
          'Order 3 r 1(b) FREP Rules 2009. Questions for determination must be enumerated precisely. ' +
          'Preferred where the facts are not in dispute and the matter is purely a question of law.',
    needsCaseTheory: true },

  { id: 'frep_ex_parte_interim', label: 'FREP — Ex Parte / Interim Relief', icon: '⚡', track: 'frep',
    package: [
      'Ex Parte Originating Motion',
      'Statement',
      'Supporting Affidavit',
      'Certificate of Urgency',
      'Written Address in Support',
      'List of Authorities',
    ],
    hint: 'Urgent ex parte application for interim order under Order 4 FREP Rules 2009. ' +
          'Applicant must satisfy court that the urgency is genuine and that giving notice would defeat the purpose. ' +
          'Certificate of Urgency required. Order must be served on Respondent immediately after grant.',
    needsCaseTheory: true },

  { id: 'frep_opposition_factual', label: 'FREP — Opposition (Factual)', icon: '↩', track: 'frep',
    package: [
      'Counter-Affidavit',
      'Written Address in Opposition',
      'List of Authorities',
    ],
    hint: 'Respondent opposition where the facts are disputed — Counter-Affidavit required within 5 days of service of Applicant\'s affidavit (Order 6 r 1). ' +
          'Counter-Affidavit responds paragraph-by-paragraph: admit, deny, or not within knowledge. ' +
          'Silence on any paragraph of the Supporting Affidavit constitutes an admission.',
    needsCaseTheory: false },

  { id: 'frep_opposition_law_only', label: 'FREP — Opposition (Law Only)', icon: '🛡', track: 'frep',
    package: [
      'Written Address in Opposition',
      'List of Authorities',
    ],
    hint: 'Respondent opposition where no factual dispute exists — Written Address only. ' +
          'All facts in Applicant\'s Supporting Affidavit are taken as admitted. ' +
          'Raise only legal grounds: jurisdiction, locus standi, non-justiciability, constitutional interpretation, or that the act complained of was lawful.',
    needsCaseTheory: false },

  { id: 'frep_reply', label: 'FREP — Applicant\'s Reply', icon: '↗', track: 'frep',
    package: [
      'Further Affidavit (if needed)',
      'Reply on Points of Law',
      'List of Authorities',
    ],
    hint: 'Applicant\'s reply to Respondent\'s opposition. Further Affidavit responds to new facts introduced in Counter-Affidavit. ' +
          'Reply on Points of Law addresses only new legal arguments raised by Respondent — no new reliefs or facts. ' +
          'File within the time directed by court or 5 days after service of opposition.',
    needsCaseTheory: true },

  { id: 'frep_preliminary_objection', label: 'FREP — Preliminary Objection', icon: '🚫', track: 'frep',
    package: [
      'Notice of Preliminary Objection',
      'Written Address in Support',
      'List of Authorities',
    ],
    hint: 'Respondent preliminary objection challenging jurisdiction, locus standi, or competence of the application before the court engages the merits. ' +
          'Common grounds: wrong court (State vs Federal), matter not within Chapter IV CFRN, application statute-barred, Applicant lacks standing, ' +
          'or right not violated by the specific Respondent named.',
    needsCaseTheory: false },
  // ── MATRIMONIAL — MCA Applications (Phase 7A) ────────────────────────────
  // Ports all 9 from MApplications + 2 new (mat_opposition_application, mat_make_absolute path fix).
  // Excluded from 'all' filter — same pattern as FREP.
  { id: 'mat_leave_s30', label: 'Leave to Present Petition', icon: '⚖', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Application for leave to present a matrimonial petition before the two-year waiting period under s.30 MCA. ' +
          'Must invoke one of the statutory exceptions: wilful refusal to consummate; adultery; rape, sodomy or bestiality; ' +
          'or exceptional hardship or depravity suffered by the applicant. Authority: s.30 MCA; O.4 rr.1–2 MCR.',
    needsCaseTheory: false },
  { id: 'mat_alimony_pendente', label: 'Maintenance Pendente Lite', icon: '💰', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'Financial Disclosure Statement', 'List of Authorities'],
    hint: 'Interim maintenance pending the determination of the matrimonial proceedings — s.70 MCA. ' +
          'Affidavit must exhibit evidence of the applicant\'s needs and the respondent\'s means. ' +
          'Addresses housing, food, clothing, medical, and children\'s needs. Court assesses means and conduct.',
    needsCaseTheory: false },
  { id: 'mat_custody_pendente', label: 'Interim Custody Order', icon: '👶', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'Welfare Report (if ordered)', 'List of Authorities'],
    hint: 'Interim custody and/or access order pending final determination — s.71 MCA. ' +
          'Welfare of the child is the paramount consideration. Address: current living arrangements, ' +
          'schooling, health, primary carer history, and any welfare concerns regarding the other party.',
    needsCaseTheory: false },
  { id: 'mat_restraining_injunction', label: 'Restraining Injunction — Asset Dissipation', icon: '🚫', track: 'matrimonial',
    package: ['Motion Ex Parte', 'Supporting Affidavit', 'Written Address in Support', 'Schedule of Assets', 'Undertaking as to Damages', 'List of Authorities'],
    hint: 'Injunction to restrain disposal, dissipation, or transfer of matrimonial assets pending ancillary relief proceedings. ' +
          'Based on inherent jurisdiction of the court. Must show: real risk of dissipation, identified assets, ' +
          'and that the balance of convenience favours the order. Often sought ex parte for urgency.',
    needsCaseTheory: false },
  { id: 'mat_occupation_order', label: 'Occupation Order — Matrimonial Home', icon: '🏠', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Order for exclusive occupation of the matrimonial home pending determination of property rights. ' +
          'Available under MCA and inherent jurisdiction. Address: ownership, financial contributions, ' +
          'children\'s needs, conduct, and hardship to each party if order is made or refused.',
    needsCaseTheory: false },
  { id: 'mat_financial_disclosure', label: 'Financial Disclosure Order', icon: '📊', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'Draft Disclosure Order', 'List of Authorities'],
    hint: 'Application for compulsory financial disclosure from the other party — O.11 MCR and the Compulsory Conference procedure. ' +
          'Used where voluntary disclosure has failed or been incomplete. Must specify the documents or information sought ' +
          'and the relevance to the ancillary relief claim.',
    needsCaseTheory: false },
  { id: 'mat_make_absolute', label: 'Application to Make Decree Absolute', icon: '📜', track: 'matrimonial',
    package: ['Application (s.57 or s.58 MCA)', 'Supporting Affidavit', 'Decree Nisi Order', 'Children Welfare Compliance Certificate (s.57)', 'List of Authorities'],
    hint: 'Application to convert decree nisi to decree absolute. Two paths under MCA: ' +
          's.57 path — 28 days after all children welfare orders are settled; ' +
          's.58 path — 3 months from decree nisi where no children order is required. ' +
          'Affidavit must confirm: no appeal pending, no reconciliation, and (s.57 path) all welfare orders in place.',
    needsCaseTheory: false },
  { id: 'mat_variation_order', label: 'Variation of Maintenance / Custody Order', icon: '🔄', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'Copy of Original Order', 'List of Authorities'],
    hint: 'Application to vary, suspend, or discharge an existing maintenance or custody order — s.45 and s.70 MCA. ' +
          'Must show material change in circumstances since the original order: ' +
          'change in income, remarriage, child\'s welfare needs, relocation, or other supervening events.',
    needsCaseTheory: false },
  { id: 'mat_transfer_forum', label: 'Transfer of Forum', icon: '🏛', track: 'matrimonial',
    package: ['Motion on Notice', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
    hint: 'Application to transfer matrimonial proceedings to a different High Court under s.9(2) MCA. ' +
          'Grounds include: convenience of parties and witnesses, location of matrimonial home, ' +
          'domicile or habitual residence, or administration of justice.',
    needsCaseTheory: false },
  { id: 'mat_substituted_svc', label: 'Substituted Service', icon: '📬', track: 'matrimonial',
    package: ['Motion Ex Parte', 'Affidavit of Attempted Service', 'Written Address in Support', 'List of Authorities'],
    hint: 'Application for leave to effect substituted service of the matrimonial petition — O.7 MCR. ' +
          'Affidavit must show that personal service has been attempted and is impracticable, ' +
          'and propose a mode of service reasonably likely to bring the petition to the respondent\'s notice ' +
          '(courier, newspaper publication, last known address, or email).',
    needsCaseTheory: false },
  { id: 'mat_opposition_application', label: 'Opposition to Application', icon: '↩', track: 'matrimonial',
    package: ['Counter-Affidavit', 'Written Address in Opposition', 'List of Authorities'],
    hint: 'Respondent opposition to any matrimonial interlocutory application — MCR general procedure. ' +
          'Counter-affidavit challenges the supporting affidavit paragraph by paragraph. ' +
          'Written address addresses legal and factual grounds for refusing the relief sought.',
    needsCaseTheory: false },
];

const DEFAULT_FACTS: AppFacts = {
  parties: '', reliefSought: '', grounds: '', deponent: '', keyFacts: '', additionalContext: '',
  autoReliefs: '', autoGrounds: '', autoKeyFacts: '',
};

const MODULE      = 'applications_v2';
const TRACKER_MOD = 'app_tracker';
const WORKER_URL   = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const APP_STATUSES: AppStatus[] = ['Drafting', 'Filed', 'Served', 'Awaiting Hearing', 'Heard', 'Granted', 'Refused', 'Withdrawn'];

// ─────────────────────────────────────────────────────────────────────────────
// WORKER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function workerSave(record: ApplicationRecord): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/application`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* offline — local save is source of truth */ }
}

async function workerLoad(caseId: string): Promise<ApplicationRecord[]> {
  try {
    const res = await fetch(`${WORKER_URL}/applications?caseId=${encodeURIComponent(caseId)}`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { records?: ApplicationRecord[] };
    return data.records ?? [];
  } catch { return []; }
}

async function workerDelete(id: string): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/application?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* offline */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Btn({
  label, onClick, loading = false, accent = '#4090d0', off = false, small = false,
}: {
  label: string; onClick: () => void; loading?: boolean; accent?: string; off?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || off}
      style={{
        background: loading || off ? '#101018' : `linear-gradient(135deg,#000000,${accent})`,
        color:   loading || off ? '#2a2a38' : '#f0ece0',
        border: 'none', borderRadius: 6,
        padding: small ? '7px 16px' : '11px 26px',
        fontSize: small ? 12 : 14,
        fontFamily: "'Times New Roman', Times, serif",
        cursor: loading || off ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function StepBadge({ n, active, done }: { n: number; active: boolean; done?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: '50%',
      background: done ? '#40a060' : active ? '#4090d0' : '#181828',
      color: (done || active) ? '#fff' : '#505068',
      fontWeight: 700, fontSize: 12,
      border: `1px solid ${done ? '#40a060' : active ? '#4090d0' : '#282840'}`,
      flexShrink: 0,
    }}>
      {done ? '✓' : n}
    </span>
  );
}

function SLabel({ text }: { text: string }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, color: '#808098',
      fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6,
    }}>{text}</label>
  );
}

function TA({
  value, onChange, placeholder = '', rows = 4, disabled = false,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      style={{
        width: '100%', background: '#0a0a14', border: '1px solid #1e1e34',
        borderRadius: 6, padding: '10px 12px', color: '#e8e4d8', fontSize: 13,
        fontFamily: "'Times New Roman', Times, serif", resize: 'vertical',
        boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function MandatoryNotice() {
  return (
    <div style={{
      background: '#1a1000', border: '1px solid #5a3800', borderRadius: 6,
      padding: '10px 14px', marginTop: 18, fontSize: 12, color: '#c09040', lineHeight: 1.6,
    }}>
      <strong>⚠ Counsel Review Required.</strong> All documents are AI-generated starting points.
      Review and settle every document before filing. Any affidavit must be duly sworn before
      a Commissioner for Oaths or other competent authority.
    </div>
  );
}

function StatusBadge({ status }: { status: AppStatus }) {
  const map: Record<AppStatus, string> = {
    Drafting:          '#8060c0',
    Filed:             '#4090d0',
    Served:            '#40a0c0',
    'Awaiting Hearing':'#c09030',
    Heard:             '#c09030',
    Granted:           '#40a860',
    Refused:           '#c05050',
    Withdrawn:         '#505068',
  };
  const col = map[status] ?? '#606070';
  return (
    <span style={{
      fontSize: 9, color: col, border: `1px solid ${col}40`, borderRadius: 3,
      padding: '1px 6px', fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700,
    }}>
      {status}
    </span>
  );
}

function StatuteChunksPanel({ chunks, error }: { chunks: StatuteChunk[]; error?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (error) return (
    <div style={{ background: '#0e0a04', border: '1px solid #2a1808', borderRadius: 6, padding: '10px 14px', marginBottom: 14 }}>
      <p style={{ fontSize: 11, color: '#808098', fontFamily: "'Times New Roman', Times, serif" }}>⚠ Statute RAG: {error}</p>
    </div>
  );
  if (!chunks.length) return null;
  return (
    <div style={{ background: '#050d06', border: '1px solid #1a3020', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 14 : 0 }}>
        <span style={{ fontSize: 10, color: '#40b060', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>
          § Statute RAG — {chunks.length} section{chunks.length !== 1 ? 's' : ''} retrieved
        </span>
        <button onClick={() => setExpanded(v => !v)}
          style={{ background: 'transparent', border: '1px solid #1a3020', color: '#40b060', borderRadius: 3, padding: '3px 10px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
          {expanded ? 'Collapse' : 'Preview ↓'}
        </button>
      </div>
      {expanded && chunks.map((c, i) => (
        <div key={i} style={{ background: '#030a04', border: '1px solid #0e2014', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: '#40b060', fontWeight: 700 }}>{c.section}</span>
            <span style={{ fontSize: 10, color: '#505068' }}>{c.actName}</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#303048', border: '1px solid #0a1a10', padding: '1px 5px', borderRadius: 2 }}>{Math.round(c.score * 100)}%</span>
          </div>
          <p style={{ fontSize: 12, color: '#a0a0b8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {c.text.slice(0, 280)}{c.text.length > 280 ? '…' : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3D — THEORY MERGE PANEL
// unlock → diff → edit → relock + diff log
//
// Standalone component. Rendered by ArgumentBuilderStage in both:
//   • Mover track  (Opposing Response tab)   — after moverDetectedTheory
//   • Respondent track (Counter-Affidavit tab) — after respDetectedTheory
//
// Props:
//   detected      — the DetectedOpponentTheory from 3B / 3C
//   current       — current locked/unlocked CaseTheoryRecord (may be null)
//   locked        — whether the theory is currently locked
//   caseId        — for storage calls
//   partyLabel    — "Opponent" (Mover track) | "Mover" (Respondent track)
//   onDone        — called after re-lock; triggers reload + panel close
//   onDismiss     — called when counsel cancels without merging
// ─────────────────────────────────────────────────────────────────────────────

interface TheoryMergePanelProps {
  detected:   DetectedOpponentTheory;
  current:    CaseTheoryRecord | null;
  locked:     boolean;
  caseId:     string;
  partyLabel: string;
  onDone:     () => void;
  onDismiss:  () => void;
}

function TheoryMergePanel({
  detected, current, locked, caseId, partyLabel, onDone, onDismiss,
}: TheoryMergePanelProps) {
  // Editable fields — pre-filled from detected theory; counsel may adjust
  const [editOpposing,  setEditOpposing]  = useState(detected.core_proposition);
  const [editKiller,    setEditKiller]    = useState(detected.theory_killer_target ?? current?.theory_killer ?? '');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [phase, setPhase] = useState<'review' | 'done'>('review');

  // Diff helpers — compare proposed vs current
  const prevOpposing = current?.opposing_theory ?? '(none)';
  const prevKiller   = current?.theory_killer   ?? '(none)';
  const opposingChanged = editOpposing.trim() !== prevOpposing && prevOpposing !== '(none)';
  const killerChanged   = editKiller.trim()   !== prevKiller   && prevKiller   !== '(none)';

  async function handleRelock() {
    if (!editOpposing.trim()) { setError('Opposing theory cannot be empty.'); return; }
    setSaving(true);
    setError(null);
    try {
      // 1. Unlock (records history entry)
      if (locked) {
        await unlockCaseTheory(caseId, `Phase 3D — ${partyLabel} theory merge from detected ${detected.source.replace(/_/g, ' ')}`);
      }
      // 2. Save merged record
      const base: CaseTheoryRecord = current ?? {
        core_proposition: '',
        elements:         [],
        opposing_theory:  '',
        theory_killer:    '',
        weakest_link:     '',
        narrative_theme:  '',
        gap_report:       [],
        score_breakdown:  { legal_sufficiency: 0, evidence_coverage: 0, vulnerability: 0, narrative_coherence: 0, jurisdictional_precision: 0, total: 0 },
      };
      await saveCaseTheory(caseId, {
        ...base,
        opposing_theory: editOpposing.trim(),
        theory_killer:   editKiller.trim(),
      });
      // 3. Re-lock (increments version, records lock timestamp)
      await lockCaseTheory(caseId);
      setPhase('done');
    } catch (e: any) {
      setError(e?.message ?? 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'done') {
    return (
      <div style={{ background: '#060e06', border: '1px solid #1a401a', borderRadius: 8, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: '#50c060', fontWeight: 700, marginBottom: 8 }}>✓ Theory updated and re-locked</div>
        <div style={{ fontSize: 12, color: '#407050', marginBottom: 12, lineHeight: 1.55 }}>
          Opposing theory and theory killer updated. Version incremented. Downstream engines (Written Address, Final Address) will pick up the new lock on next load.
        </div>
        <button onClick={onDone}
          style={{ background: 'transparent', border: '1px solid #1e3a1e', borderRadius: 5, padding: '6px 14px', fontSize: 12, color: '#40a060', cursor: 'pointer' }}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: '#07101e', border: '1px solid #2a3a5a', borderRadius: 8, padding: '18px 20px', marginBottom: 18 }}>
      {/* Header */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#a0c0e0', marginBottom: 4 }}>
        ⚖ Theory Merge — Phase 3D
      </div>
      <div style={{ fontSize: 12, color: '#505070', marginBottom: 18, lineHeight: 1.55 }}>
        Review the detected theory below. Edit if needed, then re-lock.
        {locked && <span style={{ color: '#c09040' }}> The current lock will be released and a new version created.</span>}
      </div>

      {/* Diff: opposing_theory */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#606080', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Opposing Theory ({partyLabel})
        </div>
        {opposingChanged && (
          <div style={{ fontSize: 11, color: '#c09040', marginBottom: 6, fontStyle: 'italic', paddingLeft: 10, borderLeft: '2px solid #5a4010' }}>
            Was: {prevOpposing}
          </div>
        )}
        <textarea
          value={editOpposing}
          onChange={e => setEditOpposing(e.target.value)}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#050d1a', border: '1px solid #1e2e48',
            borderRadius: 6, padding: '10px 12px', fontSize: 13,
            color: '#d0ccc0', lineHeight: 1.6, resize: 'vertical',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        />
      </div>

      {/* Diff: theory_killer */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#606080', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Theory Killer — the one fact/document that defeats their position
        </div>
        {killerChanged && (
          <div style={{ fontSize: 11, color: '#c09040', marginBottom: 6, fontStyle: 'italic', paddingLeft: 10, borderLeft: '2px solid #5a4010' }}>
            Was: {prevKiller}
          </div>
        )}
        <textarea
          value={editKiller}
          onChange={e => setEditKiller(e.target.value)}
          rows={2}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#050d1a', border: '1px solid #1e2e48',
            borderRadius: 6, padding: '10px 12px', fontSize: 13,
            color: '#d0ccc0', lineHeight: 1.6, resize: 'vertical',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        />
      </div>

      {/* Key arguments — read-only reference */}
      {detected.key_arguments.length > 0 && (
        <div style={{ background: '#050a14', border: '1px solid #1a2030', borderRadius: 6, padding: '12px 14px', marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#404060', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Detected Key Arguments (reference only — not stored separately)
          </div>
          {detected.key_arguments.map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: '#606080', lineHeight: 1.5, marginBottom: 4 }}>
              {i + 1}. {a}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#c06060', marginBottom: 12 }}>⚠ {error}</div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={handleRelock}
          disabled={saving}
          style={{
            background: saving ? '#0a1020' : '#0c2040',
            border: '1px solid #2050a0', borderRadius: 6,
            padding: '9px 18px', fontSize: 12, fontWeight: 600,
            color: saving ? '#404060' : '#90c0f0',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: "'Times New Roman', Times, serif",
          }}>
          {saving ? '⏳ Saving…' : locked ? '🔓 Unlock → Merge → 🔒 Re-lock' : '✓ Merge + Lock'}
        </button>
        <button
          onClick={onDismiss}
          disabled={saving}
          style={{
            background: 'transparent', border: '1px solid #1e1e34',
            borderRadius: 6, padding: '9px 14px', fontSize: 12,
            color: '#404060', cursor: saving ? 'not-allowed' : 'pointer',
          }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3 — ARGUMENT BUILDER (dual-track: Mover / Respondent to Application)
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared: issue-by-issue IRAC builder (used by both tracks) ────────────────

interface IssueBuilderProps {
  activeCase:      Case;
  appType:         AppTypeConfig;
  facts:           AppFacts;
  issues:          ArgumentIssue[];
  onIssuesChange:  (v: ArgumentIssue[]) => void;
  writtenAddress:  string;
  onAddressChange: (v: string) => void;
  side:            'support' | 'opposition';
  systemCtx:       string;
  // 2D-ii — populated when a template skeleton was injected into the last draft call
  templateBadge?:  { appType: string; jurisdiction: string } | null;
  onTemplateBadge?: (badge: { appType: string; jurisdiction: string } | null) => void;
}

function IssueBuilder({
  activeCase, appType, facts, issues, onIssuesChange,
  writtenAddress, onAddressChange, side, systemCtx,
  templateBadge, onTemplateBadge,
}: IssueBuilderProps) {
  const { ask, loading, error, clearError } = useAI(activeCase);
  // Phase 9D — light theory injection when appType.needsCaseTheory is true
  const { theory: issueTheory, hasTheory: issueHasTheory } = useCaseTheory(activeCase.id);
  // Phase 10C — jurisdiction delta, resolved once per render and reused by generateIssue and assembleAddress.
  // Named issueBuilderLawDelta to distinguish from the memoized lawDelta in the main ApplicationsEngine component.
  const jurisdiction = (activeCase as any).jurisdiction ?? activeCase.court ?? '';
  const issueBuilderLawDelta = getJurisdictionDeltaSync(appType.label, jurisdiction);
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [draftIssue,      setDraftIssue]      = useState<ArgumentIssue | null>(null);
  const [statuteChunks,   setStatuteChunks]   = useState<StatuteChunk[]>([]);
  const [statuteRagError, setStatuteRagError] = useState('');
  const [ragFetching,     setRagFetching]     = useState(false);
  const [deleteModal,     setDeleteModal]     = useState<string | null>(null);

  // 2D-iii — Save as Template modal state
  interface SaveTemplateModal {
    skeleton:            string;
    appType:             string;
    jurisdiction:        string;
    court_level:         string;
    statutory_basis:     string;
    leading_authorities: string;
    tests:               string;
    stripping:           boolean;   // AI stripping in progress
    duplicateWarning:    boolean;   // a template already exists for this appType × jurisdiction
  }
  const [saveModal,    setSaveModal]    = useState<SaveTemplateModal | null>(null);
  const [saveToast,    setSaveToast]    = useState('');
  const [savingTpl,    setSavingTpl]    = useState(false);

  const sideLabel = side === 'support' ? 'Written Address in Support' : 'Written Address in Opposition';

  function startNew() {
    setDraftIssue({ id: uid(), issue: '', rule: '', application: '', conclusion: '', draft: '' });
    setEditingId(null);
  }
  function startEdit(iss: ArgumentIssue) { setDraftIssue({ ...iss }); setEditingId(iss.id); }
  function cancelEdit() { setDraftIssue(null); setEditingId(null); clearError(); }
  function removeIssue(id: string) {
    setDeleteModal(id);
  }
  function confirmRemoveIssue() {
    if (!deleteModal) return;
    onIssuesChange(issues.filter(i => i.id !== deleteModal));
    setDeleteModal(null);
  }

  async function generateIssue() {
    if (!draftIssue) return;
    setStatuteChunks([]); setStatuteRagError('');
    // 2D-ii — clear any badge from a previous run
    onTemplateBadge?.(null);

    // ── Pre-draft template lookup (Phase 10B refactor) ────────────────────
    // The full template object is now passed to buildDraftSystemPrompt (Layer 3).
    // The badge state retains its { appType, jurisdiction } shape for the badge UI.
    // skeletonBlock is retired — skeleton assembly is inside buildDraftSystemPrompt.
    let matchedTemplateBadge: { appType: string; jurisdiction: string } | null = null;
    let foundTemplate: ArgumentTemplate | null = null;
    try {
      const tpl = await db.argument_templates
        .where({ appType: appType.label, jurisdiction })
        .first();
      if (tpl) {
        foundTemplate        = tpl ?? null;
        matchedTemplateBadge = { appType: tpl.appType, jurisdiction: tpl.jurisdiction };
      }
    } catch {
      // Template lookup failure is non-fatal — proceed with standard draft
    }
    // ── RAG statute lookup (unchanged) ────────────────────────────────────
    let statuteSections = '';
    if (isRagConfigured() && draftIssue.issue) {
      setRagFetching(true);
      const ragResult = await queryStatutes(
        buildRagQuery({ argIssue: draftIssue.issue, argType: 'written_address_application', legalIssues: [draftIssue.issue], caseName: activeCase.caseName }),
        { topK: 5 },
      );
      setRagFetching(false);
      if (!ragResult.skipped && ragResult.chunks.length > 0) {
        setStatuteChunks(ragResult.chunks);
        statuteSections = formatStatutesForPrompt(ragResult.chunks);
      } else if (ragResult.error) { setStatuteRagError(ragResult.error); }
    }

    const prompt = `Draft one issue of a ${sideLabel} for a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'} | ROLE: ${activeCase.counsel_role ?? 'claimant_side'}
POSITION IN THIS APPLICATION: ${side === 'support' ? 'We filed this application — arguing in support' : 'We are opposing this application — arguing against it'}

ISSUE: ${draftIssue.issue}
RULE OF LAW: ${draftIssue.rule}
APPLICATION TO FACTS: ${draftIssue.application}
CONCLUSION: ${draftIssue.conclusion}

APPLICATION FACTS:
Relief Sought: ${facts.reliefSought}
Grounds: ${facts.grounds}
Key Facts: ${facts.keyFacts}

${statuteSections ? 'VERIFIED STATUTE SECTIONS (cite directly — these are confirmed):\n' + statuteSections + '\n' : ''}

RULES:
- IRAC: Issue heading → Rule → Application to Facts → Conclusion
- ${statuteSections ? 'Cite provided statute sections directly.' : 'Cite statutes by name and section only — do not invent text.'}
- Cases you are CERTAIN exist: [Case Name] (Year) Court — [holding]
- Cases you need but cannot verify — use EXACTLY:
[RESEARCH NEEDED]
Proposition: [one sentence — what this authority must establish]
Area of law: [e.g. Contract / Land Law / Criminal Procedure / Evidence / Constitutional Law]
Court level needed: [Supreme Court | Court of Appeal | High Court]
LawPavilion search 1: [3–5 keyword phrase]
LawPavilion search 2: [alternative angle]
LawPavilion search 3: [narrower term of art]
What the case must decide: [required ratio/holding in one sentence]
[/RESEARCH NEEDED]
- NEVER invent a case name, citation, year, volume, or law report.
- Begin immediately with the issue heading.`;

    // ── Assemble system prompt via buildDraftSystemPrompt (Phase 10B)
    // Layer 1: systemCtx (role + intelligence)
    // Layer 2: issueBuilderLawDelta — wired via getJurisdictionDeltaSync (Phase 10C)
    // Layer 3: template skeleton (foundTemplate from lookup above, or null)
    // Layer 4: theory — gated on needsCaseTheory + locked theory
    // Layer 5: per-call instruction
    const systemPrompt = buildDraftSystemPrompt({
      systemCtx,
      appType,
      template:        foundTemplate,
      theory:          appType.needsCaseTheory && issueHasTheory && issueTheory ? issueTheory : null,
      lawDelta:        issueBuilderLawDelta,
      callInstruction: 'You are drafting one issue of a Written Address for a Nigerian court. NEVER invent case citations. Use [RESEARCH NEEDED] blocks for uncertain authority.',
    });

    const result = await ask({
      system: systemPrompt,
      userMsg: prompt, maxTokens: 2000,
      libraryOpts: { queryHint: `${appType.label} ${draftIssue.issue} Nigerian court`, topK: 6 },
    });
    if (result) {
      setDraftIssue(prev => prev ? { ...prev, draft: result.trim() } : prev);
      // 2D-ii — raise badge to parent only when a template was used
      if (matchedTemplateBadge) onTemplateBadge?.(matchedTemplateBadge);
    }
  }

  // 2D-iii — open the Save as Template flow from a completed assembled address
  async function handleSaveAsTemplate(draft: string) {
    const jurisdiction = (activeCase as any).jurisdiction ?? activeCase.court ?? '';
    // Check for duplicate before stripping
    let duplicateWarning = false;
    try {
      const existing = await db.argument_templates
        .where({ appType: appType.label, jurisdiction })
        .first();
      if (existing) duplicateWarning = true;
    } catch { /* non-fatal */ }

    // Open modal in stripping state — skeleton field blank until AI returns
    setSaveModal({
      skeleton: '',
      appType: appType.label,
      jurisdiction,
      court_level: (activeCase as any).court_level ?? '',
      statutory_basis: '',
      leading_authorities: '',
      tests: '',
      stripping: true,
      duplicateWarning,
    });

    // AI strip call
    const strippingPrompt = `You are given a completed legal argument draft. Extract the reusable structural skeleton only.

Remove:
- All references to specific parties (replace with [PARTY])
- All specific dates (replace with [DATE])
- All specific amounts (replace with [AMOUNT])
- All specific locations unless they are jurisdictional identifiers
- All case-specific facts

Preserve:
- Legal framework and structure
- Statutory provisions and how they are applied
- Legal tests and how they are structured
- Argument flow and headings
- Authorities cited (these are reusable)

Return ONLY the stripped skeleton. No preamble.

DRAFT:
${draft}`;

    const skeleton = await ask({
      system: 'You extract reusable argument skeletons from completed Nigerian legal drafts. Return only the skeleton — no preamble, no explanation.',
      userMsg: strippingPrompt,
      maxTokens: 2000,
    });

    setSaveModal(prev => prev ? { ...prev, skeleton: skeleton?.trim() ?? '', stripping: false } : null);
  }

  // 2D-iii — write the confirmed template to db.argument_templates
  async function confirmSaveTemplate() {
    if (!saveModal) return;
    if (!saveModal.appType || !saveModal.jurisdiction || !saveModal.skeleton.trim()) return;
    setSavingTpl(true);
    try {
      await db.argument_templates.add({
        id:                  uid(),
        appType:             saveModal.appType,
        jurisdiction:         saveModal.jurisdiction,
        court_level:          saveModal.court_level,
        skeleton:             saveModal.skeleton,
        statutory_basis:      saveModal.statutory_basis,
        leading_authorities:  saveModal.leading_authorities,
        tests:                saveModal.tests,
        law_delta:            '',
        needsCaseTheory:      appType.needsCaseTheory,
        created_at:           new Date().toISOString(),
        updated_at:           new Date().toISOString(),
      });
      setSaveModal(null);
      setSaveToast(`Template saved — ${saveModal.appType} / ${saveModal.jurisdiction}`);
      setTimeout(() => setSaveToast(''), 4000);
    } catch (e) {
      setSaveToast('Save failed — check storage.');
      setTimeout(() => setSaveToast(''), 4000);
    } finally {
      setSavingTpl(false);
    }
  }

  function saveIssue() {
    if (!draftIssue) return;
    if (editingId) { onIssuesChange(issues.map(i => i.id === editingId ? draftIssue : i)); }
    else { onIssuesChange([...issues, draftIssue]); }
    setDraftIssue(null); setEditingId(null); clearError();
  }

  async function assembleAddress() {
    if (!issues.length) return;
    const issueBlocks = issues.map((iss, i) =>
      `ISSUE ${i + 1}: ${iss.issue}\nRule: ${iss.rule}\nApplication: ${iss.application}\nConclusion: ${iss.conclusion}${iss.draft ? '\n\nDRAFTED ARGUMENT:\n' + iss.draft : ''}`
    ).join('\n\n---\n\n');

    const prompt = `Assemble a complete ${sideLabel} for a ${appType.label} from these issue arguments.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
POSITION: ${side === 'support' ? 'We are the Applicant/Mover — urging the court to GRANT the application' : 'We are the Respondent — urging the court to REFUSE the application'}

STRUCTURE:
1. INTRODUCTION — introducing the application and our position
2. ISSUES FOR DETERMINATION — numbered list
3. ARGUMENTS — each issue in sequence, refined and elevated from the drafts below
4. CONCLUSION AND RELIEF SOUGHT — why the court should ${side === 'support' ? 'grant' : 'refuse'} the application; reliefs in numbered form

ISSUE ARGUMENTS:
${issueBlocks}

APPLICATION FACTS:
${facts.reliefSought ? 'Relief Sought: ' + facts.reliefSought : ''}
${facts.grounds ? 'Grounds: ' + facts.grounds : ''}
${facts.keyFacts ? 'Key Facts: ' + facts.keyFacts : ''}

- Never invent case citations. Use [RESEARCH NEEDED] blocks.
- Write as senior counsel addressing a superior court.
- Begin with the INTRODUCTION heading.`;

    const result = await ask({
      system: buildDraftSystemPrompt({
        systemCtx,
        appType,
        template:  null,   // assembleAddress merges pre-drafted issues — no skeleton needed
        theory:    appType.needsCaseTheory && issueHasTheory && issueTheory ? issueTheory : null,
        lawDelta:  issueBuilderLawDelta,
      }),
      userMsg: prompt, maxTokens: 3500,
      libraryOpts: { queryHint: `${appType.label} written address Nigerian court procedure`, topK: 8 },
    });
    if (result) onAddressChange(result.trim());
  }

  return (
    <div>
      {deleteModal && (
        <TypeDeleteModal
          label="issue"
          onConfirm={confirmRemoveIssue}
          onCancel={() => setDeleteModal(null)}
        />
      )}

      <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
        Build the {sideLabel} issue by issue. Each issue uses IRAC — Issue → Rule → Application → Conclusion.
        Statute RAG fires automatically. When all issues are ready, assemble into the full Written Address.
      </div>

      {error && <ErrorBlock message={error} />}

      {/* Issue list */}
      {issues.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {issues.map((iss, i) => (
            <div key={iss.id} style={{
              background: '#080814', border: `1px solid ${editingId === iss.id ? '#4090d0' : '#1e1e34'}`,
              borderRadius: 7, padding: '14px 16px', marginBottom: 10,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#4090d0', fontWeight: 600, marginBottom: 4 }}>
                  Issue {i + 1}: {iss.issue || '(untitled)'}
                </div>
                {iss.rule && <div style={{ fontSize: 12, color: '#808098', marginBottom: 2 }}>Rule: {iss.rule.slice(0, 80)}{iss.rule.length > 80 ? '…' : ''}</div>}
                {iss.draft && <div style={{ fontSize: 11, color: '#40a060', marginTop: 4 }}>✓ Argument drafted</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => startEdit(iss)}
                  style={{ background: 'transparent', border: '1px solid #2a2a40', color: '#808098', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "\'Times New Roman\', Times, serif" }}>Edit</button>
                <button onClick={() => removeIssue(iss.id)}
                  style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Issue editor */}
      {draftIssue ? (
        <div style={{ background: '#080814', border: '1px solid #4090d030', borderRadius: 8, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
            {editingId ? 'Edit Issue' : 'New Issue'}
          </div>
          <div style={{ marginBottom: 12 }}>
            <SLabel text="Issue (legal question for determination)" />
            <TA value={draftIssue.issue} onChange={v => setDraftIssue(p => p ? { ...p, issue: v } : p)}
              placeholder="e.g. Whether the defendant's failure to file a defence within time entitles the claimant to judgment in default"
              rows={2} disabled={loading} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <SLabel text="Rule of Law (statute / principle)" />
            <TA value={draftIssue.rule} onChange={v => setDraftIssue(p => p ? { ...p, rule: v } : p)}
              placeholder="e.g. Order 8 Rule 7, Federal High Court (Civil Procedure) Rules 2019"
              rows={2} disabled={loading} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <SLabel text="Application to Facts" />
            <TA value={draftIssue.application} onChange={v => setDraftIssue(p => p ? { ...p, application: v } : p)}
              placeholder="How the rule applies to the specific facts of this case…"
              rows={3} disabled={loading} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <SLabel text="Conclusion" />
            <TA value={draftIssue.conclusion} onChange={v => setDraftIssue(p => p ? { ...p, conclusion: v } : p)}
              placeholder="What the court is urged to find / do on this issue…"
              rows={2} disabled={loading} />
          </div>

          {isRagConfigured() && !ragFetching && (
            <div style={{ fontSize: 11, color: '#40b060', marginBottom: 8 }}>§ Statute RAG active — retrieves sections automatically on generation.</div>
          )}
          {ragFetching && <div style={{ fontSize: 11, color: '#40b060', marginBottom: 8 }}>⟳ Searching statute library…</div>}
          <StatuteChunksPanel chunks={statuteChunks} error={statuteRagError} />

          {draftIssue.draft && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Argument drafted — review below</div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 6, padding: '14px 16px', lineHeight: 1.85, fontSize: 13, maxHeight: 360, overflowY: 'auto' }}>
                <Md text={draftIssue.draft} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn label={draftIssue.draft ? '↻ Re-generate' : '✍ Generate Argument'}
              onClick={generateIssue} loading={loading} accent="#4090d0" off={!draftIssue.issue.trim()} />
            <Btn label={editingId ? '✓ Update Issue' : '✓ Save Issue'}
              onClick={saveIssue} accent="#40a060" off={!draftIssue.issue.trim()} />
            <button onClick={cancelEdit}
              style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 12, fontFamily: "\'Times New Roman\', Times, serif" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <Btn label="+ Add Issue" onClick={startNew} accent="#4090d0" />
        </div>
      )}

      {/* Assemble */}
      {issues.length > 0 && !draftIssue && (
        <div style={{ borderTop: '1px solid #181828', paddingTop: 20 }}>
          {writtenAddress && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, color: '#40a060' }}>✓ {sideLabel} assembled</div>
                {/* 2D-iii — Save as Template trigger */}
                <button
                  onClick={() => handleSaveAsTemplate(writtenAddress)}
                  disabled={loading}
                  style={{
                    background: 'none', border: '1px solid #303050', borderRadius: 4,
                    color: '#6060a0', fontSize: 11, padding: '2px 10px', cursor: 'pointer',
                    fontFamily: "'Times New Roman', Times, serif",
                  }}
                >
                  🗂 Save as Template
                </button>
              </div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', lineHeight: 1.85, fontSize: 13, maxHeight: 320, overflowY: 'auto' }}>
                <Md text={writtenAddress} />
              </div>
            </div>
          )}
          <Btn
            label={writtenAddress ? `↻ Re-assemble ${sideLabel}` : `⚖ Assemble ${sideLabel}`}
            onClick={assembleAddress} loading={loading} accent="#4090d0"
          />
        </div>
      )}

      {/* 2D-iii — Toast */}
      {saveToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#101824', border: '1px solid #4090d0', borderRadius: 6,
          padding: '10px 20px', fontSize: 12, color: '#c0d8f0', zIndex: 9999,
          boxShadow: '0 4px 20px #00000080',
        }}>
          {saveToast}
        </div>
      )}

      {/* 2D-iii — Save as Template modal */}
      {saveModal && (
        <div style={{
          position: 'fixed', inset: 0, background: '#00000090', zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#0c0c1a', border: '1px solid #2a2a48', borderRadius: 10,
            padding: '24px 28px', width: '100%', maxWidth: 660,
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
              🗂 Save as Template
            </div>
            <div style={{ fontSize: 11, color: '#808098', marginBottom: 18 }}>
              The skeleton below has had case-specific facts stripped by AI. Review and edit before saving.
              Saved templates are applied automatically to future drafts for the same application type and jurisdiction.
            </div>

            {saveModal.duplicateWarning && (
              <div style={{
                background: '#1a1208', border: '1px solid #806030', borderRadius: 5,
                padding: '10px 14px', fontSize: 11, color: '#c09040', marginBottom: 16,
              }}>
                ⚠ A template already exists for <strong>{saveModal.appType}</strong> in <strong>{saveModal.jurisdiction}</strong>.
                Saving will create a second template. To replace, delete the existing one from the Templates tab first.
              </div>
            )}

            {saveModal.stripping ? (
              <div style={{ color: '#4090d0', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                ⟳ Stripping case-specific facts…
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Read-only identity fields */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>Application Type</div>
                    <div style={{ fontSize: 12, color: '#c0c0d8', background: '#080812', border: '1px solid #1e1e34', borderRadius: 4, padding: '6px 10px' }}>
                      {saveModal.appType}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>Jurisdiction</div>
                    <div style={{ fontSize: 12, color: '#c0c0d8', background: '#080812', border: '1px solid #1e1e34', borderRadius: 4, padding: '6px 10px' }}>
                      {saveModal.jurisdiction || '(not set on case)'}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>Court Level (optional)</div>
                    <input
                      value={saveModal.court_level}
                      onChange={e => setSaveModal(p => p ? { ...p, court_level: e.target.value } : null)}
                      placeholder="e.g. High Court"
                      style={{
                        width: '100%', background: '#080812', border: '1px solid #2a2a40',
                        borderRadius: 4, padding: '6px 10px', fontSize: 12,
                        color: '#f0ece0', outline: 'none', boxSizing: 'border-box',
                        fontFamily: "'Times New Roman', Times, serif",
                      }}
                    />
                  </div>
                </div>

                {/* Skeleton — editable */}
                <div>
                  <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>
                    Argument Skeleton <span style={{ color: '#c04040' }}>*</span>
                    <span style={{ color: '#505068', marginLeft: 8 }}>Edit inline to refine before saving</span>
                  </div>
                  <textarea
                    value={saveModal.skeleton}
                    onChange={e => setSaveModal(p => p ? { ...p, skeleton: e.target.value } : null)}
                    rows={10}
                    style={{
                      width: '100%', background: '#06060f', border: '1px solid #2a2a48',
                      borderRadius: 5, padding: '10px 12px', fontSize: 12, lineHeight: 1.7,
                      color: '#d0cce0', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  />
                </div>

                {/* Optional fields */}
                <div>
                  <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>Statutory Basis (optional)</div>
                  <input
                    value={saveModal.statutory_basis}
                    onChange={e => setSaveModal(p => p ? { ...p, statutory_basis: e.target.value } : null)}
                    placeholder="e.g. s.35 CFRN, s.158 ACJL 2011"
                    style={{
                      width: '100%', background: '#080812', border: '1px solid #2a2a40',
                      borderRadius: 4, padding: '6px 10px', fontSize: 12,
                      color: '#f0ece0', outline: 'none', boxSizing: 'border-box',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>Applicable Tests (optional)</div>
                  <textarea
                    value={saveModal.tests}
                    onChange={e => setSaveModal(p => p ? { ...p, tests: e.target.value } : null)}
                    rows={2}
                    placeholder="e.g. Three-limb test in Kotoye v Saraki…"
                    style={{
                      width: '100%', background: '#080812', border: '1px solid #2a2a40',
                      borderRadius: 4, padding: '6px 10px', fontSize: 12,
                      color: '#f0ece0', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#808098', marginBottom: 4 }}>Leading Authorities (optional)</div>
                  <textarea
                    value={saveModal.leading_authorities}
                    onChange={e => setSaveModal(p => p ? { ...p, leading_authorities: e.target.value } : null)}
                    rows={2}
                    placeholder="e.g. Abacha v FRN (2006) 4 NWLR, Fawehinmi v IGP…"
                    style={{
                      width: '100%', background: '#080812', border: '1px solid #2a2a40',
                      borderRadius: 4, padding: '6px 10px', fontSize: 12,
                      color: '#f0ece0', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  />
                </div>

                {/* Validation note */}
                {!saveModal.skeleton.trim() && (
                  <div style={{ fontSize: 11, color: '#c04040' }}>
                    Skeleton is required before saving.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button
                    onClick={confirmSaveTemplate}
                    disabled={savingTpl || !saveModal.skeleton.trim()}
                    style={{
                      background: saveModal.skeleton.trim() ? '#1a3a2a' : '#111120',
                      border: `1px solid ${saveModal.skeleton.trim() ? '#40a060' : '#2a2a40'}`,
                      borderRadius: 5, padding: '8px 18px', fontSize: 12,
                      color: saveModal.skeleton.trim() ? '#60c080' : '#404060',
                      cursor: saveModal.skeleton.trim() ? 'pointer' : 'not-allowed',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    {savingTpl ? 'Saving…' : '✓ Save Template'}
                  </button>
                  <button
                    onClick={() => setSaveModal(null)}
                    style={{
                      background: 'none', border: '1px solid #252535', borderRadius: 5,
                      padding: '8px 18px', fontSize: 12, color: '#505068', cursor: 'pointer',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MOVER FB PARA EDITOR — inline single-para form for moverFBParaResponses
// ─────────────────────────────────────────────────────────────────────────────
function MoverFBParaEditor({ onSave }: { onSave: (p: AffidavitParaResponse) => void }) {
  const [paraNum,  setParaNum]  = useState('');
  const [paraText, setParaText] = useState('');
  const [stance,   setStance]   = useState<'admit' | 'deny' | 'not_known'>('deny');
  const [response, setResponse] = useState('');

  function handleSave() {
    if (!paraNum.trim()) return;
    onSave({ id: Math.random().toString(36).slice(2), paraNum, paraText, stance, response });
    setParaNum(''); setParaText(''); setStance('deny'); setResponse('');
  }

  return (
    <div style={{ background: '#080814', border: '1px solid #c0504030', borderRadius: 8, padding: '16px 18px', marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#c0c0d8', marginBottom: 12 }}>Add Counter-Affidavit Paragraph</div>
      <div style={{ marginBottom: 10 }}>
        <SLabel text="Para number(s)" />
        <TA value={paraNum} onChange={setParaNum} placeholder="e.g. 7 / or 7, 8 and 9" rows={1} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <SLabel text="What those paragraphs allege (new facts only)" />
        <TA value={paraText} onChange={setParaText} placeholder="e.g. Para 7 alleges that the applicant never delivered the goods" rows={3} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <SLabel text="Client's stance" />
        <div style={{ display: 'flex', gap: 8 }}>
          {(['admit', 'deny', 'not_known'] as const).map(s => (
            <button key={s} onClick={() => setStance(s)}
              style={{
                background: stance === s ? '#080f1a' : 'transparent',
                border: `1px solid ${stance === s ? (s === 'admit' ? '#40a060' : s === 'deny' ? '#c05050' : '#c09040') : '#282840'}`,
                color: stance === s ? (s === 'admit' ? '#40a060' : s === 'deny' ? '#c05050' : '#c09040') : '#505068',
                borderRadius: 5, padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
              }}>
              {s === 'not_known' ? 'Not within knowledge' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {stance === 'deny' && (
        <div style={{ marginBottom: 12 }}>
          <SLabel text="Client's rebuttal — true position" />
          <TA value={response} onChange={setResponse}
            placeholder="e.g. The goods were delivered on 3 February 2024. Client has a delivery receipt signed by the respondent's warehouse manager." rows={3} />
        </div>
      )}
      <Btn label="+ Add Paragraph" onClick={handleSave} off={!paraNum.trim()} accent="#4090d0" small />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESP FC PARA EDITOR — inline para form for respFCParaResponses
// ─────────────────────────────────────────────────────────────────────────────
function RespFCParaEditor({ onSave }: { onSave: (p: AffidavitParaResponse) => void }) {
  const [paraNum,  setParaNum]  = useState('');
  const [paraText, setParaText] = useState('');
  const [stance,   setStance]   = useState<'admit' | 'deny' | 'not_known'>('deny');
  const [response, setResponse] = useState('');

  function handleSave() {
    if (!paraNum.trim()) return;
    onSave({ id: Math.random().toString(36).slice(2), paraNum, paraText, stance, response });
    setParaNum(''); setParaText(''); setStance('deny'); setResponse('');
  }

  return (
    <div style={{ background: '#080814', border: '1px solid #c0904030', borderRadius: 8, padding: '16px 18px', marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#c0c0d8', marginBottom: 12 }}>Add Para from Applicant's Further & Better</div>
      <div style={{ marginBottom: 10 }}>
        <SLabel text="Para number(s)" />
        <TA value={paraNum} onChange={setParaNum} placeholder="e.g. 4 / or 4 and 5" rows={1} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <SLabel text="New fact(s) alleged in those paragraphs" />
        <TA value={paraText} onChange={setParaText} placeholder="e.g. Para 4 alleges that delivery was made on 3 February 2024 and signed for by the Respondent's manager" rows={3} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <SLabel text="Client's stance" />
        <div style={{ display: 'flex', gap: 8 }}>
          {(['admit', 'deny', 'not_known'] as const).map(s => (
            <button key={s} onClick={() => setStance(s)}
              style={{
                background: stance === s ? '#080f1a' : 'transparent',
                border: `1px solid ${stance === s ? (s === 'admit' ? '#40a060' : s === 'deny' ? '#c05050' : '#c09040') : '#282840'}`,
                color: stance === s ? (s === 'admit' ? '#40a060' : s === 'deny' ? '#c05050' : '#c09040') : '#505068',
                borderRadius: 5, padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
              }}>
              {s === 'not_known' ? 'Not within knowledge' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {stance === 'deny' && (
        <div style={{ marginBottom: 12 }}>
          <SLabel text="Client's rebuttal — true position" />
          <TA value={response} onChange={setResponse}
            placeholder="e.g. No delivery was made on that date. The manager's signature was forged. Client has CCTV footage." rows={3} />
        </div>
      )}
      <Btn label="+ Add Paragraph" onClick={handleSave} off={!paraNum.trim()} accent="#c09040" small />
    </div>
  );
}

// ── Full Stage 3 component ─────────────────────────────────────────────────

interface ArgBuilderProps {
  activeCase:    Case;
  appType:       AppTypeConfig;
  facts:         AppFacts;
  stage3:        Stage3Data;
  onStage3:      (v: Stage3Data) => void;
  onChangeRole:  () => void;
  systemCtx:     string;
}

function ArgumentBuilderStage({ activeCase, appType, facts, stage3, onStage3, onChangeRole, systemCtx }: ArgBuilderProps) {
  const { ask, loading, error } = useAI(activeCase);
  // Phase 9D — light theory injection for generateReplyLaw when needsCaseTheory is true
  const { theory: replyTheory, hasTheory: replyHasTheory } = useCaseTheory(activeCase.id);

  // 2D-ii — badge shown when a template was used in the last IssueBuilder draft call
  const [templateBadge, setTemplateBadge] = useState<{ appType: string; jurisdiction: string } | null>(null);

  // Fix (Phase 10F-i smoke test): these MUST be declared before the early
  // `return` below, unconditionally on every render. They were previously
  // declared after the early return, which meant they were skipped entirely
  // on the role-selector render (stage3.applicationRole === null) and only
  // called once a role was picked — a different hook count between renders,
  // which is a Rules-of-Hooks violation and throws React error #310 the
  // instant the user selects Mover or Respondent.
  const [moverTab,     setMoverTab]     = useState<MoverSubTab>((appType.id === 'civil_originating_summons' || appType.id === 'civil_originating_application') ? 'originating_process' : 'supporting_affidavit');
  const [respondentTab, setRespondentTab] = useState<RespondentSubTab>('counter_affidavit');
  const [editPara,    setEditPara]    = useState<AffidavitParaResponse | null>(null);
  const [editParaId,  setEditParaId]  = useState<string | null>(null);

  // ── Phase 3B — Mover: Opponent Theory Detection ──────────────────────────
  // Fires when the Mover pastes opposing counsel's counter-affidavit or
  // written address. Surfaces a DetectedOpponentTheory card with a merge
  // candidate prompt for the 3D unlock → merge → relock flow.
  const [moverDetecting,      setMoverDetecting]      = useState(false);
  const [moverDetectError,    setMoverDetectError]    = useState<string | null>(null);
  const [moverDetectedTheory, setMoverDetectedTheory] = useState<DetectedOpponentTheory | null>(null);
  // Which source was last used for detection (so we know which textarea to re-run on change)
  const [moverDetectSource,   setMoverDetectSource]   = useState<'counter_affidavit' | 'written_address' | null>(null);
  // Merge state
  const [moverMerging,  setMoverMerging]  = useState(false);
  const [moverMergeMsg, setMoverMergeMsg] = useState<string | null>(null);
  // Phase 3D — controls whether the full TheoryMergePanel is open
  const [moverShowMergePanel, setMoverShowMergePanel] = useState(false);
  const { theory: moverTheory, locked: moverTheoryLocked, reload: reloadMoverTheory } = useCaseTheory(activeCase.id);

  async function runMoverDetection(source: 'counter_affidavit' | 'written_address') {
    const text = source === 'counter_affidavit' ? stage3.counterAffidavitIn : stage3.writtenAddressIn;
    if (!text.trim()) return;
    setMoverDetecting(true);
    setMoverDetectError(null);
    setMoverDetectedTheory(null);
    setMoverDetectSource(source);
    setMoverMergeMsg(null);
    try {
      const caseCtx = `${activeCase.case_name ?? ''}, ${activeCase.court ?? ''}, ${activeCase.counsel_role ?? ''}`.trim();
      const result = await detectOpponentTheory(text, source === 'counter_affidavit' ? 'counter_affidavit' : 'written_address', caseCtx);
      setMoverDetectedTheory(result);
    } catch (e: any) {
      setMoverDetectError(e?.message ?? 'Detection failed. Try again.');
    } finally {
      setMoverDetecting(false);
    }
  }

  async function mergeMoverDetectedTheory() {
    if (!moverDetectedTheory || !activeCase.id) return;
    setMoverMerging(true);
    setMoverMergeMsg(null);
    try {
      if (moverTheoryLocked) {
        await unlockCaseTheory(activeCase.id, `Phase 3B — opponent theory detected from ${moverDetectSource ?? 'opposing document'}`);
      }
      const existing = moverTheory;
      const merged: CaseTheoryRecord = existing
        ? {
            ...existing,
            opposing_theory: moverDetectedTheory.core_proposition,
            theory_killer:   moverDetectedTheory.theory_killer_target ?? existing.theory_killer ?? '',
          }
        : {
            core_proposition: '',
            elements:         [],
            opposing_theory:  moverDetectedTheory.core_proposition,
            theory_killer:    moverDetectedTheory.theory_killer_target ?? '',
            weakest_link:     '',
            narrative_theme:  '',
            gap_report:       [],
            score_breakdown:  { legal_sufficiency: 0, evidence_coverage: 0, vulnerability: 0, narrative_coherence: 0, jurisdictional_precision: 0, total: 0 },
          };
      await saveCaseTheory(activeCase.id, merged);
      reloadMoverTheory();
      setMoverMergeMsg('Opponent theory merged. Review and re-lock in Case Theory when ready.');
    } catch (e: any) {
      setMoverMergeMsg(`Merge failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setMoverMerging(false);
    }
  }
  // ── End Phase 3B ─────────────────────────────────────────────────────────

  // ── Phase 3C — Respondent: Mover Theory Detection ────────────────────────
  // Fires when the Respondent pastes the applicant's Supporting Affidavit
  // (and optionally their Written Address / motion). Extracts what the MOVER
  // is actually arguing — feeds the 3D unlock → merge → relock flow so that
  // the Respondent's Written Address in Opposition argues against the mover's
  // detected theory, not a stale locked version.
  const [respDetecting,      setRespDetecting]      = useState(false);
  const [respDetectError,    setRespDetectError]    = useState<string | null>(null);
  const [respDetectedTheory, setRespDetectedTheory] = useState<DetectedOpponentTheory | null>(null);
  const [respDetectSource,   setRespDetectSource]   = useState<'affidavit' | null>(null);
  const [respMerging,        setRespMerging]        = useState(false);
  const [respMergeMsg,       setRespMergeMsg]       = useState<string | null>(null);
  // Phase 3D — controls whether the full TheoryMergePanel is open
  const [respShowMergePanel, setRespShowMergePanel] = useState(false);
  // Respondent's own "mover theory" view — same hook, same caseId, just aliased for clarity
  const { theory: respCaseTheory, locked: respTheoryLocked, reload: reloadRespTheory } = useCaseTheory(activeCase.id);

  async function runRespDetection(source: 'affidavit') {
    const text = stage3.applicantAffidavit;
    if (!text.trim()) return;
    setRespDetecting(true);
    setRespDetectError(null);
    setRespDetectedTheory(null);
    setRespDetectSource(source);
    setRespMergeMsg(null);
    try {
      const caseCtx = `${activeCase.case_name ?? ''}, ${activeCase.court ?? ''}, ${activeCase.counsel_role ?? ''}`.trim();
      const result = await detectOpponentTheory(text, source, caseCtx);
      setRespDetectedTheory(result);
    } catch (e: any) {
      setRespDetectError(e?.message ?? 'Detection failed. Try again.');
    } finally {
      setRespDetecting(false);
    }
  }

  async function mergeRespDetectedTheory() {
    if (!respDetectedTheory || !activeCase.id) return;
    setRespMerging(true);
    setRespMergeMsg(null);
    try {
      if (respTheoryLocked) {
        await unlockCaseTheory(activeCase.id, `Phase 3C — mover's theory detected from ${respDetectSource ?? 'applicant document'}`);
      }
      const existing = respCaseTheory;
      const merged: CaseTheoryRecord = existing
        ? {
            ...existing,
            opposing_theory: respDetectedTheory.core_proposition,
            theory_killer:   respDetectedTheory.theory_killer_target ?? existing.theory_killer ?? '',
          }
        : {
            core_proposition: '',
            elements:         [],
            opposing_theory:  respDetectedTheory.core_proposition,
            theory_killer:    respDetectedTheory.theory_killer_target ?? '',
            weakest_link:     '',
            narrative_theme:  '',
            gap_report:       [],
            score_breakdown:  { legal_sufficiency: 0, evidence_coverage: 0, vulnerability: 0, narrative_coherence: 0, jurisdictional_precision: 0, total: 0 },
          };
      await saveCaseTheory(activeCase.id, merged);
      reloadRespTheory();
      setRespMergeMsg("Mover's theory merged. Review and re-lock in Case Theory when ready.");
    } catch (e: any) {
      setRespMergeMsg(`Merge failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setRespMerging(false);
    }
  }
  // ── End Phase 3C ─────────────────────────────────────────────────────────

  // Safety guard — role is always set before reaching Stage 3 (picker is now in Stage 2)
  if (!stage3.applicationRole) {
    return (
      <div style={{ fontSize: 13, color: '#808098', padding: '20px 0' }}>
        No role selected. Please go back to Facts and choose your role in this application.
      </div>
    );
  }

  const role = stage3.applicationRole;

  // ── Tab definitions
  const isOriginatingType = appType.id === 'civil_originating_summons' || appType.id === 'civil_originating_application';
  const moverTabs: { id: MoverSubTab; label: string; locked?: boolean }[] = [
    ...(isOriginatingType ? [{ id: 'originating_process' as MoverSubTab, label: `📜 ${appType.label}` }] : []),
    { id: 'supporting_affidavit', label: '✍ Supporting Affidavit' },
    { id: 'written_address',    label: `⚖ Written Address in Support (${stage3.issues.length} issue${stage3.issues.length !== 1 ? 's' : ''})` },
    { id: 'opposing_response',  label: '📥 Opposing Response' },
    { id: 'further_better',     label: '✍ Further & Better Affidavit', locked: !stage3.opposingFiled },
    { id: 'reply_law',          label: '↩ Reply on Points of Law',     locked: !stage3.opposingFiled || !stage3.writtenAddressIn.trim() },
  ];

  const respondentTabs: { id: RespondentSubTab; label: string }[] = [
    { id: 'counter_affidavit',    label: `✍ Counter-Affidavit (${stage3.paraResponses.length} para${stage3.paraResponses.length !== 1 ? 's' : ''})` },
    { id: 'written_address_opp',  label: `⚖ Written Address in Opposition (${stage3.respIssues.length} issue${stage3.respIssues.length !== 1 ? 's' : ''})` },
    { id: 'further_better_resp',  label: '✍ Further & Better Affidavit' },
  ];

  // ── Counter-Affidavit builder state (Respondent track)

  function startNewPara() {
    setEditPara({ id: uid(), paraNum: '', paraText: '', stance: 'deny', response: '' });
    setEditParaId(null);
  }
  function startEditPara(p: AffidavitParaResponse) { setEditPara({ ...p }); setEditParaId(p.id); }
  function cancelParaEdit() { setEditPara(null); setEditParaId(null); }
  function removePara(id: string) { onStage3({ ...stage3, paraResponses: stage3.paraResponses.filter(p => p.id !== id) }); }
  function savePara() {
    if (!editPara || !editPara.paraNum.trim()) return;
    if (editParaId) { onStage3({ ...stage3, paraResponses: stage3.paraResponses.map(p => p.id === editParaId ? editPara : p) }); }
    else { onStage3({ ...stage3, paraResponses: [...stage3.paraResponses, editPara] }); }
    setEditPara(null); setEditParaId(null);
  }

  async function generateOriginatingProcess() {
    const reliefs  = facts.autoReliefs  || facts.reliefSought  || '';
    const grounds  = facts.autoGrounds  || facts.grounds       || '';
    const keyFacts = facts.autoKeyFacts || facts.keyFacts      || '';
    const intPkgStr = String(activeCase.intelligence_data?.intPkg ?? '').slice(0, 3000);
    const docLabel = appType.label; // "Originating Summons" or "Originating Application"
    const prompt = `Draft a complete ${docLabel} in correct Nigerian court form. This is a paper-trial originating process — there are no pleadings; the matter is decided on affidavit evidence and written address alone.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}

${intPkgStr ? 'INTELLIGENCE PACKAGE (vetted facts — do not contradict):\n' + intPkgStr + '\n' : ''}
RELIEFS SOUGHT:
${reliefs}

GROUNDS / STATUTORY BASIS:
${grounds}

KEY FACTS / SUBJECT MATTER:
${keyFacts}

${facts.additionalContext ? 'ADDITIONAL CONTEXT:\n' + facts.additionalContext + '\n' : ''}
${stage3.origProcessContext ? 'COUNSEL INSTRUCTIONS:\n' + stage3.origProcessContext + '\n' : ''}

${docLabel.toUpperCase()} RULES — MANDATORY:
1. Full Nigerian court heading: IN THE [COURT NAME] / HOLDEN AT [LOCATION] / SUIT NO: [NUMBER OR "TO BE ASSIGNED"] / BETWEEN: [APPLICANT] — Applicant AND [RESPONDENT] — Respondent
2. "IN THE MATTER OF" line identifying the statute, instrument, or subject matter to be construed or determined
3. Body: "Let [Respondent / all persons concerned] take notice that this Court will be moved on an application by the Applicant for the determination of the following questions and the grant of the following reliefs:"
4. QUESTIONS FOR DETERMINATION — numbered. Each question MUST be a legal proposition answerable without resolving disputed facts (no question may ask the court to find a fact in dispute).
5. RELIEFS SOUGHT — numbered, with each relief corresponding to a question above (declarations, orders, costs).
6. GROUNDS — the statutory or common-law basis for jurisdiction and for each question, including the enabling rule authorising commencement by ${docLabel}.
7. "AND TAKE NOTICE that the Applicant will rely on the Affidavit in Support filed herewith and such further affidavit(s) and Written Address as may be filed."
8. Solicitor's endorsement: Drawn and filed by [Counsel], [Firm], [Address], [Date]
9. Flag any missing particulars as [COUNSEL TO SUPPLY: description].

Draft the complete ${docLabel} now:`;

    const result = await ask({
      system: systemCtx + `\nYou are drafting a ${docLabel} for a Nigerian court — a paper-trial originating process decided on affidavit evidence and written address, with no pleadings and no oral trial. Questions for determination must be legal propositions, not disputed facts.`,
      userMsg: prompt,
      maxTokens: 1500,
      libraryOpts: { queryHint: `${docLabel} Nigeria questions for determination`, topK: 4 },
    });
    if (result) onStage3({ ...stage3, origProcessDraft: result.trim() });
  }

  async function generateSupportingAffidavit() {
    const reliefs  = facts.autoReliefs  || facts.reliefSought  || '';
    const grounds  = facts.autoGrounds  || facts.grounds       || '';
    const keyFacts = facts.autoKeyFacts || facts.keyFacts      || '';
    const prompt = `Draft a Supporting Affidavit for a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}
DEPONENT: ${facts.deponent || '[deponent name]'}

RELIEFS SOUGHT:
${reliefs}

GROUNDS:
${grounds}

KEY FACTS / NARRATIVE:
${keyFacts}

${facts.additionalContext ? 'ADDITIONAL CONTEXT:\n' + facts.additionalContext : ''}

SUPPORTING AFFIDAVIT RULES — MANDATORY:
1. Full Nigerian court heading: IN THE [COURT NAME] / HOLDEN AT [LOCATION] / SUIT NO: [NUMBER] / BETWEEN: [PARTIES]
2. Caption: "SUPPORTING AFFIDAVIT IN SUPPORT OF [APPLICATION TYPE]"
3. "I, [DEPONENT NAME], do hereby make oath and state as follows:"
4. Numbered paragraphs in first-person voice. State deponent's identity, capacity, and personal knowledge basis in Para 1.
5. Each material fact in its own numbered paragraph — chronological order.
6. No legal argument — facts only. Legal submissions go in the Written Address.
7. Exhibits referenced as: "...exhibited hereto and marked as Exhibit [A/B/C]..."
8. JURAT: "Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________ Commissioner for Oaths / [DEPONENT SIGNATURE]"
9. Use [EXHIBIT NEEDED] for any exhibit that should exist but is not described.

Draft the complete Supporting Affidavit now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Supporting Affidavit for a Nigerian court. This is a sworn document — facts only, no legal argument. Use correct Nigerian affidavit format with numbered paragraphs and proper jurat.',
      userMsg: prompt,
      maxTokens: 1000,
      libraryOpts: { queryHint: `Supporting Affidavit ${appType.label} Nigeria`, topK: 4 },
    });
    if (result) onStage3({ ...stage3, supportingAffidavitDraft: result.trim() });
  }

  async function generateMoverFurtherBetter() {
    const trigger = stage3.furtherBetterTrigger;
    if (!trigger) return;

    const supplementInstructions = stage3.supplementInstructions ?? '';
    const supplementExhibits     = stage3.supplementExhibits ?? '';

    const paraBlocks = stage3.moverFBParaResponses.map(p =>
      `Para ${p.paraNum}: "${p.paraText}" → ${p.stance === 'admit' ? 'ADMIT' : p.stance === 'deny' ? 'DENY' : 'NOT WITHIN MY KNOWLEDGE'}${p.response ? ' — Client says: ' + p.response : ''}`
    ).join('\n');

    const purposeSection = trigger === 'supplement'
      ? `PURPOSE: Supplement Supporting Affidavit\nSUPPLEMENT INSTRUCTIONS: ${supplementInstructions}\nEXHIBITS TO ADD: ${supplementExhibits}`
      : trigger === 'counter_counter'
      ? `PURPOSE: Respond to Counter-Affidavit new facts\nCOUNTER-AFFIDAVIT PASTE:\n${stage3.counterAffidavitIn || '(see para responses below)'}\n\nPARA-BY-PARA CLIENT INSTRUCTIONS:\n${paraBlocks}`
      : `PURPOSE: Both supplement own affidavit AND respond to Counter-Affidavit\n\nSUPPLEMENT INSTRUCTIONS: ${supplementInstructions}\nEXHIBITS TO ADD: ${supplementExhibits}\n\nCOUNTER-AFFIDAVIT PARA-BY-PARA:\n${paraBlocks}`;

    const prompt = `Draft a Further and Better Affidavit for the Applicant / Mover in a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}
DEPONENT: ${facts.deponent || '[deponent]'}

${purposeSection}

MANDATORY RULES:
1. Full Nigerian court heading and "FURTHER AND BETTER AFFIDAVIT" caption.
2. Every paragraph references its basis: "Further to paragraph [X] of my Supporting Affidavit..." or "In response to paragraph [X] of the Counter-Affidavit...".
3. Sworn document — facts only. No legal argument.
4. Numbered paragraphs, first-person voice.
5. If trigger includes counter-counter: for each DENY entry, give the applicant's true position as instructed.
6. JURAT at end.
7. Use [RESEARCH NEEDED] for any authority needed.

Draft now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Further and Better Affidavit for a Nigerian court. Sworn document — facts only, numbered paragraphs, correct jurat.',
      userMsg: prompt,
      maxTokens: 1000,
      libraryOpts: { queryHint: `Further Better Affidavit Nigeria ${appType.label}`, topK: 4 },
    });
    if (result) onStage3({ ...stage3, furtherBetterDraft: result.trim() });
  }

  async function generateCounterAffidavit() {
    const paraBlocks = stage3.paraResponses.map(p =>
      `Para ${p.paraNum}: "${p.paraText}" → ${p.stance === 'admit' ? 'ADMIT' : p.stance === 'deny' ? 'DENY' : 'NOT WITHIN MY KNOWLEDGE'}${p.response ? ' — ' + p.response : ''}`
    ).join('\n');

    const prompt = `Draft a Counter-Affidavit opposing a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}
DEPONENT: ${stage3.respondentDeponent || facts.deponent || 'the Respondent'}

APPLICANT'S SUPPORTING AFFIDAVIT:
${stage3.applicantAffidavit || '(Counsel to confirm the content of the Supporting Affidavit)'}

PARAGRAPH-BY-PARAGRAPH RESPONSES:
${paraBlocks}

${stage3.respondentNewFacts ? 'ADDITIONAL FACTS (respondent\'s own evidence):\n' + stage3.respondentNewFacts : ''}
${stage3.respondentExhibits ? 'EXHIBITS:\n' + stage3.respondentExhibits : ''}

DRAFTING RULES — MANDATORY:
1. Heading: "COUNTER-AFFIDAVIT" with full court heading, case name, suit number, parties.
2. Opening paragraph: deponent's full name, address, occupation, and that they make this affidavit in opposition to the application.
3. For each paragraph of the Supporting Affidavit:
   - ADMIT: "Paragraph [X] of the Supporting Affidavit is admitted."
   - DENY: "Paragraph [X] of the Supporting Affidavit is denied. The true position is that..." (then state the true facts)
   - NOT WITHIN KNOWLEDGE: "As to paragraph [X] of the Supporting Affidavit, the Deponent is not in a position to admit or deny the same as it is not within the Deponent's personal knowledge."
4. Additional facts (respondent's own evidence): numbered paragraphs in first-person voice.
5. Exhibits: "There is now produced and shown to me marked Exhibit [X] a copy of [document]."
6. Jurat: "Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________ Commissioner for Oaths"
7. No legal argument — only facts. Legal arguments go in the Written Address in Opposition.
8. All facts stated on personal knowledge unless stated otherwise.

Draft the Counter-Affidavit now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Counter-Affidavit for a Nigerian court. Sworn document — facts only, no legal argument. Every paragraph must be based on personal knowledge or stated otherwise. Use correct Nigerian affidavit format.',
      userMsg: prompt, maxTokens: 2500,
    });
    if (result) onStage3({ ...stage3, counterAffidavitDraft: result.trim() });
  }

  async function generateFurtherCounterAffidavit() {
    if (!stage3.leaveObtained) return;
    const paraBlocks = stage3.respFCParaResponses.map(p =>
      `Para ${p.paraNum}: "${p.paraText}" → ${p.stance === 'admit' ? 'ADMIT' : p.stance === 'deny' ? 'DENY' : 'NOT WITHIN MY KNOWLEDGE'}${p.response ? ' — Client says: ' + p.response : ''}`
    ).join('\n');

    const prompt = `Draft a Further Counter-Affidavit for the Respondent in a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}
TRACK: ${activeCase.matter_track ?? 'civil'}
DEPONENT: ${stage3.respondentDeponent || facts.deponent || 'the Respondent'}
NOTE: Leave of court has been obtained to file this Further Counter-Affidavit.

APPLICANT'S FURTHER & BETTER AFFIDAVIT:
${stage3.applicantFBIn || '(Counsel to confirm content — paste was not provided)'}

PARA-BY-PARA CLIENT INSTRUCTIONS:
${paraBlocks || '(none recorded — respond to all new facts)'}

${stage3.respondentNewFacts ? 'RESPONDENT\'S ADDITIONAL FACTS:\n' + stage3.respondentNewFacts : ''}
${stage3.respondentExhibits ? 'EXHIBITS:\n' + stage3.respondentExhibits : ''}

MANDATORY RULES:
1. Caption: "FURTHER COUNTER-AFFIDAVIT" with full Nigerian court heading.
2. Para 1: state leave of court was granted and the date/terms if known.
3. Every responding paragraph references the specific paragraph of the Applicant's Further & Better Affidavit it responds to.
4. Sworn document — facts only, no legal argument.
5. For each DENY: set out the true position per client's instructions.
6. Numbered paragraphs, first-person voice. JURAT at end.
7. Use [RESEARCH NEEDED] for any uncertain authority.

Draft now:`;

    const result = await ask({
      system: systemCtx + '\nYou are drafting a Further Counter-Affidavit for a Nigerian court. Sworn document — facts only. Reference each paragraph you respond to. Correct Nigerian affidavit format.',
      userMsg: prompt,
      maxTokens: 1000,
      libraryOpts: { queryHint: `Further Counter-Affidavit Nigeria ${appType.label}`, topK: 4 },
    });
    if (result) onStage3({ ...stage3, respFCDraft: result.trim() });
  }

  async function generateReplyLaw() {
    if (!stage3.writtenAddressIn.trim()) return;
    const prompt = `Draft a Reply on Points of Law to a ${appType.label} in a Nigerian court.

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'}

OUR WRITTEN ADDRESS IN SUPPORT (what we have already argued):
${stage3.writtenAddress.slice(0, 2500)}

OPPOSING COUNSEL'S WRITTEN ADDRESS IN OPPOSITION (what they filed):
${stage3.writtenAddressIn}

POINTS COUNSEL WANTS TO SPECIFICALLY REBUT:
${stage3.replyLawPoints || '(Respond to all new or contested legal points raised by opposing counsel)'}

STRICT RULES FOR A REPLY ON POINTS OF LAW — MANDATORY:
1. A Reply on Points of Law is STRICTLY LIMITED to new or contested legal points raised in opposing counsel's Written Address that were not already addressed in our Written Address, or that require a direct response.
2. This document must NOT introduce new facts. Any new facts must be in a Further and Better Affidavit.
3. This document must NOT raise new arguments not provoked by opposing counsel's Written Address.
4. If a point raised by opposing counsel was already fully addressed in our Written Address in Support, a brief reinforcement is permitted — but do not re-argue the whole case.
5. Structure: Brief Introduction (1 paragraph) → Point-by-point response → Closing paragraph urging the court to grant the reliefs.
6. Never invent case citations. Use [RESEARCH NEEDED] blocks where authority is needed but uncertain.
7. Write as senior counsel — direct, precise, confident. Not defensive.
8. If opposing counsel raised no new legal points, state this clearly and invite the court to discountenance their address on those points.

Draft the Reply on Points of Law now:`;

    // Phase 10C — jurisdiction delta for the Reply on Points of Law draft call.
    const jurisdiction = (activeCase as any).jurisdiction ?? activeCase.court ?? '';
    const lawDelta = getJurisdictionDeltaSync(appType.label, jurisdiction);

    const result = await ask({
      system: buildDraftSystemPrompt({
        systemCtx,
        appType,
        template:        null,   // reply on points of law — no template skeleton
        theory:          appType.needsCaseTheory && replyHasTheory && replyTheory ? replyTheory : null,
        lawDelta,
        callInstruction: 'You are drafting a Reply on Points of Law — a strictly limited document responding only to new legal points raised by opposing counsel. No new facts. No new arguments beyond what opposing counsel provoked. NEVER invent case citations.',
      }),
      userMsg: prompt, maxTokens: 2000,
      libraryOpts: { queryHint: `reply points of law ${appType.label} Nigerian court`, topK: 5 },
    });
    if (result) onStage3({ ...stage3, replyLawDraft: result.trim() });
  }

  // ── MOVER TRACK RENDER
  if (role === 'mover') {
    return (
      <div>
        {/* Role badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 12, color: '#4090d0', background: '#4090d010', border: '1px solid #4090d030', borderRadius: 4, padding: '4px 12px', fontFamily: "\'Times New Roman\', Times, serif" }}>
            ⚡ Applicant / Mover
          </span>
          <button onClick={() => onChangeRole()}
            style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 11, fontFamily: "\'Times New Roman\', Times, serif" }}>
            ← Change role
          </button>
        </div>

        {/* Sub-tab strip */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid #181828', overflowX: 'auto' }}>
          {moverTabs.map(t => (
            <button key={t.id}
              onClick={() => { if (!t.locked) setMoverTab(t.id); }}
              style={{
                background: moverTab === t.id ? '#181828' : 'transparent',
                color: t.locked ? '#2a2a40' : moverTab === t.id ? '#f0ece0' : '#505068',
                border: 'none', borderBottom: moverTab === t.id ? '2px solid #4090d0' : '2px solid transparent',
                padding: '8px 16px', fontSize: 12, cursor: t.locked ? 'not-allowed' : 'pointer',
                fontFamily: "\'Times New Roman\', Times, serif",
                fontWeight: moverTab === t.id ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
              {t.label}{t.locked ? ' 🔒' : ''}
            </button>
          ))}
        </div>

        {/* Tab 0 — Originating Summons / Originating Application (paper-trial originating process itself) */}
        {moverTab === 'originating_process' && (
          <div>
            <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.65 }}>
              The {appType.label} is the <strong style={{ color: '#c0c0d8' }}>originating process itself</strong> — questions for determination, reliefs, and grounds. This is a paper-trial document: no pleadings, decided on affidavit evidence and written address alone. Each question must be a legal proposition, not a disputed fact.
            </div>

            {error && <ErrorBlock message={error} />}

            {(facts.autoKeyFacts || facts.keyFacts) && (
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 7, padding: '12px 16px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: '#4090d0', fontWeight: 700, marginBottom: 8 }}>KEY FACTS (from Stage 2)</div>
                <div style={{ fontSize: 12, color: '#9090a8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {(facts.autoKeyFacts || facts.keyFacts).slice(0, 600)}{(facts.autoKeyFacts || facts.keyFacts).length > 600 ? '…' : ''}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <SLabel text="Counsel Instructions (questions for determination, reliefs, statutory basis — anything not captured above)" />
              <TA value={stage3.origProcessContext}
                onChange={v => onStage3({ ...stage3, origProcessContext: v })}
                placeholder="e.g. Question 1: Whether Clause 7 of the Agreement dated [date] entitles the Applicant to... ; Relief 1: A declaration that...; Enabling rule: Order X Rule Y of the [Court] Civil Procedure Rules." rows={6} />
            </div>

            {stage3.origProcessDraft && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ {appType.label} drafted</div>
                <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '18px 20px', lineHeight: 1.85, fontSize: 13, maxHeight: 400, overflowY: 'auto' }}>
                  <Md text={stage3.origProcessDraft} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <TA value={stage3.origProcessDraft}
                    onChange={v => onStage3({ ...stage3, origProcessDraft: v })} rows={12} />
                </div>
              </div>
            )}

            <Btn label={stage3.origProcessDraft ? `↻ Re-draft ${appType.label}` : `📜 Draft ${appType.label}`}
              onClick={generateOriginatingProcess} loading={loading}
              off={!facts.autoKeyFacts && !facts.keyFacts && !facts.autoReliefs && !facts.reliefSought && !stage3.origProcessContext.trim() && !activeCase.intelligence_data}
              accent="#4090d0" />

            {!facts.autoKeyFacts && !facts.keyFacts && !stage3.origProcessContext.trim() && !activeCase.intelligence_data && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#806040' }}>
                ← Go back to Stage 2 and auto-derive or enter key facts, or add counsel instructions above, first
              </div>
            )}
          </div>
        )}

        {/* Tab 1 — Supporting Affidavit */}
        {moverTab === 'supporting_affidavit' && (
          <div>
            <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.65 }}>
              The Supporting Affidavit is a <strong style={{ color: '#c0c0d8' }}>sworn document</strong> — facts only, no legal argument.
              Key facts and reliefs are pre-populated from Stage 2. Review them, then draft.
            </div>

            {error && <ErrorBlock message={error} />}

            {/* Pre-populated review */}
            {(facts.autoKeyFacts || facts.keyFacts) && (
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 7, padding: '12px 16px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: '#4090d0', fontWeight: 700, marginBottom: 8 }}>KEY FACTS (from Stage 2)</div>
                <div style={{ fontSize: 12, color: '#9090a8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {(facts.autoKeyFacts || facts.keyFacts).slice(0, 600)}{(facts.autoKeyFacts || facts.keyFacts).length > 600 ? '…' : ''}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <SLabel text="Additional Exhibits (labels and descriptions)" />
              <TA value={stage3.supplementExhibits}
                onChange={v => onStage3({ ...stage3, supplementExhibits: v })}
                placeholder="e.g. Exhibit A — letter dated 15 January 2024; Exhibit B — bank statement" rows={3} />
            </div>

            {stage3.supportingAffidavitDraft && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Supporting Affidavit drafted</div>
                <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '18px 20px', lineHeight: 1.85, fontSize: 13, maxHeight: 400, overflowY: 'auto' }}>
                  <Md text={stage3.supportingAffidavitDraft} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <TA value={stage3.supportingAffidavitDraft}
                    onChange={v => onStage3({ ...stage3, supportingAffidavitDraft: v })} rows={12} />
                </div>
              </div>
            )}

            <Btn label={stage3.supportingAffidavitDraft ? '↻ Re-draft Supporting Affidavit' : '✍ Draft Supporting Affidavit'}
              onClick={generateSupportingAffidavit} loading={loading}
              off={!facts.autoKeyFacts && !facts.keyFacts && !facts.autoReliefs && !facts.reliefSought}
              accent="#4090d0" />

            {!facts.autoKeyFacts && !facts.keyFacts && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#806040' }}>
                ← Go back to Stage 2 and auto-derive or enter key facts first
              </div>
            )}
          </div>
        )}

        {/* Tab 2 — Written Address in Support */}
        {moverTab === 'written_address' && (
          <>
            {/* 2D-ii — Template badge */}
            {templateBadge && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#1a2a1a', border: '1px solid #40a060',
                borderRadius: 4, padding: '4px 10px', marginBottom: 12,
                fontSize: 11, color: '#60c080',
              }}>
                ⚡ Drafted with Template: {templateBadge.appType} — {templateBadge.jurisdiction}
              </div>
            )}
            <IssueBuilder
              activeCase={activeCase} appType={appType} facts={facts}
              issues={stage3.issues} onIssuesChange={v => onStage3({ ...stage3, issues: v })}
              writtenAddress={stage3.writtenAddress} onAddressChange={v => onStage3({ ...stage3, writtenAddress: v })}
              side="support" systemCtx={systemCtx}
              templateBadge={templateBadge} onTemplateBadge={setTemplateBadge}
            />
          </>
        )}

        {/* B — Opposing Response */}
        {moverTab === 'opposing_response' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
              Did opposing counsel file a response to your application?
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              {([
                { val: true,  label: 'Yes — they filed a Counter-Affidavit and/or Written Address in Opposition' },
                { val: false, label: 'No — the application is unopposed' },
              ] as const).map(opt => (
                <button key={String(opt.val)} onClick={() => onStage3({ ...stage3, opposingFiled: opt.val })}
                  style={{
                    background: stage3.opposingFiled === opt.val ? '#080f1a' : '#080814',
                    border: `1px solid ${stage3.opposingFiled === opt.val ? '#4090d0' : '#1e1e34'}`,
                    borderRadius: 7, padding: '12px 16px', fontSize: 12, cursor: 'pointer',
                    color: stage3.opposingFiled === opt.val ? '#f0ece0' : '#808098',
                    fontFamily: "\'Times New Roman\', Times, serif", textAlign: 'left', flex: 1,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>

            {stage3.opposingFiled === false && (
              <div style={{ background: '#050d06', border: '1px solid #1a3020', borderRadius: 7, padding: '14px 18px', fontSize: 13, color: '#60a060', lineHeight: 1.65 }}>
                ✓ The application is unopposed. No Counter-Affidavit, Further & Better Affidavit, or Reply on Points of Law is required.
                Proceed to assemble the full package in Stage 4.
              </div>
            )}

            {stage3.opposingFiled === true && (
              <div>
                {/* ── Counter-Affidavit input ── */}
                <div style={{ marginBottom: 18 }}>
                  <SLabel text="Their Counter-Affidavit — paste or summarise the facts they are alleging or denying" />
                  <TA value={stage3.counterAffidavitIn}
                    onChange={v => { onStage3({ ...stage3, counterAffidavitIn: v }); setMoverDetectedTheory(null); setMoverMergeMsg(null); }}
                    placeholder="Paste or summarise the paragraphs in opposing counsel's Counter-Affidavit — what facts are they denying? What new facts are they introducing? This feeds into your Further & Better Affidavit."
                    rows={8} />
                  {stage3.counterAffidavitIn.trim().length > 30 && (
                    <button
                      onClick={() => runMoverDetection('counter_affidavit')}
                      disabled={moverDetecting}
                      style={{
                        marginTop: 8, background: '#0a1628', border: '1px solid #2a3a5a',
                        borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: moverDetecting ? 'not-allowed' : 'pointer',
                        color: moverDetecting ? '#505068' : '#6090d0', fontFamily: "'Times New Roman', Times, serif",
                      }}>
                      {moverDetecting && moverDetectSource === 'counter_affidavit' ? '⏳ Detecting…' : '🔍 Detect Opponent Theory from Counter-Affidavit'}
                    </button>
                  )}
                </div>

                {/* ── Written Address input ── */}
                <div style={{ marginBottom: 16 }}>
                  <SLabel text="Their Written Address in Opposition — paste or summarise their legal arguments" />
                  <TA value={stage3.writtenAddressIn}
                    onChange={v => { onStage3({ ...stage3, writtenAddressIn: v }); setMoverDetectedTheory(null); setMoverMergeMsg(null); }}
                    placeholder="Paste or summarise the legal points, cases, and statutory arguments made in opposing counsel's Written Address in Opposition. This feeds into your Reply on Points of Law."
                    rows={8} />
                  {stage3.writtenAddressIn.trim().length > 30 && (
                    <button
                      onClick={() => runMoverDetection('written_address')}
                      disabled={moverDetecting}
                      style={{
                        marginTop: 8, background: '#0a1628', border: '1px solid #2a3a5a',
                        borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: moverDetecting ? 'not-allowed' : 'pointer',
                        color: moverDetecting ? '#505068' : '#6090d0', fontFamily: "'Times New Roman', Times, serif",
                      }}>
                      {moverDetecting && moverDetectSource === 'written_address' ? '⏳ Detecting…' : '🔍 Detect Opponent Theory from Written Address'}
                    </button>
                  )}
                </div>

                {/* ── Phase 3B — Detected Theory Card ── */}
                {moverDetectError && (
                  <div style={{ background: '#1a0808', border: '1px solid #4a1a1a', borderRadius: 7, padding: '12px 16px', fontSize: 12, color: '#c06060', marginBottom: 14 }}>
                    ⚠ {moverDetectError}
                  </div>
                )}

                {moverDetectedTheory && (() => {
                  const { label: confLabel, color: confColor } = confidenceLabel(moverDetectedTheory.confidence);
                  const isCandidate = isMergeCandidate(moverDetectedTheory);
                  return (
                    <div style={{ background: '#07101e', border: '1px solid #1e3050', borderRadius: 8, padding: '16px 18px', marginBottom: 18 }}>
                      {/* Header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#a0c0e0', letterSpacing: '0.04em' }}>
                          ⚡ OPPONENT THEORY DETECTED
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: confColor, fontWeight: 600 }}>
                            {confLabel} ({moverDetectedTheory.confidence}/100)
                          </span>
                          <span style={{ fontSize: 11, color: '#404058' }}>
                            {moverDetectedTheory.source.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>

                      {/* Core proposition */}
                      <div style={{ fontSize: 13, color: '#d0ccc0', marginBottom: 10, fontStyle: 'italic', lineHeight: 1.6 }}>
                        "{moverDetectedTheory.core_proposition}"
                      </div>

                      {/* Key arguments */}
                      {moverDetectedTheory.key_arguments.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#606080', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Arguments</div>
                          {moverDetectedTheory.key_arguments.map((arg, i) => (
                            <div key={i} style={{ fontSize: 12, color: '#9090a8', lineHeight: 1.55, marginBottom: 4, paddingLeft: 12, borderLeft: '2px solid #1e2a40' }}>
                              {i + 1}. {arg}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Theory killer */}
                      {moverDetectedTheory.theory_killer_target && (
                        <div style={{ background: '#0c1a10', border: '1px solid #1a3a20', borderRadius: 6, padding: '10px 14px', marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#40a060', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pressure Point</div>
                          <div style={{ fontSize: 12, color: '#70c088', lineHeight: 1.55 }}>{moverDetectedTheory.theory_killer_target}</div>
                        </div>
                      )}

                      {/* Low confidence note */}
                      {!isCandidate && moverDetectedTheory.confidence_note && (
                        <div style={{ fontSize: 12, color: '#906040', marginBottom: 10, fontStyle: 'italic' }}>
                          ⚠ {moverDetectedTheory.confidence_note}
                        </div>
                      )}

                      {/* Theory type badge */}
                      <div style={{ fontSize: 11, color: '#404060', marginBottom: 14 }}>
                        Theory type: <span style={{ color: '#5070a0' }}>{moverDetectedTheory.theory_type}</span>
                      </div>

                      {/* Phase 3D — open TheoryMergePanel */}
                      {isCandidate && !moverShowMergePanel && (
                        <div style={{ borderTop: '1px solid #1a2a40', paddingTop: 12 }}>
                          <div style={{ fontSize: 12, color: '#707090', marginBottom: 10, lineHeight: 1.55 }}>
                            Open the merge panel to review the diff, edit if needed, then unlock → save → re-lock in one step.
                          </div>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button
                              onClick={() => setMoverShowMergePanel(true)}
                              style={{
                                background: '#0c2040', border: '1px solid #2050a0',
                                borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600,
                                color: '#90c0f0', cursor: 'pointer',
                                fontFamily: "'Times New Roman', Times, serif",
                              }}>
                              ⚖ Review &amp; Merge Theory
                            </button>
                            <button
                              onClick={() => { setMoverDetectedTheory(null); }}
                              style={{ background: 'transparent', border: '1px solid #1e1e34', borderRadius: 6, padding: '8px 14px', fontSize: 12, color: '#404060', cursor: 'pointer' }}>
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Phase 3D TheoryMergePanel — Mover track */}
                {moverDetectedTheory && moverShowMergePanel && (
                  <TheoryMergePanel
                    detected={moverDetectedTheory}
                    current={moverTheory}
                    locked={moverTheoryLocked}
                    caseId={activeCase.id}
                    partyLabel="Opponent"
                    onDone={() => { setMoverShowMergePanel(false); setMoverDetectedTheory(null); reloadMoverTheory(); }}
                    onDismiss={() => setMoverShowMergePanel(false)}
                  />
                )}

                <div style={{ fontSize: 12, color: '#40a060' }}>
                  ✓ Further &amp; Better Affidavit and Reply on Points of Law tabs are now unlocked.
                </div>
              </div>
            )}
          </div>
        )}

        {/* C — Further & Better Affidavit (Mover) */}
        {/* Tab 4 — Further & Better Affidavit (Mover) */}
        {moverTab === 'further_better' && (
          <div>
            <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.65 }}>
              A Further and Better Affidavit is a <strong style={{ color: '#c0c0d8' }}>sworn document</strong>.
              Select the purpose — this determines what client instructions are needed.
            </div>

            {error && <ErrorBlock message={error} />}

            {/* Trigger selector */}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ece0', marginBottom: 12 }}>
              What is the purpose of this Further & Better Affidavit?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {([
                { val: 'supplement' as const,       label: 'A — Supplement own Supporting Affidavit',        desc: 'Facts or exhibits were omitted from the original — add them now.' },
                { val: 'counter_counter' as const,  label: 'B — Respond to Counter-Affidavit new facts',    desc: 'The Counter-Affidavit introduced new facts that require a sworn rebuttal.' },
                { val: 'both' as const,             label: 'C — Both (supplement + respond to counter)',     desc: 'Both purposes apply — a combined document will be drafted.' },
              ]).map(opt => (
                <button key={opt.val} onClick={() => onStage3({ ...stage3, furtherBetterTrigger: opt.val })}
                  style={{
                    background: stage3.furtherBetterTrigger === opt.val ? '#080f1a' : '#080814',
                    border: `1px solid ${stage3.furtherBetterTrigger === opt.val ? '#4090d0' : '#1e1e34'}`,
                    borderRadius: 7, padding: '12px 16px', fontSize: 12, cursor: 'pointer',
                    color: stage3.furtherBetterTrigger === opt.val ? '#f0ece0' : '#808098',
                    fontFamily: "'Times New Roman', Times, serif", textAlign: 'left',
                  }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: stage3.furtherBetterTrigger === opt.val ? '#808098' : '#404058' }}>{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* Supplement section */}
            {(stage3.furtherBetterTrigger === 'supplement' || stage3.furtherBetterTrigger === 'both') && (
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#4090d0', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  A — Supplement Instructions (from client)
                </div>
                <div style={{ marginBottom: 12 }}>
                  <SLabel text="What was omitted / what new facts or exhibits to add" />
                  <TA value={stage3.supplementInstructions}
                    onChange={v => onStage3({ ...stage3, supplementInstructions: v })}
                    placeholder="e.g. Client says the payment receipt dated 5 March 2024 was not exhibited. Client also wants to add that he met the defendant at the bank on 10 March and the defendant acknowledged the debt. Exhibit the WhatsApp message confirming this."
                    rows={5} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <SLabel text="Additional exhibits for supplement" />
                  <TA value={stage3.supplementExhibits}
                    onChange={v => onStage3({ ...stage3, supplementExhibits: v })}
                    placeholder="e.g. Exhibit D — payment receipt dated 5 March 2024; Exhibit E — WhatsApp chat, 10 March 2024"
                    rows={3} />
                </div>
              </div>
            )}

            {/* Counter-Counter section — para-by-para builder */}
            {(stage3.furtherBetterTrigger === 'counter_counter' || stage3.furtherBetterTrigger === 'both') && (
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#4090d0', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  B — Respond to Counter-Affidavit New Facts (para-by-para)
                </div>
                <div style={{ fontSize: 11, color: '#505068', marginBottom: 14, lineHeight: 1.6 }}>
                  For each paragraph of the Counter-Affidavit that introduced new facts, record your client's instructions.
                </div>

                {/* Existing para responses */}
                {stage3.moverFBParaResponses.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {stage3.moverFBParaResponses.map((p, idx) => (
                      <div key={p.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 11, color: '#4090d0', fontWeight: 700 }}>Para {p.paraNum}</span>
                            <span style={{ fontSize: 11, color: p.stance === 'admit' ? '#40a060' : p.stance === 'deny' ? '#c05050' : '#c09040', marginLeft: 8, textTransform: 'uppercase' }}>
                              {p.stance === 'not_known' ? 'Not within knowledge' : p.stance}
                            </span>
                            <div style={{ fontSize: 12, color: '#808098', marginTop: 4, lineHeight: 1.5 }}>{p.paraText.slice(0, 80)}{p.paraText.length > 80 ? '…' : ''}</div>
                            {p.response && <div style={{ fontSize: 12, color: '#c0c0d8', marginTop: 4, fontStyle: 'italic' }}>{p.response.slice(0, 100)}{p.response.length > 100 ? '…' : ''}</div>}
                          </div>
                          <button onClick={() => onStage3({ ...stage3, moverFBParaResponses: stage3.moverFBParaResponses.filter((_, i) => i !== idx) })}
                            style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, marginLeft: 12 }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new para response inline */}
                <MoverFBParaEditor
                  onSave={p => onStage3({ ...stage3, moverFBParaResponses: [...stage3.moverFBParaResponses, p] })}
                />
              </div>
            )}

            {/* Draft button */}
            {stage3.furtherBetterTrigger && (
              <>
                {stage3.furtherBetterDraft && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Further & Better Affidavit drafted</div>
                    <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '18px 20px', lineHeight: 1.85, fontSize: 13, maxHeight: 400, overflowY: 'auto' }}>
                      <Md text={stage3.furtherBetterDraft} />
                    </div>
                  </div>
                )}
                <Btn label={stage3.furtherBetterDraft ? '↻ Re-draft Further & Better Affidavit' : '✍ Draft Further & Better Affidavit'}
                  onClick={generateMoverFurtherBetter} loading={loading} accent="#4090d0" />
              </>
            )}
          </div>
        )}

        {/* D — Reply on Points of Law */}
        {moverTab === 'reply_law' && (
          <div>
            <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.65 }}>
              A Reply on Points of Law responds only to <strong style={{ color: '#c0c0d8' }}>new or contested legal points</strong> raised
              in opposing counsel's Written Address in Opposition. It must not introduce new facts — those go in the Further & Better Affidavit.
              It must not raise new arguments not provoked by opposing counsel.
            </div>

            {error && <ErrorBlock message={error} />}

            <div style={{ marginBottom: 16 }}>
              <SLabel text="Specific legal points you want to rebut (optional — if blank, AI responds to all new points)" />
              <TA value={stage3.replyLawPoints}
                onChange={v => onStage3({ ...stage3, replyLawPoints: v })}
                placeholder="e.g. Opposing counsel cited Kalu v Odili for a proposition it does not support. They also argued that Order 26 Rule 3 bars this application — that is a misreading of the rule. Address both specifically."
                rows={5} />
            </div>

            {stage3.replyLawDraft && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Reply on Points of Law drafted</div>
                <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '18px 20px', lineHeight: 1.85, fontSize: 13, maxHeight: 400, overflowY: 'auto' }}>
                  <Md text={stage3.replyLawDraft} />
                </div>
              </div>
            )}

            <Btn label={stage3.replyLawDraft ? '↻ Re-draft Reply on Points of Law' : '↩ Draft Reply on Points of Law'}
              onClick={generateReplyLaw} loading={loading} accent="#4090d0" />
          </div>
        )}
      </div>
    );
  }

  // ── RESPONDENT TRACK RENDER
  return (
    <div>
      {/* Role badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 12, color: '#c09040', background: '#c0904010', border: '1px solid #c0904030', borderRadius: 4, padding: '4px 12px', fontFamily: "\'Times New Roman\', Times, serif" }}>
          🛡 Respondent to Application
        </span>
        <button onClick={() => onChangeRole()}
          style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 11, fontFamily: "\'Times New Roman\', Times, serif" }}>
          ← Change role
        </button>
      </div>

      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid #181828', overflowX: 'auto' }}>
        {respondentTabs.map(t => (
          <button key={t.id} onClick={() => setRespondentTab(t.id)}
            style={{
              background: respondentTab === t.id ? '#181828' : 'transparent',
              color: respondentTab === t.id ? '#f0ece0' : '#505068',
              border: 'none', borderBottom: respondentTab === t.id ? '2px solid #c09040' : '2px solid transparent',
              padding: '8px 16px', fontSize: 12, cursor: 'pointer',
              fontFamily: "\'Times New Roman\', Times, serif",
              fontWeight: respondentTab === t.id ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* A — Counter-Affidavit */}
      {respondentTab === 'counter_affidavit' && (
        <div>
          <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
            Build the Counter-Affidavit paragraph by paragraph. For each paragraph of the applicant's Supporting Affidavit,
            state whether you admit it, deny it, or whether it is not within your knowledge. Add your own facts after.
          </div>

          {error && <ErrorBlock message={error} />}

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Applicant's Supporting Affidavit (paste here for reference)" />
            <TA value={stage3.applicantAffidavit}
              onChange={v => { onStage3({ ...stage3, applicantAffidavit: v }); setRespDetectedTheory(null); setRespMergeMsg(null); }}
              placeholder="Paste the applicant's Supporting Affidavit here. This feeds your paragraph-by-paragraph responses below and the AI uses it to draft the Counter-Affidavit correctly."
              rows={6} />
            {stage3.applicantAffidavit.trim().length > 30 && (
              <button
                onClick={() => runRespDetection('affidavit')}
                disabled={respDetecting}
                style={{
                  marginTop: 8, background: '#0a1628', border: '1px solid #2a3a5a',
                  borderRadius: 6, padding: '7px 14px', fontSize: 12,
                  cursor: respDetecting ? 'not-allowed' : 'pointer',
                  color: respDetecting ? '#505068' : '#6090d0',
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                {respDetecting && respDetectSource === 'affidavit' ? '⏳ Detecting…' : '🔍 Detect Mover\'s Theory from Supporting Affidavit'}
              </button>
            )}
          </div>

          {/* Phase 3C — Detected Theory Card (Respondent track) */}
          {respDetectError && (
            <div style={{ background: '#1a0808', border: '1px solid #4a1a1a', borderRadius: 7, padding: '12px 16px', fontSize: 12, color: '#c06060', marginBottom: 14 }}>
              ⚠ {respDetectError}
            </div>
          )}

          {respDetectedTheory && (() => {
            const { label: confLabel, color: confColor } = confidenceLabel(respDetectedTheory.confidence);
            const isCandidate = isMergeCandidate(respDetectedTheory);
            return (
              <div style={{ background: '#07101e', border: '1px solid #1e3050', borderRadius: 8, padding: '16px 18px', marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#a0c0e0', letterSpacing: '0.04em' }}>
                    ⚡ MOVER'S THEORY DETECTED
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: confColor, fontWeight: 600 }}>{confLabel} ({respDetectedTheory.confidence}/100)</span>
                    <span style={{ fontSize: 11, color: '#404058' }}>{respDetectedTheory.source.replace(/_/g, ' ')}</span>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: '#d0ccc0', marginBottom: 10, fontStyle: 'italic', lineHeight: 1.6 }}>
                  "{respDetectedTheory.core_proposition}"
                </div>

                {respDetectedTheory.key_arguments.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#606080', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Arguments</div>
                    {respDetectedTheory.key_arguments.map((arg, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#9090a8', lineHeight: 1.55, marginBottom: 4, paddingLeft: 12, borderLeft: '2px solid #1e2a40' }}>
                        {i + 1}. {arg}
                      </div>
                    ))}
                  </div>
                )}

                {respDetectedTheory.theory_killer_target && (
                  <div style={{ background: '#0c1a10', border: '1px solid #1a3a20', borderRadius: 6, padding: '10px 14px', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#40a060', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pressure Point</div>
                    <div style={{ fontSize: 12, color: '#70c088', lineHeight: 1.55 }}>{respDetectedTheory.theory_killer_target}</div>
                  </div>
                )}

                {!isCandidate && respDetectedTheory.confidence_note && (
                  <div style={{ fontSize: 12, color: '#906040', marginBottom: 10, fontStyle: 'italic' }}>⚠ {respDetectedTheory.confidence_note}</div>
                )}

                <div style={{ fontSize: 11, color: '#404060', marginBottom: 14 }}>
                  Theory type: <span style={{ color: '#5070a0' }}>{respDetectedTheory.theory_type}</span>
                </div>

                {/* Phase 3D — open TheoryMergePanel */}
                {isCandidate && !respShowMergePanel && (
                  <div style={{ borderTop: '1px solid #1a2a40', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, color: '#707090', marginBottom: 10, lineHeight: 1.55 }}>
                      Open the merge panel to review the diff, edit if needed, then unlock → save → re-lock in one step.
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => setRespShowMergePanel(true)}
                        style={{
                          background: '#0c2040', border: '1px solid #2050a0',
                          borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600,
                          color: '#90c0f0', cursor: 'pointer',
                          fontFamily: "'Times New Roman', Times, serif",
                        }}>
                        ⚖ Review &amp; Merge Theory
                      </button>
                      <button
                        onClick={() => { setRespDetectedTheory(null); }}
                        style={{ background: 'transparent', border: '1px solid #1e1e34', borderRadius: 6, padding: '8px 14px', fontSize: 12, color: '#404060', cursor: 'pointer' }}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Phase 3D TheoryMergePanel — Respondent track */}
          {respDetectedTheory && respShowMergePanel && (
            <TheoryMergePanel
              detected={respDetectedTheory}
              current={respCaseTheory}
              locked={respTheoryLocked}
              caseId={activeCase.id}
              partyLabel="Mover"
              onDone={() => { setRespShowMergePanel(false); setRespDetectedTheory(null); reloadRespTheory(); }}
              onDismiss={() => setRespShowMergePanel(false)}
            />
          )}

          {/* Para responses */}
          {stage3.paraResponses.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {stage3.paraResponses.map((p, i) => (
                <div key={p.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '12px 16px', marginBottom: 8, display: 'flex', gap: 12, justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#4090d0', fontWeight: 600 }}>¶{p.paraNum}</span>
                      <span style={{
                        fontSize: 10, borderRadius: 3, padding: '1px 6px', fontWeight: 700,
                        color: p.stance === 'admit' ? '#40a060' : p.stance === 'deny' ? '#c05050' : '#c09040',
                        border: `1px solid ${p.stance === 'admit' ? '#40a06040' : p.stance === 'deny' ? '#c0505040' : '#c0904040'}`,
                      }}>
                        {p.stance === 'admit' ? 'ADMIT' : p.stance === 'deny' ? 'DENY' : 'NOT KNOWN'}
                      </span>
                    </div>
                    {p.response && <div style={{ fontSize: 12, color: '#808098' }}>{p.response.slice(0, 80)}{p.response.length > 80 ? '…' : ''}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => startEditPara(p)}
                      style={{ background: 'transparent', border: '1px solid #2a2a40', color: '#808098', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "\'Times New Roman\', Times, serif" }}>Edit</button>
                    <button onClick={() => removePara(p.id)}
                      style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Para editor */}
          {editPara ? (
            <div style={{ background: '#080814', border: '1px solid #c0504030', borderRadius: 8, padding: '18px 20px', marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f0ece0', marginBottom: 16 }}>
                {editParaId ? 'Edit Paragraph Response' : 'New Paragraph Response'}
              </div>
              <div style={{ marginBottom: 12 }}>
                <SLabel text="Paragraph number(s) in the Supporting Affidavit" />
                <TA value={editPara.paraNum} onChange={v => setEditPara(p => p ? { ...p, paraNum: v } : p)} placeholder="e.g. 5 / or 5, 6 and 7" rows={1} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <SLabel text="What those paragraph(s) allege" />
                <TA value={editPara.paraText} onChange={v => setEditPara(p => p ? { ...p, paraText: v } : p)}
                  placeholder="e.g. Paragraph 5 alleges that the defendant received the sum of ₦2,000,000 from the claimant on 10 January 2024" rows={3} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <SLabel text="Stance" />
                <div style={{ display: 'flex', gap: 8 }}>
                  {([
                    { val: 'admit'    as const, label: 'Admit',          col: '#40a060' },
                    { val: 'deny'     as const, label: 'Deny',           col: '#c05050' },
                    { val: 'not_known'as const, label: 'Not within my knowledge', col: '#c09040' },
                  ]).map(opt => (
                    <button key={opt.val} onClick={() => setEditPara(p => p ? { ...p, stance: opt.val } : p)}
                      style={{
                        background: editPara.stance === opt.val ? '#080f1a' : 'transparent',
                        border: `1px solid ${editPara.stance === opt.val ? opt.col : '#282840'}`,
                        color: editPara.stance === opt.val ? opt.col : '#505068',
                        borderRadius: 5, padding: '6px 12px', fontSize: 11, cursor: 'pointer',
                        fontFamily: "\'Times New Roman\', Times, serif",
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {(editPara.stance === 'deny') && (
                <div style={{ marginBottom: 16 }}>
                  <SLabel text="Your response — the true facts" />
                  <TA value={editPara.response} onChange={v => setEditPara(p => p ? { ...p, response: v } : p)}
                    placeholder="e.g. The true position is that the defendant never received any payment from the claimant. No such payment was made on 10 January 2024 or at any time thereafter."
                    rows={4} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn label={editParaId ? '✓ Update' : '✓ Save Paragraph'} onClick={savePara} accent="#c09040" off={!editPara.paraNum.trim()} />
                <button onClick={cancelParaEdit}
                  style={{ background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 12, fontFamily: "\'Times New Roman\', Times, serif" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 20 }}>
              <Btn label="+ Add Paragraph Response" onClick={startNewPara} accent="#c09040" />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Respondent's additional facts (own evidence not in applicant's affidavit)" />
            <TA value={stage3.respondentNewFacts}
              onChange={v => onStage3({ ...stage3, respondentNewFacts: v })}
              placeholder="State any new facts the respondent wants to place before the court — facts not addressed in the applicant's affidavit. These will be added as numbered paragraphs after the paragraph-by-paragraph responses."
              rows={5} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <SLabel text="Deponent (who is swearing this Counter-Affidavit)" />
            <TA value={stage3.respondentDeponent}
              onChange={v => onStage3({ ...stage3, respondentDeponent: v })}
              placeholder="e.g. Chukwuemeka Obi, the Respondent / a clerk in the employ of counsel for the Respondent"
              rows={1} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <SLabel text="Exhibits (labels and descriptions)" />
            <TA value={stage3.respondentExhibits}
              onChange={v => onStage3({ ...stage3, respondentExhibits: v })}
              placeholder="e.g. Exhibit A — letter dated 15 January 2024; Exhibit B — bank statement showing no credit on 10 January 2024"
              rows={3} />
          </div>

          {stage3.counterAffidavitDraft && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Counter-Affidavit drafted</div>
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', lineHeight: 1.85, fontSize: 13, maxHeight: 380, overflowY: 'auto' }}>
                <Md text={stage3.counterAffidavitDraft} />
              </div>
            </div>
          )}

          <Btn label={stage3.counterAffidavitDraft ? '↻ Re-draft Counter-Affidavit' : '✍ Draft Counter-Affidavit'}
            onClick={generateCounterAffidavit} loading={loading}
            off={stage3.paraResponses.length === 0 && !stage3.respondentNewFacts.trim()}
            accent="#c09040" />
        </div>
      )}

      {/* B — Written Address in Opposition */}
      {respondentTab === 'written_address_opp' && (
        <>
          {/* Applicant's Written Address in Support — read-only reference panel */}
          {stage3.applicantWrittenAddressIn && (
            <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
              <div style={{ fontSize: 9, color: '#c09040', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Applicant's Written Address in Support — Reference (read-only)
              </div>
              <div style={{ fontSize: 12, color: '#707090', lineHeight: 1.7, maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: "'Times New Roman', Times, serif" }}>
                {stage3.applicantWrittenAddressIn}
              </div>
            </div>
          )}
          {/* 2D-ii — Template badge */}
          {templateBadge && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#1a2a1a', border: '1px solid #40a060',
              borderRadius: 4, padding: '4px 10px', marginBottom: 12,
              fontSize: 11, color: '#60c080',
            }}>
              ⚡ Drafted with Template: {templateBadge.appType} — {templateBadge.jurisdiction}
            </div>
          )}
          <IssueBuilder
            activeCase={activeCase} appType={appType} facts={facts}
            issues={stage3.respIssues} onIssuesChange={v => onStage3({ ...stage3, respIssues: v })}
            writtenAddress={stage3.writtenAddressOpp} onAddressChange={v => onStage3({ ...stage3, writtenAddressOpp: v })}
            side="opposition" systemCtx={systemCtx}
            templateBadge={templateBadge} onTemplateBadge={setTemplateBadge}
          />
        </>
      )}

      {/* C — Further Counter-Affidavit (Respondent) */}
      {respondentTab === 'further_better_resp' && (
        <div>
          <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.65 }}>
            A Further Counter-Affidavit responds to new facts introduced in the Applicant's Further &amp; Better Affidavit.
            It requires <strong style={{ color: '#c0c0d8' }}>leave of court</strong> and is a sworn document.
          </div>

          {/* Gate question */}
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ece0', marginBottom: 12 }}>
            Did the Applicant file a Further &amp; Better Affidavit?
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
            {([
              { val: true,  label: 'Yes — they filed a Further & Better Affidavit after our Counter-Affidavit' },
              { val: false, label: 'No — flow ends here' },
            ] as const).map(opt => (
              <button key={String(opt.val)} onClick={() => onStage3({ ...stage3, respOpposingFiled: opt.val })}
                style={{
                  background: stage3.respOpposingFiled === opt.val ? '#080f1a' : '#080814',
                  border: `1px solid ${stage3.respOpposingFiled === opt.val ? '#c09040' : '#1e1e34'}`,
                  borderRadius: 7, padding: '12px 16px', fontSize: 12, cursor: 'pointer',
                  color: stage3.respOpposingFiled === opt.val ? '#f0ece0' : '#808098',
                  fontFamily: "'Times New Roman', Times, serif", textAlign: 'left', flex: 1,
                }}>
                {opt.label}
              </button>
            ))}
          </div>

          {stage3.respOpposingFiled === false && (
            <div style={{ background: '#050d06', border: '1px solid #1a3020', borderRadius: 7, padding: '14px 18px', fontSize: 13, color: '#60a060', lineHeight: 1.65 }}>
              ✓ Flow ends here. Proceed to assemble: Counter-Affidavit + Written Address in Opposition.
            </div>
          )}

          {stage3.respOpposingFiled === true && (
            <div>
              {/* Step 1 — Leave of court */}
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#c09040', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Step 1 — Leave of Court
                </div>
                <div style={{ fontSize: 12, color: '#808098', marginBottom: 14, lineHeight: 1.6 }}>
                  A Further Counter-Affidavit requires leave of court before it can be filed.
                  The draft button is disabled until leave is confirmed.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={stage3.leaveObtained}
                    onChange={e => onStage3({ ...stage3, leaveObtained: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: '#c09040' }} />
                  <span style={{ fontSize: 12, color: stage3.leaveObtained ? '#c09040' : '#808098', fontFamily: "'Times New Roman', Times, serif" }}>
                    Leave of Court has been obtained to file a Further Counter-Affidavit
                  </span>
                </label>
              </div>

              {/* Step 2 — Paste Applicant's Further & Better */}
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#c09040', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Step 2 — Paste Applicant's Further &amp; Better Affidavit
                </div>
                <TA value={stage3.applicantFBIn}
                  onChange={v => onStage3({ ...stage3, applicantFBIn: v })}
                  placeholder="Paste the Applicant's Further and Better Affidavit here. The engine will identify which paragraphs introduced new facts."
                  rows={8} />
              </div>

              {/* Step 3 — Para-by-para builder */}
              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#c09040', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Step 3 — Client Instructions: Para-by-Para Response
                </div>
                <div style={{ fontSize: 11, color: '#505068', marginBottom: 14, lineHeight: 1.6 }}>
                  For each paragraph of the Applicant's Further &amp; Better Affidavit that introduces new facts,
                  record your client's instructions. This is a sworn document — client consultation is mandatory.
                </div>

                {stage3.respFCParaResponses.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {stage3.respFCParaResponses.map((p, idx) => (
                      <div key={p.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 11, color: '#c09040', fontWeight: 700 }}>Para {p.paraNum}</span>
                            <span style={{ fontSize: 11, color: p.stance === 'admit' ? '#40a060' : p.stance === 'deny' ? '#c05050' : '#c09040', marginLeft: 8, textTransform: 'uppercase' }}>
                              {p.stance === 'not_known' ? 'Not within knowledge' : p.stance}
                            </span>
                            <div style={{ fontSize: 12, color: '#808098', marginTop: 4, lineHeight: 1.5 }}>{p.paraText.slice(0, 80)}{p.paraText.length > 80 ? '…' : ''}</div>
                            {p.response && <div style={{ fontSize: 12, color: '#c0c0d8', marginTop: 4, fontStyle: 'italic' }}>{p.response.slice(0, 100)}{p.response.length > 100 ? '…' : ''}</div>}
                          </div>
                          <button onClick={() => onStage3({ ...stage3, respFCParaResponses: stage3.respFCParaResponses.filter((_, i) => i !== idx) })}
                            style={{ background: 'transparent', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, marginLeft: 12 }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <RespFCParaEditor
                  onSave={p => onStage3({ ...stage3, respFCParaResponses: [...stage3.respFCParaResponses, p] })}
                />

                <div style={{ marginTop: 18, marginBottom: 12 }}>
                  <SLabel text="Respondent's additional facts (not in Applicant's Further & Better)" />
                  <TA value={stage3.respondentNewFacts}
                    onChange={v => onStage3({ ...stage3, respondentNewFacts: v })}
                    placeholder="Any additional facts the respondent wishes to place on record in the Further Counter-Affidavit"
                    rows={4} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <SLabel text="Deponent" />
                  <TA value={stage3.respondentDeponent}
                    onChange={v => onStage3({ ...stage3, respondentDeponent: v })}
                    placeholder="e.g. Chukwuemeka Obi, the Respondent / a clerk in the employ of counsel" rows={1} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <SLabel text="Exhibits" />
                  <TA value={stage3.respondentExhibits}
                    onChange={v => onStage3({ ...stage3, respondentExhibits: v })}
                    placeholder="e.g. Exhibit D — bank statement showing no debit on 3 February 2024" rows={2} />
                </div>
              </div>

              {error && <ErrorBlock message={error} />}

              {stage3.respFCDraft && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: '#40a060', marginBottom: 8 }}>✓ Further Counter-Affidavit drafted</div>
                  <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '18px 20px', lineHeight: 1.85, fontSize: 13, maxHeight: 400, overflowY: 'auto' }}>
                    <Md text={stage3.respFCDraft} />
                  </div>
                </div>
              )}

              <Btn
                label={stage3.respFCDraft ? '↻ Re-draft Further Counter-Affidavit' : '✍ Draft Further Counter-Affidavit'}
                onClick={generateFurtherCounterAffidavit} loading={loading}
                off={!stage3.leaveObtained || (stage3.respFCParaResponses.length === 0 && !stage3.respondentNewFacts.trim())}
                accent="#c09040"
              />
              {!stage3.leaveObtained && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#806040' }}>
                  ↑ Confirm leave of court in Step 1 before drafting
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5 — APPLICATIONS TRACKER
// ─────────────────────────────────────────────────────────────────────────────

function ApplicationsTracker({ caseId }: { caseId: string }) {
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [loaded,  setLoaded]  = useState(false);
  const [newType,    setNewType]    = useState('');
  const [newFiled,   setNewFiled]   = useState('');
  const [newHearing, setNewHearing] = useState('');
  const [newStatus,  setNewStatus]  = useState<AppStatus>('Drafting');
  const [newNotes,   setNewNotes]   = useState('');

  useEffect(() => {
    loadBlindSpot<TrackerData>(caseId, TRACKER_MOD, { entries: [] })
      .then(d => { setEntries(d.entries ?? []); setLoaded(true); });
  }, [caseId]);

  async function persist(updated: TrackerEntry[]) {
    setEntries(updated);
    await saveBlindSpot(caseId, TRACKER_MOD, { entries: updated });
  }

  function addEntry() {
    if (!newType.trim()) return;
    persist([...entries, {
      id: uid(), appType: newType, filedDate: newFiled,
      hearingDate: newHearing, status: newStatus, ruling: '', notes: newNotes,
    }]);
    setNewType(''); setNewFiled(''); setNewHearing(''); setNewNotes(''); setNewStatus('Drafting');
  }

  const allTypes = [
    'Motion on Notice', 'Motion Ex Parte', 'Bail Application', 'Preliminary Objection',
    'Injunction', 'Stay of Proceedings', 'Stay of Execution', 'Default Judgment',
    'Strike Out', 'Security for Costs', 'Extension of Time', 'Extension of Time to Appeal',
    'Regularise Records', 'Quash Charge', 'Opposition to Motion', 'Other',
  ];

  if (!loaded) return <div style={{ color: '#505068', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading tracker…</div>;

  return (
    <div>
      {entries.length === 0 && (
        <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 8, padding: '20px', marginBottom: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#505068', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>No applications tracked yet. Add one below.</p>
        </div>
      )}

      {entries.map(entry => (
        <div key={entry.id} style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 8, padding: '16px 18px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 14, color: '#f0ece0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{entry.appType}</span>
                <StatusBadge status={entry.status} />
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {entry.filedDate   && <span style={{ fontSize: 11, color: '#808098' }}>Filed: {entry.filedDate}</span>}
                {entry.hearingDate && <span style={{ fontSize: 11, color: '#808098' }}>Hearing: {entry.hearingDate}</span>}
              </div>
              {entry.notes   && <p style={{ fontSize: 12, color: '#a0a0b8', fontFamily: "'Times New Roman', Times, serif", margin: '6px 0 0', lineHeight: 1.5 }}>{entry.notes}</p>}
              {entry.ruling  && <p style={{ fontSize: 12, color: '#4090d0', fontFamily: "'Times New Roman', Times, serif", margin: '6px 0 0' }}>Ruling: {entry.ruling}</p>}
            </div>
            <button onClick={() => { if (!confirm('Remove?')) return; persist(entries.filter(e => e.id !== entry.id)); }}
              style={{ background: 'transparent', border: '1px solid #2a0808', color: '#804040', fontSize: 11, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>
              ×
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={entry.status} onChange={e => persist(entries.map(en => en.id === entry.id ? { ...en, status: e.target.value as AppStatus } : en))}
              style={{ background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 4, padding: '4px 8px', color: '#c0c0d8', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              {APP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={entry.ruling} onChange={e => persist(entries.map(en => en.id === entry.id ? { ...en, ruling: e.target.value } : en))}
              placeholder="Ruling / outcome…"
              style={{ background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 4, padding: '4px 10px', color: '#e8e4d8', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", outline: 'none', flex: 1, minWidth: 140 }} />
          </div>
        </div>
      ))}

      {/* Add form */}
      <div style={{ background: '#080814', border: '1px solid #4090d020', borderRadius: 8, padding: '18px 20px', marginTop: 8 }}>
        <div style={{ fontSize: 11, color: '#4090d0', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: '1px solid #4090d020', paddingBottom: 8 }}>
          Add Application to Tracker
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <SLabel text="Application Type" />
            <select value={allTypes.includes(newType) || !newType ? newType : '_other'} onChange={e => setNewType(e.target.value === '_other' ? '' : e.target.value)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: newType ? '#e8e4d8' : '#505068', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              <option value="">Select type…</option>
              {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <SLabel text="Status" />
            <select value={newStatus} onChange={e => setNewStatus(e.target.value as AppStatus)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              {APP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <SLabel text="Date Filed" />
            <input type="date" value={newFiled} onChange={e => setNewFiled(e.target.value)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div>
            <SLabel text="Hearing Date" />
            <input type="date" value={newHearing} onChange={e => setNewHearing(e.target.value)}
              style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", boxSizing: 'border-box', outline: 'none' }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <SLabel text="Notes" />
          <input value={newNotes} onChange={e => setNewNotes(e.target.value)}
            placeholder="Optional notes, adjourn date, outcome…"
            style={{ width: '100%', background: '#0a0a14', border: '1px solid #2a2a40', borderRadius: 6, padding: '8px 12px', color: '#e8e4d8', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", boxSizing: 'border-box', outline: 'none' }} />
        </div>
        <Btn label="Add to Tracker" onClick={addEntry} accent="#4090d0" off={!newType.trim()} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_STAGE3 — single source of truth for Stage3Data initial/reset state.
// Declared at module scope so useState and resetWorkflow both reference the
// same object, preventing silent divergence when new fields are added.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STAGE3: Stage3Data = {
  applicationRole: null, origProcessContext: '', origProcessDraft: '', supportingAffidavitDraft: '', supplementInstructions: '', supplementExhibits: '',
  issues: [], writtenAddress: '', opposingFiled: false,
  counterAffidavitIn: '', writtenAddressIn: '', fbGrounds: [], furtherBetterDraft: '',
  replyLawPoints: '', replyLawDraft: '', furtherBetterTrigger: null, moverFBParaResponses: [],
  motionPaperIn: '', applicantWrittenAddressIn: '',
  applicantAffidavit: '', paraResponses: [],
  respondentNewFacts: '', respondentDeponent: '', respondentExhibits: '',
  counterAffidavitDraft: '', respIssues: [], writtenAddressOpp: '',
  respOpposingFiled: false, leaveObtained: false, applicantFBIn: '',
  respFCParaResponses: [], respFCDraft: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ApplicationsEngine({ activeCase }: Props) {
  const { ask, loading, error, clearError } = useAI(activeCase);
  // Phase 4 seeding: ApplicationsEngine receives issues + locked theory (flagged).
  // 'issues' scope = established_facts + disputed_areas + legal_issues — gives the
  // drafting layer full legal framing without the redundant risk register / gap list
  // (those belong to CaseCommand display, not argument generation).
  const { fullContext } = useIntelligence(activeCase, 'issues');
  const systemCtx = buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role) + fullContext;

  // Phase 9D — locked Case Theory for needsCaseTheory appTypes
  const { theory, locked, score, hasTheory, loading: theoryLoading } = useCaseTheory(activeCase.id);

  const [mainTab,     setMainTab]     = useState<MainTab>('new');
  const [stage,       setStage]       = useState<Stage>(1);
  const isFrepMatter = activeCase.originating_process === 'frep' ||
    activeCase.counsel_role === 'frep_applicant' || activeCase.counsel_role === 'frep_respondent';
  const isMatrimonialMatter = activeCase.matter_track === 'matrimonial' ||
    activeCase.originating_process === 'petition_matrimonial';
  const [trackFilter, setTrackFilter] = useState<TrackFilter>(
    isFrepMatter ? 'frep' : isMatrimonialMatter ? 'matrimonial' : 'all'
  );

  // Stage 1
  const [selectedType,    setSelectedType]    = useState<AppTypeConfig | null>(null);
  const [customTypeText,  setCustomTypeText]  = useState('');

  // Phase 10C — jurisdiction delta for the selected application type, memoized
  // so it's resolved once per (selectedType, activeCase) change and reused by handleAssemble.
  const lawDelta = React.useMemo(() => {
    if (!selectedType) return '';
    return getJurisdictionDeltaSync(selectedType.label, (activeCase as any).jurisdiction ?? activeCase.court ?? '');
  }, [selectedType, activeCase]);

  // Stage 2
  const [facts, setFacts] = useState<AppFacts>({ ...DEFAULT_FACTS });
  // Stage 2 — Mover auto-derive
  const [derivingFacts,   setDerivingFacts]   = useState(false);
  const [deriveError,     setDeriveError]     = useState<string | null>(null);
  // Stage 2 — Respondent extract & analyse
  const [extractingOpp,   setExtractingOpp]   = useState(false);
  const [extractError,    setExtractError]    = useState<string | null>(null);
  const [oppExtractResult, setOppExtractResult] = useState<{
    reliefs_being_opposed: string[];
    grounds_being_opposed: string[];
    applicant_arguments: string[];
    our_counter_grounds: string[];
    issues_for_opposition: string[];
  } | null>(null);

  // Stage 3 — all mover + respondent state in one object
  const [stage3, setStage3] = useState<Stage3Data>({ ...DEFAULT_STAGE3 });

  // Stage 4
  const [generated, setGenerated] = useState('');

  // History
  const [history,        setHistory]        = useState<ApplicationRecord[]>([]);
  const [historyLoaded,  setHistoryLoaded]  = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ApplicationRecord | null>(null);

  // Clone modal
  const [cloneTarget,          setCloneTarget]          = useState<ApplicationRecord | null>(null);
  const [allCases,             setAllCases]             = useState<CaseSummary[]>([]);
  const [allCasesLoaded,       setAllCasesLoaded]       = useState(false);
  const [selectedCloneCaseId,  setSelectedCloneCaseId]  = useState('');
  const [cloneInProgress,      setCloneInProgress]      = useState(false);

  const roleColor  = COUNSEL_ROLE_COLORS[activeCase.counsel_role ?? 'claimant_side'];
  const trackColor = MATTER_TRACK_COLORS[activeCase.matter_track ?? 'civil'];

  // Load history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await workerLoad(activeCase.id);
      if (!cancelled) {
        if (remote.length > 0) {
          setHistory(remote);
          await saveBlindSpot(activeCase.id, MODULE, { history: remote });
        } else {
          const local = await loadBlindSpot<SavedData>(activeCase.id, MODULE, { history: [] });
          if (!cancelled) setHistory(local.history ?? []);
        }
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCase.id]);

  // Lazy-load all cases when the clone modal opens — only once per engine mount
  useEffect(() => {
    if (!cloneTarget || allCasesLoaded) return;
    loadAllCases().then(cases => {
      setAllCases(cases.filter(c => c.id !== activeCase.id));
      setAllCasesLoaded(true);
    });
  }, [cloneTarget, allCasesLoaded, activeCase.id]);

  async function persistHistory(updated: ApplicationRecord[]) {
    setHistory(updated);
    await saveBlindSpot(activeCase.id, MODULE, { history: updated });
  }

  // Stage 4 — Assemble full package
  const handleAssemble = useCallback(async () => {
    if (!selectedType) return;
    setGenerated('');

    const claimants  = activeCase.claimants.map(p => p.name).join(', ') || 'Claimant';
    const defendants = activeCase.defendants.map(p => p.name).join(', ') || 'Defendant';
    const track      = activeCase.matter_track ?? 'civil';
    const isCriminal = track === 'criminal';
    const partyBlock = isCriminal
      ? `Prosecution: ${claimants}\nDefendant/Accused: ${defendants}`
      : `Claimant(s): ${claimants}\nDefendant(s): ${defendants}`;

    const role         = stage3.applicationRole;
    const isMover      = role === 'mover' || role === null;
    const isRespondent = role === 'respondent';

    // Embed any documents already drafted in Stage 3
    const docSections: string[] = [];
    if (isMover) {
      if (stage3.supportingAffidavitDraft) docSections.push(`SUPPORTING AFFIDAVIT (already drafted — use as-is):\n${stage3.supportingAffidavitDraft.slice(0,2500)}`);
      if (stage3.writtenAddress)           docSections.push(`WRITTEN ADDRESS IN SUPPORT (already drafted — use as-is):\n${stage3.writtenAddress.slice(0,2500)}`);
      if (stage3.furtherBetterDraft)       docSections.push(`FURTHER AND BETTER AFFIDAVIT (already drafted — use as-is):\n${stage3.furtherBetterDraft.slice(0,2000)}`);
      if (stage3.replyLawDraft)            docSections.push(`REPLY ON POINTS OF LAW (already drafted — use as-is):\n${stage3.replyLawDraft.slice(0,2000)}`);
    }
    if (isRespondent) {
      if (stage3.counterAffidavitDraft) docSections.push(`COUNTER-AFFIDAVIT (already drafted — use as-is):\n${stage3.counterAffidavitDraft.slice(0,2000)}`);
      if (stage3.writtenAddressOpp)     docSections.push(`WRITTEN ADDRESS IN OPPOSITION (already drafted — use as-is):\n${stage3.writtenAddressOpp.slice(0,2500)}`);
      if (stage3.respFCDraft)           docSections.push(`FURTHER COUNTER-AFFIDAVIT (already drafted — use as-is):\n${stage3.respFCDraft.slice(0,2000)}`);
    }

    // Build package description — only documents actually produced appear
    const packageDescription = isRespondent
      ? [
          stage3.counterAffidavitDraft    ? 'Counter-Affidavit (pre-drafted)' : 'Counter-Affidavit',
          stage3.writtenAddressOpp        ? 'Written Address in Opposition (pre-drafted)' : 'Written Address in Opposition',
          stage3.respOpposingFiled && stage3.respFCDraft ? 'Further Counter-Affidavit (pre-drafted)' :
          stage3.respOpposingFiled        ? 'Further Counter-Affidavit' : '',
        ].filter(Boolean).join(', ')
      : [
          stage3.supportingAffidavitDraft ? 'Supporting Affidavit (pre-drafted)' : 'Supporting Affidavit',
          stage3.writtenAddress           ? 'Written Address in Support (pre-drafted)' : 'Written Address in Support',
          stage3.opposingFiled && stage3.furtherBetterDraft ? 'Further and Better Affidavit (pre-drafted)' :
          stage3.opposingFiled            ? 'Further and Better Affidavit' : '',
          stage3.opposingFiled && stage3.replyLawDraft ? 'Reply on Points of Law (pre-drafted)' :
          stage3.opposingFiled && stage3.writtenAddressIn ? 'Reply on Points of Law' : '',
        ].filter(Boolean).join(', ');

    // Use auto-derived facts if available, fall back to manual
    const reliefBlock   = facts.autoReliefs  || facts.reliefSought  || '';
    const groundsBlock  = facts.autoGrounds  || facts.grounds       || '';
    const keyFactsBlock = facts.autoKeyFacts || facts.keyFacts      || '';

    // Respondent: include pasted opposing documents as context
    const respondentContext = isRespondent && (stage3.motionPaperIn || stage3.applicantWrittenAddressIn)
      ? `\nMOTION PAPER SERVED ON CLIENT:\n${stage3.motionPaperIn.slice(0, 1500)}\n\nAPPLICANT\'S WRITTEN ADDRESS IN SUPPORT:\n${stage3.applicantWrittenAddressIn.slice(0, 1500)}`
      : '';

    const intPkgStr = String(activeCase.intelligence_data?.intPkg ?? '').slice(0, 3000);

    const prompt = `Assemble a complete application package for a Nigerian court. Draft every document in full — no placeholders. Court-ready.

CASE: ${activeCase.caseName}
SUIT NO: ${activeCase.suitNo || '[Suit No. TBA]'}
COURT: ${activeCase.court}
${partyBlock}
MATTER TRACK: ${track}
COUNSEL ROLE IN THIS APPLICATION: ${isRespondent ? 'Respondent to Application — opposing the motion' : 'Applicant / Mover — we filed this motion'}
APPLICATION TYPE: ${selectedType.label}
DOCUMENTS TO ASSEMBLE: ${packageDescription}

APPLICATION FACTS:
Parties: ${facts.parties || activeCase.caseName}
${reliefBlock    ? (isRespondent ? 'Reliefs Being Opposed: ' : 'Relief Sought: ') + reliefBlock : ''}
${groundsBlock   ? (isRespondent ? 'Grounds Being Opposed: ' : 'Grounds: ') + groundsBlock : ''}
${facts.deponent ? 'Affidavit Deponent: ' + facts.deponent : ''}
${keyFactsBlock  ? 'Key Facts: ' + keyFactsBlock : ''}
${facts.additionalContext ? 'Additional Context: ' + facts.additionalContext : ''}
${respondentContext}

${docSections.length ? '=== PRE-DRAFTED DOCUMENTS (embed as-is) ===\n' + docSections.join('\n\n---\n\n') + '\n=== END PRE-DRAFTED DOCUMENTS ===' : ''}
${intPkgStr ? 'INTELLIGENCE PACKAGE:\n' + intPkgStr : ''}

ASSEMBLY RULES — MANDATORY:
1. Output every document in full, in filing sequence, with a clear bold heading for each.
2. Pre-drafted documents: embed them exactly as provided — do not re-draft or paraphrase.
3. Documents not yet drafted: draft from the facts above using correct Nigerian format.
4. Every document gets full Nigerian court heading: court name, suit number, parties, date line.
5. Affidavit format: numbered paragraphs, first-person deponent voice, jurat: "Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________ Commissioner for Oaths"
6. Counter-Affidavit: paragraph-by-paragraph responses (admit/deny/not within knowledge) + respondent's new facts.
7. Further Counter-Affidavit: caption must state leave of court was obtained; every paragraph references the Applicant's Further & Better paragraph it responds to.
8. Further & Better Affidavit: every paragraph references the specific paragraph of the principal affidavit or counter-affidavit it is premised on or responding to.
9. Written Address: Introduction → Issues for Determination → Arguments (IRAC) → Conclusion and Relief. ${isRespondent ? 'Urge court to REFUSE the application.' : 'Urge court to GRANT the application.'}
10. Reply on Points of Law: responds ONLY to new legal points raised by opposing counsel — no new facts.
11. Bail: community ties, flight risk, gravity of offence, health, dependants.
12. Extension of time: account for every day of delay — Bowaje v Adediwura two-condition test.
13. Stay of execution: good grounds of appeal, special circumstances, balance of hardship.
14. Separate each document with: ---
15. NEVER fabricate case citations. Use [RESEARCH NEEDED] blocks for uncertain authority.

Begin with the first document heading now:`;

    const result = await ask({
      system: buildDraftSystemPrompt({
        systemCtx,
        appType:   selectedType,
        template:  null,   // handleAssemble does not do a template lookup (IssueBuilder handles template per issue)
        theory:    selectedType?.needsCaseTheory && hasTheory && theory ? theory : null,
        lawDelta,
      }),
      userMsg: prompt,
      maxTokens: 4500,
      libraryOpts: { queryHint: `${selectedType.label} Nigerian court applications procedure`, topK: 10 },
    });

    if (result) {
      setGenerated(result.trim());
      setStage(4);
    }
  }, [selectedType, facts, stage3, ask, activeCase, systemCtx, lawDelta, hasTheory, theory]);

  const handleSave = useCallback(async () => {
    if (!selectedType || !generated) return;
    const record: ApplicationRecord = {
      id: uid(), caseId: activeCase.id, appType: selectedType.label,
      facts, stage3, documents: generated,
      createdAt: new Date().toISOString(),
    };
    const updated = [record, ...history];
    await persistHistory(updated);
    await workerSave(record);
    alert('Package saved to history.');
  }, [selectedType, generated, facts, stage3, history, activeCase.id]);

  const handleAutoDerive = useCallback(async () => {
    if (!selectedType) return;
    setDerivingFacts(true); setDeriveError(null);
    const intPkg = String(activeCase.intelligence_data?.intPkg ?? '').slice(0, 3000);
    const prompt = `You are reviewing an intelligence package for a Nigerian court matter and must derive the key facts for a ${selectedType.label}.

INTELLIGENCE PACKAGE:
${intPkg || '(No intelligence package loaded — derive from case facts)'}

CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | TRACK: ${activeCase.matter_track ?? 'civil'}

Derive the following from the intelligence package. Return ONLY a JSON object with no preamble or markdown:
{
  "reliefs_sought": "Numbered list of specific reliefs to seek in this application, e.g.: 1. An order that... 2. A declaration that... 3. Costs of this application",
  "grounds": "Numbered grounds for the application, one per line",
  "key_facts": "Chronological narrative of material facts relevant to this application — dates, events, documents, communications",
  "deponent_suggestion": "Name and description of the most appropriate deponent based on the case facts"
}`;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000,
          system: systemCtx + '\nReturn ONLY valid JSON. No preamble, no markdown fences.',
          messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await resp.json();
      const text = (data.content ?? []).map((b: any) => b.text ?? '').join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      setFacts(f => ({
        ...f,
        autoReliefs:  parsed.reliefs_sought ?? '',
        autoGrounds:  parsed.grounds ?? '',
        autoKeyFacts: parsed.key_facts ?? '',
        deponent:     f.deponent || (parsed.deponent_suggestion ?? ''),
      }));
    } catch (e: any) {
      setDeriveError('Auto-derive failed: ' + (e?.message ?? 'unknown error'));
    }
    setDerivingFacts(false);
  }, [selectedType, activeCase, systemCtx]);

  const handleExtractOpp = useCallback(async () => {
    if (!stage3.motionPaperIn.trim() && !stage3.applicantWrittenAddressIn.trim()) return;
    setExtractingOpp(true); setExtractError(null);
    const intPkg = String(activeCase.intelligence_data?.intPkg ?? '').slice(0, 3000);
    const prompt = `You are acting as counsel for the Respondent in a Nigerian court application. Analyse the documents served on your client.

MOTION PAPER / NOTICE OF MOTION:
${stage3.motionPaperIn || '(not provided)'}

APPLICANT'S WRITTEN ADDRESS IN SUPPORT:
${stage3.applicantWrittenAddressIn || '(not provided)'}

INTELLIGENCE PACKAGE (our case context):
${intPkg || '(none)'}

Extract and return ONLY a JSON object with no preamble or markdown:
{
  "reliefs_being_opposed": ["list of specific reliefs the Applicant is seeking"],
  "grounds_being_opposed": ["list of grounds in the motion paper"],
  "applicant_arguments": ["key legal arguments made in the Written Address"],
  "our_counter_grounds": ["preliminary counter-grounds available to the Respondent based on intelligence"],
  "issues_for_opposition": ["issues for determination from the Respondent's perspective"]
}`;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000,
          system: systemCtx + '\nReturn ONLY valid JSON. No preamble, no markdown fences.',
          messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await resp.json();
      const text = (data.content ?? []).map((b: any) => b.text ?? '').join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      setOppExtractResult(parsed);
    } catch (e: any) {
      setExtractError('Extraction failed: ' + (e?.message ?? 'unknown error'));
    }
    setExtractingOpp(false);
  }, [stage3.motionPaperIn, stage3.applicantWrittenAddressIn, activeCase, systemCtx]);


  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this application package?')) return;
    const updated = history.filter(r => r.id !== id);
    await persistHistory(updated);
    await workerDelete(id);
    if (selectedRecord?.id === id) setSelectedRecord(null);
  }, [history, selectedRecord]);

  const resetWorkflow = useCallback(() => {
    setStage(1); setSelectedType(null); setCustomTypeText('');
    setFacts({ ...DEFAULT_FACTS }); setStage3({ ...DEFAULT_STAGE3 });
    setGenerated(''); clearError();
  }, [clearError]);

  // Loads a saved/cloned ApplicationRecord back into the live editing wizard
  // (facts + stage3 + matched type) and jumps to the Facts stage, so a
  // cloned record's _clone_notice is reachable and any saved draft can be
  // resumed rather than only viewed read-only. Falls back to a synthetic
  // custom type if appType doesn't match a current APP_TYPES entry (covers
  // older saved records and the free-text "custom" application path).
  const resumeRecord = useCallback((rec: ApplicationRecord) => {
    const matchedType: AppTypeConfig = APP_TYPES.find(t => t.label === rec.appType) ?? {
      id: 'custom', label: rec.appType, icon: '📄', track: 'all',
      package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
      hint: rec.appType, needsCaseTheory: false,
    };
    setSelectedType(matchedType);
    setFacts(rec.facts);
    setStage3(s => ({
      ...s,
      ...rec.stage3,
      // Explicit hydration — ensure mover draft fields survive round-trip
      origProcessContext:       rec.stage3.origProcessContext       ?? s.origProcessContext,
      origProcessDraft:         rec.stage3.origProcessDraft         ?? s.origProcessDraft,
      supportingAffidavitDraft: rec.stage3.supportingAffidavitDraft ?? s.supportingAffidavitDraft,
      supplementInstructions:   rec.stage3.supplementInstructions   ?? s.supplementInstructions,
      supplementExhibits:       rec.stage3.supplementExhibits       ?? s.supplementExhibits,
    }));
    setGenerated('');
    clearError();
    setStage(2);
    setMainTab('new');
    setSelectedRecord(null);
  }, [clearError]);

  // 'frep' track types only show under the explicit 'frep' filter — they are
  // not listed when trackFilter === 'all' to avoid cluttering the civil list.
  // 'all' track types (custom fallbacks) show under every filter.
  const filteredTypes = APP_TYPES.filter(t => {
    if (t.track === 'all') return true;
    if (trackFilter === 'all') return t.track !== 'frep' && t.track !== 'matrimonial';
    return t.track === trackFilter;
  });
  const canGoToStage2 = !!selectedType;
  const canGoToStage3 = canGoToStage2 && !!stage3.applicationRole && !!(facts.reliefSought.trim() || facts.grounds.trim() || facts.autoReliefs.trim() || stage3.motionPaperIn.trim());
  const stageLabels   = ['Type', 'Facts', 'Arguments', 'Assemble', 'Track'];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
    <div style={{ padding: '24px 28px', fontFamily: "'Times New Roman', Times, serif", color: '#e8e4d8' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <span style={{ fontSize: 26, color: '#4090d0' }}>⚡</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f0ece0', letterSpacing: '.02em' }}>
            Applications Engine
          </div>
          <div style={{ fontSize: 12, color: '#6a6a88', marginTop: 2 }}>
            Draft complete application packages — Civil · Criminal · Appeal
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: roleColor.bg, border: `1px solid ${roleColor.bdr}`, color: roleColor.col }}>
            {activeCase.counsel_role?.replace('_', ' ').toUpperCase()}
          </span>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: trackColor.bg, border: `1px solid ${trackColor.bdr}`, color: trackColor.col }}>
            {(activeCase.matter_track ?? 'civil').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Main tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #181828' }}>
        {([['new', '⚡ New Application'], ['tracker', '📋 Tracker'], ['templates', '🗂 Templates']] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setMainTab(id as MainTab); if (id === 'tracker') setSelectedRecord(null); }}
            style={{
              background: mainTab === id ? '#181828' : 'transparent',
              color: mainTab === id ? '#f0ece0' : '#505068',
              border: 'none', borderBottom: mainTab === id ? '2px solid #4090d0' : '2px solid transparent',
              padding: '8px 18px', fontSize: 13, cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: mainTab === id ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>

      {/* ══ NEW APPLICATION TAB ══ */}
      {mainTab === 'new' && (
        <div>
          {/* Stage progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            {([1, 2, 3, 4, 5] as const).map((n, i) => (
              <React.Fragment key={n}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: (n <= stage || (n === 5 && !!generated)) ? 'pointer' : 'default' }}
                  onClick={() => { if (n <= stage || (n === 5 && !!generated)) setStage(n); }}
                >
                  <StepBadge n={n} active={stage === n} done={stage > n} />
                  <span style={{ fontSize: 11, color: stage >= n ? '#c8c0b0' : '#404058' }}>{stageLabels[i]}</span>
                </div>
                {i < 4 && <div style={{ flex: 1, height: 1, background: stage > n ? '#4090d0' : '#181828' }} />}
              </React.Fragment>
            ))}
          </div>

          {/* Phase 9D — Case Theory banner, shown from Stage 2 onward for needsCaseTheory appTypes */}
          {selectedType?.needsCaseTheory && stage >= 2 && (
            <CaseTheoryBanner
              theory={theory}
              locked={locked}
              score={score}
              hasTheory={hasTheory}
              loading={theoryLoading}
            />
          )}

          {error && <ErrorBlock message={error} />}

          {/* ── STAGE 1 — Application Type ── */}
          {stage === 1 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={1} active={true} /> &nbsp; Select Application Type
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18 }}>
                Click a type to pre-fill the document package. The engine will build the correct set of documents automatically.
              </div>

              {/* Track filter */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                {(['all', 'civil', 'criminal', 'appeal', 'frep', 'matrimonial'] as const).map(t => (
                  <button key={t} onClick={() => setTrackFilter(t)}
                    style={{
                      background: trackFilter === t ? '#181828' : 'transparent',
                      border: trackFilter === t ? '1px solid #4090d0' : '1px solid #282840',
                      color: trackFilter === t ? '#4090d0' : '#505068',
                      borderRadius: 4, padding: '5px 12px', fontSize: 11, cursor: 'pointer',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}>
                    {t === 'all' ? 'All' : t === 'frep' ? 'FREP' : t === 'matrimonial' ? 'Matrimonial' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Type cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {filteredTypes.map(type => (
                  <button key={type.id} onClick={() => setSelectedType(type)}
                    style={{
                      background: selectedType?.id === type.id ? '#080f1a' : '#080814',
                      border: `1px solid ${selectedType?.id === type.id ? '#4090d0' : '#1e1e34'}`,
                      borderRadius: 7, padding: '12px 16px', textAlign: 'left',
                      cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                    }}>
                    <span style={{ fontSize: 20, opacity: selectedType?.id === type.id ? 1 : 0.5, flexShrink: 0, marginTop: 2 }}>{type.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: selectedType?.id === type.id ? '#f0ece0' : '#a0a0c0', fontWeight: 600, marginBottom: 3 }}>
                        {type.label}
                      </div>
                      <div style={{ fontSize: 11, color: selectedType?.id === type.id ? '#808098' : '#404058', lineHeight: 1.55, marginBottom: 6 }}>
                        {type.hint}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {type.package.map((doc, i) => (
                          <span key={i} style={{ fontSize: 10, color: '#4090d0', background: '#4090d010', border: '1px solid #4090d030', borderRadius: 3, padding: '1px 6px' }}>{doc}</span>
                        ))}
                      </div>
                    </div>
                    {selectedType?.id === type.id && <span style={{ fontSize: 14, color: '#4090d0', flexShrink: 0, marginTop: 2 }}>✓</span>}
                  </button>
                ))}
              </div>

              {/* Custom type fallback */}
              <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '14px 16px', marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: '#808098', marginBottom: 8 }}>Not listed above? Describe the application:</div>
                <TA value={customTypeText} onChange={setCustomTypeText}
                  placeholder="e.g. Application to set aside a default judgment entered against my client — they were not properly served"
                  rows={3} />
                {customTypeText.trim() && (
                  <div style={{ marginTop: 10 }}>
                    <Btn label="Use Custom Description →" accent="#4090d0"
                      onClick={() => setSelectedType({
                        id: 'custom', label: customTypeText.slice(0, 60).trim(), icon: '📄', track: 'all',
                        package: ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
                        hint: customTypeText,
                      })} />
                  </div>
                )}
              </div>

              <Btn label="Continue to Facts →" onClick={() => setStage(2)} off={!canGoToStage2} accent="#4090d0" />
            </div>
          )}

          {/* ── STAGE 2 — Application Facts ── */}
          {stage === 2 && selectedType && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={2} active={true} /> &nbsp; Application Facts
              </div>

              {/* Clone notice — shown when this record was cloned from another case */}
              {(facts as Record<string, string>)['_clone_notice'] && (
                <div style={{ background: '#1a1200', border: '1px solid #4a3800', borderRadius: 7, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#c8a840', lineHeight: 1.65 }}>
                  ⚠ {(facts as Record<string, string>)['_clone_notice']}
                </div>
              )}

              {/* Type reminder */}
              <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{selectedType.icon}</span>
                <div>
                  <div style={{ fontSize: 13, color: '#4090d0', fontWeight: 600 }}>{selectedType.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {selectedType.package.map((doc, i) => (
                      <span key={i} style={{ fontSize: 10, color: '#4090d0', background: '#4090d010', border: '1px solid #4090d030', borderRadius: 3, padding: '1px 6px' }}>{doc}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── ROLE PICKER — first thing in Stage 2 ── */}
              {!stage3.applicationRole ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ece0', marginBottom: 10 }}>
                    In this application, I am:
                  </div>
                  <div style={{ fontSize: 12, color: '#808098', marginBottom: 14, lineHeight: 1.6 }}>
                    In a Nigerian court, any party can file an application at any stage of proceedings.
                    Your role in the main suit does not determine your role here.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                    {([
                      {
                        role: 'mover' as const,
                        icon: '⚡',
                        title: 'Applicant / Mover',
                        desc: 'I filed this motion. I am urging the court to grant the reliefs I seek. I will file: Motion Paper + Supporting Affidavit + Written Address in Support. If opposed, I may later file a Further & Better Affidavit and a Reply on Points of Law.',
                      },
                      {
                        role: 'respondent' as const,
                        icon: '🛡',
                        title: 'Respondent to Application',
                        desc: 'I am opposing this motion filed by the other party. Paste the Motion Paper and Written Address filed against my client — the engine will extract the grounds and map the opposition. I will file: Counter-Affidavit + Written Address in Opposition.',
                      },
                    ]).map(opt => (
                      <button key={opt.role} onClick={() => setStage3(s => ({ ...s, applicationRole: opt.role }))}
                        style={{
                          background: '#080814', border: '1px solid #1e1e34', borderRadius: 8,
                          padding: '18px 20px', textAlign: 'left', cursor: 'pointer',
                          display: 'flex', alignItems: 'flex-start', gap: 14,
                        }}>
                        <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{opt.icon}</span>
                        <div>
                          <div style={{ fontSize: 14, color: '#f0ece0', fontWeight: 700, marginBottom: 6 }}>{opt.title}</div>
                          <div style={{ fontSize: 12, color: '#808098', lineHeight: 1.65 }}>{opt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: '#404058', lineHeight: 1.6 }}>
                    Note: Being the claimant or defendant in the main suit does not determine which role you occupy here.
                    A defendant can bring a motion; a claimant can be the respondent to a motion brought by the defendant.
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <Btn label="← Back" onClick={() => setStage(1)} accent="#505068" small />
                  </div>
                </div>
              ) : (
                <div>
                  {/* Role badge + change link */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '8px 14px' }}>
                    <span style={{ fontSize: 16 }}>{stage3.applicationRole === 'mover' ? '⚡' : '🛡'}</span>
                    <span style={{ fontSize: 13, color: '#f0ece0', fontWeight: 600 }}>
                      {stage3.applicationRole === 'mover' ? 'Applicant / Mover' : 'Respondent to Application'}
                    </span>
                    <button onClick={() => setStage3(s => ({ ...s, applicationRole: null }))}
                      style={{ marginLeft: 'auto', fontSize: 11, color: '#4090d0', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      Change role
                    </button>
                  </div>

                  {/* ── MOVER PATH ── */}
                  {stage3.applicationRole === 'mover' && (
                    <div>
                      <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
                        The Intelligence Engine context is loaded. Click <strong style={{ color: '#4090d0' }}>Auto-derive from Intelligence</strong> to extract
                        reliefs, grounds, and key facts automatically — then review and correct before proceeding.
                      </div>

                      {/* Auto-derive button */}
                      {!facts.autoReliefs && !facts.autoGrounds && (
                        <div style={{ marginBottom: 20 }}>
                          <Btn label={derivingFacts ? '⏳ Deriving from Intelligence…' : '⚡ Auto-derive from Intelligence'}
                            onClick={handleAutoDerive} loading={derivingFacts} accent="#4090d0" />
                          <div style={{ fontSize: 11, color: '#404058', marginTop: 8 }}>
                            Reads the Intelligence Package and derives reliefs, grounds, and key facts for a {selectedType?.label}.
                          </div>
                        </div>
                      )}

                      {deriveError && <div style={{ background: '#1a0808', border: '1px solid #4a1a1a', borderRadius: 7, padding: '10px 14px', fontSize: 12, color: '#c06060', marginBottom: 14 }}>⚠ {deriveError}</div>}

                      {/* Auto-derived fields — editable */}
                      {(facts.autoReliefs || facts.autoGrounds || facts.autoKeyFacts) && (
                        <div style={{ background: '#07101e', border: '1px solid #1e3050', borderRadius: 8, padding: '16px 18px', marginBottom: 18 }}>
                          <div style={{ fontSize: 11, color: '#4090d0', fontWeight: 700, marginBottom: 14, letterSpacing: '0.04em' }}>
                            ⚡ AUTO-DERIVED — Review and correct before proceeding
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <SLabel text="Relief Sought (AI-derived — edit as needed)" />
                            <TA value={facts.autoReliefs} onChange={v => setFacts(p => ({ ...p, autoReliefs: v }))} rows={5}
                              placeholder="AI will populate from Intelligence Package" />
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <SLabel text="Grounds (AI-derived — edit as needed)" />
                            <TA value={facts.autoGrounds} onChange={v => setFacts(p => ({ ...p, autoGrounds: v }))} rows={4}
                              placeholder="AI will populate from Intelligence Package" />
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <SLabel text="Key Facts / Affidavit Narrative (AI-derived — edit as needed)" />
                            <TA value={facts.autoKeyFacts} onChange={v => setFacts(p => ({ ...p, autoKeyFacts: v }))} rows={6}
                              placeholder="AI will populate from Intelligence Package" />
                          </div>
                          <button onClick={handleAutoDerive} disabled={derivingFacts}
                            style={{ fontSize: 11, color: '#4090d0', background: 'transparent', border: 'none', cursor: derivingFacts ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}>
                            ↻ Re-derive
                          </button>
                        </div>
                      )}

                      <div style={{ marginBottom: 14 }}>
                        <SLabel text="Affidavit Deponent" />
                        <TA value={facts.deponent} onChange={v => setFacts(p => ({ ...p, deponent: v }))}
                          placeholder="e.g. Chukwuemeka Obi, the Claimant / a clerk in the employ of counsel" rows={2} />
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <SLabel text="Parties (if different from case file)" />
                        <TA value={facts.parties} onChange={v => setFacts(p => ({ ...p, parties: v }))}
                          placeholder={`${activeCase.claimants[0]?.name ?? 'Claimant'} v ${activeCase.defendants[0]?.name ?? 'Defendant'}`} rows={2} />
                      </div>
                      <div style={{ marginBottom: 20 }}>
                        <SLabel text="Additional Strategic Context (counsel's instructions)" />
                        <TA value={facts.additionalContext} onChange={v => setFacts(p => ({ ...p, additionalContext: v }))}
                          placeholder="Strategic constraints, recent developments, what opposing counsel is likely to argue…" rows={3} />
                      </div>
                    </div>
                  )}

                  {/* ── RESPONDENT PATH ── */}
                  {stage3.applicationRole === 'respondent' && (
                    <div>
                      <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
                        Paste the documents served on your client. The engine will extract the Applicant's grounds and reliefs
                        and map your opposition — so you focus on instructions, not re-typing what opposing counsel already wrote.
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <SLabel text="Motion Paper / Notice of Motion (as served)" />
                        <TA value={stage3.motionPaperIn}
                          onChange={v => { setStage3(s => ({ ...s, motionPaperIn: v })); setOppExtractResult(null); }}
                          placeholder="Paste the Motion Paper or Notice of Motion filed against your client — heading, grounds, reliefs sought."
                          rows={8} />
                      </div>

                      <div style={{ marginBottom: 18 }}>
                        <SLabel text="Applicant's Written Address in Support (if served)" />
                        <TA value={stage3.applicantWrittenAddressIn}
                          onChange={v => { setStage3(s => ({ ...s, applicantWrittenAddressIn: v })); setOppExtractResult(null); }}
                          placeholder="Paste the Applicant's Written Address in Support — legal arguments made in favour of the application."
                          rows={8} />
                      </div>

                      {/* Extract & Analyse button */}
                      <Btn label={extractingOpp ? '⏳ Extracting & Analysing…' : '🔍 Extract & Analyse Opposition'}
                        onClick={handleExtractOpp} loading={extractingOpp}
                        off={!stage3.motionPaperIn.trim() && !stage3.applicantWrittenAddressIn.trim()}
                        accent="#c09040" />

                      {extractError && <div style={{ background: '#1a0808', border: '1px solid #4a1a1a', borderRadius: 7, padding: '10px 14px', fontSize: 12, color: '#c06060', marginTop: 14 }}>⚠ {extractError}</div>}

                      {oppExtractResult && (
                        <div style={{ background: '#07101e', border: '1px solid #1e3050', borderRadius: 8, padding: '16px 18px', marginTop: 18 }}>
                          <div style={{ fontSize: 11, color: '#c09040', fontWeight: 700, marginBottom: 14, letterSpacing: '0.04em' }}>
                            🔍 EXTRACTION RESULT — Confirm before proceeding to Stage 3
                          </div>
                          {oppExtractResult.reliefs_being_opposed.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#606080', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Reliefs Being Opposed</div>
                              {oppExtractResult.reliefs_being_opposed.map((r, i) => (
                                <div key={i} style={{ fontSize: 12, color: '#9090a8', paddingLeft: 12, borderLeft: '2px solid #1e2a40', marginBottom: 4, lineHeight: 1.55 }}>{r}</div>
                              ))}
                            </div>
                          )}
                          {oppExtractResult.our_counter_grounds.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#40a060', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Preliminary Counter-Grounds</div>
                              {oppExtractResult.our_counter_grounds.map((g, i) => (
                                <div key={i} style={{ fontSize: 12, color: '#70c088', paddingLeft: 12, borderLeft: '2px solid #1a3a20', marginBottom: 4, lineHeight: 1.55 }}>{g}</div>
                              ))}
                            </div>
                          )}
                          {oppExtractResult.issues_for_opposition.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#c09040', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Issues for Opposition</div>
                              {oppExtractResult.issues_for_opposition.map((iss, i) => (
                                <div key={i} style={{ fontSize: 12, color: '#c0a858', paddingLeft: 12, borderLeft: '2px solid #3a2800', marginBottom: 4, lineHeight: 1.55 }}>{iss}</div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
                            <button onClick={handleExtractOpp} disabled={extractingOpp}
                              style={{ fontSize: 11, color: '#c09040', background: 'transparent', border: 'none', cursor: extractingOpp ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}>
                              ↻ Re-extract
                            </button>
                            {oppExtractResult.issues_for_opposition.length > 0 && (
                              <button
                                onClick={() => {
                                  const seeded: ArgumentIssue[] = oppExtractResult.issues_for_opposition.map((iss, i) => ({
                                    id:          `resp_issue_${Date.now()}_${i}`,
                                    issue:       iss,
                                    rule:        '',
                                    application: '',
                                    conclusion:  '',
                                    draft:       '',
                                  }));
                                  setStage3(s => ({ ...s, respIssues: seeded }));
                                }}
                                style={{ fontSize: 11, color: '#40a060', background: '#050d06', border: '1px solid #1a3020', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>
                                ✓ Confirm &amp; Seed Issues into Written Address
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div style={{ marginTop: 18, marginBottom: 14 }}>
                        <SLabel text="Affidavit Deponent" />
                        <TA value={facts.deponent} onChange={v => setFacts(p => ({ ...p, deponent: v }))}
                          placeholder="e.g. Chukwuemeka Obi, the Respondent / a clerk in the employ of counsel for the Respondent" rows={2} />
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <SLabel text="Parties (if different from case file)" />
                        <TA value={facts.parties} onChange={v => setFacts(p => ({ ...p, parties: v }))}
                          placeholder={`${activeCase.claimants[0]?.name ?? 'Claimant'} v ${activeCase.defendants[0]?.name ?? 'Defendant'}`} rows={2} />
                      </div>
                      <div style={{ marginBottom: 20 }}>
                        <SLabel text="Additional Strategic Context (counsel's instructions)" />
                        <TA value={facts.additionalContext} onChange={v => setFacts(p => ({ ...p, additionalContext: v }))}
                          placeholder="Strategic constraints, preliminary objections, what the Respondent's position is…" rows={3} />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                    <Btn label="← Back" onClick={() => setStage(1)} accent="#505068" small />
                    <Btn label="Continue to Arguments →" onClick={() => setStage(3)} off={!canGoToStage3} accent="#4090d0" />
                    <Btn label="Skip to Assemble" onClick={() => { setStage(4); handleAssemble(); }}
                      off={!canGoToStage3} loading={loading} accent="#808098" small />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STAGE 3 — Argument Builder ── */}
          {stage === 3 && selectedType && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={3} active={true} /> &nbsp; Argument Builder
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18, lineHeight: 1.6 }}>
                Build each document for this application. Draft documents appear in the final assembled package.
              </div>

              <ArgumentBuilderStage
                activeCase={activeCase} appType={selectedType} facts={facts}
                stage3={stage3} onStage3={setStage3}
                onChangeRole={() => { setStage3(s => ({ ...s, applicationRole: null })); setStage(2); }}
                systemCtx={systemCtx}
              />

              <div style={{ display: 'flex', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #181828', flexWrap: 'wrap' }}>
                <Btn label="← Back to Facts" onClick={() => setStage(2)} accent="#505068" small />
                <Btn label="Assemble Full Package →" onClick={() => { setStage(4); handleAssemble(); }} loading={loading} accent="#4090d0" />
              </div>
            </div>
          )}

          {/* ── STAGE 4 — Generated Package ── */}
          {stage === 4 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0' }}>
                  <StepBadge n={4} active={!generated} done={!!generated} /> &nbsp;
                  {loading ? 'Assembling Package…' : `Package — ${selectedType?.label}`}
                </div>
                {generated && !loading && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn label="Save to History" onClick={handleSave} accent="#40a060" small />
                    <Btn label="↻ Re-assemble"   onClick={handleAssemble} loading={loading} accent="#4090d0" small />
                    <Btn label="← Edit Arguments" onClick={() => setStage(3)} accent="#505068" small />
                    <Btn label="New Application"  onClick={resetWorkflow} accent="#808098" small />
                  </div>
                )}
              </div>

              {loading && (
                <div style={{ color: '#4090d0', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
                  ⟳ Drafting {selectedType?.package.join(' · ')}…
                </div>
              )}

              {error && !loading && <ErrorBlock message={error} />}

              {generated && !loading && (
                <div>
                  <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '20px 22px', lineHeight: 1.85, fontSize: 13 }}>
                    <Md text={generated} />
                  </div>

                  <MandatoryNotice />
                </div>
              )}
            </div>
          )}

          {/* ── STAGE 5 — Tracker (accessible via stage bar click) ── */}
          {stage === 5 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
                <StepBadge n={5} active={true} /> &nbsp; Applications Tracker
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 18 }}>
                Track every application filed in this matter — status, dates, rulings.
              </div>
              <ApplicationsTracker caseId={activeCase.id} />
            </div>
          )}
        </div>
      )}

      {/* ══ TEMPLATES TAB ══ */}
      {mainTab === 'templates' && (
        <div>
          <ArgumentTemplateManager
            activeCase={activeCase}
            onApplyDraft={(draft) => {
              // Phase 2D-i: navigate to the New Application tab and seed the
              // mover written address with the selected template draft so counsel
              // can review, edit, and re-assemble without re-running the full
              // issue-by-issue flow from scratch.
              setStage3(s => ({ ...s, writtenAddress: draft }));
              setMainTab('new');
              setStage(3);
            }}
          />
        </div>
      )}

      {/* ══ TRACKER TAB ══ */}
      {mainTab === 'tracker' && (
        <div>
          <div style={{ fontSize: 14, color: '#808098', marginBottom: 20, lineHeight: 1.6 }}>
            Track every application filed in this matter. Update status as proceedings advance.
          </div>
          <ApplicationsTracker caseId={activeCase.id} />

          {/* Saved drafts */}
          {historyLoaded && history.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: 13, color: '#4090d0', fontWeight: 700, marginBottom: 14, borderBottom: '1px solid #181828', paddingBottom: 8 }}>
                Saved Drafts ({history.length})
              </div>

              {!selectedRecord ? (
                <div>
                  {history.map(rec => (
                    <div key={rec.id}
                      style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 7, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      onClick={() => setSelectedRecord(rec)}>
                      <div>
                        <div style={{ fontSize: 14, color: '#4090d0', fontWeight: 600, marginBottom: 4 }}>{rec.appType}</div>
                        <div style={{ fontSize: 12, color: '#808098' }}>
                          {new Date(rec.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button
                          onClick={e => { e.stopPropagation(); resumeRecord(rec); }}
                          title="Continue editing"
                          style={{ background: 'none', border: '1px solid #1e2a3a', borderRadius: 4, color: '#4090d0', cursor: 'pointer', fontSize: 13, padding: '3px 8px', lineHeight: 1 }}>
                          ✎
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setCloneTarget(rec); }}
                          title="Clone to another case"
                          style={{ background: 'none', border: '1px solid #1e2a3a', borderRadius: 4, color: '#4090d0', cursor: 'pointer', fontSize: 13, padding: '3px 8px', lineHeight: 1 }}>
                          ⎘
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDelete(rec.id); }}
                          style={{ background: 'none', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}>✕</button>
                      </div>
                    </div>

                  ))}
                </div>
              ) : (
                <div>
                  <button onClick={() => setSelectedRecord(null)}
                    style={{ background: 'none', border: 'none', color: '#4090d0', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12 }}>
                    ← Back to list
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f0ece0' }}>{selectedRecord.appType}</div>
                    <Btn label="✎ Continue Editing →" onClick={() => resumeRecord(selectedRecord)} accent="#4090d0" small />
                  </div>
                  <div style={{ fontSize: 12, color: '#505068', marginBottom: 16 }}>
                    {new Date(selectedRecord.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                  {selectedRecord.documents ? (
                    <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '20px 22px', lineHeight: 1.85, fontSize: 13 }}>
                      <Md text={selectedRecord.documents} />
                    </div>
                  ) : (
                    <div style={{ background: '#080814', border: '1px dashed #282840', borderRadius: 8, padding: '20px 22px', fontSize: 13, color: '#808098', textAlign: 'center' }}>
                      No draft generated yet for this record{(selectedRecord.facts as Record<string, string>)['_clone_notice'] ? ' — cloned from another case' : ''}. Click "Continue Editing" above to fill in the facts and generate a draft.
                    </div>
                  )}
                  {selectedRecord.documents && <MandatoryNotice />}
                </div>
              )}
            </div>
          )}
        </div>

      )}
    </div>

    {/* ── Clone Draft Modal ───────────────────────────────────────────────── */}
    {cloneTarget && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#0d0d1a', border: '1px solid #2a2a44', borderRadius: 10, padding: '28px 30px', width: 440, maxWidth: '92vw' }}>

          <div style={{ fontSize: 16, fontWeight: 700, color: '#f0ece0', marginBottom: 6 }}>
            Clone to Another Case
          </div>
          <div style={{ fontSize: 12, color: '#505068', marginBottom: 18 }}>
            {cloneTarget.appType}
          </div>

          {!allCasesLoaded ? (
            <div style={{ fontSize: 13, color: '#808098', marginBottom: 18 }}>Loading cases…</div>
          ) : allCases.length === 0 ? (
            <div style={{ fontSize: 13, color: '#905050', marginBottom: 18 }}>No other cases found.</div>
          ) : (
            <select
              value={selectedCloneCaseId}
              onChange={e => setSelectedCloneCaseId(e.target.value)}
              style={{ width: '100%', background: '#080814', border: '1px solid #2a2a44', borderRadius: 6, color: '#d0ccbc', padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
              <option value="">— Select target case —</option>
              {allCases.map(c => (
                <option key={c.id} value={c.id}>
                  {c.caseName}{c.jurisdiction ? ` · ${c.jurisdiction}` : ''}
                </option>
              ))}
            </select>
          )}

          <div style={{ fontSize: 11, color: '#505068', marginBottom: 20, lineHeight: 1.65 }}>
            The application structure will be copied to the selected case. All case-specific facts will be cleared. Open that case → Applications to complete the facts and generate a new draft.
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              disabled={!selectedCloneCaseId || cloneInProgress}
              onClick={async () => {
                if (!selectedCloneCaseId || cloneInProgress) return;
                setCloneInProgress(true);
                try {
                  const targetCase = allCases.find(c => c.id === selectedCloneCaseId);
                  const cloned = await cloneApplicationToCase({
                    sourceRecord:   cloneTarget as unknown as import('@/types').CloneableApplicationRecord,
                    targetCaseId:   selectedCloneCaseId,
                    sourceCaseName: activeCase.caseName,
                  });
                  // cloneApplicationToCase only writes to local storage (saveBlindSpot).
                  // Every other create path (handleAssemble) also pushes to the remote
                  // worker — without this, the clone gets silently overwritten the
                  // moment the target case's ApplicationsEngine mounts and workerLoad
                  // returns any pre-existing remote records for that case.
                  await workerSave(cloned as unknown as ApplicationRecord);
                  setCloneTarget(null);
                  setSelectedCloneCaseId('');
                  alert(`Cloned to "${targetCase?.caseName ?? 'selected case'}". Open that case → Applications to complete the facts.`);
                } catch (err) {
                  console.error('[ApplicationsEngine] clone failed', err);
                  alert('Clone failed — see console for details.');
                } finally {
                  setCloneInProgress(false);
                }
              }}
              style={{
                background:   selectedCloneCaseId && !cloneInProgress ? '#1a3a5a' : '#111122',
                border:       '1px solid #2a2a44',
                borderRadius: 6,
                color:        selectedCloneCaseId && !cloneInProgress ? '#4090d0' : '#404058',
                cursor:       selectedCloneCaseId && !cloneInProgress ? 'pointer' : 'not-allowed',
                padding:      '9px 18px',
                fontSize:     13,
                fontWeight:   600,
              }}>
              {cloneInProgress ? 'Cloning…' : 'Clone'}
            </button>
            <button
              onClick={() => { setCloneTarget(null); setSelectedCloneCaseId(''); }}
              style={{ background: 'none', border: '1px solid #2a2a44', borderRadius: 6, color: '#808098', cursor: 'pointer', padding: '9px 18px', fontSize: 13 }}>
              Cancel
            </button>
          </div>

        </div>
      </div>
    )}
    </>
  );
}
