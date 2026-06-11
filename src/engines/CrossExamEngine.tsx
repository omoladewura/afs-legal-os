/**
 * AFS Advocates — CrossExaminationEngine
 *
 * Five modules:
 *   1. Witness Profiler        — build a cross-exam dossier per opposing witness
 *   2. Contradiction Mapper    — log & exploit statement contradictions
 *   3. Question Sequencer      — generate phased question sets
 *   4. Impeachment Arsenal     — Evidence Act 2011 admissibility + deployment
 *   5. Live Courtroom Mode     — real-time AI advice as witness answers are typed
 *
 * Storage: blind_spots table via loadBlindSpot / saveBlindSpot with cx_ prefix.
 * API:     callClaude() from @/services/api
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';

// ── Design tokens (CX-specific) ───────────────────────────────────────────────

const CX_ACCENT = '#d04040';
const CX_LIGHT  = '#e07070';
const CX_DIM    = '#8a3030';

// ── Storage hook ──────────────────────────────────────────────────────────────

function useCxStorage<T>(caseId: string, module: string, fallback: T) {
  const [data, setDataState] = useState<T>(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadBlindSpot<T>(caseId, `cx_${module}`, fallback).then(d => {
      setDataState(d);
      setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, module]);

  const setData = useCallback((updater: T | ((prev: T) => T)) => {
    setDataState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      saveBlindSpot(caseId, `cx_${module}`, next);
      return next;
    });
  }, [caseId, module]);

  return { data, setData, ready };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WitnessRecord {
  id: string;
  name: string;
  role: string;
  facts: string;
  statement: string;
  vulnerabilities: string;
  documents: string;
  demeanour: string;
  motivation: string;
  status: string;
  objective: string;
}

interface ContradictionRecord {
  id: string;
  witness: string;
  stmt1: string;
  stmt1Src: string;
  stmt2: string;
  stmt2Src: string;
  impact: string;
  notes: string;
}

interface ImpeachmentItem {
  id: string;
  witness: string;
  type: string;
  weapon: string;
  impact: string;
  addedAt: string;
}

interface LiveAnswer {
  id: string;
  text: string;
  time: string;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function CXSection({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  const col = accent || CX_ACCENT;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10, color: col, fontFamily: 'Inter,sans-serif', letterSpacing: '.14em', textTransform: 'uppercase' as const, fontWeight: 700, marginBottom: 12, paddingBottom: 7, borderBottom: `1px solid ${col}22` }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function CXInput({ label, value, onChange, placeholder, multiline, rows = 3 }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number;
}) {
  const s: React.CSSProperties = { width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none', boxSizing: 'border-box' };
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, display: 'block', marginBottom: 5 }}>{label}</label>}
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{ ...s, resize: 'vertical', lineHeight: 1.75 }} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={s} />}
    </div>
  );
}

function CXBtn({ onClick, disabled, children, variant = 'primary', small }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'primary' | 'ghost' | 'danger' | 'gold'; small?: boolean;
}) {
  const base: React.CSSProperties = { border: 'none', borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, letterSpacing: '.04em', transition: 'opacity .15s', opacity: disabled ? 0.4 : 1 };
  const vars: Record<string, React.CSSProperties> = {
    primary: { background: `linear-gradient(135deg,${CX_ACCENT},#a02020)`, color: '#fff8f8', padding: small ? '7px 18px' : '12px 24px', fontSize: small ? 13 : 15 },
    ghost:   { background: '#0d0d1c', border: '1px solid #1e1e2e', color: T.mute, padding: small ? '6px 14px' : '10px 20px', fontSize: small ? 12 : 14 },
    danger:  { background: '#1a0808', border: '1px solid #3a1010', color: '#c05050', padding: small ? '6px 14px' : '10px 20px', fontSize: small ? 12 : 14 },
    gold:    { background: 'linear-gradient(135deg,#c4a030,#a07820)', color: '#05050c', padding: small ? '7px 18px' : '12px 24px', fontSize: small ? 13 : 15 },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...vars[variant] }}>{children}</button>;
}

function CXAIBlock({ loading, result, error }: { loading: boolean; result: string; error: string }) {
  if (loading) return (
    <div style={{ background: '#0d0608', border: `1px solid ${CX_ACCENT}33`, borderRadius: 6, padding: '24px', textAlign: 'center', marginTop: 14 }}>
      <div style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #3a1010', borderTop: `2px solid ${CX_ACCENT}`, borderRadius: '50%', animation: 'spin .8s linear infinite', marginBottom: 10 }} />
      <p style={{ fontSize: 12, color: CX_DIM, fontFamily: 'Inter,sans-serif', letterSpacing: '.08em', margin: 0 }}>Preparing cross-examination strategy…</p>
    </div>
  );
  if (error) return <div style={{ background: '#1a0808', border: '1px solid #3a1010', borderRadius: 5, padding: '12px 16px', color: '#c05050', fontFamily: 'Inter,sans-serif', fontSize: 13, marginTop: 12 }}>{error}</div>;
  if (!result) return null;
  return (
    <div style={{ background: '#0d0608', border: `1px solid ${CX_ACCENT}33`, borderRadius: 6, padding: '18px 22px', marginTop: 14 }}>
      <div style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', letterSpacing: '.16em', textTransform: 'uppercase' as const, fontWeight: 700, marginBottom: 10 }}>Cross-Examination Intelligence</div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontFamily: "'Cormorant Garamond',serif", fontSize: 15, color: '#cac6ba' }}>{result}</div>
    </div>
  );
}

// ── Role-aware context helpers ────────────────────────────────────────────────

function roleSystemPrompt(c: Case): string {
  const track = c.matter_track || 'civil';
  const role  = c.counsel_role  || c.role || 'claimant_side';

  const MAP: Record<string, string> = {
    claimant_side:  'You are a Nigerian civil litigation cross-examination specialist acting for the CLAIMANT. Your goal is to destroy opposing witnesses, extract admissions that advance the claimant\'s claim, and undermine evidence that resists it. Every strategy, question sequence, and impeachment weapon must advance the claimant\'s case.',
    defendant_side: 'You are a Nigerian civil litigation cross-examination specialist acting for the DEFENDANT. Your goal is to neutralise the claimant\'s witnesses, expose weaknesses in the claimant\'s evidence, and extract concessions that support the defence and counterclaim. Every strategy must resist and limit the claim.',
    prosecution:    'You are a Nigerian criminal litigation cross-examination specialist acting for the PROSECUTION. Your goal is to cross-examine defence witnesses to destroy their credibility, undermine alibis and exculpatory accounts, and reinforce the prosecution\'s case on each count. Apply ACJA 2015 and the Evidence Act 2011.',
    defence:        'You are a Nigerian criminal litigation cross-examination specialist acting for the DEFENCE. Your goal is to cross-examine prosecution witnesses to undermine the prosecution\'s case on every count, expose inconsistencies, challenge admissibility, and build the foundation for a no-case submission or acquittal. Apply ACJA 2015 and the Evidence Act 2011. Protect the accused at every turn.',
  };

  const base = MAP[role] ?? MAP['claimant_side'];
  return `${base}\n\nMATTER TRACK: ${track.toUpperCase()} | COUNSEL ROLE: ${role.toUpperCase().replace(/_/g, ' ')}\nApply Nigerian court procedure and the Evidence Act 2011 throughout. Be surgical, tactical, and direct — no academic commentary.`;
}

function caseHeader(c: Case): string {
  const track = c.matter_track || 'civil';
  const role  = c.counsel_role  || c.role || 'claimant_side';
  return `CASE: ${c.caseName || ''} | COURT: ${c.court || 'Not specified'}
MATTER TRACK: ${track.toUpperCase()} | COUNSEL ROLE: ${role.toUpperCase().replace(/_/g, ' ')}
CLAIMANTS: ${(c.claimants || []).map(p => p.name).filter(Boolean).join(', ') || 'Not specified'}
DEFENDANTS: ${(c.defendants || []).map(p => p.name).filter(Boolean).join(', ') || 'Not specified'}`;
}

// ── MODULE 1: WITNESS PROFILER ────────────────────────────────────────────────

function CXWitnessProfiler({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const { data: witnesses, setData: setWitnesses } = useCxStorage<WitnessRecord[]>(caseId, 'witnesses', []);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<WitnessRecord | null>(null);
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  function addWitness() {
    const w: WitnessRecord = { id: uid(), name: '', role: '', facts: '', statement: '', vulnerabilities: '', documents: '', demeanour: '', motivation: '', status: 'Pending', objective: '' };
    setWitnesses(p => [...p, w]);
    setForm(w);
    setSelected(w.id);
    setAiRes('');
  }

  function updateW(field: keyof WitnessRecord, val: string) {
    if (!form) return;
    const updated = { ...form, [field]: val };
    setForm(updated);
    setWitnesses(p => p.map(w => w.id === form.id ? updated : w));
  }

  function deleteW(id: string) {
    setWitnesses(p => p.filter(w => w.id !== id));
    setSelected(null);
    setForm(null);
  }

  async function generateProfile() {
    if (!form) return;
    setLoading(true); setErr(''); setAiRes('');
    try {
      const result = await callClaude({
        system: roleSystemPrompt(activeCase),
        userMsg: `${caseHeader(activeCase)}

WITNESS: ${form.name || 'Unnamed'}
WITNESS ROLE: ${form.role || 'Not specified'}
WHAT WITNESS KNOWS / EXPECTED TO TESTIFY: ${form.facts || 'Not provided'}
WITNESS STATEMENT / AFFIDAVIT: ${form.statement || 'Not provided'}
KNOWN VULNERABILITIES: ${form.vulnerabilities || 'None identified'}
DOCUMENTS TO CONFRONT WITNESS WITH: ${form.documents || 'None specified'}
WITNESS DEMEANOUR / CHARACTER: ${form.demeanour || 'Unknown'}
WITNESS MOTIVATION / INTEREST: ${form.motivation || 'Unknown'}
OUR OBJECTIVE IN CROSS-EXAMINATION: ${form.objective || 'Not specified'}

Provide a comprehensive cross-examination profile:

## 1. WITNESS THREAT ASSESSMENT
Assess how dangerous this witness is. Rate: HIGH / MEDIUM / LOW threat. Explain specifically.

## 2. PRIMARY CROSS-EXAMINATION OBJECTIVES
What must we achieve? List 3-5 concrete objectives ranked by priority.

## 3. CREDIBILITY ATTACK STRATEGY
Every credibility vulnerability and how to exploit each. Prior inconsistent statements? Bias, interest, motive to fabricate?

## 4. IMPEACHMENT SEQUENCE — THE FIVE BREAKING QUESTIONS
The five most dangerous questions. Give exact question text and what each achieves.

## 5. DOCUMENTS TO CONFRONT WITNESS WITH
Which documents, in what order, and what response to extract.

## 6. WHAT NOT TO DO
Biggest mistakes counsel can make. What traps has this witness set?

## 7. THE EXTRACTION TARGET
The single most important admission we must extract and how to engineer it.

Be specific, tactical, and assume Nigerian litigation procedure throughout.`,
        maxTokens: 1800,
      });
      setAiRes(result);
    } catch (e) {
      setErr('Error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  const STATUSES = ['Pending', 'In Preparation', 'Ready', 'Cross-Examined', 'Withdrawn'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <CXSection title="Opposing Witnesses">
          {witnesses.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7 }}>No witnesses profiled yet. Add the witnesses you must cross-examine.</p>}
          {witnesses.map(w => (
            <div key={w.id} onClick={() => { setSelected(w.id); setForm({ ...w }); setAiRes(''); }}
              style={{ background: selected === w.id ? '#150808' : '#070710', border: `1px solid ${selected === w.id ? CX_ACCENT : '#111120'}`, borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer', transition: 'border-color .15s' }}>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Cormorant Garamond',serif", fontWeight: 500, marginBottom: 2 }}>{w.name || 'Unnamed Witness'}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.05em', color: CX_DIM, textTransform: 'uppercase' as const }}>{w.status}</span>
                {w.role && <span style={{ fontSize: 10, color: '#303040', fontFamily: 'Inter,sans-serif' }}>· {w.role.slice(0, 20)}{w.role.length > 20 ? '…' : ''}</span>}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}><CXBtn onClick={addWitness} small variant="ghost">+ Add Witness</CXBtn></div>
        </CXSection>
      </div>

      <div>
        {!form ? (
          <div style={{ textAlign: 'center', padding: '70px 24px', color: T.mute, fontFamily: 'Inter,sans-serif', fontSize: 13 }}>
            <div style={{ fontSize: 36, opacity: .06, marginBottom: 14 }}>⚔</div>
            Select or add a witness to build their cross-examination profile.
          </div>
        ) : (
          <div>
            <CXSection title={`Cross-Examination Profile — ${form.name || 'Unnamed Witness'}`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <CXInput label="Full Name" value={form.name} onChange={v => updateW('name', v)} placeholder="Witness full name" />
                <div>
                  <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, display: 'block', marginBottom: 5 }}>Status</label>
                  <select value={form.status} onChange={e => updateW('status', e.target.value)} style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <CXInput label="Role / Position in Case" value={form.role} onChange={v => updateW('role', v)} placeholder="e.g. PW1 — Eye-witness to the accident; expert witness on land survey" />
              <CXInput label="What This Witness Is Expected to Testify" value={form.facts} onChange={v => updateW('facts', v)} placeholder="Summarise their expected evidence in chief. What will they say? What facts do they establish for the other side?" multiline rows={4} />
              <CXInput label="Witness Statement or Affidavit (paste text)" value={form.statement} onChange={v => updateW('statement', v)} placeholder="Paste or summarise the witness statement or affidavit — the AI will identify internal contradictions and vulnerabilities." multiline rows={5} />
              <CXInput label="Known Vulnerabilities & Credibility Weaknesses" value={form.vulnerabilities} onChange={v => updateW('vulnerabilities', v)} placeholder="Prior inconsistent statements, criminal record, relationship to party, financial interest, prior contradictory positions in other proceedings…" multiline rows={3} />
              <CXInput label="Documents to Confront Witness With" value={form.documents} onChange={v => updateW('documents', v)} placeholder="Documents that contradict or undermine this witness — receipts, correspondence, earlier statements, previous court filings…" multiline rows={3} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <CXInput label="Witness Demeanour / Character" value={form.demeanour} onChange={v => updateW('demeanour', v)} placeholder="Confident, evasive, aggressive, nervous, rehearsed…" />
                <CXInput label="Witness Motivation / Interest" value={form.motivation} onChange={v => updateW('motivation', v)} placeholder="Financial interest, relationship, revenge, fear of liability…" />
              </div>
              <CXInput label="Our Primary Objective in This Cross" value={form.objective} onChange={v => updateW('objective', v)} placeholder="What must we achieve? Destroy credibility? Extract admission of X? Establish that they did not witness Y?" />
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <CXBtn onClick={generateProfile} disabled={loading}>⚔ Generate Cross-Examination Strategy</CXBtn>
                <CXBtn onClick={() => deleteW(form.id)} variant="danger" small>Delete Witness</CXBtn>
              </div>
            </CXSection>
            <CXAIBlock loading={loading} result={aiRes} error={err} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── MODULE 2: CONTRADICTION MAPPER ────────────────────────────────────────────

function CXContradictionMapper({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const { data: maps, setData: setMaps } = useCxStorage<ContradictionRecord[]>(caseId, 'contradictions', []);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<ContradictionRecord | null>(null);
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  function addMap() {
    const m: ContradictionRecord = { id: uid(), witness: '', stmt1: '', stmt1Src: '', stmt2: '', stmt2Src: '', impact: '', notes: '' };
    setMaps(p => [...p, m]);
    setForm(m);
    setSel(m.id);
    setAiRes('');
  }

  function updateM(field: keyof ContradictionRecord, val: string) {
    if (!form) return;
    const updated = { ...form, [field]: val };
    setForm(updated);
    setMaps(p => p.map(m => m.id === form.id ? updated : m));
  }

  function deleteM(id: string) {
    setMaps(p => p.filter(m => m.id !== id));
    setSel(null);
    setForm(null);
  }

  async function analyseContradiction() {
    if (!form) return;
    setLoading(true); setErr(''); setAiRes('');
    try {
      const result = await callClaude({
        userMsg: `${caseHeader(activeCase)}
WITNESS: ${form.witness || 'Unknown'}

STATEMENT 1:
"${form.stmt1 || 'Not provided'}"
Source: ${form.stmt1Src || 'Not specified'}

STATEMENT 2 (CONTRADICTING STATEMENT):
"${form.stmt2 || 'Not provided'}"
Source: ${form.stmt2Src || 'Not specified'}

COUNSEL'S ASSESSMENT: ${form.impact || 'Not assessed'}

Analyse this contradiction:

## 1. NATURE OF THE CONTRADICTION
Fundamental (destroys core evidence) or peripheral (credibility only)? What does this contradiction mean for the case?

## 2. HOW TO ESTABLISH THE CONTRADICTION IN COURT
The precise sequence to lock in both statements before springing the contradiction. Never confront before confirming both. Give exact procedural steps.

## 3. THE BREAKING SEQUENCE — EXACT QUESTIONS
The series of questions to: (a) confirm Statement 1, (b) confirm Statement 2, (c) confront with the contradiction. Tight, closed, leaving no escape.

## 4. ANTICIPATED ESCAPE ROUTES
How will the witness try to explain away the contradiction? Prepare a blocking sequence for each escape route.

## 5. CLOSING THE LOOP
How to use this contradiction in the written address. The precise submission on this point.

Be surgical. Every word must count.`,
        maxTokens: 1400,
      });
      setAiRes(result);
    } catch (e) {
      setErr('Error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <CXSection title="Contradiction Map">
          {maps.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7 }}>No contradictions mapped. Add each contradiction between statements, affidavits, or prior proceedings.</p>}
          {maps.map(m => (
            <div key={m.id} onClick={() => { setSel(m.id); setForm({ ...m }); setAiRes(''); }}
              style={{ background: sel === m.id ? '#150808' : '#070710', border: `1px solid ${sel === m.id ? CX_ACCENT : '#111120'}`, borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer' }}>
              <div style={{ fontSize: 12, color: T.text, fontFamily: "'Cormorant Garamond',serif", fontWeight: 500, marginBottom: 2 }}>{m.witness || 'Unnamed Witness'}</div>
              <div style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter,sans-serif' }}>{m.stmt1 ? m.stmt1.slice(0, 30) + '…' : 'No statement yet'}</div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}><CXBtn onClick={addMap} small variant="ghost">+ Map Contradiction</CXBtn></div>
        </CXSection>
      </div>

      <div>
        {!form ? (
          <div style={{ textAlign: 'center', padding: '70px 24px', color: T.mute, fontFamily: 'Inter,sans-serif', fontSize: 13 }}>
            <div style={{ fontSize: 36, opacity: .06, marginBottom: 14 }}>⚡</div>
            Map each contradiction between a witness's statements, affidavit, and prior positions.
          </div>
        ) : (
          <div>
            <CXSection title="Contradiction Analysis">
              <CXInput label="Witness Name" value={form.witness} onChange={v => updateM('witness', v)} placeholder="The witness whose statements contradict" />
              <div style={{ background: '#060f08', border: '1px solid #1a2e1a', borderRadius: 6, padding: '14px 16px', marginBottom: 12 }}>
                <p style={{ fontSize: 9, color: '#5a9a5a', fontFamily: 'Inter,sans-serif', letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 700, marginBottom: 10 }}>Statement 1 — Their Original Position</p>
                <CXInput label="Statement Text" value={form.stmt1} onChange={v => updateM('stmt1', v)} placeholder="What did they say, swear to, or sign? Paste exact text where possible." multiline rows={3} />
                <CXInput label="Source (Document, Date, Paragraph)" value={form.stmt1Src} onChange={v => updateM('stmt1Src', v)} placeholder="e.g. Witness Statement dated 1 Jan 2024, para 4" />
              </div>
              <div style={{ background: '#1a0808', border: '1px solid #3a1010', borderRadius: 6, padding: '14px 16px', marginBottom: 12 }}>
                <p style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 700, marginBottom: 10 }}>Statement 2 — The Contradicting Statement</p>
                <CXInput label="Contradicting Statement Text" value={form.stmt2} onChange={v => updateM('stmt2', v)} placeholder="What did they say that contradicts Statement 1? Paste exact text." multiline rows={3} />
                <CXInput label="Source (Document, Date, Paragraph)" value={form.stmt2Src} onChange={v => updateM('stmt2Src', v)} placeholder="e.g. Counter-Affidavit of 15 Mar 2024, para 9" />
              </div>
              <CXInput label="Counsel's Assessment of Impact" value={form.impact} onChange={v => updateM('impact', v)} placeholder="Does this destroy core evidence or only affect credibility? What does it prove?" />
              <CXInput label="Notes" value={form.notes} onChange={v => updateM('notes', v)} placeholder="Context, additional observations, related contradictions…" multiline rows={2} />
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <CXBtn onClick={analyseContradiction} disabled={loading || !form.stmt1 || !form.stmt2}>⚡ Analyse &amp; Build Exploitation Strategy</CXBtn>
                <CXBtn onClick={() => deleteM(form.id)} variant="danger" small>Delete</CXBtn>
              </div>
            </CXSection>
            <CXAIBlock loading={loading} result={aiRes} error={err} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── MODULE 3: QUESTION SEQUENCER ─────────────────────────────────────────────

function CXQuestionSequencer({ caseId: _caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [witName, setWitName] = useState('');
  const [objective, setObjective] = useState('');
  const [factual, setFactual] = useState('');
  const [strategy, setStrategy] = useState('destroy_credibility');
  const [style, setStyle] = useState('controlled');
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const STRATEGIES = [
    { id: 'destroy_credibility', label: 'Destroy Credibility' },
    { id: 'extract_admission',   label: 'Extract Key Admission' },
    { id: 'establish_facts',     label: 'Establish Helpful Facts' },
    { id: 'undermine_evidence',  label: 'Undermine Central Evidence' },
    { id: 'expose_bias',         label: 'Expose Bias / Motive' },
    { id: 'no_case_sub',         label: 'Build No-Case Submission' },
  ];
  const STYLES = [
    { id: 'controlled',      label: 'Controlled — Tight closed questions only' },
    { id: 'incremental',     label: 'Incremental — Build pressure gradually' },
    { id: 'confrontational', label: 'Confrontational — Direct and aggressive' },
    { id: 'socratic',        label: 'Socratic — Lead the witness to the conclusion' },
  ];

  async function generateSequence() {
    if (!witName.trim() || !objective.trim()) return;
    setLoading(true); setErr(''); setAiRes('');
    try {
      const result = await callClaude({
        system: roleSystemPrompt(activeCase),
        userMsg: `${caseHeader(activeCase)}
WITNESS: ${witName}
CROSS-EXAMINATION OBJECTIVE: ${objective}
RELEVANT FACTS & CONTEXT: ${factual || 'Not provided'}
STRATEGY: ${STRATEGIES.find(s => s.id === strategy)?.label || strategy}
STYLE: ${STYLES.find(s => s.id === style)?.label || style}

Generate a complete, sequenced cross-examination plan:

## PHASE 1 — LOCK-DOWN (Factual Concessions First)
Questions that establish facts the witness cannot deny — which you will use against them later. Number each question. Mark each with what it is designed to establish.

## PHASE 2 — PRESSURE BUILD
Questions that tighten around the witness. Closing escapes. Building toward the central attack. Number each question. Mark purpose.

## PHASE 3 — THE ATTACK
Core cross-examination sequence. Questions most likely to extract the admission, destroy credibility, or establish the contradiction. Number each question. Mark purpose.

## PHASE 4 — THE CLOSED BOX
The closing sequence — pin the witness to a position they cannot escape. The final submission material. Number each question. Mark purpose.

## OBJECTIONS EXPECTED
Likely objections from opposing counsel and how to respond to each.

## THE ADMISSION TARGET
The exact words you need the witness to say, and the sequence most likely to produce them.

Format questions as:
Q[N]: [Exact question text] → [Purpose / what this achieves]`,
        maxTokens: 2000,
      });
      setAiRes(result);
    } catch (e) {
      setErr('Error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  function copySeq() {
    try { navigator.clipboard.writeText(aiRes); } catch { const ta = document.createElement('textarea'); ta.value = aiRes; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const selStyle: React.CSSProperties = { width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none' };

  return (
    <div>
      <CXSection title="Cross-Examination Question Sequencer">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7, marginBottom: 18 }}>
          Build a complete, numbered question sequence for any witness. The AI generates a phased cross-examination strategy with exact question text you can read directly in court.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <CXInput label="Witness Name" value={witName} onChange={setWitName} placeholder="Full name of witness to cross-examine" />
          <CXInput label="Primary Objective" value={objective} onChange={setObjective} placeholder="e.g. Prove witness did not see the accident / Extract admission that signature was forged" />
        </div>
        <CXInput label="Key Facts, Contradictions & Context" value={factual} onChange={setFactual} placeholder="Paste the witness statement, relevant facts, contradictions identified, documents to use. More context = more surgical questions." multiline rows={5} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, display: 'block', marginBottom: 5 }}>Strategy</label>
            <select value={strategy} onChange={e => setStrategy(e.target.value)} style={selStyle}>
              {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, display: 'block', marginBottom: 5 }}>Style</label>
            <select value={style} onChange={e => setStyle(e.target.value)} style={selStyle}>
              {STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <CXBtn onClick={generateSequence} disabled={loading || !witName.trim() || !objective.trim()}>⚔ Generate Full Question Sequence</CXBtn>
      </CXSection>

      {aiRes && !loading && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', letterSpacing: '.14em', textTransform: 'uppercase' as const, fontWeight: 700, margin: 0 }}>Cross-Examination Sequence — {witName}</p>
            <button onClick={copySeq} style={{ background: copied ? '#0d1a08' : 'transparent', border: `1px solid ${copied ? '#3a5028' : '#2a1a1a'}`, color: copied ? '#60b040' : CX_DIM, borderRadius: 3, padding: '4px 12px', fontSize: 10, fontFamily: 'Inter,sans-serif', cursor: 'pointer', transition: 'all .2s' }}>
              {copied ? '✓ Copied' : 'Copy All'}
            </button>
          </div>
          <div style={{ background: '#0d0608', border: `1px solid ${CX_ACCENT}33`, borderRadius: 6, padding: '20px 24px', whiteSpace: 'pre-wrap', lineHeight: 1.9, fontFamily: "'Cormorant Garamond',serif", fontSize: 15, color: '#cac6ba' }}>
            {aiRes}
          </div>
        </div>
      )}
      {err && <div style={{ background: '#1a0808', border: '1px solid #3a1010', borderRadius: 5, padding: '12px 16px', color: '#c05050', fontFamily: 'Inter,sans-serif', fontSize: 13, marginTop: 12 }}>{err}</div>}
    </div>
  );
}

// ── MODULE 4: IMPEACHMENT ARSENAL ─────────────────────────────────────────────

function CXImpeachmentBank({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const { data: items, setData: setItems } = useCxStorage<ImpeachmentItem[]>(caseId, 'impeachment', []);
  const [witFilter, setWitFilter] = useState('All');
  const [form, setForm] = useState({ witness: '', type: '', weapon: '', impact: '' });
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  function addItem() {
    if (!form.witness.trim() || !form.weapon.trim()) return;
    setItems(p => [...p, { ...form, id: uid(), addedAt: new Date().toISOString() }]);
    setForm({ witness: '', type: '', weapon: '', impact: '' });
    setAiRes('');
  }

  const TYPES = ['Prior Inconsistent Statement', 'Criminal Record', 'Bias / Motive', 'Prior Bad Acts', 'Expert Qualification Attack', 'Document Contradiction', 'Relationship / Interest', 'Prior Adverse Finding'];
  const witnesses = ['All', ...Array.from(new Set(items.map(i => i.witness).filter(Boolean)))];

  async function analyseWeapon() {
    if (!form.weapon.trim()) return;
    setLoading(true); setErr(''); setAiRes('');
    try {
      const result = await callClaude({
        userMsg: `Nigerian court. Senior Advocate. Cross-examination impeachment analysis.

${caseHeader(activeCase)}
WITNESS: ${form.witness || 'Unknown'}
IMPEACHMENT TYPE: ${form.type || 'Not specified'}
IMPEACHMENT WEAPON: ${form.weapon}
ASSESSED IMPACT: ${form.impact || 'Not assessed'}

Advise:
1. ADMISSIBILITY — Is this weapon admissible in Nigerian courts? What provisions of the Evidence Act 2011 apply? Any procedural steps required?
2. HOW TO DEPLOY — The exact procedural sequence to introduce this in cross-examination.
3. MAXIMUM IMPACT QUESTIONS — Write 3-5 exact questions that deploy this weapon for maximum effect.
4. ANTICIPATED OBJECTIONS — What will opposing counsel object to, and how to overcome each objection?
5. CLOSING SUBMISSION — How to use this in the written address on credibility.

Be specific to Nigerian evidence law (Evidence Act 2011).`,
        maxTokens: 1200,
      });
      setAiRes(result);
    } catch (e) {
      setErr('Error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  const filtered = witFilter === 'All' ? items : items.filter(i => i.witness === witFilter);

  return (
    <div>
      <CXSection title="Impeachment Arsenal">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7, marginBottom: 16 }}>
          Build and store every impeachment weapon across all witnesses. The AI analyses admissibility under the Evidence Act 2011, drafts deployment questions, and prepares the closing submission on credibility.
        </p>

        <div style={{ background: '#0d0608', border: `1px solid ${CX_ACCENT}22`, borderRadius: 7, padding: '18px 20px', marginBottom: 24 }}>
          <p style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', letterSpacing: '.14em', textTransform: 'uppercase' as const, fontWeight: 700, marginBottom: 14 }}>Add Impeachment Weapon</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <CXInput label="Witness Name" value={form.witness} onChange={v => setForm(f => ({ ...f, witness: v }))} placeholder="Witness to impeach" />
            <div>
              <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, display: 'block', marginBottom: 5 }}>Impeachment Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
                <option value="">Select type…</option>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <CXInput label="The Weapon — Describe the Impeachment Material" value={form.weapon} onChange={v => setForm(f => ({ ...f, weapon: v }))} placeholder="e.g. In previous proceedings (Suit No. X) this witness testified under oath that the signature was his. He now denies it in paragraph 7 of his counter-affidavit." multiline rows={3} />
          <CXInput label="Assessed Impact" value={form.impact} onChange={v => setForm(f => ({ ...f, impact: v }))} placeholder="Fundamental — destroys core evidence / Credibility — damages reliability / Peripheral — reduces weight only" />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <CXBtn onClick={() => { if (form.weapon.trim()) analyseWeapon(); }} disabled={loading || !form.weapon.trim()}>⚡ Analyse Weapon</CXBtn>
            <CXBtn onClick={addItem} disabled={!form.witness.trim() || !form.weapon.trim()} variant="ghost">Save to Arsenal</CXBtn>
          </div>
          <CXAIBlock loading={loading} result={aiRes} error={err} />
        </div>

        {items.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {witnesses.map(w => (
                <button key={w} onClick={() => setWitFilter(w)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 3, border: `1px solid ${witFilter === w ? CX_ACCENT : '#1e1e2e'}`, background: witFilter === w ? '#150808' : 'transparent', color: witFilter === w ? CX_LIGHT : T.mute, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.04em' }}>{w}</button>
              ))}
            </div>
            {filtered.map(item => (
              <div key={item.id} style={{ background: '#07070f', border: '1px solid #111120', borderRadius: 5, padding: '14px 18px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, marginRight: 8 }}>{item.witness}</span>
                    {item.type && <span style={{ fontSize: 9, color: '#3a2a2a', fontFamily: 'Inter,sans-serif', border: '1px solid #2a1a1a', padding: '1px 6px', borderRadius: 2 }}>{item.type}</span>}
                  </div>
                  <button onClick={() => setItems(p => p.filter(x => x.id !== item.id))} style={{ background: 'transparent', border: 'none', color: '#2a1a1a', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>✕</button>
                </div>
                <p style={{ fontSize: 15, color: '#cac6ba', fontFamily: "'Cormorant Garamond',serif", lineHeight: 1.8, margin: '0 0 6px' }}>{item.weapon}</p>
                {item.impact && <p style={{ fontSize: 12, color: CX_DIM, fontFamily: 'Inter,sans-serif', margin: 0 }}>Impact: {item.impact}</p>}
              </div>
            ))}
          </div>
        )}
        {items.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No impeachment weapons in the arsenal yet.</p>}
      </CXSection>
    </div>
  );
}

// ── MODULE 5: LIVE COURTROOM MODE ─────────────────────────────────────────────

function CXLiveMode({ caseId: _caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [witness, setWitness] = useState('');
  const [context, setContext] = useState('');
  const [answers, setAnswers] = useState<LiveAnswer[]>([]);
  const [input, setInput] = useState('');
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [session, setSession] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function startSession() {
    if (!witness.trim()) return;
    setSession(true);
    setAnswers([]);
    setAiRes('');
    setErr('');
  }

  function addAnswer() {
    if (!input.trim()) return;
    const entry: LiveAnswer = {
      id: uid(),
      text: input.trim(),
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setAnswers(a => [...a, entry]);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function getAdvice() {
    if (!answers.length) return;
    setLoading(true); setErr(''); setAiRes('');
    const log = answers.map((a, i) => `Answer ${i + 1} [${a.time}]: ${a.text}`).join('\n\n');
    try {
      const result = await callClaude({
        system: roleSystemPrompt(activeCase),
        userMsg: `${caseHeader(activeCase)}
WITNESS BEING CROSS-EXAMINED: ${witness}
BACKGROUND CONTEXT: ${context || 'Not provided'}

WITNESS ANSWERS SO FAR:
${log}

Provide urgent, real-time cross-examination intelligence:

## CRITICAL OBSERVATIONS
Flag anything immediately dangerous or useful in the answers given. Has the witness said something unexpected — helpful or harmful?

## CONTRADICTIONS DETECTED
Any internal contradictions between the answers, or contradictions with the expected position?

## NEXT THREE QUESTIONS
The three best questions to ask RIGHT NOW — based on what the witness just said. Give exact question text and what each achieves.

## FOLLOW-UP TARGET
Which specific answer should be drilled into further, and exactly how?

## ADMISSION RISK ASSESSMENT
Has the witness made any admissions? Rate: STRONG / PARTIAL / NONE.

## APPELLATE FLAGS
Anything that should be preserved as an appellate issue? Any objections that should be made?

Be direct. Be urgent. This is live courtroom intelligence.`,
        maxTokens: 1200,
      });
      setAiRes(result);
    } catch (e) {
      setErr('Error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  if (!session) {
    return (
      <div style={{ maxWidth: 580 }}>
        <CXSection title="Live Courtroom Mode — Setup">
          <div style={{ background: '#120606', border: `1px solid ${CX_ACCENT}33`, borderRadius: 6, padding: '14px 18px', marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: CX_LIGHT, fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', lineHeight: 1.8, margin: 0 }}>
              Enter the courtroom. As the witness answers your questions, type each answer here. The AI monitors in real time — detecting contradictions, flagging admissions, and generating the next question sequence based on what the witness actually says.
            </p>
          </div>
          <CXInput label="Witness Being Cross-Examined" value={witness} onChange={setWitness} placeholder="Full name of witness" />
          <CXInput label="Background Context (cross-examination objectives, key facts, contradictions to exploit)" value={context} onChange={setContext} placeholder="Brief the AI on what you're trying to achieve and what you know about this witness. More context = more precise real-time intelligence." multiline rows={5} />
          <CXBtn onClick={startSession} disabled={!witness.trim()}>⚔ Enter Courtroom</CXBtn>
        </CXSection>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: '#120606', border: `1px solid ${CX_ACCENT}`, borderRadius: 6, padding: '12px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, background: CX_ACCENT, borderRadius: '50%', animation: 'glow 1.5s ease infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: CX_LIGHT, fontFamily: 'Inter,sans-serif', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const }}>LIVE — Cross-Examining: {witness}</span>
        </div>
        <button onClick={() => { setSession(false); setAnswers([]); setAiRes(''); }} style={{ background: 'transparent', border: '1px solid #2a1010', color: CX_DIM, borderRadius: 3, padding: '4px 12px', fontSize: 10, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>End Session</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
        <div>
          <CXSection title={`Witness Answers — ${answers.length} recorded`}>
            {answers.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7 }}>No answers recorded yet. Type each answer the witness gives and press Enter.</p>}
            {answers.map((a, i) => (
              <div key={a.id} style={{ background: '#07070f', border: '1px solid #111120', borderRadius: 5, padding: '11px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>ANSWER {i + 1}</span>
                  <span style={{ fontSize: 9, color: '#303040', fontFamily: 'Inter,sans-serif' }}>{a.time}</span>
                </div>
                <p style={{ fontSize: 15, color: '#cac6ba', fontFamily: "'Cormorant Garamond',serif", lineHeight: 1.8, margin: 0 }}>{a.text}</p>
              </div>
            ))}
          </CXSection>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', letterSpacing: '.14em', textTransform: 'uppercase' as const, fontWeight: 700, display: 'block', marginBottom: 5 }}>Type or dictate witness answer →</label>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addAnswer(); } }}
                placeholder="Type what the witness just said… (Enter to log)"
                rows={3}
                style={{ width: '100%', background: '#0d0608', border: `1px solid ${CX_ACCENT}55`, borderRadius: 5, color: T.text, padding: '11px 14px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none', resize: 'vertical', lineHeight: 1.75, boxSizing: 'border-box' as const }}
              />
            </div>
            <CXBtn onClick={addAnswer} disabled={!input.trim()} variant="primary" small>Log Answer</CXBtn>
          </div>
        </div>

        <div>
          <CXSection title="Real-Time AI Intelligence">
            <CXBtn onClick={getAdvice} disabled={loading || !answers.length}>
              {loading ? '⟳ Analysing…' : '⚔ Get Next Move'}
            </CXBtn>
            {err && <div style={{ background: '#1a0808', border: '1px solid #3a1010', borderRadius: 5, padding: '10px 14px', color: '#c05050', fontFamily: 'Inter,sans-serif', fontSize: 12, marginTop: 10 }}>{err}</div>}
            {loading && (
              <div style={{ textAlign: 'center', padding: '20px', marginTop: 10 }}>
                <div style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #3a1010', borderTop: `2px solid ${CX_ACCENT}`, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                <p style={{ fontSize: 11, color: CX_DIM, fontFamily: 'Inter,sans-serif', marginTop: 8, margin: '8px 0 0' }}>Processing courtroom intelligence…</p>
              </div>
            )}
            {aiRes && !loading && (
              <div style={{ background: '#0d0608', border: `1px solid ${CX_ACCENT}22`, borderRadius: 6, padding: '16px 18px', marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.85, fontFamily: "'Cormorant Garamond',serif", fontSize: 14, color: '#cac6ba', maxHeight: 520, overflowY: 'auto' }}>
                {aiRes}
              </div>
            )}
          </CXSection>
        </div>
      </div>
    </div>
  );
}

// ── MAIN ENGINE COMPONENT ─────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

export function CrossExamEngine({ activeCase }: Props) {
  const caseId = activeCase.id;
  type SubTab = 'profiler' | 'contradictions' | 'sequencer' | 'impeachment' | 'live';
  const [sub, setSub] = useState<SubTab>('profiler');

  const SUB_TABS: Array<{ id: SubTab; icon: string; label: string }> = [
    { id: 'profiler',       icon: '◈', label: 'Witness Profiler' },
    { id: 'contradictions', icon: '⚡', label: 'Contradiction Mapper' },
    { id: 'sequencer',      icon: '§', label: 'Question Sequencer' },
    { id: 'impeachment',    icon: '⚔', label: 'Impeachment Arsenal' },
    { id: 'live',           icon: '●', label: 'Live Courtroom Mode' },
  ];

  return (
    <div style={{ padding: '0 0 40px', animation: 'fadeUp .3s ease' }}>
      {/* Engine header */}
      <div style={{ background: '#0d0608', border: `1px solid ${CX_ACCENT}33`, borderRadius: 8, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 24, opacity: .7 }}>⚔</span>
        <div>
          <p style={{ fontSize: 9, color: CX_ACCENT, fontFamily: 'Inter,sans-serif', letterSpacing: '.18em', textTransform: 'uppercase' as const, fontWeight: 700, marginBottom: 3 }}>Cross-Examination Engine · Step 13</p>
          <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', margin: 0 }}>The most dangerous room in litigation. Build, execute, and survive cross-examination.</p>
        </div>
      </div>

      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} style={{
            background: sub === t.id ? '#150808' : 'transparent',
            border: `1px solid ${sub === t.id ? CX_ACCENT : '#1e1e2e'}`,
            color: sub === t.id ? CX_LIGHT : T.mute,
            borderRadius: 5, padding: '8px 14px', fontSize: 11,
            fontFamily: 'Inter,sans-serif', cursor: 'pointer',
            letterSpacing: '.06em', textTransform: 'uppercase' as const, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
          }}>
            <span style={{ fontSize: 13 }}>{t.icon}</span>
            {t.label}
            {t.id === 'live' && (
              <span style={{ width: 5, height: 5, background: sub === t.id ? CX_ACCENT : '#2a1010', borderRadius: '50%', display: 'inline-block', animation: sub === t.id ? 'glow 1.5s ease infinite' : 'none', marginLeft: 3 }} />
            )}
          </button>
        ))}
      </div>

      {/* Sub-module content */}
      {sub === 'profiler'       && <CXWitnessProfiler    caseId={caseId} activeCase={activeCase} />}
      {sub === 'contradictions' && <CXContradictionMapper caseId={caseId} activeCase={activeCase} />}
      {sub === 'sequencer'      && <CXQuestionSequencer   caseId={caseId} activeCase={activeCase} />}
      {sub === 'impeachment'    && <CXImpeachmentBank     caseId={caseId} activeCase={activeCase} />}
      {sub === 'live'           && <CXLiveMode            caseId={caseId} activeCase={activeCase} />}
    </div>
  );
}
