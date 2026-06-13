/**
 * AFS Legal OS V2 — Alerts Engine (Phase 7: Automation + Phase E: Period Computation)
 *
 * Role-specific automated alert system. Reads matter state, deadlines, docket
 * entries, and stage data to surface precisely targeted alerts from the lawyer's
 * position — never generic notices, always role-specific intelligence.
 *
 * Phase E upgrade: pattern alerts are now supplemented (and where possible
 * superseded) by COMPUTED alerts generated from real docket anchor dates.
 * Computed alerts carry the governing statute, exact trigger date, computed
 * deadline date, real countdown, and fatal flag.
 *
 * Alert sources:
 *   'computed' → from period computer + real docket anchors (Phase E)
 *   'static'   → pattern/keyword based (pre-Phase E, fallback when no anchor)
 *   'ai'       → Claude-generated matter-specific intelligence
 *
 * Alert categories by role:
 *
 * CIVIL CLAIMANT SIDE
 *   - Appearance monitor: defendant has not appeared — default opportunity
 *   - SoD monitor: defendant has not filed defence — default judgment available
 *   - Limitation risk: filing date proximity
 *   - Enforcement window: judgment obtained, enforcement not started
 *   - Overdue deadlines
 *
 * CIVIL DEFENDANT SIDE
 *   - Appearance deadline: risk of default judgment (COMPUTED from service anchor)
 *   - Defence filing deadline: SoD not yet filed (COMPUTED from SoC service anchor)
 *   - Appeal window: judgment delivered, appeal not filed (COMPUTED from judgment anchor)
 *   - Default judgment exposure
 *   - Overdue deadlines
 *
 * CRIMINAL PROSECUTION
 *   - ACJA 90-day compliance countdown (COMPUTED from arraignment anchor)
 *   - Witness schedule gaps
 *   - Exhibit not tendered (count at risk)
 *   - No-case submission received — response required
 *   - Overdue prosecution steps
 *
 * CRIMINAL DEFENCE
 *   - ACJA remand period countdown (COMPUTED from remand anchor)
 *   - Appeal deadline countdown from conviction/sentence (COMPUTED from conviction anchor)
 *   - No-case threshold alert (after prosecution witnesses)
 *   - Bail renewal approaching
 *   - Charge defect flags
 *   - Overdue defence steps
 *
 * AI-Assisted Alerts: The engine can call Claude to generate additional
 * matter-specific alerts from docket narrative, intelligence data, and
 * current stage — surfacing issues a static rule engine would miss.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case, Deadline, DocketEntry, CounselRole, MatterTrack } from '@/types';
import {
  COUNSEL_ROLE_COLORS,
  COUNSEL_ROLE_LABELS,
} from '@/types';
import { loadDeadlines, loadEntries, saveCase } from '@/storage/helpers';
import { callClaude } from '@/services/api';
import { T } from '@/constants/tokens';
import { STAGE_KEYWORDS } from '@/constants/roleWorkspace';
import { uid } from '@/utils';

// Phase E — period computation
import { extractAnchors } from '@/utils/dateExtractor';
import {
  computePeriods,
  formatPeriodDate,
  formatDaysRemaining,
  periodStatusConfig,
  type ComputedPeriod,
} from '@/utils/periodComputer';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertCategory =
  | 'deadline'
  | 'default_risk'
  | 'procedural'
  | 'evidence'
  | 'compliance'
  | 'remand'
  | 'bail'
  | 'no_case'
  | 'appeal'
  | 'enforcement'
  | 'ai_generated';

export interface Alert {
  id:         string;
  severity:   AlertSeverity;
  category:   AlertCategory;
  title:      string;
  body:       string;
  action?:    string;       // recommended immediate action
  dismissed?: boolean;
  createdAt:  string;
  source:     'static' | 'computed' | 'ai';

  // Phase E — Period detail block (only on computed alerts)
  period?: {
    triggerDate:       string;
    deadlineDate:      string;
    daysRemaining:     number;
    authority:         string;
    fatal:             boolean;
    confidence:        'high' | 'inferred';
    triggerEntryTitle: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEVERITY COLOURS
// ─────────────────────────────────────────────────────────────────────────────

const SEV: Record<AlertSeverity, { bg: string; bdr: string; col: string; icon: string; pulse: boolean }> = {
  CRITICAL: { bg: '#1a0808', bdr: '#5a1818', col: '#d05050', icon: '🔴', pulse: true  },
  HIGH:     { bg: '#1a0e04', bdr: '#4a2010', col: '#c07040', icon: '🟠', pulse: true  },
  MEDIUM:   { bg: '#1a1400', bdr: '#483800', col: '#b09030', icon: '🟡', pulse: false },
  LOW:      { bg: '#071810', bdr: '#1a4028', col: '#408860', icon: '🟢', pulse: false },
};

const CAT_ICONS: Record<AlertCategory, string> = {
  deadline:    '⏰',
  default_risk:'⚠',
  procedural:  '◦',
  evidence:    '📁',
  compliance:  '⚙',
  remand:      '🔒',
  bail:        '🔓',
  no_case:     '⚖',
  appeal:      '↑',
  enforcement: '→',
  ai_generated:'✦',
};

// ─────────────────────────────────────────────────────────────────────────────
// STATIC ALERT ENGINE — deterministic rule-based alerts
// ─────────────────────────────────────────────────────────────────────────────

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(dateStr: string): number {
  return Math.round(
    (new Date(dateStr + 'T00:00:00').getTime() - todayDate().getTime())
    / (1000 * 60 * 60 * 24)
  );
}

function formatDate(ds: string): string {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Returns true if any entry title/notes matches any of the given keywords */
function entryMatches(entries: DocketEntry[], keywords: string[]): boolean {
  const corpus = entries
    .map(e => `${e.docTitle} ${e.notes ?? ''} ${e.docType ?? ''}`.toLowerCase())
    .join(' ');
  return keywords.some(kw => corpus.includes(kw.toLowerCase()));
}

/** Generates static (rule-based) alerts from matter state */
function generateStaticAlerts(
  activeCase: Case,
  entries:    DocketEntry[],
  deadlines:  Deadline[],
): Alert[] {
  const role  = activeCase.counsel_role as CounselRole | undefined;
  const track = activeCase.matter_track;
  const now   = todayDate();
  const alerts: Alert[] = [];

  const mk = (fields: Omit<Alert, 'id' | 'createdAt' | 'source' | 'dismissed'>): Alert => ({
    id: uid(),
    createdAt: new Date().toISOString(),
    source: 'static',
    dismissed: false,
    ...fields,
  });

  // ── Overdue deadlines (all roles) ──────────────────────────────────────────
  const overdue = deadlines.filter(
    d => d.status !== 'Dismissed' && new Date(d.date + 'T00:00:00') < now
  );
  overdue.forEach(d => {
    alerts.push(mk({
      severity: 'CRITICAL',
      category: 'deadline',
      title:    `Overdue: ${d.label}`,
      body:     `This deadline was due on ${formatDate(d.date)} and has not been resolved. Immediate attention required.`,
      action:   'Dismiss or resolve this deadline now, or update its status in the Deadline Engine.',
    }));
  });

  // ── Deadlines due within 7 days (all roles) ────────────────────────────────
  const soon = deadlines.filter(d => {
    if (d.status === 'Dismissed') return false;
    const days = daysUntil(d.date);
    return days >= 0 && days <= 7;
  });
  soon.forEach(d => {
    const days = daysUntil(d.date);
    alerts.push(mk({
      severity: days <= 2 ? 'HIGH' : 'MEDIUM',
      category: 'deadline',
      title:    `Deadline in ${days === 0 ? 'TODAY' : `${days}d`}: ${d.label}`,
      body:     `Due ${formatDate(d.date)}. ${d.notes ? `Note: ${d.notes}` : 'Action required before this date.'}`,
      action:   'Complete the required filing or step before this date.',
    }));
  });

  if (!role || !track) return alerts;

  // ─────────────────────────────────────────────────────────────────────────
  // ROLE-SPECIFIC STATIC ALERTS
  // ─────────────────────────────────────────────────────────────────────────

  if (role === 'claimant_side') {

    // Appearance monitor — defendant has not appeared
    const commencedOrServed =
      entryMatches(entries, STAGE_KEYWORDS['commencement'] ?? []) ||
      entryMatches(entries, STAGE_KEYWORDS['service'] ?? []);
    const hasAppearance = entryMatches(entries, STAGE_KEYWORDS['appearance'] ?? []);

    if (commencedOrServed && !hasAppearance) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'default_risk',
        title:    'Defendant Has Not Entered Appearance',
        body:     'Process has been filed and/or served, but no memorandum of appearance appears in the docket. Default judgment may be available if the time for appearance has expired.',
        action:   'Check the service date. If the appearance period has expired, consider applying for judgment in default of appearance.',
      }));
    }

    // SoD monitor — appearance entered but no defence filed
    if (hasAppearance && !entryMatches(entries, ['statement of defence', 'sod'])) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'default_risk',
        title:    'Statement of Defence Overdue',
        body:     'Defendant has entered appearance but no Statement of Defence appears in the docket. Default judgment may be available if the defence period has expired.',
        action:   'Check whether the time to file a Statement of Defence has elapsed. If so, apply for default judgment under the applicable Rules.',
      }));
    }

    // Judgment obtained — enforcement not started
    const hasJudgment    = entryMatches(entries, STAGE_KEYWORDS['judgment'] ?? []);
    const hasEnforcement = entryMatches(entries, STAGE_KEYWORDS['enforcement'] ?? []);
    if (hasJudgment && !hasEnforcement) {
      alerts.push(mk({
        severity: 'MEDIUM',
        category: 'enforcement',
        title:    'Judgment Obtained — Enforcement Not Started',
        body:     'A judgment entry is in the docket but no enforcement steps appear. A judgment that is not enforced is worthless. The enforcement window may also be time-limited.',
        action:   'Open the Enforcement Engine. Select the correct mechanism (FIFA, Garnishee, or other) and commence enforcement.',
      }));
    }

    // Appeal filed against our judgment — response needed
    const hasAppeal = entryMatches(entries, ['notice of appeal']);
    if (hasJudgment && hasAppeal) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'appeal',
        title:    'Notice of Appeal Filed Against Judgment',
        body:     'An appeal has been filed. As judgment creditor/respondent, you must file a Respondent\'s Brief and consider a cross-appeal.',
        action:   'Open the Appeal Engine. File your Respondent\'s Brief within the prescribed time. Consider whether a cross-appeal is warranted.',
      }));
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  if (role === 'defendant_side') {

    // Appearance deadline — process received, no appearance
    const serviceReceived = entryMatches(entries, STAGE_KEYWORDS['service_received'] ?? []);
    const hasAppearance   = entryMatches(entries, STAGE_KEYWORDS['appearance'] ?? []);

    if (serviceReceived && !hasAppearance) {
      alerts.push(mk({
        severity: 'CRITICAL',
        category: 'default_risk',
        title:    'Appearance Not Yet Entered — Default Risk',
        body:     'Process has been received but no memorandum of appearance appears in the docket. Failure to enter appearance within time exposes your client to default judgment.',
        action:   'Enter unconditional or conditional appearance immediately. The time limit runs from service.',
      }));
    }

    // Defence deadline — appeared, no SoD
    if (hasAppearance && !entryMatches(entries, ['statement of defence', 'sod'])) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'procedural',
        title:    'Statement of Defence Not Yet Filed',
        body:     'Appearance has been entered but no Statement of Defence appears in the docket. Failure to file in time risks default judgment on the merits.',
        action:   'File Statement of Defence before the prescribed deadline. Open the Pleadings Engine to draft.',
      }));
    }

    // Adverse judgment — appeal window
    const hasJudgment = entryMatches(entries, STAGE_KEYWORDS['judgment'] ?? []);
    const hasAppeal   = entryMatches(entries, ['notice of appeal', 'appellant brief']);
    if (hasJudgment && !hasAppeal) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'appeal',
        title:    'Judgment Delivered — Appeal Window Running',
        body:     'A judgment entry is in the docket. If the judgment is adverse, the time to file a Notice of Appeal is running from the date of delivery. Missing this window is fatal to the appeal.',
        action:   'File Notice of Appeal within 90 days (for High Court → Court of Appeal) or as applicable. Open the Appeal Engine.',
      }));
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  if (role === 'prosecution') {

    // ACJA 90-day period alert
    const hasArraignment = entryMatches(entries, STAGE_KEYWORDS['arraignment'] ?? []);
    const hasTrial       = entryMatches(entries, STAGE_KEYWORDS['trial'] ?? []);

    if (hasArraignment && !hasTrial) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'compliance',
        title:    'ACJA 90-Day Trial Period — Monitor Compliance',
        body:     'Arraignment has occurred. Under the Administration of Criminal Justice Act 2015, trial must conclude within a reasonable time. The 90-day target under Section 396 ACJA requires each hearing to advance the matter.',
        action:   'Ensure each hearing produces substantive progress. Avoid unnecessary adjournments that could ground a no-case submission on delay.',
      }));
    }

    // No-case submission received — response required
    const noCase         = entryMatches(entries, STAGE_KEYWORDS['no_case'] ?? []);
    const noCaseResponse = entryMatches(entries, STAGE_KEYWORDS['no_case_response'] ?? []);
    if (noCase && !noCaseResponse) {
      alerts.push(mk({
        severity: 'CRITICAL',
        category: 'no_case',
        title:    'No-Case Submission Filed — Response Required',
        body:     'The defence has filed a no-case submission. You must respond per count, defending the sufficiency of prosecution evidence under the Ajidagba / Ibeziako standard.',
        action:   'Draft your response immediately. Open the No-Case engine (Prosecution view) to build your per-count evidence summary.',
      }));
    }

    // Close of prosecution — no final address
    const closePros = entryMatches(entries, ['close of prosecution']);
    const hasAddress = entryMatches(entries, STAGE_KEYWORDS['final_address'] ?? []);
    if (closePros && !noCase && !hasAddress) {
      alerts.push(mk({
        severity: 'MEDIUM',
        category: 'procedural',
        title:    'Prosecution Closed — Final Address Due',
        body:     'Prosecution has closed its case. If no no-case submission was filed, the matter should proceed to defence case and then final addresses. Your prosecution address must be filed.',
        action:   'Prepare and file your final written address. Use the Argument Builder for the prosecution address.',
      }));
    }

    // Conviction — sentencing submissions
    const hasConviction = entryMatches(entries, ['conviction', 'convicted', 'guilty']);
    const hasSentencing = entryMatches(entries, STAGE_KEYWORDS['sentencing'] ?? []);
    if (hasConviction && !hasSentencing) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'procedural',
        title:    'Conviction Entered — Sentencing Submissions Required',
        body:     'A conviction appears in the docket. You must file sentencing submissions addressing aggravating factors and the appropriate sentence.',
        action:   'Open the Sentencing Engine (Prosecution view). Build your aggravating factors and sentencing address.',
      }));
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  if (role === 'defence') {

    // Charge received — no preliminary objection assessment
    const hasCharge  = entryMatches(entries, STAGE_KEYWORDS['charge'] ?? []);
    const hasObjn    = entryMatches(entries, ['preliminary objection', 'charge defect']);

    if (hasCharge && !hasObjn && !entryMatches(entries, ['arraignment', 'plea'])) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'procedural',
        title:    'Charge Received — Run Defect Analysis',
        body:     'A charge has been filed or received. Before arraignment, the charge must be analysed for defects: duplicity, lack of particulars, wrong jurisdiction, or failure to disclose an offence known to law.',
        action:   'Open Charge & Arraignment Engine. Run charge defect analysis and identify preliminary objection grounds before your client takes a plea.',
      }));
    }

    // Arraignment — bail application not filed
    const hasArraignment = entryMatches(entries, STAGE_KEYWORDS['arraignment'] ?? []);
    const hasBail        = entryMatches(entries, ['bail', 'surety', 'bail application', 'remand']);
    if (hasArraignment && !hasBail) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'bail',
        title:    'Arraignment Recorded — Bail Application Needed',
        body:     'Your client has been arraigned. If in custody, a bail application must be filed without delay. The ACJA remand clock runs from arraignment.',
        action:   'File a bail application immediately. Open the Criminal Defence Engine or Charge & Arraignment Engine to draft the application.',
      }));
    }

    // ACJA remand — bail not granted yet
    if (hasArraignment && hasBail && !entryMatches(entries, ['bail granted', 'bail allowed', 'bail approved'])) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'remand',
        title:    'Client in Custody — ACJA Remand Period Running',
        body:     'Your client appears to be in custody following arraignment. Under ACJA 2015 Section 296, an accused on remand has the right to apply for bail at any stage. Monitor the remand period carefully.',
        action:   'Track the remand period. If bail was refused, renew the application at each hearing or apply to a higher court if circumstances change.',
      }));
    }

    // Prosecution case underway — no cross-exam preparation
    const hasProsCase = entryMatches(entries, STAGE_KEYWORDS['prosecution_case'] ?? []);
    const hasCrossPrep = entryMatches(entries, ['cross-examination', 'cross examination', 'dw', 'pw cross']);
    if (hasProsCase && !hasCrossPrep) {
      alerts.push(mk({
        severity: 'MEDIUM',
        category: 'no_case',
        title:    'Prosecution Case Underway — No-Case Threshold Monitor',
        body:     'The prosecution case has commenced. You must track each prosecution witness and assess no-case threshold after each witness concludes. A no-case submission at the right moment is a primary defence right.',
        action:   'Open the Prosecution Case Engine (Defence view). Track each witness and run a no-case assessment after each one concludes.',
      }));
    }

    // No-case submission — awaiting ruling
    const hasNoCaseFiled = entryMatches(entries, ['no-case', 'no case submission', 'no case to answer']);
    if (hasNoCaseFiled && !entryMatches(entries, ['ruling', 'discharge', 'overruled'])) {
      alerts.push(mk({
        severity: 'HIGH',
        category: 'no_case',
        title:    'No-Case Submission Filed — Awaiting Ruling',
        body:     'A no-case submission has been filed. If the court discharges your client, ensure immediate release. If overruled, activate defence case preparation immediately.',
        action:   'Monitor the ruling date. Prepare both outcomes: discharge → release. Overruled → open Defence Case and call witnesses or rest.',
      }));
    }

    // Conviction — appeal deadline
    const hasConviction  = entryMatches(entries, ['conviction', 'convicted', 'guilty verdict']);
    const hasSentence    = entryMatches(entries, STAGE_KEYWORDS['sentencing'] ?? []);
    const hasAppealFiled = entryMatches(entries, ['notice of appeal', 'appeal filed']);

    if ((hasConviction || hasSentence) && !hasAppealFiled) {
      alerts.push(mk({
        severity: 'CRITICAL',
        category: 'appeal',
        title:    'Conviction / Sentence — Appeal Deadline Running NOW',
        body:     'Your client has been convicted or sentenced. The time to file a Notice of Appeal begins from the date of conviction or sentence. Under s. 25 CPA, 30 days from conviction. Missing this window is fatal.',
        action:   'File Notice of Appeal immediately. Also file allocutus if sentence has not yet been passed. Open the Appeal Engine and Sentencing Engine.',
      }));
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTED ALERT GENERATOR — Phase E period-based alerts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts ComputedPeriod[] into Alert[] with source: 'computed'.
 * These replace pattern-based alerts for the same event wherever a real
 * docket anchor was found. The period detail block is attached so the
 * AlertCard can render the governing statute, trigger date, deadline, and
 * countdown accurately.
 */
function generateComputedAlerts(periods: ComputedPeriod[]): Alert[] {
  return periods.map(p => {
    const cfg      = periodStatusConfig(p.status);
    const severity = ((): AlertSeverity => {
      switch (p.status) {
        case 'overdue':  return 'CRITICAL';
        case 'critical': return p.rule.fatal ? 'CRITICAL' : 'HIGH';
        case 'urgent':   return 'HIGH';
        case 'upcoming': return 'MEDIUM';
        default:         return 'LOW';
      }
    })();

    const category = ((): AlertCategory => {
      const id = p.rule.id;
      if (id.includes('appeal'))      return 'appeal';
      if (id.includes('appearance'))  return 'deadline';
      if (id.includes('arraignment')) return 'compliance';
      if (id.includes('remand'))      return 'remand';
      if (id.includes('conviction'))  return 'appeal';
      if (id.includes('sod') || id.includes('soc')) return 'deadline';
      if (id.includes('judgment') || id.includes('ruling')) return 'deadline';
      return 'procedural';
    })();

    const countdown = formatDaysRemaining(p.daysRemaining);
    const deadline  = formatPeriodDate(p.deadlineDate);
    const trigger   = formatPeriodDate(p.triggerDate);

    const body = [
      `Trigger: ${p.triggerEntryTitle} (${trigger}).`,
      `Deadline: ${deadline} — ${countdown}.`,
      p.rule.notes ?? '',
    ].filter(Boolean).join(' ');

    const action = p.rule.fatal
      ? `FATAL deadline. ${p.rule.label}. Authority: ${p.rule.authority}.`
      : `${p.rule.label}. Authority: ${p.rule.authority}.`;

    return {
      id:        uid(),
      severity,
      category,
      title:     `${p.rule.fatal ? '[FATAL] ' : ''}${p.rule.label} — ${countdown}`,
      body,
      action,
      dismissed: false,
      createdAt: new Date().toISOString(),
      source:    'computed' as const,
      period: {
        triggerDate:       p.triggerDate,
        deadlineDate:      p.deadlineDate,
        daysRemaining:     p.daysRemaining,
        authority:         p.rule.authority,
        fatal:             p.rule.fatal,
        confidence:        p.confidence,
        triggerEntryTitle: p.triggerEntryTitle,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AI ALERT GENERATOR — calls Claude for matter-specific intelligence alerts
// ─────────────────────────────────────────────────────────────────────────────

async function generateAIAlerts(
  activeCase: Case,
  entries:    DocketEntry[],
  deadlines:  Deadline[],
): Promise<Alert[]> {
  const role  = activeCase.counsel_role as CounselRole;
  const track = activeCase.matter_track;

  const roleLabel    = COUNSEL_ROLE_LABELS[role];
  const recentTitles = entries.slice(0, 12).map(e => `  - ${e.docTitle} (${e.dateFiled})`).join('\n');
  const ddlSummary   = deadlines
    .filter(d => d.status !== 'Dismissed')
    .map(d => `  - ${d.label}: ${d.date}`)
    .join('\n') || '  None recorded.';
  const intel        = activeCase.intelligence_data?.intPkg
    ? activeCase.intelligence_data.intPkg.slice(0, 800)
    : 'No intelligence package generated yet.';

  const prompt = `You are an AFS Legal OS alert generator. Your role: acting as ${roleLabel} on a ${track} matter.

MATTER: ${activeCase.caseName}
COURT: ${activeCase.court || 'Not specified'}
STAGE: ${activeCase.current_stage || 'Not explicitly set'}

RECENT DOCKET ENTRIES:
${recentTitles || '  None recorded.'}

ACTIVE DEADLINES:
${ddlSummary}

INTELLIGENCE SUMMARY (truncated):
${intel}

Generate up to 4 matter-specific alerts that a static rule engine would miss. Focus on:
- Narrative inconsistencies or procedural gaps visible from the docket
- Strategy risks specific to this matter and role
- Timing issues not covered by deadline entries
- Evidence gaps or witness management concerns

Return ONLY a JSON array. No markdown. No preamble. Each item:
{
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "category": "deadline" | "default_risk" | "procedural" | "evidence" | "compliance" | "remand" | "bail" | "no_case" | "appeal" | "enforcement" | "ai_generated",
  "title": "short title under 60 chars",
  "body": "2-3 sentence explanation specific to this matter",
  "action": "single recommended action"
}

Return an empty array [] if no meaningful alerts can be generated from the data provided.`;

  const raw = await callClaude({
    system:    `You are the AFS Legal OS alert generator. Return only valid JSON arrays. No prose, no markdown fences.`,
    userMsg:   prompt,
    maxTokens: 700,
    skipLibrary: true,
    matter_track: track,
    counsel_role: role,
  });

  try {
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as Omit<Alert, 'id' | 'createdAt' | 'source' | 'dismissed'>[];
    return parsed
      .filter(a => a.title && a.body && a.severity && a.category)
      .map(a => ({
        ...a,
        id:         uid(),
        source:     'ai' as const,
        dismissed:  false,
        createdAt:  new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT CARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  roleColor,
  onDismiss,
}: {
  alert:      Alert;
  roleColor:  string;
  onDismiss:  (id: string) => void;
}) {
  const s = SEV[alert.severity];
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background:   s.bg,
      border:       `1px solid ${s.bdr}`,
      borderRadius: 7,
      padding:      '13px 16px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Severity stripe */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 3, background: s.col, borderRadius: '7px 0 0 7px',
      }} />

      <div style={{ paddingLeft: 10 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
            {CAT_ICONS[alert.category]}
          </span>
          <div style={{ flex: 1 }}>
            {/* Severity + category badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 8, fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.1em', textTransform: 'uppercase',
                fontWeight: 700, color: s.col,
                background: `${s.col}15`, border: `1px solid ${s.col}40`,
                padding: '2px 6px', borderRadius: 3,
              }}>
                {alert.severity}
              </span>
              {alert.source === 'computed' && (
                <span style={{
                  fontSize: 8, fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.08em', textTransform: 'uppercase',
                  color: '#2a7a5a', background: '#071810',
                  border: '1px solid #1a4028', padding: '2px 6px', borderRadius: 3,
                }}>
                  ⏱ COMPUTED
                </span>
              )}
              {alert.source === 'ai' && (
                <span style={{
                  fontSize: 8, fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.08em', textTransform: 'uppercase',
                  color: '#8060c0', background: '#0e0818',
                  border: '1px solid #3a1878', padding: '2px 6px', borderRadius: 3,
                }}>
                  ✦ AI
                </span>
              )}
              <span style={{
                fontSize: 8, fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.06em', textTransform: 'uppercase',
                color: '#5a5a72', padding: '2px 6px',
              }}>
                {alert.category.replace(/_/g, ' ')}
              </span>
            </div>
            {/* Title */}
            <p style={{
              fontSize: 13, color: s.col,
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 600, lineHeight: 1.3, margin: 0,
            }}>
              {alert.title}
            </p>
          </div>
          {/* Dismiss button */}
          <button
            onClick={() => onDismiss(alert.id)}
            title="Dismiss alert"
            style={{
              background: 'transparent', border: 'none',
              color: '#3a3a4a', cursor: 'pointer',
              fontSize: 14, padding: '0 2px', lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <p style={{
          fontSize: 12, color: '#a0a0b8',
          fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.65, margin: '0 0 6px',
        }}>
          {alert.body}
        </p>

        {/* Period Detail block — computed alerts only */}
        {alert.source === 'computed' && alert.period && (
          <div style={{
            marginTop: 8,
            padding: '8px 10px',
            background: `${s.col}08`,
            border: `1px solid ${s.col}20`,
            borderRadius: 4,
          }}>
            <p style={{
              fontSize: 9, color: s.col,
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.10em', textTransform: 'uppercase',
              fontWeight: 700, margin: '0 0 5px',
            }}>
              ⏱ Period Detail
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                ['Trigger', `${alert.period.triggerEntryTitle} (${formatPeriodDate(alert.period.triggerDate)})`],
                ['Deadline', formatPeriodDate(alert.period.deadlineDate)],
                ['Authority', alert.period.authority],
                ['Fatal', alert.period.fatal ? 'YES — missing this deadline is fatal to the right' : 'No — directory obligation'],
                ['Anchor confidence', alert.period.confidence === 'high' ? 'High (exact title match)' : 'Inferred (keyword match — verify date)'],
              ].map(([k, v]) => (
                <div key={k as string} style={{ display: 'flex', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#6a6a82', fontFamily: "'Times New Roman', Times, serif", minWidth: 120, flexShrink: 0 }}>{k}:</span>
                  <span style={{ fontSize: 10, color: '#c0c0d8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.4 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action — toggle */}
        {alert.action && (
          <div style={{ marginTop: alert.source === 'computed' ? 6 : 0 }}>
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                background: 'transparent', border: 'none',
                color: s.col, cursor: 'pointer',
                fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.06em', padding: 0,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {expanded ? '▾ Hide action' : '▸ Recommended action'}
            </button>
            {expanded && (
              <p style={{
                fontSize: 11, color: '#c0c0d8',
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: 1.6, marginTop: 6, marginBottom: 0,
                padding: '8px 10px',
                background: `${s.col}0a`,
                border: `1px solid ${s.col}25`,
                borderRadius: 4,
              }}>
                → {alert.action}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY ROW — counts by severity
// ─────────────────────────────────────────────────────────────────────────────

function AlertSummaryRow({
  alerts,
  filter,
  setFilter,
}: {
  alerts:    Alert[];
  filter:    AlertSeverity | 'ALL';
  setFilter: (f: AlertSeverity | 'ALL') => void;
}) {
  const counts: Record<AlertSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  alerts.forEach(a => { counts[a.severity]++; });

  const severities: AlertSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
      {/* All */}
      <button
        onClick={() => setFilter('ALL')}
        style={{
          background: filter === 'ALL' ? '#1e1e30' : 'transparent',
          border: `1px solid ${filter === 'ALL' ? '#3a3a5a' : '#2a2a3a'}`,
          borderRadius: 5, color: filter === 'ALL' ? '#a0a0c0' : '#5a5a72',
          padding: '5px 12px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif",
          cursor: 'pointer', letterSpacing: '.04em',
        }}
      >
        All ({alerts.length})
      </button>
      {severities.map(sev => counts[sev] > 0 && (
        <button
          key={sev}
          onClick={() => setFilter(sev)}
          style={{
            background: filter === sev ? SEV[sev].bg : 'transparent',
            border: `1px solid ${filter === sev ? SEV[sev].bdr : '#2a2a3a'}`,
            borderRadius: 5,
            color: filter === sev ? SEV[sev].col : '#5a5a72',
            padding: '5px 12px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif",
            cursor: 'pointer', letterSpacing: '.04em',
          }}
        >
          {SEV[sev].icon} {sev} ({counts[sev]})
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface AlertsEngineProps {
  activeCase: Case;
}

export function AlertsEngine({ activeCase }: AlertsEngineProps) {
  const role      = activeCase.counsel_role as CounselRole | undefined;
  const roleColor = role ? COUNSEL_ROLE_COLORS[role].col : '#888888';
  const roleBg    = role ? COUNSEL_ROLE_COLORS[role].bg  : '#ffffff';
  const roleBdr   = role ? COUNSEL_ROLE_COLORS[role].bdr : '#cccccc';
  const roleLabel = role ? COUNSEL_ROLE_LABELS[role]     : 'Role Not Set';

  const [entries,   setEntries]   = useState<DocketEntry[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [staticAlerts,   setStaticAlerts]   = useState<Alert[]>([]);
  const [computedAlerts, setComputedAlerts] = useState<Alert[]>([]);
  const [aiAlerts,       setAIAlerts]       = useState<Alert[]>([]);
  const [dismissed,    setDismissed]    = useState<Set<string>>(new Set());
  const [aiLoading,    setAILoading]    = useState(false);
  const [aiError,      setAIError]      = useState('');
  const [aiGenerated,  setAIGenerated]  = useState(false);
  const [filter,       setFilter]       = useState<AlertSeverity | 'ALL'>('ALL');
  const [showDismissed, setShowDismissed] = useState(false);

  // ── Load docket data ──────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      loadEntries(activeCase.id),
      loadDeadlines(activeCase.id),
    ]).then(([ents, dls]) => {
      if (!live) return;
      setEntries(ents ?? []);
      setDeadlines(dls ?? []);
      setLoading(false);
    }).catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [activeCase.id]);

  // ── Run static + computed alerts when data is ready ─────────────────────
  useEffect(() => {
    if (loading) return;

    // Computed alerts (Phase E) — real anchor dates from docket
    const track = activeCase.matter_track;
    const role  = activeCase.counsel_role as CounselRole | undefined;
    if (track && role) {
      const anchors = extractAnchors(entries);
      const periods = computePeriods(track as MatterTrack, role, anchors);
      setComputedAlerts(generateComputedAlerts(periods));
    }

    // Static (pattern) alerts — fallback for events without a computed period
    const sa = generateStaticAlerts(activeCase, entries, deadlines);
    setStaticAlerts(sa);
  }, [loading, activeCase, entries, deadlines]);

  // ── Dismiss handler ───────────────────────────────────────────────────────
  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => new Set([...prev, id]));
  }, []);

  // ── AI alerts ─────────────────────────────────────────────────────────────
  const handleGenerateAI = useCallback(async () => {
    if (!role || aiLoading) return;
    setAILoading(true);
    setAIError('');
    try {
      const ai = await generateAIAlerts(activeCase, entries, deadlines);
      setAIAlerts(ai);
      setAIGenerated(true);
    } catch (err: unknown) {
      setAIError((err as Error).message ?? 'AI alert generation failed.');
    } finally {
      setAILoading(false);
    }
  }, [role, aiLoading, activeCase, entries, deadlines]);

  // ── Combine and filter ────────────────────────────────────────────────────
  // Computed alerts take precedence. Static alerts are shown only as fallback
  // for event types that have no computed anchor.
  const allAlerts: Alert[] = [...computedAlerts, ...staticAlerts, ...aiAlerts];
  const activeAlerts = allAlerts.filter(a => !dismissed.has(a.id));
  const dismissedAlerts = allAlerts.filter(a => dismissed.has(a.id));

  const SEV_ORDER: Record<AlertSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...activeAlerts].sort((a, b) =>
    SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
  );
  const filtered = filter === 'ALL' ? sorted : sorted.filter(a => a.severity === filter);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!role) {
    return (
      <div style={{ color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 14, padding: 24 }}>
        Alerts Engine requires a role-aware matter (V2). Set matter_track and counsel_role at matter creation.
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .25s ease' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.18em', textTransform: 'uppercase' }}>
            Phase 7 · Automation
          </span>
          <span style={{
            fontSize: 9, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em',
            textTransform: 'uppercase', fontWeight: 700,
            background: roleBg, border: `1px solid ${roleBdr}`,
            color: roleColor, padding: '2px 7px', borderRadius: 3,
          }}>
            {roleLabel}
          </span>
        </div>

        <h2 style={{
          fontSize: 20, color: roleColor,
          fontFamily: "'Times New Roman', Times, serif",
          fontWeight: 600, letterSpacing: '.02em', marginBottom: 4,
        }}>
          Role-Specific Alerts
        </h2>
        <p style={{
          fontSize: 12, color: '#6a6a82',
          fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.6, maxWidth: 560,
        }}>
          Automated alerts generated from your matter state, deadlines, and docket — targeted to your position as {roleLabel}.
          Static alerts update on load. AI alerts surface matter-specific intelligence from docket narrative.
        </p>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif", fontSize: 12, padding: '24px 0' }}>
          Loading matter state…
        </div>
      )}

      {!loading && (
        <>
          {/* ── Alert summary + filters ──────────────────────────────────────── */}
          {activeAlerts.length > 0 && (
            <AlertSummaryRow
              alerts={activeAlerts}
              filter={filter}
              setFilter={setFilter}
            />
          )}

          {/* ── No alerts state ───────────────────────────────────────────────── */}
          {activeAlerts.length === 0 && (
            <div style={{
              background: '#071810', border: '1px solid #1a4028',
              borderRadius: 7, padding: '20px 22px', marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 18, color: '#40a860' }}>✓</span>
              <div>
                <p style={{ fontSize: 13, color: '#40a860', fontFamily: "'Times New Roman', Times, serif", margin: 0, fontWeight: 600 }}>
                  No active alerts
                </p>
                <p style={{ fontSize: 11, color: '#406050', fontFamily: "'Times New Roman', Times, serif", margin: '3px 0 0' }}>
                  No static alerts triggered from current matter state.
                  {!aiGenerated && ' Run AI Alerts to surface matter-specific intelligence.'}
                </p>
              </div>
            </div>
          )}

          {/* ── Alert cards ───────────────────────────────────────────────────── */}
          {filtered.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {filtered.map(alert => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  roleColor={roleColor}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}

          {/* ── AI alerts panel ───────────────────────────────────────────────── */}
          <div style={{
            background: '#0a080e',
            border: '1px solid #2a1848',
            borderRadius: 8, padding: '18px 20px', marginBottom: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <p style={{
                  fontSize: 10, color: '#8060c0',
                  fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.12em', textTransform: 'uppercase',
                  fontWeight: 700, margin: '0 0 3px',
                }}>
                  ✦ AI-Generated Alerts
                </p>
                <p style={{
                  fontSize: 11, color: '#5a4a72',
                  fontFamily: "'Times New Roman', Times, serif",
                  margin: 0, lineHeight: 1.5,
                }}>
                  Claude reads your docket narrative to surface matter-specific risks.
                </p>
              </div>
              <button
                onClick={handleGenerateAI}
                disabled={aiLoading}
                style={{
                  background: aiLoading ? '#1a1028' : '#1a0e28',
                  border: '1px solid #4a2888',
                  borderRadius: 5, color: aiLoading ? '#4a3860' : '#9060d0',
                  padding: '8px 14px', fontSize: 11,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: aiLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 600, letterSpacing: '.04em',
                  flexShrink: 0,
                  transition: 'all .15s',
                }}
              >
                {aiLoading ? '✦ Scanning…' : aiGenerated ? '✦ Refresh AI' : '✦ Run AI Alerts'}
              </button>
            </div>

            {aiError && (
              <p style={{ fontSize: 11, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
                ⚠ {aiError}
              </p>
            )}

            {aiGenerated && aiAlerts.length === 0 && !aiLoading && !aiError && (
              <p style={{ fontSize: 11, color: '#4a4a62', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
                No additional AI alerts found from the current docket narrative.
              </p>
            )}

            {aiGenerated && aiAlerts.length > 0 && !aiLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {aiAlerts
                  .filter(a => !dismissed.has(a.id))
                  .map(alert => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      roleColor={roleColor}
                      onDismiss={handleDismiss}
                    />
                  ))
                }
              </div>
            )}
          </div>

          {/* ── Dismissed alerts (collapsible) ───────────────────────────────── */}
          {dismissedAlerts.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => setShowDismissed(s => !s)}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#3a3a52', cursor: 'pointer',
                  fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.08em', padding: 0,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {showDismissed ? '▾' : '▸'} Dismissed alerts ({dismissedAlerts.length})
              </button>
              {showDismissed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, opacity: 0.4 }}>
                  {dismissedAlerts.map(alert => (
                    <div key={alert.id} style={{
                      background: '#ffffff', border: '1px solid #1a1a2a',
                      borderRadius: 5, padding: '8px 12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif" }}>
                          {CAT_ICONS[alert.category]} {alert.title}
                        </span>
                        <button
                          onClick={() => setDismissed(prev => {
                            const next = new Set(prev);
                            next.delete(alert.id);
                            return next;
                          })}
                          title="Restore alert"
                          style={{
                            background: 'transparent', border: 'none',
                            color: '#2a2a3a', cursor: 'pointer',
                            fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                            letterSpacing: '.06em', padding: '0 4px',
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Role alert legend ─────────────────────────────────────────────── */}
          <div style={{
            background: '#ffffff', border: '1px solid #cccccc',
            borderRadius: 7, padding: '14px 18px',
          }}>
            <p style={{
              fontSize: 9, color: '#3a3a52',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.12em', textTransform: 'uppercase',
              fontWeight: 700, marginBottom: 10,
            }}>
              Alert Coverage — {roleLabel}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {getAlertCoverageForRole(role).map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#3a3a52', flexShrink: 0, marginTop: 1 }}>◦</span>
                  <span style={{ fontSize: 11, color: '#4a4a62', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT COVERAGE DESCRIPTIONS BY ROLE
// ─────────────────────────────────────────────────────────────────────────────

function getAlertCoverageForRole(role: CounselRole): string[] {
  const coverage: Record<CounselRole, string[]> = {
    claimant_side: [
      'Overdue deadlines (CRITICAL)',
      'Defendant has not entered appearance — default judgment opportunity',
      'Statement of Defence overdue — default judgment on merits available',
      'Judgment obtained without enforcement activated',
      'Notice of Appeal filed against your judgment',
      'AI: docket-specific procedural and strategy risks',
    ],
    defendant_side: [
      'Overdue deadlines (CRITICAL)',
      'Process received but appearance not entered — default judgment risk (CRITICAL)',
      'Appearance entered but Statement of Defence not filed — default risk',
      'Adverse judgment delivered — appeal window running',
      'AI: docket-specific procedural and default exposure risks',
    ],
    prosecution: [
      'Overdue deadlines (CRITICAL)',
      'ACJA Section 396 — 90-day trial period compliance',
      'No-case submission filed — response required (CRITICAL)',
      'Close of prosecution without final address',
      'Conviction entered — sentencing submissions required',
      'AI: count-by-count evidence gaps and witness risk alerts',
    ],
    defence: [
      'Overdue deadlines (CRITICAL)',
      'Charge received — defect analysis not run',
      'Arraignment without bail application — ACJA remand clock running',
      'Client in custody — remand monitoring',
      'Prosecution case underway — no-case threshold tracking',
      'No-case submission filed — awaiting ruling',
      'Conviction or sentence — appeal deadline running (CRITICAL)',
      'AI: charge defects, prosecution weakness, bail and appeal strategy alerts',
    ],
  };
  return coverage[role] ?? [];
}
