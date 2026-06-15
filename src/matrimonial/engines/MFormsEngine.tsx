/**
 * AFS Advocates — Matrimonial Forms Engine (MFormsEngine)
 * Phase 5
 *
 * Generates all 14 MCR statutory forms to filing standard.
 * Forms are rendered as completed drafts ready for counsel review and signing.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadMatrimonialData } from '@/storage/helpers';
import type { MatrimonialCaseData, MExtractionResult } from '@/matrimonial/types';
import { Md, ErrorBlock } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const SYSTEM = `You are a specialist Nigerian matrimonial causes draftsman operating under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and the Matrimonial Causes Rules 1983 (MCR).

DRAFTING RULES:
- All forms must comply strictly with the MCR prescribed format.
- Parties are always PETITIONER and RESPONDENT — never Claimant/Defendant.
- The court is always the High Court of [State] — never the Federal High Court.
- Proceedings commence by Petition (Form 6) — never by Writ.
- The sole ground for dissolution is irretrievable breakdown (s.15(1) MCA); the s.15(2) facts are evidence of breakdown.
- Every petition must include: (a) Form 3A reconciliation certificate; (b) condonation/connivance/collusion declaration ss.26–27 MCA; (c) verifying affidavit O.5 r.10 MCR.
- When adultery is alleged, the co-respondent must be joined: s.32 MCA, O.9 rr.2–3 MCR.
- s.30 MCA: no petition within 2 years of marriage without leave (exceptions: s.15(2)(a) wilful refusal, s.15(2)(b) adultery, s.16(1)(a) rape/sodomy/bestiality).
- Use formal court drafting style throughout. Insert [BRACKETS] for information counsel must supply.

Format each form with a clear FORM HEADER, the prescribed layout, and footer with filing instructions.`;

interface MCRForm {
  id:          string;
  number:      string;
  rule:        string;
  title:       string;
  description: string;
  fields:      FormField[];
}

interface FormField {
  id:          string;
  label:       string;
  type:        'text' | 'textarea' | 'date' | 'select';
  placeholder: string;
  options?:    string[];
  required?:   boolean;
}

const MCR_FORMS: MCRForm[] = [
  {
    id: 'form_3a', number: 'Form 3A', rule: 'O.2 r.2 MCR',
    title: 'Certificate Relating to Reconciliation',
    description: 'Must accompany every petition for dissolution or judicial separation. Counsel certifies whether reconciliation was discussed with the petitioner.',
    fields: [
      { id: 'counsel_name', label: "Counsel's Full Name", type: 'text', placeholder: 'Full name of petitioner\'s counsel', required: true },
      { id: 'petitioner', label: 'Petitioner Name', type: 'text', placeholder: 'Full name', required: true },
      { id: 'reconciliation_discussed', label: 'Was reconciliation discussed?', type: 'select', placeholder: '', options: ['Yes — discussed and not possible', 'Yes — discussed and referred to counsellor', 'No — not appropriate in the circumstances'], required: true },
    ],
  },
  {
    id: 'form_6', number: 'Form 6', rule: 'O.5 MCR',
    title: 'Petition for Dissolution / Judicial Separation',
    description: 'The originating process for all matrimonial causes. Petition commences proceedings; never a Writ.',
    fields: [
      { id: 'court', label: 'Court', type: 'text', placeholder: 'High Court of [State]', required: true },
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '[to be assigned on filing]' },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: 'Full name of petitioner', required: true },
      { id: 'respondent', label: 'Respondent', type: 'text', placeholder: 'Full name of respondent', required: true },
      { id: 'co_respondent', label: 'Co-Respondent (if adultery alleged)', type: 'text', placeholder: 'Full name or leave blank' },
      { id: 'marriage_date', label: 'Date of Marriage', type: 'date', placeholder: '', required: true },
      { id: 'marriage_place', label: 'Place of Marriage', type: 'text', placeholder: 'Church/Registry/Place and State', required: true },
      { id: 'marriage_type', label: 'Type of Marriage', type: 'select', placeholder: '', options: ['Statutory (Marriage Act)', 'Customary', 'Church', 'Islamic', 'Other'], required: true },
      { id: 'last_address', label: 'Last Matrimonial Home Address', type: 'text', placeholder: 'Full address', required: true },
      { id: 'dissolution_fact', label: 'S.15(2) Fact(s) Relied Upon', type: 'select', placeholder: '', options: [
        's.15(2)(a) — Wilful and persistent refusal to consummate',
        's.15(2)(b) — Adultery and intolerability',
        's.15(2)(c) — Unreasonable behaviour',
        's.15(2)(d) — Desertion (at least 1 continuous year)',
        's.15(2)(e) — Living apart 2 years (respondent consents)',
        's.15(2)(f) — Living apart 3 years (no consent required)',
        's.15(2)(g) — Non-compliance with RCR decree',
        's.15(2)(h) — Presumed death (absent 7 years)',
      ], required: true },
      { id: 'particulars', label: 'Particulars of the Fact Relied Upon', type: 'textarea', placeholder: 'Set out dates, incidents, and specific particulars establishing the s.15(2) fact...', required: true },
      { id: 'children', label: 'Children of the Marriage', type: 'textarea', placeholder: 'Name, DOB, and current arrangement for each child. State "None" if no children.' },
      { id: 'relief_sought', label: 'Relief Sought', type: 'textarea', placeholder: 'e.g. (i) A decree of dissolution; (ii) Custody of the children; (iii) Maintenance pendente lite; (iv) Property settlement; (v) Costs', required: true },
    ],
  },
  {
    id: 'form_7', number: 'Form 7', rule: 'O.5 MCR',
    title: 'Petition for Restitution of Conjugal Rights',
    description: 'Petition commencing proceedings for restitution of conjugal rights under s.47 MCA.',
    fields: [
      { id: 'court', label: 'Court', type: 'text', placeholder: 'High Court of [State]', required: true },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: 'Full name', required: true },
      { id: 'respondent', label: 'Respondent', type: 'text', placeholder: 'Full name', required: true },
      { id: 'marriage_date', label: 'Date of Marriage', type: 'date', placeholder: '', required: true },
      { id: 'desertion_date', label: 'Date Respondent Withdrew from Cohabitation', type: 'date', placeholder: '' },
      { id: 'circumstances', label: 'Circumstances of Withdrawal', type: 'textarea', placeholder: 'Describe how and when the respondent withdrew from cohabitation...', required: true },
    ],
  },
  {
    id: 'form_8', number: 'Form 8 / 8A', rule: 'O.5 r.28 MCR',
    title: 'Notice of Petition',
    description: 'Notice to be served on respondent / co-respondent together with the petition.',
    fields: [
      { id: 'court', label: 'Court', type: 'text', placeholder: 'High Court of [State]', required: true },
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: '', required: true },
      { id: 'respondent', label: 'Respondent', type: 'text', placeholder: '', required: true },
      { id: 'service_address', label: 'Address for Service of Respondent', type: 'text', placeholder: 'Full address', required: true },
    ],
  },
  {
    id: 'form_11', number: 'Form 11', rule: 'O.6 r.3 MCR',
    title: 'Acknowledgement of Service',
    description: 'Filed by respondent (or co-respondent) upon being served with the petition.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'respondent', label: 'Respondent / Co-Respondent Name', type: 'text', placeholder: '', required: true },
      { id: 'service_date', label: 'Date Petition was Received', type: 'date', placeholder: '', required: true },
      { id: 'intention', label: 'Intention', type: 'select', placeholder: '', options: [
        'Intend to defend the proceedings',
        'Do not intend to defend the proceedings',
        'Intend to defend only the ancillary relief claims',
      ], required: true },
      { id: 'address', label: 'Address for Service', type: 'text', placeholder: 'Full address for service on respondent', required: true },
    ],
  },
  {
    id: 'form_15', number: 'Form 15', rule: 'O.5 r.29 MCR',
    title: 'Answer to Petition',
    description: 'Respondent\'s answer — may admit, deny, or traverse allegations, and raise bars such as condonation, connivance, or collusion.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'respondent', label: 'Respondent', type: 'text', placeholder: '', required: true },
      { id: 'response_to_facts', label: 'Response to Petition Allegations', type: 'textarea', placeholder: 'Admit / Deny / Traverse each allegation in the petition...', required: true },
      { id: 'bars_raised', label: 'Bars / Defences Raised', type: 'select', placeholder: '', options: [
        'None — facts not admitted but no bar',
        'Condonation (ss.26–27 MCA)',
        'Connivance (s.28 MCA)',
        'Collusion',
        'Respondent\'s own adultery — seeking discretion',
        'Cross-petition (attach Form 15A)',
      ] },
      { id: 'bar_particulars', label: 'Particulars of Bar / Defence', type: 'textarea', placeholder: 'Provide dates and circumstances supporting the defence raised...' },
    ],
  },
  {
    id: 'form_15a', number: 'Form 15A', rule: 'MCR',
    title: 'Cross-Petition',
    description: 'Filed where respondent seeks dissolution / nullity on their own account in the same proceedings.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'cross_petitioner', label: 'Cross-Petitioner (Respondent\'s Name)', type: 'text', placeholder: '', required: true },
      { id: 'cross_fact', label: 'S.15(2) Fact Relied Upon in Cross-Petition', type: 'select', placeholder: '', options: [
        's.15(2)(a) — Wilful and persistent refusal to consummate',
        's.15(2)(b) — Adultery and intolerability',
        's.15(2)(c) — Unreasonable behaviour',
        's.15(2)(d) — Desertion (at least 1 continuous year)',
        's.15(2)(e) — Living apart 2 years (respondent consents)',
        's.15(2)(f) — Living apart 3 years (no consent required)',
        's.15(2)(g) — Non-compliance with RCR decree',
        's.15(2)(h) — Presumed death (absent 7 years)',
      ], required: true },
      { id: 'cross_particulars', label: 'Particulars of Cross-Petition', type: 'textarea', placeholder: 'Set out dates, incidents, and specific particulars...', required: true },
    ],
  },
  {
    id: 'form_17', number: 'Form 17', rule: 'O.7 r.4(5) MCR',
    title: 'Reply to Answer',
    description: 'Petitioner\'s reply to respondent\'s answer — traverses defences and responds to cross-petition.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'reply_content', label: 'Reply to Answer', type: 'textarea', placeholder: 'Traverse or admit each paragraph of the Answer. Respond to bars raised (condonation/connivance). Respond to cross-petition if any...', required: true },
    ],
  },
  {
    id: 'form_30', number: 'Form 30', rule: 'O.11 rr.28–29 MCR',
    title: 'Discretion Statement',
    description: 'SEALED ENVELOPE — filed when petitioner has committed adultery. Filed separately; not open to inspection except by the court.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: '', required: true },
      { id: 'adultery_particulars', label: 'Particulars of Petitioner\'s Own Adultery', type: 'textarea', placeholder: 'Set out the person(s) with whom adultery was committed and the dates...', required: true },
      { id: 'discretion_prayer', label: 'Prayer for Discretion', type: 'textarea', placeholder: 'The petitioner prays the court to exercise its discretion in their favour...', required: true },
    ],
  },
  {
    id: 'form_31', number: 'Form 31', rule: 'O.11 r.39 MCR',
    title: 'Request to Set Down — Undefended',
    description: 'Application to set the cause down for hearing as undefended.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: '', required: true },
      { id: 'counsel_name', label: "Petitioner's Counsel", type: 'text', placeholder: '', required: true },
      { id: 'no_answer_date', label: 'Date by Which No Answer Filed / No Defence Intended', type: 'date', placeholder: '' },
    ],
  },
  {
    id: 'form_32', number: 'Form 32', rule: 'O.11 r.39 MCR',
    title: 'Request to Set Down — Defended',
    description: 'Application to set the cause down for hearing as defended.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: '', required: true },
      { id: 'respondent', label: 'Respondent', type: 'text', placeholder: '', required: true },
      { id: 'issues', label: 'Issues for Trial', type: 'textarea', placeholder: 'List the issues to be determined at the defended hearing...', required: true },
    ],
  },
  {
    id: 'form_33', number: 'Form 33', rule: 'MCR',
    title: 'Notice of Trial',
    description: 'Notice of the date fixed for hearing of the cause.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'trial_date', label: 'Date Fixed for Hearing', type: 'date', placeholder: '', required: true },
      { id: 'court', label: 'Court', type: 'text', placeholder: 'High Court of [State]', required: true },
      { id: 'judge', label: 'Judge (if known)', type: 'text', placeholder: 'Hon. Justice [Name]' },
    ],
  },
  {
    id: 'form_42_43', number: 'Form 42 / 43', rule: 'MCR',
    title: 'AG / Third-Party Intervention Notice',
    description: 'Notice to the Attorney-General or a third party (e.g. the co-respondent) of their right to intervene in the proceedings.',
    fields: [
      { id: 'suit_no', label: 'Suit Number', type: 'text', placeholder: '', required: true },
      { id: 'addressee', label: 'Addressee', type: 'text', placeholder: 'Attorney-General of [State] / Name of third party', required: true },
      { id: 'basis', label: 'Basis for Intervention Notice', type: 'textarea', placeholder: 'Set out why this party is being notified and the nature of their potential interest...', required: true },
    ],
  },
  {
    id: 'form_60', number: 'Form 60', rule: 'O.22 r.2 MCR',
    title: 'Petition for Jactitation of Marriage',
    description: 'Petition where the respondent falsely claims to be married to the petitioner.',
    fields: [
      { id: 'court', label: 'Court', type: 'text', placeholder: 'High Court of [State]', required: true },
      { id: 'petitioner', label: 'Petitioner', type: 'text', placeholder: '', required: true },
      { id: 'respondent', label: 'Respondent', type: 'text', placeholder: '', required: true },
      { id: 'false_claim_particulars', label: 'Particulars of False Claim', type: 'textarea', placeholder: 'Describe when, where, and to whom the respondent falsely claimed to be married to the petitioner...', required: true },
      { id: 'no_marriage_proof', label: 'Proof That No Marriage Exists', type: 'textarea', placeholder: 'State why there is no valid marriage between the parties...', required: true },
    ],
  },
];

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
  const [expanded, setExpanded] = useState(false);
  const ex = matrimonialData.intelligence_extraction;
  const runAt = matrimonialData.intelligence_run_at
    ? new Date(matrimonialData.intelligence_run_at).toLocaleDateString('en-NG', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—';
  const version = matrimonialData.intelligence_version ?? 1;

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
            Marriage date, fact selection, children, and co-respondent have been pre-populated from the case extraction.
            {ex?.two_year_bar?.bar_applies && (
              <span style={{ color: '#c04040', fontWeight: 700 }}> ⚠ Two-year bar applies — verify s.30 leave before filing.</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-start' }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'transparent', border: '1px solid #4caf85', color: '#1a5a38', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}
          >
            {expanded ? 'Hide extraction' : 'View extraction'}
          </button>
          <button
            onClick={onClear}
            style={{ background: 'transparent', border: '1px solid #c04040', color: '#c04040', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}
          >
            Clear &amp; enter manually
          </button>
        </div>
      </div>
      {expanded && ex && (
        <div style={{ marginTop: 12, background: '#e8f5ee', borderRadius: 5, padding: '10px 14px', fontSize: 11, fontFamily: SERIF, color: '#1a3a28', lineHeight: 1.7 }}>
          <strong>Marriage:</strong> {ex.marriage_timeline.marriage_date} · {ex.marriage_timeline.marriage_place} · {ex.marriage_timeline.marriage_type}<br />
          <strong>Relief:</strong> {ex.relief_sought}<br />
          <strong>Facts:</strong> {ex.dissolution_facts.map(f => f.fact).join('; ') || '—'}<br />
          {ex.children.length > 0 && (
            <><strong>Children:</strong> {ex.children.map(c => `${c.name} (${c.age})`).join(', ')}<br /></>
          )}
          {ex.co_respondent.named && (
            <><strong>Co-respondent:</strong> {ex.co_respondent.name}<br /></>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — derive pre-populated field values from extraction
// ─────────────────────────────────────────────────────────────────────────────

function derivePreFill(ex: MExtractionResult): Record<string, string> {
  const prefill: Record<string, string> = {};

  // Marriage date — store as YYYY-MM-DD for <input type="date">
  if (ex.marriage_timeline.marriage_date) {
    // Attempt to parse a human date into YYYY-MM-DD
    const parsed = new Date(ex.marriage_timeline.marriage_date);
    if (!isNaN(parsed.getTime())) {
      prefill['marriage_date'] = parsed.toISOString().slice(0, 10);
    }
  }

  if (ex.marriage_timeline.marriage_place) {
    prefill['marriage_place'] = ex.marriage_timeline.marriage_place;
  }

  // Marriage type — map to MCR select option
  const typeMap: Record<string, string> = {
    statutory: 'Statutory (Marriage Act)',
    customary: 'Customary',
    church:    'Church',
    islamic:   'Islamic',
    other:     'Other',
  };
  const rawType = ex.marriage_timeline.marriage_type?.toLowerCase() ?? '';
  const mappedType = Object.entries(typeMap).find(([k]) => rawType.includes(k))?.[1];
  if (mappedType) prefill['marriage_type'] = mappedType;

  // Relief — map relief_sought to select option
  const reliefSought = ex.relief_sought?.toLowerCase() ?? '';
  if (reliefSought.includes('dissolution')) prefill['relief_sought'] = 'A decree of dissolution of the marriage';
  else if (reliefSought.includes('judicial separation')) prefill['relief_sought'] = 'A decree of judicial separation';
  else if (reliefSought.includes('nullity')) prefill['relief_sought'] = 'A decree of nullity';

  // s.15(2) fact — pick strongest
  const strongFact = ex.dissolution_facts.find(f => f.strength === 'STRONG') ?? ex.dissolution_facts[0];
  if (strongFact) {
    // Map the raw fact string to the MCR select option text
    const factLabel = strongFact.fact.trim();
    prefill['dissolution_fact'] = factLabel;
  }

  // Children — format for textarea
  if (ex.children.length > 0) {
    prefill['children'] = ex.children
      .map(c => `${c.name}, aged ${c.age}. Current arrangement: ${c.current_arrangement}.${c.welfare_concern ? ` Welfare note: ${c.welfare_concern}` : ''}`)
      .join('\n');
  }

  // Co-respondent
  if (ex.co_respondent.named && ex.co_respondent.name) {
    prefill['co_respondent'] = ex.co_respondent.name;
  }

  return prefill;
}



const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: '#111111', padding: '9px 12px', fontSize: 13,
  fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.8, minHeight: 80 };
const lbS: React.CSSProperties = {
  fontSize: 9, color: '#666666', fontFamily: SERIF,
  letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600,
  display: 'block', marginBottom: 4,
};
const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0',
  borderRadius: 8, padding: '18px 20px', marginBottom: 12,
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
      fontFamily: SERIF, cursor: loading ? 'not-allowed' : 'pointer',
      fontWeight: 600, letterSpacing: '.04em',
    }}>
      {loading ? '⟳  Drafting…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM DRAFTER
// ─────────────────────────────────────────────────────────────────────────────

function FormDrafter({ form, activeCase, initialValues = {} }: { form: MCRForm; activeCase: Case; initialValues?: Record<string, string> }) {
  const ai = useAI(activeCase);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [draft, setDraft] = useState('');

  function set(id: string, val: string) {
    setValues(prev => ({ ...prev, [id]: val }));
  }

  async function generate() {
    const fieldData = form.fields.map(f => `${f.label}: ${values[f.id] || '(not provided)'}`).join('\n');

    const prompt = `Generate ${form.number} — ${form.title} (${form.rule}) under the Nigerian Matrimonial Causes Rules 1983.

CASE CONTEXT:
Case Name: ${activeCase.caseName}
Court: ${activeCase.court || values['court'] || 'High Court of [State]'}
Suit No: ${activeCase.suitNo || values['suit_no'] || '[to be assigned]'}
Counsel Role: ${activeCase.counsel_role === 'petitioner_side' ? 'Petitioner Side' : 'Respondent Side'}

FORM DATA PROVIDED BY COUNSEL:
${fieldData}

Draft the complete form in its prescribed MCR format. Include:
- The prescribed form heading with FORM ${form.number} centred at top
- All prescribed fields populated with the data above
- [BRACKETS] for any information not yet provided
- The prescribed jurat/attestation/signature block at the foot
- Filing instructions for the Registry

Use formal legal drafting throughout. The form must be ready for counsel review and signing.`;

    const result = await ai.ask({ system: SYSTEM, userMsg: prompt, maxTokens: 2000, libraryOpts: { queryHint: 'MCR statutory forms Form 6 Form 11 Form 15 Form 3A Form 31 Form 32 MCR O.5 O.6 petition acknowledgement answer set down' } });
    if (result) setDraft(result);
  }

  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(draft).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      {/* Fields */}
      <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        {form.fields.map(f => (
          <div key={f.id}>
            <label style={lbS}>
              {f.label}{f.required && <span style={{ color: '#cc3333' }}> *</span>}
            </label>
            {f.type === 'textarea' ? (
              <textarea
                style={taS}
                rows={4}
                value={values[f.id] || ''}
                onChange={e => set(f.id, e.target.value)}
                placeholder={f.placeholder}
              />
            ) : f.type === 'select' && f.options ? (
              <select style={{ ...iS }} value={values[f.id] || ''} onChange={e => set(f.id, e.target.value)}>
                <option value="">— select —</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'date' ? (
              <input type="date" style={iS} value={values[f.id] || ''} onChange={e => set(f.id, e.target.value)} />
            ) : (
              <input type="text" style={iS} value={values[f.id] || ''} onChange={e => set(f.id, e.target.value)} placeholder={f.placeholder} />
            )}
          </div>
        ))}
      </div>

      <Btn onClick={generate} loading={ai.loading} label={`Generate ${form.number} →`} />
      {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}

      {/* Draft Output */}
      {draft && (
        <div style={{ marginTop: 16, background: '#fafafa', border: '1px solid #dddddd', borderRadius: 7, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase' as const, fontWeight: 600, color: '#4a1a7a' }}>
              Draft — {form.number}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={copy} style={{ background: '#ffffff', border: '1px solid #cccccc', color: copied ? '#1a7a3a' : '#444444', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: SERIF, cursor: 'pointer' }}>
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

export function MFormsEngine({ activeCase }: { activeCase: Case }) {
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const selectedForm = MCR_FORMS.find(f => f.id === selectedFormId) ?? null;

  // Intelligence pre-population state
  const [matrimonialData, setMatrimonialData] = useState<MatrimonialCaseData | null>(null);
  const [intelligenceCleared, setIntelligenceCleared] = useState(false);
  const [prefillValues, setPrefillValues] = useState<Record<string, string>>({});

  useEffect(() => {
    loadMatrimonialData(activeCase.id)
      .then(data => {
        if (data?.intelligence_extraction) {
          setMatrimonialData(data);
          setPrefillValues(derivePreFill(data.intelligence_extraction));
        }
      })
      .catch(() => {});
  }, [activeCase.id]);

  const showBanner = !!(matrimonialData?.intelligence_extraction && !intelligenceCleared);

  function handleClearIntelligence() {
    setIntelligenceCleared(true);
    setPrefillValues({});
  }

  // Group forms
  const GROUPS: Array<{ label: string; ids: string[] }> = [
    { label: 'Pre-Filing', ids: ['form_3a'] },
    { label: 'Originating Process', ids: ['form_6', 'form_7', 'form_60'] },
    { label: 'Service', ids: ['form_8'] },
    { label: 'Respondent Documents', ids: ['form_11', 'form_15', 'form_15a'] },
    { label: 'Petitioner Reply', ids: ['form_17'] },
    { label: 'Set Down & Trial', ids: ['form_30', 'form_31', 'form_32', 'form_33'] },
    { label: 'Third Party', ids: ['form_42_43'] },
  ];

  return (
    <div style={{ paddingTop: 24, maxWidth: 960 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          MCR Statutory Forms
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          All 14 prescribed forms under the Matrimonial Causes Rules 1983 · Generated to filing standard
        </p>
      </div>

      {showBanner && matrimonialData && (
        <IntelligenceBanner
          matrimonialData={matrimonialData}
          onClear={handleClearIntelligence}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20 }}>

        {/* Sidebar */}
        <div>
          {GROUPS.map(g => (
            <div key={g.label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase' as const, fontWeight: 700, color: '#888888', marginBottom: 6 }}>
                {g.label}
              </div>
              {g.ids.map(id => {
                const form = MCR_FORMS.find(f => f.id === id);
                if (!form) return null;
                const active = selectedFormId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedFormId(id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: active ? '#4a1a7a' : 'transparent',
                      border: `1px solid ${active ? '#7a3ab0' : 'transparent'}`,
                      borderRadius: 4, padding: '7px 10px', cursor: 'pointer',
                      marginBottom: 2, fontFamily: SERIF,
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 600, color: active ? '#ffffff' : '#333333', display: 'block' }}>
                      {form.number}
                    </span>
                    <span style={{ fontSize: 10, color: active ? '#e0c8f8' : '#888888' }}>
                      {form.title}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Main Panel */}
        <div>
          {!selectedForm ? (
            <div style={{ background: '#faf8ff', border: '1px solid #e0d8f0', borderRadius: 8, padding: '40px 32px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontFamily: SERIF, color: '#4a1a7a', marginBottom: 8 }}>Select a form from the left panel</p>
              <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888', lineHeight: 1.7 }}>
                All 14 MCR prescribed forms are available · Enter the particulars and generate a filing-ready draft
              </p>
            </div>
          ) : (
            <div style={cardS}>
              <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #ede0f5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontFamily: SERIF, fontWeight: 700, color: '#4a1a7a' }}>{selectedForm.number}</span>
                  <span style={{ fontSize: 10, fontFamily: SERIF, letterSpacing: '.08em', textTransform: 'uppercase' as const, fontWeight: 600, background: '#f5edfb', color: '#4a1a7a', border: '1px solid #ccb8e8', borderRadius: 3, padding: '2px 8px' }}>
                    {selectedForm.rule}
                  </span>
                </div>
                <h3 style={{ fontSize: 15, fontFamily: SERIF, fontWeight: 600, color: '#111111', marginBottom: 6 }}>{selectedForm.title}</h3>
                <p style={{ fontSize: 12, fontFamily: SERIF, color: '#666666', lineHeight: 1.7 }}>{selectedForm.description}</p>
                {selectedForm.id === 'form_30' && (
                  <div style={{ marginTop: 10, background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 4, padding: '8px 12px' }}>
                    <span style={{ fontSize: 11, fontFamily: SERIF, fontWeight: 600, color: '#7a5a00' }}>
                      ⚠ SEALED ENVELOPE — This document must be filed separately in a sealed envelope. It is not open to public inspection.
                    </span>
                  </div>
                )}
              </div>
              <FormDrafter form={selectedForm} activeCase={activeCase} initialValues={prefillValues} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
