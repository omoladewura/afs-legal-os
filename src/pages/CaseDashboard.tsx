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
 * - Added lazy imports for: CaseCommand, StrategyHub, WrittenAddressEngine.
 * - Engine router updated: `overview` → case_command, `blindspots`/`warroom`/
 *   `briefme` → strategy_hub, `builder`/`final_address`/`authority`/
 *   `research`/`synthesis` → written_address, `console` → copilot (AICopilot).
 * - `Timeline →` shortcut in Next Action strip rerouted to `case_command`.
 *
 * Phase 2C (Civil Matter Tree):
 * - Added 9 new cases to EngineContent switch — all route to PleadingsEngine:
 *   winding_up, nicn_pleadings, customary_pleadings, magistrate_pleadings,
 *   small_claims_pleadings, election_petition_pleadings, tax_appeal_pleadings,
 *   ist_pleadings, arbitration_pleadings.
 * - getTabsForOriginatingProcess import verified correct (Phase 2A output).
 * - New DashTabId values added to index.ts union to match Phase 2A tab sets.
 *
 * Phase 0A (Build Plan v5 — Navigation Shell, Civil only):
 * - Forked the tab-bar computation: `matter_track === 'criminal'` keeps the
 *   existing getTabsForOriginatingProcess() output untouched (no behaviour
 *   change for criminal matters, including the legacy V1 fallback path).
 * - Every other track (civil, matrimonial, and legacy matters with no
 *   originating_process) now renders the fixed 4-tab civil pipeline:
 *   Case Command → Pleadings → Trial → Final Address. Secondary engines
 *   (Applications, CrossExam, Evidence, Enforcement, Intelligence,
 *   Synthesis, MatrimonialEngine, etc.) are no longer in the main tab bar —
 *   they move to FloatingEngines.tsx (0B) and its "More" menu (0C).
 * - Matrimonial and FREP tabs are dropped from the visible bar here; their
 *   engines remain mounted and reachable via EngineContent/More menu — see
 *   0E for the actual tab removal at the source-of-truth tab-list level.
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
import type { Case, DashTabId, MatterTrack, CounselRole } from '@/types';
import {
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
  getOriginatingProcess,
} from '@/types';

// ── Phase 0A — Civil 4-tab pipeline ────────────────────────────────────────
// Fixed tab set for every non-criminal matter (civil, matrimonial, and
// legacy matters). Criminal matters are untouched and keep going through
// getTabsForOriginatingProcess() exactly as before.
const CIVIL_PIPELINE_TABS: { id: DashTabId; label: string; icon: string }[] = [
  { id: 'case_command',    label: 'Case Command',  icon: '⌂' },
  { id: 'pleadings',       label: 'Pleadings',      icon: '✎' },
  { id: 'trial',           label: 'Trial',          icon: '⚖' },
  { id: 'written_address', label: 'Final Address',  icon: '✓' },
];

// ── Lazy engine imports ───────────────────────────────────────────────────────

// Phase 6 — New consolidated engine shells
const CaseCommand        = lazy(() => import('@/engines/CaseCommand').then(m => ({ default: m.CaseCommand })));
const StrategyHub        = lazy(() => import('@/engines/StrategyHub').then(m => ({ default: m.StrategyHub })));
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
const EnforcementEngine  = lazy(() => import('@/engines/EnforcementEngine').then(m => ({ default: m.EnforcementEngine })));
// Phase B — Applications Engine
const ApplicationsEngine = lazy(() => import('@/engines/ApplicationsEngine').then(m => ({ default: m.ApplicationsEngine })));
// Phase 2 — Argument Template Manager
const ArgumentTemplateManager = lazy(() => import('@/engines/ArgumentTemplateManager').then(m => ({ default: m.ArgumentTemplateManager })));
// Trial Engine Consolidation (Build Plan v2, Phase 3)
const TrialEngine          = lazy(() => import('@/engines/TrialEngine').then(m => ({ default: m.TrialEngine })));
// Phase 5C — Synthesis Engine (re-added as a live tab; always last for every role)
const SynthesisEngine      = lazy(() => import('@/engines/SynthesisEngine').then(m => ({ default: m.SynthesisEngine })));

// ── Engine router ─────────────────────────────────────────────────────────────

interface EngineContentProps {
  tabId:         DashTabId;
  activeCase:    Case;
  onSaveIntel:   (data: unknown) => Promise<void>;
  onSaveAppeal:  (data: unknown) => Promise<void>;
  onSaveInherit: (data: unknown) => Promise<void>;
  onSetDashTab:  (tab: DashTabId) => void;
  /** Phase 1A — Role Gate: persists matter_track + counsel_role to case when gate confirms */
  onSaveRole:    (track: MatterTrack, role: CounselRole) => Promise<void>;
}

function EngineContent({
  tabId,
  activeCase,
  onSaveIntel,
  onSaveAppeal,
  onSaveInherit,
  onSetDashTab,
  onSaveRole,
}: EngineContentProps) {
  switch (tabId) {
    // Phase 6 — New consolidated engine shells
    case 'case_command':      return <CaseCommand          activeCase={activeCase} onSetDashTab={onSetDashTab} />;
    case 'strategy_hub':       return <StrategyHub          activeCase={activeCase} />;
    case 'written_address':   return <WrittenAddressEngine activeCase={activeCase} />;
    // Retained engines — untouched
    case 'intelligence': return <IntelligenceEngine activeCase={activeCase} onSave={onSaveIntel} onSaveRole={onSaveRole} />;
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
    case 'enforcement':        return <EnforcementEngine   activeCase={activeCase} />;
    // Phase 2C — Civil Matter Tree engine tabs (all route to PleadingsEngine)
    case 'winding_up':
    case 'nicn_pleadings':
    case 'customary_pleadings':
    case 'magistrate_pleadings':
    case 'small_claims_pleadings':
    case 'election_petition_pleadings':
    case 'tax_appeal_pleadings':
    case 'ist_pleadings':
    case 'arbitration_pleadings':
                               return <PleadingsEngine    activeCase={activeCase} />;
    // Phase B — Applications Engine
    case 'applications':       return <ApplicationsEngine  activeCase={activeCase} />;
    case 'arg_templates':      return <ArgumentTemplateManager activeCase={activeCase} />;
    // Trial Engine Consolidation (Build Plan v2, Phase 3)
    case 'trial':              return <TrialEngine            activeCase={activeCase} onSetDashTab={onSetDashTab} />;
    // Phase 5C — Synthesis Engine (Master Case Theory)
    case 'synthesis':         return <SynthesisEngine activeCase={activeCase} onNavigate={(tabId) => onSetDashTab(tabId as DashTabId)} />;
    default:             return null;
  }
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export function CaseDashboard() {
  const { activeCase, dashTab, setDashTab, updateActiveCase } = useAppStore();

  if (!activeCase) return null;

  // ── Persist helpers ───────────────────────────────────────────────────────

  const onSaveIntel = useCallback(async (data: unknown) => {
    // Merge, not replace — IntelligenceEngine only carries the fields it
    // owns (stage/rawFacts/extraction/.../commencement_audit) in local
    // state. A hard replace here would silently wipe sibling fields on
    // intelligence_data that other writers persist independently:
    // digest/digest_at (compressIntelligence), and — as later phases land —
    // risk_verdict, conflict_scan, counterclaim_detected, authority_grounding.
    const patch = {
      intelligence_data: {
        ...activeCase.intelligence_data,
        ...(data as Case['intelligence_data']),
      },
    };
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

  // ── Phase 1A — Role Gate persist handler ─────────────────────────────────
  // Called by IntelligenceEngine.RoleGate when counsel confirms track + role.
  // Persists to IndexedDB and syncs the app store so roleGateActive clears.
  const onSaveRole = useCallback(async (track: MatterTrack, role: CounselRole) => {
    const patch = { matter_track: track, counsel_role: role };
    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });
  }, [activeCase, updateActiveCase]);

  // ── Tab set — driven by originating_process (criminal) or fixed pipeline (civil) ──
  // Phase 5: replaced ROLE_TABS lookup with getTabsForOriginatingProcess().
  // This is the single source of truth for which tabs a *criminal* case sees.
  // Legacy V1 matters (no originating_process, no matter_track) fall through
  // to TABS_WRIT via the default branch in getTabsForOriginatingProcess().
  //
  // Phase 0A: criminal is forked off unchanged here. Civil (and matrimonial,
  // and any legacy/untracked matter) now gets the fixed 4-tab pipeline —
  // Case Command / Pleadings / Trial / Final Address — defined in
  // CIVIL_PIPELINE_TABS above. Everything else those matters need
  // (Applications, CrossExam, Evidence, Enforcement, Intelligence,
  // Synthesis, Matrimonial) lives behind FloatingEngines.tsx (0B/0C).

  const matterTrack  = activeCase.matter_track;

  const visibleTabs =
    matterTrack === 'criminal' || activeCase.originating_process === 'frep'
      ? getTabsForOriginatingProcess(activeCase.originating_process)
      : CIVIL_PIPELINE_TABS;

  // ── Role / position config (still used for quick actions + accent colour) ──
  const counselRole  = activeCase.counsel_role;
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
          {/* Phase 5A — Bundle Complete badge (civil only)
              Fires when:
                1. Intelligence package generated (stage ≥ 5 / intPkg present)
                2. Case theory locked (case_theory_locked === true)
              Together these mean: facts seeded + theory committed = trial-ready bundle.
              Criminal track is excluded — it has its own pipeline gate. */}
          {matterTrack !== 'criminal' &&
            activeCase.intelligence_data?.intPkg &&
            activeCase.case_theory_locked === true && (
            <span
              title="Intelligence package generated and Case Theory locked — matter is trial-ready"
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 2,
                fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                background: '#e8f5ee', border: '1px solid #a8d0b8', color: '#1a5a30',
                cursor: 'default',
              }}
            >
              ✓ Bundle Complete
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
              {/* Phase 5B — trial tab: green dot when bundle complete + trial started */}
              {tab.id === 'trial' &&
                activeCase.intelligence_data?.intPkg &&
                activeCase.case_theory_locked === true && (
                <span
                  title={activeCase.trial_stage === 'defence_case_closed'
                    ? 'Trial concluded — proceed to Final Written Address'
                    : 'Bundle complete — trial pipeline active'}
                  style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: activeCase.trial_stage === 'defence_case_closed' ? '#1a3a6a' : '#2a6a3a',
                    display: 'inline-block', flexShrink: 0,
                  }}
                />
              )}
              {/* Phase 5B — written_address tab: blue dot when trial is concluded */}
              {tab.id === 'written_address' &&
                activeCase.trial_stage === 'defence_case_closed' && (
                <span
                  title="Trial concluded — Final Written Address is ready to draft"
                  style={{ width: 4, height: 4, borderRadius: '50%', background: '#1a3a6a', display: 'inline-block', flexShrink: 0 }}
                />
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
            onSaveRole={onSaveRole}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
    </PartyLabelsProvider>
  );
}
