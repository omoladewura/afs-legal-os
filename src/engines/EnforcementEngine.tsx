/**
 * AFS Legal OS V2 — Enforcement Engine (Phase 7C)
 *
 * Dual-role civil engine: activated after judgment is obtained or received.
 * counsel_role determines which sub-tabs appear.
 *
 * CLAIMANT SIDE sub-tabs (judgment creditor):
 *   1. Judgment Summary      — record judgment details as enforcement anchor
 *   2. Enforcement Selector  — AI recommends best enforcement mechanism
 *   3. Writ Drafter          — draft Writ of Fieri Facias (FIFA)
 *   4. Garnishee             — draft Garnishee Order Nisi with affidavit
 *   5. Recovery Tracker      — log enforcement steps and amounts recovered
 *
 * DEFENDANT SIDE sub-tabs (judgment debtor):
 *   1. Judgment Summary      — record judgment details as response anchor
 *   2. Stay of Execution     — draft motion for stay of execution pending appeal
 *   3. Compliance Tracker    — track judgment obligations and payment schedule
 *   4. Appeal Grounds        — pull appeal grounds from case data, link to Appeal Engine
 *
 * matter_track is always 'civil' for this engine.
 * counsel_role must be claimant_side | defendant_side.
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

type ClaimSubTab = 'judgment_summary' | 'enforcement_selector' | 'writ_drafter' | 'garnishee' | 'recovery_tracker';
type DefSubTab   = 'judgment_summary_def' | 'stay_execution' | 'compliance_tracker' | 'appeal_grounds';
type SubTab      = ClaimSubTab | DefSubTab;

interface RecoveryStep {
  id:      string;
  date:    string;
  action:  string;
  amount:  string;
  notes:   string;
}

interface ComplianceStep {
  id:          string;
  date:        string;
  obligation:  string;
  done:        boolean;
}

interface SavedData {
  // Shared
  judgmentDate?:         string;
  judgmentCourt?:        string;
  reliefsGranted?:       string;
  amountAwarded?:        string;
  // Claimant
  selectedMechanism?:    string;
  enforcementContext?:   string;
  enforcementResult?:    string;
  writContext?:          string;
  writDraft?:            string;
  garnisheeContext?:     string;
  garnisheeDraft?:       string;
  recoverySteps?:        RecoveryStep[];
  // Defendant
  stayContext?:          string;
  stayDraft?:            string;
  complianceSteps?:      ComplianceStep[];
  appealGroundsContext?: string;
  appealGroundsResult?:  string;
  lastUpdated?:          string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEY
// ─────────────────────────────────────────────────────────────────────────────

const MODULE = 'enforcement_engine';

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
        <button onClick={onClear} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
          clear ×
        </button>
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
        width: '100%', background: '#08080e', color: T.text,
        border: '1px solid #cccccc', borderRadius: 6,
        padding: '10px 14px', fontSize: 13,
        fontFamily: "'Times New Roman', Times, serif",
        resize: 'vertical', boxSizing: 'border-box',
      }}
    />
  );
}

function Input({
  value, onChange, placeholder = '',
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#08080e', color: T.text,
        border: '1px solid #cccccc', borderRadius: 6,
        padding: '9px 14px', fontSize: 13,
        fontFamily: "'Times New Roman', Times, serif",
        boxSizing: 'border-box',
      }}
    />
  );
}

function SectionHead({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 16, paddingBottom: 8, borderBottom: `1px solid ${accent}20` }}>
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function EnforcementEngine({ activeCase }: Props) {
  const isClaim  = activeCase.counsel_role === 'claimant_side';
  const accent   = activeCase.counsel_role ? COUNSEL_ROLE_COLORS[activeCase.counsel_role].col : '#4090d0';

  const claimTabs: { id: ClaimSubTab; label: string }[] = [
    { id: 'judgment_summary',     label: 'Judgment Summary' },
    { id: 'enforcement_selector', label: 'Enforcement Selector' },
    { id: 'writ_drafter',         label: 'Writ of FIFA' },
    { id: 'garnishee',            label: 'Garnishee' },
    { id: 'recovery_tracker',     label: 'Recovery Tracker' },
  ];

  const defTabs: { id: DefSubTab; label: string }[] = [
    { id: 'judgment_summary_def', label: 'Judgment Summary' },
    { id: 'stay_execution',       label: 'Stay of Execution' },
    { id: 'compliance_tracker',   label: 'Compliance Tracker' },
    { id: 'appeal_grounds',       label: 'Appeal Grounds' },
  ];

  const [activeTab, setActiveTab] = useState<SubTab>(isClaim ? 'judgment_summary' : 'judgment_summary_def');

  // ── Shared fields ──────────────────────────────────────────────────────────
  const [judgmentDate,   setJudgmentDate]   = useState('');
  const [judgmentCourt,  setJudgmentCourt]  = useState('');
  const [reliefsGranted, setReliefsGranted] = useState('');
  const [amountAwarded,  setAmountAwarded]  = useState('');

  // ── Claimant fields ────────────────────────────────────────────────────────
  const [selectedMechanism,  setSelectedMechanism]  = useState('');
  const [enforcementContext, setEnforcementContext]  = useState('');
  const [enforcementResult,  setEnforcementResult]  = useState('');
  const [writContext,        setWritContext]         = useState('');
  const [writDraft,          setWritDraft]           = useState('');
  const [garnisheeContext,   setGarnisheeContext]    = useState('');
  const [garnisheeDraft,     setGarnisheeDraft]      = useState('');
  const [recoverySteps,      setRecoverySteps]       = useState<RecoveryStep[]>([]);

  // ── Defendant fields ───────────────────────────────────────────────────────
  const [stayContext,          setStayContext]          = useState('');
  const [stayDraft,            setStayDraft]            = useState('');
  const [complianceSteps,      setComplianceSteps]      = useState<ComplianceStep[]>([]);
  const [appealGroundsContext, setAppealGroundsContext] = useState('');
  const [appealGroundsResult,  setAppealGroundsResult]  = useState('');

  // ── Recovery row form ──────────────────────────────────────────────────────
  const [newStep, setNewStep] = useState<Omit<RecoveryStep, 'id'>>({ date: '', action: '', amount: '', notes: '' });

  // ── Compliance row form ────────────────────────────────────────────────────
  const [newObligation, setNewObligation] = useState<Omit<ComplianceStep, 'id'>>({ date: '', obligation: '', done: false });

  const { generate, loading, error } = useAI();

  // ── Load saved data ────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = loadBlindSpot<SavedData>(activeCase.id, MODULE, {});
    if (saved.judgmentDate)         setJudgmentDate(saved.judgmentDate);
    if (saved.judgmentCourt)        setJudgmentCourt(saved.judgmentCourt);
    if (saved.reliefsGranted)       setReliefsGranted(saved.reliefsGranted);
    if (saved.amountAwarded)        setAmountAwarded(saved.amountAwarded);
    if (saved.selectedMechanism)    setSelectedMechanism(saved.selectedMechanism);
    if (saved.enforcementContext)   setEnforcementContext(saved.enforcementContext);
    if (saved.enforcementResult)    setEnforcementResult(saved.enforcementResult);
    if (saved.writContext)          setWritContext(saved.writContext);
    if (saved.writDraft)            setWritDraft(saved.writDraft);
    if (saved.garnisheeContext)     setGarnisheeContext(saved.garnisheeContext);
    if (saved.garnisheeDraft)       setGarnisheeDraft(saved.garnisheeDraft);
    if (saved.recoverySteps)        setRecoverySteps(saved.recoverySteps);
    if (saved.stayContext)          setStayContext(saved.stayContext);
    if (saved.stayDraft)            setStayDraft(saved.stayDraft);
    if (saved.complianceSteps)      setComplianceSteps(saved.complianceSteps);
    if (saved.appealGroundsContext) setAppealGroundsContext(saved.appealGroundsContext);
    if (saved.appealGroundsResult)  setAppealGroundsResult(saved.appealGroundsResult);
  }, [activeCase.id]);

  // ── Save helper ────────────────────────────────────────────────────────────
  const persist = useCallback((patch: Partial<SavedData>) => {
    const existing = loadBlindSpot<SavedData>(activeCase.id, MODULE, {});
    saveBlindSpot(activeCase.id, MODULE, { ...existing, ...patch, lastUpdated: new Date().toISOString() });
  }, [activeCase.id]);

  // ─────────────────────────────────────────────────────────────────────────
  // AI HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const handleEnforcementSelector = useCallback(async () => {
    const prompt = `Acting as claimant's counsel on this civil matter, advise on the most appropriate enforcement mechanism.

Matter: ${activeCase.title}
Court: ${judgmentCourt || activeCase.court}
Judgment Date: ${judgmentDate}
Reliefs Granted: ${reliefsGranted}
Amount Awarded: ${amountAwarded}
Additional Context: ${enforcementContext}

Analyse and recommend the best enforcement mechanism(s) from the following:
1. Writ of Fieri Facias (FIFA) — for moveable property
2. Garnishee Proceedings — for debt owed to judgment debtor
3. Judgment Summons — for failure to pay debt
4. Charging Order — for land or securities
5. Sequestration — for disobedience of court orders
6. Contempt / Committal — for non-compliance with court orders

For each recommended mechanism:
- State why it is appropriate on these facts
- Identify any preconditions or procedural requirements under Nigerian law
- Flag any risks or limitations

Conclude with your primary recommendation and the first step to take.`;

    const result = await generate(prompt);
    if (result) {
      setEnforcementResult(result);
      persist({ enforcementContext, enforcementResult: result });
    }
  }, [activeCase, judgmentDate, judgmentCourt, reliefsGranted, amountAwarded, enforcementContext, generate, persist]);

  const handleWritDrafter = useCallback(async () => {
    const prompt = `Acting as claimant's counsel on this civil matter, draft a Writ of Fieri Facias (FIFA).

Matter: ${activeCase.title}
Court: ${judgmentCourt || activeCase.court}
Judgment Date: ${judgmentDate}
Amount Awarded: ${amountAwarded}
Reliefs Granted: ${reliefsGranted}
Additional Context: ${writContext}

Draft a complete Writ of Fieri Facias in the standard Nigerian court form. The draft should include:
- The court header and matter details
- Recital of the judgment
- The amount to be recovered (judgment sum + interest + costs where applicable)
- Direction to the Sheriff / Bailiff
- Property to be seized and sold (moveable goods)
- Endorsement for execution
- Proper execution clauses

Use standard Nigerian High Court practice for the writ. Insert [BRACKETS] for any information that must be completed from the actual court record.`;

    const result = await generate(prompt);
    if (result) {
      setWritDraft(result);
      persist({ writContext, writDraft: result });
    }
  }, [activeCase, judgmentDate, judgmentCourt, amountAwarded, reliefsGranted, writContext, generate, persist]);

  const handleGarnisheeDrafter = useCallback(async () => {
    const prompt = `Acting as claimant's counsel on this civil matter, draft a Garnishee Order Nisi and supporting affidavit.

Matter: ${activeCase.title}
Court: ${judgmentCourt || activeCase.court}
Judgment Date: ${judgmentDate}
Amount Awarded: ${amountAwarded}
Additional Context: ${garnisheeContext}

Draft:
1. A Motion ex parte for a Garnishee Order Nisi (in proper Nigerian High Court form)
2. A supporting affidavit in aid of the application

The motion and affidavit should:
- Identify the judgment debtor and the garnishee (third party holding the debt)
- State the judgment sum, interest, and costs
- Establish that the garnishee is indebted to the judgment debtor
- Comply with Order 30 of the Sheriffs and Civil Process Act (Cap S6 LFN 2004) and applicable High Court Rules
- Include all required exhibits (certified copy of judgment etc.)

Insert [BRACKETS] for information to be completed from the actual record.`;

    const result = await generate(prompt);
    if (result) {
      setGarnisheeDraft(result);
      persist({ garnisheeContext, garnisheeDraft: result });
    }
  }, [activeCase, judgmentDate, judgmentCourt, amountAwarded, garnisheeContext, generate, persist]);

  const handleStayDrafter = useCallback(async () => {
    const prompt = `Acting as defendant's counsel on this civil matter, draft a Motion for Stay of Execution pending appeal.

Matter: ${activeCase.title}
Court: ${judgmentCourt || activeCase.court}
Judgment Date: ${judgmentDate}
Reliefs Against Client: ${reliefsGranted}
Amount Against Client: ${amountAwarded}
Grounds and Context: ${stayContext}

Draft a complete Motion for Stay of Execution and supporting affidavit. The draft should:
- State the grounds for stay (Notice of Appeal filed, special circumstances, balance of hardship, irreparable harm if execution proceeds, nugatory appeal risk)
- Apply the Vaswani Trading Co. v. Savalakh & Co. principles and subsequent Nigerian authorities on stay pending appeal
- Include a supporting affidavit deposing to the grounds
- Seek an order staying execution of the judgment pending determination of the appeal
- Comply with applicable Nigerian High Court/Court of Appeal rules

Insert [BRACKETS] for information to be completed from the court record.`;

    const result = await generate(prompt);
    if (result) {
      setStayDraft(result);
      persist({ stayContext, stayDraft: result });
    }
  }, [activeCase, judgmentDate, judgmentCourt, reliefsGranted, amountAwarded, stayContext, generate, persist]);

  const handleAppealGrounds = useCallback(async () => {
    const prompt = `Acting as defendant's counsel on this civil matter, identify and develop grounds of appeal from the judgment.

Matter: ${activeCase.title}
Court: ${judgmentCourt || activeCase.court}
Judgment Date: ${judgmentDate}
Decision Against Client: ${reliefsGranted}
Context and Grievances: ${appealGroundsContext}

Analyse and identify the strongest grounds of appeal available to the defendant, including:
1. Errors of law (misdirection in law, wrong legal test applied, wrong interpretation of statute or rule)
2. Errors of fact (perverse findings, failure to evaluate evidence, weight given to wrong evidence)
3. Procedural irregularities (denial of fair hearing, improper admission/exclusion of evidence)
4. Quantum (if damages or costs are manifestly excessive or wrong in principle)

For each ground:
- State the ground clearly in the form suitable for a Notice of Appeal
- Identify the part of the judgment it attacks
- Note the applicable standard of appellate review

Conclude with a priority ranking of the grounds.`;

    const result = await generate(prompt);
    if (result) {
      setAppealGroundsResult(result);
      persist({ appealGroundsContext, appealGroundsResult: result });
    }
  }, [activeCase, judgmentDate, judgmentCourt, reliefsGranted, appealGroundsContext, generate, persist]);

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const addRecoveryStep = () => {
    if (!newStep.action) return;
    const entry: RecoveryStep = { ...newStep, id: Date.now().toString() };
    const updated = [...recoverySteps, entry];
    setRecoverySteps(updated);
    setNewStep({ date: '', action: '', amount: '', notes: '' });
    persist({ recoverySteps: updated });
  };

  const removeRecoveryStep = (id: string) => {
    const updated = recoverySteps.filter(s => s.id !== id);
    setRecoverySteps(updated);
    persist({ recoverySteps: updated });
  };

  const addComplianceStep = () => {
    if (!newObligation.obligation) return;
    const entry: ComplianceStep = { ...newObligation, id: Date.now().toString() };
    const updated = [...complianceSteps, entry];
    setComplianceSteps(updated);
    setNewObligation({ date: '', obligation: '', done: false });
    persist({ complianceSteps: updated });
  };

  const toggleCompliance = (id: string) => {
    const updated = complianceSteps.map(s => s.id === id ? { ...s, done: !s.done } : s);
    setComplianceSteps(updated);
    persist({ complianceSteps: updated });
  };

  const removeComplianceStep = (id: string) => {
    const updated = complianceSteps.filter(s => s.id !== id);
    setComplianceSteps(updated);
    persist({ complianceSteps: updated });
  };

  const saveJudgmentSummary = () => {
    persist({ judgmentDate, judgmentCourt, reliefsGranted, amountAwarded });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED JUDGMENT SUMMARY PANEL (used by both roles)
  // ─────────────────────────────────────────────────────────────────────────

  const renderJudgmentSummary = (roleLabel: string) => (
    <div>
      <SectionHead text={`Judgment Summary — ${roleLabel}`} accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
        Record the judgment details. This anchors all enforcement or resistance actions in this engine.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <Label text="Judgment Date" />
          <Input value={judgmentDate} onChange={setJudgmentDate} placeholder="e.g. 14 June 2026" />
        </div>
        <div>
          <Label text="Court" />
          <Input value={judgmentCourt} onChange={setJudgmentCourt} placeholder={activeCase.court} />
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Label text="Reliefs Granted / Orders Made Against Client" />
        <Textarea
          value={reliefsGranted}
          onChange={setReliefsGranted}
          rows={4}
          placeholder="e.g. Judgment for ₦15,000,000 plus interest at 10% per annum, costs of ₦500,000..."
        />
      </div>
      <div style={{ marginBottom: 20 }}>
        <Label text="Amount Awarded (if monetary)" />
        <Input value={amountAwarded} onChange={setAmountAwarded} placeholder="e.g. ₦15,000,000" />
      </div>
      <Btn label="Save Judgment Summary" onClick={saveJudgmentSummary} accent={accent} />
      {judgmentDate && (
        <div style={{ marginTop: 16, padding: '14px 18px', background: `${accent}10`, border: `1px solid ${accent}30`, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Judgment on Record</div>
          <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            <strong>Date:</strong> {judgmentDate}<br />
            <strong>Court:</strong> {judgmentCourt || activeCase.court}<br />
            <strong>Orders:</strong> {reliefsGranted}<br />
            {amountAwarded && <><strong>Amount:</strong> {amountAwarded}</>}
          </div>
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER CLAIMANT TABS
  // ─────────────────────────────────────────────────────────────────────────

  const renderClaimTab = () => {
    switch (activeTab as ClaimSubTab) {
      case 'judgment_summary':
        return renderJudgmentSummary('Claimant / Judgment Creditor');

      case 'enforcement_selector':
        return (
          <div>
            <SectionHead text="Enforcement Mechanism Selector" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              AI analyses the judgment and advises on the most effective enforcement mechanism under Nigerian law.
            </p>
            {!judgmentDate && (
              <div style={{ padding: '12px 16px', background: '#f5f5f3', border: '1px solid #2e2e48', borderRadius: 6, marginBottom: 16, fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                ⚠ Record the judgment details in the Judgment Summary tab first.
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <Label text="Known Defendant Assets or Circumstances (optional)" />
              <Textarea
                value={enforcementContext}
                onChange={setEnforcementContext}
                rows={4}
                placeholder="e.g. Defendant operates a bank account at GTBank. Has moveable goods in his Lekki warehouse. Has land in Ibeju-Lekki..."
              />
            </div>
            <Btn label="Recommend Enforcement Mechanism" onClick={handleEnforcementSelector} loading={loading} accent={accent} off={!judgmentDate} />
            {error && <ErrorBlock message={error} />}
            {enforcementResult && (
              <ResultBlock
                title="Enforcement Analysis"
                content={enforcementResult}
                accent={accent}
                onClear={() => { setEnforcementResult(''); persist({ enforcementResult: '' }); }}
              />
            )}
          </div>
        );

      case 'writ_drafter':
        return (
          <div>
            <SectionHead text="Writ of Fieri Facias (FIFA)" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              Draft a Writ of FIFA directing the Sheriff to seize and sell the judgment debtor's moveable goods in satisfaction of the judgment.
            </p>
            {!judgmentDate && (
              <div style={{ padding: '12px 16px', background: '#f5f5f3', border: '1px solid #2e2e48', borderRadius: 6, marginBottom: 16, fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                ⚠ Record the judgment details in the Judgment Summary tab first.
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <Label text="Additional Details for the Writ (optional)" />
              <Textarea
                value={writContext}
                onChange={setWritContext}
                rows={3}
                placeholder="e.g. Interest at 10% from date of judgment. Levy on goods at defendant's Apapa warehouse. Costs assessed at ₦500,000..."
              />
            </div>
            <Btn label="Draft Writ of FIFA" onClick={handleWritDrafter} loading={loading} accent={accent} off={!judgmentDate} />
            {error && <ErrorBlock message={error} />}
            {writDraft && (
              <ResultBlock
                title="Writ of Fieri Facias — Draft"
                content={writDraft}
                accent={accent}
                onClear={() => { setWritDraft(''); persist({ writDraft: '' }); }}
              />
            )}
          </div>
        );

      case 'garnishee':
        return (
          <div>
            <SectionHead text="Garnishee Proceedings" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              Draft a Motion ex parte for a Garnishee Order Nisi and supporting affidavit. Used where a third party (bank or debtor) holds funds owed to the judgment debtor.
            </p>
            {!judgmentDate && (
              <div style={{ padding: '12px 16px', background: '#f5f5f3', border: '1px solid #2e2e48', borderRadius: 6, marginBottom: 16, fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                ⚠ Record the judgment details in the Judgment Summary tab first.
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <Label text="Garnishee Details (name of bank / third party, nature of debt owed to judgment debtor)" />
              <Textarea
                value={garnisheeContext}
                onChange={setGarnisheeContext}
                rows={4}
                placeholder="e.g. Garnishee is First Bank of Nigeria Plc, Victoria Island Branch. Defendant holds account No. [XXX]. Balance believed to exceed ₦20,000,000..."
              />
            </div>
            <Btn label="Draft Garnishee Order Nisi" onClick={handleGarnisheeDrafter} loading={loading} accent={accent} off={!judgmentDate} />
            {error && <ErrorBlock message={error} />}
            {garnisheeDraft && (
              <ResultBlock
                title="Garnishee Order Nisi — Draft"
                content={garnisheeDraft}
                accent={accent}
                onClear={() => { setGarnisheeDraft(''); persist({ garnisheeDraft: '' }); }}
              />
            )}
          </div>
        );

      case 'recovery_tracker':
        return (
          <div>
            <SectionHead text="Recovery Tracker" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              Log each enforcement step taken and record amounts recovered. Track outstanding balance.
            </p>
            {/* Add row form */}
            <div style={{ background: '#0c0c18', border: '1px solid #cccccc', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14 }}>Add Recovery Step</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <Label text="Date" />
                  <Input value={newStep.date} onChange={v => setNewStep(s => ({ ...s, date: v }))} placeholder="DD/MM/YYYY" />
                </div>
                <div>
                  <Label text="Action Taken" />
                  <Input value={newStep.action} onChange={v => setNewStep(s => ({ ...s, action: v }))} placeholder="e.g. FIFA levied on Apapa goods" />
                </div>
                <div>
                  <Label text="Amount Recovered" />
                  <Input value={newStep.amount} onChange={v => setNewStep(s => ({ ...s, amount: v }))} placeholder="e.g. ₦4,500,000" />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <Label text="Notes" />
                <Input value={newStep.notes} onChange={v => setNewStep(s => ({ ...s, notes: v }))} placeholder="Additional notes..." />
              </div>
              <Btn label="Add Step" onClick={addRecoveryStep} accent={accent} />
            </div>

            {/* Summary */}
            {amountAwarded && recoverySteps.length > 0 && (() => {
              const totalRecovered = recoverySteps.reduce((sum, s) => {
                const n = parseFloat(s.amount.replace(/[^0-9.]/g, ''));
                return sum + (isNaN(n) ? 0 : n);
              }, 0);
              return (
                <div style={{ padding: '12px 16px', background: `${accent}10`, border: `1px solid ${accent}30`, borderRadius: 6, marginBottom: 16, fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif" }}>
                  <strong>Total Recovered:</strong> ₦{totalRecovered.toLocaleString()} &nbsp;|&nbsp;
                  <strong>Judgment Amount:</strong> {amountAwarded}
                </div>
              );
            })()}

            {/* Table */}
            {recoverySteps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: T.mute, fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>
                No recovery steps recorded yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${accent}30` }}>
                      {['Date', 'Action', 'Amount', 'Notes', ''].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, color: accent, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recoverySteps.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid #1a1a2a' }}>
                        <td style={{ padding: '10px 12px', color: T.mute }}>{s.date}</td>
                        <td style={{ padding: '10px 12px', color: T.text }}>{s.action}</td>
                        <td style={{ padding: '10px 12px', color: accent }}>{s.amount}</td>
                        <td style={{ padding: '10px 12px', color: T.mute }}>{s.notes}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => removeRecoveryStep(s.id)} style={{ background: 'none', border: 'none', color: '#c06060', cursor: 'pointer', fontSize: 12 }}>remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER DEFENDANT TABS
  // ─────────────────────────────────────────────────────────────────────────

  const renderDefTab = () => {
    switch (activeTab as DefSubTab) {
      case 'judgment_summary_def':
        return renderJudgmentSummary('Defendant / Judgment Debtor');

      case 'stay_execution':
        return (
          <div>
            <SectionHead text="Stay of Execution" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              Draft a Motion for Stay of Execution pending the determination of appeal. The court will consider the balance of hardship, whether the appeal would be rendered nugatory, and special circumstances.
            </p>
            {!judgmentDate && (
              <div style={{ padding: '12px 16px', background: '#f5f5f3', border: '1px solid #2e2e48', borderRadius: 6, marginBottom: 16, fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                ⚠ Record the judgment details in the Judgment Summary tab first.
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <Label text="Grounds for Stay and Special Circumstances" />
              <Textarea
                value={stayContext}
                onChange={setStayContext}
                rows={5}
                placeholder="e.g. Notice of Appeal filed 12 June 2026. If execution proceeds, client's business will be irreparably destroyed. Appeal raises substantial questions of law on limitation. Judgment debtor is willing to provide security by deposit into court..."
              />
            </div>
            <Btn label="Draft Motion for Stay of Execution" onClick={handleStayDrafter} loading={loading} accent={accent} off={!judgmentDate} />
            {error && <ErrorBlock message={error} />}
            {stayDraft && (
              <ResultBlock
                title="Motion for Stay of Execution — Draft"
                content={stayDraft}
                accent={accent}
                onClear={() => { setStayDraft(''); persist({ stayDraft: '' }); }}
              />
            )}
          </div>
        );

      case 'compliance_tracker':
        return (
          <div>
            <SectionHead text="Compliance Tracker" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              Track judgment obligations — payment instalments, orders to deliver up property, injunction compliance, and any other court-ordered steps.
            </p>
            {/* Add obligation form */}
            <div style={{ background: '#0c0c18', border: '1px solid #cccccc', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: accent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14 }}>Add Obligation</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <Label text="Due Date" />
                  <Input value={newObligation.date} onChange={v => setNewObligation(o => ({ ...o, date: v }))} placeholder="DD/MM/YYYY" />
                </div>
                <div>
                  <Label text="Obligation" />
                  <Input value={newObligation.obligation} onChange={v => setNewObligation(o => ({ ...o, obligation: v }))} placeholder="e.g. Pay first instalment of ₦5,000,000" />
                </div>
              </div>
              <Btn label="Add Obligation" onClick={addComplianceStep} accent={accent} />
            </div>

            {complianceSteps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: T.mute, fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>
                No obligations recorded yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Times New Roman', Times, serif" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${accent}30` }}>
                      {['Due Date', 'Obligation', 'Status', ''].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, color: accent, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {complianceSteps.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid #1a1a2a' }}>
                        <td style={{ padding: '10px 12px', color: T.mute }}>{s.date}</td>
                        <td style={{ padding: '10px 12px', color: T.text }}>{s.obligation}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <button
                            onClick={() => toggleCompliance(s.id)}
                            style={{
                              background: s.done ? '#1a3a1a' : '#cccccc',
                              border: `1px solid ${s.done ? '#40a860' : '#2e2e48'}`,
                              color: s.done ? '#40a860' : T.mute,
                              borderRadius: 4, padding: '4px 10px', fontSize: 11,
                              cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                            }}
                          >
                            {s.done ? '✓ Done' : '○ Pending'}
                          </button>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => removeComplianceStep(s.id)} style={{ background: 'none', border: 'none', color: '#c06060', cursor: 'pointer', fontSize: 12 }}>remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      case 'appeal_grounds':
        return (
          <div>
            <SectionHead text="Appeal Grounds" accent={accent} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
              Identify and develop grounds of appeal from the adverse judgment. AI analyses the judgment and suggests the strongest grounds available to the defendant.
            </p>
            <div style={{ marginBottom: 20 }}>
              <Label text="Judgment Grievances and Errors Identified" />
              <Textarea
                value={appealGroundsContext}
                onChange={setAppealGroundsContext}
                rows={6}
                placeholder="e.g. Judge misapplied the limitation period under the Limitation Law. Failed to evaluate defendant's key defence witness DW2. Award of damages is manifestly excessive and not supported by evidence. Exhibit C was wrongly admitted without authentication..."
              />
            </div>
            <Btn label="Develop Appeal Grounds" onClick={handleAppealGrounds} loading={loading} accent={accent} />
            {error && <ErrorBlock message={error} />}
            {appealGroundsResult && (
              <ResultBlock
                title="Appeal Grounds Analysis"
                content={appealGroundsResult}
                accent={accent}
                onClear={() => { setAppealGroundsResult(''); persist({ appealGroundsResult: '' }); }}
              />
            )}
            <div style={{ marginTop: 20, padding: '12px 16px', background: '#0c0c18', border: '1px solid #cccccc', borderRadius: 6, fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              To file the Notice of Appeal and manage the full appeal workflow, navigate to the <strong style={{ color: accent }}>Appeal Engine</strong> tab.
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>→</span>
          <h2 style={{ margin: 0, fontSize: 20, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
            Enforcement Engine
          </h2>
          <span style={{
            fontSize: 10, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em',
            textTransform: 'uppercase', fontWeight: 700,
            color: accent, background: `${accent}18`,
            border: `1px solid ${accent}40`, borderRadius: 4, padding: '3px 10px',
          }}>
            {isClaim ? 'Judgment Creditor' : 'Judgment Debtor'} — Civil
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {isClaim
            ? 'Execute judgment: select enforcement mechanism, draft writs, track recovery progress.'
            : 'Resist enforcement: seek stay of execution, manage compliance obligations, develop appeal grounds.'}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={isClaim ? claimTabs : defTabs}
        active={activeTab}
        onSelect={id => setActiveTab(id as SubTab)}
        accent={accent}
      />

      {/* Content */}
      {isClaim ? renderClaimTab() : renderDefTab()}
    </div>
  );
}
