/**
 * AFS Legal OS V2 — Charge & Arraignment Engine (Phase 6A)
 *
 * Dual-role criminal engine: the first procedural step after a matter is
 * opened on the criminal track.
 *
 * PROSECUTION sub-tabs:
 *   1. Charge Builder     — draft counts, validate offences and sections
 *   2. Count Validator    — jurisdiction, sentencing power, sufficiency of particulars
 *   3. Arraignment Record — accused present, charge read, plea noted
 *
 * DEFENCE sub-tabs:
 *   1. Charge Defect Analyser — duplicity, jurisdiction, missing particulars, misjoinder
 *   2. Preliminary Objection  — grounds generator and draft
 *   3. Arraignment Tracker    — confirmation, bail outcome
 *
 * counsel_role governs which sub-tabs and AI prompts are active.
 * matter_track is always 'criminal' for this engine.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type ProsSubTab = 'charge_builder' | 'count_validator' | 'arraignment_record';
type DefSubTab  = 'defect_analyser' | 'preliminary_objection' | 'arraignment_tracker';
type SubTab     = ProsSubTab | DefSubTab;

interface ChargeCount {
  id:        number;
  offence:   string;
  section:   string;
  statute:   string;
  date:      string;
  place:     string;
  accused:   string;
  manner:    string;
}

interface SavedData {
  // Prosecution
  counts?:              ChargeCount[];
  chargeNarrative?:     string;
  validationResult?:    string;
  arraignmentPros?:     ArraignmentPros;
  arraignmentAnalysis?: string;
  // Defence
  chargeText?:          string;
  defectAnalysis?:      string;
  objGrounds?:          string;
  objDraft?:            string;
  arraignmentDef?:      ArraignmentDef;
  arraignmentDefNotes?: string;
}

interface ArraignmentPros {
  date: string; accusedPresent: string; chargeRead: string;
  interpreterUsed: string; pleaTaken: string; bailOutcome: string; notes: string;
}
interface ArraignmentDef {
  date: string; properArraignment: string; plea: string;
  bailApplied: string; bailGranted: string; suretyConditions: string; remandExpiry: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#070710', border: '1px solid #cccccc',
  borderRadius: 5, color: '#e0dcd0', padding: '11px 14px', fontSize: 15,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.82, minHeight: 120 };
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

function Btn({
  onClick, loading, disabled, label, accent = '#c09030',
}: { onClick: () => void; loading: boolean; disabled?: boolean; label: string; accent?: string }) {
  const off = disabled && !loading;
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background: loading || off ? '#101018' : `linear-gradient(135deg,#000000,${accent})`,
        color:      loading || off ? '#2a2a38' : '#f0ece0',
        border: 'none', borderRadius: 6, padding: '11px 26px',
        fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
        cursor: loading || off ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function ResultBlock({ title, content, onClear, accent = '#c09030' }: {
  title: string; content: string; onClear: () => void; accent?: string;
}) {
  return (
    <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${accent}30`, borderRadius: 8, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </span>
        <button onClick={onClear} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
          clear ×
        </button>
      </div>
      <Md content={content} />
    </div>
  );
}

function SubTabBar({ tabs, active, onSelect, accent }: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  accent: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24 }}>
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              background:    isActive ? `${accent}18` : 'transparent',
              border:        `1px solid ${isActive ? `${accent}50` : '#cccccc'}`,
              color:         isActive ? accent : '#888888',
              borderRadius:  5,
              padding:       '7px 16px',
              fontSize:      11,
              fontFamily:    "'Times New Roman', Times, serif",
              cursor:        'pointer',
              fontWeight:    600,
              letterSpacing: '.06em',
              transition:    'all .15s',
              whiteSpace:    'nowrap',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

const emptyCount = (): ChargeCount => ({
  id: Date.now(), offence: '', section: '', statute: '',
  date: '', place: '', accused: '', manner: '',
});

function ChargeBuilderTab({
  counts, setCount, narrative, setNarrative, accent, caseRef,
}: {
  counts: ChargeCount[];
  setCount: (fn: (prev: ChargeCount[]) => ChargeCount[]) => void;
  narrative: string;
  setNarrative: (v: string) => void;
  accent: string;
  caseRef: string;
}) {
  const addCount = () => setCount(p => [...p, emptyCount()]);
  const removeCount = (id: number) => setCount(p => p.filter(c => c.id !== id));
  const updateCount = (id: number, field: keyof ChargeCount, value: string) =>
    setCount(p => p.map(c => c.id === id ? { ...c, [field]: value } : c));

  const fields: Array<{ key: keyof ChargeCount; label: string; ph: string }> = [
    { key: 'offence',  label: 'Offence',           ph: 'e.g. Armed Robbery' },
    { key: 'section',  label: 'Section',            ph: 'e.g. s.1(2)(a)' },
    { key: 'statute',  label: 'Statute',            ph: 'e.g. Robbery and Firearms (Special Provisions) Act' },
    { key: 'date',     label: 'Date of Offence',    ph: 'e.g. 14 March 2024' },
    { key: 'place',    label: 'Place of Offence',   ph: 'e.g. No. 5 Broad Street, Lagos' },
    { key: 'accused',  label: 'Accused Named',      ph: 'Names as they appear in the charge' },
    { key: 'manner',   label: 'Manner/Particulars', ph: 'Brief statement of how the offence was committed' },
  ];

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Charge Builder</h3>
        <p style={dimS}>
          Build each count of the charge or information. Every count must specify the
          offence, the statutory provision, the date, the place, and the accused. Vague
          particulars are a ground for a defence preliminary objection.
        </p>

        {counts.map((c, idx) => (
          <div key={c.id} style={{
            background: '#ffffff', border: `1px solid ${accent}28`,
            borderRadius: 7, padding: '16px 18px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: accent, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Count {idx + 1}
              </span>
              {counts.length > 1 && (
                <button
                  onClick={() => removeCount(c.id)}
                  style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: "'Times New Roman', Times, serif" }}
                >
                  Remove count
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {fields.map(f => (
                <div key={f.key} style={f.key === 'manner' ? { gridColumn: '1/-1' } : {}}>
                  <label style={labelS}>{f.label}</label>
                  {f.key === 'manner' ? (
                    <textarea
                      style={{ ...taS, minHeight: 80 }}
                      value={c[f.key] as string}
                      onChange={e => updateCount(c.id, f.key, e.target.value)}
                      placeholder={f.ph}
                    />
                  ) : (
                    <input
                      style={iS}
                      value={c[f.key] as string}
                      onChange={e => updateCount(c.id, f.key, e.target.value)}
                      placeholder={f.ph}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={addCount}
          style={{
            background: 'transparent', border: `1px dashed ${accent}50`,
            color: accent, borderRadius: 6, padding: '9px 20px',
            fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            letterSpacing: '.06em', marginBottom: 18,
          }}
        >
          + Add count
        </button>

        <label style={labelS}>Charge Preamble / Court Header</label>
        <textarea
          style={{ ...taS, minHeight: 80 }}
          value={narrative}
          onChange={e => setNarrative(e.target.value)}
          placeholder={`IN THE HIGH COURT OF ${caseRef.toUpperCase()} HOLDEN AT ...\nCHARGE NO: ...\nBETWEEN:\nTHE STATE / FRN — and — [ACCUSED NAME]`}
        />
      </div>
    </div>
  );
}

function CountValidatorTab({
  counts, accent, activeCase,
}: {
  counts: ChargeCount[];
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [result, setResult] = useState('');

  const validate = useCallback(async () => {
    if (!counts.length || !counts[0].offence) return;
    const countSummary = counts.map((c, i) =>
      `COUNT ${i + 1}: ${c.offence} under ${c.section} of the ${c.statute}. Date: ${c.date}. Place: ${c.place}. Accused: ${c.accused}. Particulars: ${c.manner}`
    ).join('\n\n');

    const r = await call({
      system: `You are a Nigerian prosecution counsel validating a criminal charge document. Apply ACJA 2015, Evidence Act 2011, and the relevant criminal statutes.`,
      userMsg: `Validate the following charge counts for the matter: ${activeCase.caseName} (Court: ${activeCase.court}).

${countSummary}

For each count, analyse:
1. **Offence Correctly Named** — is this the correct legal name for the offence?
2. **Section Correct** — does the section cited match the offence described?
3. **Statute Identified** — is the statute clearly and correctly identified?
4. **Particulars Sufficient** — do the particulars state the essential ingredients?
5. **Duplicity** — does this count charge more than one offence?
6. **Jurisdiction** — does the court named have jurisdiction over this offence?
7. **Sentencing Power** — does the court have power to pass sentence for this offence?
8. **Defects** — list any defects that would expose this count to a preliminary objection.
9. **Verdict** — VALID or DEFECTIVE (with reasons).

For each count that is DEFECTIVE, provide a corrected version.`,
    });
    if (r) setResult(r);
  }, [counts, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Count Validator</h3>
      <p style={dimS}>
        AI-powered count-by-count validation. Checks offence names, statutory references,
        essential particulars, jurisdiction, sentencing power, and duplicity. Use before
        filing the charge to pre-empt defence preliminary objections.
      </p>

      {counts.length === 0 || !counts[0].offence ? (
        <p style={{ fontSize: 13, color: T.mute, fontStyle: 'italic', fontFamily: "'Times New Roman', Times, serif" }}>
          Build at least one count in the Charge Builder tab before running validation.
        </p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 16 }}>
            {counts.length} count{counts.length !== 1 ? 's' : ''} ready for validation:
          </p>
          {counts.map((c, i) => (
            <div key={c.id} style={{
              background: '#fafaf8', border: '1px solid #cccccc', borderRadius: 4,
              padding: '10px 14px', marginBottom: 8,
              fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif",
            }}>
              <strong style={{ color: accent }}>Count {i + 1}:</strong> {c.offence} — {c.section}, {c.statute}
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <Btn onClick={validate} loading={loading} label="Validate All Counts" accent={accent} />
          </div>
          {error && <ErrorBlock message={error} />}
          {result && (
            <ResultBlock
              title="Count Validation Report"
              content={result}
              onClear={() => setResult('')}
              accent={accent}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ArraignmentRecordPros({
  data, setData, analysis, setAnalysis, accent, activeCase,
}: {
  data: ArraignmentPros;
  setData: (d: ArraignmentPros) => void;
  analysis: string;
  setAnalysis: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const setField = (k: keyof ArraignmentPros, v: string) =>
    setData({ ...data, [k]: v });

  const analyse = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian prosecution counsel. Apply ACJA 2015.`,
      userMsg: `Arraignment record for ${activeCase.caseName}:

Date: ${data.date}
Accused present: ${data.accusedPresent}
Charge read: ${data.chargeRead}
Interpreter used: ${data.interpreterUsed}
Plea taken: ${data.pleaTaken}
Bail outcome: ${data.bailOutcome}
Notes: ${data.notes}

Assess this arraignment from the prosecution's perspective:
1. Was the arraignment conducted in compliance with ACJA 2015 s.264–269?
2. If accused not present — what orders are available to the prosecution?
3. If plea is Guilty — what is the next step (sentencing submissions)?
4. If plea is Not Guilty — prosecution case opens. What is the first prosecution action?
5. Were there any irregularities that the defence could exploit?
6. Prosecution's next step based on this arraignment.`,
    });
    if (r) setAnalysis(r);
  }, [data, activeCase, call]);

  const fields: Array<{ key: keyof ArraignmentPros; label: string; ph: string; type?: string }> = [
    { key: 'date',           label: 'Date of Arraignment',   ph: 'DD/MM/YYYY', type: 'date' },
    { key: 'accusedPresent', label: 'Accused Present',       ph: 'Yes / No / Bench warrant issued' },
    { key: 'chargeRead',     label: 'Charge Read to Accused', ph: 'Yes / No' },
    { key: 'interpreterUsed', label: 'Interpreter Used',     ph: 'Yes / No / Not required' },
    { key: 'pleaTaken',      label: 'Plea Taken',            ph: 'Not Guilty / Guilty / Refusal / Count-by-count' },
    { key: 'bailOutcome',    label: 'Bail Outcome',          ph: 'Granted / Refused / Adjourned for hearing' },
    { key: 'notes',          label: 'Additional Notes',      ph: 'Any irregularities, defence objections raised, court orders made' },
  ];

  return (
    <div style={cardS}>
      <h3 style={hS}>Arraignment Record</h3>
      <p style={dimS}>
        Record the arraignment proceedings and generate a prosecution-perspective
        analysis of the next steps following the plea.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        {fields.map(f => (
          <div key={f.key} style={f.key === 'notes' ? { gridColumn: '1/-1' } : {}}>
            <label style={labelS}>{f.label}</label>
            {f.key === 'notes' ? (
              <textarea
                style={{ ...taS, minHeight: 80 }}
                value={data[f.key]}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.ph}
              />
            ) : (
              <input
                style={iS}
                type={f.type}
                value={data[f.key]}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.ph}
              />
            )}
          </div>
        ))}
      </div>

      <Btn
        onClick={analyse}
        loading={loading}
        disabled={!data.date}
        label="Generate Prosecution Analysis"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {analysis && (
        <ResultBlock
          title="Prosecution Arraignment Analysis"
          content={analysis}
          onClear={() => setAnalysis('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

function ChargeDefectAnalyserTab({
  chargeText, setChargeText, defectAnalysis, setDefectAnalysis, accent, activeCase,
}: {
  chargeText: string;
  setChargeText: (v: string) => void;
  defectAnalysis: string;
  setDefectAnalysis: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const analyse = useCallback(async () => {
    if (!chargeText.trim()) return;
    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Apply ACJA 2015, Criminal Procedure Act, and Evidence Act 2011. Your goal is to identify every defect in the charge that can be used to protect the accused.`,
      userMsg: `Analyse the following charge for defects in the matter ${activeCase.caseName}:

${chargeText}

Conduct a comprehensive defect analysis covering:

1. **Jurisdiction** — Does this court have jurisdiction over the offence charged? Is the accused within territorial jurisdiction?
2. **Competence** — Is the charge filed by the correct authority? Was a fiat obtained if required?
3. **Duplicity** — Does any count charge more than one offence? (contrary to ACJA s.270)
4. **Wrong Section** — Is the statutory provision cited correct for the offence described?
5. **Missing Essential Particulars** — Are all essential ingredients of the offence clearly stated?
6. **Vague/Ambiguous Language** — Is there language that fails to give the accused adequate notice?
7. **Misjoinder** — Are counts improperly joined? Are accused persons improperly joined?
8. **Date/Place Issues** — Is the date and place of the alleged offence sufficiently stated?
9. **Defect in Commencement** — Was the charge validly commenced (fiat, proper parties, signed by appropriate officer)?
10. **Constitutional Issues** — Any violations of CFRN s.36(6) rights (informed of charge in detail, in language understood)?

For each defect found: state the defect, the legal basis, and whether it is a ground for preliminary objection, quashing the charge, or an argument at trial.

Conclude with an overall rating: STRONG OBJECTION GROUNDS / MODERATE OBJECTION GROUNDS / MINOR DEFECTS ONLY / NO DEFECTS FOUND.`,
    });
    if (r) setDefectAnalysis(r);
  }, [chargeText, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Charge Defect Analyser</h3>
      <p style={dimS}>
        Paste the full charge document or describe the charge. AI will conduct a
        comprehensive defect analysis under ACJA 2015 and identify every ground
        for preliminary objection, jurisdictional challenge, or trial argument.
      </p>

      <label style={labelS}>Charge / Information Text</label>
      <textarea
        style={{ ...taS, minHeight: 180 }}
        value={chargeText}
        onChange={e => setChargeText(e.target.value)}
        placeholder="Paste the full charge document, or describe the charge and each count in as much detail as available (offences, sections, dates, places, accused)."
      />

      <div style={{ marginTop: 14 }}>
        <Btn
          onClick={analyse}
          loading={loading}
          disabled={!chargeText.trim()}
          label="Analyse for Defects"
          accent={accent}
        />
      </div>
      {error && <ErrorBlock message={error} />}
      {defectAnalysis && (
        <ResultBlock
          title="Charge Defect Analysis"
          content={defectAnalysis}
          onClear={() => setDefectAnalysis('')}
          accent={accent}
        />
      )}
    </div>
  );
}

function PreliminaryObjectionTab({
  chargeText, defectAnalysis, objGrounds, setObjGrounds, objDraft, setObjDraft, accent, activeCase,
}: {
  chargeText: string;
  defectAnalysis: string;
  objGrounds: string;
  setObjGrounds: (v: string) => void;
  objDraft: string;
  setObjDraft: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const generateGrounds = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian criminal defence counsel specialising in preliminary objections to charge documents.`,
      userMsg: `For the matter ${activeCase.caseName}, the charge reads:

${chargeText || '[Charge text not entered — please enter in Charge Defect Analyser tab]'}

${defectAnalysis ? `Defect analysis already conducted:\n${defectAnalysis}\n\n` : ''}

Generate a structured list of grounds for preliminary objection to this charge. For each ground:
- State the ground precisely (as it would appear in a Notice of Preliminary Objection)
- Cite the legal basis (ACJA provision, constitutional right, or case authority)
- Summarise the argument in 2–3 sentences
- Rate the strength: STRONG / MEDIUM / ARGUABLE

Format as a numbered list suitable for filing.`,
    });
    if (r) setObjGrounds(r);
  }, [chargeText, defectAnalysis, activeCase, call]);

  const draftObjection = useCallback(async () => {
    if (!objGrounds.trim()) return;
    const r = await call({
      system: `You are a Nigerian criminal defence counsel drafting a preliminary objection to a charge document for filing in court.`,
      userMsg: `Draft a formal Preliminary Objection to the charge in the matter:

${activeCase.caseName} — ${activeCase.court}

Grounds identified:
${objGrounds}

Charge details:
${chargeText || '[See defect analysis]'}

Draft a full preliminary objection document with:
1. Caption (matter name, charge number, court)
2. Introduction paragraph identifying who is objecting and to what
3. Each ground set out formally with supporting argument
4. Prayer / relief sought (quash the charge / discharge the accused / strike out offending count)
5. Signature block for defence counsel

Use formal Nigerian legal drafting style. Each ground should be clearly numbered and argued with reference to the relevant ACJA provision, constitutional right, or case authority.`,
    });
    if (r) setObjDraft(r);
  }, [objGrounds, chargeText, activeCase, call]);

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Preliminary Objection</h3>
        <p style={dimS}>
          Generate objection grounds from the defect analysis, then draft a full
          preliminary objection document ready for filing or adaptation.
        </p>

        {!chargeText.trim() && (
          <div style={{
            padding: '12px 16px', background: `${accent}0d`, border: `1px solid ${accent}30`,
            borderRadius: 6, marginBottom: 16,
            fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
          }}>
            Enter the charge text in the Charge Defect Analyser tab first to generate the strongest grounds.
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Btn
            onClick={generateGrounds}
            loading={loading}
            label="Generate Objection Grounds"
            accent={accent}
          />
        </div>

        {objGrounds && (
          <ResultBlock
            title="Objection Grounds"
            content={objGrounds}
            onClear={() => setObjGrounds('')}
            accent={accent}
          />
        )}
      </div>

      {objGrounds && (
        <div style={cardS}>
          <h3 style={hS}>Draft Preliminary Objection</h3>
          <p style={dimS}>
            Generate a full court-ready preliminary objection document based on the grounds above.
          </p>
          <label style={labelS}>Additional instructions (optional)</label>
          <textarea
            style={{ ...taS, minHeight: 80, marginBottom: 14 }}
            value={objGrounds}
            onChange={e => setObjGrounds(e.target.value)}
            placeholder="Edit or add to the grounds before drafting..."
          />
          <Btn
            onClick={draftObjection}
            loading={loading}
            disabled={!objGrounds.trim()}
            label="Draft Preliminary Objection"
            accent={accent}
          />
          {error && <ErrorBlock message={error} />}
          {objDraft && (
            <ResultBlock
              title="Preliminary Objection (Draft)"
              content={objDraft}
              onClear={() => setObjDraft('')}
              accent={accent}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ArraignmentTrackerDef({
  data, setData, notes, setNotes, accent, activeCase,
}: {
  data: ArraignmentDef;
  setData: (d: ArraignmentDef) => void;
  notes: string;
  setNotes: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [analysis, setAnalysis] = useState('');

  const setField = (k: keyof ArraignmentDef, v: string) =>
    setData({ ...data, [k]: v });

  const analyse = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Apply ACJA 2015, CFRN 1999, and Evidence Act 2011. The accused's liberty and rights are paramount.`,
      userMsg: `Defence arraignment assessment for ${activeCase.caseName}:

Date: ${data.date}
Proper arraignment conducted: ${data.properArraignment}
Plea entered: ${data.plea}
Bail applied for: ${data.bailApplied}
Bail granted: ${data.bailGranted}
Surety conditions: ${data.suretyConditions}
Remand expiry date: ${data.remandExpiry}
Defence notes: ${notes}

Assess from the defence perspective:
1. **Arraignment Validity** — was the arraignment conducted properly under ACJA s.264–269? Any grounds to challenge it?
2. **Plea Advice** — based on the plea entered, what are the immediate next steps for defence?
3. **Bail Status** — if remanded, calculate ACJA remand period (ACJA s.293 — 30 days for High Court, 10 days for Magistrate Court). Flag if approaching expiry.
4. **Remand Deadline Alert** — when does the remand period expire? What must defence do?
5. **Constitutional Rights** — were the accused's CFRN s.35(3) and s.36(6) rights observed at arraignment?
6. **Immediate Defence Actions** — what must defence do in the next 7 days?`,
    });
    if (r) setAnalysis(r);
  }, [data, notes, activeCase, call]);

  const fields: Array<{ key: keyof ArraignmentDef; label: string; ph: string }> = [
    { key: 'date',             label: 'Date of Arraignment',     ph: 'DD/MM/YYYY' },
    { key: 'properArraignment', label: 'Proper Arraignment',     ph: 'Yes / No / Contested' },
    { key: 'plea',             label: 'Plea Entered',            ph: 'Not Guilty / Guilty / Refusal (per count if different)' },
    { key: 'bailApplied',      label: 'Bail Applied For',        ph: 'Yes / No / Adjourned' },
    { key: 'bailGranted',      label: 'Bail Granted',            ph: 'Yes — terms: / No — reasons: / Pending' },
    { key: 'suretyConditions', label: 'Surety / Conditions',     ph: 'Surety requirements, self-recognizance, other conditions' },
    { key: 'remandExpiry',     label: 'Remand Expiry Date (ACJA)', ph: 'DD/MM/YYYY — auto-flag if approaching' },
  ];

  return (
    <div style={cardS}>
      <h3 style={hS}>Arraignment Tracker</h3>
      <p style={dimS}>
        Record arraignment details and generate a defence assessment — including
        arraignment validity, plea routing, bail status, and ACJA remand deadline tracking.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {fields.map(f => (
          <div key={f.key} style={f.key === 'plea' || f.key === 'suretyConditions' ? { gridColumn: '1/-1' } : {}}>
            <label style={labelS}>{f.label}</label>
            {f.key === 'plea' || f.key === 'suretyConditions' ? (
              <textarea
                style={{ ...taS, minHeight: 70 }}
                value={data[f.key]}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.ph}
              />
            ) : (
              <input
                style={iS}
                value={data[f.key]}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.ph}
              />
            )}
          </div>
        ))}
      </div>

      <label style={labelS}>Defence Notes / Irregularities Observed</label>
      <textarea
        style={{ ...taS, minHeight: 80, marginBottom: 14 }}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Note any irregularities, arguments raised, objections made, court orders, and any matters to follow up."
      />

      <Btn
        onClick={analyse}
        loading={loading}
        disabled={!data.date}
        label="Generate Defence Assessment"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {analysis && (
        <ResultBlock
          title="Defence Arraignment Assessment"
          content={analysis}
          onClear={() => setAnalysis('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'charge_arraignment';

const DEFAULT_PROS_DATA: ArraignmentPros = {
  date: '', accusedPresent: '', chargeRead: '',
  interpreterUsed: '', pleaTaken: '', bailOutcome: '', notes: '',
};
const DEFAULT_DEF_DATA: ArraignmentDef = {
  date: '', properArraignment: '', plea: '',
  bailApplied: '', bailGranted: '', suretyConditions: '', remandExpiry: '',
};

export function ChargeArraignment({ activeCase }: Props) {
  const role   = activeCase.counsel_role ?? 'defence';
  const isPros = role === 'prosecution';
  const accent = COUNSEL_ROLE_COLORS[role]?.col ?? '#c09030';

  // Sub-tab
  const prosSubTabs = [
    { id: 'charge_builder',    label: '1 — Charge Builder' },
    { id: 'count_validator',   label: '2 — Count Validator' },
    { id: 'arraignment_record', label: '3 — Arraignment Record' },
  ];
  const defSubTabs = [
    { id: 'defect_analyser',       label: '1 — Charge Defect Analyser' },
    { id: 'preliminary_objection', label: '2 — Preliminary Objection' },
    { id: 'arraignment_tracker',   label: '3 — Arraignment Tracker' },
  ];
  const [subTab, setSubTab] = useState<SubTab>(isPros ? 'charge_builder' : 'defect_analyser');

  // Shared state
  const [saved, setSaved]   = useState<SavedData>({});

  // Prosecution state
  const [counts,            setCounts]            = useState<ChargeCount[]>([emptyCount()]);
  const [chargeNarrative,   setChargeNarrative]   = useState('');
  const [validationResult,  setValidationResult]  = useState('');
  const [arraignmentPros,   setArrayignmentPros]  = useState<ArraignmentPros>(DEFAULT_PROS_DATA);
  const [arraignmentAnalysis, setArrayignmentAnalysis] = useState('');

  // Defence state
  const [chargeText,     setChargeText]     = useState('');
  const [defectAnalysis, setDefectAnalysis] = useState('');
  const [objGrounds,     setObjGrounds]     = useState('');
  const [objDraft,       setObjDraft]       = useState('');
  const [arraignmentDef, setArrayignmentDef] = useState<ArraignmentDef>(DEFAULT_DEF_DATA);
  const [arraignmentDefNotes, setArrayignmentDefNotes] = useState('');

  // Load
  useEffect(() => {
    loadBlindSpot(activeCase.id, STORAGE_KEY).then((d: SavedData | null) => {
      if (!d) return;
      setSaved(d);
      if (d.counts)            setCounts(d.counts);
      if (d.chargeNarrative)   setChargeNarrative(d.chargeNarrative);
      if (d.validationResult)  setValidationResult(d.validationResult);
      if (d.arraignmentPros)   setArrayignmentPros(d.arraignmentPros);
      if (d.arraignmentAnalysis) setArrayignmentAnalysis(d.arraignmentAnalysis);
      if (d.chargeText)        setChargeText(d.chargeText);
      if (d.defectAnalysis)    setDefectAnalysis(d.defectAnalysis);
      if (d.objGrounds)        setObjGrounds(d.objGrounds);
      if (d.objDraft)          setObjDraft(d.objDraft);
      if (d.arraignmentDef)    setArrayignmentDef(d.arraignmentDef);
      if (d.arraignmentDefNotes) setArrayignmentDefNotes(d.arraignmentDefNotes);
    }).catch(() => {});
  }, [activeCase.id]);

  // Persist
  const persist = useCallback(() => {
    const data: SavedData = {
      counts, chargeNarrative, validationResult, arraignmentPros, arraignmentAnalysis,
      chargeText, defectAnalysis, objGrounds, objDraft, arraignmentDef, arraignmentDefNotes,
    };
    saveBlindSpot(activeCase.id, STORAGE_KEY, data).catch(() => {});
  }, [
    counts, chargeNarrative, validationResult, arraignmentPros, arraignmentAnalysis,
    chargeText, defectAnalysis, objGrounds, objDraft, arraignmentDef, arraignmentDefNotes,
    activeCase.id,
  ]);

  useEffect(() => { persist(); }, [persist]);

  // ── Header labels ──────────────────────────────────────────────────────────
  const headingLabel = isPros ? 'Charge & Arraignment — Prosecution' : 'Charge & Arraignment — Defence';
  const headingDesc  = isPros
    ? 'Build the charge, validate every count, and record the arraignment proceedings.'
    : 'Analyse the charge for defects, generate preliminary objection grounds, and track the arraignment.';

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{
            fontSize: 9, color: accent, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700,
            background: `${accent}14`, border: `1px solid ${accent}30`,
            padding: '3px 9px', borderRadius: 3,
          }}>
            Criminal · {isPros ? 'Prosecution' : 'Defence'}
          </span>
          <span style={{
            fontSize: 9, color: '#888', fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.1em', textTransform: 'uppercase',
          }}>
            Phase 6A
          </span>
        </div>
        <h2 style={{
          fontSize: 26, color: T.text, fontWeight: 300,
          fontFamily: "'Times New Roman', Times, serif", marginBottom: 6,
        }}>
          {headingLabel}
        </h2>
        <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {headingDesc}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={isPros ? prosSubTabs : defSubTabs}
        active={subTab}
        onSelect={id => setSubTab(id as SubTab)}
        accent={accent}
      />

      {/* Prosecution sub-tabs */}
      {isPros && subTab === 'charge_builder' && (
        <ChargeBuilderTab
          counts={counts}
          setCount={setCounts}
          narrative={chargeNarrative}
          setNarrative={setChargeNarrative}
          accent={accent}
          caseRef={activeCase.court ?? ''}
        />
      )}
      {isPros && subTab === 'count_validator' && (
        <CountValidatorTab
          counts={counts}
          accent={accent}
          activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'arraignment_record' && (
        <ArraignmentRecordPros
          data={arraignmentPros}
          setData={setArrayignmentPros}
          analysis={arraignmentAnalysis}
          setAnalysis={setArrayignmentAnalysis}
          accent={accent}
          activeCase={activeCase}
        />
      )}

      {/* Defence sub-tabs */}
      {!isPros && subTab === 'defect_analyser' && (
        <ChargeDefectAnalyserTab
          chargeText={chargeText}
          setChargeText={setChargeText}
          defectAnalysis={defectAnalysis}
          setDefectAnalysis={setDefectAnalysis}
          accent={accent}
          activeCase={activeCase}
        />
      )}
      {!isPros && subTab === 'preliminary_objection' && (
        <PreliminaryObjectionTab
          chargeText={chargeText}
          defectAnalysis={defectAnalysis}
          objGrounds={objGrounds}
          setObjGrounds={setObjGrounds}
          objDraft={objDraft}
          setObjDraft={setObjDraft}
          accent={accent}
          activeCase={activeCase}
        />
      )}
      {!isPros && subTab === 'arraignment_tracker' && (
        <ArraignmentTrackerDef
          data={arraignmentDef}
          setData={setArrayignmentDef}
          notes={arraignmentDefNotes}
          setNotes={setArrayignmentDefNotes}
          accent={accent}
          activeCase={activeCase}
        />
      )}
    </div>
  );
}
