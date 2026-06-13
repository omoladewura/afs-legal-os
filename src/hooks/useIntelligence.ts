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
 *   - fullContext : intelBlock + counselBlock combined — pass to AI calls
 */

import type { Case } from '@/types';

interface IntelligenceData {
  rawFacts?:         string;
  intPkg?:           string;
  established_facts?: string[];
  disputed_areas?:   string[];
  legal_issues?:     string[];
  gaps_identified?:  string[];
  initial_risks?:    Array<{ risk: string; severity: string }>;
  timeline?:         Array<{ date: string; event: string; significance?: string }>;
}

export interface IntelOutput {
  /** Whether any vetted intelligence exists for this case */
  hasIntel: boolean;

  /** Structured intelligence block — inject into AI system prompts */
  intelBlock: string;

  /** Counsel instructions block — inject after intelBlock */
  counselBlock: string;

  /** Full context = intelBlock + counselBlock — use this in AI calls */
  fullContext: string;

  /** Raw intelligence data fields for components that need direct access */
  raw: IntelligenceData;
}

/**
 * Extracts and formats all intelligence from activeCase.intelligence_data
 * plus counsel instructions from activeCase.counsel_instructions.
 *
 * Usage:
 *   const { fullContext, hasIntel } = useIntelligence(activeCase);
 *   await ask({ system: buildRoleSystemPrompt(...) + fullContext, userMsg: '...' });
 */
export function useIntelligence(activeCase: Case | null): IntelOutput {
  const intel = (activeCase?.intelligence_data || {}) as IntelligenceData;
  const instructions = (activeCase as any)?.counsel_instructions as string | undefined;

  const hasIntel = !!(
    intel.intPkg ||
    intel.rawFacts ||
    (intel.established_facts?.length ?? 0) > 0
  );

  // ── Intelligence Block ────────────────────────────────────────────────────
  const parts: string[] = [];

  if (hasIntel) {
    parts.push('═══════════════════════════════════════');
    parts.push('VETTED CASE INTELLIGENCE (Intelligence Engine Output)');
    parts.push('═══════════════════════════════════════');
    parts.push('Use ONLY these verified facts. Do not contradict them.');
    parts.push('Where silent, supplement from general legal knowledge but clearly distinguish.');
    parts.push('');
  }

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

  if (intel.rawFacts && !intel.intPkg) {
    // Only show rawFacts if no processed package yet
    parts.push('── RAW FACTS (unprocessed — treat as client narration) ──');
    parts.push(intel.rawFacts);
    parts.push('');
  }

  const intelBlock = parts.join('\n');

  // ── Counsel Instructions Block ────────────────────────────────────────────
  let counselBlock = '';
  if (instructions?.trim()) {
    counselBlock = [
      '',
      '═══════════════════════════════════════',
      'COUNSEL INSTRUCTIONS & STRATEGY NOTES',
      '═══════════════════════════════════════',
      instructions.trim(),
      '',
    ].join('\n');
  }

  return {
    hasIntel,
    intelBlock,
    counselBlock,
    fullContext: intelBlock + counselBlock,
    raw: intel,
  };
}
