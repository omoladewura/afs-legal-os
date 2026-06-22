/**
 * AFS Advocates — Matrimonial Causes Engine
 * Phase 2 — Full implementation
 * Phase 9E — MIntelligence upstream pre-population for all sub-tabs
 *
 * Build-plan Phase 2C note: Phase 9E was originally written into a copy of
 * this file at src/matrimonial/engines/MatrimonialEngine.tsx, which was
 * never wired into the app — this file (the one actually imported by
 * MatrimonialDashboard.tsx and CaseDashboard.tsx) was left on its pre-9E
 * version. Phase 2C merged the 9E pre-population logic in here, keeping
 * this file's centralized getPrompt() doctrinal text (the orphaned copy had
 * dropped the s.30/s.32/condonation/nullity-bar registry references) and
 * fixing the Petition ground pre-select to match on the s.15(2)(x) letter
 * rather than relying on an exact string match against the AI's free-text
 * output. THIS is the canonical file — do not edit the orphaned copy.
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
import { loadBlindSpot, saveBlindSpot, loadMatrimonialData } from '@/storage/helpers';
import { Md, ErrorBlock }   from '@/components/common/ui';
import { getPrompt }        from '@/law/prompts';
import type { MExtractionResult } from '@/matrimonial/types';

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
// INTELLIGENCE BANNER — shown when a panel is pre-populated from MIntelligence
// ─────────────────────────────────────────────────────────────────────────────

function IntelligenceBanner({
  runAt,
  version,
  onClear,
}: {
  runAt: string;
  version: number;
  onClear: () => void;
}) {
  const date = runAt
    ? new Date(runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <div style={{
      background: '#f0f8f0', border: '1px solid #60b060', borderRadius: 6,
      padding: '10px 16px', marginBottom: 14,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
    }}>
      <span style={{
        fontSize: 12, color: '#2a6a2a', fontFamily: "'Times New Roman', Times, serif",
        letterSpacing: '.02em',
      }}>
        ⚡ Pre-filled from MIntelligence · Run {date} · Version {version}
      </span>
      <button
        onClick={onClear}
        style={{
          background: 'none', border: '1px solid #2a6a2a', color: '#2a6a2a',
          borderRadius: 4, padding: '3px 10px', fontSize: 11,
          fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
        }}
      >
        Clear and enter manually
      </button>
    </div>
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

function buildMatrimonialSystem(): string {
  return `You are a specialist Nigerian matrimonial causes practitioner. You operate under the Matrimonial Causes Act Cap M7 LFN 2004 ("MCA"), the Matrimonial Causes Rules 1983 ("MCR"), and the applicable practice directions of the High Court of the relevant State or the Federal Capital Territory. The correct court for matrimonial causes is the High Court of a State (or the FCT High Court) — NOT the Federal High Court.

DOCTRINAL RULES — OBSERVE WITHOUT EXCEPTION:
1. ${getPrompt('mca_dissolution_facts')}
2. The parties to a matrimonial cause are always PETITIONER and RESPONDENT — never Claimant and Defendant.
3. Proceedings commence by PETITION (Form 6 MCR) — never by Writ.
4. Jurisdiction: domicile in Nigeria at date of petition (s.2(3) MCA) OR residence in Nigeria for at least two years immediately preceding the petition (s.7 MCA).
5. ADR / reconciliation is available only for ancillary reliefs — it is NOT available for dissolution or nullity proceedings.
6. ${getPrompt('mca_s30_two_year_bar')}
7. ${getPrompt('mca_s32_co_respondent')}
8. ${getPrompt('mca_condonation_ss2627')}
9. ${getPrompt('mca_nullity_bars_ss3537')}
10. The welfare of any children of the marriage is the paramount consideration in all custody matters.

Format your response with clear section headings using ## and ### markers.`;
}
const MATRIMONIAL_SYSTEM = buildMatrimonialSystem();

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function MatrimonialEngine({ activeCase }: Props) {
  const caseId = activeCase?.id ?? 'unknown';

  const [subTab, setSubTab] = useState<SubTabId>('intake');
  const [saved,  setSaved]  = useState<MatrimonialSaved>({} as MatrimonialSaved);
  const { call, loading, error, clearError } = useAI(activeCase);
  const { fullContext } = useIntelligence(activeCase);

  const [intel,     setIntel]     = useState<MExtractionResult | null>(null);
  const [intelMeta, setIntelMeta] = useState<{ runAt: string; version: number } | null>(null);

  useEffect(() => {
    loadBlindSpot<MatrimonialSaved>(caseId, 'matrimonial', {} as MatrimonialSaved)
      .then(setSaved);
  }, [caseId]);

  // Load MIntelligence extraction on mount — Phase 9E, restored after being
  // missing from this file (the live engine was wired to a stale copy that
  // predated the pre-population feature; this brings it in line with
  // MFormsEngine / DecreeEnforcementEngine / MAppeal / MApplications, which
  // already pre-populate from the same source).
  useEffect(() => {
    if (!caseId || caseId === 'unknown') return;
    loadMatrimonialData(caseId).then(mData => {
      if (mData?.intelligence_extraction) {
        setIntel(mData.intelligence_extraction);
        setIntelMeta({
          runAt:   mData.intelligence_run_at   ?? '',
          version: mData.intelligence_version  ?? 1,
        });
      }
    });
  }, [caseId]);

  const save = useCallback((patch: Partial<MatrimonialSaved>) => {
    setSaved(prev => {
      const next = { ...prev, ...patch };
      saveBlindSpot(caseId, 'matrimonial', next);
      return next;
    });
  }, [caseId]);

  // Formats children from MIntelligence extraction into the free-text shape
  // the Intake/Custody panels expect.
  function formatChildrenFromIntel(children: MExtractionResult['children']): string {
    if (!children?.length) return '';
    return children.map(c =>
      `${c.name}${c.age ? `, ${c.age}` : ''}${c.current_arrangement ? ` — currently: ${c.current_arrangement}` : ''}`
    ).join('\n');
  }

  function buildCtx(): string {
    const ip = saved.intakeData;
    return [
      `CASE: ${activeCase?.caseName || 'Matrimonial Matter'} | COURT: ${activeCase?.court || 'High Court (State)'}`,
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
    const [marriageDate,  setMarriageDate]  = useState(
      ip.marriageDate  || intel?.marriage_timeline?.marriage_date || ''
    );
    const [marriagePlace, setMarriagePlace] = useState(
      ip.marriagePlace || intel?.marriage_timeline?.marriage_place || ''
    );
    const [marriageType,  setMarriageType]  = useState(
      ip.marriageType  || intel?.marriage_timeline?.marriage_type  || ''
    );
    const [children,      setChildren]      = useState(
      ip.children || (intel ? formatChildrenFromIntel(intel.children) : '')
    );
    const [jurisdiction,  setJurisdiction]  = useState(ip.jurisdiction  || '');
    const [relief,        setRelief]        = useState(ip.relief        || intel?.relief_sought || '');

    const prePopulated = !saved.intakeData && !!intel;
    const [dismissed, setDismissed] = useState(false);
    const showBanner = prePopulated && !dismissed && !!intelMeta;

    async function run() {
      if (!petitioner || !marriageDate || !relief) return;
      const data: IntakeData = { petitioner, respondent, marriageDate, marriagePlace, marriageType, children, jurisdiction, relief };
      save({ intakeData: data });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        libraryOpts: { queryHint: 'MCA jurisdiction domicile two-year bar s.30 Form 3A s.2(3) s.7 MCA intake checklist' },
        userMsg:  `${buildCtx()}\n\nMARRIAGE TYPE: ${marriageType}\nRELIEF SOUGHT: ${relief}\nCHILDREN OF MARRIAGE: ${children || 'None stated'}\nJURISDICTION BASIS: ${jurisdiction}\n\n## 1. Proper Court\nMatrimonial causes jurisdiction vests in the High Court of the relevant State (or FCT High Court) — confirm the correct court. The Federal High Court has NO matrimonial causes jurisdiction.\n\n## 2. Domicile / Residence Qualification\nDoes the petitioner satisfy (a) domicile in Nigeria at the date of petition under s.2(3) MCA, or (b) residence in Nigeria for at least two years immediately preceding the petition under s.7 MCA? Identify which basis applies and what evidence is required.\n\n## 3. Two-Year Bar (s.30 MCA)\nCalculate from the marriage date provided. If the marriage is less than two years old at the date of filing, the petition may NOT be presented without leave of court. Are any exceptions under s.30(2) available (wilful refusal to consummate s.15(2)(a); adultery s.15(2)(b); rape, sodomy, or bestiality by the respondent s.16(1)(a))? If leave is required, advise on the motion ex-parte procedure under O.4 rr.1–2 MCR.\n\n## 4. Appropriate Relief\nIs the relief sought (dissolution, nullity, judicial separation, RCR, jactitation) correctly identified? Any alternative or additional relief that should be claimed?\n\n## 5. Co-Respondent Warning\nIf adultery (s.15(2)(b)) is a fact relied upon — the co-respondent MUST be joined as a party: s.32 MCA; O.9 rr.2–3 MCR; Ebe v Ebe. Flag immediately if adultery is in play.\n\n## 6. Intake Checklist & Form 3A\nDocuments required before filing:\n- Certificate of Marriage (original or certified copy)\n- Form 3A — Certificate relating to Reconciliation (O.2 r.2 MCR) — MANDATORY for every petition\n- Evidence of domicile or residence qualification\n- Children's birth certificates (where applicable)\n- Any prior proceedings — s.10 MCA declaration\n\n## 7. Condonation / Connivance / Collusion Declaration\nEvery petition must contain a declaration that the petitioner has not condoned, connived at, or colluded in the conduct relied upon (ss.26–27 MCA). Flag any post-knowledge conduct by the petitioner that may constitute condonation.\n\n## 8. Children Urgency\nAre there urgent custody, maintenance, or welfare issues requiring interim orders before the main petition is heard?`,
        maxTokens: 2500,
      });
      if (result) save({ intakeData: data, intakeAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Matrimonial Causes Intake</p>
          <p style={dimS}>Enter the parties, marriage details, children of the marriage, and relief sought. AI assesses jurisdiction, pre-conditions, proper court, and urgent interim orders.</p>

          {showBanner && (
            <IntelligenceBanner
              runAt={intelMeta!.runAt}
              version={intelMeta!.version}
              onClear={() => setDismissed(true)}
            />
          )}

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
    const GROUNDS = [
      's.15(2)(a) — Wilful and persistent refusal to consummate the marriage',
      's.15(2)(b) — Adultery: respondent committed adultery and petitioner finds it intolerable to live with respondent',
      's.15(2)(c) — Unreasonable behaviour: respondent has behaved in such a way that petitioner cannot reasonably be expected to live with respondent (read with s.16 MCA)',
      's.15(2)(d) — Desertion for at least one continuous year immediately preceding the petition',
      's.15(2)(e) — Living apart for at least two years immediately preceding the petition, respondent consents to decree',
      's.15(2)(f) — Living apart for at least three years immediately preceding the petition (no consent required)',
      's.15(2)(g) — Failure to comply with a decree of restitution of conjugal rights for at least one year',
      's.15(2)(h) — Respondent presumed dead — absent without reasonable explanation for at least seven years',
      'Multiple facts (specify)',
    ];

    const prePopulated = !saved.petGround && !!intel?.dissolution_facts?.length;
    const [dismissed, setDismissed] = useState(false);
    const showBanner = prePopulated && !dismissed && !!intelMeta;

    // Pre-select the strongest identified fact. The AI's free-text `fact`
    // label won't reliably match a GROUNDS[] option verbatim, so match on
    // the s.15(2)(x) letter instead of the full string.
    const bestFact = intel?.dissolution_facts?.find(f => f.strength === 'STRONG' || f.strength === 'MODERATE');
    function matchGroundFromFact(fact?: string): string {
      if (!fact) return '';
      const m = fact.match(/\(([a-h])\)/i);
      if (!m) return '';
      const letter = m[1].toLowerCase();
      return GROUNDS.find(g => g.toLowerCase().includes(`s.15(2)(${letter})`)) ?? '';
    }

    const [ground,       setGround]       = useState(saved.petGround       || matchGroundFromFact(bestFact?.fact));
    const [particulars,  setParticulars]  = useState(saved.petParticulars  || '');
    const [childArrange, setChildArrange] = useState(saved.petChildArrange || '');
    const [financials,   setFinancials]   = useState(
      saved.petFinancials ||
      (intel?.financial_picture?.assets_known?.length
        ? `Known assets: ${intel.financial_picture.assets_known.join(', ')}`
        : '')
    );

    // Show co-respondent warning from intelligence
    const coRespondentAlert = intel?.co_respondent?.named && ground.includes('Adultery');


    function getParticularsPlaceholder(): string {
      if (ground.includes('Wilful'))    return 'Date of marriage. Confirmation that the marriage has not been consummated. Whether the refusal is by the petitioner or respondent. Any medical evidence. Whether the refusal is deliberate and persistent.';
      if (ground.includes('Adultery'))  return 'Dates, places, and circumstances of the adultery. Name of co-respondent (if to be joined — s.32 MCA, O.9 MCR). Evidence available — messages, admissions, hotel records. Any prior knowledge or forgiveness by the petitioner (condonation risk).';
      if (ground.includes('behaviour')) return 'Specific incidents of unreasonable behaviour — dates, descriptions, impact on petitioner. Pattern of conduct relied upon. Any medical evidence of injury. Note: behaviour is assessed objectively per s.16 MCA.';
      if (ground.includes('Desertion')) return 'Date desertion began. Who left and who was deserted. Whether the respondent has since returned (period of desertion must be continuous). Whether desertion was actual or constructive.';
      if (ground.includes('two years')) return 'Date parties began living apart. Who left the matrimonial home. Where each party has lived since. Evidence of separation. Confirmation that respondent consents to the decree.';
      if (ground.includes('three years')) return 'Date parties began living apart (must be at least three years before petition date). Where each party has lived since separation. Evidence of continuous living apart.';
      if (ground.includes('restitution')) return 'Date and details of the RCR decree. Name of court that made the order. Respondent\'s failure or refusal to comply. Period of non-compliance (must be at least one year).';
      if (ground.includes('presumed')) return 'Date respondent was last known to be alive. Circumstances of disappearance. Efforts made to locate respondent. Reason no reasonable explanation exists for absence of at least seven years.';
      return 'Describe the facts relied upon in full detail — dates, locations, witnesses, documentary evidence available.';
    }

    async function run() {
      if (!ground || !particulars) return;
      save({ petGround: ground, petParticulars: particulars, petChildArrange: childArrange, petFinancials: financials });
      const ip = saved.intakeData || {} as IntakeData;
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        libraryOpts: { queryHint: 'MCA s.15(2) dissolution fact petition Form 6 MCR O.5 co-respondent s.32 Form 3A condonation ss.26-27 irretrievable breakdown' },
        userMsg: `PARTICULARS: ${particulars}
ARRANGEMENTS FOR CHILDREN: ${childArrange || 'To be determined by court'}
FINANCIAL POSITION: ${financials || 'Not provided'}

${ground.includes('Adultery') ? 'CO-RESPONDENT WARNING: Adultery (s.15(2)(b)) is alleged. The co-respondent must be joined as a party — s.32 MCA, O.9 rr.2–3 MCR, Ebe v Ebe. Flag this in the petition and in a pre-filing note.\n\n' : ''}Draft a COMPLETE PETITION FOR DISSOLUTION OF MARRIAGE to court-filing standard under the Matrimonial Causes Rules 1983. Structure it as follows:

## Court Heading
IN THE HIGH COURT OF [STATE] | HOLDEN AT [CITY] | PETITION NO. [___]/[YEAR] | BETWEEN: [PETITIONER] — PETITIONER and [RESPONDENT] — RESPONDENT${ground.includes('Adultery') ? ' and [CO-RESPONDENT] — CO-RESPONDENT' : ''} | IN THE MATTER OF THE MATRIMONIAL CAUSES ACT CAP M7 LFN 2004

## Petition for Dissolution of Marriage

Include all of the following:
(a) Details of marriage — date, place, type, certificate reference
(b) Petitioner's domicile (s.2(3) MCA) or two-year residence qualification (s.7 MCA)
(c) Prior proceedings declaration — s.10 MCA
(d) The sole ground for dissolution: that the marriage has broken down irretrievably (s.15(1) MCA)
(e) The fact(s) relied upon under s.15(2) with full particulars — using correct subsection letter(s)
(f) Condonation/connivance/collusion declaration — ss.26–27 MCA — petitioner has not condoned, connived at, or colluded in the conduct relied upon
(g) Form 3A certificate — that a reconciliation certificate has been filed per O.2 r.2 MCR
(h) Children of the marriage — names, ages, proposed arrangements
(i) Financial position of each party
(j) Prayer/relief sought including all ancillary reliefs

Draft to court-filing standard in formal legal language. Flag any particulars requiring client verification with [VERIFY: ...] markers.`,
        maxTokens: 3500,
      });
      if (result) save({ petGround: ground, petParticulars: particulars, petChildArrange: childArrange, petFinancials: financials, petitionDraft: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Petition Builder — Dissolution of Marriage</p>
          <p style={dimS}>Generates a complete Petition for Dissolution of Marriage under the MCA. Select the ground, provide the particulars, and AI drafts the full petition to court-filing standard.</p>

          {showBanner && (
            <IntelligenceBanner
              runAt={intelMeta!.runAt}
              version={intelMeta!.version}
              onClear={() => setDismissed(true)}
            />
          )}

          {intel?.dissolution_facts && intel.dissolution_facts.length > 0 && !dismissed && (
            <div style={{
              background: '#f8f4ff', border: '1px solid #c0a8f0', borderRadius: 6,
              padding: '10px 16px', marginBottom: 14, fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", color: '#4a1a7a',
            }}>
              <strong>Facts identified by MIntelligence:</strong>{' '}
              {intel.dissolution_facts.map(f => `${f.fact} (${f.strength})`).join(' · ')}
            </div>
          )}

          {coRespondentAlert && (
            <div style={{
              background: '#fff3f3', border: '1px solid #e04040', borderRadius: 6,
              padding: '10px 16px', marginBottom: 14, fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", color: '#a01010',
            }}>
              ⚠ MIntelligence identified a co-respondent: <strong>{intel!.co_respondent.name || 'named party'}</strong>.
              Co-respondent must be joined — s.32 MCA, O.9 rr.2–3 MCR.
            </div>
          )}

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
        libraryOpts: { queryHint: 'nullity void voidable s.3 s.5 MCA bars ss.35-37 consummation prohibited degrees bigamy' },
        userMsg: `${facts}

## 1. Void or Voidable?

**VOID MARRIAGES (s.3 MCA) — marriage is void ab initio, decree is declaratory only:**
(a) Either party was already married to another person living at the time of the marriage
(b) The parties are within the prohibited degrees of consanguinity or affinity (Schedule to Marriage Act)
(c) The parties are not respectively male and female
(d) In the case of a marriage other than one under the Marriage Act — any ground under the relevant customary or religious law that renders the marriage void

**VOIDABLE MARRIAGES (s.5 MCA) — valid until annulled, decree is constitutive):**
(a) The marriage has not been consummated owing to the incapacity of either party to consummate it
(b) The marriage has not been consummated owing to the wilful refusal of the respondent to consummate it
(c) Either party did not validly consent to the marriage (duress, fraud, mistake as to identity or nature of ceremony, unsoundness of mind)
(d) At the time of the marriage, the respondent was suffering from a communicable venereal disease
(e) At the time of the marriage, the respondent was pregnant by a person other than the petitioner

## 2. Bars to Voidable Nullity (ss.35–37 MCA)
Assess each of the following bars:
- s.35 MCA: The petitioner knew of the defect at the time of the marriage (applies to voidable grounds (c), (d), (e))
- s.36 MCA: Conduct by the petitioner that would make it unjust to grant the decree (approbation / inequitable conduct)
- s.37 MCA: For grounds (c), (d), (e) — proceedings must be commenced within one year of the marriage
- THE DISABILITY RULE: A person whose incapacity or defect gives rise to a voidable ground CANNOT petition on that ground — only the other party can

## 3. Correct Route
Is nullity more appropriate than dissolution? Explain the legal and practical consequences of each route.

## 4. Evidence Required
What evidence must be produced? Medical evidence? Witnesses? Documentary proof of prior subsisting marriage?

## 5. Petition Structure
Outline the structure of a Petition for Nullity for this specific ground, with the correct MCA section citations.

## 6. Consequences
Effects of decree of nullity vs dissolution — on children's legitimacy, property, succession, pension rights.`,
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
    const prePopulated = !saved.custodyChildren && !!intel?.children?.length;
    const [dismissed, setDismissed] = useState(false);
    const showBanner = prePopulated && !dismissed && !!intelMeta;

    const [childrenDetails, setChildrenDetails] = useState(
      saved.custodyChildren || (intel ? formatChildrenFromIntel(intel.children) : '')
    );
    const [currentArrange,  setCurrentArrange]  = useState(saved.custodyCurrent  || '');
    const [clientSituation, setClientSituation] = useState(saved.custodyClient   || '');
    const [otherParty,      setOtherParty]      = useState(saved.custodyOther    || '');

    async function run() {
      if (!childrenDetails || !clientSituation) return;
      save({ custodyChildren: childrenDetails, custodyCurrent: currentArrange, custodyClient: clientSituation, custodyOther: otherParty });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        libraryOpts: { queryHint: 'custody welfare child s.71 MCA interim custody order welfare principle guardianship' },
        userMsg: `${childrenDetails}
CURRENT ARRANGEMENTS:
${currentArrange || 'Not specified'}
OUR CLIENT'S SITUATION:
${clientSituation}
OTHER PARENT'S SITUATION:
${otherParty || 'Not specified'}

## 1. Welfare Principle
Apply the paramount consideration — the welfare of the child (s.71 MCA). List the specific welfare factors Nigerian courts weigh: stability and continuity, primary carer history, wishes of the child (age-appropriate), harmful exposure, each parent's capacity, siblings, extended family.

## 2. Custody Recommendation
Based on the facts, what custody order should be sought? Sole custody, joint custody, or primary residence with generous contact? With reasons.

## 3. Contact Arrangements
What contact arrangements for the non-custodial parent should be proposed — routine contact, holiday contact, special occasion contact?

## 4. Interim Orders
Is an urgent interim custody order needed? What grounds and what application to make?

## 5. Arguments to Anticipate
What custody arguments will the other party make? How to rebut each.

## 6. Supporting Affidavit Structure
Key paragraphs the affidavit in support of custody must address.

## 7. Draft Application Prayers
The specific reliefs to seek in the custody application.`,
        maxTokens: 2800,
      });
      if (result) save({ custodyChildren: childrenDetails, custodyCurrent: currentArrange, custodyClient: clientSituation, custodyOther: otherParty, custodyAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Custody & Guardianship</p>
          <p style={dimS}>Applies the welfare-of-the-child paramount principle. Analyses custody arrangements, interim orders, contact, and generates application prayers and affidavit structure.</p>

          {showBanner && (
            <IntelligenceBanner
              runAt={intelMeta!.runAt}
              version={intelMeta!.version}
              onClear={() => setDismissed(true)}
            />
          )}

          {intel?.children?.some(c => c.welfare_concern) && !dismissed && (
            <div style={{
              background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 6,
              padding: '10px 16px', marginBottom: 14, fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", color: '#8a5a00',
            }}>
              ⚠ <strong>Welfare concerns flagged by MIntelligence:</strong>{' '}
              {intel.children.filter(c => c.welfare_concern).map(c => `${c.name}: ${c.welfare_concern}`).join(' · ')}
            </div>
          )}

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
    const prePopulated = !saved.maintType && !!intel?.financial_picture;
    const [dismissed, setDismissed] = useState(false);
    const showBanner = prePopulated && !dismissed && !!intelMeta;

    const [maintType,    setMaintType]    = useState(
      saved.maintType ||
      (intel?.financial_picture?.pendente_lite_urgency === 'HIGH' ? 'Maintenance Pending Suit (interim)' : '')
    );
    const [clientIncome, setClientIncome] = useState(saved.maintClientIncome || '');
    const [otherIncome,  setOtherIncome]  = useState(saved.maintOtherIncome  || '');
    const [needs,        setNeeds]        = useState(
      saved.maintNeeds || intel?.financial_picture?.maintenance_needs || ''
    );
    const [marriage,     setMarriage]     = useState(saved.maintMarriage     || '');

    // Pendente lite urgency alert
    const pendenteLiteUrgent = intel?.financial_picture?.pendente_lite_urgency === 'HIGH' && !dismissed;

    async function run() {
      if (!maintType || !needs) return;
      save({ maintType, maintClientIncome: clientIncome, maintOtherIncome: otherIncome, maintNeeds: needs, maintMarriage: marriage });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        libraryOpts: { queryHint: 'maintenance pending suit s.70 MCA periodical payments s.72 lump sum financial orders pendente lite' },
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

          {showBanner && (
            <IntelligenceBanner
              runAt={intelMeta!.runAt}
              version={intelMeta!.version}
              onClear={() => setDismissed(true)}
            />
          )}

          {pendenteLiteUrgent && (
            <div style={{
              background: '#fff3f3', border: '1px solid #e04040', borderRadius: 6,
              padding: '10px 16px', marginBottom: 14, fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", color: '#a01010',
            }}>
              ⚠ MIntelligence flagged <strong>HIGH urgency</strong> for maintenance pending suit.
              Immediate application recommended before financial position deteriorates further.
            </div>
          )}

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
    const prePopulated = !saved.propAssets && !!intel?.financial_picture?.assets_known?.length;
    const [dismissed, setDismissed] = useState(false);
    const showBanner = prePopulated && !dismissed && !!intelMeta;

    const [assets,        setAssets]        = useState(
      saved.propAssets ||
      (intel?.financial_picture?.assets_known?.length
        ? intel.financial_picture.assets_known.map((a, i) => `${i + 1}. ${a}`).join('\n')
        : '')
    );
    const [contributions, setContributions] = useState(saved.propContributions || '');
    const [postSep,       setPostSep]       = useState(saved.propPostSep       || '');

    // Disclosure gaps warning
    const disclosureGaps = intel?.financial_picture?.disclosure_gaps ?? [];

    async function run() {
      if (!assets) return;
      save({ propAssets: assets, propContributions: contributions, propPostSep: postSep });
      const result = await call({
        system:   MATRIMONIAL_SYSTEM + fullContext,
        libraryOpts: { queryHint: 'property settlement s.72 MCA matrimonial assets transfer of property financial disclosure variation of settlement' },
        userMsg: `${assets}
CONTRIBUTIONS OF EACH PARTY:
${contributions || 'Not specified'}
POST-SEPARATION ACCRETIONS:
${postSep || 'None stated'}

## 1. Nigerian Legal Framework
Nigeria is NOT a community property jurisdiction. Apply the principles — ownership follows title, but courts have discretion under s.72 MCA to make property orders. Distinguish matrimonial property from separate property.

## 2. Per-Asset Analysis
For each asset listed — legal title holder, financial contributions, non-financial contributions (homemaking, childcare), post-separation accretion, recommended settlement position.

## 3. Matrimonial Home
Specific analysis — whose name? Mortgage? Can client remain? Transfer of property order or Mesne profits?

## 4. Settlement Zone
What is a fair settlement range? Floor and ceiling of a reasonable negotiated outcome.

## 5. Applications Available
Transfer of property order, sale and division of proceeds, variation of settlement — with specific prayers for each.

## 6. Financial Disclosure
What financial disclosure must the other party make? How to compel disclosure if refused.

## 7. Litigation Strategy
Should this be litigated or negotiated? Risk assessment of litigating to judgment.`,
        maxTokens: 2800,
      });
      if (result) save({ propAssets: assets, propContributions: contributions, propPostSep: postSep, propAnalysis: result });
    }

    return (
      <div>
        <div style={cardS}>
          <p style={hS}>Property Settlement Analyser</p>
          <p style={dimS}>Nigerian matrimonial property analysis — ownership follows title, not automatic division. Analyses each asset by title, contributions, and non-financial contributions. Identifies settlement zones and orders available.</p>

          {showBanner && (
            <IntelligenceBanner
              runAt={intelMeta!.runAt}
              version={intelMeta!.version}
              onClear={() => setDismissed(true)}
            />
          )}

          {disclosureGaps.length > 0 && !dismissed && (
            <div style={{
              background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 6,
              padding: '10px 16px', marginBottom: 14, fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", color: '#8a5a00',
            }}>
              ⚠ <strong>Disclosure gaps flagged by MIntelligence:</strong>{' '}
              {disclosureGaps.join(' · ')}
            </div>
          )}

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
        libraryOpts: { queryHint: 'ancillary relief injunction occupation order financial disclosure s.70 s.71 MCA ex parte motion MCR O.11' },
        userMsg: `${situation}

## 1. Injunctions
Restraining order preventing disposal, transfer, or encumbrance of matrimonial assets pending proceedings. Is an ex parte injunction urgently needed? What assets are at risk? Draft the prayer for an injunction.

## 2. Occupation Order
Exclusive occupation of the matrimonial home. Is the client currently in the home? Is there domestic violence? Basis for an occupation order under Nigerian law.

## 3. Financial Disclosure Order
Compelling the other party to make full and frank financial disclosure. What documents should be requested?

## 4. Variation of Settlement
Any ante-nuptial or post-nuptial settlement that can be varied by the court.

## 5. Tenancy Transfer
Is the matrimonial home rented? Can the tenancy be transferred to the client?

## 6. Most Urgent Relief
Which ancillary relief is most urgent and should be applied for first? Draft the motion paper prayers for the most urgent application.

## 7. Procedural Steps
The correct procedure to apply for each relief identified — ex parte or on notice, affidavit requirements, hearing timelines.`,
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

    // Pre-suggest condonation defence if condonation risk flagged
    useEffect(() => {
      if (intel?.condonation_risk?.risk && !saved.respDefences?.length) {
        setDefences(['Condonation (forgave the conduct relied upon)']);
      }
    }, []);

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
        libraryOpts: { queryHint: 'answer to petition Form 15 MCR condonation connivance s.28 MCA cross-petition respondent defences bars' },
        userMsg: `${petitionSummary}
RESPONDENT'S ACCOUNT:
${clientAccount || 'Not provided'}
DEFENCES TO RAISE: ${defences.join(', ') || 'To be identified'}

## 1. Paragraph-by-Paragraph Response
For each allegation in the petition — admit, deny, or neither admit nor deny (with reasons). Identify which facts are truly in dispute.

## 2. Affirmative Defences
For each selected defence — condonation, connivance, delay, petitioner's conduct — develop the legal and factual basis under the MCA.

## 3. Cross-Petition
If the respondent has independent grounds for dissolution — identify them, develop the particulars, and recommend whether to cross-petition.

## 4. Custody & Maintenance Response
Respondent's position on children's arrangements and financial orders if the petition proceeds.

## 5. Strength Assessment
Honest assessment — can this petition be successfully defended? Realistic outcome if defended vs negotiated?

## 6. Answer Structure
Draft the opening section of the Answer to Petition with the formal denials and affirmative defences.

## 7. Negotiation Leverage
What leverage does the respondent have in any financial settlement negotiations?`,
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

          {/* Condonation risk alert from intelligence */}
          {intel?.condonation_risk?.risk && (
            <div style={{
              background: '#fff3f3', border: '1px solid #e04040', borderRadius: 6,
              padding: '10px 16px', marginBottom: 14, fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", color: '#a01010',
            }}>
              ⚠ MIntelligence flagged condonation risk ({intel.condonation_risk.severity}):{' '}
              {intel.condonation_risk.basis}
            </div>
          )}

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
