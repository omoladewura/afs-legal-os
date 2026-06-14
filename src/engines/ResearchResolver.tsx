/**
 * AFS Advocates — Research Resolver
 * Phase 2 — Full implementation
 *
 * Two tabs:
 *   A) ⚡ Case Finder  — paste a [RESEARCH NEEDED] block → get instant
 *                        LawPavilion search queries → go search → come back
 *   B) § Resolver      — paste the block + argument paragraph + the cases
 *                        you found → get the paragraph rewritten with real
 *                        Nigerian citations in place of the placeholder
 *
 * Workflow under pressure (in front of a judge):
 *   1. ArgumentBuilder generates draft with [RESEARCH NEEDED] blocks
 *   2. Copy the block → Case Finder tab → copy a search query
 *   3. Paste into LawPavilion → find real case → copy ratio
 *   4. Come back → Resolver tab → paste cases → resolve
 *   5. Real citation, no hallucination, done in minutes
 */

import React, { useState, useRef } from 'react';
import { callClaude } from '@/services/api';
import { useIntelligence } from '@/hooks/useIntelligence';
import type { Case }  from '@/types';
import { T }          from '@/constants/tokens';
import { uid }        from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface UploadedFile {
  name: string;
  type: string;   // MIME
  data: string;   // base64, no data-URI prefix
}

interface CaseEntry {
  id:       string;
  citation: string;
  text:     string;
  file:     UploadedFile | null;
}

interface Props {
  onBack: () => void;
  activeCase: Case;
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const DIM  = '#4a3810';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 13px', fontSize: 14,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const taStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', lineHeight: 1.75 };
const labelStyle: React.CSSProperties = {
  fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// CASE ENTRY CARD
// ─────────────────────────────────────────────────────────────────────────────

interface CaseCardProps {
  entry:     CaseEntry;
  index:     number;
  removable: boolean;
  onUpdate:  (id: string, field: keyof CaseEntry, value: unknown) => void;
  onRemove:  (id: string) => void;
}

function CaseCard({ entry, index, removable, onUpdate, onRemove }: CaseCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('File too large — max 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      onUpdate(entry.id, 'file', { name: file.name, type: file.type, data: result.split(',')[1] });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div style={{ background: T.card, border: '1px solid #1a1a2a', borderRadius: 7, padding: '16px 18px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, minWidth: 20, flexShrink: 0 }}>{index + 1}.</span>
        <input
          value={entry.citation}
          onChange={e => onUpdate(entry.id, 'citation', e.target.value)}
          placeholder="Citation — e.g. Sken-Consult (Nig.) Ltd v. Ukey (1981) 1 SC 6"
          style={{ ...inputStyle, flex: 1, fontSize: 13 }}
        />
        {removable && (
          <button onClick={() => onRemove(entry.id)} style={{ background: 'transparent', border: '1px solid #3a1a1a', color: '#804040', borderRadius: 3, padding: '6px 9px', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</button>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Paste the case text — ratio, headnote, or relevant excerpts</label>
        <textarea
          value={entry.text}
          onChange={e => onUpdate(entry.id, 'text', e.target.value)}
          rows={4}
          placeholder="Paste the relevant portion of the judgment — the holding, ratio decidendi, or the specific passage you are relying on."
          style={{ ...taStyle, fontSize: 13 }}
        />
      </div>

      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} style={{ display: 'none' }} />
      {entry.file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: '1px solid #cccccc', borderRadius: 4, padding: '7px 12px' }}>
          <span style={{ fontSize: 13 }}>📎</span>
          <span style={{ flex: 1, fontSize: 11, color: T.dim, fontFamily: "'Times New Roman', Times, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.file.name}</span>
          <button onClick={() => onUpdate(entry.id, 'file', null)} style={{ background: 'transparent', border: 'none', color: '#804040', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          style={{ background: 'transparent', border: '1px dashed #1e1e2e', color: T.mute, borderRadius: 4, padding: '8px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', width: '100%', textAlign: 'center', letterSpacing: '.04em', transition: 'border-color .15s' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3a52')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = T.bdr)}
        >
          📎 Upload PDF or image of the case (optional)
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT PANEL
// ─────────────────────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try { navigator.clipboard.writeText(result); } catch {
      const ta = document.createElement('textarea'); ta.value = result;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div style={{ background: T.card, border: `1px solid ${T.text}`, borderRadius: 10, padding: '24px 26px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${T.text}22` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, background: T.text, borderRadius: '50%', display: 'inline-block' }} />
          <p style={{ fontSize: 9, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600, margin: 0 }}>Resolved Paragraph</p>
        </div>
        <button
          onClick={copy}
          style={{ background: copied ? '#0a1a06' : 'transparent', border: `1px solid ${copied ? T.bdr : T.bdr}`, color: copied ? '#60b040' : T.mute, borderRadius: 3, padding: '4px 14px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, transition: 'all .2s' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ fontSize: 16, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {result}
      </div>
      <p style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #131320', fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75 }}>
        Verify every citation before filing — confirm the case name, year, volume, page, and that the holding stated matches what the court actually decided.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE FINDER — Tab A
// Parse [RESEARCH NEEDED] block → generate LawPavilion search queries
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedBlock {
  proposition:        string;
  areaOfLaw:          string;
  courtLevel:         string;
  searches:           string[];
  whatCaseMustDecide: string;
}

function parseResearchBlock(raw: string): ParsedBlock | null {
  if (!raw.includes('[RESEARCH NEEDED]')) return null;
  const get = (label: string): string => {
    const re = new RegExp(`${label}:\\s*([^\\n]+)`, 'i');
    return (raw.match(re)?.[1] || '').trim();
  };
  const searches: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const v = get(`LawPavilion search ${i}`);
    if (v) searches.push(v);
  }
  return {
    proposition:        get('Proposition'),
    areaOfLaw:          get('Area of law'),
    courtLevel:         get('Court level needed'),
    searches,
    whatCaseMustDecide: get('What the case must decide'),
  };
}

function CaseFinder({ fullContext }: { fullContext: string }) {
  const [block,        setBlock]        = useState('');
  const [parsed,       setParsed]       = useState<ParsedBlock | null>(null);
  const [error,        setError]        = useState('');
  const [copiedIdx,    setCopiedIdx]    = useState<number | null>(null);
  const [extraSearches, setExtraSearches] = useState<string[]>([]);
  const [generating,   setGenerating]   = useState(false);

  function parseBlock() {
    if (!block.trim()) { setError('Paste a [RESEARCH NEEDED] block first.'); return; }
    const result = parseResearchBlock(block);
    if (!result) {
      setError('Could not parse the block. Make sure it was generated by the Argument Builder and includes [RESEARCH NEEDED] and [/RESEARCH NEEDED] tags.');
      return;
    }
    setError('');
    setParsed(result);
    setExtraSearches([]);
  }

  async function generateMoreSearches() {
    if (!parsed) return;
    setGenerating(true);
    try {
      const text = await callClaude({
        system: 'You are a Nigerian legal research expert specialising in LawPavilion searches. Generate precise, effective search queries for finding Nigerian case law.' + fullContext,
        userMsg:
          `Generate 4 additional LawPavilion search queries for this legal research need.\n\n` +
          `Proposition: ${parsed.proposition}\n` +
          `Area of law: ${parsed.areaOfLaw}\n` +
          `Court level: ${parsed.courtLevel}\n` +
          `What the case must decide: ${parsed.whatCaseMustDecide}\n\n` +
          `Existing searches:\n${parsed.searches.join('\n')}\n\n` +
          `Generate 4 NEW search phrases — different angles, synonyms, alternative legal terms of art, ` +
          `or related doctrines that might surface relevant cases in LawPavilion. ` +
          `Output ONLY the 4 search phrases, one per line, no numbering, no explanation.`,
        maxTokens: 300,
      });
      const lines = text.trim().split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean).slice(0, 4);
      setExtraSearches(lines);
    } catch (e) {
      setError((e as Error).message || 'Failed to generate more searches.');
    } finally {
      setGenerating(false);
    }
  }

  function copySearch(query: string, idx: number) {
    try { navigator.clipboard.writeText(query); } catch {
      const ta = document.createElement('textarea'); ta.value = query;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  const allSearches = [...(parsed?.searches || []), ...extraSearches];

  return (
    <div style={{ animation: 'fadeUp .25s ease' }}>

      {/* Under pressure banner */}
      <div style={{ background: '#080a04', border: '1px solid #2a3010', borderLeft: '3px solid #8ab020', borderRadius: '0 8px 8px 0', padding: '14px 18px', marginBottom: 20 }}>
        <p style={{ fontSize: 11, color: '#8ab040', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
          ⚡ Under Pressure Workflow
        </p>
        <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65 }}>
          Copy a [RESEARCH NEEDED] block from your argument → paste below → get instant LawPavilion search queries → copy one → search in LawPavilion → find the real case → come back → use the Resolver tab to plug it in. 3–5 real cases, zero hallucination.
        </p>
      </div>

      {/* Paste area */}
      <div style={{ background: '#0d0d18', border: '1px solid #2a2208', borderLeft: `3px solid ${T.text}`, borderRadius: '0 8px 8px 0', padding: '20px 22px', marginBottom: 14 }}>
        <label style={{ ...labelStyle, color: T.text, letterSpacing: '.12em', marginBottom: 6 }}>
          Paste [RESEARCH NEEDED] block here <span style={{ color: '#b06060' }}>*</span>
        </label>
        <p style={{ fontSize: 11, color: DIM, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.6 }}>
          Copy the entire block including [RESEARCH NEEDED] and [/RESEARCH NEEDED] tags from your argument draft.
        </p>
        <textarea
          value={block}
          onChange={e => { setBlock(e.target.value); setParsed(null); setExtraSearches([]); setError(''); }}
          rows={9}
          placeholder={
            '[RESEARCH NEEDED]\n' +
            'Proposition: The court has inherent jurisdiction to set aside its own judgment obtained by fraud.\n' +
            'Area of law: Civil Procedure / Judgments\n' +
            'Court level needed: Supreme Court\n' +
            'LawPavilion search 1: inherent jurisdiction set aside judgment fraud\n' +
            'LawPavilion search 2: fraud exception finality of judgment Nigeria\n' +
            'LawPavilion search 3: court set aside consent judgment obtained by fraud\n' +
            'What the case must decide: That a court retains jurisdiction to set aside its own judgment where fraud is established.\n' +
            '[/RESEARCH NEEDED]'
          }
          style={{ ...taStyle, fontFamily: "'Times New Roman', Times, serif", fontSize: 12, lineHeight: 1.7 }}
        />
        {error && (
          <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 8, lineHeight: 1.5 }}>{error}</p>
        )}
        <button
          onClick={parseBlock}
          style={{ marginTop: 12, background: '#000000', color: '#ffffff', border: 'none', borderRadius: 6, padding: '11px 28px', fontSize: 15, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, cursor: 'pointer', letterSpacing: '.04em' }}
        >
          Generate Search Queries →
        </button>
      </div>

      {/* Results */}
      {parsed && (
        <div style={{ animation: 'fadeUp .25s ease' }}>

          {/* Brief summary card */}
          <div style={{ background: '#05070d', border: '1px solid #1a1e2e', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
            <p style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Research Brief</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {[{ label: 'Area of Law', value: parsed.areaOfLaw }, { label: 'Court Level', value: parsed.courtLevel }].map(item => (
                <div key={item.label} style={{ background: '#ffffff', border: '1px solid #12122a', borderRadius: 5, padding: '10px 13px' }}>
                  <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{item.label}</p>
                  <p style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>{item.value || '—'}</p>
                </div>
              ))}
            </div>
            <div style={{ background: '#ffffff', border: '1px solid #12122a', borderRadius: 5, padding: '10px 13px', marginBottom: 10 }}>
              <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Proposition to establish</p>
              <p style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, fontStyle: 'italic' }}>{parsed.proposition || '—'}</p>
            </div>
            <div style={{ background: '#ffffff', border: '1px solid #12122a', borderRadius: 5, padding: '10px 13px' }}>
              <p style={{ fontSize: 8, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>The case must hold that</p>
              <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>{parsed.whatCaseMustDecide || '—'}</p>
            </div>
          </div>

          {/* LawPavilion search queries */}
          <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                  LawPavilion Search Queries
                </p>
                <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>
                  Copy any query → paste into LawPavilion → find the real case → come back
                </p>
              </div>
              <button
                onClick={generateMoreSearches}
                disabled={generating}
                style={{ background: 'transparent', border: `1px solid ${T.text}44`, color: generating ? T.mute : T.text, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: generating ? 'not-allowed' : 'pointer', letterSpacing: '.04em', flexShrink: 0, transition: 'all .15s' }}
              >
                {generating ? '…generating' : '+ More Queries'}
              </button>
            </div>

            {allSearches.map((q, i) => (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ffffff', border: `1px solid ${copiedIdx === i ? T.text + '44' : '#eeeeee'}`, borderRadius: 6, padding: '12px 14px', marginBottom: 8, transition: 'border-color .15s' }}
              >
                <span style={{ fontSize: 10, color: i < parsed.searches.length ? T.text : '#5a7030', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, minWidth: 20, flexShrink: 0 }}>{i + 1}</span>
                <p style={{ flex: 1, fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5, margin: 0, wordBreak: 'break-word' }}>{q}</p>
                <button
                  onClick={() => copySearch(q, i)}
                  style={{ background: copiedIdx === i ? '#071808' : 'transparent', border: `1px solid ${copiedIdx === i ? '#2a4818' : T.bdr}`, color: copiedIdx === i ? '#50a840' : T.text, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', flexShrink: 0, transition: 'all .2s', whiteSpace: 'nowrap' }}
                >
                  {copiedIdx === i ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            ))}

            <div style={{ marginTop: 14, background: '#060810', border: '1px solid #0e0e20', borderRadius: 6, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>🔍</span>
              <p style={{ fontSize: 11, color: '#3a3a58', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
                Go to <strong style={{ color: '#5a5a80' }}>lawpavilion.com</strong> → paste query into the case search → find the case → copy the ratio decidendi or headnote → come back to the <strong style={{ color: '#5a5a80' }}>Resolver tab</strong> to plug it in.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div style={{ background: '#0a0d06', border: '1px solid #1a2a10', borderRadius: 8, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>✓</span>
            <div>
              <p style={{ fontSize: 13, color: '#80b050', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 3 }}>Found your cases?</p>
              <p style={{ fontSize: 11, color: '#4a6030', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>
                Switch to the <strong>Resolver tab</strong> → paste the [RESEARCH NEEDED] block + the argument paragraph + the cases you found → get the paragraph rewritten with real citations.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVER — Tab B
// ─────────────────────────────────────────────────────────────────────────────

function Resolver({ fullContext }: { fullContext: string }) {
  const [resBlock, setResBlock] = useState('');
  const [argPara,  setArgPara]  = useState('');
  const [cases,    setCases]    = useState<CaseEntry[]>([{ id: uid(), citation: '', text: '', file: null }]);
  const [result,   setResult]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  function addCase() { setCases(prev => [...prev, { id: uid(), citation: '', text: '', file: null }]); }
  function removeCase(id: string) { setCases(prev => prev.filter(c => c.id !== id)); }
  function updateCase(id: string, field: keyof CaseEntry, value: unknown) {
    setCases(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  }

  async function resolve() {
    const valid = cases.filter(c => c.citation.trim() && (c.text.trim() || c.file));
    if (!resBlock.trim() || !argPara.trim()) { setError('The [RESEARCH] block and the argument paragraph are both required.'); return; }
    if (valid.length === 0) { setError('Add at least one case with a citation and some text or an uploaded PDF.'); return; }
    setLoading(true); setError(''); setResult('');

    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

    const content: ContentBlock[] = [
      {
        type: 'text',
        text:
          'You are Senior Counsel at AFS Advocates rewriting an argument paragraph with real Nigerian authorities.\n\n' +
          'THE [RESEARCH] BLOCK (what authority was needed):\n' + resBlock.trim() +
          '\n\nTHE ARGUMENT PARAGRAPH — rewrite this, replacing the research gap with real citations:\n' + argPara.trim() +
          '\n\n───\n' +
          'The following ' + (valid.length > 1 ? `${valid.length} authorities were` : 'authority was') +
          ' found and provided. Each case follows. Read each carefully, identify the holding or proposition ' +
          'relevant to the argument, and weave them in as real citations in proper Nigerian citation format ' +
          '(case name, year, volume, law report, page).\n\n' +
          'Output ONLY the rewritten paragraph — no preamble, no commentary, no explanation. ' +
          'The paragraph must read as polished advocacy suitable for a Written Address or Brief of Argument ' +
          'filed in a Nigerian court. ' +
          'If a case supports only part of the proposition, apply it accurately to that part only.',
      },
    ];

    valid.forEach((c, i) => {
      content.push({ type: 'text', text: `\n\n═══ CASE ${i + 1}: ${c.citation} ═══` });
      if (c.file) content.push({ type: 'document', source: { type: 'base64', media_type: c.file.type, data: c.file.data } });
      if (c.text.trim()) content.push({ type: 'text', text: c.text.trim() });
    });

    try {
      const text = await callClaude({
        system:
          'You are Senior Counsel at AFS Advocates. You rewrite argument paragraphs using real cases ' +
          'provided by the instructing solicitor. You cite accurately in Nigerian format. ' +
          'You output only the rewritten paragraph — nothing else.' + fullContext,
        messages: [{ role: 'user' as const, content: content as import('@/types').ContentBlock[] }],
        maxTokens: 2000,
      });
      setResult(text.trim());
    } catch (e) {
      setError((e as Error).message || 'Resolution failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const canResolve = !loading && resBlock.trim().length > 0 && argPara.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* How it works */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { n: '01', label: 'Paste the block',    desc: 'Copy the [RESEARCH NEEDED] block exactly as generated.' },
          { n: '02', label: 'Add your cases',      desc: 'Paste the ratio from LawPavilion, upload the PDF, or both. One entry per case.' },
          { n: '03', label: 'Get the paragraph',   desc: 'AI rewrites the paragraph with real Nigerian citations in court format.' },
        ].map(step => (
          <div key={step.n} style={{ background: '#ffffff', border: '1px solid #111120', borderRadius: 7, padding: '14px 16px' }}>
            <div style={{ fontSize: 9, color: DIM, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', fontWeight: 700, marginBottom: 5 }}>STEP {step.n}</div>
            <div style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 5 }}>{step.label}</div>
            <div style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>{step.desc}</div>
          </div>
        ))}
      </div>

      {/* [RESEARCH NEEDED] block */}
      <div style={{ background: '#0d0d18', border: '1px solid #2a2208', borderLeft: `3px solid ${T.text}`, borderRadius: '0 8px 8px 0', padding: '20px 22px' }}>
        <label style={{ ...labelStyle, color: T.text, letterSpacing: '.12em', marginBottom: 6 }}>
          [RESEARCH NEEDED] Block — paste exactly as generated <span style={{ color: '#b06060' }}>*</span>
        </label>
        <p style={{ fontSize: 11, color: DIM, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.6 }}>
          Copy the block verbatim including the [RESEARCH NEEDED] and [/RESEARCH NEEDED] tags.
        </p>
        <textarea
          value={resBlock}
          onChange={e => setResBlock(e.target.value)}
          rows={7}
          placeholder={'[RESEARCH NEEDED]\nProposition: ...\nArea of law: ...\n...\n[/RESEARCH NEEDED]'}
          style={{ ...taStyle, fontFamily: "'Times New Roman', Times, serif", fontSize: 12, lineHeight: 1.7 }}
        />
      </div>

      {/* Argument paragraph */}
      <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '20px 22px' }}>
        <label style={labelStyle}>
          The Argument Paragraph (containing that research block) <span style={{ color: '#b06060' }}>*</span>
        </label>
        <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 10, lineHeight: 1.6 }}>
          Paste the full paragraph as generated — including the surrounding argument and the [RESEARCH NEEDED] block within it.
        </p>
        <textarea
          value={argPara}
          onChange={e => setArgPara(e.target.value)}
          rows={7}
          placeholder="Paste the full argument paragraph here, including the [RESEARCH NEEDED] block within it..."
          style={{ ...taStyle, lineHeight: 1.85 }}
        />
      </div>

      {/* Cases */}
      <div style={{ background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Authorities Found</p>
            <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
              One block per case. Paste the ratio from LawPavilion, upload the PDF, or both.
            </p>
          </div>
          <button
            onClick={addCase}
            style={{ background: 'transparent', border: `1px solid ${T.text}`, color: T.text, borderRadius: 4, padding: '6px 16px', fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', flexShrink: 0, transition: 'background .15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0d0d00')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            + Add Case
          </button>
        </div>
        {cases.map((c, idx) => (
          <CaseCard key={c.id} entry={c} index={idx} removable={cases.length > 1} onUpdate={updateCase} onRemove={removeCase} />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#180808', border: '1px solid #401818', borderRadius: 5, padding: '12px 16px' }}>
          <p style={{ color: T.mute, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>{error}</p>
        </div>
      )}

      {/* Resolve button */}
      <button
        onClick={resolve}
        disabled={!canResolve}
        style={{ background: canResolve ? `linear-gradient(135deg,${T.text},${T.dim})` : '#101018', color: canResolve ? '#05050c' : '#2a2a38', border: 'none', borderRadius: 6, padding: '16px', fontSize: 18, fontFamily: "'Times New Roman', Times, serif", cursor: canResolve ? 'pointer' : 'not-allowed', fontWeight: 600, letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'opacity .2s' }}
      >
        {loading ? (
          <>
            <span style={{ width: 14, height: 14, border: `2px solid #1e1e2e`, borderTop: `2px solid ${T.text}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} />
            Resolving…
          </>
        ) : 'Resolve Citations →'}
      </button>

      {result && <ResultPanel result={result} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — tabbed shell
// ─────────────────────────────────────────────────────────────────────────────

export function ResearchResolver({ onBack, activeCase }: Props) {
  const { fullContext } = useIntelligence(activeCase);
  const [activeTab, setActiveTab] = useState<'finder' | 'resolver'>('finder');

  return (
    <div style={{ animation: 'fadeUp .35s ease', paddingBottom: 48 }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 6 }}>
          <button
            onClick={onBack}
            style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', marginTop: 6, flexShrink: 0, transition: 'border-color .15s, color .15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#3a3a52'; (e.currentTarget as HTMLElement).style.color = T.text; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.bdr; (e.currentTarget as HTMLElement).style.color = T.mute; }}
          >← Back</button>
          <div>
            <p style={{ fontSize: 9, color: T.mute, letterSpacing: '.2em', textTransform: 'uppercase', fontFamily: "'Times New Roman', Times, serif", marginBottom: 6 }}>Smart Tools · Research</p>
            <h1 style={{ fontSize: 30, color: '#d4b050', fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.03em', lineHeight: 1.1, marginBottom: 8 }}>
              Research Resolver
            </h1>
            <p style={{ fontSize: 14, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', lineHeight: 1.65, maxWidth: 580 }}>
              Case Finder generates precise LawPavilion search queries from your [RESEARCH NEEDED] blocks. Resolver rewrites the paragraph with the real cases you bring back.
            </p>
          </div>
        </div>
        <div style={{ width: 60, height: 1, background: `linear-gradient(90deg, transparent, ${T.text}, transparent)`, margin: '18px 0' }} />
      </div>

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 22, background: '#050508', border: '1px solid #111120', borderRadius: 7, padding: 3 }}>
        {[
          { id: 'finder'   as const, icon: '⚡', label: 'Case Finder', sub: 'Get LawPavilion queries' },
          { id: 'resolver' as const, icon: '§',  label: 'Resolver',    sub: 'Rewrite with real cases' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, background: activeTab === tab.id ? '#0d0d1c' : 'transparent', border: `1px solid ${activeTab === tab.id ? T.text : 'transparent'}`, color: activeTab === tab.id ? T.text : T.mute, borderRadius: 5, padding: '9px 8px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600, transition: 'all .2s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
          >
            <span style={{ fontSize: 15 }}>{tab.icon}</span>
            <span>{tab.label}</span>
            <span style={{ fontSize: 8, opacity: .6, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{tab.sub}</span>
          </button>
        ))}
      </div>

      {activeTab === 'finder'   && <CaseFinder fullContext={fullContext} />}
      {activeTab === 'resolver' && <Resolver fullContext={fullContext} />}

      <p style={{ marginTop: 40, fontSize: 11, color: '#1e1e2a', textAlign: 'center', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8 }}>
        AFS Advocates · Research Resolver — authorities verified by counsel, citations resolved by AI.
      </p>
    </div>
  );
}
