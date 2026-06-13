/**
 * AFS Legal OS V2 — Case Overview Engine (Phase 2: Role-Aware)
 *
 * The first tab opened in every case. Adapts completely to matter_track + counsel_role:
 *   · Role-specific position summary panel
 *   · Role-specific next action
 *   · Role-specific risk flags
 *   · Role-specific module readiness grid
 *   · Upcoming deadlines
 *   · Recent docket entries
 *   · Role-specific quick actions
 *
 * Legacy V1 matters (no counsel_role) fall back to the original generic display.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  ROLE_RISK_FLAGS,
  ROLE_MODULES,
  ROLE_STAGES,
} from '@/constants/roleWorkspace';
import { computeNextAction } from '@/utils/nextAction';
import type { Case, DocketEntry, Deadline, EvidenceItem, ArgumentVersion } from '@/types';
import type { DashTabId } from '@/types';
import {
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
} from '@/types';

// ── Legacy role colours (V1 compatibility) ────────────────────────────────────

const LEGACY_ROLE_COLORS: Record<string, { col: string; bg: string; bdr: string; icon: string }> = {
  Claimant:    { col: '#4a7ed0', bg: '#081428', bdr: '#1a3060', icon: '⚔' },
  Defendant:   { col: '#c06040', bg: '#180c08', bdr: '#602010', icon: '🛡' },
  Appellant:   { col: '#8050d0', bg: '#0e0818', bdr: '#401880', icon: '↑' },
  Respondent:  { col: '#c04080', bg: '#180810', bdr: '#601030', icon: '↓' },
  Prosecution: { col: '#c09030', bg: '#181000', bdr: '#403000', icon: '⚖' },
  Defence:     { col: '#40a860', bg: '#071a0e', bdr: '#1a4028', icon: '🛡' },
};

// ── Status dot colours ────────────────────────────────────────────────────────

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

const SEVERITY_COLORS: Record<'HIGH' | 'MEDIUM' | 'LOW', { col: string; bg: string; bdr: string }> = {
  HIGH:   { col: '#c05050', bg: '#180808', bdr: '#401818' },
  MEDIUM: { col: '#b07030', bg: '#181000', bdr: '#3a2800' },
  LOW:    { col: '#508070', bg: '#071410', bdr: '#1a3028' },
};

// ── Urgency ───────────────────────────────────────────────────────────────────

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

function daysActive(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function CaseOverview({ activeCase }: Props) {
  const { setDashTab, updateActiveCase } = useAppStore();

  const [entries,   setEntries]   = useState<DocketEntry[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [evidence,  setEvidence]  = useState<EvidenceItem[]>([]);
  const [argVers,   setArgVers]   = useState<ArgumentVersion[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [isSavingStage,   setIsSavingStage]   = useState(false);

  useEffect(() => {
    if (!activeCase?.id) return;
    setLoading(true);
    Promise.all([
      loadEntries(activeCase.id),
      loadDeadlines(activeCase.id),
      loadEvidenceMeta(activeCase.id),
      loadArgVersions(activeCase.id),
    ]).then(([ents, dls, evs, args]) => {
      setEntries(ents);
      setDeadlines(dls);
      setEvidence(evs);
      setArgVers(args);
      setLoading(false);
    });
  }, [activeCase?.id]);

  const counselRole = activeCase.counsel_role;
  const matterTrack = activeCase.matter_track;
  const intel       = activeCase.intelligence_data;
  const urgency     = getUrgency(deadlines);
  const days        = daysActive(activeCase.createdAt);

  // ── Role-specific config ──────────────────────────────────────────────────
  const posConfig   = counselRole ? ROLE_POSITION_CONFIG[counselRole]   : null;
  const riskFlags   = counselRole ? ROLE_RISK_FLAGS[counselRole]        : null;
  const modules     = counselRole ? ROLE_MODULES[counselRole]           : null;
  const nextActionResult = computeNextAction(activeCase, entries, deadlines);
  const nextAction  = nextActionResult.action || null;

  const roleAccent  = counselRole ? COUNSEL_ROLE_COLORS[counselRole].col : '#888888';
  const roleBg      = counselRole ? COUNSEL_ROLE_COLORS[counselRole].bg  : '#ffffff';
  const roleBdr     = counselRole ? COUNSEL_ROLE_COLORS[counselRole].bdr : '#cccccc';

  // Stage selector
  const roleStages  = counselRole ? (ROLE_STAGES[counselRole] ?? []) : [];

  const handleSetStage = useCallback(async (stageId: string) => {
    setIsSavingStage(true);
    const patch = { current_stage: stageId };
    updateActiveCase(patch);
    try {
      await saveCase({ ...activeCase, ...patch });
    } catch (e) {
      console.error('[CaseOverview] saveCase failed', e);
    } finally {
      setIsSavingStage(false);
      setStagePickerOpen(false);
    }
  }, [activeCase, updateActiveCase]);

  // Legacy V1 fallback colours
  const legacyRole  = activeCase.role || 'Claimant';
  const legacyClr   = LEGACY_ROLE_COLORS[legacyRole] || LEGACY_ROLE_COLORS.Claimant;

  // Identity border accent
  const borderAccent = counselRole ? roleAccent : legacyClr.col;

  // ── Upcoming deadlines ────────────────────────────────────────────────────
  const upcoming = [...deadlines]
    .filter(d => d.status !== 'Dismissed')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 3);

  // ── Recent entries ────────────────────────────────────────────────────────
  const recent = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  // ── Module readiness — V2 role-aware, V1 generic fallback ─────────────────
  interface ModStatus { id: DashTabId; icon: string; label: string; done: boolean; desc: string; }

  const v2Modules: ModStatus[] = modules ? modules.map(m => ({
    id:    m.id,
    icon:  m.icon,
    label: m.label,
    done:
      m.id === 'intelligence' ? !!(intel?.intPkg) :
      m.id === 'evidence'     ? evidence.length > 0 :
      m.id === 'filings'      ? entries.length > 0 :
      m.id === 'builder'      ? argVers.length > 0 :
      m.id === 'appeal'       ? !!(activeCase.appeal_data as any)?.package :
      false,
    desc: m.desc,
  })) : [];

  const v1Modules: ModStatus[] = [
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',   done: !!(intel?.intPkg), desc: intel?.intPkg ? 'Package generated' : 'Run 5-step intake' },
    { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',  done: !!(activeCase.appeal_data as any)?.package, desc: 'Appellate package' },
    { id: 'evidence',     icon: '📁', label: 'Evidence',       done: evidence.length > 0, desc: `${evidence.length} file(s)` },
    { id: 'builder',      icon: '✍',  label: 'Arg Builder',    done: argVers.length > 0, desc: `${argVers.length} argument(s)` },
    { id: 'docket',       icon: '⚖',  label: 'Docket',         done: entries.length > 0, desc: `${entries.length} entr(y/ies)` },
    { id: 'risk',         icon: '■',  label: 'Risk Analytics', done: false, desc: 'Score 8 risk dimensions' },
  ];

  const displayModules = counselRole ? v2Modules : v1Modules;
  const doneCount = displayModules.filter(m => m.done).length;
  const pct = displayModules.length > 0 ? Math.round((doneCount / displayModules.length) * 100) : 0;

  // ── Quick actions — V2 role-aware ─────────────────────────────────────────
  const v2QuickActions = counselRole ? [
    { label: 'Run Intelligence', icon: '⚡', tab: 'intelligence' as DashTabId, accent: roleAccent, hint: 'AI case analysis' },
    { label: 'Add Docket Entry', icon: '⚖', tab: 'docket' as DashTabId,       accent: roleAccent, hint: 'Log a filing or order' },
    { label: 'Brief Me Now',     icon: '🎯', tab: 'briefme' as DashTabId,      accent: roleAccent, hint: 'Pre-hearing brief' },
    { label: 'Upload Evidence',  icon: '📁', tab: 'evidence' as DashTabId,     accent: roleAccent, hint: 'Add to vault' },
  ] : [
    { label: 'Run Intelligence', icon: '⚡', tab: 'intelligence' as DashTabId, accent: '#000000', hint: '5-step AI pipeline' },
    { label: 'Add Docket Entry', icon: '⚖', tab: 'docket' as DashTabId,       accent: '#4a7ed0', hint: 'Log a filing or order' },
    { label: 'Brief Me Now',     icon: '🎯', tab: 'briefme' as DashTabId,      accent: '#40b068', hint: 'Pre-hearing brief' },
    { label: 'Build Argument',   icon: '✍',  tab: 'builder' as DashTabId,      accent: '#000000', hint: 'Draft with AI' },
    { label: 'Upload Evidence',  icon: '📁', tab: 'evidence' as DashTabId,     accent: '#5090d0', hint: 'Add to vault' },
    { label: 'War Room',         icon: '⬛', tab: 'warroom' as DashTabId,      accent: '#8050d0', hint: 'Strategic cockpit' },
  ];

  if (loading) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center' }}>
        <span style={{ display: 'inline-block', width: 24, height: 24, border: `2px solid ${T.bdr}`, borderTop: `2px solid #000`, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Role Position Panel ─────────────────────────────────────────────── */}
      <div style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 10, padding: '20px 22px', marginBottom: 16,
        borderLeft: `3px solid ${borderAccent}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>

          {/* Role badge */}
          <div style={{
            background: counselRole ? roleBg : legacyClr.bg,
            border: `1px solid ${counselRole ? roleBdr : legacyClr.bdr}`,
            borderRadius: 7, padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
          }}>
            <span style={{ fontSize: 16 }}>{posConfig?.icon ?? legacyClr.icon}</span>
            <div>
              <div style={{
                fontSize: 7, color: borderAccent,
                fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2,
              }}>
                {posConfig ? posConfig.positionLabel : 'Our Role'}
              </div>
              <div style={{
                fontSize: 13, color: borderAccent,
                fontFamily: "'Times New Roman', Times, serif",
                fontWeight: 700, letterSpacing: '.04em',
              }}>
                {counselRole
                  ? COUNSEL_ROLE_LABELS[counselRole].toUpperCase()
                  : legacyRole.toUpperCase()
                }
              </div>
            </div>
          </div>

          {/* Case metadata */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{
              fontSize: 22, color: T.text,
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 300, marginBottom: 6,
            }}>
              {activeCase.caseName}
            </h2>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
              {matterTrack && (
                <span style={{
                  fontSize: 9, padding: '2px 7px', borderRadius: 3,
                  fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                  letterSpacing: '.1em', textTransform: 'uppercase',
                  background: MATTER_TRACK_COLORS[matterTrack].bg,
                  border: `1px solid ${MATTER_TRACK_COLORS[matterTrack].bdr}`,
                  color: MATTER_TRACK_COLORS[matterTrack].col,
                }}>
                  {MATTER_TRACK_LABELS[matterTrack]}
                </span>
              )}
              {activeCase.court && (
                <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                  ⚖ {activeCase.court}
                </span>
              )}
              {activeCase.suitNo && (
                <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                  {activeCase.suitNo}
                </span>
              )}
              {activeCase.dateCommenced && (
                <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                  Filed: {fmtDate(activeCase.dateCommenced)}
                </span>
              )}
            </div>
            {posConfig?.positionDesc && (
              <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, margin: 0 }}>
                {posConfig.positionDesc}
              </p>
            )}
          </div>

          {/* Health widgets */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <div style={{ background: T.bg, border: `1px solid ${T.bdr}`, borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 400, lineHeight: 1 }}>{days}</div>
              <div style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>days active</div>
            </div>
            <div style={{ background: T.bg, border: `1px solid ${urgency.color}33`, borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: urgency.color, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, lineHeight: 1 }}>{urgency.label}</div>
              <div style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>
                {urgency.count > 0 ? `${urgency.count} deadline${urgency.count !== 1 ? 's' : ''}` : 'no deadlines'}
              </div>
            </div>
          </div>
        </div>

        {/* Next Action strip */}
        {nextAction && (
          <div style={{
            marginTop: 16, padding: '10px 14px',
            background: `${roleAccent}0a`,
            border: `1px solid ${roleAccent}25`,
            borderRadius: 6,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 14, color: roleAccent, flexShrink: 0, marginTop: 1 }}>→</span>
            <div>
              <div style={{ fontSize: 8, color: roleAccent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                {posConfig?.nextActionLabel ?? 'Next Action'}
              </div>
              <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>
                {nextAction}
              </div>
            </div>
          </div>
        )}

        {/* Stage picker */}
        {counselRole && roleStages.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.bdr}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 8, color: T.mute,
                fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600,
              }}>
                Current Stage
              </span>
              {activeCase.current_stage && (() => {
                const st = roleStages.find(s => s.id === activeCase.current_stage);
                return st ? (
                  <span style={{
                    fontSize: 10, color: roleAccent,
                    fontFamily: "'Times New Roman', Times, serif",
                    background: `${roleAccent}18`,
                    border: `1px solid ${roleAccent}40`,
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
                  fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                  cursor: 'pointer', letterSpacing: '.04em',
                  transition: 'all .15s',
                }}
              >
                {stagePickerOpen ? '✕ Close' : (activeCase.current_stage ? '✎ Change Stage' : '+ Set Stage')}
              </button>
              <button
                onClick={() => setDashTab('timeline' as DashTabId)}
                style={{
                  background: 'transparent', border: 'none',
                  color: T.mute, fontSize: 10,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: 'pointer', letterSpacing: '.04em',
                  textDecoration: 'underline',
                }}
              >
                View Timeline →
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
                      onClick={() => !isActive && handleSetStage(stage.id)}
                      disabled={isSavingStage || isActive}
                      style={{
                        background: isActive ? `${roleAccent}18` : T.bg,
                        border: `1px solid ${isActive ? roleAccent + '50' : T.bdr}`,
                        borderRadius: 5, padding: '8px 12px',
                        textAlign: 'left', cursor: isActive ? 'default' : 'pointer',
                        transition: 'all .15s',
                        opacity: isSavingStage && !isActive ? 0.5 : 1,
                      }}
                      onMouseEnter={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = roleAccent + '50';
                      }}
                      onMouseLeave={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = T.bdr;
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: isActive ? roleAccent : T.mute }}>{isActive ? '●' : '◦'}</span>
                        <span style={{ fontSize: 12, color: isActive ? roleAccent : T.sub, fontFamily: "'Times New Roman', Times, serif", fontWeight: isActive ? 600 : 400 }}>
                          {stage.label}
                        </span>
                        {isActive && <span style={{ marginLeft: 'auto', fontSize: 8, color: roleAccent, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em' }}>CURRENT</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Parties row */}
        {(activeCase.claimants?.length > 0 || activeCase.defendants?.length > 0) && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.bdr}`, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {activeCase.claimants?.length > 0 && (
              <div>
                <div style={{ fontSize: 8, color: '#4a7ed0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                  {matterTrack === 'criminal' ? 'Complainant' : `Claimant${activeCase.claimants.length > 1 ? 's' : ''}`}
                </div>
                {activeCase.claimants.map(p => (
                  <div key={p.id} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{p.name}</div>
                ))}
              </div>
            )}
            {activeCase.defendants?.length > 0 && (
              <div>
                <div style={{ fontSize: 8, color: '#c06040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                  {matterTrack === 'criminal' ? `Accused` : `Defendant${activeCase.defendants.length > 1 ? 's' : ''}`}
                </div>
                {activeCase.defendants.map(p => (
                  <div key={p.id} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{p.name}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Risk Flags — role-specific ──────────────────────────────────────── */}
      {riskFlags && (
        <div style={{
          background: T.card, border: `1px solid ${T.bdr}`,
          borderRadius: 10, padding: '18px 20px', marginBottom: 16,
        }}>
          <SectionHeader icon={posConfig?.icon ?? '⚠'} title={posConfig?.riskLabel ?? 'Risk Flags'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {riskFlags.map((rf, i) => {
              const sc = SEVERITY_COLORS[rf.severity];
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '9px 12px',
                  background: sc.bg, border: `1px solid ${sc.bdr}`,
                  borderRadius: 6,
                }}>
                  <span style={{
                    fontSize: 8, color: sc.col,
                    fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                    letterSpacing: '.1em', textTransform: 'uppercase',
                    background: `${sc.col}15`, border: `1px solid ${sc.bdr}`,
                    borderRadius: 3, padding: '2px 6px', flexShrink: 0, marginTop: 2,
                  }}>
                    {rf.severity}
                  </span>
                  <span style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>
                    {rf.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Two-column: Deadlines + Intelligence ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        <Panel
          icon="⏱"
          title="Upcoming Deadlines"
          action={upcoming.length > 0 ? { label: 'All Deadlines →', onClick: () => setDashTab('docket' as DashTabId) } : undefined}
        >
          {upcoming.length === 0 ? (
            <Empty label="No active deadlines." action={{ label: 'Add in Docket →', onClick: () => setDashTab('docket' as DashTabId) }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcoming.map(dl => {
                const diff    = daysUntil(dl.date);
                const overdue = diff < 0;
                const soon    = diff >= 0 && diff <= 7;
                const col     = overdue ? '#c05050' : soon ? '#b07030' : T.mute;
                return (
                  <div key={dl.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dl.label}</div>
                      <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{dl.type}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                        {overdue ? `${Math.abs(diff)}d ago` : diff === 0 ? 'Today' : `${diff}d`}
                      </div>
                      <div style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{fmtDate(dl.date)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          icon="⚡"
          title="Intelligence Status"
          action={{ label: intel?.intPkg ? 'View Package →' : 'Run Intelligence →', onClick: () => setDashTab('intelligence' as DashTabId) }}
        >
          {!intel?.intPkg ? (
            <Empty label="Intelligence package not yet generated." action={{ label: 'Run 5-Step Pipeline →', onClick: () => setDashTab('intelligence' as DashTabId) }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <IntelChip label="Facts" done={!!intel.facts} />
              <IntelChip label="Legal Issues" done={!!(intel.legal_issues || intel.extraction?.legal_issues?.length)} />
              <IntelChip label="Disputes" done={!!intel.disputes} />
              <IntelChip label="Evidence Matrix" done={!!(intel.evidenceM?.length)} />
              <IntelChip label="Full Package" done={!!intel.intPkg} highlight />
            </div>
          )}
        </Panel>
      </div>

      {/* ── Module Readiness Grid ───────────────────────────────────────────── */}
      <div style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 10, padding: '18px 20px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionHeader icon="◉" title="Case Readiness" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 80, height: 5, background: T.bdr, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, transition: 'width .5s ease',
                background: pct < 30 ? '#c05050' : pct < 70 ? '#b07030' : '#40b068' }} />
            </div>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{pct}%</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8 }}>
          {displayModules.map(m => (
            <button
              key={m.id}
              onClick={() => setDashTab(m.id as DashTabId)}
              style={{
                background:   m.done ? '#f0faf4' : T.bg,
                border:       `1px solid ${m.done ? '#a0d8b4' : T.bdr}`,
                borderRadius: 6, padding: '10px 12px',
                textAlign: 'left', cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = m.done ? '#60c080' : (counselRole ? roleAccent : '#888');
                (e.currentTarget as HTMLElement).style.background  = m.done ? '#e6f7ee' : '#fafafa';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = m.done ? '#a0d8b4' : T.bdr;
                (e.currentTarget as HTMLElement).style.background  = m.done ? '#f0faf4' : T.bg;
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>{m.icon}</span>
                <span style={{ fontSize: 11, color: m.done ? '#2a7048' : T.dim, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{m.label}</span>
                {m.done && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#40b068' }}>✓</span>}
              </div>
              <p style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, margin: 0 }}>{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Recent Docket Entries ───────────────────────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionHeader icon="⚖" title="Recent Docket Entries" />
          <button
            onClick={() => setDashTab('docket' as DashTabId)}
            style={{ background: 'transparent', border: `1px solid ${T.bdr}`, color: T.mute, borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em' }}
          >
            Full Docket →
          </button>
        </div>
        {recent.length === 0 ? (
          <Empty label="No docket entries yet." action={{ label: 'Open Docket →', onClick: () => setDashTab('docket' as DashTabId) }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map(e => {
              const dot = STATUS_DOT[e.status] || T.mute;
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: T.bg, borderRadius: 6, border: `1px solid ${T.bdr}` }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.docTitle}</div>
                    <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{e.docType} · {e.filedBy}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: dot, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{e.status}</div>
                    <div style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{fmtDate(e.dateFiled || e.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Quick Actions ───────────────────────────────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '18px 20px' }}>
        <SectionHeader icon="→" title="Quick Actions" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, marginTop: 14 }}>
          {v2QuickActions.map(a => (
            <button
              key={a.tab}
              onClick={() => setDashTab(a.tab)}
              style={{
                background:   `${a.accent}0a`,
                border:       `1px solid ${a.accent}25`,
                borderRadius: 7, padding: '12px 14px',
                textAlign: 'left', cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `${a.accent}18`;
                (e.currentTarget as HTMLElement).style.borderColor = `${a.accent}55`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = `${a.accent}0a`;
                (e.currentTarget as HTMLElement).style.borderColor = `${a.accent}25`;
              }}
            >
              <div style={{ fontSize: 14, marginBottom: 5 }}>{a.icon}</div>
              <div style={{ fontSize: 13, color: a.accent, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 2 }}>{a.label}</div>
              <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{a.hint}</div>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 12, color: T.dim }}>{icon}</span>
      <span style={{ fontSize: 9, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
        {title}
      </span>
    </div>
  );
}

interface PanelProps {
  icon:     string;
  title:    string;
  children: React.ReactNode;
  action?:  { label: string; onClick: () => void };
}

function Panel({ icon, title, children, action }: PanelProps) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <SectionHeader icon={icon} title={title} />
        {action && (
          <button
            onClick={action.onClick}
            style={{ background: 'transparent', border: 'none', color: T.dim, fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', padding: 0 }}
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty({ label, action }: { label: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: action ? 8 : 0 }}>{label}</p>
      {action && (
        <button onClick={action.onClick} style={{ background: 'transparent', border: 'none', color: T.dim, fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', textDecoration: 'underline' }}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function IntelChip({ label, done, highlight }: { label: string; done: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: done ? '#40b068' : T.mute }}>{done ? '✓' : '○'}</span>
      <span style={{ fontSize: highlight ? 12 : 11, color: done ? (highlight ? '#2a7048' : T.sub) : T.mute, fontFamily: "'Times New Roman', Times, serif", fontWeight: highlight ? 600 : 400 }}>
        {label}
      </span>
      {highlight && done && (
        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, border: '1px solid #a0d8b4', padding: '1px 6px', borderRadius: 2, background: '#f0faf4' }}>
          READY
        </span>
      )}
    </div>
  );
}
