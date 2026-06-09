/**
 * AFS Advocates — Case Dashboard
 *
 * Renders the tab bar and routes to each engine component.
 * IntelligenceEngine and ArgumentBuilder are now fully implemented (Phase 2).
 * All other engines remain as stubs until their respective phases.
 *
 * onSave wiring: engines that persist data to the case object call
 * onSave(patch) → updateActiveCase(patch) in Zustand + saveCase() in IndexedDB.
 */

import { Suspense, lazy, useCallback } from 'react';
import { useAppStore } from '@/state/appStore';
import { DASH_TABS } from '@/constants/dashboard';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoadingBlock } from '@/components/common/ui';
import { T } from '@/constants/tokens';
import { saveCase } from '@/storage/helpers';
import type { Case, DashTabId } from '@/types';
import {
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
} from '@/types';

// ── Lazy engine imports ───────────────────────────────────────────────────────

const CaseOverview       = lazy(() => import('@/engines/CaseOverview').then(m => ({ default: m.CaseOverview })));
const IntelligenceEngine = lazy(() => import('@/engines/IntelligenceEngine').then(m => ({ default: m.IntelligenceEngine })));
const AppealEngine       = lazy(() => import('@/engines/AppealEngine').then(m => ({ default: m.AppealEngine })));
const ArgumentBuilder    = lazy(() => import('@/engines/ArgumentBuilder').then(m => ({ default: m.ArgumentBuilder })));
const CaseDocketTab      = lazy(() => import('@/engines/CaseDocketTab').then(m => ({ default: m.CaseDocketTab })));
const EvidenceVault      = lazy(() => import('@/engines/EvidenceVault').then(m => ({ default: m.EvidenceVault })));
const FilingsTracker     = lazy(() => import('@/engines/FilingsTracker').then(m => ({ default: m.FilingsTracker })));
const CaseTimeline       = lazy(() => import('@/engines/CaseTimeline').then(m => ({ default: m.CaseTimeline })));
const CaseResearch       = lazy(() => import('@/engines/CaseResearch').then(m => ({ default: m.CaseResearch })));
const SanMode            = lazy(() => import('@/engines/SanMode').then(m => ({ default: m.SanMode })));
const BriefMe            = lazy(() => import('@/engines/BriefMe').then(m => ({ default: m.BriefMe })));
const InheritanceMode    = lazy(() => import('@/engines/InheritanceMode').then(m => ({ default: m.InheritanceMode })));
const BlindSpots         = lazy(() => import('@/engines/BlindSpots').then(m => ({ default: m.BlindSpots })));
const CrossExamEngine    = lazy(() => import('@/engines/CrossExamEngine').then(m => ({ default: m.CrossExamEngine })));
const ComplianceEngine   = lazy(() => import('@/engines/ComplianceEngine').then(m => ({ default: m.ComplianceEngine })));
const AuthorityValidator = lazy(() => import('@/engines/AuthorityValidator').then(m => ({ default: m.AuthorityValidator })));
const RiskAnalytics      = lazy(() => import('@/engines/RiskAnalytics').then(m => ({ default: m.RiskAnalytics })));
const WarRoom            = lazy(() => import('@/engines/WarRoom').then(m => ({ default: m.WarRoom })));
const CommandConsole     = lazy(() => import('@/engines/CommandConsole').then(m => ({ default: m.CommandConsole })));
const CriminalDefence    = lazy(() => import('@/engines/CriminalDefence').then(m => ({ default: m.CriminalDefence })));
const MatrimonialEngine  = lazy(() => import('@/engines/MatrimonialEngine').then(m => ({ default: m.MatrimonialEngine })));

// ── Engine router ─────────────────────────────────────────────────────────────

interface EngineContentProps {
  tabId:         DashTabId;
  activeCase:    Case;
  onSaveIntel:   (data: unknown) => Promise<void>;
  onSaveAppeal:  (data: unknown) => Promise<void>;
  onSaveInherit: (data: unknown) => Promise<void>;
  onSetDashTab:  (tab: DashTabId) => void;
}

function EngineContent({
  tabId,
  activeCase,
  onSaveIntel,
  onSaveAppeal,
  onSaveInherit,
  onSetDashTab,
}: EngineContentProps) {
  switch (tabId) {
    case 'overview':     return <CaseOverview       activeCase={activeCase} />;
    case 'intelligence': return <IntelligenceEngine activeCase={activeCase} onSave={onSaveIntel} />;
    case 'appeal':       return <AppealEngine       activeCase={activeCase} onSave={onSaveAppeal} />;
    case 'builder':      return <ArgumentBuilder    activeCase={activeCase} />;
    case 'docket':       return <CaseDocketTab      activeCase={activeCase} />;
    case 'evidence':     return <EvidenceVault      activeCase={activeCase} />;
    case 'filings':      return <FilingsTracker     activeCase={activeCase} />;
    case 'timeline':     return <CaseTimeline       activeCase={activeCase} />;
    case 'research':     return <CaseResearch       activeCase={activeCase} />;
    case 'san':          return <SanMode            activeCase={activeCase} />;
    case 'briefme':      return <BriefMe            activeCase={activeCase} />;
    case 'inheritance':  return <InheritanceMode    activeCase={activeCase} onSave={onSaveInherit} />;
    case 'blindspots':   return <BlindSpots         activeCase={activeCase} />;
    case 'crossexam':    return <CrossExamEngine    activeCase={activeCase} />;
    case 'compliance':   return <ComplianceEngine   activeCase={activeCase} />;
    case 'authority':    return <AuthorityValidator activeCase={activeCase} />;
    case 'risk':         return <RiskAnalytics      activeCase={activeCase} />;
    case 'warroom':      return <WarRoom            activeCase={activeCase} />;
    case 'console':      return <CommandConsole     activeCase={activeCase} setDashTab={onSetDashTab} />;
    case 'criminal':     return <CriminalDefence    activeCase={activeCase} />;
    case 'matrimonial':  return <MatrimonialEngine  activeCase={activeCase} />;
    default:             return null;
  }
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export function CaseDashboard() {
  const { activeCase, dashTab, setDashTab, updateActiveCase } = useAppStore();

  if (!activeCase) return null;

  // ── Persist helpers — write to IndexedDB and update Zustand ───────────────

  const onSaveIntel = useCallback(async (data: unknown) => {
    const patch = { intelligence_data: data as Case['intelligence_data'] };
    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });
  }, [activeCase, updateActiveCase]);

  const onSaveAppeal = useCallback(async (data: unknown) => {
    const patch = { appeal_data: data as Case['appeal_data'] };
    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });
  }, [activeCase, updateActiveCase]);

  const onSaveInherit = useCallback(async (data: unknown) => {
    const patch = { inheritance_data: data as Case['inheritance_data'] };
    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });
  }, [activeCase, updateActiveCase]);

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Case header */}
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${T.bdr}` }}>
        <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 4 }}>
          Active Matter
        </p>
        <h2 style={{ fontSize: 22, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, marginBottom: 6 }}>
          {activeCase.caseName}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Track badge */}
          {activeCase.matter_track && (
            <span style={{
              fontSize: 9, padding: '3px 8px', borderRadius: 3,
              fontFamily: 'Inter, sans-serif', fontWeight: 700,
              letterSpacing: '.1em', textTransform: 'uppercase',
              background: MATTER_TRACK_COLORS[activeCase.matter_track].bg,
              border: `1px solid ${MATTER_TRACK_COLORS[activeCase.matter_track].bdr}`,
              color: MATTER_TRACK_COLORS[activeCase.matter_track].col,
            }}>
              {MATTER_TRACK_LABELS[activeCase.matter_track]}
            </span>
          )}
          {/* Role badge — permanently visible so lawyer always knows which hat they are wearing */}
          {activeCase.counsel_role && (
            <span style={{
              fontSize: 9, padding: '3px 8px', borderRadius: 3,
              fontFamily: 'Inter, sans-serif', fontWeight: 700,
              letterSpacing: '.07em', textTransform: 'uppercase',
              background: COUNSEL_ROLE_COLORS[activeCase.counsel_role].bg,
              border: `1px solid ${COUNSEL_ROLE_COLORS[activeCase.counsel_role].bdr}`,
              color: COUNSEL_ROLE_COLORS[activeCase.counsel_role].col,
            }}>
              {COUNSEL_ROLE_LABELS[activeCase.counsel_role]}
            </span>
          )}
          {/* Court and suit number */}
          <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>
            {[activeCase.court, activeCase.suitNo].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-scroll" style={{ marginBottom: 24, gap: 3, paddingBottom: 2 }}>
        {DASH_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setDashTab(tab.id as DashTabId)}
            style={{
              flexShrink:    0,
              background:    dashTab === tab.id ? '#0e0e1e' : 'transparent',
              border:        `1px solid ${dashTab === tab.id ? '#2a2a3e' : 'transparent'}`,
              color:         dashTab === tab.id ? T.gold : T.mute,
              borderRadius:  5,
              padding:       '7px 14px',
              fontSize:      11,
              fontFamily:    'Inter, sans-serif',
              cursor:        'pointer',
              letterSpacing: '.06em',
              fontWeight:    600,
              transition:    'all .15s',
              whiteSpace:    'nowrap',
              display:       'flex',
              alignItems:    'center',
              gap:           5,
            }}
          >
            <span style={{ fontSize: 12 }}>{tab.icon}</span>
            {tab.label}
            {/* Data-present indicators */}
            {tab.id === 'intelligence' && activeCase.intelligence_data?.intPkg && (
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#40a860', display: 'inline-block', flexShrink: 0 }} />
            )}
            {tab.id === 'appeal' && (activeCase.appeal_data as any)?.package && (
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#8050d0', display: 'inline-block', flexShrink: 0 }} />
            )}
          </button>
        ))}
      </div>

      {/* Active engine */}
      <ErrorBoundary name={dashTab}>
        <Suspense fallback={<LoadingBlock label="Loading module…" />}>
          <EngineContent
            tabId={dashTab as DashTabId}
            activeCase={activeCase}
            onSaveIntel={onSaveIntel}
            onSaveAppeal={onSaveAppeal}
            onSaveInherit={onSaveInherit}
            onSetDashTab={setDashTab}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
