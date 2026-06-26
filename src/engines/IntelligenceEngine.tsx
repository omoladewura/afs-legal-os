/**
 * AFS Advocates — Trial Intelligence Engine
 * Phase 2 — Full implementation
 *
 * 5-step pipeline:
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
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaude, withRetry } from '@/services/api';
import { Spinner, ErrorBlock, RoleBadge, Md } from '@/components/common/ui';
import { copyToClipboard } from '@/utils';
import { getPartyLabels } from '@/utils/getPartyLabels';
import { db } from '@/storage/db';

// ── Step definitions ───────────────────────────────────────────────────────────

const TIE_STEPS = [
  { id: 1, label: 'Raw Facts' },
  { id: 2, label: 'Extraction + Audit' },
  { id: 3, label: 'Follow-Up' },
  { id: 4, label: 'Evidence Map' },
  { id: 5, label: 'Package + Risk' },
];

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

export function IntelligenceEngine({ activeCase, onSave }: Props) {
  const saved = (activeCase.intelligence_data || {}) as unknown as Partial<TIEData>;

  const isDefendant = activeCase.counsel_role === 'defendant_side';
  const [stage,              setStage]              = useState<number>(
    saved.stage ?? (isDefendant && !saved.rawFacts ? 0 : 1)
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
      const raw = await withRetry(() => callClaude({
        system: `You are a trial intelligence extraction engine for Nigerian litigation.
Extract structured intelligence from the raw case facts provided by the user.
Role-aware: the lawyer acts for the ${role}.
Case context: ${caseCtx}

COUNTERCLAIM DETECTION: Where this is a civil matter, actively assess whether the facts disclose a viable counterclaim — an independent cause of action arising from the same transaction or facts (available to the opposing side, or to our client if we act for the defendant) that could be raised as a cross-claim under the applicable Rules of Civil Procedure. A counterclaim is distinct from a mere defence or set-off: it seeks affirmative relief in its own right, not merely a denial of liability. Set "counterclaim_detected.flag" to true only where one is reasonably disclosed on the facts, and write a one-to-two sentence "counterclaim_detected.summary" stating who would bring it, against whom, and the cause of action. Do not fabricate a counterclaim where the facts do not support one — if this is not a civil matter, or no counterclaim is disclosed, set "flag" to false and omit "summary".

Output ONLY valid JSON — no markdown fences, no preamble, no explanation. Exactly this structure:
{
  "timeline": [{"date":"...","event":"...","significance":"..."}],
  "established_facts": ["..."],
  "disputed_areas": ["..."],
  "legal_issues": ["..."],
  "evidence_mentioned": ["..."],
  "gaps_identified": ["..."],
  "initial_risks": [{"risk":"...","severity":"HIGH|MEDIUM|LOW"}],
  "counterclaim_detected": {"flag": true|false, "summary": "..."}
}

Rules:
- Every string value must be properly escaped. Never use unescaped double quotes inside string values.
- Use single quotes or rephrase if quoting speech — never raw double quotes inside JSON strings.
- Output ONLY the JSON object. Nothing before it, nothing after it.`,
        userMsg: `RAW FACTS / CLIENT NARRATION:\n\n${rawFacts}`,
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
    } catch (e) {
      setError('Extraction failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
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
    const resetStage = isDefendant ? 0 : 1;
    onSave({ stage: resetStage, rawFacts: '', extraction: null, followUpQs: [], followUpAs: {}, evidenceM: null, intPkg: '', commencement_audit: undefined, counterclaim_detected: undefined, conflict_scan: undefined, risk_verdict: undefined, authority_grounding: undefined, served_process_analysis: undefined });
    setSpaResult(undefined);
    setProcessText('');
    setStage(resetStage);
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
  // ── Phase 2C — Served Process Analysis ──────────────────────────────────────
  async function runServedProcessAnalysis() {
    if (processText.trim().length < 80) {
      setSpaError('Please paste more of the served process — at least 80 characters needed for meaningful analysis.');
      return;
    }
    setSpaLoading(true); setSpaError('');
    try {
      const raw = await withRetry(() => callClaude({
        systemMsg: `You are a Senior Advocate analysing an originating process served on our client (the Defendant/Respondent). Extract and structure the following from the document.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "process_type": "one of: Writ of Summons | Originating Summons | Originating Motion | Petition | Charge | Other — identify from the document",
  "claimant_theory": "2–3 sentences: the Claimant's legal theory and what they are trying to establish",
  "claims_identified": ["each distinct claim or relief sought, as a separate string"],
  "factual_allegations": ["each key factual allegation made against the Defendant, as a separate string"],
  "counterclaim_hints": ["any facts that suggest the Defendant may have a counterclaim — state the basis briefly; empty array if none"],
  "procedural_deadlines": ["any deadlines stated or implied: e.g. 'Enter appearance within 8 days of service', '30 days to file defence' — empty array if none mentioned"],
  "summary": "one sentence: what this matter is about and what is being claimed"
}`,
        userMsg: `SERVED PROCESS:\n\n${processText}\n\nCase: ${activeCase.caseName}\nCourt: ${activeCase.court || 'Not specified'}`,
      }));

      let parsed: Omit<IntelligenceData['served_process_analysis'], 'run_at' | 'process_text'>;
      try {
        const clean = raw.replace(/\`\`\`json|\`\`\`/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        throw new Error('Analysis returned unexpected format — please try again.');
      }

      const spa: IntelligenceData['served_process_analysis'] = {
        run_at:              new Date().toISOString(),
        process_text:        processText,
        process_type:        parsed.process_type ?? 'Unknown',
        claimant_theory:     parsed.claimant_theory ?? '',
        claims_identified:   parsed.claims_identified ?? [],
        factual_allegations: parsed.factual_allegations ?? [],
        counterclaim_hints:  parsed.counterclaim_hints ?? [],
        procedural_deadlines: parsed.procedural_deadlines ?? [],
        summary:             parsed.summary ?? '',
      };

      setSpaResult(spa);

      // Seed rawFacts with the process text so Stage 1 has a starting point
      const seededFacts = \`[SERVED PROCESS — pasted by counsel]\n\n\${processText}\`;
      setRawFacts(seededFacts);

      advance(0.5, { served_process_analysis: spa, rawFacts: seededFacts });
    } catch (e: unknown) {
      setSpaError(e instanceof Error ? e.message : 'Analysis failed — please try again.');
    } finally {
      setSpaLoading(false);
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
          <p style={{ fontSize: 10, color: T.text, fontFamily: \"'Times New Roman', Times, serif\", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Intelligence Engine · Entry
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: \"'Times New Roman', Times, serif\", fontWeight: 300, marginBottom: 8 }}>
            How are we coming into this matter?
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: \"'Times New Roman', Times, serif\", lineHeight: 1.7 }}>
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
              <p style={{ fontSize: 15, color: '#c8c8e8', fontFamily: \"'Times New Roman', Times, serif\", fontWeight: 700, marginBottom: 5 }}>
                We Were Served
              </p>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: \"'Times New Roman', Times, serif\", lineHeight: 1.65 }}>
                A writ, originating summons, petition, or other process was served on {B}.
                Upload or paste the originating process — the engine will analyse the claim,
                extract the {A}'s theory, and identify counterclaim opportunities.
              </p>
              <p style={{ fontSize: 10, color: '#5050a0', fontFamily: \"'Times New Roman', Times, serif\", marginTop: 8, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
                Served Process Intake → Theory Extraction → Counterclaim Scan
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
              <p style={{ fontSize: 15, color: '#c8e8c8', fontFamily: \"'Times New Roman', Times, serif\", fontWeight: 700, marginBottom: 5 }}>
                Enter Raw Facts
              </p>
              <p style={{ fontSize: 12, color: T.mute, fontFamily: \"'Times New Roman', Times, serif\", lineHeight: 1.65 }}>
                We have the client's account of events but no served process yet — or we prefer to build
                the defence picture from our own instructions first. Proceed with the standard 5-step intelligence pipeline.
              </p>
              <p style={{ fontSize: 10, color: '#3a5a3a', fontFamily: \"'Times New Roman', Times, serif\", marginTop: 8, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
                Raw Facts → Extraction → Follow-Up → Evidence Map → Package
              </p>
            </div>
          </button>

        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 0.5 — Served Process Intake (Phase 2C)
  // ─────────────────────────────────────────────────────────────────────────
  function Stage0_5() {
    const spa = spaResult;
    const A = partyA;
    const B = partyB;

    // If analysis already done — show results + proceed options
    if (spa) {
      return (
        <div style={{ animation: 'fadeUp .3s ease' }}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
              Served Process Analysis · Complete
            </p>
            <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
              {spa.process_type} — Analysed
            </h2>
            <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              {spa.summary}
            </p>
          </div>

          <div style={{ background: '#0a0a18', border: '1px solid #1a1a30', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>

            {/* Claimant Theory */}
            <div style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 9, color: '#8080c0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                {A}'s Theory
              </p>
              <p style={{ fontSize: 13, color: '#c8c8e8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
                {spa.claimant_theory}
              </p>
            </div>

            {/* Claims */}
            {spa.claims_identified.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p style={{ fontSize: 9, color: '#8080c0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  Claims / Reliefs Sought
                </p>
                {spa.claims_identified.map((c, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #2a2a48', marginBottom: 5 }}>
                    {c}
                  </div>
                ))}
              </div>
            )}

            {/* Factual Allegations */}
            {spa.factual_allegations.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p style={{ fontSize: 9, color: '#c08040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  Allegations Against {B}
                </p>
                {spa.factual_allegations.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #3a2808', marginBottom: 5 }}>
                    {a}
                  </div>
                ))}
              </div>
            )}

            {/* Counterclaim Hints */}
            {spa.counterclaim_hints.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p style={{ fontSize: 9, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  Counterclaim Opportunities
                </p>
                {spa.counterclaim_hints.map((h, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #183028', marginBottom: 5 }}>
                    {h}
                  </div>
                ))}
              </div>
            )}

            {/* Procedural Deadlines */}
            {spa.procedural_deadlines.length > 0 && (
              <div>
                <p style={{ fontSize: 9, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                  Procedural Deadlines
                </p>
                {spa.procedural_deadlines.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, paddingLeft: 12, borderLeft: '2px solid #401818', marginBottom: 5 }}>
                    {d}
                  </div>
                ))}
              </div>
            )}
          </div>

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
              Continue → Add Client Instructions & Extract Intelligence
            </button>
            <button
              onClick={() => { setSpaResult(undefined); setProcessText(''); }}
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
            Step 0 · Served Process Intake
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
            Paste the Served Process
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            Paste the full text of the writ, originating summons, petition, or charge as served on {B}.
            The engine will extract {A}'s theory, the claims made, allegations against {B}, and counterclaim opportunities.
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
              'Paste the served process here:\n\n• Writ of Summons — include the endorsement and any annexed statement of claim\n• Originating Summons — include all questions and the supporting affidavit if attached\n• Petition — include all grounds\n• Charge Sheet — include the charges and particulars\n\nThe more complete the text, the sharper the analysis.'
            }
            style={{ ...iS, resize: 'vertical', lineHeight: 1.85, minHeight: 300, fontSize: 15 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: processText.length < 80 ? '#804040' : T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {processText.length} characters{processText.length < 80 ? ' · minimum 80' : ''}
            </span>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
              More text = sharper theory extraction
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
              <><Spinner size={14} /> Analysing Served Process…</>
            ) : (
              'Analyse Served Process →'
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
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Step 1 of 5 · Raw Facts
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
            Enter the Complete Case Narrative
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            Do not filter or organise — give the raw client story. Include dates, parties, conversations, documents, and events in any order. The AI will extract the structure.
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
          <label style={lbS}>
            Complete Case Narrative / Raw Facts <span style={{ color: '#b06060' }}>*</span>
          </label>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.65 }}>
            Include: what happened, when, between whom, what documents exist, what was said, what was agreed, what went wrong, who holds what evidence.
          </p>
          <textarea
            value={rawFacts}
            onChange={e => setRawFacts(e.target.value)}
            rows={13}
            placeholder={
              'Tell the full story of this matter:\n\n• What happened and when?\n• Who did what, to whom?\n• What documents, contracts, or communications exist?\n• What is the other side likely to say?\n• What outcome does the client want?\n\nDo not organise — give it raw. The engine will extract the intelligence.'
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

      <TIESteps />

      {stage === 0   && <Stage0 />}
      {stage === 0.5 && <Stage0_5 />}
      {stage === 1   && <Stage1 />}
      {stage === 2   && <Stage2 />}
      {stage === 3   && <Stage3 />}
      {stage === 4   && <Stage4 />}
      {stage === 5   && <Stage5 />}
    </div>
  );
}
