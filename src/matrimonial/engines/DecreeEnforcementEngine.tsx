/**
 * AFS Advocates — Decree Enforcement Engine (DecreeEnforcementEngine)
 * Phase 5
 *
 * Tracks decree nisi date and terms.
 * Asks whether a children's welfare arrangement order was made:
 *   YES → s.57 MCA: 28 days to apply for decree absolute
 *   NO  → s.58 MCA: 3 months
 * Auto-computes decree_absolute_deadline.
 * Drafts application to make absolute.
 * Handles post-absolute enforcement:
 *   - Maintenance arrears: attachment and sequestration O.17 r.4 MCR
 *   - Property transfer compliance
 *   - Custody non-compliance
 *   - Contempt for non-compliance with RCR order
 *   - Magistrate Court enforcement: s.2(1)(b) MCA
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { Md, ErrorBlock } from '@/components/common/ui';
import { loadMatrimonialData, saveMatrimonialData } from '@/storage/helpers';
import type { MatrimonialCaseData, MExtractionResult } from '@/matrimonial/types';
import { getLawSync } from '@/law/registry';
import { getPrompt } from '@/law/prompts';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

// SYSTEM prompt — legal assertions sourced from Law Registry prompts
// (getPrompt() is synchronous; called at module level so the string is stable)
const SYSTEM = `You are a specialist Nigerian matrimonial causes practitioner dealing with decree nisi, decree absolute, and post-decree enforcement under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and Matrimonial Causes Rules 1983 (MCR).

ABSOLUTE RULES:
${getPrompt('mca_s57_absolute_rule')}

${getPrompt('mca_s58_absolute_rule')}

${getPrompt('cfrn_s241_2_appeal_absolute_bar')}

${getPrompt('mca_maintenance_magistrate')}

- Post-absolute enforcement options: attachment of earnings, sequestration O.17 r.4 MCR, contempt proceedings, committal.

Format responses with clear ## section headings.`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '9px 12px', fontSize: 13,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.8, minHeight: 80 };
const lbS: React.CSSProperties = {
  fontSize: 9, color: '#666666', fontFamily: SERIF,
  letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600,
  display: 'block', marginBottom: 5,
};
const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0',
  borderRadius: 8, padding: '20px 22px', marginBottom: 14,
};

function Btn({ onClick, loading, disabled, label, variant = 'primary' }: {
  onClick: () => void; loading: boolean; disabled?: boolean; label: string;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      background:  loading ? '#f0f0f0' : variant === 'primary' ? '#111111' : '#ffffff',
      color:       loading ? '#aaaaaa' : variant === 'primary' ? '#ffffff' : '#333333',
      border:      variant === 'secondary' ? '1px solid #cccccc' : 'none',
      borderRadius: 5, padding: '9px 20px', fontSize: 12,
      fontFamily: SERIF, cursor: loading || disabled ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳  Working…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE BANNER
// ─────────────────────────────────────────────────────────────────────────────

function IntelligenceBanner({
  matrimonialData,
  onClear,
}: {
  matrimonialData: MatrimonialCaseData;
  onClear: () => void;
}) {
  const runAt = matrimonialData.intelligence_run_at
    ? new Date(matrimonialData.intelligence_run_at).toLocaleDateString('en-NG', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—';
  const version = matrimonialData.intelligence_version ?? 1;
  const ex = matrimonialData.intelligence_extraction;

  return (
    <div style={{
      background: '#f0faf5', border: '1px solid #4caf85', borderRadius: 7,
      padding: '12px 16px', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 12, fontFamily: SERIF, fontWeight: 700, color: '#1a5a38', marginBottom: 3 }}>
            ⚡ Pre-filled from MIntelligence · Run {runAt} · Version {version}
          </p>
          <p style={{ fontSize: 11, fontFamily: SERIF, color: '#2d7a52', lineHeight: 1.6 }}>
            {ex?.children && ex.children.length > 0
              ? `Children detected (${ex.children.length}) — s.57 path pre-selected (${S57_DAYS} days). Verify whether a welfare order was actually made at nisi.`
              : `No children recorded — s.58 path pre-selected (${S58_MONTHS} months). Confirm with decree nisi order.`}
            {ex?.decree_stage
              ? <span> Decree stage: <em>{ex.decree_stage}</em>.</span>
              : null}
          </p>
        </div>
        <button
          onClick={onClear}
          style={{ background: 'transparent', border: '1px solid #c04040', color: '#c04040', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer', flexShrink: 0 }}
        >
          Clear &amp; enter manually
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCEMENT MODULE
// ─────────────────────────────────────────────────────────────────────────────

const ENFORCEMENT_TYPES = [
  { id: 'maintenance_arrears', label: 'Maintenance Arrears', icon: '⚖' },
  { id: 'property_transfer', label: 'Property Transfer Non-Compliance', icon: '🏛' },
  { id: 'custody', label: 'Custody / Contact Non-Compliance', icon: '👶' },
  { id: 'rcr_contempt', label: 'RCR Order Non-Compliance (Contempt)', icon: '⚡' },
];

function EnforcementPanel({ activeCase }: { activeCase: Case }) {
  const ai = useAI(activeCase);
  const [enfType, setEnfType] = useState('');
  const [situation, setSituation] = useState('');
  const [output, setOutput] = useState('');

  async function analyse() {
    const prompt = `Enforcement matter — ${enfType}

${activeCase.caseName}

Situation:
${situation}

Advise on:
1. The specific enforcement mechanism available under the MCA, MCR, and general civil procedure
2. Step-by-step procedure including applications to be filed
3. Evidence required
4. Relevant section references (MCA, MCR, Sheriff and Civil Process Act where applicable)
5. Whether the Magistrate Court can enforce (maintenance orders: s.2(1)(b) MCA)
6. Timeline and urgency assessment

Where contempt is involved, advise on the O.17 r.4 MCR procedure, the standard for committal, and the purging of contempt.`;

    const result = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2000, libraryOpts: { queryHint: 'decree enforcement MCA O.17 r.4 MCR contempt maintenance arrears attachment sequestration post-decree compliance' } });
    if (result) setOutput(result);
  }

  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 16 }}>
        {ENFORCEMENT_TYPES.map(et => (
          <button
            key={et.id}
            onClick={() => setEnfType(et.label)}
            style={{
              background: enfType === et.label ? '#4a1a7a' : '#faf8ff',
              border: `1px solid ${enfType === et.label ? '#7a3ab0' : '#e0d8f0'}`,
              borderRadius: 5, padding: '10px 14px', cursor: 'pointer',
              textAlign: 'left' as const, fontFamily: SERIF,
            }}
          >
            <span style={{ fontSize: 16, marginRight: 8 }}>{et.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: enfType === et.label ? '#ffffff' : '#333333' }}>
              {et.label}
            </span>
          </button>
        ))}
      </div>

      {enfType && (
        <>
          <label style={lbS}>Situation — {enfType}</label>
          <textarea
            style={taS}
            rows={5}
            value={situation}
            onChange={e => setSituation(e.target.value)}
            placeholder="Describe what the defaulting party has done or failed to do, and when. Include amounts in arrears, dates of breach, and what steps have been taken so far..."
          />
          <div style={{ marginTop: 10 }}>
            <Btn onClick={analyse} loading={ai.loading} disabled={situation.trim().length < 20} label="Analyse Enforcement Options →" />
          </div>
        </>
      )}

      {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}

      {output && (
        <div style={{ marginTop: 16, background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 7, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a' }}>
              Enforcement Analysis
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { navigator.clipboard?.writeText(output).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ background: '#ffffff', border: '1px solid #cccccc', color: copied ? '#1a7a3a' : '#444444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button onClick={() => setOutput('')} style={{ background: 'none', border: '1px solid #eecccc', color: '#aa4444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          </div>
          <Md text={output} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

type ActiveTab = 'tracker' | 'absolute' | 'enforcement';

export function DecreeEnforcementEngine({ activeCase }: { activeCase: Case }) {
  const ai = useAI(activeCase);

  const [tab, setTab] = useState<ActiveTab>('tracker');
  const [mData, setMData] = useState<MatrimonialCaseData | null>(null);

  // Tracker state
  const [nisiDate, setNisiDate] = useState('');
  const [nisiTerms, setNisiTerms] = useState('');
  const [childrenOrder, setChildrenOrder] = useState<'yes' | 'no' | ''>('');
  const [saved, setSaved] = useState(false);

  // Intelligence pre-population
  const [intelligenceCleared, setIntelligenceCleared] = useState(false);
  const [hasIntelligence, setHasIntelligence] = useState(false);
  const [intelligencePackage, setIntelligencePackage] = useState('');

  // Draft application state
  const [draftOutput, setDraftOutput] = useState('');
  const [draftCopied, setDraftCopied] = useState(false);

  useEffect(() => {
    if (!activeCase?.id) return;
    loadMatrimonialData(activeCase.id).then(d => {
      if (!d) return;
      setMData(d);

      // Always apply saved structural fields first
      if (d.decree_nisi_date) setNisiDate(d.decree_nisi_date);
      if (d.decree_absolute_path) setChildrenOrder(d.decree_absolute_path === 's57_28_days' ? 'yes' : 'no');

      // Then layer intelligence pre-population if available and not yet overridden
      if (d.intelligence_extraction) {
        setHasIntelligence(true);
        if (d.intelligence_package) setIntelligencePackage(d.intelligence_package);

        // Only pre-populate tracker if no saved structural data exists yet
        if (!d.decree_nisi_date && !d.decree_absolute_path) {
          const ex = d.intelligence_extraction;
          // Infer children path from extraction
          if (ex.children.length > 0) {
            setChildrenOrder('yes'); // s.57 path — children present; associate must confirm welfare order
          } else {
            setChildrenOrder('no'); // s.58 path — no children
          }
          // nisiDate left blank — we know the stage but not the date yet
        }
      }
    });
  }, [activeCase?.id]);

  // Deadline periods sourced from Law Registry (overridable without deploy)
  const S57_DAYS   = parseInt(getLawSync('mca_s57_absolute_days'),   10) || 28;
  const S58_MONTHS = parseInt(getLawSync('mca_s58_absolute_months'), 10) || 3;

  // Compute deadline
  const deadline = nisiDate && childrenOrder
    ? childrenOrder === 'yes'
      ? addDays(nisiDate, S57_DAYS)
      : addMonths(nisiDate, S58_MONTHS)
    : null;

  const countdown = deadline ? daysUntil(deadline) : null;

  async function saveTracker() {
    if (!nisiDate || !childrenOrder) return;
    const patch: Partial<MatrimonialCaseData> = {
      decree_nisi_date:      nisiDate,
      decree_absolute_path:  childrenOrder === 'yes' ? 's57_28_days' : 's58_3_months',
      decree_absolute_deadline: deadline ?? undefined,
    };
    await saveMatrimonialData(activeCase.id, { ...(mData ?? {}), ...patch });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function draftAbsolute() {
    if (!nisiDate || !childrenOrder) return;
    const path = childrenOrder === 'yes' ? `s.57 MCA (${S57_DAYS}-day path — children welfare order made)` : `s.58 MCA (${S58_MONTHS}-month path — no children welfare order)`;
    const intelligenceContext = intelligencePackage
      ? `\n\nCASE INTELLIGENCE SUMMARY (from MIntelligence):\n${intelligencePackage.slice(0, 1200)}`
      : '';
    const prompt = `Draft an Application to Make Decree Nisi Absolute in the matter of ${activeCase.caseName}.

DECREE NISI DATE: ${formatDate(nisiDate)}
APPLICABLE PATH: ${path}
EARLIEST APPLICATION DATE: ${formatDate(deadline!)}

DECREE NISI TERMS:
${nisiTerms || '(counsel to insert)'}${intelligenceContext}

Draft:
1. Motion paper (by Notice of Motion or ex-parte as applicable) — O.11 MCR
2. Supporting affidavit verifying that the conditions in the applicable section are satisfied
3. Exhibit list
4. Order sought

State the applicable statutory provision clearly (${childrenOrder === 'yes' ? 's.57' : 's.58'} MCA). The application must state that the prescribed period has elapsed or will have elapsed by the return date.`;

    const result = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2500, libraryOpts: { queryHint: 'decree absolute s.57 s.58 MCA application make absolute children welfare order O.11 MCR prescribed period' } });
    if (result) setDraftOutput(result);
  }

  const TABS: Array<{ id: ActiveTab; label: string; icon: string }> = [
    { id: 'tracker', label: 'Decree Tracker', icon: '📅' },
    { id: 'absolute', label: 'Application to Make Absolute', icon: '⚡' },
    { id: 'enforcement', label: 'Post-Decree Enforcement', icon: '⚖' },
  ];

  return (
    <div style={{ paddingTop: 24, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Decree & Enforcement Engine
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          s.57 MCA ({S57_DAYS} days, children order) · s.58 MCA ({S58_MONTHS} months, no children order) · Post-decree enforcement
        </p>
      </div>

      {hasIntelligence && !intelligenceCleared && mData && (
        <IntelligenceBanner
          matrimonialData={mData}
          onClear={() => {
            setIntelligenceCleared(true);
            // Clear the intelligence-derived path suggestion if no structural data saved
            if (!mData?.decree_nisi_date) {
              setChildrenOrder('');
            }
          }}
        />
      )}

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: '1px solid #e0e0e0', paddingBottom: 0 }}>
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
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}

      {/* TAB: Decree Tracker */}
      {tab === 'tracker' && (
        <div>
          <div style={cardS}>
            <div style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #ede0f5' }}>
              Decree Nisi — Record & Track
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={lbS}>Date of Decree Nisi <span style={{ color: '#cc3333' }}>*</span></label>
                <input type="date" style={iS} value={nisiDate} onChange={e => setNisiDate(e.target.value)} />
              </div>

              <div>
                <label style={lbS}>Was a Children's Welfare Arrangement Order made at decree nisi? <span style={{ color: '#cc3333' }}>*</span></label>
                <p style={{ fontSize: 11, fontFamily: SERIF, color: '#888888', marginBottom: 8, lineHeight: 1.6 }}>
                  This determines whether s.57 ({S57_DAYS} days) or s.58 ({S58_MONTHS} months) applies. The wrong answer produces the wrong deadline.
                </p>
                {hasIntelligence && !intelligenceCleared && childrenOrder && !mData?.decree_absolute_path && (
                  <p style={{ fontSize: 10, fontFamily: SERIF, color: '#1a5a38', background: '#edfaf3', border: '1px solid #b8e8cc', borderRadius: 4, padding: '5px 10px', marginBottom: 8 }}>
                    ⚡ Path inferred from MIntelligence extraction — confirm against the actual decree nisi order before saving.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  {(['yes', 'no'] as const).map(v => (
                    <button key={v} onClick={() => setChildrenOrder(v)} style={{
                      background: childrenOrder === v ? (v === 'yes' ? '#edfaf3' : '#fbedf0') : '#f5f5f5',
                      border: `1px solid ${childrenOrder === v ? (v === 'yes' ? '#b8e8cc' : '#e8b8c0') : '#dddddd'}`,
                      color: childrenOrder === v ? (v === 'yes' ? '#1a5a3a' : '#7a1a1a') : '#555555',
                      borderRadius: 5, padding: '8px 20px', fontSize: 13, fontFamily: SERIF,
                      fontWeight: 600, cursor: 'pointer',
                    }}>
                      {v === 'yes' ? `✓ Yes — s.57 (${S57_DAYS} days)` : `✗ No — s.58 (${S58_MONTHS} months)`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={lbS}>Terms of Decree Nisi (optional)</label>
                <textarea style={taS} rows={4} value={nisiTerms} onChange={e => setNisiTerms(e.target.value)}
                  placeholder="Set out the orders made at decree nisi — ancillary relief, custody arrangements, costs, any undertakings..."
                />
              </div>
            </div>

            {/* Computed Deadline Display */}
            {deadline && (
              <div style={{
                marginTop: 18, padding: '16px 20px',
                background: countdown !== null && countdown < 0 ? '#fbedf0' : countdown !== null && countdown <= 14 ? '#fff8e1' : '#edfaf3',
                border: `1px solid ${countdown !== null && countdown < 0 ? '#e8b8c0' : countdown !== null && countdown <= 14 ? '#f0c040' : '#b8e8cc'}`,
                borderRadius: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontSize: 10, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 700,
                      color: countdown !== null && countdown < 0 ? '#7a1a1a' : '#1a5a3a', marginBottom: 4 }}>
                      {childrenOrder === 'yes' ? 's.57 MCA — 28-Day Path' : 's.58 MCA — 3-Month Path'}
                    </p>
                    <p style={{ fontSize: 24, fontFamily: SERIF, fontWeight: 700, color: '#111111', letterSpacing: '.02em' }}>
                      {formatDate(deadline)}
                    </p>
                    <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', marginTop: 4 }}>
                      Earliest date to apply to make decree absolute
                    </p>
                  </div>
                  {countdown !== null && (
                    <div style={{ textAlign: 'right' as const }}>
                      <p style={{ fontSize: 28, fontFamily: SERIF, fontWeight: 700,
                        color: countdown < 0 ? '#7a1a1a' : countdown <= 14 ? '#7a5a00' : '#1a5a3a' }}>
                        {countdown < 0 ? `${Math.abs(countdown)} days overdue` : countdown === 0 ? 'Today' : `${countdown} days`}
                      </p>
                      {countdown < 0 && (
                        <p style={{ fontSize: 11, fontFamily: SERIF, color: '#7a1a1a' }}>
                          Application can be filed immediately
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <Btn onClick={saveTracker} loading={false} disabled={!nisiDate || !childrenOrder} label={saved ? '✓ Saved' : 'Save to Case'} />
            </div>
          </div>

          {/* Doctrinal Note */}
          <div style={{ background: '#faf8ff', border: '1px solid #e0d8f0', borderRadius: 6, padding: '14px 16px' }}>
            <p style={{ fontSize: 11, fontFamily: SERIF, fontWeight: 600, color: '#4a1a7a', marginBottom: 6 }}>Doctrinal Note</p>
            <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', lineHeight: 1.7 }}>
              <strong>s.57 MCA:</strong> Where the court made a children welfare arrangement order at decree nisi, the petitioner must obtain the court's satisfaction as to the welfare of the children before or with the application to make absolute. The minimum period is 28 days.<br /><br />
              <strong>s.58 MCA:</strong> Where no children welfare arrangement order was made, the minimum period before applying to make absolute is 3 months from the date of decree nisi.<br /><br />
              <strong>s.241(2) CFRN:</strong> No appeal lies against a decree absolute. This is a hard constitutional bar. There are no exceptions.
            </p>
          </div>
        </div>
      )}

      {/* TAB: Application to Make Absolute */}
      {tab === 'absolute' && (
        <div style={cardS}>
          <div style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #ede0f5' }}>
            Draft Application to Make Decree Absolute
          </div>

          {!nisiDate || !childrenOrder ? (
            <div style={{ background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 5, padding: '14px 16px' }}>
              <p style={{ fontSize: 13, fontFamily: SERIF, color: '#7a5a00' }}>
                ⚠ Please record the decree nisi date and path in the Decree Tracker tab first.
              </p>
            </div>
          ) : (
            <>
              <div style={{ background: '#faf8ff', border: '1px solid #e0d8f0', borderRadius: 5, padding: '12px 16px', marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontFamily: SERIF, color: '#333333', lineHeight: 1.7 }}>
                  <strong>Decree Nisi:</strong> {formatDate(nisiDate)} &nbsp;|&nbsp;
                  <strong>Path:</strong> {childrenOrder === 'yes' ? 's.57 MCA — 28 days' : 's.58 MCA — 3 months'} &nbsp;|&nbsp;
                  <strong>Earliest Application:</strong> {formatDate(deadline!)}
                  {countdown !== null && countdown > 0 && (
                    <span style={{ color: '#7a5a00' }}> ({countdown} days remaining)</span>
                  )}
                  {countdown !== null && countdown <= 0 && (
                    <span style={{ color: '#1a5a3a' }}> — period has elapsed ✓</span>
                  )}
                </p>
              </div>

              <Btn onClick={draftAbsolute} loading={ai.loading} label="Draft Application to Make Absolute →" />

              {draftOutput && (
                <div style={{ marginTop: 16, background: '#fafafa', border: '1px solid #dddddd', borderRadius: 7, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a' }}>
                      Draft — Application for Decree Absolute
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { navigator.clipboard?.writeText(draftOutput).catch(() => {}); setDraftCopied(true); setTimeout(() => setDraftCopied(false), 2000); }}
                        style={{ background: '#ffffff', border: '1px solid #cccccc', color: draftCopied ? '#1a7a3a' : '#444444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
                        {draftCopied ? '✓ Copied' : 'Copy'}
                      </button>
                      <button onClick={() => setDraftOutput('')} style={{ background: 'none', border: '1px solid #eecccc', color: '#aa4444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
                        Clear
                      </button>
                    </div>
                  </div>
                  <Md text={draftOutput} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB: Post-Decree Enforcement */}
      {tab === 'enforcement' && (
        <div style={cardS}>
          <div style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #ede0f5' }}>
            Post-Decree Enforcement
          </div>

          {/* Magistrate Court note */}
          <div style={{ background: '#edfaf3', border: '1px solid #b8e8cc', borderRadius: 5, padding: '10px 14px', marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontFamily: SERIF, color: '#1a5a3a', lineHeight: 1.7 }}>
              <strong>Note (s.2(1)(b) MCA):</strong> Maintenance orders under the MCA may also be enforced in the Magistrate Court. Consider this where expedited enforcement of arrears is needed and the Magistrate Court has a shorter list.
            </p>
          </div>

          <EnforcementPanel activeCase={activeCase} />
        </div>
      )}
    </div>
  );
}
