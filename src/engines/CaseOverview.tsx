/**
 * AFS Advocates — Case Overview Engine
 *
 * The first tab opened in every case. Provides a full operational snapshot:
 *   · Case identity panel (metadata, parties, role badge)
 *   · Case health radial — days active, urgency level
 *   · Upcoming deadlines strip (next 3 from IndexedDB)
 *   · Module readiness grid — which engines have data vs are empty
 *   · Recent docket entries (last 4)
 *   · Intelligence summary (if generated)
 *   · Quick-action buttons to navigate directly to key engines
 *
 * Polish Phase — replaces the Phase 1 stub with a full implementation.
 */

import React, { useState, useEffect } from 'react';
import { T } from '@/constants/tokens';
import { useAppStore } from '@/state/appStore';
import {
  loadEntries,
  loadDeadlines,
  loadEvidenceMeta,
  loadArgVersions,
} from '@/storage/helpers';
import type { Case, DocketEntry, Deadline, EvidenceItem, ArgumentVersion } from '@/types';
import type { DashTabId } from '@/types';

// ── Colour tokens for role badge ──────────────────────────────────────────────

const ROLE_COLORS: Record<string, { col: string; bg: string; bdr: string; icon: string }> = {
  Claimant:   { col: '#4a7ed0', bg: '#081428', bdr: '#1a3060', icon: '⚔' },
  Defendant:  { col: '#c06040', bg: '#180c08', bdr: '#602010', icon: '🛡' },
  Appellant:  { col: '#8050d0', bg: '#0e0818', bdr: '#401880', icon: '↑' },
  Respondent: { col: '#c04080', bg: '#180810', bdr: '#601030', icon: '↓' },
  Both:       { col: '#8050d0', bg: '#0e0818', bdr: '#401880', icon: '⚖' },
};

// ── Status colours (mirroring docket) ─────────────────────────────────────────

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
  'Settled':           '#000000',
};

// ── Module health items ────────────────────────────────────────────────────────

interface ModuleStatus {
  id:    DashTabId;
  icon:  string;
  label: string;
  done:  boolean;
  desc:  string;
}

// ── Urgency from deadlines ────────────────────────────────────────────────────

function getUrgencyLevel(deadlines: Deadline[]): { label: string; color: string; count: number } {
  const now = new Date();
  const active = deadlines.filter(d => d.status !== 'Dismissed');
  const overdue = active.filter(d => new Date(d.date) < now);
  const soon    = active.filter(d => {
    const diff = (new Date(d.date).getTime() - now.getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  if (overdue.length > 0) return { label: 'OVERDUE', color: '#c05050', count: overdue.length };
  if (soon.length > 0)    return { label: 'URGENT',  color: T.text, count: soon.length };
  if (active.length > 0)  return { label: 'ACTIVE',  color: '#40a878', count: active.length };
  return { label: 'CLEAR', color: T.mute, count: 0 };
}

// ── Days active calculation ───────────────────────────────────────────────────

function daysActive(createdAt: string): number {
  const created = new Date(createdAt);
  return Math.floor((Date.now() - created.getTime()) / 86400000);
}

// ── Format date nicely ────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

export function CaseOverview({ activeCase }: Props) {
  const { setDashTab } = useAppStore();

  const [entries,    setEntries]    = useState<DocketEntry[]>([]);
  const [deadlines,  setDeadlines]  = useState<Deadline[]>([]);
  const [evidence,   setEvidence]   = useState<EvidenceItem[]>([]);
  const [argVers,    setArgVers]    = useState<ArgumentVersion[]>([]);
  const [loading,    setLoading]    = useState(true);

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

  const role    = activeCase.role || 'Claimant';
  const roleClr = ROLE_COLORS[role] || ROLE_COLORS.Claimant;
  const days    = daysActive(activeCase.createdAt);
  const urgency = getUrgencyLevel(deadlines);

  // ── Module health ───────────────────────────────────────────────────────────
  const intel  = activeCase.intelligence_data;
  const appeal = activeCase.appeal_data;

  const modules: ModuleStatus[] = [
    { id: 'intelligence', icon: '⚡', label: 'Intelligence',    done: !!(intel?.intPkg),        desc: intel?.intPkg ? 'Package generated' : 'Run the 5-step intake pipeline' },
    { id: 'appeal',       icon: '↑',  label: 'Appeal Engine',   done: !!(appeal?.package),      desc: appeal?.package ? 'Appellate package ready' : 'No appeal data yet' },
    { id: 'evidence',     icon: '📁', label: 'Evidence Vault',  done: evidence.length > 0,      desc: evidence.length > 0 ? `${evidence.length} file${evidence.length !== 1 ? 's' : ''} uploaded` : 'No files uploaded' },
    { id: 'builder',      icon: '✍',  label: 'Arg Builder',     done: argVers.length > 0,       desc: argVers.length > 0 ? `${argVers.length} argument${argVers.length !== 1 ? 's' : ''} saved` : 'No arguments yet' },
    { id: 'docket',       icon: '⚖',  label: 'Docket',          done: entries.length > 0,       desc: entries.length > 0 ? `${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'} logged` : 'No entries yet' },
    { id: 'briefme',      icon: '🎯', label: 'Brief Me',        done: !!(activeCase.intelligence_data?.intPkg && entries.length > 0), desc: 'Generates from your case data' },
    { id: 'compliance',   icon: '⚙',  label: 'Compliance',      done: false,                    desc: 'Run procedural audit' },
    { id: 'risk',         icon: '■',  label: 'Risk Analytics',  done: false,                    desc: 'Score 8 risk dimensions' },
    { id: 'warroom',      icon: '⬛', label: 'War Room',         done: !!(intel?.intPkg),        desc: 'Strategic cockpit' },
    { id: 'crossexam',    icon: '⚔',  label: 'Cross-Exam',      done: false,                    desc: 'Build examination strategies' },
    { id: 'blindspots',   icon: '◈',  label: 'Blind Spots',     done: false,                    desc: '7 intelligence modules' },
    { id: 'san',          icon: '⭐', label: 'SAN Mode',         done: false,                    desc: 'Senior advocate AI' },
  ];

  const doneCount = modules.filter(m => m.done).length;
  const pct = Math.round((doneCount / modules.length) * 100);

  // ── Upcoming deadlines (next 3, sorted) ────────────────────────────────────
  const upcoming = [...deadlines]
    .filter(d => d.status !== 'Dismissed')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 3);

  // ── Recent entries (last 4) ─────────────────────────────────────────────────
  const recent = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  if (loading) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center' }}>
        <span style={{ display: 'inline-block', width: 24, height: 24, border: `2px solid ${T.bdr}`, borderTop: `2px solid ${T.gold}`, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Identity Panel ─────────────────────────────────────────────────── */}
      <div style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 10, padding: '22px 24px', marginBottom: 16,
        borderLeft: `3px solid ${roleClr.col}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>

          {/* Role badge */}
          <div style={{
            background: roleClr.bg, border: `1px solid ${roleClr.bdr}`,
            borderRadius: 6, padding: '8px 14px',
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          }}>
            <span style={{ fontSize: 14 }}>{roleClr.icon}</span>
            <div>
              <div style={{ fontSize: 7, color: roleClr.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Our Role</div>
              <div style={{ fontSize: 13, color: roleClr.col, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, letterSpacing: '.04em' }}>{role.toUpperCase()}</div>
            </div>
          </div>

          {/* Case metadata */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ fontSize: 22, color: T.goldL, fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 6 }}>
              {activeCase.caseName}
            </h2>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {activeCase.court && (
                <span style={{ fontSize: 11, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>
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
          </div>

          {/* Health indicators */}
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {/* Days active */}
            <div style={{ background: T.bg, border: `1px solid ${T.bdr}`, borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, color: T.goldL, fontFamily: "'Times New Roman', Times, serif", fontWeight: 400, lineHeight: 1 }}>{days}</div>
              <div style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>days active</div>
            </div>
            {/* Urgency */}
            <div style={{ background: T.bg, border: `1px solid ${urgency.color}33`, borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: urgency.color, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, lineHeight: 1 }}>{urgency.label}</div>
              <div style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>
                {urgency.count > 0 ? `${urgency.count} deadline${urgency.count !== 1 ? 's' : ''}` : 'no deadlines'}
              </div>
            </div>
          </div>
        </div>

        {/* Parties row */}
        {(activeCase.claimants?.length > 0 || activeCase.defendants?.length > 0) && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.bdr}`, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {activeCase.claimants?.length > 0 && (
              <div>
                <div style={{ fontSize: 8, color: '#4a7ed0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Claimant{activeCase.claimants.length > 1 ? 's' : ''}</div>
                {activeCase.claimants.map(p => (
                  <div key={p.id} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{p.name}</div>
                ))}
              </div>
            )}
            {activeCase.defendants?.length > 0 && (
              <div>
                <div style={{ fontSize: 8, color: '#c06040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Defendant{activeCase.defendants.length > 1 ? 's' : ''}</div>
                {activeCase.defendants.map(p => (
                  <div key={p.id} style={{ fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif" }}>{p.name}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Two-column grid ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Upcoming deadlines */}
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
                const diff = daysUntil(dl.date);
                const overdue = diff < 0;
                const urgentSoon = diff >= 0 && diff <= 7;
                const col = overdue ? '#c05050' : urgentSoon ? '#b07030' : T.sub;
                return (
                  <div key={dl.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dl.label}
                      </div>
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

        {/* Intelligence summary */}
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

      {/* ── Module readiness grid ───────────────────────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionHeader icon="◉" title="Case Readiness" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 80, height: 5, background: T.bdr, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct < 30 ? '#c05050' : pct < 70 ? '#b07030' : '#40b068', borderRadius: 3, transition: 'width .5s ease' }} />
            </div>
            <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{pct}%</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {modules.map(m => (
            <button
              key={m.id}
              onClick={() => setDashTab(m.id as DashTabId)}
              style={{
                background:   m.done ? '#081a0e' : T.bg,
                border:       `1px solid ${m.done ? T.bdr : T.bdr}`,
                borderRadius: 6, padding: '10px 12px',
                textAlign: 'left', cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = m.done ? '#2a6040' : T.gold;
                (e.currentTarget as HTMLElement).style.background  = m.done ? '#0c2214' : '#0f0f1c';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = m.done ? T.bdr : T.bdr;
                (e.currentTarget as HTMLElement).style.background  = m.done ? '#081a0e' : T.bg;
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>{m.icon}</span>
                <span style={{ fontSize: 11, color: m.done ? '#40b068' : T.dim, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>{m.label}</span>
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
                    <div style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.docTitle}
                    </div>
                    <div style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                      {e.docType} · {e.filedBy}
                    </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 14 }}>
          {[
            { label: 'Run Intelligence', icon: '⚡', tab: 'intelligence', accent: '#000000', hint: '5-step AI pipeline' },
            { label: 'Add Docket Entry', icon: '⚖', tab: 'docket',        accent: '#4a7ed0', hint: 'Log a filing or order' },
            { label: 'Brief Me Now',     icon: '🎯', tab: 'briefme',      accent: '#40b068', hint: 'Pre-hearing brief' },
            { label: 'War Room',         icon: '⬛', tab: 'warroom',      accent: '#8050d0', hint: 'Strategic cockpit' },
            { label: 'Build Argument',   icon: '✍',  tab: 'builder',      accent: '#000000', hint: 'Draft with AI' },
            { label: 'Upload Evidence',  icon: '📁', tab: 'evidence',     accent: '#5090d0', hint: 'Add to vault' },
          ].map(a => (
            <button
              key={a.tab}
              onClick={() => setDashTab(a.tab as DashTabId)}
              style={{
                background: `${a.accent}10`, border: `1px solid ${a.accent}33`,
                borderRadius: 7, padding: '12px 14px',
                textAlign: 'left', cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `${a.accent}20`;
                (e.currentTarget as HTMLElement).style.borderColor = `${a.accent}66`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = `${a.accent}10`;
                (e.currentTarget as HTMLElement).style.borderColor = `${a.accent}33`;
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
      <span style={{ fontSize: 12, color: T.gold }}>{icon}</span>
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
            style={{ background: 'transparent', border: 'none', color: T.gold, fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', padding: 0 }}
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
        <button onClick={action.onClick} style={{ background: 'transparent', border: 'none', color: T.gold, fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', textDecoration: 'underline' }}>
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
      <span style={{
        fontSize: highlight ? 12 : 11,
        color: done ? (highlight ? '#40b068' : T.sub) : T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        fontWeight: highlight ? 600 : 400,
      }}>
        {label}
      </span>
      {highlight && done && (
        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#40b068', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, border: '1px solid #1a4028', padding: '1px 6px', borderRadius: 2 }}>
          READY
        </span>
      )}
    </div>
  );
}
