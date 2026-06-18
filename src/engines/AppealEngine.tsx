/**
 * AFS Advocates — Appeal Intelligence Engine
 * Phase 2 — Full implementation
 *
 * 5-step appellate pipeline:
 *   Step 1 — Court & Role selection (Court of Appeal / Supreme Court, Appellant / Respondent)
 *   Step 2 — Lower Court Record input (judgment summary + what was argued)
 *   Step 3 — AI Extraction (grounds, issues, preserved/abandoned points, risks) → JSON
 *   Step 4 — Cross-Level Tracking (displayed as part of Step 3 results)
 *   Step 5 — Full Appellate Intelligence Package generation
 *
 * Distinct from Trial Intelligence Engine — appellate reasoning framework,
 * Nigerian appellate procedure (CA Rules 2021, SC Rules 2014).
 * All data persisted to case via onSave().
 */

import React, { useState } from 'react';
import type { Case }       from '@/types';
import { T }              from '@/constants/tokens';
import { callClaude }   from '@/services/api';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md }             from '@/components/common/ui';
import { useIntelligence } from '@/hooks/useIntelligence';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { uid } from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ACC  = '#8050d0';
const ACCL = '#a070f0';

const AIE_STEPS = [
  { id: 1, label: 'Court & Role'  },
  { id: 2, label: 'Lower Record' },
  { id: 3, label: 'AI Extraction'},
  { id: 4, label: 'Cross-Level'  },
  { id: 5, label: 'Package'      },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
  onSave:     (data: unknown) => void;
}

interface GroundItem {
  ground:    string;
  strength:  'STRONG' | 'ARGUABLE' | 'WEAK';
  basis:     string;
  category?: string;
}

interface RiskItem {
  risk:     string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface Extraction {
  what_was_decided:             string[];
  lower_court_errors:           Array<{ error: string; category: string; exploitable: boolean }>;
  grounds_identified:           GroundItem[];
  issues_for_determination:     string[];
  preserved_points:             string[];
  abandoned_points:             string[];
  record_inconsistencies:       string[];
  cross_appeal_potential:       string;
  preliminary_objection_risks:  string[];
  limitation_analysis:          string;
  procedural_risks:             RiskItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function roleLabel(c: Case): string {
  const role  = c.counsel_role  || c.role || 'claimant_side';
  const track = c.matter_track  || 'civil';
  return `MATTER TRACK: ${track.toUpperCase()} | TRIAL COUNSEL ROLE: ${role.toUpperCase().replace(/_/g, ' ')}`;
}

function extractionSystemPrompt(c: Case, appealRole: string): string {
  const role  = c.counsel_role  || c.role || 'claimant_side';
  const track = c.matter_track  || 'civil';
  const isCriminal = track === 'criminal';
  const roleCtx = isCriminal
    ? (role === 'prosecution'
        ? 'You acted as PROSECUTION at trial. On appeal, analyse errors that affect the conviction or sentence from the prosecution\'s perspective.'
        : 'You acted as DEFENCE at trial. On appeal, analyse every error that could secure acquittal, reduce sentence, or advance the accused\'s interests.')
    : (role === 'claimant_side'
        ? 'You acted for the CLAIMANT at trial. On appeal, analyse errors that affect the reliefs granted or refused from the claimant\'s perspective.'
        : 'You acted for the DEFENDANT at trial. On appeal, analyse errors that could set aside an adverse judgment or reduce liability from the defendant\'s perspective.');
  return `You are a Senior Appellate Counsel at AFS Advocates, expert in Nigerian appellate practice before the Court of Appeal and the Supreme Court.\n${roleCtx}\nOur role on this appeal: ${appealRole}.\nAnalyse the lower court record and extract structured appellate intelligence. Return ONLY valid JSON — no markdown fences, no explanation, no preamble.`;
}

function packageSystemPrompt(c: Case, appealRole: string): string {
  const role  = c.counsel_role  || c.role || 'claimant_side';
  const track = c.matter_track  || 'civil';
  const isCriminal = track === 'criminal';
  const roleCtx = isCriminal
    ? (role === 'prosecution'
        ? 'acting as PROSECUTION APPELLATE COUNSEL — your goal is to uphold the conviction/sentence or prosecute the appeal successfully.'
        : 'acting as DEFENCE APPELLATE COUNSEL — your goal is to secure acquittal, reduce sentence, or achieve the best outcome for the accused on appeal.')
    : (role === 'claimant_side'
        ? 'acting as CLAIMANT APPELLATE COUNSEL — your goal is to uphold or expand the reliefs granted, or prosecute the appeal for the claimant.'
        : 'acting as DEFENDANT APPELLATE COUNSEL — your goal is to set aside the adverse order or reduce liability for the defendant on appeal.');
  return `You are a Senior Appellate Counsel at AFS Advocates, ${roleCtx}\nOur appellate role: ${appealRole}.\nGenerate a comprehensive, practical Appellate Intelligence Package. Use clean formatted markdown: ## for main sections, ### for subsections, **bold** for critical items, - for bullets. Be precise, analytical, and grounded in Nigerian appellate procedure and case law. Every section must be substantive — no generic padding.`;
}

function copyText(text: string): void {
  try { navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED LOCAL STYLES
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};

const lbS: React.CSSProperties = {
  fontSize: 9, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28, padding: '14px 18px', background: '#ffffff', border: '1px solid #181828', borderRadius: 8, overflowX: 'auto' }}>
      {AIE_STEPS.map((s, i) => {
        const done   = current > s.id;
        const active = current === s.id;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, minWidth: 62 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                background: done ? '#1a1030' : active ? '#0e0818' : '#0d0d18',
                border: `2px solid ${done ? '#4a2880' : active ? ACC : '#cccccc'}`,
                color: done ? ACCL : active ? ACC : '#cccccc',
                fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, transition: 'all .3s', flexShrink: 0,
              }}>
                {done ? '✓' : s.id}
              </div>
              <span style={{ fontSize: 8, color: done ? ACCL : active ? ACC : '#cccccc', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.25, maxWidth: 58 }}>
                {s.label}
              </span>
            </div>
            {i < AIE_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: done ? '#4a2880' : '#131320', minWidth: 6, transition: 'background .3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SPINNER
// ─────────────────────────────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '54px 24px' }}>
      <div style={{ width: 32, height: 32, border: `2px solid ${T.bdr}`, borderTop: `2px solid ${ACC}`, borderRadius: '50%', margin: '0 auto 18px', animation: 'spin .9s linear infinite' }} />
      <p style={{ fontSize: 19, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>{label}</p>
      <p style={{ fontSize: 10, color: '#cccccc', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', marginTop: 10 }}>
        APPEAL INTELLIGENCE ENGINE · SPECTER-LIT STANDARD
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR BANNER
// ─────────────────────────────────────────────────────────────────────────────

function ErrBanner({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div style={{ background: '#180808', border: '1px solid #401818', borderRadius: 5, padding: '10px 14px', marginBottom: 14 }}>
      <p style={{ color: '#c07070', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>{error}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE C.3 — APPEAL DOCUMENT DRAFTERS
// Brief of Argument, Reply Brief, Respondent's Notice
// ─────────────────────────────────────────────────────────────────────────────

type AppealDocTab = 'brief_of_argument' | 'reply_brief' | 'respondents_notice';

interface BriefIssueEntry {
  id:          string;
  /** Ground / Error of Law or Fact (Appellant) · Ground Being Attacked (Respondent) */
  ground:      string;
  /** Rule / Principle Violated (Appellant) · Supporting Rule / Authority (Respondent) */
  rule:        string;
  /** Application to Lower Court Record (Appellant) · Why the Lower Court Was Correct (Respondent) */
  application: string;
  /** Relief Sought (Appellant) · Why Appellant's Argument Fails (Respondent) */
  outcome:     string;
}

interface ReplyIssueEntry {
  id:       string;
  /** New point in the Respondent's Brief only — never a re-argument of an existing ground */
  newPoint: string;
}

interface AppealDocData {
  briefContext?:            string;
  briefDraft?:              string;
  replyBriefContext?:       string;
  replyBriefDraft?:         string;
  respondentsNoticeContext?: string;
  respondentsNoticeDraft?:  string;
}

function AppealDocDrafters({
  activeCase,
  extraction,
  intPkg,
  appealCourt,
  appealRole,
}: {
  activeCase: Case;
  extraction: Extraction | null;
  intPkg:     string;
  appealCourt: string;
  appealRole:  string;
}) {
  const [activeDocTab, setActiveDocTab] = useState<AppealDocTab>('brief_of_argument');
  const [docData, setDocData]           = useState<AppealDocData>({});
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const { fullContext, hasIntel } = useIntelligence(activeCase);

  const docTabs: { id: AppealDocTab; label: string }[] = [
    { id: 'brief_of_argument',  label: 'Brief of Argument' },
    { id: 'reply_brief',        label: 'Reply Brief' },
    { id: 'respondents_notice', label: "Respondent's Notice" },
  ];

  const isAppellant = appealRole === 'Appellant';

  // ── Brief of Argument — ground-by-ground issue builder ─────────────────────
  const [briefIssues, setBriefIssues] = useState<BriefIssueEntry[]>(() => {
    if (extraction?.grounds_identified?.length) {
      return extraction.grounds_identified.map(g => ({
        id: uid(), ground: g.ground, rule: '', application: g.basis, outcome: '',
      }));
    }
    return [{ id: uid(), ground: '', rule: '', application: '', outcome: '' }];
  });

  function addBriefIssue() {
    setBriefIssues(prev => [...prev, { id: uid(), ground: '', rule: '', application: '', outcome: '' }]);
  }
  function removeBriefIssue(id: string) {
    setBriefIssues(prev => prev.filter(i => i.id !== id));
  }
  function updateBriefIssue(id: string, field: keyof BriefIssueEntry, val: string) {
    setBriefIssues(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i));
  }
  function importGroundsFromExtraction() {
    if (!extraction?.grounds_identified?.length) return;
    setBriefIssues(extraction.grounds_identified.map(g => ({
      id: uid(), ground: g.ground, rule: '', application: g.basis, outcome: '',
    })));
  }

  // ── Reply Brief — restricted new-points-only builder ────────────────────────
  const [replyIssues, setReplyIssues] = useState<ReplyIssueEntry[]>([{ id: uid(), newPoint: '' }]);

  function addReplyIssue() {
    setReplyIssues(prev => [...prev, { id: uid(), newPoint: '' }]);
  }
  function removeReplyIssue(id: string) {
    setReplyIssues(prev => prev.filter(i => i.id !== id));
  }
  function updateReplyIssue(id: string, val: string) {
    setReplyIssues(prev => prev.map(i => i.id === id ? { ...i, newPoint: val } : i));
  }

  async function draftBrief() {
    setLoading(true); setError('');
    const groundsList = extraction?.grounds_identified
      ?.map((g, i) => `Ground ${i + 1}: ${g.ground} [${g.strength}] — ${g.basis}`)
      .join('\n') ?? 'Not yet extracted — extract appellate intelligence first.';

    const issuesList = extraction?.issues_for_determination?.join('\n') ?? '';

    const validBriefIssues = briefIssues.filter(i => i.ground.trim());
    const issueFrameworkText = validBriefIssues.length
      ? validBriefIssues.map((bi, i) => isAppellant
          ? `GROUND ${i + 1}: ${bi.ground}\nRule / Principle Violated: ${bi.rule || '[counsel to supply]'}\nApplication to Lower Court Record: ${bi.application || '[counsel to supply]'}\nRelief Sought: ${bi.outcome || '[counsel to supply]'}`
          : `GROUND BEING ATTACKED ${i + 1}: ${bi.ground}\nWhy the Lower Court Was Correct: ${bi.application || '[counsel to supply]'}\nSupporting Rule / Authority: ${bi.rule || '[counsel to supply]'}\nWhy Appellant's Argument Fails: ${bi.outcome || '[counsel to supply]'}`
        ).join('\n\n')
      : 'Counsel has not yet built a ground-by-ground framework — draft from the extracted grounds and intelligence package below.';

    const prompt = `You are a Senior Appellate Counsel at AFS Advocates drafting the ${isAppellant ? "Appellant's" : "Respondent's"} Brief of Argument.

Case: ${activeCase.caseName}
Appeal Court: ${appealCourt}
Our Role: ${appealRole}
Matter Track: ${activeCase.matter_track ?? 'civil'}
Trial Role: ${activeCase.counsel_role ?? 'claimant_side'}

Counsel's Ground-by-Ground Argument Framework:
${issueFrameworkText}

All Extracted Grounds of Appeal (for reference/completeness):
${groundsList}

Issues for Determination (from extraction):
${issuesList}

Appellate Intelligence Package (summary):
${intPkg ? intPkg.substring(0, 2000) : 'Not yet generated.'}

Counsel's Additional Notes (optional, supplementary to the framework above):
${docData.briefContext || 'None provided.'}

Draft the complete ${isAppellant ? "Appellant's" : "Respondent's"} Brief of Argument in Nigerian appellate practice form.

MANDATORY STRUCTURE:

**COVER PAGE**
IN THE [COURT]
[APPEAL COURT NUMBER e.g. CA/L/XXX/YEAR]
BETWEEN:
[APPELLANT NAME] — Appellant
AND
[RESPONDENT NAME] — Respondent

${isAppellant ? "APPELLANT'S" : "RESPONDENT'S"} BRIEF OF ARGUMENT

[Counsel's name, firm, address for service]
Date:

---

**TABLE OF CONTENTS** (list all sections with page references as [X])

---

**LIST OF CASES CITED** (alphabetical — Nigerian courts first, then others)

---

**LIST OF STATUTES AND RULES REFERRED TO**

---

**STATEMENT OF FACTS** (brief, factual, non-argumentative — what happened at the lower court)

---

**ISSUES FOR DETERMINATION**
${isAppellant
  ? 'Distil all grounds into the minimum number of precise issues. Each issue must be capable of resolving the appeal. Formulate as a question ending with a question mark.'
  : 'Adopt or reformulate the Appellant\'s issues. Where adopted, state "Appellant\'s Issues are adopted." Where reformulated, state the reformulated issue.'}

---

**ARGUMENT**
For each Issue:
### ISSUE [N]: [Restate the issue]

**Arguments:**
- Lead with the applicable legal principle (cite authority)
- Apply the principle to the facts of the case
- Address the specific error(s) of the lower court (for Appellant) / why the decision was correct (for Respondent)
- Cite relevant Nigerian Supreme Court and Court of Appeal decisions
- Address any procedural or jurisdictional points first before merits

---

**CONCLUSION**
Summarise the relief sought. Restate why the appeal should be allowed/dismissed. End with formal prayer to the court.

---

Nigerian brief-writing rules:
- Every proposition of law must be supported by authority in brackets: (See: Case Name [year] NWLR Part Page ratio; s. X Statute)
- Authorities must be Nigerian unless no Nigerian authority exists — then cite Commonwealth
- No new grounds may be argued beyond those in the Notice of Appeal (for Appellant)
- Flag any authority that requires RAG verification with [AUTHORITY TO VERIFY]
- Issue formulation must match the grounds argued
- Library Rule: Only cite authorities the engine can verify — flag uncertain citations

Return the complete draft brief.`;

    try {
      const system = `${buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role)} You are drafting a Nigerian ${isAppellant ? "Appellant's" : "Respondent's"} Brief of Argument before the ${appealCourt || 'appellate court'}, applying the ${appealCourt === 'Supreme Court' ? 'Supreme Court Rules 2014' : 'Court of Appeal Rules 2021'}. NEVER fabricate case citations, names, years, volumes, or law reports — where an authority cannot be verified, flag it clearly with [AUTHORITY TO VERIFY] rather than inventing one.` + fullContext;
      const result = await callClaude({ system, userMsg: prompt, maxTokens: 4500,
        matter_track: activeCase.matter_track, counsel_role: activeCase.counsel_role });
      if (result) setDocData(p => ({ ...p, briefDraft: result }));
    } catch (e: unknown) {
      setError('Draft failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally { setLoading(false); }
  }

  async function draftReplyBrief() {
    setLoading(true); setError('');
    const validPoints = replyIssues.filter(i => i.newPoint.trim());
    const pointsText = validPoints.length
      ? validPoints.map((p, i) => `${i + 1}. ${p.newPoint}`).join('\n')
      : 'Counsel has not yet identified specific new points — draft a template structure with placeholders.';

    const prompt = `You are a Senior Appellate Counsel at AFS Advocates drafting a Reply Brief.

Case: ${activeCase.caseName}
Appeal Court: ${appealCourt}
Our Role: ${appealRole}

New Points of Law Raised in the Respondent's Brief (counsel-identified, one per entry — each must be a genuinely new point not already in the Appellant's main Brief):
${pointsText}

Supplementary notes from counsel:
${docData.replyBriefContext || 'None provided.'}

Before drafting, review the listed points above. If any entry appears to restate an issue already argued rather than raise a genuinely new point of law, flag it at the very top of your output — before the cover page — under a heading "SCOPE CHECK", quoting the entry and explaining why it looks like a re-argument. If every entry is a properly new point, state "SCOPE CHECK: All entries confirmed as new points of law." Then proceed to draft the Reply Brief in Nigerian appellate practice form.

MANDATORY STRUCTURE:

COVER PAGE (same format as main brief — headed "APPELLANT'S REPLY BRIEF")

PRELIMINARY NOTE:
State that this Reply Brief is filed pursuant to [applicable Court rule on reply briefs] and responds only to new points of law raised in the Respondent's Brief not covered in the Appellant's Brief.

LIST OF CASES CITED IN REPLY

ARGUMENT IN REPLY:
For each new legal point raised by the Respondent (not already addressed in the main Brief):
### Reply to [Respondent's Argument / Issue X]
- Identify the new point being replied to
- State why the Respondent's argument is wrong in law or fact
- Cite authority
- Distinguish any cases the Respondent relies upon

IMPORTANT RULE: A Reply Brief may NOT introduce new grounds of appeal or new arguments not raised in the main Brief. If counsel identifies new arguments, flag them with [NEW ARGUMENT — CANNOT BE IN REPLY BRIEF — consider amending main Brief or seeking leave].

CONCLUSION: Brief prayer restating the relief from the main Brief.

Return the complete draft Reply Brief.`;

    try {
      const system = `${buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role)} CRITICAL RESTRICTION: A Reply Brief may only respond to new points raised by the Respondent that were not in the Appellant's Brief. It cannot introduce new grounds of appeal or re-argue issues already addressed. NEVER fabricate case citations — flag any authority that cannot be verified with [AUTHORITY TO VERIFY].` + fullContext;
      const result = await callClaude({ system, userMsg: prompt, maxTokens: 3000,
        matter_track: activeCase.matter_track, counsel_role: activeCase.counsel_role });
      if (result) setDocData(p => ({ ...p, replyBriefDraft: result }));
    } catch (e: unknown) {
      setError('Draft failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally { setLoading(false); }
  }

  async function draftRespondentsNotice() {
    setLoading(true); setError('');
    const prompt = `You are a Senior Appellate Counsel at AFS Advocates drafting a Respondent's Notice.

Case: ${activeCase.caseName}
Appeal Court: ${appealCourt}
Our Role: ${appealRole} (Respondent)

Grounds on which the Respondent seeks to uphold the judgment on different/additional grounds:
${docData.respondentsNoticeContext || 'Counsel instructions not yet provided — draft a template with placeholders.'}

Draft a complete Respondent's Notice under Order [X] Rule [Y] of the ${appealCourt} Rules.

STRUCTURE:

HEADING: [Court heading, case number]
RESPONDENT'S NOTICE
Pursuant to Order [X] Rule [Y] of the [Court of Appeal / Supreme Court] Rules [Year]

The Respondent, [Name], by this Notice states that the Respondent desires that the judgment of the lower court be affirmed on grounds other than or in addition to those relied on by that court.

ADDITIONAL / ALTERNATIVE GROUNDS:
[Numbered grounds — each ground must identify:]
a. The legal proposition relied on
b. How it supports affirmation of the decision (even if on different reasoning)
c. The record reference

PURPOSE NOTE: A Respondent's Notice is NOT a cross-appeal. It does not seek to improve the Respondent's position — it only seeks to uphold the existing judgment on different or additional reasoning. Flag any ground that actually seeks a better outcome than the judgment with [THIS REQUIRES A CROSS-APPEAL — NOT A RESPONDENT'S NOTICE].

PRAYER: That the judgment of the lower court be affirmed.

Signed: [Counsel's name, firm, address]
Date:

Return the complete draft Respondent's Notice.`;

    try {
      const result = await callClaude({ userMsg: prompt, maxTokens: 2000,
        matter_track: activeCase.matter_track, counsel_role: activeCase.counsel_role });
      if (result) setDocData(p => ({ ...p, respondentsNoticeDraft: result }));
    } catch (e: unknown) {
      setError('Draft failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally { setLoading(false); }
  }

  // ── Sub-tab bar ────────────────────────────────────────────────────────────
  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>
      <div style={{ marginBottom: 22 }}>
        <p style={{ fontSize: 10, color: ACCL, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Appeal Documents · Phase C.3</p>
        <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>Appeal Document Drafters</h2>
        <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          Draft the full Brief of Argument, Reply Brief, and Respondent's Notice. These documents draw from the extracted grounds and intelligence package above.
          {!extraction && <span style={{ color: '#c08030' }}> — Complete extraction (Step 3) first for the richest output.</span>}
        </p>
      </div>

      {/* Doc tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {docTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveDocTab(t.id)}
            style={{
              background:   activeDocTab === t.id ? `${ACC}18` : 'transparent',
              border:       `1px solid ${activeDocTab === t.id ? ACC : '#cccccc'}`,
              color:        activeDocTab === t.id ? ACC : T.mute,
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

      {/* Brief of Argument */}
      {activeDocTab === 'brief_of_argument' && (
        <div>
          <div style={{ fontSize: 11, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: `1px solid ${ACC}20`, paddingBottom: 8 }}>
            {isAppellant ? "Appellant's" : "Respondent's"} Brief of Argument
          </div>
          <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, lineHeight: 1.6 }}>
            Build the argument ground by ground, then the AI drafts the complete {isAppellant ? "Appellant's" : "Respondent's"} Brief using this framework plus the extracted intelligence package.
          </p>
          {hasIntel && (
            <div style={{ marginBottom: 14, background: '#071810', border: '1px solid #1a4028', borderRadius: 5, padding: '7px 12px' }}>
              <p style={{ fontSize: 10, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", margin: 0, fontWeight: 700, letterSpacing: '.06em' }}>
                ✓ Trial Intelligence Package detected — will be injected into the draft
              </p>
            </div>
          )}

          {briefIssues.map((bi, idx) => (
            <div key={bi.id} style={{ background: '#08080e', border: '1px solid #1e1e30', borderRadius: 7, padding: '16px 18px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  {isAppellant ? `Ground ${idx + 1}` : `Ground Attacked ${idx + 1}`}
                </span>
                {briefIssues.length > 1 && (
                  <button onClick={() => removeBriefIssue(bi.id)} style={{ background: 'transparent', border: '1px solid #3a1a1a', color: '#804040', borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontFamily: "'Times New Roman', Times, serif" }}>
                    remove
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                    {isAppellant ? 'Ground / Error of Law or Fact' : 'Ground Being Attacked'}
                  </label>
                  <textarea value={bi.ground} onChange={e => updateBriefIssue(bi.id, 'ground', e.target.value)} rows={2}
                    placeholder={isAppellant ? 'State the specific error of law or fact the lower court made.' : "State the Appellant's ground exactly as you expect it to be argued."}
                    style={{ width: '100%', background: '#0a0a12', border: '1px solid #cccccc', borderRadius: 5, padding: '9px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                    {isAppellant ? 'Rule / Principle Violated' : 'Supporting Rule / Authority'}
                  </label>
                  <textarea value={bi.rule} onChange={e => updateBriefIssue(bi.id, 'rule', e.target.value)} rows={2}
                    placeholder={isAppellant ? 'The legal rule, principle, or statutory provision the lower court got wrong.' : 'The rule or authority that supports the lower court being correct.'}
                    style={{ width: '100%', background: '#0a0a12', border: '1px solid #cccccc', borderRadius: 5, padding: '9px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                    {isAppellant ? 'Application to Lower Court Record' : 'Why the Lower Court Was Correct'}
                  </label>
                  <textarea value={bi.application} onChange={e => updateBriefIssue(bi.id, 'application', e.target.value)} rows={3}
                    placeholder={isAppellant ? 'Apply the rule to the specific facts in the record — cite the relevant pages/exhibits.' : 'Explain why the decision below was right on the facts and the law, with record references.'}
                    style={{ width: '100%', background: '#0a0a12', border: '1px solid #cccccc', borderRadius: 5, padding: '9px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                    {isAppellant ? 'Relief Sought' : "Why Appellant's Argument Fails"}
                  </label>
                  <textarea value={bi.outcome} onChange={e => updateBriefIssue(bi.id, 'outcome', e.target.value)} rows={2}
                    placeholder={isAppellant ? 'What should the appellate court do on this ground — set aside, vary, remit?' : "State precisely why the Appellant's ground cannot succeed."}
                    style={{ width: '100%', background: '#0a0a12', border: '1px solid #cccccc', borderRadius: 5, padding: '9px 12px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
                </div>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <button onClick={addBriefIssue} style={{ background: 'transparent', border: `1px dashed ${ACC}50`, color: ACC, borderRadius: 5, padding: '7px 18px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              + Add Ground
            </button>
            {!!extraction?.grounds_identified?.length && (
              <button onClick={importGroundsFromExtraction} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '7px 18px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
                ↺ Re-import Grounds from Extraction
              </button>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Additional Notes (Optional)</label>
            <textarea
              value={docData.briefContext ?? ''}
              onChange={e => setDocData(p => ({ ...p, briefContext: e.target.value }))}
              rows={3}
              placeholder="Anything not captured above — particular emphasis, authorities you want relied on, or strategic notes."
              style={{ width: '100%', background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '10px 14px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <button
            onClick={draftBrief}
            disabled={loading}
            style={{ background: loading ? '#101018' : `linear-gradient(135deg,#000000,${ACC})`, color: loading ? '#2a2a38' : '#f0ecff', border: 'none', borderRadius: 6, padding: '11px 26px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em' }}
          >
            {loading ? '⟳ Drafting Brief…' : `Draft ${isAppellant ? "Appellant's" : "Respondent's"} Brief of Argument`}
          </button>
          {error && <div style={{ marginTop: 12, background: '#180808', border: '1px solid #401818', borderRadius: 5, padding: '10px 14px' }}><p style={{ color: '#c07070', fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>{error}</p></div>}
          {docData.briefDraft && (
            <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${ACC}30`, borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
                  {isAppellant ? "Appellant's" : "Respondent's"} Brief — Draft
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => navigator.clipboard?.writeText(docData.briefDraft!)} style={{ background: 'transparent', border: `1px solid ${ACC}30`, color: ACC, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", borderRadius: 4, padding: '3px 10px' }}>copy</button>
                  <button onClick={() => setDocData(p => ({ ...p, briefDraft: '' }))} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>clear ×</button>
                </div>
              </div>
              <Md text={docData.briefDraft} />
            </div>
          )}
        </div>
      )}

      {/* Reply Brief */}
      {activeDocTab === 'reply_brief' && (
        <div>
          <div style={{ fontSize: 11, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: `1px solid ${ACC}20`, paddingBottom: 8 }}>
            Reply Brief
          </div>
          <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, lineHeight: 1.6 }}>
            A Reply Brief responds only to new points of law raised in the Respondent's Brief that were not covered in the Appellant's Brief. List each new point as a separate entry below.
          </p>
          <div style={{ marginBottom: 14, background: '#1a1000', border: '1px solid #3a2800', borderRadius: 6, padding: '10px 14px' }}>
            <p style={{ fontSize: 11, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
              ⚠ A Reply Brief cannot introduce new grounds or re-argue points already in the main Brief. The AI will run a scope check on every entry before drafting and flag anything that looks like a re-argument.
            </p>
          </div>

          {replyIssues.map((ri, idx) => (
            <div key={ri.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: ACC, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, minWidth: 22, marginTop: 10 }}>{idx + 1}.</span>
              <textarea
                value={ri.newPoint}
                onChange={e => updateReplyIssue(ri.id, e.target.value)}
                rows={3}
                placeholder="State one new point of law raised in the Respondent's Brief that was not already addressed in the Appellant's main Brief."
                style={{ flex: 1, background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '10px 14px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
              />
              {replyIssues.length > 1 && (
                <button onClick={() => removeReplyIssue(ri.id)} style={{ background: 'transparent', border: '1px solid #3a1a1a', color: '#804040', borderRadius: 3, padding: '8px 10px', cursor: 'pointer', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", marginTop: 2 }}>×</button>
              )}
            </div>
          ))}
          <button onClick={addReplyIssue} style={{ background: 'transparent', border: `1px dashed ${ACC}50`, color: ACC, borderRadius: 5, padding: '7px 18px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', marginBottom: 16, display: 'block' }}>
            + Add New Point
          </button>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Supplementary Notes (Optional)</label>
            <textarea
              value={docData.replyBriefContext ?? ''}
              onChange={e => setDocData(p => ({ ...p, replyBriefContext: e.target.value }))}
              rows={3}
              placeholder="Anything not captured above — e.g. specific authorities to distinguish."
              style={{ width: '100%', background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '10px 14px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <button
            onClick={draftReplyBrief}
            disabled={loading}
            style={{ background: loading ? '#101018' : `linear-gradient(135deg,#000000,${ACC})`, color: loading ? '#2a2a38' : '#f0ecff', border: 'none', borderRadius: 6, padding: '11px 26px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em' }}
          >
            {loading ? '⟳ Drafting Reply Brief…' : 'Draft Reply Brief'}
          </button>
          {error && <div style={{ marginTop: 12, background: '#180808', border: '1px solid #401818', borderRadius: 5, padding: '10px 14px' }}><p style={{ color: '#c07070', fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>{error}</p></div>}
          {docData.replyBriefDraft && (
            <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${ACC}30`, borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Reply Brief — Draft</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => navigator.clipboard?.writeText(docData.replyBriefDraft!)} style={{ background: 'transparent', border: `1px solid ${ACC}30`, color: ACC, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", borderRadius: 4, padding: '3px 10px' }}>copy</button>
                  <button onClick={() => setDocData(p => ({ ...p, replyBriefDraft: '' }))} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>clear ×</button>
                </div>
              </div>
              <Md text={docData.replyBriefDraft} />
            </div>
          )}
        </div>
      )}

      {/* Respondent's Notice */}
      {activeDocTab === 'respondents_notice' && (
        <div>
          <div style={{ fontSize: 11, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: `1px solid ${ACC}20`, paddingBottom: 8 }}>
            Respondent's Notice
          </div>
          <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", marginBottom: 8, lineHeight: 1.6 }}>
            A Respondent's Notice is used to uphold the judgment on additional or different grounds — without seeking a better outcome than the judgment already gives. It is not a cross-appeal.
          </p>
          <div style={{ marginBottom: 16, background: '#071810', border: '1px solid #1a4028', borderRadius: 6, padding: '10px 14px' }}>
            <p style={{ fontSize: 11, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", margin: 0, lineHeight: 1.6 }}>
              ✓ Use this when: the lower court reached the right result but on the wrong or incomplete grounds, and you want to give the appellate court additional legal basis to affirm.
            </p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Additional / Alternative Grounds to Uphold the Judgment</label>
            <textarea
              value={docData.respondentsNoticeContext ?? ''}
              onChange={e => setDocData(p => ({ ...p, respondentsNoticeContext: e.target.value }))}
              rows={6}
              placeholder="Identify the additional or different legal grounds on which the judgment should be upheld. e.g. 'The court was right to dismiss the claim but should also have found that the limitation period had expired under s. X.' Leave blank to generate a template."
              style={{ width: '100%', background: '#08080e', border: '1px solid #cccccc', borderRadius: 6, padding: '10px 14px', color: T.fg, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <button
            onClick={draftRespondentsNotice}
            disabled={loading}
            style={{ background: loading ? '#101018' : `linear-gradient(135deg,#000000,${ACC})`, color: loading ? '#2a2a38' : '#f0ecff', border: 'none', borderRadius: 6, padding: '11px 26px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em' }}
          >
            {loading ? "⟳ Drafting Notice…" : "Draft Respondent's Notice"}
          </button>
          {error && <div style={{ marginTop: 12, background: '#180808', border: '1px solid #401818', borderRadius: 5, padding: '10px 14px' }}><p style={{ color: '#c07070', fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>{error}</p></div>}
          {docData.respondentsNoticeDraft && (
            <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${ACC}30`, borderRadius: 8, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Respondent's Notice — Draft</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => navigator.clipboard?.writeText(docData.respondentsNoticeDraft!)} style={{ background: 'transparent', border: `1px solid ${ACC}30`, color: ACC, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", borderRadius: 4, padding: '3px 10px' }}>copy</button>
                  <button onClick={() => setDocData(p => ({ ...p, respondentsNoticeDraft: '' }))} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>clear ×</button>
                </div>
              </div>
              <Md text={docData.respondentsNoticeDraft} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}



export function AppealEngine({ activeCase, onSave }: Props) {
  const { fullContext, hasIntel } = useIntelligence(activeCase);

  const saved = (activeCase.appeal_data ?? {}) as Record<string, unknown>;

  const [stage,           setStage]          = useState<number>((saved.aStage as number) || 1);
  const [appealCourt,     setAppealCourt]     = useState<string>((saved.appealCourt  as string) || '');
  const [appealRole,      setAppealRole]      = useState<string>((saved.appealRole   as string) || '');
  const [lowerCourt,      setLowerCourt]      = useState<string>((saved.lowerCourt   as string) || '');
  const [judgmentSummary, setJudgmentSummary] = useState<string>((saved.judgmentSummary as string) || '');
  const [whatArgued,      setWhatArgued]      = useState<string>((saved.whatArgued   as string) || '');
  const [extraction,      setExtraction]      = useState<Extraction | null>((saved.extraction as Extraction) || null);
  const [intPkg,          setIntPkg]          = useState<string>((saved.intPkg       as string) || '');
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState('');
  const [copied,          setCopied]          = useState(false);

  function persist(updates: Record<string, unknown>) {
    const data = { aStage: stage, appealCourt, appealRole, lowerCourt, judgmentSummary, whatArgued, extraction, intPkg, ...updates };
    onSave(data);
  }

  function goBack(s: number) { setStage(s); setError(''); }

  function resetPipeline() {
    if (!window.confirm('Reset the Appeal Intelligence pipeline? All extracted data will be cleared.')) return;
    setStage(1); setAppealCourt(''); setAppealRole(''); setLowerCourt('');
    setJudgmentSummary(''); setWhatArgued(''); setExtraction(null); setIntPkg(''); setError('');
    onSave({});
  }

  // ── AI Call 1: Extract appellate intelligence ───────────────────────────────
  async function runExtraction() {
    if (!appealCourt || !appealRole)            { setError('Select the appellate court and your role.'); return; }
    if (judgmentSummary.trim().length < 80)     { setError('Judgment summary must be at least 80 characters.'); return; }
    setLoading(true); setError('');
    try {
      const raw = await callClaude({
        system:    extractionSystemPrompt(activeCase, appealRole),
        messages:  [{ role: 'user', content:
`APPEAL COURT: ${appealCourt}
ROLE ON APPEAL: ${appealRole}
LOWER COURT: ${lowerCourt || 'Not specified'}
CASE NAME: ${activeCase.caseName}
${roleLabel(activeCase)}

JUDGMENT / RULING BEING APPEALED:
${judgmentSummary}

WHAT WAS ARGUED BELOW:
${whatArgued || 'Not specifically provided — infer from judgment summary.'}

Return ONLY this exact JSON structure (no markdown, no preamble):
{
  "what_was_decided": ["concise statement of what the court decided on each issue"],
  "lower_court_errors": [{"error":"specific error made by the court","category":"Law|Fact|Mixed Law and Fact|Procedure","exploitable":true}],
  "grounds_identified": [{"ground":"the specific appealable ground","strength":"STRONG|ARGUABLE|WEAK","basis":"why this ground exists in the record"}],
  "issues_for_determination": ["crisp appellate issue distilled from the grounds"],
  "preserved_points": ["points properly raised and ventilated below — available on appeal"],
  "abandoned_points": ["points not raised or not properly ventilated — cannot now be raised without leave"],
  "record_inconsistencies": ["contradictions or inconsistencies in the record that may affect the appeal"],
  "cross_appeal_potential": "analysis of whether a cross-appeal is available or advisable — what and why",
  "preliminary_objection_risks": ["threshold objections the other side can raise to kill the appeal"],
  "limitation_analysis": "appeal filing window — time elapsed from judgment date, applicable rules, whether in time, any extension needed",
  "procedural_risks": [{"risk":"specific procedural danger","severity":"HIGH|MEDIUM|LOW"}]
}` }],
        maxTokens: 3500,
      });
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean) as Extraction;
      setExtraction(parsed);
      setStage(3);
      persist({ extraction: parsed, aStage: 3 });
    } catch (e: unknown) {
      setError('Extraction failed: ' + (e instanceof Error ? e.message : 'Unknown error. Check your input and retry.'));
    } finally { setLoading(false); }
  }

  // ── AI Call 2: Generate Appellate Intelligence Package ──────────────────────
  async function generatePackage() {
    if (!extraction) { setError('Run extraction first.'); return; }
    setLoading(true); setError('');
    const isAppellant = appealRole === 'Appellant';
    try {
      const content = await callClaude({
        system:    packageSystemPrompt(activeCase, appealRole),
        messages:  [{ role: 'user', content:
`APPELLATE INTELLIGENCE PACKAGE — GENERATE NOW

Case: ${activeCase.caseName}
Appeal Court: ${appealCourt}
Our Role: ${appealRole}
${roleLabel(activeCase)}
Lower Court: ${lowerCourt || 'Not specified'}

LOWER COURT RECORD:
${judgmentSummary}

WHAT WAS ARGUED BELOW:
${whatArgued || 'Not provided.'}

EXTRACTED INTELLIGENCE:
${JSON.stringify(extraction, null, 2)}

Generate the complete Appellate Intelligence Package with these sections:

## 1. Appellate Posture
Summarise: what this appeal is about, which court, our role, the procedural stage, and the core question on appeal.

## 2. ${isAppellant ? 'Grounds of Appeal — Analysis' : "Assessment of Appellant's Likely Grounds"}
${isAppellant
  ? 'Every viable ground — rated STRONG / ARGUABLE / WEAK. For each: the exact error, the legal basis, the record reference, and how to frame it as a ground.'
  : "Assess the grounds the Appellant is most likely to file. For each: its strength, the weaknesses in it, and how to meet it as Respondent."}

## 3. Issues for Determination
Distil the grounds into properly framed appellate issues. Each issue should be crisp, capable of resolving the appeal, and framed as the court would frame it.

## 4. Cross-Level Tracking
**Preserved Points:** What was properly raised and can be pursued.
**Abandoned Points:** What was not raised or not preserved — what is now too late.
**Record Inconsistencies:** Any contradictions in what was said at different levels.
**What This Means:** Strategic implications of the preservation analysis.

## 5. ${isAppellant ? "Appellant's Procedural Roadmap" : "Respondent's Procedural Roadmap"}
${isAppellant
  ? 'Step-by-step: Notice of Appeal, Record compilation, Brief of Argument deadline, service obligations, key rules under the Court of Appeal Rules / Supreme Court Rules as applicable.'
  : 'Response timeline: when to file Brief of Argument, cross-appeal window (if any), preliminary objection strategy, response to Record.'}

## 6. Cross-Appeal Analysis
Analysis of whether a cross-appeal is available, on what grounds, and whether it is strategically advisable.

## 7. Preliminary Objection Exposure
Every threshold objection the other side can raise — competence of appeal, notice, grounds, record — and how to address each proactively.

## 8. Strategic Options
**Option A — Aggressive:** The high-reward, higher-risk approach.
**Option B — Conservative:** The safer, lower-exposure approach.
**Option C — Hybrid:** The strategic middle ground.
**Recommendation:** The path Senior Counsel recommends, clearly labelled as guidance only.

## 9. Key Authorities Needed
Nigerian appellate authorities required for each ground / issue — Supreme Court and Court of Appeal decisions. Specify what proposition each authority must establish and where to find it (LawPavilion / NigeriaLII).

## 10. Critical Risks & Landmines
Every risk that could kill the appeal, reduce the likelihood of success, or expose the client to costs.

## 11. Immediate Action Items
The specific steps to take right now — in priority order. Deadlines where known.` }],
        maxTokens: 4500,
      });
      const pkg = content.trim();
      setIntPkg(pkg);
      setStage(5);
      persist({ intPkg: pkg, aStage: 5, extraction });
    } catch (e: unknown) {
      setError('Package generation failed: ' + (e instanceof Error ? e.message : 'Unknown error.'));
    } finally { setLoading(false); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 1 — Court & Role
  // ─────────────────────────────────────────────────────────────────────────────

  function renderStage1() {
    const canProceed = !!(appealCourt && appealRole);
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 22 }}>
          <p style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Step 1 of 5 · Court & Role</p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>Configure the Appeal</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            The Appeal Intelligence Engine is a separate reasoning framework from the Trial engine. Select the appellate court and your role — every output is calibrated for appellate procedure and Nigerian appellate practice.
          </p>
        </div>

        <div style={{ background: '#ffffff', border: `1px solid #281840`, borderLeft: `3px solid ${ACC}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>↑</span>
          <p style={{ fontSize: 13, color: `${ACC}cc`, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>
            Trial asks: <em>What happened and how do we prove it?</em> Appeal asks: <em>Did the lower court legally arrive at the correct decision?</em> Different question — different engine.
          </p>
        </div>

        {/* Appellate Court */}
        <div style={{ marginBottom: 22 }}>
          <label style={lbS}>Appellate Court <span style={{ color: '#b06060' }}>*</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { id: 'Court of Appeal', icon: '⚖', sub: 'First-instance appeal', desc: 'Appeals from High Courts, Federal High Court, National Industrial Court, Election Petition Tribunals. 3-judge panel. Court of Appeal Rules 2021.' },
              { id: 'Supreme Court',   icon: '★', sub: 'Final appellate court',  desc: 'Appeals from the Court of Appeal. 5 or 7 Justices. The final word on Nigerian law. Supreme Court Rules 2014.' },
            ].map(ct => (
              <button key={ct.id} onClick={() => setAppealCourt(ct.id)}
                style={{ background: appealCourt === ct.id ? '#0e0818' : '#ffffff', border: `1.5px solid ${appealCourt === ct.id ? ACC : '#1a1a2a'}`, borderRadius: 9, padding: '18px', cursor: 'pointer', textAlign: 'left', transition: 'all .18s' }}>
                <div style={{ fontSize: 20, marginBottom: 7 }}>{ct.icon}</div>
                <div style={{ fontSize: 13, color: appealCourt === ct.id ? ACCL : '#6a6a88', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, letterSpacing: '.04em', marginBottom: 3 }}>{ct.id}</div>
                <div style={{ fontSize: 9, color: appealCourt === ct.id ? ACC + '99' : '#cccccc', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>{ct.sub}</div>
                <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55 }}>{ct.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Appeal Role */}
        <div style={{ marginBottom: 22 }}>
          <label style={lbS}>Our Role on Appeal <span style={{ color: '#b06060' }}>*</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { id: 'Appellant',  icon: '↑', sub: 'We are appealing',   desc: 'We challenge the judgment or ruling. We file the Notice of Appeal, compile the Record, and file the Appellant\'s Brief of Argument. The burden to show error lies with us.' },
              { id: 'Respondent', icon: '↓', sub: 'They are appealing', desc: 'We defend the judgment. We file the Respondent\'s Brief. We may also cross-appeal if we lost on some grounds. The lower court\'s decision is presumed correct.' },
            ].map(r => (
              <button key={r.id} onClick={() => setAppealRole(r.id)}
                style={{ background: appealRole === r.id ? '#0e0818' : '#ffffff', border: `1.5px solid ${appealRole === r.id ? ACC : '#1a1a2a'}`, borderRadius: 9, padding: '18px', cursor: 'pointer', textAlign: 'left', transition: 'all .18s' }}>
                <div style={{ fontSize: 20, marginBottom: 7 }}>{r.icon}</div>
                <div style={{ fontSize: 13, color: appealRole === r.id ? ACCL : '#6a6a88', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, letterSpacing: '.04em', marginBottom: 3 }}>{r.id}</div>
                <div style={{ fontSize: 9, color: appealRole === r.id ? ACC + '99' : '#cccccc', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>{r.sub}</div>
                <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55 }}>{r.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Lower Court */}
        <div style={{ marginBottom: 22 }}>
          <label style={lbS}>Lower Court / Tribunal</label>
          <input value={lowerCourt} onChange={e => setLowerCourt(e.target.value)}
            placeholder="e.g. Federal High Court, Lagos Division / Kano State High Court" style={iS} />
        </div>

        <ErrBanner error={error} />
        <button
          onClick={() => { if (!canProceed) { setError('Select the appellate court and our role to continue.'); return; } setStage(2); setError(''); persist({ appealCourt, appealRole, lowerCourt, aStage: 2 }); }}
          disabled={!canProceed}
          style={{ background: canProceed ? `linear-gradient(135deg,${ACC},#6030b0)` : '#101018', color: canProceed ? '#f0ecff' : '#2a2a38', border: 'none', borderRadius: 6, padding: '14px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: canProceed ? 'pointer' : 'not-allowed', width: '100%', fontWeight: 600, letterSpacing: '.04em' }}>
          Enter Lower Court Record →
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 2 — Lower Court Record
  // ─────────────────────────────────────────────────────────────────────────────

  function renderStage2() {
    const canExtract = !loading && judgmentSummary.trim().length >= 80;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Step 2 of 5 · Lower Court Record</p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>Enter the Lower Court Record</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            Summarise the judgment or ruling being appealed — what the court decided, the reasoning, the orders made, and the errors you identify.
          </p>
        </div>

        {/* Context strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #131320' }}>
          {[appealCourt, appealRole].map(tag => (
            <span key={tag} style={{ background: '#0e0818', border: `1px solid ${ACC}44`, borderRadius: 3, padding: '2px 9px', fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{tag}</span>
          ))}
          {lowerCourt && <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>from {lowerCourt}</span>}
          <span style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>{activeCase.caseName}</span>
        </div>

        {/* Judgment Summary */}
        <div style={{ background: '#0d0d18', border: `1px solid #281840`, borderLeft: `3px solid ${ACC}`, borderRadius: '0 8px 8px 0', padding: '20px 22px', marginBottom: 14 }}>
          <label style={lbS}>Judgment / Ruling Summary <span style={{ color: '#b06060' }}>*</span></label>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.65 }}>
            What did the lower court decide? Include the issues before it, the decisions on each issue, the orders made, the reasoning given, the date of judgment, and what you believe the court got wrong.
          </p>
          <textarea
            value={judgmentSummary} onChange={e => setJudgmentSummary(e.target.value)} rows={12}
            placeholder={`Summarise the judgment being appealed:\n\n• Date of judgment and the court that delivered it\n• What were the issues before the lower court?\n• What did the court decide on each issue?\n• What orders were made?\n• What was the court's reasoning on the key points?\n• What specific errors do you believe the court made?\n\nDo not filter or organise — give it raw. The engine will extract the grounds.`}
            style={{ ...iS, resize: 'vertical', lineHeight: 1.85, minHeight: 280, fontSize: 15 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: judgmentSummary.length < 80 ? '#804040' : T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {judgmentSummary.length} characters{judgmentSummary.length < 80 ? ' · minimum 80' : ''}
            </span>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>More detail = sharper grounds</span>
          </div>
        </div>

        {/* What Was Argued Below */}
        <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '20px 22px', marginBottom: 14 }}>
          <label style={lbS}>What Was Argued Below</label>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.65 }}>
            Essential for cross-level tracking. What arguments, issues, objections, and points were raised at the lower court?
          </p>
          <textarea
            value={whatArgued} onChange={e => setWhatArgued(e.target.value)} rows={7}
            placeholder={`What was argued and raised at the lower court?\n\n• What issues were canvassed in the written addresses?\n• What objections were taken during proceedings?\n• Were there any points raised but not ruled upon by the court?\n• What is in the grounds of the Notice of Appeal already filed (if any)?`}
            style={{ ...iS, resize: 'vertical', lineHeight: 1.85, minHeight: 160, fontSize: 15 }}
          />
        </div>

        <ErrBanner error={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(1)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>← Reconfigure</button>
          <button onClick={runExtraction} disabled={!canExtract}
            style={{ flex: 1, background: canExtract ? `linear-gradient(135deg,${ACC},#6030b0)` : '#101018', color: canExtract ? '#f0ecff' : '#2a2a38', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: canExtract ? 'pointer' : 'not-allowed', fontWeight: 600, letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {loading
              ? <><span style={{ width: 14, height: 14, border: `2px solid #2a1a50`, borderTop: `2px solid ${ACCL}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} />Extracting Appellate Intelligence…</>
              : 'Extract Appellate Intelligence →'}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 3 — Extraction Results + Cross-Level Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  function renderStage3() {
    if (!extraction) return <Spinner label="Extracting appellate intelligence…" />;

    const STR_C: Record<string, { bg: string; bdr: string; col: string }> = {
      STRONG:   { bg: '#071810', bdr: '#1a4028', col: '#40b068' },
      ARGUABLE: { bg: '#1a1400', bdr: '#3a3000', col: '#b08020' },
      WEAK:     { bg: '#180808', bdr: '#401818', col: '#c05050' },
    };
    const SEV_C: Record<string, { bg: string; bdr: string; col: string }> = {
      HIGH:   { bg: '#180808', bdr: '#401818', col: '#c05050' },
      MEDIUM: { bg: '#1a1000', bdr: '#3a2800', col: '#c08030' },
      LOW:    { bg: '#071810', bdr: '#1a4028', col: '#40b068' },
    };

    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: ACCL, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Steps 3–4 of 5 · Extraction + Cross-Level Complete</p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>Appellate Intelligence Extracted</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>Review the extracted grounds, cross-level tracking, and procedural risks. When ready, generate the full Package.</p>
        </div>

        {/* What Was Decided */}
        {(extraction.what_was_decided?.length > 0) && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>What the Lower Court Decided</p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {extraction.what_was_decided.map((d, i) => (
                <li key={i} style={{ fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 6, paddingLeft: 16, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: T.mute, fontSize: 9, top: 3 }}>◦</span>{d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Grounds */}
        {(extraction.grounds_identified?.length > 0) && (
          <div style={{ background: '#0d0d18', border: `1px solid #281840`, borderLeft: `3px solid ${ACC}`, borderRadius: '0 8px 8px 0', padding: '18px 20px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 14 }}>Grounds of Appeal Identified</p>
            {extraction.grounds_identified.map((g, i) => {
              const sc = STR_C[g.strength] ?? STR_C.ARGUABLE;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: i < extraction.grounds_identified.length - 1 ? '1px solid #131320' : 'none' }}>
                  <span style={{ background: sc.bg, border: `1px solid ${sc.bdr}`, color: sc.col, fontSize: 8, padding: '3px 7px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', fontWeight: 600, flexShrink: 0, marginTop: 3, whiteSpace: 'nowrap' }}>{g.strength}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 3 }}>{g.ground}</p>
                    {g.basis && <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, fontStyle: 'italic' }}>{g.basis}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Issues for Determination */}
        {(extraction.issues_for_determination?.length > 0) && (
          <div style={{ background: '#0e0818', border: `1px solid #281840`, borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Issues for Determination</p>
            <ol style={{ margin: 0, padding: '0 0 0 22px', listStyleType: 'decimal' }}>
              {extraction.issues_for_determination.map((issue, i) => (
                <li key={i} style={{ fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75, marginBottom: 6 }}>{issue}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Preserved vs Abandoned */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {(extraction.preserved_points?.length > 0) && (
            <div style={{ background: '#071810', border: '1px solid #1a4028', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>✓ Preserved for Appeal</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.preserved_points.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#40b068', fontSize: 8, top: 4 }}>●</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(extraction.abandoned_points?.length > 0) && (
            <div style={{ background: '#180808', border: '1px solid #401818', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>✗ Abandoned / Not Preserved</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.abandoned_points.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 4 }}>●</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Record Inconsistencies */}
        {(extraction.record_inconsistencies?.length > 0) && (
          <div style={{ background: '#1a1400', border: '1px solid #3a3000', borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: '#b08020', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>⚑ Record Inconsistencies</p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {extraction.record_inconsistencies.map((r, i) => (
                <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 16, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#b08020', fontSize: 9, top: 2 }}>!</span>{r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Limitation */}
        {extraction.limitation_analysis && (
          <div style={{ background: '#120a00', border: '1px solid #3a2800', borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>⏱ Limitation & Filing Window</p>
            <p style={{ fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75 }}>{extraction.limitation_analysis}</p>
          </div>
        )}

        {/* Cross-Appeal */}
        {extraction.cross_appeal_potential && (
          <div style={{ background: '#0e0818', border: `1px solid #281840`, borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Cross-Appeal Analysis</p>
            <p style={{ fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75 }}>{extraction.cross_appeal_potential}</p>
          </div>
        )}

        {/* Preliminary Objection Risks */}
        {(extraction.preliminary_objection_risks?.length > 0) && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: '#c06040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Preliminary Objection Exposure</p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {extraction.preliminary_objection_risks.map((p, i) => (
                <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 16, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#c06040', fontSize: 9, top: 2 }}>⚠</span>{p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Procedural Risks */}
        {(extraction.procedural_risks?.length > 0) && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>Procedural Risks</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {extraction.procedural_risks.map((r, i) => {
                const rc = SEV_C[r.severity] ?? SEV_C.MEDIUM;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ background: rc.bg, border: `1px solid ${rc.bdr}`, color: rc.col, fontSize: 8, padding: '2px 6px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', fontWeight: 600, flexShrink: 0, marginTop: 2 }}>{r.severity}</span>
                    <span style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>{r.risk}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <ErrBanner error={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(2)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>← Edit Record</button>
          <button onClick={generatePackage} disabled={loading}
            style={{ flex: 1, background: loading ? '#101018' : `linear-gradient(135deg,${ACC},#6030b0)`, color: loading ? '#2a2a38' : '#f0ecff', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {loading
              ? <><span style={{ width: 14, height: 14, border: `2px solid #2a1a50`, borderTop: `2px solid ${ACCL}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} />Generating Appellate Package…</>
              : 'Generate Appellate Intelligence Package →'}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 5 — Appellate Intelligence Package
  // ─────────────────────────────────────────────────────────────────────────────

  function renderStage5() {
    if (loading) return <Spinner label="Assembling Appellate Intelligence Package…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: ACCL, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Step 5 of 5 · Complete · Saved to Case</p>
            <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>Appellate Intelligence Package</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button onClick={() => { copyText(intPkg); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ background: 'transparent', border: '1px solid #2a2208', color: copied ? '#40b068' : T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', transition: 'color .2s' }}>
              {copied ? '✓ Copied' : 'Copy All'}
            </button>
            <button onClick={() => goBack(3)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>← Extraction</button>
            <button onClick={resetPipeline} style={{ background: 'transparent', border: '1px solid #3a1818', color: '#804040', borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>↺ Reset</button>
          </div>
        </div>

        {intPkg && (
          <div style={{ background: '#ffffff', border: `1px solid ${ACC}33`, borderRadius: 10, padding: '26px 28px', marginBottom: 14 }}>
            {/* Package header strip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #131320', flexWrap: 'wrap' }}>
              {[appealCourt, appealRole].map(tag => (
                <span key={tag} style={{ background: '#0e0818', border: `1px solid ${ACC}44`, borderRadius: 3, padding: '2px 9px', fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{tag}</span>
              ))}
              {lowerCourt && <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>from {lowerCourt}</span>}
              <span style={{ fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', flex: 1, minWidth: 0 }}>{activeCase.caseName}</span>
              <span style={{ fontSize: 10, color: '#cccccc', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <Md text={intPkg} />
          </div>
        )}

        <ErrBanner error={error} />

        {/* Phase C.3 — Appeal Document Drafters */}
        <div style={{ marginTop: 28, borderTop: `1px solid ${ACC}20`, paddingTop: 24 }}>
          <AppealDocDrafters
            activeCase={activeCase}
            extraction={extraction}
            intPkg={intPkg}
            appealCourt={appealCourt}
            appealRole={appealRole}
          />
        </div>

        <p style={{ fontSize: 11, color: '#1e1e2a', textAlign: 'center', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8, marginTop: 16 }}>
          Appeal Intelligence Engine · Package saved to case · All analysis is advisory — the lawyer decides.
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 9, color: T.mute, letterSpacing: '.18em', textTransform: 'uppercase', fontFamily: "'Times New Roman', Times, serif", marginBottom: 5 }}>
            AFS Advocates · Appeal Intelligence Engine · Step 5
          </p>
          <h1 style={{ fontSize: 26, color: '#111111', fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.02em' }}>
            Appeal Intelligence Engine
          </h1>
        </div>
        {(stage > 1 || judgmentSummary.trim()) && (
          <button onClick={resetPipeline}
            style={{ background: 'transparent', border: '1px solid #2a1a40', color: '#6a3090', borderRadius: 4, padding: '6px 13px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', flexShrink: 0 }}>
            ↺ Reset Pipeline
          </button>
        )}
      </div>

      <StepIndicator current={stage} />

      {stage === 1 && renderStage1()}
      {stage === 2 && renderStage2()}
      {stage === 3 && renderStage3()}
      {stage === 5 && renderStage5()}
    </div>
  );
}
