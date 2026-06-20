/**
 * AFS Legal OS V2 — Defence Case Engine (Phase A)
 *
 * Dual-role criminal engine: activated after no-case is overruled
 * OR after the defence elects to call witnesses.
 *
 * PROSECUTION sub-tabs:
 *   1. Cross-Examination Tracker  — per defence witness, AI drafts cross questions
 *   2. Defence Evidence Monitor   — log exhibits tendered by defence, flag admissibility
 *   3. Close of Defence           — record close, activate Final Address
 *
 * DEFENCE sub-tabs:
 *   1. Election                   — call witnesses or rest — decision recorded
 *   2. Defence Witnesses          — DW1, DW2 etc. — name, role, evidence per count
 *   3. Examination-in-Chief       — AI drafts examination questions per witness
 *   4. Close of Defence           — record close, activate Final Address
 *
 * Storage: loadBlindSpot/saveBlindSpot key `defence_case_${caseId}`.
 * AI via useAI(activeCase).
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type DefSubTab  = 'election' | 'witnesses' | 'exam_in_chief' | 'close_def';
type ProsSubTab = 'cross_tracker' | 'evidence_monitor' | 'close_pros';
type SubTab     = DefSubTab | ProsSubTab;

type ElectionDecision = '' | 'call_witnesses' | 'rest_on_prosecution';

interface DefenceWitness {
  id:       string;
  name:     string;
  role:     string;  // e.g. 'Accused', 'Character Witness', 'Expert'
  counts:   string;  // which counts their evidence addresses
  summary:  string;  // what they will say
  examDraft: string; // AI-generated examination questions
}

interface DefenceExhibit {
  id:          string;
  label:       string;   // e.g. DEx1
  description: string;
  tenderedBy:  string;   // witness name
  admissible:  'Pending' | 'Admitted' | 'Objected' | 'Rejected';
  objection:   string;
}

interface SavedData {
  // Defence state
  election?:       ElectionDecision;
  electionDate?:   string;
  electionNotes?:  string;
  witnesses?:      DefenceWitness[];
  closeDefNotes?:  string;
  closeDefDate?:   string;
  defClosed?:      boolean;
  // Prosecution state
  prosWitnesses?:  ProsWitnessCross[];
  defExhibits?:    DefenceExhibit[];
  closeProsNotes?: string;
  closeProsDate?:  string;
  prosClosed?:     boolean;
}

interface ProsWitnessCross {
  id:       string;
  name:     string;
  role:     string;
  weaknesses: string;
  crossDraft: string;
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

function Btn({ onClick, loading, disabled, label, accent = '#40a860' }: {
  onClick: () => void; loading: boolean; disabled?: boolean; label: string; accent?: string;
}) {
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

function ResultBlock({ title, content, onClear, accent = '#40a860' }: {
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
      <Md text={content} />
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
// DEFENCE SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

function ElectionTab({ election, setElection, electionDate, setElectionDate, electionNotes, setElectionNotes, accent }: {
  election: ElectionDecision;
  setElection: (v: ElectionDecision) => void;
  electionDate: string;
  setElectionDate: (v: string) => void;
  electionNotes: string;
  setElectionNotes: (v: string) => void;
  accent: string;
}) {
  const OPTS: { value: ElectionDecision; label: string; desc: string; col: string }[] = [
    {
      value: 'call_witnesses',
      label: 'Call Defence Witnesses',
      desc: 'The defence elects to open its case and call witnesses. The accused may testify and additional witnesses may be called.',
      col: '#40a860',
    },
    {
      value: 'rest_on_prosecution',
      label: 'Rest on the Prosecution Case',
      desc: 'The defence makes no case and rests entirely on the weaknesses in the prosecution evidence. No defence witnesses are called.',
      col: '#c09030',
    },
  ];

  return (
    <div style={cardS}>
      <h3 style={hS}>Defence Election</h3>
      <p style={dimS}>
        After the no-case submission is overruled, the defence must formally elect whether to call
        witnesses or rest on the prosecution case. This decision is recorded and cannot be reversed
        once communicated to the court.
      </p>

      <div style={{
        padding: '12px 16px', background: `${accent}08`,
        border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 22,
        fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
      }}>
        <strong style={{ color: accent }}>ACJA 2015 — Defence Case</strong>
        {' '}— After the no-case ruling is overruled, the accused is required to enter on his
        defence (s.303(4) ACJA). The defence counsel should advise the accused on the election
        before communicating it to the court. Once the decision is communicated, the proceedings
        move irrevocably to the next stage.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
        {OPTS.map(o => {
          const selected = election === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setElection(o.value)}
              style={{
                background:  selected ? `${o.col}10` : '#f8f8f8',
                border:      `2px solid ${selected ? o.col : '#d0d0d0'}`,
                borderRadius: 8,
                padding:     '16px 20px',
                textAlign:   'left',
                cursor:      'pointer',
                transition:  'all .15s',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: selected ? o.col : T.text, fontFamily: "'Times New Roman', Times, serif", marginBottom: 6 }}>
                {selected ? '● ' : '○ '}{o.label}
              </div>
              <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                {o.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelS}>Date of Election</label>
          <input type="date" style={iS} value={electionDate} onChange={e => setElectionDate(e.target.value)} />
        </div>
        <div>
          <label style={labelS}>Notes / Court Record</label>
          <input
            style={iS}
            value={electionNotes}
            onChange={e => setElectionNotes(e.target.value)}
            placeholder="e.g. Accused elects to testify. DW1 confirmed. Adjourn to [date] for defence opening."
          />
        </div>
      </div>

      {election && (
        <div style={{
          marginTop: 16, padding: '14px 18px', borderRadius: 6,
          background: election === 'call_witnesses' ? '#0d1800' : '#181000',
          border: `1px solid ${election === 'call_witnesses' ? '#285000' : '#3a2800'}`,
        }}>
          <p style={{ fontSize: 13, color: election === 'call_witnesses' ? '#50c050' : '#b08030', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
            {election === 'call_witnesses'
              ? '✓ Election recorded: Call witnesses. Proceed to Defence Witnesses tab to register DW1, DW2 etc.'
              : '✓ Election recorded: Rest on prosecution case. Proceed to Close of Defence tab to formally close.'}
          </p>
        </div>
      )}
    </div>
  );
}

const emptyWitness = (idx: number): DefenceWitness => ({
  id:        `dw_${Date.now()}_${idx}`,
  name:      '',
  role:      '',
  counts:    '',
  summary:   '',
  examDraft: '',
});

function WitnessesTab({ witnesses, setWitnesses, accent }: {
  witnesses: DefenceWitness[];
  setWitnesses: (fn: (p: DefenceWitness[]) => DefenceWitness[]) => void;
  accent: string;
}) {
  const add    = () => setWitnesses(p => [...p, emptyWitness(p.length)]);
  const remove = (id: string) => setWitnesses(p => p.filter(w => w.id !== id));
  const update = (id: string, field: keyof DefenceWitness, value: string) =>
    setWitnesses(p => p.map(w => w.id === id ? { ...w, [field]: value } : w));

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Defence Witnesses</h3>
        <p style={dimS}>
          Register each defence witness. Label them DW1, DW2 etc. Record their role,
          which counts their evidence addresses, and a summary of what they will say.
          Use the Examination-in-Chief tab to generate examination questions per witness.
        </p>

        {witnesses.map((w, idx) => (
          <div key={w.id} style={{
            background: '#ffffff', border: `1px solid ${accent}28`,
            borderRadius: 7, padding: '16px 18px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: accent,
                fontFamily: "'Times New Roman', Times, serif",
                minWidth: 36, flexShrink: 0,
              }}>
                DW{idx + 1}
              </div>
              <input
                style={{ ...iS, flex: 1, minWidth: 180 }}
                value={w.name}
                onChange={e => update(w.id, 'name', e.target.value)}
                placeholder="Witness full name"
              />
              <input
                style={{ ...iS, flex: 1, minWidth: 160 }}
                value={w.role}
                onChange={e => update(w.id, 'role', e.target.value)}
                placeholder="Role (e.g. Accused, Expert, Alibi Witness)"
              />
              <input
                style={{ ...iS, width: 130, flex: '0 0 130px' }}
                value={w.counts}
                onChange={e => update(w.id, 'counts', e.target.value)}
                placeholder="Counts e.g. 1, 3"
              />
              {witnesses.length > 1 && (
                <button
                  onClick={() => remove(w.id)}
                  style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}
                >
                  remove
                </button>
              )}
            </div>
            <label style={labelS}>Evidence Summary — What this witness will say</label>
            <textarea
              style={{ ...taS, minHeight: 90 }}
              value={w.summary}
              onChange={e => update(w.id, 'summary', e.target.value)}
              placeholder="Summarise the evidence this witness will give, the facts they will establish, and how it meets the defence theory. Be specific — what facts does this witness prove that the prosecution has not?"
            />
          </div>
        ))}

        <button
          onClick={add}
          style={{
            background: 'transparent', border: `1px dashed ${accent}50`,
            color: accent, borderRadius: 6, padding: '9px 20px',
            fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            letterSpacing: '.06em',
          }}
        >
          + Add Defence Witness
        </button>
      </div>
    </div>
  );
}

function ExamInChiefTab({ witnesses, setWitnesses, accent, activeCase, fullContext }: {
  witnesses: DefenceWitness[];
  setWitnesses: (fn: (p: DefenceWitness[]) => DefenceWitness[]) => void;
  accent: string;
  activeCase: Case;
  fullContext: string;
}) {
  const { call, loading, error } = useAI(activeCase);
  const [selectedId, setSelectedId] = useState<string>(witnesses[0]?.id ?? '');
  const readyWitnesses = witnesses.filter(w => w.name && w.summary);

  const selected = witnesses.find(w => w.id === selectedId);

  const draftExam = useCallback(async () => {
    if (!selected?.name || !selected?.summary) return;
    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Draft examination-in-chief questions for a defence witness. Questions must be non-leading (examination-in-chief), logically sequenced, and designed to elicit the witness's full evidence efficiently. Apply the Evidence Act 2011.` + fullContext,
      userMsg: `Draft examination-in-chief questions for defence witness ${selected.name} in the matter: ${activeCase.caseName} at ${activeCase.court}.

Witness role: ${selected.role || 'Defence Witness'}
Counts their evidence addresses: ${selected.counts || 'all counts'}
Evidence summary: ${selected.summary}

Intelligence Package context: ${activeCase.intelligence_data?.intPkg ? activeCase.intelligence_data.intPkg.slice(0, 800) : 'Not available'}

Draft a complete examination-in-chief in the following structure:

1. **Witness Introduction** — questions establishing identity, occupation, and relationship to the matter
2. **Background / Foundational Questions** — questions establishing the witness's relevant knowledge or position
3. **Substantive Evidence Questions** — the main body of examination, sequenced chronologically or logically. For each question: (a) write the question in non-leading form, (b) note the fact it is designed to establish
4. **Exhibit Tendering** — if this witness tenders any documentary exhibit, draft the sequence of questions to properly tender it (identify, confirm authorship/receipt, tender through counsel)
5. **Closing Questions** — any final questions cementing the witness's account

Note any areas where the witness's evidence directly contradicts prosecution witnesses, and design questions to bring out those contradictions clearly without leading.`,
    });
    if (r) setWitnesses(p => p.map(w => w.id === selectedId ? { ...w, examDraft: r } : w));
  }, [selected, selectedId, activeCase, call, setWitnesses]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Examination-in-Chief Drafter</h3>
      <p style={dimS}>
        Select a defence witness and generate a full examination-in-chief sequence. Questions
        are non-leading, logically ordered, and designed to elicit the complete defence narrative.
        Requires witness name and evidence summary from the Defence Witnesses tab.
      </p>

      {readyWitnesses.length === 0 ? (
        <div style={{ padding: '16px', background: '#f8f0e0', border: '1px solid #e0d0a0', borderRadius: 6 }}>
          <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
            No witnesses ready. Add witnesses with name and evidence summary in the Defence Witnesses tab first.
          </p>
        </div>
      ) : (
        <>
          <label style={labelS}>Select Witness</label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{ ...iS, marginBottom: 16, cursor: 'pointer', appearance: 'none' }}
          >
            {witnesses.map((w, idx) => (
              <option key={w.id} value={w.id} disabled={!w.name || !w.summary}>
                DW{idx + 1} — {w.name || '(unnamed)'}
                {(!w.name || !w.summary) ? ' [incomplete]' : ''}
              </option>
            ))}
          </select>

          {selected && (
            <div style={{ marginBottom: 16, padding: '12px 16px', background: `${accent}06`, border: `1px solid ${accent}18`, borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: accent, fontWeight: 700, fontFamily: "'Times New Roman', Times, serif", marginBottom: 4 }}>
                {selected.name} — {selected.role || 'Defence Witness'}
              </div>
              <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                {selected.summary?.slice(0, 200)}{(selected.summary?.length ?? 0) > 200 ? '…' : ''}
              </div>
            </div>
          )}

          <Btn
            onClick={draftExam}
            loading={loading}
            disabled={!selected?.name || !selected?.summary}
            label={`Draft Examination — ${selected?.name ?? 'Select Witness'}`}
            accent={accent}
          />
          {error && <ErrorBlock message={error} />}

          {selected?.examDraft && (
            <ResultBlock
              title={`Examination-in-Chief — ${selected.name}`}
              content={selected.examDraft}
              onClear={() => setWitnesses(p => p.map(w => w.id === selectedId ? { ...w, examDraft: '' } : w))}
              accent={accent}
            />
          )}
        </>
      )}
    </div>
  );
}

function CloseOfDefenceTab({ closeNotes, setCloseNotes, closeDate, setCloseDate, closed, setClosed, accent, isDefence }: {
  closeNotes: string;
  setCloseNotes: (v: string) => void;
  closeDate: string;
  setCloseDate: (v: string) => void;
  closed: boolean;
  setClosed: (v: boolean) => void;
  accent: string;
  isDefence: boolean;
}) {
  return (
    <div style={cardS}>
      <h3 style={hS}>{isDefence ? 'Close of Defence' : 'Close of Defence — Prosecution Record'}</h3>
      <p style={dimS}>
        {isDefence
          ? 'Record the formal close of the defence case. Once closed, both sides are entitled to file Final Addresses. The date of close triggers the timeline for written addresses.'
          : 'Record the date the defence formally closed its case. This triggers the right to file prosecution Final Address.'}
      </p>

      <div style={{
        padding: '12px 16px', background: `${accent}08`,
        border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 22,
        fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
      }}>
        <strong style={{ color: accent }}>ACJA 2015 — Close of Case</strong>
        {' '}— After the last defence witness is closed, counsel should formally inform the court
        that the defence case is closed. The court will then fix dates for filing of Final Written
        Addresses by both sides. Failure to file addresses within the period fixed may result in
        proceedings on addresses without your submissions.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelS}>Date of Close</label>
          <input type="date" style={iS} value={closeDate} onChange={e => setCloseDate(e.target.value)} />
        </div>
        <div>
          <label style={labelS}>Court Record / Adjournment</label>
          <input
            style={iS}
            value={closeNotes}
            onChange={e => setCloseNotes(e.target.value)}
            placeholder="e.g. Defence closed 12 May 2025. Court directs written addresses within 30 days. Adjourn to [date] for adoption."
          />
        </div>
      </div>

      <label style={labelS}>Additional Notes</label>
      <textarea
        style={{ ...taS, minHeight: 80, marginBottom: 16 }}
        value={closeNotes}
        onChange={e => setCloseNotes(e.target.value)}
        placeholder="Any additional notes on the close of the defence case, orders made, address schedule..."
      />

      <button
        onClick={() => setClosed(!closed)}
        style={{
          background: closed ? `${accent}12` : 'transparent',
          border: `2px solid ${closed ? accent : '#cccccc'}`,
          color: closed ? accent : T.mute,
          borderRadius: 7, padding: '12px 24px',
          fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
          cursor: 'pointer', fontWeight: 700, letterSpacing: '.04em',
        }}
      >
        {closed ? '✓ DEFENCE CASE CLOSED — Final Address stage activated' : 'Mark Defence Case as Closed'}
      </button>

      {closed && (
        <div style={{ marginTop: 16, padding: '14px 18px', background: '#0d1800', border: '1px solid #285000', borderRadius: 6 }}>
          <p style={{ fontSize: 13, color: '#50c050', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
            ✓ Defence case closed. Navigate to <strong>Final Address Engine</strong> to draft {isDefence ? 'the defence' : 'prosecution'} written address.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

const emptyProsCross = (idx: number): ProsWitnessCross => ({
  id:         `cross_${Date.now()}_${idx}`,
  name:       '',
  role:       '',
  weaknesses: '',
  crossDraft: '',
});

function CrossTrackerTab({ witnesses, setWitnesses, accent, activeCase, fullContext }: {
  witnesses: ProsWitnessCross[];
  setWitnesses: (fn: (p: ProsWitnessCross[]) => ProsWitnessCross[]) => void;
  accent: string;
  activeCase: Case;
  fullContext: string;
}) {
  const { call, loading, error } = useAI(activeCase);
  const [selectedId, setSelectedId] = useState<string>(witnesses[0]?.id ?? '');

  const add    = () => setWitnesses(p => [...p, emptyProsCross(p.length)]);
  const remove = (id: string) => setWitnesses(p => p.filter(w => w.id !== id));
  const update = (id: string, field: keyof ProsWitnessCross, value: string) =>
    setWitnesses(p => p.map(w => w.id === id ? { ...w, [field]: value } : w));

  const selected = witnesses.find(w => w.id === selectedId);

  const draftCross = useCallback(async () => {
    if (!selected?.name) return;
    const r = await call({
      system: `You are a Nigerian prosecution counsel preparing cross-examination questions for a defence witness. Your goal is to challenge the witness's credibility, expose inconsistencies with prosecution evidence, and undermine the defence narrative. Apply Evidence Act 2011 on leading questions in cross-examination.` + fullContext,
      userMsg: `Draft cross-examination questions for defence witness ${selected.name} in: ${activeCase.caseName} at ${activeCase.court}.

Witness role: ${selected.role || 'Defence Witness'}
Known weaknesses / areas to exploit: ${selected.weaknesses || 'not specified — generate from context'}

Case context: ${activeCase.intelligence_data?.intPkg ? activeCase.intelligence_data.intPkg.slice(0, 600) : 'Not available'}

Draft prosecution cross-examination in this structure:

1. **Credibility Attack** — questions on the witness's relationship to the accused, interest in the case outcome, prior inconsistency
2. **Contradiction with Prosecution Evidence** — specific questions forcing the witness to confirm or deny facts established by prosecution witnesses
3. **Inconsistency Exposure** — where the witness's account conflicts with documents or other defence witnesses, expose those conflicts
4. **Motive / Bias** — questions establishing the witness has reason to favour the accused
5. **Closing Questions** — questions that commit the witness to concessions helpful to the prosecution

Use leading questions (permitted in cross-examination). Each question should have a purpose noted in brackets.`,
    });
    if (r) setWitnesses(p => p.map(w => w.id === selectedId ? { ...w, crossDraft: r } : w));
  }, [selected, selectedId, activeCase, call, setWitnesses]);

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Cross-Examination Tracker</h3>
        <p style={dimS}>
          Register each defence witness and generate targeted cross-examination questions.
          Leading questions are permitted in cross-examination (Evidence Act 2011, s.221).
        </p>

        {witnesses.map((w, idx) => (
          <div key={w.id} style={{
            background: '#ffffff', border: `1px solid ${accent}28`,
            borderRadius: 7, padding: '16px 18px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: accent, fontFamily: "'Times New Roman', Times, serif", minWidth: 36 }}>
                DW{idx + 1}
              </div>
              <input
                style={{ ...iS, flex: 1, minWidth: 160 }}
                value={w.name}
                onChange={e => update(w.id, 'name', e.target.value)}
                placeholder="Witness name"
              />
              <input
                style={{ ...iS, flex: 1, minWidth: 160 }}
                value={w.role}
                onChange={e => update(w.id, 'role', e.target.value)}
                placeholder="Role (e.g. Accused, Alibi Witness)"
              />
              {witnesses.length > 1 && (
                <button
                  onClick={() => remove(w.id)}
                  style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: "'Times New Roman', Times, serif" }}
                >
                  remove
                </button>
              )}
            </div>
            <label style={labelS}>Weaknesses / Areas to Exploit</label>
            <textarea
              style={{ ...taS, minHeight: 80 }}
              value={w.weaknesses}
              onChange={e => update(w.id, 'weaknesses', e.target.value)}
              placeholder="Known inconsistencies, motive to lie, contradictions with prosecution evidence, prior statements..."
            />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            onClick={add}
            style={{
              background: 'transparent', border: `1px dashed ${accent}50`,
              color: accent, borderRadius: 6, padding: '9px 20px',
              fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}
          >
            + Add Defence Witness
          </button>
        </div>

        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 18 }}>
          <label style={labelS}>Generate Cross for Witness</label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{ ...iS, marginBottom: 14, cursor: 'pointer', appearance: 'none' }}
          >
            {witnesses.map((w, idx) => (
              <option key={w.id} value={w.id}>
                DW{idx + 1} — {w.name || '(unnamed)'}
              </option>
            ))}
          </select>
          <Btn
            onClick={draftCross}
            loading={loading}
            disabled={!selected?.name}
            label={`Draft Cross-Examination — ${selected?.name ?? 'Select Witness'}`}
            accent={accent}
          />
          {error && <ErrorBlock message={error} />}
          {selected?.crossDraft && (
            <ResultBlock
              title={`Cross-Examination — ${selected.name}`}
              content={selected.crossDraft}
              onClear={() => setWitnesses(p => p.map(w => w.id === selectedId ? { ...w, crossDraft: '' } : w))}
              accent={accent}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const emptyExhibit = (idx: number): DefenceExhibit => ({
  id:          `dex_${Date.now()}_${idx}`,
  label:       `DEx${idx + 1}`,
  description: '',
  tenderedBy:  '',
  admissible:  'Pending',
  objection:   '',
});

const ADMIT_COLORS: Record<DefenceExhibit['admissible'], { bg: string; col: string }> = {
  'Pending':  { bg: '#101018', col: '#505080' },
  'Admitted': { bg: '#071810', col: '#40b068' },
  'Objected': { bg: '#181000', col: '#b08030' },
  'Rejected': { bg: '#180808', col: '#c05050' },
};

function EvidenceMonitorTab({ exhibits, setExhibits, accent }: {
  exhibits: DefenceExhibit[];
  setExhibits: (fn: (p: DefenceExhibit[]) => DefenceExhibit[]) => void;
  accent: string;
}) {
  const add    = () => setExhibits(p => [...p, emptyExhibit(p.length)]);
  const remove = (id: string) => setExhibits(p => p.filter(e => e.id !== id));
  const update = (id: string, field: keyof DefenceExhibit, value: string) =>
    setExhibits(p => p.map(e => e.id === id ? { ...e, [field]: value } : e));

  const admitted  = exhibits.filter(e => e.admissible === 'Admitted').length;
  const rejected  = exhibits.filter(e => e.admissible === 'Rejected').length;
  const objected  = exhibits.filter(e => e.admissible === 'Objected').length;

  return (
    <div>
      {exhibits.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {admitted > 0 && (
            <span style={{ fontSize: 11, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
              ✓ Admitted: {admitted}
            </span>
          )}
          {objected > 0 && (
            <span style={{ fontSize: 11, color: '#b08030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
              ⚠ Objected: {objected}
            </span>
          )}
          {rejected > 0 && (
            <span style={{ fontSize: 11, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
              ✗ Rejected: {rejected}
            </span>
          )}
        </div>
      )}

      <div style={cardS}>
        <h3 style={hS}>Defence Evidence Monitor</h3>
        <p style={dimS}>
          Log each exhibit tendered by the defence. Track admissibility, flag any objections,
          and record the court's ruling on contested items. Use to monitor whether defence
          exhibits are building the record correctly.
        </p>

        {exhibits.map((e) => {
          const col = ADMIT_COLORS[e.admissible];
          return (
            <div key={e.id} style={{
              background: col.bg, border: `1px solid ${col.col}30`,
              borderRadius: 7, padding: '16px 18px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  style={{ ...iS, width: 80, flex: '0 0 80px', fontSize: 13, fontWeight: 700 }}
                  value={e.label}
                  onChange={ev => update(e.id, 'label', ev.target.value)}
                  placeholder="DEx1"
                />
                <input
                  style={{ ...iS, flex: 1, minWidth: 200 }}
                  value={e.description}
                  onChange={ev => update(e.id, 'description', ev.target.value)}
                  placeholder="Exhibit description (e.g. Photograph of accident scene)"
                />
                <input
                  style={{ ...iS, flex: 1, minWidth: 140 }}
                  value={e.tenderedBy}
                  onChange={ev => update(e.id, 'tenderedBy', ev.target.value)}
                  placeholder="Tendered by (DW1 name)"
                />
                <select
                  value={e.admissible}
                  onChange={ev => update(e.id, 'admissible', ev.target.value as DefenceExhibit['admissible'])}
                  style={{ ...iS, width: 'auto', minWidth: 120, fontSize: 12, cursor: 'pointer', appearance: 'none', background: col.bg, color: col.col }}
                >
                  {(['Pending', 'Admitted', 'Objected', 'Rejected'] as const).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                {exhibits.length > 1 && (
                  <button
                    onClick={() => remove(e.id)}
                    style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: "'Times New Roman', Times, serif" }}
                  >
                    remove
                  </button>
                )}
              </div>
              {(e.admissible === 'Objected' || e.admissible === 'Rejected') && (
                <>
                  <label style={labelS}>Objection / Rejection Reason</label>
                  <textarea
                    style={{ ...taS, minHeight: 60 }}
                    value={e.objection}
                    onChange={ev => update(e.id, 'objection', ev.target.value)}
                    placeholder="State the prosecution's objection ground and the court's ruling..."
                  />
                </>
              )}
            </div>
          );
        })}

        <button
          onClick={add}
          style={{
            background: 'transparent', border: `1px dashed ${accent}50`,
            color: accent, borderRadius: 6, padding: '9px 20px',
            fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
          }}
        >
          + Add Defence Exhibit
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'defence_case';

export function DefenceCaseEngine({ activeCase }: Props) {
  const role      = activeCase.counsel_role ?? 'defence';
  const isPros    = role === 'prosecution';
  const isDefence = !isPros;
  const accent    = COUNSEL_ROLE_COLORS[role]?.col ?? '#40a860';
  const { fullContext } = useIntelligence(activeCase);

  const defSubTabs: { id: DefSubTab; label: string }[] = [
    { id: 'election',     label: '1 — Election' },
    { id: 'witnesses',    label: '2 — Defence Witnesses' },
    { id: 'exam_in_chief', label: '3 — Examination-in-Chief' },
    { id: 'close_def',   label: '4 — Close of Defence' },
  ];
  const prosSubTabs: { id: ProsSubTab; label: string }[] = [
    { id: 'cross_tracker',   label: '1 — Cross-Examination Tracker' },
    { id: 'evidence_monitor', label: '2 — Defence Evidence Monitor' },
    { id: 'close_pros',      label: '3 — Close of Defence' },
  ];

  const [subTab, setSubTab] = useState<SubTab>(isDefence ? 'election' : 'cross_tracker');

  // Defence state
  const [election,      setElection]      = useState<ElectionDecision>('');
  const [electionDate,  setElectionDate]  = useState('');
  const [electionNotes, setElectionNotes] = useState('');
  const [witnesses,     setWitnesses]     = useState<DefenceWitness[]>([emptyWitness(0)]);
  const [closeDefNotes, setCloseDefNotes] = useState('');
  const [closeDefDate,  setCloseDefDate]  = useState('');
  const [defClosed,     setDefClosed]     = useState(false);

  // Prosecution state
  const [prosWitnesses,  setProsWitnesses]  = useState<ProsWitnessCross[]>([emptyProsCross(0)]);
  const [defExhibits,    setDefExhibits]    = useState<DefenceExhibit[]>([emptyExhibit(0)]);
  const [closeProsNotes, setCloseProsNotes] = useState('');
  const [closeProsDate,  setCloseProsDate]  = useState('');
  const [prosClosed,     setProsClosed]     = useState(false);

  // Load
  useEffect(() => {
    loadBlindSpot(activeCase.id, STORAGE_KEY, null).then((d: SavedData | null) => {
      if (!d) return;
      if (d.election)                setElection(d.election);
      if (d.electionDate)            setElectionDate(d.electionDate);
      if (d.electionNotes)           setElectionNotes(d.electionNotes);
      if (d.witnesses?.length)       setWitnesses(d.witnesses);
      if (d.closeDefNotes)           setCloseDefNotes(d.closeDefNotes);
      if (d.closeDefDate)            setCloseDefDate(d.closeDefDate);
      if (d.defClosed !== undefined) setDefClosed(d.defClosed);
      if (d.prosWitnesses?.length)   setProsWitnesses(d.prosWitnesses);
      if (d.defExhibits?.length)     setDefExhibits(d.defExhibits);
      if (d.closeProsNotes)          setCloseProsNotes(d.closeProsNotes);
      if (d.closeProsDate)           setCloseProsDate(d.closeProsDate);
      if (d.prosClosed !== undefined) setProsClosed(d.prosClosed);
    }).catch(() => {});
  }, [activeCase.id]);

  // Persist
  const persist = useCallback(() => {
    const data: SavedData = {
      election, electionDate, electionNotes, witnesses, closeDefNotes, closeDefDate, defClosed,
      prosWitnesses, defExhibits, closeProsNotes, closeProsDate, prosClosed,
    };
    saveBlindSpot(activeCase.id, STORAGE_KEY, data).catch(() => {});
  }, [
    election, electionDate, electionNotes, witnesses, closeDefNotes, closeDefDate, defClosed,
    prosWitnesses, defExhibits, closeProsNotes, closeProsDate, prosClosed, activeCase.id,
  ]);

  useEffect(() => { persist(); }, [persist]);

  const closed = isDefence ? defClosed : prosClosed;

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, color: accent, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700,
            background: `${accent}14`, border: `1px solid ${accent}30`,
            padding: '3px 9px', borderRadius: 3,
          }}>
            Criminal · {isDefence ? 'Defence' : 'Prosecution'}
          </span>
          <span style={{
            fontSize: 9, color: '#888', fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.1em', textTransform: 'uppercase',
          }}>
            Phase A
          </span>
          {closed && (
            <span style={{
              fontSize: 9, color: '#50c050', fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: '#0d1800', border: '1px solid #285000',
              padding: '3px 9px', borderRadius: 3,
            }}>
              ✓ DEFENCE CASE CLOSED
            </span>
          )}
          {isDefence && election && (
            <span style={{
              fontSize: 9, color: election === 'call_witnesses' ? '#40a860' : '#b08030',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: election === 'call_witnesses' ? '#0d1800' : '#180f00',
              border: `1px solid ${election === 'call_witnesses' ? '#285000' : '#3a2800'}`,
              padding: '3px 9px', borderRadius: 3,
            }}>
              {election === 'call_witnesses' ? '↑ CALLING WITNESSES' : '⏸ RESTING ON PROSECUTION'}
            </span>
          )}
        </div>
        <h2 style={{
          fontSize: 26, color: '#14141e', fontWeight: 300,
          fontFamily: "'Times New Roman', Times, serif", marginBottom: 6,
        }}>
          Defence Case — {isDefence ? 'Defence' : 'Prosecution'}
        </h2>
        <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {isDefence
            ? 'Record the defence election, register defence witnesses, draft examination-in-chief questions, and formally close the defence case to activate Final Address.'
            : 'Track defence witnesses for cross-examination, monitor defence exhibits for admissibility, and record the close of the defence case.'}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={isDefence ? defSubTabs : prosSubTabs}
        active={subTab}
        onSelect={id => setSubTab(id as SubTab)}
        accent={accent}
      />

      {/* Defence sub-tabs */}
      {isDefence && subTab === 'election' && (
        <ElectionTab
          election={election} setElection={setElection}
          electionDate={electionDate} setElectionDate={setElectionDate}
          electionNotes={electionNotes} setElectionNotes={setElectionNotes}
          accent={accent}
        />
      )}
      {isDefence && subTab === 'witnesses' && (
        <WitnessesTab
          witnesses={witnesses} setWitnesses={setWitnesses}
          accent={accent}
        />
      )}
      {isDefence && subTab === 'exam_in_chief' && (
        <div style={{
          padding: '32px 24px',
          textAlign: 'center',
          border: '1px dashed #cccccc',
          borderRadius: 6,
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          <p style={{ fontSize: 15, color: '#333333', fontWeight: 700, marginBottom: 8 }}>
            Examination-in-Chief has moved to the Trial Engine tab.
          </p>
          <p style={{ fontSize: 13, color: '#777777', margin: 0 }}>
            Open the <strong>⚔ Trial Engine</strong> tab and select
            <strong> Examination-in-Chief</strong>. The three-sided Witness
            Preparation Bundle (counsel script · witness study pack ·
            anticipated cross prep) is available there. All witness records
            added here carry forward.
          </p>
        </div>
      )}
      {isDefence && subTab === 'close_def' && (
        <CloseOfDefenceTab
          closeNotes={closeDefNotes} setCloseNotes={setCloseDefNotes}
          closeDate={closeDefDate} setCloseDate={setCloseDefDate}
          closed={defClosed} setClosed={setDefClosed}
          accent={accent} isDefence={true}
        />
      )}

      {/* Prosecution sub-tabs */}
      {isPros && subTab === 'cross_tracker' && (
        <CrossTrackerTab
          witnesses={prosWitnesses} setWitnesses={setProsWitnesses}
          accent={accent} activeCase={activeCase} fullContext={fullContext}
        />
      )}
      {isPros && subTab === 'evidence_monitor' && (
        <EvidenceMonitorTab
          exhibits={defExhibits} setExhibits={setDefExhibits}
          accent={accent}
        />
      )}
      {isPros && subTab === 'close_pros' && (
        <CloseOfDefenceTab
          closeNotes={closeProsNotes} setCloseNotes={setCloseProsNotes}
          closeDate={closeProsDate} setCloseDate={setCloseProsDate}
          closed={prosClosed} setClosed={setProsClosed}
          accent={accent} isDefence={false}
        />
      )}
    </div>
  );
}
