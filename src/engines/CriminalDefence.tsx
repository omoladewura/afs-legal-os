/**
 * AFS Advocates — Criminal Defence Engine
 * Phase 2 — Full implementation
 *
 * Eight sub-modules, all defence-oriented:
 *  1. Case Intake           — charges, agency, facts, initial analysis
 *  2. Arrest Legality       — constitutional audit, s.35/36 CFRN, ACJA
 *  3. Charge Analyser       — per-count breakdown, defects, jurisdiction
 *  4. Prosecution Evidence  — admissibility attack, counter-evidence
 *  5. Confession Analysis   — voluntariness, cautioning, trial-within-trial
 *  6. Bail Strategy         — bail-ability, arguments, conditions
 *  7. No-Case Submission    — Ajidagba test, per-count no-case analysis
 *  8. Defence Theory        — alibi, denial, duress, self-defence, narrative
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case }        from '@/types';
import { T }                from '@/constants/tokens';
import { useAI }            from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock }   from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

interface EvidenceItem { id: number; type: string; desc: string; }

interface CriminalSaved {
  intakeData?:            IntakeData;
  intakeAnalysis?:        string;
  arrestData?:            ArrestData;
  arrestAnalysis?:        string;
  chargeText?:            string;
  chargeAnalysis?:        string;
  prosEvidence?:          EvidenceItem[];
  prosEvidenceAnalysis?:  string;
  confText?:              string;
  confCircumstances?:     string;
  confAnalysis?:          string;
  bailType?:              string;
  bailOffence?:           string;
  bailFacts?:             string;
  bailAnalysis?:          string;
  noCaseFacts?:           string;
  noCaseAnalysis?:        string;
  defenceTheoryType?:     string;
  defenceTheoryFacts?:    string;
  defenceWitnesses?:      string;
  defenceTheoryAnalysis?: string;
}

interface IntakeData {
  charges: string; agency: string; arrestDate: string;
  facts: string; instructions: string; coAccused: string;
}

interface ArrestData {
  hasWarrant: string; circumstances: string;
  detention: string; counsel: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#070710', border: '1px solid #cccccc',
  borderRadius: 5, color: '#e0dcd0', padding: '11px 14px', fontSize: 15,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.82, minHeight: 110 };
const labelS: React.CSSProperties = {
  fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 6,
};
const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #14141e',
  borderRadius: 8, padding: '20px 22px', marginBottom: 16,
};
const hS: React.CSSProperties = {
  fontSize: 20, color: T.text, fontWeight: 400,
  fontFamily: "'Times New Roman', Times, serif", marginBottom: 6, letterSpacing: '.02em',
};
const dimS: React.CSSProperties = {
  fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  lineHeight: 1.6, marginBottom: 14,
};

function ActionBtn({
  onClick, loading, disabled, label,
}: { onClick: () => void; loading: boolean; disabled?: boolean; label: string }) {
  const off = disabled && !loading;
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background:   loading ? '#101018' : off ? '#101018' : 'linear-gradient(135deg,#000000,#a07820)',
        color:        loading ? '#2a2a38' : off ? '#2a2a38' : '#05050c',
        border:       'none', borderRadius: 6, padding: '13px 28px',
        fontSize: 16, fontFamily: "'Times New Roman', Times, serif",
        cursor:       loading || off ? 'not-allowed' : 'pointer',
        fontWeight:   600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT BLOCK — shared output renderer
// ─────────────────────────────────────────────────────────────────────────────

function ResultBlock({
  title, content, onClear,
}: { title: string; content: string; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div style={{ background: '#060610', border: '1px solid #1e2e1e', borderRadius: 8, padding: '20px 22px', marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: '#508050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>
          {title}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={copy} style={{ background: T.card, border: '1px solid #cccccc', color: copied ? '#60b040' : '#666666', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={onClear} style={{ background: 'none', border: '1px solid #2a1818', color: '#604040', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </div>
      <Md text={content} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

const CRIMINAL_SUB_TABS = [
  { id: 'intake',      icon: '📋', label: 'Case Intake'          },
  { id: 'arrest',      icon: '⛓',  label: 'Arrest Legality'      },
  { id: 'charge',      icon: '§',   label: 'Charge Analyser'      },
  { id: 'evidence',    icon: '🔬', label: 'Prosecution Evidence'  },
  { id: 'confession',  icon: '📜', label: 'Confession Analysis'   },
  { id: 'bail',        icon: '⚖',  label: 'Bail Strategy'        },
  { id: 'nocase',      icon: '✗',   label: 'No-Case Submission'   },
  { id: 'defence',     icon: '🛡',  label: 'Defence Theory'       },
] as const;

type SubTabId = typeof CRIMINAL_SUB_TABS[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const DEFENCE_SYSTEM = `You are the most experienced criminal defence counsel in Nigeria. Your only client is the accused. You are not neutral. Your function is to identify every weakness in the prosecution's case, every constitutional violation, and every path to acquittal or minimum sentence. You have mastery of: ACJA 2015, ACJLs, Criminal Procedure Act, Criminal Procedure Code, Criminal Code Act, Penal Code, EFCC Act, NDLEA Act, Evidence Act 2011, and the CFRN 1999 (as amended). You know Nigerian criminal courts intimately — from Magistrates through the High Court to the Supreme Court. Format your response with clear section headings using ## and ### markers.`;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function CriminalDefence({ activeCase }: Props) {
  const caseId = activeCase?.id ?? 'unknown';

  const [subTab, setSubTab] = useState<SubTabId>('intake');
  const [saved,  setSaved]  = useState<CriminalSaved>({} as CriminalSaved);

  useEffect(() => {
    loadBlindSpot<CriminalSaved>(caseId, 'criminal', {} as CriminalSaved)
      .then(setSaved);
  }, [caseId]);

  const { call, loading, error, clearError } = useAI();

  const save = useCallback((patch: Partial<CriminalSaved>) => {
    setSaved(prev => {
      const next = { ...prev, ...patch };
      saveBlindSpot(caseId, 'criminal', next);
      return next;
    });
  }, [caseId]);

  const isProsecution = activeCase?.counsel_role === 'prosecution';
  const roleLabel = isProsecution ? 'Prosecution Counsel' : 'Defence Counsel';

  function buildCtx(): string {
    const ip = saved.intakeData;
    return [
      `CASE: ${activeCase?.caseName || 'Untitled'} | COURT: ${activeCase?.court || '—'} | ROLE: ${roleLabel}`,
      ip ? `CHARGES: ${ip.charges || 'See intake'} | AGENCY: ${ip.agency || '—'} | ARREST DATE: ${ip.arrestDate || '—'}` : '',
      ip?.facts ? `ALLEGED FACTS: ${ip.facts}` : '',
      ip?.instructions ? `CLIENT INSTRUCTIONS: ${ip.instructions}` : '',
    ].filter(Boolean).join('\n');
  }

  // ── INTAKE ─────────────────────────────────────────────────────────────────

  function IntakePanel() {
    const ip = saved.intakeData || {} as IntakeData;
    const [charges,      setCharges]      = useState(ip.charges      || '');
    const [agency,       setAgency]       = useState(ip.agency       || '');
    const [arrestDate,   setArrestDate]   = useState(ip.arrestDate   || '');
    const [facts,        setFacts]        = useState(ip.facts        || '');
    const [instructions, setInstructions] = useState(ip.instructions || '');
    const [coAccused,    setCoAccused]    = useState(ip.coAccused    || '');

    async function run() {
      if (!charges || !facts) { return; }
      const intakeData: IntakeData = { charges, agency, arrestDate, facts, instructions, coAccused };
      save({ intakeData });
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nCHARGES (with section numbers): ${charges}\nAGENCY: ${agency}\nARREST DATE: ${arrestDate}\nALLEGED FACTS: ${facts}\nCLIENT INSTRUCTIONS: ${instructions}\nCO-ACCUSED: ${coAccused || 'None'}\n\nProvide:\n## 1. Elements of Each Charge\nList every element the prosecution must prove per count.\n\n## 2. Initial Strength Assessment\nRate prosecution's case per count (Strong/Moderate/Weak) with reasons.\n\n## 3. Immediate Defence Flags\nConstitutional concerns, procedural issues, and evidentiary gaps visible at intake.\n\n## 4. Priority Actions\nThe 5 most urgent steps for the defence right now.`,
        maxTokens: 2500,
      });
      if (result) save({ intakeData, intakeAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Criminal Case Intake</p>
          <p style={dimS}>Enter the charges, arresting agency, alleged facts, and client instructions. AI will analyse each charge element, assess prosecution strength, and flag immediate defence priorities.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Charge(s) with Section Numbers</span>
              <textarea value={charges} onChange={e => setCharges(e.target.value)} rows={3}
                placeholder="e.g. Count 1: Armed Robbery — s.1(2)(a) Robbery and Firearms Act&#10;Count 2: Conspiracy — s.97 Criminal Code Act"
                style={{ ...taS, minHeight: 80 }} />
            </div>
            <div>
              <span style={labelS}>Arresting Agency</span>
              <select value={agency} onChange={e => setAgency(e.target.value)} style={{ ...iS, marginBottom: 10 }}>
                <option value="">Select agency…</option>
                {['NPF (Nigeria Police Force)', 'EFCC', 'DSS (State Security Service)', 'NAPTIP', 'NDLEA', 'Customs', 'ICPC', 'Other'].map(a => <option key={a}>{a}</option>)}
              </select>
              <span style={labelS}>Date of Arrest</span>
              <input type="date" value={arrestDate} onChange={e => setArrestDate(e.target.value)} style={iS} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Alleged Facts (prosecution's version)</span>
            <textarea value={facts} onChange={e => setFacts(e.target.value)} rows={5}
              placeholder="Describe what the prosecution alleges happened. Include dates, locations, persons involved, and alleged acts."
              style={taS} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Client's Instructions / Account</span>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={4}
                placeholder="What does the accused say happened? Include alibi, denials, or any exculpatory explanation."
                style={{ ...taS, minHeight: 90 }} />
            </div>
            <div>
              <span style={labelS}>Co-Accused (if any)</span>
              <textarea value={coAccused} onChange={e => setCoAccused(e.target.value)} rows={4}
                placeholder="Names of co-accused, their roles, and whether they have separate counsel."
                style={{ ...taS, minHeight: 90 }} />
            </div>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!charges || !facts} label="⚖ Analyse Charges & Initial Defence Assessment" />
        </div>

        <ErrorBlock message={error} />
        {saved.intakeAnalysis && (
          <ResultBlock title="Charge Analysis & Initial Defence Assessment"
            content={saved.intakeAnalysis}
            onClear={() => { save({ intakeAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── ARREST LEGALITY ────────────────────────────────────────────────────────

  function ArrestLegalityPanel() {
    const al = saved.arrestData || {} as ArrestData;
    const [hasWarrant,    setHasWarrant]    = useState(al.hasWarrant    || '');
    const [circumstances, setCircumstances] = useState(al.circumstances || '');
    const [detention,     setDetention]     = useState(al.detention     || '');
    const [counsel,       setCounsel]       = useState(al.counsel       || '');

    async function run() {
      if (!circumstances) return;
      const arrestData: ArrestData = { hasWarrant, circumstances, detention, counsel };
      save({ arrestData });
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nARREST LEGALITY ANALYSIS\nWas there an arrest warrant? ${hasWarrant}\nCircumstances of arrest: ${circumstances}\nDetention details: ${detention}\nAccess to counsel: ${counsel}\n\n## 1. Warrant Analysis\nWas the arrest lawful — warrant basis or statutory warrantless power (s.24 ACJA)?\n\n## 2. Constitutional Rights Audit\nCheck compliance with Section 35 CFRN (personal liberty), Section 36 (fair hearing), right to be informed, right to remain silent, right to counsel.\n\n## 3. ACJA / ACJL Compliance\nDetention period vs mandatory charge period (24–48 hours rule), bail rights, court appearance timelines.\n\n## 4. Arguable Violations\nList every constitutional and statutory violation with specific section numbers.\n\n## 5. Remedies Available\nFundamental rights enforcement, bail, exclusion of statements obtained in violation, damages.\n\n## 6. Strength of Constitutional Challenge\nRate (Strong/Moderate/Weak) with strategic recommendation.`,
        maxTokens: 2500,
      });
      if (result) save({ arrestData, arrestAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Arrest Legality Analyser</p>
          <p style={dimS}>Analyses constitutional and statutory lawfulness of the arrest. Flags violations of Sections 35 and 36 CFRN, ACJA detention rules, bail rights, and right to counsel.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Was there an Arrest Warrant?</span>
            <select value={hasWarrant} onChange={e => setHasWarrant(e.target.value)} style={{ ...iS, marginBottom: 12 }}>
              <option value="">Select…</option>
              <option>Yes — warrant issued by court</option>
              <option>No — warrantless arrest</option>
              <option>Unknown</option>
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Circumstances of Arrest</span>
            <textarea value={circumstances} onChange={e => setCircumstances(e.target.value)} rows={4}
              placeholder="Describe how and when the accused was arrested. Was it at home, on the street, at a checkpoint? Who effected the arrest? Was the accused shown any warrant? Was the accused told why they were being arrested?"
              style={taS} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Detention & Charging Details</span>
              <textarea value={detention} onChange={e => setDetention(e.target.value)} rows={4}
                placeholder="Date of arrest, date first brought to court, how many days in custody before being charged. Any bail applications made and outcome."
                style={{ ...taS, minHeight: 90 }} />
            </div>
            <div>
              <span style={labelS}>Access to Legal Counsel</span>
              <textarea value={counsel} onChange={e => setCounsel(e.target.value)} rows={4}
                placeholder="When was accused first able to speak with a lawyer? Were requests for counsel denied or delayed? Any statements taken before counsel arrived?"
                style={{ ...taS, minHeight: 90 }} />
            </div>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!circumstances} label="⛓ Analyse Arrest Legality" />
        </div>

        <ErrorBlock message={error} />
        {saved.arrestAnalysis && (
          <ResultBlock title="Arrest Legality Analysis"
            content={saved.arrestAnalysis}
            onClear={() => { save({ arrestAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── CHARGE ANALYSER ────────────────────────────────────────────────────────

  function ChargeAnalyserPanel() {
    const [chargeText, setChargeText] = useState(saved.chargeText || '');

    async function run() {
      if (!chargeText) return;
      save({ chargeText });
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nCHARGE SHEET:\n${chargeText}\n\n## 1. Per-Count Breakdown\nFor each count — the offence charged, the statute, every element the prosecution must prove, the penalty on conviction.\n\n## 2. Defects in Charges\nDuplicity, wrong section cited, wrong court/jurisdiction, misjoinder of accused, vague particulars, missing material averments.\n\n## 3. Burden Map\nFor each element of each count — what evidence must the prosecution adduce? What does the defence need to create reasonable doubt?\n\n## 4. Jurisdiction Analysis\nIs this the proper court? Magistrate vs High Court? Federal vs State court?\n\n## 5. Joinder Issues\nDefective joinder issues with co-accused or counts?\n\n## 6. Recommended Applications\nPreliminary objection to charge, application to quash, motion to sever, request for particulars?`,
        maxTokens: 3000,
      });
      if (result) save({ chargeAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Charge Analyser</p>
          <p style={dimS}>Dissects each count: the offence, the statute, every element the prosecution must prove, defects in drafting, jurisdiction issues, and recommended applications to challenge the charge.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Paste the Charge Sheet / Information</span>
            <textarea value={chargeText} onChange={e => setChargeText(e.target.value)} rows={10}
              placeholder="Paste the full text of the charge sheet or information as filed by the prosecution. Include the preamble, all counts, and the particulars of each offence."
              style={{ ...taS, minHeight: 200 }} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!chargeText} label="§ Analyse Charges" />
        </div>

        <ErrorBlock message={error} />
        {saved.chargeAnalysis && (
          <ResultBlock title="Charge Analysis"
            content={saved.chargeAnalysis}
            onClear={() => { save({ chargeAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── PROSECUTION EVIDENCE ───────────────────────────────────────────────────

  function ProsecutionEvidencePanel() {
    const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>(saved.prosEvidence || []);
    const [eType, setEType] = useState('Confessional Statement');
    const [eDesc, setEDesc] = useState('');

    const EVIDENCE_TYPES = [
      'Confessional Statement', 'Documentary Evidence', 'Electronic Evidence',
      'Witness Evidence', 'Expert Evidence', 'Circumstantial Evidence',
      'Identification Evidence', 'Hearsay',
    ];

    function addEvidence() {
      if (!eDesc.trim()) return;
      const next = [...evidenceList, { id: Date.now(), type: eType, desc: eDesc.trim() }];
      setEvidenceList(next);
      save({ prosEvidence: next });
      setEDesc('');
    }

    function removeEvidence(id: number) {
      const next = evidenceList.filter(e => e.id !== id);
      setEvidenceList(next);
      save({ prosEvidence: next });
    }

    async function analyse() {
      if (!evidenceList.length) return;
      const evList = evidenceList.map((e, i) => `${i + 1}. [${e.type}] ${e.desc}`).join('\n');
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nPROSECUTION EVIDENCE LIST:\n${evList}\n\nFor EACH piece of evidence provide:\n\n## Admissibility Status\nIs this evidence admissible? Relevant provisions of the Evidence Act 2011.\n\n## Attack Strategy\nThe most effective defence challenge (voluntariness, authentication, hearsay rule, s.84 for electronic, Turnbull warning for identification).\n\n## Required Counter-Evidence\nWhat must the defence produce or elicit to neutralise this evidence?\n\n## Strength Rating\nRate for the prosecution: Devastating / Strong / Moderate / Weak / Inadmissible — with explanation.\n\n## Key Applications\nApplications to exclude or limit this evidence (trial-within-trial, voire dire, formal objection, pre-trial motion).`,
        maxTokens: 3000,
      });
      if (result) save({ prosEvidenceAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Prosecution Evidence Tracker</p>
          <p style={dimS}>Log all prosecution evidence by type. AI analyses admissibility, attack strategy, required counter-evidence, and applications to exclude — for each piece of evidence.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, alignItems: 'end', marginBottom: 16 }}>
            <div>
              <span style={labelS}>Evidence Type</span>
              <select value={eType} onChange={e => setEType(e.target.value)} style={iS}>
                {EVIDENCE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <span style={labelS}>Description</span>
              <input value={eDesc} onChange={e => setEDesc(e.target.value)}
                placeholder="Describe this piece of evidence — what it is, what it purports to show"
                style={iS} />
            </div>
            <button onClick={addEvidence} style={{ background: T.card, border: '1px solid #cccccc', color: '#444444', borderRadius: 5, padding: '11px 18px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Add
            </button>
          </div>

          {evidenceList.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {evidenceList.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: '#060610', border: '1px solid #111120', borderRadius: 5, marginBottom: 7 }}>
                  <span style={{ fontSize: 10, color: '#444444', fontFamily: "'Times New Roman', Times, serif", border: '1px solid #3a2208', padding: '2px 8px', borderRadius: 2, letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{e.type}</span>
                  <span style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", flex: 1 }}>{e.desc}</span>
                  <button onClick={() => removeEvidence(e.id)} style={{ background: 'none', border: 'none', color: T.mute, cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <ActionBtn onClick={analyse} loading={loading} disabled={!evidenceList.length} label="🔬 Analyse All Prosecution Evidence" />
        </div>

        <ErrorBlock message={error} />
        {saved.prosEvidenceAnalysis && (
          <ResultBlock title="Prosecution Evidence Analysis"
            content={saved.prosEvidenceAnalysis}
            onClear={() => { save({ prosEvidenceAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── CONFESSION ANALYSIS ────────────────────────────────────────────────────

  function ConfessionPanel() {
    const [confText,       setConfText]       = useState(saved.confText          || '');
    const [confCircumstances, setConfCircumstances] = useState(saved.confCircumstances || '');

    async function run() {
      if (!confText && !confCircumstances) return;
      save({ confText, confCircumstances });
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nCONFESSIONAL STATEMENT TEXT:\n${confText || '[Not pasted — see circumstances below]'}\n\nCIRCUMSTANCES OF TAKING:\n${confCircumstances}\n\n## 1. Voluntariness Analysis\nWas this statement free from inducement, threat, or promise? Apply Sections 28 and 29 Evidence Act 2011. Identify every indicator of involuntariness.\n\n## 2. Cautioning Compliance\nWas proper caution administered? Right to remain silent. Right to legal representation at the time.\n\n## 3. Timing & Custody\nTime of statement relative to arrest. Was the accused in unlawful detention when the statement was taken?\n\n## 4. Consistency Check\nInternal contradictions? Facts inconsistent with other prosecution evidence? Corroboration analysis.\n\n## 5. Retraction Strategy\nRetraction strategy and the evidentiary weight of retraction under Nigerian law.\n\n## 6. Trial-Within-Trial\nIs a trial-within-trial warranted? Legal basis, procedure under ACJA/Evidence Act, and witnesses to call.\n\n## 7. Overall Admissibility Rating\nWill this statement likely be admitted? Arguments for exclusion rated by strength.`,
        maxTokens: 2800,
      });
      if (result) save({ confText, confCircumstances, confAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Confession Analysis Panel</p>
          <p style={dimS}>Dedicated attack on confessional statements. Analyses voluntariness, proper cautioning, timing, consistency, and builds the trial-within-trial strategy.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Confessional Statement Text (paste if available)</span>
            <textarea value={confText} onChange={e => setConfText(e.target.value)} rows={8}
              placeholder="Paste the full text of the confessional statement as recorded. Include the heading, body, and jurat/signature section."
              style={{ ...taS, minHeight: 160 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Circumstances of Taking the Statement</span>
            <textarea value={confCircumstances} onChange={e => setConfCircumstances(e.target.value)} rows={5}
              placeholder="When was the statement taken? Was the accused cautioned? Was counsel present? Were there allegations of duress, inducement, or threats? Any injuries visible?"
              style={taS} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!confText && !confCircumstances} label="📜 Analyse Confession & Build Attack Strategy" />
        </div>

        <ErrorBlock message={error} />
        {saved.confAnalysis && (
          <ResultBlock title="Confession Analysis"
            content={saved.confAnalysis}
            onClear={() => { save({ confAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── BAIL STRATEGY ──────────────────────────────────────────────────────────

  function BailStrategyPanel() {
    const [bailType,  setBailType]  = useState(saved.bailType    || 'Bail Pending Trial');
    const [offence,   setOffence]   = useState(saved.bailOffence || '');
    const [facts,     setBailFacts] = useState(saved.bailFacts   || '');

    async function run() {
      if (!offence) return;
      save({ bailType, bailOffence: offence, bailFacts: facts });
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nBAIL APPLICATION TYPE: ${bailType}\nOFFENCE CATEGORY: ${offence}\nRELEVANT FACTS FOR BAIL: ${facts}\n\n## 1. Bail-ability Analysis\nIs this offence bailable as of right (Part 7 ACJA) or discretionary? Statutory provisions.\n\n## 2. Arguments for Bail\nNature of offence, prosecution case strength, flight risk rebuttal, community ties, health, lengthy detention, cooperative attitude, family responsibilities.\n\n## 3. Arguments to Rebut\nAnticipate prosecution's bail opposition and how to counter each point.\n\n## 4. Conditions to Propose\nRealistic bail conditions — sureties, passport deposit, reporting obligations, amount — calibrated to the court.\n\n## 5. Exceptional Circumstances\nFor capital/serious offences — build the exceptional circumstances argument (Dokubo-Asari test).\n\n## 6. Surety Strategy\nHow many sureties, what class, what conditions to propose.\n\n## 7. Draft Arguments\n3 key paragraphs of oral argument for the bail application.`,
        maxTokens: 2500,
      });
      if (result) save({ bailType, bailOffence: offence, bailFacts: facts, bailAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Bail Strategy Builder</p>
          <p style={dimS}>Generates bail arguments for trial or appeal. Analyses bail-ability, builds arguments, anticipates prosecution opposition, and drafts oral submission paragraphs.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Type of Bail Application</span>
              <select value={bailType} onChange={e => setBailType(e.target.value)} style={iS}>
                <option>Bail Pending Trial</option>
                <option>Bail Pending Appeal</option>
                <option>Bail Variation / Review</option>
              </select>
            </div>
            <div>
              <span style={labelS}>Offence Category</span>
              <select value={offence} onChange={e => setOffence(e.target.value)} style={iS}>
                <option value="">Select…</option>
                {[
                  'Summary offence (Magistrate Court)',
                  'Non-capital felony (High Court)',
                  'Capital offence (murder, armed robbery)',
                  'Economic offence (EFCC/ICPC)',
                  'Drug offence (NDLEA)',
                  'Terrorism offence',
                  'Electoral offence',
                  'Cybercrime offence',
                ].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Key Facts for Bail (client background, health, ties to jurisdiction)</span>
            <textarea value={facts} onChange={e => setBailFacts(e.target.value)} rows={5}
              placeholder="Occupation, family situation, time in custody, health issues, passport status, previous bail record, any concerns prosecution may raise about absconding or witness interference."
              style={taS} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!offence} label="⚖ Build Bail Strategy & Arguments" />
        </div>

        <ErrorBlock message={error} />
        {saved.bailAnalysis && (
          <ResultBlock title="Bail Strategy"
            content={saved.bailAnalysis}
            onClear={() => { save({ bailAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── NO-CASE SUBMISSION ─────────────────────────────────────────────────────

  function NoCasePanel() {
    const [prosecutionCase, setProsecutionCase] = useState(saved.noCaseFacts || '');

    async function run() {
      if (!prosecutionCase) return;
      save({ noCaseFacts: prosecutionCase });
      const charges = saved.intakeData?.charges || saved.chargeText || '';
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nCHARGES: ${charges}\n\nPROSECUTION'S CASE AT CLOSE:\n${prosecutionCase}\n\n## 1. Legal Test\nState the applicable Nigerian no-case standard — Ajidagba v State, Ibeziako v COP, and the current Supreme Court position. Is this the "prima facie case" test or the "no evidence" test?\n\n## 2. Per-Count Analysis\nFor each count — has the prosecution established a prima facie case on EVERY element? Identify specifically which elements have not been proved.\n\n## 3. Evidence Failures\nFor each count where no-case lies — which witnesses failed to prove which elements? Which documents were not properly admitted? Which evidence was excluded?\n\n## 4. Submission Structure\nDraft the structure of the no-case submission — introduction, law, analysis per count, conclusion, relief sought.\n\n## 5. Tactical Assessment\nShould we submit no-case or go into defence? Risk of going into defence? Recommendation with reasons.\n\n## 6. Draft Opening Paragraph\nDraft the first paragraph of the submission as it would be delivered in court.`,
        maxTokens: 3000,
      });
      if (result) save({ noCaseAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>No-Case Submission Builder</p>
          <p style={dimS}>At the close of prosecution's case — analyses whether a prima facie case has been made out on each count. Applies the Ajidagba test and drafts the submission structure.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Prosecution's Case at Close — Summary of Evidence Adduced</span>
            <textarea value={prosecutionCase} onChange={e => setProsecutionCase(e.target.value)} rows={10}
              placeholder="Summarise the prosecution's case as it stands at close of evidence. List each witness and what they testified to, each document tendered and admitted (or rejected), the key facts the prosecution claims to have proved."
              style={{ ...taS, minHeight: 200 }} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!prosecutionCase} label="✗ Build No-Case Submission" />
        </div>

        <ErrorBlock message={error} />
        {saved.noCaseAnalysis && (
          <ResultBlock title="No-Case Submission Analysis"
            content={saved.noCaseAnalysis}
            onClear={() => { save({ noCaseAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── DEFENCE THEORY ─────────────────────────────────────────────────────────

  function DefenceTheoryPanel() {
    const [theory,    setTheory]    = useState(saved.defenceTheoryType  || '');
    const [facts,     setFacts]     = useState(saved.defenceTheoryFacts || '');
    const [witnesses, setWitnesses] = useState(saved.defenceWitnesses   || '');

    const THEORIES = [
      'Alibi', 'Complete Denial', 'Duress / Compulsion', 'Self-Defence',
      'Defence of Another', 'Consent', 'Mistake of Fact', 'Lack of Mens Rea',
      'Entrapment', 'Insanity / Mental Disorder', 'Provocation (partial defence)',
      'Diminished Responsibility', 'Impossibility', 'Mixed — Multiple Defences',
    ];

    async function run() {
      if (!theory || !facts) return;
      save({ defenceTheoryType: theory, defenceTheoryFacts: facts, defenceWitnesses: witnesses });
      const charges = saved.intakeData?.charges || saved.chargeText || '';
      const result = await call({
        system: DEFENCE_SYSTEM,
        userMsg: `${buildCtx()}\n\nCHARGES: ${charges}\nDEFENCE THEORY: ${theory}\nFACTS SUPPORTING DEFENCE: ${facts}\nAVAILABLE WITNESSES: ${witnesses || 'Not specified'}\n\n## 1. Theory Viability\nHow strong is this defence theory given the charges and available facts? Rate (Strong/Moderate/Weak) with reasons.\n\n## 2. Elements to Establish\nWhat must the defence prove or raise? Evidential burden vs legal burden.\n\n## 3. Evidence Map\nMap each available fact and witness to the element of the defence it supports.\n\n## 4. Gaps in the Defence\nWhat is missing? What evidence must still be obtained? What witnesses are critical?\n\n## 5. Prosecution Counter-Attack\nHow will the prosecution attack this theory? How does the defence rebut each anticipated attack?\n\n## 6. Case Theory Narrative\nDraft a 200-word case theory narrative — the story the defence will tell from opening to closing.\n\n## 7. Strategic Integration\nHow does this defence theory integrate with: the no-case submission strategy, cross-examination priorities, and any constitutional arguments already made?`,
        maxTokens: 3000,
      });
      if (result) save({ defenceTheoryType: theory, defenceTheoryFacts: facts, defenceWitnesses: witnesses, defenceTheoryAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Defence Theory Builder</p>
          <p style={dimS}>Constructs the overall defence theory — alibi, denial, duress, self-defence, mistake of fact, lack of mens rea. Maps theory to evidence, identifies gaps, and drafts the case narrative.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Primary Defence Theory</span>
              <select value={theory} onChange={e => setTheory(e.target.value)} style={iS}>
                <option value="">Select theory…</option>
                {THEORIES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <span style={labelS}>Available Defence Witnesses</span>
              <textarea value={witnesses} onChange={e => setWitnesses(e.target.value)} rows={3}
                placeholder="List witnesses available to the defence — names and what they can testify to."
                style={{ ...taS, minHeight: 78 }} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Facts Supporting the Defence Theory</span>
            <textarea value={facts} onChange={e => setFacts(e.target.value)} rows={6}
              placeholder="Describe all facts, evidence, and circumstances that support the chosen defence theory. Include the client's account, corroborating evidence, alibi details, or any exculpatory information."
              style={taS} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!theory || !facts} label="🛡 Build Defence Theory" />
        </div>

        <ErrorBlock message={error} />
        {saved.defenceTheoryAnalysis && (
          <ResultBlock title="Defence Theory"
            content={saved.defenceTheoryAnalysis}
            onClear={() => { save({ defenceTheoryAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const panels: Record<SubTabId, React.ReactNode> = {
    intake:     <IntakePanel />,
    arrest:     <ArrestLegalityPanel />,
    charge:     <ChargeAnalyserPanel />,
    evidence:   <ProsecutionEvidencePanel />,
    confession: <ConfessionPanel />,
    bail:       <BailStrategyPanel />,
    nocase:     <NoCasePanel />,
    defence:    <DefenceTheoryPanel />,
  };

  return (
    <div style={{ padding: '24px 0', animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, border: '1px solid #3a2208', padding: '3px 10px', borderRadius: 2 }}>
            {isProsecution ? 'Criminal — Prosecution View' : 'Criminal Defence'}
          </span>
          <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase' }}>
            {isProsecution
              ? 'Prosecution Counsel · Evidence Review · Conviction Strategy'
              : 'Defence-Oriented · Prosecution Attack · Acquittal Strategy'}
          </span>
        </div>
        <h2 style={{ fontSize: 28, color: T.text, fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', margin: 0 }}>
          {isProsecution ? 'Criminal Prosecution View' : 'Criminal Defence Engine'}
        </h2>
        <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginTop: 6, maxWidth: 700 }}>
          {isProsecution
            ? 'This matter is assigned to Prosecution Counsel. The tools below remain available for charge review, evidence assessment, and strategy — framed from the prosecution perspective.'
            : 'Dedicated criminal defence intelligence for Nigerian criminal courts. Charge analysis, arrest legality audits, prosecution evidence attack, confession analysis, bail strategy, no-case submissions, and defence theory construction. Always defence-oriented.'}
        </p>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24, borderBottom: '1px solid #12121e', paddingBottom: 12 }}>
        {CRIMINAL_SUB_TABS.map(st => (
          <button
            key={st.id}
            onClick={() => { setSubTab(st.id); clearError(); }}
            style={{
              background:   subTab === st.id ? '#e8e8e8' : 'transparent',
              border:       subTab === st.id ? '1px solid #2a2a3e' : '1px solid transparent',
              color:        subTab === st.id ? T.gold : '#505060',
              borderRadius: 5, padding: '7px 14px', fontSize: 12,
              fontFamily:   "'Times New Roman', Times, serif", cursor: 'pointer',
              letterSpacing: '.06em', fontWeight: 600, transition: 'all .15s',
            }}
          >
            {st.icon} {st.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      {panels[subTab]}

    </div>
  );
}
