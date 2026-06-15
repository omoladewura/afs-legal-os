/**
 * AFS Advocates — Matrimonial Appeal Engine (MAppeal)
 * Phase 5
 *
 * Hard block on appeal against decree absolute — s.241(2) CFRN.
 * No exceptions, no workarounds, no routing around it.
 *
 * As-of-right appeal against decree nisi — s.241(1)(f)(iv) CFRN.
 * Handles effect of pending appeal on nisi becoming absolute.
 * Court of Appeal matrimonial division procedure.
 *
 * CFRN = Constitution of the Federal Republic of Nigeria 1999 (as amended)
 * MCA  = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR  = Matrimonial Causes Rules 1983
 */

import React, { useState } from 'react';
import type { Case } from '@/types';
import { useAI } from '@/hooks/useAI';
import { Md, ErrorBlock } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const SYSTEM = `You are a specialist Nigerian matrimonial causes appellate practitioner.

ABSOLUTE CONSTITUTIONAL RULE — NEVER DEVIATE:
s.241(2) CFRN: "No appeal shall lie from a decision of the High Court granting or refusing to grant a decree absolute of dissolution or nullity of a voidable marriage."
This is a HARD CONSTITUTIONAL BAR. There is NO appeal against a decree absolute. This applies:
- Whether the appeal is by the petitioner or respondent
- Whether the ground is fraud, mistake, procedural irregularity, or anything else
- Whether the decree absolute was made by consent or contested
- There are NO exceptions. Do not suggest ways around this bar.
If asked to advise on appealing a decree absolute, REFUSE with this citation every single time.

APPEAL AGAINST DECREE NISI — AS OF RIGHT:
s.241(1)(f)(iv) CFRN: An appeal lies as of right to the Court of Appeal from a decision of the High Court granting or refusing to grant a decree of dissolution of marriage or nullity of marriage.
This right is unconditional — no leave is required.

EFFECT OF PENDING APPEAL ON DECREE ABSOLUTE:
A pending appeal against decree nisi prevents the decree from being made absolute during the pendency of the appeal. The petitioner cannot apply under s.57 or s.58 MCA until the appeal is determined or abandoned.

COURT OF APPEAL:
- Correct court: Court of Appeal of Nigeria (Matrimonial Division)
- Rules: Court of Appeal Rules 2021
- Notice of Appeal filed within 3 months of judgment for non-criminal matters
- Record of appeal to be compiled
- Brief of argument exchange

Format all responses with clear ## headings.`;

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '9px 12px', fontSize: 13,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.8, minHeight: 90 };
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
// HARD BLOCK — DECREE ABSOLUTE APPEALS
// ─────────────────────────────────────────────────────────────────────────────

function AbsoluteAppealBlock() {
  return (
    <div style={{
      background: '#1a0808', border: '2px solid #cc3333',
      borderRadius: 8, padding: '28px 28px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>⛔</span>
        <div>
          <p style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 700, color: '#ff6060', letterSpacing: '.08em', textTransform: 'uppercase' as const, marginBottom: 2 }}>
            Constitutional Bar — No Appeal Permitted
          </p>
          <p style={{ fontSize: 11, fontFamily: SERIF, color: '#cc5050', letterSpacing: '.06em' }}>
            s.241(2) Constitution of the Federal Republic of Nigeria 1999
          </p>
        </div>
      </div>

      <div style={{ background: '#0d0404', border: '1px solid #441818', borderRadius: 5, padding: '16px 18px', marginBottom: 16 }}>
        <p style={{ fontSize: 15, fontFamily: "'Courier New', Courier, monospace", color: '#ff9090', lineHeight: 1.8, fontStyle: 'italic' }}>
          "No appeal shall lie from a decision of the High Court granting
          or refusing to grant a decree absolute of dissolution or nullity
          of a voidable marriage."
        </p>
        <p style={{ fontSize: 10, fontFamily: SERIF, color: '#884444', marginTop: 8, letterSpacing: '.06em' }}>
          SECTION 241(2), CONSTITUTION OF THE FEDERAL REPUBLIC OF NIGERIA 1999 (AS AMENDED)
        </p>
      </div>

      <p style={{ fontSize: 13, fontFamily: SERIF, color: '#cc8080', lineHeight: 1.75, marginBottom: 12 }}>
        This is a hard constitutional bar. It applies without exception:
      </p>

      <ul style={{ margin: '0 0 16px 20px', padding: 0 }}>
        {[
          'Whether the appeal is by the petitioner or the respondent',
          'Whether the grounds allege fraud, mistake, irregularity, or injustice',
          'Whether the decree absolute was made by consent or after contest',
          'Whether the proceedings that led to it were flawed',
          'At no point can this bar be circumvented by a different appeal route',
        ].map((item, i) => (
          <li key={i} style={{ fontSize: 13, fontFamily: SERIF, color: '#aa6060', marginBottom: 6, lineHeight: 1.65 }}>
            {item}
          </li>
        ))}
      </ul>

      <div style={{ background: '#120606', border: '1px solid #3a1010', borderRadius: 5, padding: '12px 16px' }}>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#886060', lineHeight: 1.7 }}>
          <strong style={{ color: '#cc7070' }}>Alternative remedies to consider:</strong><br />
          If the decree absolute was obtained by fraud or misrepresentation, the correct remedy may be an application to the court that made the order (not an appeal) to set aside the decree on those specific grounds. This is an equitable jurisdiction and is fact-dependent. Seek senior counsel's opinion.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DECREE NISI APPEAL MODULE
// ─────────────────────────────────────────────────────────────────────────────

function NisiAppealPanel({ activeCase }: { activeCase: Case }) {
  const ai = useAI(activeCase);
  const [nisiDate, setNisiDate] = useState('');
  const [outcome, setOutcome] = useState('');
  const [grounds, setGrounds] = useState('');
  const [pendingEffect, setPendingEffect] = useState('');
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);

  async function analyse() {
    const prompt = `Matrimonial appeal advice — decree nisi

Case: ${activeCase.caseName}
Court below: ${activeCase.court || 'High Court'}
Decree Nisi Date / Outcome: ${nisiDate ? `Granted/refused on ${nisiDate}` : outcome}
Proposed Grounds of Appeal: ${grounds}
Effect of Pending Appeal on Decree Absolute: ${pendingEffect || 'advise on this'}

Advise on:

## Right of Appeal
- Confirm the as-of-right appeal under s.241(1)(f)(iv) CFRN — no leave required
- Whether this is an appeal against grant or refusal of decree nisi

## Grounds of Appeal
- Assessment of each proposed ground
- Any additional grounds to consider
- Strength of each ground

## Procedure
- Notice of Appeal: form, content, time limit (3 months), filing court
- Record of Appeal compilation
- Brief of argument exchange in the Court of Appeal
- Application to stay execution pending appeal (and whether this prevents absolute)

## Effect on Decree Absolute
- Pending appeal prevents petitioner applying to make absolute
- s.57 / s.58 MCA timelines are suspended until appeal is determined or abandoned
- What happens if appeal is abandoned

## Strategic Assessment
- Prospects
- Cost-benefit for both sides
- Recommended course`;

    const result = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2500, libraryOpts: { queryHint: 'appeal decree nisi s.241(1)(f)(iv) CFRN s.241(2) absolute bar Court of Appeal matrimonial pending appeal effect' } });
  }

  return (
    <div>
      <div style={{ background: '#edfaf3', border: '1px solid #b8e8cc', borderRadius: 5, padding: '12px 16px', marginBottom: 16 }}>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#1a5a3a', lineHeight: 1.7 }}>
          <strong>s.241(1)(f)(iv) CFRN:</strong> An appeal lies as of right to the Court of Appeal from any decision of the High Court granting or refusing to grant a decree of dissolution of marriage or nullity of marriage. <strong>No leave is required.</strong>
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={lbS}>Date of Decree Nisi (or refusal)</label>
          <input type="date" style={iS} value={nisiDate} onChange={e => setNisiDate(e.target.value)} />
        </div>
        <div>
          <label style={lbS}>Decision appealed against</label>
          <select style={iS} value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="">— select —</option>
            <option value="Grant of decree nisi">Grant of decree nisi — respondent appeals</option>
            <option value="Refusal to grant decree nisi">Refusal to grant decree nisi — petitioner appeals</option>
            <option value="Grant of nullity">Grant of nullity — respondent appeals</option>
            <option value="Refusal of nullity">Refusal of nullity — petitioner appeals</option>
          </select>
        </div>
        <div>
          <label style={lbS}>Proposed Grounds of Appeal</label>
          <textarea style={taS} rows={5} value={grounds} onChange={e => setGrounds(e.target.value)}
            placeholder="Set out each proposed ground — e.g. misdirection on standard of proof, failure to consider material evidence, wrong application of s.15(2)(c) standard, failure to consider condonation defence..."
          />
        </div>
        <div>
          <label style={lbS}>Urgency / Effect on Decree Absolute</label>
          <textarea style={{ ...taS, minHeight: 60 }} rows={2} value={pendingEffect} onChange={e => setPendingEffect(e.target.value)}
            placeholder="Is the petitioner seeking to make absolute? Is there urgency? What has already been done?"
          />
        </div>
      </div>

      <Btn onClick={analyse} loading={ai.loading} disabled={!outcome || grounds.trim().length < 20} label="Analyse Appeal →" />
      {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}

      {output && (
        <div style={{ marginTop: 16, background: '#fafafa', border: '1px solid #dddddd', borderRadius: 7, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a' }}>
              Appeal Advice
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
// NOTICE OF APPEAL DRAFTER
// ─────────────────────────────────────────────────────────────────────────────

function NoticeOfAppealPanel({ activeCase }: { activeCase: Case }) {
  const ai = useAI(activeCase);
  const [details, setDetails] = useState({
    courtBelow: activeCase.court || '',
    judgmentDate: '',
    decision: '',
    grounds: '',
    reliefSought: '',
  });
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  function set(k: keyof typeof details, v: string) {
    setDetails(prev => ({ ...prev, [k]: v }));
  }

  async function generate() {
    const prompt = `Draft a Notice of Appeal in the matter of ${activeCase.caseName} from the decision of the High Court on the decree nisi.

Court Below: ${details.courtBelow}
Date of Judgment: ${details.judgmentDate}
Decision Appealed: ${details.decision}
Grounds of Appeal: ${details.grounds}
Relief Sought in the Court of Appeal: ${details.reliefSought}

Draft a complete Notice of Appeal under the Court of Appeal Rules 2021, including:
1. Caption and heading
2. Parties
3. Name and address of the court below
4. Date and nature of the decision appealed against
5. Full grounds of appeal (numbered)
6. Relief sought
7. Signature block for counsel

Note: This is an appeal as of right under s.241(1)(f)(iv) CFRN — no leave required. State this clearly in the preamble.`;

    const result = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2000, libraryOpts: { queryHint: 'notice of appeal Court of Appeal matrimonial s.241(1)(f)(iv) CFRN grounds of appeal decree nisi as of right' } });
  }

  return (
    <div>
      <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={lbS}>Court Below</label>
          <input type="text" style={iS} value={details.courtBelow} onChange={e => set('courtBelow', e.target.value)} placeholder="High Court of [State]" />
        </div>
        <div>
          <label style={lbS}>Date of Judgment</label>
          <input type="date" style={iS} value={details.judgmentDate} onChange={e => set('judgmentDate', e.target.value)} />
        </div>
        <div>
          <label style={lbS}>Decision Appealed Against</label>
          <input type="text" style={iS} value={details.decision} onChange={e => set('decision', e.target.value)}
            placeholder="e.g. Grant of decree nisi of dissolution of marriage" />
        </div>
        <div>
          <label style={lbS}>Grounds of Appeal</label>
          <textarea style={taS} rows={6} value={details.grounds} onChange={e => set('grounds', e.target.value)}
            placeholder="1. The learned trial judge erred in law in holding that...\n2. The learned trial judge misdirected herself in finding that..." />
        </div>
        <div>
          <label style={lbS}>Relief Sought in Court of Appeal</label>
          <textarea style={{ ...taS, minHeight: 60 }} rows={3} value={details.reliefSought} onChange={e => set('reliefSought', e.target.value)}
            placeholder="An order setting aside the decree nisi granted on [date] and [substituting an order dismissing the petition / remitting the matter for retrial]..." />
        </div>
      </div>

      <Btn onClick={generate} loading={ai.loading}
        disabled={!details.judgmentDate || !details.decision || details.grounds.trim().length < 30}
        label="Draft Notice of Appeal →" />
      {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}

      {draft && (
        <div style={{ marginTop: 16, background: '#fafafa', border: '1px solid #dddddd', borderRadius: 7, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a' }}>
              Draft Notice of Appeal
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { navigator.clipboard?.writeText(draft).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ background: '#ffffff', border: '1px solid #cccccc', color: copied ? '#1a7a3a' : '#444444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button onClick={() => setDraft('')} style={{ background: 'none', border: '1px solid #eecccc', color: '#aa4444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          </div>
          <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 13, color: '#111111', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {draft}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

type AppealTab = 'absolute_check' | 'nisi_appeal' | 'notice';

export function MAppeal({ activeCase }: { activeCase: Case }) {
  const [tab, setTab] = useState<AppealTab>('absolute_check');

  const TABS: Array<{ id: AppealTab; label: string; icon: string }> = [
    { id: 'absolute_check', label: 'Appeal Against Absolute', icon: '⛔' },
    { id: 'nisi_appeal',    label: 'Appeal Against Nisi',     icon: '▲' },
    { id: 'notice',         label: 'Draft Notice of Appeal',  icon: '✍' },
  ];

  return (
    <div style={{ paddingTop: 24, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Matrimonial Appeal Engine
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          s.241(2) CFRN — hard bar on absolute appeals · s.241(1)(f)(iv) CFRN — as-of-right nisi appeal · Court of Appeal procedure
        </p>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: '1px solid #e0e0e0' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? (t.id === 'absolute_check' ? '#3a0808' : '#111111') : 'transparent',
            border: '1px solid transparent',
            borderColor: tab === t.id ? (t.id === 'absolute_check' ? '#883333' : '#111111') : 'transparent',
            color: tab === t.id ? (t.id === 'absolute_check' ? '#ff8080' : '#ffffff') : '#555555',
            borderRadius: '4px 4px 0 0', padding: '7px 14px', fontSize: 12,
            fontFamily: SERIF, cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
            letterSpacing: '.04em', marginBottom: tab === t.id ? -1 : 0,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* TAB: Absolute — hard block */}
      {tab === 'absolute_check' && (
        <div>
          <AbsoluteAppealBlock />

          {/* Quick advisory panel */}
          <div style={{ marginTop: 16, background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '20px 22px' }}>
            <p style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#555555', marginBottom: 10 }}>
              What You Can Do Instead
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { label: 'Appeal the decree nisi', detail: 'An appeal against decree nisi is available as of right under s.241(1)(f)(iv) CFRN. A pending nisi appeal prevents the decree from being made absolute. See the Appeal Against Nisi tab.' },
                { label: 'Set aside the decree absolute', detail: 'If the decree absolute was obtained by fraud, misrepresentation, or material non-disclosure, there may be an application to the court that made the order to set it aside on equitable grounds. This is not an appeal — it is a separate jurisdiction.' },
                { label: 'Enforce ancillary orders separately', detail: 'Maintenance, property, and custody orders remain enforceable regardless of the finality of the decree absolute. See the Decree & Enforcement tab.' },
                { label: 'Vary existing ancillary orders', detail: 'Maintenance and property orders may be varied under ss.45 and 70 MCA. The dissolution does not bar variation applications.' },
              ].map((item, i) => (
                <div key={i} style={{ background: '#fafafa', border: '1px solid #eeeeee', borderRadius: 5, padding: '10px 14px' }}>
                  <p style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600, color: '#111111', marginBottom: 4 }}>{item.label}</p>
                  <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', lineHeight: 1.65 }}>{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: Appeal against nisi */}
      {tab === 'nisi_appeal' && (
        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '20px 22px' }}>
          <NisiAppealPanel activeCase={activeCase} />
        </div>
      )}

      {/* TAB: Draft Notice */}
      {tab === 'notice' && (
        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '20px 22px' }}>
          <NoticeOfAppealPanel activeCase={activeCase} />
        </div>
      )}
    </div>
  );
}
