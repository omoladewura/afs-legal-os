/**
 * AFS Legal OS V2 — Case Dashboard
 *
 * Phase 2: Role-Aware Dashboard
 * - Tab bar is filtered to show only role-relevant tabs
 * - Role badge + track badge permanently visible in header
 * - "Next Action" strip shows role-specific next step
 * - Quick Action bar shows role-specific action buttons
 * - Engine router unchanged — all engines still accessible
 */

import { Suspense, lazy, useCallback, useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { DASH_TABS } from '@/constants/dashboard';
import {
  ROLE_TABS,
  ROLE_QUICK_ACTIONS,
  ROLE_POSITION_CONFIG,
} from '@/constants/roleWorkspace';
import { computeNextAction } from '@/utils/nextAction';
import { loadEntries, loadDeadlines } from '@/storage/helpers';
import type { DocketEntry, Deadline } from '@/types';
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
const ProceduralTimeline = lazy(() => import('@/engines/ProceduralTimeline').then(m => ({ default: m.ProceduralTimeline })));
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
const AICopilot          = lazy(() => import('@/engines/AICopilot').then(m => ({ default: m.AICopilot })));
// Phase 6A — Criminal Procedural Engines
const ChargeArraignment  = lazy(() => import('@/engines/ChargeArraignment').then(m => ({ default: m.ChargeArraignment })));
const PleaEngine         = lazy(() => import('@/engines/PleaEngine').then(m => ({ default: m.PleaEngine })));
// Phase 6B — Core Trial Engines
const ProsecutionCase    = lazy(() => import('@/engines/ProsecutionCase').then(m => ({ default: m.ProsecutionCase })));
const NoCaseSubmission   = lazy(() => import('@/engines/NoCaseSubmission').then(m => ({ default: m.NoCaseSubmission })));
// Phase 6C — Sentencing Engine
const SentencingEngine   = lazy(() => import('@/engines/SentencingEngine').then(m => ({ default: m.SentencingEngine })));
// Phase 7 — Civil Engines
const PleadingsEngine   = lazy(() => import('@/engines/PleadingsEngine').then(m => ({ default: m.PleadingsEngine })));
const MotionEngine       = lazy(() => import('@/engines/MotionEngine').then(m => ({ default: m.MotionEngine })));
const EnforcementEngine  = lazy(() => import('@/engines/EnforcementEngine').then(m => ({ default: m.EnforcementEngine })));

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
    case 'timeline':     return <ProceduralTimeline activeCase={activeCase} />;
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
    case 'copilot':      return <AICopilot          activeCase={activeCase} />;
    // Phase 6A — Criminal Procedural Engines
    case 'charge_arraignment': return <ChargeArraignment activeCase={activeCase} />;
    case 'plea':               return <PleaEngine         activeCase={activeCase} />;
    // Phase 6B — Core Trial Engines
    case 'prosecution_case':   return <ProsecutionCase    activeCase={activeCase} />;
    case 'no_case':            return <NoCaseSubmission   activeCase={activeCase} />;
    // Phase 6C — Sentencing Engine
    case 'sentencing':         return <SentencingEngine   activeCase={activeCase} />;
    // Phase 7 — Civil Engines
    case 'pleadings':          return <PleadingsEngine    activeCase={activeCase} />;
    case 'motions':            return <MotionEngine        activeCase={activeCase} />;
    case 'enforcement':        return <EnforcementEngine   activeCase={activeCase} />;
    default:             return null;
  }
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export function CaseDashboard() {
  const { activeCase, dashTab, setDashTab, updateActiveCase } = useAppStore();

  if (!activeCase) return null;

  // ── Persist helpers ───────────────────────────────────────────────────────

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

  // ── Role-aware tab filtering ──────────────────────────────────────────────
  // If this is a V2 matter with counsel_role, filter tabs to role-relevant set.
  // Legacy V1 matters (no counsel_role) show the full tab list.

  const counselRole  = activeCase.counsel_role;
  const matterTrack  = activeCase.matter_track;

  const visibleTabIds: Set<DashTabId> = counselRole
    ? new Set(ROLE_TABS[counselRole] as DashTabId[])
    : new Set(DASH_TABS.map(t => t.id as DashTabId));

  const visibleTabs = DASH_TABS.filter(t => visibleTabIds.has(t.id as DashTabId));

  // ── Role position config ──────────────────────────────────────────────────
  const posConfig    = counselRole ? ROLE_POSITION_CONFIG[counselRole] : null;
  const quickActions = counselRole ? ROLE_QUICK_ACTIONS[counselRole] : null;

  // ── Dynamic Next Action — loaded from docket + deadlines ─────────────────
  const [dashEntries,   setDashEntries]   = useState<DocketEntry[]>([]);
  const [dashDeadlines, setDashDeadlines] = useState<Deadline[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all([
      loadEntries(activeCase.id),
      loadDeadlines(activeCase.id),
    ]).then(([ents, dls]) => {
      if (!live) return;
      setDashEntries(ents ?? []);
      setDashDeadlines(dls ?? []);
    }).catch(() => {});
    return () => { live = false; };
  }, [activeCase.id, activeCase.current_stage]);

  const nextActionResult = computeNextAction(activeCase, dashEntries, dashDeadlines);
  const nextAction = nextActionResult.action;

  // ── Role accent ──────────────────────────────────────────────────────────
  const roleAccent = counselRole ? COUNSEL_ROLE_COLORS[counselRole].col : '#888888';
  const roleBg     = counselRole ? COUNSEL_ROLE_COLORS[counselRole].bg  : '#0a0a14';
  const roleBdr    = counselRole ? COUNSEL_ROLE_COLORS[counselRole].bdr : '#1e1e2e';

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Case header ─────────────────────────────────────────────────────── */}
      <div style={{
        marginBottom: 0,
        paddingBottom: 16,
        borderBottom: `1px solid ${T.bdr}`,
      }}>
        <p style={{
          fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif',
          letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 4,
        }}>
          Active Matter
        </p>
        <h2 style={{
          fontSize: 22, color: T.text,
          fontFamily: "'Cormorant Garamond', serif",
          fontWeight: 300, marginBottom: 8,
        }}>
          {activeCase.caseName}
        </h2>

        {/* Badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {/* Track badge */}
          {matterTrack && (
            <span style={{
              fontSize: 9, padding: '3px 8px', borderRadius: 3,
              fontFamily: 'Inter, sans-serif', fontWeight: 700,
              letterSpacing: '.1em', textTransform: 'uppercase',
              background: MATTER_TRACK_COLORS[matterTrack].bg,
              border: `1px solid ${MATTER_TRACK_COLORS[matterTrack].bdr}`,
              color: MATTER_TRACK_COLORS[matterTrack].col,
            }}>
              {MATTER_TRACK_LABELS[matterTrack]}
            </span>
          )}
          {/* Role badge — permanently visible */}
          {counselRole && (
            <span style={{
              fontSize: 9, padding: '3px 8px', borderRadius: 3,
              fontFamily: 'Inter, sans-serif', fontWeight: 700,
              letterSpacing: '.07em', textTransform: 'uppercase',
              background: roleBg,
              border: `1px solid ${roleBdr}`,
              color: roleAccent,
            }}>
              {posConfig?.icon} {COUNSEL_ROLE_LABELS[counselRole]}
            </span>
          )}
          {/* Court and suit */}
          <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>
            {[activeCase.court, activeCase.suitNo].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* ── Next Action strip — dynamic, role + stage aware ──────────────── */}
        {nextAction && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 14px',
            background: `${roleAccent}0d`,
            border: `1px solid ${nextActionResult.hasOverdueDeadlines ? '#c05050' : roleAccent}30`,
            borderRadius: 6,
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: roleAccent, flexShrink: 0, marginTop: 1 }}>→</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                <span style={{
                  fontSize: 8, color: roleAccent,
                  fontFamily: 'Inter, sans-serif',
                  letterSpacing: '.12em', textTransform: 'uppercase',
                  fontWeight: 700,
                }}>
                  {posConfig?.nextActionLabel ?? 'Next Action'}
                </span>
                {nextActionResult.currentStageLabel && (
                  <span style={{
                    fontSize: 8, color: `${roleAccent}99`,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '.06em',
                    border: `1px solid ${roleAccent}28`,
                    padding: '1px 6px', borderRadius: 3,
                  }}>
                    {nextActionResult.currentStageLabel}
                  </span>
                )}
                {nextActionResult.urgency?.level === 'HIGH' && (
                  <span style={{
                    fontSize: 8, color: '#c05050',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 700, letterSpacing: '.08em',
                    border: '1px solid #4a1818', background: '#1a0808',
                    padding: '1px 6px', borderRadius: 3,
                  }}>
                    ⚠ URGENT
                  </span>
                )}
              </div>
              <span style={{
                fontSize: 12, color: T.sub,
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: 1.5, display: 'block',
              }}>
                {nextAction}
              </span>
              {nextActionResult.urgency && (
                <span style={{
                  fontSize: 10,
                  color: nextActionResult.urgency.level === 'HIGH' ? '#c05050' : '#b07030',
                  fontFamily: 'Inter, sans-serif', lineHeight: 1.4,
                  display: 'block', marginTop: 4,
                }}>
                  {nextActionResult.urgency.note}
                </span>
              )}
            </div>
            {/* Timeline shortcut */}
            <button
              onClick={() => setDashTab('timeline')}
              title="View procedural timeline"
              style={{
                background: 'transparent',
                border: `1px solid ${roleAccent}30`,
                color: roleAccent,
                borderRadius: 4, padding: '4px 10px',
                fontSize: 9, fontFamily: 'Inter, sans-serif',
                cursor: 'pointer', letterSpacing: '.06em',
                flexShrink: 0, alignSelf: 'flex-start',
                marginTop: 1, transition: 'all .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `${roleAccent}18`;
                (e.currentTarget as HTMLElement).style.borderColor = `${roleAccent}60`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
                (e.currentTarget as HTMLElement).style.borderColor = `${roleAccent}30`;
              }}
            >
              Timeline →
            </button>
          </div>
        )}

        {/* ── Role Quick Action bar ──────────────────────────────────────────── */}
        {quickActions && (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {quickActions.map(qa => (
              <button
                key={qa.tab + qa.label}
                onClick={() => setDashTab(qa.tab)}
                title={qa.hint}
                style={{
                  background: `${qa.accent}10`,
                  border: `1px solid ${qa.accent}30`,
                  borderRadius: 5,
                  color: qa.accent,
                  padding: '6px 13px',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all .15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = `${qa.accent}22`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${qa.accent}60`;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = `${qa.accent}10`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${qa.accent}30`;
                }}
              >
                <span style={{ fontSize: 12 }}>{qa.icon}</span>
                {qa.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab bar — role-filtered ──────────────────────────────────────────── */}
      <div
        className="tab-scroll"
        style={{ margin: '16px 0 24px', gap: 3, paddingBottom: 2 }}
      >
        {visibleTabs.map(tab => {
          const isActive = dashTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setDashTab(tab.id as DashTabId)}
              style={{
                flexShrink:    0,
                background:    isActive ? (counselRole ? `${roleAccent}12` : '#0e0e1e') : 'transparent',
                border:        `1px solid ${isActive ? (counselRole ? `${roleAccent}40` : '#2a2a3e') : 'transparent'}`,
                color:         isActive ? (counselRole ? roleAccent : T.text) : T.mute,
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
          );
        })}
      </div>

      {/* ── Active engine ────────────────────────────────────────────────────── */}
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
