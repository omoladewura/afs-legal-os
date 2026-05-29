/**
 * AFS Advocates — Research Resolver
 * Phase 2 — Full implementation
 *
 * Standalone tool (no active case required).
 *
 * Workflow:
 *   1. Paste a [RESEARCH] block from any AI-generated output
 *   2. Paste the full argument paragraph containing that block
 *   3. Add the cases you actually found — one per entry, with citation +
 *      pasted text and/or PDF/image upload
 *   4. The system rewrites the paragraph with real Nigerian citations in place
 *      of the [RESEARCH] placeholder
 *
 * Port of ResearchResolverPanel from app.html (10_engine_research_resolver.txt).
 * Adapted for TypeScript / React 18 / project architecture.
 */

import React, { useState, useRef } from 'react';
import { callClaude }            from '@/services/api';
import { T }                       from '@/constants/tokens';
import { uid }                     from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface UploadedFile {
  name:      string;
  type:      string;   // MIME
  data:      string;   // base64, no data-URI prefix
}

interface CaseEntry {
  id:       string;
  citation: string;
  text:     string;
  file:     UploadedFile | null;
}

interface Props {
  onBack: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — local palette
// ─────────────────────────────────────────────────────────────────────────────

const ACC  = '#c4a030';
const ACCD = '#a07820';
const DIM  = '#4a3810';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width:        '100%',
  background:   T.bg,
  border:       '1px solid #1e1e2e',
  borderRadius: 5,
  color:        T.text,
  padding:      '10px 13px',
  fontSize:     14,
  fontFamily:   "'Cormorant Garamond', serif",
  outline:      'none',
  boxSizing:    'border-box',
};

const taStyle: React.CSSProperties = {
  ...inputStyle,
  resize:     'vertical',
  lineHeight: 1.75,
};

const labelStyle: React.CSSProperties = {
  fontSize:      9,
  color:         T.mute,
  fontFamily:    'Inter, sans-serif',
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  fontWeight:    600,
  display:       'block',
  marginBottom:  5,
};

// ─────────────────────────────────────────────────────────────────────────────
// CASE ENTRY CARD
// ─────────────────────────────────────────────────────────────────────────────

interface CaseCardProps {
  entry:      CaseEntry;
  index:      number;
  removable:  boolean;
  onUpdate:   (id: string, field: keyof CaseEntry, value: unknown) => void;
  onRemove:   (id: string) => void;
}

function CaseCard({ entry, index, removable, onUpdate, onRemove }: CaseCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large — max 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      onUpdate(entry.id, 'file', {
        name: file.name,
        type: file.type,
        data: result.split(',')[1],
      });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  return (
    <div style={{
      background:   '#0a0a14',
      border:       '1px solid #1a1a2a',
      borderRadius: 7,
      padding:      '16px 18px',
      marginBottom: 10,
    }}>
      {/* Citation row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          fontSize:   11,
          color:      ACC,
          fontFamily: "'Cormorant Garamond', serif",
          fontWeight: 600,
          minWidth:   20,
          flexShrink: 0,
        }}>
          {index + 1}.
        </span>
        <input
          value={entry.citation}
          onChange={e => onUpdate(entry.id, 'citation', e.target.value)}
          placeholder="Citation — e.g. Sken-Consult (Nig.) Ltd v. Ukey (1981) 1 SC 6"
          style={{ ...inputStyle, flex: 1, fontSize: 13 }}
        />
        {removable && (
          <button
            onClick={() => onRemove(entry.id)}
            style={{
              background:   'transparent',
              border:       '1px solid #3a1a1a',
              color:        '#804040',
              borderRadius: 3,
              padding:      '6px 9px',
              cursor:       'pointer',
              fontSize:     11,
              flexShrink:   0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Case text */}
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Paste the case text (ratio, headnote, or relevant excerpts)</label>
        <textarea
          value={entry.text}
          onChange={e => onUpdate(entry.id, 'text', e.target.value)}
          rows={4}
          placeholder="Paste the relevant portion of the judgment — the holding, the ratio decidendi, or the specific passage you are relying on to support the proposition."
          style={{ ...taStyle, fontSize: 13 }}
        />
      </div>

      {/* PDF / image upload */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        {entry.file ? (
          <div style={{
            display:      'flex',
            alignItems:   'center',
            gap:          8,
            background:   T.bg,
            border:       '1px solid #1e1e2e',
            borderRadius: 4,
            padding:      '7px 12px',
          }}>
            <span style={{ fontSize: 13 }}>📎</span>
            <span style={{
              flex:          1,
              fontSize:      11,
              color:         T.dim,
              fontFamily:    'Inter, sans-serif',
              overflow:      'hidden',
              textOverflow:  'ellipsis',
              whiteSpace:    'nowrap',
            }}>
              {entry.file.name}
            </span>
            <button
              onClick={() => onUpdate(entry.id, 'file', null)}
              style={{
                background: 'transparent',
                border:     'none',
                color:      '#804040',
                cursor:     'pointer',
                fontSize:   11,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background:    'transparent',
              border:        '1px dashed #1e1e2e',
              color:         T.mute,
              borderRadius:  4,
              padding:       '8px',
              fontSize:      11,
              fontFamily:    'Inter, sans-serif',
              cursor:        'pointer',
              width:         '100%',
              textAlign:     'center',
              letterSpacing: '.04em',
              transition:    'border-color .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3a52')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e1e2e')}
          >
            📎 Upload PDF or image of the case (optional)
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT PANEL
// ─────────────────────────────────────────────────────────────────────────────

interface ResultPanelProps {
  result: string;
}

function ResultPanel({ result }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);

  function copy() {
    try {
      navigator.clipboard.writeText(result);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = result;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      background:   '#0a0a14',
      border:       `1px solid ${ACC}`,
      borderRadius: 10,
      padding:      '24px 26px',
      animation:    'fadeUp .3s ease',
    }}>
      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   16,
        paddingBottom:  12,
        borderBottom:   `1px solid ${ACC}22`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width:        6,
            height:       6,
            background:   ACC,
            borderRadius: '50%',
            display:      'inline-block',
            flexShrink:   0,
          }} />
          <p style={{
            fontSize:      9,
            color:         ACC,
            fontFamily:    'Inter, sans-serif',
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight:    600,
            margin:        0,
          }}>
            Resolved Paragraph
          </p>
        </div>
        <button
          onClick={copy}
          style={{
            background:    copied ? '#0a1a06' : 'transparent',
            border:        `1px solid ${copied ? '#3a5028' : '#2a2208'}`,
            color:         copied ? '#60b040' : T.mute,
            borderRadius:  3,
            padding:       '4px 14px',
            fontSize:      9,
            fontFamily:    'Inter, sans-serif',
            cursor:        'pointer',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            fontWeight:    600,
            transition:    'all .2s',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Result text */}
      <div style={{
        fontSize:    16,
        color:       '#ddd9cc',
        fontFamily:  "'Cormorant Garamond', serif",
        lineHeight:  2,
        whiteSpace:  'pre-wrap',
        wordBreak:   'break-word',
      }}>
        {result}
      </div>

      {/* Disclaimer */}
      <p style={{
        marginTop:   16,
        paddingTop:  14,
        borderTop:   '1px solid #131320',
        fontSize:    11,
        color:       '#3a3a52',
        fontFamily:  'Inter, sans-serif',
        lineHeight:  1.75,
      }}>
        Verify every citation before filing — confirm the case name, year, volume, page, and that
        the holding stated matches what the court actually decided.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ResearchResolver({ onBack }: Props) {
  const [resBlock,  setResBlock]  = useState('');
  const [argPara,   setArgPara]   = useState('');
  const [cases,     setCases]     = useState<CaseEntry[]>([
    { id: uid(), citation: '', text: '', file: null },
  ]);
  const [result,    setResult]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  // ── Case list helpers ───────────────────────────────────────────────────────

  function addCase() {
    setCases(prev => [...prev, { id: uid(), citation: '', text: '', file: null }]);
  }

  function removeCase(id: string) {
    setCases(prev => prev.filter(c => c.id !== id));
  }

  function updateCase(id: string, field: keyof CaseEntry, value: unknown) {
    setCases(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  }

  // ── Resolve ────────────────────────────────────────────────────────────────

  async function resolve() {
    const valid = cases.filter(c => c.citation.trim() && (c.text.trim() || c.file));

    if (!resBlock.trim() || !argPara.trim()) {
      setError('The [RESEARCH] block and the argument paragraph are both required.');
      return;
    }
    if (valid.length === 0) {
      setError('Add at least one case with a citation and some text or an uploaded PDF.');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    // Build message content array
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
      content.push({
        type: 'text',
        text: `\n\n═══ CASE ${i + 1}: ${c.citation} ═══`,
      });
      if (c.file) {
        content.push({
          type:   'document',
          source: {
            type:       'base64',
            media_type: c.file.type,
            data:       c.file.data,
          },
        });
      }
      if (c.text.trim()) {
        content.push({ type: 'text', text: c.text.trim() });
      }
    });

    try {
      const text = await callClaude({
        system:
          'You are Senior Counsel at AFS Advocates. You rewrite argument paragraphs using real cases ' +
          'provided by the instructing solicitor. You cite accurately in Nigerian format. ' +
          'You output only the rewritten paragraph — nothing else.',
        messages: [{ role: 'user', content }],
        maxTokens: 2000,
      });

      setResult(text.trim());
    } catch (e) {
      setError((e as Error).message || 'Resolution failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const canResolve = !loading && resBlock.trim().length > 0 && argPara.trim().length > 0;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ animation: 'fadeUp .35s ease', paddingBottom: 48 }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 6 }}>
          <button
            onClick={onBack}
            style={{
              background:    'transparent',
              border:        '1px solid #1e1e2e',
              color:         T.mute,
              borderRadius:  5,
              padding:       '7px 14px',
              fontSize:      11,
              fontFamily:    'Inter, sans-serif',
              cursor:        'pointer',
              marginTop:     6,
              flexShrink:    0,
              transition:    'border-color .15s, color .15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = '#3a3a52';
              (e.currentTarget as HTMLElement).style.color = T.text;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = '#1e1e2e';
              (e.currentTarget as HTMLElement).style.color = T.mute;
            }}
          >
            ← Back
          </button>

          <div>
            <p style={{
              fontSize:      9,
              color:         T.mute,
              letterSpacing: '.2em',
              textTransform: 'uppercase',
              fontFamily:    'Inter, sans-serif',
              marginBottom:  6,
            }}>
              Smart Tools · Research
            </p>
            <h1 style={{
              fontSize:      30,
              color:         '#d4b050',
              fontWeight:    300,
              fontFamily:    "'Cormorant Garamond', serif",
              letterSpacing: '.03em',
              lineHeight:    1.1,
              marginBottom:  8,
            }}>
              Research Resolver
            </h1>
            <p style={{
              fontSize:   14,
              color:      T.dim,
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle:  'italic',
              lineHeight: 1.65,
              maxWidth:   580,
            }}>
              Paste a [RESEARCH] block and its paragraph. Add the cases you found — one at a time,
              as many as the point needs. Get the paragraph rewritten with real citations.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div style={{
          width:      60,
          height:     1,
          background: `linear-gradient(90deg, transparent, ${ACC}, transparent)`,
          margin:     '18px 0',
        }} />
      </div>

      {/* ── HOW IT WORKS strip ── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap:                 10,
        marginBottom:        28,
      }}>
        {[
          { n: '01', label: 'Paste the block', desc: "Copy the [RESEARCH] block exactly as the AI generated it — from any engine output." },
          { n: '02', label: 'Add your cases', desc: 'Paste the text of each case you found, upload the PDF, or both. One entry per case.' },
          { n: '03', label: 'Get the paragraph', desc: 'AI rewrites the paragraph with real Nigerian citations in proper court format.' },
        ].map(step => (
          <div key={step.n} style={{
            background:   '#080810',
            border:       '1px solid #111120',
            borderRadius: 7,
            padding:      '14px 16px',
          }}>
            <div style={{
              fontSize:      9,
              color:         DIM,
              fontFamily:    'Inter, sans-serif',
              letterSpacing: '.14em',
              fontWeight:    700,
              marginBottom:  5,
            }}>
              STEP {step.n}
            </div>
            <div style={{
              fontSize:      13,
              color:         ACC,
              fontFamily:    "'Cormorant Garamond', serif",
              fontWeight:    600,
              marginBottom:  5,
            }}>
              {step.label}
            </div>
            <div style={{
              fontSize:   11,
              color:      T.mute,
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.6,
            }}>
              {step.desc}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── [RESEARCH] Block ── */}
        <div style={{
          background:   '#0d0d18',
          border:       '1px solid #2a2208',
          borderLeft:   `3px solid ${ACC}`,
          borderRadius: '0 8px 8px 0',
          padding:      '20px 22px',
        }}>
          <label style={{
            ...labelStyle,
            color:        ACC,
            letterSpacing: '.12em',
            marginBottom:  6,
          }}>
            [RESEARCH] Block — paste exactly as generated&nbsp;
            <span style={{ color: '#b06060' }}>*</span>
          </label>
          <p style={{
            fontSize:    11,
            color:       DIM,
            fontFamily:  "'Cormorant Garamond', serif",
            fontStyle:   'italic',
            marginBottom: 10,
            lineHeight:  1.6,
          }}>
            Copy the block verbatim including the [RESEARCH] and [/RESEARCH] tags.
          </p>
          <textarea
            value={resBlock}
            onChange={e => setResBlock(e.target.value)}
            rows={6}
            placeholder={
              '[RESEARCH]\n' +
              'Principle: The court has inherent jurisdiction to set aside its own judgment obtained by fraud.\n' +
              'Authority needed: Supreme Court authority establishing the fraud exception to the finality of judgments.\n' +
              'Platform: LawPavilion / NigeriaLII\n' +
              '[/RESEARCH]'
            }
            style={{
              ...taStyle,
              fontFamily: 'Inter, sans-serif',
              fontSize:   12,
              lineHeight: 1.7,
            }}
          />
        </div>

        {/* ── Argument Paragraph ── */}
        <div style={{
          background:   '#0d0d18',
          border:       '1px solid #181828',
          borderRadius: 8,
          padding:      '20px 22px',
        }}>
          <label style={labelStyle}>
            The Argument Paragraph (containing that research block)&nbsp;
            <span style={{ color: '#b06060' }}>*</span>
          </label>
          <p style={{
            fontSize:    11,
            color:       T.mute,
            fontFamily:  "'Cormorant Garamond', serif",
            fontStyle:   'italic',
            marginBottom: 10,
            lineHeight:  1.6,
          }}>
            Paste the full paragraph as generated — including the surrounding argument and the
            [RESEARCH] block within it.
          </p>
          <textarea
            value={argPara}
            onChange={e => setArgPara(e.target.value)}
            rows={7}
            placeholder={
              'It is submitted that the doctrine of estoppel per rem judicatam does not operate to ' +
              'bar this application. [RESEARCH][Principle: The court has inherent jurisdiction to set ' +
              'aside its own judgment obtained by fraud...][/RESEARCH] The Applicant\'s evidence of ' +
              'fraud is particularised in paragraphs 8–14 of the supporting affidavit.'
            }
            style={{ ...taStyle, lineHeight: 1.85 }}
          />
        </div>

        {/* ── Cases / Authorities ── */}
        <div style={{
          background:   '#0d0d18',
          border:       '1px solid #181828',
          borderRadius: 8,
          padding:      '20px 22px',
        }}>
          {/* Section header */}
          <div style={{
            display:        'flex',
            alignItems:     'flex-start',
            justifyContent: 'space-between',
            marginBottom:   16,
          }}>
            <div>
              <p style={{
                fontSize:      10,
                color:         ACC,
                fontFamily:    'Inter, sans-serif',
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                fontWeight:    600,
                marginBottom:  3,
              }}>
                Authorities Found
              </p>
              <p style={{
                fontSize:   12,
                color:      T.mute,
                fontFamily: "'Cormorant Garamond', serif",
                fontStyle:  'italic',
              }}>
                One block per case. Paste the text, upload a PDF, or both. Each case is read
                independently.
              </p>
            </div>
            <button
              onClick={addCase}
              style={{
                background:    'transparent',
                border:        `1px solid ${ACC}`,
                color:         ACC,
                borderRadius:  4,
                padding:       '6px 16px',
                fontSize:      11,
                cursor:        'pointer',
                fontFamily:    'Inter, sans-serif',
                letterSpacing: '.06em',
                flexShrink:    0,
                transition:    'background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d0d00')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              + Add Case
            </button>
          </div>

          {cases.map((c, idx) => (
            <CaseCard
              key={c.id}
              entry={c}
              index={idx}
              removable={cases.length > 1}
              onUpdate={updateCase}
              onRemove={removeCase}
            />
          ))}
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{
            background:   '#180808',
            border:       '1px solid #401818',
            borderRadius: 5,
            padding:      '12px 16px',
          }}>
            <p style={{
              color:      '#c07070',
              fontSize:   13,
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.5,
            }}>
              {error}
            </p>
          </div>
        )}

        {/* ── Resolve Button ── */}
        <button
          onClick={resolve}
          disabled={!canResolve}
          style={{
            background:    canResolve
              ? `linear-gradient(135deg, ${ACC}, ${ACCD})`
              : '#101018',
            color:         canResolve ? '#05050c' : '#2a2a38',
            border:        'none',
            borderRadius:  6,
            padding:       '16px',
            fontSize:      18,
            fontFamily:    "'Cormorant Garamond', serif",
            cursor:        canResolve ? 'pointer' : 'not-allowed',
            fontWeight:    600,
            letterSpacing: '.04em',
            display:       'flex',
            alignItems:    'center',
            justifyContent: 'center',
            gap:           10,
            transition:    'opacity .2s',
          }}
        >
          {loading ? (
            <>
              <span style={{
                width:        14,
                height:       14,
                border:       `2px solid #1e1e2e`,
                borderTop:    `2px solid ${ACC}`,
                borderRadius: '50%',
                display:      'inline-block',
                animation:    'spin .8s linear infinite',
              }} />
              Resolving…
            </>
          ) : (
            'Resolve Citations →'
          )}
        </button>

        {/* ── Result ── */}
        {result && <ResultPanel result={result} />}

      </div>

      {/* Footer */}
      <p style={{
        marginTop:   40,
        fontSize:    11,
        color:       '#1e1e2a',
        textAlign:   'center',
        fontFamily:  'Inter, sans-serif',
        lineHeight:  1.8,
      }}>
        AFS Advocates · Research Resolver — authorities verified by counsel, citations resolved by AI.
      </p>
    </div>
  );
}
