/**
 * AFS Advocates — Synthesis Engine (Phase D)
 *
 * Reads all previous engine outputs and produces one coherent
 * Master Case Theory. Always the last tab in the tab list for every role.
 *
 * Three auto-detected modes:
 *   Civil    → Civil Master Case Theory
 *   Criminal → Criminal Master Defence Theory
 *   Appeal   → Appeal Master Theory
 *
 * AI is told it is NOT generating new analysis — it is finding the coherent
 * theory that reconciles all inputs. Contradictions are surfaced explicitly.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Case, RiskResult } from '@/types';
import { T, S } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { useCaseContext } from '@/hooks/useCaseContext';
import { Spinner, Md } from '@/components/common/ui';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { copyToClipboard } from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type SynthesisMode = 'civil' | 'criminal' | 'appeal';

interface SynthesisResult {
  mode:        SynthesisMode;
  theory:      string;
  timestamp:   string;
  caseId:      string;
}

interface ReadinessItem {
  id:     string;
  label:  string;
  met:    boolean;
  engine: string;   // tab id to navigate to
}

interface AllInputs {
  riskResult:       RiskResult | null;
  crossExamData:    unknown;
  warRoomData:      unknown;
  argBuilderData:   unknown;
  prevSynthesis:    SynthesisResult | null;
  intPkg:           string;
  appealData:       unknown;
  criminalDefData:  unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

function detectMode(activeCase: Case): SynthesisMode {
  if (activeCase.appeal_data?.package) return 'appeal';
  if (activeCase.matter_track === 'criminal') return 'criminal';
  return 'civil';
}

function modeLabel(mode: SynthesisMode): string {
  if (mode === 'appeal')   return 'Appeal Master Theory';
  if (mode === 'criminal') return 'Criminal Master Defence Theory';
  return 'Civil Master Case Theory';
}

function modeIcon(mode: SynthesisMode): string {
  if (mode === 'appeal')   return '↑';
  if (mode === 'criminal') return '⚖';
  return '◎';
}

// ─────────────────────────────────────────────────────────────────────────────
// READINESS CHECK
// ─────────────────────────────────────────────────────────────────────────────

function checkReadiness(
  mode: SynthesisMode,
  inputs: AllInputs,
): ReadinessItem[] {
  const hasIntPkg      = Boolean(inputs.intPkg && inputs.intPkg.length > 50);
  const hasRisk        = Boolean(inputs.riskResult);
  const hasArgBuilder  = Boolean(inputs.argBuilderData);
  const hasCrimDef     = Boolean(inputs.criminalDefData);
  const hasAppeal      = Boolean(inputs.appealData);

  if (mode === 'civil') {
    return [
      { id: 'intelligence', label: 'Intelligence Package generated',    met: hasIntPkg,     engine: 'intelligence' },
      { id: 'builder',      label: 'At least one Argument Builder draft', met: hasArgBuilder, engine: 'builder'      },
      { id: 'risk',         label: 'Risk Analytics result available',   met: hasRisk,       engine: 'risk'         },
    ];
  }
  if (mode === 'criminal') {
    return [
      { id: 'criminal',  label: 'Criminal Defence analysis run',          met: hasCrimDef,    engine: 'criminal'     },
      { id: 'builder',   label: 'At least one Argument Builder draft',    met: hasArgBuilder, engine: 'builder'      },
      { id: 'risk',      label: 'Risk Analytics result available',        met: hasRisk,       engine: 'risk'         },
    ];
  }
  // appeal
  return [
    { id: 'appeal',   label: 'Appeal Engine package completed',        met: hasAppeal,     engine: 'appeal'   },
    { id: 'builder',  label: 'At least one Argument Builder draft',    met: hasArgBuilder, engine: 'builder'  },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildSynthesisPrompt(
  mode: SynthesisMode,
  activeCase: Case,
  inputs: AllInputs,
): string {
  const caseTitle = activeCase.caseName || 'Untitled Matter';
  const court     = activeCase.court || '';
  const riskVerdict = inputs.riskResult
    ? `${inputs.riskResult.verdict} — ${inputs.riskResult.recommendation}`
    : 'Not available';
  const riskWarn = inputs.riskResult &&
    (inputs.riskResult.verdict === 'SETTLE' || inputs.riskResult.verdict === 'WALK_AWAY')
      ? `⚠ RISK ALERT: Risk Analytics returned "${inputs.riskResult.verdict}". This must be the first thing addressed in The Risk-Adjusted Strategy section — lead with the red flag before any theory.`
      : '';

  const sharedContext = `
CASE: ${caseTitle}
COURT: ${court}
MATTER TRACK: ${activeCase.matter_track ?? 'civil'}
COUNSEL ROLE: ${activeCase.counsel_role ?? 'claimant_side'}

INTELLIGENCE PACKAGE:
${inputs.intPkg || '(not available)'}

RISK ANALYTICS VERDICT: ${riskVerdict}
${riskWarn}

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

  const appealPkg = activeCase.appeal_data?.package || '(not available)';
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

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = {
  fontFamily: "'Times New Roman', Times, serif",
  maxWidth: 900, margin: '0 auto', padding: '0 4px',
};

const sectionCard: React.CSSProperties = {
  background: T.card,
  border: `1px solid ${T.bdr}`,
  borderRadius: 6,
  padding: '20px 24px',
  marginBottom: 16,
};

const sectionNum: React.CSSProperties = {
  display: 'inline-block',
  background: T.goldL,
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.1em',
  padding: '2px 8px',
  borderRadius: 3,
  marginBottom: 8,
};

const metaBadge = (met: boolean): React.CSSProperties => ({
  display: 'inline-block',
  background: met ? '#e8f5ee' : '#fbeaea',
  color:      met ? T.ok      : T.err,
  border:     `1px solid ${met ? '#a8d0b8' : '#e0b8b8'}`,
  borderRadius: 3,
  fontSize: 11,
  padding: '2px 8px',
  fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.05em',
});

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px',
  border: `1px solid ${active ? T.goldL : T.bdr}`,
  background: active ? T.goldL : T.bg,
  color: active ? '#fff' : T.dim,
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "'Times New Roman', Times, serif",
  cursor: 'pointer',
  letterSpacing: '.05em',
});

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function ReadinessChecklist({
  items,
  onNavigate,
}: {
  items:      ReadinessItem[];
  onNavigate: (engine: string) => void;
}) {
  const allMet = items.every(i => i.met);

  return (
    <div style={sectionCard}>
      <div style={{ ...S.h2, marginTop: 0 }}>
        {allMet ? '✓ Ready to generate' : '◎ Readiness Check'}
      </div>
      <p style={{ ...S.hint, marginBottom: 16 }}>
        {allMet
          ? 'All required engine outputs are available. Click Generate below.'
          : 'Complete the following engines before generating the Master Case Theory.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(item => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: item.met ? T.ok : T.err, fontSize: 15 }}>
                {item.met ? '✓' : '○'}
              </span>
              <span style={{ fontSize: 13, color: item.met ? T.text : T.dim }}>
                {item.label}
              </span>
            </div>
            {!item.met && (
              <button
                style={{
                  ...chipStyle(false),
                  padding: '3px 10px', fontSize: 11,
                }}
                onClick={() => onNavigate(item.engine)}
              >
                Go →
              </button>
            )}
            {item.met && <span style={metaBadge(true)}>✓ Ready</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THEORY DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<SynthesisMode, string[]> = {
  civil: [
    'The Decisive Issue',
    'The Winning Theory of Facts',
    'The Killing Ground',
    'The Legal Framework',
    'The Risk-Adjusted Strategy',
    'Immediate Actions',
  ],
  criminal: [
    'The Core Defence',
    "The Prosecution's Weaknesses",
    'Witness Destruction Plan',
    'Constitutional & Procedural Weapons',
    'Risk Assessment',
    'Immediate Actions',
  ],
  appeal: [
    'The Ground That Wins',
    'The Record on Appeal',
    'The Brief Architecture',
    'Procedural Calendar',
    'Risk Assessment',
    'Immediate Actions',
  ],
};

function TheoryDisplay({ result, onCopy }: { result: SynthesisResult; onCopy: () => void }) {
  const labels = SECTION_LABELS[result.mode];
  // Split on numbered headings (1., 2., etc.) or named headings
  // The AI will output the six section headings naturally; we display the full text in Md
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ fontSize: 11, color: T.mute, letterSpacing: '.1em', textTransform: 'uppercase' }}>
            {modeIcon(result.mode)} {modeLabel(result.mode)}
          </span>
          <span style={{ fontSize: 11, color: T.mute, marginLeft: 12 }}>
            Generated {new Date(result.timestamp).toLocaleString()}
          </span>
        </div>
        <button
          style={{ ...chipStyle(false), padding: '5px 16px' }}
          onClick={onCopy}
        >
          Copy
        </button>
      </div>

      {/* Section navigation pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {labels.map((label, i) => (
          <span key={i} style={{
            ...metaBadge(true),
            background: '#f7f7f5',
            color: T.dim,
            border: `1px solid ${T.bdr}`,
            fontSize: 10,
            padding: '3px 10px',
          }}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      <div style={sectionCard}>
        <Md text={result.theory} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase:   Case;
  onNavigate?:  (tabId: string) => void;
}

export function SynthesisEngine({ activeCase, onNavigate }: Props) {
  const caseId = activeCase.id;
  const ai     = useAI(activeCase);
  const mode   = detectMode(activeCase);
  const { fullContext } = useCaseContext(activeCase, { query: activeCase?.caseName ?? '', engine: 'SynthesisEngine' });

  const [inputs,    setInputs]    = useState<AllInputs | null>(null);
  const [result,    setResult]    = useState<SynthesisResult | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [copied,    setCopied]    = useState(false);
  const [generating, setGenerating] = useState(false);

  // ── Load all engine data in parallel ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      loadBlindSpot<RiskResult | null>(caseId, 'risk_result', null),
      loadBlindSpot<unknown>(caseId, 'crossexam', null),
      loadBlindSpot<unknown>(caseId, 'warroom', null),
      loadBlindSpot<unknown>(caseId, 'arg_versions', null),
      loadBlindSpot<SynthesisResult | null>(caseId, 'synthesis', null),
      loadBlindSpot<unknown>(caseId, 'criminal_defence', null),
    ]).then(([riskResult, crossExamData, warRoomData, argBuilderData, prevSynthesis, criminalDefData]) => {
      if (cancelled) return;
      setInputs({
        riskResult:      riskResult as RiskResult | null,
        crossExamData,
        warRoomData,
        argBuilderData,
        prevSynthesis:   prevSynthesis as SynthesisResult | null,
        intPkg:          activeCase.intelligence_data?.intPkg ?? '',
        appealData:      activeCase.appeal_data ?? null,
        criminalDefData,
      });
      setResult(prevSynthesis as SynthesisResult | null);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [caseId, activeCase]);

  // ── Generate ─────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!inputs) return;
    setGenerating(true);

    const prompt = buildSynthesisPrompt(mode, activeCase, inputs);
    const raw = await ai.ask({
      system:  'You are a senior Nigerian advocate. Respond in plain structured text suitable for law chambers. No markdown fences. Use numbered sections exactly as instructed.' + fullContext,
      userMsg: prompt,
      maxTokens: 3000,
    });

    if (raw) {
      const newResult: SynthesisResult = {
        mode,
        theory:    raw,
        timestamp: new Date().toISOString(),
        caseId,
      };
      await saveBlindSpot(caseId, 'synthesis', newResult);
      setResult(newResult);
    }
    setGenerating(false);
  }, [inputs, mode, activeCase, ai, caseId]);

  // ── Copy ─────────────────────────────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const ok = await copyToClipboard(
      `${modeLabel(result.mode)}\n${activeCase.caseName || ''}\nGenerated: ${new Date(result.timestamp).toLocaleString()}\n\n${result.theory}`,
    );
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }, [result, activeCase]);

  // ── Readiness ────────────────────────────────────────────────────────────

  const readinessItems = inputs ? checkReadiness(mode, inputs) : [];
  const allReady       = readinessItems.every(i => i.met);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <Spinner size={24} />
        <p style={{ ...S.hint, marginTop: 12 }}>Loading engine outputs…</p>
      </div>
    );
  }

  return (
    <div style={wrap}>

      {/* ── Header ── */}
      <div style={{
        borderBottom: `1px solid ${T.bdr}`,
        paddingBottom: 14, marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 22, color: T.goldL }}>◎</span>
          <h1 style={{ ...S.h1, border: 'none', padding: 0, margin: 0, fontSize: 20 }}>
            Case Theory
          </h1>
          <span style={{
            fontSize: 10, color: T.mute, letterSpacing: '.12em',
            textTransform: 'uppercase', marginLeft: 4,
          }}>
            {modeLabel(mode)}
          </span>
        </div>
        <p style={{ ...S.hint, marginTop: 8, marginBottom: 0 }}>
          Reads all engine outputs and finds the single coherent theory that reconciles them.
          Contradictions are surfaced explicitly — never resolved silently.
        </p>
      </div>

      {/* ── Mode badge ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['civil', 'criminal', 'appeal'] as SynthesisMode[]).map(m => (
          <span key={m} style={{
            ...chipStyle(m === mode),
            cursor: 'default',
          }}>
            {modeIcon(m)} {modeLabel(m)}
          </span>
        ))}
      </div>

      {/* ── Readiness checklist ── */}
      {inputs && (
        <ReadinessChecklist
          items={readinessItems}
          onNavigate={(engine) => onNavigate?.(engine)}
        />
      )}

      {/* ── Error ── */}
      {ai.error && (
        <div style={{
          background: '#fbeaea', border: `1px solid #e0b8b8`,
          borderRadius: 5, padding: '12px 16px', marginBottom: 16,
          color: T.err, fontSize: 13,
        }}>
          {ai.error}
        </div>
      )}

      {/* ── Generate button ── */}
      <div style={{ marginBottom: 24 }}>
        <button
          style={allReady && !generating ? S.btn : S.btnOff}
          disabled={!allReady || generating}
          onClick={handleGenerate}
        >
          {generating
            ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Spinner size={13} color="#fff" /> Synthesising…
              </span>
            : result
              ? '↻ Regenerate Master Theory'
              : '◎ Generate Master Case Theory'
          }
        </button>
        {!allReady && (
          <p style={{ ...S.hint, marginTop: 6, color: T.warn, marginBottom: 0 }}>
            Complete all required engines above before generating.
          </p>
        )}
      </div>

      {/* ── Result display ── */}
      {result && (
        <TheoryDisplay
          result={result}
          onCopy={() => { void handleCopy(); }}
        />
      )}

      {copied && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: T.goldL, color: '#fff',
          padding: '10px 20px', borderRadius: 5,
          fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
          boxShadow: '0 2px 8px rgba(0,0,0,.2)',
          zIndex: 9999,
        }}>
          Copied to clipboard
        </div>
      )}

      {/* ── Inputs summary ── */}
      {inputs && (
        <div style={{ marginTop: 32 }}>
          <div style={{ ...S.h3, marginBottom: 12 }}>Engine Sources Read</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 8,
          }}>
            {[
              { label: 'Intelligence Package', available: Boolean(inputs.intPkg) },
              { label: 'Risk Analytics',        available: Boolean(inputs.riskResult) },
              { label: 'Cross-Examination',     available: Boolean(inputs.crossExamData) },
              { label: 'War Room',              available: Boolean(inputs.warRoomData) },
              { label: 'Argument Builder',      available: Boolean(inputs.argBuilderData) },
              { label: 'Criminal Defence',      available: Boolean(inputs.criminalDefData) },
              { label: 'Appeal Package',        available: Boolean(inputs.appealData) },
            ].map(src => (
              <div key={src.label} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: src.available ? T.text : T.mute,
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                <span style={{ color: src.available ? T.ok : T.bdr }}>
                  {src.available ? '●' : '○'}
                </span>
                {src.label}
              </div>
            ))}
          </div>
          <p style={{ ...S.hint, marginTop: 14, color: T.mute, fontSize: 11 }}>
            ○ = engine not yet run or data not available. Run the engine and regenerate to include it.
          </p>
        </div>
      )}

    </div>
  );
}
