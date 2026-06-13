/**
 * AFS Advocates — Design Tokens
 * White newspaper theme — Times New Roman throughout.
 * Single source of truth for all colours and visual constants.
 */

export const T = {
  bg:    '#ffffff',
  card:  '#f7f7f5',
  bdr:   '#d0cfc8',
  bdrL:  '#e0dfd8',

  gold:  '#6b6b6b',   // used as accent label colour — charcoal
  goldL: '#000000',   // headings

  text:  '#111111',
  sub:   '#2a2a2a',
  dim:   '#444444',
  mute:  '#888888',

  ok:    '#2a6a3a',
  warn:  '#7a4a10',
  err:   '#8a1a1a',
  info:  '#1a3a6a',
  fg:    '#111111',
} as const;

/** Shared inline style objects used across components */
export const S = {
  label: {
    fontSize: 10, color: '#444444',
    fontFamily: "'Times New Roman', Times, serif",
    letterSpacing: '.12em', textTransform: 'uppercase' as const,
    fontWeight: 700, display: 'block', marginBottom: 6,
  },
  hint: {
    fontSize: 13, color: '#666666',
    fontFamily: "'Times New Roman', Times, serif",
    lineHeight: 1.6, marginBottom: 7,
  },
  sel: {
    width: '100%', background: '#ffffff', border: '1px solid #cccccc',
    borderRadius: 4, color: '#111111', padding: '10px 14px',
    fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
    outline: 'none', appearance: 'none' as const,
    WebkitAppearance: 'none' as const, cursor: 'pointer',
  },
  inp: {
    width: '100%', background: '#ffffff', border: '1px solid #cccccc',
    borderRadius: 4, color: '#111111', padding: '10px 14px',
    fontSize: 13, fontFamily: "'Times New Roman', Times, serif", outline: 'none',
  },
  ta: {
    width: '100%', background: '#ffffff', border: '1px solid #cccccc',
    borderRadius: 4, color: '#111111', padding: '12px 14px',
    fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
    outline: 'none', resize: 'vertical' as const,
    lineHeight: 1.8, minHeight: 120,
  },
  btn: {
    background: '#111111',
    color: '#ffffff', border: 'none', borderRadius: 4,
    padding: '11px 24px', fontSize: 13,
    fontFamily: "'Times New Roman', Times, serif",
    cursor: 'pointer', width: '100%', marginTop: 16,
    letterSpacing: '.04em', fontWeight: 600, transition: 'opacity .2s',
  },
  btnOff: {
    background: '#eeeeee', color: '#aaaaaa',
    border: '1px solid #dddddd', borderRadius: 4,
    padding: '11px 24px', fontSize: 13,
    fontFamily: "'Times New Roman', Times, serif",
    cursor: 'not-allowed', width: '100%', marginTop: 16,
  },
  h1: {
    fontSize: 22, color: '#111111', fontWeight: 400,
    borderBottom: '1px solid #cccccc',
    paddingBottom: 10, marginTop: 28, marginBottom: 14,
    fontFamily: "'Times New Roman', Times, serif",
  },
  h2: {
    fontSize: 17, color: '#333333', fontWeight: 400,
    marginTop: 22, marginBottom: 8,
    fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic',
  },
  h3: {
    fontSize: 11, color: '#555555', fontWeight: 700,
    marginTop: 18, marginBottom: 6,
    textTransform: 'uppercase' as const, letterSpacing: '.1em',
    fontFamily: "'Times New Roman', Times, serif",
  },
  p: {
    margin: '7px 0', fontSize: 14, color: '#222222',
    lineHeight: 1.85, fontFamily: "'Times New Roman', Times, serif",
  },
  li: {
    margin: '5px 0 5px 22px', fontSize: 14, color: '#222222',
    lineHeight: 1.75, listStyleType: 'disc',
    fontFamily: "'Times New Roman', Times, serif",
  },
  empty: {
    color: '#999999', fontStyle: 'italic',
    fontFamily: "'Times New Roman', Times, serif", fontSize: 13,
  },
} as const;
