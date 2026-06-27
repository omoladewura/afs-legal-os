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
 * - Auto-presets originating_process when filter is 'frep' or 'matrimonial'.
 * - Party label placeholders and role button labels reflect filter context.
 * - Header title and subtitle adapt to active filter.
 *
 * V5 CHANGES (UI fixes):
 * - Search input removed.
 * - Case list hidden while New Matter form is open.
 * - Track toggle: "Civil / Special" → "Civil".
 * - Form order: Track → Court → Originating Process (court-driven).
 * - Originating Process options filtered by selected court.
 * - Role description text no longer says "claim" for non-civil tracks.
 * - Delete button added to each case row.
 * - Court list: Federal High Court and High Court (FCT) are separate entries.
 * - Court of Appeal and Supreme Court removed (appellate — not first instance).
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { loadCases, saveCase, deleteCase } from '@/storage/helpers';
import { uid, cid, formatDate } from '@/utils';
import { T, S } from '@/constants/tokens';
import { COURTS, COURT_ORIGINATING_PROCESSES } from '@/constants/legal';
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

// ── Court-driven originating process → OriginatingProcess id mapping ─────
// Maps the plain string labels from COURT_ORIGINATING_PROCESSES (legal.ts)
// to the OriginatingProcess id used internally.
// Labels must match COURT_ORIGINATING_PROCESSES values exactly.
const PROC_LABEL_TO_ID: Record<string, OriginatingProcess> = {
  // ── High Court (State / FCT) & Federal High Court — general civil ─────────
  'Writ of Summons':          'writ_of_summons',
  'Originating Summons':      'originating_summons',

  // ── Two-level top-level labels (sub-proc overrides final id) ──────────────
  'Originating Motion':       'originating_motion',   // fallback; sub-proc overrides
  'Petition':                 'petition_matrimonial',  // fallback; sub-proc overrides

  // ── Originating Motion sub-types ──────────────────────────────────────────
  'General Originating Motion': 'originating_motion',
  'Fundamental Rights (FREP)':  'frep',

  // ── Petition sub-types ────────────────────────────────────────────────────
  'Matrimonial Petition':     'petition_matrimonial',
  'Winding-Up Petition':      'winding_up_petition',

  // ── Federal High Court — specialist track (legacy) ────────────────────────

  // ── National Industrial Court ─────────────────────────────────────────────
  'NICN Complaint':           'nicn_complaint',
  'NICN Originating Summons': 'nicn_originating_summons',
  'NICN Judicial Review':     'nicn_judicial_review',
  'NICN Notice of Appeal':    'nicn_appeal',

  // ── Lower Courts ──────────────────────────────────────────────────────────
  'Customary Summons':        'customary_summons',
  'Magistrate Plaint':        'magistrate_plaint',
  'Magistrate Default':       'magistrate_default',
  'Small Claims':             'small_claims',

  // ── Specialized Tribunals & Panels ────────────────────────────────────────
  'Election Petition':        'election_petition',
  'Tax Appeal':               'tax_appeal',
  'IST Application':          'ist_application',
  'Notice of Arbitration':    'arbitration_notice',
};

function procLabelToId(label: string, _court: string): OriginatingProcess {
  return PROC_LABEL_TO_ID[label] ?? 'other';
}

export function CaseDocket() {
  const { setDocketOpen, setActiveCase, setView, docketFilter } = useAppStore();

  const [cases,    setCases]    = useState<Case[]>([]);
  const [creating, setCreating] = useState(false);

  const [loadingCases, setLoadingCases] = useState(true);
  const [fromCache,    setFromCache]    = useState(false);

  // ── New case form state ────────────────────────────────────────────────────
  const [ncName,        setNcName]        = useState('');
  const [ncCourt,       setNcCourt]       = useState('');
  const [ncProcLabel,   setNcProcLabel]   = useState('');   // plain string label
  const [ncSubProcLabel, setNcSubProcLabel] = useState('');  // sub-type for Originating Motion / Petition
  const [ncSuit,        setNcSuit]        = useState('');
  const [ncDate,        setNcDate]        = useState('');
  const [isCriminal,    setIsCriminal]    = useState(false);
  const [ncCustomA,     setNcCustomA]     = useState('');
  const [ncCustomB,     setNcCustomB]     = useState('');

  const filterPreset = docketFilter !== 'all' ? FILTER_PRESET[docketFilter] : null;

  // Derive OriginatingProcess id from court + label selection
  // Sub-proc label (for Originating Motion / Petition) overrides the top-level label when set.
  const ncOrigProc: OriginatingProcess = filterPreset
    ?? (ncCourt && ncProcLabel
        ? (ncSubProcLabel ? procLabelToId(ncSubProcLabel, ncCourt) : procLabelToId(ncProcLabel, ncCourt))
        : 'writ_of_summons');

  // Available process labels for the selected court
  const availableProcs: string[] = ncCourt ? (COURT_ORIGINATING_PROCESSES[ncCourt] ?? []) : [];

  // Reset proc label when court changes
  useEffect(() => {
    setNcProcLabel('');
    setNcSubProcLabel('');
  }, [ncCourt]);

  // Reset sub-proc when top-level proc label changes
  useEffect(() => {
    setNcSubProcLabel('');
  }, [ncProcLabel]);

  // Keep proc label in sync when filter preset sets the court
  useEffect(() => {
    if (filterPreset) setNcProcLabel('');
  }, [filterPreset]);

  const [ncRole, setNcRole] = useState<CounselRole>(
    filterPreset === 'petition_matrimonial' ? 'petitioner_side' : 'claimant_side'
  );

  const [ncPartiesA, setNcPartiesA] = useState<Party[]>([{ id: cid(), name: '' }]);
  const [ncPartiesB, setNcPartiesB] = useState<Party[]>([{ id: cid(), name: '' }]);

  const origConfig  = getOriginatingProcess(isCriminal ? undefined : ncOrigProc);
  const derivedTrack = isCriminal ? 'criminal' : origConfig.track;

  const partyALabel  = isCriminal ? 'Complainant(s)' : (ncOrigProc === 'other' && ncCustomA ? ncCustomA : origConfig.partyAPlural);
  const partyBLabel  = isCriminal ? 'Accused'        : (ncOrigProc === 'other' && ncCustomB ? ncCustomB : origConfig.partyBPlural);
  const partyAHolder = isCriminal ? 'Complainant name' : origConfig.partyALabel + ' name';
  const partyBHolder = isCriminal ? 'Accused name'     : origConfig.partyBLabel + ' name';

  function handleTrackSwitch(criminal: boolean) {
    setIsCriminal(criminal);
    if (criminal) {
      setNcRole('prosecution');
    } else {
      setNcRole('claimant_side');
      setNcCourt('');
      setNcProcLabel('');
    }
  }

  function handleProcLabelChange(label: string) {
    setNcProcLabel(label);
    setNcSubProcLabel('');
    // Role only auto-sets here for non-two-level labels; two-level handled in handleSubProcLabelChange
    const id = procLabelToId(label, ncCourt);
    if (label !== 'Originating Motion' && label !== 'Petition') {
      setNcRole(id === 'petition_matrimonial' ? 'petitioner_side' : 'claimant_side');
    }
  }

  function handleSubProcLabelChange(subLabel: string) {
    setNcSubProcLabel(subLabel);
    const id = procLabelToId(subLabel, ncCourt);
    if (id === 'frep') setNcRole('frep_applicant');
    else if (id === 'petition_matrimonial') setNcRole('petitioner_side');
    else setNcRole('claimant_side');
  }

  // ── Role description — no "claim" language for non-civil roles ────────────
  // Phase 1E — court + process-aware role descriptions
  function roleDescription(role: CounselRole): string {
    const A = origConfig.partyALabel;
    const B = origConfig.partyBLabel;
    const op = ncOrigProc;

    // ── Criminal ─────────────────────────────────────────────────────────────
    if (role === 'prosecution') {
      return ncCourt.includes('Magistrate')
        ? 'Acting for the prosecution — presenting the charge, calling witnesses, and securing a conviction before the Magistrate.'
        : 'Acting for the prosecution — building the case file, conducting examination-in-chief, and advancing the charge to verdict.';
    }
    if (role === 'defence') {
      return 'Acting for the defence — protecting the accused at every stage: bail, no-case submission, cross-examination, and final address.';
    }

    // ── Matrimonial ───────────────────────────────────────────────────────────
    if (role === 'petitioner_side' && op === 'petition_matrimonial') {
      return 'Acting for the Petitioner — presenting the petition, establishing the dissolution fact, and advancing ancillary relief claims under the MCA.';
    }
    if (role === 'respondent_side' && op === 'petition_matrimonial') {
      return 'Acting for the Respondent — answering the petition, raising available bars to dissolution, and protecting interests in ancillary proceedings.';
    }

    // ── Election Petition ─────────────────────────────────────────────────────
    if (role === 'petitioner_side' && (op === 'petition_election' || op === 'election_petition')) {
      return 'Acting for the Petitioner — challenging the election result, adducing electoral irregularity evidence, and advancing the petition to the Tribunal.';
    }
    if (role === 'respondent_side' && (op === 'petition_election' || op === 'election_petition')) {
      return "Acting for the Respondent — defending the declaration, challenging the Petitioner's locus and evidence, and protecting the mandate.";
    }

    // ── Winding-Up Petition ───────────────────────────────────────────────────
    if (role === 'claimant_side' && op === 'winding_up_petition') {
      return 'Acting for the Petitioner — establishing the ground for winding up, verifying the debt, and advancing the petition under CAMA before the Federal High Court.';
    }
    if (role === 'defendant_side' && op === 'winding_up_petition') {
      return 'Acting for the Respondent Company — opposing the petition, challenging the debt or ground relied upon, and filing a counter-affidavit.';
    }

    // ── FREP ──────────────────────────────────────────────────────────────────
    if (role === 'frep_applicant') {
      return `Acting for the Applicant — initiating enforcement of fundamental rights${ncCourt ? ' in the ' + ncCourt : ''}, filing the application and supporting affidavit, and advancing the matter to hearing.`;
    }
    if (role === 'frep_respondent') {
      return 'Acting for the Respondent — opposing the application, filing counter-affidavit, and challenging the facts and reliefs sought.';
    }

    // ── NICN ──────────────────────────────────────────────────────────────────
    if (op === 'nicn_complaint') {
      return role === 'claimant_side'
        ? 'Acting for the Claimant — filing Complaint Form 1, advancing the employment claim, and driving the matter to hearing before the NICN.'
        : 'Acting for the Defendant — filing a defence, raising jurisdictional objections if available, and resisting the employment claim.';
    }
    if (op === 'nicn_originating_summons') {
      return role === 'claimant_side'
        ? "Acting for the Applicant — seeking the court's interpretation or determination on questions of labour law or employment rights before the NICN."
        : "Acting for the Respondent — opposing the originating summons, filing counter-affidavit, and advancing the Respondent's construction of the issues.";
    }
    if (op === 'nicn_judicial_review') {
      return role === 'claimant_side'
        ? 'Acting for the Applicant — challenging the decision of an employer or body on judicial review grounds before the NICN.'
        : 'Acting for the Respondent — defending the impugned decision and opposing leave and substantive relief.';
    }
    if (op === 'nicn_appeal') {
      return role === 'claimant_side'
        ? "Acting for the Appellant — prosecuting the appeal, settling grounds, and filing the Appellant's brief before the NICN."
        : "Acting for the Respondent — opposing the appeal, filing the Respondent's brief, and defending the decision below.";
    }

    // ── Magistrate / Lower Courts ─────────────────────────────────────────────
    if (op === 'magistrate_plaint' || op === 'customary_summons') {
      return role === 'claimant_side'
        ? `Acting for the ${A} — commencing the action by summons, leading evidence, and advancing the claim to judgment.`
        : `Acting for the ${B} — entering appearance, filing a defence, and resisting the claim at every stage.`;
    }
    if (op === 'magistrate_default') {
      return role === 'claimant_side'
        ? 'Acting for the Claimant — recovering the debt via default summons, and moving for judgment if the Defendant fails to appear or pay.'
        : 'Acting for the Defendant — entering appearance to set aside default, filing a defence, and disputing the debt.';
    }
    if (op === 'small_claims') {
      return role === 'claimant_side'
        ? 'Acting for the Claimant — pursuing the small claim, presenting evidence informally, and securing a fast-track judgment.'
        : 'Acting for the Defendant — contesting the claim in the small claims track, presenting the defence, and limiting the award.';
    }

    // ── Specialised Tribunals ─────────────────────────────────────────────────
    if (op === 'tax_appeal') {
      return role === 'claimant_side'
        ? 'Acting for the Appellant — challenging the tax assessment, filing the appeal and grounds, and advancing the objection before the TAT.'
        : "Acting for the Respondent (FIRS/SIRS) — defending the assessment, filing the Respondent's reply, and justifying the tax demand.";
    }
    if (op === 'ist_application') {
      return role === 'claimant_side'
        ? 'Acting for the Applicant — bringing the capital market or securities dispute before the IST, filing the application and supporting documents.'
        : "Acting for the Respondent — opposing the application, filing counter-documents, and advancing the Respondent's position before the IST.";
    }
    if (op === 'arbitration_notice') {
      return role === 'claimant_side'
        ? "Acting for the Claimant — commencing arbitration under the AMA, filing the notice and statement of claim, and driving the process to award."
        : "Acting for the Respondent — filing the statement of defence, raising jurisdictional objections if available, and resisting the claim before the panel.";
    }

    // ── Originating Summons / Motion (non-NICN) ───────────────────────────────
    if (op === 'originating_summons') {
      return role === 'claimant_side'
        ? `Acting for the Applicant — seeking the court's determination on questions of law or construction${ncCourt ? ' in the ' + ncCourt : ''}, by originating summons.`
        : "Acting for the Respondent — opposing the summons, filing counter-affidavit, and advancing the Respondent's construction of the issues.";
    }
    if (op === 'originating_motion') {
      return role === 'claimant_side'
        ? `Acting for the Applicant — initiating proceedings by originating motion${ncCourt ? ' in the ' + ncCourt : ''}, filing the motion paper and supporting affidavit.`
        : "Acting for the Respondent — opposing the motion, filing counter-affidavit, and advancing the Respondent's case.";
    }

    // ── Default: Writ of Summons + fallback ───────────────────────────────────
    if (role === 'claimant_side') {
      return `Acting for the ${A} — commencing by writ${ncCourt ? ' in the ' + ncCourt : ''}, driving pleadings, trial preparation, and enforcement of any judgment.`;
    }
    if (role === 'defendant_side') {
      return `Acting for the ${B} — entering appearance, filing a statement of defence, and resisting the claim through pleadings, interlocutory applications, and trial.`;
    }
    return '';
  }

  useEffect(() => {
    setLoadingCases(true);
    setFromCache(false);
    const start = Date.now();
    loadCases().then(result => {
      setCases(result);
      const elapsed = Date.now() - start;
      setFromCache(!navigator.onLine || elapsed < 200);
      setLoadingCases(false);
    }).catch(() => {
      setLoadingCases(false);
      setFromCache(true);
    });
  }, []);

  const filterByCaseType = (c: Case) => {
    if (docketFilter === 'frep')        return c.originating_process === 'frep';
    if (docketFilter === 'matrimonial') return c.originating_process === 'petition_matrimonial';
    return true;
  };

  const filtered = cases.filter(filterByCaseType);

  async function createCase() {
    if (!ncName.trim()) return;
    const now = new Date().toISOString();

    const legacyRole: Case['role'] =
      ncRole === 'claimant_side'   ? 'Claimant'   :
      ncRole === 'defendant_side'  ? 'Defendant'  :
      ncRole === 'prosecution'     ? 'Prosecution':
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

  async function handleDelete(e: React.MouseEvent, caseId: string) {
    e.stopPropagation();
    if (!window.confirm('Delete this matter? This cannot be undone.')) return;
    try {
      await deleteCase(caseId);
      setCases(prev => prev.filter(c => c.id !== caseId));
    } catch {
      alert('Failed to delete matter. Please try again.');
    }
  }

  function openCase(c: Case) {
    setActiveCase(c);
    setDocketOpen(false);
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
    setNcName(''); setNcCourt(''); setNcProcLabel(''); setNcSubProcLabel(''); setNcSuit(''); setNcDate('');
    setIsCriminal(false);
    setNcRole('claimant_side');
    setNcCustomA(''); setNcCustomB('');
    setNcPartiesA([{ id: cid(), name: '' }]);
    setNcPartiesB([{ id: cid(), name: '' }]);
  }

  // ── Header copy ────────────────────────────────────────────────────────────
  const headerTitle = docketFilter === 'frep'
    ? 'FREP Docket'
    : docketFilter === 'matrimonial'
      ? 'Matrimonial Docket'
      : 'Case Docket';

  const headerSubtitle = docketFilter === 'frep'
    ? 'Fundamental Rights Enforcement Proceedings — Applicant / Respondent matters.'
    : docketFilter === 'matrimonial'
      ? 'Matrimonial causes and ancillary relief — Petitioner / Respondent matters.'
      : 'All matters — open and manage your full docket.';

  const emptyMsg = cases.filter(filterByCaseType).length === 0
    ? fromCache
      ? `No ${docketFilter === 'all' ? '' : docketFilter === 'frep' ? 'FREP ' : 'matrimonial '}matters found in local cache.`
      : `No ${docketFilter === 'all' ? '' : docketFilter === 'frep' ? 'FREP ' : 'matrimonial '}matters yet. Create your first matter above.`
    : 'No matters found.';

  // ── Styles ─────────────────────────────────────────────────────────────────
  const ROLE_LIGHT: Record<CounselRole, { bg: string; bdr: string; col: string }> = {
    claimant_side:   { bg: '#edf3fb', bdr: '#b8cfe8', col: '#1a4a8a' },
    defendant_side:  { bg: '#fbeaea', bdr: '#e0b8b8', col: '#7a1a1a' },
    prosecution:     { bg: '#fdf3e0', bdr: '#e0cfa0', col: '#7a4a00' },
    defence:         { bg: '#e8f5ee', bdr: '#a8d0b8', col: '#1a5a30' },
    petitioner_side: { bg: '#f5edfb', bdr: '#ccb8e8', col: '#4a1a7a' },
    respondent_side: { bg: '#fbedf5', bdr: '#e8b8d4', col: '#7a1a4a' },
    frep_applicant:  { bg: '#edf5f0', bdr: '#a8d4bc', col: '#1a5a38' },
    frep_respondent: { bg: '#fdf0ea', bdr: '#e0c0a8', col: '#7a3010' },
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

        {/* Offline badge */}
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

        {/* Action row — New Matter button only, no search */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
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

            {/* STEP 1: Track — Civil or Criminal */}
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
                    ⚖ Civil
                  </button>
                  <button onClick={() => handleTrackSwitch(true)} style={trackBtnStyle(isCriminal)}>
                    ⚖ Criminal
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Court */}
            {!filterPreset && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                  Court <span style={{ color: '#111111' }}>*</span>
                </label>
                <select
                  value={ncCourt}
                  onChange={e => setNcCourt(e.target.value)}
                  style={{ ...S.sel, padding: '10px 14px', fontSize: 13, width: '100%' }}
                >
                  <option value="">Select court…</option>
                  {COURTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {/* STEP 3: Originating Process — driven by court selection */}
            {!isCriminal && !filterPreset && ncCourt && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                  Originating Process <span style={{ color: '#111111' }}>*</span>
                </label>
                <select
                  value={ncProcLabel}
                  onChange={e => handleProcLabelChange(e.target.value)}
                  style={{ ...S.sel, padding: '10px 14px', fontSize: 13, width: '100%' }}
                >
                  <option value="">Select process…</option>
                  {availableProcs.map(proc => (
                    <option key={proc} value={proc}>{proc}</option>
                  ))}
                </select>

                {/* Sub-proc selector — appears when Originating Motion or Petition is chosen */}
                {ncProcLabel === 'Originating Motion' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                      Motion Type <span style={{ color: '#111111' }}>*</span>
                    </label>
                    <select
                      value={ncSubProcLabel}
                      onChange={e => handleSubProcLabelChange(e.target.value)}
                      style={{ ...S.sel, padding: '10px 14px', fontSize: 13, width: '100%' }}
                    >
                      <option value="">Select motion type…</option>
                      <option value="General Originating Motion">General Originating Motion</option>
                      <option value="Fundamental Rights (FREP)">Fundamental Rights Enforcement (FREP)</option>
                    </select>
                  </div>
                )}

                {ncProcLabel === 'Petition' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ ...S.label, marginBottom: 8, display: 'block' }}>
                      Petition Type <span style={{ color: '#111111' }}>*</span>
                    </label>
                    <select
                      value={ncSubProcLabel}
                      onChange={e => handleSubProcLabelChange(e.target.value)}
                      style={{ ...S.sel, padding: '10px 14px', fontSize: 13, width: '100%' }}
                    >
                      <option value="">Select petition type…</option>
                      {(ncCourt === 'High Court (State)' || ncCourt === 'High Court (FCT)') && (
                        <option value="Matrimonial Petition">Matrimonial Petition</option>
                      )}
                      {(ncCourt === 'Federal High Court' || ncCourt === 'High Court (State)' || ncCourt === 'High Court (FCT)') && (
                        <option value="Winding-Up Petition">Winding-Up Petition</option>
                      )}
                    </select>
                  </div>
                )}

                {ncProcLabel && !(ncProcLabel === 'Originating Motion' && !ncSubProcLabel) && !(ncProcLabel === 'Petition' && !ncSubProcLabel) && (
                  <div style={{
                    marginTop: 8, padding: '8px 12px',
                    background: trackColor.bg,
                    border: `1px solid ${trackColor.bdr}`,
                    borderRadius: 3, fontSize: 12, color: trackColor.col,
                    fontFamily: "'Times New Roman', Times, serif",
                  }}>
                    <span style={{ fontStyle: 'italic' }}>{origConfig.description ?? ncProcLabel}</span>
                    {origConfig.courtNote && (
                      <span style={{ color: '#888888', marginLeft: 8, fontSize: 11 }}>
                        — {origConfig.courtNote}
                      </span>
                    )}
                  </div>
                )}

                {/* Custom labels for 'other' */}
                {ncOrigProc === 'other' && (
                  <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ ...S.label, fontSize: 11 }}>Party A designation (plural)</label>
                      <input value={ncCustomA} onChange={e => setNcCustomA(e.target.value)} placeholder="e.g. Applicants" style={{ ...S.inp, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ ...S.label, fontSize: 11 }}>Party B designation (plural)</label>
                      <input value={ncCustomB} onChange={e => setNcCustomB(e.target.value)} placeholder="e.g. Respondents" style={{ ...S.inp, fontSize: 12 }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Filter preset badge */}
            {!isCriminal && filterPreset && (
              <div style={{
                marginBottom: 18, padding: '8px 12px',
                background: trackColor.bg, border: `1px solid ${trackColor.bdr}`,
                borderRadius: 3, fontSize: 12, color: trackColor.col,
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                <span style={{ fontWeight: 700 }}>{origConfig.label}</span>
                <span style={{ fontStyle: 'italic', marginLeft: 8 }}>{origConfig.description}</span>
              </div>
            )}

            {/* STEP 4: Our Role */}
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
                      : role === 'claimant_side' || role === 'petitioner_side' || role === 'frep_applicant'
                        ? `For ${origConfig.partyALabel}`
                        : `For ${origConfig.partyBLabel}`
                    }
                  </button>
                ))}
              </div>
              {/* Role description — only once context is set (Phase 1D ghost-box fix) */}
              {(filterPreset || ncCourt) && (
                <div style={{
                  marginTop: 8, padding: '8px 12px',
                  background: ROLE_LIGHT[ncRole]?.bg ?? '#f5f5f5',
                  border: `1px solid ${ROLE_LIGHT[ncRole]?.bdr ?? '#cccccc'}`,
                  borderRadius: 3, fontSize: 12, color: ROLE_LIGHT[ncRole]?.col ?? '#444444',
                  fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic',
                }}>
                  {roleDescription(ncRole)}
                </div>
              )}
            </div>

            {/* Matter details */}
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Matter Name *</label>
              <input
                value={ncName}
                onChange={e => setNcName(e.target.value)}
                placeholder={
                  isCriminal ? 'e.g. FRN v Adeyemi'
                  : ncOrigProc === 'petition_matrimonial' ? 'e.g. Okonkwo v Okonkwo'
                  : ncOrigProc === 'petition_election'    ? 'e.g. Bello v INEC & Ors'
                  : ncOrigProc === 'frep'                 ? 'e.g. Chukwu v AGF & Ors'
                  : 'e.g. Okonkwo v First Bank PLC'
                }
                style={S.inp}
              />
            </div>

            {/* Court field — shown inline only when filter preset (court already selected above otherwise) */}
            {filterPreset && (
              <div style={{ marginBottom: 12 }}>
                <label style={S.label}>Court</label>
                <select value={ncCourt} onChange={e => setNcCourt(e.target.value)} style={{ ...S.sel, padding: '10px 14px' }}>
                  <option value="">Select court…</option>
                  {COURTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Date Commenced</label>
              <input type="date" value={ncDate} onChange={e => setNcDate(e.target.value)} style={S.inp} />
            </div>

            {/* Parties */}
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

            {/* Summary strip — transparent preview (Phase 1C) */}
            {ncName.trim() && (
              <div style={{
                marginBottom: 18, padding: '10px 14px',
                background: 'rgba(6,6,16,0.45)', border: `1px solid rgba(26,26,46,0.6)`,
                borderRadius: 6, fontFamily: "'Times New Roman', Times, serif", fontSize: 11,
                color: T.mute, lineHeight: 1.7, backdropFilter: 'blur(4px)',
              }}>
                <span style={{ color: trackColor.col, fontWeight: 700 }}>
                  {isCriminal ? 'Criminal' : (ncProcLabel || origConfig.label)}
                </span>
                {' · '}
                <span style={{ color: ROLE_LIGHT[ncRole]?.col ?? '#888888', fontWeight: 700 }}>
                  {isCriminal
                    ? COUNSEL_ROLE_LABELS[ncRole]
                    : ncRole === 'claimant_side' || ncRole === 'frep_applicant'
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

        {/* ── Matter list — hidden while form is open ──────────────────────── */}
        {!creating && (
          loadingCases ? (
            <div style={{ borderTop: '1px solid #cccccc' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  padding: '18px 4px', borderBottom: '1px solid #eeeeee',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 15, width: `${55 + i * 12}%`, borderRadius: 3, background: '#f0f0ee', marginBottom: 8 }} />
                    <div style={{ height: 11, width: '35%', borderRadius: 3, background: '#f5f5f3' }} />
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
                // Phase 1F — process-aware suit/petition/charge label
                function suitNoLabelFor(cas: typeof c): string {
                  const op = cas.originating_process ?? '';
                  if (cas.matter_track === 'criminal') return 'Charge No.';
                  if (op.startsWith('petition_') || op === 'election_petition' || op === 'winding_up_petition') return 'Petition No.';
                  return 'Suit No.';
                }
                const track  = c.matter_track ?? 'civil';
                const role   = c.counsel_role;
                const roleL  = role ? ROLE_LIGHT[role] : null;
                const tColor = MATTER_TRACK_COLORS[track] ?? MATTER_TRACK_COLORS['civil'];
                const origProc = c.originating_process ? getOriginatingProcess(c.originating_process) : null;
                return (
                  <div
                    key={c.id}
                    style={{
                      borderBottom: '1px solid #eeeeee',
                      padding: '16px 4px',
                      display: 'flex', alignItems: 'flex-start',
                      gap: 8, background: '#ffffff',
                      transition: 'background .12s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f7f7f5'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ffffff'; }}
                  >
                    {/* Clickable case info */}
                    <button
                      onClick={() => openCase(c)}
                      style={{
                        background: 'transparent', border: 'none',
                        textAlign: 'left', cursor: 'pointer', flex: 1, padding: 0,
                      }}
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
                            {[c.court, c.suitNo ? `${suitNoLabelFor(c)} ${c.suitNo}` : null].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <span style={{
                            fontSize: 9, padding: '2px 7px', borderRadius: 2,
                            fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                            letterSpacing: '.08em', textTransform: 'uppercase' as const,
                            background: tColor.bg, border: `1px solid ${tColor.bdr}`, color: tColor.col,
                          }}>
                            {origProc ? origProc.label : (MATTER_TRACK_LABELS[track] ?? track)}
                          </span>
                          {role && roleL ? (
                            <span style={{
                              fontSize: 9, padding: '2px 7px', borderRadius: 2,
                              fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                              letterSpacing: '.06em', textTransform: 'uppercase' as const,
                              background: roleL.bg, border: `1px solid ${roleL.bdr}`, color: roleL.col,
                            }}>
                              {origProc
                                ? role === 'claimant_side' || role === 'frep_applicant' || role === 'petitioner_side'
                                  ? `For ${origProc.partyALabel}`
                                  : `For ${origProc.partyBLabel}`
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

                    {/* Delete button */}
                    <button
                      onClick={e => handleDelete(e, c.id)}
                      title="Delete matter"
                      style={{
                        background: 'transparent',
                        border: '1px solid #e0b8b8',
                        color: '#c05050',
                        borderRadius: 3,
                        padding: '6px 9px',
                        cursor: 'pointer',
                        fontSize: 13,
                        lineHeight: 1,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
