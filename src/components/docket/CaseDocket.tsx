/**
 * AFS Advocates — Case Docket Overlay
 * Full-screen overlay for case management: list, create, search, open.
 * This is the entry point to the case engine suite.
 *
 * NOTE: The full docket internals (entries, deadlines, calendar, BUTS,
 * compress, intelligence) are in src/engines/CaseDocketTab.tsx.
 * This component handles case selection and creation only.
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { loadCases, saveCase } from '@/storage/helpers';
import { uid, cid, formatDate } from '@/utils';
import { T, S } from '@/constants/tokens';
import { COURTS } from '@/constants/legal';
import type { Case, Party } from '@/types';

export function CaseDocket() {
  const { setDocketOpen, setActiveCase, setView } = useAppStore();

  const [cases,    setCases]   = useState<Case[]>([]);
  const [search,   setSearch]  = useState('');
  const [creating, setCreating] = useState(false);

  // New case form
  const [ncName,    setNcName]    = useState('');
  const [ncCourt,   setNcCourt]   = useState('');
  const [ncSuit,    setNcSuit]    = useState('');
  const [ncDate,    setNcDate]    = useState('');
  const [ncRole,    setNcRole]    = useState('Claimant');
  const [ncClaims,  setNcClaims]  = useState<Party[]>([{ id: cid(), name: '' }]);
  const [ncDefends, setNcDefends] = useState<Party[]>([{ id: cid(), name: '' }]);

  useEffect(() => {
    loadCases().then(setCases);
  }, []);

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
    const nc: Case = {
      id:                 cid(),
      caseName:           ncName.trim(),
      court:              ncCourt.trim(),
      suitNo:             ncSuit.trim(),
      dateCommenced:      ncDate,
      role:               ncRole,
      claimants:          ncClaims.filter(c => c.name.trim()).map(c => ({ ...c, name: c.name.trim() })),
      defendants:         ncDefends.filter(d => d.name.trim()).map(d => ({ ...d, name: d.name.trim() })),
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

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(7,7,15,0.96)',
    overflowY: 'auto', padding: '0 0 60px',
  };

  const innerStyle: React.CSSProperties = {
    maxWidth: 860, margin: '0 auto', padding: '80px 24px 40px',
  };

  const pIStyle: React.CSSProperties = {
    ...S.inp,
    marginBottom: 0,
    fontSize: 13,
  };

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
              fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              marginTop: 8,
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <button
            onClick={() => setCreating(c => !c)}
            style={{
              background: creating ? 'transparent' : `linear-gradient(135deg,#c4a030,#a07820)`,
              color:      creating ? T.mute : '#05050c',
              border:     creating ? `1px solid #1e1e2e` : 'none',
              borderRadius: 5, padding: '10px 20px', fontSize: 13,
              fontFamily: "'Cormorant Garamond', serif",
              cursor: 'pointer', fontWeight: 600, letterSpacing: '.03em',
            }}
          >
            {creating ? '✕ Cancel' : '+ New Case'}
          </button>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cases…"
            style={{
              ...S.inp, width: 240, marginBottom: 0, fontSize: 13, padding: '10px 14px',
            }}
          />
        </div>

        {/* New case form */}
        {creating && (
          <div style={{
            background: '#0a0a14', border: `1px solid ${T.gold}33`,
            borderRadius: 8, padding: '20px 22px', marginBottom: 20,
            animation: 'fadeUp .2s ease',
          }}>
            <p style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 16 }}>
              New Case
            </p>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Case Name *</label>
              <input value={ncName} onChange={e => setNcName(e.target.value)} placeholder="e.g. Okonkwo v First Bank PLC" style={S.inp} />
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
                <label style={S.label}>Our Role</label>
                <select value={ncRole} onChange={e => setNcRole(e.target.value)} style={{ ...S.sel, padding: '10px 14px' }}>
                  {['Claimant', 'Defendant', 'Appellant', 'Respondent'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Suit Number</label>
                <input value={ncSuit} onChange={e => setNcSuit(e.target.value)} placeholder="e.g. FHC/L/CS/123/2024" style={S.inp} />
              </div>
              <div>
                <label style={S.label}>Date Commenced</label>
                <input type="date" value={ncDate} onChange={e => setNcDate(e.target.value)} style={S.inp} />
              </div>
            </div>

            {/* Claimants */}
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Claimants</label>
              {ncClaims.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={e => updateParty(ncClaims, setNcClaims, p.id, e.target.value)} placeholder="Party name" style={{ ...pIStyle, flex: 1 }} />
                  <button onClick={() => removeParty(ncClaims, setNcClaims, p.id)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              <button onClick={() => addParty(ncClaims, setNcClaims)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>+ Add Claimant</button>
            </div>

            {/* Defendants */}
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Defendants / Respondents</label>
              {ncDefends.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={e => updateParty(ncDefends, setNcDefends, p.id, e.target.value)} placeholder="Party name" style={{ ...pIStyle, flex: 1 }} />
                  <button onClick={() => removeParty(ncDefends, setNcDefends, p.id)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              <button onClick={() => addParty(ncDefends, setNcDefends)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>+ Add Defendant</button>
            </div>

            <button
              onClick={createCase}
              disabled={!ncName.trim()}
              style={{
                background:    ncName.trim() ? `linear-gradient(135deg,#c4a030,#a07820)` : '#101018',
                color:         ncName.trim() ? '#05050c' : '#2a2a38',
                border:        'none', borderRadius: 6,
                padding:       '12px 24px', fontSize: 15,
                fontFamily:    "'Cormorant Garamond', serif",
                cursor:        ncName.trim() ? 'pointer' : 'not-allowed',
                fontWeight:    600, letterSpacing: '.04em',
              }}
            >
              Create Case →
            </button>
          </div>
        )}

        {/* Case list */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 16, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 8 }}>
              {cases.length === 0 ? 'No cases yet. Create your first case above.' : 'No cases match your search.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(c => (
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
                    <p style={{ fontSize: 15, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 4 }}>
                      {c.caseName}
                    </p>
                    <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                      {[c.court, c.suitNo].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{
                      fontSize: 9, padding: '3px 8px', borderRadius: 3,
                      fontFamily: 'Inter, sans-serif', fontWeight: 600,
                      letterSpacing: '.08em', textTransform: 'uppercase',
                      background: '#0a0a14', border: `1px solid #1e1e2e`, color: T.mute,
                    }}>
                      {c.role}
                    </span>
                    <p style={{ fontSize: 10, color: '#2a2a3e', fontFamily: 'Inter, sans-serif', marginTop: 5 }}>
                      {formatDate(c.createdAt?.slice(0, 10) || '')}
                    </p>
                    <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
                      {c.recent_entries?.length ?? 0} entries
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
