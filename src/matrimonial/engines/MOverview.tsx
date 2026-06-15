/**
 * AFS Advocates — Matrimonial Overview Engine (MOverview)
 * Phase 5
 *
 * Case overview: parties, marriage particulars, relief type, two-year bar
 * status, procedural stage, and risk register summary.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useEffect } from 'react';
import type { Case } from '@/types';
import { useAI } from '@/hooks/useAI';
import { Md, ErrorBlock } from '@/components/common/ui';
import { loadMatrimonialData, saveMatrimonialData } from '@/storage/helpers';
import type { MatrimonialCaseData, MatrimonialReliefType, DissolutionFact } from '@/matrimonial/types';
import { DISSOLUTION_FACT_LABELS } from '@/matrimonial/types';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const SYSTEM = `You are a specialist Nigerian matrimonial causes practitioner under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and Matrimonial Causes Rules 1983 (MCR). The correct court is the High Court of a State — NOT the Federal High Court.

DOCTRINAL RULES:
- One ground: irretrievable breakdown s.15(1) MCA. Eight s.15(2) facts are evidence of breakdown, not separate grounds.
- Parties: PETITIONER and RESPONDENT. Proceedings by Petition (Form 6), never by Writ.
- s.30 bar: no petition within 2 years of marriage without leave. Exceptions: s.15(2)(a), (b), s.16(1)(a).
- s.57 (28 days) vs s.58 (3 months) for decree absolute — depends on whether children welfare order was made.
- s.241(2) CFRN: NO appeal against decree absolute.

Format with clear ## headings.`;

const RELIEF_LABELS: Record<MatrimonialReliefType, string> = {
  dissolution:          'Dissolution of Marriage',
  nullity_void:         'Nullity — Void Marriage (s.3 MCA)',
  nullity_voidable:     'Nullity — Voidable Marriage (s.5 MCA)',
  judicial_separation:  'Judicial Separation (s.39 MCA)',
  restitution_conjugal: 'Restitution of Conjugal Rights (s.47 MCA)',
  jactitation:          'Jactitation of Marriage (s.55 MCA)',
};

const RELIEF_COLORS: Record<MatrimonialReliefType, { bg: string; col: string; bdr: string }> = {
  dissolution:          { bg: '#f5edfb', col: '#4a1a7a', bdr: '#ccb8e8' },
  nullity_void:         { bg: '#fbedf0', col: '#7a1a1a', bdr: '#e8b8c0' },
  nullity_voidable:     { bg: '#fdf0eb', col: '#7a3a1a', bdr: '#e8c8b8' },
  judicial_separation:  { bg: '#edf3fb', col: '#1a4a7a', bdr: '#b8cce8' },
  restitution_conjugal: { bg: '#edfaf3', col: '#1a5a3a', bdr: '#b8e8cc' },
  jactitation:          { bg: '#fbf7ed', col: '#5a4a1a', bdr: '#e8dab8' },
};

const MARRIAGE_TYPE_LABELS: Record<string, string> = {
  statutory: 'Statutory (Marriage Act)',
  customary: 'Customary',
  church:    'Church',
  islamic:   'Islamic',
  other:     'Other',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(d: string): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return d; }
}

function twoYearBarStatus(marriageDate: string): { applies: boolean; daysElapsed: number } {
  if (!marriageDate) return { applies: false, daysElapsed: 0 };
  const ms = Date.now() - new Date(marriageDate).getTime();
  const daysElapsed = Math.floor(ms / (1000 * 60 * 60 * 24));
  return { applies: daysElapsed < 730, daysElapsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '9px 12px', fontSize: 13,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.8, minHeight: 70 };
const lbS: React.CSSProperties = {
  fontSize: 9, color: '#666666', fontFamily: SERIF,
  letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600,
  display: 'block', marginBottom: 5,
};
const secH: React.CSSProperties = {
  fontSize: 10, fontFamily: SERIF, letterSpacing: '.12em',
  textTransform: 'uppercase' as const, color: '#4a1a7a', fontWeight: 700,
  marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #ede0f5',
};
const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0',
  borderRadius: 8, padding: '18px 20px', marginBottom: 14,
};

function Pill({ label, bg, col, bdr }: { label: string; bg: string; col: string; bdr: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '.07em',
      textTransform: 'uppercase' as const, background: bg,
      color: col, border: `1px solid ${bdr}`,
      borderRadius: 3, padding: '2px 9px', fontFamily: SERIF,
      display: 'inline-block',
    }}>{label}</span>
  );
}

function Btn({ onClick, loading, disabled, label }: {
  onClick: () => void; loading: boolean; disabled?: boolean; label: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      background: loading || disabled ? '#f0f0f0' : '#111111',
      color:      loading || disabled ? '#aaaaaa' : '#ffffff',
      border: 'none', borderRadius: 5, padding: '9px 20px', fontSize: 12,
      fontFamily: SERIF, cursor: loading || disabled ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳  Working…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MATTER PARTICULARS EDITOR
// ─────────────────────────────────────────────────────────────────────────────

function ParticularsEditor({
  data, onChange, onSave, saving,
}: {
  data: Partial<MatrimonialCaseData>;
  onChange: (patch: Partial<MatrimonialCaseData>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const RELIEF_OPTIONS: MatrimonialReliefType[] = [
    'dissolution', 'nullity_void', 'nullity_voidable',
    'judicial_separation', 'restitution_conjugal', 'jactitation',
  ];

  const FACTS: DissolutionFact[] = [
    'a_wilful_refusal_consummate', 'b_adultery_intolerability',
    'c_unreasonable_behaviour', 'd_desertion_one_year',
    'e_separation_two_years_consent', 'f_separation_three_years',
    'g_non_compliance_rcr', 'h_presumed_death_seven_years',
  ];

  function toggleFact(f: DissolutionFact) {
    const cur = data.dissolution_facts ?? [];
    const next = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f];
    onChange({ dissolution_facts: next });
  }

  const barStatus = twoYearBarStatus(data.marriage_date ?? '');

  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* Marriage Particulars */}
      <div style={cardS}>
        <div style={secH}>Marriage Particulars</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbS}>Date of Marriage</label>
            <input type="date" style={iS} value={data.marriage_date ?? ''}
              onChange={e => onChange({ marriage_date: e.target.value })} />
            {data.marriage_date && (
              <p style={{ fontSize: 11, fontFamily: SERIF, marginTop: 5,
                color: barStatus.applies ? '#7a5a00' : '#1a5a3a' }}>
                {barStatus.applies
                  ? `⚠ ${barStatus.daysElapsed} days elapsed — s.30 two-year bar applies`
                  : `✓ ${barStatus.daysElapsed} days elapsed — s.30 bar does not apply`}
              </p>
            )}
          </div>
          <div>
            <label style={lbS}>Place of Marriage</label>
            <input type="text" style={iS} value={data.marriage_place ?? ''}
              onChange={e => onChange({ marriage_place: e.target.value })}
              placeholder="Church / Registry / Place, State" />
          </div>
          <div>
            <label style={lbS}>Type of Marriage</label>
            <select style={iS} value={data.marriage_type ?? ''}
              onChange={e => onChange({ marriage_type: e.target.value as MatrimonialCaseData['marriage_type'] })}>
              <option value="">— select —</option>
              {Object.entries(MARRIAGE_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbS}>Relief Sought</label>
            <select style={iS} value={data.relief_type ?? ''}
              onChange={e => onChange({ relief_type: e.target.value as MatrimonialReliefType })}>
              <option value="">— select —</option>
              {RELIEF_OPTIONS.map(r => (
                <option key={r} value={r}>{RELIEF_LABELS[r]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* s.15(2) Facts */}
      {(data.relief_type === 'dissolution' || !data.relief_type) && (
        <div style={cardS}>
          <div style={secH}>s.15(2) Facts in Play</div>
          <p style={{ fontSize: 11, fontFamily: SERIF, color: '#888888', marginBottom: 10, lineHeight: 1.6 }}>
            Tick all that apply. These are evidence of irretrievable breakdown — not separate grounds.
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            {FACTS.map(f => {
              const checked = (data.dissolution_facts ?? []).includes(f);
              return (
                <button key={f} onClick={() => toggleFact(f)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' as const,
                  background: checked ? '#faf8ff' : '#fafafa',
                  border: `1px solid ${checked ? '#ccb8e8' : '#e0e0e0'}`,
                  borderRadius: 5, padding: '8px 12px', cursor: 'pointer', width: '100%',
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                    background: checked ? '#4a1a7a' : '#ffffff',
                    border: `1px solid ${checked ? '#4a1a7a' : '#cccccc'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked && <span style={{ color: '#ffffff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: SERIF, color: checked ? '#4a1a7a' : '#333333', fontWeight: checked ? 600 : 400 }}>
                    {DISSOLUTION_FACT_LABELS[f]}
                  </span>
                </button>
              );
            })}
          </div>
          {(data.dissolution_facts ?? []).includes('b_adultery_intolerability') && (
            <div style={{ marginTop: 10, background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 5, padding: '8px 12px' }}>
              <p style={{ fontSize: 11, fontFamily: SERIF, color: '#7a5a00' }}>
                ⚠ <strong>Co-respondent required</strong> — s.32 MCA, O.9 rr.2–3 MCR. The co-respondent must be joined when adultery is alleged.
              </p>
            </div>
          )}
        </div>
      )}

      {/* s.30 Bar */}
      <div style={cardS}>
        <div style={secH}>s.30 Two-Year Bar</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbS}>Leave Granted under s.30?</label>
            <select style={iS} value={data.leave_granted === true ? 'yes' : data.leave_granted === false ? 'no' : ''}
              onChange={e => onChange({ leave_granted: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : undefined })}>
              <option value="">— select if applicable —</option>
              <option value="yes">Yes — leave obtained</option>
              <option value="no">No — leave not yet obtained</option>
            </select>
          </div>
          <div>
            <label style={lbS}>Exception Identified</label>
            <select style={iS} value={data.two_year_bar_exception ?? ''}
              onChange={e => onChange({ two_year_bar_exception: e.target.value as MatrimonialCaseData['two_year_bar_exception'] })}>
              <option value="">— none / not applicable —</option>
              <option value="wilful_refusal">s.15(2)(a) — Wilful refusal to consummate</option>
              <option value="adultery">s.15(2)(b) — Adultery</option>
              <option value="rape_sodomy_bestiality">s.16(1)(a) — Rape / Sodomy / Bestiality by respondent</option>
            </select>
          </div>
        </div>
      </div>

      {/* Decree Stage */}
      <div style={cardS}>
        <div style={secH}>Decree Timeline</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbS}>Date of Decree Nisi</label>
            <input type="date" style={iS} value={data.decree_nisi_date ?? ''}
              onChange={e => onChange({ decree_nisi_date: e.target.value })} />
          </div>
          <div>
            <label style={lbS}>Path to Absolute</label>
            <select style={iS} value={data.decree_absolute_path ?? ''}
              onChange={e => onChange({ decree_absolute_path: e.target.value as MatrimonialCaseData['decree_absolute_path'] })}>
              <option value="">— not yet at nisi —</option>
              <option value="s57_28_days">s.57 — 28 days (children welfare order made)</option>
              <option value="s58_3_months">s.58 — 3 months (no children welfare order)</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <Btn onClick={onSave} loading={saving} label={saving ? 'Saving…' : 'Save Case Data'} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK SUMMARY (AI-generated)
// ─────────────────────────────────────────────────────────────────────────────

function RiskSummary({ activeCase, mData }: { activeCase: Case; mData: Partial<MatrimonialCaseData> }) {
  const ai = useAI(activeCase);
  const [summary, setSummary] = useState('');

  async function generate() {
    const prompt = `Generate a concise risk summary for this matrimonial case.

Case: ${activeCase.caseName}
Court: ${activeCase.court || 'Not specified'}
Counsel Role: ${activeCase.counsel_role === 'petitioner_side' ? 'Petitioner Side' : 'Respondent Side'}

CASE DATA:
Relief Sought: ${mData.relief_type ? RELIEF_LABELS[mData.relief_type] : 'Not specified'}
Marriage Date: ${mData.marriage_date ? formatDate(mData.marriage_date) : 'Not specified'}
Marriage Type: ${mData.marriage_type ?? 'Not specified'}
s.15(2) Facts: ${(mData.dissolution_facts ?? []).map(f => DISSOLUTION_FACT_LABELS[f]).join('; ') || 'None specified'}
Two-Year Bar: ${mData.two_year_bar_applies ? 'Applies' : 'Does not apply'}
Leave Granted: ${mData.leave_granted === true ? 'Yes' : mData.leave_granted === false ? 'No' : 'N/A'}
Bar Exception: ${mData.two_year_bar_exception ?? 'None'}
Co-respondent Joined: ${mData.co_respondent_joined === true ? 'Yes' : mData.co_respondent_joined === false ? 'No' : 'Unknown'}
Condonation Risk: ${mData.condonation_risk ? 'Yes — flagged' : 'Not flagged'}
Decree Nisi Date: ${mData.decree_nisi_date ? formatDate(mData.decree_nisi_date) : 'Not yet'}
Absolute Path: ${mData.decree_absolute_path === 's57_28_days' ? 's.57 (28 days)' : mData.decree_absolute_path === 's58_3_months' ? 's.58 (3 months)' : 'Not determined'}

Provide a concise risk summary under these headings:
## Immediate Risks
## Ground Strength Assessment
## Procedural Urgencies
## Recommended Next Steps

Be specific to the facts above. Use correct MCA section numbers.`;

    const result = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 1500, libraryOpts: { queryHint: 'MCA matrimonial causes overview s.15(2) dissolution facts decree nisi absolute procedural stage next steps' } });
    if (result) setSummary(result);
  }

  const [copied, setCopied] = useState(false);

  return (
    <div style={cardS}>
      <div style={secH}>AI Risk Summary</div>
      <p style={{ fontSize: 12, fontFamily: SERIF, color: '#666666', marginBottom: 12, lineHeight: 1.65 }}>
        Generate an AI risk summary based on the case data recorded above.
        Save the case data first for the most accurate summary.
      </p>

      <Btn onClick={generate} loading={ai.loading} label="Generate Risk Summary →" />
      {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}

      {summary && (
        <div style={{ marginTop: 14, background: '#faf8ff', border: '1px solid #e0d8f0', borderRadius: 6, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a' }}>
              Risk Summary
            </span>
            <button onClick={() => { navigator.clipboard?.writeText(summary).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ background: '#ffffff', border: '1px solid #cccccc', color: copied ? '#1a7a3a' : '#444444', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <Md text={summary} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW DISPLAY (read-only)
// ─────────────────────────────────────────────────────────────────────────────

function OverviewDisplay({ mData, onEdit }: { mData: Partial<MatrimonialCaseData>; onEdit: () => void }) {
  const relief = mData.relief_type ? RELIEF_LABELS[mData.relief_type] : null;
  const reliefColors = mData.relief_type ? RELIEF_COLORS[mData.relief_type] : null;
  const barStatus = twoYearBarStatus(mData.marriage_date ?? '');

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Badge strip */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' }}>
        {relief && reliefColors && <Pill label={relief} {...reliefColors} />}
        {barStatus.applies && !mData.leave_granted && (
          <Pill label="⚠ s.30 Bar — Leave Required" bg="#fff8e1" col="#7a5a00" bdr="#f0c040" />
        )}
        {mData.leave_granted && (
          <Pill label="✓ s.30 Leave Granted" bg="#edfaf3" col="#1a5a3a" bdr="#b8e8cc" />
        )}
        {mData.co_respondent_joined === false && (mData.dissolution_facts ?? []).includes('b_adultery_intolerability') && (
          <Pill label="⚠ Co-Respondent Not Joined" bg="#fbedf0" col="#7a1a1a" bdr="#e8b8c0" />
        )}
        {mData.condonation_risk && (
          <Pill label="⚠ Condonation Risk" bg="#fdf0eb" col="#7a3a1a" bdr="#e8c8b8" />
        )}
        {mData.decree_nisi_date && (
          <Pill label={`Nisi: ${formatDate(mData.decree_nisi_date)}`} bg="#edf3fb" col="#1a4a7a" bdr="#b8cce8" />
        )}
        {mData.decree_absolute_path && (
          <Pill
            label={mData.decree_absolute_path === 's57_28_days' ? 's.57 — 28 days' : 's.58 — 3 months'}
            bg="#faf8ff" col="#4a1a7a" bdr="#ccb8e8"
          />
        )}
      </div>

      {/* Marriage card */}
      <div style={cardS}>
        <div style={secH}>Marriage Particulars</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { label: 'Date of Marriage',  value: formatDate(mData.marriage_date ?? '') },
            { label: 'Place',             value: mData.marriage_place ?? '—' },
            { label: 'Type',              value: mData.marriage_type ? MARRIAGE_TYPE_LABELS[mData.marriage_type] : '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <span style={lbS}>{label}</span>
              <span style={{ fontFamily: SERIF, fontSize: 14, color: '#111111' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Facts */}
      {(mData.dissolution_facts ?? []).length > 0 && (
        <div style={cardS}>
          <div style={secH}>s.15(2) Facts in Play</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {(mData.dissolution_facts ?? []).map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf8ff', border: '1px solid #e8e0f5', borderRadius: 4, padding: '7px 12px' }}>
                <span style={{ color: '#4a1a7a', fontWeight: 700, fontSize: 14 }}>§</span>
                <span style={{ fontSize: 13, fontFamily: SERIF, color: '#333333' }}>{DISSOLUTION_FACT_LABELS[f]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Children */}
      {(mData.children ?? []).length > 0 && (
        <div style={cardS}>
          <div style={secH}>Children of the Marriage</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {(mData.children ?? []).map((c, i) => (
              <div key={i} style={{ background: '#f5f8ff', border: '1px solid #d0daf0', borderRadius: 4, padding: '8px 12px' }}>
                <span style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: 12, fontFamily: SERIF, color: '#666666', marginLeft: 10 }}>
                  DOB: {formatDate(c.dob)} · {c.current_arrangement}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={onEdit} style={{
        background: 'transparent', border: '1px solid #cccccc', color: '#444444',
        borderRadius: 5, padding: '8px 18px', fontSize: 12, fontFamily: SERIF, cursor: 'pointer',
        width: 'fit-content',
      }}>
        ✎ Edit Case Data
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

type OverviewTab = 'overview' | 'edit' | 'risk';

export function MOverview({ activeCase }: { activeCase: Case }) {
  const [tab, setTab] = useState<OverviewTab>('overview');
  const [mData, setMData] = useState<Partial<MatrimonialCaseData>>({});
  const [edits, setEdits] = useState<Partial<MatrimonialCaseData>>({});
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    if (!activeCase?.id) return;
    loadMatrimonialData(activeCase.id).then(d => {
      const data = d ?? {};
      setMData(data);
      setEdits(data);
    });
  }, [activeCase?.id]);

  function applyEdit(patch: Partial<MatrimonialCaseData>) {
    setEdits(prev => ({ ...prev, ...patch }));
  }

  async function save() {
    setSaving(true);
    try {
      const updated: MatrimonialCaseData = {
        ...mData,
        ...edits,
        _updatedAt: new Date().toISOString(),
      } as MatrimonialCaseData;
      // Auto-compute two-year bar
      if (updated.marriage_date) {
        const { applies } = twoYearBarStatus(updated.marriage_date);
        updated.two_year_bar_applies = applies;
      }
      await saveMatrimonialData(activeCase.id, updated);
      setMData(updated);
      setSaved(true);
      setTimeout(() => { setSaved(false); setTab('overview'); }, 1200);
    } finally {
      setSaving(false);
    }
  }

  const hasData = mData.relief_type || mData.marriage_date || (mData.dissolution_facts ?? []).length > 0;

  const TABS: Array<{ id: OverviewTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'edit',     label: hasData ? 'Edit Particulars' : '+ Add Particulars' },
    { id: 'risk',     label: 'Risk Summary' },
  ];

  return (
    <div style={{ paddingTop: 24, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Case Overview
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          Marriage particulars · Relief type · Two-year bar · s.15(2) facts · Decree timeline · Risk summary
        </p>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: '1px solid #e0e0e0' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#111111' : 'transparent',
            border: '1px solid transparent',
            borderColor: tab === t.id ? '#111111' : 'transparent',
            color: tab === t.id ? '#ffffff' : '#555555',
            borderRadius: '4px 4px 0 0', padding: '7px 14px', fontSize: 12,
            fontFamily: SERIF, cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
            letterSpacing: '.04em', marginBottom: tab === t.id ? -1 : 0,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        hasData
          ? <OverviewDisplay mData={mData} onEdit={() => setTab('edit')} />
          : (
            <div style={{ background: '#faf8ff', border: '1px dashed #ccb8e8', borderRadius: 8, padding: '40px 32px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontFamily: SERIF, color: '#4a1a7a', marginBottom: 8 }}>No case particulars recorded yet</p>
              <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888', marginBottom: 16 }}>
                Add marriage details, relief type, and s.15(2) facts to build the overview.
              </p>
              <button onClick={() => setTab('edit')} style={{
                background: '#4a1a7a', color: '#ffffff', border: 'none',
                borderRadius: 5, padding: '10px 22px', fontSize: 13, fontFamily: SERIF,
                cursor: 'pointer', fontWeight: 600,
              }}>
                Add Case Particulars →
              </button>
            </div>
          )
      )}

      {tab === 'edit' && (
        <ParticularsEditor
          data={edits}
          onChange={applyEdit}
          onSave={save}
          saving={saving}
        />
      )}

      {saved && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1a5a3a', color: '#ffffff', borderRadius: 5, padding: '10px 18px', fontFamily: SERIF, fontSize: 13, fontWeight: 600 }}>
          ✓ Case data saved
        </div>
      )}

      {tab === 'risk' && (
        <RiskSummary activeCase={activeCase} mData={mData} />
      )}
    </div>
  );
}
