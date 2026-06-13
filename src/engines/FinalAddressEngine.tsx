/**
 * AFS Legal OS V2 — Final Address Engine (Phase A)
 *
 * Dual-role criminal engine: final written addresses after close of evidence.
 *
 * PROSECUTION sub-tabs:
 *   1. Final Address Drafter  — AI builds from proved counts, witnesses, exhibits
 *   2. Reply on Points of Law — prosecution reply to defence points of law
 *   3. Address Status         — date filed, adopted
 *
 * DEFENCE sub-tabs:
 *   1. Final Address Drafter  — AI builds from prosecution gaps, credibility failures, no-case grounds
 *   2. Reply on Points of Law — defence reply on points of law
 *   3. Address Status         — date filed, adopted
 *
 * Storage: `final_address_${caseId}`. AI via useAI(activeCase).
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

type DefSubTab  = 'def_drafter' | 'def_reply' | 'def_status';
type ProsSubTab = 'pros_drafter' | 'pros_reply' | 'pros_status';
type SubTab     = DefSubTab | ProsSubTab;

type FilingStatus = 'Not Filed' | 'Draft Ready' | 'Filed' | 'Adopted';

interface AddressStatus {
  status:       FilingStatus;
  dateFiled:    string;
  dateAdopted:  string;
  notes:        string;
}

interface SavedData {
  // Prosecution
  prosContext?:    string;
  prosAddress?:    string;
  prosReply?:      string;
  prosReplyDraft?: string;
  prosStatus?:     AddressStatus;
  // Defence
  defContext?:     string;
  defAddress?:     string;
  defReply?:       string;
  defReplyDraft?:  string;
  defStatus?:      AddressStatus;
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
// PROSECUTION FINAL ADDRESS DRAFTER
// ─────────────────────────────────────────────────────────────────────────────

function ProsDrafterTab({ prosContext, setProsContext, prosAddress, setProsAddress, accent, activeCase }: {
  prosContext: string; setProsContext: (v: string) => void;
  prosAddress: string; setProsAddress: (v: string) => void;
  accent: string; activeCase: Case;
}) {
  const { call, loading, error } = useAI(activeCase);

  const draft = useCallback(async () => {
    const intPkg = activeCase.intelligence_data?.intPkg ?? '';
    const r = await call({
      system: `You are a Nigerian prosecution counsel drafting a final written address for filing in court at the close of a criminal trial. Apply ACJA 2015, Evidence Act 2011, and the criminal procedure of the relevant court. Your address must analyse the evidence, apply the law, and make specific submissions on each count. Use formal Nigerian court drafting.`,
      userMsg: `Draft a prosecution Final Written Address for: ${activeCase.caseName} at ${activeCase.court}.

Case facts and Intelligence Package: ${intPkg ? intPkg.slice(0, 1000) : '[not available]'}

Additional prosecution context (proved counts, witnesses, exhibits, defence highlights):
${prosContext || '[not provided — generate from case facts above]'}

Draft a complete prosecution Final Written Address in this structure:

1. **Introduction** — formal caption; statement that the prosecution closed its case and invites the court to convict
2. **Summary of Prosecution Case** — brief narrative of what was proved
3. **Issues for Determination** — identify the key legal and factual issues
4. **Evidence Analysis per Count** — for each count:
   a. State the charge and essential ingredients
   b. Summarise prosecution evidence on each ingredient (witness, exhibit, page reference)
   c. Address any defence challenge to that evidence
   d. Conclude: prosecution has proved this ingredient beyond reasonable doubt
5. **Defence Evidence Assessment** — explain why defence evidence should be rejected or has failed to raise reasonable doubt
6. **Witness Credibility** — assess prosecution witnesses as credible and consistent; address any inconsistencies
7. **Legal Submissions** — any point of law on admissibility, proof standard, or applicable statute
8. **Authorities** — cite Nigerian authorities supporting the submissions
9. **Conclusion and Prayer** — invite the court to convict the accused on named counts and pass appropriate sentence

Note: All citations must follow the Library Rule — cite only authorities from the case library. Where uncertain, state "to be confirmed from authorities."`,
    });
    if (r) setProsAddress(r);
  }, [prosContext, activeCase, call, setProsAddress]);

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Prosecution Final Address Drafter</h3>
        <p style={dimS}>
          Generate a complete prosecution final written address. The AI draws from the
          Intelligence Package and your input on proved counts, witnesses, and exhibits.
          Edit the draft before filing.
        </p>

        <div style={{
          padding: '12px 16px', background: `${accent}08`,
          border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
          fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
        }}>
          <strong style={{ color: accent }}>Prosecution Standard</strong>
          {' '}— The prosecution must prove each essential ingredient of each count beyond
          reasonable doubt. The final address should systematically demonstrate, ingredient
          by ingredient and count by count, that this standard has been met. Do not assert —
          point to specific evidence.
        </div>

        <label style={labelS}>
          Prosecution Case Summary — Proved Counts, Key Witnesses, Exhibits, Defence Highlights
        </label>
        <textarea
          style={{ ...taS, minHeight: 200, marginBottom: 14 }}
          value={prosContext}
          onChange={e => setProsContext(e.target.value)}
          placeholder={`Summarise the prosecution case as proved. Include:
• Counts in the charge and which are fully proved
• Key prosecution witnesses (PW1, PW2...) and what each proved
• Exhibits admitted (Exh. A, B...) and what they establish
• Defence witnesses called and why their evidence should be rejected
• Any points of law you want addressed
• Any inconsistencies in prosecution evidence you want to address pre-emptively`}
        />

        <Btn
          onClick={draft}
          loading={loading}
          disabled={!prosContext.trim() && !activeCase.intelligence_data?.intPkg}
          label="Draft Prosecution Final Address"
          accent={accent}
        />
        {error && <ErrorBlock message={error} />}
      </div>

      {prosAddress && (
        <div style={cardS}>
          <h3 style={hS}>Prosecution Final Written Address (Draft)</h3>
          <p style={dimS}>Edit before filing. All authorities must be verified in the library.</p>
          <textarea
            style={{ ...taS, minHeight: 600 }}
            value={prosAddress}
            onChange={e => setProsAddress(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => setProsAddress('')}
              style={{
                background: 'transparent', border: '1px solid #301818',
                color: '#c05050', borderRadius: 5, padding: '6px 16px',
                fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              }}
            >
              clear draft ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE FINAL ADDRESS DRAFTER
// ─────────────────────────────────────────────────────────────────────────────

function DefDrafterTab({ defContext, setDefContext, defAddress, setDefAddress, accent, activeCase }: {
  defContext: string; setDefContext: (v: string) => void;
  defAddress: string; setDefAddress: (v: string) => void;
  accent: string; activeCase: Case;
}) {
  const { call, loading, error } = useAI(activeCase);

  const draft = useCallback(async () => {
    const intPkg = activeCase.intelligence_data?.intPkg ?? '';
    const r = await call({
      system: `You are a Nigerian criminal defence counsel drafting a final written address for filing in court at the close of a criminal trial. Apply ACJA 2015, Evidence Act 2011, and relevant criminal procedure. Your address must relentlessly identify prosecution failures, credibility breakdowns, and reasonable doubt on each count. Use formal Nigerian court drafting.`,
      userMsg: `Draft a defence Final Written Address for: ${activeCase.caseName} at ${activeCase.court}.

Case facts and Intelligence Package: ${intPkg ? intPkg.slice(0, 1000) : '[not available]'}

Defence context (prosecution gaps, credibility failures, no-case grounds, defence witnesses):
${defContext || '[not provided — generate from case facts above]'}

Draft a complete defence Final Written Address in this structure:

1. **Introduction** — formal caption; statement of the principle that the accused is presumed innocent until proved guilty beyond reasonable doubt
2. **The Burden and Standard of Proof** — explain the principle and that the burden never shifts; cite Woolmington v DPP and Nigerian authorities
3. **Summary of Prosecution's Failures** — brief narrative of what the prosecution failed to prove
4. **Issues for Determination** — identify the key factual and legal issues
5. **Evidence Analysis per Count** — for each count:
   a. State the charge and each essential ingredient
   b. Identify precisely which ingredient(s) prosecution failed to prove, and why
   c. Point to specific testimonial or exhibit failures (which witness was inconsistent, which exhibit was wrongly admitted)
   d. Conclude: prosecution has failed to prove this count beyond reasonable doubt
6. **Credibility of Prosecution Witnesses** — systematically attack credibility: inconsistencies, contradictions, interest in outcome, demeanour
7. **Defence Evidence** — where defence witnesses were called, explain what their evidence established
8. **Points of Law** — any point on admissibility, jurisdiction, duplicity, or constitutional rights
9. **Authorities** — cite Nigerian criminal authorities in support
10. **Conclusion and Prayer** — invite the court to discharge and acquit the accused on all counts / named counts

Note: All citations must follow the Library Rule. Where uncertain, state "to be confirmed from authorities."`,
    });
    if (r) setDefAddress(r);
  }, [defContext, activeCase, call, setDefAddress]);

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>Defence Final Address Drafter</h3>
        <p style={dimS}>
          Generate a complete defence final written address built from prosecution gaps,
          credibility failures, and surviving no-case grounds. Edit before filing.
        </p>

        <div style={{
          padding: '12px 16px', background: `${accent}08`,
          border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
          fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
        }}>
          <strong style={{ color: accent }}>Defence Standard</strong>
          {' '}— The defence does not need to prove innocence. The address must demonstrate
          that the prosecution has failed to eliminate reasonable doubt on at least one essential
          ingredient of each count. One gap in one ingredient on any count = acquittal on that count.
        </div>

        <label style={labelS}>
          Defence Analysis — Prosecution Gaps, Credibility Failures, Defence Evidence, Points of Law
        </label>
        <textarea
          style={{ ...taS, minHeight: 200, marginBottom: 14 }}
          value={defContext}
          onChange={e => setDefContext(e.target.value)}
          placeholder={`Provide the defence analysis. Include:
• Each count and the specific ingredient(s) prosecution failed to prove
• Prosecution witnesses who were inconsistent or discredited during cross-examination
• Any admissibility objections that should be reviewed
• No-case grounds that survived even if technically overruled
• Defence witnesses called and what they established
• Any constitutional rights violations (unlawful arrest, confession under duress)
• Points of law the court must consider`}
        />

        <Btn
          onClick={draft}
          loading={loading}
          disabled={!defContext.trim() && !activeCase.intelligence_data?.intPkg}
          label="Draft Defence Final Address"
          accent={accent}
        />
        {error && <ErrorBlock message={error} />}
      </div>

      {defAddress && (
        <div style={cardS}>
          <h3 style={hS}>Defence Final Written Address (Draft)</h3>
          <p style={dimS}>Edit before filing. Verify all authorities cited.</p>
          <textarea
            style={{ ...taS, minHeight: 600 }}
            value={defAddress}
            onChange={e => setDefAddress(e.target.value)}
          />
          <button
            onClick={() => setDefAddress('')}
            style={{
              marginTop: 10, background: 'transparent', border: '1px solid #301818',
              color: '#c05050', borderRadius: 5, padding: '6px 16px',
              fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}
          >
            clear draft ×
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPLY ON POINTS OF LAW
// ─────────────────────────────────────────────────────────────────────────────

function ReplyTab({ replyContext, setReplyContext, replyDraft, setReplyDraft, accent, activeCase, isPros }: {
  replyContext: string; setReplyContext: (v: string) => void;
  replyDraft: string; setReplyDraft: (v: string) => void;
  accent: string; activeCase: Case; isPros: boolean;
}) {
  const { call, loading, error } = useAI(activeCase);

  const draft = useCallback(async () => {
    if (!replyContext.trim()) return;
    const r = await call({
      system: isPros
        ? `You are a Nigerian prosecution counsel drafting a reply on points of law to the defence final address. A reply is limited to new points of law raised by the defence — you cannot re-argue the entire case. Be precise and cite authority.`
        : `You are a Nigerian criminal defence counsel drafting a reply on points of law to the prosecution final address. A reply is limited to new legal points raised by prosecution — do not re-argue. Be precise and cite authority.`,
      userMsg: `Draft a ${isPros ? 'prosecution' : 'defence'} Reply on Points of Law for: ${activeCase.caseName}.

${isPros ? 'Defence address highlights / new points of law raised' : 'Prosecution address highlights / new points of law raised'}:
${replyContext}

Draft a formal Reply on Points of Law. Structure:
1. **Introduction** — nature and scope of the right of reply (limited to new points of law only)
2. **New Points of Law Identified** — list the new legal points raised by the opposing address
3. **Reply per Point** — for each new legal point: (a) restate the opposing submission, (b) cite the correct authority, (c) explain why the opposing submission is wrong in law
4. **Conclusion** — maintain the prayer from the Final Address

The reply must not introduce new facts or re-argue the evidence. It is confined to law only.`,
    });
    if (r) setReplyDraft(r);
  }, [replyContext, isPros, activeCase, call, setReplyDraft]);

  return (
    <div style={cardS}>
      <h3 style={hS}>{isPros ? 'Prosecution' : 'Defence'} Reply on Points of Law</h3>
      <p style={dimS}>
        A reply on points of law is confined strictly to new points of law raised in the
        opposing side's final address. It cannot be used to re-argue the case or introduce
        new facts. This is a right that must be exercised judiciously.
      </p>

      <div style={{
        padding: '12px 16px', background: `${accent}08`,
        border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
        fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
      }}>
        <strong style={{ color: accent }}>Scope of Reply</strong>
        {' '}— A reply on points of law is available as of right where the opposing side raises
        a new point of law in their address that was not in your original address. It is strictly
        confined to law — no new evidence, no new facts.
      </div>

      <label style={labelS}>
        New Points of Law from {isPros ? 'Defence' : 'Prosecution'} Address (summarise each)
      </label>
      <textarea
        style={{ ...taS, minHeight: 180, marginBottom: 14 }}
        value={replyContext}
        onChange={e => setReplyContext(e.target.value)}
        placeholder={`Paste or summarise each new point of law raised by the ${isPros ? 'defence' : 'prosecution'} that was not in your own original address. Include: the specific legal proposition, how they argued it, and any authority they cited.`}
      />

      <Btn
        onClick={draft}
        loading={loading}
        disabled={!replyContext.trim()}
        label={`Draft ${isPros ? 'Prosecution' : 'Defence'} Reply`}
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}

      {replyDraft && (
        <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${accent}30`, borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              {isPros ? 'Prosecution' : 'Defence'} Reply — Draft
            </span>
            <button onClick={() => setReplyDraft('')} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
              clear ×
            </button>
          </div>
          <Md text={replyDraft} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS STATUS
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_OPTS: FilingStatus[] = ['Not Filed', 'Draft Ready', 'Filed', 'Adopted'];
const STATUS_COLORS: Record<FilingStatus, { bg: string; col: string; bdr: string }> = {
  'Not Filed':   { bg: '#101018', col: '#505080', bdr: '#202030' },
  'Draft Ready': { bg: '#181000', col: '#b08030', bdr: '#3a2800' },
  'Filed':       { bg: '#0d1800', col: '#50c050', bdr: '#285000' },
  'Adopted':     { bg: '#071810', col: '#40b068', bdr: '#1a4028' },
};

function StatusTab({ status, setStatus, accent, isPros }: {
  status: AddressStatus;
  setStatus: (fn: (p: AddressStatus) => AddressStatus) => void;
  accent: string;
  isPros: boolean;
}) {
  const update = (field: keyof AddressStatus, value: string | FilingStatus) =>
    setStatus(p => ({ ...p, [field]: value }));

  const col = STATUS_COLORS[status.status];

  return (
    <div style={cardS}>
      <h3 style={hS}>{isPros ? 'Prosecution' : 'Defence'} Address Status</h3>
      <p style={dimS}>
        Track the filing and adoption status of the final written address.
        Mark as Adopted once it is read into the record in court.
      </p>

      <div style={{
        marginBottom: 22, padding: '18px 20px',
        background: col.bg, border: `2px solid ${col.bdr}`,
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, color: col.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          Current Status
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_OPTS.map(o => (
            <button
              key={o}
              onClick={() => update('status', o)}
              style={{
                background:    status.status === o ? `${col.col}20` : 'transparent',
                border:        `1px solid ${status.status === o ? col.col : '#404050'}`,
                color:         status.status === o ? col.col : '#707080',
                borderRadius:  5, padding: '7px 16px',
                fontSize:      12, fontFamily: "'Times New Roman', Times, serif",
                cursor:        'pointer', fontWeight: status.status === o ? 700 : 400,
              }}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelS}>Date Filed</label>
          <input
            type="date" style={iS}
            value={status.dateFiled}
            onChange={e => update('dateFiled', e.target.value)}
          />
        </div>
        <div>
          <label style={labelS}>Date Adopted</label>
          <input
            type="date" style={iS}
            value={status.dateAdopted}
            onChange={e => update('dateAdopted', e.target.value)}
          />
        </div>
      </div>

      <label style={labelS}>Notes</label>
      <textarea
        style={{ ...taS, minHeight: 80 }}
        value={status.notes}
        onChange={e => update('notes', e.target.value)}
        placeholder="e.g. Filed and served on opposing counsel 10 June 2025. Adoption adjourned to 20 June 2025."
      />

      {status.status === 'Adopted' && (
        <div style={{ marginTop: 18, padding: '14px 18px', background: '#071810', border: '1px solid #285000', borderRadius: 6 }}>
          <p style={{ fontSize: 13, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
            ✓ Address adopted. The matter is now with the court for judgment. Monitor judgment date and ensure you are present for delivery.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'final_address';

const defaultStatus = (): AddressStatus => ({
  status: 'Not Filed', dateFiled: '', dateAdopted: '', notes: '',
});

export function FinalAddressEngine({ activeCase }: Props) {
  const role      = activeCase.counsel_role ?? 'defence';
  const isPros    = role === 'prosecution';
  const isDefence = !isPros;
  const accent    = COUNSEL_ROLE_COLORS[role]?.col ?? '#40a860';

  const prosSubTabs: { id: ProsSubTab; label: string }[] = [
    { id: 'pros_drafter', label: '1 — Address Drafter' },
    { id: 'pros_reply',   label: '2 — Reply on Points of Law' },
    { id: 'pros_status',  label: '3 — Address Status' },
  ];
  const defSubTabs: { id: DefSubTab; label: string }[] = [
    { id: 'def_drafter', label: '1 — Address Drafter' },
    { id: 'def_reply',   label: '2 — Reply on Points of Law' },
    { id: 'def_status',  label: '3 — Address Status' },
  ];

  const [subTab, setSubTab] = useState<SubTab>(isDefence ? 'def_drafter' : 'pros_drafter');

  // Prosecution state
  const [prosContext,    setProsContext]    = useState('');
  const [prosAddress,    setProsAddress]    = useState('');
  const [prosReplyCtx,   setProsReplyCtx]   = useState('');
  const [prosReplyDraft, setProsReplyDraft] = useState('');
  const [prosStatus,     setProsStatus]     = useState<AddressStatus>(defaultStatus);

  // Defence state
  const [defContext,    setDefContext]    = useState('');
  const [defAddress,    setDefAddress]    = useState('');
  const [defReplyCtx,   setDefReplyCtx]   = useState('');
  const [defReplyDraft, setDefReplyDraft] = useState('');
  const [defStatus,     setDefStatus]     = useState<AddressStatus>(defaultStatus);

  // Load
  useEffect(() => {
    loadBlindSpot(activeCase.id, STORAGE_KEY, null).then((d: SavedData | null) => {
      if (!d) return;
      if (d.prosContext)    setProsContext(d.prosContext);
      if (d.prosAddress)    setProsAddress(d.prosAddress);
      if (d.prosReply)      setProsReplyCtx(d.prosReply);
      if (d.prosReplyDraft) setProsReplyDraft(d.prosReplyDraft);
      if (d.prosStatus)     setProsStatus(d.prosStatus);
      if (d.defContext)     setDefContext(d.defContext);
      if (d.defAddress)     setDefAddress(d.defAddress);
      if (d.defReply)       setDefReplyCtx(d.defReply);
      if (d.defReplyDraft)  setDefReplyDraft(d.defReplyDraft);
      if (d.defStatus)      setDefStatus(d.defStatus);
    }).catch(() => {});
  }, [activeCase.id]);

  // Persist
  const persist = useCallback(() => {
    const data: SavedData = {
      prosContext, prosAddress, prosReply: prosReplyCtx, prosReplyDraft, prosStatus,
      defContext, defAddress, defReply: defReplyCtx, defReplyDraft, defStatus,
    };
    saveBlindSpot(activeCase.id, STORAGE_KEY, data).catch(() => {});
  }, [
    prosContext, prosAddress, prosReplyCtx, prosReplyDraft, prosStatus,
    defContext, defAddress, defReplyCtx, defReplyDraft, defStatus,
    activeCase.id,
  ]);

  useEffect(() => { persist(); }, [persist]);

  const myStatus = isDefence ? defStatus : prosStatus;
  const myAddress = isDefence ? defAddress : prosAddress;

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
          {myAddress && (
            <span style={{
              fontSize: 9, color: '#b08030', fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: '#180f00', border: '1px solid #3a2800',
              padding: '3px 9px', borderRadius: 3,
            }}>
              ✓ DRAFT READY
            </span>
          )}
          {myStatus.status === 'Filed' || myStatus.status === 'Adopted' ? (
            <span style={{
              fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: '#071810', border: '1px solid #285000',
              padding: '3px 9px', borderRadius: 3,
            }}>
              ✓ {myStatus.status.toUpperCase()}
            </span>
          ) : null}
        </div>
        <h2 style={{
          fontSize: 26, color: '#14141e', fontWeight: 300,
          fontFamily: "'Times New Roman', Times, serif", marginBottom: 6,
        }}>
          Final Written Address — {isDefence ? 'Defence' : 'Prosecution'}
        </h2>
        <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {isDefence
            ? 'Draft the defence final written address from prosecution gaps, credibility failures, and surviving no-case grounds. Reply on points of law raised by prosecution.'
            : 'Draft the prosecution final written address from proved counts, witnesses, and exhibits. Reply on new points of law raised by the defence.'}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={isDefence ? defSubTabs : prosSubTabs}
        active={subTab}
        onSelect={id => setSubTab(id as SubTab)}
        accent={accent}
      />

      {/* Prosecution sub-tabs */}
      {isPros && subTab === 'pros_drafter' && (
        <ProsDrafterTab
          prosContext={prosContext} setProsContext={setProsContext}
          prosAddress={prosAddress} setProsAddress={setProsAddress}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'pros_reply' && (
        <ReplyTab
          replyContext={prosReplyCtx} setReplyContext={setProsReplyCtx}
          replyDraft={prosReplyDraft} setReplyDraft={setProsReplyDraft}
          accent={accent} activeCase={activeCase} isPros={true}
        />
      )}
      {isPros && subTab === 'pros_status' && (
        <StatusTab
          status={prosStatus} setStatus={setProsStatus}
          accent={accent} isPros={true}
        />
      )}

      {/* Defence sub-tabs */}
      {isDefence && subTab === 'def_drafter' && (
        <DefDrafterTab
          defContext={defContext} setDefContext={setDefContext}
          defAddress={defAddress} setDefAddress={setDefAddress}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isDefence && subTab === 'def_reply' && (
        <ReplyTab
          replyContext={defReplyCtx} setReplyContext={setDefReplyCtx}
          replyDraft={defReplyDraft} setReplyDraft={setDefReplyDraft}
          accent={accent} activeCase={activeCase} isPros={false}
        />
      )}
      {isDefence && subTab === 'def_status' && (
        <StatusTab
          status={defStatus} setStatus={setDefStatus}
          accent={accent} isPros={false}
        />
      )}
    </div>
  );
}
