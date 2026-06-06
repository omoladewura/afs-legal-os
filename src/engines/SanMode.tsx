/**
 * AFS Advocates — SAN Mode Engine
 * Phase 2 Migration: full port of SANMode from app.html (11_engine_san_mode.txt)
 *
 * Senior Advocate / Principal Partner AI.
 * Accepts text + image/PDF input, returns structured Option A/B/C paths,
 * Nigerian/international authorities, landmines on each path, and SAN's
 * recommendation. Maintains full multi-turn conversation history.
 * Supports Drive RAG via MCP toggle and case context injection.
 */

import { useState, useRef, useEffect } from 'react';
import type { Case, ApiMessage, ContentBlock } from '@/types';
import { T } from '@/constants/tokens';
import { CLAUDE_MODEL } from '@/services/api';
import { queryLibrary, deriveQuery } from '@/services/library';
import { Md } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Attachment {
  name:      string;
  type:      string;   // MIME type
  data:      string;   // base64, no data-URL prefix
}

interface SanTurn {
  role:       'user' | 'assistant';
  text:       string;              // display text
  img?:       string;              // attachment filename if any
  apiContent: string | ContentBlock[];  // raw content sent / received
}

interface Props {
  activeCase: Case | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const SAN_SYSTEM = `You are SAN — Senior Advocate and Principal Partner at AFS Advocates. You have mastery of Nigerian law and procedure across every practice area: civil procedure, criminal procedure, commercial litigation, constitutional law, evidence, appellate practice, arbitration, land law, company law, employment law, human rights, and international commercial law. You know both the written rule and the live practice of Nigerian courts — from magistrate courts through to the Supreme Court. You know Lagos, Abuja, Port Harcourt, Kano — their rules, their culture, their judges.

CARDINAL RULE: You NEVER give one answer. You give structured options — exactly as a senior partner would in chambers. You guide. The lawyer decides. Always.

When presented with a legal problem, document image, court order, contract clause, law report photograph, draft, or question — respond in this EXACT structure:

**The Situation**
[Your precise reading of the legal problem in 2–4 sentences. Name the real issue. Be clinical.]

---

**Option A — [Name this path]**
*Posture: Aggressive / High-stakes*
[What this path involves. What it achieves. Why counsel would take it. Be specific — name the procedural steps, the pleadings, the timeframes.]
⚠ *Watch out for:* [The exact landmines on this path — procedural, evidential, strategic]

**Option B — [Name this path]**
*Posture: Conservative / Lower-risk*
[What this path involves. The tradeoffs made.]
⚠ *Watch out for:* [Landmines on this path]

**Option C — [Name this path]**
*Posture: Hybrid / Strategic*
[The creative middle ground. What it preserves. What it sacrifices.]
⚠ *Watch out for:* [Landmines on this path]

---

**Relevant Authorities**
[Nigerian cases — full names, year, court level where known. Statutes — specific sections. Rules of Court — specific Order and Rule numbers. International precedents where relevant and persuasive. If uncertain of a specific citation, identify the principle clearly and note that counsel should verify on LawPavilion or NigeriaLII before relying on it in court.]

---

**SAN's Recommendation**
*Guidance only — the decision is yours.*
[Which path SAN leans toward and precisely why. Name the specific factors driving the recommendation. Be direct. One tight paragraph. Never equivocate.]

---

For pure legal questions — definitions, procedure, explanations — answer directly and thoroughly with Nigerian authorities. Adapt the structured format to what is actually being asked. If a photo or PDF is shared, read it carefully, extract the legal implications, flag every risk, and suggest next steps — before offering the options framework.

If Google Drive is available, search for relevant precedents, past briefs, or research the lawyer already has — integrate findings before responding.`;

// ─────────────────────────────────────────────────────────────────────────────
// QUICK PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  "My client was dismissed without notice after 12 years. What do I do?",
  "Should my client settle or continue to trial?",
  "The limitation period may be about to expire — what are my options?",
  "Is this interlocutory injunction application strong enough?",
];

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE MCP SERVER CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const DRIVE_MCP_SERVER = {
  type: 'url',
  url:  'https://drivemcp.googleapis.com/mcp/v1',
  name: 'google-drive',
};

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

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function SanMode({ activeCase }: Props) {
  const [msgs,       setMsgs]       = useState<SanTurn[]>([]);
  const [inputText,  setInputText]  = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [useCtx,     setUseCtx]     = useState(true);
  const [useDrive,   setUseDrive]   = useState(false);
  const [copiedIdx,  setCopiedIdx]  = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const endRef  = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs, loading]);

  // ── File Attachment ────────────────────────────────────────────────────────

  function handleAttach(file: File | null | undefined): void {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large — maximum 10MB.');
      return;
    }
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setError('SAN accepts images (JPG, PNG, WEBP) and PDF documents.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setAttachment({ name: file.name, type: file.type, data: result.split(',')[1] });
    };
    reader.readAsDataURL(file);
    setError('');
  }

  // ── Copy message ──────────────────────────────────────────────────────────

  function copyMsg(idx: number): void {
    copyToClipboard(msgs[idx]?.text || '');
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2200);
  }

  // ── Build user content for API ─────────────────────────────────────────────

  function buildUserContent(txt: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    // Add attachment first (image or PDF)
    if (attachment) {
      if (attachment.type === 'application/pdf') {
        // PDF as document block
        blocks.push({
          type: 'image',  // typed as 'image' to satisfy ContentBlock; API accepts document type
          // @ts-ignore — document type is valid in Anthropic API but not in our slim type def
          source: { type: 'base64', media_type: 'application/pdf', data: attachment.data },
        } as unknown as ContentBlock);
      } else {
        blocks.push({
          type:   'image',
          source: { type: 'base64', media_type: attachment.type, data: attachment.data },
        });
      }
    }

    // Build prompt text with optional case context
    let promptText = txt;
    if (useCtx && activeCase) {
      const claimantNames  = activeCase.claimants.map(x => x.name).filter(Boolean).join(', ') || '[Not listed]';
      const defendantNames = activeCase.defendants.map(x => x.name).filter(Boolean).join(', ') || '[Not listed]';
      const caseLines = [
        `ACTIVE CASE: ${activeCase.caseName}`,
        activeCase.court   ? `Court: ${activeCase.court}`    : null,
        activeCase.suitNo  ? `Suit No: ${activeCase.suitNo}` : null,
        `Role: ${activeCase.role || 'Claimant'}`,
        `Claimants: ${claimantNames}`,
        `Defendants: ${defendantNames}`,
        activeCase.compressed_summary
          ? `Case history summary:\n${activeCase.compressed_summary}`
          : null,
      ].filter(Boolean).join('\n');
      promptText = `${caseLines}\n\n---\nINSTRUCTION FROM COUNSEL:\n${txt || '[See attached document]'}`;
    } else if (!txt && attachment) {
      promptText = 'Please read the attached document and give me your analysis.';
    }

    blocks.push({ type: 'text', text: promptText });
    return blocks;
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function send(): Promise<void> {
    const txt = inputText.trim();
    if (!txt && !attachment) return;
    setLoading(true);
    setError('');

    const userContent = buildUserContent(txt);

    // Build full conversation history for the API
    const apiMsgs: ApiMessage[] = [];
    msgs.forEach(m => {
      apiMsgs.push({
        role:    m.role,
        content: m.role === 'user' ? m.apiContent : m.text,
      });
    });
    apiMsgs.push({ role: 'user', content: userContent });

    // ── LIBRARY FIRST: Query Vectorize before building the request ─────────────
    let effectiveSystem = SAN_SYSTEM;
    try {
      const query = deriveQuery(SAN_SYSTEM, txt);
      if (query.trim()) {
        const ctx = await queryLibrary(query, { topK: 8, threshold: 0.70 });
        if (ctx.ok && ctx.block) {
          effectiveSystem = `${ctx.block}\n${SAN_SYSTEM}`;
        }
      }
    } catch {
      // Library unavailable — proceed with original SAN_SYSTEM
    }
    // ── END LIBRARY QUERY ──────────────────────────────────────────────────────

    const reqBody: Record<string, unknown> = {
      model:      CLAUDE_MODEL,
      max_tokens: 3000,
      system:     effectiveSystem,
      messages:   apiMsgs,
    };
    if (useDrive) {
      reqBody.mcp_servers = [DRIVE_MCP_SERVER];
    }

    try {
      const res  = await fetch('https://afs-legal-rag.sobamboadeshupo.workers.dev/chat', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer AFS2026SecureToken99',
        },
        body:    JSON.stringify(reqBody),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const reply = (data.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('');

      setMsgs(prev => [
        ...prev,
        {
          role:       'user',
          text:       txt,
          img:        attachment?.name,
          apiContent: userContent,
        },
        {
          role:       'assistant',
          text:       reply,
          apiContent: reply,
        },
      ]);

      setInputText('');
      setAttachment(null);
    } catch (e) {
      setError((e as Error).message || 'SAN is unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Key handler ───────────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && (inputText.trim() || attachment)) {
      e.preventDefault();
      send();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const acc = '#c4a030';
  const canSend = !loading && (!!inputText.trim() || !!attachment);

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22, paddingBottom: 20, borderBottom: `1px solid ${T.bdr}` }}>
        <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#1c1500,#0d0900)', border: '1px solid #3a2a0a', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, boxShadow: `0 0 20px ${acc}14` }}>
          ⭐
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: acc, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600 }}>
              SAN Mode · Live
            </span>
            <span style={{ fontSize: 7, color: '#3a2a08', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', border: '1px solid #2a1e06', padding: '1px 6px', borderRadius: 2, textTransform: 'uppercase', background: '#0a0800' }}>
              Step 6
            </span>
          </div>
          <h2 style={{ fontSize: 24, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, letterSpacing: '.02em', marginBottom: 5, lineHeight: 1.2 }}>
            Senior Advocate · Principal Partner
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', lineHeight: 1.65 }}>
            Upload a court order, paste a problem, ask anything. SAN gives you structured options — A, B, C — with Nigerian authorities and the landmines on each path. SAN guides. You decide.
          </p>
        </div>
      </div>

      {/* ── Conversation thread ── */}
      {msgs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {msgs.map((m, i) => m.role === 'user' ? (

            /* User bubble */
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14, animation: 'fadeUp .2s ease' }}>
              <div style={{ background: '#111122', border: '1px solid #1e1e32', borderRadius: '10px 3px 10px 10px', padding: '12px 16px', maxWidth: '84%' }}>
                {m.img && (
                  <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.08em', marginBottom: 6 }}>
                    📎 {m.img}
                  </p>
                )}
                <p style={{ fontSize: 15, color: T.sub, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.72, whiteSpace: 'pre-wrap' }}>
                  {m.text || (m.img ? '[Document attached]' : '')}
                </p>
              </div>
              <div style={{ width: 28, height: 28, background: '#0e0e1e', border: '1px solid #1e1e2e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: T.mute, flexShrink: 0, marginTop: 4 }}>
                ⚖
              </div>
            </div>

          ) : (

            /* SAN reply bubble */
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 20, animation: 'fadeUp .28s ease' }}>
              <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#1c1500,#0d0900)', border: '1px solid #3a2a0a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 4 }}>
                ⭐
              </div>
              <div style={{ flex: 1, background: '#09090f', border: '1px solid #181828', borderRadius: '3px 10px 10px 10px', padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontSize: 8, color: acc, fontFamily: 'Inter, sans-serif', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600 }}>
                    SAN's Analysis
                  </span>
                  <button
                    onClick={() => copyMsg(i)}
                    style={{ background: copiedIdx === i ? '#071808' : 'transparent', border: `1px solid ${copiedIdx === i ? '#1a4018' : '#1e1e2e'}`, color: copiedIdx === i ? '#40a858' : T.mute, borderRadius: 3, padding: '3px 11px', fontSize: 9, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.06em', transition: 'all .2s' }}>
                    {copiedIdx === i ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <Md text={m.text} />
              </div>
            </div>

          ))}

          {/* Loading bubble */}
          {loading && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#1c1500,#0d0900)', border: '1px solid #3a2a0a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 4 }}>
                ⭐
              </div>
              <div style={{ flex: 1, background: '#09090f', border: `1px solid ${acc}22`, borderRadius: '3px 10px 10px 10px', padding: '18px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 16, height: 16, border: `2px solid #1e1a06`, borderTop: `2px solid ${acc}`, borderRadius: '50%', animation: 'spin .9s linear infinite', flexShrink: 0 }} />
                  <p style={{ fontSize: 15, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>
                    SAN is reviewing your instructions…
                  </p>
                </div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      )}

      {/* ── Empty state ── */}
      {msgs.length === 0 && !loading && (
        <div style={{ background: '#07070e', border: '1px dashed #181828', borderRadius: 10, padding: '28px 22px', marginBottom: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 42, opacity: .07, marginBottom: 14 }}>⭐</div>
          <p style={{ fontSize: 22, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 8 }}>
            Ready for Instructions
          </p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.85, maxWidth: 500, margin: '0 auto 18px' }}>
            Ask SAN anything — a legal question, a strategic decision, an evidence problem. Upload a court order, a contract clause, a photo of a judgment or law report. SAN will give you Options A, B, and C with relevant Nigerian authorities.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {QUICK_PROMPTS.map((q, i) => (
              <button
                key={i}
                onClick={() => setInputText(q)}
                style={{ background: '#0d0d1a', border: '1px solid #181828', borderRadius: 20, padding: '6px 14px', fontSize: 11, color: '#3a3a54', fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.02em', transition: 'all .15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = T.goldL; (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a3e'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#3a3a54'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#181828'; }}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input panel ── */}
      <div style={{ background: '#0d0d18', border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '18px 20px' }}>

        {/* Toggle bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 13, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Case context toggle */}
          <button
            onClick={() => setUseCtx(v => !v)}
            style={{ background: useCtx ? '#100f20' : 'transparent', border: `1px solid ${useCtx ? acc + '50' : '#1e1e2e'}`, color: useCtx ? acc : T.mute, borderRadius: 4, padding: '4px 11px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 5, transition: 'all .15s' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: useCtx ? acc : '#2a2a3e', transition: 'background .15s', display: 'inline-block', flexShrink: 0 }} />
            Case: {activeCase ? (activeCase.caseName.length > 26 ? activeCase.caseName.slice(0, 23) + '…' : activeCase.caseName) : 'No case'}
          </button>

          {/* Drive RAG toggle */}
          <button
            onClick={() => setUseDrive(v => !v)}
            style={{ background: useDrive ? '#081428' : 'transparent', border: `1px solid ${useDrive ? '#4a7ed050' : '#1e1e2e'}`, color: useDrive ? '#7090d8' : T.mute, borderRadius: 4, padding: '4px 11px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 5, transition: 'all .15s' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: useDrive ? '#5080c8' : '#2a2a3e', transition: 'background .15s', display: 'inline-block', flexShrink: 0 }} />
            Drive RAG {useDrive ? '· ON' : '· OFF'}
          </button>

          {/* Clear conversation */}
          {msgs.length > 0 && (
            <button
              onClick={() => { setMsgs([]); setError(''); }}
              style={{ background: 'transparent', border: '1px solid #1e1e2e', color: '#2a1e1e', borderRadius: 4, padding: '4px 11px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', marginLeft: 'auto', transition: 'color .15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#904040'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#2a1e1e'; }}>
              Clear ✕
            </button>
          )}
        </div>

        {/* Attachment preview */}
        {attachment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#07070f', border: '1px solid #1e1e2e', borderRadius: 5, padding: '8px 12px', marginBottom: 11 }}>
            <span style={{ fontSize: 14 }}>{attachment.type === 'application/pdf' ? '📄' : '🖼'}</span>
            <span style={{ flex: 1, fontSize: 12, color: T.dim, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {attachment.name}
            </span>
            <span style={{ fontSize: 8, color: T.mute, fontFamily: 'Inter, sans-serif', flexShrink: 0, letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Ready
            </span>
            <button
              onClick={() => setAttachment(null)}
              style={{ background: 'transparent', border: 'none', color: '#804040', cursor: 'pointer', fontSize: 13, padding: '0 3px', flexShrink: 0 }}>
              ✕
            </button>
          </div>
        )}

        {/* Textarea */}
        <textarea
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={e => {
            setTimeout(() => (e.target as HTMLTextAreaElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 350);
          }}
          placeholder="Describe your legal problem, paste a clause or draft, ask your question… (Enter to send · Shift+Enter for new line)"
          rows={4}
          style={{ width: '100%', background: '#07070f', border: '1px solid #1a1a28', borderRadius: 6, color: T.text, padding: '13px 15px', fontSize: 15, fontFamily: "'Cormorant Garamond', serif", outline: 'none', resize: 'vertical', lineHeight: 1.8, minHeight: 88, boxSizing: 'border-box' }}
        />

        {/* Action row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>

          {/* Hidden file input */}
          <input
            type="file"
            ref={fileRef}
            style={{ display: 'none' }}
            accept="image/*,.pdf"
            onChange={e => handleAttach(e.target.files?.[0])}
          />

          {/* Upload button */}
          <button
            onClick={() => fileRef.current?.click()}
            title="Upload image or PDF — court orders, judgments, contract clauses, law report pages"
            style={{ background: 'transparent', border: '1px dashed #1e1e2e', color: T.mute, borderRadius: 5, padding: '9px 14px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, transition: 'all .15s' }}
            onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = '#3a3a52'; b.style.color = T.dim; }}
            onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = '#1e1e2e'; b.style.color = T.mute; }}>
            📎 Upload
          </button>

          {/* Send button */}
          <button
            onClick={send}
            disabled={!canSend}
            style={{ flex: 1, background: canSend ? `linear-gradient(135deg,#c4a030,#a07820)` : '#101018', color: canSend ? '#05050c' : '#2a2a38', border: 'none', borderRadius: 6, padding: '11px 24px', fontSize: 16, fontFamily: "'Cormorant Garamond', serif", cursor: canSend ? 'pointer' : 'not-allowed', fontWeight: 600, letterSpacing: '.04em', transition: 'all .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? (
              <>
                <span style={{ width: 11, height: 11, border: '2px solid #1a1400', borderTop: `2px solid ${acc}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} />
                Consulting SAN…
              </>
            ) : (
              <>Consult SAN ⭐</>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginTop: 10, background: '#1a0810', border: '1px solid #4a1830', borderRadius: 5, padding: '10px 14px', color: '#c07070', fontSize: 13, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Capabilities strip ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px solid #0f0f18` }}>
        {[
          { icon: '📝', text: 'Text problems & questions' },
          { icon: '🖼', text: 'Photos of judgments & contracts' },
          { icon: '📄', text: 'PDF court orders & briefs' },
          { icon: '⚖',  text: 'Nigerian + international law' },
          { icon: '🗂',  text: 'Case context (toggle above)' },
          { icon: '🔍', text: 'Drive search (toggle above)' },
        ].map((cap, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10, opacity: .5 }}>{cap.icon}</span>
            <span style={{ fontSize: 9, color: '#222234', fontFamily: 'Inter, sans-serif', letterSpacing: '.07em' }}>
              {cap.text}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}
