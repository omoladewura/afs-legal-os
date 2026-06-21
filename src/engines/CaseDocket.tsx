/**
 * AFS Advocates — Case Docket Overlay
 * Full-screen overlay for case management: list, create, search, open.
 *
 * V3 CHANGES:
 * - Originating process dropdown added (civil/special matters only).
 * - Party labels auto-derive from originating process config.
 * - matter_track auto-derives from originating process selection.
 * - Matrimonial, Election, and FREP tracks fully wired.
 * - Custom "Other" option allows free-text party label entry.
 *
 * V4 CHANGES (Phase 3 — FREP & Matrimonial integration):
 * - Reads docketFilter from store to filter the case list.
 * - Auto-presets originating_process when filter is 'frep' or 'matrimonial'
 *   (skips the dropdown — it is already determined by entry point).
 * - Party label placeholders and role button labels reflect filter context.
 * - Header title and subtitle adapt to active filter.
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { loadCases, saveCase } from '@/storage/helpers';
import { uid, cid, formatDate } from '@/utils';
import { T, S } from '@/constants/tokens';
import { COURTS } from '@/constants/legal';
import type { Case, Party, CounselRole, OriginatingProcess } from '@/types';
import {
  rolesForTrack,
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_LABELS,
  COUNSEL_ROLE_COLORS,
  MATTER_TRACK_COLORS,
  ORIGINATING_PROCESSES,
  getOriginatingProcess,
} from '@/types';

// ── Filter → preset originating process mapping ───────────────────────────
const FILTER_PRESET: Record<'frep' | 'matrimonial', OriginatingProcess> = {
  frep:        'frep',
  matrimonial: 'petition_matrimonial',
};

export function CaseDocket() {
  const { setDocketOpen, setActiveCase, setView, docketFilter } = useAppStore();

  const [cases,    setCases]    = useState<Case[]>([]);
  const [search,   setSearch]   = useState('');
  const [creating, setCreating] = useState(false);

  // Phase 2A — loading state + offline-from-cache detection.
  // loadCases() tries D1 first (6 s timeout) then falls back to IndexedDB.
  // fromCache is set to true when D1 is unreachable and we served local data.
  const [loadingCases, setLoadingCases] = useState(true);
  const [fromCache,    setFromCache]    = useState(false);

  // ── New case form state ────────────────────────────────────────────────────

  const [ncName,   setNcName]   = useState('');
  const [ncCourt,  setNcCourt]  = useState('');
  const [ncSuit,   setNcSuit]   = useState('');
  const [ncDate,   setNcDate]   = useState('');

  // Track — criminal uses buttons; civil derives from originating process
  const [isCriminal, setIsCriminal] = useState(false);

  // Originating process — civil/special matters only.
  // When docketFilter is 'frep' or 'matrimonial', this is preset and the
  // dropdown is hidden (the entry point already determined the process).
  const filterPreset = docketFilter !== 'all' ? FILTER_PRESET[docketFilter] : null;
  const [ncOrigProc, setNcOrigProc] = useState<OriginatingProcess>(
    filterPreset ?? 'writ_of_summons'
  );

  // Keep ncOrigProc in sync if user navigates between filtered entry points
  // without unmounting the docket (e.g. unlikely but safe to handle).
  useEffect(() => {
    if (filterPreset) setNcOrigProc(filterPreset);
  }, [filterPreset]);

  // Custom party labels — used when originating_process === 'other'
  const [ncCustomA, setNcCustomA] = useState('');
  const [ncCustomB, setNcCustomB] = useState('');

  // Counsel role — default to petitioner_side for matrimonial entry point
  const [ncRole, setNcRole] = useState<CounselRole>(
    filterPreset === 'petition_matrimonial' ? 'petitioner_side' : 'claimant_side'
  );

  // Parties
  const [ncPartiesA, setNcPartiesA] = useState<Party[]>([{ id: cid(), name: '' }]);
  const [ncPartiesB, setNcPartiesB] = useState<Party[]>([{ id: cid(), name: '' }]);

  // Derived config from originating process
  const origConfig = getOriginatingProcess(isCriminal ? undefined : ncOrigProc);

  // Derived matter_track
  const derivedTrack = isCriminal ? 'criminal' : origConfig.track;

  // Party labels
  const partyALabel   = isCriminal ? 'Complainant(s)' : (ncOrigProc === 'other' && ncCustomA ? ncCustomA : origConfig.partyAPlural);
  const partyBLabel   = isCriminal ? 'Accused'        : (ncOrigProc === 'other' && ncCustomB ? ncCustomB : origConfig.partyBPlural);
  const partyAHolder  = isCriminal ? 'Complainant name' : origConfig.partyALabel + ' name';
  const partyBHolder  = isCriminal ? 'Accused name'     : origConfig.partyBLabel + ' name';

  // When switching criminal/civil, reset role
  function handleTrackSwitch(criminal: boolean) {
    setIsCriminal(criminal);
    if (criminal) {
      setNcRole('prosecution');
    } else {
      setNcRole('claimant_side');
      // If a filter preset exists, honour it; otherwise fall back to writ
      setNcOrigProc(filterPreset ?? 'writ_of_summons');
    }
  }

  // When originating process changes, update role to match side
  function handleOrigProcChange(proc: OriginatingProcess) {
    setNcOrigProc(proc);
    // Matrimonial petitions use petitioner_side, all others use claimant_side
    setNcRole(proc === 'petition_matrimonial' ? 'petitioner_side' : 'claimant_side');
  }

  useEffect(() => {
    // Phase 2A — offline-aware case list load.
    // We race D1 against a flag so we know whether the result came from
    // the network or from IndexedDB. loadCases() already does the D1 →
    // IndexedDB fallback; we detect which path fired by checking navigator.onLine
    // and whether the Worker was reachable via the existing afs:worker-offline event.
    // Simpler heuristic: if navigator.onLine is false we know it's cache.
    // If online but D1 times out (6 s), loadCases() still returns IndexedDB data
    // silently — we detect that by timing the call.
    setLoadingCases(true);
    setFromCache(false);

    const start = Date.now();
    loadCases().then(result => {
      setCases(result);
      // If the load came back faster than 200 ms it was almost certainly
      // IndexedDB (D1 never responds that quickly). Over 200 ms we assume
      // it may have hit D1 — but if device is offline we still flag cache.
      const elapsed = Date.now() - start;
      const likelyCached = !navigator.onLine || elapsed < 200;
      setFromCache(likelyCached);
      setLoadingCases(false);
    }).catch(() => {
      setLoadingCases(false);
      setFromCache(true);
    });
  }, []);

  // ── Case list filtering ────────────────────────────────────────────────────
  // Apply docketFilter first, then text search on top.
  const filterByCaseType = (c: Case) => {
    if (docketFilter === 'frep')        return c.originating_process === 'frep';
    if (docketFilter === 'matrimonial') return c.originating_process === 'petition_matrimonial';
    return true; // 'all'
  };

  const filtered = cases
    .filter(filterByCaseType)
    .filter(c =>
      !search.trim() ||
      c.caseName.toLowerCase().includes(search.toLowerCase()) ||
      (c.suitNo  || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.court   || '').toLowerCase().includes(search.toLowerCase())
    );

  async function createCase() {
    if (!ncName.trim()) return;
    const now = new Date().toISOString();

    const legacyRole: Case['role'] =
      ncRole === 'claimant_side'   ? 'Claimant'  :
      ncRole === 'defendant_side'  ? 'Defendant' :
      ncRole === 'prosecution'     ? 'Prosecution' :
      ncRole === 'petitioner_side' ? 'Petitioner' :
      ncRole === 'respondent_side' ? 'Respondent' :
      'Defence';

    const nc: Case = {
      id:                  cid(),
      caseName:            ncName.trim(),
      court:               ncCourt.trim(),
      suitNo:              ncSuit.trim(),
      dateCommenced:       ncDate,
      matter_track:        derivedTrack,
      counsel_role:        ncRole,
      originating_process: isCriminal ? undefined : ncOrigProc,
      custom_party_a_label: ncOrigProc === 'other' && ncCustomA ? ncCustomA : undefined,
      custom_party_b_label: ncOrigProc === 'other' && ncCustomB ? ncCustomB : undefined,
      role:                legacyRole,
      claimants:           ncPartiesA.filter(p => p.name.trim()).map(p => ({ ...p, name: p.name.trim() })),
      defendants:          ncPartiesB.filter(p => p.name.trim()).map(p => ({ ...p, name: p.name.trim() })),
      createdAt:           now,
      compressed_summary:  '',
      recent_entries:      [],
      deadlines:           [],
    };
    await saveCase(nc);
    setCases(prev => [nc, ...prev]);
    openCase(nc);
  }

  function openCase(c: Case) {
    setActiveCase(c);
    setDocketOpen(false);
    // Matrimonial cases get their own first-class workspace
    setView(c.originating_process === 'petition_matrimonial' ? 'matrimonial' : 'engine');
  }

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
    setIsCriminal(false);
    setNcOrigProc(filterPreset ?? 'writ_of_summons');
    setNcRole('claimant_side');
    setNcCustomA(''); setNcCustomB('');
    setNcPartiesA([{ id: cid(), name: '' }]);
    setNcPartiesB([{ id: cid(), name: '' }]);
  }

  // ── Header copy driven by docketFilter ────────────────────────────────────
  const headerTitle = docketFilter === 'frep'
    ? 'FREP Docket'
    : docketFilter === 'matrimonial'
      ? 'Matrimonial Docket'
      : 'Case Docket';

  const headerSubtitle = docketFilter === 'frep'
    ? 'Fundamental Rights Enforcement Proceedings — Applicant / Respondent matters.'
    : docketFilter === 'matrimonial'
      ? 'Matrimonial causes and ancillary relief — Petitioner / Respondent matters.'
      : 'All matters — open, search, and manage your full docket.';

  const emptyMsg = cases.filter(filterByCaseType).length === 0
    ? fromCache
      ? `No ${docketFilter === 'all' ? '' : docketFilter === 'frep' ? 'FREP ' : 'matrimonial '}matters found in local cache. Connect to sync your docket from the server.`
      : `No ${docketFilter === 'all' ? '' : docketFilter === 'frep' ? 'FREP ' : 'matrimonial '}matters yet. Create your first matter above.`
    : 'No matters match your search.';

  // ── Styles ─────────────────────────────────────────────────────────────────

  const ROLE_LIGHT: Record<CounselRole, { bg: string; bdr: string; col: string }> = {
    claimant_side:   { bg: '#edf3fb', bdr: '#b8cfe8', col: '#1a4a8a' },
    defendant_side:  { bg: '#fbeaea', bdr: '#e0b8b8', col: '#7a1a1a' },
    prosecution:     { bg: '#fdf3e0', bdr: '#e0cfa0', col: '#7a4a00' },
    defence:         { bg: '#e8f5ee', bdr: '#a8d0b8', col: '#1a5a30' },
    petitioner_side: { bg: '#f5edfb', bdr: '#ccb8e8', col: '#4a1a7a' },
    respondent_side: { bg: '#fbedf5', bdr: '#e8b8d4', col: '#7a1a4a' },
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.55)',
    overflowY: 'auto', padding: '0 0 60px',
  };

  const innerStyle: React.CSSProperties = {
    maxWidth: 860, margin: '0 auto', padding: '60px 24px 40px',
    background: '#ffffff', minHeight: '100vh',
  };

  const pIStyle: React.CSSProperties = { ...S.inp, marginBottom: 0, fontSize: 13 };

  const trackBtnStyle = (selected: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 14px',
    background: selected ? '#f0f0ee' : '#ffffff',
    border: `1px solid ${selected ? '#888888' : '#cccccc'}`,
    borderRadius: 3, cursor: 'pointer',
    color: selected ? '#111111' : '#888888',
    fontFamily: "'Times New Roman', Times, serif", fontSize: 12, fontWeight: 700,
    letterSpacing: '.08em', textTransform: 'uppercase' as const,
    transition: 'all .15s',
  });

  const roleBtnStyle = (selected: boolean, role: CounselRole): React.CSSProperties => ({
    flex: 1, padding: '10px 14px',
    background: selected ? ROLE_LIGHT[role].bg : '#ffffff',
    border: `1px solid ${selected ? ROLE_LIGHT[role].bdr : '#cccccc'}`,
    borderRadius: 3, cursor: 'pointer',
    color: selected ? ROLE_LIGHT[role].col : '#888888',
    fontFamily: "'Times New Roman', Times, serif", fontSize: 12, fontWeight: 600,
    letterSpacing: '.04em',
    transition: 'all .15s',
  });

  const trackColor = MATTER_TRACK_COLORS[derivedTrack] ?? MATTER_TRACK_COLORS['civil'];

  return (
    <div style={overlayStyle}>
      <div style={innerStyle}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', marginBottom: 28,
          borderBottom: '2px solid #111111', paddingBottom: 16,
        }}>
          <div>
            <p style={{
              fontSize: 9, color: '#888888',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 5,
            }}>
              AFS Advocates
            </p>
            <h1 style={{
              fontSize: 28, color: '#111111',
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 700, fontStyle: 'italic', marginBottom: 6,
            }}>
              {headerTitle}
            </h1>
            <p style={{
              fontSize: 12, color: '#888888',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              {headerSubtitle}
            </p>
          </div>
          <button
            onClick={() => setDocketOpen(false)}
            style={{
              background: 'transparent', border: '1px solid #cccccc',
              color: '#444444', borderRadius: 3, padding: '7px 16px',
              fontSize: 12, fontFamily: "'Times New Roman', Times, serif",
              cursor: 'pointer', marginTop: 8,
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Phase 2A — Offline / cached data badge */}
        {fromCache && !loadingCases && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', marginBottom: 16,
            background: '#fffbf0', border: '1px solid #e0cfa0',
            borderRadius: 4,
          }}>
            <span style={{ fontSize: 13, lineHeight: 1 }}>◌</span>
            <p style={{
              fontSize: 11, margin: 0, color: '#7a4a00',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              Showing locally cached matters — changes made here will sync when you're back online
            </p>
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <button
            onClick={() => { if (creating) resetForm(); setCreating(c => !c); }}
            style={{
              background: creating ? 'transparent' : '#111111',
              color: creating ? '#666666' : '#ffffff',
              border: creating ? '1px solid #cccccc' : 'none',
              borderRadius: 3, padding: '9px 20px', fontSize: 13,
              fontFamily: "'Times New Roman', Times, serif",
              cursor: 'pointer', fontWeight: 600, letterSpacing: '.02em',
            }}
          >
            {creating ? '✕ Cancel' : '+ New Matter'}
          </button>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search matters…"
            style={{ ...S.inp, width: 240, marginBottom: 0, fontSize: 13, padding: '9px 14px' }}
          />
        </div>

        {/* ── New matter form ──────────────────────────────────────────────── */}
        {creating && (
          <div style={{
            background: '#fafaf8', border: '1px solid #cccccc',
            borderRadius: 4, padding: '22px 24px', marginBottom: 24,
            animation: 'fadeUp .2s ease',
          }}>
            <p style={{
              fontSize: 9, color: '#444444',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 18,
              borderBottom: '1px solid #cccccc', paddingBottom: 10,
            }}>
              New Matter
              {filterPreset && (
                <span style={{ fontWeight: 400, color: '#888888', marginLeft: 10, letterSpacing: '.06em' }}>
                  — {docketFilter === 'frep' ? 'FREP · Applicant / Respondent' : 'Matrimonial · Petitioner / Respondent'}
                </span>
              )}
            </p>

            {/* ── STEP 1: Criminal vs Civil/Special ──
                Hidden when filter is 'frep' or 'matrimonial' — those are
                always civil/special. The track is already determined. */}
            {!filterPreset && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                  Track <span style={{ color: '#111111' }}>*</span>
                  <span style={{ color: '#888888', fontWeight: 400, fontSize: 10, marginLeft: 8 }}>
                    Cannot be changed after creation
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleTrackSwitch(false)} style={trackBtnStyle(!isCriminal)}>
                    ⚖ Civil / Special
                  </button>
                  <button onClick={() => handleTrackSwitch(true)} style={trackBtnStyle(isCriminal)}>
                    ⚖ Criminal
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: Originating Process (civil/special only) ──
                Hidden when docketFilter presets the process — the entry
                point has already determined it. Shown for 'all' filter. */}
            {!isCriminal && !filterPreset && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                  Originating Process <span style={{ color: '#111111' }}>*</span>
                </label>
                <select
                  value={ncOrigProc}
                  onChange={e => handleOrigProcChange(e.target.value as OriginatingProcess)}
                  style={{ ...S.sel, padding: '10px 14px', fontSize: 13, width: '100%' }}
                >
                  {ORIGINATING_PROCESSES.map(proc => (
                    <option key={proc.id} value={proc.id}>{proc.label}</option>
                  ))}
                </select>

                {/* Description + court authority */}
                <div style={{
                  marginTop: 8, padding: '8px 12px',
                  background: trackColor.bg,
                  border: `1px solid ${trackColor.bdr}`,
                  borderRadius: 3, fontSize: 12, color: trackColor.col,
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                  <span style={{ fontStyle: 'italic' }}>{origConfig.description}</span>
                  <span style={{ color: '#888888', marginLeft: 8, fontSize: 11 }}>
                    — {origConfig.courtNote}
                  </span>
                </div>

                {/* Custom party labels for 'other' */}
                {ncOrigProc === 'other' && (
                  <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ ...S.label, fontSize: 11 }}>Party A designation (plural)</label>
                      <input
                        value={ncCustomA}
                        onChange={e => setNcCustomA(e.target.value)}
                        placeholder="e.g. Applicants"
                        style={{ ...S.inp, fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ ...S.label, fontSize: 11 }}>Party B designation (plural)</label>
                      <input
                        value={ncCustomB}
                        onChange={e => setNcCustomB(e.target.value)}
                        placeholder="e.g. Respondents"
                        style={{ ...S.inp, fontSize: 12 }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* When filter preset is active, show a read-only process badge instead */}
            {!isCriminal && filterPreset && (
              <div style={{
                marginBottom: 18, padding: '8px 12px',
                background: trackColor.bg,
                border: `1px solid ${trackColor.bdr}`,
                borderRadius: 3, fontSize: 12, color: trackColor.col,
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                <span style={{ fontWeight: 700 }}>{origConfig.label}</span>
                <span style={{ fontStyle: 'italic', marginLeft: 8 }}>{origConfig.description}</span>
                <span style={{ color: '#888888', marginLeft: 8, fontSize: 11 }}>
                  — {origConfig.courtNote}
                </span>
              </div>
            )}

            {/* ── STEP 3: Our Role ── */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                Our Role <span style={{ color: '#111111' }}>*</span>
                <span style={{ color: '#888888', fontWeight: 400, fontSize: 10, marginLeft: 8 }}>
                  Cannot be changed after creation
                </span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {rolesForTrack(derivedTrack).map(role => (
                  <button
                    key={role}
                    onClick={() => setNcRole(role)}
                    style={roleBtnStyle(ncRole === role, role)}
                  >
                    {isCriminal
                      ? COUNSEL_ROLE_LABELS[role]
                      : role === 'claimant_side'
                        ? `For ${origConfig.partyALabel}`
                        : `For ${origConfig.partyBLabel}`
                    }
                  </button>
                ))}
              </div>
              <div style={{
                marginTop: 8, padding: '8px 12px',
                background: ROLE_LIGHT[ncRole].bg,
                border: `1px solid ${ROLE_LIGHT[ncRole].bdr}`,
                borderRadius: 3, fontSize: 12, color: ROLE_LIGHT[ncRole].col,
                fontFamily: "'Times New Roman', Times, serif",
                fontStyle: 'italic',
              }}>
                {ncRole === 'claimant_side'   && `Acting for the ${origConfig.partyALabel.toLowerCase()} — advancing the claim, driving pleadings, trial, and enforcement.`}
                {ncRole === 'defendant_side'  && `Acting for the ${origConfig.partyBLabel.toLowerCase()} — resisting or managing the claim, filing defences and applications.`}
                {ncRole === 'prosecution'     && 'Acting for the prosecution — building and presenting the case against the accused.'}
                {ncRole === 'defence'         && 'Acting for the defence — protecting the accused, challenging prosecution evidence at every stage.'}
                {ncRole === 'petitioner_side' && 'Acting for the Petitioner — presenting the petition, establishing the dissolution fact, and advancing ancillary relief under the MCA.'}
                {ncRole === 'respondent_side' && 'Acting for the Respondent — answering the petition, raising available bars, and protecting the respondent\'s interests in ancillary proceedings.'}
              </div>
            </div>

            {/* ── Matter details ── */}
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Matter Name *</label>
              <input
                value={ncName}
                onChange={e => setNcName(e.target.value)}
                placeholder={
                  isCriminal
                    ? 'e.g. FRN v Adeyemi'
                    : ncOrigProc === 'petition_matrimonial'
                      ? 'e.g. Okonkwo v Okonkwo'
                      : ncOrigProc === 'petition_election'
                        ? 'e.g. Bello v INEC & Ors'
                        : ncOrigProc === 'frep'
                          ? 'e.g. Chukwu v AGF & Ors'
                          : 'e.g. Okonkwo v First Bank PLC'
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
                  {isCriminal ? 'Charge / Case No.' : 'Suit Number'}
                </label>
                <input
                  value={ncSuit}
                  onChange={e => setNcSuit(e.target.value)}
                  placeholder={isCriminal ? 'FHC/L/CR/456/2024' : 'FHC/L/CS/123/2024'}
                  style={S.inp}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Date Commenced</label>
              <input type="date" value={ncDate} onChange={e => setNcDate(e.target.value)} style={{ ...S.inp, maxWidth: 220 }} />
            </div>

            {/* ── Parties (labels derive from originating process) ── */}
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>{partyALabel}</label>
              {ncPartiesA.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={e => updateParty(ncPartiesA, setNcPartiesA, p.id, e.target.value)} placeholder={partyAHolder} style={{ ...pIStyle, flex: 1 }} />
                  <button onClick={() => removeParty(ncPartiesA, setNcPartiesA, p.id)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              <button onClick={() => addParty(ncPartiesA, setNcPartiesA)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
                + Add {isCriminal ? 'Complainant' : origConfig.partyALabel}
              </button>
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={S.label}>{partyBLabel}</label>
              {ncPartiesB.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={e => updateParty(ncPartiesB, setNcPartiesB, p.id, e.target.value)} placeholder={partyBHolder} style={{ ...pIStyle, flex: 1 }} />
                  <button onClick={() => removeParty(ncPartiesB, setNcPartiesB, p.id)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              <button onClick={() => addParty(ncPartiesB, setNcPartiesB)} style={{ background: 'transparent', border: `1px solid #1e1e2e`, color: T.mute, borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
                + Add {isCriminal ? 'Accused' : origConfig.partyBLabel}
              </button>
            </div>

            {/* ── Summary strip before create ── */}
            {ncName.trim() && (
              <div style={{
                marginBottom: 18, padding: '10px 14px',
                background: '#060610', border: `1px solid #1a1a2e`,
                borderRadius: 6, fontFamily: "'Times New Roman', Times, serif", fontSize: 11,
                color: T.mute, lineHeight: 1.7,
              }}>
                <span style={{ color: trackColor.col, fontWeight: 700 }}>
                  {isCriminal ? 'Criminal' : origConfig.label}
                </span>
                {' · '}
                <span style={{ color: ROLE_LIGHT[ncRole].col, fontWeight: 700 }}>
                  {isCriminal
                    ? COUNSEL_ROLE_LABELS[ncRole]
                    : (ncRole === 'petitioner_side' || ncRole === 'respondent_side')
                      ? COUNSEL_ROLE_LABELS[ncRole]
                      : ncRole === 'claimant_side'
                        ? `For ${origConfig.partyALabel}`
                        : `For ${origConfig.partyBLabel}`
                  }
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
                fontFamily:  "'Times New Roman', Times, serif",
                cursor:      ncName.trim() ? 'pointer' : 'not-allowed',
                fontWeight:  600, letterSpacing: '.04em',
              }}
            >
              Create Matter →
            </button>
          </div>
        )}

        {/* ── Matter list ─────────────────────────────────────────────────── */}
        {loadingCases ? (
          // Phase 2A — skeleton while loadCases() is in flight (up to 6 s for D1 timeout)
          <div style={{ borderTop: '1px solid #cccccc' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                padding: '18px 4px', borderBottom: '1px solid #eeeeee',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    height: 15, width: `${55 + i * 12}%`, borderRadius: 3,
                    background: '#f0f0ee', marginBottom: 8,
                  }} />
                  <div style={{
                    height: 11, width: '35%', borderRadius: 3,
                    background: '#f5f5f3',
                  }} />
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <div style={{ height: 16, width: 80, borderRadius: 3, background: '#f0f0ee' }} />
                  <div style={{ height: 16, width: 60, borderRadius: 3, background: '#f5f5f3' }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', borderTop: '1px solid #cccccc' }}>
            <p style={{ fontSize: 14, color: '#888888', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              {emptyMsg}
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid #cccccc' }}>
            {filtered.map(c => {
              const track = c.matter_track ?? 'civil';
              const role  = c.counsel_role;
              const roleL = role ? ROLE_LIGHT[role] : null;
              const tColor = MATTER_TRACK_COLORS[track] ?? MATTER_TRACK_COLORS['civil'];
              const origProc = c.originating_process ? getOriginatingProcess(c.originating_process) : null;
              return (
                <button
                  key={c.id}
                  onClick={() => openCase(c)}
                  style={{
                    background: '#ffffff', border: 'none',
                    borderBottom: '1px solid #eeeeee',
                    padding: '16px 4px',
                    textAlign: 'left', cursor: 'pointer',
                    transition: 'background .12s',
                    display: 'block', width: '100%',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f7f7f5'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ffffff'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 15, color: '#111111',
                        fontFamily: "'Times New Roman', Times, serif",
                        fontWeight: 700, fontStyle: 'italic', marginBottom: 4,
                      }}>
                        {c.caseName}
                      </p>
                      <p style={{
                        fontSize: 11, color: '#888888',
                        fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5,
                      }}>
                        {[c.court, c.suitNo].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      {/* Originating process badge (civil/special) or track badge (criminal) */}
                      <span style={{
                        fontSize: 9, padding: '2px 7px', borderRadius: 2,
                        fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                        letterSpacing: '.08em', textTransform: 'uppercase' as const,
                        background: tColor.bg, border: `1px solid ${tColor.bdr}`, color: tColor.col,
                      }}>
                        {origProc ? origProc.label : (MATTER_TRACK_LABELS[track] ?? track)}
                      </span>
                      {/* Role badge */}
                      {role && roleL ? (
                        <span style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 2,
                          fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                          letterSpacing: '.06em', textTransform: 'uppercase' as const,
                          background: roleL.bg, border: `1px solid ${roleL.bdr}`, color: roleL.col,
                        }}>
                          {origProc
                            ? role === 'claimant_side' ? `For ${origProc.partyALabel}` : `For ${origProc.partyBLabel}`
                            : COUNSEL_ROLE_LABELS[role]
                          }
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 2,
                          fontFamily: "'Times New Roman', Times, serif", fontWeight: 600,
                          letterSpacing: '.08em', textTransform: 'uppercase' as const,
                          background: '#f5f5f5', border: '1px solid #cccccc', color: '#888888',
                        }}>
                          {c.role}
                        </span>
                      )}
                      <p style={{ fontSize: 10, color: '#888888', fontFamily: "'Times New Roman', Times, serif", marginTop: 2 }}>
                        {formatDate(c.createdAt?.slice(0, 10) || '')}
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
