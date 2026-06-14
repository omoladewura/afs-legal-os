/**
 * AFS Advocates — Command Console
 * Phase 2 — Full implementation
 *
 * Port of CommandConsole from app.html (17_engine_command_console.txt).
 *
 * Natural-language OS terminal for litigation commands.
 * Two-step AI pipeline:
 *   1. Fast routing call  → classifies command to one of 11 engine categories
 *   2. Full execution call → answers with a specialised system prompt for that category
 *
 * Features:
 *   - Strategic posture switcher (Aggressive / Defensive / Settlement-Seeking / Appellate)
 *   - Quick command palette (12 pre-built commands)
 *   - Keyboard history navigation (↑ ↓)
 *   - Per-case log persisted to IndexedDB
 *   - "Open Module →" button routes to the relevant dashboard tab
 *   - Clear log
 *
 * All data isolated per caseId.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Case, DashTabId }                      from '@/types';
import { T }                                          from '@/constants/tokens';
import { callClaude }                                from '@/services/api';
import { useIntelligence }                           from '@/hooks/useIntelligence';
import { loadBlindSpot, saveBlindSpot }               from '@/storage/helpers';
import { buildCaseContext }                           from '@/utils';
import { Md }                                         from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Posture = 'Aggressive' | 'Defensive' | 'Settlement-Seeking' | 'Appellate';
type RouteKey =
  | 'strategy_rebuild'
  | 'witness_analysis'
  | 'cross_exam'
  | 'evidence_analysis'
  | 'argument_build'
  | 'document_generate'
  | 'compliance_check'
  | 'risk_assessment'
  | 'appeal_analysis'
  | 'settlement'
  | 'general';

interface HistoryEntry {
  role:        'user' | 'assistant' | 'system' | 'error';
  content:     string;
  ts:          number;
  route?:      string;
  routeColor?: string;
  routeTab?:   DashTabId | null;
}

interface Props {
  activeCase: Case;
  setDashTab?: (tab: DashTabId) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const POSTURES: Posture[] = ['Aggressive', 'Defensive', 'Settlement-Seeking', 'Appellate'];

const POSTURE_COLORS: Record<Posture, { bg: string; light: string }> = {
  'Aggressive':        { bg: '#2a0808', light: '#e05050' },
  'Defensive':         { bg: '#081428', light: '#5090d0' },
  'Settlement-Seeking':{ bg: '#081a0e', light: '#50c070' },
  'Appellate':         { bg: '#140828', light: '#9060e0' },
};

const ROUTE_MAP: Record<RouteKey, { label: string; tab: DashTabId | null; color: string }> = {
  strategy_rebuild:  { label: 'Strategy Engine',          tab: 'intelligence', color: '#e0a030' },
  witness_analysis:  { label: 'Cross-Examination Engine', tab: 'crossexam',   color: '#e05090' },
  cross_exam:        { label: 'Cross-Examination Engine', tab: 'crossexam',   color: '#e05090' },
  evidence_analysis: { label: 'Evidence Vault',           tab: 'evidence',    color: '#40b0a0' },
  argument_build:    { label: 'Argument Builder',         tab: 'builder',     color: '#a050d0' },
  document_generate: { label: 'Document Generator',       tab: null,          color: '#d09030' },
  compliance_check:  { label: 'Compliance Engine',        tab: 'compliance',  color: '#50a0e0' },
  risk_assessment:   { label: 'Risk Analytics',           tab: 'risk',        color: '#e05050' },
  appeal_analysis:   { label: 'Appeal Engine',            tab: 'appeal',      color: '#60c0a0' },
  settlement:        { label: 'Blind Spots — BATNA',      tab: 'blindspots',  color: '#80d060' },
  general:           { label: 'General Intelligence',     tab: null,          color: '#b0a080' },
};

const QUICK_CMDS: Array<{ label: string; cat: string }> = [
  { label: 'Rebuild defence theory around alibi',                              cat: 'strategy'   },
  { label: 'What are my three biggest risks right now?',                       cat: 'risk'       },
  { label: 'Generate hostile cross-examination for PW2',                       cat: 'crossexam'  },
  { label: 'Reassess admissibility of electronic evidence under Section 84',   cat: 'evidence'   },
  { label: 'Has the limitation period expired?',                               cat: 'compliance' },
  { label: 'Rebuild argument around jurisdiction only',                        cat: 'argument'   },
  { label: 'Prepare emergency stay of execution application',                  cat: 'document'   },
  { label: 'Update case theory with new witness statement',                    cat: 'strategy'   },
  { label: 'Identify all appellate issues so far',                             cat: 'appeal'     },
  { label: 'Analyse prosecution evidence weaknesses',                          cat: 'evidence'   },
  { label: 'What is our BATNA right now?',                                     cat: 'settlement' },
  { label: 'Generate no-case submission analysis',                             cat: 'document'   },
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS — one per route category
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(routeKey: RouteKey, posture: Posture, ctx: string): string {
  const base: Record<RouteKey, string> = {
    strategy_rebuild:
      `You are the most experienced litigation strategist in Nigeria. Your role is to rebuild and recalibrate the client's litigation theory based on the practitioner's command. Think: what is the primary narrative, what evidence supports it, what are the remaining gaps, what procedural steps are required. Be bold, specific, and actionable. Current strategic posture: ${posture}.`,
    witness_analysis:
      `You are Nigeria's leading trial counsel specialising in witness management and cross-examination. Analyse the witness situation, identify vulnerabilities, prior inconsistencies, credibility attacks, and suggest the precise cross-examination strategy. Current strategic posture: ${posture}.`,
    cross_exam:
      `You are a senior Nigerian trial advocate. Generate a full, adversarial, sequenced cross-examination strategy. Identify the witness's weaknesses, build the impeachment framework, and produce ordered question lines designed to destroy credibility and extract admissions. Current strategic posture: ${posture}.`,
    evidence_analysis:
      `You are a Nigerian evidence law specialist. Analyse the evidence situation: admissibility, weight, authenticity, Section 84 compliance for electronic evidence, hearsay exceptions, and strategic value. Flag vulnerabilities and attack lines. Current strategic posture: ${posture}.`,
    argument_build:
      `You are a master of Nigerian civil and criminal procedure and legal argumentation. Build the strongest possible legal argument on the identified issue, structured by legal principle, procedural basis, burden allocation, and authority requirements. Current strategic posture: ${posture}.`,
    document_generate:
      `You are an expert Nigerian legal drafter. Generate the requested legal document or application in full, following Nigerian court rules, practice directions, and drafting conventions. Structure it court-ready: title, parties, grounds, reliefs, verification. Current strategic posture: ${posture}.`,
    compliance_check:
      `You are a Nigerian procedural law expert covering the High Court (Civil Procedure) Rules, the ACJA, and all state-level equivalents. Check every limitation period, pre-action notice, filing deadline, and procedural step. Flag any breach or approaching deadline with urgency. Current strategic posture: ${posture}.`,
    risk_assessment:
      `You are a litigation risk analyst specialising in Nigerian courts. Assess the current risk profile across all dimensions: procedural, evidential, witness vulnerability, jurisdictional, burden satisfaction, settlement advisability, appeal survivability. Be direct and ranked. Current strategic posture: ${posture}.`,
    appeal_analysis:
      `You are a leading Nigerian appellate advocate. Identify and analyse all appellate issues: errors of law, procedural errors, wrong admission/rejection of evidence, constitutional violations, and jurisdictional points. Assess survivability at the Court of Appeal and Supreme Court. Current strategic posture: ${posture}.`,
    settlement:
      `You are an experienced Nigerian dispute resolution counsel. Analyse the settlement landscape: BATNA, WATNA, realistic settlement range, negotiation leverage, timing, and recommended posture. Be frank and strategic. Current strategic posture: ${posture}.`,
    general:
      `You are Senior Counsel at AFS Advocates — an expert in Nigerian law and litigation strategy across all courts and practice areas. Answer the practitioner's command with precision, drawing on Nigerian statutes, rules of court, and case law. Be specific, structured, and actionable. Current strategic posture: ${posture}.`,
  };

  return base[routeKey] + `\n\nFULL CASE CONTEXT:\n${ctx}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

interface ConsoleBlob { history: HistoryEntry[]; posture: Posture; }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function CommandConsole({ activeCase, setDashTab }: Props) {
  const caseId = activeCase.id;
  const { fullContext } = useIntelligence(activeCase);

  const [cmd,          setCmd]          = useState('');
  const [history,      setHistory]      = useState<HistoryEntry[]>([]);
  const [histIdx,      setHistIdx]      = useState(-1);
  const [loading,      setLoading]      = useState(false);
  const [posture,      setPosture]      = useState<Posture>('Aggressive');
  const [paletteOpen,  setPaletteOpen]  = useState(false);

  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Re-load when case changes
  useEffect(() => {
    loadBlindSpot<ConsoleBlob>(caseId, 'console', { history: [], posture: 'Aggressive' })
      .then(d => {
        setHistory(d.history ?? []);
        setPosture((d.posture && POSTURES.includes(d.posture)) ? d.posture : 'Aggressive');
      });
    setCmd('');
    setHistIdx(-1);
  }, [caseId]);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // ── Posture switcher ────────────────────────────────────────────────────────

  const switchPosture = useCallback((p: Posture) => {
    setPosture(p);
    // posture also saved when the notice is appended to history below
    const notice: HistoryEntry = {
      role:    'system',
      content: `Strategic posture switched to: ${p}. All subsequent commands will adapt reasoning to the ${p} posture.`,
      ts:      Date.now(),
    };
    setHistory(prev => {
      const next = [...prev, notice];
      saveBlindSpot(caseId, 'console', { history: next, posture: p });
      return next;
    });
  }, [caseId]);

  // ── Clear log ───────────────────────────────────────────────────────────────

  function clearLog() {
    setHistory([]);
    saveBlindSpot(caseId, 'console', { history: [], posture });
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    const userCmds = history.filter(h => h.role === 'user');
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = histIdx + 1;
      if (idx < userCmds.length) {
        setHistIdx(idx);
        setCmd(userCmds[userCmds.length - 1 - idx].content);
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = histIdx - 1;
      if (idx < 0) { setHistIdx(-1); setCmd(''); }
      else { setHistIdx(idx); setCmd(userCmds[userCmds.length - 1 - idx].content); }
    }
  }

  // ── Send command (two-step pipeline) ───────────────────────────────────────

  async function handleSend() {
    const command = cmd.trim();
    if (!command || loading) return;

    setCmd('');
    setHistIdx(-1);
    setLoading(true);

    const userEntry: HistoryEntry = { role: 'user', content: command, ts: Date.now() };
    const withUser = [...history, userEntry];
    setHistory(withUser);

    const ctx = buildCaseContext(activeCase);

    try {
      // ── Step 1: Route ─────────────────────────────────────────────────────
      const rawKey = (await callClaude({
        system:
          'You are a command router for a Nigerian litigation intelligence system. ' +
          'Classify the user command into EXACTLY ONE of these categories ' +
          '(return ONLY the category key, nothing else):\n' +
          'strategy_rebuild | witness_analysis | cross_exam | evidence_analysis | ' +
          'argument_build | document_generate | compliance_check | risk_assessment | ' +
          'appeal_analysis | settlement | general' + fullContext,
        messages: [{
          role:    'user',
          content: `Case context:\n${ctx}\n\nUser command: "${command}"\n\nReturn ONLY the category key.`,
        }],
        maxTokens: 80,
      })).trim().toLowerCase().replace(/[^a-z_]/g, '');

      const routeKey: RouteKey = (rawKey in ROUTE_MAP)
        ? rawKey as RouteKey
        : 'general';

      const route = ROUTE_MAP[routeKey];

      // ── Step 2: Execute ───────────────────────────────────────────────────
      const aiText = await callClaude({
        system:    buildSystemPrompt(routeKey, posture, ctx) + fullContext,
        userMsg:   command,
        maxTokens: 2000,
      });

      const aiEntry: HistoryEntry = {
        role:       'assistant',
        content:    aiText,
        ts:         Date.now(),
        route:      route.label,
        routeColor: route.color,
        routeTab:   route.tab,
      };

      const finalHist = [...withUser, aiEntry];
      setHistory(finalHist);
      saveBlindSpot(caseId, 'console', { history: finalHist, posture });

    } catch (err) {
      const errEntry: HistoryEntry = {
        role:    'error',
        content: 'Command failed: ' + (err as Error).message,
        ts:      Date.now(),
      };
      const finalHist = [...withUser, errEntry];
      setHistory(finalHist);
      saveBlindSpot(caseId, 'console', { history: finalHist, posture });
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const currentPostureColors = POSTURE_COLORS[posture];

  return (
    <div style={{ paddingBottom: 32, animation: 'fadeUp .3s ease' }}>

      {/* ── Header ── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   20,
        flexWrap:       'wrap',
        gap:            12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize:   13,
              color:      '#404050',
              fontFamily: 'monospace',
              letterSpacing: '.12em',
            }}>
              {'>'}_
            </span>
            <h2 style={{
              margin:        0,
              fontSize:      22,
              color:         T.goldL,
              fontFamily:    "'Times New Roman', Times, serif",
              fontWeight:    400,
              letterSpacing: '.04em',
            }}>
              Command Console
            </h2>
            <span style={{
              fontSize:      9,
              color:         '#252530',
              fontFamily:    "'Times New Roman', Times, serif",
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              border:        '1px solid #1a1a28',
              padding:       '2px 8px',
              borderRadius:  2,
            }}>
              Litigation OS Terminal
            </span>
          </div>
          <p style={{
            margin:     '4px 0 0 23px',
            fontSize:   12,
            color:      T.dim,
            fontFamily: "'Times New Roman', Times, serif",
          }}>
            Issue any litigation command. The system routes it to the correct engine with full
            case awareness.
          </p>
        </div>

        <button
          onClick={clearLog}
          style={{
            background:    'transparent',
            border:        '1px solid #2a1a1a',
            color:         '#604040',
            borderRadius:  4,
            padding:       '5px 12px',
            fontSize:      10,
            fontFamily:    "'Times New Roman', Times, serif",
            cursor:        'pointer',
            letterSpacing: '.06em',
            transition:    'border-color .15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#5a2a2a')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a1a1a')}
        >
          ↺ Clear Log
        </button>
      </div>

      {/* ── Posture Switcher ── */}
      <div style={{
        background:   '#08080f',
        border:       `1px solid ${currentPostureColors.bg}`,
        borderLeft:   `3px solid ${currentPostureColors.light}`,
        borderRadius: '0 6px 6px 0',
        padding:      '12px 16px',
        marginBottom: 14,
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        flexWrap:     'wrap',
      }}>
        <span style={{
          fontSize:      10,
          color:         T.dim,
          fontFamily:    "'Times New Roman', Times, serif",
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          flexShrink:    0,
        }}>
          Strategic Posture
        </span>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {POSTURES.map(p => {
            const pc = POSTURE_COLORS[p];
            const active = posture === p;
            return (
              <button
                key={p}
                onClick={() => switchPosture(p)}
                style={{
                  background:    active ? pc.bg      : 'transparent',
                  border:        `1px solid ${active ? pc.light : '#cccccc'}`,
                  color:         active ? pc.light   : '#505060',
                  borderRadius:  4,
                  padding:       '4px 14px',
                  fontSize:      10,
                  fontFamily:    "'Times New Roman', Times, serif",
                  cursor:        'pointer',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  fontWeight:    600,
                  transition:    'all .15s',
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
        <span style={{
          marginLeft: 'auto',
          fontSize:   10,
          color:      currentPostureColors.light,
          fontFamily: "'Times New Roman', Times, serif",
          fontStyle:  'italic',
          opacity:    0.7,
        }}>
          All commands adapt to {posture} posture
        </span>
      </div>

      {/* ── Quick Command Palette ── */}
      <div style={{ marginBottom: 14 }}>
        <button
          onClick={() => setPaletteOpen(o => !o)}
          style={{
            background:    'transparent',
            border:        '1px solid #1a1a28',
            color:         T.mute,
            borderRadius:  4,
            padding:       '5px 14px',
            fontSize:      10,
            fontFamily:    "'Times New Roman', Times, serif",
            cursor:        'pointer',
            letterSpacing: '.08em',
            display:       'flex',
            alignItems:    'center',
            gap:           6,
          }}
        >
          <span style={{ fontSize: 8 }}>▶</span>
          Quick Commands {paletteOpen ? '▲' : '▼'}
        </button>

        {paletteOpen && (
          <div style={{
            background:   '#06060e',
            border:       '1px solid #141420',
            borderRadius: 6,
            padding:      '14px 16px',
            marginTop:    8,
            display:      'flex',
            flexWrap:     'wrap',
            gap:          7,
            animation:    'fadeUp .15s ease',
          }}>
            {QUICK_CMDS.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  setCmd(q.label);
                  setPaletteOpen(false);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                style={{
                  background:    '#ffffff',
                  border:        '1px solid #1e1e30',
                  color:         T.mute,
                  borderRadius:  4,
                  padding:       '5px 11px',
                  fontSize:      10,
                  fontFamily:    "'Times New Roman', Times, serif",
                  cursor:        'pointer',
                  letterSpacing: '.04em',
                  transition:    'border-color .12s, color .12s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#3a3a60';
                  (e.currentTarget as HTMLElement).style.color = T.text;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#1e1e30';
                  (e.currentTarget as HTMLElement).style.color = T.mute;
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Command Log ── */}
      <div style={{
        background:  '#03030a',
        border:      '1px solid #0e0e1e',
        borderRadius: 6,
        minHeight:   340,
        maxHeight:   520,
        overflowY:   'auto',
        padding:     '16px',
        marginBottom: 14,
        fontFamily:  'monospace',
      }}>
        {history.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 36, opacity: .05, marginBottom: 14 }}>{'>'}_</div>
            <p style={{
              fontSize:   13,
              color:      '#303040',
              fontFamily: "'Times New Roman', Times, serif",
              fontStyle:  'italic',
              lineHeight: 1.85,
            }}>
              Type a command below. Use ↑↓ to scroll command history.<br />
              Every command is executed with full case awareness.
            </p>
          </div>
        )}

        {history.map((entry, i) => (
          <div key={i} style={{ marginBottom: entry.role === 'assistant' ? 20 : 10 }}>

            {/* User command */}
            {entry.role === 'user' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{
                  color:      '#404060',
                  fontSize:   11,
                  flexShrink: 0,
                  paddingTop: 2,
                  fontFamily: 'monospace',
                }}>
                  &gt;
                </span>
                <span style={{
                  color:      '#c8c4b8',
                  fontSize:   12,
                  fontFamily: 'monospace',
                  lineHeight: 1.6,
                  wordBreak:  'break-word',
                }}>
                  {entry.content}
                </span>
              </div>
            )}

            {/* System notification */}
            {entry.role === 'system' && (
              <div style={{
                borderLeft: '2px solid #2a2a4a',
                paddingLeft: 10,
                marginLeft:  2,
              }}>
                <span style={{
                  fontSize:   10,
                  color:      '#505070',
                  fontFamily: "'Times New Roman', Times, serif",
                  fontStyle:  'italic',
                }}>
                  {entry.content}
                </span>
              </div>
            )}

            {/* Assistant response */}
            {entry.role === 'assistant' && (
              <div style={{
                background:   '#ffffff',
                border:       '1px solid #141424',
                borderRadius: 5,
                padding:      '14px 16px',
              }}>
                {/* Route badge row */}
                <div style={{
                  display:     'flex',
                  alignItems:  'center',
                  gap:         8,
                  marginBottom: 12,
                  flexWrap:    'wrap',
                }}>
                  <span style={{
                    fontSize:      9,
                    color:         entry.routeColor ?? '#606080',
                    fontFamily:    "'Times New Roman', Times, serif",
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    border:        `1px solid ${(entry.routeColor ?? '#303050') + '55'}`,
                    padding:       '2px 7px',
                    borderRadius:  2,
                  }}>
                    Routed → {entry.route}
                  </span>

                  {entry.routeTab && setDashTab && (
                    <button
                      onClick={() => setDashTab(entry.routeTab as DashTabId)}
                      style={{
                        background:    'transparent',
                        border:        '1px solid #1e2030',
                        color:         '#405060',
                        borderRadius:  3,
                        padding:       '2px 8px',
                        fontSize:      9,
                        fontFamily:    "'Times New Roman', Times, serif",
                        cursor:        'pointer',
                        letterSpacing: '.06em',
                        transition:    'border-color .15s, color .15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = entry.routeColor ?? '#3a4050';
                        (e.currentTarget as HTMLElement).style.color = entry.routeColor ?? '#8090a0';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = '#1e2030';
                        (e.currentTarget as HTMLElement).style.color = '#405060';
                      }}
                    >
                      Open Module →
                    </button>
                  )}

                  <span style={{
                    marginLeft: 'auto',
                    fontSize:   9,
                    color:      '#cccccc',
                    fontFamily: 'monospace',
                  }}>
                    {new Date(entry.ts).toLocaleTimeString('en-GB', {
                      hour:   '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* AI response content */}
                <div style={{
                  fontSize:   13,
                  fontFamily: "'Times New Roman', Times, serif",
                  lineHeight: 1.75,
                  wordBreak:  'break-word',
                }}>
                  <Md text={entry.content} />
                </div>
              </div>
            )}

            {/* Error entry */}
            {entry.role === 'error' && (
              <div style={{
                borderLeft:  '2px solid #6a1a1a',
                paddingLeft: 10,
                marginLeft:  2,
              }}>
                <span style={{
                  fontSize:   11,
                  color:      '#c05050',
                  fontFamily: 'monospace',
                }}>
                  {entry.content}
                </span>
              </div>
            )}

          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
            <span style={{ color: '#303048', fontSize: 11, fontFamily: 'monospace' }}>&gt;</span>
            <span style={{
              color:      '#303048',
              fontSize:   11,
              fontFamily: 'monospace',
              animation:  'pulse 1.2s ease infinite',
            }}>
              Routing command… executing…
            </span>
          </div>
        )}

        <div ref={logEndRef} />
      </div>

      {/* ── Command Input ── */}
      <div style={{
        background:    '#06060f',
        border:        `1px solid ${loading ? '#1e1e40' : '#1a1a30'}`,
        borderRadius:  6,
        display:       'flex',
        alignItems:    'flex-end',
        gap:           0,
        transition:    'border-color .15s',
      }}>
        <span style={{
          color:      '#404060',
          fontSize:   13,
          padding:    '10px 10px 12px 14px',
          fontFamily: 'monospace',
          flexShrink: 0,
        }}>
          &gt;
        </span>
        <textarea
          ref={inputRef}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            'Issue a litigation command…  e.g. "What are my three biggest risks?" ' +
            'or "Prepare stay of execution" or "Rebuild defence around alibi"'
          }
          rows={2}
          disabled={loading}
          style={{
            flex:        1,
            background:  'transparent',
            border:      'none',
            outline:     'none',
            color:       '#d0ccbe',
            fontSize:    12,
            fontFamily:  'monospace',
            lineHeight:  1.65,
            padding:     '10px 6px',
            resize:      'none',
            minHeight:   44,
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !cmd.trim()}
          style={{
            background:   loading || !cmd.trim() ? 'transparent' : '#12121f',
            border:       'none',
            borderLeft:   '1px solid #1a1a30',
            color:        loading || !cmd.trim() ? '#252535' : T.gold,
            padding:      '10px 16px',
            cursor:       loading || !cmd.trim() ? 'default' : 'pointer',
            fontSize:     14,
            borderRadius: '0 6px 6px 0',
            alignSelf:    'stretch',
            transition:   'all .15s',
            flexShrink:   0,
          }}
        >
          {loading ? '…' : '⏎'}
        </button>
      </div>

      {/* Keyboard hints */}
      <p style={{
        fontSize:      10,
        color:         '#202030',
        fontFamily:    "'Times New Roman', Times, serif",
        marginTop:     6,
        letterSpacing: '.04em',
      }}>
        Enter to send · Shift+Enter for new line · ↑↓ to recall history
      </p>

    </div>
  );
}
