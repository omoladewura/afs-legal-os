/**
 * AFS Legal OS V2 — AI Copilot Engine (Phase 5)
 *
 * The role-aware AI Copilot. Permanently knows matter_track + counsel_role.
 * Adapts identity, system prompt, suggestions, and output framing to the
 * exact position the lawyer occupies on each matter.
 *
 * Civil Claimant Side   → Claimant Strategy Copilot
 * Civil Defendant Side  → Defence Strategy Copilot
 * Criminal Prosecution  → Prosecution Copilot
 * Criminal Defence      → Defence Copilot
 *
 * Doc12 specification: every Claude invocation must include matter_track + counsel_role.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Case, ApiMessage } from '@/types';
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
import {
  COUNSEL_ROLE_LABELS,
  MATTER_TRACK_LABELS,
  COUNSEL_ROLE_COLORS,
} from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CopilotTurn {
  role:    'user' | 'assistant';
  text:    string;
}

interface Props {
  activeCase: Case | null;
}

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
  const [msgs,      setMsgs]      = useState<CopilotTurn[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [useCtx,    setUseCtx]    = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const endRef  = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs, loading]);

  const counselRole  = activeCase?.counsel_role;
  const matterTrack  = activeCase?.matter_track;
  const accent       = copilotAccent(counselRole);
  const heading      = copilotHeading(matterTrack, counselRole);
  const suggestions  = copilotSuggestions(matterTrack, counselRole);
  const roleColors   = counselRole ? COUNSEL_ROLE_COLORS[counselRole] : null;

  // ── Send ──────────────────────────────────────────────────────────────────

  const send = useCallback(async (userText?: string) => {
    const txt = (userText ?? input).trim();
    if (!txt || loading) return;

    setLoading(true);
    setError('');

    // Build user message with optional case context
    let promptText = txt;
    if (useCtx && activeCase) {
      const ctx = buildCaseContext(activeCase);
      promptText = `${ctx}\n\n---\nQUESTION FROM COUNSEL:\n${txt}`;
    }

    // Assemble history
    const history: ApiMessage[] = msgs.map(m => ({
      role:    m.role,
      content: m.text,
    }));
    history.push({ role: 'user', content: promptText });

    // Build role-aware system prompt
    const baseSystem = buildRoleSystemPrompt(matterTrack, counselRole);

    // Query library for relevant authorities
    let effectiveSystem = baseSystem;
    try {
      const query = deriveQuery(baseSystem, txt);
      if (query.trim()) {
        // Role-aware retrieval: filter Vectorize to role-appropriate materials
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
      // Role context — enables Worker-side role-aware retrieval
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

      setMsgs(prev => [
        ...prev,
        { role: 'user',      text: txt },
        { role: 'assistant', text: reply },
      ]);
      setInput('');
    } catch (e) {
      setError((e as Error).message || 'Copilot is unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, msgs, loading, useCtx, activeCase, matterTrack, counselRole]);

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
    setMsgs([]);
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
    fontFamily:   "'Cormorant Garamond', serif",
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
    fontFamily:   "'Cormorant Garamond', serif",
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
    fontFamily:   "'Cormorant Garamond', serif",
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
    fontFamily:   "'Cormorant Garamond', serif",
  };

  const hintS: React.CSSProperties = {
    fontSize: 11,
    color:    T.mute,
  };

  return (
    <div style={containerS}>

      {/* ── Header ── */}
      <div style={headerS}>
        <div style={iconS}>
          {counselRole === 'claimant_side'  ? '⚔' :
           counselRole === 'defendant_side' ? '🛡' :
           counselRole === 'prosecution'    ? '⚖' :
           counselRole === 'defence'        ? '🛡' : '✦'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.fg, marginBottom: 4, fontFamily: "'Cormorant Garamond', serif" }}>
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
              <div style={{ fontSize: 15, color: T.fg, fontWeight: 600, marginBottom: 6, fontFamily: "'Cormorant Garamond', serif" }}>
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
                ? <Md>{m.text}</Md>
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

    </div>
  );
}
