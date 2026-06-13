/**
 * AFS Advocates — Procedural Compliance Engine
 * Phase 2 — Full implementation
 *
 * Audits procedural posture at every stage of Nigerian litigation:
 * limitation periods, originating process, service validity, affidavit
 * defects, pre-action compliance, jurisdiction, locus standi, parties.
 *
 * Four sub-modules:
 *  1. Full Compliance Audit  — configurable area checklist + AI audit
 *  2. Limitation Calculator  — cause of action → all Nigerian deadlines
 *  3. Affidavit Checker      — paste affidavit → defect analysis
 *  4. Service Validator      — service facts → validity assessment
 */

import React, { useState, useEffect, useRef } from 'react';
import type { Case }       from '@/types';
import { T }               from '@/constants/tokens';
import { callClaude }    from '@/services/api';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, Spinner }     from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const ACC   = '#c07030';
const LIGHT = '#e09050';
const DIM   = '#7a4820';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PCE_STAGES_CIVIL = [
  'Pre-Filing / Pre-Action',
  'Originating Process',
  'Service of Process',
  'Pleadings Stage',
  'Pre-Trial / Case Management',
  'Trial Stage',
  'Post-Trial / Judgment',
  'Appeal Stage',
];

const PCE_STAGES_CRIMINAL = [
  'Investigation',
  'Charge & Arraignment',
  'Plea',
  'Prosecution Case',
  'No-Case Submission',
  'Defence Case',
  'Final Addresses',
  'Judgment',
  'Sentencing',
  'Appeal',
];

const COUNSEL_ROLE_LABELS_LOCAL: Record<string, string> = {
  claimant_side:  'Claimant Side',
  defendant_side: 'Defendant Side',
  prosecution:    'Prosecution',
  defence:        'Defence',
};

const PCE_AUDIT_TYPES: Array<{
  id:   string;
  icon: string;
  label: string;
  desc: string;
}> = [
  { id: 'limitation',   icon: '⏱', label: 'Limitation Period',    desc: 'Has the right to sue expired? Any extensions, acknowledgments, or saving provisions?' },
  { id: 'originating',  icon: '§',  label: 'Originating Process',  desc: 'Wrong originating process? Competence, endorsement, suit number, proper court form?' },
  { id: 'service',      icon: '✉',  label: 'Service Validity',     desc: 'Was process properly served? Mode, proof, time, substituted service if applicable?' },
  { id: 'parties',      icon: '👥', label: 'Proper Parties',       desc: 'Right claimant? Right defendant? Capacity? Representative capacity? Misjoinder/non-joinder?' },
  { id: 'preaction',    icon: '⚠',  label: 'Pre-Action Notice',    desc: 'Mandatory notice required? Statutory conditions precedent satisfied before filing?' },
  { id: 'affidavit',    icon: '📜', label: 'Affidavit Defects',    desc: 'Sworn before proper officer? Exhibits properly identified? Hearsay properly attributed?' },
  { id: 'jurisdiction', icon: '⚖',  label: 'Jurisdiction',         desc: 'Subject matter jurisdiction? Territorial jurisdiction? Pecuniary jurisdiction? Proper court?' },
  { id: 'locus',        icon: '◈',  label: 'Locus Standi',         desc: 'Does the claimant have standing? Sufficient interest? Recognisable cause of action?' },
  { id: 'deadlines',    icon: '⏱', label: 'Procedural Deadlines', desc: 'Time to file defence, reply, witness statements, hearing notices — within time?' },
  { id: 'conditions',   icon: '✓',  label: 'Conditions Precedent', desc: 'Statutory pre-conditions met? Notices given? Internal processes exhausted if required?' },
];

const AFF_TYPES = [
  'Supporting Affidavit (Motion)',
  'Counter-Affidavit',
  'Affidavit of Service',
  'Further Affidavit',
  'Affidavit of Facts',
  'Affidavit in Proof of Title',
  'Affidavit to Lead Secondary Evidence',
];

const PROCESS_TYPES = [
  'Writ of Summons',
  'Originating Summons',
  'Motion on Notice',
  'Motion Ex Parte',
  'Notice of Appeal',
  'Garnishee Order Nisi',
  'Writ of Fifa',
  'Judgment / Court Order',
  'Third-Party Notice',
  'Hearing Notice',
];

const DEFENDANT_TYPES = [
  'Private individual',
  'Private company',
  'State government / ministry',
  'Federal government / ministry',
  'Public officer',
  'Statutory body',
  'Bank / financial institution',
  'Local government',
];

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — IndexedDB via blind_spots table
//
// Each sub-component holds a blobRef (seeded by its useEffect load) so that
// savePce never has to re-read from DB before writing. This avoids the
// read-modify-write race that fire-and-forget async merges can cause.
// ─────────────────────────────────────────────────────────────────────────────

function makePce(caseId: string, blobRef: React.MutableRefObject<Record<string, unknown>>) {
  return function savePce(key: string, val: unknown): void {
    blobRef.current = { ...blobRef.current, [key]: val };
    saveBlindSpot(caseId, 'compliance', blobRef.current);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function pceCall(system: string, prompt: string, maxTokens = 2000): Promise<string> {
  return callClaude({ system, userMsg: prompt, maxTokens });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE-AWARE SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildComplianceSystem(activeCase: Case): string {
  const track = activeCase.matter_track ?? 'civil';
  const role  = activeCase.counsel_role ?? (track === 'criminal' ? 'defence' : 'claimant_side');
  const roleLabel  = COUNSEL_ROLE_LABELS_LOCAL[role] ?? role;
  const trackLabel = track === 'criminal' ? 'Criminal' : 'Civil';

  const roleContext = track === 'criminal'
    ? role === 'prosecution'
      ? 'You are advising prosecution counsel. Flag compliance risks that could result in acquittal, evidence exclusion, or ACJA violations. Highlight issues the defence could exploit.'
      : 'You are advising defence counsel. Identify every procedural defect, constitutional violation, or compliance gap that could benefit the accused — including grounds for discharge, exclusion of evidence, or bail.'
    : role === 'claimant_side'
      ? 'You are advising claimant\'s counsel. Flag compliance risks that could defeat the claim — limitation expiry, defective process, service failure, or standing issues.'
      : 'You are advising defendant\'s counsel. Identify every procedural defect the defendant can exploit — invalid service, limitation, wrong originating process, or absence of pre-action compliance.';

  return `You are a Nigerian litigation procedural compliance expert acting for ${roleLabel} on a ${trackLabel} matter. Cite specific Nigerian statutes, Rules of Court, and court decisions. Be precise and actionable. ${roleContext}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function PCESection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 3, height: 16, background: ACC, borderRadius: 2, flexShrink: 0 }} />
        <p style={{
          fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700, margin: 0,
        }}>
          {title}
        </p>
      </div>
      {children}
    </div>
  );
}

function PCEBtn({
  onClick, disabled, children, variant = 'primary', small = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
}) {
  const base: React.CSSProperties = {
    borderRadius:  5,
    cursor:        disabled ? 'not-allowed' : 'pointer',
    fontFamily:    "'Times New Roman', Times, serif",
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    fontWeight:    700,
    transition:    'all .2s',
    display:       'inline-flex',
    alignItems:    'center',
    gap:           6,
    opacity:       disabled ? 0.4 : 1,
    border:        'none',
  };
  const styles: Record<string, React.CSSProperties> = {
    primary: { ...base, background: `linear-gradient(135deg,${ACC},#904820)`, color: '#fff', padding: small ? '8px 16px' : '11px 22px', fontSize: small ? 10 : 11 },
    ghost:   { ...base, background: 'transparent', color: ACC, border: `1px solid ${ACC}55`, padding: small ? '7px 14px' : '10px 20px', fontSize: small ? 10 : 11 },
    danger:  { ...base, background: 'transparent', color: '#c04040', border: '1px solid #4a1010', padding: small ? '7px 14px' : '10px 20px', fontSize: small ? 10 : 11 },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={styles[variant]}>
      {children}
    </button>
  );
}

function PCEAIBlock({ loading, result, error }: { loading: boolean; result: string; error: string }) {
  if (!loading && !result && !error) return null;
  return (
    <div style={{
      marginTop: 14, background: '#08060e',
      border: `1px solid ${ACC}33`, borderRadius: 6,
      padding: '16px 18px', animation: 'fadeUp .3s ease',
    }}>
      {loading && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Spinner size={14} color={ACC} />
          <p style={{ fontSize: 12, color: DIM, fontFamily: "'Times New Roman', Times, serif", marginTop: 10 }}>
            Running compliance audit…
          </p>
        </div>
      )}
      {error && !loading && (
        <p style={{ fontSize: 13, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {error}
        </p>
      )}
      {result && !loading && <Md text={result} />}
    </div>
  );
}

const taBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '12px 14px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
  outline: 'none', resize: 'vertical', lineHeight: 1.8,
  boxSizing: 'border-box',
};

const selBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 12px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif", outline: 'none',
};

const inpBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 12px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
  outline: 'none', boxSizing: 'border-box',
};

const lbl: React.CSSProperties = {
  fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase',
  fontWeight: 600, display: 'block', marginBottom: 6,
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 1: Full Compliance Audit
// ─────────────────────────────────────────────────────────────────────────────

function PCEFullAudit({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [stage,  setStage]  = useState('');
  const [facts,  setFacts]  = useState('');
  const [checks, setChecks] = useState<string[]>([]);
  const blobRef = useRef<Record<string, unknown>>({});
  const savePce = makePce(caseId, blobRef);

  useEffect(() => {
    loadBlindSpot<Record<string, unknown>>(caseId, 'compliance', {}).then(d => {
      blobRef.current = d;
      setFacts((d['audit_facts'] as string) ?? '');
      setChecks((d['audit_checks'] as string[]) ?? []);
    });
  }, [caseId]);
  const [aiRes,  setAiRes]  = useState('');
  const [load,   setLoad]   = useState(false);
  const [err,    setErr]    = useState('');

  function toggleCheck(id: string) {
    const next = checks.includes(id) ? checks.filter(x => x !== id) : [...checks, id];
    setChecks(next);
    savePce('audit_checks', next);
  }

  async function runAudit() {
    if (!facts.trim()) return;
    setLoad(true); setErr(''); setAiRes('');

    const scope = checks.length
      ? PCE_AUDIT_TYPES.filter(t => checks.includes(t.id)).map(t => t.label).join(', ')
      : 'Full audit — all areas';

    const roleLabel  = COUNSEL_ROLE_LABELS_LOCAL[activeCase.counsel_role ?? ''] ?? activeCase.role ?? 'Claimant';
    const trackLabel = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';

    const prompt = `You are a senior Nigerian litigation counsel performing a procedural compliance audit.

CASE: ${activeCase.caseName || 'Untitled'} | COURT: ${activeCase.court || 'Not specified'} | TRACK: ${trackLabel} | ROLE: ${roleLabel} | STAGE: ${stage || 'Not specified'}

AUDIT SCOPE: ${scope}

CASE FACTS & PROCEDURAL HISTORY:
${facts}

Conduct a rigorous procedural compliance audit. For each applicable compliance area:

## [AREA NAME]
**Status:** COMPLIANT / AT RISK / DEFECTIVE / UNCLEAR — needs more facts
**Analysis:** The specific procedural requirement and whether it has been met.
**Statute/Rule:** The specific provision under Nigerian law (Evidence Act 2011, Rules of Court, relevant statute).
**Risk Level:** HIGH / MEDIUM / LOW
**Recommended Action:** What must be done immediately, if anything.

End with:
## COMPLIANCE SUMMARY
A priority-ranked list of actions — what must be addressed before the next step.

Be precise. Cite Nigerian statutes and Rules of Court. Do not generalise.`;

    try {
      const text = await pceCall(
        buildComplianceSystem(activeCase),
        prompt,
        2000,
      );
      setAiRes(text);
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  return (
    <div>
      <PCESection title="Compliance Audit — Case Facts">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 16 }}>
          Describe the procedural history of this matter. The AI audits every compliance area for defects and risks.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Current Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)} style={selBase}>
            <option value=''>Select current stage…</option>
            {(activeCase.matter_track === 'criminal' ? PCE_STAGES_CRIMINAL : PCE_STAGES_CIVIL).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <textarea
          value={facts}
          onChange={e => { setFacts(e.target.value); savePce('audit_facts', e.target.value); }}
          placeholder={
            'Describe the procedural history:\n\n' +
            '• When was the matter filed? Which court?\n' +
            '• How was process served and when?\n' +
            '• What has been filed by each party?\n' +
            '• Any court orders made?\n' +
            '• Any preliminary objections raised?\n' +
            '• What is the current procedural stage?\n\n' +
            'The more specific the facts, the more precise the compliance audit.'
          }
          rows={8}
          style={taBase}
        />
      </PCESection>

      <PCESection title="Select Audit Areas">
        <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 14 }}>
          Select specific areas to audit, or leave all unselected to run a full audit across all areas.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          {PCE_AUDIT_TYPES.map(t => {
            const sel = checks.includes(t.id);
            return (
              <div
                key={t.id}
                onClick={() => toggleCheck(t.id)}
                style={{
                  background:  sel ? '#120c08' : '#080810',
                  border:      `1px solid ${sel ? ACC : '#cccccc'}`,
                  borderRadius: 6,
                  padding:     '11px 14px',
                  cursor:      'pointer',
                  transition:  'all .2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: 3,
                    border: `1.5px solid ${sel ? ACC : '#3a3a5a'}`,
                    background: sel ? ACC : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'all .2s',
                  }}>
                    {sel && <span style={{ fontSize: 9, color: '#fff', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 11, color: sel ? LIGHT : T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                    {t.label}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, paddingLeft: 22, margin: 0 }}>
                  {t.desc}
                </p>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <PCEBtn onClick={runAudit} disabled={load || !facts.trim()}>
            {load ? <><Spinner size={10} color="#fff" /> Auditing…</> : '⚙ Run Compliance Audit'}
          </PCEBtn>
          {checks.length > 0 && (
            <PCEBtn
              onClick={() => { setChecks([]); savePce('audit_checks', []); }}
              variant="ghost" small
            >
              Clear Selection
            </PCEBtn>
          )}
          <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
            {checks.length === 0
              ? 'All areas selected'
              : `${checks.length} area${checks.length > 1 ? 's' : ''} selected`}
          </span>
        </div>

        <PCEAIBlock loading={load} result={aiRes} error={err} />
      </PCESection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 2: Limitation Period Calculator
// ─────────────────────────────────────────────────────────────────────────────

function PCELimitationCalc({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [coa,     setCoa]    = useState('');
  const [td,      setTd]     = useState('');
  const [extras,  setExtras] = useState('');
  const blobRef = useRef<Record<string, unknown>>({});
  const savePce = makePce(caseId, blobRef);

  useEffect(() => {
    loadBlindSpot<Record<string, unknown>>(caseId, 'compliance', {}).then(d => {
      blobRef.current = d;
      setCoa((d['lim_coa'] as string) ?? '');
      setTd((d['lim_td'] as string) ?? '');
      setExtras((d['lim_extras'] as string) ?? '');
    });
  }, [caseId]);
  const [defType, setDefType] = useState('');
  const [aiRes,   setAiRes]  = useState('');
  const [load,    setLoad]   = useState(false);
  const [err,     setErr]    = useState('');

  async function run() {
    if (!coa.trim()) return;
    setLoad(true); setErr(''); setAiRes('');

    const prompt = `Nigerian Litigation — Limitation Period Analysis.

CAUSE OF ACTION: ${coa}
TRIGGER DATE: ${td || 'Not specified — identify the correct trigger event'}
COURT: ${activeCase.court || 'Not specified'}
DEFENDANT TYPE: ${defType || 'Not specified'}
ADDITIONAL FACTS: ${extras || 'None'}

Provide:
## APPLICABLE LIMITATION PERIOD
The specific limitation period and the statute/section that creates it.

## TRIGGER DATE ANALYSIS
What event starts the limitation clock running? Accrual, discovery, breach, refusal?

## CURRENT STATUS
If trigger date provided: is the limitation period still open, or has it expired?

## EXTENSION PROVISIONS
Any disability, fraud, concealment, acknowledgment, or part payment that could extend or restart time.

## PRE-ACTION NOTICE REQUIREMENTS
Any mandatory notice periods that must be given before suit can be filed (e.g. government bodies, public authorities, financial institutions).

## CRITICAL DEADLINES
Every time-sensitive step with the specific date if trigger date was provided.

## RISK ASSESSMENT
Is there any limitation risk in this matter? What must be done immediately?

Cite specific Nigerian statutes: Limitation Law of Lagos/Rivers/applicable state, Public Officers Protection Act, CAMA, relevant sector statutes.`;

    try {
      const text = await pceCall('', prompt, 1500);
      setAiRes(text);
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <PCESection title="Limitation Period Analysis">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 16 }}>
          Enter the cause of action and trigger date. The engine maps every applicable limitation period,
          pre-action notice requirement, and extension provision under Nigerian law.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Cause of Action *</label>
          <textarea
            value={coa}
            onChange={e => { setCoa(e.target.value); savePce('lim_coa', e.target.value); }}
            rows={3}
            placeholder={
              'e.g. Breach of contract — failure to pay balance of purchase price\n' +
              'or: Negligence — accident causing personal injury\n' +
              'or: Recovery of land — trespass and wrongful occupation\n' +
              'or: Wrongful dismissal under employment contract'
            }
            style={taBase}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Trigger Date</label>
            <input
              type="date"
              value={td}
              onChange={e => { setTd(e.target.value); savePce('lim_td', e.target.value); }}
              style={{ ...inpBase, padding: '11px 12px' }}
            />
          </div>
          <div>
            <label style={lbl}>Defendant Type</label>
            <select value={defType} onChange={e => setDefType(e.target.value)} style={selBase}>
              <option value=''>Select if relevant…</option>
              {DEFENDANT_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Additional Facts</label>
          <textarea
            value={extras}
            onChange={e => { setExtras(e.target.value); savePce('lim_extras', e.target.value); }}
            rows={3}
            placeholder="Any disability? Fraud or concealment? Acknowledgment of debt? Part payment? Minor plaintiff? Was the claimant incapacitated?"
            style={taBase}
          />
        </div>

        <PCEBtn onClick={run} disabled={load || !coa.trim()}>
          {load ? <><Spinner size={10} color="#fff" /> Calculating…</> : '⏱ Analyse Limitation Period'}
        </PCEBtn>
        <PCEAIBlock loading={load} result={aiRes} error={err} />
      </PCESection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 3: Affidavit Defect Checker
// ─────────────────────────────────────────────────────────────────────────────

function PCEAffidavitCheck({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [affText, setAffText] = useState('');
  const [affType, setAffType] = useState('');
  const [aiRes,   setAiRes]   = useState('');
  const [load,    setLoad]    = useState(false);
  const [err,     setErr]     = useState('');

  async function run() {
    if (!affText.trim()) return;
    setLoad(true); setErr(''); setAiRes('');

    const prompt = `Nigerian court affidavit defect analysis. Court: ${activeCase.court || 'Not specified'}.

AFFIDAVIT TYPE: ${affType || 'Not specified'}
AFFIDAVIT TEXT:
${affText}

Analyse for defects under the Evidence Act 2011 and applicable Rules of Court:

## FORMAL DEFECTS
Check: proper jurat, date, commissioner for oaths/deponent rank, oath vs affirmation, witness signature.

## PARAGRAPH NUMBERING & STRUCTURE
Check: paragraphs numbered consecutively, each paragraph contains single statement of fact.

## HEARSAY COMPLIANCE
Identify any hearsay paragraphs. Are sources of information and belief correctly attributed per Section 115, Evidence Act 2011?

## EXHIBIT COMPLIANCE
Are exhibits referenced correctly? Proper identification markings? Exhibited before swearing?

## DEPONENT COMPETENCE
Is the deponent competent? Do they have personal knowledge or have they correctly attributed sources?

## ARGUMENTATIVE / LEGAL CONCLUSION PARAGRAPHS
Identify any paragraphs that contain legal arguments or conclusions — these are objectionable.

## REBUTTAL VULNERABILITY
What paragraphs are most vulnerable to a motion to strike? How would opposing counsel attack this affidavit?

## CORRECTIVE ACTION
For each defect: the specific correction required before the affidavit is court-ready.

Be specific. Reference Evidence Act 2011 sections and applicable court rules.`;

    try {
      const text = await pceCall('', prompt, 1800);
      setAiRes(text);
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <PCESection title="Affidavit Defect Checker">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 16 }}>
          Paste the affidavit text. The engine checks for every defect that opposing counsel could exploit —
          formal, structural, hearsay, exhibit, and argumentative paragraph issues.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Affidavit Type</label>
          <select value={affType} onChange={e => setAffType(e.target.value)} style={selBase}>
            <option value=''>Select type…</option>
            {AFF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <textarea
          value={affText}
          onChange={e => setAffText(e.target.value)}
          placeholder="Paste the full affidavit text here — from the heading and introduction through to the jurat and signature block. The more complete the text, the more thorough the defect analysis."
          rows={12}
          style={{ ...taBase, marginBottom: 14 }}
        />

        <PCEBtn onClick={run} disabled={load || !affText.trim()}>
          {load ? <><Spinner size={10} color="#fff" /> Checking…</> : '📜 Check for Defects'}
        </PCEBtn>
        <PCEAIBlock loading={load} result={aiRes} error={err} />
      </PCESection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 4: Service of Process Validator
// ─────────────────────────────────────────────────────────────────────────────

function PCEServiceCheck({ caseId, activeCase }: { caseId: string; activeCase: Case }) {
  const [details,     setDetails]     = useState('');
  const [processType, setProcessType] = useState('');
  const [aiRes,       setAiRes]       = useState('');
  const [load,        setLoad]        = useState(false);
  const [err,         setErr]         = useState('');

  async function run() {
    if (!details.trim()) return;
    setLoad(true); setErr(''); setAiRes('');

    const prompt = `Nigerian court — service of process validity analysis.

COURT: ${activeCase.court || 'Not specified'} | CASE: ${activeCase.caseName || ''}
PROCESS TYPE: ${processType || 'Not specified'}
SERVICE DETAILS:
${details}

Analyse validity of service under Nigerian procedural rules:

## SERVICE METHOD ANALYSIS
Was the mode of service appropriate for this type of process and defendant? Personal service / substituted service / postal service / service on solicitor — each has specific requirements.

## TECHNICAL COMPLIANCE
Timeline of service from filing. Days required before hearing. Whether Rules of Court were strictly followed.

## PROOF OF SERVICE
Is the proof of service (affidavit of service / certificate) adequate? What must it contain?

## SUBSTITUTED SERVICE
If substituted service was used or is needed: the procedural steps, court order requirements, and how proof is established.

## SERVICE ON SPECIAL DEFENDANTS
If applicable: government entities (Attorney General notice, 30-day pre-action), corporate defendants, persons in custody, persons outside jurisdiction.

## DEFECT ASSESSMENT
Any defect that could void service or give the defendant grounds to object?

## CURATIVE STEPS
If service is defective: can it be cured? How? What order must be sought?

Cite applicable Rules of Court (High Court Civil Procedure Rules, Sheriffs and Civil Process Act, Foreign Judgments Act if applicable).`;

    try {
      const text = await pceCall('', prompt, 1500);
      setAiRes(text);
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <PCESection title="Service of Process Validator">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 16 }}>
          Describe how service was effected — or how you intend to effect service. The engine checks validity,
          proof requirements, and any defects that could be exploited.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Process Type</label>
          <select value={processType} onChange={e => setProcessType(e.target.value)} style={selBase}>
            <option value=''>Select process…</option>
            {PROCESS_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <textarea
          value={details}
          onChange={e => setDetails(e.target.value)}
          placeholder={
            'Describe the service:\n\n' +
            '• How was service effected? (personal, substituted, postal, via lawyer)\n' +
            '• Who served the process and when?\n' +
            '• Where was the defendant served?\n' +
            '• How many days before hearing was service effected?\n' +
            '• Who is the defendant? (individual, company, government body)\n' +
            '• Was an affidavit of service filed? What does it say?\n\n' +
            'Or describe how you intend to serve if service has not yet been effected.'
          }
          rows={8}
          style={{ ...taBase, marginBottom: 14 }}
        />

        <PCEBtn onClick={run} disabled={load || !details.trim()}>
          {load ? <><Spinner size={10} color="#fff" /> Validating…</> : '✉ Validate Service'}
        </PCEBtn>
        <PCEAIBlock loading={load} result={aiRes} error={err} />
      </PCESection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

type SubTab = 'audit' | 'limitation' | 'affidavit' | 'service';

interface Props {
  activeCase: Case;
}

export function ComplianceEngine({ activeCase }: Props) {
  const caseId = activeCase.id;
  const [sub, setSub] = useState<SubTab>('audit');

  const SUB_TABS: Array<{ id: SubTab; icon: string; label: string }> = [
    { id: 'audit',      icon: '⚙',  label: 'Full Compliance Audit' },
    { id: 'limitation', icon: '⏱', label: 'Limitation Period'     },
    { id: 'affidavit',  icon: '📜', label: 'Affidavit Checker'     },
    { id: 'service',    icon: '✉',  label: 'Service Validator'     },
  ];

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* Engine header */}
      <div style={{
        background:   '#100a06',
        border:       `1px solid ${ACC}33`,
        borderRadius:  8,
        padding:      '16px 20px',
        marginBottom:  20,
        display:      'flex',
        alignItems:   'center',
        gap:           14,
      }}>
        <span style={{ fontSize: 24, opacity: .7 }}>⚙</span>
        <div>
          <p style={{
            fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.18em', textTransform: 'uppercase',
            fontWeight: 700, marginBottom: 3,
          }}>
            Procedural Compliance Engine · {activeCase.caseName}
          </p>
          <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', margin: 0 }}>
            Procedural defects lose cases before the first witness is called. Audit everything.
          </p>
        </div>
      </div>

      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              background:    sub === t.id ? '#120a06' : 'transparent',
              border:        `1px solid ${sub === t.id ? ACC : '#cccccc'}`,
              color:         sub === t.id ? LIGHT : T.mute,
              borderRadius:  5,
              padding:       '8px 14px',
              fontSize:      11,
              fontFamily:    "'Times New Roman', Times, serif",
              cursor:        'pointer',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              fontWeight:    600,
              display:       'flex',
              alignItems:    'center',
              gap:           6,
              transition:    'all .2s',
            }}
          >
            <span style={{ fontSize: 13 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-module panels */}
      {sub === 'audit'      && <PCEFullAudit      caseId={caseId} activeCase={activeCase} />}
      {sub === 'limitation' && <PCELimitationCalc caseId={caseId} activeCase={activeCase} />}
      {sub === 'affidavit'  && <PCEAffidavitCheck caseId={caseId} activeCase={activeCase} />}
      {sub === 'service'    && <PCEServiceCheck   caseId={caseId} activeCase={activeCase} />}
    </div>
  );
}
