/**
 * AFS Legal OS — Floating Engine Buttons
 *
 * AICopilot + ApplicationsEngine as floating action buttons
 * visible only inside case workspaces (engine + matrimonial views).
 * Hidden on home, gate, san, settings, resolver.
 *
 * Phase 0B (Build Plan v5 — Navigation Shell, Civil only):
 * - Criminal matters (view === 'engine' && matter_track === 'criminal') keep
 *   the original behaviour untouched: floating buttons toggle a slide-in
 *   overlay panel rendered on top of the current screen.
 * - Everything else (civil, matrimonial, and any matter view without a
 *   criminal track) gets a different mechanism: the same two floating
 *   buttons now navigate full-page via setDashTab() instead of opening an
 *   overlay panel — no panel/backdrop/local AICopilot+ApplicationsEngine
 *   mount, just a route into the existing EngineContent router so the
 *   engine renders as its own full page like every other civil tab.
 * - This is also the anchor point for 0C's "More" menu: the secondary
 *   engines bumped out of the civil 4-tab bar in 0A (Evidence, CrossExam,
 *   Enforcement, Intelligence, Synthesis, MatrimonialEngine) will hang off
 *   this same civil-only nav, not off the criminal overlay.
 *
 * Phase 0C (Build Plan v5 — Navigation Shell, Civil only):
 * - Added a third FAB, "More", civil/matrimonial branch only. Toggles a
 *   lightweight dropdown list (not the criminal slide-in panel mechanism —
 *   no backdrop-blocking modal, no inline engine mount) of secondary
 *   engines: Intelligence, Evidence, CrossExam, Enforcement, Synthesis.
 * - MatrimonialEngine is added to that list only when
 *   activeCase.matter_track === 'matrimonial' — this is the actual landing
 *   spot for the matrimonial engine now that 0E removes its dedicated tab;
 *   the engine itself is untouched, only its entry point moved here.
 * - Each item just calls setDashTab(id) and closes the menu — same
 *   full-page routing mechanism as the Apps/Copilot buttons from 0B.
 */

import { useState, useCallback, useEffect } from 'react';
import { AICopilot } from '@/engines/AICopilot';
import { ApplicationsEngine } from '@/engines/ApplicationsEngine';
import { useAppStore } from '@/state/appStore';
import { loadBlindSpot } from '@/storage/helpers';
import { T } from '@/constants/tokens';
import type { DashTabId } from '@/types';

type OpenPanel = 'copilot' | 'applications' | null;

// Phase 0C — Secondary engines for the civil/matrimonial "More" menu.
// Matrimonial is appended conditionally (matter_track === 'matrimonial')
// inside the component, not listed here statically.
const MORE_MENU_ITEMS: { id: DashTabId; label: string; icon: string }[] = [
  { id: 'intelligence', label: 'Intelligence', icon: '◎' },
  { id: 'evidence',     label: 'Evidence',      icon: '⊞' },
  { id: 'crossexam',    label: 'Cross-Exam',    icon: '?' },
  { id: 'enforcement',  label: 'Enforcement',   icon: '⚑' },
  { id: 'synthesis',    label: 'Synthesis',     icon: '∑' },
];

export function FloatingEngines() {
  const [open, setOpen] = useState<OpenPanel>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { activeCase, view, setDashTab } = useAppStore();

  // Restrict to case workspace views only
  if (view !== 'engine' && view !== 'matrimonial') return null;

  // Phase 0B: criminal is the only track that still uses the overlay panel.
  // matrimonial view and civil engine view (matter_track !== 'criminal')
  // both fall through to the full-page nav branch below.
  const isCriminal = view === 'engine' && activeCase?.matter_track === 'criminal';

  const toggle = useCallback((panel: OpenPanel) => {
    setOpen(prev => (prev === panel ? null : panel));
  }, []);

  const close = useCallback(() => setOpen(null), []);

  // ── Phase 0B — Civil / matrimonial: full-page nav, no overlay ────────────
  // Same two buttons, but they route into the dashboard's own tab content
  // instead of toggling a slide-in panel. Secondary engines added for the
  // 0C "More" menu will live in this branch too.
  // Phase 5D — load FWA status to badge Enforcement in More menu
  const [fwaAdopted, setFwaAdopted] = useState(false);
  useEffect(() => {
    if (!activeCase?.id) return;
    loadBlindSpot<{ status?: string }>(activeCase.id, 'fwa_status', {}).then(rec => {
      setFwaAdopted(rec?.status === 'Adopted');
    });
  }, [activeCase?.id]);

  if (!isCriminal) {
    // Phase 0C — append MatrimonialEngine to the More list only for
    // matrimonial-track matters; civil matters never see it.
    const moreItems = activeCase?.matter_track === 'matrimonial'
      ? [...MORE_MENU_ITEMS, { id: 'matrimonial' as DashTabId, label: 'Matrimonial', icon: '⚭' }]
      : MORE_MENU_ITEMS;

    const goTo = (id: DashTabId) => {
      setDashTab(id);
      setMoreOpen(false);
    };

    return (
      <>
        <div style={fabGroup}>
          <button
            onClick={() => setDashTab('applications')}
            title="Applications Engine"
            style={{ ...fabBtn, background: T.bg, color: T.text, border: `1.5px solid ${T.bdr}` }}
          >
            <span style={fabIcon}>⚖</span>
            <span style={fabLabel}>Apps</span>
          </button>

          <button
            onClick={() => setDashTab('copilot')}
            title="AI Copilot"
            style={{ ...fabBtn, background: T.bg, color: T.text, border: `1.5px solid ${T.bdr}` }}
          >
            <span style={fabIcon}>✦</span>
            <span style={fabLabel}>Copilot</span>
          </button>

          {/* Phase 0C — More menu for secondary engines */}
          <button
            onClick={() => setMoreOpen(prev => !prev)}
            title="More engines"
            style={{
              ...fabBtn,
              background: moreOpen ? T.text : T.bg,
              color:      moreOpen ? T.bg   : T.text,
              border: `1.5px solid ${T.bdr}`,
            }}
          >
            <span style={fabIcon}>⋯</span>
            <span style={fabLabel}>More</span>
          </button>
        </div>

        {moreOpen && (
          <>
            {/* Click-outside-to-close — transparent, not the criminal modal backdrop */}
            <div onClick={() => setMoreOpen(false)} style={moreBackdrop} />
            <div style={moreMenu}>
              {moreItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => goTo(item.id)}
                  style={moreMenuItem}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f0f0ee'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 13 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.id === 'enforcement' && fwaAdopted && (
                    <span
                      title="Final Written Address adopted — enforcement ready"
                      style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#1a5a30', display: 'inline-block', flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  // ── Criminal — unchanged overlay behaviour ───────────────────────────────
  return (
    <>
      {/* ── Floating Buttons ── */}
      <div style={fabGroup}>
        {/* Applications Engine */}
        <button
          onClick={() => toggle('applications')}
          title="Applications Engine"
          style={{
            ...fabBtn,
            background: open === 'applications' ? T.text : T.bg,
            color:      open === 'applications' ? T.bg   : T.text,
            border: `1.5px solid ${T.bdr}`,
          }}
        >
          <span style={fabIcon}>⚖</span>
          <span style={fabLabel}>Apps</span>
        </button>

        {/* AI Copilot */}
        <button
          onClick={() => toggle('copilot')}
          title="AI Copilot"
          style={{
            ...fabBtn,
            background: open === 'copilot' ? T.text : T.bg,
            color:      open === 'copilot' ? T.bg   : T.text,
            border: `1.5px solid ${T.bdr}`,
          }}
        >
          <span style={fabIcon}>✦</span>
          <span style={fabLabel}>Copilot</span>
        </button>
      </div>

      {/* ── Slide-in Panel ── */}
      {open && (
        <>
          {/* Backdrop */}
          <div onClick={close} style={backdrop} />

          {/* Panel */}
          <div style={panel}>
            {/* Panel Header */}
            <div style={panelHeader}>
              <span style={panelTitle}>
                {open === 'copilot' ? '✦ AI Copilot' : '⚖ Applications Engine'}
              </span>
              <button onClick={close} style={closeBtn}>✕</button>
            </div>

            {/* Panel Content */}
            <div style={panelBody}>
              {open === 'copilot' && (
                <AICopilot activeCase={activeCase ?? null} />
              )}
              {open === 'applications' && activeCase && (
                <ApplicationsEngine activeCase={activeCase} />
              )}
              {open === 'applications' && !activeCase && (
                <div style={noCase}>
                  <p style={{ fontFamily: "'Times New Roman', Times, serif", color: T.mute, fontSize: 14 }}>
                    Open a case first to use the Applications Engine.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const fabGroup: React.CSSProperties = {
  position:      'fixed',
  bottom:        28,
  right:         20,
  display:       'flex',
  flexDirection: 'column',
  gap:           10,
  zIndex:        1000,
};

const fabBtn: React.CSSProperties = {
  display:        'flex',
  flexDirection:  'column',
  alignItems:     'center',
  justifyContent: 'center',
  width:          56,
  height:         56,
  borderRadius:   '50%',
  cursor:         'pointer',
  boxShadow:      '0 2px 12px rgba(0,0,0,0.15)',
  transition:     'all .2s ease',
  padding:        0,
};

const fabIcon: React.CSSProperties = {
  fontSize:   18,
  lineHeight: 1,
};

const fabLabel: React.CSSProperties = {
  fontSize:      8,
  fontFamily:    "'Times New Roman', Times, serif",
  letterSpacing: '.05em',
  marginTop:     2,
};

const backdrop: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.25)',
  zIndex:     1001,
};

const panel: React.CSSProperties = {
  position:    'fixed',
  bottom:      0,
  right:       0,
  width:       'min(480px, 100vw)',
  height:      '85vh',
  background:  T.bg,
  borderTop:   `1px solid ${T.bdr}`,
  borderLeft:  `1px solid ${T.bdr}`,
  borderRadius: '12px 0 0 0',
  zIndex:      1002,
  display:     'flex',
  flexDirection: 'column',
  boxShadow:   '-4px 0 24px rgba(0,0,0,0.12)',
  animation:   'slideUp .25s ease',
};

const panelHeader: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '14px 18px',
  borderBottom:   `1px solid ${T.bdr}`,
  flexShrink:     0,
};

const panelTitle: React.CSSProperties = {
  fontFamily:    "'Times New Roman', Times, serif",
  fontSize:      15,
  fontWeight:    700,
  color:         T.text,
  letterSpacing: '.03em',
};

const closeBtn: React.CSSProperties = {
  background: 'none',
  border:     'none',
  cursor:     'pointer',
  color:      T.mute,
  fontSize:   16,
  padding:    '2px 6px',
};

const panelBody: React.CSSProperties = {
  flex:      1,
  overflowY: 'auto',
  padding:   '0',
};

const noCase: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  height:         '100%',
  padding:        32,
  textAlign:      'center',
};

// ── Phase 0C — "More" menu styles (civil/matrimonial only) ──────────────────

const moreBackdrop: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'transparent',
  zIndex:     1000,
};

const moreMenu: React.CSSProperties = {
  position:      'fixed',
  bottom:        96,
  right:         20,
  background:    T.bg,
  border:        `1.5px solid ${T.bdr}`,
  borderRadius:  8,
  boxShadow:     '0 4px 18px rgba(0,0,0,0.15)',
  zIndex:        1001,
  display:       'flex',
  flexDirection: 'column',
  minWidth:      160,
  padding:       4,
  animation:     'fadeUp .15s ease',
};

const moreMenuItem: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:            8,
  width:          '100%',
  background:     'transparent',
  border:         'none',
  borderRadius:   4,
  padding:        '8px 10px',
  cursor:         'pointer',
  fontFamily:     "'Times New Roman', Times, serif",
  fontSize:       12,
  color:          T.text,
  textAlign:      'left',
  letterSpacing:  '.02em',
  transition:     'background .15s',
};
