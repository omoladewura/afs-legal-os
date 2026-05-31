/**
 * AFS Advocates — Design Tokens
 * Single source of truth for all colours and visual constants.
 * These match the original app exactly. Change here to change everywhere.
 */

export const T = {
  bg:    '#ffffff',
  card:  '#f5f5f5',
  bdr:   '#cccccc',
  gold:  '#000000',
  goldL: '#000000',
  mute:  '#666666',
  dim:   '#444444',
  text:  '#000000',
  sub:   '#222222',
} as const;

/** Shared inline style objects used across components */
export const S = {
  label: {
    fontSize: 14, color: T.dim,
    fontFamily: "'Times New Roman', Times, serif",
    letterSpacing: '.05em', textTransform: 'uppercase' as const,
    fontWeight: 600, display: 'block', marginBottom: 6,
  },
  hint: {
    fontSize: 14, color: T.mute,
    fontFamily: "'Times New Roman', Times, serif",
    lineHeight: 1.55, marginBottom: 7,
  },
  sel: {
    width: '100%', background: '#ffffff', border: `1px solid #cccccc`,
    borderRadius: 5, color: T.text, padding: '12px 14px',
    fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
    outline: 'none', appearance: 'none' as const,
    WebkitAppearance: 'none' as const, cursor: 'pointer',
  },
  inp: {
    width: '100%', background: '#ffffff', border: `1px solid #cccccc`,
    borderRadius: 5, color: T.text, padding: '11px 14px',
    fontSize: 14, fontFamily: "'Times New Roman', Times, serif", outline: 'none',
  },
  ta: {
    width: '100%', background: '#ffffff', border: `1px solid #cccccc`,
    borderRadius: 5, color: T.text, padding: '12px 14px',
    fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
    outline: 'none', resize: 'vertical' as const,
    lineHeight: 1.82, minHeight: 130,
  },
  btn: {
    background: '#000000',
    color: '#ffffff', border: 'none', borderRadius: 6,
    padding: '14px 28px', fontSize: 14,
    fontFamily: "'Times New Roman', Times, serif",
    cursor: 'pointer', width: '100%', marginTop: 18,
    letterSpacing: '.04em', fontWeight: 600, transition: 'opacity .2s',
  },
  btnOff: {
    background: '#eeeeee', color: '#aaaaaa',
    border: `1px solid #cccccc`, borderRadius: 6,
    padding: '14px 28px', fontSize: 14,
    fontFamily: "'Times New Roman', Times, serif",
    cursor: 'not-allowed', width: '100%', marginTop: 18,
  },
  h1: {
    fontSize: 22, color: T.text, fontWeight: 700,
    borderBottom: `1px solid #cccccc`,
    paddingBottom: 10, marginTop: 30, marginBottom: 14,
    fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.02em',
  },
  h2: {
    fontSize: 17, color: T.dim, fontWeight: 600,
    marginTop: 24, marginBottom: 8,
    fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic',
  },
  h3: {
    fontSize: 14, color: '#444444', fontWeight: 700,
    marginTop: 18, marginBottom: 6,
    textTransform: 'uppercase' as const, letterSpacing: '.08em',
    fontFamily: "'Times New Roman', Times, serif",
  },
  p: {
    margin: '7px 0', fontSize: 14, color: T.text,
    lineHeight: 1.95, fontFamily: "'Times New Roman', Times, serif",
  },
  li: {
    margin: '5px 0 5px 22px', fontSize: 14, color: T.text,
    lineHeight: 1.85, listStyleType: 'disc',
    fontFamily: "'Times New Roman', Times, serif",
  },
  empty: {
    color: T.mute, fontStyle: 'italic',
    fontFamily: "'Times New Roman', Times, serif", fontSize: 14,
  },
} as const;
