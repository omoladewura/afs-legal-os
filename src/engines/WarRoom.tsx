/**
 * AFS Advocates — War Room Engine
 *
 * The strategic cockpit. Aggregates every module into one operational view:
 * Case Theory Map · Strategic Posture · Witness Command Map · Evidence Coverage
 * Contradictions · Risk Alerts · Appellate Vulnerabilities · Opponent Strategy
 * Hearing Readiness · Judicial Notes
 *
 * All data is read from IndexedDB and localStorage (mirroring the original
 * app.html implementation). No data is entered here — each panel deep-links
 * to its source module. AI panels (Theory, Appellate, Opponent) persist their
 * output to localStorage keyed by caseId.
 *
 * Props:
 *   activeCase — the loaded Case object from the store
 *
 * setDashTab is obtained from useAppStore directly (no prop drilling).
 */

import { useState, useEffect } from 'react';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { buildRoleLibraryOpts } from '@/utils/roleLibrary';
import { Md, Spinner } from '@/components/common/ui';
import { useAppStore } from '@/state/appStore';
import { loadBlindSpot, loadEvidenceMeta } from '@/storage/helpers';
import type { Case, DashTabId, EvidenceItem } from '@/types';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

interface JudicialNote {
  id:   number;
  text: string;
  ts:   string;
}

interface WitnessEntry {
  name?:               string;
  role?:               string;
  type?:               string;
  side?:               string;
  vulnerabilities?:    string;
  credibilityVulns?:   string;
  preparationStatus?:  string;
  proofingStatus?:     string;
}

interface ContradictionEntry {
  witness?:     string;
  statement1?:  string;
  statement2?:  string;
  exploitation?: string;
  severity?:    string;
}

interface RiskScores {
  _meta?:     unknown;
  _overview?: unknown;
  [key: string]: number | unknown;
}

// ── localStorage helpers (AI output persistence only) ─────────────────────────

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

// ── Case context builder (mirrors buildCaseContext from original) ──────────────

function buildCtx(c: Case): string {
  const intel = c.intelligence_data || {};
  const parts: string[] = [];
  if (c.caseName)      parts.push('Case: ' + c.caseName);
  if (c.court)         parts.push('Court: ' + c.court);
  if (c.suitNo)        parts.push('Suit No: ' + c.suitNo);
  // V2: prefer counsel_role + matter_track; fall back to legacy role
  if (c.counsel_role)  parts.push('Counsel Role: ' + c.counsel_role);
  if (c.matter_track)  parts.push('Matter Track: ' + c.matter_track);
  else if (c.role)     parts.push('Our Role: ' + c.role);
  if (c.dateCommenced) parts.push('Date Commenced: ' + c.dateCommenced);
  const claimants  = (c.claimants  || []).map(p => p.name).filter(Boolean);
  const defendants = (c.defendants || []).map(p => p.name).filter(Boolean);
  if (claimants.length)  parts.push('Claimant(s): '  + claimants.join(', '));
  if (defendants.length) parts.push('Defendant(s): ' + defendants.join(', '));
  if (intel.facts)        parts.push('\nKey Facts:\n'       + intel.facts);
  if (intel.legal_issues) parts.push('\nLegal Issues:\n'    + intel.legal_issues);
  if (intel.disputes)     parts.push('\nKey Disputes:\n'    + intel.disputes);
  if (intel.risks)        parts.push('\nRisks Identified:\n'+ intel.risks);
  return parts.join('\n');
}

// ── PANEL DEFINITIONS ─────────────────────────────────────────────────────────

const PANELS = [
  { id: 'theory',        icon: '◉', label: 'Case Theory'            },
  { id: 'posture',       icon: '⚡', label: 'Strategic Posture'      },
  { id: 'witnesses',     icon: '👁', label: 'Witness Command'        },
  { id: 'evidence',      icon: '📁', label: 'Evidence Coverage'      },
  { id: 'contradictions',icon: '⚔', label: 'Contradictions'         },
  { id: 'risks',         icon: '■', label: 'Risk Alerts'            },
  { id: 'appellate',     icon: '↑', label: 'Appellate Vulnerabilities'},
  { id: 'opponent',      icon: '◈', label: 'Opponent Strategy'      },
  { id: 'hearing',       icon: '⚖', label: 'Hearing Readiness'      },
  { id: 'judicial',      icon: '§', label: 'Judicial Notes'         },
] as const;

type PanelId = (typeof PANELS)[number]['id'];

// ── Risk colour helpers ───────────────────────────────────────────────────────

function riskColor(s: number): string {
  if (s <= 3) return '#e05050';
  if (s <= 6) return '#d09030';
  return '#50c070';
}
function riskLabel(s: number): string {
  if (s <= 3) return 'HIGH RISK';
  if (s <= 6) return 'MODERATE';
  return 'SOUND';
}

// ── Shared panel wrapper ──────────────────────────────────────────────────────

interface PanelWrapProps {
  title:       string;
  icon:        string;
  children:    React.ReactNode;
  onGenerate?: () => void;
  genKey?:     string;
  genLabel?:   string;
  loading?:    boolean;
}

function PanelWrap({ title, icon, children, onGenerate, genLabel = 'AI Generate', loading = false }: PanelWrapProps) {
  return (
    <div style={{ background: '#06060f', border: '1px solid #101020', borderRadius: 6, padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#444444', opacity: .5 }}>{icon}</span>
          <span style={{ fontSize: 13, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, letterSpacing: '.04em' }}>{title}</span>
        </div>
        {onGenerate && (
          <button
            onClick={onGenerate}
            disabled={loading}
            style={{
              background: 'transparent',
              border: `1px solid ${loading ? '#1a1a2a' : '#2a2a4a'}`,
              color: loading ? '#303040' : '#8080c0',
              borderRadius: 4, padding: '4px 13px', fontSize: 10,
              fontFamily: "'Times New Roman', Times, serif", cursor: loading ? 'default' : 'pointer',
              letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading ? <><Spinner size={8} color="#8080c0" /> Generating…</> : genLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────────

function EmptyPanel({ msg, actions }: { msg: string; actions?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <p style={{ fontSize: 12, color: '#303040', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: actions ? 10 : 0 }}>{msg}</p>
      {actions && <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>{actions}</div>}
    </div>
  );
}

function NavBtn({ label, tab, setDashTab }: { label: string; tab: DashTabId; setDashTab: (t: DashTabId) => void }) {
  return (
    <button
      onClick={() => setDashTab(tab)}
      style={{ background: 'transparent', border: '1px solid #1e1e30', color: '#505070', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}
    >
      {label} ›
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function WarRoom({ activeCase }: Props) {
  const { setDashTab } = useAppStore();
  const caseId = activeCase.id;
  const intel  = activeCase.intelligence_data || {};
  const appeal = activeCase.appeal_data || {};

  // ── Cross-module data loaded from IndexedDB ───────────────────────────────
  const [witnesses,      setWitnesses]      = useState<WitnessEntry[]>([]);
  const [cxWitnesses,    setCxWitnesses]    = useState<WitnessEntry[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionEntry[]>([]);
  const [evMeta,         setEvMeta]         = useState<EvidenceItem[]>([]);

  useEffect(() => {
    loadBlindSpot<WitnessEntry[]>(caseId, 'witnesses', []).then(setWitnesses);
  }, [caseId]);

  useEffect(() => {
    loadBlindSpot<WitnessEntry[]>(caseId, 'cx_witnesses', []).then(setCxWitnesses);
  }, [caseId]);

  useEffect(() => {
    loadBlindSpot<ContradictionEntry[]>(caseId, 'cx_contradictions', []).then(setContradictions);
  }, [caseId]);

  useEffect(() => {
    loadEvidenceMeta(caseId).then(setEvMeta);
  }, [caseId]);

  // ── Risk scores remain on localStorage (migrated in Fix #5) ──────────────
  const riskScores = readLS<RiskScores | null>(`risk_${caseId}_scores`, null);

  // ── AI panel state (persisted to localStorage) ────────────────────────────
  const [caseTheory,    setCaseTheory]    = useState<string>(() => readLS(`afs_wr_theory_${caseId}`,   ''));
  const [oppStrategy,   setOppStrategy]   = useState<string>(() => readLS(`afs_wr_opp_${caseId}`,     ''));
  const [appellateVuln, setAppellateVuln] = useState<string>(() => readLS(`afs_wr_appvuln_${caseId}`, ''));
  const [judicialLog,   setJudicialLog]   = useState<JudicialNote[]>(() => readLS(`afs_wr_judicial_${caseId}`, []));
  const [judicialNote,  setJudicialNote]  = useState('');

  // ── Loading state per panel key ───────────────────────────────────────────
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  // ── Active panel ──────────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<PanelId>('theory');

  function setLoad(k: string, v: boolean) { setLoading(p => ({ ...p, [k]: v })); }
  function setErr(k: string, v: string)   { setErrors(p => ({ ...p, [k]: v })); }

  // ── AI generation helper ──────────────────────────────────────────────────
  async function aiGenerate(
    key: string,
    system: string,
    userMsg: string,
    setter: (t: string) => void,
    lsKey: string,
  ) {
    setLoad(key, true);
    setErr(key, '');
    try {
      const text = await callClaude({ system, userMsg, maxTokens: 1800, matter_track: activeCase.matter_track, counsel_role: activeCase.counsel_role, libraryOpts: buildRoleLibraryOpts(activeCase.matter_track, activeCase.counsel_role, userMsg.slice(0, 150)) });
      setter(text);
      writeLS(lsKey, text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setErr(key, msg);
      setter('');
    } finally {
      setLoad(key, false);
    }
  }

  // ── Deadline derived data ─────────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const deadlines = activeCase.deadlines || [];
  const activeDl  = deadlines.filter(d => d.status !== 'Dismissed');
  const overdueDl = activeDl.filter(d => { const dd = new Date(d.date); dd.setHours(0,0,0,0); return dd < today; });
  const urgentDl  = activeDl.filter(d => { const dd = new Date(d.date); dd.setHours(0,0,0,0); const diff = (dd.getTime() - today.getTime()) / 86400000; return diff >= 0 && diff <= 7; });

  // ── Risk dimension helpers ────────────────────────────────────────────────
  const riskDims = riskScores
    ? (Object.entries(riskScores) as [string, unknown][])
        .filter(([k]) => k !== '_meta' && k !== '_overview')
        .map(([k, v]) => [k, v] as [string, number])
        .filter(([, v]) => typeof v === 'number')
    : [];
  const topRisks = [...riskDims].sort((a, b) => a[1] - b[1]).slice(0, 3);

  // ── Evidence categories ───────────────────────────────────────────────────
  const evCategories = [...new Set(evMeta.map(e => e.category || 'Uncategorised'))];
  const issueList    = (intel.legal_issues || '').split('\n').filter(s => s.trim()).slice(0, 6);

  // ── Witness merge (CX + Blind Spots) ─────────────────────────────────────
  const allWitnesses = [
    ...cxWitnesses,
    ...witnesses.filter(w => !cxWitnesses.find(cw => cw.name === w.name)),
  ];

  const ctx = buildCtx(activeCase);
  // Role-aware system prompt — used as base for all WarRoom AI panels
  const roleSystem = buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role);

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: CASE THEORY MAP
  // ─────────────────────────────────────────────────────────────────────────

  function renderTheory() {
    return (
      <PanelWrap
        title="Case Theory Map" icon="◉"
        onGenerate={() => aiGenerate(
          'theory',
          roleSystem,
          `Produce a Case Theory Map for this matter. Structure your analysis as:\n(1) Primary cause of action / defence theory\n(2) Core legal proposition\n(3) Each legal issue — strength (STRONG/MODERATE/WEAK/UNCERTAIN) and reasoning\n(4) Evidence that anchors the theory\n(5) The single most vulnerable point in the theory\n(6) Strategic recommendation\n\nBe specific and role-specific — advice must reflect the counsel role on this matter.\n\n${ctx}`,
          `CASE CONTEXT:\n${ctx}\n\nIntelligence Package:\n${JSON.stringify(intel, null, 2)}\n\nBuild the Case Theory Map.`,
          setCaseTheory,
          `afs_wr_theory_${caseId}`,
        )}
        genKey="theory" genLabel="⟳ Generate Theory Map" loading={loading['theory']}
      >
        {errors['theory'] && (
          <p style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>{errors['theory']}</p>
        )}
        {caseTheory ? (
          <Md text={caseTheory} />
        ) : (
          intel.legal_issues ? (
            <div>
              <p style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 10, fontStyle: 'italic' }}>
                Derived from Intelligence Package — generate for full AI analysis:
              </p>
              {issueList.map((issue, i) => (
                <div key={i} style={{ background: '#ffffff', border: '1px solid #151525', borderRadius: 4, padding: '8px 12px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 9, color: '#5050a0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', flexShrink: 0, paddingTop: 1 }}>Issue {i + 1}</span>
                  <span style={{ fontSize: 12, color: '#b0acaa', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>{issue}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel msg="Run the Intelligence Engine first, then Generate Theory Map." />
          )
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: STRATEGIC POSTURE
  // ─────────────────────────────────────────────────────────────────────────

  function renderPosture() {
    const consolePosKey  = `afs_console_posture_${caseId}`;
    const currentPosture = readLS<string>(consolePosKey, 'Aggressive');
    const POSTURE_ADVICE: Record<string, string> = {
      'Aggressive':          'Press every procedural point. File early. Attack evidence. Force motions. Keep opponent on back foot.',
      'Defensive':           'Protect the record. Minimise concessions. Defer on non-essential procedural battles. Build appellate issues.',
      'Settlement-Seeking':  'Signal reasonableness on peripheral issues. Avoid irreversible steps. Preserve relationship and BATNA.',
      'Appellate':           'Protect every appellate ground. Object to all adverse rulings on record. Prioritise legal issues over facts.',
    };
    const stageGuess = intel.extraction
      ? 'Mid-Trial / Pre-Trial'
      : activeCase.current_stage
        ? activeCase.current_stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        : 'Not yet set';

    const displayRole = activeCase.counsel_role
      ? activeCase.counsel_role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      : (activeCase.role || 'Not set');

    return (
      <PanelWrap title="Strategic Posture" icon="⚡">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {([
            ['Our Role',  displayRole],
            ['Court',     activeCase.court || 'Not set'],
            ['Track',     activeCase.matter_track ? activeCase.matter_track.charAt(0).toUpperCase() + activeCase.matter_track.slice(1) : 'Not set'],
            ['Stage',     stageGuess],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ background: '#ffffff', border: '1px solid #141424', borderRadius: 4, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: '#404060', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 13, color: '#d0ccc0', fontFamily: "'Times New Roman', Times, serif" }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ background: '#090916', border: '1px solid #1e1e3a', borderRadius: 5, padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#505080', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6 }}>
            Current Posture (set in Command Console)
          </div>
          <div style={{ fontSize: 16, color: '#a0a0e0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 6 }}>{currentPosture}</div>
          <div style={{ fontSize: 12, color: '#666666', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>
            {POSTURE_ADVICE[currentPosture] || 'No posture set.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: T.dim, fontFamily: "'Times New Roman', Times, serif", alignSelf: 'center' }}>Switch posture in →</span>
          <NavBtn label="Command Console" tab="console" setDashTab={setDashTab} />
        </div>
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: WITNESS COMMAND MAP
  // ─────────────────────────────────────────────────────────────────────────

  function renderWitnesses() {
    return (
      <PanelWrap title="Witness Command Map" icon="👁">
        {allWitnesses.length === 0 ? (
          <EmptyPanel
            msg="No witnesses entered yet. Add via Blind Spots → Witness Management or Cross-Examination Engine."
            actions={
              <>
                <NavBtn label="Blind Spots" tab="blindspots" setDashTab={setDashTab} />
                <NavBtn label="Cross-Exam" tab="crossexam" setDashTab={setDashTab} />
              </>
            }
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {allWitnesses.map((w, i) => {
              const vuln    = w.vulnerabilities || w.credibilityVulns || '';
              const status  = w.preparationStatus || w.proofingStatus || 'Not Proofed';
              const isReady = /proof|ready|done/i.test(status);
              const isOwn   = /claimant|plaintiff|ours|own|defence/i.test(w.side || w.role || '');
              return (
                <div key={i} style={{ background: '#ffffff', border: `1px solid ${isOwn ? '#1a2a1a' : '#2a1a1a'}`, borderRadius: 5, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#c8c4b8', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {w.name || `Witness ${i + 1}`}
                    </span>
                    <span style={{ fontSize: 8, color: isOwn ? '#50a060' : '#c05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase' }}>
                      {isOwn ? 'OURS' : 'OPP'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#505060', fontFamily: "'Times New Roman', Times, serif", marginBottom: 4 }}>{w.role || w.type || 'Witness'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isReady ? '#50c070' : '#e09030', flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 10, color: isReady ? '#50c070' : '#d09030', fontFamily: "'Times New Roman', Times, serif" }}>{status}</span>
                  </div>
                  {vuln && (
                    <div style={{ fontSize: 10, color: '#906050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, borderTop: '1px solid #151520', paddingTop: 6, marginTop: 4 }}>
                      {vuln.slice(0, 80)}{vuln.length > 80 ? '…' : ''}
                    </div>
                  )}
                  <button
                    onClick={() => setDashTab('crossexam')}
                    style={{ marginTop: 8, background: 'transparent', border: '1px solid #1e1e30', color: '#404060', borderRadius: 3, padding: '3px 9px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', width: '100%' }}
                  >
                    CX Prep ›
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: EVIDENCE COVERAGE
  // ─────────────────────────────────────────────────────────────────────────

  function renderEvidence() {
    return (
      <PanelWrap title="Evidence Coverage Board" icon="📁">
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif" }}>Evidence Vault:</span>
            <span style={{ fontSize: 13, color: '#111111', fontFamily: "'Times New Roman', Times, serif" }}>
              {evMeta.length} document{evMeta.length !== 1 ? 's' : ''}
            </span>
            {evMeta.length > 0 && (
              <button onClick={() => setDashTab('evidence')} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #1e1e30', color: '#404060', borderRadius: 3, padding: '3px 9px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
                Open Vault ›
              </button>
            )}
          </div>
          {evCategories.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {evCategories.map((cat, i) => (
                <span key={i} style={{ fontSize: 10, color: '#50a070', fontFamily: "'Times New Roman', Times, serif", border: '1px solid #1a3a2a', background: '#050f0a', borderRadius: 3, padding: '3px 9px' }}>{cat}</span>
              ))}
            </div>
          )}
        </div>

        {issueList.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: '#404060', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Issue Coverage Matrix</div>
            {issueList.map((issue, i) => {
              const words   = issue.toLowerCase().split(' ').filter(w => w.length > 4);
              const covered = evMeta.some(ev => {
                const txt = ((ev.title || '') + (ev.category || '') + (ev.notes || '')).toLowerCase();
                return words.some(w => txt.includes(w));
              });
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 10px', background: '#08080f', border: '1px solid #0e0e1e', borderRadius: 4, marginBottom: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: covered ? '#50c070' : '#e05050', flexShrink: 0, marginTop: 3, display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#b0acaa', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, flex: 1 }}>{issue}</span>
                  <span style={{ fontSize: 9, color: covered ? '#50a060' : '#a04040', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0, letterSpacing: '.08em' }}>
                    {covered ? 'COVERED' : 'GAP'}
                  </span>
                </div>
              );
            })}
            {intel.extraction?.gaps_identified && intel.extraction.gaps_identified.length > 0 && (
              <div style={{ marginTop: 12, background: '#120808', border: '1px solid #2a1010', borderRadius: 4, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: '#803030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 5 }}>Intelligence Engine — Gaps Identified</div>
                <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                  {intel.extraction.gaps_identified.map((g, i) => (
                    <li key={i} style={{ fontSize: 11, color: '#a06060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 3 }}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <EmptyPanel msg="Run the Intelligence Engine to populate issue coverage analysis." />
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: CONTRADICTIONS
  // ─────────────────────────────────────────────────────────────────────────

  function renderContradictions() {
    return (
      <PanelWrap title="Contradiction Tracker" icon="⚔">
        {contradictions.length === 0 ? (
          <EmptyPanel
            msg="No contradictions logged yet. Add via Cross-Examination → Contradiction Mapper."
            actions={<NavBtn label="Cross-Exam Engine" tab="crossexam" setDashTab={setDashTab} />}
          />
        ) : (
          <div>
            <div style={{ fontSize: 10, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>
              {contradictions.length} contradiction{contradictions.length !== 1 ? 's' : ''} mapped
            </div>
            {contradictions.map((c, i) => (
              <div key={i} style={{ background: '#0f0808', border: '1px solid #2a1515', borderRadius: 5, padding: '10px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: '#903030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', border: '1px solid #2a1010', padding: '2px 7px', borderRadius: 2 }}>
                    Contradiction {i + 1}
                  </span>
                  {c.witness && <span style={{ fontSize: 10, color: '#c08060', fontFamily: "'Times New Roman', Times, serif" }}>— {c.witness}</span>}
                  {c.severity && (
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: c.severity === 'High' ? '#e05050' : c.severity === 'Medium' ? '#d09030' : '#808080', fontFamily: "'Times New Roman', Times, serif", textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      {c.severity}
                    </span>
                  )}
                </div>
                {c.statement1   && <div style={{ fontSize: 11, color: '#906060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, marginBottom: 4 }}>Statement: {c.statement1}</div>}
                {c.statement2   && <div style={{ fontSize: 11, color: '#609060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, marginBottom: 4 }}>Contradicted by: {c.statement2}</div>}
                {c.exploitation && <div style={{ fontSize: 11, color: '#808060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, fontStyle: 'italic' }}>Exploit: {c.exploitation}</div>}
              </div>
            ))}
          </div>
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: RISK ALERTS
  // ─────────────────────────────────────────────────────────────────────────

  function renderRisks() {
    const allClear = overdueDl.length === 0 && urgentDl.length === 0 && topRisks.length === 0;
    return (
      <PanelWrap title="Risk Alerts" icon="■">
        {overdueDl.length > 0 && (
          <div style={{ background: '#130505', border: '1px solid #3a1010', borderRadius: 5, padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: '#e05050', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              ⚠ OVERDUE DEADLINES ({overdueDl.length})
            </div>
            {overdueDl.slice(0, 3).map((d, i) => (
              <div key={i} style={{ fontSize: 11, color: '#d07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 3 }}>
                • {d.label} — {new Date(d.date).toLocaleDateString('en-GB')}
              </div>
            ))}
            <button onClick={() => setDashTab('docket')} style={{ marginTop: 8, background: 'transparent', border: '1px solid #2a1010', color: '#804040', borderRadius: 3, padding: '3px 9px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
              Manage Deadlines ›
            </button>
          </div>
        )}

        {urgentDl.length > 0 && (
          <div style={{ background: '#120a03', border: '1px solid #3a2010', borderRadius: 5, padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: '#d09030', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              ⏱ URGENT (within 7 days) ({urgentDl.length})
            </div>
            {urgentDl.slice(0, 3).map((d, i) => (
              <div key={i} style={{ fontSize: 11, color: '#c0a060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 3 }}>
                • {d.label} — {new Date(d.date).toLocaleDateString('en-GB')}
              </div>
            ))}
          </div>
        )}

        {topRisks.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: '#404060', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Top Risk Dimensions (from Risk Analytics)
            </div>
            {topRisks.map(([key, score], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#ffffff', border: '1px solid #101020', borderRadius: 4, marginBottom: 6 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: riskColor(score), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#fff', fontWeight: 700, fontFamily: "'Times New Roman', Times, serif" }}>{score}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#c0bcb4', fontFamily: "'Times New Roman', Times, serif", textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 9, color: riskColor(score), fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase' }}>{riskLabel(score)}</div>
                </div>
                <button onClick={() => setDashTab('risk')} style={{ background: 'transparent', border: '1px solid #1e1e30', color: '#404060', borderRadius: 3, padding: '3px 8px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>→</button>
              </div>
            ))}
          </div>
        ) : !allClear ? null : null}

        {allClear && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <span style={{ fontSize: 12, color: '#30c060', fontFamily: "'Times New Roman', Times, serif" }}>✓ No immediate risk alerts</span>
          </div>
        )}

        {topRisks.length === 0 && !allClear && (
          <p style={{ fontSize: 12, color: '#303040', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>No risk scores yet. Run Risk Analytics to populate this panel.</p>
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: APPELLATE VULNERABILITIES
  // ─────────────────────────────────────────────────────────────────────────

  function renderAppellate() {
    return (
      <PanelWrap
        title="Appellate Vulnerability Tracker" icon="↑"
        onGenerate={() => aiGenerate(
          'appvuln',
          roleSystem,
          `Identify every live appellate issue in this case from the perspective of the counsel role.\n\nFor each appellate issue:\n(1) The issue\n(2) The ground of appeal it generates\n(3) Survivability rating at the Court of Appeal (High/Medium/Low)\n(4) What must be done NOW to preserve the point\n\nCover: errors of law, wrongly admitted/excluded evidence, jurisdictional points, constitutional issues, procedural violations.\n\nCASE CONTEXT:\n${ctx}\n\nAppeal data: ${JSON.stringify(appeal, null, 2)}\n\nIdentify all appellate vulnerabilities from this counsel's position.`,
          setAppellateVuln,
          `afs_wr_appvuln_${caseId}`,
        )}
        genKey="appvuln" genLabel="⟳ Generate Appellate Analysis" loading={loading['appvuln']}
      >
        {errors['appvuln'] && <p style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>{errors['appvuln']}</p>}
        {appellateVuln ? (
          <Md text={appellateVuln} />
        ) : (
          <EmptyPanel msg="Generate an AI appellate vulnerability analysis, or navigate to the Appeal Engine for full appellate intelligence." />
        )}
        <button onClick={() => setDashTab('appeal')} style={{ marginTop: 10, background: 'transparent', border: '1px solid #1e1e30', color: '#404060', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
          Appeal Engine ›
        </button>
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: OPPONENT STRATEGY
  // ─────────────────────────────────────────────────────────────────────────

  function renderOpponent() {
    return (
      <PanelWrap
        title="Opponent Strategy Board" icon="◈"
        onGenerate={() => aiGenerate(
          'opp',
          roleSystem,
          `Analyse the opposing side's most likely litigation strategy on this matter.\n\nCover:\n(1) Their strongest 3 arguments against our position\n(2) Their most likely procedural moves in the next 60 days\n(3) Their evidential strategy — what they will try to admit and what they will challenge\n(4) Their vulnerabilities and the single most damaging thing we can do to their case now\n(5) Recommended counter-posture from our counsel role\n\nCASE CONTEXT:\n${ctx}\n\nBuild the opponent strategy analysis from our side's perspective.`,
          setOppStrategy,
          `afs_wr_opp_${caseId}`,
        )}
        genKey="opp" genLabel="⟳ Analyse Opponent" loading={loading['opp']}
      >
        {errors['opp'] && <p style={{ fontSize: 12, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>{errors['opp']}</p>}
        {oppStrategy ? (
          <Md text={oppStrategy} />
        ) : (
          <EmptyPanel msg="Generate an AI analysis of the opponent's likely strategy, strongest arguments, and recommended counter-posture." />
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: HEARING READINESS
  // ─────────────────────────────────────────────────────────────────────────

  function renderHearing() {
    // Next hearing from docket entries
    const entries = activeCase.recent_entries || [];
    const futureHearings = entries
      .filter(e => {
        if (!e.nextAdjournedDate) return false;
        const d = new Date(e.nextAdjournedDate); d.setHours(0, 0, 0, 0);
        return d >= today;
      })
      .sort((a, b) => new Date(a.nextAdjournedDate).getTime() - new Date(b.nextAdjournedDate).getTime());
    const nextHearing = futureHearings[0];

    const savedBriefMe = readLS<string | null>(`afs_bm_${caseId}`, null);
    const savedArgs    = readLS<unknown[]>(`afs_ab_${caseId}`, []);
    const aveLibrary   = readLS<unknown[]>(`ave_${caseId}_library`, []);

    const checks = [
      { label: 'Witnesses confirmed and proofed',  done: allWitnesses.some(w => /proof|ready/i.test(w.preparationStatus || '')) },
      { label: 'Documents in Evidence Vault',      done: evMeta.length > 0 },
      { label: 'Arguments prepared (Argument Builder)', done: savedArgs.length > 0 },
      { label: 'Deadlines reviewed',               done: activeDl.length > 0 },
      { label: 'Authorities validated',            done: aveLibrary.length > 0 },
      { label: 'Risk assessment complete',         done: !!riskScores },
      { label: 'Brief Me briefing generated',      done: !!savedBriefMe },
    ];
    const doneCount = checks.filter(c => c.done).length;

    return (
      <PanelWrap title="Hearing Readiness Board" icon="⚖">
        {nextHearing ? (
          <div style={{ background: '#080814', border: '1px solid #1a1a2a', borderRadius: 5, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: '#505080', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>Next Hearing</div>
            <div style={{ fontSize: 14, color: '#a0a0d0', fontFamily: "'Times New Roman', Times, serif" }}>{nextHearing.docTitle || 'Hearing'}</div>
            <div style={{ fontSize: 11, color: '#606080', fontFamily: "'Times New Roman', Times, serif", marginTop: 2 }}>
              {new Date(nextHearing.nextAdjournedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #141420', borderRadius: 5, padding: '8px 14px', marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: '#303040', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>No upcoming hearings in docket</span>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase' }}>Readiness</span>
            <span style={{ fontSize: 12, color: doneCount === checks.length ? '#50c070' : doneCount > 4 ? '#d09030' : '#e05050', fontFamily: "'Times New Roman', Times, serif" }}>
              {doneCount}/{checks.length}
            </span>
          </div>
          {checks.map((ch, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', borderBottom: '1px solid #0e0e18' }}>
              <span style={{ fontSize: 13, color: ch.done ? '#50c070' : '#303040', flexShrink: 0 }}>{ch.done ? '✓' : '○'}</span>
              <span style={{ fontSize: 11, color: ch.done ? '#708060' : '#505060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.4 }}>{ch.label}</span>
            </div>
          ))}
        </div>
        <button onClick={() => setDashTab('briefme')} style={{ marginTop: 8, background: 'transparent', border: '1px solid #1e1e30', color: '#505070', borderRadius: 4, padding: '5px 14px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', width: '100%' }}>
          Generate Brief Me Briefing ›
        </button>
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL: JUDICIAL NOTES
  // ─────────────────────────────────────────────────────────────────────────

  function renderJudicial() {
    function addNote() {
      if (!judicialNote.trim()) return;
      const note: JudicialNote = { id: Date.now(), text: judicialNote.trim(), ts: new Date().toISOString() };
      const updated = [...judicialLog, note];
      setJudicialLog(updated);
      setJudicialNote('');
      writeLS(`afs_wr_judicial_${caseId}`, updated);
    }
    function delNote(id: number) {
      const updated = judicialLog.filter(n => n.id !== id);
      setJudicialLog(updated);
      writeLS(`afs_wr_judicial_${caseId}`, updated);
    }
    return (
      <PanelWrap title="Judicial Notes" icon="§">
        <p style={{ fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 12, fontStyle: 'italic' }}>
          Record the court's rulings, judicial temperament, admissions, and directions. These feed appellate analysis.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <textarea
            value={judicialNote}
            onChange={e => setJudicialNote(e.target.value)}
            placeholder="e.g. Court refused to admit Exhibit D — ground: secondary evidence. Ruled against us on jurisdiction but reserved ruling for record. Judge appeared skeptical of PW1 testimony."
            rows={3}
            style={{ flex: 1, background: '#070710', border: '1px solid #141424', borderRadius: 4, color: '#c0bcb4', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", padding: '8px 10px', resize: 'vertical', outline: 'none', lineHeight: 1.65 }}
          />
          <button onClick={addNote} style={{ background: 'transparent', border: '1px solid #2a2a4a', color: '#6060a0', borderRadius: 4, padding: '8px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', alignSelf: 'flex-start', flexShrink: 0 }}>
            Add
          </button>
        </div>
        {judicialLog.length === 0 ? (
          <p style={{ fontSize: 12, color: '#252535', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>No judicial notes yet.</p>
        ) : (
          <div>
            {[...judicialLog].reverse().map(n => (
              <div key={n.id} style={{ background: '#ffffff', border: '1px solid #101020', borderRadius: 4, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#b0acaa', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{n.text}</div>
                  <div style={{ fontSize: 9, color: '#252535', fontFamily: 'monospace', marginTop: 5 }}>{new Date(n.ts).toLocaleString('en-GB')}</div>
                </div>
                <button onClick={() => delNote(n.id)} style={{ background: 'transparent', border: 'none', color: '#303040', cursor: 'pointer', fontSize: 13, flexShrink: 0, padding: '0 4px' }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </PanelWrap>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL ROUTER
  // ─────────────────────────────────────────────────────────────────────────

  const PANEL_RENDERERS: Record<PanelId, () => React.ReactElement> = {
    theory:         renderTheory,
    posture:        renderPosture,
    witnesses:      renderWitnesses,
    evidence:       renderEvidence,
    contradictions: renderContradictions,
    risks:          renderRisks,
    appellate:      renderAppellate,
    opponent:       renderOpponent,
    hearing:        renderHearing,
    judicial:       renderJudicial,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '0 0 32px 0', animation: 'fadeUp .3s ease' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 14, opacity: .4 }}>⬛</span>
          <h2 style={{ margin: 0, fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 400, letterSpacing: '.04em' }}>War Room</h2>
          <span style={{ fontSize: 9, color: '#303038', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.18em', textTransform: 'uppercase', border: '1px solid #cccccc', padding: '2px 8px', borderRadius: 2 }}>
            Strategic Cockpit
          </span>
        </div>
        <p style={{ margin: '0 0 0 24px', fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif" }}>
          Full operational picture — aggregated from all modules. Update data in each module; this view refreshes automatically.
        </p>
      </div>

      {/* ── Panel navigation ── */}
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', marginBottom: 20, border: '1px solid #101018', borderRadius: 5, overflow: 'hidden' }}>
        {PANELS.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePanel(p.id)}
            style={{
              background:    activePanel === p.id ? '#e8e8e8' : 'transparent',
              border:        'none',
              borderRight:   '1px solid #101018',
              color:         activePanel === p.id ? T.goldL : '#404050',
              padding:       '8px 14px',
              fontSize:      10,
              fontFamily:    "'Times New Roman', Times, serif",
              cursor:        'pointer',
              letterSpacing: '.06em',
              display:       'flex',
              alignItems:    'center',
              gap:           5,
              borderBottom:  activePanel === p.id ? `2px solid ${T.gold}` : '2px solid transparent',
              transition:    'all .12s',
              whiteSpace:    'nowrap',
            }}
          >
            <span style={{ fontSize: 9 }}>{p.icon}</span> {p.label}
          </button>
        ))}
      </div>

      {/* ── Active panel ── */}
      {PANEL_RENDERERS[activePanel]?.()}
    </div>
  );
}
