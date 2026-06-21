/**
 * AFS Legal OS — AI Copilot Engine (Phase 4 — extended in place)
 *
 * Phase 4 absorbs CommandConsole into this file, adding COMMAND MODE alongside
 * the existing CHAT MODE. Two modes toggled at the top:
 *
 *   CHAT MODE    (original Copilot — unchanged)
 *     Role-aware conversation · Full case context · Suggestions panel
 *
 *   COMMAND MODE (CommandConsole merged in)
 *     Strategic Posture switcher — Aggressive / Defensive /
 *       Settlement-Seeking / Appellate
 *     Posture flows into Chat Mode system prompt
 *     Quick commands palette (12 pre-built commands)
 *     Two-step routing pipeline: classify → specialist system prompt
 *     Per-case command log
 *     "Open Module →" routing to relevant tab
 *
 * Posture state is shared between both modes — set it in Command,
 * Chat inherits it immediately via the shared `posture` state.
 *
 * Original engines:
 *   Civil Claimant Side   → Claimant Strategy Copilot
 *   Civil Defendant Side  → Defence Strategy Copilot
 *   Criminal Prosecution  → Prosecution Copilot
 *   Criminal Defence      → Defence Copilot
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Case, DashTabId } from '@/types';
import { T } from '@/constants/tokens';
import { CLAUDE_MODEL } from '@/services/api';
import { queryLibrary, deriveQuery } from '@/services/library';
import { buildRoleLibraryOpts } from '@/utils/roleLibrary';
import { Md } from '@/components/common/ui';
import {
  buildRoleSystemPrompt,
  copilotHeading,
  copilotAccent,
  copilotSuggestions,
} from '@/utils/rolePrompt';
import { useIntelligence } from '@/hooks/useIntelligence';
import { useChatSession } from '@/hooks/useChatSession';
import {
  COUNSEL_ROLE_LABELS,
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_COLORS,
} from '@/types';
import { useAppStore } from '@/state/appStore';
import { callClaude, withRetry } from '@/services/api';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — COMMAND MODE TYPES & CONSTANTS (merged from CommandConsole)
// ─────────────────────────────────────────────────────────────────────────────

type CopilotMode = 'chat' | 'command';

type Posture = 'Aggressive' | 'Defensive' | 'Settlement-Seeking' | 'Appellate';

type RouteKey =
  | 'strategy_rebuild' | 'witness_analysis' | 'cross_exam'
  | 'evidence_analysis' | 'argument_build' | 'document_generate'
  | 'compliance_check' | 'risk_assessment' | 'appeal_analysis'
  | 'settlement' | 'general';

interface HistoryEntry {
  role:        'user' | 'assistant' | 'system' | 'error';
  content:     string;
  ts:          number;
  route?:      string;
  routeColor?: string;
  routeTab?:   DashTabId | null;
}

const POSTURES: Posture[] = ['Aggressive', 'Defensive', 'Settlement-Seeking', 'Appellate'];

const POSTURE_COLORS: Record<Posture, { bg: string; light: string }> = {
  'Aggressive':         { bg: '#2a0808', light: '#e05050' },
  'Defensive':          { bg: '#081428', light: '#5090d0' },
  'Settlement-Seeking': { bg: '#081a0e', light: '#50c070' },
  'Appellate':          { bg: '#140828', light: '#9060e0' },
};

const ROUTE_MAP: Record<RouteKey, { label: string; tab: DashTabId | null; color: string }> = {
  strategy_rebuild:  { label: 'Strategy Engine',          tab: 'intelligence',       color: '#e0a030' },
  witness_analysis:  { label: 'Cross-Examination Engine', tab: 'crossexam',          color: '#e05090' },
  cross_exam:        { label: 'Cross-Examination Engine', tab: 'crossexam',          color: '#e05090' },
  evidence_analysis: { label: 'Evidence Vault',           tab: 'evidence',           color: '#40b0a0' },
  argument_build:    { label: 'Written Address Engine',   tab: 'written_address' as DashTabId, color: '#a050d0' },
  document_generate: { label: 'Document Generator',       tab: null,                 color: '#d09030' },
  compliance_check:  { label: 'Compliance Engine',        tab: 'case_command' as DashTabId,    color: '#50a0e0' },
  risk_assessment:   { label: 'Risk Analytics',           tab: 'case_command' as DashTabId,    color: '#e05050' },
  appeal_analysis:   { label: 'Appeal Engine',            tab: 'appeal',             color: '#60c0a0' },
  settlement:        { label: 'Strategy Hub',            tab: 'strategy_hub' as DashTabId, color: '#80d060' },
  general:           { label: 'General Intelligence',     tab: null,                 color: '#b0a080' },
};

const QUICK_CMDS: Array<{ label: string }> = [
  { label: 'Rebuild defence theory around alibi' },
  { label: 'What are my three biggest risks right now?' },
  { label: 'Generate hostile cross-examination for PW2' },
  { label: 'Reassess admissibility of electronic evidence under Section 84' },
  { label: 'Has the limitation period expired?' },
  { label: 'Rebuild argument around jurisdiction only' },
  { label: 'Prepare emergency stay of execution application' },
  { label: 'Update case theory with new witness statement' },
  { label: 'Identify all appellate issues so far' },
  { label: 'Analyse prosecution evidence weaknesses' },
  { label: 'What is our BATNA right now?' },
  { label: 'Generate no-case submission analysis' },
];

function buildCommandSystemPrompt(routeKey: RouteKey, posture: Posture, ctx: string): string {
  const base: Record<RouteKey, string> = {
    strategy_rebuild:
      `You are the most experienced litigation strategist in Nigeria. Rebuild and recalibrate the client's litigation theory. Current strategic posture: ${posture}.`,
    witness_analysis:
      `You are Nigeria's leading trial counsel specialising in witness management and cross-examination. Current strategic posture: ${posture}.`,
    cross_exam:
      `You are a senior Nigerian trial advocate. Generate a full, adversarial, sequenced cross-examination strategy. Current strategic posture: ${posture}.`,
    evidence_analysis:
      `You are a Nigerian evidence law specialist. Analyse admissibility, weight, authenticity, Section 84 compliance. Current strategic posture: ${posture}.`,
    argument_build:
      `You are a master of Nigerian civil and criminal procedure and legal argumentation. Build the strongest possible legal argument on the identified issue. Current strategic posture: ${posture}.`,
    document_generate:
      `You are an expert Nigerian legal drafter. Generate the requested legal document in full, following Nigerian court rules and drafting conventions. Current strategic posture: ${posture}.`,
    compliance_check:
      `You are a Nigerian procedural law expert. Check every limitation period, pre-action notice, filing deadline, and procedural step. Current strategic posture: ${posture}.`,
    risk_assessment:
      `You are a litigation risk analyst specialising in Nigerian courts. Assess the current risk profile across all dimensions. Current strategic posture: ${posture}.`,
    appeal_analysis:
      `You are a leading Nigerian appellate advocate. Identify and analyse all appellate issues. Current strategic posture: ${posture}.`,
    settlement:
      `You are an experienced Nigerian dispute resolution counsel. Analyse the settlement landscape, BATNA, and recommended posture. Current strategic posture: ${posture}.`,
    general:
      `You are Senior Counsel at AFS Advocates — expert in Nigerian law and litigation strategy across all courts. Current strategic posture: ${posture}.`,
  };
  return base[routeKey] + `\n\nFULL CASE CONTEXT:\n${ctx}`;
}

interface ConsoleBlob { history: HistoryEntry[]; posture: Posture; }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function buildCaseContext(c: Case): string {
  const claimants  = c.claimants.map(p => p.name).filter(Boolean).join(', ') || '[Not listed]';
  const defendants = c.defendants.map(p => p.name).filter(Boolean).join(', ') || '[Not listed]';
  const track      = c.matter_track ? MATTER_TRACK_LABELS[c.matter_track] : 'Civil';
  const role       = c.counsel_role ? COUNSEL_ROLE_LABELS[c.counsel_role] : (c.role || 'Claimant');
  const lines = [
    `MATTER: ${c.caseName}`,
    c.court   ? `Court: ${c.court}`    : null,
    c.suitNo  ? `Suit No: ${c.suitNo}` : null,
    `Track: ${track}`,
    `Counsel Role: ${role}`,
    c.current_stage ? `Current Stage: ${c.current_stage}` : null,
    `Claimants / Complainants: ${claimants}`,
    `Defendants / Accused: ${defendants}`,
    c.compressed_summary
      ? `\nMatter Summary:\n${c.compressed_summary}`
      : null,
  ].filter(Boolean).join('\n');
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function AICopilot({ activeCase }: Props) {
  const { setDashTab } = useAppStore();

  // ── Shared mode + posture state ────────────────────────────────────────────
  const [mode,      setMode]      = useState<CopilotMode>('chat');
  const [posture,   setPosture]   = useState<Posture>('Aggressive');

  // ── Chat mode state ────────────────────────────────────────────────────────
  // Phase 4: history managed by useChatSession (caps at HISTORY_WINDOW turns,
  // folds overflow into a running summary instead of resending verbatim).
  const { turns: msgs, appendTurns, windowedApiMessages, clearSession } = useChatSession();
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [useCtx,    setUseCtx]    = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // ── Command mode state ─────────────────────────────────────────────────────
  const [cmd,          setCmd]          = useState('');
  const [cmdHistory,   setCmdHistory]   = useState<HistoryEntry[]>([]);
  const [cmdHistIdx,   setCmdHistIdx]   = useState(-1);
  const [cmdLoading,   setCmdLoading]   = useState(false);
  const [paletteOpen,  setPaletteOpen]  = useState(false);

  const endRef    = useRef<HTMLDivElement>(null);
  const textRef   = useRef<HTMLTextAreaElement>(null);
  const cmdRef    = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const caseId = activeCase?.id ?? '';

  // Load command log when case changes
  useEffect(() => {
    if (!caseId) return;
    loadBlindSpot<ConsoleBlob>(caseId, 'console', { history: [], posture: 'Aggressive' })
      .then(d => {
        setCmdHistory(d.history ?? []);
        if (d.posture && POSTURES.includes(d.posture)) setPosture(d.posture);
      });
    setCmd('');
    setCmdHistIdx(-1);
  }, [caseId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs, loading]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cmdHistory]);

  const counselRole  = activeCase?.counsel_role;
  const matterTrack  = activeCase?.matter_track;
  const accent       = copilotAccent(counselRole);
  const heading      = copilotHeading(matterTrack, counselRole);
  const suggestions  = copilotSuggestions(matterTrack, counselRole);
  const roleColors   = counselRole ? COUNSEL_ROLE_COLORS[counselRole] : null;
  const { fullContext } = useIntelligence(activeCase);

  // ── Posture switcher (shared) ──────────────────────────────────────────────
  const switchPosture = useCallback((p: Posture) => {
    setPosture(p);
    const notice: HistoryEntry = {
      role: 'system',
      content: `Strategic posture switched to: ${p}. All subsequent commands will adapt reasoning to the ${p} posture.`,
      ts: Date.now(),
    };
    setCmdHistory(prev => {
      const next = [...prev, notice];
      if (caseId) saveBlindSpot(caseId, 'console', { history: next, posture: p });
      return next;
    });
  }, [caseId]);

  // ── Command mode — send (two-step pipeline) ────────────────────────────────
  const handleCommandSend = useCallback(async () => {
    const command = cmd.trim();
    if (!command || cmdLoading || !activeCase) return;
    setCmd('');
    setCmdHistIdx(-1);
    setCmdLoading(true);

    const userEntry: HistoryEntry = { role: 'user', content: command, ts: Date.now() };
    const withUser = [...cmdHistory, userEntry];
    setCmdHistory(withUser);

    const ctx = buildCaseContext(activeCase);

    try {
      // Step 1: Route
      // Phase 4: fullContext removed from the routing call — the router only
      // needs to classify the command, not read case facts.
      const rawKey = (await withRetry(() => callClaude({
        system:
          'You are a command router for a Nigerian litigation intelligence system. ' +
          'Classify the user command into EXACTLY ONE of these categories ' +
          '(return ONLY the category key, nothing else):\n' +
          'strategy_rebuild | witness_analysis | cross_exam | evidence_analysis | ' +
          'argument_build | document_generate | compliance_check | risk_assessment | ' +
          'appeal_analysis | settlement | general',
        messages: [{
          role: 'user',
          content: `User command: "${command}"\n\nReturn ONLY the category key.`,
        }],
        maxTokens: 80,
      }))).trim().toLowerCase().replace(/[^a-z_]/g, '');

      const routeKey: RouteKey = (rawKey in ROUTE_MAP) ? rawKey as RouteKey : 'general';
      const route = ROUTE_MAP[routeKey];

      // Step 2: Execute — fullContext injected once here in system prompt
      const aiText = await withRetry(() => callClaude({
        system:   buildCommandSystemPrompt(routeKey, posture, ctx) + fullContext,
        userMsg:  command,
        maxTokens: 2000,
      }));

      const aiEntry: HistoryEntry = {
        role: 'assistant', content: aiText, ts: Date.now(),
        route: route.label, routeColor: route.color, routeTab: route.tab,
      };
      const finalHist = [...withUser, aiEntry];
      setCmdHistory(finalHist);
      if (caseId) saveBlindSpot(caseId, 'console', { history: finalHist, posture });
    } catch (err) {
      const errEntry: HistoryEntry = {
        role: 'error',
        content: 'Command failed: ' + (err as Error).message,
        ts: Date.now(),
      };
      const finalHist = [...withUser, errEntry];
      setCmdHistory(finalHist);
      if (caseId) saveBlindSpot(caseId, 'console', { history: finalHist, posture });
    } finally {
      setCmdLoading(false);
    }
  }, [cmd, cmdHistory, cmdLoading, activeCase, posture, fullContext, caseId]);

  function handleCmdKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommandSend(); return; }
    const userCmds = cmdHistory.filter(h => h.role === 'user');
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = cmdHistIdx + 1;
      if (idx < userCmds.length) { setCmdHistIdx(idx); setCmd(userCmds[userCmds.length - 1 - idx].content); }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = cmdHistIdx - 1;
      if (idx < 0) { setCmdHistIdx(-1); setCmd(''); }
      else { setCmdHistIdx(idx); setCmd(userCmds[userCmds.length - 1 - idx].content); }
    }
  }

  function clearCmdLog() {
    setCmdHistory([]);
    if (caseId) saveBlindSpot(caseId, 'console', { history: [], posture });
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  const send = useCallback(async (userText?: string) => {
    const txt = (userText ?? input).trim();
    if (!txt || loading) return;

    setLoading(true);
    setError('');

    // Phase 4: case context lives in the system prompt (via fullContext from
    // useIntelligence), NOT prepended to each user message. This eliminates
    // the ~200-token context block being duplicated across every turn.
    const promptText = txt;

    // Phase 4: windowed history — last HISTORY_WINDOW turns only, older turns
    // folded into a running summary by useChatSession.
    const history = windowedApiMessages();
    history.push({ role: 'user', content: promptText });

    // Build role-aware system prompt — posture + fullContext injected once here.
    // When useCtx is on, fullContext (from useIntelligence) provides the case
    // facts. When off, just the role prompt is used.
    const caseCtxBlock = (useCtx && activeCase) ? fullContext : '';
    const baseSystem = buildRoleSystemPrompt(matterTrack, counselRole)
      + `\n\nCURRENT STRATEGIC POSTURE: ${posture}. Frame all recommendations through this posture.`
      + caseCtxBlock;

    // Query library for relevant authorities
    let effectiveSystem = baseSystem;
    try {
      const query = deriveQuery(baseSystem, txt);
      if (query.trim()) {
        const roleLibOpts = buildRoleLibraryOpts(matterTrack, counselRole, txt.slice(0, 150));
        const lib = await queryLibrary(query, roleLibOpts);
        if (lib.ok && lib.block) {
          effectiveSystem = `${lib.block}\n\n${baseSystem}`;
        }
      }
    } catch {
      // Library unavailable — proceed with role system prompt only
    }

    const reqBody = {
      model:        CLAUDE_MODEL,
      max_tokens:   2500,
      system:       effectiveSystem,
      messages:     history,
      counsel_role: counselRole  ?? undefined,
      matter_track: matterTrack  ?? undefined,
      engine:       counselRole  ? `copilot_${counselRole}` : 'copilot',
    };

    try {
      const res = await fetch('https://afs-legal-rag.sobamboadeshupo.workers.dev/chat', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer AFS2026SecureToken99',
        },
        body: JSON.stringify(reqBody),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const reply = (data.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('');

      appendTurns(
        { role: 'user',      text: txt   },
        { role: 'assistant', text: reply },
      );
      setInput('');
    } catch (e) {
      setError((e as Error).message || 'Copilot is unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, msgs, loading, useCtx, activeCase, matterTrack, counselRole, posture, fullContext, windowedApiMessages, appendTurns]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
      e.preventDefault();
      send();
    }
  }

  function copyMsg(idx: number): void {
    copyToClipboard(msgs[idx]?.text || '');
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function clearConversation(): void {
    clearSession();
    setError('');
    setInput('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const canSend = !loading && !!input.trim();

  const containerS: React.CSSProperties = {
    display:       'flex',
    flexDirection: 'column',
    gap:           0,
    animation:     'fadeUp .3s ease',
    height:        'calc(100vh - 220px)',
    minHeight:     480,
  };

  const headerS: React.CSSProperties = {
    display:       'flex',
    alignItems:    'flex-start',
    gap:           16,
    marginBottom:  20,
    paddingBottom: 18,
    borderBottom:  `1px solid ${T.bdr}`,
    flexShrink:    0,
  };

  const iconS: React.CSSProperties = {
    width:         44,
    height:        44,
    background:    roleColors ? roleColors.bg : T.card,
    border:        `1px solid ${roleColors ? roleColors.bdr : T.bdr}`,
    borderRadius:  10,
    display:       'flex',
    alignItems:    'center',
    justifyContent:'center',
    fontSize:      22,
    flexShrink:    0,
  };

  const roleBadgeS: React.CSSProperties = {
    display:      'inline-flex',
    alignItems:   'center',
    gap:          6,
    padding:      '3px 10px',
    borderRadius: 20,
    fontSize:     11,
    fontWeight:   600,
    letterSpacing:'.06em',
    background:   roleColors ? roleColors.bg : T.card,
    border:       `1px solid ${roleColors ? roleColors.bdr : T.bdr}`,
    color:        accent,
    marginTop:    4,
  };

  const ctrlS: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        12,
    marginLeft: 'auto',
    flexShrink: 0,
  };

  const toggleBtnS = (on: boolean): React.CSSProperties => ({
    padding:      '5px 12px',
    borderRadius: 6,
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
    border:       `1px solid ${on ? accent : T.bdr}`,
    background:   on ? `${accent}18` : 'transparent',
    color:        on ? accent : T.mute,
    transition:   'all .2s',
  });

  const chatAreaS: React.CSSProperties = {
    flex:       1,
    overflowY:  'auto',
    padding:    '4px 0 16px',
    display:    'flex',
    flexDirection: 'column',
    gap:        16,
  };

  const emptyS: React.CSSProperties = {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    flex:           1,
    gap:            24,
    padding:        '40px 20px',
  };

  const suggGridS: React.CSSProperties = {
    display:             'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap:                 10,
    width:               '100%',
    maxWidth:            640,
  };

  const suggBtnS: React.CSSProperties = {
    textAlign:    'left',
    padding:      '12px 14px',
    borderRadius: 8,
    fontSize:     13,
    color:        T.fg,
    background:   T.card,
    border:       `1px solid ${T.bdr}`,
    cursor:       'pointer',
    lineHeight:   1.4,
    transition:   'border-color .2s, background .2s',
    fontFamily:   "'Times New Roman', Times, serif",
  };

  const msgRowS = (role: 'user' | 'assistant'): React.CSSProperties => ({
    display:       'flex',
    flexDirection: role === 'user' ? 'row-reverse' : 'row',
    gap:           10,
    alignItems:    'flex-start',
  });

  const avatarS = (role: 'user' | 'assistant'): React.CSSProperties => ({
    width:         32,
    height:        32,
    borderRadius:  8,
    background:    role === 'user' ? `${accent}20` : T.card,
    border:        `1px solid ${role === 'user' ? accent + '40' : T.bdr}`,
    display:       'flex',
    alignItems:    'center',
    justifyContent:'center',
    fontSize:      14,
    flexShrink:    0,
    color:         role === 'user' ? accent : T.mute,
    fontWeight:    700,
  });

  const bubbleS = (role: 'user' | 'assistant'): React.CSSProperties => ({
    flex:        1,
    maxWidth:    '86%',
    padding:     '12px 15px',
    borderRadius: role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
    background:  role === 'user' ? `${accent}12` : T.card,
    border:      `1px solid ${role === 'user' ? accent + '30' : T.bdr}`,
    fontSize:    14,
    lineHeight:  1.65,
    color:       T.fg,
    position:    'relative',
  });

  const copyBtnS = (copied: boolean): React.CSSProperties => ({
    position:   'absolute',
    top:        8,
    right:      8,
    padding:    '2px 8px',
    fontSize:   10,
    borderRadius: 4,
    border:     `1px solid ${T.bdr}`,
    background: copied ? '#40a87820' : 'transparent',
    color:      copied ? '#40a878' : T.mute,
    cursor:     'pointer',
    transition: 'all .2s',
  });

  const inputAreaS: React.CSSProperties = {
    flexShrink:   0,
    paddingTop:   14,
    borderTop:    `1px solid ${T.bdr}`,
    display:      'flex',
    flexDirection:'column',
    gap:          10,
  };

  const textareaS: React.CSSProperties = {
    width:        '100%',
    background:   T.card,
    border:       `1px solid ${T.bdr}`,
    borderRadius: 8,
    color:        T.fg,
    fontSize:     14,
    fontFamily:   "'Times New Roman', Times, serif",
    padding:      '11px 14px',
    resize:       'none',
    outline:      'none',
    lineHeight:   1.55,
    minHeight:    72,
    maxHeight:    160,
    boxSizing:    'border-box',
  };

  const footerRowS: React.CSSProperties = {
    display:     'flex',
    alignItems:  'center',
    gap:         10,
    justifyContent: 'space-between',
  };

  const sendBtnS: React.CSSProperties = {
    padding:      '9px 22px',
    borderRadius: 7,
    fontSize:     13,
    fontWeight:   600,
    border:       'none',
    background:   canSend ? accent : T.card,
    color:        canSend ? '#05050c' : T.mute,
    cursor:       canSend ? 'pointer' : 'not-allowed',
    transition:   'all .2s',
    letterSpacing:'.04em',
    fontFamily:   "'Times New Roman', Times, serif",
  };

  const clearBtnS: React.CSSProperties = {
    padding:      '9px 16px',
    borderRadius: 7,
    fontSize:     12,
    fontWeight:   600,
    border:       `1px solid ${T.bdr}`,
    background:   'transparent',
    color:        T.mute,
    cursor:       msgs.length > 0 ? 'pointer' : 'not-allowed',
    opacity:      msgs.length > 0 ? 1 : 0.4,
    transition:   'all .2s',
    fontFamily:   "'Times New Roman', Times, serif",
  };

  const hintS: React.CSSProperties = {
    fontSize: 11,
    color:    T.mute,
  };

  return (
    <div style={containerS}>

      {/* ── Phase 4: Mode toggle bar ── */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 16, flexShrink: 0,
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: '8px 10px',
      }}>
        {([
          { id: 'chat'    as CopilotMode, icon: '✦', label: 'Chat Mode',    desc: 'Role-aware conversation' },
          { id: 'command' as CopilotMode, icon: '>_', label: 'Command Mode', desc: 'Strategic posture + routing pipeline' },
        ] as const).map(m => {
          const active = mode === m.id;
          return (
            <button key={m.id} onClick={() => setMode(m.id)} style={{
              flex: 1, background: active ? `${accent}12` : 'transparent',
              border: `1px solid ${active ? accent + '55' : T.bdr}`,
              borderRadius: 6, padding: '8px 14px', cursor: 'pointer',
              textAlign: 'left', transition: 'all .15s',
            }}>
              <span style={{ fontSize: 11, color: active ? accent : T.mute, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, display: 'block', marginBottom: 2 }}>
                {m.icon} {m.label}
              </span>
              <span style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                {m.desc}
              </span>
            </button>
          );
        })}

        {/* Posture badge — always visible, shared between modes */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 12px', borderRadius: 6,
          background: POSTURE_COLORS[posture].bg,
          border: `1px solid ${POSTURE_COLORS[posture].light}33`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 8, color: POSTURE_COLORS[posture].light, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
            Posture
          </span>
          <span style={{ fontSize: 10, color: POSTURE_COLORS[posture].light, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
            {posture}
          </span>
        </div>
      </div>

      {/* ── COMMAND MODE ── */}
      {mode === 'command' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>

          {/* Posture switcher */}
          <div style={{
            background: '#08080f', border: `1px solid ${POSTURE_COLORS[posture].bg}`,
            borderLeft: `3px solid ${POSTURE_COLORS[posture].light}`,
            borderRadius: '0 6px 6px 0', padding: '10px 14px', marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, color: T.dim, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>
              Strategic Posture
            </span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {POSTURES.map(p => {
                const pc = POSTURE_COLORS[p];
                const active = posture === p;
                return (
                  <button key={p} onClick={() => switchPosture(p)} style={{
                    background: active ? pc.bg : 'transparent',
                    border: `1px solid ${active ? pc.light : '#cccccc'}`,
                    color: active ? pc.light : '#505060',
                    borderRadius: 4, padding: '4px 12px', fontSize: 10,
                    fontFamily: "'Times New Roman', Times, serif",
                    cursor: 'pointer', letterSpacing: '.06em',
                    textTransform: 'uppercase', fontWeight: 600, transition: 'all .15s',
                  }}>
                    {p}
                  </button>
                );
              })}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: POSTURE_COLORS[posture].light, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', opacity: 0.7 }}>
              Flows into Chat Mode ·  all commands adapt to {posture} posture
            </span>
          </div>

          {/* Quick command palette toggle */}
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            <button onClick={() => setPaletteOpen(o => !o)} style={{
              background: 'transparent', border: '1px solid #1a1a28', color: T.mute,
              borderRadius: 4, padding: '5px 12px', fontSize: 10,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              letterSpacing: '.08em', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ fontSize: 8 }}>▶</span>
              Quick Commands {paletteOpen ? '▲' : '▼'}
            </button>
            {paletteOpen && (
              <div style={{
                background: '#06060e', border: '1px solid #141420', borderRadius: 6,
                padding: '12px 14px', marginTop: 6,
                display: 'flex', flexWrap: 'wrap', gap: 6, animation: 'fadeUp .15s ease',
              }}>
                {QUICK_CMDS.map((q, i) => (
                  <button key={i} onClick={() => { setCmd(q.label); setPaletteOpen(false); setTimeout(() => cmdRef.current?.focus(), 50); }}
                    style={{
                      background: '#ffffff', border: '1px solid #1e1e30', color: T.mute,
                      borderRadius: 4, padding: '4px 10px', fontSize: 10,
                      fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
                      letterSpacing: '.04em', transition: 'border-color .12s, color .12s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#3a3a60'; (e.currentTarget as HTMLElement).style.color = T.text; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e1e30'; (e.currentTarget as HTMLElement).style.color = T.mute; }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Command log */}
          <div style={{
            flex: 1, background: '#03030a', border: '1px solid #0e0e1e',
            borderRadius: 6, overflowY: 'auto', padding: '14px',
            marginBottom: 10, fontFamily: 'monospace', minHeight: 200,
          }}>
            {cmdHistory.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 30, opacity: .05, marginBottom: 10 }}>{'>_'}</div>
                <p style={{ fontSize: 13, color: '#303040', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', lineHeight: 1.85 }}>
                  Issue any litigation command. The system routes it to the correct engine.<br />
                  Posture set here flows into Chat Mode immediately.
                </p>
              </div>
            )}
            {cmdHistory.map((entry, i) => (
              <div key={i} style={{ marginBottom: entry.role === 'assistant' ? 18 : 8 }}>
                {entry.role === 'user' && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <span style={{ color: '#404060', fontSize: 11, flexShrink: 0, paddingTop: 2, fontFamily: 'monospace' }}>&gt;</span>
                    <span style={{ color: '#c8c4b8', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word' }}>{entry.content}</span>
                  </div>
                )}
                {entry.role === 'system' && (
                  <div style={{ borderLeft: '2px solid #2a2a4a', paddingLeft: 9, marginLeft: 2 }}>
                    <span style={{ fontSize: 10, color: '#505070', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>{entry.content}</span>
                  </div>
                )}
                {entry.role === 'assistant' && (
                  <div style={{ background: '#ffffff', border: '1px solid #141424', borderRadius: 5, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9, color: entry.routeColor ?? '#606080', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', border: `1px solid ${(entry.routeColor ?? '#303050') + '55'}`, padding: '2px 6px', borderRadius: 2 }}>
                        Routed → {entry.route}
                      </span>
                      {entry.routeTab && (
                        <button onClick={() => setDashTab(entry.routeTab as DashTabId)} style={{ background: 'transparent', border: '1px solid #1e2030', color: '#405060', borderRadius: 3, padding: '2px 7px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', transition: 'all .15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = entry.routeColor ?? '#3a4050'; (e.currentTarget as HTMLElement).style.color = entry.routeColor ?? '#8090a0'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e2030'; (e.currentTarget as HTMLElement).style.color = '#405060'; }}
                        >
                          Open Module →
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: '#cccccc', fontFamily: 'monospace' }}>
                        {new Date(entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75, wordBreak: 'break-word' }}>
                      <Md text={entry.content} />
                    </div>
                  </div>
                )}
                {entry.role === 'error' && (
                  <div style={{ borderLeft: '2px solid #6a1a1a', paddingLeft: 9, marginLeft: 2 }}>
                    <span style={{ fontSize: 11, color: '#c05050', fontFamily: 'monospace' }}>{entry.content}</span>
                  </div>
                )}
              </div>
            ))}
            {cmdLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0' }}>
                <span style={{ color: '#303048', fontSize: 11, fontFamily: 'monospace' }}>&gt;</span>
                <span style={{ color: '#303048', fontSize: 11, fontFamily: 'monospace', animation: 'pulse 1.2s ease infinite' }}>
                  Routing command… executing…
                </span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>

          {/* Command input */}
          <div style={{ background: '#06060f', border: '1px solid #1a1a30', borderRadius: 6, display: 'flex', alignItems: 'flex-end', flexShrink: 0 }}>
            <span style={{ color: '#404060', fontSize: 13, padding: '10px 8px 12px 12px', fontFamily: 'monospace', flexShrink: 0 }}>&gt;</span>
            <textarea ref={cmdRef} value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={handleCmdKeyDown}
              placeholder='Issue a litigation command…  e.g. "What are my three biggest risks?" or "Prepare emergency stay"'
              rows={2} disabled={cmdLoading}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#d0ccbe', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.65, padding: '10px 6px', resize: 'none', minHeight: 44 }}
            />
            <button onClick={handleCommandSend} disabled={cmdLoading || !cmd.trim()}
              style={{ background: cmdLoading || !cmd.trim() ? 'transparent' : '#12121f', border: 'none', borderLeft: '1px solid #1a1a30', color: cmdLoading || !cmd.trim() ? '#252535' : '#c4a030', padding: '10px 14px', cursor: cmdLoading || !cmd.trim() ? 'default' : 'pointer', fontSize: 14, borderRadius: '0 6px 6px 0', alignSelf: 'stretch', transition: 'all .15s', flexShrink: 0 }}>
              {cmdLoading ? '…' : '⏎'}
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <p style={{ fontSize: 10, color: '#202030', fontFamily: "'Times New Roman', Times, serif", margin: 0, letterSpacing: '.04em' }}>
              Enter to send · Shift+Enter for new line · ↑↓ to recall history
            </p>
            <button onClick={clearCmdLog} style={{ background: 'transparent', border: 'none', color: '#604040', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
              ↺ Clear Log
            </button>
          </div>
        </div>
      )}

      {/* ── CHAT MODE (original — unchanged below) ── */}
      {mode === 'chat' && (<>

      {/* ── Header ── */}
      <div style={headerS}>
        <div style={iconS}>
          {counselRole === 'claimant_side'  ? '⚔' :
           counselRole === 'defendant_side' ? '🛡' :
           counselRole === 'prosecution'    ? '⚖' :
           counselRole === 'defence'        ? '🛡' : '✦'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.fg, marginBottom: 4, fontFamily: "'Times New Roman', Times, serif" }}>
            {heading}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {counselRole && (
              <span style={roleBadgeS}>
                {COUNSEL_ROLE_LABELS[counselRole].toUpperCase()}
              </span>
            )}
            {matterTrack && (
              <span style={{ fontSize: 11, color: T.mute }}>
                {MATTER_TRACK_LABELS[matterTrack]} Matter
              </span>
            )}
            {!counselRole && (
              <span style={{ fontSize: 12, color: T.mute }}>
                Role-aware Nigerian Litigation AI
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: T.mute, marginTop: 6, lineHeight: 1.5 }}>
            {counselRole === 'claimant_side'  && 'Advancing and winning the claim — every recommendation is from your client\'s perspective.'}
            {counselRole === 'defendant_side' && 'Defeating and limiting the claim — every strategy is from the defendant\'s perspective.'}
            {counselRole === 'prosecution'    && 'Proving every count beyond reasonable doubt — prosecution-focused intelligence.'}
            {counselRole === 'defence'        && 'Protecting the accused and challenging the prosecution — defence-focused intelligence.'}
            {!counselRole                     && 'Set matter_track and counsel_role at matter creation for fully role-specific guidance.'}
          </div>
        </div>
        <div style={ctrlS}>
          <button
            style={toggleBtnS(useCtx)}
            onClick={() => setUseCtx(v => !v)}
            title="Include case context in every message"
          >
            {useCtx ? '◉ Case Context' : '○ Case Context'}
          </button>
          <button
            style={clearBtnS}
            onClick={clearConversation}
            disabled={msgs.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div style={chatAreaS}>

        {/* Empty state — suggestions */}
        {msgs.length === 0 && (
          <div style={emptyS}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>
                {counselRole === 'claimant_side'  ? '⚔' :
                 counselRole === 'defendant_side' ? '🛡' :
                 counselRole === 'prosecution'    ? '⚖' :
                 counselRole === 'defence'        ? '🛡' : '✦'}
              </div>
              <div style={{ fontSize: 15, color: T.fg, fontWeight: 600, marginBottom: 6, fontFamily: "'Times New Roman', Times, serif" }}>
                {heading}
              </div>
              <div style={{ fontSize: 13, color: T.mute, maxWidth: 440 }}>
                Ask anything about this matter. Every answer is framed from your role's perspective.
              </div>
            </div>
            <div style={suggGridS}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  style={suggBtnS}
                  onClick={() => send(s)}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = accent;
                    (e.currentTarget as HTMLButtonElement).style.background  = `${accent}10`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = T.bdr;
                    (e.currentTarget as HTMLButtonElement).style.background  = T.card;
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {msgs.map((m, i) => (
          <div key={i} style={msgRowS(m.role)}>
            <div style={avatarS(m.role)}>
              {m.role === 'user' ? 'Y' : '✦'}
            </div>
            <div style={bubbleS(m.role)}>
              {m.role === 'assistant' && (
                <button
                  style={copyBtnS(copiedIdx === i)}
                  onClick={() => copyMsg(i)}
                >
                  {copiedIdx === i ? '✓ Copied' : 'Copy'}
                </button>
              )}
              {m.role === 'assistant'
                ? <Md text={m.text ?? ''} />
                : <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              }
            </div>
          </div>
        ))}

        {/* Loading */}
        {loading && (
          <div style={msgRowS('assistant')}>
            <div style={avatarS('assistant')}>✦</div>
            <div style={{ ...bubbleS('assistant'), color: T.mute }}>
              <span style={{ animation: 'pulse 1.4s ease-in-out infinite' }}>
                Analysing from {counselRole ? COUNSEL_ROLE_LABELS[counselRole].toLowerCase() + ' perspective' : 'litigation perspective'}…
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#180808', border: '1px solid #401818', color: '#c05050', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Input area ── */}
      <div style={inputAreaS}>
        <textarea
          ref={textRef}
          style={textareaS}
          rows={3}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            counselRole === 'claimant_side'  ? 'Ask about advancing the claim, default judgment, evidence, enforcement…' :
            counselRole === 'defendant_side' ? 'Ask about defences available, preliminary objection, default exposure…' :
            counselRole === 'prosecution'    ? 'Ask about evidence sufficiency, witness order, admissibility, sentencing…' :
            counselRole === 'defence'        ? 'Ask about charge defects, bail grounds, no-case threshold, mitigation…' :
            'Ask about this matter — procedure, strategy, documents, deadlines…'
          }
        />
        <div style={footerRowS}>
          <span style={hintS}>
            {useCtx && activeCase
              ? `◉ Including case context · ${activeCase.caseName}`
              : '○ No case context — responses are general'
            }
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ ...hintS, fontSize: 10 }}>Enter to send · Shift+Enter for new line</span>
            <button
              style={sendBtnS}
              onClick={() => send()}
              disabled={!canSend}
            >
              {loading ? 'Thinking…' : 'Send →'}
            </button>
          </div>
        </div>
      </div>
      </>)}

    </div>
  );
}
