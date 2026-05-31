/**
 * AFS Advocates — Home Page (Mode Selector)
 * Displays all litigation modes grouped by category.
 * Clicking a mode card opens the ArgumentBuilder for that mode.
 * The Docket button opens the Case Docket overlay.
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { MODES, MODE_GROUPS } from '@/constants/modes';
import { T } from '@/constants/tokens';
import type { Mode } from '@/constants/modes';
import { BillionsVoiceWidget } from '@/components/BillionsVoiceWidget';

export function HomePage() {
  const { setView, setDocketOpen } = useAppStore();
  const [search, setSearch] = useState('');

  const q = search.toLowerCase().trim();
  const filtered = q
    ? MODES.filter(m =>
        m.label.toLowerCase().includes(q) ||
        m.desc.toLowerCase().includes(q)  ||
        m.sub.toLowerCase().includes(q)
      )
    : null;

  function openMode(mode: Mode) {
    // research_resolver is a standalone tool — opens the resolver view
    if (mode.id === 'research_resolver') {
      setView('resolver');
      return;
    }
    // All other modes navigate to the engine view (ArgumentBuilder / CaseDashboard)
    setView('engine');
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 6 }}>
          AFS Advocates · Legal Intelligence OS
        </p>
        <h1 style={{ fontSize: 32, color: T.goldL, fontWeight: 300, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 8 }}>
          What are we building today?
        </h1>
        <p style={{ fontSize: 14, color: T.dim, fontFamily: 'Inter, sans-serif', lineHeight: 1.6, maxWidth: 600 }}>
          Select a litigation mode to begin drafting. Open the Docket to manage cases and access the full engine suite.
        </p>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setDocketOpen(true)}
          style={{
            background: `linear-gradient(135deg,#c4a030,#a07820)`,
            color: '#05050c', border: 'none', borderRadius: 6,
            padding: '11px 22px', fontSize: 15,
            fontFamily: "'Cormorant Garamond', serif",
            cursor: 'pointer', fontWeight: 600, letterSpacing: '.04em',
          }}
        >
          ⚖ Open Case Docket
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search modes…"
          style={{
            background: T.card, border: `1px solid #1e1e2e`,
            borderRadius: 5, color: T.text, padding: '10px 14px',
            fontSize: 13, fontFamily: "'Cormorant Garamond', serif",
            outline: 'none', width: 220,
          }}
        />
      </div>

      {/* Modes — filtered or grouped */}
      {filtered ? (
        <div>
          <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14 }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{search}"
          </p>
          <div className="mode-grid">
            {filtered.map(m => <ModeCard key={m.id} mode={m} onSelect={() => openMode(m)} />)}
          </div>
        </div>
      ) : (
        MODE_GROUPS.map(group => {
          const groupModes = MODES.filter(m => m.group === group.id);
          if (groupModes.length === 0) return null;
          return (
            <div key={group.id} style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 3, height: 14, background: group.color, borderRadius: 2, flexShrink: 0 }} />
                <p style={{ fontSize: 9, color: group.color, fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700 }}>
                  {group.label}
                </p>
              </div>
              <div className="mode-grid">
                {groupModes.map(m => <ModeCard key={m.id} mode={m} onSelect={() => openMode(m)} />)}
              </div>
            </div>
          );
        })
      )}
      {!filtered && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 3, height: 14, background: '#8b6914', borderRadius: 2, flexShrink: 0 }} />
            <p style={{ fontSize: 9, color: '#8b6914', fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700 }}>
              Rhetoric
            </p>
          </div>
          <div className="mode-grid">
            <BillionsVoiceWidget />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mode Card ─────────────────────────────────────────────────────────────────

interface ModeCardProps {
  mode:     Mode;
  onSelect: () => void;
}

function ModeCard({ mode, onSelect }: ModeCardProps) {
  return (
    <button
      onClick={onSelect}
      style={{
        background:    T.card,
        border:        `1px solid ${T.bdr}`,
        borderRadius:  7,
        padding:       '16px 18px',
        textAlign:     'left',
        cursor:        'pointer',
        transition:    'border-color .15s, background .15s',
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = mode.accent;
        (e.currentTarget as HTMLButtonElement).style.background  = '#0f0f1c';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = T.bdr;
        (e.currentTarget as HTMLButtonElement).style.background  = T.card;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18, color: mode.accent, flexShrink: 0, lineHeight: 1 }}>
          {mode.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 13, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, lineHeight: 1.3 }}>
              {mode.label}
            </p>
            {mode.type === 'tool' && (
              <span style={{
                fontSize: 7, color: mode.accent, fontFamily: 'Inter, sans-serif',
                letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
                border: `1px solid ${mode.accent}44`, padding: '1px 5px', borderRadius: 2,
              }}>
                TOOL
              </span>
            )}
          </div>
          <div style={{ fontSize: 8, color: mode.accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', marginTop: 2, fontWeight: 600 }}>
            {mode.sub}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
        {mode.desc}
      </p>
    </button>
  );
}
