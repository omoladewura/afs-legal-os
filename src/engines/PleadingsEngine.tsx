/**
 * AFS Legal OS V2 — Pleadings Engine (Phase 7A)
 *
 * Dual-role civil engine: governs the pleadings stage for both sides
 * of a civil matter. counsel_role determines which sub-tabs appear.
 *
 * CLAIMANT SIDE sub-tabs:
 *   1. SoC Drafter          — draft Statement of Claim with AI
 *   2. SoD Monitor          — track defendant's SoD, flag default opportunity
 *   3. Counterclaim Response — draft Defence to Counterclaim if raised
 *   4. Default Flag         — default judgment readiness calculator
 *
 * DEFENDANT SIDE sub-tabs:
 *   1. SoD Drafter          — draft Statement of Defence with AI
 *   2. Counterclaim Builder  — draft Counterclaim with reliefs sought
 *   3. Preliminary Objection — identify objection grounds and draft motion
 *   4. Reply Monitor        — track claimant's reply to SoD
 *
 * matter_track is always 'civil' for this engine.
 * counsel_role must be claimant_side | defendant_side.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useIntelligence } from '@/hooks/useIntelligence';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type ClaimSubTab = 'originating_process' | 'soc_drafter' | 'witness_statement' | 'sod_monitor' | 'counterclaim_response' | 'default_flag';
type DefSubTab   = 'sod_drafter' | 'counterclaim_builder' | 'preliminary_objection' | 'reply_monitor';
type SubTab      = ClaimSubTab | DefSubTab;

interface PleadingItem {
  id:        string;
  type:      string;   // e.g. 'SoC', 'SoD', 'Counterclaim', 'Reply'
  side:      'ours' | 'theirs';
  filedDate: string;
  status:    string;   // 'Filed' | 'Received' | 'Overdue' | 'Pending'
  notes:     string;
}

interface SavedData {
  // Claimant — Originating Process
  origProcessType?:    string;
  origProcessContext?: string;
  origProcessDraft?:   string;
  // Claimant — Witness Statement
  witnessName?:        string;
  witnessRole?:        string;
  witnessContext?:     string;
  witnessStatDraft?:   string;
  // Claimant
  socContext?:          string;
  socDraft?:            string;
  sodReceivedDate?:     string;
  sodFiled?:            boolean;
  dtccContext?:         string;
  dtccDraft?:           string;
  // Defendant
  sodContext?:          string;
  sodDraft?:            string;
  counterclaimContext?: string;
  counterclaimDraft?:   string;
  objectionContext?:    string;
  objectionDraft?:      string;
  replyReceived?:       boolean;
  replyDate?:           string;
  // Shared tracker
  pleadingItems?:       PleadingItem[];
  serviceDate?:         string;
  lastUpdated?:         string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEY
// ─────────────────────────────────────────────────────────────────────────────

const MODULE = 'pleadings_engine';

const DEFAULT_DATA: SavedData = {
  origProcessType: '', origProcessContext: '', origProcessDraft: '',
  witnessName: '', witnessRole: '', witnessContext: '', witnessStatDraft: '',
  socContext: '', socDraft: '',
  sodReceivedDate: '', sodFiled: false,
  dtccContext: '', dtccDraft: '',
  sodContext: '', sodDraft: '',
  counterclaimContext: '', counterclaimDraft: '',
  objectionContext: '', objectionDraft: '',
  replyReceived: false, replyDate: '',
  pleadingItems: [],
  serviceDate: '',
  lastUpdated: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI HELPERS
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
  value, onChange, rows = 4, placeholder = '',
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Filed:    '#40a878', Received: '#4090d0', Overdue: '#c05050',
    Pending:  '#c09030', Settled:  '#8060c0',
  };
  const col = map[status] ?? '#606070';
  return (
    <span style={{ fontSize: 9, color: col, border: `1px solid ${col}40`, borderRadius: 3, padding: '1px 6px', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLEADING TRACKER — shared component used in SoD Monitor and Reply Monitor
// ─────────────────────────────────────────────────────────────────────────────

function PleadingTracker({
  items, onUpdate, accent,
}: {
  items: PleadingItem[];
  onUpdate: (items: PleadingItem[]) => void;
  accent: string;
}) {
  const [newType, setNewType]     = useState('');
  const [newSide, setNewSide]     = useState<'ours' | 'theirs'>('ours');
  const [newDate, setNewDate]     = useState('');
  const [newStatus, setNewStatus] = useState('Filed');
  const [newNotes, setNewNotes]   = useState('');

  const add = () => {
    if (!newType.trim()) return;
    const item: PleadingItem = {
      id: `pl_${Date.now()}`, type: newType.trim(), side: newSide,
      filedDate: newDate, status: newStatus, notes: newNotes,
    };
    onUpdate([...items, item]);
    setNewType(''); setNewDate(''); setNewNotes('');
  };

  const remove = (id: string) => onUpdate(items.filter(i => i.id !== id));

  const updateStatus = (id: string, status: string) =>
    onUpdate(items.map(i => i.id === id ? { ...i, status } : i));

  return (
    <div>
      {items.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {items.map(item => (
            <div key={item.id} style={{ background: '#ffffff', border: '1px solid #cccccc', borderRadius: 8, padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{item.type}</span>
                  <span style={{ fontSize: 10, color: item.side === 'ours' ? accent : '#888', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
                    {item.side === 'ours' ? '(our filing)' : '(opposing)'}
                  </span>
                  <StatusBadge status={item.status} />
                  {item.filedDate && (
                    <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{item.filedDate}</span>
                  )}
                </div>
                {item.notes && (
                  <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.5 }}>{item.notes}</p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <select
                  value={item.status}
                  onChange={e => updateStatus(item.id, e.target.value)}
                  style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 4, padding: '4px 8px', color: T.mute, fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}
                >
                  {['Filed','Received','Overdue','Pending','Settled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => remove(item.id)} style={{ background: 'transparent', border: '1px solid #2a0808', color: '#804040', fontSize: 11, borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add row */}
      <div style={{ background: '#08080e', border: `1px solid ${accent}20`, borderRadius: 8, padding: '16px 18px' }}>
        <SectionTitle text="Add Pleading Entry" accent={accent} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <Label text="Pleading Type" />
            <Input value={newType} onChange={setNewType} placeholder="e.g. Statement of Claim, SoD, Counterclaim" />
          </div>
          <div>
            <Label text="Date Filed / Received" />
            <Input type="date" value={newDate} onChange={setNewDate} />
          </div>
          <div>
            <Label text="Filed By" />
            <select
              value={newSide}
              onChange={e => setNewSide(e.target.value as 'ours' | 'theirs')}
              style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '8px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", outline: 'none', cursor: 'pointer', width: '100%' }}
            >
              <option value="ours">Our Side</option>
              <option value="theirs">Opposing Side</option>
            </select>
          </div>
          <div>
            <Label text="Status" />
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              style={{ background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '8px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", outline: 'none', cursor: 'pointer', width: '100%' }}
            >
              {['Filed','Received','Overdue','Pending','Settled'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Label text="Notes" />
          <Input value={newNotes} onChange={setNewNotes} placeholder="Optional notes" />
        </div>
        <Btn label="Add Entry" onClick={add} accent={accent} off={!newType.trim()} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT DAYS CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────────────────
// C.1 NEW — ORIGINATING PROCESS DRAFTER (Claimant)
// ─────────────────────────────────────────────────────────────────────────────

const PROCESS_TYPES = [
  { id: 'writ_of_summons',     label: 'Writ of Summons',      desc: 'Standard originating process for most civil claims before the High Court. Endorsement of claim sets out cause of action and reliefs.' },
  { id: 'originating_summons', label: 'Originating Summons',  desc: 'For matters unlikely to be disputed on facts — questions of law, construction of documents, administration of estates, mortgages.' },
  { id: 'originating_motion',  label: 'Originating Motion',   desc: 'For applications authorised by statute to be commenced by motion — enforcement of fundamental rights, elections, judicial review.' },
  { id: 'petition',            label: 'Petition',             desc: 'Divorce/matrimonial proceedings, winding-up of companies, election petitions before election petition tribunals.' },
];

function OriginatingProcessDrafter({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [processType, setProcessType] = useState(data.origProcessType ?? '');
  const [context, setContext]         = useState(data.origProcessContext ?? '');
  const [draft, setDraft]             = useState(data.origProcessDraft ?? '');
  const { ask, loading, error }       = ai;

  const selected = PROCESS_TYPES.find(p => p.id === processType);

  const run = useCallback(async () => {
    const caseName = (window as any).__afsActiveCase?.caseName ?? '';
    const court    = (window as any).__afsActiveCase?.court ?? 'High Court';
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT side.

Matter: ${caseName}
Court: ${court}
Originating Process Selected: ${selected?.label ?? processType}

Instructions from counsel:
${context}

Draft a complete ${selected?.label ?? processType} in the correct Nigerian form for the court specified.

STRUCTURE FOR ${(selected?.label ?? processType).toUpperCase()}:

${processType === 'writ_of_summons' ? `
1. Header: In the [Court] of [State] holden at [City]
   Suit No: [to be assigned] — YYYY
2. Parties block: BETWEEN [CLAIMANT NAME] — Claimant AND [DEFENDANT NAME] — Defendant
3. WRIT OF SUMMONS preamble ordering the defendant to enter appearance
4. ENDORSEMENT OF CLAIM: Numbered paragraphs stating:
   a. The claim(s) — specific reliefs
   b. The cause of action
   c. Brief grounds
5. Endorsement of amount claimed (if monetary)
6. Issued at [Registry] on [date] — signature block for Registrar
7. Solicitor's endorsement (counsel's name, address, firm, filing date)
` : processType === 'originating_summons' ? `
1. Header: In the [Court] holden at [City] — Suit No: [to be assigned]
2. In the matter of: [subject matter e.g. "an Application under Order X Rule Y Lagos HCR"]
3. Parties: [Applicant] — Applicant / [Respondent] — Respondent (if any)
4. ORIGINATING SUMMONS — Let [Respondent/all persons concerned] attend before the Honourable Court…
5. Questions for determination: numbered list of legal questions to be resolved
6. Reliefs sought: numbered list corresponding to each question
7. Grounds: brief statutory/legal basis for each question
8. Affidavit in support reference
9. Solicitor's endorsement and filing details
` : processType === 'originating_motion' ? `
1. Header: In the [Court] — Suit No: [to be assigned]
2. Parties or ex parte designation
3. NOTICE OF MOTION / APPLICATION — nature and statutory basis (e.g. Fundamental Rights (Enforcement Procedure) Rules 2009)
4. Application paragraph: "TAKE NOTICE that [Applicant] shall apply to this Honourable Court…"
5. For: numbered list of orders/declarations sought
6. On the grounds that: numbered legal and factual grounds
7. AND TAKE FURTHER NOTICE that on the hearing of this application, the Applicant will rely on: (affidavit, documents listed)
8. Solicitor's endorsement and filing details
` : `
1. Header: In the [Tribunal/Court] — Petition No: [to be assigned]
2. In the matter of: [subject e.g. divorce, winding-up]
3. Petitioner and Respondent designation
4. PETITION: numbered paragraphs setting out:
   a. Jurisdiction and parties
   b. Background facts supporting the petition
   c. Grounds for the petition (statutory grounds where applicable)
   d. Particulars of each ground
5. Wherefore the Petitioner prays: numbered list of reliefs
6. Verifying affidavit reference
7. Solicitor's endorsement
`}

Nigerian form requirements:
- Use correct court heading for the court specified
- Include suit number placeholder [to be assigned]
- Use formal Nigerian court language throughout
- Every relief must be specifically and separately stated
- Include counsel's name, firm, address for service on the endorsement
- Flag any missing particulars with [COUNSEL TO SUPPLY: description]

Return the complete draft originating process only.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 2500 });
    if (result) {
      setDraft(result);
      onSave({ origProcessType: processType, origProcessContext: context, origProcessDraft: result });
    }
  }, [processType, context, ask, onSave, selected]);

  return (
    <div>
      <SectionTitle text="Originating Process Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Select the correct originating process for this matter. The AI will draft the full process in Nigerian court form for the court on record.
      </p>

      {/* Process type selector */}
      <div style={{ marginBottom: 20 }}>
        <Label text="Select Originating Process Type" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {PROCESS_TYPES.map(p => (
            <button
              key={p.id}
              onClick={() => { setProcessType(p.id); onSave({ origProcessType: p.id }); }}
              style={{
                background:   processType === p.id ? `${accent}12` : '#ffffff',
                border:       `1.5px solid ${processType === p.id ? accent : '#cccccc'}`,
                borderRadius: 7, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
              }}
            >
              <div style={{ fontSize: 13, color: processType === p.id ? accent : T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 5 }}>
                {p.label}
              </div>
              <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, margin: 0 }}>{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {processType && (
        <>
          <div style={{ background: `${accent}08`, border: `1px solid ${accent}20`, borderRadius: 7, padding: '12px 16px', marginBottom: 18 }}>
            <p style={{ fontSize: 12, color: accent, fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
              <strong>Selected:</strong> {selected?.label} — {selected?.desc}
            </p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <Label text="Parties, Cause of Action, Reliefs & Any Special Instructions" />
            <Textarea
              value={context}
              onChange={setContext}
              rows={8}
              placeholder={`Provide:\n• Full names and descriptions of all parties (claimant, defendant, capacity)\n• Court and division\n• Cause of action / claim type\n• Every specific relief sought (number them)\n• Relevant statute or rule authorising this process (if applicable)\n• Any special matters to be endorsed (amounts, pre-action notices complied with, etc.)`}
            />
          </div>
          <Btn label={`Draft ${selected?.label ?? 'Originating Process'}`} onClick={run} loading={loading} accent={accent} off={!context.trim()} />
        </>
      )}

      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock
          title={`${selected?.label ?? 'Originating Process'} — Draft`}
          content={draft}
          onClear={() => { setDraft(''); onSave({ origProcessDraft: '' }); }}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// C.1 NEW — WITNESS STATEMENT ON OATH DRAFTER (Claimant)
// ─────────────────────────────────────────────────────────────────────────────

function WitnessStatementDrafter({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [witnessName, setWitnessName]   = useState(data.witnessName ?? '');
  const [witnessRole, setWitnessRole]   = useState(data.witnessRole ?? '');
  const [context, setContext]           = useState(data.witnessContext ?? '');
  const [draft, setDraft]               = useState(data.witnessStatDraft ?? '');
  const { ask, loading, error }         = ai;

  const run = useCallback(async () => {
    const caseName    = (window as any).__afsActiveCase?.caseName ?? '';
    const court       = (window as any).__afsActiveCase?.court ?? 'High Court';
    const intPkg      = (window as any).__afsActiveCase?.intelligence_data?.intPkg ?? '';

    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT side.

Matter: ${caseName}
Court: ${court}
Witness: ${witnessName} (${witnessRole || 'witness for the claimant'})

Intelligence Package (facts established):
${intPkg ? intPkg.substring(0, 3000) : 'Not available — use the context below.'}

Additional witness-specific facts and instructions:
${context}

Draft a complete Witness Statement on Oath for ${witnessName} in the Nigerian High Court format.

STRUCTURE:
1. Heading: IN THE [COURT] HOLDEN AT [CITY] — Suit No: [case number]
   BETWEEN: [parties as in the originating process]

2. WITNESS STATEMENT ON OATH OF [FULL NAME]

3. Deponent's introduction paragraph:
   "I, [FULL NAME], of [address], do hereby make oath and state as follows:"

4. Personal details paragraph: name, occupation, address, relationship to the matter / capacity as witness

5. Substantive testimony — numbered paragraphs:
   - Each paragraph covers ONE factual point only
   - State facts within the witness's personal knowledge
   - Reference exhibits as Exhibit "[letter]" (e.g. Exhibit "A")
   - Use first person throughout ("I was present at…", "I saw…", "I received…")
   - Distinguish between direct knowledge and information/belief (state source for the latter)
   - Cover all material facts relevant to every head of claim
   - Connect each factual point to the reliefs sought where possible

6. List of exhibits: "Attached hereto and marked Exhibit 'A', 'B', etc. are the following documents: [list]"

7. Deponent's affirmation:
   "The contents of this witness statement are true to the best of my knowledge, information and belief."
   Deponent's signature block: [Signature] / [Name] / [Date]

8. Jurat:
   SWORN to at [City] this [day] day of [month], [year]
   Before me: ________________________________
   Commissioner for Oaths / Notary Public

Nigerian evidence rules:
- Every exhibit must be identified and listed
- Hearsay must be attributed ("I was informed by X that…")  
- Expert opinion paragraphs must state the basis
- No argument or legal conclusions in the body — facts only

Return the complete witness statement draft only.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 2500 });
    if (result) {
      setDraft(result);
      onSave({ witnessName, witnessRole, witnessContext: context, witnessStatDraft: result });
    }
  }, [witnessName, witnessRole, context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Witness Statement on Oath" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Draft a complete sworn witness statement for any witness in this matter. The AI draws from the Intelligence Package and the facts you provide.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <Label text="Witness Full Name" />
          <Input value={witnessName} onChange={setWitnessName} placeholder="e.g. Chukwuemeka Obi" />
        </div>
        <div>
          <Label text="Witness Role / Capacity" />
          <Input value={witnessRole} onChange={setWitnessRole} placeholder="e.g. 1st Claimant, Managing Director, Claimant's agent" />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Facts to Be Covered in the Statement" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={8}
          placeholder={`Set out the key facts this witness will testify to:\n• What the witness saw, did, heard, or received — with dates\n• Documents in the witness's possession (list them — they become exhibits)\n• Any transactions the witness was party to\n• What the witness can say about each head of claim\n• Any admissions or prior communications relevant to the case\n\nNote: If an Intelligence Package exists, it will also inform the draft.`}
        />
      </div>

      <div style={{ marginBottom: 20, background: '#08080e', border: `1px solid ${accent}15`, borderRadius: 6, padding: '10px 14px' }}>
        <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
          ⚖ <strong style={{ color: T.sub }}>Note:</strong> This witness statement must be sworn before a Commissioner for Oaths or Notary Public before it may be filed. Counsel must review and confirm all factual averments with the deponent before swearing.
        </p>
      </div>

      <Btn
        label="Draft Witness Statement on Oath"
        onClick={run}
        loading={loading}
        accent={accent}
        off={!witnessName.trim() || !context.trim()}
      />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock
          title={`Witness Statement — ${witnessName || 'Draft'}`}
          content={draft}
          onClear={() => { setDraft(''); onSave({ witnessStatDraft: '' }); }}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAIMANT TABS
// ─────────────────────────────────────────────────────────────────────────────

function SoCDrafter({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [context, setContext] = useState(data.socContext ?? '');
  const [draft, setDraft]     = useState(data.socDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const caseName = (window as any).__afsActiveCase?.caseName ?? '';
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT side.

Matter: ${caseName}

Case context provided by counsel:
${context}

Draft a complete Statement of Claim in the Nigerian High Court format. Structure:
1. Opening paragraph identifying parties and court
2. Facts pleaded in numbered paragraphs (material facts only, no evidence)
3. Legal basis / cause of action paragraphs
4. Wherefore clause listing all reliefs claimed

Nigerian pleading rules apply:
- Plead material facts, not evidence
- Every relief must be specifically pleaded
- Damages must be particularised where possible
- Use formal Nigerian court pleading language
- Number every paragraph

Return the full draft Statement of Claim.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 2000 });
    if (result) {
      setDraft(result);
      onSave({ socContext: context, socDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Statement of Claim Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Provide the material facts, parties, cause of action, and reliefs sought. The AI will draft a complete Statement of Claim in Nigerian High Court format.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Case Facts, Parties & Reliefs Sought" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={8}
          placeholder="Set out the material facts: who the parties are, what happened, the cause of action, and every relief you are seeking. Include relevant dates and amounts."
        />
      </div>
      <Btn label="Draft Statement of Claim" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Statement of Claim — Draft" content={draft} onClear={() => { setDraft(''); onSave({ socDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function SoDMonitor({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [serviceDate, setServiceDate]       = useState(data.serviceDate ?? '');
  const [sodReceivedDate, setSodReceivedDate] = useState(data.sodReceivedDate ?? '');
  const [sodFiled, setSodFiled]             = useState(data.sodFiled ?? false);
  const [pleadingItems, setPleadingItems]   = useState<PleadingItem[]>(data.pleadingItems ?? []);
  const [advice, setAdvice]                 = useState('');
  const { ask, loading, error } = ai;

  const daysSinceService = daysSince(serviceDate);
  const defaultAvailable = !sodFiled && daysSinceService !== null && daysSinceService >= 30;
  const defaultRisk      = !sodFiled && daysSinceService !== null && daysSinceService >= 21 && daysSinceService < 30;

  const save = (patch: Partial<SavedData>) => {
    onSave({ serviceDate, sodReceivedDate, sodFiled, pleadingItems, ...patch });
  };

  const getAdvice = useCallback(async () => {
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT side.

Service date: ${serviceDate || 'not recorded'}
Days since service: ${daysSinceService ?? 'unknown'}
Statement of Defence filed by defendant: ${sodFiled ? 'YES' : 'NO'}
SoD received date: ${sodReceivedDate || 'N/A'}

Advise on:
1. Whether default judgment is available and the procedural basis (High Court Rules)
2. The correct motion to file — judgment in default of appearance or default of defence
3. The exact steps and documents required to obtain default judgment
4. If SoD was filed — the claimant's next step (respond to any counterclaim, proceed to CMC)

Apply Nigerian High Court (Civil Procedure) Rules. Be specific and practical.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 1200 });
    if (result) setAdvice(result);
  }, [serviceDate, sodFiled, sodReceivedDate, daysSinceService, ask]);

  return (
    <div>
      <SectionTitle text="Statement of Defence Monitor" accent={accent} />

      {/* Status indicators */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={{ background: '#ffffff', border: `1px solid ${defaultAvailable ? '#c05050' : '#cccccc'}`, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Default Judgment</div>
          <div style={{ fontSize: 18, color: defaultAvailable ? '#c05050' : defaultRisk ? '#c09030' : '#40a860', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
            {defaultAvailable ? '⚠ Available' : defaultRisk ? '◎ Approaching' : sodFiled ? '✓ SoD Filed' : '— Monitoring'}
          </div>
          {daysSinceService !== null && (
            <div style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 6 }}>{daysSinceService} days since service</div>
          )}
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #cccccc', borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>SoD Status</div>
          <div style={{ fontSize: 18, color: sodFiled ? '#40a860' : '#c05050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
            {sodFiled ? '✓ Filed' : '✗ Not Filed'}
          </div>
          {sodFiled && sodReceivedDate && (
            <div style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 6 }}>Received {sodReceivedDate}</div>
          )}
        </div>
      </div>

      {/* Dates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <Label text="Date of Service on Defendant" />
          <Input type="date" value={serviceDate} onChange={v => { setServiceDate(v); save({ serviceDate: v }); }} />
        </div>
        <div>
          <Label text="Date SoD Received (if filed)" />
          <Input type="date" value={sodReceivedDate} onChange={v => { setSodReceivedDate(v); save({ sodReceivedDate: v }); }} />
        </div>
      </div>

      {/* SoD toggle */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sodFiled}
            onChange={e => { setSodFiled(e.target.checked); save({ sodFiled: e.target.checked }); }}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: accent }}
          />
          <span style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>
            Defendant has filed Statement of Defence
          </span>
        </label>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Btn label="Get Procedural Advice" onClick={getAdvice} loading={loading} accent={accent} off={!serviceDate} />
      </div>

      {error && <ErrorBlock message={error} />}
      {advice && (
        <ResultBlock title="Procedural Advice — Default Position" content={advice} onClear={() => setAdvice('')} accent={accent} />
      )}

      {/* Tracker */}
      <div style={{ marginTop: 28 }}>
        <SectionTitle text="Pleadings Tracker" accent={accent} />
        <PleadingTracker
          items={pleadingItems}
          onUpdate={items => { setPleadingItems(items); save({ pleadingItems: items }); }}
          accent={accent}
        />
      </div>
    </div>
  );
}

function CounterclaimResponse({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [context, setContext] = useState(data.dtccContext ?? '');
  const [draft, setDraft]     = useState(data.dtccDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const caseName = (window as any).__afsActiveCase?.caseName ?? '';
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT side (who is now defendant to the counterclaim).

Matter: ${caseName}

Counterclaim details and facts to address:
${context}

Draft a complete Defence to Counterclaim in Nigerian High Court format:
1. Traverse (deny) each counterclaim allegation not admitted
2. Raise any affirmative defences to the counterclaim
3. Specifically admit any facts that are admitted
4. Plead any set-off or abatement if applicable
5. Wherefore clause — dismiss counterclaim with costs

Apply Nigerian pleading rules. Number every paragraph. Use formal court language.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 1500 });
    if (result) {
      setDraft(result);
      onSave({ dtccContext: context, dtccDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Defence to Counterclaim Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Summarise the counterclaim allegations and any defences available. The AI will draft a Defence to Counterclaim in Nigerian High Court format.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Counterclaim Allegations & Available Defences" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={7}
          placeholder="Set out what the defendant is claiming in the counterclaim, the reliefs they seek, and any grounds on which the counterclaim should be resisted."
        />
      </div>
      <Btn label="Draft Defence to Counterclaim" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Defence to Counterclaim — Draft" content={draft} onClear={() => { setDraft(''); onSave({ dtccDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function DefaultFlag({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [serviceDate, setServiceDate] = useState(data.serviceDate ?? '');
  const [sodFiled, setSodFiled]       = useState(data.sodFiled ?? false);
  const [court, setCourt]             = useState('');
  const [draft, setDraft]             = useState('');
  const { ask, loading, error } = ai;

  const days            = daysSince(serviceDate);
  const defaultAvailable = !sodFiled && days !== null && days >= 30;

  const draftMotion = useCallback(async () => {
    const prompt = `You are acting as Nigerian civil litigation counsel for the CLAIMANT.

Court: ${court || 'High Court'}
Service date: ${serviceDate}
Days since service: ${days}
Statement of Defence filed: ${sodFiled ? 'Yes' : 'No'}

Draft a complete Motion for Judgment in Default of Defence. Include:
1. Motion on Notice heading with parties and court
2. Application paragraph citing the relevant High Court Rules provision
3. Supporting affidavit structure (deponent, facts, exhibits required)
4. List of proposed exhibits (proof of service, copy of SoC, etc.)
5. Relief(s) sought
6. Certificate of service

Apply the relevant Nigerian High Court Civil Procedure Rules for default judgment in default of defence.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 1500 });
    if (result) setDraft(result);
  }, [court, serviceDate, days, sodFiled, ask]);

  return (
    <div>
      <SectionTitle text="Default Judgment Readiness" accent={accent} />

      {/* Readiness card */}
      <div style={{
        background: defaultAvailable ? '#1a0808' : '#ffffff',
        border: `1px solid ${defaultAvailable ? '#c05050' : '#cccccc'}`,
        borderRadius: 10, padding: '20px 22px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 22, color: defaultAvailable ? '#c05050' : T.mute }}>
            {defaultAvailable ? '⚠' : days !== null && days >= 21 ? '◎' : '◦'}
          </span>
          <div>
            <div style={{ fontSize: 14, color: defaultAvailable ? '#c05050' : T.sub, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
              {defaultAvailable
                ? 'Default Judgment Available'
                : days !== null && days >= 21 && !sodFiled
                ? 'Approaching Default Window'
                : sodFiled
                ? 'SoD Filed — No Default'
                : 'Monitor Service Date'}
            </div>
            {days !== null && (
              <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 4 }}>
                {days} day{days !== 1 ? 's' : ''} since service
                {!sodFiled && days < 30 ? ` — default available in ${30 - days} day${30 - days !== 1 ? 's' : ''}` : ''}
              </div>
            )}
          </div>
        </div>
        {defaultAvailable && (
          <p style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.5 }}>
            The defendant has not filed a Statement of Defence within 30 days of service. You may apply for judgment in default of defence under the applicable High Court Rules.
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <Label text="Date of Service" />
          <Input type="date" value={serviceDate} onChange={v => { setServiceDate(v); onSave({ serviceDate: v }); }} />
        </div>
        <div>
          <Label text="Court" />
          <Input value={court} onChange={setCourt} placeholder="e.g. High Court of Lagos State" />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sodFiled}
            onChange={e => { setSodFiled(e.target.checked); onSave({ sodFiled: e.target.checked }); }}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: accent }}
          />
          <span style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>
            Defendant has filed a Statement of Defence
          </span>
        </label>
      </div>

      <Btn label="Draft Default Judgment Motion" onClick={draftMotion} loading={loading} accent={accent} off={!serviceDate || sodFiled} />
      {!defaultAvailable && !sodFiled && serviceDate && (
        <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 10 }}>
          Default judgment motion will be available after 30 days from service date.
        </p>
      )}
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Default Judgment Motion — Draft" content={draft} onClear={() => setDraft('')} accent={accent} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENDANT TABS
// ─────────────────────────────────────────────────────────────────────────────

function SoDDrafter({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [context, setContext] = useState(data.sodContext ?? '');
  const [draft, setDraft]     = useState(data.sodDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const caseName = (window as any).__afsActiveCase?.caseName ?? '';
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT side.

Matter: ${caseName}

Defence context and instructions from counsel:
${context}

Draft a complete Statement of Defence in Nigerian High Court format:
1. Opening paragraph identifying the defendant and this defence
2. Traverse each paragraph of the Statement of Claim:
   - Para X is admitted / denied / not admitted
3. Affirmative defences pleaded in numbered paragraphs (e.g. limitation, accord and satisfaction, estoppel, laches)
4. Counterclaim section (if applicable — draft if facts warrant cross-relief)
5. Wherefore clause — claim dismissal of the action with costs

Nigerian pleading rules apply:
- Every allegation not admitted is deemed denied
- Plead material facts constituting defences, not evidence
- State the specific defence(s) clearly
- Number every paragraph

Return the full draft Statement of Defence.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 2000 });
    if (result) {
      setDraft(result);
      onSave({ sodContext: context, sodDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Statement of Defence Drafter" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Provide the claimant's allegations, available defences, any admissions, and whether a counterclaim is warranted. The AI drafts a complete Statement of Defence.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Claimant's Allegations, Available Defences & Admissions" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={8}
          placeholder="Summarise the SoC allegations paragraph by paragraph, state what is admitted, what is denied, and what affirmative defences apply. Note if a counterclaim is warranted."
        />
      </div>
      <Btn label="Draft Statement of Defence" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Statement of Defence — Draft" content={draft} onClear={() => { setDraft(''); onSave({ sodDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function CounterclaimBuilder({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [context, setContext] = useState(data.counterclaimContext ?? '');
  const [draft, setDraft]     = useState(data.counterclaimDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const caseName = (window as any).__afsActiveCase?.caseName ?? '';
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT.

Matter: ${caseName}

Counterclaim facts and reliefs:
${context}

Draft a complete Counterclaim to be included within the Statement of Defence. Structure:
1. Counterclaim heading (after main defence)
2. Material facts founding the counterclaim in numbered paragraphs
3. Cause of action identified
4. Reliefs claimed — numbered list with specific amounts/orders where possible
5. Wherefore the defendant-counterclaimant claims (list of reliefs)

Apply Nigerian pleading rules. This counterclaim forms part of the Statement of Defence.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 1500 });
    if (result) {
      setDraft(result);
      onSave({ counterclaimContext: context, counterclaimDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Counterclaim Builder" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Provide the facts founding the counterclaim and the reliefs the defendant seeks. The AI drafts the Counterclaim section for inclusion in the Statement of Defence.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Counterclaim Facts & Reliefs Sought" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={7}
          placeholder="Describe the basis for the counterclaim: the defendant's cause of action against the claimant, material facts, and specific reliefs to be claimed (damages, declarations, injunctions, etc.)."
        />
      </div>
      <Btn label="Draft Counterclaim" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Counterclaim — Draft" content={draft} onClear={() => { setDraft(''); onSave({ counterclaimDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function PreliminaryObjDrafter({ data, onSave, accent, ai, systemCtx }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string; ai: ReturnType<typeof useAI>; systemCtx: string }) {
  const [context, setContext] = useState(data.objectionContext ?? '');
  const [draft, setDraft]     = useState(data.objectionDraft ?? '');
  const { ask, loading, error } = ai;

  const run = useCallback(async () => {
    const caseName = (window as any).__afsActiveCase?.caseName ?? '';
    const prompt = `You are acting as Nigerian civil litigation counsel for the DEFENDANT.

Matter: ${caseName}

Grounds and case details for the preliminary objection:
${context}

Analyse whether a preliminary objection is available and draft accordingly.

Assess for these grounds (apply each to the facts):
1. Jurisdiction — does the court lack jurisdiction over the subject matter or parties?
2. Competence of originating process — is the process defective in form or substance?
3. Limitation — has the limitation period expired under the Limitation Law?
4. Locus standi — does the claimant have standing to bring this action?
5. Non-disclosure of cause of action — does the SoC disclose a reasonable cause of action?
6. Failure of pre-conditions — were statutory notices or pre-action requirements complied with?
7. Improper parties — misjoinder or non-joinder of necessary parties

Then draft:
A. Notice of Preliminary Objection (formal notice)
B. Points of Argument on each valid ground with supporting Nigerian authorities
C. Relief sought — that the suit be struck out / dismissed with costs

Apply Nigerian High Court Rules and relevant authorities.`;

    const result = await ask({ system: systemCtx, userMsg: prompt, maxTokens: 2000 });
    if (result) {
      setDraft(result);
      onSave({ objectionContext: context, objectionDraft: result });
    }
  }, [context, ask, onSave]);

  return (
    <div>
      <SectionTitle text="Preliminary Objection Grounds & Draft" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Describe the case and any suspected procedural defects. The AI will assess all preliminary objection grounds and draft the Notice and Points of Argument.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Label text="Case Facts, Originating Process Details & Suspected Defects" />
        <Textarea
          value={context}
          onChange={setContext}
          rows={7}
          placeholder="Describe: the claimant's cause of action, the originating process used, the court seized, relevant dates (when cause of action arose, when writ was filed), and any apparent procedural irregularities."
        />
      </div>
      <Btn label="Analyse Grounds & Draft Objection" onClick={run} loading={loading} accent={accent} off={!context.trim()} />
      {error && <ErrorBlock message={error} />}
      {draft && (
        <ResultBlock title="Preliminary Objection — Grounds & Draft" content={draft} onClear={() => { setDraft(''); onSave({ objectionDraft: '' }); }} accent={accent} />
      )}
    </div>
  );
}

function ReplyMonitor({ data, onSave, accent }: { data: SavedData; onSave: (d: Partial<SavedData>) => void; accent: string }) {
  const [replyReceived, setReplyReceived] = useState(data.replyReceived ?? false);
  const [replyDate, setReplyDate]         = useState(data.replyDate ?? '');
  const [pleadingItems, setPleadingItems] = useState<PleadingItem[]>(data.pleadingItems ?? []);

  const save = (patch: Partial<SavedData>) =>
    onSave({ replyReceived, replyDate, pleadingItems, ...patch });

  const daysAwaiting = !replyReceived ? daysSince(data.sodReceivedDate ?? '') : null;

  return (
    <div>
      <SectionTitle text="Reply Monitor" accent={accent} />
      <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 18, lineHeight: 1.6 }}>
        Track the claimant's Reply to the Statement of Defence. A claimant is not obliged to file a Reply unless new matters were raised in the SoD. If a Counterclaim was included, the claimant must file a Defence to Counterclaim.
      </p>

      {/* Status card */}
      <div style={{ background: '#ffffff', border: `1px solid ${replyReceived ? '#40a860' : '#c0903050'}`, borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, color: replyReceived ? '#40a860' : '#c09030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 6 }}>
          {replyReceived ? '✓ Reply Received' : '— Awaiting Claimant Reply'}
        </div>
        {daysAwaiting !== null && !replyReceived && (
          <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
            {daysAwaiting} days since SoD filed
          </div>
        )}
        {replyReceived && replyDate && (
          <div style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>Received on {replyDate}</div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={replyReceived}
              onChange={e => { setReplyReceived(e.target.checked); save({ replyReceived: e.target.checked }); }}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: accent }}
            />
            <span style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>
              Reply received from claimant
            </span>
          </label>
        </div>
        {replyReceived && (
          <div>
            <Label text="Date Reply Received" />
            <Input type="date" value={replyDate} onChange={v => { setReplyDate(v); save({ replyDate: v }); }} />
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionTitle text="Pleadings Tracker" accent={accent} />
        <PleadingTracker
          items={pleadingItems}
          onUpdate={items => { setPleadingItems(items); save({ pleadingItems: items }); }}
          accent={accent}
        />
      </div>

      <div style={{ marginTop: 20, background: '#08080e', border: `1px solid ${accent}20`, borderRadius: 8, padding: '16px 18px' }}>
        <SectionTitle text="Pleadings Closure Note" accent={accent} />
        <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.7 }}>
          Under Nigerian High Court Rules, pleadings close after the Statement of Defence (or Reply if filed). Once pleadings are closed, the matter proceeds to the Case Management Conference (CMC). The defendant should prepare for CMC by identifying the issues for trial.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function PleadingsEngine({ activeCase }: Props) {
  const isClaim = activeCase.counsel_role === 'claimant_side';
  const accent  = activeCase.counsel_role
    ? COUNSEL_ROLE_COLORS[activeCase.counsel_role].col
    : '#4090d0';

  // Store activeCase on window for sub-component access to caseName
  (window as any).__afsActiveCase = activeCase;

  const claimTabs = [
    { id: 'originating_process',   label: 'Originating Process' },
    { id: 'soc_drafter',           label: 'SoC Drafter' },
    { id: 'witness_statement',     label: 'Witness Statement' },
    { id: 'sod_monitor',           label: 'SoD Monitor' },
    { id: 'counterclaim_response', label: 'Counterclaim Response' },
    { id: 'default_flag',          label: 'Default Flag' },
  ];

  const defTabs = [
    { id: 'sod_drafter',           label: 'SoD Drafter' },
    { id: 'counterclaim_builder',  label: 'Counterclaim Builder' },
    { id: 'preliminary_objection', label: 'Preliminary Objection' },
    { id: 'reply_monitor',         label: 'Reply Monitor' },
  ];

  const tabs = isClaim ? claimTabs : defTabs;

  const [activeTab, setActiveTab] = useState<SubTab>(
    isClaim ? 'originating_process' : 'sod_drafter'
  );

  const [data, setData]       = useState<SavedData>(DEFAULT_DATA);
  const [loaded, setLoaded]   = useState(false);
  const ai                    = useAI(activeCase);
  const { fullContext } = useIntelligence(activeCase);
  const systemCtx = buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role) + fullContext;

  // ── Load persisted data ────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    loadBlindSpot<SavedData>(activeCase.id, MODULE, DEFAULT_DATA).then(d => {
      if (live) { setData(d); setLoaded(true); }
    });
    return () => { live = false; };
  }, [activeCase.id]);

  // ── Save helper ────────────────────────────────────────────────────────────
  const onSave = useCallback((patch: Partial<SavedData>) => {
    setData(prev => {
      const next = { ...prev, ...patch, lastUpdated: new Date().toISOString() };
      saveBlindSpot(activeCase.id, MODULE, next);
      return next;
    });
  }, [activeCase.id]);

  if (!loaded) {
    return (
      <div style={{ padding: 40, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13 }}>
        Loading Pleadings Engine…
      </div>
    );
  }

  // ── Phase 6 guard — Writ of Summons only ──────────────────────────────────
  // FREP and Matrimonial cases never reach this engine via their tab sets
  // (Phase 4/5), but this is a safety net against direct navigation or future
  // routing changes. Render a clear message rather than a broken engine.
  if (activeCase.originating_process && activeCase.originating_process !== 'writ_of_summons') {
    return (
      <div style={{
        padding: '32px 28px',
        background: '#fafaf8',
        border: '1px solid #cccccc',
        borderRadius: 6,
        fontFamily: "'Times New Roman', Times, serif",
      }}>
        <p style={{ fontSize: 11, color: '#888888', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 8 }}>
          Engine Unavailable
        </p>
        <p style={{ fontSize: 14, color: '#111111', fontWeight: 700, marginBottom: 6 }}>
          Pleadings Engine — Writ of Summons only
        </p>
        <p style={{ fontSize: 13, color: '#555555', lineHeight: 1.65 }}>
          The Pleadings Engine is only available for Writ of Summons matters.
          This matter was commenced by <strong>{activeCase.originating_process.replace(/_/g, ' ')}</strong> and
          uses a different procedural flow. Navigate using the tabs above.
        </p>
      </div>
    );
  }

  // Validate role
  if (activeCase.counsel_role !== 'claimant_side' && activeCase.counsel_role !== 'defendant_side') {
    return (
      <div style={{ padding: 32, background: '#08080e', border: '1px solid #cccccc', borderRadius: 8 }}>
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
          The Pleadings Engine is only available on civil matters. This matter is on the criminal track.
        </p>
      </div>
    );
  }

  const sharedProps = { data, onSave, accent, ai, systemCtx };

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 18, color: accent }}>📜</span>
          <h3 style={{ fontSize: 18, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, margin: 0 }}>
            Pleadings Engine
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
            ? 'Draft originating processes, pleadings, and witness statements. Monitor the defendant\'s response and track default judgment opportunities.'
            : 'Draft your defence, build counterclaims, identify preliminary objection grounds, and track pleadings.'}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar tabs={tabs} active={activeTab} onSelect={id => setActiveTab(id as SubTab)} accent={accent} />

      {/* Content */}
      <div>
        {/* CLAIMANT tabs */}
        {isClaim && activeTab === 'originating_process'   && <OriginatingProcessDrafter   {...sharedProps} />}
        {isClaim && activeTab === 'soc_drafter'           && <SoCDrafter              {...sharedProps} />}
        {isClaim && activeTab === 'witness_statement'     && <WitnessStatementDrafter     {...sharedProps} />}
        {isClaim && activeTab === 'sod_monitor'           && <SoDMonitor              {...sharedProps} />}
        {isClaim && activeTab === 'counterclaim_response' && <CounterclaimResponse    {...sharedProps} />}
        {isClaim && activeTab === 'default_flag'          && <DefaultFlag             {...sharedProps} />}

        {/* DEFENDANT tabs */}
        {!isClaim && activeTab === 'sod_drafter'           && <SoDDrafter             {...sharedProps} />}
        {!isClaim && activeTab === 'counterclaim_builder'  && <CounterclaimBuilder    {...sharedProps} />}
        {!isClaim && activeTab === 'preliminary_objection' && <PreliminaryObjDrafter  {...sharedProps} />}
        {!isClaim && activeTab === 'reply_monitor'         && <ReplyMonitor           data={data} onSave={onSave} accent={accent} />}
      </div>
    </div>
  );
}
