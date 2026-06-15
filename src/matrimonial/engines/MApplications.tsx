/**
 * AFS Advocates — Matrimonial Applications Engine (MApplications)
 * Phase 6
 *
 * 9 MCA-specific application packages replacing the civil ApplicationsEngine:
 *
 *   1. Leave to present petition within 2 years — s.30 MCA, O.4 rr.1–2 MCR
 *   2. Maintenance pendente lite — s.70 MCA
 *   3. Interim custody order — s.71 MCA
 *   4. Restraining injunction — asset dissipation, inherent jurisdiction
 *   5. Occupation order — MCA and inherent jurisdiction
 *   6. Financial disclosure order — O.11 MCR compulsory conference
 *   7. Application to make decree absolute — s.57 or s.58 MCA
 *   8. Variation of existing order — s.45 and s.70 MCA
 *   9. Transfer of forum — s.9(2) MCA
 *
 * Workflow: Select application → describe facts → classify → confirm package → generate.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot, loadMatrimonialData, uid } from '@/storage/helpers';
import type { MatrimonialCaseData, MExtractionResult } from '@/matrimonial/types';
import { Md, ErrorBlock } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type Step = 1 | 2 | 3 | 4;

interface ApplicationDef {
  id:           string;
  label:        string;
  authority:    string;
  description:  string;
  urgencyNote?: string;
  package:      string[];
  icon:         string;
}

interface AppRecord {
  id:        string;
  caseId:    string;
  appId:     string;
  appLabel:  string;
  facts:     string;
  documents: string;
  createdAt: string;
}

interface SavedData { history: AppRecord[]; }

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";
const MODULE = 'matrimonial_applications';
const DEFAULT_DATA: SavedData = { history: [] };

const APPLICATIONS: ApplicationDef[] = [
  {
    id:          'leave_s30',
    label:       'Leave to Present Petition (Within 2 Years)',
    authority:   's.30 MCA · O.4 rr.1–2 MCR',
    icon:        '⚖',
    description: 'Where the marriage is less than 2 years old, a petition for dissolution cannot be presented without leave of court. Leave is obtained by motion ex-parte supported by affidavit. Three exceptions displace the bar entirely: wilful refusal to consummate s.15(2)(a), adultery s.15(2)(b), and rape/sodomy/bestiality by the respondent s.16(1)(a).',
    urgencyNote: 'This application must be brought before the petition is filed — filing the petition without leave (where the bar applies and no exception exists) renders the petition premature.',
    package:     [
      'Motion Ex-Parte (O.4 r.1 MCR)',
      'Affidavit in Support of Leave Application',
      'Draft Order Granting Leave',
    ],
  },
  {
    id:          'maintenance_pendente',
    label:       'Maintenance Pendente Lite',
    authority:   's.70 MCA',
    icon:        '💰',
    description: 'The court may order maintenance pending suit for either party. The application is governed by s.70 MCA and is available as soon as the petition is on file. The applicant must show need and the respondent\'s capacity to pay. Interim quantum is assessed on a needs basis without final determination of entitlement.',
    urgencyNote: 'Where financial hardship is immediate, apply by motion on notice simultaneously with or shortly after filing the petition.',
    package:     [
      'Motion on Notice',
      'Affidavit in Support (income, expenditure, assets, respondent\'s means)',
      'Written Address in Support',
      'Proposed Order',
    ],
  },
  {
    id:          'interim_custody',
    label:       'Interim Custody Order',
    authority:   's.71 MCA',
    icon:        '👶',
    description: 'Section 71 MCA empowers the court to make orders regarding the custody, guardianship, welfare, advancement, and education of children of the marriage. Interim custody may be sought before the hearing of the petition. The welfare of the child is the paramount consideration.',
    urgencyNote: 'Where a child\'s welfare is at immediate risk or a party threatens to remove the child from jurisdiction, apply ex-parte for interim relief with early return date.',
    package:     [
      'Motion on Notice (or Ex-Parte where urgent)',
      'Affidavit in Support (child\'s welfare, current arrangements, proposed care)',
      'Written Address in Support',
      'Proposed Interim Custody Order',
    ],
  },
  {
    id:          'restraining_injunction',
    label:       'Restraining / Mareva-Style Injunction',
    authority:   'Inherent Jurisdiction of the High Court · s.71 MCA (ancillary)',
    icon:        '🛑',
    description: 'Where there is a real risk that a party will dissipate or conceal matrimonial assets before ancillary relief is determined, the court will grant a restraining injunction under its inherent jurisdiction. The applicant must show: (a) a good arguable case; (b) a real risk of dissipation; (c) that the balance of convenience favours the grant.',
    urgencyNote: 'Apply ex-parte where disclosure of the application would itself trigger dissipation. An early inter-partes hearing must be fixed on the return date.',
    package:     [
      'Motion Ex-Parte (with early return date)',
      'Affidavit in Support (assets, dissipation risk, balance of convenience)',
      'Schedule of Assets to be Restrained',
      'Draft Restraining Order (with penal notice)',
      'Written Address in Support',
    ],
  },
  {
    id:          'occupation_order',
    label:       'Occupation Order (Exclusion from Matrimonial Home)',
    authority:   'Inherent Jurisdiction · s.71 MCA',
    icon:        '🏠',
    description: 'Where continued occupation of the matrimonial home by both parties is intolerable — particularly where there is a history of violence, harassment, or threat — the court may make an occupation order requiring one party to vacate. The applicant must show that an order is just and reasonable in all the circumstances.',
    package:     [
      'Motion on Notice (or Ex-Parte where violence is immediate)',
      'Affidavit in Support (history, incidents, impact on children if any)',
      'Written Address in Support',
      'Draft Occupation / Exclusion Order (with penal notice)',
    ],
  },
  {
    id:          'financial_disclosure',
    label:       'Financial Disclosure Order',
    authority:   'O.11 MCR — Compulsory Conference · Inherent Jurisdiction',
    icon:        '📋',
    description: 'Full and frank financial disclosure is required before ancillary relief can be properly determined. The compulsory conference under O.11 MCR is the primary mechanism. Where a party fails to disclose or deliberately conceals assets, the court may order specific disclosure, appoint a receiver, or draw adverse inferences.',
    package:     [
      'Motion on Notice for Specific Disclosure',
      'Affidavit in Support (gaps in disclosure, concealment evidence)',
      'Schedule of Information Required',
      'Draft Disclosure Order',
    ],
  },
  {
    id:          'decree_absolute',
    label:       'Application to Make Decree Absolute',
    authority:   's.57 MCA (28 days — children welfare order) · s.58 MCA (3 months — no order)',
    icon:        '⚡',
    description: 'After decree nisi is granted, the petitioner applies to make it absolute. The applicable path depends on whether a children\'s welfare arrangement order was made: s.57 — 28 days minimum from nisi where a welfare order exists; s.58 — 3 months minimum from nisi where no welfare order was made. The respondent may also apply after a further period elapses.',
    urgencyNote: 'No appeal lies against a decree absolute — s.241(2) CFRN. The decree absolute terminates the marriage finally.',
    package:     [
      'Application to Make Decree Absolute (Form prescribed by MCR)',
      'Affidavit verifying that the prescribed period has elapsed',
      'Affidavit as to children arrangements (s.57 path)',
      'Draft Decree Absolute',
    ],
  },
  {
    id:          'variation_order',
    label:       'Variation of Existing Order',
    authority:   's.45 MCA · s.70 MCA',
    icon:        '↻',
    description: 'Maintenance orders and certain ancillary orders may be varied, suspended, discharged, or revived under ss.45 and 70 MCA. The applicant must show a material change in circumstances since the original order was made. Custody and welfare orders are variable at any time in the interests of the child.',
    package:     [
      'Motion on Notice for Variation',
      'Affidavit in Support (changed circumstances, current needs/means)',
      'Written Address in Support',
      'Proposed Varied Order',
    ],
  },
  {
    id:          'transfer_forum',
    label:       'Transfer of Forum / Proceedings',
    authority:   's.9(2) MCA',
    icon:        '⇄',
    description: 'Section 9(2) MCA allows the transfer of matrimonial proceedings from one State High Court to another where the interests of justice so require — for example, where the parties or children have relocated, where witnesses are in another state, or where there is a risk of bias.',
    package:     [
      'Motion on Notice for Transfer',
      'Affidavit in Support (grounds for transfer)',
      'Written Address',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** IDs of applications that should be highlighted based on extraction fields. */
function getRecommendedAppIds(ex: MExtractionResult): Set<string> {
  const recommended = new Set<string>();
  if (ex.two_year_bar?.bar_applies && !ex.two_year_bar?.leave_obtained) {
    recommended.add('leave_s30');
  }
  if (ex.financial_picture?.pendente_lite_urgency === 'HIGH') {
    recommended.add('maintenance_pendente');
  }
  if (ex.children?.some(c => c.welfare_concern && c.welfare_concern.trim().length > 0)) {
    recommended.add('interim_custody');
  }
  if (ex.financial_picture?.disclosure_gaps?.length > 0) {
    recommended.add('financial_disclosure');
  }
  return recommended;
}

/** Pre-populate the facts textarea for a selected application from extraction. */
function buildPreFilledFacts(appId: string, ex: MExtractionResult, caseName: string): string {
  const timeline = ex.marriage_timeline;

  switch (appId) {
    case 'leave_s30': {
      const bar = ex.two_year_bar;
      return [
        `Case: ${caseName}`,
        `Marriage date: ${timeline.marriage_date} at ${timeline.marriage_place}.`,
        `The s.30 MCA two-year bar applies: ${bar.bar_applies ? 'Yes' : 'No'}.`,
        bar.exception
          ? `Exception identified: ${bar.exception_basis || bar.exception}.`
          : `No exception identified — leave is required before presenting the petition.`,
        `Facts in play: ${ex.dissolution_facts.map(f => f.fact).join('; ') || '—'}.`,
        `Current proceedings stage: ${ex.decree_stage || 'Pre-petition'}.`,
        '[COUNSEL TO VERIFY: Confirm marriage registration date and confirm no exception applies before proceeding.]',
      ].filter(Boolean).join('\n');
    }

    case 'maintenance_pendente': {
      const fin = ex.financial_picture;
      return [
        `Case: ${caseName}`,
        `Marriage date: ${timeline.marriage_date}. Cohabitation ended: ${timeline.cohabitation_end || '[not recorded]'}.`,
        `Financial picture: ${fin.maintenance_needs || 'Applicant has identified maintenance needs.'}`,
        `Pendente lite urgency: ${fin.pendente_lite_urgency}.`,
        fin.assets_known.length > 0
          ? `Known matrimonial assets: ${fin.assets_known.join(', ')}.`
          : '',
        fin.disclosure_gaps.length > 0
          ? `Disclosure gaps identified: ${fin.disclosure_gaps.join('; ')}.`
          : '',
        `Children: ${ex.children.length > 0 ? ex.children.map(c => `${c.name} (${c.age})`).join(', ') : 'None'}.`,
        '[COUNSEL TO VERIFY: Provide current income, monthly expenditure, and respondent means before filing.]',
      ].filter(Boolean).join('\n');
    }

    case 'interim_custody': {
      return [
        `Case: ${caseName}`,
        `Children of the marriage:`,
        ...ex.children.map(c =>
          `  - ${c.name}, aged ${c.age}. Current arrangement: ${c.current_arrangement}.${c.welfare_concern ? ` Welfare concern: ${c.welfare_concern}` : ''}`
        ),
        `Marriage date: ${timeline.marriage_date}. Cohabitation ended: ${timeline.cohabitation_end || '[not recorded]'}.`,
        '[COUNSEL TO VERIFY: Confirm current living arrangements and any immediate welfare risks before filing.]',
      ].filter(Boolean).join('\n');
    }

    case 'financial_disclosure': {
      const fin = ex.financial_picture;
      return [
        `Case: ${caseName}`,
        `Known assets: ${fin.assets_known.length > 0 ? fin.assets_known.join(', ') : 'None identified'}.`,
        `Disclosure gaps requiring court order: ${fin.disclosure_gaps.length > 0 ? fin.disclosure_gaps.join('; ') : 'None specified'}.`,
        `Financial picture: ${fin.maintenance_needs || '—'}.`,
        '[COUNSEL TO VERIFY: Specify exact documents required and grounds for believing non-disclosure before filing.]',
      ].filter(Boolean).join('\n');
    }

    default:
      return '';
  }
}

function IntelligenceBanner({
  matrimonialData,
  onClear,
}: {
  matrimonialData: MatrimonialCaseData;
  onClear: () => void;
}) {
  const ex = matrimonialData.intelligence_extraction;
  const runAt = matrimonialData.intelligence_run_at
    ? new Date(matrimonialData.intelligence_run_at).toLocaleDateString('en-NG', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—';
  const version = matrimonialData.intelligence_version ?? 1;
  const recommended = ex ? getRecommendedAppIds(ex) : new Set<string>();

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
            {recommended.size > 0
              ? `${recommended.size} application${recommended.size > 1 ? 's' : ''} recommended based on extraction. Highlighted below.`
              : 'No priority applications flagged. Facts box will pre-fill when you select an application.'}
            {ex?.two_year_bar?.bar_applies && !ex.two_year_bar.leave_obtained && (
              <span style={{ color: '#c04040', fontWeight: 700 }}> ⚠ s.30 bar applies — Leave to Present Petition is required first.</span>
            )}
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

 You draft court documents under the Matrimonial Causes Act Cap M7 LFN 2004 (MCA) and the Matrimonial Causes Rules 1983 (MCR).

DOCTRINAL RULES (mandatory throughout):
- Sole ground for dissolution: irretrievable breakdown s.15(1). The s.15(2)(a)–(h) facts are EVIDENCE of breakdown.
- Parties: PETITIONER and RESPONDENT — never Claimant/Defendant.
- Court: High Court of a State (or FCT High Court) — NEVER the Federal High Court.
- Proceedings commence by Petition Form 6 MCR — never by Writ.
- s.30 MCA two-year bar: no dissolution petition without leave if marriage < 2 years, unless exception applies.
- s.57 (28 days from nisi if children welfare order made) vs s.58 (3 months, no such order).
- s.241(2) CFRN: NO appeal against decree absolute — constitutional hard bar.
- Cite MCA sections, MCR Order/Rule references, and case authority (Ebe v Ebe where relevant) accurately.
- Documents must be Nigerian-law compliant and ready for counsel to review and settle before filing.

Draft all documents requested. Label each document clearly with its title and relevant statutory authority. End with a mandatory counsel review notice.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI
// ─────────────────────────────────────────────────────────────────────────────

const cardS: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 8,
  padding: '20px 22px', marginBottom: 16,
};
const secH: React.CSSProperties = {
  fontSize: 9, fontFamily: SERIF, letterSpacing: '.14em', textTransform: 'uppercase',
  fontWeight: 700, color: '#888888', marginBottom: 14, paddingBottom: 10,
  borderBottom: '1px solid #eeeeee',
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

function Btn({
  label, onClick, loading = false, disabled = false, secondary = false,
}: {
  label: string; onClick: () => void; loading?: boolean; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        background: secondary ? '#f5f5f5' : loading || disabled ? '#e0e0e0' : '#111111',
        color:  secondary ? '#444444' : loading || disabled ? '#999999' : '#ffffff',
        border: secondary ? '1px solid #cccccc' : 'none',
        borderRadius: 5, padding: '10px 22px', fontSize: 13,
        fontFamily: SERIF, cursor: loading || disabled ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
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

function UrgencyNotice({ text }: { text: string }) {
  return (
    <div style={{
      background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 5,
      padding: '10px 14px', marginTop: 10,
    }}>
      <p style={{ fontSize: 12, fontFamily: SERIF, color: '#8a5a00', lineHeight: 1.6, margin: 0 }}>
        <strong>⚠ Urgency Note:</strong> {text}
      </p>
    </div>
  );
}

function PackageList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 12, fontFamily: SERIF, color: '#333333', marginBottom: 4, lineHeight: 1.6 }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function CounselReviewNotice() {
  return (
    <div style={{
      background: '#fffbf0', border: '1px solid #e8c840', borderRadius: 6,
      padding: '12px 16px', marginTop: 18,
    }}>
      <p style={{ fontSize: 12, fontFamily: SERIF, color: '#7a5a00', lineHeight: 1.6, margin: 0 }}>
        <strong>⚠ Mandatory Counsel Review.</strong> These drafts are AI-generated starting points for counsel's review and settling. All documents — in particular affidavits — must be reviewed, settled, and any affidavit duly sworn before a Commissioner for Oaths or other competent authority before filing. Statutory section references and form numbers should be verified against the current MCR.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY PANEL
// ─────────────────────────────────────────────────────────────────────────────

function HistoryPanel({
  records, onView, onDelete,
}: {
  records: AppRecord[];
  onView: (r: AppRecord) => void;
  onDelete: (id: string) => void;
}) {
  if (records.length === 0) {
    return (
      <div style={{ ...cardS, textAlign: 'center', color: '#aaaaaa', fontFamily: SERIF, fontSize: 13, paddingTop: 40, paddingBottom: 40 }}>
        No saved applications yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {records.map(r => (
        <div key={r.id} style={{ ...cardS, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 600, color: '#111111', marginBottom: 3 }}>
                {r.appLabel}
              </p>
              <p style={{ fontSize: 11, fontFamily: SERIF, color: '#888888' }}>
                {new Date(r.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => onView(r)} style={{ background: '#111111', color: '#ffffff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                View
              </button>
              <button onClick={() => onDelete(r.id)} style={{ background: 'transparent', color: '#c04040', border: '1px solid #e0c0c0', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
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

export function MApplications({ activeCase }: Props) {
  const ai = useAI(activeCase);

  const [mainTab, setMainTab] = useState<'new' | 'history'>('new');
  const [step, setStep]     = useState<Step>(1);
  const [selApp, setSelApp] = useState<ApplicationDef | null>(null);
  const [facts, setFacts]   = useState('');
  const [draft, setDraft]   = useState('');
  const [history, setHistory] = useState<AppRecord[]>([]);
  const [viewRecord, setViewRecord] = useState<AppRecord | null>(null);
  const [copied, setCopied] = useState(false);

  // Intelligence pre-population state
  const [matrimonialData, setMatrimonialData] = useState<MatrimonialCaseData | null>(null);
  const [intelligenceCleared, setIntelligenceCleared] = useState(false);
  const [recommendedIds, setRecommendedIds] = useState<Set<string>>(new Set());

  const caseId = activeCase.id;

  useEffect(() => {
    loadBlindSpot<SavedData>(caseId, MODULE)
      .then(d => setHistory((d ?? DEFAULT_DATA).history))
      .catch(() => {});
  }, [caseId]);

  useEffect(() => {
    loadMatrimonialData(caseId)
      .then(data => {
        if (data?.intelligence_extraction) {
          setMatrimonialData(data);
          setRecommendedIds(getRecommendedAppIds(data.intelligence_extraction));
        }
      })
      .catch(() => {});
  }, [caseId]);

  async function persistHistory(next: AppRecord[]) {
    setHistory(next);
    await saveBlindSpot(caseId, MODULE, { history: next });
  }

  const handleDelete = useCallback(async (id: string) => {
    const next = history.filter(r => r.id !== id);
    await persistHistory(next);
    if (viewRecord?.id === id) setViewRecord(null);
  }, [history, viewRecord]);

  const reset = useCallback(() => {
    setStep(1);
    setSelApp(null);
    setFacts('');
    setDraft('');
    setViewRecord(null);
  }, []);

  function selectApp(app: ApplicationDef) {
    setSelApp(app);
    // Pre-fill facts from intelligence if available and not cleared
    if (matrimonialData?.intelligence_extraction && !intelligenceCleared) {
      const prefilled = buildPreFilledFacts(app.id, matrimonialData.intelligence_extraction, activeCase.caseName);
      if (prefilled) setFacts(prefilled);
    }
    setStep(2);
  }

  // ── Step 2 → 3: Generate drafts ─────────────────────────────────────────

  async function generate() {
    if (!selApp) return;

    const roleLabel = activeCase.counsel_role === 'petitioner_side'
      ? 'Petitioner Side'
      : activeCase.counsel_role === 'respondent_side'
        ? 'Respondent Side'
        : activeCase.counsel_role ?? 'Unknown Role';

    const prompt = `Case: ${activeCase.caseName}
Court: ${activeCase.court ?? 'High Court of the relevant State'}
Suit No: ${activeCase.suitNo ?? 'Not yet assigned'}
Counsel Role: ${roleLabel}

APPLICATION: ${selApp.label}
Statutory Authority: ${selApp.authority}
Document Package Required: ${selApp.package.join(', ')}

FACTS PROVIDED BY COUNSEL:
${facts}

Draft the complete document package for this application. For each document in the package:
1. Use a clear heading: "DOCUMENT [N]: [TITLE]" followed by the statutory authority.
2. Draft the full document in a format ready for counsel to review and settle.
3. Use Nigerian court conventions: proper intitulement, court name (High Court of [State]), case number, formal language.
4. For affidavits: use numbered paragraphs, deponent in first person, proper jurat clause (to be sworn before Commissioner for Oaths).
5. For motions: correct prayers, proper counsel signature block.
6. Insert [COUNSEL TO VERIFY] where specific information must be confirmed by counsel before filing.

After all documents, add a section: "## FILING CHECKLIST" with the steps counsel must complete before filing.`;

    const raw = await ai.ask({ system: MCA_SYSTEM, userMsg: prompt, maxTokens: 4000, libraryOpts: { queryHint: `MCA MCR application ${selApp.authority} ${selApp.label} affidavit motion ex-parte notice matrimonial causes` } });
    if (!raw) return;

    setDraft(raw);
    setStep(3);

    const record: AppRecord = {
      id: uid(), caseId, appId: selApp.id, appLabel: selApp.label,
      facts, documents: raw, createdAt: new Date().toISOString(),
    };
    await persistHistory([record, ...history]);
  }

  // ── Copy ─────────────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    const text = viewRecord ? viewRecord.documents : draft;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [draft, viewRecord]);

  // ── View record ──────────────────────────────────────────────────────────

  if (viewRecord) {
    return (
      <div style={{ paddingTop: 24, maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => setViewRecord(null)} style={{ background: 'transparent', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '6px 14px', fontSize: 12, fontFamily: SERIF, cursor: 'pointer' }}>
            ← Back
          </button>
          <span style={{ fontSize: 15, fontFamily: SERIF, fontWeight: 600, color: '#111111' }}>
            {viewRecord.appLabel}
          </span>
          <button onClick={handleCopy} style={{ marginLeft: 'auto', background: '#111111', color: '#ffffff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <div style={{ background: '#faf8ff', border: '1px solid #ccb8e8', borderRadius: 8, padding: '20px 22px' }}>
          <Md text={viewRecord.documents} />
        </div>
        <CounselReviewNotice />
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 24, maxWidth: 900 }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontFamily: SERIF, color: '#111111', fontWeight: 600, marginBottom: 4 }}>
          Matrimonial Applications
        </h2>
        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888' }}>
          9 MCA-specific application packages · s.30 leave · s.70 maintenance · s.71 custody · decree absolute · variation · transfer of forum
        </p>
      </div>

      {/* Intelligence banner */}
      {matrimonialData?.intelligence_extraction && !intelligenceCleared && (
        <IntelligenceBanner
          matrimonialData={matrimonialData}
          onClear={() => { setIntelligenceCleared(true); setRecommendedIds(new Set()); }}
        />
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e0e0e0' }}>
        {(['new', 'history'] as const).map(t => (
          <button key={t} onClick={() => { setMainTab(t); if (t === 'new') reset(); }}
            style={{
              background: 'transparent', border: 'none', borderBottom: mainTab === t ? '2px solid #111111' : '2px solid transparent',
              color: mainTab === t ? '#111111' : '#888888', padding: '8px 16px', fontSize: 12,
              fontFamily: SERIF, cursor: 'pointer', fontWeight: mainTab === t ? 600 : 400,
              letterSpacing: '.04em', textTransform: 'capitalize',
            }}>
            {t === 'new' ? 'New Application' : `History (${history.length})`}
          </button>
        ))}
      </div>

      {ai.error && <ErrorBlock message={ai.error} onDismiss={() => ai.clearError()} />}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────── */}
      {mainTab === 'history' && (
        <HistoryPanel records={history} onView={setViewRecord} onDelete={handleDelete} />
      )}

      {/* ── NEW APPLICATION TAB ──────────────────────────────────────────── */}
      {mainTab === 'new' && (
        <>

          {/* Step 1 — Select application */}
          {step === 1 && (
            <div>
              <div style={secH}>Step 1 — Select Application</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {APPLICATIONS.map(app => {
                  const isRecommended = recommendedIds.has(app.id);
                  return (
                  <div
                    key={app.id}
                    onClick={() => selectApp(app)}
                    style={{
                      ...cardS, marginBottom: 0, cursor: 'pointer',
                      border: `1px solid ${isRecommended ? '#4caf85' : selApp?.id === app.id ? '#4a1a7a' : '#e0e0e0'}`,
                      background: isRecommended ? '#f5fdf8' : '#ffffff',
                      transition: 'border-color .1s',
                    }}
                  >
                    {isRecommended && (
                      <div style={{ fontSize: 10, fontFamily: SERIF, fontWeight: 700, color: '#1a5a38', background: '#d8f5e8', borderRadius: 3, padding: '2px 8px', display: 'inline-block', marginBottom: 8 }}>
                        ⚡ Recommended — flagged by MIntelligence
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{app.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                          <span style={{ fontSize: 14, fontFamily: SERIF, fontWeight: 600, color: '#111111' }}>
                            {app.label}
                          </span>
                          <AuthorityBadge text={app.authority} />
                        </div>
                        <p style={{ fontSize: 12, fontFamily: SERIF, color: '#555555', lineHeight: 1.65, margin: 0 }}>
                          {app.description}
                        </p>
                        {app.urgencyNote && <UrgencyNotice text={app.urgencyNote} />}
                        <div style={{ marginTop: 10 }}>
                          <span style={lbS}>Document package</span>
                          <PackageList items={app.package} />
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2 — Facts */}
          {step === 2 && selApp && (
            <div style={cardS}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setStep(1); setFacts(''); }} style={{ background: 'transparent', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '5px 12px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                  ← Change
                </button>
                <div>
                  <p style={{ fontSize: 14, fontFamily: SERIF, fontWeight: 600, color: '#111111', marginBottom: 2 }}>
                    {selApp.icon} {selApp.label}
                  </p>
                  <AuthorityBadge text={selApp.authority} />
                </div>
              </div>

              <div style={{ background: '#fafafa', border: '1px solid #eeeeee', borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}>
                <span style={lbS}>Document package to be generated</span>
                <PackageList items={selApp.package} />
              </div>

              <label style={lbS}>Relevant facts for this application</label>
              <p style={{ fontSize: 12, fontFamily: SERIF, color: '#888888', lineHeight: 1.6, marginBottom: 10 }}>
                Provide the specific facts relevant to this application: who is applying, the basis for the relief, the current situation, any urgency, and any financial or welfare particulars required. The more specific the facts, the more tailored the draft.
              </p>
              <textarea
                style={{ ...taS, minHeight: 180 }}
                rows={10}
                value={facts}
                onChange={e => setFacts(e.target.value)}
                placeholder={`Facts relevant to: ${selApp.label}\n\nInclude: parties, dates, current circumstances, basis for relief, urgency if any, financial particulars if relevant…`}
              />

              <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                <Btn label="← Back" onClick={() => { setStep(1); }} secondary />
                <Btn
                  label={`Generate ${selApp.package.length} Document${selApp.package.length !== 1 ? 's' : ''} →`}
                  onClick={generate}
                  loading={ai.loading}
                  disabled={facts.trim().length < 40}
                />
              </div>
            </div>
          )}

          {/* Step 3 — Generated documents */}
          {step === 3 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <button onClick={() => setStep(2)} style={{ background: 'transparent', border: '1px solid #cccccc', color: '#444444', borderRadius: 4, padding: '5px 12px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                  ← Back
                </button>
                <span style={{ fontSize: 14, fontFamily: SERIF, fontWeight: 600, color: '#111111', flex: 1 }}>
                  {selApp?.label}
                </span>
                <button onClick={handleCopy} style={{ background: '#111111', color: '#ffffff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 11, fontFamily: SERIF, cursor: 'pointer' }}>
                  {copied ? 'Copied ✓' : 'Copy All'}
                </button>
                <Btn label="New Application" onClick={reset} secondary />
              </div>

              <div style={{ background: '#faf8ff', border: '1px solid #ccb8e8', borderRadius: 8, padding: '20px 22px' }}>
                <Md text={draft} />
              </div>
              <CounselReviewNotice />
            </>
          )}
        </>
      )}
    </div>
  );
}
