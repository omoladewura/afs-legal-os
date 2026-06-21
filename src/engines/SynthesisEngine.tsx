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
import type { Case } from '@/types';
import { T, S } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { Spinner, Md } from '@/components/common/ui';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { copyToClipboard } from '@/utils';
import {
  detectMode,
  modeLabel,
  modeIcon,
  checkReadiness,
  buildSynthesisPrompt,
} from './SynthesisEngine.logic';
import type { SynthesisMode, SynthesisRisk, AllInputs, ReadinessItem } from './SynthesisEngine.logic';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL TYPES  (engine-only — not needed in tests)
// ─────────────────────────────────────────────────────────────────────────────

interface SynthesisResult {
  mode:        SynthesisMode;
  theory:      string;
  timestamp:   string;
  caseId:      string;
}

// SynthesisMode, SynthesisRisk, AllInputs, ReadinessItem — see SynthesisEngine.logic.ts

// ─────────────────────────────────────────────────────────────────────────────
// detectMode / modeLabel / modeIcon / checkReadiness / buildSynthesisPrompt
// imported from SynthesisEngine.logic.ts
// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Intelligence hook — canonical source for intPkg + fullContext ─────────
  const { fullContext, raw: intelRaw } = useIntelligence(activeCase);

  const [inputs,     setInputs]     = useState<AllInputs | null>(null);
  const [result,     setResult]     = useState<SynthesisResult | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [copied,     setCopied]     = useState(false);
  const [generating, setGenerating] = useState(false);

  // ── Load all engine data in parallel ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      loadBlindSpot<unknown>(caseId, 'crossexam', null),
      loadBlindSpot<unknown>(caseId, 'warroom', null),
      loadBlindSpot<unknown>(caseId, 'arg_versions', null),
      loadBlindSpot<SynthesisResult | null>(caseId, 'synthesis', null),
      loadBlindSpot<unknown>(caseId, 'criminal_defence', null),
    ]).then(([crossExamData, warRoomData, argBuilderData, prevSynthesis, criminalDefData]) => {
      if (cancelled) return;

      // ── Risk: prefer intelligence_data.risk_verdict (Phase 3+); fall back
      //    to the legacy loadBlindSpot('risk_result') shape via a minimal bridge.
      //    Both expose .verdict and .recommendation so the prompt works either way.
      const iv = activeCase.intelligence_data?.risk_verdict ?? null;
      const riskResult: AllInputs['riskResult'] = iv
        ? {
            verdict:              iv.verdict,
            recommendation:       iv.recommendation,
            scores:               iv.scores as Record<string, number>,
            reasoning:            iv.reasoning as Record<string, string>,
            appellate_narrative:  iv.appellate_narrative,
            batna_notes:          iv.batna_notes,
          }
        : null;

      // ── Authority grounding (Phase 5A) — lives in intelligence_data ──────
      const ag = activeCase.intelligence_data?.authority_grounding ?? null;
      const authorityGrounding: AllInputs['authorityGrounding'] = ag ?? null;

      setInputs({
        riskResult,
        crossExamData,
        warRoomData,
        argBuilderData,
        prevSynthesis:    prevSynthesis as SynthesisResult | null,
        intPkg:           intelRaw.intPkg ?? '',
        appealData:       activeCase.appeal_data ?? null,
        criminalDefData,
        authorityGrounding,
      });
      setResult(prevSynthesis as SynthesisResult | null);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [caseId, activeCase, intelRaw]);

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
              { label: 'Risk Verdict',          available: Boolean(inputs.riskResult) },
              { label: 'Authority Grounding',   available: Boolean(inputs.authorityGrounding) },
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
