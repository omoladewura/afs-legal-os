/**
 * AFS Advocates — Risk Analytics Engine
 *
 * Numerical risk scoring across 8 strategic dimensions:
 *   Procedural Strength · Evidential Strength · Witness Vulnerability
 *   Jurisdictional Risk · Burden Satisfaction · Settlement Advisability
 *   Appeal Survivability · Opponent Threat Level
 *
 * Verdict: FILE | NEGOTIATE | SETTLE | WALK_AWAY
 */

import React, { useState, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { buildRoleLibraryOpts } from '@/utils/roleLibrary';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Verdict = 'FILE' | 'NEGOTIATE' | 'SETTLE' | 'WALK_AWAY';

interface DimensionScores {
  procedural:              number;
  evidential:              number;
  witness_vulnerability:   number;
  jurisdictional_risk:     number;
  burden_satisfaction:     number;
  settlement_advisability: number;
  appeal_survivability:    number;
  opponent_threat:         number;
}

type DimensionId = keyof DimensionScores;

interface DimensionReasoning {
  procedural:              string;
  evidential:              string;
  witness_vulnerability:   string;
  jurisdictional_risk:     string;
  burden_satisfaction:     string;
  settlement_advisability: string;
  appeal_survivability:    string;
  opponent_threat:         string;
}

interface RiskResult {
  scores:         DimensionScores;
  reasoning:      DimensionReasoning;
  recommendation: string;
  verdict:        Verdict;
  timestamp:      number;
  stage:          string;
}

interface ScenarioInput {
  id:          string;
  label:       string;
  description: string;
}

interface ScenarioResult {
  id:             string;
  label:          string;
  verdict:        Verdict;
  scores:         DimensionScores;
  recommendation: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CIVIL_STAGES: string[] = [
  'Pre-Filing / Pre-Action',
  'Originating Process',
  'Service of Process',
  'Pleadings Stage',
  'Pre-Trial / Case Management',
  'Trial Stage',
  'Post-Trial / Judgment',
  'Appeal Stage',
];

const CRIMINAL_STAGES: string[] = [
  'Investigation / Pre-Charge',
  'Charge & Arraignment',
  'Prosecution Case',
  'No-Case Submission',
  'Defence Case',
  'Final Addresses',
  'Sentencing',
  'Appeal Stage',
];

function getPceStages(matterTrack?: string): string[] {
  return matterTrack === 'criminal' ? CRIMINAL_STAGES : CIVIL_STAGES;
}

// Keep PCE_STAGES as alias for default (civil) to avoid breaking references
const PCE_STAGES = CIVIL_STAGES;

const DIMENSIONS: Array<{ id: DimensionId; label: string; icon: string; invert?: boolean }> = [
  { id: 'procedural',              label: 'Procedural Strength',      icon: '⚙' },
  { id: 'evidential',              label: 'Evidential Strength',      icon: '📁' },
  { id: 'witness_vulnerability',   label: 'Witness Vulnerability',    icon: '👁',  invert: true },
  { id: 'jurisdictional_risk',     label: 'Jurisdictional Risk',      icon: '⚖',  invert: true },
  { id: 'burden_satisfaction',     label: 'Burden Satisfaction',      icon: '⚔' },
  { id: 'settlement_advisability', label: 'Settlement Advisability',  icon: '🤝' },
  { id: 'appeal_survivability',    label: 'Appeal Survivability',     icon: '↑' },
  { id: 'opponent_threat',         label: 'Opponent Threat Level',    icon: '⚡', invert: true },
];

const VERDICT_CONFIG: Record<Verdict, { color: string; bg: string; bdr: string; label: string }> = {
  FILE:      { color: '#40a868', bg: '#081e10', bdr: '#1a5030', label: 'FILE' },
  NEGOTIATE: { color: '#c4a030', bg: '#1e1600', bdr: '#4a3a00', label: 'NEGOTIATE' },
  SETTLE:    { color: '#c07830', bg: '#1a1000', bdr: '#4a2800', label: 'SETTLE' },
  WALK_AWAY: { color: '#c04040', bg: '#1e0808', bdr: '#4a1818', label: 'WALK AWAY' },
};

const PRESET_SCENARIOS: ScenarioInput[] = [
  { id: 'best_case',  label: 'Best Case',  description: 'Assume all disputed evidence resolves in our favour. All witnesses cooperate fully.' },
  { id: 'base_case',  label: 'Base Case',  description: 'Realistic scenario — mixed outcomes on disputed points. Standard witness performance.' },
  { id: 'worst_case', label: 'Worst Case', description: 'Key evidence excluded or challenged successfully. Adverse witness testimony.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(n: number, invert = false): string {
  const adjusted = invert ? (100 - n) : n;
  if (adjusted < 40) return '#c04040';
  if (adjusted < 70) return '#c4a030';
  return '#40a868';
}

function overallScore(scores: DimensionScores): number {
  const positive: DimensionId[] = ['procedural', 'evidential', 'burden_satisfaction', 'settlement_advisability', 'appeal_survivability'];
  const negative: DimensionId[] = ['witness_vulnerability', 'jurisdictional_risk', 'opponent_threat'];
  const posSum = positive.reduce((a, k) => a + scores[k], 0) / positive.length;
  const negSum = negative.reduce((a, k) => a + (100 - scores[k]), 0) / negative.length;
  return Math.round((posSum + negSum) / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const RISK_SYSTEM = `You are a senior Nigerian litigation risk analyst with 30 years of courtroom experience across the Magistrate Court, High Court, Court of Appeal, and Supreme Court. Analyse the case facts and stage provided and return ONLY valid JSON — no markdown fences, no preamble, no trailing text. Use this exact shape:

{"scores":{"procedural":N,"evidential":N,"witness_vulnerability":N,"jurisdictional_risk":N,"burden_satisfaction":N,"settlement_advisability":N,"appeal_survivability":N,"opponent_threat":N},"reasoning":{"procedural":"one precise line","evidential":"one precise line","witness_vulnerability":"one precise line","jurisdictional_risk":"one precise line","burden_satisfaction":"one precise line","settlement_advisability":"one precise line","appeal_survivability":"one precise line","opponent_threat":"one precise line"},"recommendation":"two to three sentence strategic recommendation for Nigerian litigation counsel","verdict":"FILE"}

Rules:
- All N values are integers 0–100.
- verdict must be exactly one of: FILE, NEGOTIATE, SETTLE, WALK_AWAY.
- Higher score = stronger practitioner position for: procedural, evidential, burden_satisfaction, settlement_advisability, appeal_survivability.
- Higher score = WORSE (higher risk) for: witness_vulnerability, jurisdictional_risk, opponent_threat.
- Apply Nigerian procedural law, Evidence Act 2011, and specific court norms throughout.
- Be analytically honest — do not default to optimistic scores.`;

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SHARED COMPONENTS (local to this engine)
// ─────────────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span style={{
      display:      'inline-block',
      width:        11,
      height:       11,
      border:       '1.5px solid #2a2208',
      borderTop:    '1.5px solid #c4a030',
      borderRadius: '50%',
      animation:    'spin .8s linear infinite',
      flexShrink:   0,
    }} />
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div style={{ background: '#180808', border: '1px solid #4a1818', borderRadius: 6, padding: '12px 16px', marginTop: 12 }}>
      <p style={{ fontSize: 13, color: '#c05050', fontFamily: 'Inter, sans-serif', margin: 0 }}>{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

export function RiskAnalytics({ activeCase }: Props) {
  const caseId = activeCase?.id || 'unknown';

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scenarios' | 'register'>('dashboard');
  const [facts,     setFacts]     = useState<string>('');
  const [stage,     setStage]     = useState<string>(getPceStages(activeCase.matter_track)[0]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [result,    setResult]    = useState<RiskResult | null>(null);
  const [animated,  setAnimated]  = useState(false);

  // Scenario analysis state
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioResults, setScenarioResults] = useState<ScenarioResult[]>([]);
  const [scenarioError,   setScenarioError]   = useState('');

  // Risk register state
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerContent, setRegisterContent] = useState<string>('');
  const [registerError,   setRegisterError]   = useState('');

  // ── Effects ────────────────────────────────────────────────────────────────

  // Load all persisted data from IndexedDB on mount / caseId change
  useEffect(() => {
    loadBlindSpot<{ facts: string; stage: string; result: RiskResult | null; register: string }>(
      caseId, 'risk',
      { facts: '', stage: getPceStages(activeCase.matter_track)[0], result: null, register: '' }
    ).then(data => {
      setFacts(data.facts ?? '');
      setStage(data.stage ?? getPceStages(activeCase.matter_track)[0]);
      setResult(data.result ?? null);
      setRegisterContent(data.register ?? '');
    });
  }, [caseId]);

  useEffect(() => {
    if (result) {
      setAnimated(false);
      const t = setTimeout(() => setAnimated(true), 100);
      return () => clearTimeout(t);
    }
  }, [result]);

  // Persist helper — always writes the full blob
  function persist(patch: { facts?: string; stage?: string; result?: RiskResult | null; register?: string }) {
    // read current state values via closure; merge patch
    saveBlindSpot(caseId, 'risk', {
      facts:    patch.facts    !== undefined ? patch.facts    : facts,
      stage:    patch.stage    !== undefined ? patch.stage    : stage,
      result:   patch.result   !== undefined ? patch.result   : result,
      register: patch.register !== undefined ? patch.register : registerContent,
    });
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const cardS: React.CSSProperties = {
    background:   '#0d0d18',
    border:       '1px solid #181828',
    borderRadius: 8,
    padding:      '18px 20px',
    marginBottom: 12,
  };
  const labelS: React.CSSProperties = {
    fontSize:      10,
    color:         '#5a5a72',
    fontFamily:    'Inter, sans-serif',
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    fontWeight:    600,
    display:       'block',
    marginBottom:  6,
  };
  const inputS: React.CSSProperties = {
    width:        '100%',
    background:   '#07070f',
    border:       '1px solid #1e1e2e',
    borderRadius: 5,
    color:        '#e0dcd0',
    padding:      '11px 14px',
    fontSize:     15,
    fontFamily:   "'Cormorant Garamond', serif",
    outline:      'none',
    resize:       'vertical',
    lineHeight:   1.82,
    minHeight:    140,
    boxSizing:    'border-box',
  };
  const selS: React.CSSProperties = {
    width:            '100%',
    background:       '#07070f',
    border:           '1px solid #1e1e2e',
    borderRadius:     5,
    color:            '#e0dcd0',
    padding:          '11px 14px',
    fontSize:         14,
    fontFamily:       "'Cormorant Garamond', serif",
    outline:          'none',
    appearance:       'none',
    WebkitAppearance: 'none',
    cursor:           'pointer',
  };
  const primaryBtnS = (enabled: boolean): React.CSSProperties => ({
    background:     enabled ? 'linear-gradient(135deg, #c4a030, #a07820)' : '#101018',
    color:          enabled ? '#05050c' : '#2a2a38',
    border:         enabled ? 'none' : '1px solid #181828',
    borderRadius:   6,
    padding:        '13px 28px',
    fontSize:       16,
    fontFamily:     "'Cormorant Garamond', serif",
    cursor:         enabled ? 'pointer' : 'not-allowed',
    width:          '100%',
    fontWeight:     600,
    letterSpacing:  '.04em',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    transition:     'all .2s',
  });

  // ── Analysis ───────────────────────────────────────────────────────────────
  async function runAnalysis() {
    if (!facts.trim()) return;
    setLoading(true);
    setError('');
    setAnimated(false);
    try {
      const raw    = await callClaude({ system: buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role) + '\n\n' + RISK_SYSTEM, userMsg: `Case Stage: ${stage}\n\nCase Facts:\n${facts}`, maxTokens: 1200, matter_track: activeCase.matter_track, counsel_role: activeCase.counsel_role, libraryOpts: buildRoleLibraryOpts(activeCase.matter_track, activeCase.counsel_role, 'risk analytics litigation risk assessment') });
      const clean  = raw.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(clean) as Omit<RiskResult, 'timestamp' | 'stage'>;
      const withMeta: RiskResult = { ...parsed, timestamp: Date.now(), stage };
      saveBlindSpot(caseId, 'risk', { facts, stage, result: withMeta, register: registerContent });
      setResult(withMeta);
    } catch (e) {
      setError((e as Error).message || 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function clearResult() {
    setResult(null);
    setAnimated(false);
    saveBlindSpot(caseId, 'risk', { facts, stage, result: null, register: registerContent });
  }

  // ── Scenario Analysis ──────────────────────────────────────────────────────
  async function runScenarios() {
    if (!facts.trim()) { setScenarioError('Enter case facts on the Dashboard tab first.'); return; }
    setScenarioLoading(true);
    setScenarioError('');
    setScenarioResults([]);
    try {
      const results: ScenarioResult[] = [];
      for (const scenario of PRESET_SCENARIOS) {
        const raw    = await callClaude({ system: RISK_SYSTEM, userMsg: `Case Stage: ${stage}\n\nCase Facts:\n${facts}\n\nSCENARIO MODIFIER: ${scenario.description}`, maxTokens: 1000 });
        const clean  = raw.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(clean) as Omit<RiskResult, 'timestamp' | 'stage'>;
        results.push({ id: scenario.id, label: scenario.label, verdict: parsed.verdict, scores: parsed.scores, recommendation: parsed.recommendation });
      }
      setScenarioResults(results);
    } catch (e) {
      setScenarioError((e as Error).message || 'Scenario analysis failed.');
    } finally {
      setScenarioLoading(false);
    }
  }

  // ── Risk Register ──────────────────────────────────────────────────────────
  async function generateRegister() {
    if (!facts.trim() && !result) { setRegisterError('Run the Risk Dashboard analysis first, or enter case facts.'); return; }
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const scoreContext = result
        ? `\n\nEXISTING RISK SCORES:\n${DIMENSIONS.map(d => `${d.label}: ${result.scores[d.id]}/100`).join('\n')}\nVerdict: ${result.verdict}\nRecommendation: ${result.recommendation}`
        : '';
      const registerSystem = `You are a senior Nigerian litigation risk analyst. Produce a detailed Litigation Risk Register in structured plain text. No JSON, no markdown fences. Use clear section headings, numbered risks, and concise prose. Each risk entry must include: Risk ID, Risk Category, Description, Likelihood (High/Medium/Low), Impact (High/Medium/Low), Risk Rating (Critical/Significant/Moderate/Low), Mitigation Strategy, and Responsible Action. Group risks by category: Procedural, Evidential, Witness, Jurisdictional, Financial, Strategic, and Reputational. Begin with an Executive Summary showing the overall risk rating and top 3 risks. End with a Risk Mitigation Action Plan.`;
      const content = await callClaude({
        system:   registerSystem,
        userMsg:  `Case: ${activeCase.caseName || 'Untitled'}\nCourt: ${activeCase.court || '—'}\nStage: ${stage}\n\nCase Facts:\n${facts}${scoreContext}`,
        maxTokens: 2500,
      });
      saveBlindSpot(caseId, 'risk', { facts, stage, result, register: content });
      setRegisterContent(content);
    } catch (e) {
      setRegisterError((e as Error).message || 'Register generation failed.');
    } finally {
      setRegisterLoading(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const canRun   = facts.trim().length > 20 && !loading;
  const overall  = result ? overallScore(result.scores) : null;
  const overallC = overall !== null ? scoreColor(overall) : '#5a5a72';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
          Risk Analytics Engine
        </p>
        <p style={{ fontSize: 22, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, marginBottom: 4 }}>
          Strategic Risk Scoring
        </p>
        <p style={{ fontSize: 13, color: '#5a5a72', fontFamily: 'Inter, sans-serif', lineHeight: 1.65, maxWidth: 680 }}>
          Numerical risk assessment across 8 dimensions calibrated to Nigerian litigation standards.
          Scores are AI-generated — verify independently before advising clients.
        </p>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24, borderBottom: '1px solid #12121e', paddingBottom: 12 }}>
        {([
          { id: 'dashboard', icon: '■',  label: 'Risk Dashboard'    },
          { id: 'scenarios', icon: '◈',  label: 'Scenario Analysis' },
          { id: 'register',  icon: '§',  label: 'Risk Register'     },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background:    activeTab === tab.id ? '#0e0e1e' : 'transparent',
              border:        activeTab === tab.id ? '1px solid #2a2a3e' : '1px solid transparent',
              color:         activeTab === tab.id ? T.gold : '#505060',
              borderRadius:  5,
              padding:       '7px 14px',
              fontSize:      12,
              fontFamily:    'Inter, sans-serif',
              cursor:        'pointer',
              letterSpacing: '.06em',
              fontWeight:    600,
              transition:    'all .15s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════ DASHBOARD ══════════════════════════ */}
      {activeTab === 'dashboard' && (
        <div>
          <div style={cardS}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelS}>Case Facts &amp; Issues</label>
              <textarea
                value={facts}
                onChange={e => { setFacts(e.target.value); saveBlindSpot(caseId, 'risk', { facts: e.target.value, stage, result, register: registerContent }); }}
                placeholder="Summarise the key facts, parties, claims, available evidence, and legal issues. The more detail you provide, the more precise the risk scores will be."
                style={inputS}
              />
              <p style={{ fontSize: 10, color: '#3a3a52', fontFamily: 'Inter, sans-serif', textAlign: 'right', marginTop: 4 }}>
                {facts.length} chars
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: result ? '1fr auto' : '1fr', gap: 10, alignItems: 'end', marginBottom: 14 }}>
              <div>
                <label style={labelS}>Case Stage</label>
                <select value={stage} onChange={e => { setStage(e.target.value); saveBlindSpot(caseId, 'risk', { facts, stage: e.target.value, result, register: registerContent }); }} style={selS}>
                  {getPceStages(activeCase.matter_track).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {result && (
                <button
                  onClick={clearResult}
                  style={{ background: 'transparent', border: '1px solid #1e1e2e', color: '#505068', borderRadius: 5, padding: '11px 16px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.06em', whiteSpace: 'nowrap', alignSelf: 'flex-end' }}
                >
                  ✕ Clear
                </button>
              )}
            </div>
            <button onClick={runAnalysis} disabled={!canRun} style={primaryBtnS(canRun)}>
              {loading
                ? <><Spinner /> Analysing…</>
                : result ? '⟳ Re-run Analysis' : '■ Run Risk Analysis'}
            </button>
            {error && <ErrorBlock message={error} />}
          </div>

          {result && !loading && (
            <div style={{ animation: 'fadeUp .3s ease' }}>

              {/* Meta bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '10px 14px', background: '#080810', border: '1px solid #111120', borderRadius: 6 }}>
                <div>
                  <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase' }}>Last analysed · {result.stage}</p>
                  <p style={{ fontSize: 11, color: '#3a3a52', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
                    {new Date(result.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {overall !== null && (
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Overall</p>
                    <span style={{ fontSize: 32, color: overallC, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, lineHeight: 1 }}>{overall}</span>
                  </div>
                )}
              </div>

              {/* Verdict */}
              {result.verdict && (() => {
                const v = VERDICT_CONFIG[result.verdict] || VERDICT_CONFIG.NEGOTIATE;
                return (
                  <div style={{ textAlign: 'center', marginBottom: 18, padding: '18px 24px', background: '#080810', border: `1px solid ${v.color}33`, borderRadius: 8 }}>
                    <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 8 }}>Strategic Verdict</p>
                    <div style={{ display: 'inline-block', background: `${v.color}18`, border: `1px solid ${v.color}55`, borderRadius: 4, padding: '6px 24px', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, color: v.color, fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' }}>{v.label}</span>
                    </div>
                    {result.recommendation && (
                      <p style={{ fontSize: 15, color: '#cac6ba', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.85, maxWidth: 600, margin: '0 auto' }}>
                        {result.recommendation}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Score Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {DIMENSIONS.map(dim => {
                  const score  = result.scores[dim.id];
                  const color  = scoreColor(score, dim.invert);
                  const reason = result.reasoning[dim.id];
                  return (
                    <div key={dim.id} style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, opacity: .7 }}>{dim.icon}</span>
                          <p style={{ fontSize: 10, color: '#8a8a9a', fontFamily: 'Inter, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>{dim.label}</p>
                        </div>
                        <span style={{ fontSize: 28, color, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, lineHeight: 1 }}>{score}</span>
                      </div>
                      <div style={{ background: '#0a0a14', borderRadius: 3, height: 5, marginBottom: 10, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: animated ? `${score}%` : '0%', background: color, borderRadius: 3, transition: 'width .9s cubic-bezier(.25,.46,.45,.94)' }} />
                      </div>
                      {dim.invert && (
                        <p style={{ fontSize: 9, color: '#3a3a52', fontFamily: 'Inter, sans-serif', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>↑ higher = more risk</p>
                      )}
                      {reason && (
                        <p style={{ fontSize: 12, color: '#6a6050', fontFamily: 'Inter, sans-serif', fontStyle: 'italic', lineHeight: 1.55, margin: 0 }}>{reason}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════ SCENARIOS ══════════════════════════ */}
      {activeTab === 'scenarios' && (
        <div>
          <div style={cardS}>
            <p style={{ fontSize: 18, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, marginBottom: 6 }}>Scenario Analysis</p>
            <p style={{ fontSize: 13, color: '#505060', fontFamily: 'Inter, sans-serif', lineHeight: 1.65, marginBottom: 16 }}>
              Runs Best Case, Base Case, and Worst Case scenarios simultaneously. Requires case facts entered on the Dashboard tab.
            </p>

            {!facts.trim() && (
              <div style={{ background: '#100a00', border: '1px solid #3a2808', borderRadius: 6, padding: '12px 16px', marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: '#9a7030', fontFamily: 'Inter, sans-serif' }}>Enter case facts on the Dashboard tab before running scenario analysis.</p>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
              {PRESET_SCENARIOS.map(sc => (
                <div key={sc.id} style={{ background: '#080810', border: '1px solid #141428', borderRadius: 6, padding: '12px 14px' }}>
                  <p style={{ fontSize: 11, color: T.gold, fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>{sc.label}</p>
                  <p style={{ fontSize: 12, color: '#505060', fontFamily: 'Inter, sans-serif', lineHeight: 1.55 }}>{sc.description}</p>
                </div>
              ))}
            </div>

            <button onClick={runScenarios} disabled={scenarioLoading || !facts.trim()} style={primaryBtnS(Boolean(facts.trim()) && !scenarioLoading)}>
              {scenarioLoading ? <><Spinner /> Running 3 Scenarios…</> : '◈ Run Scenario Analysis'}
            </button>
            {scenarioError && <ErrorBlock message={scenarioError} />}
          </div>

          {scenarioResults.length > 0 && (
            <div style={{ animation: 'fadeUp .3s ease' }}>
              {/* Verdict cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                {scenarioResults.map(sc => {
                  const v  = VERDICT_CONFIG[sc.verdict] || VERDICT_CONFIG.NEGOTIATE;
                  const ov = overallScore(sc.scores);
                  return (
                    <div key={sc.id} style={{ background: '#080810', border: `1px solid ${v.color}33`, borderRadius: 8, padding: '16px', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 8 }}>{sc.label}</p>
                      <div style={{ display: 'inline-block', background: `${v.color}18`, border: `1px solid ${v.color}55`, borderRadius: 3, padding: '4px 14px', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: v.color, fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '.14em' }}>{v.label}</span>
                      </div>
                      <p style={{ fontSize: 36, color: scoreColor(ov), fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, lineHeight: 1, marginBottom: 8 }}>{ov}</p>
                      <p style={{ fontSize: 11, color: '#5a5a72', fontFamily: 'Inter, sans-serif', lineHeight: 1.55 }}>{sc.recommendation}</p>
                    </div>
                  );
                })}
              </div>

              {/* Comparison table */}
              <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 80px)', gap: 0 }}>
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid #181828' }}>
                    <p style={{ fontSize: 9, color: '#3a3a52', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Dimension</p>
                  </div>
                  {scenarioResults.map(sc => (
                    <div key={sc.id} style={{ padding: '10px 0', borderBottom: '1px solid #181828', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{sc.label}</p>
                    </div>
                  ))}
                  {DIMENSIONS.map((dim, i) => (
                    <React.Fragment key={dim.id}>
                      <div style={{ padding: '10px 16px', borderBottom: i < DIMENSIONS.length - 1 ? '1px solid #0e0e1e' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, opacity: .6 }}>{dim.icon}</span>
                        <p style={{ fontSize: 11, color: '#8a8a9a', fontFamily: 'Inter, sans-serif' }}>{dim.label}</p>
                        {dim.invert && <span style={{ fontSize: 8, color: '#3a3a52', fontFamily: 'Inter, sans-serif' }}>↑risk</span>}
                      </div>
                      {scenarioResults.map(sc => (
                        <div key={sc.id} style={{ padding: '10px 0', borderBottom: i < DIMENSIONS.length - 1 ? '1px solid #0e0e1e' : 'none', textAlign: 'center' }}>
                          <span style={{ fontSize: 18, color: scoreColor(sc.scores[dim.id], dim.invert), fontFamily: "'Cormorant Garamond', serif", fontWeight: 300 }}>
                            {sc.scores[dim.id]}
                          </span>
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════ REGISTER ═══════════════════════════ */}
      {activeTab === 'register' && (
        <div>
          <div style={cardS}>
            <p style={{ fontSize: 18, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, marginBottom: 6 }}>Litigation Risk Register</p>
            <p style={{ fontSize: 13, color: '#505060', fontFamily: 'Inter, sans-serif', lineHeight: 1.65, marginBottom: 16 }}>
              Generates a formal risk register with Risk IDs, Likelihood, Impact, Ratings, and Mitigation Actions — grouped by category. Integrates existing risk scores if available.
            </p>
            <button onClick={generateRegister} disabled={registerLoading || (!facts.trim() && !result)} style={primaryBtnS(Boolean((facts.trim() || result) && !registerLoading))}>
              {registerLoading ? <><Spinner /> Generating Register…</> : '§ Generate Risk Register'}
            </button>
            {registerError && <ErrorBlock message={registerError} />}
          </div>

          {registerContent && (
            <div style={{ background: '#060610', border: '1px solid #1a2a1a', borderRadius: 8, padding: '20px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: '#508050', fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Litigation Risk Register</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { try { navigator.clipboard.writeText(registerContent); } catch { /* ignore */ } }}
                    style={{ background: '#0a0a18', border: '1px solid #1a1a28', color: '#808090', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                  >Copy</button>
                  <button
                    onClick={() => { setRegisterContent(''); saveBlindSpot(caseId, 'risk', { facts, stage, result, register: '' }); }}
                    style={{ background: 'none', border: '1px solid #2a1818', color: '#604040', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                  >Clear</button>
                </div>
              </div>
              <div style={{ fontSize: 14, color: '#cac6ba', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
                {registerContent}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
