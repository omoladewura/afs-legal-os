/**
 * AFS Legal OS V2 — Motion Engine (Phase 7B)
 *
 * Dual-role civil engine: governs interlocutory applications on both sides
 * of a civil matter. counsel_role determines which sub-tabs appear.
 *
 * CLAIMANT SIDE sub-tabs:
 *   1. Default Judgment     — motion in default of appearance or defence
 *   2. Summary Judgment     — Ord 22 / equivalent summary judgment application
 *   3. Injunction           — Mareva, mandatory, prohibitory injunction drafter
 *   4. Motion Tracker       — log and track all claimant motions
 *
 * DEFENDANT SIDE sub-tabs:
 *   1. Preliminary Objection — jurisdiction, competence, limitation, locus standi
 *   2. Strike Out            — no reasonable cause of action, frivolous, abuse of process
 *   3. Stay Application      — stay pending appeal, arbitration, related proceedings
 *   4. Security for Costs    — application where claimant is impecunious / foreign
 *   5. Application Tracker   — log and track all defendant applications
 *
 * matter_track is always 'civil' for this engine.
 * counsel_role must be claimant_side | defendant_side.
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

type ClaimSubTab = 'default_judgment' | 'summary_judgment' | 'injunction' | 'motion_tracker';
type DefSubTab   = 'preliminary_obj' | 'strike_out' | 'stay_application' | 'security_costs' | 'application_tracker';
type SubTab      = ClaimSubTab | DefSubTab;

type MotionStatus = 'Drafting' | 'Filed' | 'Served' | 'Awaiting Hearing' | 'Heard' | 'Granted' | 'Refused' | 'Withdrawn';

interface MotionEntry {
  id:        string;
  type:      string;
  filedDate: string;
  status:    MotionStatus;
  hearingDate: string;
  ruling:    string;
  notes:     string;
}

interface SavedData {
  // Claimant drafts
  defaultJudgmentContext?: string;
  defaultJudgmentDraft?:   string;
  summaryJudgmentContext?: string;
  summaryJudgmentDraft?:   string;
  injunctionContext?:      string;
  injunctionDraft?:        string;
  injunctionType?:         string;
  // Defendant drafts
  prelimObjContext?:       string;
  prelimObjDraft?:         string;
  strikeOutContext?:        string;
  strikeOutDraft?:          string;
  stayContext?:            string;
  stayDraft?:              string;
  securityCostsContext?:   string;
  securityCostsDraft?:     string;
  // Shared tracker
  motionEntries?:          MotionEntry[];
  lastUpdated?:            string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEY
// ─────────────────────────────────────────────────────────────────────────────

const MODULE = 'motion_engine';

const DEFAULT_DATA: SavedData = {
  defaultJudgmentContext: '', defaultJudgmentDraft: '',
  summaryJudgmentContext: '', summaryJudgmentDraft: '',
  injunctionContext: '', injunctionDraft: '', injunctionType: 'Prohibitory',
  prelimObjContext: '', prelimObjDraft: '',
  strikeOutContext: '', strikeOutDraft: '',
  stayContext: '', stayDraft: '',
  securityCostsContext: '', securityCostsDraft: '',
  motionEntries: [],
  lastUpdated: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Btn({
  label, onClick, loading = false, accent = '#4090d0', off = false,
}: {
  label: string; onClick: () => void; loading?: boolean; accent?: string; off?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || off}
      style={{
        background: loading || off
          ? '#101018'
          : `linear-gradient(135deg,#000000,${accent})`,
        color:   loading || off ? '#2a2a38' : '#f0ece0',
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

function ResultBlock({
  title, content, onClear, accent = '#4090d0',
}: {
  title: string; content: string; onClear: () => void; accent?: string;
}) {
  return (
    <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${accent}30`, borderRadius: 8, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => navigator.clipboard?.writeText(content)}
            style={{ background: 'transparent', border: `1px solid ${accent}30`, color: accent, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", borderRadius: 4, padding: '3px 10px' }}
          >
            copy
          </button>
          <button onClick={onClear} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
            clear ×
          </button>
        </div>
      </div>
      <Md text={content} />
    </div>
  );
}

function SubTabBar({
  tabs, active, onSelect, accent,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  accent: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            background:   active === t.id ? `${accent}18` : 'transparent',
            border:       `1px solid ${active === t.id ? accent : '#cccccc'}`,
            color:        active === t.id ? accent : T.mute,
            borderRadius: 5, padding: '6px 14px',
            fontSize: 12, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em',
            transition: 'all .15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
      {text}
    </label>
  );
}

function Textarea({
  value, onChange, rows = 5, placeholder = '',
}: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#08080e', border: '1px solid #cccccc',
        borderRadius: 6, padding: '10px 14px', color: T.fg,
        fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
        resize: 'vertical', boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function Input({
  value, onChange, placeholder = '', type = 'text',
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#08080e', border: '1px solid #cccccc',
        borderRadius: 6, padding: '8px 12px', color: T.fg,
        fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
        boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function SectionTitle({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: `1px solid ${accent}20`, paddingBottom: 8 }}>
      {text}
    </div>
  );
}

function StatusBadge({ status }: { status: MotionStatus }) {
  const map: Record<MotionStatus, string> = {
    Drafting:          '#8060c0',
    Filed:             '#4090d0',
    Served:            '#40a0c0',
    'Awaiting Hearing':'#c09030',
    Heard:             '#c09030',
    Granted:           '#40a860',
    Refused:           '#c05050',
    Withdrawn:         '#505068',
  };
  const col = map[status] ?? '#606070';
  return (
    <span style={{ fontSize: 9, color: col, border: `1px solid ${col}40`, borderRadius: 3, padding: '1px 6px', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTION TRACKER — shared between claimant and defendant
// ─────────────────────────────────────────────────────────────────────────────

function MotionTracker({
  entries, onUpdate, accent, side,
}: {
  entries: MotionEntry[];
  onUpdate: (entries: MotionEntry[]) => void;
  accent: string;
  side: 'claimant' | 'defendant';
}) {
  const [newType, setNewType]         = useState('');
  const [newFiled, setNewFiled]       = useState('');
  const [newHearing, setNewHearing]   = useState('');
  const [newStatus, setNewStatus]     = useState<MotionStatus>('Drafting');
  const [newNotes, setNewNotes]       = useState('');

  const claimantTypes = ['Default Judgment', 'Summary Judgment', 'Mareva Injunction', 'Mandatory Injunction', 'Prohibitory Injunction', 'Joinder', 'Amendment of Pleadings', 'Extension of Time', 'Other'];
  const defendantTypes = ['Preliminary Objection', 'Strike Out', 'Stay of Proceedings', 'Security for Costs', 'Setting Aside Service', 'Amendment of Pleadings', 'Extension of Time', 'Other'];
  const motionTypes = side === 'claimant' ? claimantTypes : defendantTypes;

  const statuses: MotionStatus[] = ['Drafting', 'Filed', 'Served', 'Awaiting Hearing', 'Heard', 'Granted', 'Refused', 'Withdrawn'];

  const add = () => {
    if (!newType) return;
    const entry: MotionEntry = {
      id: `mot_${Date.now()}`, type: newType,
      filedDate: newFiled, hearingDate: newHearing,
      status: newStatus, ruling: '', notes: newNotes,
    };
    onUpdate([...entries, entry]);
    setNewType(''); setNewFiled(''); setNewHearing(''); setNewNotes('');
  };

  const updateField = (id: string, field: keyof MotionEntry, val: string) =>
    onUpdate(entries.map(e => e.id === id ? { ...e, [field]: val } : e));

  const remove = (id: string) => onUpdate(entries.filter(e => e.id !== id));

  return (
    <div>
      {entries.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {entries.map(entry => (
            <div key={entry.id} style={{ background: '#ffffff', border: '1px solid #cccccc', borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{entry.type}</span>
                    <StatusBadge status={entry.status} />
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {entry.filedDate && (
                      <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>Filed: {entry.filedDate}</span>
                    )}
                    {entry.hearingDate && (
                      <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>Hearing: {entry.hearingDate}</span>
                    )}
                  </div>
                  {entry.notes && (
                    <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", margin: '6px 0 0', lineHeight: 1.5 }}>{entry.notes}</p>
                  )}
                  {entry.ruling && (
                    <p style={{ fontSize: 12, color: accent, fontFamily: "'Times New Roman', Times, serif", margin: '6px 0 0', lineHeight: 1.5 }}>Ruling: {entry.ruling}</p>
                  )}
                </div>
                <button onClick={() => remove(entry.id)} style={{ background: 'transparent', border: '1px solid #2a0808', color: '#804040', fontSize: 11, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>
                  ×
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={entry.status}
                  onChange={e => updateField(entry.id, 'status', e.target.value)}
                  style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 4, padding: '4px 8px', color: T.mute, fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}
                >
                  {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  value={entry.ruling}
                  onChange={e => updateField(entry.id, 'ruling', e.target.value)}
                  placeholder="Ruling / outcome…"
                  style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 4, padding: '4px 10px', color: T.fg, fontSize: 11, fontFamily: "'Times New Roman', Times, serif", outline: 'none', flex: 1, minWidth: 140 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && (
        <div style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 8, padding: '20px', marginBottom: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>No motions recorded yet.</p>
        </div>
      )}

      {/* Add row */}
      <div style={{ background: '#08080e', border: `1px solid ${accent}20`, borderRadius: 8, padding: '16px 18px' }}>
        <SectionTitle text="Add Motion / Application" accent={accent} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <Label text="Motion Type" />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '8px 12px', color: newType ? T.fg : T.mute, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", outline: 'none', cursor: 'pointer', width: '100%' }}
            >
              <option value="">Select type…</option>
              {motionTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label text="Status" />
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value as MotionStatus)}
              style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '8px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", outline: 'none', cursor: 'pointer', width: '100%' }}
            >
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label text="Date Filed" />
            <Input type="date" value={newFiled} onChange={setNewFiled} />
          </div>
          <div>
            <Label text="Hearing Date" />
            <Input type="date" value={newHearing} onChange={setNewHearing} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Label text="Notes" />
          <Input value={newNotes} onChange={setNewNotes} placeholder="Optional notes, e.g. outcome, adjourn date" />
        </div>
        <Btn label="Add Entry" onClick={add} accent={accent} off={!newType} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAIMANT TABS
// ─────────────────────────────────────────────────────────────────────────────

function DefaultJudgmentTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.defaultJudgmentContext ?? '');
  const [draft, setDraft]     = useState(data.defaultJudgmentDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}

Facts and instructions for default judgment:
${context}

Draft a complete Motion for Judgment in Default. Include both scenarios if applicable:

PART A — If applying in default of appearance:
- Motion on Notice with correct Order citations (High Court Civil Procedure Rules)
- Supporting affidavit verifying non-appearance and service
- Proof of service requirements
- Relief sought: judgment in default of appearance

PART B — If applying in default of defence:
- Motion on Notice with correct Order citations
- Supporting affidavit verifying SoC was served, time elapsed, no SoD filed
- Required exhibits (proof of service, copy of SoC, diary)
- Relief sought: judgment in default of defence

Apply the applicable High Court (Civil Procedure) Rules. Use formal Nigerian court drafting language. Number all paragraphs in affidavits. Include an exhibit list.`;

    const result = await ask({ userMsg: prompt, maxTokens: 2000 });
    if (result) {
      setDraft(result);
      onSave({ defaultJudgmentContext: context, defaultJudgmentDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Default Judgment Motion Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Provide the facts: date of service, whether appearance was entered, whether SoD was filed, and the reliefs you claim. The AI drafts the motion and supporting affidavit.
      </p>

      <div style={{ background: '#0a0814', border: `1px solid ${accent}20`, borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 700 }}>When to Apply</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ background: '#08080e', borderRadius: 6, padding: '12px 14px', border: '1px solid #cccccc' }}>
            <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", marginBottom: 4, fontWeight: 600 }}>Default of Appearance</div>
            <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>Defendant served but did not enter appearance within the required time (usually 8–10 days).</div>
          </div>
          <div style={{ background: '#08080e', borderRadius: 6, padding: '12px 14px', border: '1px solid #cccccc' }}>
            <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", marginBottom: 4, fontWeight: 600 }}>Default of Defence</div>
            <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>Defendant entered appearance but failed to file a Statement of Defence within 30 days of service of the SoC.</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Service Date, Default Type & Reliefs Sought" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={6}
          placeholder="State: (1) date process was served, (2) whether appearance was entered, (3) whether SoD was filed and when it was due, (4) the specific reliefs sought in the SoC (damages, injunction, declaration, etc.)."
        />
      </div>
      <Btn label="Draft Default Judgment Motion" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Default Judgment Motion — Draft" content={draft} onClear={() => { setDraft(''); onSave({ defaultJudgmentDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function SummaryJudgmentTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.summaryJudgmentContext ?? '');
  const [draft, setDraft]     = useState(data.summaryJudgmentDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}

Facts for summary judgment application:
${context}

Draft a complete Application for Summary Judgment. The basis is that the defendant has no real defence to the claim (or a part of it). Include:

1. Motion on Notice — citing the applicable Order for summary judgment (Ord 11 or equivalent)
2. Summary of the claim and the reliefs sought
3. Why there is no real or bona fide defence — address each possible defence and why it fails
4. Supporting Affidavit structure:
   - Deponent's knowledge of the facts
   - Facts establishing the claim
   - Statement that defendant has no real defence
   - Exhibits required (contract, correspondence, invoices, SoC, SoD if filed)
5. Written Address structure:
   - Issue: whether the defendant has a real defence
   - Nigerian standard for summary judgment (cite key authorities)
   - Application to the facts
   - Conclusion and relief sought

Use formal Nigerian court drafting language throughout.`;

    const result = await ask({ userMsg: prompt, maxTokens: 2000 });
    if (result) {
      setDraft(result);
      onSave({ summaryJudgmentContext: context, summaryJudgmentDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Summary Judgment Application" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Summary judgment is available where the defendant has no real or bona fide defence to the whole claim or any part of it. Provide the claim summary and why no real defence exists.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Claim Summary, Defendant's Purported Defence & Why It Fails" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={7}
          placeholder="Describe: (1) the nature of the claim and reliefs, (2) what the defendant's defence or position is (if any), (3) why no real or bona fide defence exists (e.g. liquidated debt, clear documentary evidence, bare denials without substance)."
        />
      </div>
      <Btn label="Draft Summary Judgment Application" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Summary Judgment Application — Draft" content={draft} onClear={() => { setDraft(''); onSave({ summaryJudgmentDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function InjunctionTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.injunctionContext ?? '');
  const [draft, setDraft]     = useState(data.injunctionDraft ?? '');
  const [injType, setInjType] = useState(data.injunctionType ?? 'Prohibitory');
  const { ask, loading, error } = ai;

  const injTypes = ['Prohibitory', 'Mandatory', 'Mareva (Asset Freezing)', 'Quia Timet', 'Interlocutory Status Quo'];

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}
Injunction type sought: ${injType}

Facts and basis for the injunction:
${context}

Draft a complete Interlocutory Injunction Application. Include:

1. Ex Parte Motion (if urgency warrants) OR Motion on Notice — with correct Order citations
2. Supporting Affidavit addressing all three limbs of the American Cyanamid test as applied in Nigeria:
   a) Serious question to be tried — particularise the cause of action
   b) Balance of convenience — why damages would not be an adequate remedy; relative hardship
   c) Undertaking as to damages — counsel's undertaking paragraph
3. For Mareva injunction — additionally address:
   - Real risk of dissipation of assets
   - Assets to be frozen (with particulars if known)
   - Carve-outs for ordinary living expenses and legal costs
4. Written Address — applying Nigerian authorities on the test for interlocutory injunctions
5. Draft Order sought

Use formal Nigerian court drafting language. Cite relevant Nigerian authorities.`;

    const result = await ask({ userMsg: prompt, maxTokens: 2000 });
    if (result) {
      setDraft(result);
      onSave({ injunctionContext: context, injunctionDraft: result, injunctionType: injType });
    }
  }, [context, injType, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Injunction Application Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Provide the factual basis for the injunction, the harm feared, and why damages are inadequate. The AI drafts the motion, affidavit, and written address on the American Cyanamid test.
      </p>

      <div style={{ marginBottom: 16 }}>
        <Label text="Injunction Type" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {injTypes.map(t => (
            <button
              key={t}
              onClick={() => setInjType(t)}
              style={{
                background: injType === t ? `${accent}18` : 'transparent',
                border: `1px solid ${injType === t ? accent : '#cccccc'}`,
                color: injType === t ? accent : T.mute,
                borderRadius: 5, padding: '6px 14px', fontSize: 12,
                cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                transition: 'all .15s',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Facts, Harm Feared, Assets (if Mareva) & Urgency" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={7}
          placeholder="Describe: (1) the cause of action being protected, (2) the specific act or threatened act to be restrained, (3) the irreparable harm if not restrained, (4) why damages are inadequate, (5) for Mareva — known assets and risk of dissipation."
        />
      </div>
      <Btn label={`Draft ${injType} Injunction Application`} onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title={`${injType} Injunction — Draft`} content={draft} onClear={() => { setDraft(''); onSave({ injunctionDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENDANT TABS
// ─────────────────────────────────────────────────────────────────────────────

function PrelimObjTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.prelimObjContext ?? '');
  const [draft, setDraft]     = useState(data.prelimObjDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}

Case details and suspected grounds for preliminary objection:
${context}

Conduct a full preliminary objection analysis. Assess each ground systematically:

1. JURISDICTION — does this court have subject matter jurisdiction? Is the claim within the court's territorial and/or monetary jurisdiction?
2. COMPETENCE — is the originating process properly constituted? Was the correct originating process used (Writ vs Originating Summons vs Originating Motion)?
3. LIMITATION — has the limitation period expired under the applicable Limitation Law / Act?
4. LOCUS STANDI — does the claimant have the legal right to institute this action? Is there a legal nexus between the claimant and the reliefs claimed?
5. NON-DISCLOSURE OF CAUSE OF ACTION — does the Statement of Claim disclose a reasonable cause of action in law?
6. PRE-CONDITIONS — were all statutory notices / pre-action requirements complied with (e.g. s97 SCFTA notice, CTC Regulations, Police Act notice)?
7. PARTIES — is there a misjoinder or non-joinder of necessary parties?

For each valid ground found:
- State the ground
- Explain why it applies on these facts
- Cite the applicable Nigerian authority

Then draft:
A. Notice of Preliminary Objection
B. Points of Argument on each valid ground with supporting Nigerian authorities
C. Reliefs sought (that the suit be struck out / dismissed with costs)

Apply Nigerian High Court Rules and leading authorities on each ground.`;

    const result = await ask({ userMsg: prompt, maxTokens: 2200 });
    if (result) {
      setDraft(result);
      onSave({ prelimObjContext: context, prelimObjDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Preliminary Objection Analysis & Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        A preliminary objection can terminate the action before it is heard on the merits. Provide the case details and the AI will assess all grounds and draft the Notice and Points of Argument.
      </p>

      <div style={{ background: '#0a0814', border: `1px solid ${accent}20`, borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>Grounds to be Assessed</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {['Jurisdiction', 'Competence of Process', 'Limitation', 'Locus Standi', 'No Cause of Action', 'Pre-conditions', 'Misjoinder / Non-joinder'].map(g => (
            <div key={g} style={{ background: '#08080e', borderRadius: 5, padding: '8px 12px', border: '1px solid #cccccc', fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {g}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Case Details & Suspected Defects" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={7}
          placeholder="Describe: (1) the claimant's cause of action and reliefs, (2) the originating process used, (3) the court, (4) when the cause of action arose and when the writ was filed, (5) whether any pre-action notices were required, (6) any apparent procedural irregularities."
        />
      </div>
      <Btn label="Analyse Grounds & Draft Objection" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Preliminary Objection — Analysis & Draft" content={draft} onClear={() => { setDraft(''); onSave({ prelimObjDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function StrikeOutTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.strikeOutContext ?? '');
  const [draft, setDraft]     = useState(data.strikeOutDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}

Basis for strike out application:
${context}

Draft a complete Application to Strike Out the Claimant's Statement of Claim / suit. Assess and draft under whichever of these bases applies:

1. DISCLOSES NO REASONABLE CAUSE OF ACTION — the pleading is legally deficient on its face
2. FRIVOLOUS OR VEXATIOUS — the claim is clearly bound to fail, an abuse of process
3. SCANDALOUS OR EMBARRASSING — the pleading contains irrelevant, scandalous, or embarrassing matter
4. ABUSE OF PROCESS — the suit is res judicata, sub judice, or an attempt to relitigate settled matters

For the applicable ground(s):
- Motion on Notice with correct Order / Rule citations
- Supporting Affidavit (if facts needed) OR argument that no affidavit evidence is required (on face of pleading)
- Written Address:
  * The applicable standard for strike out in Nigeria
  * Application to the pleading in this case
  * Nigerian authorities supporting the application
- Reliefs sought: that the suit / statement of claim be struck out with costs

Note: for "no reasonable cause of action" — the court looks only at the pleading; no affidavit evidence is admissible.`;

    const result = await ask({ userMsg: prompt, maxTokens: 1800 });
    if (result) {
      setDraft(result);
      onSave({ strikeOutContext: context, strikeOutDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Strike Out Application" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        A strike-out application removes a defective claim at the interlocutory stage without a full hearing on the merits. Describe the basis and the AI drafts the application and written address.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Basis for Strike Out & Pleading Defects" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={6}
          placeholder="Describe: (1) the claimant's cause of action as pleaded, (2) why the pleading is defective — e.g. discloses no legally recognised cause of action, is time-barred on the face of the pleading, is res judicata, or is a clear abuse of process."
        />
      </div>
      <Btn label="Draft Strike Out Application" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Strike Out Application — Draft" content={draft} onClear={() => { setDraft(''); onSave({ strikeOutDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function StayApplicationTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.stayContext ?? '');
  const [draft, setDraft]     = useState(data.stayDraft ?? '');
  const [stayBasis, setStayBasis] = useState('Appeal Pending');
  const { ask, loading, error } = ai;

  const stayBases = ['Appeal Pending', 'Arbitration Clause', 'Related Proceedings', 'Foreign Jurisdiction Clause', 'Pending Criminal Proceedings'];

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}
Basis for stay: ${stayBasis}

Facts and grounds for stay of proceedings:
${context}

Draft a complete Application for Stay of Proceedings. Include:

1. Motion on Notice — citing inherent jurisdiction of the court and/or applicable Rules
2. Grounds for stay specific to: ${stayBasis}
   ${stayBasis === 'Arbitration Clause' ? '- Identify the arbitration clause, its scope, and that the dispute falls within it (Arbitration and Conciliation Act / ACA)' : ''}
   ${stayBasis === 'Appeal Pending' ? '- Identify the interlocutory ruling being appealed, the Notice of Appeal filed, and why the proceedings should pause' : ''}
   ${stayBasis === 'Related Proceedings' ? '- Identify the related proceedings, the risk of inconsistent judgments, and the balance of convenience' : ''}
3. Supporting Affidavit verifying the basis for the stay
4. Written Address applying Nigerian authorities on the court\'s power to stay proceedings
5. Relief sought: stay of proceedings pending [basis] with costs in the cause

Apply Nigerian procedural law throughout.`;

    const result = await ask({ userMsg: prompt, maxTokens: 1800 });
    if (result) {
      setDraft(result);
      onSave({ stayContext: context, stayDraft: result });
    }
  }, [context, stayBasis, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Stay of Proceedings Application" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        A stay of proceedings suspends the court action. Select the basis and provide the facts. The AI drafts the motion, affidavit, and written address.
      </p>

      <div style={{ marginBottom: 16 }}>
        <Label text="Basis for Stay" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {stayBases.map(b => (
            <button
              key={b}
              onClick={() => setStayBasis(b)}
              style={{
                background: stayBasis === b ? `${accent}18` : 'transparent',
                border: `1px solid ${stayBasis === b ? accent : '#cccccc'}`,
                color: stayBasis === b ? accent : T.mute,
                borderRadius: 5, padding: '6px 14px', fontSize: 12,
                cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", transition: 'all .15s',
              }}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Facts & Grounds" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={6}
          placeholder={
            stayBasis === 'Arbitration Clause'
              ? "Describe the arbitration clause — which agreement, clause number, scope of disputes covered, and how this dispute falls within it."
              : stayBasis === 'Appeal Pending'
              ? "Describe the interlocutory ruling being challenged, the grounds of appeal filed, and why continuation would render any appeal nugatory."
              : "Describe the circumstances warranting the stay and the basis for the court's exercise of discretion."
          }
        />
      </div>
      <Btn label="Draft Stay Application" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Stay Application — Draft" content={draft} onClear={() => { setDraft(''); onSave({ stayDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function SecurityCostsTab({ data, onSave, accent, ai }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI> }) {
  const [context, setContext] = useState(data.securityCostsContext ?? '');
  const [draft, setDraft]     = useState(data.securityCostsDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const c = (window as any).__afsActiveCase;
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT.

Matter: ${c?.caseName ?? ''}
Court: ${c?.court ?? ''}

Facts supporting security for costs application:
${context}

Draft a complete Application for Security for Costs. Include:

1. Motion on Notice citing the applicable Order / Rule
2. Grounds establishing why security should be ordered:
   - Claimant is ordinarily resident outside Nigeria, OR
   - Claimant's financial position makes it unlikely costs could be recovered if defendant succeeds, OR
   - Claimant is a nominal plaintiff with no real interest
3. Proposed quantum of security (if known) and how it was calculated
4. Supporting Affidavit with evidence of the claimant's inability to meet a costs order
5. Written Address applying Nigerian authorities on security for costs
6. Relief sought: order that claimant provide security in the sum of ₦[X] within [Y] days, failing which the suit be struck out

Apply Nigerian procedural law and relevant High Court Rules.`;

    const result = await ask({ userMsg: prompt, maxTokens: 1600 });
    if (result) {
      setDraft(result);
      onSave({ securityCostsContext: context, securityCostsDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Security for Costs Application" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Security for costs protects the defendant where the claimant is unlikely to satisfy a costs order if the defendant succeeds. Provide details of the claimant's financial position or residency.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Claimant's Financial Position, Residency & Grounds" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={6}
          placeholder="Describe: (1) whether the claimant is resident outside Nigeria, (2) evidence of the claimant's impecuniosity or inability to meet a costs order, (3) estimated costs of defending the action, (4) any other basis for the application."
        />
      </div>
      <Btn label="Draft Security for Costs Application" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Security for Costs Application — Draft" content={draft} onClear={() => { setDraft(''); onSave({ securityCostsDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function MotionEngine({ activeCase }: Props) {
  const isClaim = activeCase.counsel_role === 'claimant_side';
  const accent  = activeCase.counsel_role
    ? COUNSEL_ROLE_COLORS[activeCase.counsel_role].col
    : '#4090d0';

  (window as any).__afsActiveCase = activeCase;

  const claimTabs = [
    { id: 'default_judgment', label: 'Default Judgment' },
    { id: 'summary_judgment', label: 'Summary Judgment' },
    { id: 'injunction',       label: 'Injunction' },
    { id: 'motion_tracker',   label: 'Motion Tracker' },
  ];

  const defTabs = [
    { id: 'preliminary_obj',     label: 'Preliminary Objection' },
    { id: 'strike_out',          label: 'Strike Out' },
    { id: 'stay_application',    label: 'Stay of Proceedings' },
    { id: 'security_costs',      label: 'Security for Costs' },
    { id: 'application_tracker', label: 'Application Tracker' },
  ];

  const tabs = isClaim ? claimTabs : defTabs;

  const [activeTab, setActiveTab] = useState<SubTab>(
    isClaim ? 'default_judgment' : 'preliminary_obj'
  );

  const [data, setData]     = useState<SavedData>(DEFAULT_DATA);
  const [loaded, setLoaded] = useState(false);
  const ai                  = useAI(activeCase);

  useEffect(() => {
    let live = true;
    loadBlindSpot<SavedData>(activeCase.id, MODULE, DEFAULT_DATA).then(d => {
      if (live) { setData(d); setLoaded(true); }
    });
    return () => { live = false; };
  }, [activeCase.id]);

  const onSave = useCallback((patch: Partial<SavedData>) => {
    setData(prev => {
      const next = { ...prev, ...patch, lastUpdated: new Date().toISOString() };
      saveBlindSpot(activeCase.id, MODULE, next);
      return next;
    });
  }, [activeCase.id]);

  const onUpdateMotions = useCallback((motionEntries: MotionEntry[]) => {
    setData(prev => {
      const next = { ...prev, motionEntries, lastUpdated: new Date().toISOString() };
      saveBlindSpot(activeCase.id, MODULE, next);
      return next;
    });
  }, [activeCase.id]);

  if (!loaded) {
    return (
      <div style={{ padding: 40, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13 }}>
        Loading Motion Engine…
      </div>
    );
  }

  if (activeCase.counsel_role !== 'claimant_side' && activeCase.counsel_role !== 'defendant_side') {
    return (
      <div style={{ padding: 32, background: '#08080e', border: '1px solid #cccccc', borderRadius: 8 }}>
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
          The Motion Engine is only available on civil matters.
        </p>
      </div>
    );
  }

  const sharedProps = { data, onSave, accent, ai };
  const isTrackerTab = activeTab === 'motion_tracker' || activeTab === 'application_tracker';

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 18, color: accent }}>⚖</span>
          <h3 style={{ fontSize: 18, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, margin: 0 }}>
            {isClaim ? 'Motions Engine' : 'Applications Engine'}
          </h3>
          <span style={{
            fontSize: 9, padding: '3px 8px', borderRadius: 3,
            fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
            letterSpacing: '.08em', textTransform: 'uppercase',
            background: `${accent}15`, border: `1px solid ${accent}30`, color: accent,
          }}>
            {isClaim ? 'Claimant Side' : 'Defendant Side'}
          </span>
        </div>
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
          {isClaim
            ? 'Draft and track interlocutory motions — default judgment, summary judgment, and injunctions.'
            : 'Draft and track interlocutory applications — preliminary objections, strike out, stay, and security for costs.'}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar tabs={tabs} active={activeTab} onSelect={id => setActiveTab(id as SubTab)} accent={accent} />

      {/* Content */}
      <div>
        {/* CLAIMANT tabs */}
        {isClaim && activeTab === 'default_judgment' && <DefaultJudgmentTab  {...sharedProps} />}
        {isClaim && activeTab === 'summary_judgment' && <SummaryJudgmentTab  {...sharedProps} />}
        {isClaim && activeTab === 'injunction'       && <InjunctionTab        {...sharedProps} />}
        {isClaim && isTrackerTab && (
          <div>
            <SectionTitle text="Motion Tracker" accent={accent} />
            <MotionTracker
              entries={data.motionEntries ?? []}
              onUpdate={onUpdateMotions}
              accent={accent}
              side="claimant"
            />
          </div>
        )}

        {/* DEFENDANT tabs */}
        {!isClaim && activeTab === 'preliminary_obj'     && <PrelimObjTab       {...sharedProps} />}
        {!isClaim && activeTab === 'strike_out'          && <StrikeOutTab        {...sharedProps} />}
        {!isClaim && activeTab === 'stay_application'    && <StayApplicationTab  {...sharedProps} />}
        {!isClaim && activeTab === 'security_costs'      && <SecurityCostsTab    {...sharedProps} />}
        {!isClaim && isTrackerTab && (
          <div>
            <SectionTitle text="Application Tracker" accent={accent} />
            <MotionTracker
              entries={data.motionEntries ?? []}
              onUpdate={onUpdateMotions}
              accent={accent}
              side="defendant"
            />
          </div>
        )}
      </div>
    </div>
  );
}
