/**
 * AFS Advocates — Matrimonial Argument Builder (MArgumentBuilder)
 * Phase 6
 *
 * 7 matrimonial-specific document types:
 *
 *   1. Verifying Affidavit in Support of Petition — O.5 r.10 MCR
 *   2. Affidavit in Support of Leave Application — s.30 MCA
 *   3. Discretion Statement — Form 30, O.11 rr.28–29 MCR, sealed envelope
 *   4. Affidavit in Support of Ancillary Relief Application
 *   5. Written Address — Ancillary Hearing
 *   6. Written Address — Custody and Welfare
 *   7. Written Address — Decree Absolute Application
 *
 * Workflow: Select document type → import intelligence (optional) → add context → generate.
 * Version history persisted per case.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

interface DocType {
  id:          string;
  label:       string;
  icon:        string;
  authority:   string;
  description: string;
  notes:       string;
  promptHint:  string;
}

interface Version {
  id:        string;
  caseId:    string;
  docTypeId: string;
  docLabel:  string;
  context:   string;
  draft:     string;
  createdAt: string;
}

interface SavedData { versions: Version[]; }

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";
const MODULE = 'matrimonial_builder';
const DEFAULT_DATA: SavedData = { versions: [] };

const DOC_TYPES: DocType[] = [
  {
    id:          'verifying_affidavit',
    label:       'Verifying Affidavit in Support of Petition',
    icon:        '§',
    authority:   'O.5 r.10 MCR',
    description: 'The verifying affidavit must accompany every petition for dissolution, nullity, judicial separation, restitution of conjugal rights, or jactitation. It verifies the facts stated in the petition and must be sworn by the petitioner.',
    notes:       'The affidavit must identify the deponent as the petitioner, verify the petition facts paragraph by paragraph, and include the proper jurat. It must be sworn before a Commissioner for Oaths before filing.',
    promptHint:  'petition facts, marriage date and place, facts relied upon (s.15(2) or nullity grounds), children, and relief sought',
  },
  {
    id:          'leave_affidavit',
    label:       'Affidavit in Support of Leave Application (s.30 MCA)',
    icon:        '📅',
    authority:   's.30 MCA · O.4 rr.1–2 MCR',
    description: 'Required where a dissolution petition is to be presented within 2 years of marriage and no exception to the s.30 bar applies. Sworn in support of the ex-parte motion for leave.',
    notes:       'Must state the marriage date, establish that the 2-year bar applies (marriage date to today), identify the exceptional hardship or depravity relied upon OR confirm that an exception under ss.15(2)(a), 15(2)(b), or 16(1)(a) applies, and depose to the grounds for the application.',
    promptHint:  'marriage date, date of petition, basis for leave (exceptional hardship, exceptional depravity, or applicable exception), facts of the marriage breakdown',
  },
  {
    id:          'discretion_statement',
    label:       'Discretion Statement (Form 30)',
    icon:        '🔒',
    authority:   'Form 30 MCR · O.11 rr.28–29 MCR',
    description: 'Where the petitioner has committed adultery, or has been guilty of other conduct which the court would take into account, a discretion statement must be filed in a sealed envelope at the time of setting down. The statement is not disclosed to the respondent without a court order.',
    notes:       'Form 30 MCR. Filed in sealed envelope marked "Discretion Statement — Confidential". Not served on the respondent. The court reads it in determining whether to exercise its discretion. Contents: the petitioner\'s admission of the relevant conduct, dated and signed.',
    promptHint:  'nature of the petitioner\'s conduct to be disclosed, dates, identity of the third party (initials acceptable where sensitive), and the petitioner\'s explanation or context',
  },
  {
    id:          'ancillary_affidavit',
    label:       'Affidavit in Support of Ancillary Relief Application',
    icon:        '💰',
    authority:   'O.11 MCR · ss.70–72 MCA',
    description: 'Sworn in support of applications for maintenance, property settlement, or custody orders. Must disclose the deponent\'s financial position fully and frankly. The court expects complete and accurate disclosure — concealment or understatement attracts adverse inferences.',
    notes:       'Standard sections: identity and role, marriage history brief, children, income (all sources), assets (full list, estimated values), liabilities, monthly outgoings, proposed orders and basis. Must exhibit relevant financial documents where available.',
    promptHint:  'party\'s income (employment, business, investments), assets (property, vehicles, bank accounts, investments, pensions), liabilities, monthly expenses, children\'s needs, proposed maintenance quantum and property settlement',
  },
  {
    id:          'written_address_ancillary',
    label:       'Written Address — Ancillary Relief Hearing',
    icon:        '⚖',
    authority:   'ss.70–72 MCA · O.11 MCR',
    description: 'Closing written address at the ancillary relief hearing. Covers the applicable legal principles for maintenance, property settlement, and custody. Must address the evidence adduced and the competing orders sought.',
    notes:       'Structure: Issues for determination → Applicable legal principles (MCA provisions, relevant authorities) → Application to the facts → Relief sought (specific orders prayed). Cite MCA sections and case authority. Pray specific orders with quantum.',
    promptHint:  'relief sought (maintenance quantum, property orders, custody arrangements), evidence adduced, respondent\'s counter-position, applicable authorities, specific orders to be prayed',
  },
  {
    id:          'written_address_custody',
    label:       'Written Address — Custody and Welfare',
    icon:        '👶',
    authority:   's.71 MCA · Child\'s Rights Act 2003',
    description: 'Written address at a custody and welfare hearing. The welfare of the child is the paramount consideration under s.71 MCA and the Child\'s Rights Act. Addresses current arrangements, proposed orders, welfare officer\'s report (if any), and the parties\' respective capacity to provide.',
    notes:       'The court is not bound by the parties\' agreement — welfare is paramount. Address the welfare checklist: child\'s wishes (age-appropriate), physical/emotional needs, likely effect of change, risk, capability of each parent. Where a welfare officer\'s report exists, engage it directly.',
    promptHint:  'children (names, ages), current living arrangements, proposed custody and access arrangements, welfare concerns, any welfare officer involvement, parties\' employment and availability, each party\'s capacity to care, child\'s school and stability',
  },
  {
    id:          'written_address_absolute',
    label:       'Written Address — Decree Absolute Application',
    icon:        '⚡',
    authority:   'ss.57–58 MCA',
    description: 'Written address in support of the application to make the decree nisi absolute. Must establish: the decree nisi date, the correct path (s.57 — 28 days if welfare order made; s.58 — 3 months otherwise), that the prescribed period has elapsed, and that there is no pending appeal or other bar.',
    notes:       'This is usually brief unless opposed. If opposed, address the grounds of opposition. Note s.241(2) CFRN: once the decree absolute is granted, no appeal lies. If a children\'s arrangement order was made alongside the nisi (s.57 path), exhibit it.',
    promptHint:  'decree nisi date, whether a children welfare order was made (s.57 or s.58 path), application date, elapsed period, whether any appeal was filed, grounds of opposition if any',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const MAB_SYSTEM = `You are a specialist Nigerian matrimonial causes drafting counsel. You produce court documents and written addresses under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and the Matrimonial Causes Rules 1983 (MCR).

DOCTRINAL RULES (mandatory throughout all documents):
- Sole ground for dissolution: irretrievable breakdown s.15(1) MCA. The s.15(2)(a)–(h) facts are EVIDENCE of breakdown, not separate grounds.
- Parties are PETITIONER and RESPONDENT — NEVER Claimant/Defendant.
- Court: High Court of a State (or FCT High Court) — NEVER the Federal High Court.
- Proceedings commence by Petition Form 6 MCR — never by Writ.
- s.30 MCA: 2-year bar on dissolution petitions. Three exceptions: s.15(2)(a) wilful refusal, s.15(2)(b) adultery, s.16(1)(a) rape/sodomy/bestiality by respondent.
- s.57: 28 days from nisi to absolute where children welfare order made. s.58: 3 months where no such order.
- s.241(2) CFRN: NO appeal against decree absolute — constitutional hard bar, no exceptions.
- Cite MCA section numbers with correct letter assignments throughout.
- All affidavits: numbered paragraphs, first person, proper jurat (to be sworn before Commissioner for Oaths or other competent authority).
- All written addresses: use IRAC (Issue, Rule, Application, Conclusion) structure per issue.
- Insert [COUNSEL TO VERIFY] where specific information must be confirmed or completed.
- End every document with mandatory counsel review notice.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES + UI
// ─────────────────────────────────────────────────────────────────────────────

const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 8,
  padding: '20px 22px', marginBottom: 16,
};
const lbS: React.CSSProperties = {
  fontSize: 9, color: '#888888', fontFamily: SERIF,
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};
const taS: React.CSSProperties = {
  width: '100%', background: '#fafafa', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '10px 13px', fontSize: 13,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
  lineHeight: 1.7, resize: 'vertical',
};

function Btn({ label, onClick, loading = false, disabled = false, secondary = false }: {
  label: string; onClick: () => void; loading?: boolean; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading || disabled} style={{
      background: secondary ? '#f5f5f5' : loading || disabled ? '#e0e0e0' : '#111111',
      color: secondary ? '#444444' : loading || disabled ? '#999999' : '#ffffff',
      border: secondary ? '1px solid #cccccc' : 'none',
      borderRadius: 5, padding: '10px 22px', fontSize: 13,
      fontFamily: SERIF, cursor: loading || disabled ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳ Drafting…' : label}
    </button>
  );
}

function AuthorityBadge({ text }: { text: string }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: SERIF, fontWeight: 600, letterSpacing: '.04em',
      background: '#f5edfb', color: '#4a1a7a', border: '1px solid #ccb8e8',
      borderRadius: 3, padding: '2px 8px', display: 'inline-block',
    }}>{text}</span>
  );
}

function CounselNotice({ text }: { text: string }) {
  return (
    <div style={{ background: '#fffbf0', border: '1px solid #e8d040', borderRadius: 5, padding: '10px 14px', marginTop: 10 }}>
      <p style={{ fontSize: 12, fontFamily: SERIF, color: '#7a5a00', lineHeight: 1.6, margin: 0 }}>
        📌 {text}
      </p>
    </div>
  );
}

// Step indicator
function StepBar({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Select Document' },
    { n: 2, label: 'Facts & Context' },
    { n: 3, label: 'Draft' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 22 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: '50%',
              background: s.n <= current ? '#111111' : '#e0e0e0',
              color: s.n <= current ? '#ffffff' : '#888888',
              fontSize: 12, fontFamily: SERIF, fontWeight: 700, flexShrink: 0,
            }}>{s.n}</span>
            <span style={{ fontSize: 11, fontFamily: SERIF, color: s.n === current ? '#111111' : '#888888', fontWeight: s.n === current ? 600 : 400 }}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 1, background: '#e0e0e0', margin: '0 12px' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY PANEL
// ─────────────────────────────────────────────────────────────────────────────

function VersionHistory({
  versions, onView, onDelete,
}: {
  versions: Version[];
  onView: (v: Version) => void;
  onDelete: (id: string) => void;
}) {
  if (versions.length === 0) {
    return (
      <div style={{ ...cardS, textAlign: 'center', color: '#aaaaaa', fontFamily: SERIF, fontSize: 13, paddingTop: 40, paddingBottom: 40 }}>
        No saved drafts yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {versions.map(v => (
        <div key={v.id} style={{ ...cardS, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600, color: '#111111', marginBottom: 3 }}>
                {v.docLabel}
              </p>
              <p style={{ fontSize: 11, fontFamily: SERIF, color: '#888888' }}>
                {new Date(v.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => onView(v)} style={{ background: '#111111', color: '#ffffff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                Open
              </button>
              <button onClick={() => onDelete(v.id)} style={{ background: 'transparent', color: '#c04040', border: '1px solid #e0c0c0', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function MArgumentBuilder({ activeCase }: Props) {
  const ai = useAI(activeCase);

  const [mainTab, setMainTab] = useState<'build' | 'history'>('build');
  const [step, setStep]         = useState<1 | 2 | 3>(1);
  const [selDoc, setSelDoc]     = useState<DocType | null>(null);
  const [context, setContext]   = useState('');
  const [draft, setDraft]       = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [viewVer, setViewVer]   = useState<Version | null>(null);
  const [copied, setCopied]     = useState(false);

  const caseId = activeCase.id;

  useEffect(() => {
    loadBlindSpot<SavedData>(caseId, MODULE)
      .then(d => setVersions((d ?? DEFAULT_DATA).versions))
      .catch(() => {});
  }, [caseId]);

  async function persistVersions(next: Version[]) {
    setVersions(next);
    await saveBlindSpot(caseId, MODULE, { versions: next });
  }

  const handleDelete = useCallback(async (id: string) => {
    const next = versions.filter(v => v.id !== id);
    await persistVersions(next);
    if (viewVer?.id === id) setViewVer(null);
  }, [versions, viewVer]);

  const reset = useCallback(() => {
    setStep(1);
    setSelDoc(null);
    setContext('');
    setDraft('');
    setViewVer(null);
  }, []);

  // ── Generation ────────────────────────────────────────────────────────────

  async function generate() {
    if (!selDoc) return;

    const roleLabel = activeCase.counsel_role === 'petitioner_side'
      ? 'Petitioner Side'
      : activeCase.counsel_role === 'respondent_side'
        ? 'Respondent Side'
        : activeCase.counsel_role ?? 'Not specified';

    const prompt = `CASE: ${activeCase.caseName}
Court: ${activeCase.court ?? 'High Court of the relevant State'}
Suit No: ${activeCase.suitNo ?? 'Not yet assigned'}
Counsel Role: ${roleLabel}

DOCUMENT TO DRAFT: ${selDoc.label}
Statutory Authority: ${selDoc.authority}
Drafting Notes: ${selDoc.notes}

FACTS AND CONTEXT PROVIDED BY COUNSEL:
${context}

Draft the complete document described above. Requirements:
1. Start with a clear document heading including the case intitulement, court, suit number, and document title.
2. For affidavits:
   - Number every paragraph.
   - Deponent swears in first person ("I, [DEPONENT NAME] of [ADDRESS], make oath and say as follows:").
   - Paragraphs: introduction and qualification → the relevant facts in chronological order → the legal basis for the application where applicable → the prayer.
   - End with a proper jurat: "SWORN at [PLACE] this [DATE] day of [MONTH] [YEAR] / Before me: _______________/ Commissioner for Oaths".
3. For written addresses:
   - Use Nigerian-style structure: Introduction → Issues for Determination → Law (applicable MCA/MCR provisions and authorities) → Application to the Facts → Conclusion and Relief Sought.
   - IRAC per issue. Cite s.15(2) letter assignments correctly (a)–(h).
   - End with a specific prayer block listing exactly the orders sought.
4. For the Discretion Statement (Form 30): follow the confidential form format, state it is filed in a sealed envelope per O.11 rr.28–29 MCR, and include a statement that it is not to be opened without a court order.
5. Insert [COUNSEL TO VERIFY] for any information that must be confirmed before filing.
6. End with:

---
⚠ COUNSEL REVIEW REQUIRED: This draft must be reviewed and settled by counsel before filing. Any affidavit must be sworn before a Commissioner for Oaths or other competent authority. All statutory references should be verified against the current MCA and MCR.`;

    const raw = await ai.ask({ system: MAB_SYSTEM, userMsg: prompt, maxTokens: 4000, libraryOpts: { queryHint: `MCA MCR ${selDoc.authority} ${selDoc.label} affidavit written address verifying affidavit Nigerian matrimonial causes drafting` } });
    if (!raw) return;

    setDraft(raw);
    setStep(3);

    const v: Version = {
      id: uid(), caseId, docTypeId: selDoc.id, docLabel: selDoc.label,
      context, draft: raw, createdAt: new Date().toISOString(),
    };
    await persistVersions([v, ...versions]);
  }

  const handleCopy = useCallback(() => {
    const text = viewVer ? viewVer.draft : draft;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [draft, viewVer]);

  // ── View saved version ────────────────────────────────────────────────────

  if (viewVer) {
    return (
      <div style={{ paddingTop: 24, maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => setViewVer(null)} style={{ background: 'transparent', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '6px 14px', fontSize: 12, fontFamily: SERIF, cursor: 'pointer' }}>
            ← Back
          </button>
          <span style={{ fontSize: 15, fontFamily: SERIF, fontWeight: 600, color: '#111111', flex: 1 }}>
            {viewVer.docLabel}
          </span>
          <button onClick={handleCopy} style={{ background: '#111111', color: '#ffffff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <div style={{ background: '#faf8ff', border: '1px solid #ccb8e8', borderRadius: 8, padding: '20px 22px' }}>
          <Md text={viewVer.draft} />
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div style={{ paddingTop: 24, maxWidth: 900 }}>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Matrimonial Argument Builder
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          7 document types · Verifying Affidavit · Leave Affidavit · Discretion Statement · Ancillary Relief Affidavit · Written Addresses
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e0e0e0' }}>
        {(['build', 'history'] as const).map(t => (
          <button key={t} onClick={() => { setMainTab(t); if (t === 'build' && step === 3) { /* keep draft visible */ } }}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: mainTab === t ? '2px solid #111111' : '2px solid transparent',
              color: mainTab === t ? '#111111' : '#888888', padding: '8px 16px',
              fontSize: 12, fontFamily: SERIF, cursor: 'pointer',
              fontWeight: mainTab === t ? 600 : 400, letterSpacing: '.04em',
            }}>
            {t === 'build' ? 'Build Document' : `Saved Drafts (${versions.length})`}
          </button>
        ))}
      </div>

      {ai.error && <ErrorBlock message={ai.error} onDismiss={() => ai.clearError()} />}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────── */}
      {mainTab === 'history' && (
        <VersionHistory versions={versions} onView={setViewVer} onDelete={handleDelete} />
      )}

      {/* ── BUILD TAB ────────────────────────────────────────────────────── */}
      {mainTab === 'build' && (
        <>
          <StepBar current={step} />

          {/* Step 1 — Select document type */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: 9, fontFamily: SERIF, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: '#888888', marginBottom: 14 }}>
                Step 1 — Select Document Type
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {DOC_TYPES.map(doc => (
                  <div
                    key={doc.id}
                    onClick={() => { setSelDoc(doc); setStep(2); }}
                    style={{
                      ...cardS, marginBottom: 0, cursor: 'pointer',
                      border: `1px solid ${selDoc?.id === doc.id ? '#4a1a7a' : '#e0e0e0'}`,
                      transition: 'border-color .12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{doc.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 5 }}>
                          <span style={{ fontSize: 14, fontFamily: SERIF, fontWeight: 600, color: '#111111' }}>
                            {doc.label}
                          </span>
                          <AuthorityBadge text={doc.authority} />
                        </div>
                        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', lineHeight: 1.65, marginBottom: 8 }}>
                          {doc.description}
                        </p>
                        <div style={{ background: '#fafafa', border: '1px solid #eeeeee', borderRadius: 4, padding: '8px 12px' }}>
                          <span style={{ ...lbS, marginBottom: 3 }}>Drafting notes</span>
                          <p style={{ fontSize: 11, fontFamily: SERIF, color: '#666666', lineHeight: 1.6, margin: 0 }}>
                            {doc.notes}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — Facts & Context */}
          {step === 2 && selDoc && (
            <div style={cardS}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setStep(1); setContext(''); }} style={{ background: 'transparent', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '5px 12px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                  ← Change
                </button>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontFamily: SERIF, fontWeight: 600, color: '#111111' }}>
                      {selDoc.icon} {selDoc.label}
                    </span>
                    <AuthorityBadge text={selDoc.authority} />
                  </div>
                </div>
              </div>

              <CounselNotice text={selDoc.notes} />

              <div style={{ marginTop: 16 }}>
                <label style={lbS}>Facts and context for this document</label>
                <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888', lineHeight: 1.6, marginBottom: 10 }}>
                  Provide: {selDoc.promptHint}.
                </p>
                <textarea
                  style={{ ...taS, minHeight: 180 }}
                  rows={10}
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder={`Provide facts for: ${selDoc.label}\n\nInclude: ${selDoc.promptHint}…`}
                />
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                <Btn label="← Back" onClick={() => setStep(1)} secondary />
                <Btn
                  label="Draft Document →"
                  onClick={generate}
                  loading={ai.loading}
                  disabled={context.trim().length < 40}
                />
              </div>
            </div>
          )}

          {/* Step 3 — Draft */}
          {step === 3 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <button onClick={() => setStep(2)} style={{ background: 'transparent', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '5px 12px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                  ← Revise
                </button>
                <span style={{ fontSize: 14, fontFamily: SERIF, fontWeight: 600, color: '#111111', flex: 1 }}>
                  {selDoc?.label}
                </span>
                <button onClick={handleCopy} style={{ background: '#111111', color: '#ffffff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                <Btn label="New Document" onClick={reset} secondary />
              </div>

              <div style={{ background: '#faf8ff', border: '1px solid #ccb8e8', borderRadius: 8, padding: '20px 22px' }}>
                <Md text={draft} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
