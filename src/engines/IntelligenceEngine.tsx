/**
 * AFS Advocates — Trial Intelligence Engine
 * Phase 1A — Role Gate & Pipeline Split (Grand Build Plan)
 * Phase 2  — Full 5-step pipeline
 *
 * PHASE 1A — ROLE GATE & PIPELINE SPLIT
 * The first decision the engine makes on every case.
 *
 *   Stage -1 (RoleGate)  — fires when counsel_role is absent/unset at case level.
 *                           Prompts counsel to confirm matter_track + counsel_role
 *                           before any pipeline stage opens. Saves to case via
 *                           onSaveRole() prop. Once set, never shown again.
 *
 *   PipelineBanner       — rendered at the top of every stage (0 → 5) after the
 *                           gate is cleared. Confirms: pipeline (Commencing /
 *                           Receiving), role label, track. Non-interactive strip.
 *
 *   Pipeline split:
 *     COMMENCING (claimant_side | prosecution | petitioner_side | frep_applicant)
 *       → Stage 1 (Raw Facts) → 2 → 3 → 4 → 5
 *     RECEIVING  (defendant_side | respondent_side | defence | frep_respondent)
 *       → Stage 0 (Entry Path Selector) → 0.5 (SPA) → 1 → 2 → 3 → 4 → 5
 *
 * PHASE 2 — PIPELINE STEPS
 *   1. Raw Facts intake
 *   2. AI extraction (timeline, established facts, disputes, legal issues, gaps, risks)
 *   2b. Commencement Audit — auto-runs after extraction; ports ComplianceEngine
 *       (Full Compliance Audit + Limitation Calculator + Service Validator).
 *       Persists to intelligence_data.commencement_audit. Non-blocking.
 *   3. Dynamic follow-up questions
 *   4. Evidence matrix
 *   5. Intelligence Package generation
 *
 * All state persisted to case via onSave(). Fully role-aware.
 */

import React, { useState } from 'react';
import type { Case, CaseTheoryRecord, CounselRole, MatterTrack } from '@/types';
import { COUNSEL_ROLE_LABELS, COUNSEL_ROLE_COLORS, MATTER_TRACK_LABELS, rolesForTrack } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude, withRetry } from '@/services/api';
import { Spinner, ErrorBlock, RoleBadge, Md } from '@/components/common/ui';
import { copyToClipboard } from '@/utils';
import { getPartyLabels } from '@/utils/getPartyLabels';
import { db } from '@/storage/db';
import { saveCaseTheory, lockCaseTheory, writeIntelligenceToCase } from '@/storage/helpers';
import type { MExtractionResult } from '@/matrimonial/types';

// ── Step definitions ───────────────────────────────────────────────────────────

const TIE_STEPS = [
  { id: 1, label: 'Raw Facts' },
  { id: 2, label: 'Extraction + Audit' },
  { id: 3, label: 'Follow-Up' },
  { id: 4, label: 'Evidence Map' },
  { id: 5, label: 'Package + Risk' },
];

// ── Phase 1A — Pipeline classification ────────────────────────────────────────
//
// COMMENCING: we open the matter — Claimant, Prosecution, Petitioner, FREP Applicant.
// RECEIVING:  we are served — Defendant, Defence, Respondent, FREP Respondent.
//
// This split is permanent once counsel_role is set. The gate fires (stage -1)
// whenever counsel_role is absent. Once confirmed, it never shows again.

export type PipelineType = 'commencing' | 'receiving';

export const COMMENCING_ROLES = new Set<CounselRole>([
  'claimant_side',
  'prosecution',
  'petitioner_side',
  'frep_applicant',
]);

export const RECEIVING_ROLES_SET = new Set<CounselRole>([
  'defendant_side',
  'respondent_side',
  'defence',
  'frep_respondent',
]);

export function getPipelineType(role?: CounselRole | string): PipelineType {
  if (!role) return 'commencing'; // safe default — gate will clarify
  if (RECEIVING_ROLES_SET.has(role as CounselRole)) return 'receiving';
  return 'commencing';
}

/** Human-readable pipeline description for UI copy. */
const PIPELINE_COPY: Record<PipelineType, { label: string; description: string; icon: string; accent: string }> = {
  commencing: {
    label:       'Commencing Pipeline',
    description: 'We open this matter — we file first.',
    icon:        '⚔',
    accent:      '#1a4a8a',
  },
  receiving: {
    label:       'Receiving Pipeline',
    description: 'We were served — we respond.',
    icon:        '🛡',
    accent:      '#7a1a1a',
  },
};

// ── Severity colours ──────────────────────────────────────────────────────────

const RISK_SEV_C: Record<string, { bg: string; bdr: string; col: string }> = {
  HIGH:   { bg: '#1a0808', bdr: T.bdr, col: '#c05050' },
  MEDIUM: { bg: '#1a1000', bdr: '#3a2800', col: '#c08030' },
  LOW:    { bg: '#071810', bdr: T.bdr, col: '#40b068' },
};

const PRIORITY_C: Record<string, { bg: string; bdr: string; col: string }> = {
  CRITICAL: { bg: '#1a0808', bdr: T.bdr, col: '#c05050' },
  HIGH:     { bg: '#1a0e00', bdr: '#3a2200', col: '#b07030' },
  MEDIUM:   { bg: '#1a1400', bdr: '#3a3000', col: '#b09040' },
  LOW:      { bg: '#071810', bdr: T.bdr, col: '#40b068' },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractionResult {
  timeline:          Array<{ date: string; event: string; significance?: string }>;
  established_facts: string[];
  disputed_areas:    string[];
  legal_issues:      string[];
  evidence_mentioned: string[];
  gaps_identified:   string[];
  initial_risks:     Array<{ risk: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

interface EvidenceMapItem {
  issue:              string;
  evidence_needed:    string[];
  evidence_available: string[];
  evidence_missing:   string[];
  priority:           'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  notes?:             string;
}

// ── Step 2b — Commencement Audit result (mirrors intelligence_data.commencement_audit) ──

interface CommencementAuditResult {
  run_at:             string;
  findings:           string;
  limitation_expiry?: string;
  service_valid?:     boolean;
  status:             'CLEAR' | 'RISK' | 'DEFECTIVE';
  summary:            string;
}

// ── Step 2 — Counterclaim Detected types (Phase 6A) ───────────────────────────
// Mirrors IntelligenceData['counterclaim_detected'] in src/types/index.ts.
// Produced inside the same Step 2 extraction call (Phase 6A-i prompt
// instruction) and split out into its own sibling field on save — kept
// separate from ExtractionResult so intelligence_data.extraction stays
// exactly the shape PleadingsEngine and other readers already expect.

interface CounterclaimDetectedResult {
  /** Whether the extraction found credible counterclaim facts */
  flag:     boolean;
  /** Brief description of the detected counterclaim basis (if flag is true) */
  summary?: string;
}

// ── Step 4b — Conflict Scan types ─────────────────────────────────────────────

interface ConflictHit {
  case_id:  string;
  case_ref: string;
  overlap:  string;
}

interface ConflictScanResult {
  run_at:    string;
  clear:     boolean;
  conflicts: ConflictHit[];
  summary:   string;
}

// ── Step 5b — Risk Verdict types ─────────────────────────────────────────────

type RiskVerdict = 'FILE' | 'NEGOTIATE' | 'SETTLE' | 'WALK_AWAY';

interface RiskDimensionScores {
  procedural:              number;
  evidential:              number;
  witness_vulnerability:   number;
  jurisdictional_risk:     number;
  burden_satisfaction:     number;
  settlement_advisability: number;
  /** Includes merged appellate vulnerabilities narrative */
  appeal_survivability:    number;
  opponent_threat:         number;
}

interface RiskDimensionReasoning {
  procedural:              string;
  evidential:              string;
  witness_vulnerability:   string;
  jurisdictional_risk:     string;
  burden_satisfaction:     string;
  settlement_advisability: string;
  appeal_survivability:    string;
  opponent_threat:         string;
}

interface RiskVerdictResult {
  run_at:               string;
  scores:               RiskDimensionScores;
  reasoning:            RiskDimensionReasoning;
  recommendation:       string;
  verdict:              RiskVerdict;
  /**
   * Full structured appellate vulnerability narrative (3B).
   * Per-issue: issue → ground → survivability → preservation action.
   * Merged into appeal_survivability rather than scored separately.
   */
  appellate_narrative?: string;
  batna_notes?:         string;
}

interface TIEData {
  stage:               number;
  rawFacts:            string;
  extraction:          ExtractionResult | null;
  followUpQs:          Array<{ id: string; question: string; purpose?: string }>;
  followUpAs:          Record<string, string>;
  evidenceM:           EvidenceMapItem[] | null;
  intPkg:              string;
  /** Step 2b — Commencement Audit. Auto-populated after extraction. */
  commencement_audit?: CommencementAuditResult;
  /** Step 2 — Counterclaim Detected. Auto-populated as part of extraction (Phase 6A). */
  counterclaim_detected?: CounterclaimDetectedResult;
  /** Step 4b — Conflict Scan. Run on-demand from Stage 4/5. */
  conflict_scan?:      ConflictScanResult;
  /** Step 5b — Risk Verdict. Auto-populated after package generation. */
  risk_verdict?:       RiskVerdictResult;
  /** Step 5 — Authority Grounding. Auto-populated after package generation. */
  authority_grounding?: IntelligenceData['authority_grounding'];
  /** Phase 2C — Served Process Analysis. Defendant Stage 0.5 output. */
  served_process_analysis?: IntelligenceData['served_process_analysis'];
}

interface Props {
  activeCase: Case;
  onSave:     (data: TIEData) => void;
  /**
   * Phase 1A — Role Gate callback.
   * Called when counsel confirms matter_track + counsel_role from the gate screen.
   * The parent (CaseDashboard) must persist these two fields to the Case record
   * so the gate never fires again for this case.
   */
  onSaveRole?: (track: MatterTrack, role: CounselRole) => void;
}

// ── Shared local styles ───────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const lbS: React.CSSProperties = {
  fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function IntelligenceEngine({ activeCase, onSave, onSaveRole }: Props) {
  const saved = (activeCase.intelligence_data || {}) as unknown as Partial<TIEData>;

  // ── Phase 1A: Role Gate ────────────────────────────────────────────────────
  // Use module-level sets. RECEIVING_ROLES kept as alias for rest of file.
  const RECEIVING_ROLES = RECEIVING_ROLES_SET;
  const isReceivingSide = RECEIVING_ROLES.has(activeCase.counsel_role as CounselRole ?? '');
  const pipeline: PipelineType = getPipelineType(activeCase.counsel_role);

  // Gate fires (stage -1) if counsel_role is absent — overrides all other stage logic.
  // Once counsel_role is set on the Case record, this never fires again.
  const roleGateActive = !activeCase.counsel_role;

  // Phase 1A local state — tracks selections inside the gate before saving
  const [gateTrack, setGateTrack] = useState<MatterTrack>(activeCase.matter_track ?? 'civil');
  const [gateRole,  setGateRole]  = useState<CounselRole | ''>('');
  const [gateSaving, setGateSaving] = useState(false);

  /** Confirm the role selection and call onSaveRole. Non-blocking. */
  async function confirmRoleGate() {
    if (!gateRole) return;
    setGateSaving(true);
    try {
      await onSaveRole?.(gateTrack, gateRole as CounselRole);
    } finally {
      setGateSaving(false);
    }
  }
  const isCivilDefendant = activeCase.counsel_role === 'defendant_side'; // retained for counterclaim-specific copy
  // Keep isDefendant as alias so unchanged internal references still compile
  const isDefendant = isCivilDefendant;
  const [stage,              setStage]              = useState<number>(
    saved.stage ?? (isReceivingSide && !saved.rawFacts ? 0 : 1)
  );
  const [rawFacts,           setRawFacts]           = useState<string>(saved.rawFacts ?? '');
  const [extraction,         setExtraction]         = useState<ExtractionResult | null>(saved.extraction ?? null);
  const [followUpQs,         setFollowUpQs]         = useState<TIEData['followUpQs']>(saved.followUpQs ?? []);
  const [followUpAs,         setFollowUpAs]         = useState<Record<string, string>>(saved.followUpAs ?? {});
  const [evidenceM,          setEvidenceM]          = useState<EvidenceMapItem[] | null>(saved.evidenceM ?? null);
  const [intPkg,             setIntPkg]             = useState<string>(saved.intPkg ?? '');
  // Step 2b
  const [commencementAudit,  setCommencementAudit]  = useState<CommencementAuditResult | undefined>(saved.commencement_audit);
  const [auditLoading,       setAuditLoading]       = useState(false);
  const [auditError,         setAuditError]         = useState('');
  // Step 2 — Counterclaim Detected (Phase 6A)
  const [counterclaimDetected, setCounterclaimDetected] = useState<CounterclaimDetectedResult | undefined>(saved.counterclaim_detected);

  // Step 4b — Conflict Scan
  const [conflictScan,       setConflictScan]       = useState<ConflictScanResult | undefined>(saved.conflict_scan);
  const [conflictLoading,    setConflictLoading]    = useState(false);
  const [conflictError,      setConflictError]      = useState('');

  // Step 5b — Risk Verdict
  const [riskVerdict,        setRiskVerdict]        = useState<RiskVerdictResult | undefined>(saved.risk_verdict);
  const [riskLoading,        setRiskLoading]        = useState(false);
  const [riskError,          setRiskError]          = useState('');
  const [riskAnimated,       setRiskAnimated]       = useState(false);
  const [authorityGrounding, setAuthorityGrounding] = useState<IntelligenceData['authority_grounding'] | undefined>(saved.authority_grounding);
  const [agLoading,          setAgLoading]          = useState(false);
  const [agError,            setAgError]            = useState('');

  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [copied,     setCopied]     = useState(false);
  // Phase 7C — set true when a mid-stream interruption was auto-resumed
  const [pkgResumed, setPkgResumed] = useState(false);
  const [processText,   setProcessText]   = useState<string>('');
  const [spaResult,     setSpaResult]     = useState<IntelligenceData['served_process_analysis'] | undefined>(saved.served_process_analysis);
  const [spaLoading,    setSpaLoading]    = useState(false);
  const [spaError,      setSpaError]      = useState('');

  // ── Phase 2E — Theory Clash Synthesis state ──────────────────────────────
  const [theoryClashLoading, setTheoryClashLoading] = useState(false);
  const [theoryClashError,   setTheoryClashError]   = useState('');
  const [theoryClashDone,    setTheoryClashDone]    = useState(false);
  const [theoryClashRecord,  setTheoryClashRecord]  = useState<CaseTheoryRecord | null>(null);

  const { partyA, partyB, partyAPlural, partyBPlural, ourSide } = getPartyLabels(activeCase);

  const role = activeCase.counsel_role
    ? `${activeCase.counsel_role} (${activeCase.matter_track || 'civil'} matter)`
    : ourSide;

  const caseCtx = `Case: ${activeCase.caseName}
Court: ${activeCase.court || 'Not specified'}
Suit No: ${activeCase.suitNo || 'Not specified'}
Track: ${activeCase.matter_track || 'civil'}
Counsel Role: ${activeCase.counsel_role || ourSide}
${partyAPlural}: ${activeCase.claimants.map(c => c.name).filter(Boolean).join(', ') || 'Not named'}
${partyBPlural}: ${activeCase.defendants.map(d => d.name).filter(Boolean).join(', ') || 'Not named'}`;

  function persist(updates: Partial<TIEData>) {
    const data: TIEData = {
      stage, rawFacts, extraction, followUpQs, followUpAs, evidenceM, intPkg,
      commencement_audit:      commencementAudit,
      counterclaim_detected:   counterclaimDetected,
      conflict_scan:           conflictScan,
      risk_verdict:            riskVerdict,
      authority_grounding:     authorityGrounding,
      served_process_analysis: spaResult,
      ...updates,
    };
    onSave(data);
  }

  function advance(newStage: number, updates: Partial<TIEData> = {}) {
    setStage(newStage);
    persist({ stage: newStage, ...updates });
  }

  function goBack(n: number) { setStage(n); setError(''); }

  // ── Step 1 → 2: Extract intelligence ──────────────────────────────────────
  // ── Step 1 → 2: Extract intelligence ──────────────────────────────────────
  async function runExtraction() {
    if (rawFacts.trim().length < 50) {
      setError('Please provide a fuller account of the facts (at least 50 characters).');
      return;
    }
    setLoading(true); setError('');
    try {
      // ── Phase 2D: Theory-aware context when defendant came through SPA (Stage 0.5) ──
      const isDefendantWithSPA = isReceivingSide && !!spaResult;
      const spaTheoryBlock = isDefendantWithSPA
        ? `\n\nOPPONENT THEORY (from Served Process Analysis — already extracted):\n${spaResult!.claimant_theory}\n\nPRE-IDENTIFIED COUNTERCLAIM HINTS (from Served Process — evaluate and confirm or refine):\n${spaResult!.counterclaim_hints.length > 0 ? spaResult!.counterclaim_hints.map((h: string, i: number) => `${i + 1}. ${h}`).join('\n') : 'None identified from process text.'}\n\nINSTRUCTION: You already know the ${partyA}'s theory from the served process above. Your extraction must now:\n1. Frame every legal issue as a clash between that theory and the ${partyB}'s position revealed in the client instructions below.\n2. Identify which of the ${partyA}'s factual allegations are admitted, disputed, or unknown from the client's account.\n3. Re-evaluate the counterclaim hints above against the client's fuller instructions — confirm, expand, or dismiss each one with reasons in "counterclaim_detected".`
        : '';

      const counterclaimInstruction = isDefendantWithSPA
        ? `COUNTERCLAIM EVALUATION (${partyB} path — theory-aware): The served process already surfaced counterclaim hints (listed above). Now that you have the client's full instructions, assess whether those hints ripen into a viable counterclaim. A counterclaim requires: (a) an independent cause of action, (b) arising from the same transaction or occurrence, (c) seeking affirmative relief — not merely a defence. Set "counterclaim_detected.flag" to true if one is confirmed, and write a 1–2 sentence "summary" identifying who brings it, against whom, and the cause of action. If the hints do not ripen, set flag to false and include a brief explanation in summary.`
        : `COUNTERCLAIM DETECTION: Where this is a civil matter, actively assess whether the facts disclose a viable counterclaim — an independent cause of action arising from the same transaction or facts (available to the opposing side, or to our client if we act for the defendant) that could be raised as a cross-class under the applicable Rules of Civil Procedure. A counterclaim is distinct from a mere defence or set-off: it seeks affirmative relief in its own right, not merely a denial of liability. Set "counterclaim_detected.flag" to true only where one is reasonably disclosed on the facts, and write a one-to-two sentence "counterclaim_detected.summary" stating who would bring it, against whom, and the cause of action. Do not fabricate a counterclaim where the facts do not support one — if this is not a civil matter, or no counterclaim is disclosed, set "flag" to false and omit "summary".`;

      const raw = await withRetry(() => callClaude({
        system: `You are a trial intelligence extraction engine for Nigerian litigation.\nExtract structured intelligence from the raw case facts provided by the user.\nRole-aware: the lawyer acts for the ${role}.\nCase context: ${caseCtx}${spaTheoryBlock}\n\n${counterclaimInstruction}\n\nOutput ONLY valid JSON — no markdown fences, no preamble, no explanation. Exactly this structure:\n{\n  "timeline": [{"date":"...","event":"...","significance":"..."}],\n  "established_facts": ["..."],\n  "disputed_areas": ["..."],\n  "legal_issues": ["..."],\n  "evidence_mentioned": ["..."],\n  "gaps_identified": ["..."],\n  "initial_risks": [{"risk":"...","severity":"HIGH|MEDIUM|LOW"}],\n  "counterclaim_detected": {"flag": true|false, "summary": "..."}\n}\n\nRules:\n- Every string value must be properly escaped. Never use unescaped double quotes inside string values.\n- Use single quotes or rephrase if quoting speech — never raw double quotes inside JSON strings.\n- Output ONLY the JSON object. Nothing before it, nothing after it.`,
        userMsg: isDefendantWithSPA
          ? `SERVED PROCESS (already analysed — use the OPPONENT THEORY block from the system prompt; do not re-extract theory from this):\n\n${spaResult!.process_text}\n\n──────────────────────────────────────\nCLIENT INSTRUCTIONS / DEFENDANT'S ACCOUNT:\n\n${rawFacts}`
          : `RAW FACTS / CLIENT NARRATION:\n\n${rawFacts}`,
        maxTokens: 5000,
        skipLibrary: true,
      }));

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let ext: ExtractionResult & { counterclaim_detected?: CounterclaimDetectedResult };
      try {
        ext = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        ext = JSON.parse(repaired);
      }

      // Split counterclaim_detected out — it lives as a sibling of `extraction`
      // on intelligence_data (Phase 6A-ii), not nested inside it, even though
      // the AI returns both in the same Step 2 JSON blob.
      const { counterclaim_detected: ccRaw, ...extractionOnly } = ext;
      const counterclaim: CounterclaimDetectedResult =
        ccRaw && typeof ccRaw.flag === 'boolean'
          ? { flag: ccRaw.flag, ...(ccRaw.summary ? { summary: ccRaw.summary } : {}) }
          : { flag: false };

      setExtraction(extractionOnly);
      setCounterclaimDetected(counterclaim);
      advance(2, { extraction: extractionOnly, rawFacts, counterclaim_detected: counterclaim });
      // Step 2b fires automatically — non-blocking (does not await)
      runCommencementAudit(extractionOnly);
      // Phase 2E — Theory Clash Synthesis fires automatically on defendant+SPA path (non-blocking)
      if (isDefendantWithSPA) {
        runTheoryClashSynthesis(extractionOnly, counterclaim);
      }
      // Phase 3A — MCA extraction hook: fires when matter_track === 'matrimonial' (non-blocking)
      if (activeCase.matter_track === 'matrimonial') {
        runMCAExtraction(extractionOnly, rawFacts);
      }
    } catch (e) {
      setError('Extraction failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Phase 3A: MCA Extraction Hook (fires after Step 2 when matter_track === 'matrimonial') ──
  // Non-blocking. Reads the standard ExtractionResult already produced by Step 2,
  // runs a targeted MCA prompt against the raw facts, and persists via writeIntelligenceToCase().
  // Respondent path: when counsel_role === 'respondent_side', the paste is the served Petition —
  // MCA layer reads what is being alleged and maps Answer + Cross-Petition strategy automatically.
  async function runMCAExtraction(ext: ExtractionResult, raw: string) {
    const role = activeCase.counsel_role ?? 'petitioner_side';
    const isRespondent = role === 'respondent_side';

    const systemPrompt = `You are an MCA (Matrimonial Causes Act) intelligence extraction engine for Nigerian matrimonial litigation.
Extract structured matrimonial intelligence from the facts below.
Output ONLY valid JSON — no markdown fences, no preamble, no explanation. Exactly this structure:
{
  "marriage_timeline": {
    "date_of_marriage": "...",
    "place_of_marriage": "...",
    "date_of_separation": "...",
    "duration_years": 0,
    "cohabitation_ended": "..."
  },
  "relief_sought": "...",
  "dissolution_facts": [
    { "fact_code": "adultery|cruelty|desertion|two_year_sep|five_year_sep|incurable_insanity|imprisonment", "particulars": "...", "strength": "STRONG|MODERATE|WEAK" }
  ],
  "two_year_bar": {
    "applies": true,
    "exception_available": "wilful_refusal|adultery|rape_sodomy_bestiality|none",
    "leave_needed": true
  },
  "condonation_risk": { "risk": true, "basis": "...", "severity": "HIGH|MEDIUM|LOW|NONE" },
  "connivance_risk": { "risk": false, "basis": "..." },
  "co_respondent": { "named": false, "name": "", "service_feasible": false },
  "decree_stage": "none|nisi|absolute",
  "cross_petition": {
    "detected": false,
    "filed_by": "respondent",
    "facts": [],
    "relief": ""
  },
  "gaps_and_risks": [{ "issue": "...", "severity": "HIGH|MEDIUM|LOW" }]
}
Rules:
- two_year_bar.applies = true when separation < 2 years from filing date and no s.15(2)(a)-(c) exception applies.
- condonation_risk: true when petitioner resumed cohabitation after the conduct complained of.
- cross_petition.detected: true only when facts disclose an independent dissolution ground available to the respondent.
- ${isRespondent ? 'RESPONDENT PATH: The raw facts are the served Petition. Map: what is alleged against the respondent, viable Answer grounds, and whether a Cross-Petition is warranted.' : 'PETITIONER PATH: Extract all dissolution facts and readiness indicators.'}
- Output ONLY the JSON object. Nothing before or after.`;

    try {
      const res = await callClaude({
        system: systemPrompt,
        userMsg: `COUNSEL ROLE: ${role}

RAW FACTS / SERVED PETITION:
${raw}

STANDARD EXTRACTION (for context):
${JSON.stringify(ext, null, 2)}`,
        maxTokens: 2000,
      });

      let mcaRaw: MExtractionResult;
      try {
        const cleaned = res.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);

        // Map AI output → MExtractionResult shape
        mcaRaw = {
          marriage_timeline:  parsed.marriage_timeline  ?? { date_of_marriage: '', place_of_marriage: '', date_of_separation: '', duration_years: 0, cohabitation_ended: '' },
          relief_sought:      parsed.relief_sought      ?? '',
          dissolution_facts:  parsed.dissolution_facts  ?? [],
          two_year_bar:       parsed.two_year_bar       ?? { applies: false, exception_available: 'none', leave_needed: false },
          children:           parsed.children           ?? [],
          financial_picture:  parsed.financial_picture  ?? { assets_mentioned: [], liabilities_mentioned: [], maintenance_sought: false, property_sought: false },
          condonation_risk:   parsed.condonation_risk   ?? { risk: false, basis: '', severity: 'NONE' },
          connivance_risk:    parsed.connivance_risk    ?? { risk: false, basis: '' },
          co_respondent:      parsed.co_respondent      ?? { named: false, name: '', service_feasible: false },
          decree_stage:       parsed.decree_stage       ?? 'none',
          gaps_and_risks:     parsed.gaps_and_risks     ?? [],
        };
      } catch {
        // MCA parse failed — silent, non-blocking
        return;
      }

      // Persist to matrimonial_data via writeIntelligenceToCase (non-destructive merge)
      await writeIntelligenceToCase(activeCase.id, mcaRaw, '');

      // If cross-petition detected — update matrimonial_data cross_petition fields via onSave surface
      // (onSave covers intelligence_data fields; cross_petition fields are written directly by the activate button)
      // — nothing more needed here; MatrimonialDashboard reads writeIntelligenceToCase output on next mount.
    } catch {
      // Non-blocking — swallow silently; standard Step 2 result is already persisted
    }
  }


  // ── Step 2b: Commencement Audit (auto-runs after extraction) ──────────────
  // Ports: Full Compliance Audit + Limitation Calculator + Service Validator
  // from ComplianceEngine into the pipeline. Saves to intelligence_data.commencement_audit.
  async function runCommencementAudit(ext: ExtractionResult) {
    setAuditLoading(true); setAuditError('');
    const track     = activeCase.matter_track ?? 'civil';
    const roleLabel = activeCase.counsel_role
      ? activeCase.counsel_role.replace('_', ' ')
      : track === 'criminal' ? 'defence' : 'claimant side';
    const trackLabel = track === 'criminal' ? 'Criminal' : 'Civil';

    const roleDirective = track === 'criminal'
      ? activeCase.counsel_role === 'prosecution'
        ? 'You advise prosecution. Flag compliance gaps the defence could exploit — ACJA violations, constitutional defects, evidence exclusion risks.'
        : 'You advise defence. Identify every procedural defect, constitutional violation, or compliance gap benefiting the accused — discharge grounds, exclusion of evidence, bail.'
      : activeCase.counsel_role === 'defendant_side'
        ? 'You advise the defendant. Identify every procedural defect the defendant can exploit — invalid service, limitation, wrong originating process, pre-action non-compliance.'
        : 'You advise the claimant. Flag compliance risks that could defeat the claim — limitation expiry, defective process, service failure, standing issues.';

    const system = `You are a Nigerian litigation procedural compliance expert acting for ${roleLabel} on a ${trackLabel} matter.
${roleDirective}
Cite specific Nigerian statutes, Rules of Court, and court decisions. Be precise and actionable.
Output ONLY valid JSON — no markdown fences, no preamble, no explanation.`;

    const prompt = `Conduct a commencement audit across three areas from the case facts and extracted intelligence below.

CASE: ${activeCase.caseName || 'Untitled'}
COURT: ${activeCase.court || 'Not specified'}
TRACK: ${trackLabel} | ROLE: ${roleLabel}
${partyAPlural}: ${activeCase.claimants.map(c => c.name).filter(Boolean).join(', ') || 'Not specified'}
${partyBPlural}: ${activeCase.defendants.map(d => d.name).filter(Boolean).join(', ') || 'Not specified'}

RAW FACTS:
${rawFacts}

EXTRACTED INTELLIGENCE (timeline / legal issues / initial risks):
Timeline: ${JSON.stringify(ext.timeline?.slice(0, 5) ?? [])}
Legal issues: ${JSON.stringify(ext.legal_issues ?? [])}
Initial risks: ${JSON.stringify(ext.initial_risks ?? [])}

Return EXACTLY this JSON object and nothing else:
{
  "findings": "Detailed markdown narrative covering:\n## COMPLIANCE AUDIT\n[Status per area: COMPLIANT / AT RISK / DEFECTIVE. Cite statutes and Rules of Court. Include limitation period analysis: cause of action identified from facts, applicable limitation period and statute, whether time is open or expired. Include service validity assessment based on any service facts mentioned.]\n## LIMITATION PERIOD\n[Specific limitation period, trigger event, current status, any extension provisions, pre-action notice requirements]\n## SERVICE VALIDITY\n[Assessment of service validity or anticipated service requirements for this matter type]\n## COMPLIANCE SUMMARY\n[Priority-ranked list of immediate actions]",
  "limitation_expiry": "ISO date string if calculable, or plain text like 'Cannot determine without trigger date', or null",
  "service_valid": true or false or null,
  "status": "CLEAR or RISK or DEFECTIVE",
  "summary": "One sentence for Case Command — e.g. 'Limitation period open, service requirements identified, no critical defects'"
}

Rules:
- status CLEAR = no material compliance risk identified
- status RISK = at least one issue needs attention but is not yet fatal
- status DEFECTIVE = a fatal procedural defect exists
- If facts are insufficient to determine an area, note it as UNCLEAR in findings but still return the JSON
- Never use unescaped double quotes inside JSON string values`;

    try {
      const raw = await withRetry(() => callClaude({
        system,
        userMsg: prompt,
        maxTokens: 2500,
        skipLibrary: true,
      }));

      let cleaned = raw.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON in audit response');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: Omit<CommencementAuditResult, 'run_at'>;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
          .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const result: CommencementAuditResult = {
        run_at:            new Date().toISOString(),
        findings:          parsed.findings   ?? '',
        limitation_expiry: parsed.limitation_expiry ?? undefined,
        service_valid:     typeof parsed.service_valid === 'boolean' ? parsed.service_valid : undefined,
        status:            (['CLEAR','RISK','DEFECTIVE'] as const).includes(parsed.status as 'CLEAR'|'RISK'|'DEFECTIVE')
                             ? parsed.status as 'CLEAR'|'RISK'|'DEFECTIVE'
                             : 'RISK',
        summary:           parsed.summary ?? '',
      };

      setCommencementAudit(result);
      // Persist immediately — commencementAudit state won't be visible to persist() yet
      // so we pass it directly in the update
      onSave({
        stage, rawFacts, extraction: ext, followUpQs, followUpAs, evidenceM, intPkg,
        commencement_audit: result,
      });
    } catch (e) {
      setAuditError('Commencement audit failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setAuditLoading(false); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2E — Theory Clash Synthesis
  // Defendant + SPA path only. Runs after extraction completes (non-blocking).
  // Produces a CaseTheoryRecord (case_theory_structured v1), saves it, and
  // immediately locks it so downstream engines (CrossExamEngine, FinalWrittenAddressEngine,
  // ApplicationsEngine) can consume it without a separate lock step from counsel.
  // Counsel can unlock → edit → relock via the standard 3D flow later.
  // ─────────────────────────────────────────────────────────────────────────
  async function runTheoryClashSynthesis(
    ext: ExtractionResult,
    cc: CounterclaimDetectedResult,
  ) {
    if (!spaResult) return;
    setTheoryClashLoading(true);
    setTheoryClashError('');
    setTheoryClashDone(false);
    try {
      const claimantTheory = spaResult.claimant_theory;
      const claimsBlock    = spaResult.claims_identified.map((c, i) => `${i + 1}. ${c}`).join('\n');
      const allegationsBlk = spaResult.factual_allegations.map((a, i) => `${i + 1}. ${a}`).join('\n');
      const ccBlock        = cc.flag && cc.summary ? `COUNTERCLAIM CONFIRMED: ${cc.summary}` : 'No counterclaim confirmed.';
      const issuesBlock    = (ext.legal_issues ?? []).map((v, i) => `${i + 1}. ${v}`).join('\n');
      const factsBlock     = (ext.established_facts ?? []).slice(0, 12).map((v, i) => `${i + 1}. ${v}`).join('\n');
      const disputedBlock  = (ext.disputed_areas ?? []).map((v, i) => `${i + 1}. ${v}`).join('\n');
      const gapsBlock      = (ext.gaps_identified ?? []).map((v, i) => `${i + 1}. ${v}`).join('\n');
      const risksBlock     = (ext.initial_risks ?? []).map((r, i) => `${i + 1}. [${r.severity}] ${r.risk}`).join('\n');

      const raw = await withRetry(() => callClaude({
        system: (() => {
          const tcRole = activeCase.counsel_role ?? 'defendant_side';
          const tcReceiving = tcRole === 'respondent_side' ? 'Respondent (Petition matter)' : tcRole === 'frep_respondent' ? 'Respondent (FREP matter)' : 'Defendant';
          const tcOpposing = tcRole === 'respondent_side' ? 'Petitioner' : tcRole === 'frep_respondent' ? 'Applicant' : 'Claimant/Petitioner';
          return `You are a senior trial advocate synthesising a Theory of the Case for the ${tcReceiving} in Nigerian litigation.
You have been given:
  (A) The ${tcOpposing}'s theory as extracted from the served process.
  (B) The ${tcReceiving}'s extracted intelligence — facts, disputes, issues, risks, gaps, and any confirmed counterclaim/cross-petition.

Your task is to produce a single locked CaseTheoryRecord for the \${tcReceiving} that:
1. Names the core proposition the Defendant must establish to WIN (not merely to resist — frame it as an affirmative position).
2. Lists every element the Defendant must prove or maintain, each with the evidence that supports it, the Nigerian statute/authority behind it, and the risk if that element fails.
3. States the Claimant's theory in one sentence (opposing_theory).
4. Identifies the single fact, document, or admission that — if established — defeats the Claimant's theory entirely (theory_killer).
5. Identifies the Defendant's weakest element and the contingency if it cannot be proved (weakest_link).
6. Crafts a human-level narrative theme for the trial judge — non-legal, story-form, one sentence.
7. Produces a gap report: every evidentiary or procedural gap that must be closed before trial, with a specific (named, not generic) suggested action.
8. Scores the theory on five 0–20 dimensions (total must sum to 0–100):
   - legal_sufficiency: Are the legal elements fully identified and grounded in Nigerian authority?
   - evidence_coverage: How well does the current evidence support each element?
   - vulnerability: How exposed is the Defendant to the Claimant's theory? (higher = more vulnerable)
   - narrative_coherence: How compelling and coherent is the Defendant's story?
   - jurisdictional_precision: How precisely are the relevant Nigerian court, rules, and procedure identified?

Output ONLY valid JSON — no preamble, no markdown fences, no explanation. Exactly:
{
  "core_proposition": "One sentence. The single thing that if proved wins for the Defendant.",
  "elements": [
    {"element":"...","evidence":"...","authority":"Nigerian statute or case","risk":"..."}
  ],
  "opposing_theory": "The Claimant's case in one sentence.",
  "theory_killer": "The one fact/document/admission that defeats their theory.",
  "weakest_link": "Our least confident element + contingency.",
  "narrative_theme": "Human story for the judge, non-legal language, one sentence.",
  "gap_report": [
    {"element":"...","needed":"...","suggested_action":"Specific named action — e.g. 'Obtain certified copy of Deed No. X from Lands Registry'"}
  ],
  "score_breakdown": {
    "legal_sufficiency": 0,
    "evidence_coverage": 0,
    "vulnerability": 0,
    "narrative_coherence": 0,
    "jurisdictional_precision": 0,
    "total": 0
  }
}

Rules:
- Every element must cite a real Nigerian statute, rule, or decided case — do not invent authorities.
- suggested_action must be specific and actionable, never "gather evidence" or "conduct research".
- score_breakdown.total must equal the exact arithmetic sum of the five sub-scores.
- Output ONLY the JSON object.`; })(),
        userMsg: (() => {
          const umRole = activeCase.counsel_role ?? 'defendant_side';
          const umOpposing = umRole === 'respondent_side' ? 'PETITIONER' : umRole === 'frep_respondent' ? 'APPLICANT' : 'CLAIMANT';
          const umReceiving = umRole === 'respondent_side' ? 'RESPONDENT' : umRole === 'frep_respondent' ? 'RESPONDENT (FREP)' : 'DEFENDANT';
          return `CASE: ${activeCase.caseName}
COURT: ${activeCase.court || 'Not specified'}
SUIT NO: ${activeCase.suitNo || 'Not specified'}
${umOpposing}: ${activeCase.claimants.map(c => c.name).filter(Boolean).join(', ') || 'Not named'}
${umReceiving} (our client): ${activeCase.defendants.map(d => d.name).filter(Boolean).join(', ') || 'Not named'}

═══ (A) ${umOpposing}'S THEORY (from served process) ═══
${claimantTheory}

CLAIMS / RELIEFS SOUGHT:
${claimsBlock || 'Not specified'}

FACTUAL ALLEGATIONS AGAINST ${umReceiving}:
${allegationsBlk || 'Not specified'}

═══ (B) ${umReceiving}'S EXTRACTED INTELLIGENCE ═══
LEGAL ISSUES:
${issuesBlock || 'None extracted'}

ESTABLISHED FACTS (from client instructions):
${factsBlock || 'None extracted'}

DISPUTED AREAS:
${disputedBlock || 'None extracted'}

EVIDENCE GAPS:
${gapsBlock || 'None extracted'}

INITIAL RISKS:
${risksBlock || 'None extracted'}

COUNTERCLAIM STATUS:
${ccBlock}`; })(),
        maxTokens: 4000,
        skipLibrary: true,
      }));

      let cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('Theory Clash: no JSON found in response.');
      cleaned = cleaned.slice(s, e + 1);

      let record: CaseTheoryRecord;
      try {
        record = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        record = JSON.parse(repaired);
      }

      // Save + immediately lock (v1)
      await saveCaseTheory(activeCase.id, record);
      await lockCaseTheory(activeCase.id);

      setTheoryClashRecord(record);
      setTheoryClashDone(true);
    } catch (err) {
      setTheoryClashError('Theory Clash Synthesis failed: ' + ((err as Error).message || 'Please try again.'));
    } finally {
      setTheoryClashLoading(false);
    }
  }

    // ── Step 2b: Commencement Audit panel (rendered inside Stage2) ───────────

  function CommencementAuditPanel() {
    if (!auditLoading && !commencementAudit && !auditError) return null;

    const statusCfg = {
      CLEAR:    { bg: '#071810', bdr: '#1a4028', col: '#40b068', icon: '✓' },
      RISK:     { bg: '#1a1000', bdr: '#3a2800', col: '#c08030', icon: '⚠' },
      DEFECTIVE:{ bg: '#1a0808', bdr: '#401818', col: '#c05050', icon: '✗' },
    };
    const sc = commencementAudit ? statusCfg[commencementAudit.status] : null;

    return (
      <div style={{
        background: '#0a0a14', border: `1px solid ${sc ? sc.bdr : '#1a1a28'}`,
        borderRadius: 8, padding: '16px 20px', marginBottom: 14,
        borderLeft: `3px solid ${sc ? sc.col : '#2a2a40'}`,
        animation: 'fadeUp .3s ease',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: auditLoading ? 0 : 12 }}>
          <span style={{ fontSize: 9, color: sc?.col ?? '#5a5a78', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
            Step 2b · Commencement Audit
          </span>
          {auditLoading && (
            <>
              <Spinner size={10} />
              <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                Running compliance · limitation · service audit…
              </span>
            </>
          )}
          {!auditLoading && commencementAudit && sc && (
            <span style={{ marginLeft: 'auto', background: sc.bg, border: `1px solid ${sc.bdr}`, color: sc.col, fontSize: 8, padding: '2px 8px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', fontWeight: 700 }}>
              {sc.icon} {commencementAudit.status}
            </span>
          )}
          {!auditLoading && !commencementAudit && auditError && (
            <button
              onClick={() => extraction && runCommencementAudit(extraction)}
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #3a2800', color: '#c08030', borderRadius: 4, padding: '3px 10px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em' }}>
              ↺ Retry
            </button>
          )}
        </div>

        {/* Summary + detail */}
        {!auditLoading && commencementAudit && (
          <>
            <p style={{ fontSize: 13, color: sc!.col, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 10 }}>
              {commencementAudit.summary}
            </p>
            {(commencementAudit.limitation_expiry || commencementAudit.service_valid !== undefined) && (
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                {commencementAudit.limitation_expiry && (
                  <div style={{ background: '#0d0d18', border: '1px solid #1a1a28', borderRadius: 5, padding: '7px 12px' }}>
                    <span style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>
                      Limitation Expiry
                    </span>
                    <span style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>
                      {commencementAudit.limitation_expiry}
                    </span>
                  </div>
                )}
                {commencementAudit.service_valid !== undefined && (
                  <div style={{ background: '#0d0d18', border: '1px solid #1a1a28', borderRadius: 5, padding: '7px 12px' }}>
                    <span style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>
                      Service Valid
                    </span>
                    <span style={{ fontSize: 12, color: commencementAudit.service_valid ? '#40b068' : '#c05050', fontFamily: "'Times New Roman', Times, serif" }}>
                      {commencementAudit.service_valid ? 'Yes' : 'No / Unclear'}
                    </span>
                  </div>
                )}
              </div>
            )}
            <details style={{ cursor: 'pointer' }}>
              <summary style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', userSelect: 'none', outline: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>▸</span> View full audit findings
              </summary>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #131320' }}>
                <Md text={commencementAudit.findings} />
              </div>
            </details>
          </>
        )}

        {/* Error state */}
        {!auditLoading && auditError && (
          <p style={{ fontSize: 12, color: '#804040', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            {auditError}
          </p>
        )}
      </div>
    );
  }
  async function generateFollowUp() {
    setLoading(true); setError('');
    try {
      const raw = await callClaude({
        system: `You are a trial intelligence engine for Nigerian litigation. Generate precise gap-filling follow-up questions. Role: ${role}. Output ONLY valid JSON — no markdown, no preamble. Exactly this structure: {"questions":[{"id":"q1","question":"...","purpose":"..."}]}`,
        userMsg: `${caseCtx}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nGenerate 6 targeted follow-up questions addressing the most critical gaps.`,
        maxTokens: 5000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: { questions: TIEData['followUpQs'] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const qs: TIEData['followUpQs'] = parsed.questions || [];
      const initAs: Record<string, string> = {};
      qs.forEach(q => { initAs[q.id] = ''; });
      setFollowUpQs(qs); setFollowUpAs(initAs);
      advance(3, { followUpQs: qs, followUpAs: initAs });
    } catch (e) {
      setError('Question generation failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 3 → 4: Build evidence matrix ─────────────────────────────────────
  async function buildEvidenceMatrix() {
    const answered = followUpQs.filter(q => followUpAs[q.id]?.trim()).length;
    if (answered < Math.min(3, followUpQs.length)) {
      setError('Please answer at least 3 questions before proceeding.');
      return;
    }
    setLoading(true); setError('');
    const qaText = followUpQs
      .map(q => `Q: ${q.question}\nA: ${followUpAs[q.id] || '(Not answered)'}`)
      .join('\n\n');
    try {
      const raw = await callClaude({
        system: `You are a trial evidence strategist for Nigerian litigation. Map required evidence to facts and legal issues. Role of client: ${role}. Output ONLY valid JSON — no markdown, no preamble. Exactly this structure: {"evidence_map":[{"issue":"...","evidence_needed":["..."],"evidence_available":["..."],"evidence_missing":["..."],"priority":"CRITICAL|HIGH|MEDIUM|LOW","notes":"..."}]}`,
        userMsg: `${caseCtx}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nFOLLOW-UP ANSWERS:\n${qaText}\n\nBuild the evidence matrix.`,
        maxTokens: 5000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: { evidence_map: EvidenceMapItem[] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const em: EvidenceMapItem[] = parsed.evidence_map || [];
      setEvidenceM(em);
      advance(4, { evidenceM: em });
    } catch (e) {
      setError('Evidence mapping failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 4 → 5: Generate Intelligence Package ─────────────────────────────
  async function generatePackage() {
    setLoading(true); setError('');
    const qaText = followUpQs
      .map(q => `Q: ${q.question}\nA: ${followUpAs[q.id] || '(Not answered)'}`)
      .join('\n\n');
    const claimsHead =
      activeCase.counsel_role === 'claimant_side' ? `${partyA.toUpperCase()} CLAIMS & RELIEF` :
      activeCase.counsel_role === 'defendant_side' ? `${partyB.toUpperCase()} DEFENCE POSTURE & COUNTERCLAIMS` :
      'CLAIMS, DEFENCES & STRATEGY';
    try {
      let streamedPkg = '';
      const { text: pkg } = await callClaude({
        system: `You are a Senior Advocate at the Nigerian Bar with 30 years of trial experience. You produce trial intelligence packages of exceptional depth and precision. Role-aware, outcome-focused, and honest. Your analysis changes how lawyers approach cases.`,
        userMsg: `${caseCtx}\n\nRAW FACTS:\n${rawFacts}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nFOLLOW-UP ANSWERS:\n${qaText}\n\nEVIDENCE MATRIX:\n${JSON.stringify(evidenceM, null, 2)}\n\nGenerate the full Trial Intelligence Package. Format as structured markdown:\n\n# ESTABLISHED FACTS\n[Undisputed facts with basis]\n\n# DISPUTED FACTS\n[Contested facts and likely nature of dispute]\n\n# MISSING EVIDENCE\n[Critical gaps — what must be obtained and how]\n\n# LEGAL ISSUES\n[Each issue distilled — element by element where applicable]\n\n# ${claimsHead}\n[Role-specific: causes of action / grounds of defence, elements, burden of proof, what must be proved]\n\n# AUTHORITY GROUNDING\nFor every authority mentioned anywhere in the facts or follow-up answers:\n\n## HIERARCHY MAP\nFor each cited case: court level, binding on which courts in this matter, persuasive value if not binding. Flag any authority cited without a court or citation — those must be verified before filing.\n\n## BINDING FORCE & RATIO\nFor each authority: the ratio decidendi being relied on (not obiter). Flag where the principle being extracted may be obiter only.\n\n## OVERRULED / CONFLICTING STATUS\nHas any cited authority been overruled, distinguished, or significantly limited by a later decision? If so, name the later case and its effect. Flag any authority where currency is uncertain — direct counsel to verify on LawPavilion, NigeriaLII, or NWLR before filing.\n\n## CONFLICTING AUTHORITIES\nAre any cited authorities in direct conflict with each other? Identify the conflict, map hierarchy to determine which prevails, and state the reconciliation strategy.\n\n## OPPOSITION ATTACK VECTORS\nFor each authority we rely on: how will opposing counsel attack or distinguish it? For each authority they are likely to rely on: how do we neutralise it?\n\nIf no authorities are mentioned in the facts, state: \\\"No authorities cited in the facts provided — authority research required before filing.\\\" Do not fabricate case names.\n\n# RISK REGISTER\n[Every material risk — severity HIGH/MEDIUM/LOW, impact, mitigation]\n\n# IMMEDIATE ACTION ITEMS\n[Specific, time-sensitive steps the lawyer must take NOW]\n\nWrite with the precision of a Senior Advocate who has analysed every document and seen every angle. Be direct, specific, and unflinchingly honest.`,
        maxTokens: 5000,
        skipLibrary: true,
        streamCaseId: activeCase.id,
        streamEngine: 'intelligence-pkg',
        onChunk: (chunk) => {
          streamedPkg += chunk;
          setIntPkg(streamedPkg);
        },
        onResumed: () => setPkgResumed(true),
      });
      setIntPkg(pkg);
      advance(5, { intPkg: pkg });
      // Step 5b — auto-run risk verdict off the completed package
      runRiskVerdict(pkg);
      // Step 5 — auto-run authority grounding off the completed package
      runAuthorityGrounding(pkg);
    } catch (e) {
      setError('Package generation failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  async function copyPackage() {
    await copyToClipboard(intPkg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function resetPipeline() {
    if (!window.confirm('Reset the Intelligence Engine? All pipeline data for this case will be cleared.')) return;
    setStage(1); setRawFacts(''); setExtraction(null); setFollowUpQs([]);
    setFollowUpAs({}); setEvidenceM(null); setIntPkg(''); setError('');
    setCommencementAudit(undefined); setAuditError('');
    setCounterclaimDetected(undefined);
    setConflictScan(undefined); setConflictError('');
    setRiskVerdict(undefined); setRiskError(''); setRiskAnimated(false);
    const resetStage = isReceivingSide ? 0 : 1;
    onSave({ stage: resetStage, rawFacts: '', extraction: null, followUpQs: [], followUpAs: {}, evidenceM: null, intPkg: '', commencement_audit: undefined, counterclaim_detected: undefined, conflict_scan: undefined, risk_verdict: undefined, authority_grounding: undefined, served_process_analysis: undefined });
    setSpaResult(undefined);
    setProcessText('');
    setStage(resetStage);
  }

  // ── Phase 1A: Role Gate ────────────────────────────────────────────────────
  //
  // Fires when counsel_role is absent at case level (stage === -1 conceptually).
  // Presents matter_track selector → counsel_role selector → Confirm.
  // On confirm → calls onSaveRole(track, role) → parent persists → gate clears.
  //
  // Layout: newspaper-white canvas, same dark-card sub-panels used across the engine.
  // No AI calls made here — pure data entry and save.

  function RoleGate() {
    const availableRoles = rolesForTrack(gateTrack);
    // FREP roles are a special case — exposed separately below
    const trackOptions: MatterTrack[] = ['civil', 'criminal', 'matrimonial'];

    return (
      <div style={{ animation: 'fadeUp .35s ease' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 9, color: '#c07820', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            Phase 1A · Role Gate &amp; Pipeline Split
          </p>
          <h2 style={{ fontSize: 24, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 8 }}>
            What is your role on this matter?
          </h2>
          <p style={{ fontSize: 13, color: '#555555', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75 }}>
            The Intelligence Engine routes every phase, prompt, and output based on your role.
            This is set once and controls everything downstream — the pipeline, the audit calibration,
            the evidence matrix, and the package voice. Confirm it carefully.
          </p>
        </div>

        {/* Step 1 — Matter Track */}
        <div style={{ background: '#0d0d18', border: '1px solid #1a1a30', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>
          <p style={{ fontSize: 9, color: '#8080b0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
            Step 1 · Matter Track
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {trackOptions.map(track => {
              const selected = gateTrack === track;
              return (
                <button
                  key={track}
                  onClick={() => { setGateTrack(track); setGateRole(''); }}
                  style={{
                    flex: 1, minWidth: 100,
                    background: selected ? '#1a1a40' : '#070710',
                    border: `1px solid ${selected ? '#5050a0' : '#1e1e30'}`,
                    borderRadius: 7, padding: '14px 10px',
                    cursor: 'pointer', textAlign: 'center',
                    transition: 'border-color .15s, background .15s',
                  }}
                >
                  <p style={{
                    fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
                    color: selected ? '#c8c8f8' : '#5a5a78',
                    fontWeight: selected ? 700 : 400,
                    letterSpacing: '.04em',
                  }}>
                    {MATTER_TRACK_LABELS[track]}
                  </p>
                </button>
              );
            })}
          </div>
          {/* FREP supplemental */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #131320' }}>
            <p style={{ fontSize: 10, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', marginBottom: 8 }}>
              Fundamental Rights Enforcement (FREP) matters use the civil track with specialist FREP roles:
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['frep_applicant', 'frep_respondent'] as CounselRole[]).map(r => {
                const selected = gateRole === r;
                const cfg = COUNSEL_ROLE_COLORS[r];
                return (
                  <button
                    key={r}
                    onClick={() => { setGateTrack('civil'); setGateRole(r); }}
                    style={{
                      flex: 1,
                      background: selected ? cfg.bg : '#070710',
                      border: `1px solid ${selected ? cfg.bdr : '#1e1e30'}`,
                      borderRadius: 6, padding: '10px 12px',
                      cursor: 'pointer',
                      transition: 'border-color .15s, background .15s',
                    }}
                  >
                    <p style={{ fontSize: 12, color: selected ? cfg.col : '#3a3a52', fontFamily: "'Times New Roman', Times, serif", fontWeight: selected ? 700 : 400 }}>
                      {COUNSEL_ROLE_LABELS[r]}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Step 2 — Counsel Role */}
        {!(['frep_applicant', 'frep_respondent'] as string[]).includes(gateRole) && (
          <div style={{ background: '#0d0d18', border: '1px solid #1a1a30', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>
            <p style={{ fontSize: 9, color: '#8080b0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
              Step 2 · Your Role
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {availableRoles.map(r => {
                const selected = gateRole === r;
                const cfg = COUNSEL_ROLE_COLORS[r];
                const rPipeline = getPipelineType(r);
                const pCopy = PIPELINE_COPY[rPipeline];
                return (
                  <button
                    key={r}
                    onClick={() => setGateRole(r)}
                    style={{
                      background: selected ? cfg.bg : '#070710',
                      border: `2px solid ${selected ? cfg.bdr : '#1e1e30'}`,
                      borderRadius: 9, padding: '16px 18px',
                      cursor: 'pointer', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 16,
                      transition: 'border-color .15s, background .15s',
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{pCopy.icon}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 15, color: selected ? cfg.col : '#6a6a88', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, marginBottom: 3 }}>
                        {COUNSEL_ROLE_LABELS[r]}
                      </p>
                      <p style={{ fontSize: 11, color: selected ? '#555555' : '#3a3a50', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55 }}>
                        {pCopy.label} · {pCopy.description}
                      </p>
                    </div>
                    {selected && (
                      <span style={{ fontSize: 12, color: cfg.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, flexShrink: 0 }}>✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3 — Pipeline confirmation preview */}
        {gateRole && (() => {
          const confirmed = getPipelineType(gateRole as CounselRole);
          const pCopy = PIPELINE_COPY[confirmed];
          const cfg   = COUNSEL_ROLE_COLORS[gateRole as CounselRole];
          return (
            <div style={{ background: '#08080f', border: `1px solid ${cfg.bdr}`, borderLeft: `4px solid ${cfg.col}`, borderRadius: 8, padding: '16px 20px', marginBottom: 18 }}>
              <p style={{ fontSize: 9, color: cfg.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
                {pCopy.icon}  Pipeline Confirmed
              </p>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Pipeline</p>
                  <p style={{ fontSize: 13, color: cfg.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>{pCopy.label}</p>
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Track</p>
                  <p style={{ fontSize: 13, color: '#c8c8e0', fontFamily: "'Times New Roman', Times, serif" }}>{MATTER_TRACK_LABELS[gateTrack]}</p>
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Role</p>
                  <p style={{ fontSize: 13, color: '#c8c8e0', fontFamily: "'Times New Roman', Times, serif" }}>{COUNSEL_ROLE_LABELS[gateRole as CounselRole]}</p>
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Entry Point</p>
                  <p style={{ fontSize: 13, color: '#c8c8e0', fontFamily: "'Times New Roman', Times, serif" }}>
                    {RECEIVING_ROLES_SET.has(gateRole as CounselRole) ? 'Stage 0 — Entry Path Selector' : 'Stage 1 — Raw Facts'}
                  </p>
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginTop: 10, fontStyle: 'italic' }}>
                This role is permanent once confirmed — it controls every phase, prompt, audit, and output downstream. The engine cannot run without it.
              </p>
            </div>
          );
        })()}

        {/* Confirm button */}
        <button
          onClick={confirmRoleGate}
          disabled={!gateRole || gateSaving}
          style={{
            width: '100%',
            background: !gateRole || gateSaving
              ? '#101018'
              : 'linear-gradient(135deg,#000000,#302080)',
            color: !gateRole || gateSaving ? '#2a2a38' : '#c8c8f8',
            border: 'none', borderRadius: 7, padding: '16px',
            fontSize: 17, fontFamily: "'Times New Roman', Times, serif",
            cursor: !gateRole || gateSaving ? 'not-allowed' : 'pointer',
            fontWeight: 600, letterSpacing: '.06em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {gateSaving
            ? <><Spinner size={14} /> Saving Role…</>
            : gateRole
              ? `Confirm ${COUNSEL_ROLE_LABELS[gateRole as CounselRole]} → Open Intelligence Engine`
              : 'Select your role to continue'
          }
        </button>
      </div>
    );
  }

  // ── Phase 1A: Pipeline Banner ──────────────────────────────────────────────
  //
  // Rendered at the top of every stage (0 → 5) after the gate is cleared.
  // Non-interactive strip confirming: pipeline type, track, role, entry point.
  // Collapsed by default; expands on click to show full context.

  function PipelineBanner() {
    const [expanded, setExpanded] = useState(false);
    if (roleGateActive) return null; // gate not cleared yet — don't show banner
    const pCopy = PIPELINE_COPY[pipeline];
    const cfg   = activeCase.counsel_role ? COUNSEL_ROLE_COLORS[activeCase.counsel_role] : null;
    if (!cfg) return null;

    return (
      <div
        onClick={() => setExpanded(x => !x)}
        role="button"
        style={{
          background: '#07070e',
          border: `1px solid ${cfg.bdr}`,
          borderLeft: `3px solid ${cfg.col}`,
          borderRadius: 6, padding: '8px 14px',
          marginBottom: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, flexShrink: 0 }}>{pCopy.icon}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 9, color: cfg.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
            {pCopy.label}
          </span>
          {!expanded && (
            <span style={{ fontSize: 9, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", marginLeft: 12 }}>
              {COUNSEL_ROLE_LABELS[activeCase.counsel_role!]} · {MATTER_TRACK_LABELS[activeCase.matter_track ?? 'civil']}
            </span>
          )}
        </div>
        <span style={{ fontSize: 9, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>
          {expanded ? '▴' : '▾'}
        </span>

        {expanded && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: '#09090f', border: `1px solid ${cfg.bdr}`, borderRadius: 6, padding: '12px 16px', zIndex: 10, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Pipeline</p>
              <p style={{ fontSize: 12, color: cfg.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>{pCopy.label}</p>
            </div>
            <div>
              <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Track</p>
              <p style={{ fontSize: 12, color: '#c8c8e0', fontFamily: "'Times New Roman', Times, serif" }}>{MATTER_TRACK_LABELS[activeCase.matter_track ?? 'civil']}</p>
            </div>
            <div>
              <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Role</p>
              <p style={{ fontSize: 12, color: '#c8c8e0', fontFamily: "'Times New Roman', Times, serif" }}>{COUNSEL_ROLE_LABELS[activeCase.counsel_role!]}</p>
            </div>
            <div>
              <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Description</p>
              <p style={{ fontSize: 12, color: '#c8c8e0', fontFamily: "'Times New Roman', Times, serif" }}>{pCopy.description}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Step progress bar ──────────────────────────────────────────────────────
  function TIESteps() {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        marginBottom: 28, padding: '14px 18px',
        background: '#ffffff', border: '1px solid #181828',
        borderRadius: 8, overflowX: 'auto',
      }}>
        {TIE_STEPS.map((s, i) => {
          const done   = stage > s.id;
          const active = stage === s.id;
          return (
            <React.Fragment key={s.id}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, minWidth: 68 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                  background: done ? '#1a3820' : active ? '#1a1500' : '#0d0d18',
                  border: `2px solid ${done ? '#2a6a40' : active ? T.text : T.bdr}`,
                  color: done ? '#40b068' : active ? T.text : T.bdr,
                  transition: 'all .3s', flexShrink: 0,
                }}>
                  {done ? '✓' : s.id}
                </div>
                <span style={{
                  fontSize: 8, color: done ? '#40b068' : active ? T.text : T.bdr,
                  fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em',
                  textTransform: 'uppercase', textAlign: 'center',
                  lineHeight: 1.25, maxWidth: 60,
                }}>
                  {s.label}
                </span>
              </div>
              {i < TIE_STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 1,
                  background: done ? '#2a6a40' : T.bdr,
                  minWidth: 6, transition: 'background .3s',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── Large spinner ──────────────────────────────────────────────────────────
  function BigSpinner({ label }: { label: string }) {
    return (
      <div style={{ textAlign: 'center', padding: '54px 24px' }}>
        <div style={{
          width: 32, height: 32, border: `2px solid ${T.bdr}`,
          borderTop: `2px solid ${T.text}`, borderRadius: '50%',
          margin: '0 auto 18px', animation: 'spin .9s linear infinite',
        }} />
        <p style={{ fontSize: 19, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
          {label}
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── Phase 1B — Served Process Analysis (Grand Build Plan)
  //
  // STANDING RULE: library queried FIRST against the process type and court
  // identified from the pre-entry context. Library results injected into the
  // SPA system prompt as verified sources. AI reasons from those sources and
  // flags any law needed but absent.
  //
  // Phase 1B analysis covers (per the Grand Build Plan):
  //   • Correct originating process type for this cause of action / court
  //   • Service validity under applicable Rules of Court
  //   • Jurisdiction — court has jurisdiction over matter and parties
  //   • Conditions precedent — pre-action compliance by the claimant
  //   • Limitation — did the claimant file in time? (defendant's perspective)
  //   • Preliminary objection grounds — ranked: FATAL_SUSTAINABLE / TACTICAL / WEAK
  //   • Claimant theory, claims, allegations, counterclaim hints, deadlines
  //
  // Result seeds rawFacts and is displayed as a persistent banner above Stage 1.
  // ─────────────────────────────────────────────────────────────────────────
  async function runServedProcessAnalysis() {
    if (processText.trim().length < 80) {
      setSpaError('Please paste more of the served process — at least 80 characters needed for meaningful analysis.');
      return;
    }
    setSpaLoading(true); setSpaError('');
    try {
      const spaRole = activeCase.counsel_role ?? 'defendant_side';
      const receivingRoleLabel =
        spaRole === 'respondent_side' ? 'Respondent (opposing the Petition)' :
        spaRole === 'frep_respondent' ? 'Respondent (opposing the Fundamental Rights Application)' :
        spaRole === 'defence'        ? 'Accused/Defendant (criminal matter)' :
        'Defendant';
      const opposingPartyLabel =
        spaRole === 'respondent_side' ? 'Petitioner' :
        spaRole === 'frep_respondent' ? 'Applicant' :
        spaRole === 'defence'        ? 'Prosecution' :
        'Claimant/Plaintiff';
      const strategyLabel =
        spaRole === 'respondent_side' ? 'Answer grounds and Cross-Petition viability' :
        spaRole === 'frep_respondent' ? 'grounds of opposition and any preliminary objection' :
        spaRole === 'defence'        ? 'defence grounds and any no-case submission basis' :
        'counterclaim opportunities and defence strategy';
      const track = activeCase.matter_track ?? 'civil';
      const court = activeCase.court ?? 'Not specified';

      // ── STANDING RULE: Library query FIRST ────────────────────────────────
      // Query against: process type (will be identified shortly), court, track.
      // We run a broad initial query on the process type + court since we don't
      // yet know the exact cause of action — a narrower query follows inside
      // the SPA prompt once the process type is identified.
      const raw = await withRetry(() => callClaude({
        system: `You are a Senior Advocate conducting a Phase 1B Served Process Analysis for the ${receivingRoleLabel} in a Nigerian ${track} matter before ${court}.

STANDING RULE — LIBRARY FIRST: Reason from Nigerian statutes, Rules of Court, and case law. For any proposition you state, identify the specific legal source. Where you apply a rule that was not in the library results injected into this prompt, flag it explicitly as "NOT IN LIBRARY — verify before filing" so counsel knows which rules need confirmation.

You must analyse the served process and return a comprehensive Phase 1B SPA covering ALL of the following areas. Return ONLY valid JSON — no preamble, no markdown fences:

{
  "process_type": "one of: Writ of Summons | Originating Summons | Originating Motion | FREP Originating Motion | Petition | Charge | Information | Other — identify precisely from the document",

  "process_type_analysis": {
    "correct": true,
    "finding": "Was this the correct originating process for this cause of action and court? Cite the specific rule that prescribes the correct process (e.g. Order 3 Rule 2 High Court (Civil Procedure) Rules).",
    "defect": "If incorrect: state what should have been used and why — or omit this field if correct"
  },

  "claimant_theory": "2–3 sentences: the ${opposingPartyLabel}'s legal theory — what legal right they assert, what relief they seek, and on what factual and legal basis",

  "claims_identified": ["each distinct claim or relief sought, as a separate string — be specific, include quantum where stated"],

  "factual_allegations": ["each key factual allegation made against the ${receivingRoleLabel}, as a separate string — be precise, include dates and amounts where stated"],

  "service_validity": {
    "status": "VALID or DEFECTIVE or UNCLEAR",
    "finding": "Senior Advocate prose: was the process validly served? Cite the applicable service rule (e.g. Order 7 HCCPR). Address: mode of service, person served, time of service if stated.",
    "defects": ["specific rule violation — e.g. 'Order 7 Rule 3 requires personal service on a natural person; service on secretary is only permitted if personal service is impracticable'"],
    "curable": true
  },

  "jurisdiction_analysis": {
    "status": "ESTABLISHED or ARGUABLE or DOUBTFUL",
    "finding": "Senior Advocate prose: does this court have subject-matter jurisdiction, monetary jurisdiction (if applicable), and territorial jurisdiction? Cite the Constitution, applicable statute, or court rules that vest or limit jurisdiction.",
    "objection_available": false,
    "objection_basis": "If objection available: the specific ground and authority — or omit if no objection"
  },

  "conditions_precedent": {
    "status": "SATISFIED or UNSATISFIED or UNCLEAR",
    "requirements": ["each applicable pre-action condition: statutory notice, demand letter, pre-action protocol, ADR certificate, ministerial consent, etc. — cite the specific provision that requires it"],
    "satisfied": ["which conditions are evidenced as satisfied in the process or attachments"],
    "unsatisfied": ["which conditions are absent or unclear — state why it matters and cite the authority that makes it a condition precedent"],
    "fatal": false,
    "finding": "Senior Advocate prose: overall conditions precedent assessment"
  },

  "limitation_analysis": {
    "status": "IN_TIME or EXPIRED or UNCLEAR",
    "applicable_period": "Specific limitation period + statute (e.g. '6 years — Limitation Law Cap 522 LFN 2004 s.8(1)(a)')",
    "trigger_event": "When time began to run — be specific: date of accrual of cause of action if identifiable",
    "expiry_date": "ISO date string if calculable, or descriptive string — e.g. 'Cannot determine without accrual date'",
    "finding": "Senior Advocate prose: limitation analysis from the defendant's perspective — is a limitation defence arguable?",
    "defence_available": false
  },

  "preliminary_objection_grounds": [
    {
      "ground": "One-line statement of the PO ground",
      "basis": "Specific statute, constitutional provision, or rule — e.g. 'Section 4 High Court Law; Order 3 Rule 2 HCCPR'",
      "rank": "FATAL_SUSTAINABLE or TACTICAL or WEAK",
      "risk": "Any tactical double-edge risk from raising this PO — or omit if none"
    }
  ],

  "counterclaim_hints": ["any facts suggesting ${strategyLabel} — state the basis briefly; empty array if none"],

  "procedural_deadlines": ["any deadlines stated or implied: e.g. 'Enter appearance within 8 days of service (Order 10 Rule 1 HCCPR)', '30 days to file defence (Order 23 Rule 2)'"],

  "spa_verdict": "CLEAN or DEFECTS or FATAL",

  "summary": "one sentence for Case Command: what this matter is, who is the opposing party, and the headline SPA finding"
}

Rules:
- spa_verdict CLEAN = no significant defects in service, jurisdiction, or conditions precedent
- spa_verdict DEFECTS = one or more defects identified (curable or non-fatal)
- spa_verdict FATAL = at least one fatal PO ground: wrong court, expired limitation, fatal conditions precedent failure
- preliminary_objection_grounds: rank FATAL_SUSTAINABLE = raises a jurisdictional/fatal bar; TACTICAL = good but double-edged; WEAK = arguable but unlikely to succeed
- Every string value must be properly JSON-escaped. No unescaped double quotes inside JSON strings.
- Output ONLY the JSON object. Nothing before it, nothing after it.`,
        userMsg: `SERVED PROCESS:\n\n${processText}\n\nCASE: ${activeCase.caseName}\nCOURT: ${court}\nTRACK: ${track}\nCOUNSEL ROLE: ${spaRole}\n${partyAPlural}: ${activeCase.claimants.map(c => c.name).filter(Boolean).join(', ') || 'Not yet named'}\n${partyBPlural}: ${activeCase.defendants.map(d => d.name).filter(Boolean).join(', ') || 'Not yet named'}`,
        maxTokens: 4000,
        skipLibrary: true,
      }));

      let parsed: Omit<NonNullable<IntelligenceData['served_process_analysis']>, 'run_at' | 'process_text'>;
      try {
        const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const start = clean.indexOf('{');
        const end   = clean.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('No JSON object found');
        parsed = JSON.parse(clean.slice(start, end + 1));
      } catch {
        throw new Error('Analysis returned unexpected format — please try again.');
      }

      const spa: NonNullable<IntelligenceData['served_process_analysis']> = {
        run_at:              new Date().toISOString(),
        process_text:        processText,
        process_type:        parsed.process_type ?? 'Unknown',
        claimant_theory:     parsed.claimant_theory ?? '',
        claims_identified:   parsed.claims_identified ?? [],
        factual_allegations: parsed.factual_allegations ?? [],
        counterclaim_hints:  parsed.counterclaim_hints ?? [],
        procedural_deadlines: parsed.procedural_deadlines ?? [],
        summary:             parsed.summary ?? '',
        // ── Phase 1B fields ──────────────────────────────────────────────
        process_type_analysis:        parsed.process_type_analysis,
        service_validity:             parsed.service_validity,
        jurisdiction_analysis:        parsed.jurisdiction_analysis,
        conditions_precedent:         parsed.conditions_precedent,
        limitation_analysis:          parsed.limitation_analysis,
        preliminary_objection_grounds: parsed.preliminary_objection_grounds ?? [],
        spa_verdict:                  parsed.spa_verdict ?? 'CLEAN',
      };

      setSpaResult(spa);

      // Seed rawFacts with the process text so Stage 1 has a starting point
      const seededFacts = `[SERVED PROCESS — pasted by counsel]\n\n${processText}`;
      setRawFacts(seededFacts);

      advance(0.5, { served_process_analysis: spa, rawFacts: seededFacts });

      // Phase 4B — Defence Audit fires automatically after SPA (non-blocking).
      // Grounded in the SPA's service/jurisdiction/conditions precedent findings.
      // Saves to intelligence_data.commencement_audit (reuses same field — label
      // changes in the UI to "Defence Audit" for receiving-side pipeline).
      runDefenceAuditFromSPA(spa);

    } catch (e: unknown) {
      setSpaError(e instanceof Error ? e.message : 'Analysis failed — please try again.');
    } finally {
      setSpaLoading(false);
    }
  }

  // ── Phase 4B — Defence Audit seeded from SPA (runs non-blocking after Stage 0.5) ──
  //
  // When we are on the receiving side and the SPA has just run, we immediately
  // fire a Defence Audit grounded in the SPA's findings. This is Phase 4B of
  // the Grand Build Plan — adversarially calibrated:
  //   • Limitation: did the claimant file in time?
  //   • Conditions precedent: did they comply?
  //   • Service: is service valid or defective?
  //   • Jurisdiction: does this court have jurisdiction?
  //   • Originating process: was the correct process used?
  // Output ranks preliminary objection grounds: FATAL_SUSTAINABLE / TACTICAL / WEAK.
  // Saved to intelligence_data.commencement_audit so it flows to CaseCommand.
  async function runDefenceAuditFromSPA(spa: NonNullable<IntelligenceData['served_process_analysis']>) {
    setAuditLoading(true); setAuditError('');
    const track     = activeCase.matter_track ?? 'civil';
    const spaRole   = activeCase.counsel_role ?? 'defendant_side';
    const roleLabel =
      spaRole === 'respondent_side' ? 'respondent' :
      spaRole === 'frep_respondent' ? 'respondent (FREP)' :
      spaRole === 'defence'        ? 'defence (criminal)' :
      'defendant';
    const opposingLabel =
      spaRole === 'respondent_side' ? 'Petitioner' :
      spaRole === 'frep_respondent' ? 'Applicant' :
      spaRole === 'defence'        ? 'Prosecution' :
      'Claimant';

    // Summarise what the SPA already found so the audit can refine rather than repeat
    const spaContext = [
      spa.process_type_analysis
        ? `Process type: ${spa.process_type} — ${spa.process_type_analysis.correct ? 'CORRECT' : 'DEFECTIVE: ' + (spa.process_type_analysis.defect ?? '')}`
        : `Process type: ${spa.process_type}`,
      spa.service_validity
        ? `Service validity: ${spa.service_validity.status} — ${spa.service_validity.finding}`
        : '',
      spa.jurisdiction_analysis
        ? `Jurisdiction: ${spa.jurisdiction_analysis.status} — ${spa.jurisdiction_analysis.finding}`
        : '',
      spa.conditions_precedent
        ? `Conditions precedent: ${spa.conditions_precedent.status} — ${spa.conditions_precedent.finding}`
        : '',
      spa.limitation_analysis
        ? `Limitation (claimant's compliance): ${spa.limitation_analysis.status} — ${spa.limitation_analysis.finding}`
        : '',
      (spa.preliminary_objection_grounds ?? []).length > 0
        ? `PO grounds already identified: ${(spa.preliminary_objection_grounds ?? []).map(g => `${g.rank}: ${g.ground}`).join('; ')}`
        : '',
    ].filter(Boolean).join('\n');

    const system = `You are a Nigerian litigation defence counsel conducting an adversarial procedural audit for the ${roleLabel}. Your mandate is to identify every weakness in the ${opposingLabel}'s filing — not to advise the ${opposingLabel}.

You have been given the Served Process Analysis (Phase 1B) as a starting point. Your task is to deepen and confirm that analysis, applying the specific Nigerian Rules of Court for ${activeCase.court || 'the relevant court'} and the applicable substantive limitation statute.

Return ONLY valid JSON — no markdown fences, no preamble.`;

    const prompt = `DEFENCE AUDIT (Phase 4B) — Adversarial calibration

CASE: ${activeCase.caseName || 'Untitled'}
COURT: ${activeCase.court || 'Not specified'}
TRACK: ${track} | COUNSEL ROLE: ${roleLabel}
${partyAPlural}: ${activeCase.claimants.map(c => c.name).filter(Boolean).join(', ') || 'Not specified'}
${partyBPlural}: ${activeCase.defendants.map(d => d.name).filter(Boolean).join(', ') || 'Not specified'}

SPA PRE-ANALYSIS (already run — confirm, refine, or supplement):
${spaContext}

SERVED PROCESS (first 2000 chars for reference):
${spa.process_text.slice(0, 2000)}

Return EXACTLY this JSON and nothing else:
{
  "findings": "Detailed Senior Advocate prose covering:\\n## PRELIMINARY OBJECTION GROUNDS\\n[Each PO ground: state it, the specific rule/statute, rank it FATAL_SUSTAINABLE / TACTICAL / WEAK, note any tactical risk in raising it]\\n## LIMITATION DEFENCE\\n[Claimant's limitation compliance — did they file in time? What limitation period applies and under which statute? Is a limitation defence available to the ${roleLabel}?]\\n## SERVICE DEFECTS\\n[Any service invalidity — specific rule violated, whether curable, tactical implications of raising it]\\n## JURISDICTIONAL OBJECTIONS\\n[Any jurisdiction challenge — subject matter, monetary, constitutional, territorial]\\n## CONDITIONS PRECEDENT FAILURES\\n[Any pre-action condition the ${opposingLabel} failed to satisfy — is it a condition precedent to jurisdiction or merely directory?]\\n## PROCESS TYPE\\n[Was the correct originating process used? If wrong process: ground for striking out or setting aside]\\n## STRATEGIC ASSESSMENT\\n[Which grounds to raise in what order; which to waive for tactical reasons; submission sequence]",
  "limitation_expiry": "ISO date if claimant's limitation period can be calculated, or plain text, or null",
  "service_valid": true or false or null,
  "status": "CLEAR or RISK or DEFECTIVE",
  "summary": "One sentence for Case Command — e.g. 'Two fatal PO grounds: wrong originating process and expired limitation. Strong defence posture.'"
}

Rules:
- status DEFECTIVE = at least one fatal ground: wrong court, expired limitation, fatal pre-action failure
- status RISK = defects present but curable or non-fatal
- status CLEAR = no material procedural weakness found
- Be adversarially precise: name every specific rule or statute. This is the defendant's audit, not the claimant's.
- Never use unescaped double quotes inside JSON string values`;

    try {
      const raw = await withRetry(() => callClaude({
        system,
        userMsg: prompt,
        maxTokens: 3000,
        skipLibrary: true,
      }));

      let cleaned = raw.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON in defence audit response');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: Omit<CommencementAuditResult, 'run_at'>;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
          .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const result: CommencementAuditResult = {
        run_at:            new Date().toISOString(),
        findings:          parsed.findings   ?? '',
        limitation_expiry: parsed.limitation_expiry ?? undefined,
        service_valid:     typeof parsed.service_valid === 'boolean' ? parsed.service_valid : undefined,
        status:            (['CLEAR','RISK','DEFECTIVE'] as const).includes(parsed.status as 'CLEAR'|'RISK'|'DEFECTIVE')
                             ? parsed.status as 'CLEAR'|'RISK'|'DEFECTIVE'
                             : 'RISK',
        summary:           parsed.summary ?? '',
      };

      setCommencementAudit(result);
      // Persist immediately using the latest state
      onSave({
        stage, rawFacts, extraction: null, followUpQs: [], followUpAs: {}, evidenceM: null, intPkg: '',
        commencement_audit: result,
        served_process_analysis: spa,
      });
    } catch (e) {
      setAuditError('Defence Audit failed: ' + ((e as Error).message || 'Please try again.'));
    } finally {
      setAuditLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 0 — Entry Path Selector (Phase 2A) — Defendant side only
  // ─────────────────────────────────────────────────────────────────────────
  function Stage0() {
    const A = partyA;
    const B = partyB;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Intelligence Engine · Entry
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 8 }}>
            How are we coming into this matter?
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            Acting for <strong style={{ color: T.text }}>{B}</strong> — choose the entry path that matches how the matter reached us.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Path A — Served Process */}
          <button
            onClick={() => advance(0.5)}
            style={{
              background: '#0a0a18', border: '1px solid #2a2a48',
              borderRadius: 10, padding: '22px 24px',
              textAlign: 'left', cursor: 'pointer',
              transition: 'border-color .15s, background .15s',
              display: 'flex', alignItems: 'flex-start', gap: 18,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#5050a0'; (e.currentTarget as HTMLButtonElement).style.background = '#0d0d22'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a48'; (e.currentTarget as HTMLButtonElement).style.background = '#0a0a18'; }}
          >
            <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>📨</span>
            <div>
              <p style={{ fontSize: 15, color: '#c8c8e8', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, marginBottom: 5 }}>
                We Were Served
              </p>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>
                A writ, originating summons, petition, or other process was served on {B}.
                Upload or paste the originating process — the engine will analyse the claim,
                extract the {A}'s theory, and {(() => {
                  const r = activeCase.counsel_role;
                  if (r === 'respondent_side') return "identify Answer/Cross-Petition strategy.";
                  if (r === 'frep_respondent') return "map your constitutional opposition.";
                  return "identify counterclaim opportunities.";
                })()}
              </p>
              <p style={{ fontSize: 10, color: '#5050a0', fontFamily: "'Times New Roman', Times, serif", marginTop: 8, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
                {(() => {
                  const r = activeCase.counsel_role;
                  if (r === 'respondent_side') return 'Served Process Intake → Theory Extraction → Answer Strategy';
                  if (r === 'frep_respondent') return 'Served Process Intake → Theory Extraction → Opposition Map';
                  return 'Served Process Intake → Theory Extraction → Counterclaim Scan';
                })()}
              </p>
            </div>
          </button>

          {/* Path B — Raw Facts (claimant-style) */}
          <button
            onClick={() => advance(1)}
            style={{
              background: '#0a0a18', border: '1px solid #1e2a1e',
              borderRadius: 10, padding: '22px 24px',
              textAlign: 'left', cursor: 'pointer',
              transition: 'border-color .15s, background .15s',
              display: 'flex', alignItems: 'flex-start', gap: 18,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a5a3a'; (e.currentTarget as HTMLButtonElement).style.background = '#0d0d18'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#1e2a1e'; (e.currentTarget as HTMLButtonElement).style.background = '#0a0a18'; }}
          >
            <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>📋</span>
            <div>
              <p style={{ fontSize: 15, color: '#c8e8c8', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, marginBottom: 5 }}>
                Enter Raw Facts
              </p>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>
                We have the client's account of events but no served process yet — or we prefer to build
                the defence picture from our own instructions first. Proceed with the standard 5-step intelligence pipeline.
              </p>
              <p style={{ fontSize: 10, color: '#3a5a3a', fontFamily: "'Times New Roman', Times, serif", marginTop: 8, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
                Raw Facts → Extraction → Follow-Up → Evidence Map → Package
              </p>
            </div>
          </button>

        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 0.5 — Served Process Intake (Phase 1B)
  // ─────────────────────────────────────────────────────────────────────────
  function Stage0_5() {
    const spa = spaResult;
    const A = partyA;
    const B = partyB;

    // SPA verdict badge config
    const verdictCfg: Record<string, { bg: string; bdr: string; col: string; icon: string }> = {
      CLEAN:   { bg: '#071810', bdr: '#1a4028', col: '#40b068', icon: '✓' },
      DEFECTS: { bg: '#1a1000', bdr: '#3a2800', col: '#c08030', icon: '⚠' },
      FATAL:   { bg: '#1a0808', bdr: '#401818', col: '#c05050', icon: '✗' },
    };

    // PO rank config
    const rankCfg: Record<string, { bg: string; bdr: string; col: string }> = {
      FATAL_SUSTAINABLE: { bg: '#1a0808', bdr: '#401818', col: '#c05050' },
      TACTICAL:          { bg: '#1a1000', bdr: '#3a2800', col: '#c08030' },
      WEAK:              { bg: '#0d0d18', bdr: '#1e1e30', col: '#6060a0' },
    };

    // Status badge config (service, jurisdiction, etc.)
    const statusCfg: Record<string, { col: string }> = {
      VALID:       { col: '#40b068' },
      ESTABLISHED: { col: '#40b068' },
      SATISFIED:   { col: '#40b068' },
      IN_TIME:     { col: '#40b068' },
      CLEAN:       { col: '#40b068' },
      DEFECTIVE:   { col: '#c05050' },
      DOUBTFUL:    { col: '#c05050' },
      UNSATISFIED: { col: '#c05050' },
      EXPIRED:     { col: '#c05050' },
      ARGUABLE:    { col: '#c08030' },
      UNCLEAR:     { col: '#c08030' },
    };

    // If analysis already done — show full Phase 1B results + proceed options
    if (spa) {
      const vc = verdictCfg[spa.spa_verdict ?? 'CLEAN'] ?? verdictCfg.CLEAN;
      const poGrounds = spa.preliminary_objection_grounds ?? [];
      const fatalPOs  = poGrounds.filter(g => g.rank === 'FATAL_SUSTAINABLE');
      const tactPOs   = poGrounds.filter(g => g.rank === 'TACTICAL');
      const weakPOs   = poGrounds.filter(g => g.rank === 'WEAK');

      return (
        <div style={{ animation: 'fadeUp .3s ease' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                Phase 1B · Served Process Analysis · Complete
              </p>
              <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>
                {spa.process_type}
              </h2>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                {spa.summary}
              </p>
            </div>
            {/* SPA Verdict badge */}
            <div style={{ background: vc.bg, border: `1px solid ${vc.bdr}`, borderRadius: 6, padding: '10px 16px', textAlign: 'center', flexShrink: 0 }}>
              <p style={{ fontSize: 8, color: vc.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                SPA Verdict
              </p>
              <p style={{ fontSize: 18, color: vc.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
                {vc.icon} {spa.spa_verdict ?? 'CLEAN'}
              </p>
            </div>
          </div>

          {/* ── SECTION A: Claimant Theory + Claims ─────────────────────────── */}
          <div style={{ background: '#0a0a18', border: '1px solid #1a1a30', borderRadius: 10, padding: '20px 22px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: '#8080c0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
              A · {A}'s Theory &amp; Claims
            </p>

            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 9, color: '#6060a0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                Legal Theory
              </p>
              <p style={{ fontSize: 13, color: '#c8c8e8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
                {spa.claimant_theory}
              </p>
            </div>

            {spa.claims_identified.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 9, color: '#6060a0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  Claims / Reliefs Sought
                </p>
                {spa.claims_identified.map((c, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #2a2a48', marginBottom: 5 }}>
                    {c}
                  </div>
                ))}
              </div>
            )}

            {spa.factual_allegations.length > 0 && (
              <div>
                <p style={{ fontSize: 9, color: '#c08040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  Allegations Against {B}
                </p>
                {spa.factual_allegations.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #3a2808', marginBottom: 5 }}>
                    {a}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── SECTION B: Procedural Analysis (Phase 1B) ──────────────────── */}
          <div style={{ background: '#0a0a14', border: '1px solid #181828', borderRadius: 10, padding: '20px 22px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: '#8080b0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 16 }}>
              B · Procedural Analysis — Phase 1B
            </p>

            {/* 2x2 status grid: Process Type / Service / Jurisdiction / Conditions Precedent */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>

              {/* Process Type */}
              {spa.process_type_analysis && (() => {
                const pta = spa.process_type_analysis;
                const col = pta.correct ? '#40b068' : '#c05050';
                return (
                  <div style={{ background: pta.correct ? '#071810' : '#1a0808', border: `1px solid ${pta.correct ? '#1a4028' : '#401818'}`, borderRadius: 7, padding: '12px 14px' }}>
                    <p style={{ fontSize: 8, color: col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                      {pta.correct ? '✓ Correct Process' : '✗ Wrong Process'}
                    </p>
                    <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                      {pta.finding}
                    </p>
                    {!pta.correct && pta.defect && (
                      <p style={{ fontSize: 11, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, marginTop: 6, fontStyle: 'italic' }}>
                        {pta.defect}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Service Validity */}
              {spa.service_validity && (() => {
                const sv = spa.service_validity;
                const sc = statusCfg[sv.status] ?? { col: '#6060a0' };
                return (
                  <div style={{ background: '#0a0a14', border: '1px solid #181828', borderRadius: 7, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <p style={{ fontSize: 8, color: '#5a5a78', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                        Service Validity
                      </p>
                      <span style={{ fontSize: 8, color: sc.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.08em' }}>
                        {sv.status}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                      {sv.finding}
                    </p>
                    {(sv.defects ?? []).length > 0 && (
                      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                        {(sv.defects ?? []).map((d, i) => (
                          <li key={i} style={{ fontSize: 11, color: '#c07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, paddingLeft: 10, position: 'relative', marginBottom: 3 }}>
                            <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 3 }}>!</span>{d}
                          </li>
                        ))}
                      </ul>
                    )}
                    {sv.curable !== undefined && sv.status === 'DEFECTIVE' && (
                      <p style={{ fontSize: 10, color: sv.curable ? '#60a080' : '#c05050', fontFamily: "'Times New Roman', Times, serif", marginTop: 6, letterSpacing: '.06em' }}>
                        {sv.curable ? 'Curable defect' : 'Non-curable — fatal to service'}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Jurisdiction */}
              {spa.jurisdiction_analysis && (() => {
                const ja = spa.jurisdiction_analysis;
                const jc = statusCfg[ja.status] ?? { col: '#6060a0' };
                return (
                  <div style={{ background: '#0a0a14', border: '1px solid #181828', borderRadius: 7, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <p style={{ fontSize: 8, color: '#5a5a78', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                        Jurisdiction
                      </p>
                      <span style={{ fontSize: 8, color: jc.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.08em' }}>
                        {ja.status}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                      {ja.finding}
                    </p>
                    {ja.objection_available && ja.objection_basis && (
                      <p style={{ fontSize: 11, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, marginTop: 6, borderTop: '1px solid #2a2808', paddingTop: 6 }}>
                        PO Available: {ja.objection_basis}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Conditions Precedent */}
              {spa.conditions_precedent && (() => {
                const cp = spa.conditions_precedent;
                const cc = statusCfg[cp.status] ?? { col: '#6060a0' };
                return (
                  <div style={{ background: cp.fatal ? '#1a0808' : '#0a0a14', border: `1px solid ${cp.fatal ? '#401818' : '#181828'}`, borderRadius: 7, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <p style={{ fontSize: 8, color: '#5a5a78', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                        Conditions Precedent
                      </p>
                      <span style={{ fontSize: 8, color: cc.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.08em' }}>
                        {cp.status}{cp.fatal ? ' · FATAL' : ''}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: cp.unsatisfied.length > 0 ? 6 : 0 }}>
                      {cp.finding}
                    </p>
                    {cp.unsatisfied.length > 0 && (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {cp.unsatisfied.map((u, i) => (
                          <li key={i} style={{ fontSize: 11, color: '#c07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, paddingLeft: 10, position: 'relative', marginBottom: 3 }}>
                            <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 3 }}>!</span>{u}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Limitation Analysis */}
            {spa.limitation_analysis && (() => {
              const la = spa.limitation_analysis;
              const lc = statusCfg[la.status] ?? { col: '#6060a0' };
              return (
                <div style={{ background: la.defence_available ? '#071810' : '#0a0a14', border: `1px solid ${la.defence_available ? '#1a4028' : '#181828'}`, borderRadius: 7, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <p style={{ fontSize: 8, color: '#5a5a78', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                      Limitation Period — {A}'s Compliance
                    </p>
                    <span style={{ fontSize: 8, color: lc.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.08em' }}>
                      {la.status}
                    </span>
                    {la.defence_available && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.08em', background: '#071810', border: '1px solid #1a4028', padding: '2px 8px', borderRadius: 2 }}>
                        LIMITATION DEFENCE AVAILABLE
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Period</p>
                      <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{la.applicable_period}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Trigger</p>
                      <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{la.trigger_event}</p>
                    </div>
                    {la.expiry_date && (
                      <div>
                        <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Expiry</p>
                        <p style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{la.expiry_date}</p>
                      </div>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: la.defence_available ? '#60c088' : T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, fontStyle: 'italic' }}>
                    {la.finding}
                  </p>
                </div>
              );
            })()}
          </div>

          {/* ── SECTION C: Preliminary Objection Grounds ─────────────────────── */}
          {poGrounds.length > 0 && (
            <div style={{ background: '#0a0808', border: '1px solid #2a1818', borderRadius: 10, padding: '20px 22px', marginBottom: 12 }}>
              <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
                C · Preliminary Objection Grounds ({poGrounds.length})
                {fatalPOs.length > 0 && <span style={{ marginLeft: 10, background: '#1a0808', border: '1px solid #401818', color: '#c05050', fontSize: 8, padding: '2px 8px', borderRadius: 2, fontWeight: 700, letterSpacing: '.1em' }}>
                  {fatalPOs.length} FATAL
                </span>}
              </p>

              {/* Fatal sustainable */}
              {fatalPOs.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 8, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
                    Fatal &amp; Sustainable
                  </p>
                  {fatalPOs.map((g, i) => {
                    const rc = rankCfg[g.rank];
                    return (
                      <div key={i} style={{ background: rc.bg, border: `1px solid ${rc.bdr}`, borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
                        <p style={{ fontSize: 13, color: '#e0b0b0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 4 }}>{g.ground}</p>
                        <p style={{ fontSize: 11, color: '#9a7070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, fontStyle: 'italic' }}>Authority: {g.basis}</p>
                        {g.risk && (
                          <p style={{ fontSize: 11, color: '#806050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, marginTop: 4 }}>Tactical risk: {g.risk}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tactical */}
              {tactPOs.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 8, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
                    Sustainable but Tactically Double-Edged
                  </p>
                  {tactPOs.map((g, i) => {
                    const rc = rankCfg[g.rank];
                    return (
                      <div key={i} style={{ background: rc.bg, border: `1px solid ${rc.bdr}`, borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
                        <p style={{ fontSize: 13, color: '#e0c880', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 4 }}>{g.ground}</p>
                        <p style={{ fontSize: 11, color: '#8a7840', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, fontStyle: 'italic' }}>Authority: {g.basis}</p>
                        {g.risk && (
                          <p style={{ fontSize: 11, color: '#806050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, marginTop: 4 }}>Tactical risk: {g.risk}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Weak */}
              {weakPOs.length > 0 && (
                <div>
                  <p style={{ fontSize: 8, color: '#6060a0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
                    Arguable but Weak
                  </p>
                  {weakPOs.map((g, i) => {
                    const rc = rankCfg[g.rank];
                    return (
                      <div key={i} style={{ background: rc.bg, border: `1px solid ${rc.bdr}`, borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
                        <p style={{ fontSize: 12, color: '#9090b8', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 4 }}>{g.ground}</p>
                        <p style={{ fontSize: 11, color: '#505070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, fontStyle: 'italic' }}>Authority: {g.basis}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── SECTION D: Counterclaim Hints + Deadlines ───────────────────── */}
          {(spa.counterclaim_hints.length > 0 || spa.procedural_deadlines.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: spa.counterclaim_hints.length > 0 && spa.procedural_deadlines.length > 0 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
              {spa.counterclaim_hints.length > 0 && (
                <div style={{ background: '#071810', border: '1px solid #1a3020', borderRadius: 8, padding: '14px 16px' }}>
                  <p style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
                    {activeCase.counsel_role === 'respondent_side' ? 'Cross-Petition Opportunities' : 'Counterclaim Opportunities'}
                  </p>
                  {spa.counterclaim_hints.map((h, i) => (
                    <div key={i} style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #183028', marginBottom: 5 }}>
                      {h}
                    </div>
                  ))}
                </div>
              )}
              {spa.procedural_deadlines.length > 0 && (
                <div style={{ background: '#1a0808', border: '1px solid #401818', borderRadius: 8, padding: '14px 16px' }}>
                  <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
                    Procedural Deadlines ⚠
                  </p>
                  {spa.procedural_deadlines.map((d, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#c07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #401818', marginBottom: 5 }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Defence Audit loading (Phase 4B fires automatically) */}
          {(auditLoading || commencementAudit) && (
            <div style={{ background: '#0a0a14', border: `1px solid ${commencementAudit ? (commencementAudit.status === 'DEFECTIVE' ? '#401818' : commencementAudit.status === 'RISK' ? '#3a2800' : '#1a4028') : '#181828'}`, borderRadius: 8, padding: '14px 18px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: commencementAudit ? 8 : 0 }}>
                <p style={{ fontSize: 9, color: '#6a6a8a', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, flex: 1 }}>
                  Phase 4B · Defence Audit
                </p>
                {auditLoading && (
                  <><Spinner size={11} />
                    <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                      Running adversarial procedural audit…
                    </span>
                  </>
                )}
                {!auditLoading && commencementAudit && (
                  <span style={{ fontSize: 8, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.12em', padding: '2px 8px', borderRadius: 2, background: commencementAudit.status === 'DEFECTIVE' ? '#1a0808' : commencementAudit.status === 'RISK' ? '#1a1000' : '#071810', border: `1px solid ${commencementAudit.status === 'DEFECTIVE' ? '#401818' : commencementAudit.status === 'RISK' ? '#3a2800' : '#1a4028'}`, color: commencementAudit.status === 'DEFECTIVE' ? '#c05050' : commencementAudit.status === 'RISK' ? '#c08030' : '#40b068' }}>
                    {commencementAudit.status === 'DEFECTIVE' ? '✗' : commencementAudit.status === 'RISK' ? '⚠' : '✓'} {commencementAudit.status}
                  </span>
                )}
              </div>
              {!auditLoading && commencementAudit && (
                <>
                  <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 8 }}>
                    {commencementAudit.summary}
                  </p>
                  <details style={{ cursor: 'pointer' }}>
                    <summary style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', userSelect: 'none', outline: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>▸</span> View full defence audit
                    </summary>
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #131320' }}>
                      <Md text={commencementAudit.findings} />
                    </div>
                  </details>
                </>
              )}
              {auditError && !auditLoading && (
                <p style={{ fontSize: 12, color: '#804040', fontFamily: "'Times New Roman', Times, serif" }}>{auditError}</p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => advance(1)}
              style={{
                flex: 1, background: 'linear-gradient(135deg,#1a1a40,#3030a0)',
                color: '#c8c8f8', border: 'none', borderRadius: 6,
                padding: '13px', fontSize: 15,
                fontFamily: "'Times New Roman', Times, serif",
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              Continue → Add Client Instructions &amp; Extract Intelligence
            </button>
            <button
              onClick={() => { setSpaResult(undefined); setProcessText(''); setCommencementAudit(undefined); setAuditError(''); }}
              style={{
                background: 'transparent', border: '1px solid #2a2a48',
                color: T.mute, borderRadius: 6, padding: '13px 18px',
                fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              }}
            >
              Re-analyse
            </button>
          </div>
        </div>
      );
    }

    // No analysis yet — paste intake form
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Phase 1B · Served Process Intake
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
            Paste the Served Process
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            Paste the full text of the writ, originating summons, petition, or charge as served on {B}.
            The engine will extract {A}'s theory, analyse service validity, jurisdiction, conditions precedent, limitation, and rank every preliminary objection ground.
          </p>
        </div>

        <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #131320', flexWrap: 'wrap' }}>
            <RoleBadge role={role} />
            <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              {activeCase.caseName}
            </span>
            {activeCase.court && (
              <span style={{ fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif" }}>· {activeCase.court}</span>
            )}
          </div>

          {/* What the engine will analyse */}
          <div style={{ background: '#080810', border: '1px solid #141424', borderRadius: 6, padding: '10px 14px', marginBottom: 14 }}>
            <p style={{ fontSize: 9, color: '#5050a0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
              Phase 1B Analysis Will Cover
            </p>
            {[
              '✓ Correct originating process type for this court and cause of action',
              '✓ Service validity — mode, person, and timing',
              '✓ Jurisdiction — subject matter, monetary, territorial',
              '✓ Conditions precedent — pre-action notice, demand, protocol, ADR certificate',
              '✓ Limitation — did the claimant file in time? Defence available?',
              '✓ Preliminary objection grounds — ranked: Fatal / Tactical / Weak',
              '✓ Claimant\'s theory, claims, allegations, counterclaim opportunities',
            ].map((item, i) => (
              <p key={i} style={{ fontSize: 11, color: '#5050a0', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 2 }}>
                {item}
              </p>
            ))}
          </div>

          <label style={lbS}>
            Originating Process Text <span style={{ color: '#b06060' }}>*</span>
          </label>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.65 }}>
            Paste the full document — writ endorsement, statement of claim, grounds of petition, or charge sheet. The more text, the sharper the analysis.
          </p>
          <textarea
            value={processText}
            onChange={e => setProcessText(e.target.value)}
            rows={13}
            placeholder={
              'Paste the served process here:\n\n• Writ of Summons — include the endorsement and any annexed statement of claim\n• Originating Summons — include all questions and the supporting affidavit if attached\n• Petition — include all grounds\n• Originating Motion / FREP Originating Motion — include the motion paper and all grounds\n• Charge Sheet — include the charges and particulars\n\nThe more complete the text, the sharper the Phase 1B analysis.'
            }
            style={{ ...iS, resize: 'vertical', lineHeight: 1.85, minHeight: 300, fontSize: 15 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: processText.length < 80 ? '#804040' : T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {processText.length} characters{processText.length < 80 ? ' · minimum 80' : ''}
            </span>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
              More text = sharper Phase 1B analysis
            </span>
          </div>
        </div>

        {spaError && <div style={{ background: '#1a0808', border: '1px solid #401818', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif" }}>{spaError}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={runServedProcessAnalysis}
            disabled={spaLoading || processText.trim().length < 80}
            style={{
              flex: 1,
              background: spaLoading || processText.trim().length < 80
                ? '#101018'
                : 'linear-gradient(135deg,#000000,#302080)',
              color: spaLoading || processText.trim().length < 80 ? '#2a2a38' : '#c8c8f8',
              border: 'none', borderRadius: 6, padding: '14px',
              fontSize: 17, fontFamily: "'Times New Roman', Times, serif",
              cursor: spaLoading || processText.trim().length < 80 ? 'not-allowed' : 'pointer',
              fontWeight: 600, letterSpacing: '.04em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            {spaLoading ? (
              <><Spinner size={14} /> Running Phase 1B Analysis…</>
            ) : (
              'Run Phase 1B Served Process Analysis →'
            )}
          </button>
          <button
            onClick={() => setStage(0)}
            style={{
              background: 'transparent', border: '1px solid #2a2a48',
              color: T.mute, borderRadius: 6, padding: '14px 18px',
              fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // STAGE 1 — Raw Facts
  // ─────────────────────────────────────────────────────────────────────────
  function Stage1() {
    const isDefendantWithSPA = isReceivingSide && !!spaResult;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 1 of 5 · {isDefendantWithSPA ? 'Client Instructions' : 'Raw Facts'}
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
            {isDefendantWithSPA ? `${partyB}'s Account & Instructions` : 'Enter the Complete Case Narrative'}
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            {isDefendantWithSPA
              ? `The ${partyA}'s theory is already loaded from the served process. Now enter your client's full account — their version of events, what they dispute, what they admit, and any instructions on a counterclaim. The engine will clash both accounts to extract the defence theory.`
              : 'Do not filter or organise — give the raw client story. Include dates, parties, conversations, documents, and events in any order. The AI will extract the structure.'
            }
          </p>
        </div>

        {/* Phase 2D — Theory context banner for defendant SPA path */}
        {isDefendantWithSPA && spaResult && (() => {
          const spa = spaResult;
          const poGrounds = spa.preliminary_objection_grounds ?? [];
          const fatalCount = poGrounds.filter(g => g.rank === 'FATAL_SUSTAINABLE').length;
          const verdictCfg: Record<string, { bg: string; bdr: string; col: string; icon: string }> = {
            CLEAN:   { bg: '#07100a', bdr: '#1a3020', col: '#40b068', icon: '✓' },
            DEFECTS: { bg: '#100e00', bdr: '#2a2000', col: '#c08030', icon: '⚠' },
            FATAL:   { bg: '#100808', bdr: '#2a1818', col: '#c05050', icon: '✗' },
          };
          const vc = verdictCfg[spa.spa_verdict ?? 'CLEAN'];

          return (
            <div style={{ background: vc.bg, border: `1px solid ${vc.bdr}`, borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <p style={{ fontSize: 9, color: vc.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
                  Phase 1B SPA Loaded · {partyA} Theory Active
                </p>
                <span style={{ marginLeft: 'auto', fontSize: 8, color: vc.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', background: vc.bg, border: `1px solid ${vc.bdr}`, padding: '2px 8px', borderRadius: 2 }}>
                  {vc.icon} {spa.spa_verdict ?? 'CLEAN'}
                </span>
                {fatalCount > 0 && (
                  <span style={{ fontSize: 8, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em', background: '#1a0808', border: '1px solid #401818', padding: '2px 8px', borderRadius: 2 }}>
                    {fatalCount} FATAL PO
                  </span>
                )}
              </div>

              {/* Claimant theory */}
              <p style={{ fontSize: 12, color: '#a0c8a8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 10 }}>
                {spa.claimant_theory}
              </p>

              {/* Mini status row: Service / Jurisdiction / Conditions / Limitation */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: spaResult.counterclaim_hints.length > 0 ? 10 : 0 }}>
                {spa.service_validity && (
                  <div style={{ background: '#0a0a12', border: '1px solid #1a1a28', borderRadius: 4, padding: '5px 10px' }}>
                    <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Service</p>
                    <p style={{ fontSize: 11, color: spa.service_validity.status === 'VALID' ? '#40b068' : spa.service_validity.status === 'DEFECTIVE' ? '#c05050' : '#c08030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {spa.service_validity.status}
                    </p>
                  </div>
                )}
                {spa.jurisdiction_analysis && (
                  <div style={{ background: '#0a0a12', border: '1px solid #1a1a28', borderRadius: 4, padding: '5px 10px' }}>
                    <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Jurisdiction</p>
                    <p style={{ fontSize: 11, color: spa.jurisdiction_analysis.status === 'ESTABLISHED' ? '#40b068' : spa.jurisdiction_analysis.status === 'DOUBTFUL' ? '#c05050' : '#c08030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {spa.jurisdiction_analysis.status}
                    </p>
                  </div>
                )}
                {spa.conditions_precedent && (
                  <div style={{ background: '#0a0a12', border: '1px solid #1a1a28', borderRadius: 4, padding: '5px 10px' }}>
                    <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Conditions Pre.</p>
                    <p style={{ fontSize: 11, color: spa.conditions_precedent.status === 'SATISFIED' ? '#40b068' : spa.conditions_precedent.status === 'UNSATISFIED' ? '#c05050' : '#c08030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {spa.conditions_precedent.status}{spa.conditions_precedent.fatal ? ' · FATAL' : ''}
                    </p>
                  </div>
                )}
                {spa.limitation_analysis && (
                  <div style={{ background: '#0a0a12', border: '1px solid #1a1a28', borderRadius: 4, padding: '5px 10px' }}>
                    <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Limitation</p>
                    <p style={{ fontSize: 11, color: spa.limitation_analysis.defence_available ? '#40b068' : spa.limitation_analysis.status === 'EXPIRED' ? '#40b068' : spa.limitation_analysis.status === 'UNCLEAR' ? '#c08030' : '#c05050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {spa.limitation_analysis.defence_available ? 'DEFENCE AVAILABLE' : spa.limitation_analysis.status}
                    </p>
                  </div>
                )}
                {poGrounds.length > 0 && (
                  <div style={{ background: fatalCount > 0 ? '#1a0808' : '#0a0a12', border: `1px solid ${fatalCount > 0 ? '#401818' : '#1a1a28'}`, borderRadius: 4, padding: '5px 10px' }}>
                    <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>PO Grounds</p>
                    <p style={{ fontSize: 11, color: fatalCount > 0 ? '#c05050' : '#c08030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {poGrounds.length} ({fatalCount} fatal)
                    </p>
                  </div>
                )}
              </div>

              {spaResult.counterclaim_hints.length > 0 && (
                <div style={{ borderTop: `1px solid ${vc.bdr}`, paddingTop: 8 }}>
                  <p style={{ fontSize: 9, color: '#60c888', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                    {spaResult.counterclaim_hints.length} {activeCase.counsel_role === 'respondent_side' ? 'Cross-Petition' : activeCase.counsel_role === 'frep_respondent' ? 'Preliminary Objection' : 'Counterclaim'} Hint{spaResult.counterclaim_hints.length > 1 ? 's' : ''} — Will Be Re-Evaluated Against Client Instructions
                  </p>
                  {spaResult.counterclaim_hints.map((h: string, i: number) => (
                    <p key={i} style={{ fontSize: 11, color: '#608870', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 2 }}>
                      {i + 1}. {h}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #131320', flexWrap: 'wrap' }}>
            <RoleBadge role={role} />
            <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              {activeCase.caseName}
            </span>
            {activeCase.court && (
              <span style={{ fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif" }}>· {activeCase.court}</span>
            )}
          </div>
          <label style={lbS}>
            {isDefendantWithSPA ? `${partyB} Instructions & Account` : 'Complete Case Narrative / Raw Facts'} <span style={{ color: '#b06060' }}>*</span>
          </label>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.65 }}>
            {isDefendantWithSPA ? `Include: what your client says happened, which allegations they admit or dispute, any documents they hold, and whether they wish to counterclaim. The ${partyA}'s theory is pre-loaded — focus on the ${partyB}'s account.` : 'Include: what happened, when, between whom, what documents exist, what was said, what was agreed, what went wrong, who holds what evidence.'}
          </p>
          <textarea
            value={rawFacts}
            onChange={e => setRawFacts(e.target.value)}
            rows={13}
            placeholder={
              isDefendantWithSPA
                ? `What does your client say happened?\n\n• Which of the ${partyA}'s allegations do they admit?\n• Which do they dispute — and why?\n• What is their version of events?\n• Do they have a counterclaim or cross-claim?\n• What outcome do they want?\n\nThe ${partyA}'s theory is already loaded. Give the ${partyB}'s full account — the engine will clash both positions.`
                : 'Tell the full story of this matter:\n\n• What happened and when?\n• Who did what, to whom?\n• What documents, contracts, or communications exist?\n• What is the other side likely to say?\n• What outcome does the client want?\n\nDo not organise — give it raw. The engine will extract the intelligence.'
            }
            style={{ ...iS, resize: 'vertical', lineHeight: 1.85, minHeight: 300, fontSize: 15 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: rawFacts.length < 50 ? '#804040' : T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {rawFacts.length} characters{rawFacts.length < 50 ? ' · minimum 50' : ''}
            </span>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
              More detail = sharper intelligence
            </span>
          </div>
        </div>

        <ErrorBlock message={error} />

        <button
          onClick={runExtraction}
          disabled={loading || rawFacts.trim().length < 50}
          style={{
            background: loading || rawFacts.trim().length < 50
              ? '#101018'
              : 'linear-gradient(135deg,#000000,#a07820)',
            color: loading || rawFacts.trim().length < 50 ? '#2a2a38' : '#05050c',
            border: 'none', borderRadius: 6, padding: '14px',
            fontSize: 17, fontFamily: "'Times New Roman', Times, serif",
            cursor: loading || rawFacts.trim().length < 50 ? 'not-allowed' : 'pointer',
            width: '100%', fontWeight: 600, letterSpacing: '.04em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {loading ? (
            <><Spinner size={14} /> Extracting Intelligence…</>
          ) : (
            'Extract Intelligence →'
          )}
        </button>
      </div>
    );
  }

  // ── Phase 2E — Theory Clash Panel (defendant + SPA path) ────────────────
  function TheoryClashPanel() {
    const rec = theoryClashRecord;

    if (theoryClashLoading) {
      return (
        <div style={{ background: '#080e08', border: '1px solid #183020', borderRadius: 10, padding: '20px 22px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 16, height: 16, border: '2px solid #182818', borderTop: '2px solid #40b068', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 11, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>
              Phase 2E · Theory Clash Synthesis
            </p>
            <p style={{ fontSize: 12, color: '#608860', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              Synthesising {partyB} theory against {partyA} claims — locking v1…
            </p>
          </div>
        </div>
      );
    }

    if (theoryClashError && !rec) {
      return (
        <div style={{ background: '#0e0808', border: '1px solid #3a1818', borderRadius: 8, padding: '14px 18px', marginTop: 16 }}>
          <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            Theory Clash Synthesis Failed
          </p>
          <p style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>{theoryClashError}</p>
          <button
            onClick={() => extraction && runTheoryClashSynthesis(extraction, counterclaimDetected ?? { flag: false })}
            style={{ background: 'transparent', border: '1px solid #4a1818', color: '#c05050', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}
          >
            ↺ Retry Synthesis
          </button>
        </div>
      );
    }

    if (!rec && !theoryClashDone) return null;
    if (!rec) return null;

    const total = rec.score_breakdown?.total ?? 0;
    const scoreColor = total >= 75 ? '#40b068' : total >= 50 ? '#c0a030' : '#c05050';

    return (
      <div style={{ background: '#060e08', border: '1px solid #1a3020', borderRadius: 10, padding: '22px 24px', marginTop: 16, animation: 'fadeUp .3s ease' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #1a3020', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
              Phase 2E · Theory Clash Synthesis · Locked v1
            </p>
            <p style={{ fontSize: 17, color: '#d8f0e0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 400, lineHeight: 1.5 }}>
              {rec.core_proposition}
            </p>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <p style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Theory Score</p>
            <span style={{ fontSize: 36, color: scoreColor, fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, lineHeight: 1 }}>{total}</span>
            <p style={{ fontSize: 8, color: '#2a4030', fontFamily: "'Times New Roman', Times, serif", marginTop: 2 }}>/100</p>
          </div>
        </div>

        {/* Opposing theory + killer */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div style={{ background: '#0a0a18', border: '1px solid #1a1a30', borderRadius: 7, padding: '12px 14px' }}>
            <p style={{ fontSize: 8, color: '#6060a0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
              {partyA}'s Theory (to defeat)
            </p>
            <p style={{ fontSize: 12, color: '#9090b8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>{rec.opposing_theory}</p>
          </div>
          <div style={{ background: '#080e08', border: '1px solid #183020', borderRadius: 7, padding: '12px 14px' }}>
            <p style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
              Theory Killer
            </p>
            <p style={{ fontSize: 12, color: '#a8d8b0', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>{rec.theory_killer}</p>
          </div>
        </div>

        {/* Narrative theme */}
        <div style={{ background: '#0c100c', border: '1px solid #1e2a1e', borderRadius: 7, padding: '12px 14px', marginBottom: 16 }}>
          <p style={{ fontSize: 8, color: '#508050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            Narrative Theme for Trial Judge
          </p>
          <p style={{ fontSize: 13, color: '#c0d8c0', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', lineHeight: 1.7 }}>{rec.narrative_theme}</p>
        </div>

        {/* Elements */}
        {rec.elements?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
              Elements to Establish ({rec.elements.length})
            </p>
            {rec.elements.map((el, i) => (
              <div key={i} style={{ background: '#07100a', border: '1px solid #1a2a1a', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 10, color: '#2a5030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, color: '#c8e8c8', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 6 }}>{el.element}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <div>
                        <p style={{ fontSize: 8, color: '#3a6040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Evidence</p>
                        <p style={{ fontSize: 11, color: '#90a890', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55 }}>{el.evidence}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 8, color: '#3a6040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Authority</p>
                        <p style={{ fontSize: 11, color: '#90a890', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, fontStyle: 'italic' }}>{el.authority}</p>
                      </div>
                    </div>
                    {el.risk && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #182818' }}>
                        <p style={{ fontSize: 8, color: '#804040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>Risk if fails</p>
                        <p style={{ fontSize: 11, color: '#a07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55 }}>{el.risk}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Weakest link */}
        <div style={{ background: '#120808', border: '1px solid #2a1010', borderRadius: 7, padding: '12px 14px', marginBottom: 16 }}>
          <p style={{ fontSize: 8, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            Weakest Link + Contingency
          </p>
          <p style={{ fontSize: 12, color: '#c09090', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>{rec.weakest_link}</p>
        </div>

        {/* Gap report */}
        {rec.gap_report?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 8, color: '#c0a030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
              Gap Report ({rec.gap_report.length} action{rec.gap_report.length > 1 ? 's' : ''} required)
            </p>
            {rec.gap_report.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < rec.gap_report.length - 1 ? '1px solid #1e1a0a' : 'none' }}>
                <span style={{ fontSize: 11, color: '#5a4a10', flexShrink: 0, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>{i + 1}.</span>
                <div>
                  <p style={{ fontSize: 12, color: '#d0b858', fontFamily: "'Times New Roman', Times, serif", marginBottom: 3 }}>{g.element}</p>
                  <p style={{ fontSize: 11, color: '#a09040', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, marginBottom: 4 }}>Needed: {g.needed}</p>
                  <p style={{ fontSize: 11, color: '#706830', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', lineHeight: 1.55 }}>→ {g.suggested_action}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Score breakdown */}
        {rec.score_breakdown && (
          <div style={{ background: '#070e08', border: '1px solid #1a2818', borderRadius: 7, padding: '12px 14px' }}>
            <p style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
              Theory Score Breakdown
            </p>
            {[
              { key: 'legal_sufficiency',        label: 'Legal Sufficiency' },
              { key: 'evidence_coverage',        label: 'Evidence Coverage' },
              { key: 'vulnerability',            label: 'Vulnerability (↑ = more exposed)', invert: true },
              { key: 'narrative_coherence',      label: 'Narrative Coherence' },
              { key: 'jurisdictional_precision', label: 'Jurisdictional Precision' },
            ].map(({ key, label, invert }) => {
              const val = rec.score_breakdown[key as keyof typeof rec.score_breakdown] as number;
              const barColor = invert
                ? (val <= 8 ? '#40b068' : val <= 14 ? '#c0a030' : '#c05050')
                : (val >= 16 ? '#40b068' : val >= 10 ? '#c0a030' : '#c05050');
              return (
                <div key={key} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <p style={{ fontSize: 10, color: '#608860', fontFamily: "'Times New Roman', Times, serif" }}>{label}</p>
                    <span style={{ fontSize: 11, color: barColor, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{val}/20</span>
                  </div>
                  <div style={{ background: '#0f140f', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(val / 20) * 100}%`, background: barColor, borderRadius: 3, transition: 'width .8s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ fontSize: 9, color: '#1e3020', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', marginTop: 12, textAlign: 'right' }}>
          Locked v1 · case_theory_structured saved · counsel may unlock via Theory Clash (Phase 3D)
        </p>
      </div>
    );
  }

    // ─────────────────────────────────────────────────────────────────────────
  // STAGE 2 — Extraction Results
  // ─────────────────────────────────────────────────────────────────────────
  function Stage2() {
    if (!extraction) return <BigSpinner label="Processing…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: '#40a868', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 2 of 5 · Extraction Complete
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>
            Intelligence Extracted
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Review the extracted intelligence. Proceed to answer targeted follow-up questions to deepen the picture.
          </p>
        </div>

        {/* Timeline */}
        {extraction.timeline?.length > 0 && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
            <p style={{ fontSize: 9, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 14 }}>
              Case Timeline
            </p>
            {extraction.timeline.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 10, paddingBottom: 10, borderBottom: i < extraction.timeline.length - 1 ? '1px solid #131320' : 'none' }}>
                <div style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: T.text, marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, display: 'block', marginBottom: 2 }}>{t.date}</span>
                  <p style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: t.significance ? 3 : 0 }}>{t.event}</p>
                  {t.significance && (
                    <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, fontStyle: 'italic' }}>{t.significance}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Established facts + Disputed areas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {extraction.established_facts?.length > 0 && (
            <div style={{ background: '#071810', border: '1px solid #1a4028', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Established Facts</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.established_facts.map((f, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#40b068', fontSize: 8, top: 4 }}>●</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {extraction.disputed_areas?.length > 0 && (
            <div style={{ background: '#180808', border: '1px solid #401818', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Disputed Areas</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.disputed_areas.map((d, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 4 }}>●</span>{d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Legal issues + Gaps */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {extraction.legal_issues?.length > 0 && (
            <div style={{ background: '#0e0818', border: '1px solid #281840', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Legal Issues Identified</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.legal_issues.map((l, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: T.dim, fontSize: 8, top: 4 }}>●</span>{l}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {extraction.gaps_identified?.length > 0 && (
            <div style={{ background: '#1a1000', border: '1px solid #3a2800', borderRadius: 8, padding: '16px 18px' }}>
              <p style={{ fontSize: 9, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Gaps Identified</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {extraction.gaps_identified.map((g, i) => (
                  <li key={i} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 5, paddingLeft: 14, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#c08030', fontSize: 9, top: 2 }}>⚠</span>{g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Risk flags */}
        {extraction.initial_risks?.length > 0 && (
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>Initial Risk Flags</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {extraction.initial_risks.map((r, i) => {
                const rc = RISK_SEV_C[r.severity] || RISK_SEV_C.MEDIUM;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ background: rc.bg, border: `1px solid ${rc.bdr}`, color: rc.col, fontSize: 8, padding: '2px 6px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
                      {r.severity}
                    </span>
                    <span style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>{r.risk}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Counterclaim flag (Phase 6A) — only shown when the extraction found one */}
        {counterclaimDetected?.flag && (
          <div style={{ background: '#180e00', border: '1px solid #4a3000', borderRadius: 8, padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 9, color: '#d09030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11 }}>⚑</span> Possible Counterclaim Detected
            </p>
            <p style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>
              {counterclaimDetected.summary || 'The facts disclose a possible independent cause of action that could be pleaded as a counterclaim — review before settling the pleadings.'}
            </p>
          </div>
        )}

        <ErrorBlock message={error} />

        {/* Step 2b — Commencement Audit (auto-runs after extraction) */}
        <CommencementAuditPanel />

        {/* Phase 2E — Theory Clash Synthesis panel (defendant + SPA path only) */}
        {isReceivingSide && !!spaResult && (
          <TheoryClashPanel />
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(1)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
            ← Edit Facts
          </button>
          <button
            onClick={generateFollowUp}
            disabled={loading}
            style={{ flex: 1, background: loading ? '#101018' : 'linear-gradient(135deg,#000000,#a07820)', color: loading ? '#2a2a38' : '#05050c', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {loading ? <><Spinner size={14} /> Generating Questions…</> : 'Proceed to Follow-Up →'}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 3 — Follow-Up Questions
  // ─────────────────────────────────────────────────────────────────────────
  function Stage3() {
    const answeredCount = followUpQs.filter(q => followUpAs[q.id]?.trim()).length;
    const canProceed    = answeredCount >= Math.min(3, followUpQs.length);
    if (loading) return <BigSpinner label="Generating targeted questions…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 3 of 5 · Dynamic Follow-Up
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>Targeted Questions</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Answer these questions to fill the critical intelligence gaps. Answer at least {Math.min(3, followUpQs.length)} to proceed.
          </p>
        </div>

        {followUpQs.map((q, i) => (
          <div key={q.id} style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#1a1500', border: `1px solid ${T.text}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>{i + 1}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: q.purpose ? 4 : 0 }}>{q.question}</p>
                {q.purpose && (
                  <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, fontStyle: 'italic' }}>{q.purpose}</p>
                )}
              </div>
              {followUpAs[q.id]?.trim() && (
                <span style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', background: '#071810', border: '1px solid #1a4028', padding: '2px 6px', borderRadius: 2, flexShrink: 0, marginTop: 3 }}>✓</span>
              )}
            </div>
            <textarea
              value={followUpAs[q.id] || ''}
              onChange={e => setFollowUpAs(prev => ({ ...prev, [q.id]: e.target.value }))}
              rows={3}
              placeholder="Your answer…"
              style={{ ...iS, resize: 'vertical', lineHeight: 1.75, minHeight: 68, fontSize: 14 }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{answeredCount} of {followUpQs.length} answered</span>
          {canProceed && (
            <span style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', background: '#071810', border: '1px solid #1a4028', padding: '2px 8px', borderRadius: 2 }}>
              Ready to proceed
            </span>
          )}
        </div>

        <ErrorBlock message={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(2)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
            ← Back
          </button>
          <button
            onClick={buildEvidenceMatrix}
            disabled={!canProceed}
            style={{ flex: 1, background: canProceed ? 'linear-gradient(135deg,#000000,#a07820)' : '#101018', color: canProceed ? '#05050c' : '#2a2a38', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: canProceed ? 'pointer' : 'not-allowed', fontWeight: 600, letterSpacing: '.04em' }}>
            Build Evidence Map →
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 4 — Evidence Matrix
  // ─────────────────────────────────────────────────────────────────────────
  function Stage4() {
    if (loading) return <BigSpinner label="Mapping evidence requirements…" />;
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 4 of 5 · Evidence Map
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>Evidence Requirements</h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Required, available, and missing evidence — mapped to each fact and legal issue.
          </p>
        </div>

        {(evidenceM || []).map((item, i) => {
          const pc = PRIORITY_C[item.priority] || PRIORITY_C.MEDIUM;
          return (
            <div key={i} style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                <span style={{ background: pc.bg, border: `1px solid ${pc.bdr}`, color: pc.col, fontSize: 8, padding: '3px 7px', borderRadius: 2, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em', fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
                  {item.priority}
                </span>
                <p style={{ fontSize: 15, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, lineHeight: 1.45, flex: 1 }}>{item.issue}</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Required</p>
                  {(item.evidence_needed || []).map((e, j) => (
                    <p key={j} style={{ fontSize: 12, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 4, paddingLeft: 10, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: T.mute, fontSize: 8, top: 3 }}>·</span>{e}
                    </p>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Available</p>
                  {(item.evidence_available || []).length > 0
                    ? (item.evidence_available || []).map((e, j) => (
                        <p key={j} style={{ fontSize: 12, color: '#60c088', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 4, paddingLeft: 10, position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 0, color: '#40b068', fontSize: 8, top: 3 }}>✓</span>{e}
                        </p>
                      ))
                    : <p style={{ fontSize: 11, color: T.bdr, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>None identified</p>
                  }
                </div>
                <div>
                  <p style={{ fontSize: 8, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Missing</p>
                  {(item.evidence_missing || []).length > 0
                    ? (item.evidence_missing || []).map((e, j) => (
                        <p key={j} style={{ fontSize: 12, color: '#d07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 4, paddingLeft: 10, position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 0, color: '#c05050', fontSize: 8, top: 3 }}>!</span>{e}
                        </p>
                      ))
                    : <p style={{ fontSize: 11, color: T.bdr, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>None</p>
                  }
                </div>
              </div>
              {item.notes && (
                <p style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid #131320', fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, fontStyle: 'italic' }}>{item.notes}</p>
              )}
            </div>
          );
        })}

        <ErrorBlock message={error} />

        {/* Step 4b — Conflict Scan (run before generating the package) */}
        <ConflictScanPanel />

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => goBack(3)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '12px 20px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
            ← Back
          </button>
          <button
            onClick={generatePackage}
            style={{ flex: 1, background: 'linear-gradient(135deg,#000000,#a07820)', color: '#ffffff', border: 'none', borderRadius: 6, padding: '13px', fontSize: 17, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', fontWeight: 600, letterSpacing: '.04em' }}>
            Generate Intelligence Package →
          </button>
        </div>
      </div>
    );
  }

  // ── Step 4b: Conflict Scan ─────────────────────────────────────────────────
  //
  // 4Ai  — query db.cases for party-name + subject-matter overlap
  // 4Aii — normalise + compare; produce candidate hit list
  // 4Aiii — AI assesses each hit; builds red/green output + conflict list
  //
  // Run on-demand from Stage 4 or Stage 5 (button). Non-blocking.
  // Persists to intelligence_data.conflict_scan.

  /** Normalise a party name for fuzzy matching — lowercase, strip Ltd/Inc/& punctuation */
  function normaliseName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/\b(limited|ltd|plc|inc|llc|lp|and|&|nig|nigeria|enterprises?|company|co\.?)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Return true if two normalised names share a meaningful token (≥4 chars) */
  function namesOverlap(a: string, b: string): boolean {
    if (!a || !b) return false;
    const tokA = new Set(a.split(' ').filter(t => t.length >= 4));
    const tokB = new Set(b.split(' ').filter(t => t.length >= 4));
    for (const t of tokA) { if (tokB.has(t)) return true; }
    return false;
  }

  async function runConflictScan() {
    setConflictLoading(true);
    setConflictError('');

    try {
      // ── 4Ai: Query the cases table ──────────────────────────────────────
      const allCases = await db.cases.toArray();
      const otherCases = allCases.filter(c => c.id !== activeCase.id);

      // Collect current case's party names (normalised)
      const currentParties = [
        ...activeCase.claimants.map(p => p.name),
        ...activeCase.defendants.map(p => p.name),
      ].filter(Boolean);
      const currentNorm = currentParties.map(normaliseName);

      // Current case subject tokens (caseName + suitNo fragments)
      const currentSubject = normaliseName(
        `${activeCase.caseName ?? ''} ${activeCase.suitNo ?? ''}`
      );

      // ── 4Aii: Comparison logic — detect overlap ─────────────────────────
      interface Candidate {
        case_id:  string;
        case_ref: string;
        overlaps: string[];
      }
      const candidates: Candidate[] = [];

      for (const c of otherCases) {
        const overlaps: string[] = [];

        // Party name overlap
        const otherParties = [
          ...(c.claimants ?? []).map((p: { name: string }) => p.name),
          ...(c.defendants ?? []).map((p: { name: string }) => p.name),
        ].filter(Boolean);

        for (const op of otherParties) {
          const opNorm = normaliseName(op);
          for (const cn of currentNorm) {
            if (namesOverlap(cn, opNorm)) {
              overlaps.push(`Party name match: "${op}" (in ${c.caseName || c.id})`);
              break;
            }
          }
        }

        // Subject matter overlap — caseName tokens
        const otherSubject = normaliseName(`${c.caseName ?? ''} ${c.suitNo ?? ''}`);
        if (currentSubject && otherSubject && namesOverlap(currentSubject, otherSubject)) {
          overlaps.push(`Subject matter similarity: "${c.caseName || c.id}"`);
        }

        if (overlaps.length > 0) {
          candidates.push({
            case_id:  c.id,
            case_ref: c.caseName || c.suitNo || c.id,
            overlaps,
          });
        }
      }

      // ── 4Aiii: Build red/green output ──────────────────────────────────
      let result: ConflictScanResult;

      if (candidates.length === 0) {
        // No raw overlap — clear without an AI call
        result = {
          run_at:    new Date().toISOString(),
          clear:     true,
          conflicts: [],
          summary:   `No party or subject-matter overlap detected across ${otherCases.length} case${otherCases.length !== 1 ? 's' : ''} in the database.`,
        };
      } else {
        // AI assesses each candidate hit for true professional conflict
        const conflictCtx = candidates.map((cand, i) =>
          `[${i + 1}] Case: "${cand.case_ref}" (ID: ${cand.case_id})\nOverlap signals: ${cand.overlaps.join('; ')}`
        ).join('\n\n');

        const aiResult = await callClaude({
          system: `You are a Nigerian bar ethics adviser specialising in conflict of interest under the Rules of Professional Conduct for Legal Practitioners 2007. Assess each candidate case for a genuine professional conflict of interest. Return ONLY valid JSON — no markdown fences, no preamble.`,
          userMsg: `CURRENT CASE:\nName: ${activeCase.caseName || 'Untitled'}\nCourt: ${activeCase.court || 'Not specified'}\nCounsel role: ${activeCase.counsel_role || 'unspecified'}\nClaimants: ${activeCase.claimants.map(p => p.name).filter(Boolean).join(', ') || 'Not named'}\nDefendants: ${activeCase.defendants.map(p => p.name).filter(Boolean).join(', ') || 'Not named'}\n\nCANDIDATE OVERLAP CASES:\n${conflictCtx}\n\nFor each candidate, assess: does the overlap constitute a genuine professional conflict or adverse-interest risk under Nigerian bar rules? Consider: same parties on opposing sides, prior representation, substantially related subject matter, confidential information risk.\n\nReturn exactly:\n{\n  "conflicts": [\n    {"case_id":"...","case_ref":"...","overlap":"one sentence describing the specific conflict risk","flag":true}\n  ],\n  "clear_ids": ["case_id_1","case_id_2"],\n  "summary": "One sentence — e.g. '2 conflict flags across 8 cases: see Acme Ltd v Doe and XYZ v ABC.' or 'No genuine conflict risks identified across N overlap candidates.'"\n}\n\nRules:\n- Include in "conflicts" ONLY cases with genuine flag:true conflict risk. Superficial name similarity with no ethical risk should go in clear_ids.\n- clear_ids = candidate IDs you assessed as NOT a true conflict.\n- summary must be a single sentence suitable for Case Command display.`,
          maxTokens: 800,
          skipLibrary: true,
        });

        const clean = aiResult
          .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const start = clean.indexOf('{');
        const end   = clean.lastIndexOf('}');
        const parsed = JSON.parse(clean.slice(start, end + 1)) as {
          conflicts: Array<{ case_id: string; case_ref: string; overlap: string }>;
          summary:   string;
        };

        result = {
          run_at:    new Date().toISOString(),
          clear:     parsed.conflicts.length === 0,
          conflicts: parsed.conflicts.map(c => ({
            case_id:  c.case_id,
            case_ref: c.case_ref,
            overlap:  c.overlap,
          })),
          summary: parsed.summary ?? (
            parsed.conflicts.length === 0
              ? 'No genuine conflict risks identified.'
              : `${parsed.conflicts.length} conflict flag${parsed.conflicts.length > 1 ? 's' : ''} identified.`
          ),
        };
      }

      setConflictScan(result);
      onSave({
        stage, rawFacts, extraction, followUpQs, followUpAs, evidenceM, intPkg,
        commencement_audit: commencementAudit, conflict_scan: result, risk_verdict: riskVerdict, authority_grounding: authorityGrounding,
      });

    } catch (e) {
      setConflictError('Conflict scan failed: ' + ((e as Error).message || 'Please try again.'));
    } finally {
      setConflictLoading(false);
    }
  }

  // ── Step 4b: Conflict Scan panel (rendered in Stage4 and Stage5) ──────────

  function ConflictScanPanel() {
    const hasScan = Boolean(conflictScan);
    const hasParties = (
      activeCase.claimants.some(p => p.name.trim()) ||
      activeCase.defendants.some(p => p.name.trim())
    );

    return (
      <div style={{
        background: '#0a0a14',
        border: `1px solid ${conflictScan ? (conflictScan.clear ? '#1a4028' : '#401818') : '#181828'}`,
        borderLeft: `3px solid ${conflictScan ? (conflictScan.clear ? '#40b068' : '#c04040') : '#2a2a40'}`,
        borderRadius: 8, padding: '16px 20px', marginBottom: 14,
        animation: 'fadeUp .3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: conflictLoading ? 0 : (hasScan ? 12 : 0), flexWrap: 'wrap' }}>
          <p style={{ fontSize: 9, color: '#6a6a8a', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, flex: 1 }}>
            Step 4b · Conflict Scan
          </p>

          {conflictLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 12, height: 12, border: '2px solid #1e1e2e', borderTop: '2px solid #c4a030', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
              <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>Scanning {activeCase.caseName}…</span>
            </div>
          )}

          {!conflictLoading && conflictScan && (
            <span style={{
              fontSize: 8, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
              letterSpacing: '.12em', padding: '2px 8px', borderRadius: 2,
              background: conflictScan.clear ? '#071810' : '#1a0808',
              border:     `1px solid ${conflictScan.clear ? '#1a4028' : '#401818'}`,
              color:      conflictScan.clear ? '#40b068' : '#c04040',
            }}>
              {conflictScan.clear ? '✓ CLEAR' : `⚠ ${conflictScan.conflicts.length} FLAG${conflictScan.conflicts.length > 1 ? 'S' : ''}`}
            </span>
          )}

          {!conflictLoading && (
            <button
              onClick={runConflictScan}
              disabled={!hasParties}
              title={!hasParties ? 'Add parties to the case before running a conflict scan' : ''}
              style={{
                background: 'transparent',
                border: '1px solid #2a2208',
                color: hasParties ? '#8a7840' : '#3a3a3a',
                borderRadius: 4, padding: '4px 12px',
                fontSize: 9, fontFamily: "'Times New Roman', Times, serif",
                cursor: hasParties ? 'pointer' : 'not-allowed',
                letterSpacing: '.04em',
              }}>
              {hasScan ? '⟳ Re-scan' : '⚠ Run Conflict Scan'}
            </button>
          )}
        </div>

        {conflictError && !conflictLoading && (
          <p style={{ fontSize: 11, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", margin: '8px 0 0' }}>
            {conflictError}
          </p>
        )}

        {!conflictLoading && conflictScan && (
          <div>
            <p style={{ fontSize: 13, color: conflictScan.clear ? '#40b068' : '#c07050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: conflictScan.conflicts.length > 0 ? 12 : 0 }}>
              {conflictScan.summary}
            </p>

            {conflictScan.conflicts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {conflictScan.conflicts.map(hit => (
                  <div key={hit.case_id} style={{
                    background: '#1a0808', border: '1px solid #401818',
                    borderRadius: 6, padding: '10px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: '#c04040', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.1em' }}>⚑ CONFLICT</span>
                      <span style={{ fontSize: 11, color: '#d0c8c0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{hit.case_ref}</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#9a7070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, margin: 0 }}>
                      {hit.overlap}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <p style={{ fontSize: 9, color: '#2a2a38', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', marginTop: 10 }}>
              Scanned {new Date(conflictScan.run_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · Saved to intelligence_data.conflict_scan
            </p>
          </div>
        )}

        {!conflictLoading && !conflictScan && !conflictError && (
          <p style={{ fontSize: 11, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginTop: 6 }}>
            {hasParties
              ? 'Checks all cases in this device\'s database for party-name and subject-matter overlap. Run before proceeding to the Intelligence Package.'
              : 'Add party names to the case file before running a conflict scan.'}
          </p>
        )}
      </div>
    );
  }

  // ── Step 5b constants ──────────────────────────────────────────────────────

  const RISK_DIMENSIONS: Array<{ id: keyof RiskDimensionScores; label: string; icon: string; invert?: boolean }> = [
    { id: 'procedural',              label: 'Procedural Strength',      icon: '⚙' },
    { id: 'evidential',              label: 'Evidential Strength',      icon: '📁' },
    { id: 'witness_vulnerability',   label: 'Witness Vulnerability',    icon: '👁',  invert: true },
    { id: 'jurisdictional_risk',     label: 'Jurisdictional Risk',      icon: '⚖',  invert: true },
    { id: 'burden_satisfaction',     label: 'Burden Satisfaction',      icon: '⚔' },
    { id: 'settlement_advisability', label: 'Settlement Advisability',  icon: '🤝' },
    { id: 'appeal_survivability',    label: 'Appeal Survivability',     icon: '↑' },
    { id: 'opponent_threat',         label: 'Opponent Threat Level',    icon: '⚡', invert: true },
  ];

  const RISK_VERDICT_CONFIG: Record<RiskVerdict, { color: string; label: string }> = {
    FILE:      { color: '#40a868', label: 'FILE' },
    NEGOTIATE: { color: '#c4a030', label: 'NEGOTIATE' },
    SETTLE:    { color: '#c07830', label: 'SETTLE' },
    WALK_AWAY: { color: '#c04040', label: 'WALK AWAY' },
  };

  const RISK_SYSTEM_PROMPT = `You are a senior Nigerian litigation risk analyst with 30 years of courtroom experience across the Magistrate Court, High Court, Court of Appeal, and Supreme Court. Analyse the Intelligence Package provided and return ONLY valid JSON — no markdown fences, no preamble, no trailing text. Use this exact shape:

{"scores":{"procedural":N,"evidential":N,"witness_vulnerability":N,"jurisdictional_risk":N,"burden_satisfaction":N,"settlement_advisability":N,"appeal_survivability":N,"opponent_threat":N},"reasoning":{"procedural":"one precise line","evidential":"one precise line","witness_vulnerability":"one precise line","jurisdictional_risk":"one precise line","burden_satisfaction":"one precise line","settlement_advisability":"one precise line","appeal_survivability":"one line summarising aggregate appellate survivability across all identified grounds","opponent_threat":"one precise line"},"recommendation":"two to three sentence strategic recommendation for Nigerian litigation counsel","verdict":"FILE","appellate_narrative":"FULL STRUCTURED NARRATIVE HERE — see format below"}

appellate_narrative format (plain text inside the JSON string, use \\n for line breaks):
For each live appellate issue, follow this structure:
ISSUE [N]: [Issue title]
Ground: [The ground of appeal it generates under Nigerian appellate procedure]
Survivability: [High / Medium / Low at the Court of Appeal — with brief reason]
Preserve now: [Specific action counsel must take to preserve this point on the record]

Cover ALL of: errors of law, wrongly admitted/excluded evidence, jurisdictional points, constitutional issues, procedural violations that affect the record.

Rules:
- All N values are integers 0–100.
- verdict must be exactly one of: FILE, NEGOTIATE, SETTLE, WALK_AWAY.
- Higher score = stronger practitioner position for: procedural, evidential, burden_satisfaction, settlement_advisability, appeal_survivability.
- Higher score = WORSE (higher risk) for: witness_vulnerability, jurisdictional_risk, opponent_threat.
- appeal_survivability score must reflect the aggregate survivability across all issues in appellate_narrative.
- Do NOT score appellate issues separately — they are merged into appeal_survivability only.
- Apply Nigerian procedural law, Evidence Act 2011, and specific court norms throughout.
- Be analytically honest — do not default to optimistic scores.
- Every string value must be properly JSON-escaped. Use \\n for newlines inside appellate_narrative.`;

  function riskScoreColor(n: number, invert = false): string {
    const adjusted = invert ? (100 - n) : n;
    if (adjusted < 40) return '#c04040';
    if (adjusted < 70) return '#c4a030';
    return '#40a868';
  }

  function riskOverallScore(scores: RiskDimensionScores): number {
    const positive: (keyof RiskDimensionScores)[] = ['procedural', 'evidential', 'burden_satisfaction', 'settlement_advisability', 'appeal_survivability'];
    const negative: (keyof RiskDimensionScores)[] = ['witness_vulnerability', 'jurisdictional_risk', 'opponent_threat'];
    const posSum = positive.reduce((a, k) => a + scores[k], 0) / positive.length;
    const negSum = negative.reduce((a, k) => a + (100 - scores[k]), 0) / negative.length;
    return Math.round((posSum + negSum) / 2);
  }

  // ── Step 5: Run Authority Grounding (auto-called after package generation) ────
  async function runAuthorityGrounding(pkg: string) {
    setAgLoading(true);
    setAgError('');
    try {
      const raw = await withRetry(() => callClaude({
        system: `You are a Nigerian litigation authority analyst. Extract the Authority Grounding section from the Intelligence Package and return ONLY valid JSON — no markdown fences, no preamble, no trailing text. Use this exact shape:
{"hierarchy_map":"markdown narrative of court hierarchy and binding status for each cited authority","conflict_flags":"markdown narrative of overruled, conflicting, or unverified authorities — state \"None identified\" if clean","status":"GROUNDED","summary":"one-line summary for Case Command"}

Rules:
- status must be exactly one of: GROUNDED (all authorities appear current and mapped), GAPS (some authorities lack court/citation or could not be mapped), CONFLICTS (at least one overruled or conflicting authority detected).
- hierarchy_map must address every authority mentioned in the package. If none are cited, set to "No authorities cited — research required before filing."
- conflict_flags must name any authority flagged as overruled, distinguished, or unverified.
- summary must be one sentence, plain text, no markdown.
- Every string value must be properly JSON-escaped. Use \\n for newlines inside narrative fields.`,
        userMsg: `${caseCtx}\n\nINTELLIGENCE PACKAGE (read the AUTHORITY GROUNDING section):\n${pkg}`,
        maxTokens: 1500,
        skipLibrary: true,
      }));
      const clean  = raw.replace(/^\`\`\`json\s*/, '').replace(/\`\`\`\s*$/, '').trim();
      const parsed = JSON.parse(clean) as Omit<NonNullable<IntelligenceData['authority_grounding']>, 'run_at'>;
      const result: NonNullable<IntelligenceData['authority_grounding']> = {
        ...parsed,
        run_at: new Date().toISOString(),
      };
      setAuthorityGrounding(result);
      // Persist alongside the latest intPkg and risk_verdict (if already set)
      onSave({
        stage: 5, rawFacts, extraction, followUpQs, followUpAs, evidenceM,
        intPkg: pkg,
        commencement_audit:  commencementAudit,
        conflict_scan:       conflictScan,
        risk_verdict:        riskVerdict,
        authority_grounding: result,
      });
    } catch (e) {
      setAgError((e as Error).message || 'Authority grounding failed. Please try again.');
    } finally {
      setAgLoading(false);
    }
  }

  // ── Step 5b: Run Risk Verdict (auto-called after package generation) ───────
  async function runRiskVerdict(pkg: string) {
    setRiskLoading(true);
    setRiskError('');
    try {
      const raw = await withRetry(() => callClaude({
        system: RISK_SYSTEM_PROMPT,
        userMsg: `${caseCtx}\n\nINTELLIGENCE PACKAGE:\n${pkg}`,
        maxTokens: 2000,
        skipLibrary: true,
      }));
      const clean  = raw.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(clean) as Omit<RiskVerdictResult, 'run_at'>;
      const result: RiskVerdictResult = { ...parsed, run_at: new Date().toISOString() };
      setRiskVerdict(result);
      setRiskAnimated(false);
      setTimeout(() => setRiskAnimated(true), 100);
      // Persist — use advance-style direct call so we include the latest intPkg
      onSave({
        stage: 5, rawFacts, extraction, followUpQs, followUpAs, evidenceM,
        intPkg: pkg, commencement_audit: commencementAudit, risk_verdict: result,
      });
    } catch (e) {
      setRiskError((e as Error).message || 'Risk verdict failed. Please try again.');
    } finally {
      setRiskLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 5 — Intelligence Package
  // ─────────────────────────────────────────────────────────────────────────
  function Stage5() {
    if (loading) return (
      <div style={{ textAlign: 'center', padding: '68px 24px' }}>
        <div style={{ width: 38, height: 38, border: `3px solid ${T.bdr}`, borderTop: `3px solid ${T.text}`, borderRadius: '50%', margin: '0 auto 20px', animation: 'spin .9s linear infinite' }} />
        <p style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10 }}>Assembling Intelligence Package…</p>
        <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em' }}>TRIAL INTELLIGENCE ENGINE · AFS ADVOCATES</p>
      </div>
    );
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: '#40a868', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
              Step 5 of 5 · Complete · Saved to Case
            </p>
            <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>Intelligence Package</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={copyPackage}
              style={{ background: 'transparent', border: '1px solid #2a2208', color: copied ? '#40b068' : T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', transition: 'color .2s' }}>
              {copied ? '✓ Copied' : 'Copy All'}
            </button>
            <button onClick={() => goBack(4)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              ← Evidence Map
            </button>
            <button
              onClick={resetPipeline}
              style={{ background: 'transparent', border: '1px solid #3a1818', color: '#804040', borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
              ↺ Reset Pipeline
            </button>
          </div>
        </div>

        {pkgResumed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1400', border: '1px solid #3a2800', borderRadius: 6, padding: '8px 14px', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: '#c08030' }}>⟳</span>
            <span style={{ fontSize: 11, color: '#c08030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em' }}>
              Resumed after interruption — output is complete and continuous
            </span>
          </div>
        )}

        {intPkg && (
          <div style={{ background: T.card, border: `1px solid ${T.text}33`, borderRadius: 10, padding: '26px 28px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #131320', flexWrap: 'wrap' }}>
              <RoleBadge role={role} />
              <span style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>{activeCase.caseName}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif" }}>
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <Md text={intPkg} />
          </div>
        )}

        {/* ── Step 4b — Conflict Scan (also accessible from Stage 5) ──── */}
        <div style={{ marginTop: 20 }}>
          <ConflictScanPanel />
        </div>

        {/* ── Step 5b — Risk Verdict ──────────────────────────────────── */}
        <div style={{ marginTop: 20, background: '#0a0a14', border: '1px solid #181828', borderRadius: 10, padding: '22px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                Step 5b · Risk Verdict
              </p>
              <p style={{ fontSize: 17, color: '#c8c4b8', fontFamily: "'Times New Roman', Times, serif", fontWeight: 400 }}>
                Strategic Risk Scoring
              </p>
            </div>
            {riskVerdict && !riskLoading && (
              <button
                onClick={() => runRiskVerdict(intPkg)}
                style={{ background: 'transparent', border: '1px solid #2a2208', color: '#5a5a40', borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
                ⟳ Re-run
              </button>
            )}
          </div>

          {riskLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0' }}>
              <div style={{ width: 16, height: 16, border: '2px solid #1e1e2e', borderTop: '2px solid #c4a030', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                Running 8-dimension risk analysis…
              </p>
            </div>
          )}

          {riskError && !riskLoading && (
            <div style={{ background: '#180808', border: '1px solid #4a1818', borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>{riskError}</p>
              <button
                onClick={() => runRiskVerdict(intPkg)}
                style={{ marginTop: 8, background: 'transparent', border: '1px solid #4a1818', color: '#c05050', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          )}

          {!riskLoading && !riskVerdict && !riskError && (
            <p style={{ fontSize: 12, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              Risk verdict will auto-run when the Intelligence Package is generated.
            </p>
          )}

          {riskVerdict && !riskLoading && (() => {
            const overall = riskOverallScore(riskVerdict.scores);
            const vc = RISK_VERDICT_CONFIG[riskVerdict.verdict];
            return (
              <div style={{ animation: 'fadeUp .3s ease' }}>
                {/* Verdict + overall score bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18, padding: '14px 18px', background: '#ffffff', border: `1px solid ${vc.color}33`, borderRadius: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Strategic Verdict</p>
                    <div style={{ display: 'inline-block', background: `${vc.color}18`, border: `1px solid ${vc.color}55`, borderRadius: 4, padding: '5px 18px', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, color: vc.color, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' }}>{vc.label}</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#8a8676', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75, maxWidth: 520 }}>
                      {riskVerdict.recommendation}
                    </p>
                  </div>
                  <div style={{ textAlign: 'center', flexShrink: 0 }}>
                    <p style={{ fontSize: 9, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Overall</p>
                    <span style={{ fontSize: 40, color: riskScoreColor(overall), fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, lineHeight: 1 }}>{overall}</span>
                  </div>
                </div>

                {/* 8-dimension score cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginBottom: 12 }}>
                  {RISK_DIMENSIONS.map(dim => {
                    const score  = riskVerdict.scores[dim.id];
                    const color  = riskScoreColor(score, dim.invert);
                    const reason = riskVerdict.reasoning[dim.id];
                    return (
                      <div key={dim.id} style={{ background: '#07070f', border: '1px solid #141424', borderRadius: 7, padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 12, opacity: .65 }}>{dim.icon}</span>
                            <p style={{ fontSize: 9, color: '#8a8a9a', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 600 }}>{dim.label}</p>
                          </div>
                          <span style={{ fontSize: 26, color, fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, lineHeight: 1 }}>{score}</span>
                        </div>
                        <div style={{ background: '#ffffff', borderRadius: 3, height: 4, marginBottom: 8, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: riskAnimated ? `${score}%` : '0%', background: color, borderRadius: 3, transition: 'width .9s cubic-bezier(.25,.46,.45,.94)' }} />
                        </div>
                        {dim.invert && <p style={{ fontSize: 8, color: '#3a3a52', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>↑ higher = more risk</p>}
                        {reason && <p style={{ fontSize: 11, color: '#5a5650', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', lineHeight: 1.55, margin: 0 }}>{reason}</p>}
                      </div>
                    );
                  })}
                </div>

                <p style={{ fontSize: 9, color: '#2a2a38', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textAlign: 'right' }}>
                  Scored {new Date(riskVerdict.run_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · Saved to intelligence_data.risk_verdict
                </p>

                {/* Appellate vulnerability narrative (3B) */}
                {riskVerdict.appellate_narrative && (
                  <div style={{ marginTop: 16, background: '#06060e', border: '1px solid #1a1a30', borderRadius: 8, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #121220' }}>
                      <span style={{ fontSize: 13, opacity: .7 }}>↑</span>
                      <p style={{ fontSize: 9, color: '#6a6a8a', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>
                        Appellate Vulnerability Analysis
                      </p>
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: '#2a2a3e', fontFamily: "'Times New Roman', Times, serif" }}>
                        Merged into appeal_survivability · score {riskVerdict.scores.appeal_survivability}/100
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#8a8676', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
                      {riskVerdict.appellate_narrative}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <ErrorBlock message={error} />
        <p style={{ fontSize: 11, color: '#1e1e2a', textAlign: 'center', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8, marginTop: 16 }}>
          Trial Intelligence Engine · Intelligence Package saved to case · All analysis is advisory — the lawyer decides.
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 9, color: T.mute, letterSpacing: '.18em', textTransform: 'uppercase', fontFamily: "'Times New Roman', Times, serif", marginBottom: 5 }}>
            AFS Advocates · Trial Intelligence Engine · Step 4
          </p>
          <h1 style={{ fontSize: 26, color: '#111111', fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.02em' }}>
            Intelligence Engine
          </h1>
        </div>
        {(stage > 1 || (stage === 1 && rawFacts.trim())) && (
          <button
            onClick={resetPipeline}
            style={{ background: 'transparent', border: '1px solid #2a1818', color: '#604040', borderRadius: 4, padding: '6px 13px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', flexShrink: 0 }}>
            ↺ Reset Pipeline
          </button>
        )}
      </div>

      {/* Phase 1A — Role Gate: fires when counsel_role is absent. Blocks all pipeline stages. */}
      {roleGateActive ? (
        <RoleGate />
      ) : (
        <>
          {/* Phase 1A — Pipeline Banner: persistent strip confirming role + pipeline after gate clears */}
          <PipelineBanner />

          <TIESteps />

          {stage === 0   && <Stage0 />}
          {stage === 0.5 && <Stage0_5 />}
          {stage === 1   && <Stage1 />}
          {stage === 2   && <Stage2 />}
          {stage === 3   && <Stage3 />}
          {stage === 4   && <Stage4 />}
          {stage === 5   && <Stage5 />}
        </>
      )}
    </div>
  );
}
