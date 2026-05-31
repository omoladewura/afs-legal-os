/**
 * AFS Advocates — Design Tokens
 * Single source of truth for all colours and visual constants.
 * These match the original app exactly. Change here to change everywhere.
 */

export const T = {
  bg:    '#07070f',
  card:  '#0d0d18',
  bdr:   '#181828',
  gold:  '#c4a030',
  goldL: '#d4b050',
  mute:  '#3a3a52',
  dim:   '#5a5a72',
  text:  '#e0dcd0',
  sub:   '#b8b4a8',
} as const;

/** Shared inline style objects used across components */
export const S = {
  label: {
    fontSize: 10, color: T.dim,
    fontFamily: 'Inter, sans-serif',
    letterSpacing: '.1em', textTransform: 'uppercase' as const,
    fontWeight: 600, display: 'block', marginBottom: 6,
  },
  hint: {
    fontSize: 12, color: T.mute,
    fontFamily: 'Inter, sans-serif',
    lineHeight: 1.55, marginBottom: 7,
  },
  sel: {
    width: '100%', background: T.bg, border: `1px solid #1e1e2e`,
    borderRadius: 5, color: T.text, padding: '12px 14px',
    fontSize: 15, fontFamily: "'Cormorant Garamond', serif",
    outline: 'none', appearance: 'none' as const,
    WebkitAppearance: 'none' as const, cursor: 'pointer',
  },
  inp: {
    width: '100%', background: T.bg, border: `1px solid #1e1e2e`,
    borderRadius: 5, color: T.text, padding: '11px 14px',
    fontSize: 14, fontFamily: "'Cormorant Garamond', serif", outline: 'none',
  },
  ta: {
    width: '100%', background: T.bg, border: `1px solid #1e1e2e`,
    borderRadius: 5, color: T.text, padding: '12px 14px',
    fontSize: 15, fontFamily: "'Cormorant Garamond', serif",
    outline: 'none', resize: 'vertical' as const,
    lineHeight: 1.82, minHeight: 130,
  },
  btn: {
    background: 'linear-gradient(135deg,#c4a030,#a07820)',
    color: '#05050c', border: 'none', borderRadius: 6,
    padding: '14px 28px', fontSize: 17,
    fontFamily: "'Cormorant Garamond', serif",
    cursor: 'pointer', width: '100%', marginTop: 18,
    letterSpacing: '.04em', fontWeight: 600, transition: 'opacity .2s',
  },
  btnOff: {
    background: '#101018', color: '#2a2a38',
    border: `1px solid ${T.bdr}`, borderRadius: 6,
    padding: '14px 28px', fontSize: 17,
    fontFamily: "'Cormorant Garamond', serif",
    cursor: 'not-allowed', width: '100%', marginTop: 18,
  },
  h1: {
    fontSize: 22, color: T.goldL, fontWeight: 400,
    borderBottom: `1px solid ${T.bdr}`,
    paddingBottom: 10, marginTop: 30, marginBottom: 14,
    fontFamily: "'Cormorant Garamond', serif", letterSpacing: '.02em',
  },
  h2: {
    fontSize: 17, color: '#b8985a', fontWeight: 400,
    marginTop: 24, marginBottom: 8,
    fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic',
  },
  h3: {
    fontSize: 10, color: '#606070', fontWeight: 600,
    marginTop: 18, marginBottom: 6,
    textTransform: 'uppercase' as const, letterSpacing: '.1em',
    fontFamily: 'Inter, sans-serif',
  },
  p: {
    margin: '7px 0', fontSize: 16, color: '#cac6ba',
    lineHeight: 1.95, fontFamily: "'Cormorant Garamond', serif",
  },
  li: {
    margin: '5px 0 5px 22px', fontSize: 16, color: '#c2beb2',
    lineHeight: 1.85, listStyleType: 'disc',
    fontFamily: "'Cormorant Garamond', serif",
  },
  empty: {
    color: T.mute, fontStyle: 'italic',
    fontFamily: 'Inter, sans-serif', fontSize: 14,
  },
} as const;
