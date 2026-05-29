/**
 * AFS Advocates — Home Page (Mode Selector)
 * Professional legal workspace. Clean, serious, no distractions.
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { MODES, MODE_GROUPS } from '@/constants/modes';
import { T } from '@/constants/tokens';
import type { Mode } from '@/constants/modes';

const FONT = 'Georgia, "Times New Roman", serif';

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
    if (mode.id === 'research_resolver') {
      setView('resolver');
      return;
    }
    setView('engine');
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 28, borderBottom: '1px solid #2a2a2a', paddingBottom: 20 }}>
        <p style={{ fontSize: 10, color: '#5a5a5a', fontFamily: FONT, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 8 }}>
          AFS Advocates · Legal Intelligence OS
        </p>
        <h1 style={{ fontSize: 26, color: '#f0ede8', fontWeight: 400, fontFamily: FONT, marginBottom: 6 }}>
          Case Intelligence Workspace
        </h1>
        <p style={{ fontSize: 13, color: '#8a8a9a', fontFamily: FONT, lineHeight: 1.6, maxWidth: 560 }}>
          Select a litigation mode to begin. Open the Docket to manage your cases.
        </p>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setDocketOpen(true)}
          style={{
            background: '#7a1f2e',
            color: '#f0ede8', border: 'none', borderRadius: 4,
            padding: '10px 20px', fontSize: 13,
            fontFamily: FONT,
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
            background: '#151515', border: '1px solid #2a2a2a',
            borderRadius: 4, color: '#f0ede8', padding: '9px 13px',
            fontSize: 13, fontFamily: FONT,
            outline: 'none', width: 220,
          }}
        />
      </div>

      {/* Modes */}
      {filtered ? (
        <div>
          <p style={{ fontSize: 10, color: '#5a5a5a', fontFamily: FONT, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14 }}>
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
            <div key={group.id} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 2, height: 12, background: '#7a1f2e', borderRadius: 1, flexShrink: 0 }} />
                <p style={{ fontSize: 9, color: '#8a8a9a', fontFamily: FONT, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700 }}>
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
        background:    '#151515',
        border:        '1px solid #2a2a2a',
        borderRadius:  5,
        padding:       '14px 16px',
        textAlign:     'left',
        cursor:        'pointer',
        transition:    'border-color .15s',
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#7a1f2e';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a2a';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 15, color: '#8a8a9a', flexShrink: 0, lineHeight: 1 }}>
          {mode.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 13, color: '#f0ede8', fontFamily: FONT, fontWeight: 600, lineHeight: 1.3 }}>
              {mode.label}
            </p>
            {mode.type === 'tool' && (
              <span style={{
                fontSize: 7, color: '#8a8a9a', fontFamily: FONT,
                letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
                border: '1px solid #3a3a3a', padding: '1px 5px', borderRadius: 2,
              }}>
                TOOL
              </span>
            )}
          </div>
          <div style={{ fontSize: 8, color: '#5a5a5a', fontFamily: FONT, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: 2, fontWeight: 600 }}>
            {mode.sub}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: '#6a6a7a', fontFamily: FONT, lineHeight: 1.6 }}>
        {mode.desc}
      </p>
    </button>
  );
}
