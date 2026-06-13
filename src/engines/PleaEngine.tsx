/**
 * AFS Legal OS V2 — Plea Engine (Phase 6A)
 *
 * Dual-role criminal engine: activated after arraignment, this engine
 * manages the plea and routes the matter to the correct next stage.
 *
 * PROSECUTION sub-tabs:
 *   1. Plea Record     — note plea per count, route to prosecution case or sentencing
 *   2. Plea Bargain    — manage offer, terms, and agreement
 *
 * DEFENCE sub-tabs:
 *   1. Plea Advice     — AI-powered per-count plea analysis for the accused
 *   2. Plea Bargain    — negotiate terms, document agreement
 *   3. Routing Confirm — confirm next stage based on plea entered
 *
 * counsel_role governs which sub-tabs and AI prompts are active.
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

type ProsSubTab = 'plea_record' | 'plea_bargain_pros';
type DefSubTab  = 'plea_advice' | 'plea_bargain_def' | 'routing_confirm';
type SubTab     = ProsSubTab | DefSubTab;

interface CountPlea {
  id:       number;
  count:    string;
  offence:  string;
  plea:     string;   // 'Not Guilty' | 'Guilty' | 'Refusal' | 'Lesser offence'
  notes:    string;
}

interface PleaBargainTerms {
  offencePleadingTo: string;
  countsToBeDismissed: string;
  agreedSentence: string;
  restitution: string;
  cooperation: string;
  otherTerms: string;
  signedBy: string;
  date: string;
}

interface SavedData {
  countPleas?:          CountPlea[];
  routingAnalysis?:     string;
  pleaBargainPros?:     PleaBargainTerms;
  pleaBargainProsDraft?: string;
  caseBackground?:      string;
  pleaAdvice?:          string;
  pleaBargainDef?:      PleaBargainTerms;
  pleaBargainDefAnalysis?: string;
  routingNotes?:        string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
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
// PLEA SELECTOR — reusable dropdown
// ─────────────────────────────────────────────────────────────────────────────

const PLEA_OPTIONS = ['Not Guilty', 'Guilty', 'Refusal to Plead', 'Insanity Plea', 'Guilty to Lesser Offence', 'Pending — Plea Bargain'];

function PleaSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ ...iS, appearance: 'none', cursor: 'pointer' }}
    >
      <option value="">— Select plea —</option>
      {PLEA_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

function PleaRecordTab({
  countPleas, setCountPleas, routingAnalysis, setRoutingAnalysis, accent, activeCase,
}: {
  countPleas: CountPlea[];
  setCountPleas: (fn: (p: CountPlea[]) => CountPlea[]) => void;
  routingAnalysis: string;
  setRoutingAnalysis: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const addCount = () =>
    setCountPleas(p => [...p, { id: Date.now(), count: `Count ${p.length + 1}`, offence: '', plea: '', notes: '' }]);
  const removeCount = (id: number) =>
    setCountPleas(p => p.filter(c => c.id !== id));
  const update = (id: number, field: keyof CountPlea, value: string) =>
    setCountPleas(p => p.map(c => c.id === id ? { ...c, [field]: value } : c));

  const allEntered = countPleas.length > 0 && countPleas.every(c => c.plea);

  const generateRouting = useCallback(async () => {
    if (!allEntered) return;
    const plea_summary = countPleas.map(c =>
      `${c.count} (${c.offence}): PLEA — ${c.plea}${c.notes ? `. Notes: ${c.notes}` : ''}`
    ).join('\n');

    const r = await call({
      system: `You are a Nigerian prosecution counsel. Apply ACJA 2015. Pleas have been taken and you must advise on routing and next steps.`,
      userMsg: `Plea taken in ${activeCase.caseName} at ${activeCase.court}:

${plea_summary}

As prosecution counsel, advise:

1. **Plea Summary** — state what was entered on each count
2. **Routing Decision** — for each count:
   - Guilty → sentencing submissions required. What sentencing submissions must prosecution prepare?
   - Not Guilty → prosecution case opens. What is prosecution's first action?
   - Guilty to Lesser Offence → note the amended count and route accordingly
   - Refusal to Plead → how does ACJA treat this (deemed Not Guilty)?
   - Plea Bargain Pending → outline next steps in the plea bargain process
3. **Overall Case Status** — if mixed pleas (guilty on some counts, not guilty on others), how does prosecution proceed?
4. **ACJA Compliance** — what ACJA obligations are triggered by today's plea?
5. **Prosecution's Immediate Actions** — list in order of priority`,
    });
    if (r) setRoutingAnalysis(r);
  }, [countPleas, allEntered, activeCase, call]);

  // Plea badges
  const guiltyCounts    = countPleas.filter(c => c.plea.toLowerCase().includes('guilty') && !c.plea.includes('Not')).length;
  const notGuiltyCounts = countPleas.filter(c => c.plea === 'Not Guilty').length;

  return (
    <div style={cardS}>
      <h3 style={hS}>Plea Record</h3>
      <p style={dimS}>
        Record the plea entered on each count. The routing analysis will advise on
        the correct next steps — sentencing (Guilty) or opening the prosecution case (Not Guilty).
      </p>

      {/* Summary badges */}
      {(guiltyCounts > 0 || notGuiltyCounts > 0) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {guiltyCounts > 0 && (
            <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#0d1a0d', border: '1px solid #1a4a1a', color: '#50c050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.06em' }}>
              ✓ GUILTY: {guiltyCounts} count{guiltyCounts !== 1 ? 's' : ''}
            </span>
          )}
          {notGuiltyCounts > 0 && (
            <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#1a0d0d', border: '1px solid #4a1a1a', color: '#c05050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.06em' }}>
              ✗ NOT GUILTY: {notGuiltyCounts} count{notGuiltyCounts !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Count rows */}
      {countPleas.map((c, idx) => (
        <div key={c.id} style={{
          background: '#ffffff', border: `1px solid ${accent}20`,
          borderRadius: 7, padding: '16px 18px', marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input
              style={{ ...iS, flex: '0 0 100px', fontSize: 13 }}
              value={c.count}
              onChange={e => update(c.id, 'count', e.target.value)}
              placeholder="Count 1"
            />
            <input
              style={{ ...iS, flex: 1, fontSize: 13 }}
              value={c.offence}
              onChange={e => update(c.id, 'offence', e.target.value)}
              placeholder="Offence (e.g. Armed Robbery)"
            />
            {countPleas.length > 1 && (
              <button
                onClick={() => removeCount(c.id)}
                style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 12, fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}
              >
                ×
              </button>
            )}
          </div>
          <label style={labelS}>Plea Entered</label>
          <PleaSelect value={c.plea} onChange={v => update(c.id, 'plea', v)} />
          <div style={{ marginTop: 10 }}>
            <label style={labelS}>Notes</label>
            <input
              style={iS}
              value={c.notes}
              onChange={e => update(c.id, 'notes', e.target.value)}
              placeholder="Any irregularities, court orders, or observations"
            />
          </div>
        </div>
      ))}

      <button
        onClick={addCount}
        style={{
          background: 'transparent', border: `1px dashed ${accent}50`,
          color: accent, borderRadius: 6, padding: '8px 18px',
          fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
          letterSpacing: '.06em', marginBottom: 18,
        }}
      >
        + Add count
      </button>

      <div>
        <Btn
          onClick={generateRouting}
          loading={loading}
          disabled={!allEntered}
          label="Generate Prosecution Routing Analysis"
          accent={accent}
        />
        {!allEntered && countPleas.length > 0 && (
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 8 }}>
            Enter a plea for every count before generating the routing analysis.
          </p>
        )}
      </div>

      {error && <ErrorBlock message={error} />}
      {routingAnalysis && (
        <ResultBlock
          title="Prosecution Routing Analysis"
          content={routingAnalysis}
          onClear={() => setRoutingAnalysis('')}
          accent={accent}
        />
      )}
    </div>
  );
}

function PleaBargainProsTab({
  terms, setTerms, draft, setDraft, accent, activeCase,
}: {
  terms: PleaBargainTerms;
  setTerms: (t: PleaBargainTerms) => void;
  draft: string;
  setDraft: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const set = (k: keyof PleaBargainTerms, v: string) => setTerms({ ...terms, [k]: v });

  const generateDraft = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian prosecution counsel. Draft a formal plea bargain agreement under ACJA 2015 s.270.`,
      userMsg: `Draft a plea bargain agreement for ${activeCase.caseName}:

Offence pleading to: ${terms.offencePleadingTo}
Counts to be dismissed: ${terms.countsToBeDismissed}
Agreed sentence: ${terms.agreedSentence}
Restitution: ${terms.restitution}
Cooperation undertaking: ${terms.cooperation}
Other terms: ${terms.otherTerms}
Signed by: ${terms.signedBy}
Date: ${terms.date}

Draft a formal plea bargain agreement (Plea Agreement) suitable for filing in court. Include:
1. Parties (State/FRN and the accused)
2. Background / facts relied upon
3. Charge pleading to (with section and statute)
4. Counts to be withdrawn/dismissed
5. Agreed sentence (if any — note that court is not bound unless it accepts)
6. Restitution obligations
7. Prosecution cooperation obligations (what prosecution will do)
8. Accused's obligations (what accused will do)
9. ACJA s.270 compliance acknowledgment
10. Signature blocks (prosecution counsel, defence counsel, accused, and space for court acceptance)

Use formal Nigerian legal drafting style.`,
    });
    if (r) setDraft(r);
  }, [terms, activeCase, call]);

  const fields: Array<{ key: keyof PleaBargainTerms; label: string; ph: string; multi?: boolean }> = [
    { key: 'offencePleadingTo',      label: 'Offence Pleading To',       ph: 'Name of offence, section, statute' },
    { key: 'countsToBeDismissed',    label: 'Counts to be Dismissed',    ph: 'Count numbers and offences to be withdrawn' },
    { key: 'agreedSentence',         label: 'Agreed Sentence (if any)',   ph: 'Note: Court is not bound — but parties may agree a recommendation' },
    { key: 'restitution',            label: 'Restitution',               ph: 'Amount, property, or obligation; or N/A' },
    { key: 'cooperation',            label: 'Cooperation Undertaking',    ph: 'What the accused agrees to provide (testimony, information, etc.); or N/A' },
    { key: 'otherTerms',             label: 'Other Terms',               ph: 'Any additional conditions or obligations', multi: true },
    { key: 'signedBy',               label: 'Signed By (Parties)',        ph: 'Names and designations of signatories' },
    { key: 'date',                   label: 'Date',                      ph: 'DD/MM/YYYY' },
  ];

  return (
    <div style={cardS}>
      <h3 style={hS}>Plea Bargain — Prosecution</h3>
      <p style={dimS}>
        Structure and document the plea bargain offer. Under ACJA 2015 s.270, plea agreements
        must be in writing and filed with the court. The court is not bound by agreed sentences
        but must consider the agreement.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        {fields.map(f => (
          <div key={f.key} style={f.multi || f.key === 'offencePleadingTo' || f.key === 'countsToBeDismissed' ? { gridColumn: '1/-1' } : {}}>
            <label style={labelS}>{f.label}</label>
            {f.multi ? (
              <textarea
                style={{ ...taS, minHeight: 80 }}
                value={terms[f.key]}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.ph}
              />
            ) : (
              <input
                style={iS}
                value={terms[f.key]}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.ph}
              />
            )}
          </div>
        ))}
      </div>

      <Btn
        onClick={generateDraft}
        loading={loading}
        disabled={!terms.offencePleadingTo}
        label="Draft Plea Agreement"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock
          title="Plea Agreement (Draft)"
          content={draft}
          onClear={() => setDraft('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

function PleaAdviceTab({
  caseBackground, setCaseBackground, advice, setAdvice, accent, activeCase,
}: {
  caseBackground: string;
  setCaseBackground: (v: string) => void;
  advice: string;
  setAdvice: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [chargesText, setChargesText]   = useState('');
  const [evidenceSummary, setEvidence]  = useState('');
  const [instructions, setInstructions] = useState('');

  const generateAdvice = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Your duty is to protect the accused and to advise honestly on all available options. Apply ACJA 2015, Evidence Act 2011, and CFRN 1999. Client instructions are paramount.`,
      userMsg: `Plea advice required for ${activeCase.caseName}:

Charges faced:
${chargesText}

Evidence summary (prosecution's case):
${evidenceSummary}

Client instructions / background:
${caseBackground || instructions}

Provide comprehensive plea advice covering:

1. **Summary of Charges** — explain each count in plain terms
2. **Evidence Assessment** — how strong is the prosecution's evidence on each count?
3. **Plea Options — Count by Count:**
   - **Not Guilty:** What are the realistic prospects of acquittal? What are the risks?
   - **Guilty:** What sentence exposure does the accused face? What mitigating factors reduce this?
   - **Guilty to Lesser Offence:** Is a lesser offence available? What are the conditions?
   - **Plea Bargain:** Is a plea bargain viable? What could be negotiated?
4. **Defence Strategies Available** — what defences exist regardless of plea?
5. **Recommendation** — what does defence counsel recommend and why?
6. **ACJA Rights** — client's rights at this stage that must be explained to them
7. **What Must Be Communicated to the Client** — the duty to advise properly`,
    });
    if (r) setAdvice(r);
  }, [chargesText, evidenceSummary, caseBackground, instructions, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Plea Advice</h3>
      <p style={dimS}>
        Comprehensive AI-powered plea advice for each count. Covers prospects on not guilty
        plea, sentence exposure on guilty plea, lesser offence options, plea bargain
        viability, and the duty of counsel to advise fully.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 18 }}>
        <div>
          <label style={labelS}>Charges Faced (count by count)</label>
          <textarea
            style={{ ...taS, minHeight: 100 }}
            value={chargesText}
            onChange={e => setChargesText(e.target.value)}
            placeholder="List each count: Count 1 — Armed Robbery under s.1(2)(a) Robbery and Firearms Act. Count 2 — ..."
          />
        </div>
        <div>
          <label style={labelS}>Prosecution Evidence Summary</label>
          <textarea
            style={{ ...taS, minHeight: 100 }}
            value={evidenceSummary}
            onChange={e => setEvidence(e.target.value)}
            placeholder="Summarise the prosecution's evidence: eyewitness identification, exhibits, confessions, forensics, digital evidence..."
          />
        </div>
        <div>
          <label style={labelS}>Client Instructions / Background Facts</label>
          <textarea
            style={{ ...taS, minHeight: 100 }}
            value={caseBackground}
            onChange={e => setCaseBackground(e.target.value)}
            placeholder="What has the client told you? Their account, alibi, any admissions, instructions on how to proceed..."
          />
        </div>
      </div>

      <Btn
        onClick={generateAdvice}
        loading={loading}
        disabled={!chargesText.trim()}
        label="Generate Plea Advice"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {advice && (
        <ResultBlock
          title="Plea Advice"
          content={advice}
          onClear={() => setAdvice('')}
          accent={accent}
        />
      )}
    </div>
  );
}

function PleaBargainDefTab({
  terms, setTerms, analysis, setAnalysis, accent, activeCase,
}: {
  terms: PleaBargainTerms;
  setTerms: (t: PleaBargainTerms) => void;
  analysis: string;
  setAnalysis: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const set = (k: keyof PleaBargainTerms, v: string) => setTerms({ ...terms, [k]: v });
  const [prosOffer, setProsOffer] = useState('');

  const analyseOffer = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian criminal defence counsel analysing a prosecution plea bargain offer. Your sole duty is to the accused's best interests.`,
      userMsg: `Plea bargain analysis for ${activeCase.caseName}:

Prosecution offer:
${prosOffer || '[No prosecution offer recorded — general advice requested]'}

Proposed terms (defence position):
Offence to plead to: ${terms.offencePleadingTo}
Counts to be dismissed: ${terms.countsToBeDismissed}
Sentence sought: ${terms.agreedSentence}
Restitution: ${terms.restitution}
Other terms: ${terms.otherTerms}

Analyse from the defence perspective:
1. **Is this offer in the accused's best interests?** Compare sentence exposure at trial vs plea bargain
2. **Offence to plead to** — is this the right choice? Can we negotiate a lesser offence?
3. **What should we counter-propose?** Recommended counter-offer with reasoning
4. **Counts to be dismissed** — are we getting sufficient concessions?
5. **Risks of accepting** — what does the accused give up by pleading guilty?
6. **Risks of rejecting** — if we reject and lose at trial, what is the likely sentence?
7. **ACJA s.270 requirements** — what formal requirements must the plea bargain agreement satisfy?
8. **Recommendation** — accept / reject / counter-propose (with specific counter-terms)`,
    });
    if (r) setAnalysis(r);
  }, [prosOffer, terms, activeCase, call]);

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Plea Bargain — Defence Analysis</h3>
        <p style={dimS}>
          Analyse the prosecution offer and develop the defence counter-position. Under
          ACJA 2015 s.270, plea agreements must be in writing and signed by the accused
          personally before filing.
        </p>

        <label style={labelS}>Prosecution Offer (as received)</label>
        <textarea
          style={{ ...taS, minHeight: 100, marginBottom: 18 }}
          value={prosOffer}
          onChange={e => setProsOffer(e.target.value)}
          placeholder="Describe the prosecution's offer in full — offence to plead to, counts to dismiss, sentence recommendation, any restitution obligation..."
        />

        <h4 style={{ ...hS, fontSize: 16, marginBottom: 12 }}>Defence Counter-Position</h4>
        {(
          [
            { key: 'offencePleadingTo' as const,      label: 'Offence Prepared to Plead To',  ph: 'Name of offence, section' },
            { key: 'countsToBeDismissed' as const,    label: 'Counts to be Dismissed',         ph: 'What counts must be dismissed as condition of plea' },
            { key: 'agreedSentence' as const,         label: 'Sentence Position',              ph: 'Maximum acceptable sentence / recommendation to court' },
            { key: 'restitution' as const,            label: 'Restitution Ceiling',            ph: 'Maximum restitution acceptable; or nil' },
            { key: 'cooperation' as const,            label: 'Cooperation (if any)',            ph: 'What cooperation the accused is prepared to provide' },
            { key: 'otherTerms' as const,             label: 'Other Defence Conditions',       ph: 'Any other conditions' },
          ] as Array<{ key: keyof PleaBargainTerms; label: string; ph: string }>
        ).map(f => (
          <div key={f.key} style={{ marginBottom: 12 }}>
            <label style={labelS}>{f.label}</label>
            <input
              style={iS}
              value={terms[f.key]}
              onChange={e => set(f.key, e.target.value)}
              placeholder={f.ph}
            />
          </div>
        ))}

        <div style={{ marginTop: 6 }}>
          <Btn
            onClick={analyseOffer}
            loading={loading}
            label="Analyse Offer & Generate Counter-Position"
            accent={accent}
          />
        </div>
        {error && <ErrorBlock message={error} />}
        {analysis && (
          <ResultBlock
            title="Plea Bargain Analysis — Defence"
            content={analysis}
            onClear={() => setAnalysis('')}
            accent={accent}
          />
        )}
      </div>
    </div>
  );
}

function RoutingConfirmTab({
  countPleas, setCountPleas, notes, setNotes, accent, activeCase,
}: {
  countPleas: CountPlea[];
  setCountPleas: (fn: (p: CountPlea[]) => CountPlea[]) => void;
  notes: string;
  setNotes: (s: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [routingAnalysis, setRoutingAnalysis] = useState('');

  const update = (id: number, field: keyof CountPlea, value: string) =>
    setCountPleas(p => p.map(c => c.id === id ? { ...c, [field]: value } : c));
  const addCount = () =>
    setCountPleas(p => [...p, { id: Date.now(), count: `Count ${p.length + 1}`, offence: '', plea: '', notes: '' }]);
  const removeCount = (id: number) =>
    setCountPleas(p => p.filter(c => c.id !== id));

  const allEntered = countPleas.length > 0 && countPleas.every(c => c.plea);

  const generateRouting = useCallback(async () => {
    const plea_summary = countPleas.map(c =>
      `${c.count} (${c.offence}): ${c.plea}${c.notes ? ` — ${c.notes}` : ''}`
    ).join('\n');

    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Pleas have been taken. Advise the defence on routing and immediate next steps.`,
      userMsg: `Plea routing assessment for ${activeCase.caseName}:

Pleas entered:
${plea_summary}

Defence notes:
${notes}

Advise from the defence perspective:
1. **Plea Summary** — confirm what was entered on each count
2. **Routing Decision:**
   - Not Guilty → prosecution case begins. What must defence prepare immediately?
   - Guilty → sentencing stage. What must defence prepare for allocutus and mitigation?
   - Guilty to Lesser Offence → confirm the amended count and routing
   - Plea Bargain → what are the next steps in the plea bargain process?
3. **ACJA Implications** — what ACJA timelines and rights are now triggered?
4. **Immediate Defence Actions** — what must defence counsel do in the next 7–14 days?
5. **Bail/Remand Status** — any impact of plea on bail application?
6. **Client Communication** — what must be explained to the accused following today's plea?`,
    });
    if (r) setRoutingAnalysis(r);
  }, [countPleas, notes, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Plea Routing — Defence</h3>
      <p style={dimS}>
        Confirm the plea entered on each count and generate a defence routing analysis —
        what stage the matter moves to and what defence must do next.
      </p>

      {countPleas.map((c, idx) => (
        <div key={c.id} style={{
          background: '#ffffff', border: `1px solid ${accent}20`,
          borderRadius: 7, padding: '14px 16px', marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input
              style={{ ...iS, flex: '0 0 100px', fontSize: 13 }}
              value={c.count}
              onChange={e => update(c.id, 'count', e.target.value)}
              placeholder="Count 1"
            />
            <input
              style={{ ...iS, flex: 1, fontSize: 13 }}
              value={c.offence}
              onChange={e => update(c.id, 'offence', e.target.value)}
              placeholder="Offence"
            />
            {countPleas.length > 1 && (
              <button
                onClick={() => removeCount(c.id)}
                style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 12 }}
              >×</button>
            )}
          </div>
          <PleaSelect value={c.plea} onChange={v => update(c.id, 'plea', v)} />
        </div>
      ))}

      <button
        onClick={addCount}
        style={{
          background: 'transparent', border: `1px dashed ${accent}50`,
          color: accent, borderRadius: 6, padding: '8px 18px',
          fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
          letterSpacing: '.06em', marginBottom: 14,
        }}
      >
        + Add count
      </button>

      <label style={labelS}>Defence Notes</label>
      <textarea
        style={{ ...taS, minHeight: 80, marginBottom: 14 }}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Any objections made, court orders, bail outcome, instructions received at today's hearing..."
      />

      <Btn
        onClick={generateRouting}
        loading={loading}
        disabled={!allEntered}
        label="Generate Defence Routing Analysis"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {routingAnalysis && (
        <ResultBlock
          title="Defence Routing Analysis"
          content={routingAnalysis}
          onClear={() => setRoutingAnalysis('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'plea_engine';

const DEFAULT_BARGAIN: PleaBargainTerms = {
  offencePleadingTo: '', countsToBeDismissed: '', agreedSentence: '',
  restitution: '', cooperation: '', otherTerms: '', signedBy: '', date: '',
};
const defaultCount = (): CountPlea =>
  ({ id: Date.now(), count: 'Count 1', offence: '', plea: '', notes: '' });

export function PleaEngine({ activeCase }: Props) {
  const role   = activeCase.counsel_role ?? 'defence';
  const isPros = role === 'prosecution';
  const accent = COUNSEL_ROLE_COLORS[role]?.col ?? '#c09030';

  const prosSubTabs = [
    { id: 'plea_record',       label: '1 — Plea Record' },
    { id: 'plea_bargain_pros', label: '2 — Plea Bargain' },
  ];
  const defSubTabs = [
    { id: 'plea_advice',       label: '1 — Plea Advice' },
    { id: 'plea_bargain_def',  label: '2 — Plea Bargain Analysis' },
    { id: 'routing_confirm',   label: '3 — Routing Confirmation' },
  ];

  const [subTab, setSubTab] = useState<SubTab>(isPros ? 'plea_record' : 'plea_advice');

  // Shared count pleas (used in prosecution plea_record + defence routing_confirm)
  const [countPleas,       setCountPleas]       = useState<CountPlea[]>([defaultCount()]);
  const [routingAnalysis,  setRoutingAnalysis]  = useState('');
  const [pleaBargainPros,  setPleaBargainPros]  = useState<PleaBargainTerms>(DEFAULT_BARGAIN);
  const [bargainProsDraft, setBargainProsDraft] = useState('');
  const [caseBackground,   setCaseBackground]   = useState('');
  const [pleaAdvice,       setPleaAdvice]       = useState('');
  const [pleaBargainDef,   setPleaBargainDef]   = useState<PleaBargainTerms>(DEFAULT_BARGAIN);
  const [bargainDefAnalysis, setBargainDefAnalysis] = useState('');
  const [routingNotes,     setRoutingNotes]     = useState('');

  // Load
  useEffect(() => {
    loadBlindSpot(activeCase.id, STORAGE_KEY).then((d: SavedData | null) => {
      if (!d) return;
      if (d.countPleas)            setCountPleas(d.countPleas);
      if (d.routingAnalysis)       setRoutingAnalysis(d.routingAnalysis);
      if (d.pleaBargainPros)       setPleaBargainPros(d.pleaBargainPros);
      if (d.pleaBargainProsDraft)  setBargainProsDraft(d.pleaBargainProsDraft);
      if (d.caseBackground)        setCaseBackground(d.caseBackground);
      if (d.pleaAdvice)            setPleaAdvice(d.pleaAdvice);
      if (d.pleaBargainDef)        setPleaBargainDef(d.pleaBargainDef);
      if (d.pleaBargainDefAnalysis) setBargainDefAnalysis(d.pleaBargainDefAnalysis);
      if (d.routingNotes)          setRoutingNotes(d.routingNotes);
    }).catch(() => {});
  }, [activeCase.id]);

  // Persist
  const persist = useCallback(() => {
    const data: SavedData = {
      countPleas, routingAnalysis, pleaBargainPros, pleaBargainProsDraft: bargainProsDraft,
      caseBackground, pleaAdvice, pleaBargainDef, pleaBargainDefAnalysis: bargainDefAnalysis,
      routingNotes,
    };
    saveBlindSpot(activeCase.id, STORAGE_KEY, data).catch(() => {});
  }, [
    countPleas, routingAnalysis, pleaBargainPros, bargainProsDraft,
    caseBackground, pleaAdvice, pleaBargainDef, bargainDefAnalysis,
    routingNotes, activeCase.id,
  ]);

  useEffect(() => { persist(); }, [persist]);

  const headingLabel = isPros ? 'Plea — Prosecution' : 'Plea — Defence';
  const headingDesc  = isPros
    ? 'Record the plea entered on each count and generate prosecution routing — sentencing or prosecution case.'
    : 'Advise on plea options, manage plea bargain negotiation, and confirm routing based on plea entered.';

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

      {/* Prosecution */}
      {isPros && subTab === 'plea_record' && (
        <PleaRecordTab
          countPleas={countPleas}
          setCountPleas={setCountPleas}
          routingAnalysis={routingAnalysis}
          setRoutingAnalysis={setRoutingAnalysis}
          accent={accent}
          activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'plea_bargain_pros' && (
        <PleaBargainProsTab
          terms={pleaBargainPros}
          setTerms={setPleaBargainPros}
          draft={bargainProsDraft}
          setDraft={setBargainProsDraft}
          accent={accent}
          activeCase={activeCase}
        />
      )}

      {/* Defence */}
      {!isPros && subTab === 'plea_advice' && (
        <PleaAdviceTab
          caseBackground={caseBackground}
          setCaseBackground={setCaseBackground}
          advice={pleaAdvice}
          setAdvice={setPleaAdvice}
          accent={accent}
          activeCase={activeCase}
        />
      )}
      {!isPros && subTab === 'plea_bargain_def' && (
        <PleaBargainDefTab
          terms={pleaBargainDef}
          setTerms={setPleaBargainDef}
          analysis={bargainDefAnalysis}
          setAnalysis={setBargainDefAnalysis}
          accent={accent}
          activeCase={activeCase}
        />
      )}
      {!isPros && subTab === 'routing_confirm' && (
        <RoutingConfirmTab
          countPleas={countPleas}
          setCountPleas={setCountPleas}
          notes={routingNotes}
          setNotes={setRoutingNotes}
          accent={accent}
          activeCase={activeCase}
        />
      )}
    </div>
  );
}
