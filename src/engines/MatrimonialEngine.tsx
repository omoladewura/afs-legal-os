/**
 * AFS Advocates — Matrimonial Causes Engine
 * Phase 2 — Full implementation
 *
 * Eight sub-modules under the Matrimonial Causes Act Cap M7 LFN 2004:
 *  1. Case Intake          — parties, marriage details, jurisdiction, relief assessment
 *  2. Petition Builder     — full dissolution petition to court-filing standard
 *  3. Nullity Analyser     — void (s.3) vs voidable (s.5) MCA, correct route
 *  4. Custody              — welfare-of-child paramount principle, interim orders
 *  5. Maintenance          — pending suit, periodical payments, lump sum, children
 *  6. Property Settlement  — title-follows-ownership, contributions, settlement zone
 *  7. Ancillary Reliefs    — injunctions, occupation orders, disclosure, variations
 *  8. Respondent Defence   — answer to petition, condonation, cross-petition
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case }        from '@/types';
import { T }                from '@/constants/tokens';
import { useAI }            from '@/hooks/useAI';
import { useIntelligence }  from '@/hooks/useIntelligence';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock }   from '@/components/common/ui';
import { useIntelligence } from '@/hooks/useIntelligence';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

interface IntakeData {
  petitioner: string; respondent: string; marriageDate: string;
  marriagePlace: string; marriageType: string; children: string;
  jurisdiction: string; relief: string;
}

interface MatrimonialSaved {
  intakeData?:           IntakeData;
  intakeAnalysis?:       string;
  petGround?:            string;
  petParticulars?:       string;
  petChildArrange?:      string;
  petFinancials?:        string;
  petitionDraft?:        string;
  nullityFacts?:         string;
  nullityAnalysis?:      string;
  custodyChildren?:      string;
  custodyCurrent?:       string;
  custodyClient?:        string;
  custodyOther?:         string;
  custodyAnalysis?:      string;
  maintType?:            string;
  maintClientIncome?:    string;
  maintOtherIncome?:     string;
  maintNeeds?:           string;
  maintMarriage?:        string;
  maintAnalysis?:        string;
  propAssets?:           string;
  propContributions?:    string;
  propPostSep?:          string;
  propAnalysis?:         string;
  ancillarySituation?:   string;
  ancillaryAnalysis?:    string;
  respPetition?:         string;
  respAccount?:          string;
  respDefences?:         string[];
  respAnalysis?:         string;
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
        background:  loading ? '#101018' : off ? '#101018' : 'linear-gradient(135deg,#000000,#a07820)',
        color:       loading ? '#2a2a38' : off ? '#2a2a38' : '#05050c',
        border:      'none', borderRadius: 6, padding: '13px 28px',
        fontSize:    16, fontFamily: "'Times New Roman', Times, serif",
        cursor:      loading || off ? 'not-allowed' : 'pointer',
        fontWeight:  600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function ResultBlock({ title, content, onClear }: { title: string; content: string; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div style={{ background: '#060610', border: '1px solid #1e2e2a', borderRadius: 8, padding: '20px 22px', marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: '#4a8070', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>
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

const MC_SUB_TABS = [
  { id: 'intake',      icon: '📋', label: 'Case Intake'            },
  { id: 'petition',    icon: '§',   label: 'Petition Builder'       },
  { id: 'nullity',     icon: '✗',   label: 'Nullity Analyser'       },
  { id: 'custody',     icon: '👶', label: 'Custody & Guardianship'  },
  { id: 'maintenance', icon: '⚖',  label: 'Maintenance'            },
  { id: 'property',    icon: '🏛', label: 'Property Settlement'     },
  { id: 'ancillary',   icon: '⬛', label: 'Ancillary Reliefs'       },
  { id: 'respondent',  icon: '🛡',  label: 'Respondent Defence'     },
] as const;

type SubTabId = typeof MC_SUB_TABS[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const MATRIMONIAL_SYSTEM = `You are a specialist Nigerian matrimonial causes practitioner. You operate under the Matrimonial Causes Act Cap M7 LFN 2004, the Matrimonial Causes Rules, and the applicable practice directions of the Federal High Court and designated State High Courts. The welfare of any children of the marriage is the paramount consideration in all custody matters. You have deep knowledge of Nigerian matrimonial jurisprudence, the grounds for dissolution, nullity, judicial separation, custody principles, maintenance, and property settlement under Nigerian law. Format your response with clear section headings using ## and ### markers.`;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function MatrimonialEngine({ activeCase }: Props) {
  const caseId = activeCase?.id ?? 'unknown';

  const [subTab, setSubTab] = useState<SubTabId>('intake');
  const [saved,  setSaved]  = useState<MatrimonialSaved>({} as MatrimonialSaved);
  const { fullContext } = useIntelligence(activeCase);

  useEffect(() => {
    loadBlindSpot<MatrimonialSaved>(caseId, 'matrimonial', {} as MatrimonialSaved)
      .then(setSaved);
  }, [caseId]);

  const { call, loading, error, clearError } = useAI();
  const { fullContext } = useIntelligence(activeCase);
  const save = useCallback((patch: Partial<MatrimonialSaved>) => {
    setSaved(prev => {
      const next = { ...prev, ...patch };
      saveBlindSpot(caseId, 'matrimonial', next);
      return next;
    });
  }, [caseId]);

  function buildCtx(): string {
    const ip = saved.intakeData;
    return [
      `CASE: ${activeCase?.caseName || 'Matrimonial Matter'} | COURT: ${activeCase?.court || 'Federal High Court'}`,
      ip ? `PETITIONER: ${ip.petitioner || '—'} | RESPONDENT: ${ip.respondent || '—'}` : '',
      ip ? `DATE OF MARRIAGE: ${ip.marriageDate || '—'} | PLACE: ${ip.marriagePlace || '—'} | TYPE: ${ip.marriageType || '—'}` : '',
      ip?.children ? `CHILDREN: ${ip.children}` : '',
      ip?.jurisdiction ? `JURISDICTION BASIS: ${ip.jurisdiction}` : '',
      `ROLE: ${activeCase?.role || 'Petitioner'}`,
    ].filter(Boolean).join('\n');
  }

  // ── INTAKE ─────────────────────────────────────────────────────────────────

  function IntakePanel() {
    const ip = saved.intakeData || {} as IntakeData;
    const [petitioner,    setPetitioner]    = useState(ip.petitioner    || '');
    const [respondent,    setRespondent]    = useState(ip.respondent    || '');
    const [marriageDate,  setMarriageDate]  = useState(ip.marriageDate  || '');
    const [marriagePlace, setMarriagePlace] = useState(ip.marriagePlace || '');
    const [marriageType,  setMarriageType]  = useState(ip.marriageType  || '');
    const [children,      setChildren]      = useState(ip.children      || '');
    const [jurisdiction,  setJurisdiction]  = useState(ip.jurisdiction  || '');
    const [relief,        setRelief]        = useState(ip.relief        || '');

    async function run() {
      if (!petitioner || !marriageDate || !relief) return;
      const data: IntakeData = { petitioner, respondent, marriageDate, marriagePlace, marriageType, children, jurisdiction, relief };
      save({ intakeData: data });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nMARRIAGE TYPE: ${marriageType}\nRELIEF SOUGHT: ${relief}\nCHILDREN OF MARRIAGE: ${children || 'None stated'}\nJURISDICTION BASIS: ${jurisdiction}\n\n## 1. Proper Court\nIs the Federal High Court or State High Court the correct court? Analyse jurisdiction under s.2 MCA.\n\n## 2. Domicile / Residence Qualification\nDoes the petitioner satisfy the domicile or two-year residence requirement under s.4 MCA?\n\n## 3. Appropriate Relief\nIs the relief sought (dissolution, nullity, judicial separation) correctly identified? Any alternative or additional relief that should be claimed?\n\n## 4. Pre-Conditions\nAny pre-conditions to filing — reconciliation attempt, two-year bar on petitions within two years of marriage (s.30 MCA), unless exceptional hardship or depravity applies.\n\n## 5. Immediate Steps\nThe 5 most urgent steps before filing — documents needed, Certificate of Marriage, domicile evidence.\n\n## 6. Children Urgency\nAre there urgent custody, maintenance, or welfare issues requiring interim orders before the main petition is heard?`,
        maxTokens: 2500,
      });
      if (result) save({ intakeData: data, intakeAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Matrimonial Causes Intake</p>
          <p style={dimS}>Enter the parties, marriage details, children of the marriage, and relief sought. AI assesses jurisdiction, pre-conditions, proper court, and urgent interim orders.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Petitioner (Full Name)</span>
              <input value={petitioner} onChange={e => setPetitioner(e.target.value)} placeholder="Full name of the petitioner" style={iS} />
            </div>
            <div>
              <span style={labelS}>Respondent (Full Name)</span>
              <input value={respondent} onChange={e => setRespondent(e.target.value)} placeholder="Full name of the respondent" style={iS} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Date of Marriage</span>
              <input type="date" value={marriageDate} onChange={e => setMarriageDate(e.target.value)} style={iS} />
            </div>
            <div>
              <span style={labelS}>Place of Marriage</span>
              <input value={marriagePlace} onChange={e => setMarriagePlace(e.target.value)} placeholder="City, State" style={iS} />
            </div>
            <div>
              <span style={labelS}>Type of Marriage</span>
              <select value={marriageType} onChange={e => setMarriageType(e.target.value)} style={iS}>
                <option value="">Select…</option>
                <option>Statutory (Marriage Act)</option>
                <option>Customary Marriage</option>
                <option>Islamic Marriage</option>
                <option>Foreign Marriage</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Children of the Marriage</span>
              <textarea value={children} onChange={e => setChildren(e.target.value)} rows={3}
                placeholder="Names and ages of all children of the marriage. Include step-children where relevant."
                style={{ ...taS, minHeight: 80 }} />
            </div>
            <div>
              <span style={labelS}>Jurisdiction Basis</span>
              <textarea value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} rows={3}
                placeholder="Domicile in Nigeria, or two years' residence in Nigeria immediately before filing. Specify which applies and the facts supporting it."
                style={{ ...taS, minHeight: 80 }} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Relief Sought</span>
            <select value={relief} onChange={e => setRelief(e.target.value)} style={iS}>
              <option value="">Select primary relief…</option>
              <option>Dissolution of Marriage (Divorce)</option>
              <option>Nullity of Marriage (Void)</option>
              <option>Nullity of Marriage (Voidable)</option>
              <option>Judicial Separation</option>
              <option>Dissolution + Custody + Maintenance</option>
              <option>Dissolution + Property Settlement</option>
              <option>All Ancillary Reliefs</option>
            </select>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!petitioner || !marriageDate || !relief} label="📋 Run Matrimonial Intake Assessment" />
        </div>

        <ErrorBlock message={error} />
        {saved.intakeAnalysis && (
          <ResultBlock title="Matrimonial Intake Assessment"
            content={saved.intakeAnalysis}
            onClear={() => { save({ intakeAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── PETITION BUILDER ───────────────────────────────────────────────────────

  function PetitionPanel() {
    const [ground,       setGround]       = useState(saved.petGround       || '');
    const [particulars,  setParticulars]  = useState(saved.petParticulars  || '');
    const [childArrange, setChildArrange] = useState(saved.petChildArrange || '');
    const [financials,   setFinancials]   = useState(saved.petFinancials   || '');

    const GROUNDS = [
      'Adultery (s.15(2)(a) MCA)',
      'Behaviour — Respondent has behaved in such a way that petitioner cannot reasonably be expected to live with respondent (s.15(2)(b))',
      'Desertion for at least one year (s.15(2)(c))',
      'Two-year separation with consent (s.15(2)(d))',
      'Five-year separation without consent (s.15(2)(e))',
      'Multiple grounds',
    ];

    function getParticularsPlaceholder(): string {
      if (ground.includes('Adultery'))    return 'Dates, places, and circumstances of the adultery. Name of co-respondent (if to be named). Evidence available.';
      if (ground.includes('Behaviour'))   return 'Specific incidents of behaviour — dates, descriptions, impact on petitioner. Pattern of conduct relied upon. Any medical evidence of injury.';
      if (ground.includes('Desertion'))   return 'Date desertion began. Did respondent leave? Was petitioner constructively deserted? Has respondent returned at any point?';
      if (ground.includes('separation'))  return 'Date of separation. Who left, where each party has lived since separation. Evidence of separation (utility bills, rent agreements, witness statements).';
      return 'Describe the facts relied upon in full detail — dates, locations, witnesses, documentary evidence available.';
    }

    async function run() {
      if (!ground || !particulars) return;
      save({ petGround: ground, petParticulars: particulars, petChildArrange: childArrange, petFinancials: financials });
      const ip = saved.intakeData || {} as IntakeData;
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nGROUND FOR DISSOLUTION: ${ground}\nPARTICULARS: ${particulars}\nARRANGEMENTS FOR CHILDREN: ${childArrange || 'To be determined by court'}\nFINANCIAL POSITION: ${financials || 'Not provided'}\n\nDraft a COMPLETE PETITION FOR DISSOLUTION OF MARRIAGE to court-filing standard under the Matrimonial Causes Rules. Structure it as follows:\n\n## Court Heading\nIN THE [COURT] | PETITION NO | BETWEEN: [PETITIONER] — PETITIONER and [RESPONDENT] — RESPONDENT | IN THE MATTER OF THE MATRIMONIAL CAUSES ACT CAP M7 LFN 2004\n\n## Petition for Dissolution of Marriage\n\nInclude all of the following:\n(a) Details of marriage — date, place, certificate\n(b) Petitioner's domicile/residence qualification\n(c) Prior proceedings (none, or details)\n(d) Ground for dissolution with full particulars\n(e) Children of the marriage and proposed arrangements\n(f) Financial position of each party\n(g) Prayer/relief sought including all ancillary reliefs\n\nDraft to court-filing standard in formal legal language throughout. Flag any particulars that must be verified by the client before filing with [VERIFY: ...] markers.`,
        maxTokens: 3500,
      });
      if (result) save({ petGround: ground, petParticulars: particulars, petChildArrange: childArrange, petFinancials: financials, petitionDraft: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Petition Builder — Dissolution of Marriage</p>
          <p style={dimS}>Generates a complete Petition for Dissolution of Marriage under the MCA. Select the ground, provide the particulars, and AI drafts the full petition to court-filing standard.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Ground for Dissolution (Section 15(2) MCA)</span>
            <select value={ground} onChange={e => setGround(e.target.value)} style={iS}>
              <option value="">Select ground…</option>
              {GROUNDS.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Particulars of the Ground</span>
            <textarea value={particulars} onChange={e => setParticulars(e.target.value)} rows={7}
              placeholder={getParticularsPlaceholder()}
              style={{ ...taS, minHeight: 150 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Proposed Arrangements for Children</span>
              <textarea value={childArrange} onChange={e => setChildArrange(e.target.value)} rows={4}
                placeholder="Who will the children live with? Contact arrangements for the other parent. School, health, religion."
                style={{ ...taS, minHeight: 90 }} />
            </div>
            <div>
              <span style={labelS}>Financial Position of Each Party</span>
              <textarea value={financials} onChange={e => setFinancials(e.target.value)} rows={4}
                placeholder="Income, assets, liabilities of each party. Matrimonial home — owned, rented, whose name? Pension, investments, business interests."
                style={{ ...taS, minHeight: 90 }} />
            </div>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!ground || !particulars} label="§ Draft Dissolution Petition" />
        </div>

        <ErrorBlock message={error} />
        {saved.petitionDraft && (
          <ResultBlock title="Petition for Dissolution of Marriage"
            content={saved.petitionDraft}
            onClear={() => { save({ petitionDraft: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── NULLITY ANALYSER ───────────────────────────────────────────────────────

  function NullityPanel() {
    const [facts, setFacts] = useState(saved.nullityFacts || '');

    async function run() {
      if (!facts) return;
      save({ nullityFacts: facts });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nFACTS RELEVANT TO NULLITY:\n${facts}\n\n## 1. Void or Voidable?\nApply ss.3 and 5 MCA:\n\n**VOID MARRIAGES (s.3 MCA):** either party already married (bigamy), parties within prohibited degrees of consanguinity or affinity, parties not male and female, ceremony not valid.\n\n**VOIDABLE MARRIAGES (s.5 MCA):** non-consummation due to incapacity or wilful refusal, lack of consent (duress, fraud, mistake, unsoundness of mind), respondent suffering communicable venereal disease at time of marriage, respondent pregnant by another at time of marriage.\n\n## 2. Correct Route\nIs this a nullity matter or should the practitioner file for dissolution instead? Explain which is more appropriate.\n\n## 3. Evidence Required\nWhat evidence must be produced to establish the nullity ground? Medical evidence? Witnesses? Documentary evidence of prior marriage?\n\n## 4. Bars to Nullity\nAny bars to the petition — approbation, delay, petitioner's knowledge at time of marriage?\n\n## 5. Petition Structure\nOutline the structure of a Petition for Nullity for this specific ground.\n\n## 6. Consequences\nEffects of a decree of nullity vs dissolution — on children's legitimacy, property, succession, pension rights.`,
        maxTokens: 2500,
      });
      if (result) save({ nullityAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Nullity Analyser</p>
          <p style={dimS}>Analyses whether the marriage is void (s.3 MCA) or voidable (s.5 MCA). Determines correct route — nullity or dissolution — and outlines the petition structure and required evidence.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Facts Relevant to Nullity</span>
            <textarea value={facts} onChange={e => setFacts(e.target.value)} rows={10}
              placeholder="Describe all facts that may make the marriage void or voidable. Include: any prior marriage still subsisting, family relationship between parties, circumstances of the ceremony, consummation status, mental state at time of marriage, any fraud or duress, any communicable disease, any pregnancy by another."
              style={{ ...taS, minHeight: 200 }} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!facts} label="✗ Analyse Nullity Grounds" />
        </div>

        <ErrorBlock message={error} />
        {saved.nullityAnalysis && (
          <ResultBlock title="Nullity Analysis"
            content={saved.nullityAnalysis}
            onClear={() => { save({ nullityAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── CUSTODY & GUARDIANSHIP ─────────────────────────────────────────────────

  function CustodyPanel() {
    const [childrenDetails, setChildrenDetails] = useState(saved.custodyChildren || '');
    const [currentArrange,  setCurrentArrange]  = useState(saved.custodyCurrent  || '');
    const [clientSituation, setClientSituation] = useState(saved.custodyClient   || '');
    const [otherParty,      setOtherParty]      = useState(saved.custodyOther    || '');

    async function run() {
      if (!childrenDetails || !clientSituation) return;
      save({ custodyChildren: childrenDetails, custodyCurrent: currentArrange, custodyClient: clientSituation, custodyOther: otherParty });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nCHILDREN DETAILS (names, ages, schooling):\n${childrenDetails}\nCURRENT ARRANGEMENTS:\n${currentArrange || 'Not specified'}\nOUR CLIENT'S SITUATION:\n${clientSituation}\nOTHER PARENT'S SITUATION:\n${otherParty || 'Not specified'}\n\n## 1. Welfare Principle\nApply the paramount consideration — the welfare of the child (s.71 MCA). List the specific welfare factors Nigerian courts weigh: stability and continuity, primary carer history, wishes of the child (age-appropriate), harmful exposure, each parent's capacity, siblings, extended family.\n\n## 2. Custody Recommendation\nBased on the facts, what custody order should be sought? Sole custody, joint custody, or primary residence with generous contact? With reasons.\n\n## 3. Contact Arrangements\nWhat contact arrangements for the non-custodial parent should be proposed — routine contact, holiday contact, special occasion contact?\n\n## 4. Interim Orders\nIs an urgent interim custody order needed? What grounds and what application to make?\n\n## 5. Arguments to Anticipate\nWhat custody arguments will the other party make? How to rebut each.\n\n## 6. Supporting Affidavit Structure\nKey paragraphs the affidavit in support of custody must address.\n\n## 7. Draft Application Prayers\nThe specific reliefs to seek in the custody application.`,
        maxTokens: 2800,
      });
      if (result) save({ custodyChildren: childrenDetails, custodyCurrent: currentArrange, custodyClient: clientSituation, custodyOther: otherParty, custodyAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Custody & Guardianship</p>
          <p style={dimS}>Applies the welfare-of-the-child paramount principle. Analyses custody arrangements, interim orders, contact, and generates application prayers and affidavit structure.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Children of the Marriage — Names, Ages, Schooling</span>
            <textarea value={childrenDetails} onChange={e => setChildrenDetails(e.target.value)} rows={3}
              placeholder="e.g. Chidi Eze, 8 years, attends Greensprings School Lagos. Adaeze Eze, 5 years, attends Rainbow Nursery School."
              style={{ ...taS, minHeight: 80 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Current Arrangements (who are the children living with now?)</span>
            <textarea value={currentArrange} onChange={e => setCurrentArrange(e.target.value)} rows={3}
              placeholder="Who do the children currently live with? Since when? Any informal arrangements in place? Any court orders already made?"
              style={{ ...taS, minHeight: 80 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Our Client's Situation</span>
              <textarea value={clientSituation} onChange={e => setClientSituation(e.target.value)} rows={5}
                placeholder="Occupation, income, living arrangements, relationship with children, caregiving history, any concerns about the other parent."
                style={{ ...taS, minHeight: 110 }} />
            </div>
            <div>
              <span style={labelS}>Other Parent's Situation</span>
              <textarea value={otherParty} onChange={e => setOtherParty(e.target.value)} rows={5}
                placeholder="Occupation, living situation, relationship with children, any concerns — substance abuse, violence, neglect, relocation plans, new partner."
                style={{ ...taS, minHeight: 110 }} />
            </div>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!childrenDetails || !clientSituation} label="👶 Analyse Custody & Build Application" />
        </div>

        <ErrorBlock message={error} />
        {saved.custodyAnalysis && (
          <ResultBlock title="Custody Analysis & Application Strategy"
            content={saved.custodyAnalysis}
            onClear={() => { save({ custodyAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── MAINTENANCE ────────────────────────────────────────────────────────────

  function MaintenancePanel() {
    const [maintType,    setMaintType]    = useState(saved.maintType         || '');
    const [clientIncome, setClientIncome] = useState(saved.maintClientIncome || '');
    const [otherIncome,  setOtherIncome]  = useState(saved.maintOtherIncome  || '');
    const [needs,        setNeeds]        = useState(saved.maintNeeds        || '');
    const [marriage,     setMarriage]     = useState(saved.maintMarriage     || '');

    async function run() {
      if (!maintType || !needs) return;
      save({ maintType, maintClientIncome: clientIncome, maintOtherIncome: otherIncome, maintNeeds: needs, maintMarriage: marriage });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nMAINTENANCE TYPE: ${maintType}\nCLIENT'S INCOME & ASSETS: ${clientIncome || 'Not disclosed'}\nOTHER PARTY'S INCOME & ASSETS: ${otherIncome || 'Not disclosed'}\nFINANCIAL NEEDS: ${needs}\nSTANDARD OF LIVING DURING MARRIAGE: ${marriage || 'Not described'}\n\n## 1. Legal Basis\nApplicable provisions of the MCA for this type of maintenance — maintenance pending suit (s.70), periodical payments (s.72), lump sum orders.\n\n## 2. Quantum Assessment\nWhat is a reasonable maintenance figure? Consider: earning capacity of each party, standard of living during marriage, financial needs of applicant and children, contributions made, any disability, duration of marriage.\n\n## 3. Maintenance Pending Suit\nIf applicable — is an interim maintenance order needed now? What to apply for and on what grounds.\n\n## 4. Children's Maintenance\nSeparate analysis of maintenance for each child — school fees, medical, general upkeep.\n\n## 5. Arguments for Our Position\nThe strongest arguments for the maintenance figure we will seek.\n\n## 6. Anticipated Opposition\nHow the other side will resist and how to rebut.\n\n## 7. Draft Application Prayers\nThe specific maintenance orders to seek, including the amount and frequency.`,
        maxTokens: 2500,
      });
      if (result) save({ maintType, maintClientIncome: clientIncome, maintOtherIncome: otherIncome, maintNeeds: needs, maintMarriage: marriage, maintAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Maintenance Calculator & Drafter</p>
          <p style={dimS}>Analyses maintenance obligations — maintenance pending suit, periodical payments, and lump sum. Considers earning capacity, standard of living, children's needs, and drafts the application prayers.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Type of Maintenance</span>
              <select value={maintType} onChange={e => setMaintType(e.target.value)} style={iS}>
                <option value="">Select…</option>
                <option>Maintenance Pending Suit (interim)</option>
                <option>Periodical Payments Order</option>
                <option>Lump Sum Order</option>
                <option>Children's Maintenance Only</option>
                <option>All Maintenance Orders</option>
              </select>
            </div>
            <div>
              <span style={labelS}>Standard of Living During Marriage</span>
              <input value={marriage} onChange={e => setMarriage(e.target.value)}
                placeholder="e.g. High — private school, domestic staff, overseas holidays"
                style={iS} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Our Client's Income & Financial Position</span>
              <textarea value={clientIncome} onChange={e => setClientIncome(e.target.value)} rows={4}
                placeholder="Monthly income, employment status, assets, liabilities, earning capacity. Is the client currently able to meet expenses?"
                style={{ ...taS, minHeight: 90 }} />
            </div>
            <div>
              <span style={labelS}>Other Party's Income & Financial Position</span>
              <textarea value={otherIncome} onChange={e => setOtherIncome(e.target.value)} rows={4}
                placeholder="Monthly income, business interests, property, investments. Include known or estimated figures."
                style={{ ...taS, minHeight: 90 }} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Financial Needs (client and children)</span>
            <textarea value={needs} onChange={e => setNeeds(e.target.value)} rows={4}
              placeholder="Monthly expenses — rent, school fees, feeding, medical, transport, utilities, domestic help. Break down by category. Include children's expenses separately."
              style={taS} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!maintType || !needs} label="⚖ Analyse Maintenance & Draft Application" />
        </div>

        <ErrorBlock message={error} />
        {saved.maintAnalysis && (
          <ResultBlock title="Maintenance Analysis"
            content={saved.maintAnalysis}
            onClear={() => { save({ maintAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── PROPERTY SETTLEMENT ────────────────────────────────────────────────────

  function PropertyPanel() {
    const [assets,        setAssets]        = useState(saved.propAssets        || '');
    const [contributions, setContributions] = useState(saved.propContributions || '');
    const [postSep,       setPostSep]       = useState(saved.propPostSep       || '');

    async function run() {
      if (!assets) return;
      save({ propAssets: assets, propContributions: contributions, propPostSep: postSep });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nMATRIMONIAL ASSETS:\n${assets}\nCONTRIBUTIONS OF EACH PARTY:\n${contributions || 'Not specified'}\nPOST-SEPARATION ACCRETIONS:\n${postSep || 'None stated'}\n\n## 1. Nigerian Legal Framework\nNigeria is NOT a community property jurisdiction. Apply the principles — ownership follows title, but courts have discretion under s.72 MCA to make property orders. Distinguish matrimonial property from separate property.\n\n## 2. Per-Asset Analysis\nFor each asset listed — legal title holder, financial contributions, non-financial contributions (homemaking, childcare), post-separation accretion, recommended settlement position.\n\n## 3. Matrimonial Home\nSpecific analysis — whose name? Mortgage? Can client remain? Transfer of property order or Mesne profits?\n\n## 4. Settlement Zone\nWhat is a fair settlement range? Floor and ceiling of a reasonable negotiated outcome.\n\n## 5. Applications Available\nTransfer of property order, sale and division of proceeds, variation of settlement — with specific prayers for each.\n\n## 6. Financial Disclosure\nWhat financial disclosure must the other party make? How to compel disclosure if refused.\n\n## 7. Litigation Strategy\nShould this be litigated or negotiated? Risk assessment of litigating to judgment.`,
        maxTokens: 2800,
      });
      if (result) save({ propAssets: assets, propContributions: contributions, propPostSep: postSep, propAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Property Settlement Analyser</p>
          <p style={dimS}>Nigerian matrimonial property analysis — ownership follows title, not automatic division. Analyses each asset by title, contributions, and non-financial contributions. Identifies settlement zones and orders available.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Matrimonial Assets (list each asset with title holder and estimated value)</span>
            <textarea value={assets} onChange={e => setAssets(e.target.value)} rows={7}
              placeholder={`e.g.\n1. Matrimonial home — 14 Bourdillon Road, Ikoyi — registered in respondent's name — est. value ₦180m\n2. Toyota Land Cruiser 2022 — in petitioner's name — est. value ₦35m\n3. Joint savings account — First Bank — est. balance ₦8m\n4. Respondent's business (ABC Ltd) — est. value ₦50m`}
              style={{ ...taS, minHeight: 160 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <span style={labelS}>Contributions of Each Party</span>
              <textarea value={contributions} onChange={e => setContributions(e.target.value)} rows={5}
                placeholder="Financial contributions — who paid the mortgage, deposits, improvements. Non-financial contributions — who was the primary homemaker, who raised the children, who supported the other's career."
                style={{ ...taS, minHeight: 110 }} />
            </div>
            <div>
              <span style={labelS}>Post-Separation Accretions</span>
              <textarea value={postSep} onChange={e => setPostSep(e.target.value)} rows={5}
                placeholder="Assets acquired or increased in value after the date of separation. Note the date of separation and what each party has acquired or earned since."
                style={{ ...taS, minHeight: 110 }} />
            </div>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!assets} label="🏛 Analyse Property Settlement" />
        </div>

        <ErrorBlock message={error} />
        {saved.propAnalysis && (
          <ResultBlock title="Property Settlement Analysis"
            content={saved.propAnalysis}
            onClear={() => { save({ propAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── ANCILLARY RELIEFS ──────────────────────────────────────────────────────

  function AncillaryPanel() {
    const [situation, setSituation] = useState(saved.ancillarySituation || '');

    async function run() {
      if (!situation) return;
      save({ ancillarySituation: situation });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nSITUATION:\n${situation}\n\n## 1. Injunctions\nRestraining order preventing disposal, transfer, or encumbrance of matrimonial assets pending proceedings. Is an ex parte injunction urgently needed? What assets are at risk? Draft the prayer for an injunction.\n\n## 2. Occupation Order\nExclusive occupation of the matrimonial home. Is the client currently in the home? Is there domestic violence? Basis for an occupation order under Nigerian law.\n\n## 3. Financial Disclosure Order\nCompelling the other party to make full and frank financial disclosure. What documents should be requested?\n\n## 4. Variation of Settlement\nAny ante-nuptial or post-nuptial settlement that can be varied by the court.\n\n## 5. Tenancy Transfer\nIs the matrimonial home rented? Can the tenancy be transferred to the client?\n\n## 6. Most Urgent Relief\nWhich ancillary relief is most urgent and should be applied for first? Draft the motion paper prayers for the most urgent application.\n\n## 7. Procedural Steps\nThe correct procedure to apply for each relief identified — ex parte or on notice, affidavit requirements, hearing timelines.`,
        maxTokens: 2500,
      });
      if (result) save({ ancillarySituation: situation, ancillaryAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Ancillary Relief Builder</p>
          <p style={dimS}>Identifies and drafts all ancillary reliefs — injunctions restraining disposal of assets, occupation orders, financial disclosure, variation of settlements, tenancy transfers. Prioritises by urgency.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Situation Requiring Ancillary Relief</span>
            <textarea value={situation} onChange={e => setSituation(e.target.value)} rows={8}
              placeholder="Describe what is happening that requires urgent or ancillary relief. Is the respondent selling or hiding assets? Is there domestic violence in the matrimonial home? Has the respondent refused to disclose finances? Is there a risk of dissipation of assets?"
              style={{ ...taS, minHeight: 170 }} />
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!situation} label="⬛ Identify & Draft Ancillary Reliefs" />
        </div>

        <ErrorBlock message={error} />
        {saved.ancillaryAnalysis && (
          <ResultBlock title="Ancillary Reliefs Analysis"
            content={saved.ancillaryAnalysis}
            onClear={() => { save({ ancillaryAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── RESPONDENT DEFENCE ─────────────────────────────────────────────────────

  function RespondentPanel() {
    const [petitionSummary, setPetitionSummary] = useState(saved.respPetition  || '');
    const [clientAccount,   setClientAccount]   = useState(saved.respAccount   || '');
    const [defences,        setDefences]        = useState<string[]>(saved.respDefences || []);

    const DEFENCE_OPTIONS = [
      'Condonation (forgave the conduct relied upon)',
      'Connivance (consented to or encouraged the conduct)',
      'Unreasonable delay in filing',
      "Improper conduct of petitioner (petitioner's own adultery / behaviour)",
      "Denials — petitioner's allegations are false",
      'Cross-Petition — respondent has own grounds for dissolution',
    ];

    function toggleDefence(d: string) {
      const next = defences.includes(d) ? defences.filter(x => x !== d) : [...defences, d];
      setDefences(next);
      save({ respDefences: next });
    }

    async function run() {
      if (!petitionSummary) return;
      save({ respPetition: petitionSummary, respAccount: clientAccount, respDefences: defences });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        userMsg:  `${buildCtx()}\n\nPETITION GROUNDS ALLEGED:\n${petitionSummary}\nRESPONDENT'S ACCOUNT:\n${clientAccount || 'Not provided'}\nDEFENCES TO RAISE: ${defences.join(', ') || 'To be identified'}\n\n## 1. Paragraph-by-Paragraph Response\nFor each allegation in the petition — admit, deny, or neither admit nor deny (with reasons). Identify which facts are truly in dispute.\n\n## 2. Affirmative Defences\nFor each selected defence — condonation, connivance, delay, petitioner's conduct — develop the legal and factual basis under the MCA.\n\n## 3. Cross-Petition\nIf the respondent has independent grounds for dissolution — identify them, develop the particulars, and recommend whether to cross-petition.\n\n## 4. Custody & Maintenance Response\nRespondent's position on children's arrangements and financial orders if the petition proceeds.\n\n## 5. Strength Assessment\nHonest assessment — can this petition be successfully defended? Realistic outcome if defended vs negotiated?\n\n## 6. Answer Structure\nDraft the opening section of the Answer to Petition with the formal denials and affirmative defences.\n\n## 7. Negotiation Leverage\nWhat leverage does the respondent have in any financial settlement negotiations?`,
        maxTokens: 2800,
      });
      if (result) save({ respPetition: petitionSummary, respAccount: clientAccount, respDefences: defences, respAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Respondent Defence Module</p>
          <p style={dimS}>Builds the Answer to Petition. Analyses grounds alleged, identifies defences (condonation, connivance, delay, petitioner's conduct), and develops cross-petition where warranted.</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Petition Grounds Alleged (summarise what the petition claims)</span>
            <textarea value={petitionSummary} onChange={e => setPetitionSummary(e.target.value)} rows={5}
              placeholder="Summarise the grounds and particulars alleged in the petition. What has the petitioner claimed? What specific incidents or facts does the petition rely on?"
              style={taS} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelS}>Respondent's Account & Instructions</span>
            <textarea value={clientAccount} onChange={e => setClientAccount(e.target.value)} rows={5}
              placeholder="What is the respondent's version of events? Which allegations are disputed? Does the respondent have their own grievances or grounds?"
              style={taS} />
          </div>

          <div style={{ marginBottom: 18 }}>
            <span style={labelS}>Defences to Raise</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {DEFENCE_OPTIONS.map(d => (
                <button key={d} onClick={() => toggleDefence(d)} style={{
                  background:   defences.includes(d) ? '#eeeeee' : '#080810',
                  border:       defences.includes(d) ? '1px solid #3a3060' : '1px solid #141420',
                  color:        defences.includes(d) ? T.gold : '#505060',
                  borderRadius: 4, padding: '6px 12px', fontSize: 12,
                  fontFamily:   "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em',
                }}>
                  {defences.includes(d) ? '✓ ' : ''}{d}
                </button>
              ))}
            </div>
          </div>

          <ActionBtn onClick={run} loading={loading} disabled={!petitionSummary} label="🛡 Build Respondent's Answer" />
        </div>

        <ErrorBlock message={error} />
        {saved.respAnalysis && (
          <ResultBlock title="Respondent's Answer & Defence Strategy"
            content={saved.respAnalysis}
            onClear={() => { save({ respAnalysis: undefined }); clearError(); }} />
        )}
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const panels: Record<SubTabId, React.ReactNode> = {
    intake:      <IntakePanel />,
    petition:    <PetitionPanel />,
    nullity:     <NullityPanel />,
    custody:     <CustodyPanel />,
    maintenance: <MaintenancePanel />,
    property:    <PropertyPanel />,
    ancillary:   <AncillaryPanel />,
    respondent:  <RespondentPanel />,
  };

  return (
    <div style={{ padding: '24px 0', animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, border: '1px solid #3a2208', padding: '3px 10px', borderRadius: 2 }}>
            Matrimonial Causes
          </span>
          <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase' }}>
            MCA Cap M7 LFN 2004 · Matrimonial Causes Rules · Welfare of Children Paramount
          </span>
        </div>
        <h2 style={{ fontSize: 28, color: T.text, fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', margin: 0 }}>
          Matrimonial Causes Engine
        </h2>
        <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginTop: 6, maxWidth: 740 }}>
          Standalone matrimonial causes intelligence under the Matrimonial Causes Act Cap M7 LFN 2004. Petition drafting, nullity analysis, custody and guardianship applications, maintenance calculation, property settlement, ancillary reliefs, and respondent defence — all governed by the MCA, the Matrimonial Causes Rules, and the welfare-of-children paramount principle.
        </p>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24, borderBottom: '1px solid #12121e', paddingBottom: 12 }}>
        {MC_SUB_TABS.map(st => (
          <button
            key={st.id}
            onClick={() => { setSubTab(st.id); clearError(); }}
            style={{
              background:    subTab === st.id ? '#e8e8e8' : 'transparent',
              border:        subTab === st.id ? '1px solid #2a2a3e' : '1px solid transparent',
              color:         subTab === st.id ? T.gold : '#505060',
              borderRadius:  5, padding: '7px 14px', fontSize: 12,
              fontFamily:    "'Times New Roman', Times, serif", cursor: 'pointer',
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
