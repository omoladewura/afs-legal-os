/**
 * AFS Legal OS — useIntelligence Hook
 *
 * Single source of truth for reading Intelligence Engine output.
 * Every engine that needs case facts imports THIS — not raw activeCase fields.
 *
 * Returns:
 *   - intelBlock  : formatted string injected into every AI system prompt
 *   - hasIntel    : whether any intelligence data exists
 *   - counselBlock: formatted counsel instructions (if set)
 *   - fullContext : intelBlock + counselBlock + libraryLogBlock combined — pass to AI calls
 *
 * Phase 3 — Scoped Intelligence
 * ──────────────────────────────
 * Pass `scope` to limit how much intelligence context is sent:
 *
 *   'facts'   → established_facts + rawFacts/intPkg header only.
 *               Use for procedural applications (extensions, adjournments,
 *               compliance checks, alerts, enforcement) where the AI only
 *               needs to know what happened, not the full legal analysis.
 *
 *   'issues'  → facts + legal_issues + disputed_areas.
 *               Use for research tasks (CaseResearch, ResearchResolver,
 *               AuthorityValidator) that need legal framing but not the
 *               full risk register or timeline.
 *
 *   'full'    → everything (default — backwards-compatible).
 *               Use for substantive drafting: arguments, briefs, addresses,
 *               cross-exam, plea, sentencing, WarRoom, AICopilot.
 *
 * Scope is applied to intelBlock only. counselBlock is always included in
 * full and issues; omitted in facts (counsel strategy is not needed for
 * procedural tasks).
 *
 * Phase 10 — Downstream Library Log Inheritance
 * ───────────────────────────────────────────────
 * When a locked CaseTheoryRecord exists on the case, fullContext carries
 * the library_query_log assembled at Theory Lock time. This tells every
 * downstream engine:
 *   (a) which library sources grounded every proposition in the package
 *   (b) which laws the engine ran without (open_gaps) — so downstream
 *       engines do not reason as if those gaps were filled
 *   (c) which phases contributed to the log, in order of execution
 *
 * Downstream engines inherit this log and extend it with their own
 * phase-specific library queries rather than re-running the full pipeline.
 *
 * The libraryLogBlock is appended to fullContext when:
 *   - scope is 'full' (drafting engines that must reason from verified sources)
 *   - a locked theory exists with a non-empty library_query_log
 *
 * The libraryLogBlock is omitted when:
 *   - scope is 'facts' or 'issues' (procedural / research tasks)
 *   - no locked theory exists, or the log is empty
 *
 * Blind Spot Gate Overrides — Phase 6C
 * ──────────────────────────────────────
 * If the locked theory carries any overridden fatal findings (from Phase 6C),
 * those overrides are surfaced in libraryLogBlock so downstream engines know
 * they are proceeding on a case where counsel consciously accepted a flagged
 * risk. They do not re-litigate the override — they note it and proceed.
 */

import type { Case, CaseTheoryRecord, LibraryQueryLog } from '@/types';

interface IntelligenceData {
  rawFacts?:         string;
  intPkg?:           string;
  established_facts?: string[];
  disputed_areas?:   string[];
  legal_issues?:     string[];
  gaps_identified?:  string[];
  initial_risks?:    Array<{ risk: string; severity: string }>;
  timeline?:         Array<{ date: string; event: string; significance?: string }>;
  // Phase 3C — open laws gaps
  laws_needed?: Array<{
    name:       string;
    reason:     string;
    flagged_by: string;
    resolved?:  boolean;
  }>;
  // Phase 6C — blind spot gate overrides
  blind_spot_gate?: {
    entries: Array<{
      finding_index:    number;
      decision:         'addressed' | 'overridden' | 'noted';
      override_reason?: string;
      decided_at:       string;
    }>;
    cleared_at: string;
  };
  // Phase 8C — Devil's Advocate (surfaced to downstream engines)
  devils_advocate?: string;
}

export type IntelligenceScope = 'facts' | 'issues' | 'full';

export interface IntelOutput {
  /** Whether any vetted intelligence exists for this case */
  hasIntel: boolean;

  /** Structured intelligence block — inject into AI system prompts */
  intelBlock: string;

  /** Counsel instructions block — inject after intelBlock */
  counselBlock: string;

  /**
   * Phase 10 — Library Query Log block.
   * Non-empty only when scope === 'full' AND a locked theory with a
   * library_query_log exists. Downstream engines inject this to understand
   * the evidentiary foundation of every proposition in the package and
   * which laws the engine ran without.
   */
  libraryLogBlock: string;

  /** Full context = intelBlock + counselBlock + inheritanceBlock + libraryLogBlock */
  fullContext: string;

  /** Raw intelligence data fields for components that need direct access */
  raw: IntelligenceData;
}

/**
 * Formats the library_query_log from a locked CaseTheoryRecord into a
 * prompt block for downstream engines. Called only when scope === 'full'.
 *
 * The block tells the downstream engine:
 *   1. What library sources were consulted during the Intelligence pipeline
 *   2. What gaps remain open (laws the engine ran without at lock time)
 *   3. What Phase 6C blind spot overrides counsel accepted
 *
 * This is the core of Phase 10 — the handoff that makes every downstream
 * engine aware of the Intelligence Engine's evidentiary foundation without
 * requiring it to re-run the full pipeline.
 */
function buildLibraryLogBlock(
  theory:   CaseTheoryRecord,
  intel:    IntelligenceData,
): string {
  const log: LibraryQueryLog | undefined = theory.library_query_log;

  // Nothing to inject if no log was assembled at lock time
  if (!log || (log.phases.length === 0 && log.open_gaps.length === 0)) return '';

  const lines: string[] = [
    '',
    '═══════════════════════════════════════',
    'INTELLIGENCE ENGINE — LIBRARY QUERY LOG (Phase 10 Inheritance)',
    '═══════════════════════════════════════',
    'This log records every library source consulted during the Intelligence',
    'Engine pipeline and every gap that was open at Theory Lock time.',
    'Reason from the sources named here. Do not assume gaps were filled.',
    '',
  ];

  // ── Phases consulted ──────────────────────────────────────────────────────
  if (log.phases.length > 0) {
    lines.push('── LIBRARY PHASES CONSULTED ──');
    log.phases.forEach(p => {
      const status = p.retrieved ? '✓' : '○';
      lines.push(`${status} ${p.phase}: ${p.source_note}`);
    });
    lines.push('');
  }

  // ── Open gaps — laws the engine ran without ────────────────────────────────
  const openGaps = log.open_gaps ?? [];
  // Also pull any unresolved entries from intel.laws_needed that may not have
  // made it into the log at lock time (edge case: laws flagged after lock)
  const intelOpenLaws = (intel.laws_needed ?? []).filter(l => !l.resolved);

  // Deduplicate by name
  const allGaps = [...openGaps];
  intelOpenLaws.forEach(l => {
    if (!allGaps.find(g => g.name === l.name)) {
      allGaps.push({ name: l.name, reason: l.reason, flagged_by: l.flagged_by });
    }
  });

  if (allGaps.length > 0) {
    lines.push('── OPEN GAPS — LAWS NOT IN LIBRARY AT LOCK TIME ──');
    lines.push('⚑ The engine is running without the following statutes.');
    lines.push('  Do NOT reason as if these laws were available. Note the gap explicitly');
    lines.push('  in any analysis that would depend on them.');
    lines.push('');
    allGaps.forEach(g => {
      lines.push(`  ⚑ ${g.name}`);
      lines.push(`    Needed for: ${g.reason}`);
      lines.push(`    Flagged by: ${g.flagged_by}`);
      lines.push('');
    });
  } else {
    lines.push('── GAPS ──');
    lines.push('No open gaps at lock time. Library covered all flagged requirements.');
    lines.push('');
  }

  // ── Phase 6C — Blind Spot Gate overrides ─────────────────────────────────
  const overrides = (intel.blind_spot_gate?.entries ?? [])
    .filter(e => e.decision === 'overridden' && e.override_reason);

  if (overrides.length > 0) {
    lines.push('── BLIND SPOT GATE — COUNSEL OVERRIDES (Phase 6C) ──');
    lines.push('⚠ The following fatal findings were overridden by counsel.');
    lines.push('  Do not re-litigate these decisions. Proceed with awareness of the accepted risk.');
    lines.push('');
    overrides.forEach((o, i) => {
      lines.push(`  ⚠ Override ${i + 1} (Finding #${o.finding_index + 1})`);
      lines.push(`    Counsel reason: ${o.override_reason}`);
      lines.push(`    Accepted at: ${new Date(o.decided_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
      lines.push('');
    });
  }

  // ── Lock metadata ──────────────────────────────────────────────────────────
  lines.push(`Log assembled: ${new Date(log.assembled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  if (theory.lock_version) {
    lines.push(`Theory lock version: ${theory.lock_version}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Extracts and formats all intelligence from activeCase.intelligence_data
 * plus counsel instructions from activeCase.counsel_instructions.
 * Phase 10: also injects the library query log from the locked CaseTheoryRecord
 * into fullContext when scope === 'full'.
 *
 * Usage:
 *   // Full context (default — drafting engines):
 *   const { fullContext, hasIntel } = useIntelligence(activeCase);
 *
 *   // Facts only (procedural engines):
 *   const { fullContext } = useIntelligence(activeCase, 'facts');
 *
 *   // Facts + legal issues (research engines):
 *   const { fullContext } = useIntelligence(activeCase, 'issues');
 */
export function useIntelligence(
  activeCase: Case | null,
  scope: IntelligenceScope = 'full',
): IntelOutput {
  const intel = (activeCase?.intelligence_data || {}) as IntelligenceData;
  const instructions = (activeCase as any)?.counsel_instructions as string | undefined;

  const hasIntel = !!(
    intel.intPkg ||
    intel.rawFacts ||
    (intel.established_facts?.length ?? 0) > 0 ||
    (intel as any).digest
  );

  // ── Intelligence Block ────────────────────────────────────────────────────
  // Phase 5: When a digest exists, serve it instead of re-rendering the raw
  // arrays. Same precedence rule as intPkg over rawFacts. The digest is a
  // compressed prose summary generated by compressIntelligence() once the
  // pipeline reaches stage 5 — it is shorter than the full array expansion
  // and compounds with Phase 2 prompt caching (smaller cacheable block).
  //
  // Scope still applies to the digest path: 'facts' returns just the package
  // header + digest; 'issues' adds counsel block; 'full' is identical to
  // 'issues' for a digest (nothing further to add — it already contains
  // risks and gaps folded in by compressIntelligence).
  // ─────────────────────────────────────────────────────────────────────────
  const parts: string[] = [];

  if (hasIntel) {
    parts.push('═══════════════════════════════════════');
    parts.push('VETTED CASE INTELLIGENCE (Intelligence Engine Output)');
    parts.push('═══════════════════════════════════════');
    parts.push('Use ONLY these verified facts. Do not contradict them.');
    parts.push('Where silent, supplement from general legal knowledge but clearly distinguish.');
    parts.push('');
  }

  if ((intel as any).digest) {
    // ── Digest path (Phase 5) — compressed prose replaces raw arrays ─────
    parts.push('── INTELLIGENCE DIGEST ──');
    parts.push((intel as any).digest);
    parts.push('');

    // Always include the full intPkg alongside the digest when present —
    // the digest is a compression of the arrays, not a replacement for the
    // detailed package which contains specific reasoning and authorities.
    if (intel.intPkg) {
      parts.push('── INTELLIGENCE PACKAGE ──');
      parts.push(intel.intPkg);
      parts.push('');
    }
  } else {
    // ── Raw-array path (pre-digest or digest generation pending) ─────────

    // 'facts' scope: core package + established facts only
    if (intel.intPkg) {
      parts.push('── INTELLIGENCE PACKAGE ──');
      parts.push(intel.intPkg);
      parts.push('');
    }

    if (intel.established_facts?.length) {
      parts.push('── ESTABLISHED FACTS ──');
      intel.established_facts.forEach(f => parts.push(`• ${f}`));
      parts.push('');
    }

    if (intel.rawFacts && !intel.intPkg) {
      // Only show rawFacts if no processed package yet
      parts.push('── RAW FACTS (unprocessed — treat as client narration) ──');
      parts.push(intel.rawFacts);
      parts.push('');
    }

    // 'issues' scope: adds legal framing
    if (scope === 'issues' || scope === 'full') {
      if (intel.disputed_areas?.length) {
        parts.push('── DISPUTED AREAS ──');
        intel.disputed_areas.forEach(d => parts.push(`• ${d}`));
        parts.push('');
      }

      if (intel.legal_issues?.length) {
        parts.push('── LEGAL ISSUES ──');
        intel.legal_issues.forEach(i => parts.push(`• ${i}`));
        parts.push('');
      }
    }

    // 'full' scope: adds gaps, risks, timeline
    if (scope === 'full') {
      if (intel.gaps_identified?.length) {
        parts.push('── IDENTIFIED GAPS ──');
        intel.gaps_identified.forEach(g => parts.push(`• ${g}`));
        parts.push('');
      }

      if (intel.initial_risks?.length) {
        parts.push('── RISK REGISTER ──');
        intel.initial_risks.forEach(r => parts.push(`• [${r.severity}] ${r.risk}`));
        parts.push('');
      }
    }
  }

  const intelBlock = parts.join('\n');

  // ── Counsel Instructions Block ────────────────────────────────────────────
  // Omitted for 'facts' scope — procedural tasks don't need strategy notes.
  let counselBlock = '';
  if (scope !== 'facts' && instructions?.trim()) {
    counselBlock = [
      '',
      '═══════════════════════════════════════',
      'COUNSEL INSTRUCTIONS & STRATEGY NOTES',
      '═══════════════════════════════════════',
      instructions.trim(),
      '',
    ].join('\n');
  }

  // ── Inherited Matter Summary Block (Phase 4) ──────────────────────────────
  // Omitted for 'facts' scope — procedural engines don't need it. Injected
  // after counselBlock so it reads as a final, high-priority brief once the
  // AI already has the facts and counsel's strategy notes in hand.
  let inheritanceBlock = '';
  if (scope !== 'facts' && activeCase?.inheritance_data) {
    const inh = activeCase.inheritance_data;
    const lines: string[] = [
      '',
      '═══════════════════════════════════════',
      'INHERITED MATTER — FORENSIC AUDIT SUMMARY',
      '═══════════════════════════════════════',
    ];

    if (activeCase.prior_counsel_name) lines.push(`Prior Counsel: ${activeCase.prior_counsel_name}`);
    if (activeCase.handoff_stage)      lines.push(`Stage at Handoff: ${activeCase.handoff_stage}`);
    lines.push(`Audit Date: ${inh._auditDate}`);
    lines.push('');

    if (inh.inheritance_package?.current_posture) {
      lines.push('CURRENT POSTURE:');
      lines.push(inh.inheritance_package.current_posture);
      lines.push('');
    }

    if (inh.risk_register?.length) {
      lines.push('KEY RISKS:');
      inh.risk_register.forEach(r => lines.push(`• [${r.severity}] ${r.risk}`));
      lines.push('');
    }

    if (inh.inheritance_package?.immediate_actions?.length) {
      lines.push('IMMEDIATE ACTIONS:');
      inh.inheritance_package.immediate_actions.forEach(a => lines.push(`• ${a}`));
      lines.push('');
    }

    lines.push('GAP SUMMARY:');
    lines.push(
      `Errors made: ${inh.gap_report?.errors_made?.length ?? 0} | ` +
      `Cannot be recovered: ${inh.gap_report?.too_late?.length ?? 0} | ` +
      `Can be saved: ${inh.gap_report?.can_be_saved?.length ?? 0}`
    );
    lines.push('');

    inheritanceBlock = lines.join('\n');
  }

  // ── Phase 10 — Library Query Log Inheritance ──────────────────────────────
  // Only injected when:
  //   (a) scope === 'full' — drafting engines that reason from verified sources
  //   (b) the case has a locked theory with a library_query_log
  //
  // Procedural engines ('facts') and research engines ('issues') do not receive
  // the log — they do not need to know what statutes the Intelligence Engine
  // consulted; they need only the facts and legal issues respectively.
  let libraryLogBlock = '';
  if (
    scope === 'full' &&
    activeCase?.case_theory_locked &&
    activeCase?.case_theory_structured
  ) {
    libraryLogBlock = buildLibraryLogBlock(
      activeCase.case_theory_structured as CaseTheoryRecord,
      intel,
    );
  }

  return {
    hasIntel,
    intelBlock,
    counselBlock,
    libraryLogBlock,
    fullContext: intelBlock + counselBlock + inheritanceBlock + libraryLogBlock,
    raw: intel,
  };
}
