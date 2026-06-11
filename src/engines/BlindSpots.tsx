/**
 * AFS Advocates — BlindSpots Engine
 *
 * Seven intelligence modules that have cost lawyers real cases:
 * 1. Conflict of Interest Checker
 * 2. Witness Management
 * 3. Opposing Counsel Profiler
 * 4. Judge / Court Tendencies
 * 5. Settlement Negotiation Tracker + BATNA
 * 6. Client Communication Log
 * 7. Interlocutory Applications Tracker
 *
 * Fully migrated from app.html — typed, Dexie-backed, React hooks throughout.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';

// ── Types ────────────────────────────────────────────────────────────────────

interface ConflictData {
  opposingParties: string;
  subjectMatter: string;
  previousMatters: string;
  personalInterest: string;
  outcome: string;
  notes: string;
  checkedAt: string | null;
}

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

interface SettlementOffer {
  id: string;
  side: 'ours' | 'theirs';
  amount: string;
  description: string;
  date: string;
  status: 'Live' | 'Accepted' | 'Rejected' | 'Lapsed';
}

interface SettlementData {
  clientAuthority: string;
  batna: string;
  latna: string;
  claimValue: string;
  offers: SettlementOffer[];
  status: string;
  notes: string;
}

interface CommEntry {
  id: string;
  type: string;
  summary: string;
  instructions: string;
  date: string;
  flagged: boolean;
}

interface InterlockApp {
  id: string;
  title: string;
  mover: 'ours' | 'opposing';
  type: string;
  reliefSought: string;
  filingDate: string;
  hearingDate: string;
  status: string;
  outcome: string;
  affectsMainSuit: boolean;
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
  width: '100%', background: T.bg, border: '1px solid #1e1e2e',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Cormorant Garamond',serif", outline: 'none', boxSizing: 'border-box',
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
    fontFamily: "'Cormorant Garamond',serif", fontWeight: 600,
    letterSpacing: '.04em', transition: 'opacity .15s', opacity: disabled ? 0.4 : 1,
  };
  const vars: Record<string, React.CSSProperties> = {
    primary: { background: 'linear-gradient(135deg,#c4a030,#a07820)', color: '#05050c', padding: small ? '7px 18px' : '12px 24px', fontSize: small ? 13 : 15 },
    ghost:   { background: '#0d0d1c', border: '1px solid #1e1e2e', color: T.mute, padding: small ? '6px 14px' : '10px 20px', fontSize: small ? 12 : 14 },
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
    <div style={{ background: '#070710', border: '1px solid #141424', borderRadius: 6, padding: '16px 20px', marginTop: 14, whiteSpace: 'pre-wrap', lineHeight: 1.85, fontFamily: "'Cormorant Garamond',serif", fontSize: 15, color: '#cac6ba' }}>
      {result}
    </div>
  );
}

function useAI() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const run = useCallback(async (prompt: string, maxTokens = 1000) => {
    setLoading(true); setError(''); setResult('');
    try {
      const text = await callClaude({ userMsg: prompt, maxTokens });
      setResult(text);
    } catch (e) {
      setError((e as Error).message || 'API error');
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, result, error, run, setResult };
}

// ── 1. CONFLICT CHECK ────────────────────────────────────────────────────────

function BSConflict({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [data, setData] = useState<ConflictData>({
    opposingParties: '', subjectMatter: '', previousMatters: '',
    personalInterest: '', outcome: '', notes: '', checkedAt: null,
  });
  const [ready, setReady] = useState(false);
  const ai = useAI();

  useEffect(() => {
    loadBlindSpot<ConflictData>(caseId, 'conflict', {
      opposingParties: '', subjectMatter: '', previousMatters: '',
      personalInterest: '', outcome: '', notes: '', checkedAt: null,
    }).then(d => { setData(d); setReady(true); });
  }, [caseId]);

  function update(field: keyof ConflictData, val: string) {
    const d = { ...data, [field]: val };
    setData(d);
    saveBlindSpot(caseId, 'conflict', d);
  }

  async function runCheck() {
    const prompt = `You are a Nigerian bar ethics adviser. Assess the following potential conflict of interest for a lawyer considering accepting a brief.

CASE: ${activeCase.caseName || 'Unnamed case'} (${activeCase.counsel_role ? activeCase.counsel_role.replace(/_/g,' ') : (activeCase.role || 'Role unspecified')} | ${activeCase.matter_track || 'civil'})
OPPOSING PARTIES: ${data.opposingParties || 'Not specified'}
SUBJECT MATTER: ${data.subjectMatter || 'Not specified'}
PREVIOUS MATTERS: ${data.previousMatters || 'None disclosed'}
PERSONAL/FINANCIAL INTEREST: ${data.personalInterest || 'None disclosed'}

Provide:
1. CONFLICT RISK RATING — None / Low / Medium / High / Disqualifying
2. ANALYSIS — Specific rule or principle engaged (Rules of Professional Conduct 2007, NBA rules, common law)
3. DISCLOSURE OBLIGATION — What if anything must be disclosed to the client and/or opposing party
4. RECOMMENDATION — Accept / Accept with disclosure / Decline / Seek independent ethics advice
5. IF YOU ACCEPT — Any conditions or safeguards that must be in place
6. RISK TO LICENCE — Frankly assess the bar risk if you proceed

Be direct. A wrong answer here costs a licence.`;
    await ai.run(prompt);
    update('checkedAt', new Date().toISOString());
  }

  if (!ready) return null;

  return (
    <div>
      <BSSection title="⚠ Conflict of Interest Checker — Before You Accept Any Brief">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7, marginBottom: 16 }}>
          Complete this before accepting the brief. Failing a conflict check after commencement can disqualify you mid-case, expose you to disciplinary proceedings, and cost your client.
        </p>
        <BSInput label="Opposing Parties (names, entities)" value={data.opposingParties} onChange={v => update('opposingParties', v)} placeholder="e.g. Acme Ltd, John Doe, ABC Bank" />
        <BSInput label="Subject Matter of Dispute" value={data.subjectMatter} onChange={v => update('subjectMatter', v)} placeholder="e.g. Land at Plot 3 Lekki, wrongful dismissal from XYZ Corp" />
        <BSInput label="Previous Matters — Have you previously acted for any party? Describe." value={data.previousMatters} onChange={v => update('previousMatters', v)} placeholder="e.g. Previously acted for Acme Ltd in unrelated debt matter 2019" multiline rows={3} />
        <BSInput label="Personal / Financial Interest — Any stake in the subject matter?" value={data.personalInterest} onChange={v => update('personalInterest', v)} placeholder="e.g. Co-owner of land in dispute / shareholder of opposing company" />
        <div style={{ marginTop: 16 }}>
          <BSBtn onClick={runCheck} disabled={ai.loading}>Run Conflict Check →</BSBtn>
        </div>
        <BSAIBlock loading={ai.loading} result={ai.result} error={ai.error} />
        {data.checkedAt && (
          <div style={{ fontSize: 11, color: '#303040', fontFamily: 'Inter,sans-serif', marginTop: 10 }}>
            Last checked: {new Date(data.checkedAt).toLocaleString('en-GB')}
          </div>
        )}
        <BSInput label="Outcome / Decision" value={data.outcome} onChange={v => update('outcome', v)} placeholder="e.g. No conflict — accepted / Conflict noted — full disclosure made / Declined" />
        <BSInput label="Notes" value={data.notes} onChange={v => update('notes', v)} placeholder="Any notes on safeguards, disclosures made, or authority sought" multiline rows={2} />
      </BSSection>
    </div>
  );
}

// ── 2. WITNESS MANAGEMENT ────────────────────────────────────────────────────

function BSWitnesses({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
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
    await ai.run(prompt);
  }

  const STATUS_OPTS = ['Pending', 'In Preparation', 'Ready', 'Testified', 'Withdrawn'];

  if (!ready) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <BSSection title="Witnesses">
          {witnesses.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No witnesses added yet.</p>}
          {witnesses.map(w => (
            <div key={w.id} onClick={() => { setSelected(w.id); setForm(w); ai.setResult(''); }}
              style={{
                background: selected === w.id ? '#0d0d1c' : '#070710',
                border: `1px solid ${selected === w.id ? T.gold : '#111120'}`,
                borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer',
              }}>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Cormorant Garamond',serif", fontWeight: 500 }}>{w.name || 'Unnamed Witness'}</div>
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
                  style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
                  <option value="ours">Our Witness</option>
                  <option value="opposing">Opposing Witness</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Status</label>
                <select value={form.status} onChange={e => updateW(form.id, 'status', e.target.value)}
                  style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
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

function BSCounsel({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
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
    await ai.run(prompt);
  }

  if (!ready) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <BSSection title="Opposing Counsel">
          {profiles.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No profiles yet.</p>}
          {profiles.map(p => (
            <div key={p.id} onClick={() => { setSelected(p.id); setForm(p); ai.setResult(''); }}
              style={{ background: selected === p.id ? '#0d0d1c' : '#070710', border: `1px solid ${selected === p.id ? T.gold : '#111120'}`, borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer' }}>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Cormorant Garamond',serif" }}>{p.name || 'Unnamed Counsel'}</div>
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

function BSJudge({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
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
    await ai.run(prompt);
  }

  if (!ready) return null;

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

// ── 5. SETTLEMENT TRACKER + BATNA ────────────────────────────────────────────

function BSSettlement({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [data, setData] = useState<SettlementData>({
    clientAuthority: '', batna: '', latna: '', claimValue: '', offers: [], status: 'Open', notes: '',
  });
  const [ready, setReady] = useState(false);
  const [offerText, setOfferText] = useState('');
  const [offerSide, setOfferSide] = useState<'ours' | 'theirs'>('ours');
  const [offerAmt, setOfferAmt] = useState('');
  const ai = useAI();

  useEffect(() => {
    loadBlindSpot<SettlementData>(caseId, 'settlement', {
      clientAuthority: '', batna: '', latna: '', claimValue: '', offers: [], status: 'Open', notes: '',
    }).then(d => { setData(d); setReady(true); });
  }, [caseId]);

  function update(field: keyof SettlementData, val: unknown) {
    const d = { ...data, [field]: val };
    setData(d);
    saveBlindSpot(caseId, 'settlement', d);
  }

  function addOffer() {
    if (!offerText.trim()) return;
    const offer: SettlementOffer = {
      id: uid(), side: offerSide, amount: offerAmt,
      description: offerText, date: new Date().toISOString(), status: 'Live',
    };
    update('offers', [...(data.offers || []), offer]);
    setOfferText(''); setOfferAmt('');
  }

  function updateOfferStatus(id: string, status: SettlementOffer['status']) {
    update('offers', (data.offers || []).map(o => o.id === id ? { ...o, status } : o));
  }

  async function runBatna() {
    const liveOffers = (data.offers || []).filter(o => o.status === 'Live');
    const prompt = `You are a senior Nigerian litigation strategist advising on a settlement decision. Conduct a realistic BATNA analysis.

CASE: ${activeCase.caseName || 'Unnamed'} (${activeCase.counsel_role ? activeCase.counsel_role.replace(/_/g,' ') : (activeCase.role || '')} | ${activeCase.matter_track || 'civil'})
CLAIM VALUE: ${data.claimValue || 'Not quantified'}
CLIENT'S SETTLEMENT AUTHORITY: ${data.clientAuthority || 'Not specified'}
BATNA: ${data.batna || 'Not specified'}
LIKELIHOOD OF ACHIEVING BATNA: ${data.latna || 'Not specified'}

LIVE OFFERS ON TABLE:
${liveOffers.length
  ? liveOffers.map((o, i) => `${i + 1}. ${o.side === 'ours' ? 'Our offer' : 'Their offer'}: ${o.amount || 'Amount not stated'} — ${o.description}`).join('\n')
  : 'No live offers'}

Provide:
1. SETTLEMENT VIABILITY RATING — Should we be at the table? Realistic assessment.
2. BATNA QUALITY — How good is the alternative to settlement? Honest probability.
3. WALK-AWAY POINT — The minimum/maximum our client should accept/offer, and why
4. NEGOTIATION STRATEGY — Specific tactics for the next negotiation session
5. WARNING FLAGS — Signs the other side is negotiating in bad faith or stalling
6. RECOMMENDATION — Settle now / Hold / Counter at [X] / Reject and proceed

Be ruthlessly honest about litigation risk.`;
    await ai.run(prompt);
  }

  const STATUS_COLOURS: Record<string, string> = {
    Live: '#c4a030', Accepted: '#30a050', Rejected: '#c05050', Lapsed: '#505060',
  };

  if (!ready) return null;

  return (
    <div>
      <BSSection title="🤝 Settlement Negotiation Tracker + BATNA Analysis">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <BSInput label="Claim / Case Value" value={data.claimValue} onChange={v => update('claimValue', v)} placeholder="e.g. ₦50,000,000 general and special damages" />
          <BSInput label="Client's Settlement Authority" value={data.clientAuthority} onChange={v => update('clientAuthority', v)} placeholder="The minimum/maximum the client has authorised" />
        </div>
        <BSInput label="BATNA — Best Alternative to Negotiated Agreement" value={data.batna} onChange={v => update('batna', v)} placeholder="What happens if we don't settle? What is the realistic court outcome? Timeline? Cost?" multiline rows={3} />
        <BSInput label="Likelihood of Achieving BATNA (realistic probability)" value={data.latna} onChange={v => update('latna', v)} placeholder="e.g. 70% chance of full judgment / 40% chance of partial award" />
        <BSInput label="Status" value={data.status} onChange={v => update('status', v)} placeholder="e.g. Open / In negotiation / Deadlocked / Closed" />
      </BSSection>

      <BSSection title="Offer Log">
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 120px auto', gap: 8, alignItems: 'end', marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Side</label>
            <select value={offerSide} onChange={e => setOfferSide(e.target.value as 'ours' | 'theirs')}
              style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 10px', fontSize: 13, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
              <option value="ours">Ours</option>
              <option value="theirs">Theirs</option>
            </select>
          </div>
          <BSInput label="Description" value={offerText} onChange={setOfferText} placeholder="Describe the offer / counter-offer / terms" />
          <BSInput label="Amount / Value" value={offerAmt} onChange={setOfferAmt} placeholder="e.g. ₦10M" />
          <div><BSBtn onClick={addOffer} small>Log Offer</BSBtn></div>
        </div>
        {(data.offers || []).length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No offers logged yet.</p>}
        {[...(data.offers || [])].reverse().map(o => (
          <div key={o.id} style={{ background: '#070710', border: '1px solid #111120', borderRadius: 5, padding: '10px 14px', marginBottom: 7, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.06em', color: o.side === 'ours' ? T.gold : '#9080c0', textTransform: 'uppercase' }}>{o.side === 'ours' ? 'Our Offer' : 'Their Offer'}</span>
                {o.amount && <span style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter,sans-serif' }}>{o.amount}</span>}
                <span style={{ fontSize: 10, fontFamily: 'Inter,sans-serif', color: '#303040' }}>{new Date(o.date).toLocaleDateString('en-GB')}</span>
              </div>
              <div style={{ fontSize: 14, color: T.text, fontFamily: "'Cormorant Garamond',serif" }}>{o.description}</div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap' }}>
              {(['Live', 'Accepted', 'Rejected', 'Lapsed'] as const).map(s => (
                <button key={s} onClick={() => updateOfferStatus(o.id, s)}
                  style={{ fontSize: 9, padding: '3px 7px', borderRadius: 3, border: `1px solid ${o.status === s ? STATUS_COLOURS[s] : '#1e1e2e'}`, background: o.status === s ? STATUS_COLOURS[s] + '22' : 'transparent', color: o.status === s ? STATUS_COLOURS[s] : '#404050', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))}
      </BSSection>

      <BSSection title="BATNA Analysis">
        <BSBtn onClick={runBatna} disabled={ai.loading}>Run BATNA / Settlement Analysis →</BSBtn>
        <BSAIBlock loading={ai.loading} result={ai.result} error={ai.error} />
      </BSSection>

      <BSSection title="Notes">
        <BSInput value={data.notes} onChange={v => update('notes', v)} placeholder="Negotiation history, client instructions, authority limits, red lines..." multiline rows={4} />
      </BSSection>
    </div>
  );
}

// ── 6. CLIENT COMMUNICATION LOG ──────────────────────────────────────────────

function BSComms({ caseId }: { caseId: string }) {
  const [comms, setComms] = useState<CommEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [type, setType] = useState('Call');
  const [summary, setSummary] = useState('');
  const [instructions, setInstructions] = useState('');
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    loadBlindSpot<CommEntry[]>(caseId, 'comms', []).then(d => {
      setComms(d); setReady(true);
    });
  }, [caseId]);

  function save(list: CommEntry[]) {
    setComms(list);
    saveBlindSpot(caseId, 'comms', list);
  }

  function addComm() {
    if (!summary.trim()) return;
    const c: CommEntry = { id: uid(), type, summary, instructions, date: new Date().toISOString(), flagged: false };
    save([c, ...comms]);
    setSummary(''); setInstructions('');
  }

  function toggleFlag(id: string) {
    save(comms.map(c => c.id === id ? { ...c, flagged: !c.flagged } : c));
  }

  function deleteComm(id: string) {
    if (!confirm('Delete this log entry?')) return;
    save(comms.filter(c => c.id !== id));
  }

  const TYPES = ['Call', 'Meeting', 'Email', 'Letter', 'WhatsApp', 'Instructions', 'Update', 'Other'];
  const filtered = filter === 'All' ? comms : filter === 'Flagged' ? comms.filter(c => c.flagged) : comms.filter(c => c.type === filter);

  if (!ready) return null;

  return (
    <div>
      <BSSection title="💬 Client Communication Log — What Was Said, What Was Instructed">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', lineHeight: 1.7, marginBottom: 14 }}>
          This log protects you from client disputes about what was agreed, what advice was given, and what was instructed. Record everything material.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 12px', fontSize: 14, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <BSInput label="Summary of Communication" value={summary} onChange={setSummary} placeholder="What was discussed, what advice was given, what was communicated to the client" />
        </div>
        <BSInput label="Instructions Given by Client (if any)" value={instructions} onChange={setInstructions} placeholder="What the client specifically instructed. 'Client authorised us to proceed with settlement at X.'" multiline rows={2} />
        <div style={{ marginTop: 10 }}>
          <BSBtn onClick={addComm} small disabled={!summary.trim()}>Log Communication</BSBtn>
        </div>
      </BSSection>

      <BSSection title={`Communication Log (${comms.length} entries)`}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {['All', 'Flagged', ...TYPES].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ fontSize: 10, padding: '4px 10px', borderRadius: 3, border: `1px solid ${filter === f ? T.gold : '#1e1e2e'}`, background: filter === f ? '#0d0d1c' : 'transparent', color: filter === f ? T.gold : '#404050', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.04em' }}>
              {f}
            </button>
          ))}
        </div>
        {filtered.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No entries{filter !== 'All' ? ` matching "${filter}"` : ''} yet.</p>}
        {filtered.map(c => (
          <div key={c.id} style={{ background: c.flagged ? '#0d0a00' : '#070710', border: `1px solid ${c.flagged ? '#3a2808' : '#111120'}`, borderRadius: 5, padding: '12px 16px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.06em', color: T.gold, textTransform: 'uppercase' }}>{c.type}</span>
                <span style={{ fontSize: 11, color: '#303040', fontFamily: 'Inter,sans-serif' }}>{new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {c.flagged && <span style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.08em' }}>★ FLAGGED</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => toggleFlag(c.id)} style={{ fontSize: 11, background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}>★</button>
                <button onClick={() => deleteComm(c.id)} style={{ fontSize: 11, background: 'transparent', border: '1px solid #2a1010', color: '#604040', borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: 15, color: T.text, fontFamily: "'Cormorant Garamond',serif", lineHeight: 1.75, marginBottom: c.instructions ? 8 : 0 }}>{c.summary}</div>
            {c.instructions && (
              <div style={{ fontSize: 13, color: '#9a8a6a', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', borderTop: '1px solid #151515', paddingTop: 7, marginTop: 7 }}>
                <span style={{ fontSize: 10, fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.06em', color: '#504030', textTransform: 'uppercase', fontStyle: 'normal', marginRight: 8 }}>Instructions</span>
                {c.instructions}
              </div>
            )}
          </div>
        ))}
      </BSSection>
    </div>
  );
}

// ── 7. INTERLOCUTORY APPLICATIONS TRACKER ────────────────────────────────────

function BSInterlocutory({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [apps, setApps] = useState<InterlockApp[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<InterlockApp | null>(null);
  const ai = useAI();

  useEffect(() => {
    loadBlindSpot<InterlockApp[]>(caseId, 'interlocutory', []).then(d => {
      setApps(d); setReady(true);
    });
  }, [caseId]);

  function save(list: InterlockApp[]) {
    setApps(list);
    saveBlindSpot(caseId, 'interlocutory', list);
  }

  function addApp() {
    const a: InterlockApp = {
      id: uid(), title: '', mover: 'ours', type: 'Motion on Notice',
      reliefSought: '', filingDate: '', hearingDate: '', status: 'Pending',
      outcome: '', affectsMainSuit: false, notes: '',
    };
    const list = [...apps, a];
    save(list); setForm(a); setSelected(a.id); ai.setResult('');
  }

  function updateA(id: string, field: keyof InterlockApp, val: unknown) {
    const list = apps.map(a => a.id === id ? { ...a, [field]: val } : a);
    save(list); setForm(list.find(a => a.id === id) ?? null);
  }

  function deleteA(id: string) {
    save(apps.filter(a => a.id !== id));
    setSelected(null); setForm(null);
  }

  async function analyseApp() {
    if (!form) return;
    const prompt = `You are a senior Nigerian litigation advocate. Analyse this interlocutory application.

CASE: ${activeCase.caseName || 'Unnamed'} (${activeCase.counsel_role ? activeCase.counsel_role.replace(/_/g,' ') : (activeCase.role || '')} | ${activeCase.matter_track || 'civil'})
APPLICATION: ${form.title || 'Not titled'}
MOVER: ${form.mover === 'ours' ? 'We are moving' : 'Opposing party is moving'}
TYPE: ${form.type}
RELIEF SOUGHT: ${form.reliefSought || 'Not specified'}
STATUS: ${form.status}
OUTCOME SO FAR: ${form.outcome || 'None recorded'}
AFFECTS MAIN SUIT: ${form.affectsMainSuit ? 'Yes' : 'No'}

Advise:
1. STRATEGIC SIGNIFICANCE — How important is this application to the main suit?
2. CURRENT POSTURE ASSESSMENT — Based on the status and outcome so far, where do we stand?
3. NEXT STEPS — The immediate actions required on this application
4. RISKS IF WE LOSE — What happens to the main suit if this application goes against us?
5. AUTHORITIES — Key Nigerian cases and procedural rules governing this type of application
6. WHAT TO WATCH — The landmine on this application that most lawyers miss

Be precise.`;
    await ai.run(prompt);
  }

  const STATUSES = ['Pending', 'Filed', 'Heard', 'Adjourned', 'Granted', 'Dismissed', 'Withdrawn', 'Appealed'];
  const APP_TYPES = ['Motion on Notice', 'Ex-Parte Application', 'Substantive Motion', 'Preliminary Objection', 'Application to Strike Out', 'Application to Amend', 'Application for Adjournment', 'Application for Stay', 'Other'];
  const STATUS_COL: Record<string, string> = { Pending: '#5a5a72', Filed: '#3a6090', Heard: '#7a6030', Adjourned: '#5a4020', Granted: '#306050', Dismissed: '#6a2020', Withdrawn: '#404050', Appealed: '#5a3080' };

  if (!ready) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <BSSection title="Applications">
          {apps.length === 0 && <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif' }}>No applications tracked yet.</p>}
          {apps.map(a => (
            <div key={a.id} onClick={() => { setSelected(a.id); setForm(a); ai.setResult(''); }}
              style={{ background: selected === a.id ? '#0d0d1c' : '#070710', border: `1px solid ${selected === a.id ? T.gold : '#111120'}`, borderRadius: 5, padding: '9px 12px', marginBottom: 6, cursor: 'pointer' }}>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Cormorant Garamond',serif", fontWeight: 500, marginBottom: 3 }}>{a.title || 'Unnamed Application'}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontFamily: 'Inter,sans-serif', fontWeight: 600, letterSpacing: '.05em', color: STATUS_COL[a.status] || T.mute, textTransform: 'uppercase' }}>{a.status}</span>
                <span style={{ fontSize: 10, color: '#303040', fontFamily: 'Inter,sans-serif' }}>{a.mover === 'ours' ? 'We move' : 'Opp. moves'}</span>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}><BSBtn onClick={addApp} small variant="ghost">+ Add Application</BSBtn></div>
        </BSSection>
      </div>

      <div>
        {!form ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: T.mute, fontFamily: 'Inter,sans-serif', fontSize: 13 }}>Select or add an application to track.</div>
        ) : (
          <BSSection title={form.title || 'New Application'}>
            <BSInput label="Application Title" value={form.title} onChange={v => updateA(form.id, 'title', v)} placeholder="e.g. Motion for Interlocutory Injunction to restrain..." />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Mover</label>
                <select value={form.mover} onChange={e => updateA(form.id, 'mover', e.target.value)}
                  style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 10px', fontSize: 13, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
                  <option value="ours">We Move</option>
                  <option value="opposing">Opp. Moves</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Status</label>
                <select value={form.status} onChange={e => updateA(form.id, 'status', e.target.value)}
                  style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 10px', fontSize: 13, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#5a5a72', fontFamily: 'Inter,sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5 }}>Type</label>
                <select value={form.type} onChange={e => updateA(form.id, 'type', e.target.value)}
                  style={{ width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5, color: T.text, padding: '10px 10px', fontSize: 13, fontFamily: "'Cormorant Garamond',serif", outline: 'none' }}>
                  {APP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <BSInput label="Relief Sought" value={form.reliefSought} onChange={v => updateA(form.id, 'reliefSought', v)} placeholder="The specific prayer(s) in the application" multiline rows={2} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <BSInput label="Filing Date" value={form.filingDate} onChange={v => updateA(form.id, 'filingDate', v)} placeholder="DD/MM/YYYY" />
              <BSInput label="Hearing Date" value={form.hearingDate} onChange={v => updateA(form.id, 'hearingDate', v)} placeholder="DD/MM/YYYY" />
            </div>
            <BSInput label="Outcome / Ruling" value={form.outcome} onChange={v => updateA(form.id, 'outcome', v)} placeholder="Court's ruling or current position on this application" multiline rows={2} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input type="checkbox" id={`afs_affects_${form.id}`} checked={!!form.affectsMainSuit}
                onChange={e => updateA(form.id, 'affectsMainSuit', e.target.checked)}
                style={{ accentColor: T.gold, width: 14, height: 14 }} />
              <label htmlFor={`afs_affects_${form.id}`} style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter,sans-serif', cursor: 'pointer' }}>
                This application directly affects the main suit
              </label>
            </div>
            <BSInput label="Notes" value={form.notes} onChange={v => updateA(form.id, 'notes', v)} placeholder="Arguments made, parties' positions, documents filed" multiline rows={2} />
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <BSBtn onClick={analyseApp} disabled={ai.loading}>AI Application Analysis →</BSBtn>
              <BSBtn onClick={() => deleteA(form.id)} variant="danger" small>Delete</BSBtn>
            </div>
            <BSAIBlock loading={ai.loading} result={ai.result} error={ai.error} />
          </BSSection>
        )}
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

const SUB_TABS = [
  { id: 'conflict',       icon: '⚠',  label: 'Conflict Check' },
  { id: 'witnesses',      icon: '👁',  label: 'Witnesses' },
  { id: 'counsel',        icon: '⚔',  label: 'Opp. Counsel' },
  { id: 'judge',          icon: '⚖',  label: 'Judge / Court' },
  { id: 'settlement',     icon: '🤝',  label: 'Settlement' },
  { id: 'comms',          icon: '💬',  label: 'Client Comms' },
  { id: 'interlocutory',  icon: '📋',  label: 'Interlocutory' },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];

export function BlindSpots({ activeCase }: Props) {
  const [sub, setSub] = useState<SubTab>('conflict');
  const caseId = activeCase.id;

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} style={{
            background: sub === t.id ? '#0d0d1c' : 'transparent',
            border: `1px solid ${sub === t.id ? T.gold : '#1e1e2e'}`,
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
      {sub === 'conflict'      && <BSConflict      caseId={caseId} activeCase={activeCase} />}
      {sub === 'witnesses'     && <BSWitnesses     caseId={caseId} activeCase={activeCase} />}
      {sub === 'counsel'       && <BSCounsel       caseId={caseId} activeCase={activeCase} />}
      {sub === 'judge'         && <BSJudge         caseId={caseId} activeCase={activeCase} />}
      {sub === 'settlement'    && <BSSettlement    caseId={caseId} activeCase={activeCase} />}
      {sub === 'comms'         && <BSComms         caseId={caseId} />}
      {sub === 'interlocutory' && <BSInterlocutory caseId={caseId} activeCase={activeCase} />}
    </div>
  );
}
