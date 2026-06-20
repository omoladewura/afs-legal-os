/**
 * AFS Legal OS — Strategy Hub (Phase 1A rename of Case Intelligence Engine)
 *
 * New tab: `strategy_hub`  (was: `case_intelligence`)
 * Absorbs: BlindSpots · WarRoom · BriefMe
 *
 * Three modes toggled at the top. Data flows forward:
 *   Mode 1 → feeds Mode 2 → feeds Mode 3.
 *
 *   MODE 1 — INTELLIGENCE LAYER  (BlindSpots)
 *     Conflict Check · Judge/Court Tendencies · Opposing Counsel Profiler
 *     Settlement Tracker + BATNA · Client Communication Log
 *     Witness Management · Interlocutory Tracker
 *
 *   MODE 2 — STRATEGIC COCKPIT   (WarRoom)
 *     Case Theory Map · Strategic Posture · Witness Command Map
 *     Contradictions · Risk Alerts · Appellate Vulnerabilities
 *     Opponent Strategy · Hearing Readiness · Judicial Notes
 *
 *   MODE 3 — BRIEF ME            (BriefMe)
 *     One-click pre-hearing brief across 8 structured sections
 *     Reads from Mode 1 + Mode 2 + Intelligence Engine + Evidence Vault + Docket
 *
 * Engine logic is untouched — components imported and rendered inside new shell.
 */

import React, { useState, useEffect } from 'react';
import { T } from '@/constants/tokens';
import type { Case, TokenLogEntry } from '@/types';
import { loadTokenLog } from '@/storage/helpers';

// Absorbed engines — logic untouched, rendered inside new shell
import { BlindSpots } from '@/engines/BlindSpots';
import { WarRoom }    from '@/engines/WarRoom';
import { BriefMe }    from '@/engines/BriefMe';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'intelligence' | 'strategic' | 'briefme';

interface ModeConfig {
  id:       Mode;
  icon:     string;
  label:    string;
  sublabel: string;
  desc:     string;
  color:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const MODES: ModeConfig[] = [
  {
    id:       'intelligence',
    icon:     '◈',
    label:    'Intelligence Layer',
    sublabel: 'Mode 1',
    desc:     'Conflict · Judge · Counsel · Settlement · Comms · Witnesses · Interlocutory',
    color:    '#4a7ed0',
  },
  {
    id:       'strategic',
    icon:     '⬛',
    label:    'Strategic Cockpit',
    sublabel: 'Mode 2',
    desc:     'Case Theory · Posture · Witness Map · Contradictions · Risk · Appellate · Opponent',
    color:    '#8050d0',
  },
  {
    id:       'briefme',
    icon:     '🎯',
    label:    'Brief Me',
    sublabel: 'Mode 3',
    desc:     'One-click pre-hearing brief — 8 structured sections from all sources',
    color:    '#40a878',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DATA FLOW INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

function DataFlowBadge({ activeMode }: { activeMode: Mode }) {
  const flows: Array<{ from: string; to: string; active: boolean }> = [
    { from: 'Mode 1',  to: 'Mode 2', active: activeMode === 'strategic' || activeMode === 'briefme' },
    { from: 'Mode 2',  to: 'Mode 3', active: activeMode === 'briefme' },
  ];

  return (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      gap:        6,
      marginLeft: 'auto',
      flexShrink: 0,
    }}>
      {flows.map((f, i) => (
        <React.Fragment key={i}>
          <span style={{
            fontSize:     9,
            color:        f.active ? '#40a878' : T.mute,
            fontFamily:   "'Times New Roman', Times, serif",
            letterSpacing:'.06em',
            transition:   'color .2s',
          }}>
            {f.from}
          </span>
          <span style={{ fontSize: 9, color: f.active ? '#40a878' : T.mute, transition: 'color .2s' }}>→</span>
          <span style={{
            fontSize:     9,
            color:        f.active ? '#40a878' : T.mute,
            fontFamily:   "'Times New Roman', Times, serif",
            letterSpacing:'.06em',
            transition:   'color .2s',
          }}>
            {f.to}
          </span>
          {i < flows.length - 1 && (
            <span style={{ fontSize: 9, color: T.bdr, margin: '0 2px' }}>·</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE TOGGLE BAR
// ─────────────────────────────────────────────────────────────────────────────

function ModeToggle({
  activeMode,
  onChange,
}: {
  activeMode: Mode;
  onChange:   (m: Mode) => void;
}) {
  return (
    <div style={{
      background:   T.card,
      border:       `1px solid ${T.bdr}`,
      borderRadius: 10,
      padding:      '14px 18px',
      marginBottom: 16,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <span style={{
          fontSize:     9,
          color:        T.dim,
          fontFamily:   "'Times New Roman', Times, serif",
          letterSpacing:'.14em',
          textTransform:'uppercase',
          fontWeight:   700,
        }}>
          Strategy Hub
        </span>
        <DataFlowBadge activeMode={activeMode} />
      </div>

      {/* Mode buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MODES.map(m => {
          const active = m.id === activeMode;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              style={{
                flex:        1,
                minWidth:    160,
                background:  active ? `${m.color}12` : T.bg,
                border:      `1px solid ${active ? m.color + '55' : T.bdr}`,
                borderRadius: 7,
                padding:     '12px 16px',
                textAlign:   'left',
                cursor:      'pointer',
                transition:  'all .15s',
                position:    'relative',
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.borderColor = m.color + '40';
                  (e.currentTarget as HTMLElement).style.background  = `${m.color}08`;
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.borderColor = T.bdr;
                  (e.currentTarget as HTMLElement).style.background  = T.bg;
                }
              }}
            >
              {/* Active indicator */}
              {active && (
                <div style={{
                  position:    'absolute',
                  top:         0,
                  left:        0,
                  right:       0,
                  height:      2,
                  background:  m.color,
                  borderRadius:'7px 7px 0 0',
                }} />
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <span style={{ fontSize: 14, color: active ? m.color : T.mute }}>
                  {m.icon}
                </span>
                <div>
                  <span style={{
                    fontSize:     7,
                    color:        active ? m.color : T.mute,
                    fontFamily:   "'Times New Roman', Times, serif",
                    letterSpacing:'.14em',
                    textTransform:'uppercase',
                    fontWeight:   700,
                    display:      'block',
                    marginBottom: 1,
                  }}>
                    {m.sublabel}
                  </span>
                  <span style={{
                    fontSize:   13,
                    color:      active ? m.color : T.sub,
                    fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: active ? 700 : 400,
                    letterSpacing:'.02em',
                  }}>
                    {m.label}
                  </span>
                </div>
              </div>

              <p style={{
                fontSize:   10,
                color:      T.mute,
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: 1.5,
                margin:     0,
              }}>
                {m.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE HEADER (shown above each absorbed engine)
// ─────────────────────────────────────────────────────────────────────────────

function ModeHeader({ mode }: { mode: ModeConfig }) {
  return (
    <div style={{
      display:      'flex',
      alignItems:   'center',
      gap:          10,
      marginBottom: 16,
      padding:      '10px 16px',
      background:   `${mode.color}08`,
      border:       `1px solid ${mode.color}30`,
      borderRadius: 7,
      borderLeft:   `3px solid ${mode.color}`,
    }}>
      <span style={{ fontSize: 16, color: mode.color }}>{mode.icon}</span>
      <div>
        <div style={{
          fontSize:     8,
          color:        mode.color,
          fontFamily:   "'Times New Roman', Times, serif",
          letterSpacing:'.14em',
          textTransform:'uppercase',
          fontWeight:   700,
          marginBottom: 2,
        }}>
          {mode.sublabel} — {mode.label}
        </div>
        <div style={{
          fontSize:   12,
          color:      T.mute,
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          {mode.desc}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN USAGE PANEL — Phase 8B
// ─────────────────────────────────────────────────────────────────────────────

function TokenUsagePanel({ caseId }: { caseId: string }) {
  const [open,    setOpen]    = useState(false);
  const [entries, setEntries] = useState<TokenLogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    loadTokenLog(caseId).then(setEntries);
  }, [open, caseId]);

  const recent = entries.slice(-10).reverse();

  const totals = entries.reduce(
    (acc, e) => ({
      input:      acc.input  + e.usage.input_tokens,
      output:     acc.output + e.usage.output_tokens,
      cacheRead:  acc.cacheRead  + (e.usage.cache_read_input_tokens  ?? 0),
      cacheWrite: acc.cacheWrite + (e.usage.cache_creation_input_tokens ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );

  const cacheHitPct = totals.input > 0
    ? Math.round((totals.cacheRead / totals.input) * 100)
    : 0;

  return (
    <div style={{ marginTop: 12, marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background:  'none',
          border:      `1px solid ${T.border}`,
          borderRadius: 4,
          color:        T.mute,
          cursor:       'pointer',
          fontSize:     10,
          fontFamily:   "'Times New Roman', Times, serif",
          letterSpacing:'.1em',
          padding:      '3px 10px',
          textTransform:'uppercase',
        }}
      >
        {open ? '▲' : '▼'} Token Usage
      </button>

      {open && (
        <div style={{
          background:   T.surface,
          border:       `1px solid ${T.border}`,
          borderRadius: 4,
          marginTop:    6,
          padding:      '10px 14px',
          fontSize:     11,
          fontFamily:   "'Times New Roman', Times, serif",
          color:        T.fg,
        }}>
          {/* Session totals */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Total Input',    value: totals.input.toLocaleString() },
              { label: 'Total Output',   value: totals.output.toLocaleString() },
              { label: 'Cache Reads',    value: totals.cacheRead.toLocaleString() },
              { label: 'Cache Hit %',    value: `${cacheHitPct}%` },
              { label: 'Calls Logged',   value: entries.length.toString() },
            ].map(({ label, value }) => (
              <div key={label} style={{ minWidth: 90 }}>
                <div style={{ color: T.mute, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Last 10 calls */}
          {recent.length === 0 ? (
            <div style={{ color: T.mute, fontSize: 10 }}>No calls logged yet for this case.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ color: T.mute, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  <th style={{ textAlign: 'left', paddingBottom: 4, fontWeight: 400 }}>Time</th>
                  <th style={{ textAlign: 'left', paddingBottom: 4, fontWeight: 400 }}>Engine</th>
                  <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 400 }}>In</th>
                  <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 400 }}>Out</th>
                  <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 400 }}>Cache↑</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ padding: '3px 0', color: T.mute }}>
                      {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '3px 8px 3px 0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.engine}
                    </td>
                    <td style={{ textAlign: 'right', padding: '3px 0' }}>{e.usage.input_tokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '3px 0 3px 8px' }}>{e.usage.output_tokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '3px 0 3px 8px', color: (e.usage.cache_read_input_tokens ?? 0) > 0 ? '#4a9' : T.mute }}>
                      {(e.usage.cache_read_input_tokens ?? 0) > 0
                        ? (e.usage.cache_read_input_tokens!).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT — StrategyHub
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

export function StrategyHub({ activeCase }: Props) {
  const [activeMode, setActiveMode] = useState<Mode>('intelligence');

  const currentMode = MODES.find(m => m.id === activeMode)!;

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Mode toggle ───────────────────────────────────────────────────── */}
      <ModeToggle activeMode={activeMode} onChange={setActiveMode} />

      {/* ── Token usage panel ─────────────────────────────────────────────── */}
      <TokenUsagePanel caseId={activeCase.id} />

      {/* ── Mode header ───────────────────────────────────────────────────── */}
      <ModeHeader mode={currentMode} />

      {/* ── Mode 1: Intelligence Layer (BlindSpots) ───────────────────────── */}
      {activeMode === 'intelligence' && (
        <BlindSpots activeCase={activeCase} />
      )}

      {/* ── Mode 2: Strategic Cockpit (WarRoom) ───────────────────────────── */}
      {activeMode === 'strategic' && (
        <WarRoom activeCase={activeCase} />
      )}

      {/* ── Mode 3: Brief Me (BriefMe) ────────────────────────────────────── */}
      {activeMode === 'briefme' && (
        <BriefMe activeCase={activeCase} />
      )}

    </div>
  );
}
