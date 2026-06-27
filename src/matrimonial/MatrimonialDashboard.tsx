/**
 * AFS Advocates — Matrimonial Dashboard
 *
 * Phase 2B (Pipeline consolidation): Full rewrite.
 *
 * Changes from previous version:
 *   - All M-engine tab imports removed (MIntelligence, MFormsEngine,
 *     DecreeEnforcementEngine, MAppeal, MApplications, CaseCommand,
 *     StrategyHub, InheritanceMode, EvidenceVault, AICopilot,
 *     MatrimonialEngine retired as tabs)
 *   - 4 shared engines lazy-imported: IntelligenceEngine, PleadingsEngine,
 *     TrialEngine, FinalWrittenAddressEngine
 *   - onSaveIntel wired identically to CaseDashboard
 *   - Cross-petition header badge (reads cross_petition_filed from matrimonial_data)
 *   - Cross-petition activate button (sets cross_petition_filed + activated_at)
 *   - DecreeDeadlineBadge in header (reads decree_nisi_date + decree_absolute_path)
 *   - IntelligenceStatusBar removed (no longer relevant in 4-tab pipeline)
 *   - PlaceholderPanel removed (all 4 tabs are always ready)
 *   - Default tab: 'intelligence'
 *
 * Background services (no active references from this file):
 *   MIntelligence.tsx, MFormsEngine.tsx, MApplications.tsx (retired),
 *   DecreeEnforcementEngine.tsx, MAppeal.tsx, MatrimonialEngine.tsx (retired)
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
import { loadMatrimonialData, saveCase, saveMatrimonialData } from '@/storage/helpers';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoadingBlock } from '@/components/common/ui';

// ── 4 shared pipeline engines ─────────────────────────────────────────────────

const IntelligenceEngine = lazy(() =>
  import('@/engines/IntelligenceEngine').then(m => ({ default: m.IntelligenceEngine }))
);
const PleadingsEngine = lazy(() =>
  import('@/engines/PleadingsEngine').then(m => ({ default: m.PleadingsEngine }))
);
const TrialEngine = lazy(() =>
  import('@/engines/TrialEngine').then(m => ({ default: m.TrialEngine }))
);
const FinalWrittenAddressEngine = lazy(() =>
  import('@/engines/FinalWrittenAddressEngine').then(m => ({ default: m.FinalWrittenAddressEngine }))
);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const RELIEF_LABELS: Record<string, { label: string; col: string; bg: string; bdr: string }> = {
  dissolution:          { label: 'Dissolution',         col: '#4a1a7a', bg: '#f5edfb', bdr: '#ccb8e8' },
  nullity_void:         { label: 'Nullity (Void)',       col: '#7a1a1a', bg: '#fbedf0', bdr: '#e8b8c0' },
  nullity_voidable:     { label: 'Nullity (Voidable)',   col: '#7a3a1a', bg: '#fdf0eb', bdr: '#e8c8b8' },
  judicial_separation:  { label: 'Judicial Separation',  col: '#1a4a7a', bg: '#edf3fb', bdr: '#b8cce8' },
  restitution_conjugal: { label: 'Restitution (RCR)',    col: '#1a5a3a', bg: '#edfaf3', bdr: '#b8e8cc' },
  jactitation:          { label: 'Jactitation',          col: '#5a4a1a', bg: '#fbf7ed', bdr: '#e8dab8' },
};

// ─────────────────────────────────────────────────────────────────────────────
// DECREE DEADLINE BADGE — reads from matrimonial_data
// s.57 path: 28 days from decree nisi (children welfare order made)
// s.58 path: 3 months from decree nisi (no children order)
// ─────────────────────────────────────────────────────────────────────────────

function DecreeDeadlineBadge({ mData }: { mData: MatrimonialCaseData | null }) {
  if (!mData?.decree_nisi_date) return null;

  const nisi     = new Date(mData.decree_nisi_date);
  const path     = mData.decree_absolute_path ?? 's58_3_months';
  const deadline = new Date(nisi);

  if (path === 's57_28_days') {
    deadline.setDate(deadline.getDate() + 28);
  } else {
    deadline.setMonth(deadline.getMonth() + 3);
  }

  const today     = new Date();
  const daysLeft  = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const overdue   = daysLeft < 0;
  const urgent    = !overdue && daysLeft <= 14;

  const col = overdue ? '#a01010' : urgent ? '#8a5a00' : '#1a4a1a';
  const bg  = overdue ? '#fff3f3' : urgent ? '#fff8e1' : '#edfaf3';
  const bdr = overdue ? '#e04040' : urgent ? '#f0c040' : '#60b060';

  const label = overdue
    ? `Decree Absolute — OVERDUE ${Math.abs(daysLeft)}d`
    : `Decree Absolute — ${daysLeft}d left`;

  const pathLabel = path === 's57_28_days' ? 's.57 (28 days)' : 's.58 (3 months)';

  return (
    <span
      title={`${pathLabel} · Nisi: ${nisi.toLocaleDateString('en-GB')} · Deadline: ${deadline.toLocaleDateString('en-GB')}`}
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase',
        background: bg, color: col, border: `1px solid ${bdr}`,
        borderRadius: 3, padding: '2px 9px', fontFamily: SERIF,
      }}
    >
      {overdue ? '⚠ ' : urgent ? '⏱ ' : '⚡ '}{label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-PETITION ACTIVATE BUTTON
// Shown in header when counsel_role === 'respondent_side'
// and cross_petition_filed is not yet true.
// ─────────────────────────────────────────────────────────────────────────────

function CrossPetitionActivateButton({
  activeCase,
  mData,
  onActivated,
}: {
  activeCase: Case;
  mData: MatrimonialCaseData | null;
  onActivated: (updated: MatrimonialCaseData) => void;
}) {
  const [activating, setActivating] = useState(false);

  const isRespondent    = activeCase.counsel_role === 'respondent_side';
  const alreadyFiled    = mData?.cross_petition_filed === true;

  if (!isRespondent || alreadyFiled) return null;

  const handleActivate = async () => {
    setActivating(true);
    try {
      const existing = mData ?? {} as MatrimonialCaseData;
      const updated: MatrimonialCaseData = {
        ...existing,
        cross_petition_filed:        true,
        cross_petition_filed_by:     'respondent',
        cross_petition_activated_at: new Date().toISOString(),
      };
      await saveMatrimonialData(activeCase.id, updated);
      onActivated(updated);
    } finally {
      setActivating(false);
    }
  };

  return (
    <button
      onClick={handleActivate}
      disabled={activating}
      style={{
        background: activating ? '#cccccc' : 'linear-gradient(135deg,#000000,#a07820)',
        color: '#ffffff', border: 'none', borderRadius: 4,
        padding: '6px 16px', fontSize: 11, fontFamily: SERIF,
        cursor: activating ? 'not-allowed' : 'pointer',
        letterSpacing: '.05em', fontWeight: 600, flexShrink: 0,
      }}
    >
      {activating ? 'Activating…' : '+ File Cross-Petition'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export function MatrimonialDashboard() {
  const { activeCase, setView, updateActiveCase } = useAppStore();
  const [activeTab, setActiveTab] = useState<MTabId>('intelligence');
  const [mData, setMData]         = useState<MatrimonialCaseData | null>(null);

  // Load matrimonial_data on mount and whenever activeCase or tab changes
  useEffect(() => {
    if (!activeCase?.id) return;
    loadMatrimonialData(activeCase.id)
      .then(setMData)
      .catch(() => setMData(null));
  }, [activeCase?.id, activeTab]);

  const handleTabChange = useCallback((id: MTabId) => setActiveTab(id), []);

  // ── onSaveIntel — wired identically to CaseDashboard ─────────────────────
  // Called by IntelligenceEngine after extraction completes.

  const onSaveIntel = useCallback(async (intelData: unknown) => {
    if (!activeCase) return;
    const patch = { intelligence_data: intelData as Case['intelligence_data'] };
    updateActiveCase(patch);
    await saveCase({ ...activeCase, ...patch });
    // Reload matrimonial_data so header badges refresh
    loadMatrimonialData(activeCase.id)
      .then(setMData)
      .catch(() => null);
  }, [activeCase, updateActiveCase]);

  // ── Cross-petition activation callback ────────────────────────────────────

  const handleCrossPetitionActivated = useCallback((updated: MatrimonialCaseData) => {
    setMData(updated);
  }, []);

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

  const twoYearBarActive    = mData?.two_year_bar_applies === true && !mData?.leave_granted;
  const crossPetitionFiled  = mData?.cross_petition_filed === true;

  // ── Engine router ─────────────────────────────────────────────────────────

  function renderEngine() {
    if (!activeCase) {
      return (
        <div style={{ padding: '48px 0', textAlign: 'center', color: T.mute, fontFamily: SERIF, fontSize: 14 }}>
          No active case. Open a matrimonial matter from the docket.
        </div>
      );
    }

    const fallback = <LoadingBlock label="Loading engine…" />;

    switch (activeTab) {
      case 'intelligence':
        return (
          <ErrorBoundary name="intelligence">
            <Suspense fallback={fallback}>
              <IntelligenceEngine activeCase={activeCase} onSaveIntel={onSaveIntel} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'pleadings':
        return (
          <ErrorBoundary name="pleadings">
            <Suspense fallback={fallback}>
              <PleadingsEngine activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'trial':
        return (
          <ErrorBoundary name="trial">
            <Suspense fallback={fallback}>
              <TrialEngine activeCase={activeCase} />
            </Suspense>
          </ErrorBoundary>
        );

      case 'written_address':
        return (
          <ErrorBoundary name="written_address">
            <Suspense fallback={fallback}>
              <FinalWrittenAddressEngine activeCase={activeCase} />
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
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

            {/* Badge strip */}
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

              {crossPetitionFiled && (
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                  background: '#f0f8ff', color: '#1a3a7a', border: '1px solid #90b8e8',
                  borderRadius: 3, padding: '2px 9px', fontFamily: SERIF,
                }}>
                  ⚖ Cross-Petition Filed
                </span>
              )}

              {/* Decree deadline badge — background service reads from matrimonial_data */}
              <DecreeDeadlineBadge mData={mData} />

              {/* Cross-petition activate button — respondent only, pre-activation */}
              {activeCase && (
                <CrossPetitionActivateButton
                  activeCase={activeCase}
                  mData={mData}
                  onActivated={handleCrossPetitionActivated}
                />
              )}

            </div>
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
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              title={tab.description}
              style={{
                background:    isActive ? '#111111' : 'transparent',
                border:        isActive ? '1px solid #111111' : '1px solid transparent',
                color:         isActive ? '#ffffff' : '#444444',
                borderRadius:  '4px 4px 0 0',
                padding:       '7px 13px',
                fontSize:      11,
                fontFamily:    SERIF,
                cursor:        'pointer',
                letterSpacing: '.05em',
                fontWeight:    isActive ? 600 : 400,
                transition:    'all .12s',
                marginBottom:  isActive ? -1 : 0,
              }}
            >
              {tab.icon}{' '}{tab.label}
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
