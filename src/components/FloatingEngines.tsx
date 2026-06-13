/**
 * AFS Legal OS — Floating Engine Buttons
 *
 * AICopilot + ApplicationsEngine as floating action buttons
 * visible on every page. Click to open as sliding panel overlay.
 */

import { useState, useCallback } from 'react';
import { AICopilot } from '@/engines/AICopilot';
import { ApplicationsEngine } from '@/engines/ApplicationsEngine';
import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';

type OpenPanel = 'copilot' | 'applications' | null;

export function FloatingEngines() {
  const [open, setOpen] = useState<OpenPanel>(null);
  const { activeCase } = useAppStore();

  const toggle = useCallback((panel: OpenPanel) => {
    setOpen(prev => (prev === panel ? null : panel));
  }, []);

  const close = useCallback(() => setOpen(null), []);

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
