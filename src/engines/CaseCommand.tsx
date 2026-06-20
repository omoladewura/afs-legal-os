/**
 * AFS Legal OS — Case Command Engine (Phase 1)
 *
 * Single scrollable command centre for every case.
 * Absorbs: CaseOverview · RiskAnalytics · AlertsEngine · ProceduralTimeline · ComplianceEngine
 *   (Compliance Audit §4 now reads intelligence_data.commencement_audit,
 *    produced by Intelligence Engine Step 2b — see Phase 2. ComplianceEngine.tsx
 *    itself was deleted Phase 2C; its Affidavit Checker sub-module — which
 *    doesn't fit the auto-run-once pipeline pattern — lives on standalone
 *    in AffidavitChecker.tsx, mounted below the audit display.)
 * Replaces tab: `overview`
 *
 * Seven sections rendered top-to-bottom (no sub-tabs):
 *   1. Position Strip      — case name, role badge, track, court, suit number
 *   2. Next Action         — dynamic, role + stage aware
 *   3. Stage Timeline      — procedural chain, completed / current / upcoming
 *   4. Compliance Audit    — rule-based checklist against current stage
 *   5. Risk Score          — 8-dimension scores + FILE/NEGOTIATE/SETTLE/WALK_AWAY
 *   6. Alerts              — computed statutory deadlines from docket anchors
 *   7. Quick Actions       — role-specific action buttons routing to other tabs
 *
 * Logic is untouched from the absorbed engines — components are imported
 * directly and rendered inside this shell.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { T } from '@/constants/tokens';
import { useAppStore } from '@/state/appStore';
import {
  loadEntries,
  loadDeadlines,
  loadEvidenceMeta,
  loadArgVersions,
  saveCase,
} from '@/storage/helpers';
import {
  ROLE_POSITION_CONFIG,
  ROLE_STAGES,
  STAGE_KEYWORDS,
} from '@/constants/roleWorkspace';
import { computeNextAction } from '@/utils/nextAction';
import { extractAnchors } from '@/utils/dateExtractor';
import { computePeriods, periodStatusConfig, type ComputedPeriod } from '@/utils/periodComputer';
import { Md } from '@/components/common/ui';
import type { Case, DocketEntry, Deadline, EvidenceItem, ArgumentVersion, CounselRole } from '@/types';
import type { DashTabId } from '@/types';
import {
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
} from '@/types';

// Absorbed engines — logic untouched, rendered inside new shell
import { RiskAnalytics }       from '@/engines/RiskAnalytics';
import { AlertsEngine }        from '@/engines/AlertsEngine';
import { ProceduralTimeline }  from '@/engines/ProceduralTimeline';
import { AffidavitChecker }    from '@/engines/AffidavitChecker';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS (local)
// ─────────────────────────────────────────────────────────────────────────────

const SERIF = "'Times New Roman', Times, serif";

const SEVERITY_COLORS: Record<'HIGH' | 'MEDIUM' | 'LOW', { col: string; bg: string; bdr: string }> = {
  HIGH:   { col: '#c05050', bg: '#180808', bdr: '#401818' },
  MEDIUM: { col: '#b07030', bg: '#181000', bdr: '#3a2800' },
  LOW:    { col: '#508070', bg: '#071410', bdr: '#1a3028' },
};

const STATUS_DOT: Record<string, string> = {
  'Filed':             '#5090d0',
  'Served':            '#40a878',
  'Awaiting Response': '#b09040',
  'Pending Hearing':   '#9060c0',
  'Adjourned':         '#b07030',
  'Decided':           '#40b068',
  'Complied With':     '#40b068',
  'Contested':         '#c05050',
  'Struck Out':        '#505068',
  'Withdrawn':         '#505068',
  'Settled':           '#c4a030',
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION ANCHORS  (for internal smooth-scroll / jump links)
// ─────────────────────────────────────────────────────────────────────────────

type SectionId =
  | 'position'
  | 'next_action'
  | 'timeline'
  | 'compliance'
  | 'risk'
  | 'alerts'
  | 'quick_actions';

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: 'position',     label: 'Position',    icon: '◈' },
  { id: 'next_action',  label: 'Next Action', icon: '→' },
  { id: 'timeline',     label: 'Timeline',    icon: '◦' },
  { id: 'compliance',   label: 'Compliance',  icon: '⚙' },
  { id: 'risk',         label: 'Risk Score',  icon: '■' },
  { id: 'alerts',       label: 'Alerts',      icon: '⏰' },
  { id: 'quick_actions',label: 'Actions',     icon: '⚡' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function daysActive(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function getUrgency(deadlines: Deadline[]): { label: string; color: string; count: number } {
  const now    = new Date();
  const active = deadlines.filter(d => d.status !== 'Dismissed');
  const overdue = active.filter(d => new Date(d.date) < now);
  const soon    = active.filter(d => {
    const diff = (new Date(d.date).getTime() - now.getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  });
  if (overdue.length > 0) return { label: 'OVERDUE', color: '#c05050', count: overdue.length };
  if (soon.length > 0)    return { label: 'URGENT',  color: '#b07030', count: soon.length };
  if (active.length > 0)  return { label: 'ACTIVE',  color: '#40a878', count: active.length };
  return { label: 'CLEAR', color: T.mute, count: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE-SPECIFIC QUICK ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getRoleQuickActions(
  counselRole: CounselRole | undefined,
  accent: string,
): Array<{ label: string; icon: string; tab: DashTabId; hint: string }> {
  if (!counselRole) {
    return [
      { label: 'Run Intelligence', icon: '⚡', tab: 'intelligence', hint: '5-step AI pipeline' },
      { label: 'Add Docket Entry', icon: '⚖', tab: 'docket',       hint: 'Log a filing or order' },
      { label: 'Brief Me Now',     icon: '🎯', tab: 'strategy_hub' as DashTabId, hint: 'Pre-hearing brief' },
      { label: 'Upload Evidence',  icon: '📁', tab: 'evidence',     hint: 'Add to vault' },
      { label: 'War Room',         icon: '⬛', tab: 'strategy_hub' as DashTabId, hint: 'Strategic cockpit' },
    ];
  }

  const base: Array<{ label: string; icon: string; tab: DashTabId; hint: string }> = [
    { label: 'Run Intelligence', icon: '⚡', tab: 'intelligence',       hint: 'AI case analysis' },
    { label: 'Add Docket Entry', icon: '⚖', tab: 'docket',             hint: 'Log a filing or order' },
    { label: 'Brief Me Now',     icon: '🎯', tab: 'strategy_hub' as DashTabId, hint: 'Pre-hearing brief' },
    { label: 'Upload Evidence',  icon: '📁', tab: 'evidence',           hint: 'Add to vault' },
    { label: 'Written Address',  icon: '✍',  tab: 'written_address' as DashTabId,   hint: 'Draft final address' },
    { label: 'AI Copilot',       icon: '✦',  tab: 'copilot',           hint: 'Role-aware chat' },
  ];

  const roleExtras: Partial<Record<CounselRole, Array<{ label: string; icon: string; tab: DashTabId; hint: string }>>> = {
    claimant_side:  [{ label: 'Enforcement', icon: '→', tab: 'enforcement', hint: 'Execute judgment' }],
    defendant_side: [{ label: 'Applications',icon: '§', tab: 'applications',hint: 'Strike out / stay' }],
    prosecution:    [{ label: 'Prosecution',  icon: '⚖',tab: 'prosecution_case', hint: 'Prosecution case' }],
    defence:        [{ label: 'No-Case',      icon: '◦',tab: 'no_case',     hint: 'No-case submission' }],
  };

  return [...base, ...(roleExtras[counselRole] ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SectionLabel({ id, icon, title }: { id: SectionId; icon: string; title: string }) {
  return (
    <div
      id={`cc-${id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        marginBottom: 14,
      }}
    >
      <span style={{ fontSize: 12, color: T.dim }}>{icon}</span>
      <span style={{
        fontSize: 9, color: T.dim,
        fontFamily: SERIF,
        letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700,
      }}>
        {title}
      </span>
    </div>
  );
}

function Card({
  children,
  id,
  accentLeft,
  style: extraStyle,
}: {
  children: React.ReactNode;
  id?: SectionId;
  accentLeft?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      id={id ? `cc-${id}` : undefined}
      style={{
        background:   T.card,
        border:       `1px solid ${T.bdr}`,
        borderLeft:   accentLeft ? `3px solid ${accentLeft}` : undefined,
        borderRadius: 10,
        padding:      '20px 22px',
        marginBottom: 16,
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ label, action }: { label: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <p style={{ fontSize: 13, color: T.mute, fontFamily: SERIF, fontStyle: 'italic', marginBottom: action ? 8 : 0 }}>
        {label}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          style={{ background: 'transparent', border: 'none', color: T.dim, fontSize: 11, fontFamily: SERIF, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENCEMENT AUDIT DISPLAY (Phase 2C)
// Read-only render of intelligence_data.commencement_audit — the audit itself
// runs in IntelligenceEngine Step 2b (auto-fires after extraction). This panel
// just surfaces the persisted result; it never calls the AI itself. Mirrors
// the visual pattern of IntelligenceEngine's own CommencementAuditPanel.
// ─────────────────────────────────────────────────────────────────────────────

function CommencementAuditDisplay({
  activeCase,
  onRunIntelligence,
}: {
  activeCase: Case;
  onRunIntelligence: () => void;
}) {
  const audit = activeCase.intelligence_data?.commencement_audit;

  if (!audit) {
    return (
      <Empty
        label="No commencement audit yet — runs automatically after Intelligence Engine extraction (Step 2b)."
        action={{ label: 'Run Intelligence →', onClick: onRunIntelligence }}
      />
    );
  }

  const statusCfg = {
    CLEAR:     { bg: '#071810', bdr: '#1a4028', col: '#40b068', icon: '✓' },
    RISK:      { bg: '#1a1000', bdr: '#3a2800', col: '#c08030', icon: '⚠' },
    DEFECTIVE: { bg: '#1a0808', bdr: '#401818', col: '#c05050', icon: '✗' },
  } as const;
  const sc = statusCfg[audit.status];

  return (
    <div style={{
      background: '#0a0a14', border: `1px solid ${sc.bdr}`,
      borderRadius: 8, padding: '16px 20px',
      borderLeft: `3px solid ${sc.col}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 9, color: T.mute, fontFamily: SERIF, letterSpacing: '.1em' }}>
          Last run {fmtDate(audit.run_at)}
        </span>
        <span style={{
          marginLeft: 'auto', background: sc.bg, border: `1px solid ${sc.bdr}`, color: sc.col,
          fontSize: 8, padding: '2px 8px', borderRadius: 2, fontFamily: SERIF,
          letterSpacing: '.1em', fontWeight: 700,
        }}>
          {sc.icon} {audit.status}
        </span>
      </div>

      <p style={{ fontSize: 13, color: sc.col, fontFamily: SERIF, lineHeight: 1.6, marginBottom: 10 }}>
        {audit.summary}
      </p>

      {(audit.limitation_expiry || audit.service_valid !== undefined) && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          {audit.limitation_expiry && (
            <div style={{ background: '#0d0d18', border: '1px solid #1a1a28', borderRadius: 5, padding: '7px 12px' }}>
              <span style={{ fontSize: 8, color: T.mute, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>
                Limitation Expiry
              </span>
              <span style={{ fontSize: 12, color: '#d0d0e0', fontFamily: SERIF }}>
                {audit.limitation_expiry}
              </span>
            </div>
          )}
          {audit.service_valid !== undefined && (
            <div style={{ background: '#0d0d18', border: '1px solid #1a1a28', borderRadius: 5, padding: '7px 12px' }}>
              <span style={{ fontSize: 8, color: T.mute, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>
                Service Valid
              </span>
              <span style={{ fontSize: 12, color: audit.service_valid ? '#40b068' : '#c05050', fontFamily: SERIF }}>
                {audit.service_valid ? 'Yes' : 'No / Unclear'}
              </span>
            </div>
          )}
        </div>
      )}

      <details style={{ cursor: 'pointer' }}>
        <summary style={{ fontSize: 10, color: T.mute, fontFamily: SERIF, letterSpacing: '.08em', userSelect: 'none', outline: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>▸</span> View full audit findings
        </summary>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #131320' }}>
          <Md text={audit.findings} />
        </div>
      </details>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

function SectionNav({ activeSection, onJump }: { activeSection: SectionId; onJump: (id: SectionId) => void }) {
  return (
    <div style={{
      position:   'sticky',
      top:        0,
      zIndex:     10,
      background: T.card,
      border:     `1px solid ${T.bdr}`,
      borderRadius: 8,
      padding:    '8px 12px',
      marginBottom: 16,
      display:    'flex',
      gap:        4,
      flexWrap:   'wrap',
      overflowX:  'auto',
    }}>
      {SECTIONS.map(s => {
        const active = s.id === activeSection;
        return (
          <button
            key={s.id}
            onClick={() => onJump(s.id)}
            style={{
              background:   active ? '#00000012' : 'transparent',
              border:       `1px solid ${active ? T.bdr : 'transparent'}`,
              borderRadius: 5,
              padding:      '4px 10px',
              fontSize:     10,
              color:        active ? T.text : T.mute,
              fontFamily:   SERIF,
              letterSpacing:'.04em',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              gap:          4,
              whiteSpace:   'nowrap',
              transition:   'all .15s',
            }}
          >
            <span style={{ fontSize: 9 }}>{s.icon}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — POSITION STRIP
// ─────────────────────────────────────────────────────────────────────────────

interface PositionStripProps {
  activeCase:   Case;
  entries:      DocketEntry[];
  deadlines:    Deadline[];
  onNavigate:   (tab: DashTabId) => void;
  onStageSet:   (stageId: string) => void;
  isSavingStage: boolean;
}

function PositionStrip({
  activeCase, entries, deadlines, onNavigate, onStageSet, isSavingStage,
}: PositionStripProps) {
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const counselRole  = activeCase.counsel_role;
  const matterTrack  = activeCase.matter_track;
  const posConfig    = counselRole ? ROLE_POSITION_CONFIG[counselRole] : null;
  const roleAccent   = counselRole ? COUNSEL_ROLE_COLORS[counselRole].col : '#888888';
  const roleBg       = counselRole ? COUNSEL_ROLE_COLORS[counselRole].bg  : '#111111';
  const roleBdr      = counselRole ? COUNSEL_ROLE_COLORS[counselRole].bdr : '#333333';
  const urgency      = getUrgency(deadlines);
  const days         = daysActive(activeCase.createdAt);
  const roleStages   = counselRole ? (ROLE_STAGES[counselRole] ?? []) : [];

  const upcoming = [...deadlines]
    .filter(d => d.status !== 'Dismissed')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 3);

  const recent = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <Card id="position" accentLeft={roleAccent}>
      {/* ── Identity row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>

        {/* Role badge */}
        <div style={{
          background: roleBg,
          border:     `1px solid ${roleBdr}`,
          borderRadius: 7, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
        }}>
          <span style={{ fontSize: 16 }}>{posConfig?.icon ?? '⚖'}</span>
          <div>
            <div style={{
              fontSize: 7, color: roleAccent,
              fontFamily: SERIF, letterSpacing: '.14em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: 2,
            }}>
              {posConfig?.positionLabel ?? 'Our Role'}
            </div>
            <div style={{
              fontSize: 13, color: roleAccent,
              fontFamily: SERIF, fontWeight: 700, letterSpacing: '.04em',
            }}>
              {counselRole
                ? COUNSEL_ROLE_LABELS[counselRole].toUpperCase()
                : (activeCase.role ?? 'UNKNOWN').toUpperCase()
              }
            </div>
          </div>
        </div>

        {/* Case metadata */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{
            fontSize: 22, color: T.text,
            fontFamily: SERIF, fontWeight: 300, marginBottom: 6,
          }}>
            {activeCase.caseName}
          </h2>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
            {matterTrack && (
              <span style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 3,
                fontFamily: SERIF, fontWeight: 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                background: MATTER_TRACK_COLORS[matterTrack].bg,
                border:    `1px solid ${MATTER_TRACK_COLORS[matterTrack].bdr}`,
                color:      MATTER_TRACK_COLORS[matterTrack].col,
              }}>
                {MATTER_TRACK_LABELS[matterTrack]}
              </span>
            )}
            {activeCase.court && (
              <span style={{ fontSize: 11, color: T.mute, fontFamily: SERIF }}>
                ⚖ {activeCase.court}
              </span>
            )}
            {activeCase.suitNo && (
              <span style={{ fontSize: 11, color: T.mute, fontFamily: SERIF, fontStyle: 'italic' }}>
                {activeCase.suitNo}
              </span>
            )}
            {activeCase.dateCommenced && (
              <span style={{ fontSize: 11, color: T.mute, fontFamily: SERIF }}>
                Filed: {fmtDate(activeCase.dateCommenced)}
              </span>
            )}
          </div>
          {posConfig?.positionDesc && (
            <p style={{ fontSize: 12, color: T.mute, fontFamily: SERIF, lineHeight: 1.5, margin: 0 }}>
              {posConfig.positionDesc}
            </p>
          )}
        </div>

        {/* Health widgets */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{ background: T.bg, border: `1px solid ${T.bdr}`, borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, color: T.text, fontFamily: SERIF, fontWeight: 400, lineHeight: 1 }}>{days}</div>
            <div style={{ fontSize: 8, color: T.mute, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>days active</div>
          </div>
          <div style={{ background: T.bg, border: `1px solid ${urgency.color}33`, borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: urgency.color, fontFamily: SERIF, fontWeight: 700, lineHeight: 1 }}>{urgency.label}</div>
            <div style={{ fontSize: 8, color: T.mute, fontFamily: SERIF, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>
              {urgency.count > 0 ? `${urgency.count} deadline${urgency.count !== 1 ? 's' : ''}` : 'no deadlines'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Parties row ─────────────────────────────────────────────────────── */}
      {(activeCase.claimants?.length > 0 || activeCase.defendants?.length > 0) && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.bdr}`, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {activeCase.claimants?.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: '#4a7ed0', fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                {matterTrack === 'criminal' ? 'Complainant' : `Claimant${activeCase.claimants.length > 1 ? 's' : ''}`}
              </div>
              {activeCase.claimants.map(p => (
                <div key={p.id} style={{ fontSize: 13, color: T.sub, fontFamily: SERIF }}>{p.name}</div>
              ))}
            </div>
          )}
          {activeCase.defendants?.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: '#c06040', fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                {matterTrack === 'criminal' ? 'Accused' : `Defendant${activeCase.defendants.length > 1 ? 's' : ''}`}
              </div>
              {activeCase.defendants.map(p => (
                <div key={p.id} style={{ fontSize: 13, color: T.sub, fontFamily: SERIF }}>{p.name}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Stage picker row ─────────────────────────────────────────────────── */}
      {counselRole && roleStages.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.bdr}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 8, color: T.mute, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>
              Current Stage
            </span>
            {activeCase.current_stage && (() => {
              const st = roleStages.find(s => s.id === activeCase.current_stage);
              return st ? (
                <span style={{
                  fontSize: 10, color: roleAccent, fontFamily: SERIF,
                  background: `${roleAccent}18`, border: `1px solid ${roleAccent}40`,
                  padding: '2px 9px', borderRadius: 3,
                }}>
                  {st.label}
                </span>
              ) : null;
            })()}
            <button
              onClick={() => setStagePickerOpen(o => !o)}
              style={{
                background: 'transparent',
                border: `1px solid ${stagePickerOpen ? roleAccent + '60' : T.bdr}`,
                color: stagePickerOpen ? roleAccent : T.mute,
                borderRadius: 4, padding: '4px 11px',
                fontSize: 10, fontFamily: SERIF, cursor: 'pointer',
                letterSpacing: '.04em', transition: 'all .15s',
              }}
            >
              {stagePickerOpen ? '✕ Close' : (activeCase.current_stage ? '✎ Change Stage' : '+ Set Stage')}
            </button>
          </div>
          {stagePickerOpen && (
            <div style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
              gap: 6,
            }}>
              {roleStages.map(stage => {
                const isActive = activeCase.current_stage === stage.id;
                return (
                  <button
                    key={stage.id}
                    onClick={() => { if (!isActive) { onStageSet(stage.id); setStagePickerOpen(false); } }}
                    disabled={isSavingStage || isActive}
                    style={{
                      background: isActive ? `${roleAccent}18` : T.bg,
                      border: `1px solid ${isActive ? roleAccent + '50' : T.bdr}`,
                      borderRadius: 5, padding: '8px 12px',
                      textAlign: 'left', cursor: isActive ? 'default' : 'pointer',
                      transition: 'all .15s',
                      opacity: isSavingStage && !isActive ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: isActive ? roleAccent : T.mute }}>
                        {isActive ? '●' : '◦'}
                      </span>
                      <span style={{
                        fontSize: 12, color: isActive ? roleAccent : T.sub,
                        fontFamily: SERIF, fontWeight: isActive ? 600 : 400,
                      }}>
                        {stage.label}
                      </span>
                      {isActive && (
                        <span style={{ marginLeft: 'auto', fontSize: 8, color: roleAccent, fontFamily: SERIF, letterSpacing: '.08em' }}>
                          CURRENT
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Upcoming deadlines micro-strip ──────────────────────────────────── */}
      {upcoming.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.bdr}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 9, color: T.dim, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              ⏱ Upcoming Deadlines
            </span>
            <button
              onClick={() => onNavigate('docket')}
              style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 10, fontFamily: SERIF, cursor: 'pointer', letterSpacing: '.04em' }}
            >
              All Deadlines →
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {upcoming.map(dl => {
              const diff    = daysUntil(dl.date);
              const overdue = diff < 0;
              const soon    = diff >= 0 && diff <= 7;
              const col     = overdue ? '#c05050' : soon ? '#b07030' : T.mute;
              return (
                <div key={dl.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: T.text, fontFamily: SERIF, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dl.label}
                    </div>
                    <div style={{ fontSize: 10, color: T.mute, fontFamily: SERIF }}>{dl.type}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: col, fontFamily: SERIF, fontWeight: 600 }}>
                      {overdue ? `${Math.abs(diff)}d ago` : diff === 0 ? 'Today' : `${diff}d`}
                    </div>
                    <div style={{ fontSize: 9, color: T.mute, fontFamily: SERIF }}>{fmtDate(dl.date)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recent docket micro-strip ───────────────────────────────────────── */}
      {recent.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.bdr}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 9, color: T.dim, fontFamily: SERIF, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              ⚖ Recent Docket
            </span>
            <button
              onClick={() => onNavigate('docket')}
              style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 10, fontFamily: SERIF, cursor: 'pointer', letterSpacing: '.04em' }}
            >
              Full Docket →
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map(e => {
              const dot = STATUS_DOT[e.status] || T.mute;
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: T.bg, borderRadius: 6, border: `1px solid ${T.bdr}` }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: T.text, fontFamily: SERIF, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.docTitle}
                    </div>
                    <div style={{ fontSize: 10, color: T.mute, fontFamily: SERIF }}>{e.docType} · {e.filedBy}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: dot, fontFamily: SERIF, fontWeight: 600 }}>{e.status}</div>
                    <div style={{ fontSize: 9, color: T.mute, fontFamily: SERIF }}>{fmtDate(e.dateFiled || e.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — NEXT ACTION
// ─────────────────────────────────────────────────────────────────────────────

function NextActionSection({
  activeCase, entries, deadlines, roleAccent,
}: {
  activeCase: Case; entries: DocketEntry[]; deadlines: Deadline[]; roleAccent: string;
}) {
  const counselRole = activeCase.counsel_role;
  const posConfig   = counselRole ? ROLE_POSITION_CONFIG[counselRole] : null;
  const result      = computeNextAction(activeCase, entries, deadlines);
  const nextAction  = result.action ?? null;

  if (!nextAction) return null;

  return (
    <Card id="next_action">
      <SectionLabel id="next_action" icon="→" title="Next Action" />
      <div style={{
        padding: '14px 16px',
        background: `${roleAccent}0a`,
        border: `1px solid ${roleAccent}25`,
        borderRadius: 7,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{ fontSize: 16, color: roleAccent, flexShrink: 0, marginTop: 2 }}>→</span>
        <div>
          <div style={{
            fontSize: 8, color: roleAccent, fontFamily: SERIF,
            letterSpacing: '.12em', textTransform: 'uppercase',
            fontWeight: 700, marginBottom: 5,
          }}>
            {posConfig?.nextActionLabel ?? 'Recommended Next Action'}
          </div>
          <div style={{ fontSize: 14, color: T.text, fontFamily: SERIF, lineHeight: 1.6 }}>
            {nextAction}
          </div>
          {result.stage && (
            <div style={{ fontSize: 10, color: T.mute, fontFamily: SERIF, marginTop: 6, fontStyle: 'italic' }}>
              Stage: {result.stage}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — QUICK ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function QuickActionsSection({
  activeCase, onNavigate,
}: {
  activeCase: Case; onNavigate: (tab: DashTabId) => void;
}) {
  const counselRole = activeCase.counsel_role;
  const roleAccent  = counselRole ? COUNSEL_ROLE_COLORS[counselRole].col : '#888888';
  const actions     = getRoleQuickActions(counselRole, roleAccent);

  return (
    <Card id="quick_actions">
      <SectionLabel id="quick_actions" icon="⚡" title="Quick Actions" />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 8,
      }}>
        {actions.map(a => (
          <button
            key={a.tab}
            onClick={() => onNavigate(a.tab)}
            style={{
              background:   `${roleAccent}0a`,
              border:       `1px solid ${roleAccent}25`,
              borderRadius: 7, padding: '12px 14px',
              textAlign: 'left', cursor: 'pointer',
              transition: 'all .15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background  = `${roleAccent}18`;
              (e.currentTarget as HTMLElement).style.borderColor = `${roleAccent}55`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background  = `${roleAccent}0a`;
              (e.currentTarget as HTMLElement).style.borderColor = `${roleAccent}25`;
            }}
          >
            <div style={{ fontSize: 14, marginBottom: 5 }}>{a.icon}</div>
            <div style={{ fontSize: 13, color: roleAccent, fontFamily: SERIF, fontWeight: 600, marginBottom: 2 }}>
              {a.label}
            </div>
            <div style={{ fontSize: 10, color: T.mute, fontFamily: SERIF }}>{a.hint}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT — CaseCommand
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

export function CaseCommand({ activeCase }: Props) {
  const { setDashTab, updateActiveCase } = useAppStore();

  const [entries,        setEntries]        = useState<DocketEntry[]>([]);
  const [deadlines,      setDeadlines]      = useState<Deadline[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [isSavingStage,  setIsSavingStage]  = useState(false);
  const [activeSection,  setActiveSection]  = useState<SectionId>('position');

  // Load data
  useEffect(() => {
    if (!activeCase?.id) return;
    setLoading(true);
    Promise.all([
      loadEntries(activeCase.id),
      loadDeadlines(activeCase.id),
    ]).then(([ents, dls]) => {
      setEntries(ents);
      setDeadlines(dls);
      setLoading(false);
    });
  }, [activeCase?.id]);

  const counselRole = activeCase.counsel_role;
  const roleAccent  = counselRole ? COUNSEL_ROLE_COLORS[counselRole].col : '#888888';

  // Stage update handler
  const handleSetStage = useCallback(async (stageId: string) => {
    setIsSavingStage(true);
    const patch = { current_stage: stageId };
    updateActiveCase(patch);
    try {
      await saveCase({ ...activeCase, ...patch });
    } catch (e) {
      console.error('[CaseCommand] saveCase failed', e);
    } finally {
      setIsSavingStage(false);
    }
  }, [activeCase, updateActiveCase]);

  // Section jump
  const handleJump = useCallback((id: SectionId) => {
    setActiveSection(id);
    const el = document.getElementById(`cc-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Navigate to another tab (wrapper — also used by absorbed engines)
  const navigate = useCallback((tab: DashTabId) => {
    setDashTab(tab);
  }, [setDashTab]);

  if (loading) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center' }}>
        <span style={{
          display: 'inline-block', width: 24, height: 24,
          border: `2px solid ${T.bdr}`, borderTop: `2px solid #000`,
          borderRadius: '50%', animation: 'spin .8s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Jump navigator ───────────────────────────────────────────────── */}
      <SectionNav activeSection={activeSection} onJump={handleJump} />

      {/* ── §1 Position Strip ────────────────────────────────────────────── */}
      <PositionStrip
        activeCase={activeCase}
        entries={entries}
        deadlines={deadlines}
        onNavigate={navigate}
        onStageSet={handleSetStage}
        isSavingStage={isSavingStage}
      />

      {/* ── §2 Next Action ───────────────────────────────────────────────── */}
      <NextActionSection
        activeCase={activeCase}
        entries={entries}
        deadlines={deadlines}
        roleAccent={roleAccent}
      />

      {/* ── §3 Stage Timeline (ProceduralTimeline absorbed) ──────────────── */}
      <Card id="timeline">
        <SectionLabel id="timeline" icon="◦" title="Stage Timeline" />
        <ProceduralTimeline activeCase={activeCase} />
      </Card>

      {/* ── §4 Compliance Audit (commencement_audit display + AffidavitChecker) ── */}
      <Card id="compliance">
        <SectionLabel id="compliance" icon="⚙" title="Compliance Audit" />
        <CommencementAuditDisplay
          activeCase={activeCase}
          onRunIntelligence={() => navigate('intelligence')}
        />
        <AffidavitChecker activeCase={activeCase} />
      </Card>

      {/* ── §5 Risk Score (RiskAnalytics absorbed) ───────────────────────── */}
      <Card id="risk">
        <SectionLabel id="risk" icon="■" title="Risk Score" />
        <RiskAnalytics activeCase={activeCase} />
      </Card>

      {/* ── §6 Alerts (AlertsEngine absorbed) ───────────────────────────── */}
      <Card id="alerts">
        <SectionLabel id="alerts" icon="⏰" title="Alerts" />
        <AlertsEngine activeCase={activeCase} />
      </Card>

      {/* ── §7 Quick Actions ─────────────────────────────────────────────── */}
      <QuickActionsSection activeCase={activeCase} onNavigate={navigate} />

    </div>
  );
}
