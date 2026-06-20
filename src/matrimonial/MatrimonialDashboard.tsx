/**
 * AFS Advocates — Matrimonial Dashboard
 *
 * First-class workspace for matrimonial causes matters.
 * Matrimonial cases NEVER touch CaseDashboard.
 *
 * Phase 4: Full tab bar, own header (Petitioner v Respondent, suit number,
 *           court, MCA citation strip, relief-type badge), own engine router.
 * Phase 7 (Engine consolidation): 16 → 11 tabs.
 *   - Added lazy imports: CaseCommand, StrategyHub, WrittenAddressEngine,
 *     InheritanceMode.
 *   - Added router cases: case_command, strategy_hub, written_address,
 *     inheritance.
 *   - Removed router cases and lazy imports: MRisk, MArgumentBuilder,
 *     CaseResearch (research), standalone custody/maintenance/property
 *     (now inside MatrimonialEngine sub-tabs), CrossExamEngine (crossexam),
 *     MOverview (overview).
 * Phase 9E: Intelligence Status Bar — always visible, shows last run date,
 *           version, top-line risk summary. Anchors MIntelligence as first step.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 * MCR = Matrimonial Causes Rules 1983
 */

import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';
import { MATRIMONIAL_TABS, type MTabId } from '@/matrimonial/constants/mTabs';
import type { MatrimonialCaseData } from '@/matrimonial/types';
import { loadMatrimonialData, saveCase } from '@/storage/helpers';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoadingBlock } from '@/components/common/ui';

// ── Phase 7 — New consolidated engine shells (shared) ───────────────────────

const CaseCommand = lazy(() =>
  import('@/engines/CaseCommand').then(m => ({ default: m.CaseCommand }))
);
const StrategyHub = lazy(() =>
  import('@/engines/StrategyHub').then(m => ({ default: m.StrategyHub }))
);
const WrittenAddressEngine = lazy(() =>
  import('@/engines/FinalWrittenAddressEngine').then(m => ({ default: m.FinalWrittenAddressEngine }))
);
const InheritanceMode = lazy(() =>
  import('@/engines/InheritanceMode').then(m => ({ default: m.InheritanceMode }))
);

// ── Matrimonial-specific engines (retained) ──────────────────────────────────

const MatrimonialEngine = lazy(() =>
  import('@/engines/MatrimonialEngine').then(m => ({ default: m.MatrimonialEngine }))
);

// ── Phase 5 engines ───────────────────────────────────────────────────────────

const MIntelligence = lazy(() =>
  import('@/matrimonial/engines/MIntelligence').then(m => ({ default: m.MIntelligence }))
);
const MFormsEngine = lazy(() =>
  import('@/matrimonial/engines/MFormsEngine').then(m => ({ default: m.MFormsEngine }))
);
const DecreeEnforcementEngine = lazy(() =>
  import('@/matrimonial/engines/DecreeEnforcementEngine').then(m => ({ default: m.DecreeEnforcementEngine }))
);
const MAppeal = lazy(() =>
  import('@/matrimonial/engines/MAppeal').then(m => ({ default: m.MAppeal }))
);

// ── Phase 6 engines ───────────────────────────────────────────────────────────

const MApplications = lazy(() =>
  import('@/matrimonial/engines/MApplications').then(m => ({ default: m.MApplications }))
);

// ── Shared engines (as-is) ───────────────────────────────────────────────────

const EvidenceVault = lazy(() =>
  import('@/engines/EvidenceVault').then(m => ({ default: m.EvidenceVault }))
);
const AICopilot = lazy(() =>
  import('@/engines/AICopilot').then(m => ({ default: m.AICopilot }))
);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const RELIEF_LABELS: Record<string, { label: string; col: string; bg: string; bdr: string }> = {
  dissolution:          { label: 'Dissolution',          col: '#4a1a7a', bg: '#f5edfb', bdr: '#ccb8e8' },
  nullity_void:         { label: 'Nullity (Void)',        col: '#7a1a1a', bg: '#fbedf0', bdr: '#e8b8c0' },
  nullity_voidable:     { label: 'Nullity (Voidable)',    col: '#7a3a1a', bg: '#fdf0eb', bdr: '#e8c8b8' },
  judicial_separation:  { label: 'Judicial Separation',   col: '#1a4a7a', bg: '#edf3fb', bdr: '#b8cce8' },
  restitution_conjugal: { label: 'Restitution (RCR)',     col: '#1a5a3a', bg: '#edfaf3', bdr: '#b8e8cc' },
  jactitation:          { label: 'Jactitation',           col: '#5a4a1a', bg: '#fbf7ed', bdr: '#e8dab8' },
};

// Tab IDs that route directly into MatrimonialEngine (the full sub-tab engine)
type MatrimonialEngineTab = 'petition_answer' | 'matrimonial';

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE STATUS BAR — Phase 9E
// Always visible below the case header, above the tab bar.
// ─────────────────────────────────────────────────────────────────────────────

function IntelligenceStatusBar({
  mData,
  onGoToIntelligence,
  onReRun,
}: {
  mData: MatrimonialCaseData | null;
  onGoToIntelligence: () => void;
  onReRun: () => void;
}) {
  const hasIntel = !!mData?.intelligence_extraction;

  if (!hasIntel) {
    return (
      <div style={{
        background: '#f8f8fc', border: '1px solid #d8d8e8', borderRadius: 6,
        padding: '12px 20px', margin: '12px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: '#aaaaaa', marginRight: 8, verticalAlign: 'middle',
          }} />
          <span style={{ fontSize: 13, color: '#555555', fontFamily: SERIF }}>
            Intelligence not yet run · Run MIntelligence first for pre-filled forms, targeted risk assessment, and smart application suggestions.
          </span>
        </div>
        <button
          onClick={onGoToIntelligence}
          style={{
            background: 'linear-gradient(135deg,#000000,#a07820)', color: '#ffffff',
            border: 'none', borderRadius: 4, padding: '7px 18px',
            fontSize: 12, fontFamily: SERIF, cursor: 'pointer', letterSpacing: '.04em', fontWeight: 600,
            flexShrink: 0,
          }}
        >
          Go to Intelligence →
        </button>
      </div>
    );
  }

  const runAt    = mData!.intelligence_run_at;
  const version  = mData!.intelligence_version ?? 1;
  const ex       = mData!.intelligence_extraction!;

  const runDate = runAt
    ? new Date(runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const highRisks = ex.gaps_and_risks?.filter(g => g.severity === 'HIGH') ?? [];
  const barApplies   = ex.two_year_bar?.bar_applies && !ex.two_year_bar?.leave_obtained;
  const exceptionFound = ex.two_year_bar?.bar_applies && !!ex.two_year_bar?.exception;

  // Build top-line summary tags
  const summaryTags: Array<{ label: string; col: string; bg: string; bdr: string }> = [];
  if (highRisks.length > 0) {
    summaryTags.push({ label: `${highRisks.length} HIGH risk${highRisks.length > 1 ? 's' : ''}`, col: '#a01010', bg: '#fff3f3', bdr: '#e04040' });
  }
  if (barApplies) {
    summaryTags.push({ label: 's.30 bar applies', col: '#8a5a00', bg: '#fff8e1', bdr: '#f0c040' });
    if (!exceptionFound) {
      summaryTags.push({ label: 'No exception identified', col: '#7a1a1a', bg: '#fbedf0', bdr: '#e8b8c0' });
    } else {
      summaryTags.push({ label: 'Exception may apply', col: '#1a4a1a', bg: '#edfaf3', bdr: '#60b060' });
    }
  }
  const condonationHigh = ex.condonation_risk?.severity === 'HIGH';
  if (condonationHigh) {
    summaryTags.push({ label: 'Condonation HIGH', col: '#a01010', bg: '#fff3f3', bdr: '#e04040' });
  }
  if (ex.co_respondent?.named) {
    summaryTags.push({ label: 'Co-respondent named', col: '#4a1a7a', bg: '#f5edfb', bdr: '#ccb8e8' });
  }

  return (
    <div style={{
      background: '#f0f8f0', border: '1px solid #60b060', borderRadius: 6,
      padding: '12px 20px', margin: '12px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: '#40a040', marginRight: 4, verticalAlign: 'middle',
          }} />
          <span style={{ fontSize: 13, color: '#1a4a1a', fontFamily: SERIF, fontWeight: 600 }}>
            ⚡ Intelligence
          </span>
          <span style={{ fontSize: 12, color: '#336633', fontFamily: SERIF }}>
            Last run: {runDate} · Version {version}
          </span>

          {summaryTags.map((tag, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase',
              background: tag.bg, color: tag.col, border: `1px solid ${tag.bdr}`,
              borderRadius: 3, padding: '2px 8px', fontFamily: SERIF,
            }}>
              {tag.label}
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onReRun}
            style={{
              background: 'none', border: '1px solid #60b060', color: '#2a6a2a',
              borderRadius: 4, padding: '5px 14px', fontSize: 11,
              fontFamily: SERIF, cursor: 'pointer', letterSpacing: '.04em',
            }}
          >
            Re-run
          </button>
          <button
            onClick={onGoToIntelligence}
            style={{
              background: 'none', border: '1px solid #60b060', color: '#2a6a2a',
              borderRadius: 4, padding: '5px 14px', fontSize: 11,
              fontFamily: SERIF, cursor: 'pointer', letterSpacing: '.04em',
            }}
          >
            View
          </button>
        </div>
      </div>

      {highRisks.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #b0d8b0' }}>
          <span style={{ fontSize: 11, color: '#a01010', fontFamily: SERIF, fontWeight: 600 }}>High risks: </span>
          <span style={{ fontSize: 11, color: '#555555', fontFamily: SERIF }}>
            {highRisks.map(r => r.issue).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER PANEL
// ─────────────────────────────────────────────────────────────────────────────

function PlaceholderPanel({
  tabId, phase, description,
}: { tabId: MTabId; phase: 5 | 6 | 7; description: string }) {
  return (
    <div style={{
      border: '1px dashed #cccccc', borderRadius: 6,
      padding: '48px 36px', marginTop: 16, background: '#fafafa',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{
          fontSize: 10, fontFamily: SERIF, letterSpacing: '.14em',
          textTransform: 'uppercase', fontWeight: 600,
          background: phase === 5 ? '#edf3fb' : '#f5edfb',
          color:      phase === 5 ? '#1a4a7a' : '#4a1a7a',
          border:    `1px solid ${phase === 5 ? '#b8cce8' : '#ccb8e8'}`,
          borderRadius: 3, padding: '3px 10px',
        }}>
          Phase {phase} — Build Pending
        </span>
        <span style={{ fontSize: 10, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase', color: '#888888' }}>
          {tabId}
        </span>
      </div>
      <p style={{ fontSize: 15, fontFamily: SERIF, color: '#333333', lineHeight: 1.7, marginBottom: 10 }}>
        {description}
      </p>
      <p style={{ fontSize: 12, fontFamily: SERIF, color: '#aaaaaa', fontStyle: 'italic' }}>
        This engine will load here once Phase {phase} is deployed.
        All other tabs are fully operational.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export function MatrimonialDashboard() {
  const { activeCase, setView, updateActiveCase } = useAppStore();
  const [activeTab, setActiveTab] = useState<MTabId>('case_command');
  const [mData, setMData] = useState<MatrimonialCaseData | null>(null);

  useEffect(() => {
    if (!activeCase?.id) return;
    loadMatrimonialData(activeCase.id)
      .then(setMData)
      .catch(() => setMData(null));
  }, [activeCase?.id]);

  const handleTabChange = useCallback((id: MTabId) => setActiveTab(id), []);

  // ── Persist helpers ───────────────────────────────────────────────────────

  const onSaveInherit = useCallback(async (data: unknown) => {
    if (!activeCase) return;
    const patch = { inheritance_data: data as Case['inheritance_data'] };
    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });
  }, [activeCase, updateActiveCase]);

  // ── Derived display values ────────────────────────────────────────────────

  const reliefConfig = mData?.relief_type ? RELIEF_LABELS[mData.relief_type] ?? null : null;

  const petitionerName = activeCase?.parties?.find(
    p => p.role === 'petitioner_side' || p.type === 'petitioner'
  )?.name ?? null;

  const respondentName = activeCase?.parties?.find(
    p => p.role === 'respondent_side' || p.type === 'respondent'
  )?.name ?? null;

  const caseTitle = petitionerName && respondentName
    ? `${petitionerName} v ${respondentName}`
    : activeCase?.caseName ?? 'Matrimonial Matter';

  const twoYearBarActive = mData?.two_year_bar_applies === true && !mData?.leave_granted;

  // ── Intelligence Status Bar handlers ─────────────────────────────────────

  const handleGoToIntelligence = useCallback(() => {
    setActiveTab('intelligence');
  }, []);

  // Re-run: navigate to intelligence tab (associate triggers the run there)
  const handleReRun = useCallback(() => {
    setActiveTab('intelligence');
  }, []);

  // Refresh mData after returning from intelligence tab
  useEffect(() => {
    if (!activeCase?.id) return;
    loadMatrimonialData(activeCase.id)
      .then(setMData)
      .catch(() => setMData(null));
  }, [activeCase?.id, activeTab]);

  // ── Engine router ─────────────────────────────────────────────────────────

  function renderEngine() {
    if (!activeCase) {
      return (
        <div style={{ padding: '48px 0', textAlign: 'center', color: T.mute, fontFamily: SERIF, fontSize: 14 }}>
          No active case. Open a matrimonial matter from the docket.
        </div>
      );
    }

    const tab = MATRIMONIAL_TABS.find(t => t.id === activeTab);

    if (tab && tab.phase !== 'ready') {
      return (
        <PlaceholderPanel
          tabId={tab.id}
          phase={tab.phase as 5 | 6 | 7}
          description={tab.description}
        />
      );
    }

    const fallback = <LoadingBlock label="Loading engine…" />;

    switch (activeTab) {
      // Phase 7 — Consolidated engine shells
      case 'case_command':
        return (
          <ErrorBoundary name="case_command">
            <Suspense fallback={fallback}>
              <CaseCommand activeCase={activeCase} onSetDashTab={(tab) => setActiveTab(tab as MTabId)} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'strategy_hub':
        return (
          <ErrorBoundary name="strategy_hub">
            <Suspense fallback={fallback}>
              <StrategyHub activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'written_address':
        return (
          <ErrorBoundary name="written_address">
            <Suspense fallback={fallback}>
              <WrittenAddressEngine activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'inheritance':
        return (
          <ErrorBoundary name="inheritance">
            <Suspense fallback={fallback}>
              <InheritanceMode activeCase={activeCase} onSave={onSaveInherit} />
            </Suspense>
          </ErrorBoundary>
        );

      // MatrimonialEngine handles petition/answer + all 8 sub-tabs
      case 'petition_answer':
      case 'matrimonial':
        return (
          <ErrorBoundary name={activeTab}>
            <Suspense fallback={fallback}>
              <MatrimonialEngine activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'intelligence':
        return (
          <ErrorBoundary name="intelligence">
            <Suspense fallback={fallback}>
              <MIntelligence activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'forms_documents':
        return (
          <ErrorBoundary name="forms_documents">
            <Suspense fallback={fallback}>
              <MFormsEngine activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'decree_enforcement':
        return (
          <ErrorBoundary name="decree_enforcement">
            <Suspense fallback={fallback}>
              <DecreeEnforcementEngine activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'appeal':
        return (
          <ErrorBoundary name="appeal">
            <Suspense fallback={fallback}>
              <MAppeal activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'ancillary_applications':
        return (
          <ErrorBoundary name="ancillary_applications">
            <Suspense fallback={fallback}>
              <MApplications activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'evidence':
        return (
          <ErrorBoundary name="evidence">
            <Suspense fallback={fallback}>
              <EvidenceVault activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'copilot':
        return (
          <ErrorBoundary name="copilot">
            <Suspense fallback={fallback}>
              <AICopilot activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      default:
        return null;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', fontFamily: SERIF }}>

      {/* HEADER */}
      <div style={{
        borderBottom: '2px solid #111111',
        padding: '20px 32px 14px',
        background: '#ffffff',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <p style={{
              fontSize: 9, color: '#888888', letterSpacing: '.2em',
              textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
            }}>
              AFS Advocates · Matrimonial Track
            </p>

            <h1 style={{ fontSize: 24, color: '#111111', fontWeight: 700, fontStyle: 'italic', marginBottom: 4 }}>
              {caseTitle}
            </h1>

            {activeCase && (
              <p style={{ fontSize: 12, color: '#666666', marginBottom: 6 }}>
                {[activeCase.suitNo, activeCase.court].filter(Boolean).join('  ·  ')}
              </p>
            )}

            <p style={{ fontSize: 10, color: '#4a1a7a', letterSpacing: '.04em', marginBottom: 10 }}>
              Matrimonial Causes Act, Cap M7, LFN 2004
              {' · '}Matrimonial Causes Rules 1983
              {' · '}High Court of the relevant State
            </p>

            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {reliefConfig && (
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                  background: reliefConfig.bg, color: reliefConfig.col, border: `1px solid ${reliefConfig.bdr}`,
                  borderRadius: 3, padding: '2px 9px', fontFamily: SERIF,
                }}>
                  {reliefConfig.label}
                </span>
              )}

              {activeCase?.counsel_role && (
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                  background: activeCase.counsel_role === 'petitioner_side' ? '#f5edfb' : '#fbedf5',
                  color:      activeCase.counsel_role === 'petitioner_side' ? '#4a1a7a' : '#7a1a4a',
                  border:    `1px solid ${activeCase.counsel_role === 'petitioner_side' ? '#ccb8e8' : '#e8b8d4'}`,
                  borderRadius: 3, padding: '2px 9px', fontFamily: SERIF,
                }}>
                  {activeCase.counsel_role === 'petitioner_side' ? 'Petitioner Side' : 'Respondent Side'}
                </span>
              )}

              {twoYearBarActive && (
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                  background: '#fff8e1', color: '#8a5a00', border: '1px solid #f0c040',
                  borderRadius: 3, padding: '2px 9px', fontFamily: SERIF,
                }}>
                  ⚠ s.30 Two-Year Bar — Leave Required
                </span>
              )}
            </div>

            {/* ── Intelligence Status Bar — Phase 9E ──────────────────────── */}
            {activeCase && (
              <IntelligenceStatusBar
                mData={mData}
                onGoToIntelligence={handleGoToIntelligence}
                onReRun={handleReRun}
              />
            )}
          </div>

          <button
            onClick={() => setView('home')}
            style={{
              background: 'transparent', border: '1px solid #cccccc', color: '#444444',
              borderRadius: 3, padding: '7px 16px', fontSize: 12, cursor: 'pointer',
              marginTop: 4, fontFamily: SERIF, flexShrink: 0,
            }}
          >
            ← Back
          </button>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{
        display: 'flex', gap: 2, flexWrap: 'wrap',
        padding: '10px 32px 0', borderBottom: '1px solid #e0e0e0', background: '#fafafa',
      }}>
        {MATRIMONIAL_TABS.map(tab => {
          const isActive  = activeTab === tab.id;
          const isPending = tab.phase !== 'ready';
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              title={isPending ? `Phase ${tab.phase} pending — ${tab.description}` : tab.label}
              style={{
                background:   isActive ? '#111111' : 'transparent',
                border:       isActive ? '1px solid #111111' : '1px solid transparent',
                color:        isActive ? '#ffffff' : isPending ? '#aaaaaa' : '#444444',
                borderRadius: '4px 4px 0 0',
                padding:      '7px 13px',
                fontSize:     11,
                fontFamily:   SERIF,
                cursor:       'pointer',
                letterSpacing:'.05em',
                fontWeight:   isActive ? 600 : 400,
                transition:   'all .12s',
                marginBottom: isActive ? -1 : 0,
              }}
            >
              {tab.icon}{' '}{tab.label}
              {isPending && (
                <span style={{ marginLeft: 4, fontSize: 8, verticalAlign: 'super', color: '#bbbbbb' }}>
                  {tab.phase}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ENGINE PANEL */}
      <div style={{ padding: '0 32px 60px' }}>
        {renderEngine()}
      </div>

    </div>
  );
}
