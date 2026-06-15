/**
 * AFS Advocates — Matrimonial Risk Engine (MRisk)
 * Phase 6
 *
 * 8 matrimonial-specific risk dimensions:
 *
 *   1. Ground strength — evidence per s.15(2) fact, corroboration, witness availability
 *   2. Condonation & connivance exposure — knowledge, forgiveness, reinstatement, subsequent intercourse
 *   3. s.30 two-year bar — within 2 years, exception applies, leave obtained
 *   4. Nullity bar check — ss.35–37 MCA, condonation, petitioner's own disability
 *   5. Financial disclosure risk — asset concealment, adequacy of pendente lite
 *   6. Welfare-of-child risk — custody outcome probability, welfare officer involvement
 *   7. Decree nisi → absolute timeline — s.57 vs s.58 path, pending appeals
 *   8. Appeal survivability — grounds against nisi, s.241(2) CFRN hard bar on absolute appeals
 *
 * Output: scored dimension matrix + overall risk rating + strategic verdict + narrative.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type Verdict = 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'RESOLVE_BARS_FIRST' | 'RECONSIDER';

interface DimensionScore {
  score:       number;   // 0–100; higher = stronger position (post-normalisation)
  raw_risk:    'HIGH' | 'MEDIUM' | 'LOW' | 'N/A';
  reasoning:   string;
  flags:       string[];
}

interface RiskResult {
  ground_strength:         DimensionScore;
  condonation_connivance:  DimensionScore;
  two_year_bar:            DimensionScore;
  nullity_bar:             DimensionScore;
  financial_disclosure:    DimensionScore;
  welfare_of_child:        DimensionScore;
  decree_timeline:         DimensionScore;
  appeal_survivability:    DimensionScore;
  overall:                 number;
  verdict:                 Verdict;
  recommendation:          string;
  timestamp:               number;
  stage:                   string;
}

interface SavedData {
  last: RiskResult | null;
  history: RiskResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";
const MODULE = 'matrimonial_risk';
const DEFAULT_DATA: SavedData = { last: null, history: [] };

const MATRIMONIAL_STAGES = [
  'Pre-Filing',
  'Petition Filed — Service Pending',
  'Awaiting Answer / No Appearance',
  'Answer Filed — Defended',
  'Reply / Rejoinder',
  'Compulsory Conference (O.11 MCR)',
  'Set Down for Hearing',
  'Hearing',
  'Decree Nisi Granted',
  'Nisi to Absolute Period',
  'Decree Absolute Granted',
  'Appeal Pending',
  'Post-Decree Enforcement',
];

const DIMENSIONS: Array<{
  id:        keyof Omit<RiskResult, 'overall' | 'verdict' | 'recommendation' | 'timestamp' | 'stage'>;
  label:     string;
  icon:      string;
  authority: string;
  tooltip:   string;
}> = [
  {
    id:        'ground_strength',
    label:     'Ground Strength',
    icon:      '⚔',
    authority: 's.15(2) MCA',
    tooltip:   'Strength of evidence for each pleaded s.15(2) fact. Corroboration, witness availability, documentary support.',
  },
  {
    id:        'condonation_connivance',
    label:     'Condonation / Connivance Exposure',
    icon:      '👁',
    authority: 'ss.26–27 MCA',
    tooltip:   'Whether the petitioner has condoned (forgiven + resumed cohabitation) the adultery or behaviour fact. Connivance: petitioner actively facilitated the adultery. Either bars the fact.',
  },
  {
    id:        'two_year_bar',
    label:     's.30 Two-Year Bar',
    icon:      '📅',
    authority: 's.30 MCA · O.4 MCR',
    tooltip:   'Marriage under 2 years: bar applies unless wilful refusal s.15(2)(a), adultery s.15(2)(b), or rape/sodomy/bestiality s.16(1)(a). Leave required where no exception — motion ex-parte O.4 rr.1–2 MCR.',
  },
  {
    id:        'nullity_bar',
    label:     'Nullity Bar Check',
    icon:      '⛔',
    authority: 'ss.35–37 MCA',
    tooltip:   'Bars to voidable nullity: s.35 (petitioner knew of ground at time of marriage and it would be unjust to grant relief), s.36 (lapse of time), s.37 (conduct of petitioner). Also: petitioner cannot petition on ground of their own disability.',
  },
  {
    id:        'financial_disclosure',
    label:     'Financial Disclosure Risk',
    icon:      '💰',
    authority: 'O.11 MCR · s.70 MCA',
    tooltip:   'Adequacy of financial disclosure. Asset concealment, pendente lite urgency, disclosure order compliance. Hidden assets increase uncertainty in ancillary relief outcomes.',
  },
  {
    id:        'welfare_of_child',
    label:     'Welfare-of-Child Risk',
    icon:      '👶',
    authority: 's.71 MCA',
    tooltip:   'Probability of favourable custody outcome. Welfare officer involvement, current arrangements, residence stability, risk of child removal from jurisdiction.',
  },
  {
    id:        'decree_timeline',
    label:     'Nisi → Absolute Timeline',
    icon:      '⚡',
    authority: 'ss.57–58 MCA',
    tooltip:   'Whether the correct s.57 (28 days — children welfare order made) or s.58 (3 months — no order) path has been identified. Pending appeals may prevent the nisi from being made absolute.',
  },
  {
    id:        'appeal_survivability',
    label:     'Appeal Survivability',
    icon:      '▲',
    authority: 's.241(1)(f)(iv) CFRN · s.241(2) CFRN',
    tooltip:   'Strength of any grounds against the decree nisi. As-of-right appeal under s.241(1)(f)(iv) CFRN against nisi. Hard constitutional bar under s.241(2) CFRN: NO appeal against decree absolute — ever.',
  },
];

const VERDICT_CONFIG: Record<Verdict, { color: string; bg: string; bdr: string; label: string; icon: string }> = {
  PROCEED:                { color: '#1a5a3a', bg: '#edfaf3', bdr: '#b8e8cc', label: 'PROCEED',                icon: '✓' },
  PROCEED_WITH_CAUTION:   { color: '#7a5a00', bg: '#fffbf0', bdr: '#e8d880', label: 'PROCEED — WITH CAUTION', icon: '⚠' },
  RESOLVE_BARS_FIRST:     { color: '#7a3a00', bg: '#fff3ec', bdr: '#e8c0a0', label: 'RESOLVE BARS FIRST',     icon: '⛔' },
  RECONSIDER:             { color: '#7a1a1a', bg: '#fbedf0', bdr: '#e8b8c0', label: 'RECONSIDER',             icon: '✗' },
};

const MRISK_SYSTEM = `You are a specialist Nigerian matrimonial causes risk analyst. You assess cases under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and the Matrimonial Causes Rules 1983 (MCR).

DOCTRINAL RULES (mandatory):
- Sole ground: irretrievable breakdown s.15(1). s.15(2)(a)–(h) are evidence, not grounds.
- Court: High Court of a State — NOT the Federal High Court.
- s.30 bar: 2-year bar unless wilful refusal s.15(2)(a), adultery s.15(2)(b), or rape/sodomy/bestiality s.16(1)(a).
- Condonation ss.26–27: bars adultery and behaviour facts if petitioner forgave and resumed cohabitation.
- s.57: 28 days from nisi if children welfare order made. s.58: 3 months if no such order.
- s.241(2) CFRN: NO appeal against decree absolute — hard constitutional bar, no exceptions.
- Nullity bars: ss.35–37 MCA. Petitioner cannot petition on ground of their own disability.
- Co-respondent: must be joined when adultery alleged — s.32 MCA, O.9 rr.2–3 MCR.

Return ONLY valid JSON. No markdown fences, no preamble. Exact shape required.

Score each dimension 0–100 where 100 = maximum strength of counsel's position (post-normalisation for inverse dimensions).
raw_risk: the direct risk level for that dimension ("HIGH" = serious problem, "LOW" = minimal concern, "N/A" = not applicable).
flags: array of specific legal flags for that dimension (empty array if none).`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(n: number): string {
  if (n < 35) return '#c04040';
  if (n < 60) return '#c4a030';
  return '#1a5a3a';
}

function scoreBg(n: number): string {
  if (n < 35) return '#fbedf0';
  if (n < 60) return '#fffbf0';
  return '#edfaf3';
}

function overallScore(r: RiskResult): number {
  const dims: Array<keyof Omit<RiskResult, 'overall' | 'verdict' | 'recommendation' | 'timestamp' | 'stage'>> = [
    'ground_strength', 'condonation_connivance', 'two_year_bar', 'nullity_bar',
    'financial_disclosure', 'welfare_of_child', 'decree_timeline', 'appeal_survivability',
  ];
  const valid = dims.map(d => (r[d] as DimensionScore).score).filter(s => s >= 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function riskBadge(level: string) {
  const cfg: Record<string, { col: string; bg: string; bdr: string }> = {
    HIGH:   { col: '#7a1a1a', bg: '#fbedf0', bdr: '#e8b8c0' },
    MEDIUM: { col: '#7a5a00', bg: '#fffbf0', bdr: '#e8d880' },
    LOW:    { col: '#1a5a3a', bg: '#edfaf3', bdr: '#b8e8cc' },
    'N/A':  { col: '#888888', bg: '#f5f5f5', bdr: '#cccccc' },
  };
  const c = cfg[level] ?? cfg['N/A'];
  return (
    <span style={{
      fontSize: 9, fontFamily: SERIF, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', background: c.bg, color: c.col,
      border: `1px solid ${c.bdr}`, borderRadius: 3, padding: '2px 7px',
    }}>{level}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION CARD
// ─────────────────────────────────────────────────────────────────────────────

function DimensionCard({ def, data }: {
  def: typeof DIMENSIONS[number];
  data: DimensionScore;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      border: '1px solid #e0e0e0', borderRadius: 8, padding: '14px 16px',
      background: '#fafafa', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: expanded ? 12 : 0 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{def.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600, color: '#111111' }}>
              {def.label}
            </span>
            <span style={{ fontSize: 9, fontFamily: SERIF, color: '#4a1a7a', background: '#f5edfb', border: '1px solid #ccb8e8', borderRadius: 3, padding: '1px 6px', letterSpacing: '.04em' }}>
              {def.authority}
            </span>
            {riskBadge(data.raw_risk)}
          </div>
          {/* Score bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, background: '#e0e0e0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${data.score}%`, background: scoreColor(data.score), borderRadius: 3, transition: 'width .4s' }} />
            </div>
            <span style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 700, color: scoreColor(data.score), flexShrink: 0 }}>
              {data.score}
            </span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'transparent', border: '1px solid #dddddd', color: '#666666', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer', flexShrink: 0 }}>
          {expanded ? 'Less ↑' : 'Detail ↓'}
        </button>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #eeeeee', paddingTop: 12, marginTop: 4 }}>
          <p style={{ fontSize: 12, fontFamily: SERIF, color: '#444444', lineHeight: 1.7, marginBottom: 10 }}>
            {data.reasoning}
          </p>
          {data.flags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.flags.map((f, i) => (
                <span key={i} style={{
                  fontSize: 11, fontFamily: SERIF, background: '#fff8e1',
                  color: '#7a5a00', border: '1px solid #e8d880', borderRadius: 4,
                  padding: '3px 8px', lineHeight: 1.4,
                }}>⚑ {f}</span>
              ))}
            </div>
          )}
          <p style={{ fontSize: 10, fontFamily: SERIF, color: '#aaaaaa', marginTop: 8, fontStyle: 'italic' }}>
            {def.tooltip}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 8,
  padding: '20px 22px', marginBottom: 16,
};
const lbS: React.CSSProperties = {
  fontSize: 9, color: '#888888', fontFamily: SERIF,
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};
const taS: React.CSSProperties = {
  width: '100%', background: '#fafafa', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '10px 13px', fontSize: 13,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
  lineHeight: 1.7, resize: 'vertical',
};

function Btn({ label, onClick, loading = false, disabled = false, secondary = false }: {
  label: string; onClick: () => void; loading?: boolean; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading || disabled} style={{
      background: secondary ? '#f5f5f5' : loading || disabled ? '#e0e0e0' : '#111111',
      color: secondary ? '#444444' : loading || disabled ? '#999999' : '#ffffff',
      border: secondary ? '1px solid #cccccc' : 'none',
      borderRadius: 5, padding: '10px 22px', fontSize: 13,
      fontFamily: SERIF, cursor: loading || disabled ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳ Analysing…' : label}
    </button>
  );
}

export function MRisk({ activeCase }: Props) {
  const ai = useAI(activeCase);

  const [stage, setStage]     = useState('Pre-Filing');
  const [context, setContext] = useState('');
  const [result, setResult]   = useState<RiskResult | null>(null);
  const [history, setHistory] = useState<RiskResult[]>([]);
  const [tab, setTab]         = useState<'analyse' | 'history'>('analyse');
  const [copied, setCopied]   = useState(false);

  const caseId = activeCase.id;

  useEffect(() => {
    loadBlindSpot<SavedData>(caseId, MODULE)
      .then(d => {
        const saved = d ?? DEFAULT_DATA;
        if (saved.last) setResult(saved.last);
        setHistory(saved.history);
      })
      .catch(() => {});
  }, [caseId]);

  async function runAnalysis() {
    const roleLabel = activeCase.counsel_role === 'petitioner_side'
      ? 'Petitioner Side'
      : activeCase.counsel_role === 'respondent_side'
        ? 'Respondent Side'
        : activeCase.counsel_role ?? 'Unknown';

    const prompt = `CASE: ${activeCase.caseName}
Court: ${activeCase.court ?? 'High Court of the relevant State'}
Suit No: ${activeCase.suitNo ?? 'Not assigned'}
Counsel Role: ${roleLabel}
Procedural Stage: ${stage}

FACTS AND CONTEXT:
${context}

Analyse the matrimonial risk across all 8 dimensions and return ONLY this JSON object:

{
  "ground_strength":        { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": ["flag1","flag2"] },
  "condonation_connivance": { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "two_year_bar":           { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "nullity_bar":            { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "financial_disclosure":   { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "welfare_of_child":       { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "decree_timeline":        { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "appeal_survivability":   { "score": N, "raw_risk": "HIGH|MEDIUM|LOW|N/A", "reasoning": "one precise paragraph", "flags": [] },
  "overall": N,
  "verdict": "PROCEED|PROCEED_WITH_CAUTION|RESOLVE_BARS_FIRST|RECONSIDER",
  "recommendation": "two to three sentence strategic recommendation for Nigerian matrimonial counsel",
  "timestamp": 0,
  "stage": "${stage}"
}

Rules:
- All N values: integers 0–100. Score 100 = maximum strength of counsel's position.
- For dimensions that are not applicable (e.g. nullity bars in a dissolution-only case), set score to 75, raw_risk to "N/A", and explain briefly.
- verdict: PROCEED (overall ≥ 70, no HIGH risks on bar dimensions), PROCEED_WITH_CAUTION (overall 50–70 or isolated HIGH), RESOLVE_BARS_FIRST (HIGH on two_year_bar, nullity_bar, or condonation), RECONSIDER (overall < 40 or multiple critical bars).
- Apply Nigerian MCA law precisely. Be analytically honest.
- s.241(2) CFRN hard bar: if any appeal against decree absolute is in play, appeal_survivability score must be 0 with raw_risk HIGH.`;

    const raw = await ai.ask({ system: MRISK_SYSTEM, userMsg: prompt, maxTokens: 2500, libraryOpts: { queryHint: 'MCA matrimonial risk condonation connivance s.30 two-year bar nullity bars ss.35-37 ground strength s.15(2) decree timeline s.57 s.58 appeal s.241(2) CFRN financial disclosure' } });
    if (!raw) return;

    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed: RiskResult = JSON.parse(clean);
      parsed.timestamp = Date.now();
      parsed.overall   = overallScore(parsed);
      setResult(parsed);
      const nextHistory = [parsed, ...history].slice(0, 10);
      setHistory(nextHistory);
      await saveBlindSpot(caseId, MODULE, { last: parsed, history: nextHistory });
    } catch {
      // parsed failed — ai.error will show
    }
  }

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text = DIMENSIONS.map(d => {
      const data = result[d.id] as DimensionScore;
      return `${d.label} (${d.authority})\nScore: ${data.score}/100  Risk: ${data.raw_risk}\n${data.reasoning}${data.flags.length ? '\nFlags: ' + data.flags.join('; ') : ''}`;
    }).join('\n\n') + `\n\nOverall: ${result.overall}/100\nVerdict: ${VERDICT_CONFIG[result.verdict].label}\n\n${result.recommendation}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [result]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ paddingTop: 24, maxWidth: 900 }}>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Matrimonial Risk Analysis
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          8 MCA-specific dimensions · ground strength · condonation · s.30 bar · nullity bars · financial · welfare · decree timeline · appeal survivability
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e0e0e0' }}>
        {(['analyse', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: tab === t ? '2px solid #111111' : '2px solid transparent',
              color: tab === t ? '#111111' : '#888888', padding: '8px 16px',
              fontSize: 12, fontFamily: SERIF, cursor: 'pointer',
              fontWeight: tab === t ? 600 : 400, letterSpacing: '.04em',
            }}>
            {t === 'analyse' ? 'Risk Analysis' : `History (${history.length})`}
          </button>
        ))}
      </div>

      {ai.error && <ErrorBlock message={ai.error} onDismiss={() => ai.clearError()} />}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────── */}
      {tab === 'history' && (
        history.length === 0 ? (
          <div style={{ ...cardS, textAlign: 'center', color: '#aaaaaa', fontFamily: SERIF, fontSize: 13, paddingTop: 40, paddingBottom: 40 }}>
            No saved risk analyses yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {history.map((r, i) => {
              const vc = VERDICT_CONFIG[r.verdict];
              return (
                <div key={i} style={{ ...cardS, marginBottom: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{
                      fontSize: 12, fontFamily: SERIF, fontWeight: 700,
                      background: vc.bg, color: vc.color, border: `1px solid ${vc.bdr}`,
                      borderRadius: 4, padding: '3px 10px',
                    }}>{vc.icon} {vc.label}</span>
                    <span style={{ fontSize: 13, fontFamily: SERIF, color: '#333333' }}>
                      Overall: <strong>{r.overall}/100</strong>
                    </span>
                    <span style={{ fontSize: 11, fontFamily: SERIF, color: '#888888', marginLeft: 'auto' }}>
                      {r.stage} · {new Date(r.timestamp).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', lineHeight: 1.6, marginTop: 10 }}>
                    {r.recommendation}
                  </p>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── ANALYSIS TAB ────────────────────────────────────────────────── */}
      {tab === 'analyse' && (
        <>
          {/* Input panel */}
          <div style={cardS}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={lbS}>Procedural Stage</label>
                <select
                  value={stage}
                  onChange={e => setStage(e.target.value)}
                  style={{ width: '100%', background: '#fafafa', border: '1px solid #cccccc', borderRadius: 5, color: '#111111', padding: '9px 12px', fontSize: 13, fontFamily: SERIF, outline: 'none' }}>
                  {MATRIMONIAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ background: '#f5edfb', border: '1px solid #ccb8e8', borderRadius: 5, padding: '9px 14px', fontSize: 11, fontFamily: SERIF, color: '#4a1a7a', lineHeight: 1.5 }}>
                  Counsel role: <strong>{activeCase.counsel_role === 'petitioner_side' ? 'Petitioner Side' : activeCase.counsel_role === 'respondent_side' ? 'Respondent Side' : 'Not set'}</strong>
                </div>
              </div>
            </div>

            <label style={lbS}>Case facts and context for risk analysis</label>
            <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888', lineHeight: 1.6, marginBottom: 10 }}>
              Describe the matrimonial matter: marriage date, facts alleged, evidence available, any condonation events, financial situation, children, current procedural stage, and any specific concerns.
            </p>
            <textarea
              style={{ ...taS, minHeight: 160 }}
              rows={9}
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Marriage date, grounds pleaded, evidence available, condonation risk, children, financial disclosure status, stage of proceedings, specific risk concerns…"
            />
            <div style={{ marginTop: 14 }}>
              <Btn
                label="Run Risk Analysis →"
                onClick={runAnalysis}
                loading={ai.loading}
                disabled={context.trim().length < 60}
              />
            </div>
          </div>

          {/* Results */}
          {result && (
            <>
              {/* Overall verdict */}
              {(() => {
                const vc = VERDICT_CONFIG[result.verdict];
                return (
                  <div style={{
                    background: vc.bg, border: `2px solid ${vc.bdr}`, borderRadius: 10,
                    padding: '20px 24px', marginBottom: 20,
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <span style={{ fontSize: 28, fontFamily: SERIF, fontWeight: 700, color: vc.color }}>
                          {vc.icon}
                        </span>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: SERIF, letterSpacing: '.18em', textTransform: 'uppercase', color: vc.color, fontWeight: 700, marginBottom: 2 }}>
                            Matrimonial Risk Verdict
                          </div>
                          <div style={{ fontSize: 20, fontFamily: SERIF, fontWeight: 700, color: vc.color }}>
                            {vc.label}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          <div style={{ fontSize: 11, fontFamily: SERIF, color: '#888888', marginBottom: 2 }}>Overall Position</div>
                          <div style={{ fontSize: 32, fontFamily: SERIF, fontWeight: 700, color: scoreColor(result.overall), lineHeight: 1 }}>
                            {result.overall}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: SERIF, color: '#888888' }}>/100</div>
                        </div>
                      </div>
                      <p style={{ fontSize: 13, fontFamily: SERIF, color: '#333333', lineHeight: 1.75, margin: 0 }}>
                        {result.recommendation}
                      </p>
                    </div>
                    <button onClick={handleCopy} style={{ background: 'white', border: `1px solid ${vc.bdr}`, color: vc.color, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer', flexShrink: 0 }}>
                      {copied ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                );
              })()}

              {/* Dimension scores */}
              <div>
                {DIMENSIONS.map(def => (
                  <DimensionCard
                    key={def.id}
                    def={def}
                    data={result[def.id] as DimensionScore}
                  />
                ))}
              </div>

              {/* s.241(2) hard bar reminder */}
              <div style={{ background: '#fbedf0', border: '1px solid #e8b8c0', borderRadius: 8, padding: '14px 18px', marginTop: 8 }}>
                <p style={{ fontSize: 12, fontFamily: SERIF, color: '#7a1a1a', lineHeight: 1.6, margin: 0 }}>
                  <strong>s.241(2) CFRN — Constitutional Hard Bar:</strong> No appeal lies against a decree absolute. This is absolute and admits no exceptions. Once the decree absolute is granted, the marriage is dissolved finally. Any challenge to the marriage's validity at that point requires entirely different proceedings.
                </p>
              </div>

              <div style={{ marginTop: 16 }}>
                <Btn label="Re-analyse" onClick={runAnalysis} loading={ai.loading} secondary />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
