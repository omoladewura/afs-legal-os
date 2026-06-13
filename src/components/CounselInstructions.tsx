/**
 * AFS Legal OS — CounselInstructions
 *
 * Reusable panel for counsel to add instructions, strategy notes,
 * and custom directives that flow into every AI call for this case.
 *
 * Drop this into any engine. It reads/writes activeCase.counsel_instructions
 * via the onSave callback.
 *
 * Usage:
 *   <CounselInstructions activeCase={activeCase} onSave={onSave} />
 */

import React, { useState } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';

interface Props {
  activeCase: Case;
  /** Called with the updated instructions string whenever saved */
  onSave: (instructions: string) => void;
  /** Optional: collapse by default */
  defaultCollapsed?: boolean;
}

export function CounselInstructions({ activeCase, onSave, defaultCollapsed = true }: Props) {
  const existing = (activeCase as any).counsel_instructions as string ?? '';
  const [open,  setOpen]  = useState(!defaultCollapsed || !!existing);
  const [value, setValue] = useState(existing);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave(value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const hasContent = value.trim().length > 0;

  return (
    <div style={wrap}>
      {/* Header — always visible */}
      <button onClick={() => setOpen(o => !o)} style={header}>
        <span style={headerLeft}>
          <span style={dot(hasContent)} />
          <span style={title}>Counsel Instructions</span>
          {hasContent && !open && (
            <span style={preview}>{value.trim().slice(0, 60)}{value.length > 60 ? '…' : ''}</span>
          )}
        </span>
        <span style={chevron}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {open && (
        <div style={body}>
          <p style={hint}>
            Add strategy notes, specific instructions, or directives for AI on this case.
            These are injected into every engine's AI call automatically.
          </p>

          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={
              `Examples:\n` +
              `• Focus all arguments on limitation of action\n` +
              `• Client disputes the date of accident — treat it as contested\n` +
              `• Opposing counsel tends to raise preliminary objections — anticipate\n` +
              `• Always structure relief in the alternative\n` +
              `• Jurisdiction: Federal High Court Lagos — apply FHC Civil Procedure Rules 2019`
            }
            rows={7}
            style={textarea}
          />

          <div style={footer}>
            <span style={charCount}>{value.length} characters</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {value !== existing && (
                <button onClick={() => setValue(existing)} style={cancelBtn}>
                  Discard
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={value === existing}
                style={{
                  ...saveBtn,
                  opacity: value === existing ? 0.45 : 1,
                  cursor:  value === existing ? 'not-allowed' : 'pointer',
                }}
              >
                {saved ? '✓ Saved' : 'Save Instructions'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = {
  border:       `1px solid ${T.bdr}`,
  borderRadius: 6,
  marginBottom: 20,
  overflow:     'hidden',
};

const header: React.CSSProperties = {
  width:          '100%',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  background:     T.card,
  border:         'none',
  borderBottom:   `1px solid ${T.bdrL}`,
  padding:        '10px 14px',
  cursor:         'pointer',
  textAlign:      'left',
};

const headerLeft: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        8,
  flex:       1,
  minWidth:   0,
};

const dot = (active: boolean): React.CSSProperties => ({
  width:        7,
  height:       7,
  borderRadius: '50%',
  flexShrink:   0,
  background:   active ? T.ok : T.bdr,
});

const title: React.CSSProperties = {
  fontFamily:    "'Times New Roman', Times, serif",
  fontSize:      12,
  fontWeight:    700,
  color:         T.text,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  flexShrink:    0,
};

const preview: React.CSSProperties = {
  fontFamily: "'Times New Roman', Times, serif",
  fontSize:   11,
  color:      T.mute,
  overflow:   'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const chevron: React.CSSProperties = {
  fontSize:   9,
  color:      T.mute,
  flexShrink: 0,
};

const body: React.CSSProperties = {
  padding:    '14px 14px 12px',
  background: T.bg,
};

const hint: React.CSSProperties = {
  fontFamily:   "'Times New Roman', Times, serif",
  fontSize:     12,
  color:        T.mute,
  marginBottom: 10,
  lineHeight:   1.5,
};

const textarea: React.CSSProperties = {
  width:        '100%',
  background:   T.bg,
  border:       `1px solid ${T.bdr}`,
  borderRadius: 4,
  color:        T.text,
  padding:      '9px 11px',
  fontSize:     13,
  fontFamily:   "'Times New Roman', Times, serif",
  lineHeight:   1.6,
  resize:       'vertical',
  outline:      'none',
  boxSizing:    'border-box',
};

const footer: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  marginTop:      8,
};

const charCount: React.CSSProperties = {
  fontFamily: "'Times New Roman', Times, serif",
  fontSize:   10,
  color:      T.mute,
};

const cancelBtn: React.CSSProperties = {
  background:   'none',
  border:       `1px solid ${T.bdr}`,
  borderRadius: 4,
  color:        T.mute,
  padding:      '5px 12px',
  fontSize:     11,
  fontFamily:   "'Times New Roman', Times, serif",
  cursor:       'pointer',
};

const saveBtn: React.CSSProperties = {
  background:   T.text,
  border:       'none',
  borderRadius: 4,
  color:        T.bg,
  padding:      '5px 14px',
  fontSize:     11,
  fontFamily:   "'Times New Roman', Times, serif",
  fontWeight:   600,
};
