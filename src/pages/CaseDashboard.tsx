/**
 * AFS Legal OS V2 — Case Dashboard
 *
 * Phase 2: Role-Aware Dashboard
 * - Tab bar is filtered to show only role-relevant tabs
 * - Role badge + track badge permanently visible in header
 * - "Next Action" strip shows role-specific next step
 * - Quick Action bar shows role-specific action buttons
 * - Engine router unchanged — all engines still accessible
 *
 * Phase 6 (Engine consolidation):
 * - Removed lazy imports for absorbed engines: CaseOverview, RiskAnalytics,
 *   AlertsEngine, ProceduralTimeline, ComplianceEngine, WarRoom, BlindSpots,
 *   BriefMe, ArgumentBuilder, FinalAddressEngine, AuthorityValidator,
 *   ResearchResolver (CaseResearch), SynthesisEngine, CommandConsole,
 *   FilingsTracker, CriminalDefence, SanMode.
 * - Added lazy imports for: CaseCommand, CaseIntelligence, WrittenAddressEngine.
 * - Engine router updated: `overview` → case_command, `blindspots`/`warroom`/
 *   `briefme` → case_intelligence, `builder`/`final_address`/`authority`/
 *   `research`/`synthesis` → written_address, `console` → copilot (AICopilot).
 * - `Timeline →` shortcut in Next Action strip rerouted to `case_command`.
 */

import { Suspense, lazy, useCallback, useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { getTabsForOriginatingProcess } from '@/constants/dashboard';
import {
  ROLE_QUICK_ACTIONS,
  ROLE_POSITION_CONFIG,
} from '@/constants/roleWorkspace';
import { computeNextAction } from '@/utils/nextAction';
import { extractAnchors } from '@/utils/dateExtractor';
import { computePeriods, countUrgentPeriods } from '@/utils/periodComputer';
import { loadEntries, loadDeadlines } from '@/storage/helpers';
import type { DocketEntry, Deadline } from '@/types';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoadingBlock } from '@/components/common/ui';
import { PartyLabelsProvider } from '@/components/PartyLabelsContext';
import { T } from '@/constants/tokens';
import { saveCase } from '@/storage/helpers';
import { maybeCompressIntelligence } from '@/services/compressIntelligence';
import type { Case, DashTabId } from '@/types';
import {
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
  getOriginatingProcess,
} from '@/types';

// ── Lazy engine imports ───────────────────────────────────────────────────────

// Phase 6 — New consolidated engine shells
const CaseCommand        = lazy(() => import('@/engines/CaseCommand').then(m => ({ default: m.CaseCommand })));
const CaseIntelligence   = lazy(() => import('@/engines/CaseIntelligence').then(m => ({ default: m.CaseIntelligence })));
const WrittenAddressEngine = lazy(() => import('@/engines/FinalWrittenAddressEngine').then(m => ({ default: m.FinalWrittenAddressEngine })));

// Retained engines — untouched
const IntelligenceEngine = lazy(() => import('@/engines/IntelligenceEngine').then(m => ({ default: m.IntelligenceEngine })));
const AppealEngine       = lazy(() => import('@/engines/AppealEngine').then(m => ({ default: m.AppealEngine })));
const CaseDocketTab      = lazy(() => import('@/engines/CaseDocketTab').then(m => ({ default: m.CaseDocketTab })));
const EvidenceVault      = lazy(() => import('@/engines/EvidenceVault').then(m => ({ default: m.EvidenceVault })));
const InheritanceMode    = lazy(() => import('@/engines/InheritanceMode').then(m => ({ default: m.InheritanceMode })));
const CrossExamEngine    = lazy(() => import('@/engines/CrossExamEngine').then(m => ({ default: m.CrossExamEngine })));
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
const PleadingsEngine    = lazy(() => import('@/engines/PleadingsEngine').then(m => ({ default: m.PleadingsEngine })));
const MotionEngine       = lazy(() => import('@/engines/MotionEngine').then(m => ({ default: m.MotionEngine })));
const EnforcementEngine  = lazy(() => import('@/engines/EnforcementEngine').then(m => ({ default: m.EnforcementEngine })));
// Phase B — Applications Engine
const ApplicationsEngine = lazy(() => import('@/engines/ApplicationsEngine').then(m => ({ default: m.ApplicationsEngine })));

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
    // Phase 6 — New consolidated engine shells
    case 'case_command':      return <CaseCommand          activeCase={activeCase} onSetDashTab={onSetDashTab} />;
    case 'case_intelligence': return <CaseIntelligence     activeCase={activeCase} />;
    case 'written_address':   return <WrittenAddressEngine activeCase={activeCase} />;
    // Retained engines — untouched
    case 'intelligence': return <IntelligenceEngine activeCase={activeCase} onSave={onSaveIntel} />;
    case 'appeal':       return <AppealEngine       activeCase={activeCase} onSave={onSaveAppeal} />;
    case 'docket':       return <CaseDocketTab      activeCase={activeCase} />;
    case 'evidence':     return <EvidenceVault      activeCase={activeCase} />;
    case 'inheritance':  return <InheritanceMode    activeCase={activeCase} onSave={onSaveInherit} />;
    case 'crossexam':    return <CrossExamEngine    activeCase={activeCase} />;
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
    // Phase B — Applications Engine
    case 'applications':       return <ApplicationsEngine  activeCase={activeCase} />;
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
    const saved = { ...activeCase, ...patch };
    await saveCase(saved);
    // Phase 5: trigger digest compression once intPkg is generated (stage 5).
    // maybeCompressIntelligence is a no-op until shouldCompress() returns true.
    await maybeCompressIntelligence(saved, saveCase, updateActiveCase);
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

  // ── Tab set — driven by originating_process ───────────────────────────────
  // Phase 5: replaced ROLE_TABS lookup with getTabsForOriginatingProcess().
  // This is the single source of truth for which tabs a case sees.
  // Legacy V1 matters (no originating_process, no matter_track) fall through
  // to TABS_WRIT via the default branch in getTabsForOriginatingProcess().

  const visibleTabs = getTabsForOriginatingProcess(activeCase.originating_process);

  // ── Role / position config (still used for quick actions + accent colour) ──
  const counselRole  = activeCase.counsel_role;
  const matterTrack  = activeCase.matter_track;
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

  // ── Phase E: period-based alert count for red badge ──────────────────────
  const alertCount = (() => {
    const track = activeCase.matter_track;
    const role  = activeCase.counsel_role;
    if (!track || !role) return 0;
    const anchors = extractAnchors(dashEntries);
    const periods = computePeriods(
      track as import('@/types').MatterTrack,
      role  as import('@/types').CounselRole,
      anchors,
    );
    return countUrgentPeriods(periods);
  })();

  // ── Role accent — light tints for white newspaper canvas ─────────────────
  const ROLE_ACCENT_LIGHT: Record<string, { col: string; bg: string; bdr: string }> = {
    claimant_side:  { col: '#1a4a8a', bg: '#edf3fb', bdr: '#b8cfe8' },
    defendant_side: { col: '#7a1a1a', bg: '#fbeaea', bdr: '#e0b8b8' },
    prosecution:    { col: '#7a4a00', bg: '#fdf3e0', bdr: '#e0cfa0' },
    defence:        { col: '#1a5a30', bg: '#e8f5ee', bdr: '#a8d0b8' },
  };
  const roleColors  = counselRole ? ROLE_ACCENT_LIGHT[counselRole] : null;
  const roleAccent  = roleColors?.col  ?? '#444444';
  const roleBg      = roleColors?.bg   ?? '#f5f5f5';
  const roleBdr     = roleColors?.bdr  ?? '#cccccc';

  return (
    <PartyLabelsProvider activeCase={activeCase}>
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Case header ─────────────────────────────────────────────────────── */}
      <div style={{
        marginBottom: 0,
        paddingBottom: 16,
        borderBottom: `1px solid ${T.bdr}`,
      }}>
        <p style={{
          fontSize: 9, color: T.mute,
          fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 5,
        }}>
          Active Matter
        </p>
        <h2 style={{
          fontSize: 26, color: T.text,
          fontFamily: "'Times New Roman', Times, serif",
          fontWeight: 700, fontStyle: 'italic', marginBottom: 10,
          lineHeight: 1.2,
        }}>
          {activeCase.caseName}
        </h2>

        {/* Badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {/* Track badge */}
          {matterTrack && (
            <span style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 2,
              fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
              letterSpacing: '.1em', textTransform: 'uppercase',
              background: '#f0f0ee', border: '1px solid #cccccc', color: '#444444',
            }}>
              {activeCase.originating_process
                ? getOriginatingProcess(activeCase.originating_process).label
                : (MATTER_TRACK_LABELS[matterTrack] ?? matterTrack)
              }
            </span>
          )}
          {/* Role badge — permanently visible */}
          {counselRole && (
            <span style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 2,
              fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
              letterSpacing: '.07em', textTransform: 'uppercase',
              background: roleBg, border: `1px solid ${roleBdr}`, color: roleAccent,
            }}>
              {posConfig?.icon} {COUNSEL_ROLE_LABELS[counselRole]}
            </span>
          )}
          {/* Court and suit */}
          {(activeCase.court || activeCase.suitNo) && (
            <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
              {[activeCase.court, activeCase.suitNo].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* ── Next Action strip — dynamic, role + stage aware ──────────────── */}
        {nextAction && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 14px',
            background: roleBg,
            border: `1px solid ${nextActionResult.hasOverdueDeadlines ? '#e8b0b0' : roleBdr}`,
            borderRadius: 4,
            marginBottom: 14,
          }}>
            <span style={{ fontSize: 12, color: roleAccent, flexShrink: 0, marginTop: 1 }}>→</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{
                  fontSize: 8, color: roleAccent,
                  fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.12em', textTransform: 'uppercase',
                  fontWeight: 700,
                }}>
                  {posConfig?.nextActionLabel ?? 'Next Action'}
                </span>
                {nextActionResult.currentStageLabel && (
                  <span style={{
                    fontSize: 8, color: '#666666',
                    fontFamily: "'Times New Roman', Times, serif",
                    letterSpacing: '.06em',
                    border: '1px solid #cccccc',
                    background: '#ffffff',
                    padding: '1px 6px', borderRadius: 2,
                  }}>
                    {nextActionResult.currentStageLabel}
                  </span>
                )}
                {nextActionResult.urgency?.level === 'HIGH' && (
                  <span style={{
                    fontSize: 8, color: '#8a1a1a',
                    fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: 700, letterSpacing: '.08em',
                    border: '1px solid #e8b0b0', background: '#fff0f0',
                    padding: '1px 6px', borderRadius: 2,
                  }}>
                    ⚠ URGENT
                  </span>
                )}
              </div>
              <span style={{
                fontSize: 13, color: '#111111',
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: 1.55, display: 'block',
              }}>
                {nextAction}
              </span>
              {nextActionResult.urgency && (
                <span style={{
                  fontSize: 11,
                  color: nextActionResult.urgency.level === 'HIGH' ? '#8a1a1a' : '#7a4a00',
                  fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.4,
                  display: 'block', marginTop: 4, fontStyle: 'italic',
                }}>
                  {nextActionResult.urgency.note}
                </span>
              )}
            </div>
            {/* Timeline shortcut */}
            <button
              onClick={() => setDashTab('case_command')}
              title="View procedural timeline"
              style={{
                background: '#ffffff',
                border: `1px solid ${roleBdr}`,
                color: roleAccent,
                borderRadius: 3, padding: '4px 10px',
                fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                cursor: 'pointer', letterSpacing: '.04em',
                flexShrink: 0, alignSelf: 'flex-start',
                marginTop: 1, transition: 'all .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = roleBg;
                (e.currentTarget as HTMLElement).style.borderColor = roleAccent;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = '#ffffff';
                (e.currentTarget as HTMLElement).style.borderColor = roleBdr;
              }}
            >
              Timeline →
            </button>
          </div>
        )}

        {/* ── Role Quick Action bar ──────────────────────────────────────────── */}
        {quickActions && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {quickActions.map(qa => (
              <button
                key={qa.tab + qa.label}
                onClick={() => setDashTab(qa.tab)}
                title={qa.hint}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cccccc',
                  borderRadius: 3,
                  color: roleAccent,
                  padding: '5px 13px',
                  fontSize: 11,
                  fontFamily: "'Times New Roman', Times, serif",
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '.03em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all .15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = roleBg;
                  (e.currentTarget as HTMLElement).style.borderColor = roleBdr;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = '#ffffff';
                  (e.currentTarget as HTMLElement).style.borderColor = '#cccccc';
                }}
              >
                <span style={{ fontSize: 12 }}>{qa.icon}</span>
                {qa.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab bar — originating-process-filtered ──────────────────────────── */}
      <div
        className="tab-scroll"
        style={{ margin: '18px 0 26px', gap: 2, paddingBottom: 0 }}
      >
        {visibleTabs.map(tab => {
          const isActive = dashTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setDashTab(tab.id as DashTabId)}
              style={{
                flexShrink:    0,
                background:    isActive ? '#e8e8e8' : 'transparent',
                border:        '1px solid transparent',
                borderBottom:  isActive ? '2px solid #e8e8e8' : '1px solid transparent',
                marginBottom:  isActive ? '-2px' : '0',
                color:         isActive ? '#111111' : '#888888',
                borderRadius:  '3px 3px 0 0',
                padding:       '6px 14px',
                fontSize:      12,
                fontFamily:    "'Times New Roman', Times, serif",
                cursor:        'pointer',
                letterSpacing: '.03em',
                fontWeight:    isActive ? 700 : 400,
                transition:    'background .15s, color .15s',
                whiteSpace:    'nowrap',
                display:       'flex',
                alignItems:    'center',
                gap:           5,
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                  (e.currentTarget as HTMLElement).style.color = '#333333';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#888888';
                }
              }}
            >
              <span style={{ fontSize: 11 }}>{tab.icon}</span>
              {tab.label}
              {/* Data-present dots */}
              {tab.id === 'intelligence' && activeCase.intelligence_data?.intPkg && (
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#2a6a3a', display: 'inline-block', flexShrink: 0 }} />
              )}
              {tab.id === 'appeal' && (activeCase.appeal_data as any)?.package && (
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#444444', display: 'inline-block', flexShrink: 0 }} />
              )}
              {/* Phase E — red alert count badge on Alerts tab */}
              {tab.id === 'alerts' && alertCount > 0 && (
                <span style={{
                  background: '#c03030',
                  color: '#ffffff',
                  fontSize: 8,
                  fontFamily: "'Times New Roman', Times, serif",
                  fontWeight: 700,
                  borderRadius: 8,
                  padding: '1px 5px',
                  minWidth: 14,
                  textAlign: 'center',
                  lineHeight: '14px',
                  flexShrink: 0,
                }}>
                  {alertCount}
                </span>
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
    </PartyLabelsProvider>
  );
}
