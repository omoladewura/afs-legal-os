/**
 * AFS Advocates — SynthesisEngine pure logic
 *
 * Extracted so the three core functions can be unit-tested without
 * importing React or any browser-only module.
 *
 * Consumed by:
 *   - SynthesisEngine.tsx  (runtime)
 *   - SynthesisEngine.test.ts  (vitest)
 */

import type { Case } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES  (shared between engine + tests)
// ─────────────────────────────────────────────────────────────────────────────

export type SynthesisMode = 'civil' | 'criminal' | 'appeal';

export interface ReadinessItem {
  id:     string;
  label:  string;
  met:    boolean;
  engine: string;   // tab id to navigate to
}

/**
 * Risk data shape that SynthesisEngine works with.
 * After Phase 3 the canonical source is intelligence_data.risk_verdict.
 * The legacy loadBlindSpot('risk_result') is kept as a fallback for cases
 * that ran RiskAnalytics before the pipeline migration.
 */
export interface SynthesisRisk {
  verdict:              string;   // FILE | NEGOTIATE | SETTLE | WALK_AWAY
  recommendation:       string;
  scores:               Record<string, number>;
  reasoning:            Record<string, string>;
  appellate_narrative?: string;
  batna_notes?:         string;
}

export interface AllInputs {
  /** Canonical risk data from intelligence_data.risk_verdict (Phase 3+) */
  riskResult:         SynthesisRisk | null;
  crossExamData:      unknown;
  warRoomData:        unknown;
  argBuilderData:     unknown;
  prevSynthesis:      unknown;
  /** Intelligence Package prose from intelligence_data.intPkg */
  intPkg:             string;
  appealData:         unknown;
  criminalDefData:    unknown;
  /** Authority hierarchy + overruled-flag narrative (Phase 5A) */
  authorityGrounding: {
    hierarchy_map:  string;
    conflict_flags: string;
    status:         string;
    summary:        string;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-detects synthesis mode from case state.
 *
 * Priority order (highest → lowest):
 *   1. appeal_data.package present → 'appeal'
 *      (A case can start criminal/civil and gain appeal_data later;
 *       once it does, the theory must be appellate.)
 *   2. matter_track === 'criminal' → 'criminal'
 *   3. Everything else → 'civil'
 *      (Includes 'matrimonial' — matrimonial matters have their own
 *       dedicated engines and never reach SynthesisEngine in normal flow,
 *       but if they do, civil sections are the safe fallback.)
 */
export function detectMode(activeCase: Pick<Case, 'appeal_data' | 'matter_track'>): SynthesisMode {
  if (activeCase.appeal_data?.package) return 'appeal';
  if (activeCase.matter_track === 'criminal') return 'criminal';
  return 'civil';
}

export function modeLabel(mode: SynthesisMode): string {
  if (mode === 'appeal')   return 'Appeal Master Theory';
  if (mode === 'criminal') return 'Criminal Master Defence Theory';
  return 'Civil Master Case Theory';
}

export function modeIcon(mode: SynthesisMode): string {
  if (mode === 'appeal')   return '↑';
  if (mode === 'criminal') return '⚖';
  return '◎';
}

// ─────────────────────────────────────────────────────────────────────────────
// READINESS CHECK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the ordered list of readiness gates for the given mode.
 * `met` is true when the corresponding engine output is available.
 *
 * Civil   — intelligence + builder + risk + authority
 * Criminal — criminal defence + builder + risk + authority
 * Appeal  — appeal package + builder + authority
 *
 * Authority grounding is required for all modes because the prompt injects
 * the hierarchy map and conflict flags regardless of track.
 */
export function checkReadiness(
  mode: SynthesisMode,
  inputs: Pick<AllInputs,
    'intPkg' | 'riskResult' | 'argBuilderData' |
    'criminalDefData' | 'appealData' | 'authorityGrounding'
  >,
): ReadinessItem[] {
  const hasIntPkg     = Boolean(inputs.intPkg && inputs.intPkg.length > 50);
  const hasRisk       = Boolean(inputs.riskResult);
  const hasArgBuilder = Boolean(inputs.argBuilderData);
  const hasCrimDef    = Boolean(inputs.criminalDefData);
  const hasAppeal     = Boolean(inputs.appealData);
  const hasAuthority  = Boolean(inputs.authorityGrounding);

  if (mode === 'civil') {
    return [
      { id: 'intelligence', label: 'Intelligence Package generated',      met: hasIntPkg,    engine: 'intelligence' },
      { id: 'builder',      label: 'At least one Argument Builder draft', met: hasArgBuilder, engine: 'builder'      },
      { id: 'risk',         label: 'Risk verdict available',              met: hasRisk,       engine: 'risk'         },
      { id: 'authority',    label: 'Authority grounding run',             met: hasAuthority,  engine: 'intelligence' },
    ];
  }

  if (mode === 'criminal') {
    return [
      { id: 'criminal',  label: 'Criminal Defence analysis run',          met: hasCrimDef,    engine: 'criminal'     },
      { id: 'builder',   label: 'At least one Argument Builder draft',    met: hasArgBuilder, engine: 'builder'      },
      { id: 'risk',      label: 'Risk verdict available',                 met: hasRisk,       engine: 'risk'         },
      { id: 'authority', label: 'Authority grounding run',                met: hasAuthority,  engine: 'intelligence' },
    ];
  }

  // appeal
  return [
    { id: 'appeal',    label: 'Appeal Engine package completed',        met: hasAppeal,    engine: 'appeal'       },
    { id: 'builder',   label: 'At least one Argument Builder draft',    met: hasArgBuilder, engine: 'builder'      },
    { id: 'authority', label: 'Authority grounding run',                met: hasAuthority,  engine: 'intelligence' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildSynthesisPrompt(
  mode: SynthesisMode,
  activeCase: Case,
  inputs: AllInputs,
): string {
  const caseTitle   = activeCase.caseName || 'Untitled Matter';
  const court       = activeCase.court || '';
  const riskVerdict = inputs.riskResult
    ? `${inputs.riskResult.verdict} — ${inputs.riskResult.recommendation}`
    : 'Not available';

  const riskWarn = inputs.riskResult &&
    (inputs.riskResult.verdict === 'SETTLE' || inputs.riskResult.verdict === 'WALK_AWAY')
      ? `⚠ RISK ALERT: Risk Analytics returned "${inputs.riskResult.verdict}". This must be the first thing addressed in The Risk-Adjusted Strategy section — lead with the red flag before any theory.`
      : '';

  // ── Authority grounding block (Phase 5A) ──────────────────────────────────
  const authorityBlock = inputs.authorityGrounding
    ? `\nAUTHORITY GROUNDING [Status: ${inputs.authorityGrounding.status}]:\n${inputs.authorityGrounding.summary}\n\nHierarchy Map:\n${inputs.authorityGrounding.hierarchy_map}\n\nConflict Flags:\n${inputs.authorityGrounding.conflict_flags}`
    : '\nAUTHORITY GROUNDING:\n(not yet run — run Intelligence Step 5 to generate)';

  // ── Appellate narrative (Phase 3B — folded into risk_verdict) ────────────
  const appellateBlock = inputs.riskResult?.appellate_narrative
    ? `\nAPPELLATE VULNERABILITY NARRATIVE:\n${inputs.riskResult.appellate_narrative}`
    : '';

  // ── BATNA notes (Phase 4B — folded into risk_verdict) ────────────────────
  const batnaBlock = inputs.riskResult?.batna_notes
    ? `\nBATNA / SETTLEMENT NOTES:\n${inputs.riskResult.batna_notes}`
    : '';

  const sharedContext = `
CASE: ${caseTitle}
COURT: ${court}
MATTER TRACK: ${activeCase.matter_track ?? 'civil'}
COUNSEL ROLE: ${activeCase.counsel_role ?? 'claimant_side'}

INTELLIGENCE PACKAGE:
${inputs.intPkg || '(not available)'}

RISK VERDICT: ${riskVerdict}
${riskWarn}
${appellateBlock}
${batnaBlock}
${authorityBlock}

ARGUMENT BUILDER DRAFTS:
${inputs.argBuilderData ? JSON.stringify(inputs.argBuilderData, null, 2).slice(0, 4000) : '(not available)'}

CROSS-EXAMINATION DATA:
${inputs.crossExamData ? JSON.stringify(inputs.crossExamData, null, 2).slice(0, 2000) : '(not available)'}

WAR ROOM DATA:
${inputs.warRoomData ? JSON.stringify(inputs.warRoomData, null, 2).slice(0, 2000) : '(not available)'}
`.trim();

  // ─── Civil ───────────────────────────────────────────────────────────────

  if (mode === 'civil') {
    return `You are a senior Nigerian advocate. You are NOT generating new legal analysis. You are finding the single coherent case theory that reconciles ALL the engine outputs provided below.

CRITICAL INSTRUCTION: Where engines contradict each other (e.g. Risk Analytics says SETTLE but Argument Builder has a strong draft), surface the contradiction EXPLICITLY in the relevant section. Do NOT resolve contradictions silently.

${sharedContext}

Produce the CIVIL MASTER CASE THEORY in exactly these six sections. Use clear headings:

1. THE DECISIVE ISSUE
What is the single most important factual or legal question this case will turn on? One paragraph. Precise.

2. THE WINNING THEORY OF FACTS
The narrative of facts that, if believed, guarantees the client wins. Built from the Intelligence Package. Credible, coherent, consistent with every established fact.

3. THE KILLING GROUND
The witnesses, contradictions, and cross-examination opportunities that will break the opposing case. Draw from CrossExam data and WarRoom intelligence. Identify each by name or label.

4. THE LEGAL FRAMEWORK
The legal arguments sequenced in order of strength. Drawn from Argument Builder drafts. Each argument linked to the issue it resolves.

5. THE RISK-ADJUSTED STRATEGY
${riskWarn ? riskWarn + '\n' : ''}Integrate the Risk Analytics verdict into the case theory. Recommended litigation posture (FILE / NEGOTIATE / SETTLE / WALK_AWAY) with the concrete actions that posture requires. If Risk Analytics and Argument Builder are in tension, say so directly.

6. IMMEDIATE ACTIONS
3–5 concrete actions counsel must take before the next hearing. Specific. Ordered by urgency.

Output only the six sections. No preamble. No disclaimer. Counsel will review.`;
  }

  // ─── Criminal ────────────────────────────────────────────────────────────

  if (mode === 'criminal') {
    const crimData = inputs.criminalDefData
      ? JSON.stringify(inputs.criminalDefData, null, 2).slice(0, 3000)
      : '(not available)';

    return `You are a senior Nigerian criminal defence advocate. You are NOT generating new legal analysis. You are finding the single coherent defence theory that reconciles ALL the engine outputs provided below.

CRITICAL INSTRUCTION: Where engines contradict each other, surface the contradiction EXPLICITLY. Do NOT resolve contradictions silently.

${sharedContext}

CRIMINAL DEFENCE ANALYSIS:
${crimData}

Produce the CRIMINAL MASTER DEFENCE THEORY in exactly these six sections:

1. THE CORE DEFENCE
The single acquittal theory (or minimum sentence strategy if full acquittal is improbable). One paragraph. Definitive. The theory every subsequent action must support.

2. THE PROSECUTION'S WEAKNESSES
Per-element failure analysis for each count. Which elements of the offence have the prosecution failed or likely to fail to prove beyond reasonable doubt? Precise references to evidence gaps.

3. WITNESS DESTRUCTION PLAN
Per prosecution witness: their evidence-in-chief summary, identified weakness, and the cross-examination line that exploits it. Drawn from CrossExam data. Named per witness.

4. CONSTITUTIONAL AND PROCEDURAL WEAPONS
Every arguable procedural violation and available interlocutory application — bail, preliminary objection, no-case submission grounds, ACJA rights breaches, constitutional issues. Each framed as an actionable weapon.

5. RISK ASSESSMENT
Probability of acquittal per count (HIGH / MEDIUM / LOW). If Risk Analytics returned SETTLE or WALK_AWAY equivalent, say so explicitly and identify which count(s) carry the highest conviction risk.

6. IMMEDIATE ACTIONS
3–5 concrete actions counsel must take before the next hearing. Ordered by urgency.

Output only the six sections. No preamble. No disclaimer. Counsel will review.`;
  }

  // ─── Appeal ──────────────────────────────────────────────────────────────

  const appealPkg     = activeCase.appeal_data?.package || '(not available)';
  const appealGrounds = activeCase.appeal_data?.extractedGrounds || '(not available)';

  return `You are a senior Nigerian appellate advocate. You are NOT generating new legal analysis. You are finding the single coherent appeal theory that reconciles ALL the engine outputs provided below.

CRITICAL INSTRUCTION: Where engines contradict each other, surface the contradiction EXPLICITLY. Do NOT resolve contradictions silently.

${sharedContext}

APPEAL PACKAGE:
${appealPkg.slice(0, 3000)}

EXTRACTED GROUNDS:
${appealGrounds.slice(0, 2000)}

Produce the APPEAL MASTER THEORY in exactly these six sections:

1. THE GROUND THAT WINS
The single ground of appeal with the highest probability of success. Why it wins. How it connects to the judgment below. One paragraph. Definitive.

2. THE RECORD ON APPEAL
Which grounds are fully preserved in the lower court record. Which grounds are abandoned or procedurally vulnerable. Any gaps in the record that must be remedied before filing briefs.

3. THE BRIEF ARCHITECTURE
How the Argument Builder drafts map to each ground. Sequencing of issues in the Appellant's Brief. Arguments that should lead vs. arguments that support. Flag any ground that lacks a supporting draft.

4. PROCEDURAL CALENDAR
Filing deadlines in order: Notice of Appeal, compilation of records, Appellant's Brief, service, Respondent's Brief, Reply Brief. Statute-specific timeframes where known.

5. RISK ASSESSMENT
Pursue / Negotiate / Withdraw recommendation per ground. If Risk Analytics data is available, integrate it. Flag any ground that is procedurally fatal if not remedied immediately.

6. IMMEDIATE ACTIONS
3–5 concrete actions counsel must take. Ordered by urgency.

Output only the six sections. No preamble. No disclaimer. Counsel will review.`;
}
