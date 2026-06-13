/**
 * AFS Advocates — Trial Intelligence Engine
 * Phase 2 — Full implementation
 *
 * 5-step pipeline:
 *   1. Raw Facts intake
 *   2. AI extraction (timeline, established facts, disputes, legal issues, gaps, risks)
 *   3. Dynamic follow-up questions
 *   4. Evidence matrix
 *   5. Intelligence Package generation
 *
 * All state persisted to case via onSave(). Fully role-aware.
 */

import React, { useState } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { Spinner, ErrorBlock, RoleBadge, Md } from '@/components/common/ui';
import { copyToClipboard } from '@/utils';

// ── Step definitions ───────────────────────────────────────────────────────────

const TIE_STEPS = [
  { id: 1, label: 'Raw Facts' },
  { id: 2, label: 'Extraction' },
  { id: 3, label: 'Follow-Up' },
  { id: 4, label: 'Evidence Map' },
  { id: 5, label: 'Package' },
];

// ── Severity colours ──────────────────────────────────────────────────────────

const RISK_SEV_C: Record<string, { bg: string; bdr: string; col: string }> = {
  HIGH:   { bg: '#1a0808', bdr: T.bdr, col: '#c05050' },
  MEDIUM: { bg: '#1a1000', bdr: '#3a2800', col: '#c08030' },
  LOW:    { bg: '#071810', bdr: T.bdr, col: '#40b068' },
};

const PRIORITY_C: Record<string, { bg: string; bdr: string; col: string }> = {
  CRITICAL: { bg: '#1a0808', bdr: T.bdr, col: '#c05050' },
  HIGH:     { bg: '#1a0e00', bdr: '#3a2200', col: '#b07030' },
  MEDIUM:   { bg: '#1a1400', bdr: '#3a3000', col: '#b09040' },
  LOW:      { bg: '#071810', bdr: T.bdr, col: '#40b068' },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractionResult {
  timeline:          Array<{ date: string; event: string; significance?: string }>;
  established_facts: string[];
  disputed_areas:    string[];
  legal_issues:      string[];
  evidence_mentioned: string[];
  gaps_identified:   string[];
  initial_risks:     Array<{ risk: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

interface EvidenceMapItem {
  issue:              string;
  evidence_needed:    string[];
  evidence_available: string[];
  evidence_missing:   string[];
  priority:           'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  notes?:             string;
}

interface TIEData {
  stage:       number;
  rawFacts:    string;
  extraction:  ExtractionResult | null;
  followUpQs:  Array<{ id: string; question: string; purpose?: string }>;
  followUpAs:  Record<string, string>;
  evidenceM:   EvidenceMapItem[] | null;
  intPkg:      string;
}

interface Props {
  activeCase: Case;
  onSave:     (data: TIEData) => void;
}

// ── Shared local styles ───────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const lbS: React.CSSProperties = {
  fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function IntelligenceEngine({ activeCase, onSave }: Props) {
  const saved = (activeCase.intelligence_data || {}) as unknown as Partial<TIEData>;

  const [stage,      setStage]      = useState<number>(saved.stage ?? 1);
  const [rawFacts,   setRawFacts]   = useState<string>(saved.rawFacts ?? '');
  const [extraction, setExtraction] = useState<ExtractionResult | null>(saved.extraction ?? null);
  const [followUpQs, setFollowUpQs] = useState<TIEData['followUpQs']>(saved.followUpQs ?? []);
  const [followUpAs, setFollowUpAs] = useState<Record<string, string>>(saved.followUpAs ?? {});
  const [evidenceM,  setEvidenceM]  = useState<EvidenceMapItem[] | null>(saved.evidenceM ?? null);
  const [intPkg,     setIntPkg]     = useState<string>(saved.intPkg ?? '');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [copied,     setCopied]     = useState(false);

  const role = activeCase.counsel_role
    ? `${activeCase.counsel_role} (${activeCase.matter_track || 'civil'} matter)`
    : activeCase.role || 'Claimant';

  const caseCtx = `Case: ${activeCase.caseName}
Court: ${activeCase.court || 'Not specified'}
Suit No: ${activeCase.suitNo || 'Not specified'}
Track: ${activeCase.matter_track || 'civil'}
Counsel Role: ${activeCase.counsel_role || activeCase.role || 'Claimant'}
Claimants: ${activeCase.claimants.map(c => c.name).filter(Boolean).join(', ') || 'Not named'}
Defendants: ${activeCase.defendants.map(d => d.name).filter(Boolean).join(', ') || 'Not named'}`;

  function persist(updates: Partial<TIEData>) {
    const data: TIEData = {
      stage, rawFacts, extraction, followUpQs, followUpAs, evidenceM, intPkg,
      ...updates,
    };
    onSave(data);
  }

  function advance(newStage: number, updates: Partial<TIEData> = {}) {
    setStage(newStage);
    persist({ stage: newStage, ...updates });
  }

  function goBack(n: number) { setStage(n); setError(''); }

  // ── Step 1 → 2: Extract intelligence ──────────────────────────────────────
  // ── Step 1 → 2: Extract intelligence ──────────────────────────────────────
  async function runExtraction() {
    if (rawFacts.trim().length < 50) {
      setError('Please provide a fuller account of the facts (at least 50 characters).');
      return;
    }
    setLoading(true); setError('');
    try {
      const raw = await callClaude({
        system: `You are a trial intelligence extraction engine for Nigerian litigation.
Extract structured intelligence from the raw case facts provided by the user.
Role-aware: the lawyer acts for the ${role}.
Case context: ${caseCtx}

Output ONLY valid JSON — no markdown fences, no preamble, no explanation. Exactly this structure:
{
  "timeline": [{"date":"...","event":"...","significance":"..."}],
  "established_facts": ["..."],
  "disputed_areas": ["..."],
  "legal_issues": ["..."],
  "evidence_mentioned": ["..."],
  "gaps_identified": ["..."],
  "initial_risks": [{"risk":"...","severity":"HIGH|MEDIUM|LOW"}]
}

Rules:
- Every string value must be properly escaped. Never use unescaped double quotes inside string values.
- Use single quotes or rephrase if quoting speech — never raw double quotes inside JSON strings.
- Output ONLY the JSON object. Nothing before it, nothing after it.`,
        userMsg: `RAW FACTS / CLIENT NARRATION:\n\n${rawFacts}`,
        maxTokens: 50000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let ext: ExtractionResult;
      try {
        ext = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        ext = JSON.parse(repaired);
      }

      setExtraction(ext);
      advance(2, { extraction: ext, rawFacts });
    } catch (e) {
      setError('Extraction failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 2 → 3: Generate follow-up questions ──────────────────────────────
  async function generateFollowUp() {
    setLoading(true); setError('');
    try {
      const raw = await callClaude({
        system: `You are a trial intelligence engine for Nigerian litigation. Generate precise gap-filling follow-up questions. Role: ${role}. Output ONLY valid JSON — no markdown, no preamble. Exactly this structure: {"questions":[{"id":"q1","question":"...","purpose":"..."}]}`,
        userMsg: `${caseCtx}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nGenerate 6 targeted follow-up questions addressing the most critical gaps.`,
        maxTokens: 50000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: { questions: TIEData['followUpQs'] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const qs: TIEData['followUpQs'] = parsed.questions || [];
      const initAs: Record<string, string> = {};
      qs.forEach(q => { initAs[q.id] = ''; });
      setFollowUpQs(qs); setFollowUpAs(initAs);
      advance(3, { followUpQs: qs, followUpAs: initAs });
    } catch (e) {
      setError('Question generation failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 3 → 4: Build evidence matrix ─────────────────────────────────────
  async function buildEvidenceMatrix() {
    const answered = followUpQs.filter(q => followUpAs[q.id]?.trim()).length;
    if (answered < Math.min(3, followUpQs.length)) {
      setError('Please answer at least 3 questions before proceeding.');
      return;
    }
    setLoading(true); setError('');
    const qaText = followUpQs
      .map(q => `Q: ${q.question}\nA: ${followUpAs[q.id] || '(Not answered)'}`)
      .join('\n\n');
    try {
      const raw = await callClaude({
        system: `You are a trial evidence strategist for Nigerian litigation. Map required evidence to facts and legal issues. Role of client: ${role}. Output ONLY valid JSON — no markdown, no preamble. Exactly this structure: {"evidence_map":[{"issue":"...","evidence_needed":["..."],"evidence_available":["..."],"evidence_missing":["..."],"priority":"CRITICAL|HIGH|MEDIUM|LOW","notes":"..."}]}`,
        userMsg: `${caseCtx}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nFOLLOW-UP ANSWERS:\n${qaText}\n\nBuild the evidence matrix.`,
        maxTokens: 50000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: { evidence_map: EvidenceMapItem[] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const em: EvidenceMapItem[] = parsed.evidence_map || [];
      setEvidenceM(em);
      advance(4, { evidenceM: em });
    } catch (e) {
      setError('Evidence mapping failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 4 → 5: Generate Intelligence Package ─────────────────────────────
  async function generatePackage() {
    setLoading(true); setError('');
    const qaText = followUpQs
      .map(q => `Q: ${q.question}\nA: ${followUpAs[q.id] || '(Not answered)'}`)
      .join('\n\n');
    const claimsHead =
      role === 'Claimant'  ? 'CLAIMS & RELIEF' :
      role === 'Defendant' ? 'DEFENCE POSTURE & COUNTERCLAIMS' :
      'CLAIMS, DEFENCES & STRATEGY';
    try {
      const pkg = await callClaude({
        system: `You are a Senior Advocate at the Nigerian Bar with 30 years of trial experience. You produce trial intelligence packages of exceptional depth and precision. Role-aware, outcome-focused, and honest. Your analysis changes how lawyers approach cases.`,
        userMsg: `${caseCtx}\n\nRAW FACTS:\n${rawFacts}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nFOLLOW-UP ANSWERS:\n${qaText}\n\nEVIDENCE MATRIX:\n${JSON.stringify(evidenceM, null, 2)}\n\nGenerate the full Trial Intelligence Package. Format as structured markdown:\n\n# ESTABLISHED FACTS\n[Undisputed facts with basis]\n\n# DISPUTED FACTS\n[Contested facts and likely nature of dispute]\n\n# MISSING EVIDENCE\n[Critical gaps — what must be obtained and how]\n\n# LEGAL ISSUES\n[Each issue distilled — element by element where applicable]\n\n# ${claimsHead}\n[Role-specific: causes of action / grounds of defence, elements, burden of proof, what must be proved]\n\n# RISK REGISTER\n[Every material risk — severity HIGH/MEDIUM/LOW, impact, mitigation]\n\n# IMMEDIATE ACTION ITEMS\n[Specific, time-sensitive steps the lawyer must take NOW]\n\nWrite with the precision of a Senior Advocate who has analysed every document and seen every angle. Be direct, specific, and unflinchingly honest.`,
        maxTokens: 50000,
        skipLibrary: true,
      });
      setIntPkg(pkg);
      advance(5, { intPkg: pkg });
    } catch (e) {
      setError('Package generation failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  async function copyPackage() {
    await copyToClipboard(intPkg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function resetPipeline() {
    if (!window.confirm('Reset the Intelligence Engine? All pipeline data for this case will be cleared.')) return;
    setStage(1); setRawFacts(''); setExtraction(null); setFollowUpQs([]);
    setFollowUpAs({}); setEvidenceM(null); setIntPkg(''); setError('');
    onSave({ stage: 1, rawFacts: '', extraction: null, followUpQs: [], followUpAs: {}, evidenceM: null, intPkg: '' });
  }

  // ── Step progress bar ──────────────────────────────────────────────────────
  function TIESteps() {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        marginBottom: 28, padding: '14px 18px',
        background: '#ffffff', border: '1px solid #181828',
        borderRadius: 8, overflowX: 'auto',
      }}>
        {TIE_STEPS.map((s, i) => {
          const done   = stage > s.id;
          const active = stage === s.id;
          return (
            <React.Fragment key={s.id}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, minWidth: 68 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                  background: done ? '#1a3820' : active ? '#1a1500' : '#0d0d18',
                  border: `2px solid ${done ? '#2a6a40' : active ? T.text : T.bdr}`,
                  color: done ? '#40b068' : active ? T.text : T.bdr,
                  transition: 'all .3s', flexShrink: 0,
                }}>
                  {done ? '✓' : s.id}
                </div>
                <span style={{
                  fontSize: 8, color: done ? '#40b068' : active ? T.text : T.bdr,
                  fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em',
                  textTransform: 'uppercase', textAlign: 'center',
                  lineHeight: 1.25, maxWidth: 60,
                }}>
                  {s.label}
                </span>
              </div>
              {i < TIE_STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 1,
                  background: done ? '#2a6a40' : T.bdr,
                  minWidth: 6, transition: 'background .3s',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── Large spinner ──────────────────────────────────────────────────────────
  function BigSpinner({ label }: { label: string }) {
    return (
      <div style={{ textAlign: 'center', padding: '54px 24px' }}>
        <div style={{
          width: 32, height: 32, border: `2px solid ${T.bdr}`,
          borderTop: `2px solid ${T.text}`, borderRadius: '50%',
          margin: '0 auto 18px', animation: 'spin .9s linear infinite',
        }} />
        <p style={{ fontSize: 19, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
          {label}
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 1 — Raw Facts
  // ─────────────────────────────────────────────────────────────────────────
  function Stage1() {
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 1 of 5 · Raw Facts
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
            Enter the Complete Case Narrative
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            Do not filter or organise — give the raw client story. Include dates, parties, conversations, documents, and events in any order. The AI will extract the structure.
          </p>
        </div>

        <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #131320', flexWrap: 'wrap' }}>
            <RoleBadge role={role} />
            <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              {activeCase.caseName}
            </span>
            {activeCase.court && (
              <span style={{ fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif" }}>· {activeCase.court}</span>
            )}
          </div>
          <label style={lbS}>
            Complete Case Narrative / Raw Facts <span style={{ color: '#b06060' }}>*</span>
          </label>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.65 }}>
            Include: what happened, when, between whom, what documents exist, what was said, what was agreed, what went wrong, who holds what evidence.
          </p>
          <textarea
            value={rawFacts}
            onChange={e => setRawFacts(e.target.value)}
            rows={13}
            placeholder={
              'Tell the full story of this matter:\n\n• What happened and when?\n• Who did what, to whom?\n• What documents, contracts, or communications exist?\n• What is the other side likely to say?\n• What outcome does the client want?\n\nDo not organise — give it raw. The engine will extract the intelligence.'
            }
            style={{ ...iS, resize: 'vertical', lineHeight: 1.85, minHeight: 300, fontSize: 15 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: rawFacts.length < 50 ? '#804040' : T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {rawFacts.length} characters{rawFacts.length < 50 ? ' · minimum 50' : ''}
            </span>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
              More detail = sharper intelligence
            </span>
          </div>
        </div>

        <ErrorBlock message={error} />

        <button
          onClick={runExtraction}
          disabled={loading || rawFacts.trim().length < 50}
          style={{
            background: loading || rawFacts.trim().length < 50
              ? '#101018'
              : 'linear-gradient(135deg,#000000,#a07820)',
            color: loading || rawFacts.trim().length < 50 ? '#2a2a38' : '#05050c',
            border: 'none', borderRadius: 6, padding: '14px',
            fontSize: 17, fontFamily: "'Times New Roman', Times, serif",
            cursor: loading || rawFacts.trim().length < 50 ? 'not-allowed' : 'pointer',
            width: '100%', fontWeight: 600, letterSpacing: '.04em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {loading ? (
            <><Spinner size={14} /> Extracting Intelligence…</>
          ) : (
            'Extract Intelligence →'
          )}
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 2 — Extraction Results
  // ─────────────────────────────────────────────────────────────────────────
  function Stage2() {
    if (!extraction) return <BigSpinner label="Processing…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: '#40a868', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 2 of 5 · Extraction Complete
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>
            Intelligence Extracted
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Review the extracted intelligence. Proceed to answer targeted follow-up questions to deepen the picture.
          </p>
        </div>

        {/* Timeline */}
        {extraction.timeline?.length > 0 && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 14 }}>
              Case Timeline
            </p>
            {extraction.timeline.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 10, paddingBottom: 10, borderBottom: i < extraction.timeline.length - 1 ? '1px solid #131320' : 'none' }}>
                <div style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: T.text, marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, display: 'block', marginBottom: 2 }}>{t.date}</span>
                  <p style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: t.significance ? 3 : 0 }}>{t.event}</p>
                  {t.significance && (
                    <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, fontStyle: 'italic' }}>{t.significance}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Established facts + Disputed areas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {extraction.established_facts?.length > 0 && (
            <div style={{ background: '#071810', border: '1px solid #1a4028', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Established Facts</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.established_facts.map((f, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#40b068', fontSize: 8, top: 4 }}>●</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {extraction.disputed_areas?.length > 0 && (
            <div style={{ background: '#180808', border: '1px solid #401818', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Disputed Areas</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.disputed_areas.map((d, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 4 }}>●</span>{d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Legal issues + Gaps */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {extraction.legal_issues?.length > 0 && (
            <div style={{ background: '#0e0818', border: '1px solid #281840', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Legal Issues Identified</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.legal_issues.map((l, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: T.dim, fontSize: 8, top: 4 }}>●</span>{l}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {extraction.gaps_identified?.length > 0 && (
            <div style={{ background: '#1a1000', border: '1px solid #3a2800', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Gaps Identified</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.gaps_identified.map((g, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#c08030', fontSize: 9, top: 2 }}>⚠</span>{g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Risk flags */}
        {extraction.initial_risks?.length > 0 && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>Initial Risk Flags</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {extraction.initial_risks.map((r, i) => {
                const rc = RISK_SEV_C[r.severity] || RISK_SEV_C.MEDIUM;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ background: rc.bg, border: `1px solid ${rc.bdr}`, color: rc.col, fontSize: 8, padding: '2px 6px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
                      {r.severity}
                    </span>
                    <span style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>{r.risk}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <ErrorBlock message={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(1)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
            ← Edit Facts
          </button>
          <button
            onClick={generateFollowUp}
            disabled={loading}
            style={{ flex: 1, background: loading ? '#101018' : 'linear-gradient(135deg,#000000,#a07820)', color: loading ? '#2a2a38' : '#05050c', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {loading ? <><Spinner size={14} /> Generating Questions…</> : 'Proceed to Follow-Up →'}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 3 — Follow-Up Questions
  // ─────────────────────────────────────────────────────────────────────────
  function Stage3() {
    const answeredCount = followUpQs.filter(q => followUpAs[q.id]?.trim()).length;
    const canProceed    = answeredCount >= Math.min(3, followUpQs.length);
    if (loading) return <BigSpinner label="Generating targeted questions…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 3 of 5 · Dynamic Follow-Up
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>Targeted Questions</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Answer these questions to fill the critical intelligence gaps. Answer at least {Math.min(3, followUpQs.length)} to proceed.
          </p>
        </div>

        {followUpQs.map((q, i) => (
          <div key={q.id} style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#1a1500', border: `1px solid ${T.text}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>{i + 1}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: q.purpose ? 4 : 0 }}>{q.question}</p>
                {q.purpose && (
                  <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, fontStyle: 'italic' }}>{q.purpose}</p>
                )}
              </div>
              {followUpAs[q.id]?.trim() && (
                <span style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', background: '#071810', border: '1px solid #1a4028', padding: '2px 6px', borderRadius: 2, flexShrink: 0, marginTop: 3 }}>✓</span>
              )}
            </div>
            <textarea
              value={followUpAs[q.id] || ''}
              onChange={e => setFollowUpAs(prev => ({ ...prev, [q.id]: e.target.value }))}
              rows={3}
              placeholder="Your answer…"
              style={{ ...iS, resize: 'vertical', lineHeight: 1.75, minHeight: 68, fontSize: 14 }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{answeredCount} of {followUpQs.length} answered</span>
          {canProceed && (
            <span style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', background: '#071810', border: '1px solid #1a4028', padding: '2px 8px', borderRadius: 2 }}>
              Ready to proceed
            </span>
          )}
        </div>

        <ErrorBlock message={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(2)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
            ← Back
          </button>
          <button
            onClick={buildEvidenceMatrix}
            disabled={!canProceed}
            style={{ flex: 1, background: canProceed ? 'linear-gradient(135deg,#000000,#a07820)' : '#101018', color: canProceed ? '#05050c' : '#2a2a38', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: canProceed ? 'pointer' : 'not-allowed', fontWeight: 600, letterSpacing: '.04em' }}>
            Build Evidence Map →
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 4 — Evidence Matrix
  // ─────────────────────────────────────────────────────────────────────────
  function Stage4() {
    if (loading) return <BigSpinner label="Mapping evidence requirements…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 4 of 5 · Evidence Map
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>Evidence Requirements</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Required, available, and missing evidence — mapped to each fact and legal issue.
          </p>
        </div>

        {(evidenceM || []).map((item, i) => {
          const pc = PRIORITY_C[item.priority] || PRIORITY_C.MEDIUM;
          return (
            <div key={i} style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                <span style={{ background: pc.bg, border: `1px solid ${pc.bdr}`, color: pc.col, fontSize: 8, padding: '3px 7px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em', fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
                  {item.priority}
                </span>
                <p style={{ fontSize: 15, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, lineHeight: 1.45, flex: 1 }}>{item.issue}</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Required</p>
                  {(item.evidence_needed || []).map((e, j) => (
                    <p key={j} style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 4, paddingLeft: 10, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: T.mute, fontSize: 8, top: 3 }}>·</span>{e}
                    </p>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Available</p>
                  {(item.evidence_available || []).length > 0
                    ? (item.evidence_available || []).map((e, j) => (
                        <p key={j} style={{ fontSize: 12, color: '#60c088', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 4, paddingLeft: 10, position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 0, color: '#40b068', fontSize: 8, top: 3 }}>✓</span>{e}
                        </p>
                      ))
                    : <p style={{ fontSize: 11, color: T.bdr, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>None identified</p>
                  }
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Missing</p>
                  {(item.evidence_missing || []).length > 0
                    ? (item.evidence_missing || []).map((e, j) => (
                        <p key={j} style={{ fontSize: 12, color: '#d07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 4, paddingLeft: 10, position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 3 }}>!</span>{e}
                        </p>
                      ))
                    : <p style={{ fontSize: 11, color: T.bdr, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>None</p>
                  }
                </div>
              </div>
              {item.notes && (
                <p style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid #131320', fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, fontStyle: 'italic' }}>{item.notes}</p>
              )}
            </div>
          );
        })}

        <ErrorBlock message={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(3)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
            ← Back
          </button>
          <button
            onClick={generatePackage}
            style={{ flex: 1, background: 'linear-gradient(135deg,#000000,#a07820)', color: '#ffffff', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', fontWeight: 600, letterSpacing: '.04em' }}>
            Generate Intelligence Package →
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 5 — Intelligence Package
  // ─────────────────────────────────────────────────────────────────────────
  function Stage5() {
    if (loading) return (
      <div style={{ textAlign: 'center', padding: '68px 24px' }}>
        <div style={{ width: 38, height: 38, border: `3px solid ${T.bdr}`, borderTop: `3px solid ${T.text}`, borderRadius: '50%', margin: '0 auto 20px', animation: 'spin .9s linear infinite' }} />
        <p style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10 }}>Assembling Intelligence Package…</p>
        <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em' }}>TRIAL INTELLIGENCE ENGINE · AFS ADVOCATES</p>
      </div>
    );
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: '#40a868', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
              Step 5 of 5 · Complete · Saved to Case
            </p>
            <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>Intelligence Package</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={copyPackage}
              style={{ background: 'transparent', border: '1px solid #2a2208', color: copied ? '#40b068' : T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', transition: 'color .2s' }}>
              {copied ? '✓ Copied' : 'Copy All'}
            </button>
            <button onClick={() => goBack(4)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              ← Evidence Map
            </button>
            <button
              onClick={resetPipeline}
              style={{ background: 'transparent', border: '1px solid #3a1818', color: '#804040', borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
              ↺ Reset Pipeline
            </button>
          </div>
        </div>

        {intPkg && (
          <div style={{ background: T.card, border: `1px solid ${T.text}33`, borderRadius: 10, padding: '26px 28px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #131320', flexWrap: 'wrap' }}>
              <RoleBadge role={role} />
              <span style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>{activeCase.caseName}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif" }}>
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <Md text={intPkg} />
          </div>
        )}

        <ErrorBlock message={error} />
        <p style={{ fontSize: 11, color: '#1e1e2a', textAlign: 'center', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8, marginTop: 16 }}>
          Trial Intelligence Engine · Intelligence Package saved to case · All analysis is advisory — the lawyer decides.
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 9, color: T.mute, letterSpacing: '.18em', textTransform: 'uppercase', fontFamily: "'Times New Roman', Times, serif", marginBottom: 5 }}>
            AFS Advocates · Trial Intelligence Engine · Step 4
          </p>
          <h1 style={{ fontSize: 26, color: '#111111', fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.02em' }}>
            Intelligence Engine
          </h1>
        </div>
        {(stage > 1 || rawFacts.trim()) && (
          <button
            onClick={resetPipeline}
            style={{ background: 'transparent', border: '1px solid #2a1818', color: '#604040', borderRadius: 4, padding: '6px 13px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', flexShrink: 0 }}>
            ↺ Reset Pipeline
          </button>
        )}
      </div>

      <TIESteps />

      {stage === 1 && <Stage1 />}
      {stage === 2 && <Stage2 />}
      {stage === 3 && <Stage3 />}
      {stage === 4 && <Stage4 />}
      {stage === 5 && <Stage5 />}
    </div>
  );
}
