/**
 * AFS Legal OS V2 — Prosecution Case Engine (Phase 6B)
 *
 * Dual-role criminal engine: the core trial stage.
 *
 * PROSECUTION sub-tabs:
 *   1. Opening Address    — draft and record the prosecution's opening address
 *   2. Witness Schedule   — manage prosecution witnesses (PW1, PW2…), examination status
 *   3. Exhibit Register   — link each exhibit to the count it proves; track admission status
 *   4. Evidence Sufficiency — AI count-by-count analysis of evidence adequacy
 *
 * DEFENCE sub-tabs:
 *   1. Witness Tracker    — each prosecution witness with cross-examination notes
 *   2. No-Case Threshold  — running per-count assessment; flags when threshold is met
 *   3. Objection Log      — track evidence objections raised and their outcomes
 *   4. Cross-Exam Prep    — AI-assisted cross-examination strategy per witness
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

type ProsSubTab = 'opening_address' | 'witness_schedule' | 'exhibit_register' | 'evidence_sufficiency';
type DefSubTab  = 'witness_tracker' | 'no_case_threshold' | 'objection_log' | 'cross_prep';
type SubTab     = ProsSubTab | DefSubTab;

type WitnessStatus = 'Scheduled' | 'Examined' | 'Cross-Examined' | 'Re-Examined' | 'Concluded';
type ExhibitStatus = 'Pending Tender' | 'Tendered' | 'Admitted' | 'Rejected' | 'Objected';
type NoCaseRating  = 'STRONG' | 'ARGUABLE' | 'INSUFFICIENT' | 'NOT YET ASSESSED';

interface ProsWitness {
  id:          number;
  ref:         string;   // e.g. PW1
  name:        string;
  summary:     string;
  countsLinkd: string;   // which counts this witness proves
  status:      WitnessStatus;
  notes:       string;
}

interface Exhibit {
  id:          number;
  ref:         string;   // e.g. Exhibit A
  description: string;
  countLinked: string;
  tenderedBy:  string;
  status:      ExhibitStatus;
  notes:       string;
}

interface DefWitnessTrack {
  id:          number;
  ref:         string;   // e.g. PW1
  name:        string;
  summary:     string;
  crossPoints: string;
  inconsistencies: string;
  noCaseContrib:   string;   // contribution to no-case on which counts
  status:      WitnessStatus;
}

interface Objection {
  id:      number;
  hearing: string;
  item:    string;   // exhibit or testimony described
  ground:  string;
  outcome: string;
  notes:   string;
}

type NoCaseStatus = 'NOT_MET' | 'ARGUABLE' | 'STRONG' | 'MET';

interface CountNoCaseStatus {
  id:          number;
  count:       string;
  offence:     string;
  elements:    string;
  prosEvidence: string;
  rating:      NoCaseStatus;
  grounds:     string;
}

interface SavedData {
  // Prosecution
  openingDraft?:        string;
  openingDate?:         string;
  openingNotes?:        string;
  prosWitnesses?:       ProsWitness[];
  exhibits?:            Exhibit[];
  prosecutionClosed?:   boolean;
  sufficiencyResult?:   string;
  // Defence
  defWitnesses?:        DefWitnessTrack[];
  countNoCaseStatuses?: CountNoCaseStatus[];
  noCaseOverall?:       string;
  objections?:          Objection[];
  crossPrepWitness?:    string;
  crossPrepResult?:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#070710', border: '1px solid #1a1a28',
  borderRadius: 5, color: '#e0dcd0', padding: '11px 14px', fontSize: 15,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.82, minHeight: 110 };
const labelS: React.CSSProperties = {
  fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif',
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 6,
};
const cardS: React.CSSProperties = {
  background: '#080810', border: '1px solid #14141e',
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
        <span style={{ fontSize: 10, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </span>
        <button onClick={onClear} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
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
              border:        `1px solid ${isActive ? `${accent}50` : '#1e1e2e'}`,
              color:         isActive ? accent : T.mute,
              borderRadius:  5,
              padding:       '7px 16px',
              fontSize:      11,
              fontFamily:    'Inter, sans-serif',
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

function StatusBadge({ value, options, onChange, accent }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  accent: string;
}) {
  const statusColors: Record<string, string> = {
    'Scheduled':       '#505080',
    'Examined':        '#406080',
    'Cross-Examined':  '#408060',
    'Re-Examined':     '#605040',
    'Concluded':       '#304820',
    'Pending Tender':  '#505080',
    'Tendered':        '#406080',
    'Admitted':        '#304820',
    'Rejected':        '#601818',
    'Objected':        '#603018',
  };
  const col = statusColors[value] ?? '#303040';
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        ...iS,
        background: col,
        border: `1px solid ${col}aa`,
        fontSize: 12,
        padding: '6px 10px',
        cursor: 'pointer',
        appearance: 'none',
        width: 'auto',
        minWidth: 160,
      }}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

function OpeningAddressTab({
  draft, setDraft, date, setDate, notes, setNotes, accent, activeCase,
}: {
  draft: string; setDraft: (v: string) => void;
  date: string;  setDate:  (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  accent: string; activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const generate = useCallback(async () => {
    const r = await call({
      system: `You are a Nigerian prosecution counsel drafting an opening address for a criminal trial. Apply ACJA 2015 and Evidence Act 2011. The opening address introduces the prosecution's case to the court.`,
      userMsg: `Draft a prosecution opening address for the matter: ${activeCase.caseName} — ${activeCase.court}.

Additional context / charges:
${notes || '[No additional context provided — draft a general structure]'}

The opening address must:\n1. Introduce the prosecution and the nature of the charges\n2. Briefly outline the facts the prosecution will prove\n3. Identify the key witnesses and what each will prove\n4. Identify the key exhibits and their significance\n5. State the law applicable to each count\n6. Conclude by stating what verdict the prosecution invites the court to return\n\nStyle: formal Nigerian criminal court address. Do not make submissions of law at this stage — this is a preview of evidence. Avoid overstating the case; present it factually.`,
    });
    if (r) setDraft(r);
  }, [notes, activeCase, call, setDraft]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Opening Address</h3>
      <p style={dimS}>
        Record the date the prosecution opened its case and draft or paste the opening
        address. The opening address is the prosecution's formal introduction of its case
        to the court — delivered after the accused pleads Not Guilty.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div>
          <label style={labelS}>Date of Opening</label>
          <input
            style={iS}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <div />
        <div style={{ gridColumn: '1/-1' }}>
          <label style={labelS}>Charges / Case Summary (for AI drafting)</label>
          <textarea
            style={{ ...taS, minHeight: 100 }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Summarise the charges: counts, offences, sections, key facts, key witnesses, key exhibits. The more detail here, the better the AI draft."
          />
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Btn
          onClick={generate}
          loading={loading}
          label="Draft Opening Address"
          accent={accent}
        />
      </div>

      {error && <ErrorBlock message={error} />}

      <label style={labelS}>Opening Address (draft / edit / paste)</label>
      <textarea
        style={{ ...taS, minHeight: 300 }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Opening address will appear here after AI drafting, or paste / type directly..."
      />
    </div>
  );
}

const WITNESS_STATUSES: WitnessStatus[] = ['Scheduled', 'Examined', 'Cross-Examined', 'Re-Examined', 'Concluded'];

const emptyProsWitness = (idx: number): ProsWitness => ({
  id: Date.now() + idx,
  ref: `PW${idx + 1}`,
  name: '',
  summary: '',
  countsLinkd: '',
  status: 'Scheduled',
  notes: '',
});

function WitnessScheduleTab({
  witnesses, setWitnesses, closed, setClosed, accent, activeCase,
}: {
  witnesses: ProsWitness[];
  setWitnesses: (fn: (p: ProsWitness[]) => ProsWitness[]) => void;
  closed: boolean;
  setClosed: (v: boolean) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [scheduleAdvice, setScheduleAdvice] = useState('');

  const add    = () => setWitnesses(p => [...p, emptyProsWitness(p.length)]);
  const remove = (id: number) => setWitnesses(p => p.filter(w => w.id !== id));
  const update = (id: number, field: keyof ProsWitness, value: string | WitnessStatus) =>
    setWitnesses(p => p.map(w => w.id === id ? { ...w, [field]: value } : w));

  const concluded    = witnesses.filter(w => w.status === 'Concluded').length;
  const remaining    = witnesses.filter(w => w.status !== 'Concluded').length;

  const advise = useCallback(async () => {
    if (!witnesses.length) return;
    const witnessSummary = witnesses.map((w, i) =>
      `${w.ref} — ${w.name || '[Name not entered]'}: ${w.summary || '[No summary]'}. Counts: ${w.countsLinkd || 'unspecified'}. Status: ${w.status}. Notes: ${w.notes || 'none'}`
    ).join('\n\n');

    const r = await call({
      system: `You are a Nigerian prosecution counsel. Apply ACJA 2015 and Evidence Act 2011.`,
      userMsg: `Witness schedule advice for ${activeCase.caseName}:\n\n${witnessSummary}\n\nCase closed: ${closed ? 'YES' : 'NO'}\n\nAdvise prosecution:\n1. **Witness Order** — is the current order optimal? Should any witnesses be reordered for maximum impact?\n2. **Evidence Gaps** — are there counts without a witness to prove each essential ingredient?\n3. **Overlap / Redundancy** — are any witnesses duplicating evidence? Can any be consolidated?\n4. **ACJA Compliance** — have all witnesses in the proof of evidence been called or accounted for?\n5. **Vulnerable Witnesses** — any witness likely to face aggressive cross-examination? How to protect?\n6. **Close of Case Assessment** — if prosecution is ready to close, what must be confirmed before closing?\n7. **Next Prosecution Action** — based on current status, what should prosecution do next?`,
    });
    if (r) setScheduleAdvice(r);
  }, [witnesses, closed, activeCase, call]);

  return (
    <div>
      <div style={cardS}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <h3 style={hS}>Witness Schedule</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {concluded > 0 && (
              <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#0d1a0d', border: '1px solid #1a4a1a', color: '#50c050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
                ✓ {concluded} concluded
              </span>
            )}
            {remaining > 0 && (
              <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#1a1400', border: '1px solid #3a2800', color: '#b08030', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
                ⏳ {remaining} remaining
              </span>
            )}
          </div>
        </div>
        <p style={dimS}>
          Track every prosecution witness — scheduled order, examination status, and links
          to counts. Mark witnesses as Concluded to track close-of-prosecution readiness.
        </p>

        {witnesses.map((w, idx) => (
          <div key={w.id} style={{
            background: '#0a0a14', border: `1px solid ${accent}22`,
            borderRadius: 7, padding: '16px 18px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                style={{ ...iS, width: 70, flex: '0 0 70px', fontWeight: 700, fontSize: 13 }}
                value={w.ref}
                onChange={e => update(w.id, 'ref', e.target.value)}
                placeholder="PW1"
              />
              <input
                style={{ ...iS, flex: 1, minWidth: 140, fontSize: 13 }}
                value={w.name}
                onChange={e => update(w.id, 'name', e.target.value)}
                placeholder="Witness name"
              />
              <StatusBadge
                value={w.status}
                options={WITNESS_STATUSES}
                onChange={v => update(w.id, 'status', v as WitnessStatus)}
                accent={accent}
              />
              {witnesses.length > 1 && (
                <button
                  onClick={() => remove(w.id)}
                  style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
                >
                  remove
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelS}>Evidence Summary</label>
                <textarea
                  style={{ ...taS, minHeight: 80 }}
                  value={w.summary}
                  onChange={e => update(w.id, 'summary', e.target.value)}
                  placeholder="What this witness will prove — their statement summary"
                />
              </div>
              <div>
                <label style={labelS}>Counts Linked</label>
                <input
                  style={iS}
                  value={w.countsLinkd}
                  onChange={e => update(w.id, 'countsLinkd', e.target.value)}
                  placeholder="e.g. Count 1, Count 3"
                />
                <label style={{ ...labelS, marginTop: 12 }}>Notes</label>
                <textarea
                  style={{ ...taS, minHeight: 50 }}
                  value={w.notes}
                  onChange={e => update(w.id, 'notes', e.target.value)}
                  placeholder="Cross-exam observations, exhibits to tender, adjournments..."
                />
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
          <button
            onClick={add}
            style={{
              background: 'transparent', border: `1px dashed ${accent}50`,
              color: accent, borderRadius: 6, padding: '9px 20px',
              fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              letterSpacing: '.06em',
            }}
          >
            + Add witness
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={closed}
              onChange={e => setClosed(e.target.checked)}
              style={{ accentColor: accent, width: 15, height: 15 }}
            />
            <span style={{ fontSize: 12, color: T.sub, fontFamily: 'Inter, sans-serif' }}>
              Close of prosecution case filed
            </span>
          </label>
        </div>

        <Btn onClick={advise} loading={loading} disabled={!witnesses.length} label="Get Witness Schedule Advice" accent={accent} />
        {error && <ErrorBlock message={error} />}
        {scheduleAdvice && (
          <ResultBlock title="Witness Schedule Analysis" content={scheduleAdvice} onClear={() => setScheduleAdvice('')} accent={accent} />
        )}
      </div>
    </div>
  );
}

const EXHIBIT_STATUSES: ExhibitStatus[] = ['Pending Tender', 'Tendered', 'Admitted', 'Rejected', 'Objected'];

const emptyExhibit = (idx: number): Exhibit => ({
  id: Date.now() + idx,
  ref: `Exhibit ${String.fromCharCode(65 + idx)}`,
  description: '',
  countLinked: '',
  tenderedBy: '',
  status: 'Pending Tender',
  notes: '',
});

function ExhibitRegisterTab({
  exhibits, setExhibits, accent, activeCase,
}: {
  exhibits: Exhibit[];
  setExhibits: (fn: (p: Exhibit[]) => Exhibit[]) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [admissibilityResult, setAdmissibilityResult] = useState('');
  const [targetExhibitId, setTargetExhibitId] = useState<number | null>(null);

  const add    = () => setExhibits(p => [...p, emptyExhibit(p.length)]);
  const remove = (id: number) => setExhibits(p => p.filter(e => e.id !== id));
  const update = (id: number, field: keyof Exhibit, value: string | ExhibitStatus) =>
    setExhibits(p => p.map(e => e.id === id ? { ...e, [field]: value } : e));

  const admitted  = exhibits.filter(e => e.status === 'Admitted').length;
  const pending   = exhibits.filter(e => e.status === 'Pending Tender').length;
  const rejected  = exhibits.filter(e => e.status === 'Rejected' || e.status === 'Objected').length;

  const checkAdmissibility = useCallback(async (ex: Exhibit) => {
    setTargetExhibitId(ex.id);
    const r = await call({
      system: `You are a Nigerian prosecution counsel. Apply the Evidence Act 2011 to assess the admissibility of exhibits.`,
      userMsg: `Admissibility check for ${ex.ref} in ${activeCase.caseName}:\n\nDescription: ${ex.description}\nCount linked: ${ex.countLinked}\nTendered by: ${ex.tenderedBy || 'prosecution'}\nNotes: ${ex.notes || 'none'}\n\nAnalyse admissibility:\n1. **Document type** — what category of evidence is this?\n2. **Primary rule** — which Evidence Act provision governs admission?\n3. **Authentication requirements** — how must this document be authenticated?\n4. **Best evidence** — is this the original or a copy? If a copy, is secondary evidence admissible?\n5. **Hearsay issues** — does this document contain hearsay? Is any exception applicable?\n6. **Confessional statement specific issues** (if applicable) — was the statement made voluntarily? Was ACJA s.15 caution administered?\n7. **Likely defence objection** — what objection is defence likely to raise?\n8. **Prosecution response** — how should prosecution respond to that objection?\n9. **Verdict** — ADMISSIBLE / LIKELY ADMISSIBLE / DISPUTED / INADMISSIBLE`,
    });
    if (r) {
      setAdmissibilityResult(r);
      setTargetExhibitId(null);
    }
  }, [activeCase, call]);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <h3 style={hS}>Exhibit Register</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {admitted > 0 && (
            <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#0d1a0d', border: '1px solid #1a4a1a', color: '#50c050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
              ✓ {admitted} admitted
            </span>
          )}
          {pending > 0 && (
            <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#1a1400', border: '1px solid #3a2800', color: '#b08030', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
              ⏳ {pending} pending
            </span>
          )}
          {rejected > 0 && (
            <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#1a0808', border: '1px solid #4a1818', color: '#c05050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
              ✗ {rejected} rejected/objected
            </span>
          )}
        </div>
      </div>
      <p style={dimS}>
        Track every exhibit — description, the count it proves, tender status, and
        admissibility. Flag exhibits at risk of exclusion before tendering.
      </p>

      {exhibits.map(ex => (
        <div key={ex.id} style={{
          background: '#0a0a14', border: `1px solid ${accent}22`,
          borderRadius: 7, padding: '16px 18px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              style={{ ...iS, width: 110, flex: '0 0 110px', fontSize: 13, fontWeight: 700 }}
              value={ex.ref}
              onChange={e => update(ex.id, 'ref', e.target.value)}
              placeholder="Exhibit A"
            />
            <StatusBadge
              value={ex.status}
              options={EXHIBIT_STATUSES}
              onChange={v => update(ex.id, 'status', v as ExhibitStatus)}
              accent={accent}
            />
            {exhibits.length > 1 && (
              <button
                onClick={() => remove(ex.id)}
                style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
              >
                remove
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelS}>Description</label>
              <input
                style={iS}
                value={ex.description}
                onChange={e => update(ex.id, 'description', e.target.value)}
                placeholder="e.g. Written statement of accused dated 3 Jan 2024"
              />
            </div>
            <div>
              <label style={labelS}>Count Linked</label>
              <input
                style={iS}
                value={ex.countLinked}
                onChange={e => update(ex.id, 'countLinked', e.target.value)}
                placeholder="e.g. Count 1"
              />
            </div>
            <div>
              <label style={labelS}>Tendered By (Witness)</label>
              <input
                style={iS}
                value={ex.tenderedBy}
                onChange={e => update(ex.id, 'tenderedBy', e.target.value)}
                placeholder="e.g. PW2"
              />
            </div>
          </div>
          <div>
            <label style={labelS}>Notes / Objections Raised</label>
            <input
              style={iS}
              value={ex.notes}
              onChange={e => update(ex.id, 'notes', e.target.value)}
              placeholder="Defence objection, court ruling, conditions of admission..."
            />
          </div>
          <button
            onClick={() => checkAdmissibility(ex)}
            disabled={!ex.description || (loading && targetExhibitId === ex.id)}
            style={{
              marginTop: 12,
              background: 'transparent',
              border: `1px solid ${accent}40`,
              color: accent,
              borderRadius: 5,
              padding: '5px 14px',
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
              cursor: ex.description ? 'pointer' : 'not-allowed',
              letterSpacing: '.06em',
            }}
          >
            {loading && targetExhibitId === ex.id ? '⟳ Checking…' : '⚖ Check Admissibility'}
          </button>
        </div>
      ))}

      <button
        onClick={add}
        style={{
          background: 'transparent', border: `1px dashed ${accent}50`,
          color: accent, borderRadius: 6, padding: '9px 20px',
          fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
          letterSpacing: '.06em', marginBottom: 16,
        }}
      >
        + Add exhibit
      </button>

      {error && <ErrorBlock message={error} />}
      {admissibilityResult && (
        <ResultBlock
          title="Admissibility Analysis"
          content={admissibilityResult}
          onClear={() => setAdmissibilityResult('')}
          accent={accent}
        />
      )}
    </div>
  );
}

function EvidenceSufficiencyTab({
  witnesses, exhibits, accent, activeCase,
}: {
  witnesses: ProsWitness[];
  exhibits:  Exhibit[];
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [counts, setCounts] = useState('');
  const [result, setResult]  = useState('');

  const analyse = useCallback(async () => {
    const witSummary = witnesses.map(w =>
      `${w.ref} (${w.name || 'unnamed'}): ${w.summary || '[no summary]'} — Counts: ${w.countsLinkd || 'unspecified'} — Status: ${w.status}`
    ).join('\n');
    const exhSummary = exhibits.map(ex =>
      `${ex.ref}: ${ex.description || '[no description]'} — Count: ${ex.countLinked || 'unspecified'} — Status: ${ex.status}`
    ).join('\n');

    const r = await call({
      system: `You are a Nigerian prosecution counsel conducting a pre-close evidence sufficiency audit. Apply ACJA 2015 and Evidence Act 2011. Your task is to identify every gap before the prosecution closes its case.`,
      userMsg: `Evidence sufficiency check for ${activeCase.caseName} (${activeCase.court}).\n\nCharges / counts:\n${counts || '[Please describe the counts in the text box below]'}\n\nProsecution witnesses:\n${witSummary || '[No witnesses entered]'}\n\nExhibits:\n${exhSummary || '[No exhibits entered]'}\n\nFor each count, assess:\n1. **Essential Ingredients** — list every essential ingredient of the offence that prosecution must prove\n2. **Evidence Available** — which witnesses and exhibits prove each ingredient?\n3. **Gaps** — which ingredients have no evidence yet? (CRITICAL: these must be plugged before close)\n4. **Admissibility Risks** — are any tendered exhibits at risk of exclusion?\n5. **Count Verdict** — SUFFICIENTLY PROVED / ARGUABLE / INSUFFICIENT / NOT YET PROVED\n6. **Actions Before Close** — what must prosecution still do before closing its case?\n\nEnd with an overall sufficiency rating and a priority action list.`,
    });
    if (r) setResult(r);
  }, [counts, witnesses, exhibits, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Evidence Sufficiency Analysis</h3>
      <p style={dimS}>
        Count-by-count sufficiency audit. Before closing the prosecution case, this analysis
        flags every gap — ingredients not yet proved, exhibits not yet tendered, witnesses not
        yet called. Run this before closing to avoid a successful no-case submission.
      </p>

      <label style={labelS}>Charges / Counts (describe each count)</label>
      <textarea
        style={{ ...taS, minHeight: 120, marginBottom: 14 }}
        value={counts}
        onChange={e => setCounts(e.target.value)}
        placeholder="Count 1: Armed Robbery under s.1(2)(a) Robbery and Firearms Act — essential ingredients: (a) taking of property, (b) use of offensive weapon, (c) violence or threat of violence...&#10;Count 2: ..."
      />

      {(witnesses.length > 0 || exhibits.length > 0) && (
        <div style={{ padding: '10px 14px', background: `${accent}08`, border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: T.sub, fontFamily: 'Inter, sans-serif' }}>
            Using {witnesses.length} witness{witnesses.length !== 1 ? 'es' : ''} and {exhibits.length} exhibit{exhibits.length !== 1 ? 's' : ''} from your schedule and register.
          </span>
        </div>
      )}

      <Btn
        onClick={analyse}
        loading={loading}
        disabled={!counts.trim()}
        label="Run Sufficiency Analysis"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {result && (
        <ResultBlock
          title="Evidence Sufficiency Report"
          content={result}
          onClear={() => setResult('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

const emptyDefWitness = (idx: number): DefWitnessTrack => ({
  id: Date.now() + idx,
  ref: `PW${idx + 1}`,
  name: '',
  summary: '',
  crossPoints: '',
  inconsistencies: '',
  noCaseContrib: '',
  status: 'Scheduled',
});

function WitnessTrackerTab({
  witnesses, setWitnesses, accent, activeCase,
}: {
  witnesses: DefWitnessTrack[];
  setWitnesses: (fn: (p: DefWitnessTrack[]) => DefWitnessTrack[]) => void;
  accent: string;
  activeCase: Case;
}) {
  const add    = () => setWitnesses(p => [...p, emptyDefWitness(p.length)]);
  const remove = (id: number) => setWitnesses(p => p.filter(w => w.id !== id));
  const update = (id: number, field: keyof DefWitnessTrack, value: string | WitnessStatus) =>
    setWitnesses(p => p.map(w => w.id === id ? { ...w, [field]: value } : w));

  const concluded = witnesses.filter(w => w.status === 'Concluded').length;

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <h3 style={hS}>Prosecution Witness Tracker</h3>
        {concluded > 0 && (
          <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 3, background: '#0d1a0d', border: '1px solid #1a4a1a', color: '#50c050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
            {concluded} concluded
          </span>
        )}
      </div>
      <p style={dimS}>
        Track each prosecution witness — their evidence summary, cross-examination points,
        inconsistencies to exploit, and contribution to the no-case threshold on each count.
        Update status after each witness concludes.
      </p>

      {witnesses.map((w) => (
        <div key={w.id} style={{
          background: '#0a0a14', border: `1px solid ${accent}22`,
          borderRadius: 7, padding: '16px 18px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              style={{ ...iS, width: 70, flex: '0 0 70px', fontWeight: 700, fontSize: 13 }}
              value={w.ref}
              onChange={e => update(w.id, 'ref', e.target.value)}
              placeholder="PW1"
            />
            <input
              style={{ ...iS, flex: 1, minWidth: 140, fontSize: 13 }}
              value={w.name}
              onChange={e => update(w.id, 'name', e.target.value)}
              placeholder="Witness name / description"
            />
            <StatusBadge
              value={w.status}
              options={WITNESS_STATUSES}
              onChange={v => update(w.id, 'status', v as WitnessStatus)}
              accent={accent}
            />
            {witnesses.length > 1 && (
              <button
                onClick={() => remove(w.id)}
                style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
              >
                remove
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelS}>Evidence Summary</label>
              <textarea
                style={{ ...taS, minHeight: 80 }}
                value={w.summary}
                onChange={e => update(w.id, 'summary', e.target.value)}
                placeholder="What this witness said in their statement / at trial"
              />
            </div>
            <div>
              <label style={labelS}>Cross-Examination Points</label>
              <textarea
                style={{ ...taS, minHeight: 80 }}
                value={w.crossPoints}
                onChange={e => update(w.id, 'crossPoints', e.target.value)}
                placeholder="Key points for cross-examination — inconsistencies, gaps, prior statements..."
              />
            </div>
            <div>
              <label style={labelS}>Inconsistencies Identified</label>
              <textarea
                style={{ ...taS, minHeight: 70 }}
                value={w.inconsistencies}
                onChange={e => update(w.id, 'inconsistencies', e.target.value)}
                placeholder="Contradictions with other witnesses, prior statements, exhibits, police report..."
              />
            </div>
            <div>
              <label style={labelS}>No-Case Contribution (which counts)</label>
              <textarea
                style={{ ...taS, minHeight: 70 }}
                value={w.noCaseContrib}
                onChange={e => update(w.id, 'noCaseContrib', e.target.value)}
                placeholder="e.g. PW1 fails to prove ingredient (b) of Count 1 — no identification evidence given"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={add}
        style={{
          background: 'transparent', border: `1px dashed ${accent}50`,
          color: accent, borderRadius: 6, padding: '9px 20px',
          fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
          letterSpacing: '.06em',
        }}
      >
        + Add prosecution witness
      </button>
    </div>
  );
}

const NO_CASE_STATUS_COLORS: Record<NoCaseStatus, { bg: string; bdr: string; col: string }> = {
  NOT_MET:           { bg: '#0d0d18', bdr: '#202030', col: '#505080' },
  ARGUABLE:          { bg: '#181000', bdr: '#3a2800', col: '#b08030' },
  STRONG:            { bg: '#101800', bdr: '#283a00', col: '#88b030' },
  MET:               { bg: '#0d1800', bdr: '#1a4000', col: '#50c050' },
};

const NO_CASE_STATUS_LABELS: Record<NoCaseStatus, string> = {
  NOT_MET:  'Not Met',
  ARGUABLE: 'Arguable',
  STRONG:   'Strong Grounds',
  MET:      'Threshold Met ✓',
};

const emptyCountStatus = (idx: number): CountNoCaseStatus => ({
  id: Date.now() + idx,
  count: `Count ${idx + 1}`,
  offence: '',
  elements: '',
  prosEvidence: '',
  rating: 'NOT_MET',
  grounds: '',
});

function NoCaseThresholdTab({
  countStatuses, setCountStatuses, overallAssessment, setOverallAssessment, accent, activeCase,
}: {
  countStatuses:        CountNoCaseStatus[];
  setCountStatuses:     (fn: (p: CountNoCaseStatus[]) => CountNoCaseStatus[]) => void;
  overallAssessment:    string;
  setOverallAssessment: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const add    = () => setCountStatuses(p => [...p, emptyCountStatus(p.length)]);
  const remove = (id: number) => setCountStatuses(p => p.filter(c => c.id !== id));
  const update = (id: number, field: keyof CountNoCaseStatus, value: string | NoCaseStatus) =>
    setCountStatuses(p => p.map(c => c.id === id ? { ...c, [field]: value } : c));

  const metCount    = countStatuses.filter(c => c.rating === 'MET' || c.rating === 'STRONG').length;
  const totalCounts = countStatuses.length;

  const runAssessment = useCallback(async () => {
    if (!countStatuses.length) return;
    const countSummary = countStatuses.map(c =>
      `${c.count} — ${c.offence}:\nEssential elements: ${c.elements || '[not listed]'}\nProsecution evidence available: ${c.prosEvidence || '[not described]'}\nCurrent rating: ${c.rating}`
    ).join('\n\n');

    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Apply the no-case submission standard from Ajidagba v. State (1981), Ibeziako v. COP, and ACJA 2015 s.303. The test is whether there is evidence on which a reasonable court could convict — not whether the prosecution has proved its case beyond reasonable doubt.`,
      userMsg: `No-case submission threshold assessment for ${activeCase.caseName}:\n\n${countSummary}\n\nFor each count:\n1. **Essential Ingredients** — confirm or correct the list of essential ingredients prosecution must establish\n2. **Evidence Analysis** — has prosecution led prima facie evidence on each ingredient?\n3. **Critical Gaps** — which ingredients have NO evidence at all? (These are the strongest grounds)\n4. **Threshold Verdict:**\n   - MET: Prosecution has led no evidence on one or more essential ingredients — submission is clearly available\n   - STRONG: Evidence led is so manifestly unreliable or contradicted that no court should act on it\n   - ARGUABLE: Some gaps or weaknesses but court could go either way\n   - NOT MET: Sufficient prima facie case established — submission unlikely to succeed\n5. **Grounds to Include in Submission** — draft the specific grounds for this count\n\nEnd with an overall recommendation: SUBMIT NOW / WAIT FOR MORE WITNESSES / DO NOT SUBMIT ON THIS COUNT`,
    });
    if (r) setOverallAssessment(r);
  }, [countStatuses, activeCase, call]);

  return (
    <div>
      {/* Threshold meter */}
      <div style={{
        ...cardS,
        background: metCount > 0 ? '#0d1800' : '#0d0d14',
        border: `1px solid ${metCount > 0 ? '#285000' : '#141428'}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' }}>
            No-Case Threshold Meter
          </span>
          <span style={{
            fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: 700,
            color: metCount > 0 ? '#50c050' : T.mute,
          }}>
            {metCount} / {totalCounts} counts — grounds available
          </span>
        </div>
        {totalCounts > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {countStatuses.map(c => {
              const col = NO_CASE_STATUS_COLORS[c.rating];
              return (
                <span
                  key={c.id}
                  style={{
                    fontSize: 10, padding: '4px 10px', borderRadius: 4,
                    background: col.bg, border: `1px solid ${col.bdr}`, color: col.col,
                    fontFamily: 'Inter, sans-serif', fontWeight: 700,
                  }}
                >
                  {c.count}: {NO_CASE_STATUS_LABELS[c.rating]}
                </span>
              );
            })}
          </div>
        )}
        {metCount > 0 && (
          <p style={{ fontSize: 12, color: '#50c050', fontFamily: 'Inter, sans-serif', marginTop: 10, marginBottom: 0 }}>
            ⚖ No-case submission grounds exist on {metCount} count{metCount !== 1 ? 's' : ''}. Use the No-Case Submission engine to draft.
          </p>
        )}
      </div>

      <div style={cardS}>
        <h3 style={hS}>No-Case Threshold — Per Count</h3>
        <p style={dimS}>
          Track the prosecution's evidence against each count after every witness.
          Update ratings as witnesses conclude. The threshold meter above reflects
          your current assessment across all counts.
        </p>

        {countStatuses.map(c => {
          const col = NO_CASE_STATUS_COLORS[c.rating];
          return (
            <div key={c.id} style={{
              background: col.bg, border: `1px solid ${col.bdr}`,
              borderRadius: 7, padding: '16px 18px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  style={{ ...iS, width: 100, flex: '0 0 100px', fontSize: 13, fontWeight: 700 }}
                  value={c.count}
                  onChange={e => update(c.id, 'count', e.target.value)}
                  placeholder="Count 1"
                />
                <input
                  style={{ ...iS, flex: 1, fontSize: 13 }}
                  value={c.offence}
                  onChange={e => update(c.id, 'offence', e.target.value)}
                  placeholder="Offence name"
                />
                <select
                  value={c.rating}
                  onChange={e => update(c.id, 'rating', e.target.value as NoCaseStatus)}
                  style={{
                    ...iS, width: 'auto', minWidth: 160, fontSize: 12,
                    padding: '6px 10px', cursor: 'pointer', appearance: 'none',
                    background: col.bg, border: `1px solid ${col.bdr}`, color: col.col,
                  }}
                >
                  {Object.entries(NO_CASE_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                {countStatuses.length > 1 && (
                  <button
                    onClick={() => remove(c.id)}
                    style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
                  >
                    remove
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelS}>Essential Elements to Prove</label>
                  <textarea
                    style={{ ...taS, minHeight: 80 }}
                    value={c.elements}
                    onChange={e => update(c.id, 'elements', e.target.value)}
                    placeholder="e.g. (a) taking of property (b) from another person (c) with force or threat of force (d) with offensive weapon"
                  />
                </div>
                <div>
                  <label style={labelS}>Prosecution Evidence So Far</label>
                  <textarea
                    style={{ ...taS, minHeight: 80 }}
                    value={c.prosEvidence}
                    onChange={e => update(c.id, 'prosEvidence', e.target.value)}
                    placeholder="What evidence prosecution has led: which witnesses addressed which elements, which exhibits were admitted..."
                  />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={labelS}>Identified Grounds for No-Case</label>
                  <textarea
                    style={{ ...taS, minHeight: 60 }}
                    value={c.grounds}
                    onChange={e => update(c.id, 'grounds', e.target.value)}
                    placeholder="Which essential ingredient has no evidence? What is the gap?"
                  />
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
          <button
            onClick={add}
            style={{
              background: 'transparent', border: `1px dashed ${accent}50`,
              color: accent, borderRadius: 6, padding: '9px 20px',
              fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              letterSpacing: '.06em',
            }}
          >
            + Add count
          </button>

          <Btn
            onClick={runAssessment}
            loading={loading}
            disabled={!countStatuses.length || !countStatuses[0].offence}
            label="Run No-Case Assessment"
            accent={accent}
          />
        </div>

        {error && <ErrorBlock message={error} />}
        {overallAssessment && (
          <ResultBlock
            title="No-Case Submission Assessment"
            content={overallAssessment}
            onClear={() => setOverallAssessment('')}
            accent={accent}
          />
        )}
      </div>
    </div>
  );
}

const emptyObjection = (idx: number): Objection => ({
  id: Date.now() + idx,
  hearing: '',
  item: '',
  ground: '',
  outcome: '',
  notes: '',
});

function ObjectionLogTab({
  objections, setObjections, accent,
}: {
  objections: Objection[];
  setObjections: (fn: (p: Objection[]) => Objection[]) => void;
  accent: string;
}) {
  const add    = () => setObjections(p => [...p, emptyObjection(p.length)]);
  const remove = (id: number) => setObjections(p => p.filter(o => o.id !== id));
  const update = (id: number, field: keyof Objection, value: string) =>
    setObjections(p => p.map(o => o.id === id ? { ...o, [field]: value } : o));

  const sustained  = objections.filter(o => o.outcome.toLowerCase().includes('sustain')).length;
  const overruled  = objections.filter(o => o.outcome.toLowerCase().includes('overrul')).length;
  const pending    = objections.filter(o => !o.outcome).length;

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <h3 style={hS}>Evidence Objection Log</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sustained > 0 && (
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 3, background: '#0d1a0d', border: '1px solid #1a4a1a', color: '#50c050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
              ✓ {sustained} sustained
            </span>
          )}
          {overruled > 0 && (
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 3, background: '#1a0808', border: '1px solid #4a1818', color: '#c05050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
              ✗ {overruled} overruled
            </span>
          )}
          {pending > 0 && (
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 3, background: '#1a1400', border: '1px solid #3a2800', color: '#b08030', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
              ⏳ {pending} pending
            </span>
          )}
        </div>
      </div>
      <p style={dimS}>
        Record every objection raised — the item objected to, the ground, and the court's
        ruling. Sustained objections against prosecution exhibits may support the no-case threshold.
      </p>

      {objections.map((o, idx) => (
        <div key={o.id} style={{
          background: '#0a0a14', border: `1px solid ${accent}20`,
          borderRadius: 7, padding: '16px 18px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: accent, fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '.06em' }}>
              Objection {idx + 1}
            </span>
            {objections.length > 1 && (
              <button
                onClick={() => remove(o.id)}
                style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
              >
                remove
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelS}>Hearing / Date</label>
              <input style={iS} value={o.hearing} onChange={e => update(o.id, 'hearing', e.target.value)} placeholder="e.g. 3rd hearing — 15 Jan 2025" />
            </div>
            <div>
              <label style={labelS}>Item Objected To</label>
              <input style={iS} value={o.item} onChange={e => update(o.id, 'item', e.target.value)} placeholder="e.g. Exhibit C (confession), PW2's hearsay testimony" />
            </div>
            <div>
              <label style={labelS}>Ground of Objection</label>
              <textarea style={{ ...taS, minHeight: 70 }} value={o.ground} onChange={e => update(o.id, 'ground', e.target.value)} placeholder="e.g. Hearsay — s.37 Evidence Act. Involuntary confession — s.29 Evidence Act..." />
            </div>
            <div>
              <label style={labelS}>Court's Ruling / Outcome</label>
              <textarea style={{ ...taS, minHeight: 70 }} value={o.outcome} onChange={e => update(o.id, 'outcome', e.target.value)} placeholder="e.g. Sustained — exhibit excluded. Overruled — objection dismissed and exhibit admitted..." />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={labelS}>Notes / Follow-Up</label>
              <input style={iS} value={o.notes} onChange={e => update(o.id, 'notes', e.target.value)} placeholder="Impact on no-case threshold, appeal rights preserved, voir dire required..." />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={add}
        style={{
          background: 'transparent', border: `1px dashed ${accent}50`,
          color: accent, borderRadius: 6, padding: '9px 20px',
          fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
          letterSpacing: '.06em',
        }}
      >
        + Log objection
      </button>
    </div>
  );
}

function CrossPrepTab({
  defWitnesses, witnessInput, setWitnessInput, crossPrepResult, setCrossPrepResult, accent, activeCase,
}: {
  defWitnesses:      DefWitnessTrack[];
  witnessInput:      string;
  setWitnessInput:   (v: string) => void;
  crossPrepResult:   string;
  setCrossPrepResult: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [targetRef, setTargetRef] = useState('');

  const selectedWitness = defWitnesses.find(w => w.ref === targetRef);

  const generatePrep = useCallback(async () => {
    const witInfo = selectedWitness
      ? `Name: ${selectedWitness.name || selectedWitness.ref}\nEvidence summary: ${selectedWitness.summary}\nKnown inconsistencies: ${selectedWitness.inconsistencies}\nPreliminary cross points: ${selectedWitness.crossPoints}`
      : `Witness information: ${witnessInput}`;

    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Your task is to develop a detailed cross-examination strategy for a prosecution witness. Apply Evidence Act 2011 s.209–223 (cross-examination provisions) and best cross-examination practice.`,
      userMsg: `Cross-examination preparation for a prosecution witness in ${activeCase.caseName}:\n\n${witInfo}\n\nDevelop a comprehensive cross-examination strategy:\n\n1. **Objectives** — what are the primary goals of cross-examining this witness? (undermine credibility / establish no-case / create doubt / extract admissions)\n\n2. **Key Attack Areas** — identify each weakness in this witness's evidence:\n   - Internal inconsistencies within their testimony\n   - Inconsistencies with other witnesses\n   - Inconsistencies with documentary evidence or exhibits\n   - Observations / perceptions (distance, lighting, time)\n   - Prior inconsistent statements (s.209 Evidence Act)\n   - Interest in the outcome / motive to lie\n\n3. **Question Sequences** — draft specific question sequences for the top 3 attack areas (closed, leading questions)\n\n4. **Exhibits to Challenge** — if this witness tendered any exhibits, how should those be challenged?\n\n5. **No-Case Contribution** — after your cross, what essential ingredient on which count will remain unproved?\n\n6. **Risk Warning** — what are the risks in cross-examining this witness aggressively? Any questions to avoid?\n\n7. **Closing Line** — what admission or damaging concession should be the last thing this witness says before they are released?`,
    });
    if (r) setCrossPrepResult(r);
  }, [selectedWitness, witnessInput, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Cross-Examination Preparation</h3>
      <p style={dimS}>
        AI-powered cross-examination strategy for each prosecution witness. Select a tracked
        witness or enter witness details manually. The strategy focuses on impeachment,
        no-case contribution, and the single most damaging admission to extract.
      </p>

      {defWitnesses.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelS}>Select Tracked Witness</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {defWitnesses.map(w => (
              <button
                key={w.id}
                onClick={() => setTargetRef(targetRef === w.ref ? '' : w.ref)}
                style={{
                  background:    targetRef === w.ref ? `${accent}20` : 'transparent',
                  border:        `1px solid ${targetRef === w.ref ? `${accent}60` : '#1e1e2e'}`,
                  color:         targetRef === w.ref ? accent : T.mute,
                  borderRadius:  5, padding: '6px 14px',
                  fontSize:      11, fontFamily: 'Inter, sans-serif',
                  cursor:        'pointer', fontWeight: 600, letterSpacing: '.06em',
                }}
              >
                {w.ref}{w.name ? ` — ${w.name.slice(0, 20)}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {!targetRef && (
        <div>
          <label style={labelS}>Witness Details (manual input)</label>
          <textarea
            style={{ ...taS, minHeight: 130, marginBottom: 14 }}
            value={witnessInput}
            onChange={e => setWitnessInput(e.target.value)}
            placeholder="Describe the witness: their statement / testimony summary, any known inconsistencies, exhibits they tendered, and their relationship to the accused or complainant..."
          />
        </div>
      )}

      {selectedWitness && (
        <div style={{ padding: '10px 14px', background: `${accent}08`, border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: accent, fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
            {selectedWitness.ref}{selectedWitness.name ? ` — ${selectedWitness.name}` : ''}
          </span>
          {selectedWitness.summary && (
            <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginTop: 6, marginBottom: 0 }}>
              {selectedWitness.summary.slice(0, 200)}{selectedWitness.summary.length > 200 ? '…' : ''}
            </p>
          )}
        </div>
      )}

      <Btn
        onClick={generatePrep}
        loading={loading}
        disabled={!targetRef && !witnessInput.trim()}
        label="Generate Cross-Examination Strategy"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {crossPrepResult && (
        <ResultBlock
          title="Cross-Examination Strategy"
          content={crossPrepResult}
          onClear={() => setCrossPrepResult('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'prosecution_case';

export function ProsecutionCase({ activeCase }: Props) {
  const role   = activeCase.counsel_role ?? 'defence';
  const isPros = role === 'prosecution';
  const accent = COUNSEL_ROLE_COLORS[role]?.col ?? '#c09030';

  const prosSubTabs: { id: ProsSubTab; label: string }[] = [
    { id: 'opening_address',    label: '1 — Opening Address' },
    { id: 'witness_schedule',   label: '2 — Witness Schedule' },
    { id: 'exhibit_register',   label: '3 — Exhibit Register' },
    { id: 'evidence_sufficiency', label: '4 — Evidence Sufficiency' },
  ];
  const defSubTabs: { id: DefSubTab; label: string }[] = [
    { id: 'witness_tracker',   label: '1 — Witness Tracker' },
    { id: 'no_case_threshold', label: '2 — No-Case Threshold' },
    { id: 'objection_log',     label: '3 — Objection Log' },
    { id: 'cross_prep',        label: '4 — Cross-Exam Prep' },
  ];

  const [subTab, setSubTab] = useState<SubTab>(isPros ? 'opening_address' : 'witness_tracker');

  // Prosecution state
  const [openingDraft,   setOpeningDraft]   = useState('');
  const [openingDate,    setOpeningDate]    = useState('');
  const [openingNotes,   setOpeningNotes]   = useState('');
  const [prosWitnesses,  setProsWitnesses]  = useState<ProsWitness[]>([emptyProsWitness(0)]);
  const [exhibits,       setExhibits]       = useState<Exhibit[]>([emptyExhibit(0)]);
  const [prosecutionClosed, setProsecutionClosed] = useState(false);
  const [sufficiencyResult, setSufficiencyResult] = useState('');

  // Defence state
  const [defWitnesses,        setDefWitnesses]        = useState<DefWitnessTrack[]>([emptyDefWitness(0)]);
  const [countNoCaseStatuses, setCountNoCaseStatuses] = useState<CountNoCaseStatus[]>([emptyCountStatus(0)]);
  const [noCaseOverall,       setNoCaseOverall]       = useState('');
  const [objections,          setObjections]          = useState<Objection[]>([emptyObjection(0)]);
  const [crossPrepWitness,    setCrossPrepWitness]    = useState('');
  const [crossPrepResult,     setCrossPrepResult]     = useState('');

  // Load
  useEffect(() => {
    loadBlindSpot(activeCase.id, STORAGE_KEY).then((d: SavedData | null) => {
      if (!d) return;
      if (d.openingDraft)          setOpeningDraft(d.openingDraft);
      if (d.openingDate)           setOpeningDate(d.openingDate);
      if (d.openingNotes)          setOpeningNotes(d.openingNotes);
      if (d.prosWitnesses?.length) setProsWitnesses(d.prosWitnesses);
      if (d.exhibits?.length)      setExhibits(d.exhibits);
      if (d.prosecutionClosed)     setProsecutionClosed(d.prosecutionClosed);
      if (d.sufficiencyResult)     setSufficiencyResult(d.sufficiencyResult);
      if (d.defWitnesses?.length)  setDefWitnesses(d.defWitnesses);
      if (d.countNoCaseStatuses?.length) setCountNoCaseStatuses(d.countNoCaseStatuses);
      if (d.noCaseOverall)         setNoCaseOverall(d.noCaseOverall);
      if (d.objections?.length)    setObjections(d.objections);
      if (d.crossPrepWitness)      setCrossPrepWitness(d.crossPrepWitness);
      if (d.crossPrepResult)       setCrossPrepResult(d.crossPrepResult);
    }).catch(() => {});
  }, [activeCase.id]);

  // Persist
  const persist = useCallback(() => {
    const data: SavedData = {
      openingDraft, openingDate, openingNotes, prosWitnesses, exhibits,
      prosecutionClosed, sufficiencyResult,
      defWitnesses, countNoCaseStatuses, noCaseOverall, objections,
      crossPrepWitness, crossPrepResult,
    };
    saveBlindSpot(activeCase.id, STORAGE_KEY, data).catch(() => {});
  }, [
    openingDraft, openingDate, openingNotes, prosWitnesses, exhibits,
    prosecutionClosed, sufficiencyResult,
    defWitnesses, countNoCaseStatuses, noCaseOverall, objections,
    crossPrepWitness, crossPrepResult, activeCase.id,
  ]);

  useEffect(() => { persist(); }, [persist]);

  const headingLabel = isPros ? 'Prosecution Case' : 'Prosecution Case — Defence View';
  const headingDesc  = isPros
    ? 'Open the prosecution case, manage the witness schedule and exhibit register, and run an evidence sufficiency audit before closing.'
    : 'Track prosecution witnesses for cross-examination, monitor the no-case threshold per count, log evidence objections, and prepare cross-examination strategies.';

  // No-case alert badge (defence only)
  const noCaseCount = !isPros
    ? countNoCaseStatuses.filter(c => c.rating === 'MET' || c.rating === 'STRONG').length
    : 0;

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, color: accent, fontFamily: 'Inter, sans-serif',
            letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700,
            background: `${accent}14`, border: `1px solid ${accent}30`,
            padding: '3px 9px', borderRadius: 3,
          }}>
            Criminal · {isPros ? 'Prosecution' : 'Defence'}
          </span>
          <span style={{
            fontSize: 9, color: '#888', fontFamily: 'Inter, sans-serif',
            letterSpacing: '.1em', textTransform: 'uppercase',
          }}>
            Phase 6B
          </span>
          {!isPros && noCaseCount > 0 && (
            <span style={{
              fontSize: 9, color: '#50c050', fontFamily: 'Inter, sans-serif',
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: '#0d1800', border: '1px solid #285000',
              padding: '3px 9px', borderRadius: 3,
            }}>
              ⚖ NO-CASE GROUNDS: {noCaseCount} count{noCaseCount !== 1 ? 's' : ''}
            </span>
          )}
          {isPros && prosecutionClosed && (
            <span style={{
              fontSize: 9, color: '#50c050', fontFamily: 'Inter, sans-serif',
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: '#0d1800', border: '1px solid #285000',
              padding: '3px 9px', borderRadius: 3,
            }}>
              ✓ PROSECUTION CLOSED
            </span>
          )}
        </div>
        <h2 style={{
          fontSize: 26, color: T.text, fontWeight: 300,
          fontFamily: "'Cormorant Garamond', serif", marginBottom: 6,
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
      {isPros && subTab === 'opening_address' && (
        <OpeningAddressTab
          draft={openingDraft} setDraft={setOpeningDraft}
          date={openingDate}   setDate={setOpeningDate}
          notes={openingNotes} setNotes={setOpeningNotes}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'witness_schedule' && (
        <WitnessScheduleTab
          witnesses={prosWitnesses} setWitnesses={setProsWitnesses}
          closed={prosecutionClosed} setClosed={setProsecutionClosed}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'exhibit_register' && (
        <ExhibitRegisterTab
          exhibits={exhibits} setExhibits={setExhibits}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'evidence_sufficiency' && (
        <EvidenceSufficiencyTab
          witnesses={prosWitnesses} exhibits={exhibits}
          accent={accent} activeCase={activeCase}
        />
      )}

      {/* Defence sub-tabs */}
      {!isPros && subTab === 'witness_tracker' && (
        <WitnessTrackerTab
          witnesses={defWitnesses} setWitnesses={setDefWitnesses}
          accent={accent} activeCase={activeCase}
        />
      )}
      {!isPros && subTab === 'no_case_threshold' && (
        <NoCaseThresholdTab
          countStatuses={countNoCaseStatuses} setCountStatuses={setCountNoCaseStatuses}
          overallAssessment={noCaseOverall}    setOverallAssessment={setNoCaseOverall}
          accent={accent} activeCase={activeCase}
        />
      )}
      {!isPros && subTab === 'objection_log' && (
        <ObjectionLogTab
          objections={objections} setObjections={setObjections}
          accent={accent}
        />
      )}
      {!isPros && subTab === 'cross_prep' && (
        <CrossPrepTab
          defWitnesses={defWitnesses}
          witnessInput={crossPrepWitness}   setWitnessInput={setCrossPrepWitness}
          crossPrepResult={crossPrepResult} setCrossPrepResult={setCrossPrepResult}
          accent={accent} activeCase={activeCase}
        />
      )}
    </div>
  );
}
