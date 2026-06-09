/**
 * AFS Advocates — Case Docket Overlay
 * Full-screen overlay for case management: list, create, search, open.
 *
 * V2 CHANGES:
 * - Matter creation now requires matter_track (civil | criminal) and
 *   counsel_role (claimant_side | defendant_side | prosecution | defence).
 * - These two fields are permanent — they cannot be changed after creation.
 * - Party labels adapt to track: Claimant/Defendant for civil,
 *   Complainant/Accused for criminal.
 * - Case list shows track badge and role badge on every card.
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { loadCases, saveCase } from '@/storage/helpers';
import { uid, cid, formatDate } from '@/utils';
import { T, S } from '@/constants/tokens';
import { COURTS } from '@/constants/legal';
import type { Case, Party, MatterTrack, CounselRole } from '@/types';
import {
  rolesForTrack,
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
} from '@/types';

export function CaseDocket() {
  const { setDocketOpen, setActiveCase, setView } = useAppStore();

  const [cases,    setCases]    = useState<Case[]>([]);
  const [search,   setSearch]   = useState('');
  const [creating, setCreating] = useState(false);

  // ── New case form state ────────────────────────────────────────────────────

  const [ncName,   setNcName]   = useState('');
  const [ncCourt,  setNcCourt]  = useState('');
  const [ncSuit,   setNcSuit]   = useState('');
  const [ncDate,   setNcDate]   = useState('');

  // THE TWO GOVERNING FIELDS
  const [ncTrack,  setNcTrack]  = useState<MatterTrack>('civil');
  const [ncRole,   setNcRole]   = useState<CounselRole>('claimant_side');

  // Parties — labels adapt to track
  const [ncPartiesA, setNcPartiesA] = useState<Party[]>([{ id: cid(), name: '' }]);
  const [ncPartiesB, setNcPartiesB] = useState<Party[]>([{ id: cid(), name: '' }]);

  // When track changes, reset role to the first valid role for that track
  function handleTrackChange(track: MatterTrack) {
    setNcTrack(track);
    setNcRole(rolesForTrack(track)[0]);
  }

  // Party label pairs by track
  const partyLabels = ncTrack === 'civil'
    ? { a: 'Claimants', b: 'Defendants / Respondents', aPlaceholder: 'Claimant name', bPlaceholder: 'Defendant name' }
    : { a: 'Complainant(s)', b: 'Accused', aPlaceholder: 'Complainant name', bPlaceholder: 'Accused name' };

  useEffect(() => { loadCases().then(setCases); }, []);

  const filtered = search.trim()
    ? cases.filter(c =>
        c.caseName.toLowerCase().includes(search.toLowerCase()) ||
        (c.suitNo  || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.court   || '').toLowerCase().includes(search.toLowerCase())
      )
    : cases;

  async function createCase() {
    if (!ncName.trim()) return;
    const now = new Date().toISOString();

    // Derive the legacy `role` string from counsel_role for backwards compat
    const legacyRole: Case['role'] =
      ncRole === 'claimant_side'  ? 'Claimant'  :
      ncRole === 'defendant_side' ? 'Defendant' :
      ncRole === 'prosecution'    ? 'Prosecution' :
      'Defence';

    const nc: Case = {
      id:                 cid(),
      caseName:           ncName.trim(),
      court:              ncCourt.trim(),
      suitNo:             ncSuit.trim(),
      dateCommenced:      ncDate,
      // THE TWO GOVERNING FIELDS — permanent
      matter_track:       ncTrack,
      counsel_role:       ncRole,
      // Legacy field kept for V1 engine compatibility
      role:               legacyRole,
      claimants:          ncPartiesA.filter(p => p.name.trim()).map(p => ({ ...p, name: p.name.trim() })),
      defendants:         ncPartiesB.filter(p => p.name.trim()).map(p => ({ ...p, name: p.name.trim() })),
      createdAt:          now,
      compressed_summary: '',
      recent_entries:     [],
      deadlines:          [],
    };
    await saveCase(nc);
    setCases(prev => [nc, ...prev]);
    openCase(nc);
  }

  function openCase(c: Case) {
    setActiveCase(c);
    setDocketOpen(false);
    setView('engine');
  }

  // Party list helpers
  function addParty(list: Party[], setList: (l: Party[]) => void) {
    setList([...list, { id: cid(), name: '' }]);
  }
  function updateParty(list: Party[], setList: (l: Party[]) => void, id: string, name: string) {
    setList(list.map(p => p.id === id ? { ...p, name } : p));
  }
  function removeParty(list: Party[], setList: (l: Party[]) => void, id: string) {
    if (list.length <= 1) return;
    setList(list.filter(p => p.id !== id));
  }

  function resetForm() {
    setNcName(''); setNcCourt(''); setNcSuit(''); setNcDate('');
    setNcTrack('civil'); setNcRole('claimant_side');
    setNcPartiesA([{ id: cid(), name: '' }]);
    setNcPartiesB([{ id: cid(), name: '' }]);
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(7,7,15,0.96)',
    overflowY: 'auto', padding: '0 0 60px',
  };

  const innerStyle: React.CSSProperties = {
    maxWidth: 860, margin: '0 auto', padding: '80px 24px 40px',
  };

  const pIStyle: React.CSSProperties = { ...S.inp, marginBottom: 0, fontSize: 13 };

  const trackBtnStyle = (selected: boolean, track: MatterTrack): React.CSSProperties => ({
    flex: 1, padding: '12px 16px',
    background: selected ? MATTER_TRACK_COLORS[track].bg : 'transparent',
    border: `1px solid ${selected ? MATTER_TRACK_COLORS[track].bdr : '#1e1e2e'}`,
    borderRadius: 6, cursor: 'pointer',
    color: selected ? MATTER_TRACK_COLORS[track].col : T.mute,
    fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700,
    letterSpacing: '.1em', textTransform: 'uppercase' as const,
    transition: 'all .15s',
  });

  const roleBtnStyle = (selected: boolean, role: CounselRole): React.CSSProperties => ({
    flex: 1, padding: '10px 14px',
    background: selected ? COUNSEL_ROLE_COLORS[role].bg : 'transparent',
    border: `1px solid ${selected ? COUNSEL_ROLE_COLORS[role].bdr : '#1e1e2e'}`,
    borderRadius: 6, cursor: 'pointer',
    color: selected ? COUNSEL_ROLE_COLORS[role].col : T.mute,
    fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
    letterSpacing: '.07em',
    transition: 'all .15s',
  });

  return (
    <div style={overlayStyle}>
      <div style={innerStyle}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 4 }}>
              AFS Advocates
            </p>
            <h1 style={{ fontSize: 28, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic' }}>
              Case Docket
            </h1>
          </div>
          <button
            onClick={() => setDocketOpen(false)}
            style={{
              background: 'transparent', border: `1px solid #1e1e2e`,
              color: T.mute, borderRadius: 4, padding: '8px 16px',
              fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', marginTop: 8,
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <button
            onClick={() => { if (creating) resetForm(); setCreating(c => !c); }}
            style={{
              background: creating ? 'transparent' : `linear-gradient(135deg,#c4a030,#a07820)`,
              color: creating ? T.mute : '#05050c',
              border: creating ? `1px solid #1e1e2e` : 'none',
              borderRadius: 5, padding: '10px 20px', fontSize: 13,
              fontFamily: "'Cormorant Garamond', serif",
              cursor: 'pointer', fontWeight: 600, letterSpacing: '.03em',
            }}
          >
            {creating ? '✕ Cancel' : '+ New Matter'}
          </button>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search matters…"
            style={{ ...S.inp, width: 240, marginBottom: 0, fontSize: 13, padding: '10px 14px' }}
          />
        </div>

        {/* ── New matter form ──────────────────────────────────────────────── */}
        {creating && (
          <div style={{
            background: '#0a0a14', border: `1px solid ${T.gold}33`,
            borderRadius: 8, padding: '22px 24px', marginBottom: 24,
            animation: 'fadeUp .2s ease',
          }}>
            <p style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 18 }}>
              New Matter
            </p>

            {/* ── STEP 1: Track ── */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                Track <span style={{ color: T.gold }}>*</span>
                <span style={{ color: T.mute, fontWeight: 400, fontSize: 10, marginLeft: 8 }}>
                  Cannot be changed after creation
                </span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['civil', 'criminal'] as MatterTrack[]).map(track => (
                  <button
                    key={track}
                    onClick={() => handleTrackChange(track)}
                    style={trackBtnStyle(ncTrack === track, track)}
                  >
                    {track === 'civil' ? '⚖ Civil' : '⚖ Criminal'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── STEP 2: Role ── */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                Our Role <span style={{ color: T.gold }}>*</span>
                <span style={{ color: T.mute, fontWeight: 400, fontSize: 10, marginLeft: 8 }}>
                  Cannot be changed after creation
                </span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {rolesForTrack(ncTrack).map(role => (
                  <button
                    key={role}
                    onClick={() => setNcRole(role)}
                    style={roleBtnStyle(ncRole === role, role)}
                  >
                    {COUNSEL_ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
              {/* Role description strip */}
              <div style={{
                marginTop: 8, padding: '8px 12px',
                background: COUNSEL_ROLE_COLORS[ncRole].bg,
                border: `1px solid ${COUNSEL_ROLE_COLORS[ncRole].bdr}`,
                borderRadius: 5, fontSize: 11, color: COUNSEL_ROLE_COLORS[ncRole].col,
                fontFamily: 'Inter, sans-serif',
              }}>
                {ncRole === 'claimant_side'  && 'Acting for the claimant — advancing the claim, driving pleadings, trial, and enforcement.'}
                {ncRole === 'defendant_side' && 'Acting for the defendant — resisting or managing the claim, filing defences and applications.'}
                {ncRole === 'prosecution'    && 'Acting for the prosecution — building and presenting the case against the accused.'}
                {ncRole === 'defence'        && 'Acting for the defence — protecting the accused, challenging prosecution evidence at every stage.'}
              </div>
            </div>

            {/* ── Matter details ── */}
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Matter Name *</label>
              <input
                value={ncName}
                onChange={e => setNcName(e.target.value)}
                placeholder={
                  ncTrack === 'civil'
                    ? 'e.g. Okonkwo v First Bank PLC'
                    : 'e.g. FRN v Adeyemi'
                }
                style={S.inp}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Court</label>
                <select value={ncCourt} onChange={e => setNcCourt(e.target.value)} style={{ ...S.sel, padding: '10px 14px' }}>
                  <option value="">Select court…</option>
                  {COURTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>
                  {ncTrack === 'civil' ? 'Suit Number' : 'Charge / Case No.'}
                </label>
                <input
                  value={ncSuit}
                  onChange={e => setNcSuit(e.target.value)}
                  placeholder={ncTrack === 'civil' ? 'FHC/L/CS/123/2024' : 'FHC/L/CR/456/2024'}
                  style={S.inp}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Date Commenced</label>
              <input type="date" value={ncDate} onChange={e => setNcDate(e.target.value)} style={{ ...S.inp, maxWidth: 220 }} />
            </div>

            {/* ── Parties (labels adapt to track) ── */}
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>{partyLabels.a}</label>
              {ncPartiesA.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={e => updateParty(ncPartiesA, setNcPartiesA, p.id, e.target.value)} placeholder={partyLabels.aPlaceholder} style={{ ...pIStyle, flex: 1 }} />
                  <button onClick={() => removeParty(ncPartiesA, setNcPartiesA, p.id)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              <button onClick={() => addParty(ncPartiesA, setNcPartiesA)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                + Add {ncTrack === 'civil' ? 'Claimant' : 'Complainant'}
              </button>
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={S.label}>{partyLabels.b}</label>
              {ncPartiesB.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={e => updateParty(ncPartiesB, setNcPartiesB, p.id, e.target.value)} placeholder={partyLabels.bPlaceholder} style={{ ...pIStyle, flex: 1 }} />
                  <button onClick={() => removeParty(ncPartiesB, setNcPartiesB, p.id)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              <button onClick={() => addParty(ncPartiesB, setNcPartiesB)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                + Add {ncTrack === 'civil' ? 'Defendant' : 'Accused'}
              </button>
            </div>

            {/* ── Summary strip before create ── */}
            {ncName.trim() && (
              <div style={{
                marginBottom: 18, padding: '10px 14px',
                background: '#060610', border: `1px solid #1a1a2e`,
                borderRadius: 6, fontFamily: 'Inter, sans-serif', fontSize: 11,
                color: T.mute, lineHeight: 1.7,
              }}>
                <span style={{ color: MATTER_TRACK_COLORS[ncTrack].col, fontWeight: 700 }}>
                  {MATTER_TRACK_LABELS[ncTrack]}
                </span>
                {' · '}
                <span style={{ color: COUNSEL_ROLE_COLORS[ncRole].col, fontWeight: 700 }}>
                  {COUNSEL_ROLE_LABELS[ncRole]}
                </span>
                {ncCourt && <span> · {ncCourt}</span>}
                {' — '}
                <span style={{ color: T.text }}>{ncName.trim()}</span>
              </div>
            )}

            <button
              onClick={createCase}
              disabled={!ncName.trim()}
              style={{
                background:  ncName.trim() ? `linear-gradient(135deg,#c4a030,#a07820)` : '#101018',
                color:       ncName.trim() ? '#05050c' : '#2a2a38',
                border:      'none', borderRadius: 6,
                padding:     '12px 28px', fontSize: 15,
                fontFamily:  "'Cormorant Garamond', serif",
                cursor:      ncName.trim() ? 'pointer' : 'not-allowed',
                fontWeight:  600, letterSpacing: '.04em',
              }}
            >
              Create Matter →
            </button>
          </div>
        )}

        {/* ── Matter list ─────────────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 16, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 8 }}>
              {cases.length === 0 ? 'No matters yet. Create your first matter above.' : 'No matters match your search.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(c => {
              const track = c.matter_track;
              const role  = c.counsel_role;
              return (
                <button
                  key={c.id}
                  onClick={() => openCase(c)}
                  style={{
                    background: T.card, border: `1px solid ${T.bdr}`,
                    borderRadius: 7, padding: '16px 18px',
                    textAlign: 'left', cursor: 'pointer',
                    transition: 'border-color .15s, background .15s',
                    display: 'block', width: '100%',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.gold; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.bdr; }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 5 }}>
                        {c.caseName}
                      </p>
                      <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                        {[c.court, c.suitNo].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      {/* Track badge */}
                      {track ? (
                        <span style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 3,
                          fontFamily: 'Inter, sans-serif', fontWeight: 700,
                          letterSpacing: '.1em', textTransform: 'uppercase',
                          background: MATTER_TRACK_COLORS[track].bg,
                          border: `1px solid ${MATTER_TRACK_COLORS[track].bdr}`,
                          color: MATTER_TRACK_COLORS[track].col,
                        }}>
                          {MATTER_TRACK_LABELS[track]}
                        </span>
                      ) : null}
                      {/* Role badge */}
                      {role ? (
                        <span style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 3,
                          fontFamily: 'Inter, sans-serif', fontWeight: 700,
                          letterSpacing: '.07em', textTransform: 'uppercase',
                          background: COUNSEL_ROLE_COLORS[role].bg,
                          border: `1px solid ${COUNSEL_ROLE_COLORS[role].bdr}`,
                          color: COUNSEL_ROLE_COLORS[role].col,
                        }}>
                          {COUNSEL_ROLE_LABELS[role]}
                        </span>
                      ) : (
                        /* Legacy V1 matter — show old role string */
                        <span style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 3,
                          fontFamily: 'Inter, sans-serif', fontWeight: 600,
                          letterSpacing: '.08em', textTransform: 'uppercase',
                          background: '#0a0a14', border: `1px solid #1e1e2e`, color: T.mute,
                        }}>
                          {c.role}
                        </span>
                      )}
                      <p style={{ fontSize: 10, color: '#2a2a3e', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
                        {formatDate(c.createdAt?.slice(0, 10) || '')}
                      </p>
                      <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif' }}>
                        {c.recent_entries?.length ?? 0} entries
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
