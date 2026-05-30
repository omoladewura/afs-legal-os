/**
 * AFS Advocates — Design Tokens
 * Professional legal workspace. Clean, serious, no distractions.
 */

export const T = {
  bg:    '#0e0e0e',
  card:  '#151515',
  bdr:   '#2a2a2a',
  gold:  '#7a1f2e',
  goldL: '#9a2f3e',
  mute:  '#4a4a4a',
  dim:   '#8a8a9a',
  text:  '#f0ede8',
  sub:   '#c0bcb8',
} as const;

export const S = {
  label: {
    fontSize: 10, color: '#8a8a9a',
    fontFamily: 'Georgia, "Times New Roman", serif',
    letterSpacing: '.1em', textTransform: 'uppercase' as const,
    fontWeight: 600, display: 'block', marginBottom: 6,
  },
  hint: {
    fontSize: 12, color: '#4a4a4a',
    fontFamily: 'Georgia, "Times New Roman", serif',
    lineHeight: 1.55, marginBottom: 7,
  },
  sel: {
    width: '100%', background: '#0e0e0e', border: '1px solid #2a2a2a',
    borderRadius: 5, color: '#f0ede8', padding: '12px 14px',
    fontSize: 15, fontFamily: 'Georgia, "Times New Roman", serif',
    outline: 'none', appearance: 'none' as const,
    WebkitAppearance: 'none' as const, cursor: 'pointer',
  },
  inp: {
    width: '100%', background: '#0e0e0e', border: '1px solid #2a2a2a',
    borderRadius: 5, color: '#f0ede8', padding: '11px 14px',
    fontSize: 14, fontFamily: 'Georgia, "Times New Roman", serif', outline: 'none',
  },
  ta: {
    width: '100%', background: '#0e0e0e', border: '1px solid #2a2a2a',
    borderRadius: 5, color: '#f0ede8', padding: '12px 14px',
    fontSize: 15, fontFamily: 'Georgia, "Times New Roman", serif',
    outline: 'none', resize: 'vertical' as const,
    lineHeight: 1.82, minHeight: 130,
  },
  btn: {
    background: '#7a1f2e',
    color: '#f0ede8', border: 'none', borderRadius: 6,
    padding: '14px 28px', fontSize: 17,
    fontFamily: 'Georgia, "Times New Roman", serif',
    cursor: 'pointer', width: '100%', marginTop: 18,
    letterSpacing: '.04em', fontWeight: 600, transition: 'opacity .2s',
  },
  btnOff: {
    background: '#1a1a1a', color: '#3a3a3a',
    border: '1px solid #2a2a2a', borderRadius: 6,
    padding: '14px 28px', fontSize: 17,
    fontFamily: 'Georgia, "Times New Roman", serif',
    cursor: 'not-allowed', width: '100%', marginTop: 18,
  },
  h1: {
    fontSize: 22, color: '#f0ede8', fontWeight: 400,
    borderBottom: '1px solid #2a2a2a',
    paddingBottom: 10, marginTop: 30, marginBottom: 14,
    fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: '.02em',
  },
  h2: {
    fontSize: 17, color: '#c0bcb8', fontWeight: 400,
    marginTop: 24, marginBottom: 8,
    fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic',
  },
  h3: {
    fontSize: 10, color: '#606060', fontWeight: 600,
    marginTop: 18, marginBottom: 6,
    textTransform: 'uppercase' as const, letterSpacing: '.1em',
    fontFamily: 'Georgia, "Times New Roman", serif',
  },
  p: {
    margin: '7px 0', fontSize: 16, color: '#c0bcb8',
    lineHeight: 1.95, fontFamily: 'Georgia, "Times New Roman", serif',
  },
  li: {
    margin: '5px 0 5px 22px', fontSize: 16, color: '#c0bcb8',
    lineHeight: 1.85, listStyleType: 'disc',
    fontFamily: 'Georgia, "Times New Roman", serif',
  },
  empty: {
    color: '#4a4a4a', fontStyle: 'italic',
    fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 14,
  },
} as const;
