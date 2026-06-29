/**
 * AFS Advocates — CaseTrackers Engine
 *
 * Three analytical intelligence modules:
 * 1. Witness Management
 * 2. Opposing Counsel Profiler
 * 3. Judge / Court Tendencies
 *
 * Conflict Checker → moved to intelligence_data.conflict_scan (Phase 4A/4B)
 * Settlement Tracker + BATNA → moved to intelligence_data.risk_verdict (Phase 4B.ii)
 * Client Comms Log → removed (secretary work, not legal intelligence)
 * Interlocutory Applications Tracker → removed (status checklist; ApplicationsEngine drafts, Docket logs)
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude, withRetry } from '@/services/api';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
import { useIntelligence } from '@/hooks/useIntelligence';
import { LoadingBlock } from '@/components/common/ui';

// ── Types ────────────────────────────────────────────────────────────────────

interface WitnessRecord {
  id: string;
  name: string;
  side: 'ours' | 'opposing';
  role: string;
  knowledgeOf: string;
  credibilityVulns: string;
  prepNotes: string;
  status: string;
}

interface CounselProfile {
  id: string;
  name: string;
  chambers: string;
  yearsCall: string;
  typicalStrategies: string;
  strengths: string;
  weaknesses: string;
  knownTactics: string;
  notes: string;
}

interface JudgeData {
  judgeName: string;
  court: string;
  knownPreferences: string;
  rulingPatterns: string;
  proceduralStrictness: string;
  receptionToAuthorities: string;
  whatToAvoid: string;
  notes: string;
}

// ── Shared primitives ────────────────────────────────────────────────────────

function BSSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 11, color: '#5a5a72', fontFamily: 'Inter,sans-serif',
        letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600,
        marginBottom: 12, paddingBottom: 7, borderBottom: '1px solid #0e0e1c',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const inputBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};

function BSInput({
  label, value, onChange, placeholder, multiline, rows = 3,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; rows?: number;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{
          fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif',
          letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
          display: 'block', marginBottom: 5,
        }}>{label}</label>
      )}
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)}
            placeholder={placeholder} rows={rows}
            style={{ ...inputBase, resize: 'vertical', lineHeight: 1.75 }} />
        : <input value={value} onChange={e => onChange(e.target.value)}
            placeholder={placeholder} style={inputBase} />}
    </div>
  );
}

function BSBtn({
  onClick, disabled, children, variant = 'primary', small,
}: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger'; small?: boolean;
}) {
  const base: React.CSSProperties = {
    border: 'none', borderRadius: 5,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'Times New Roman', Times, serif", fontWeight: 600,
    letterSpacing: '.04em', transition: 'opacity .15s', opacity: disabled ? 0.4 : 1,
  };
  const vars: Record<string, React.CSSProperties> = {
    primary: { background: 'linear-gradient(135deg,#c4a030,#a07820)', color: '#05050c', padding: small ? '7px 18px' : '12px 24px', fontSize: small ? 13 : 15 },
    ghost:   { background: '#0d0d1c', border: '1px solid #cccccc', color: T.mute, padding: small ? '6px 14px' : '10px 20px', fontSize: small ? 12 : 14 },
    danger:  { background: '#1a0808', border: '1px solid #3a1010', color: '#c05050', padding: small ? '6px 14px' : '10px 20px', fontSize: small ? 12 : 14 },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...vars[variant] }}>
      {children}
    </button>
  );
}

function BSAIBlock({ loading, result, error }: { loading: boolean; result: string; error: string }) {
  if (loading) return (
    <div style={{ textAlign: 'center', padding: 28, color: T.mute, fontFamily: 'Inter,sans-serif', fontSize: 13 }}>
      <div style={{ display: 'inline-block', width: 12, height: 12, border: '1.5px solid #2a1a08', borderTop: `1.5px solid ${T.gold}`, borderRadius: '50%', animation: 'spin .8s linear infinite', marginBottom: 8 }} />
      <div>Analysing…</div>
    </div>
  );
  if (error) return (
    <div style={{ background: '#1a0808', border: '1px solid #3a1010', borderRadius: 5, padding: '12px 16px', color: '#c05050', fontFamily: 'Inter,sans-serif', fontSize: 13, marginTop: 12 }}>
      {error}
    </div>
  );
  if (!result) return null;
  return (
    <div style={{ background: '#070710', border: '1px solid #141424', borderRadius: 6, padding: '16px 20px', marginTop: 14, whiteSpace: 'pre-wrap', lineHeight: 1.85, fontFamily: "'Times New Roman', Times, serif", fontSize: 15, color: '#cac6ba' }}>
      {result}
    </div>
  );
}

function useAI() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const run = useCallback(async (prompt: string, maxTokens = 1000, system?: string): Promise<string | null> => {
    setLoading(true); setError(''); setResult('');
    try {
      const text = await withRetry(() => callClaude({ userMsg: prompt, maxTokens, ...(system ? { system } : {}) }));
      setResult(text);
      return text;
    } catch (e) {
      setError((e as Error).message || 'API error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, result, error, run, setResult };
}

// ── 2. WITNESS MANAGEMENT ────────────────────────────────────────────────────

function BSWitnesses({ caseId, activeCase, fullContext }: { caseId: string; activeCase: Case; fullContext: string }) {
  const [witnesses, setWitnesses] = useState<WitnessRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<WitnessRecord | null>(null);
  const ai = useAI();

  useEffect(() => {
    loadBlindSpot<WitnessRecord[]>(caseId, 'witnesses', []).then(d => {
      setWitnesses(d); setReady(true);
    });
  }, [caseId]);

  function save(list: WitnessRecord[]) {
    setWitnesses(list);
    saveBlindSpot(caseId, 'witnesses', list);
  }

  function addWitness() {
    const w: WitnessRecord = {
      id: uid(), name: '', side: 'ours', role: '',
      knowledgeOf: '', credibilityVulns: '', prepNotes: '', status: 'Pending',
    };
    const list = [...witnesses, w];
    save(list); setForm(w); setSelected(w.id); ai.setResult('');
  }

  function updateW(id: string, field: keyof WitnessRecord, val: string) {
    const list = witnesses.map(w => w.id === id ? { ...w, [field]: val } : w);
    save(list);
    setForm(list.find(w => w.id === id) ?? null);
  }

  function deleteW(id: string) {
    save(witnesses.filter(w => w.id !== id));
    setSelected(null); setForm(null);
  }

  async function analyseWitness() {
    if (!form) return;
    const prompt = `You are a senior Nigerian litigation advocate. Analyse this witness for the case: ${activeCase.caseName || 'Unnamed'} (${activeCase.counsel_role ? activeCase.counsel_role.replace(/_/g,' ') : (activeCase.role || 'Claimant')} | ${activeCase.matter_track || 'civil'}).

WITNESS: ${form.name || 'Unnamed'}
SIDE: ${form.side === 'ours' ? 'Our witness' : 'Opposing witness'}
ROLE IN CASE: ${form.role || 'Not specified'}
KNOWLEDGE / WHAT THEY KNOW: ${form.knowledgeOf || 'Not specified'}
KNOWN CREDIBILITY VULNERABILITIES: ${form.credibilityVulns || 'None specified'}

${form.side === 'ours' ? `Provide:
1. WITNESS VALUE — What this witness actually proves and how strong their evidence is
2. PREPARATION AGENDA — The 5 most important things to cover in witness prep
3. VULNERABILITIES TO CLOSE — Weaknesses opposing counsel will attack; how to neutralise each
4. WHAT NOT TO DO — The mistake this witness is most likely to make in the box
5. EXAMINATION-IN-CHIEF STRUCTURE — The optimal order for extracting their evidence`
: `Provide:
1. EXPECTED EVIDENCE — What this witness is likely to say and how damaging it is
2. CREDIBILITY ATTACK STRATEGY — Specific vulnerabilities and how to exploit them
3. THREE BREAKING QUESTIONS — Questions most likely to extract admissions or destroy credibility
4. DOCUMENTS TO CONFRONT THEM WITH — Inconsistencies with the record to put to them
5. WHAT TO EXTRACT — The specific concessions or admissions you need from this witness`}

Be precise. Every observation must be actionable.`;
    await ai.run(prompt, 1000, `You are a senior Nigerian litigation counsel specialising in witness preparation and cross-examination strategy. Apply Nigerian evidence law and courtroom tactics.` + fullContext);
  }

  // Phase 2B — show skeleton while loadBlindSpot resolves (IndexedDB-only, fast)
  const STATUS_OPTS = ['Pending', 'In Preparation', 'Ready', 'Testified', 'Withdrawn'];

  if (!ready) return <LoadingBlock label="Loading…" />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <BSSection title="Witnesses">
          {witnesses.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No witnesses added yet.</p>}
          {witnesses.map(w => (
            <div key={w.id} onClick={() => { setSelected(w.id); setForm(w); ai.setResult(''); }}
              style={{
                background: selected === w.id ? '#0d0d1c' : '#070710',
                border: `1px solid ${selected === w.id ? T.gold : '#eeeeee'}`,
                borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer',
              }}>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 500 }}>{w.name || 'Unnamed Witness'}</div>
              <div style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter,sans-serif', marginTop: 2 }}>{w.side === 'ours' ? 'Our witness' : 'Opposing'} · {w.status}</div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}><BSBtn onClick={addWitness} small variant="ghost">+ Add Witness</BSBtn></div>
        </BSSection>
      </div>
      <div>
        {!form ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: T.mute, fontFamily: 'Inter,sans-serif', fontSize: 13 }}>Select or add a witness to begin.</div>
        ) : (
          <BSSection title={form.name || 'New Witness'}>
            <BSInput label="Full Name" value={form.name} onChange={v => updateW(form.id, 'name', v)} placeholder="Witness full name" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Side</label>
                <select value={form.side} onChange={e => updateW(form.id, 'side', e.target.value as 'ours' | 'opposing')}
                  style={{ width: '100%', background: T.bg, border: '1px solid #cccccc', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", outline: 'none' }}>
                  <option value="ours">Our Witness</option>
                  <option value="opposing">Opposing Witness</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Status</label>
                <select value={form.status} onChange={e => updateW(form.id, 'status', e.target.value)}
                  style={{ width: '100%', background: T.bg, border: '1px solid #cccccc', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", outline: 'none' }}>
                  {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <BSInput label="Role in Case" value={form.role} onChange={v => updateW(form.id, 'role', v)} placeholder="e.g. Eye-witness to the transaction, employer, medical expert" />
            <BSInput label="Knowledge / What They Know" value={form.knowledgeOf} onChange={v => updateW(form.id, 'knowledgeOf', v)} placeholder="Summarise what this witness knows and can testify to" multiline rows={3} />
            <BSInput label="Credibility Vulnerabilities" value={form.credibilityVulns} onChange={v => updateW(form.id, 'credibilityVulns', v)} placeholder="Prior inconsistent statements, relationship to party, criminal record, motive..." multiline rows={3} />
            <BSInput label="Preparation Notes / Key Points" value={form.prepNotes} onChange={v => updateW(form.id, 'prepNotes', v)} placeholder="What must be covered in preparation. What to avoid saying. Key documents to review." multiline rows={3} />
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <BSBtn onClick={analyseWitness} disabled={ai.loading}>AI Witness Analysis →</BSBtn>
              <BSBtn onClick={() => deleteW(form.id)} variant="danger" small>Delete</BSBtn>
            </div>
            <BSAIBlock loading={ai.loading} result={ai.result} error={ai.error} />
          </BSSection>
        )}
      </div>
    </div>
  );
}

// ── 3. OPPOSING COUNSEL PROFILER ─────────────────────────────────────────────

function BSCounsel({ caseId, activeCase, fullContext }: { caseId: string; activeCase: Case; fullContext: string }) {
  const [profiles, setProfiles] = useState<CounselProfile[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<CounselProfile | null>(null);
  const ai = useAI();

  useEffect(() => {
    loadBlindSpot<CounselProfile[]>(caseId, 'counsel', []).then(d => {
      setProfiles(d); setReady(true);
    });
  }, [caseId]);

  function save(list: CounselProfile[]) {
    setProfiles(list);
    saveBlindSpot(caseId, 'counsel', list);
  }

  function addProfile() {
    const p: CounselProfile = {
      id: uid(), name: '', chambers: '', yearsCall: '',
      typicalStrategies: '', strengths: '', weaknesses: '', knownTactics: '', notes: '',
    };
    const list = [...profiles, p];
    save(list); setForm(p); setSelected(p.id); ai.setResult('');
  }

  function updateP(id: string, field: keyof CounselProfile, val: string) {
    const list = profiles.map(p => p.id === id ? { ...p, [field]: val } : p);
    save(list); setForm(list.find(p => p.id === id) ?? null);
  }

  async function analyseProfile() {
    if (!form) return;
    const prompt = `You are a senior Nigerian litigation advocate preparing to face opposing counsel. Analyse the following profile and advise on counter-strategy.

OPPOSING COUNSEL: ${form.name || 'Unknown'}
CHAMBERS: ${form.chambers || 'Unknown'}
YEARS IN CALL: ${form.yearsCall || 'Unknown'}
TYPICAL STRATEGIES: ${form.typicalStrategies || 'Not specified'}
KNOWN STRENGTHS: ${form.strengths || 'Not specified'}
KNOWN WEAKNESSES: ${form.weaknesses || 'Not specified'}
KNOWN TACTICS: ${form.knownTactics || 'Not specified'}

MATTER: ${activeCase.caseName || 'Unnamed'} (our role: ${activeCase.counsel_role ? activeCase.counsel_role.replace(/_/g,' ') : (activeCase.role || 'Claimant')} | ${activeCase.matter_track || 'civil'})

Advise:
1. THREAT ASSESSMENT — How dangerous is this opponent on these facts? Realistic rating.
2. LIKELY STRATEGY — Based on their profile, what approach will they take in this matter?
3. ANTICIPATED AMBUSHES — The 3 most likely unexpected moves they could make
4. COUNTER-STRATEGY — How do we stay ahead of their likely moves at each stage?
5. THEIR WEAKNESSES TO EXPLOIT — How to use their weaknesses against them in court
6. WHAT TO NEVER DO — Mistakes that play into this particular counsel's strengths

Be direct and tactical.`;
    await ai.run(prompt, 1000, `You are a senior Nigerian litigation strategist specialising in opposing counsel intelligence. Provide tactical, actionable analysis of opposing counsel's likely approach and vulnerabilities.` + fullContext);
  }

  if (!ready) return <LoadingBlock label="Loading…" />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <BSSection title="Opposing Counsel">
          {profiles.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No profiles yet.</p>}
          {profiles.map(p => (
            <div key={p.id} onClick={() => { setSelected(p.id); setForm(p); ai.setResult(''); }}
              style={{ background: selected === p.id ? '#0d0d1c' : '#070710', border: `1px solid ${selected === p.id ? T.gold : '#eeeeee'}`, borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer' }}>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif" }}>{p.name || 'Unnamed Counsel'}</div>
              <div style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter,sans-serif', marginTop: 2 }}>{p.chambers || 'Chambers not specified'}</div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}><BSBtn onClick={addProfile} small variant="ghost">+ Add Profile</BSBtn></div>
        </BSSection>
      </div>
      <div>
        {!form ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: T.mute, fontFamily: 'Inter,sans-serif', fontSize: 13 }}>Select or add a profile to begin.</div>
        ) : (
          <BSSection title={form.name || 'New Profile'}>
            <BSInput label="Name" value={form.name} onChange={v => updateP(form.id, 'name', v)} placeholder="Opposing counsel's name" />
            <BSInput label="Chambers / Firm" value={form.chambers} onChange={v => updateP(form.id, 'chambers', v)} placeholder="Name of chambers or law firm" />
            <BSInput label="Year of Call / Seniority" value={form.yearsCall} onChange={v => updateP(form.id, 'yearsCall', v)} placeholder="e.g. 2001, SAN, 25 years" />
            <BSInput label="Typical Strategies" value={form.typicalStrategies} onChange={v => updateP(form.id, 'typicalStrategies', v)} placeholder="How do they usually approach litigation? Aggressive? Technical? Delay tactics?" multiline rows={3} />
            <BSInput label="Known Strengths" value={form.strengths} onChange={v => updateP(form.id, 'strengths', v)} placeholder="What are they genuinely good at?" multiline rows={2} />
            <BSInput label="Known Weaknesses" value={form.weaknesses} onChange={v => updateP(form.id, 'weaknesses', v)} placeholder="Where do they fall short? Under-prepared on evidence? Poor cross-examination?" multiline rows={2} />
            <BSInput label="Known Tactics / Ambush Moves" value={form.knownTactics} onChange={v => updateP(form.id, 'knownTactics', v)} placeholder="Last-minute amendments, evidence dumping, procedural objections at final stages..." multiline rows={2} />
            <BSInput label="Case Notes / History" value={form.notes} onChange={v => updateP(form.id, 'notes', v)} placeholder="Any prior encounters across other matters? Outcomes?" multiline rows={2} />
            <div style={{ marginTop: 12 }}>
              <BSBtn onClick={analyseProfile} disabled={ai.loading}>AI Counter-Strategy →</BSBtn>
            </div>
            <BSAIBlock loading={ai.loading} result={ai.result} error={ai.error} />
          </BSSection>
        )}
      </div>
    </div>
  );
}

// ── 4. JUDGE / COURT TENDENCIES ──────────────────────────────────────────────

function BSJudge({ caseId, activeCase, fullContext }: { caseId: string; activeCase: Case; fullContext: string }) {
  const [data, setData] = useState<JudgeData>({
    judgeName: '', court: '', knownPreferences: '', rulingPatterns: '',
    proceduralStrictness: '', receptionToAuthorities: '', whatToAvoid: '', notes: '',
  });
  const [ready, setReady] = useState(false);
  const ai = useAI();

  useEffect(() => {
    loadBlindSpot<JudgeData>(caseId, 'judge', {
      judgeName: '', court: '', knownPreferences: '', rulingPatterns: '',
      proceduralStrictness: '', receptionToAuthorities: '', whatToAvoid: '', notes: '',
    }).then(d => { setData(d); setReady(true); });
  }, [caseId]);

  function update(field: keyof JudgeData, val: string) {
    const d = { ...data, [field]: val };
    setData(d);
    saveBlindSpot(caseId, 'judge', d);
  }

  async function runAnalysis() {
    const prompt = `You are a senior Nigerian advocate who knows the culture and tendencies of Nigerian courts at every level. Advise on how to optimise our presentation before this court.

JUDGE / COURT: ${data.judgeName || 'Not specified'} — ${data.court || 'Not specified'}
KNOWN PREFERENCES: ${data.knownPreferences || 'Not specified'}
RULING PATTERNS: ${data.rulingPatterns || 'Not specified'}
PROCEDURAL STRICTNESS: ${data.proceduralStrictness || 'Not specified'}
RECEPTION TO AUTHORITIES: ${data.receptionToAuthorities || 'Not specified'}
WHAT TO AVOID: ${data.whatToAvoid || 'Not specified'}
CASE TYPE: ${activeCase.caseName || 'Unnamed'} (${activeCase.counsel_role ? activeCase.counsel_role.replace(/_/g,' ') : (activeCase.role || '')} | ${activeCase.matter_track || 'civil'})

Advise:
1. PRESENTATION STRATEGY — How to frame our case for maximum impact before this specific court
2. WHAT THIS COURT RESPONDS TO — The presentation style and argument type that lands best here
3. AUTHORITIES TO EMPHASISE — Should we lead with Supreme Court, foreign authorities, statutory text?
4. PROCEDURAL MUST-KNOWS — Specific procedures this court enforces strictly that we cannot miss
5. WHAT TO AVOID — The specific mistakes that irritate or prejudice this judge/court
6. THE OPENING WE SHOULD MAKE — The impression to create on first appearance before this court

General principles where specifics are unknown. Be practical — this is court intelligence, not a textbook.`;
    await ai.run(prompt, 1000, `You are a senior Nigerian litigation counsel with deep knowledge of Nigerian court practice and judicial temperament. Provide practical court intelligence grounded in Nigerian procedure and advocacy.` + fullContext);
  }

  if (!ready) return <LoadingBlock label="Loading…" />;

  return (
    <div>
      <BSSection title="⚖ Judge / Court Tendencies — Court Intelligence">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7, marginBottom: 16 }}>
          This intelligence is worth more than most legal arguments. How a court rules is as important as what the law says. Record everything you learn about this court.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <BSInput label="Judge's Name" value={data.judgeName} onChange={v => update('judgeName', v)} placeholder="Honourable Justice..." />
          <BSInput label="Court / Division" value={data.court} onChange={v => update('court', v)} placeholder="e.g. Lagos High Court, General Cause List, FHC Abuja" />
        </div>
        <BSInput label="Known Preferences (argument style, presentation, brevity vs detail)" value={data.knownPreferences} onChange={v => update('knownPreferences', v)} placeholder="e.g. Prefers brief, structured oral submissions. Reads briefs in advance." multiline rows={3} />
        <BSInput label="Ruling Patterns (how do they typically decide these issues?)" value={data.rulingPatterns} onChange={v => update('rulingPatterns', v)} placeholder="e.g. Strict on limitation period applications. Tends to allow amendments." multiline rows={3} />
        <BSInput label="Procedural Strictness (what rules does this court enforce tightly?)" value={data.proceduralStrictness} onChange={v => update('proceduralStrictness', v)} placeholder="e.g. Will not admit documents not front-loaded. Strict on filing deadlines." multiline rows={2} />
        <BSInput label="Reception to Authorities (Nigerian only? Foreign? Academic texts?)" value={data.receptionToAuthorities} onChange={v => update('receptionToAuthorities', v)} placeholder="e.g. Receptive to UK Commercial Court decisions. Requires NWLR citations." multiline rows={2} />
        <BSInput label="What to Avoid Before This Court" value={data.whatToAvoid} onChange={v => update('whatToAvoid', v)} placeholder="e.g. Do not repeat arguments already in written address. Never interrupt." multiline rows={2} />
        <BSInput label="Additional Intelligence / Notes" value={data.notes} onChange={v => update('notes', v)} placeholder="Any other intelligence about this court gathered from colleagues or past appearances" multiline rows={2} />
        <div style={{ marginTop: 14 }}>
          <BSBtn onClick={runAnalysis} disabled={ai.loading}>AI Court Presentation Strategy →</BSBtn>
        </div>
        <BSAIBlock loading={ai.loading} result={ai.result} error={ai.error} />
      </BSSection>
    </div>
  );
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

const SUB_TABS = [
  { id: 'witnesses', icon: '👁', label: 'Witnesses' },
  { id: 'counsel',   icon: '⚔', label: 'Opp. Counsel' },
  { id: 'judge',     icon: '⚖', label: 'Judge / Court' },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];

export function CaseTrackers({ activeCase }: Props) {
  const [sub, setSub] = useState<SubTab>('witnesses');
  const caseId = activeCase.id;
  const { fullContext } = useIntelligence(activeCase, 'issues');

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} style={{
            background: sub === t.id ? '#0d0d1c' : 'transparent',
            border: `1px solid ${sub === t.id ? T.gold : '#cccccc'}`,
            color: sub === t.id ? T.gold : T.mute,
            borderRadius: 5, padding: '7px 13px', fontSize: 11,
            fontFamily: 'Inter,sans-serif', cursor: 'pointer',
            letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
          }}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Module content */}
      {sub === 'witnesses' && <BSWitnesses caseId={caseId} activeCase={activeCase} fullContext={fullContext} />}
      {sub === 'counsel'   && <BSCounsel   caseId={caseId} activeCase={activeCase} fullContext={fullContext} />}
      {sub === 'judge'     && <BSJudge     caseId={caseId} activeCase={activeCase} fullContext={fullContext} />}
    </div>
  );
}
