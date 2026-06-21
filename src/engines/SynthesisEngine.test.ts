/**
 * SynthesisEngine — unit tests (vitest)
 *
 * Tests the three pure functions extracted to SynthesisEngine.logic.ts:
 *
 *   detectMode        — auto-detect civil / criminal / appeal from Case state
 *   checkReadiness    — per-mode required engine gates
 *   buildSynthesisPrompt — per-mode AI prompt content & structure
 *
 * Run:
 *   npx vitest run src/engines/SynthesisEngine.test.ts
 *
 * Install (first time only):
 *   npm install -D vitest @vitest/ui
 *   # add "test": "vitest" to package.json scripts
 */

import { describe, it, expect } from 'vitest';
import {
  detectMode,
  checkReadiness,
  buildSynthesisPrompt,
} from './SynthesisEngine.logic';
import type { AllInputs, SynthesisRisk } from './SynthesisEngine.logic';
import type { Case } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal Case shape — only the fields detectMode / prompt builder touch */
function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id:                 'case-001',
    caseName:           'Test v Test',
    court:              'Federal High Court, Lagos',
    suitNo:             'FHC/L/001/2025',
    dateCommenced:      '2025-01-01',
    role:               'Claimant',
    claimants:          [],
    defendants:         [],
    createdAt:          '2025-01-01T00:00:00Z',
    compressed_summary: '',
    recent_entries:     [],
    ...overrides,
  } as Case;
}

const MOCK_RISK: SynthesisRisk = {
  verdict:        'FILE',
  recommendation: 'Proceed to trial — strong evidential position.',
  scores:         { procedural: 80, evidential: 75 },
  reasoning:      { procedural: 'Clean process.', evidential: 'Documents intact.' },
};

const MOCK_AUTHORITY = {
  hierarchy_map:  'Supreme Court → Court of Appeal → Federal High Court',
  conflict_flags: 'No overruled authorities detected.',
  status:         'GROUNDED' as const,
  summary:        'All cited authorities are binding and current.',
};

function makeInputs(overrides: Partial<AllInputs> = {}): AllInputs {
  return {
    riskResult:         MOCK_RISK,
    crossExamData:      null,
    warRoomData:        null,
    argBuilderData:     [{ title: 'Breach of Contract', draft: 'Lorem ipsum.' }],
    prevSynthesis:      null,
    intPkg:             'A'.repeat(200),   // > 50 chars threshold
    appealData:         null,
    criminalDefData:    null,
    authorityGrounding: MOCK_AUTHORITY,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// detectMode
// ─────────────────────────────────────────────────────────────────────────────

describe('detectMode', () => {
  it('returns "civil" for a plain civil matter', () => {
    const c = makeCase({ matter_track: 'civil' });
    expect(detectMode(c)).toBe('civil');
  });

  it('returns "civil" when matter_track is undefined (legacy case)', () => {
    const c = makeCase();   // no matter_track
    expect(detectMode(c)).toBe('civil');
  });

  it('returns "civil" for matrimonial track (dedicated engine handles it; civil is safe fallback)', () => {
    const c = makeCase({ matter_track: 'matrimonial' });
    expect(detectMode(c)).toBe('civil');
  });

  it('returns "criminal" when matter_track is criminal and no appeal package', () => {
    const c = makeCase({ matter_track: 'criminal' });
    expect(detectMode(c)).toBe('criminal');
  });

  it('returns "appeal" when appeal_data.package is present — beats matter_track', () => {
    const c = makeCase({
      matter_track: 'civil',
      appeal_data:  {
        court:            'Court of Appeal',
        role:             'appellant',
        judgmentText:     'Judgment text here.',
        lowerRecord:      '',
        extractedGrounds: 'Ground 1: misdirection on facts.',
        crossLevelIssues: '',
        package:          'Compiled appeal package.',
      },
    });
    expect(detectMode(c)).toBe('appeal');
  });

  it('returns "appeal" even when matter_track is criminal if appeal package exists', () => {
    const c = makeCase({
      matter_track: 'criminal',
      appeal_data:  {
        court:            'Court of Appeal',
        role:             'appellant',
        judgmentText:     '',
        lowerRecord:      '',
        extractedGrounds: '',
        crossLevelIssues: '',
        package:          'Criminal appeal package.',
      },
    });
    expect(detectMode(c)).toBe('appeal');
  });

  it('returns "civil" when appeal_data exists but package is empty string', () => {
    // Empty package = appeal engine not yet run; don't lock the mode
    const c = makeCase({
      matter_track: 'civil',
      appeal_data:  {
        court:            '',
        role:             'appellant',
        judgmentText:     '',
        lowerRecord:      '',
        extractedGrounds: '',
        crossLevelIssues: '',
        package:          '',       // falsy — no package yet
      },
    });
    expect(detectMode(c)).toBe('civil');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkReadiness — item structure
// ─────────────────────────────────────────────────────────────────────────────

describe('checkReadiness — civil', () => {
  it('returns 4 items for civil mode', () => {
    expect(checkReadiness('civil', makeInputs())).toHaveLength(4);
  });

  it('requires intelligence, builder, risk, authority', () => {
    const ids = checkReadiness('civil', makeInputs()).map(i => i.id);
    expect(ids).toEqual(['intelligence', 'builder', 'risk', 'authority']);
  });

  it('all met when all inputs provided', () => {
    const items = checkReadiness('civil', makeInputs());
    expect(items.every(i => i.met)).toBe(true);
  });

  it('intelligence gate fails when intPkg is empty', () => {
    const items = checkReadiness('civil', makeInputs({ intPkg: '' }));
    expect(items.find(i => i.id === 'intelligence')!.met).toBe(false);
  });

  it('intelligence gate fails when intPkg is ≤ 50 chars', () => {
    const items = checkReadiness('civil', makeInputs({ intPkg: 'Short.' }));
    expect(items.find(i => i.id === 'intelligence')!.met).toBe(false);
  });

  it('risk gate fails when riskResult is null', () => {
    const items = checkReadiness('civil', makeInputs({ riskResult: null }));
    expect(items.find(i => i.id === 'risk')!.met).toBe(false);
  });

  it('authority gate fails when authorityGrounding is null', () => {
    const items = checkReadiness('civil', makeInputs({ authorityGrounding: null }));
    expect(items.find(i => i.id === 'authority')!.met).toBe(false);
  });

  it('builder gate fails when argBuilderData is null', () => {
    const items = checkReadiness('civil', makeInputs({ argBuilderData: null }));
    expect(items.find(i => i.id === 'builder')!.met).toBe(false);
  });

  it('authority gate navigates to intelligence tab', () => {
    const item = checkReadiness('civil', makeInputs()).find(i => i.id === 'authority')!;
    expect(item.engine).toBe('intelligence');
  });
});

describe('checkReadiness — criminal', () => {
  it('returns 4 items for criminal mode', () => {
    expect(checkReadiness('criminal', makeInputs())).toHaveLength(4);
  });

  it('requires criminal, builder, risk, authority', () => {
    const ids = checkReadiness('criminal', makeInputs()).map(i => i.id);
    expect(ids).toEqual(['criminal', 'builder', 'risk', 'authority']);
  });

  it('does NOT require the intelligence package gate (civil-only)', () => {
    const ids = checkReadiness('criminal', makeInputs()).map(i => i.id);
    expect(ids).not.toContain('intelligence');
  });

  it('criminal gate fails when criminalDefData is null', () => {
    const items = checkReadiness('criminal', makeInputs({ criminalDefData: null }));
    expect(items.find(i => i.id === 'criminal')!.met).toBe(false);
  });

  it('criminal gate passes when criminalDefData is present', () => {
    const items = checkReadiness('criminal', makeInputs({ criminalDefData: { charges: ['Section 419'] } }));
    expect(items.find(i => i.id === 'criminal')!.met).toBe(true);
  });

  it('criminal gate navigates to criminal tab', () => {
    const item = checkReadiness('criminal', makeInputs()).find(i => i.id === 'criminal')!;
    expect(item.engine).toBe('criminal');
  });
});

describe('checkReadiness — appeal', () => {
  it('returns 3 items for appeal mode (no risk gate)', () => {
    expect(checkReadiness('appeal', makeInputs())).toHaveLength(3);
  });

  it('requires appeal, builder, authority', () => {
    const ids = checkReadiness('appeal', makeInputs()).map(i => i.id);
    expect(ids).toEqual(['appeal', 'builder', 'authority']);
  });

  it('does NOT require risk or criminal gates', () => {
    const ids = checkReadiness('appeal', makeInputs()).map(i => i.id);
    expect(ids).not.toContain('risk');
    expect(ids).not.toContain('criminal');
    expect(ids).not.toContain('intelligence');
  });

  it('appeal gate fails when appealData is null', () => {
    const items = checkReadiness('appeal', makeInputs({ appealData: null }));
    expect(items.find(i => i.id === 'appeal')!.met).toBe(false);
  });

  it('appeal gate passes when appealData is present', () => {
    const items = checkReadiness('appeal', makeInputs({ appealData: { package: 'pkg' } }));
    expect(items.find(i => i.id === 'appeal')!.met).toBe(true);
  });

  it('appeal gate navigates to appeal tab', () => {
    const item = checkReadiness('appeal', makeInputs()).find(i => i.id === 'appeal')!;
    expect(item.engine).toBe('appeal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSynthesisPrompt — civil
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSynthesisPrompt — civil', () => {
  const c = makeCase({ matter_track: 'civil' });

  it('produces the six civil section headings', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs());
    expect(prompt).toContain('THE DECISIVE ISSUE');
    expect(prompt).toContain('THE WINNING THEORY OF FACTS');
    expect(prompt).toContain('THE KILLING GROUND');
    expect(prompt).toContain('THE LEGAL FRAMEWORK');
    expect(prompt).toContain('THE RISK-ADJUSTED STRATEGY');
    expect(prompt).toContain('IMMEDIATE ACTIONS');
  });

  it('does NOT contain criminal or appeal section headings', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs());
    expect(prompt).not.toContain('THE CORE DEFENCE');
    expect(prompt).not.toContain('THE GROUND THAT WINS');
    expect(prompt).not.toContain('CONSTITUTIONAL AND PROCEDURAL WEAPONS');
  });

  it('injects the case name', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs());
    expect(prompt).toContain('Test v Test');
  });

  it('injects the intelligence package', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ intPkg: 'CRITICAL FACTS HERE' }));
    expect(prompt).toContain('CRITICAL FACTS HERE');
  });

  it('injects the risk verdict', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs());
    expect(prompt).toContain('FILE');
    expect(prompt).toContain('Proceed to trial');
  });

  it('injects authority grounding when present', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs());
    expect(prompt).toContain('AUTHORITY GROUNDING');
    expect(prompt).toContain('Supreme Court → Court of Appeal');
    expect(prompt).toContain('No overruled authorities detected.');
  });

  it('shows authority placeholder when authorityGrounding is null', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ authorityGrounding: null }));
    expect(prompt).toContain('not yet run');
  });

  it('emits RISK ALERT for SETTLE verdict', () => {
    const settleRisk: SynthesisRisk = { ...MOCK_RISK, verdict: 'SETTLE' };
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ riskResult: settleRisk }));
    expect(prompt).toContain('⚠ RISK ALERT');
    expect(prompt).toContain('SETTLE');
  });

  it('emits RISK ALERT for WALK_AWAY verdict', () => {
    const walkRisk: SynthesisRisk = { ...MOCK_RISK, verdict: 'WALK_AWAY' };
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ riskResult: walkRisk }));
    expect(prompt).toContain('⚠ RISK ALERT');
    expect(prompt).toContain('WALK_AWAY');
  });

  it('does NOT emit RISK ALERT for FILE or NEGOTIATE verdicts', () => {
    for (const verdict of ['FILE', 'NEGOTIATE']) {
      const r: SynthesisRisk = { ...MOCK_RISK, verdict };
      const prompt = buildSynthesisPrompt('civil', c, makeInputs({ riskResult: r }));
      expect(prompt).not.toContain('⚠ RISK ALERT');
    }
  });

  it('injects appellate narrative when present', () => {
    const r: SynthesisRisk = { ...MOCK_RISK, appellate_narrative: 'Ground 1 is weak on preservation.' };
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ riskResult: r }));
    expect(prompt).toContain('APPELLATE VULNERABILITY NARRATIVE');
    expect(prompt).toContain('Ground 1 is weak on preservation.');
  });

  it('injects BATNA notes when present', () => {
    const r: SynthesisRisk = { ...MOCK_RISK, batna_notes: 'Best alternative: mediation by Q3.' };
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ riskResult: r }));
    expect(prompt).toContain('BATNA / SETTLEMENT NOTES');
    expect(prompt).toContain('Best alternative: mediation by Q3.');
  });

  it('shows "(not available)" for risk verdict when riskResult is null', () => {
    const prompt = buildSynthesisPrompt('civil', c, makeInputs({ riskResult: null }));
    expect(prompt).toContain('RISK VERDICT: Not available');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSynthesisPrompt — criminal
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSynthesisPrompt — criminal', () => {
  const c = makeCase({ matter_track: 'criminal' });

  it('produces the six criminal section headings', () => {
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs());
    expect(prompt).toContain('THE CORE DEFENCE');
    expect(prompt).toContain("THE PROSECUTION'S WEAKNESSES");
    expect(prompt).toContain('WITNESS DESTRUCTION PLAN');
    expect(prompt).toContain('CONSTITUTIONAL AND PROCEDURAL WEAPONS');
    expect(prompt).toContain('RISK ASSESSMENT');
    expect(prompt).toContain('IMMEDIATE ACTIONS');
  });

  it('does NOT contain civil or appeal section headings', () => {
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs());
    expect(prompt).not.toContain('THE DECISIVE ISSUE');
    expect(prompt).not.toContain('THE KILLING GROUND');
    expect(prompt).not.toContain('THE GROUND THAT WINS');
    expect(prompt).not.toContain('THE BRIEF ARCHITECTURE');
  });

  it('addresses a Nigerian criminal defence advocate', () => {
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs());
    expect(prompt).toContain('criminal defence advocate');
  });

  it('injects CRIMINAL DEFENCE ANALYSIS block', () => {
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs({
      criminalDefData: { charges: ['Robbery — s.1 Robbery & Firearms Act'] },
    }));
    expect(prompt).toContain('CRIMINAL DEFENCE ANALYSIS');
    expect(prompt).toContain('Robbery');
  });

  it('shows "(not available)" in criminal defence block when criminalDefData is null', () => {
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs({ criminalDefData: null }));
    expect(prompt).toContain('CRIMINAL DEFENCE ANALYSIS');
    expect(prompt).toContain('(not available)');
  });

  it('still injects authority grounding for criminal mode', () => {
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs());
    expect(prompt).toContain('AUTHORITY GROUNDING');
    expect(prompt).toContain('Supreme Court → Court of Appeal');
  });

  it('truncates criminalDefData at 3000 chars', () => {
    const bigData = { text: 'X'.repeat(5000) };
    const prompt = buildSynthesisPrompt('criminal', c, makeInputs({ criminalDefData: bigData }));
    // The JSON.stringify + slice(0, 3000) means prompt won't contain 5000 Xs
    const match = prompt.match(/CRIMINAL DEFENCE ANALYSIS:\n([\s\S]*?)\n\nProduce/);
    expect(match![1].length).toBeLessThanOrEqual(3100);   // 3000 + some JSON overhead
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSynthesisPrompt — appeal
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSynthesisPrompt — appeal', () => {
  const c = makeCase({
    matter_track: 'civil',
    appeal_data:  {
      court:            'Court of Appeal, Lagos',
      role:             'appellant',
      judgmentText:     'Lower court dismissed the claim.',
      lowerRecord:      'Record compiled.',
      extractedGrounds: 'Ground 1: Error in law. Ground 2: Wrong exercise of discretion.',
      crossLevelIssues: '',
      package:          'Full appellate package text here.',
    },
  });

  it('produces the six appeal section headings', () => {
    const prompt = buildSynthesisPrompt('appeal', c, makeInputs());
    expect(prompt).toContain('THE GROUND THAT WINS');
    expect(prompt).toContain('THE RECORD ON APPEAL');
    expect(prompt).toContain('THE BRIEF ARCHITECTURE');
    expect(prompt).toContain('PROCEDURAL CALENDAR');
    expect(prompt).toContain('RISK ASSESSMENT');
    expect(prompt).toContain('IMMEDIATE ACTIONS');
  });

  it('does NOT contain civil or criminal section headings', () => {
    const prompt = buildSynthesisPrompt('appeal', c, makeInputs());
    expect(prompt).not.toContain('THE DECISIVE ISSUE');
    expect(prompt).not.toContain('THE KILLING GROUND');
    expect(prompt).not.toContain('THE CORE DEFENCE');
    expect(prompt).not.toContain('WITNESS DESTRUCTION PLAN');
  });

  it('addresses a Nigerian appellate advocate', () => {
    const prompt = buildSynthesisPrompt('appeal', c, makeInputs());
    expect(prompt).toContain('appellate advocate');
  });

  it('injects APPEAL PACKAGE from activeCase.appeal_data.package', () => {
    const prompt = buildSynthesisPrompt('appeal', c, makeInputs());
    expect(prompt).toContain('APPEAL PACKAGE');
    expect(prompt).toContain('Full appellate package text here.');
  });

  it('injects EXTRACTED GROUNDS', () => {
    const prompt = buildSynthesisPrompt('appeal', c, makeInputs());
    expect(prompt).toContain('EXTRACTED GROUNDS');
    expect(prompt).toContain('Ground 1: Error in law.');
  });

  it('shows "(not available)" for appeal package when appeal_data is absent', () => {
    const cNoAppeal = makeCase({ matter_track: 'civil' });
    const prompt = buildSynthesisPrompt('appeal', cNoAppeal, makeInputs());
    expect(prompt).toContain('APPEAL PACKAGE');
    expect(prompt).toContain('(not available)');
  });

  it('truncates appeal package at 3000 chars', () => {
    const cBig = makeCase({
      appeal_data: {
        court: '', role: 'appellant', judgmentText: '',
        lowerRecord: '', extractedGrounds: '', crossLevelIssues: '',
        package: 'P'.repeat(5000),
      },
    });
    const prompt = buildSynthesisPrompt('appeal', cBig, makeInputs());
    // prompt should contain at most 3000 Ps
    const pCount = (prompt.match(/P/g) || []).length;
    expect(pCount).toBeLessThanOrEqual(3000);
  });

  it('still injects authority grounding for appeal mode', () => {
    const prompt = buildSynthesisPrompt('appeal', c, makeInputs());
    expect(prompt).toContain('AUTHORITY GROUNDING');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sharedContext — present in all three modes
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSynthesisPrompt — sharedContext fields in all modes', () => {
  const inputs = makeInputs();

  for (const mode of ['civil', 'criminal', 'appeal'] as const) {
    const c = makeCase({
      matter_track: mode === 'appeal' ? 'civil' : mode,
      ...(mode === 'appeal' ? { appeal_data: { court: '', role: 'appellant', judgmentText: '', lowerRecord: '', extractedGrounds: '', crossLevelIssues: '', package: 'pkg' } } : {}),
    });

    it(`[${mode}] injects INTELLIGENCE PACKAGE`, () => {
      const prompt = buildSynthesisPrompt(mode, c, inputs);
      expect(prompt).toContain('INTELLIGENCE PACKAGE');
    });

    it(`[${mode}] injects RISK VERDICT`, () => {
      const prompt = buildSynthesisPrompt(mode, c, inputs);
      expect(prompt).toContain('RISK VERDICT:');
    });

    it(`[${mode}] injects AUTHORITY GROUNDING`, () => {
      const prompt = buildSynthesisPrompt(mode, c, inputs);
      expect(prompt).toContain('AUTHORITY GROUNDING');
    });

    it(`[${mode}] contains the CRITICAL INSTRUCTION`, () => {
      const prompt = buildSynthesisPrompt(mode, c, inputs);
      expect(prompt).toContain('CRITICAL INSTRUCTION');
      expect(prompt).toContain('Do NOT resolve contradictions silently');
    });

    it(`[${mode}] contains the court and case name`, () => {
      const prompt = buildSynthesisPrompt(mode, c, inputs);
      expect(prompt).toContain('Test v Test');
      expect(prompt).toContain('Federal High Court, Lagos');
    });
  }
});
