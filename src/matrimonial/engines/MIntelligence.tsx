/**
 * AFS Advocates — Matrimonial Intelligence Engine (MIntelligence)
 * Phase 5
 *
 * 5-step pipeline mirroring IntelligenceEngine but with MCA-specific schema:
 *   1. Raw Facts intake
 *   2. MCA Extraction (marriage timeline, s.15(2) facts, two-year bar,
 *      children, financial picture, condonation risk, co-respondent,
 *      decree stage, gaps and risks)
 *   3. Dynamic follow-up questions
 *   4. Evidence Map
 *   5. Intelligence Package
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useCallback } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { Md, ErrorBlock } from '@/components/common/ui';
import type {
  MarriageTimeline,
  S152FactInPlay,
  TwoYearBar,
  ChildRecord,
  FinancialPicture,
  MExtractionResult,
} from '@/matrimonial/types';
import { writeIntelligenceToCase } from '@/storage/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const MI_STEPS = [
  { id: 1, label: 'Raw Facts' },
  { id: 2, label: 'Extraction' },
  { id: 3, label: 'Follow-Up' },
  { id: 4, label: 'Evidence Map' },
  { id: 5, label: 'Package' },
];

const SYSTEM = `You are a specialist Nigerian matrimonial causes intelligence analyst operating under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and the Matrimonial Causes Rules 1983 (MCR). The correct court is the High Court of a State or the FCT High Court — NOT the Federal High Court.

DOCTRINAL RULES:
- Sole ground for dissolution: irretrievable breakdown s.15(1) MCA. The s.15(2)(a)–(h) facts are EVIDENCE of breakdown, not separate grounds.
- Parties are PETITIONER and RESPONDENT — never Claimant/Defendant.
- Proceedings commence by Petition (Form 6 MCR), never by Writ.
- s.30 MCA: No petition for dissolution may be presented within 2 years of marriage UNLESS an exception applies: (a) wilful refusal to consummate s.15(2)(a); (b) adultery s.15(2)(b); (c) rape/sodomy/bestiality by respondent s.16(1)(a). Otherwise leave required by motion ex-parte O.4 rr.1–2 MCR.
- s.15(2) facts in correct order: (a) wilful refusal consummate; (b) adultery+intolerability; (c) unreasonable behaviour s.16; (d) desertion 1 year; (e) separation 2 years consent; (f) separation 3 years no consent; (g) non-compliance RCR decree; (h) presumed death 7 years.
- Co-respondent must be joined when adultery is alleged: s.32 MCA, O.9 rr.2–3 MCR.
- Condonation (ss.26–27 MCA) bars adultery and behaviour facts if petitioner forgave and resumed cohabitation.
- Decree nisi to absolute: s.57 (28 days) if children welfare order made; s.58 (3 months) otherwise.
- s.241(2) CFRN: NO appeal lies against a decree absolute — hard constitutional bar.

Always respond in valid JSON only. No preamble, no markdown fences.`;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — Phase 9A: promoted to @/matrimonial/types and imported above.
// ─────────────────────────────────────────────────────────────────────────────


interface EvidenceMapItem {
  issue:              string;
  evidence_needed:    string[];
  evidence_available: string[];
  evidence_missing:   string[];
  priority:           'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  mcr_rule?:          string;
}

interface MIData {
  stage:            number;
  rawFacts:         string;
  extraction:       MExtractionResult | null;
  followUpQs:       Array<{ id: string; question: string; purpose: string }>;
  followUpAs:       Record<string, string>;
  evidenceMap:      EvidenceMapItem[] | null;
  intPackage:       string;
  intelligenceSaved?: boolean; // Phase 9A — true after successful write to storage
}

interface Props {
  activeCase: Case;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '10px 13px', fontSize: 14,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.8, minHeight: 120 };
const lbS: React.CSSProperties = {
  fontSize: 9, color: T.mute, fontFamily: SERIF,
  letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600,
  display: 'block', marginBottom: 5,
};
const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0',
  borderRadius: 8, padding: '20px 22px', marginBottom: 16,
};
const secH: React.CSSProperties = {
  fontSize: 11, fontFamily: SERIF, letterSpacing: '.12em',
  textTransform: 'uppercase' as const, color: '#4a1a7a', fontWeight: 600,
  marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #ede0f5',
};

function Btn({ onClick, loading, disabled, label, variant = 'primary' }: {
  onClick: () => void; loading: boolean; disabled?: boolean; label: string;
  variant?: 'primary' | 'secondary';
}) {
  const off = disabled && !loading;
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      background:  loading ? '#f0f0f0' : off ? '#f0f0f0' : variant === 'primary' ? '#111111' : '#ffffff',
      color:       loading ? '#aaaaaa' : off ? '#aaaaaa' : variant === 'primary' ? '#ffffff' : '#333333',
      border:      variant === 'secondary' ? '1px solid #cccccc' : 'none',
      borderRadius: 5, padding: '10px 22px', fontSize: 13,
      fontFamily: SERIF, cursor: loading || off ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳  Working…' : label}
    </button>
  );
}

function SevBadge({ sev }: { sev: string }) {
  const c: Record<string, { bg: string; col: string; bdr: string }> = {
    HIGH:     { bg: '#fbedf0', col: '#7a1a1a', bdr: '#e8b8c0' },
    MEDIUM:   { bg: '#fdf7ed', col: '#7a5a00', bdr: '#e8d4a0' },
    LOW:      { bg: '#edfaf3', col: '#1a5a3a', bdr: '#b8e8cc' },
    CRITICAL: { bg: '#fbedf0', col: '#7a0000', bdr: '#cc8080' },
  };
  const s = c[sev] ?? { bg: '#f5f5f5', col: '#444444', bdr: '#cccccc' };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase' as const, background: s.bg,
      color: s.col, border: `1px solid ${s.bdr}`,
      borderRadius: 3, padding: '2px 7px', fontFamily: SERIF,
    }}>{sev}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP HEADER
// ─────────────────────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' as const }}>
      {MI_STEPS.map(s => {
        const done    = current > s.id;
        const active  = current === s.id;
        return (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: active ? '#4a1a7a' : done ? '#edfaf3' : '#f5f5f5',
            border: `1px solid ${active ? '#7a3ab0' : done ? '#b8e8cc' : '#e0e0e0'}`,
            borderRadius: 4, padding: '5px 12px',
          }}>
            <span style={{
              fontSize: 10, fontFamily: SERIF, fontWeight: 600,
              color: active ? '#ffffff' : done ? '#1a5a3a' : '#aaaaaa',
            }}>
              {done ? '✓' : s.id}. {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTION DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

function ExtractionDisplay({ ex }: { ex: MExtractionResult }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* Marriage Timeline */}
      <div style={cardS}>
        <div style={secH}>Marriage Timeline</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Date of Marriage',  ex.marriage_timeline.marriage_date],
            ['Place',             ex.marriage_timeline.marriage_place],
            ['Type',              ex.marriage_timeline.marriage_type],
            ['Cohabitation Ended', ex.marriage_timeline.cohabitation_end],
          ].map(([k, v]) => (
            <div key={k}>
              <span style={lbS}>{k}</span>
              <span style={{ fontFamily: SERIF, fontSize: 14, color: '#111111' }}>{v || '—'}</span>
            </div>
          ))}
        </div>
        {ex.marriage_timeline.cohabitation_history && (
          <p style={{ marginTop: 10, fontSize: 13, fontFamily: SERIF, color: '#444444', lineHeight: 1.7 }}>
            {ex.marriage_timeline.cohabitation_history}
          </p>
        )}
      </div>

      {/* Relief & Two-Year Bar */}
      <div style={cardS}>
        <div style={secH}>Relief Sought & s.30 Two-Year Bar</div>
        <p style={{ fontSize: 14, fontFamily: SERIF, color: '#111111', marginBottom: 10 }}>
          <strong>Relief:</strong> {ex.relief_sought}
        </p>
        <div style={{
          background: ex.two_year_bar.bar_applies ? '#fff8e1' : '#edfaf3',
          border: `1px solid ${ex.two_year_bar.bar_applies ? '#f0c040' : '#b8e8cc'}`,
          borderRadius: 5, padding: '10px 14px',
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const,
            color: ex.two_year_bar.bar_applies ? '#7a5a00' : '#1a5a3a' }}>
            {ex.two_year_bar.bar_applies ? '⚠ s.30 Bar Applies' : '✓ s.30 Bar — No Issue'}
          </span>
          {ex.two_year_bar.bar_applies && (
            <p style={{ fontSize: 13, fontFamily: SERIF, color: '#444444', marginTop: 6, lineHeight: 1.6 }}>
              {ex.two_year_bar.exception
                ? `Exception identified: ${ex.two_year_bar.exception_basis}`
                : `Leave required — motion ex-parte O.4 rr.1–2 MCR. ${ex.two_year_bar.leave_obtained ? 'Leave obtained.' : 'Leave NOT yet obtained.'}`}
            </p>
          )}
        </div>
      </div>

      {/* s.15(2) Facts */}
      {ex.dissolution_facts.length > 0 && (
        <div style={cardS}>
          <div style={secH}>s.15(2) Dissolution Facts in Play</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {ex.dissolution_facts.map((f, i) => (
              <div key={i} style={{
                background: '#faf8ff', border: '1px solid #e8e0f5',
                borderRadius: 5, padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600, color: '#4a1a7a' }}>{f.fact}</span>
                  <SevBadge sev={f.strength} />
                </div>
                <p style={{ fontSize: 13, fontFamily: SERIF, color: '#555555', lineHeight: 1.65 }}>{f.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Condonation / Co-respondent */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={cardS}>
          <div style={secH}>Condonation Risk</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <SevBadge sev={ex.condonation_risk.severity} />
            <span style={{ fontSize: 12, fontFamily: SERIF, color: '#444444' }}>
              {ex.condonation_risk.risk ? 'Risk identified' : 'No risk identified'}
            </span>
          </div>
          {ex.condonation_risk.basis && (
            <p style={{ fontSize: 13, fontFamily: SERIF, color: '#555555', lineHeight: 1.65 }}>{ex.condonation_risk.basis}</p>
          )}
        </div>

        <div style={cardS}>
          <div style={secH}>Co-respondent — s.32 MCA</div>
          {ex.co_respondent.named ? (
            <>
              <p style={{ fontSize: 13, fontFamily: SERIF, color: '#111111', marginBottom: 4 }}>
                <strong>{ex.co_respondent.name || 'Named but not identified'}</strong>
              </p>
              <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555' }}>
                Service: {ex.co_respondent.service_feasible ? 'Feasible' : 'May be problematic'}
              </p>
            </>
          ) : (
            <p style={{ fontSize: 13, fontFamily: SERIF, color: '#888888' }}>No co-respondent identified</p>
          )}
        </div>
      </div>

      {/* Children */}
      {ex.children.length > 0 && (
        <div style={cardS}>
          <div style={secH}>Children of the Marriage</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {ex.children.map((c, i) => (
              <div key={i} style={{ background: '#f5f8ff', border: '1px solid #d0daf0', borderRadius: 5, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontFamily: SERIF, color: '#666666' }}>Age: {c.age}</span>
                </div>
                <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', marginBottom: c.welfare_concern ? 4 : 0 }}>
                  Current: {c.current_arrangement}
                </p>
                {c.welfare_concern && (
                  <p style={{ fontSize: 12, fontFamily: SERIF, color: '#7a1a1a', background: '#fbedf0', padding: '4px 8px', borderRadius: 3, marginTop: 4 }}>
                    ⚠ {c.welfare_concern}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Financial Picture */}
      <div style={cardS}>
        <div style={secH}>Financial Picture</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
          <span style={lbS}>Pendente Lite Urgency</span>
          <SevBadge sev={ex.financial_picture.pendente_lite_urgency} />
        </div>
        {ex.financial_picture.maintenance_needs && (
          <p style={{ fontSize: 13, fontFamily: SERIF, color: '#444444', marginBottom: 8 }}>
            {ex.financial_picture.maintenance_needs}
          </p>
        )}
        {ex.financial_picture.assets_known.length > 0 && (
          <>
            <span style={lbS}>Assets Identified</span>
            <ul style={{ margin: '4px 0 10px 16px', padding: 0 }}>
              {ex.financial_picture.assets_known.map((a, i) => (
                <li key={i} style={{ fontSize: 13, fontFamily: SERIF, color: '#333333', marginBottom: 3 }}>{a}</li>
              ))}
            </ul>
          </>
        )}
        {ex.financial_picture.disclosure_gaps.length > 0 && (
          <>
            <span style={lbS}>Disclosure Gaps</span>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              {ex.financial_picture.disclosure_gaps.map((g, i) => (
                <li key={i} style={{ fontSize: 13, fontFamily: SERIF, color: '#7a5a00', marginBottom: 3 }}>{g}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Gaps & Risks */}
      {ex.gaps_and_risks.length > 0 && (
        <div style={cardS}>
          <div style={secH}>Gaps & Risks</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {ex.gaps_and_risks.map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', background: '#fafafa', border: '1px solid #eeeeee', borderRadius: 4 }}>
                <SevBadge sev={g.severity} />
                <span style={{ fontSize: 13, fontFamily: SERIF, color: '#333333', lineHeight: 1.6 }}>{g.issue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function MIntelligence({ activeCase }: Props) {
  const ai = useAI(activeCase);

  const init: MIData = {
    stage: 1, rawFacts: '', extraction: null,
    followUpQs: [], followUpAs: {}, evidenceMap: null, intPackage: '',
  };

  const [data, setData] = useState<MIData>(init);

  function upd(patch: Partial<MIData>) {
    setData(prev => ({ ...prev, ...patch }));
  }

  const caseCtx = `Case: ${activeCase.caseName}
Court: ${activeCase.court || 'Not specified'}
Suit No: ${activeCase.suitNo || 'Not specified'}
Counsel Role: ${activeCase.counsel_role === 'petitioner_side' ? 'Petitioner Side' : activeCase.counsel_role === 'respondent_side' ? 'Respondent Side' : activeCase.counsel_role || 'Unknown'}`;

  // ── Step 1 → 2: Extract ──────────────────────────────────────────────────

  async function runExtraction() {
    const prompt = `${caseCtx}

RAW FACTS FROM COUNSEL:
${data.rawFacts}

Extract all matrimonial intelligence from the facts above and return a single JSON object matching this schema exactly:
{
  "marriage_timeline": {
    "marriage_date": "YYYY-MM-DD or descriptive",
    "marriage_place": "string",
    "marriage_type": "statutory|customary|church|islamic|other",
    "cohabitation_end": "YYYY-MM-DD or descriptive",
    "cohabitation_history": "narrative of cohabitation"
  },
  "relief_sought": "string",
  "dissolution_facts": [
    { "fact": "s.15(2)(x) label", "evidence": "what evidence supports it", "strength": "STRONG|MODERATE|WEAK|UNKNOWN" }
  ],
  "two_year_bar": {
    "marriage_date": "string",
    "bar_applies": true/false,
    "exception": "wilful_refusal|adultery|rape_sodomy_bestiality|null",
    "exception_basis": "string",
    "leave_required": true/false,
    "leave_obtained": true/false
  },
  "children": [
    { "name": "string", "age": "string", "current_arrangement": "string", "welfare_concern": "string or empty" }
  ],
  "financial_picture": {
    "assets_known": ["array of identified assets"],
    "maintenance_needs": "string",
    "pendente_lite_urgency": "HIGH|MEDIUM|LOW|NONE",
    "disclosure_gaps": ["array of gaps"]
  },
  "condonation_risk": { "risk": true/false, "basis": "string", "severity": "HIGH|MEDIUM|LOW|NONE" },
  "connivance_risk": { "risk": true/false, "basis": "string" },
  "co_respondent": { "named": true/false, "name": "string", "service_feasible": true/false },
  "decree_stage": "current procedural stage",
  "gaps_and_risks": [
    { "issue": "string", "severity": "HIGH|MEDIUM|LOW" }
  ]
}`;

    try {
      const raw = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2500, libraryOpts: { queryHint: 'MCA s.15(2) dissolution facts two-year bar s.30 condonation co-respondent s.32 marriage timeline relief nullity children financial' } });
      const clean = (raw || '').replace(/```json|```/g, '').trim();
      const ex = JSON.parse(clean);
      // Phase 9A — write extraction immediately so downstream engines can use it
      // even if the associate stops here and never reaches Step 5.
      writeIntelligenceToCase(activeCase.id, ex, '').catch(() => {});
      upd({ stage: 2, extraction: ex, intelligenceSaved: true });
    } catch {
      upd({ stage: 2, extraction: null });
    }
  }

  // ── Step 2 → 3: Follow-up questions ─────────────────────────────────────

  async function runFollowUp() {
    const prompt = `${caseCtx}

EXTRACTED INTELLIGENCE:
${JSON.stringify(data.extraction, null, 2)}

Identify the 4–7 most important follow-up questions counsel must answer to complete the intelligence picture. Focus on: evidence gaps, undisclosed assets, s.30 bar exceptions, co-respondent identification, welfare officer involvement, bar risks (condonation/connivance), and any missing dates.

Return JSON array only:
[
  { "id": "q1", "question": "string", "purpose": "why this matters legally" }
]`;

    try {
      const raw = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 1000, libraryOpts: { queryHint: 'MCA evidence gaps s.30 bar exception co-respondent identification condonation connivance welfare officer financial disclosure missing dates' } });
      const clean = (raw || '').replace(/```json|```/g, '').trim();
      const qs = JSON.parse(clean);
      upd({ stage: 3, followUpQs: qs });
    } catch {
      upd({ stage: 3, followUpQs: [] });
    }
  }

  // ── Step 3 → 4: Evidence Map ─────────────────────────────────────────────

  async function runEvidenceMap() {
    const answersText = data.followUpQs
      .map(q => `Q: ${q.question}\nA: ${data.followUpAs[q.id] || '(not answered)'}`)
      .join('\n\n');

    const prompt = `${caseCtx}

EXTRACTED INTELLIGENCE:
${JSON.stringify(data.extraction, null, 2)}

FOLLOW-UP ANSWERS:
${answersText}

Build a matrimonial evidence map. For each live issue (dissolution fact, two-year bar, condonation, co-respondent, children welfare, financial disclosure), identify what evidence is needed, what is available, and what is missing. Reference MCR rules where relevant.

Return JSON array:
[
  {
    "issue": "string",
    "evidence_needed": ["array"],
    "evidence_available": ["array"],
    "evidence_missing": ["array"],
    "priority": "CRITICAL|HIGH|MEDIUM|LOW",
    "mcr_rule": "optional MCR rule reference"
  }
]`;

    try {
      const raw = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2000, libraryOpts: { queryHint: 'MCA MCR evidence map dissolution fact s.15(2) corroboration affidavit documentary evidence children welfare financial disclosure MCR rules' } });
      const clean = (raw || '').replace(/```json|```/g, '').trim();
      const em = JSON.parse(clean);
      upd({ stage: 4, evidenceMap: em });
    } catch {
      upd({ stage: 4, evidenceMap: [] });
    }
  }

  // ── Step 4 → 5: Intelligence Package ────────────────────────────────────

  async function runPackage() {
    const prompt = `${caseCtx}

FULL INTELLIGENCE:
Extraction: ${JSON.stringify(data.extraction, null, 2)}
Evidence Map: ${JSON.stringify(data.evidenceMap, null, 2)}

Generate the full MCA Intelligence Package using ## section headings:

## Established Matrimonial Facts
## Dissolution Fact Analysis (s.15(2) MCA)
## Two-Year Bar Assessment (s.30 MCA)
## Nullity Viability (if applicable)
## Children and Welfare Position
## Financial Disclosure and Maintenance Urgency
## Condonation and Bar Exposure (ss.26–27 MCA)
## Procedural Stage and Immediate Next Steps
## Risk Register

Use correct MCA section numbers throughout. Identify the counsel role (${activeCase.counsel_role === 'petitioner_side' ? 'Petitioner Side' : 'Respondent Side'}) and tailor strategy accordingly.`;

    const raw = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 3000, libraryOpts: { queryHint: 'MCA intelligence package s.15(2) dissolution analysis s.30 two-year bar nullity children welfare financial maintenance condonation procedural stage risk register' } });
    if (!raw) return;
    // Phase 9A — update with full package. Version increments again here.
    if (data.extraction) {
      writeIntelligenceToCase(activeCase.id, data.extraction, raw).catch(() => {});
    }
    upd({ stage: 5, intPackage: raw, intelligenceSaved: true });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const { stage, rawFacts, extraction, followUpQs, followUpAs, evidenceMap, intPackage, intelligenceSaved } = data;

  return (
    <div style={{ paddingTop: 24, maxWidth: 900 }}>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Matrimonial Intelligence Engine
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          MCA-specific 5-step extraction · s.15(2) facts · s.30 bar · condonation · co-respondent · decree stage
        </p>
      </div>

      <StepBar current={stage} />

      {ai.error && <ErrorBlock message={ai.error} onDismiss={() => ai.clearError()} />}

      {/* Step 1 — Raw Facts */}
      {stage === 1 && (
        <div style={cardS}>
          <div style={secH}>Step 1 — Raw Facts</div>
          <p style={{ fontSize: 13, fontFamily: SERIF, color: '#555555', marginBottom: 14, lineHeight: 1.7 }}>
            Provide a full account of the matrimonial matter: marriage particulars, parties, children,
            what has happened and when, what relief is sought, financial situation, and any known defences.
            The more detail you provide, the sharper the extraction.
          </p>
          <label style={lbS}>Facts of the matrimonial matter</label>
          <textarea
            style={taS}
            rows={12}
            value={rawFacts}
            onChange={e => upd({ rawFacts: e.target.value })}
            placeholder="Petitioner and Respondent married on [date] at [place]. They have [x] children. The marriage broke down due to… The Petitioner seeks…"
          />
          <div style={{ marginTop: 14 }}>
            <Btn
              onClick={runExtraction}
              loading={ai.loading}
              disabled={rawFacts.trim().length < 50}
              label="Extract MCA Intelligence →"
            />
          </div>
        </div>
      )}

      {/* Step 2 — Extraction */}
      {stage === 2 && (
        <>
          {/* Phase 9A — confirmation banner shown after successful write */}
          {intelligenceSaved && extraction && (
            <div style={{
              background: '#edfaf3', border: '1px solid #b8e8cc', borderRadius: 6,
              padding: '10px 14px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: SERIF, fontSize: 13, color: '#1a5a3a',
            }}>
              <span style={{ fontSize: 15 }}>✓</span>
              <span>Intelligence saved to case — all engines will now use this extraction</span>
            </div>
          )}
          {extraction
            ? <ExtractionDisplay ex={extraction} />
            : (
              <div style={{ ...cardS, textAlign: 'center', color: '#888888', fontFamily: SERIF, fontSize: 14 }}>
                Extraction returned no parseable data. Please check the raw facts and retry.
              </div>
            )
          }
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <Btn onClick={() => upd({ stage: 1 })} loading={false} label="← Back" variant="secondary" />
            <Btn onClick={runFollowUp} loading={ai.loading} label="Generate Follow-Up Questions →" />
          </div>
        </>
      )}

      {/* Step 3 — Follow-Up */}
      {stage === 3 && (
        <div style={cardS}>
          <div style={secH}>Step 3 — Follow-Up Questions</div>
          {followUpQs.length === 0 ? (
            <p style={{ fontFamily: SERIF, fontSize: 13, color: '#888888' }}>No questions generated.</p>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {followUpQs.map(q => (
                <div key={q.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <label style={{ ...lbS, flex: 1 }}>{q.question}</label>
                    <span style={{ fontSize: 10, color: '#888888', fontFamily: SERIF, fontStyle: 'italic', marginLeft: 12, flexShrink: 0 }}>
                      {q.purpose}
                    </span>
                  </div>
                  <textarea
                    style={{ ...taS, minHeight: 60 }}
                    rows={3}
                    value={followUpAs[q.id] || ''}
                    onChange={e => upd({ followUpAs: { ...followUpAs, [q.id]: e.target.value } })}
                    placeholder="Counsel's answer…"
                  />
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn onClick={() => upd({ stage: 2 })} loading={false} label="← Back" variant="secondary" />
            <Btn onClick={runEvidenceMap} loading={ai.loading} label="Build Evidence Map →" />
          </div>
        </div>
      )}

      {/* Step 4 — Evidence Map */}
      {stage === 4 && (
        <>
          <div style={cardS}>
            <div style={secH}>Step 4 — Evidence Map</div>
            {(!evidenceMap || evidenceMap.length === 0) ? (
              <p style={{ fontFamily: SERIF, fontSize: 13, color: '#888888' }}>No evidence map generated.</p>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {evidenceMap.map((item, i) => (
                  <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: '14px 16px', background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600, color: '#111111' }}>{item.issue}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <SevBadge sev={item.priority} />
                        {item.mcr_rule && (
                          <span style={{ fontSize: 10, fontFamily: SERIF, color: '#4a1a7a', background: '#f5edfb', border: '1px solid #ccb8e8', borderRadius: 3, padding: '1px 6px' }}>
                            {item.mcr_rule}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      {[
                        { label: 'Needed',    items: item.evidence_needed,    col: '#333333' },
                        { label: 'Available', items: item.evidence_available,  col: '#1a5a3a' },
                        { label: 'Missing',   items: item.evidence_missing,    col: '#7a1a1a' },
                      ].map(col => (
                        <div key={col.label}>
                          <span style={{ ...lbS, color: col.col }}>{col.label}</span>
                          {col.items.length === 0
                            ? <span style={{ fontSize: 12, fontFamily: SERIF, color: '#aaaaaa' }}>—</span>
                            : <ul style={{ margin: '4px 0 0 14px', padding: 0 }}>
                                {col.items.map((it, j) => (
                                  <li key={j} style={{ fontSize: 12, fontFamily: SERIF, color: col.col, marginBottom: 2 }}>{it}</li>
                                ))}
                              </ul>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Btn onClick={() => upd({ stage: 3 })} loading={false} label="← Back" variant="secondary" />
            <Btn onClick={runPackage} loading={ai.loading} label="Generate Intelligence Package →" />
          </div>
        </>
      )}

      {/* Step 5 — Intelligence Package */}
      {stage === 5 && (
        <>
          {/* Phase 9A — confirmation banner */}
          {intelligenceSaved && (
            <div style={{
              background: '#edfaf3', border: '1px solid #b8e8cc', borderRadius: 6,
              padding: '10px 14px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: SERIF, fontSize: 13, color: '#1a5a3a',
            }}>
              <span style={{ fontSize: 15 }}>✓</span>
              <span>Intelligence package saved to case — all engines will now use this extraction</span>
            </div>
          )}
          <div style={{ background: '#faf8ff', border: '1px solid #ccb8e8', borderRadius: 8, padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ ...secH, margin: 0, border: 'none', padding: 0 }}>MCA Intelligence Package</span>
              <button onClick={() => navigator.clipboard?.writeText(intPackage).catch(() => {})}
                style={{ background: '#ffffff', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '5px 13px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                Copy
              </button>
            </div>
            <Md text={intPackage} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn onClick={() => upd({ stage: 4 })} loading={false} label="← Back" variant="secondary" />
            <Btn onClick={() => setData(init)} loading={false} label="New Analysis" variant="secondary" />
          </div>
        </>
      )}
    </div>
  );
}
