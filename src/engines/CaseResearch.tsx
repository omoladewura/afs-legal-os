/**
 * AFS Advocates — Case Law Research Module
 * Phase 2 — Full implementation
 *
 * Per-case Nigerian legal research hub.
 *
 * Three research modes:
 *  1. Topic Search   — leading Nigerian authorities on any legal topic
 *  2. Statute Search — judicial interpretation of a specific statute/section
 *  3. Saved Authorities — case-level research library (IndexedDB)
 *
 * All saved records stored in the `research` IndexedDB table via helpers.
 * Disclaimer on every AI result: verify before court use.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Case }                               from '@/types';
import { T }                                       from '@/constants/tokens';
import { callClaude }                              from '@/services/api';
import { Md, Spinner }                             from '@/components/common/ui';
import { uid }                                     from '@/utils';
import {
  loadResearch,
  saveResearchItem,
  deleteResearchItem,
} from '@/storage/helpers';
import type { ResearchRecord }                     from '@/storage/db';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const ACC   = '#c4a030';
const LIGHT = '#d4b050';
const DIM   = '#4a3810';

// ─────────────────────────────────────────────────────────────────────────────
async function runResearchPrompt(
  system: string,
  userPrompt: string,
): Promise<string> {
  return callClaude({ system, userMsg: userPrompt, maxTokens: 2000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize:      10,
  color:         ACC,
  fontFamily:    'Inter, sans-serif',
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  fontWeight:    600,
  display:       'block',
  marginBottom:  6,
};

const inputStyle: React.CSSProperties = {
  width:       '100%',
  background:  T.bg,
  border:      '1px solid #1e1e2e',
  borderRadius: 5,
  color:        T.text,
  padding:     '11px 14px',
  fontSize:    14,
  fontFamily:  "'Cormorant Garamond', serif",
  outline:     'none',
  boxSizing:   'border-box',
};

const taStyle: React.CSSProperties = {
  ...inputStyle,
  resize:     'vertical',
  lineHeight: 1.75,
  minHeight:  90,
};

function RunBtn({
  onClick, disabled, loading, label,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background:    disabled || loading
          ? '#101018'
          : `linear-gradient(135deg, ${ACC}, #a07820)`,
        color:         disabled || loading ? '#2a2a38' : '#05050c',
        border:        'none',
        borderRadius:  5,
        padding:       '10px 22px',
        fontSize:      13,
        fontFamily:    "'Cormorant Garamond', serif",
        cursor:        disabled || loading ? 'not-allowed' : 'pointer',
        fontWeight:    600,
        letterSpacing: '.04em',
        display:       'flex',
        alignItems:    'center',
        gap:           8,
      }}
    >
      {loading
        ? <><Spinner size={10} color={ACC} /> Processing…</>
        : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT PANEL — shows AI output with save controls
// ─────────────────────────────────────────────────────────────────────────────

interface ResultPanelProps {
  result:    string;
  loading:   boolean;
  error:     string;
  onSave:    (note: string) => void;
}

function ResultPanel({ result, loading, error, onSave }: ResultPanelProps) {
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave(note);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!loading && !result && !error) return null;

  return (
    <div style={{
      marginTop:   20,
      background:  '#080810',
      border:      `1px solid ${ACC}33`,
      borderRadius: 8,
      padding:     '20px 22px',
      animation:   'fadeUp .3s ease',
    }}>
      {/* Header bar */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        justifyContent: 'space-between',
        marginBottom:  16,
        paddingBottom: 12,
        borderBottom:  `1px solid ${ACC}22`,
        flexWrap:      'wrap',
        gap:           10,
      }}>
        <p style={{
          fontSize:      9,
          color:         ACC,
          fontFamily:    'Inter, sans-serif',
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          fontWeight:    600,
          margin:        0,
        }}>
          Research Result
        </p>
        {result && !loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)…"
              style={{
                background:   '#0d0d18',
                border:       '1px solid #1e1e2e',
                borderRadius: 4,
                color:        T.text,
                padding:      '4px 10px',
                fontSize:     12,
                fontFamily:   'Inter, sans-serif',
                outline:      'none',
                width:        160,
              }}
            />
            <button
              onClick={handleSave}
              style={{
                background:    saved ? '#0a1a06' : 'transparent',
                border:        `1px solid ${saved ? '#3a5028' : ACC + '55'}`,
                color:         saved ? '#60b040' : ACC,
                borderRadius:  4,
                padding:       '5px 14px',
                fontSize:      10,
                fontFamily:    'Inter, sans-serif',
                cursor:        'pointer',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                fontWeight:    600,
                transition:    'all .2s',
                whiteSpace:    'nowrap',
              }}
            >
              {saved ? '✓ Saved' : '◉ Save to Case'}
            </button>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spinner size={20} color={ACC} />
          <p style={{
            fontSize:   12,
            color:      DIM,
            fontFamily: 'Inter, sans-serif',
            marginTop:  12,
          }}>
            Researching Nigerian authorities…
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <p style={{ fontSize: 13, color: '#c05050', fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
          {error}
        </p>
      )}

      {/* Result */}
      {result && !loading && (
        <>
          <div style={{
            fontSize:    13,
            color:       '#9a8a50',
            fontFamily:  'Inter, sans-serif',
            fontStyle:   'italic',
            marginBottom: 14,
            lineHeight:  1.5,
          }}>
            ⚠ Research guidance only — verify all citations independently before reliance in court proceedings.
          </div>
          <Md text={result} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE: Topic Search
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_SYSTEM = `You are a senior Nigerian legal researcher. You know Nigerian case law, \
the NWLR, SCNLR, FWLR, and key decisions of all superior courts. \
You are precise and honest about citation uncertainty — never fabricate case names or citations. \
When unsure of a citation, say so clearly and flag it for verification.`;

interface TopicSearchProps {
  activeCase: Case;
  onSave: (query: string, result: string, note: string) => void;
}

function TopicSearch({ activeCase, onSave }: TopicSearchProps) {
  const [query,   setQuery]   = useState('');
  const [result,  setResult]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function run() {
    if (!query.trim()) return;
    setLoading(true); setError(''); setResult('');

    const caseCtx = activeCase
      ? `\n\nCase context: ${activeCase.caseName} | Court: ${activeCase.court || 'Not specified'} | Role: ${activeCase.role || 'Not specified'}`
      : '';

    const prompt = `Nigerian litigation case law research.\n\nRESEARCH QUERY: ${query}${caseCtx}\n\n\
Provide:\n\n## LEADING AUTHORITIES\n\
For each leading Nigerian case on this topic:\n\
**Case Name** | Court | Approximate year\n\
Citation: [NWLR/SCNLR/FWLR citation if known — state if unverified]\n\
Holding: What the case decided on this specific point.\n\
Binding strength: Binding on all lower courts / Binding on courts below Court of Appeal / Persuasive\n\
Where to find: LawPavilion / NigeriaLII / NIALS\n\n\
## STATUTORY PROVISIONS\n\
Any statute sections directly applicable to this topic.\n\n\
## KEY PRINCIPLES ESTABLISHED\n\
The settled legal propositions flowing from these authorities.\n\n\
## RESEARCH GAPS\n\
What authoritative decisions are still needed — where the law is unsettled or contested.\n\n\
## VERIFICATION NOTE\n\
Flag any citations that require independent verification before reliance in court.\n\n\
Be precise about Nigerian law. Do not fabricate citations. If unsure of a citation, say so explicitly.`;

    try {
      const text = await runResearchPrompt(TOPIC_SYSTEM, prompt);
      setResult(text);
    } catch (e) {
      setError('Research error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Research Query *</label>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={4}
          placeholder={
            'e.g. Leading authorities on the right to fair hearing under Section 36 CFRN\n\n' +
            'or: Cases on admissibility of electronically generated documents under Section 84 Evidence Act 2011\n\n' +
            'or: Supreme Court decisions on when an objection to jurisdiction is waived'
          }
          style={taStyle}
        />
      </div>
      <RunBtn
        onClick={run}
        disabled={!query.trim()}
        loading={loading}
        label="🔍 Research This Topic"
      />
      <ResultPanel
        result={result}
        loading={loading}
        error={error}
        onSave={note => result && onSave(query, result, note)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE: Statute Search
// ─────────────────────────────────────────────────────────────────────────────

const STATUTE_SYSTEM = `You are a Nigerian legislative and judicial analyst. You know the Evidence Act 2011, \
Companies and Allied Matters Act, Land Use Act, Limitation Laws, Administration of Criminal Justice Act, \
Rules of Court for all Nigerian courts, and all major Nigerian statutes. \
Be precise. Flag citation uncertainties. Never fabricate interpretations.`;

interface StatuteSearchProps {
  activeCase: Case;
  onSave: (query: string, result: string, note: string) => void;
}

function StatuteSearch({ activeCase, onSave }: StatuteSearchProps) {
  const [statute,  setStatute]  = useState('');
  const [section,  setSection]  = useState('');
  const [result,   setResult]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function run() {
    if (!statute.trim()) return;
    setLoading(true); setError(''); setResult('');

    const prompt = `Nigerian statute analysis.\n\nSTATUTE: ${statute}\n${section ? `SECTION/PROVISION: ${section}\n` : ''}\
Case context: ${activeCase?.caseName || 'General'} | Court: ${activeCase?.court || 'Not specified'}\n\n\
Provide:\n\n## STATUTORY TEXT\n\
The relevant section(s) — quote the actual provision.\n\n\
## JUDICIAL INTERPRETATION\n\
Leading Nigerian cases interpreting this provision:\n\
**Case Name** | Court | Citation (if known)\n\
What the court held about this section.\n\n\
## SCOPE & LIMITS\n\
What the provision covers, what it excludes, and any judicial carve-outs.\n\n\
## RELATED PROVISIONS\n\
Other sections of this statute or related statutes that interact with this provision.\n\n\
## RECENT DEVELOPMENTS\n\
Any recent appellate decisions that have shifted or clarified the interpretation.\n\n\
## PRACTICAL APPLICATION\n\
How this provision typically operates in litigation — what courts look for, common arguments.\n\n\
Cite Nigerian statutes precisely. Flag citation uncertainty.`;

    try {
      const text = await runResearchPrompt(STATUTE_SYSTEM, prompt);
      setResult(text);
    } catch (e) {
      setError('Research error: ' + (e as Error).message);
    }
    setLoading(false);
  }

  const savedQuery = statute + (section ? ` s.${section}` : '');

  return (
    <div>
      <div style={{
        display:             'grid',
        gridTemplateColumns: '2fr 1fr',
        gap:                 12,
        marginBottom:        14,
      }}>
        <div>
          <label style={labelStyle}>Statute *</label>
          <input
            value={statute}
            onChange={e => setStatute(e.target.value)}
            placeholder="e.g. Evidence Act 2011 / Companies and Allied Matters Act / Land Use Act"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Section / Provision</label>
          <input
            value={section}
            onChange={e => setSection(e.target.value)}
            placeholder="e.g. s. 84 / s. 149"
            style={inputStyle}
          />
        </div>
      </div>
      <RunBtn
        onClick={run}
        disabled={!statute.trim()}
        loading={loading}
        label="§ Analyse Statute"
      />
      <ResultPanel
        result={result}
        loading={loading}
        error={error}
        onSave={note => result && onSave(savedQuery, result, note)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE: Saved Authorities
// ─────────────────────────────────────────────────────────────────────────────

interface SavedAuthoritiesProps {
  caseId:  string;
  records: ResearchRecord[];
  onDelete: (id: string) => void;
}

function SavedAuthorities({ caseId, records, onDelete }: SavedAuthoritiesProps) {
  if (records.length === 0) {
    return (
      <div style={{
        textAlign:    'center',
        padding:      '60px 24px',
        background:   '#080810',
        border:       '1px solid #111120',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 36, opacity: .06, marginBottom: 14 }}>🔍</div>
        <p style={{
          fontSize:   17,
          color:      T.dim,
          fontFamily: "'Cormorant Garamond', serif",
          fontStyle:  'italic',
          marginBottom: 6,
        }}>
          No saved research yet.
        </p>
        <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
          Run a topic or statute search and save results to build this case's research library.
        </p>
      </div>
    );
  }

  return (
    <div>
      {records.map(item => (
        <div
          key={item.id}
          style={{
            background:   '#0d0d18',
            border:       '1px solid #181828',
            borderRadius: 8,
            padding:      '16px 18px',
            marginBottom: 10,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
              {item.type === 'statute' ? '§' : '🔍'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize:   15,
                color:      T.text,
                fontFamily: "'Cormorant Garamond', serif",
                fontWeight: 600,
                marginBottom: 3,
              }}>
                {item.query}
              </p>
              {item.note && (
                <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', fontStyle: 'italic' }}>
                  {item.note}
                </p>
              )}
              <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', marginTop: 3 }}>
                {new Date(item.savedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </p>
            </div>
            <button
              onClick={() => onDelete(item.id)}
              style={{
                background:  'transparent',
                border:      'none',
                color:       '#2a1a1a',
                cursor:      'pointer',
                fontSize:    14,
                padding:     '2px 4px',
                flexShrink:  0,
                lineHeight:  1,
                transition:  'color .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#804040')}
              onMouseLeave={e => (e.currentTarget.style.color = '#2a1a1a')}
            >
              ✕
            </button>
          </div>

          {/* Expandable result */}
          <details style={{ background: '#070710', border: '1px solid #131322', borderRadius: 5 }}>
            <summary style={{
              padding:       '8px 14px',
              fontSize:      9,
              color:         T.mute,
              fontFamily:    'Inter, sans-serif',
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              cursor:        'pointer',
              userSelect:    'none',
              listStyle:     'none',
              display:       'flex',
              justifyContent: 'space-between',
            }}>
              View Research Result
              <span style={{ fontSize: 9, color: '#2a2a3e' }}>▸</span>
            </summary>
            <div style={{ padding: '0 16px 14px', borderTop: '1px solid #131322' }}>
              <div style={{
                marginTop:    12,
                fontSize:     12,
                color:        '#7a6a30',
                fontFamily:   'Inter, sans-serif',
                fontStyle:    'italic',
                marginBottom: 10,
              }}>
                ⚠ Verify all citations independently before reliance in court.
              </div>
              <Md text={item.result} />
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

type SubTab = 'topic' | 'statute' | 'saved';

export function CaseResearch({ activeCase }: Props) {
  const caseId = activeCase.id;

  const [sub,     setSub]     = useState<SubTab>('topic');
  const [records, setRecords] = useState<ResearchRecord[]>([]);

  // Load saved research on mount / case change
  useEffect(() => {
    loadResearch(caseId).then(setRecords);
  }, [caseId]);

  const handleSave = useCallback(
    async (query: string, result: string, note: string, type: 'topic' | 'statute') => {
      const item: ResearchRecord = {
        id:      uid(),
        caseId,
        query,
        type,
        result,
        note,
        savedAt: new Date().toISOString(),
      };
      const ok = await saveResearchItem(item);
      if (ok) setRecords(prev => [item, ...prev]);
    },
    [caseId],
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteResearchItem(id);
    setRecords(prev => prev.filter(r => r.id !== id));
  }, []);

  const SUB_TABS: Array<{ id: SubTab; icon: string; label: string }> = [
    { id: 'topic',   icon: '🔍', label: 'Topic Search'    },
    { id: 'statute', icon: '§',  label: 'Statute Search'  },
    { id: 'saved',   icon: '◉',  label: `Saved (${records.length})` },
  ];

  return (
    <div style={{ paddingBottom: 40, animation: 'fadeUp .3s ease' }}>

      {/* Header */}
      <div style={{
        background:   '#0b0900',
        border:       `1px solid ${ACC}33`,
        borderRadius:  8,
        padding:      '16px 20px',
        marginBottom:  20,
        display:      'flex',
        alignItems:   'center',
        gap:           14,
      }}>
        <span style={{ fontSize: 24, opacity: .7 }}>🔍</span>
        <div>
          <p style={{
            fontSize:      9,
            color:         ACC,
            fontFamily:    'Inter, sans-serif',
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight:    700,
            marginBottom:  3,
          }}>
            Case Law Research · {activeCase.caseName}
          </p>
          <p style={{
            fontSize:   13,
            color:      T.mute,
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle:  'italic',
            margin:     0,
          }}>
            Nigerian authorities and statute analysis — tied to this matter and saved to this case file.
          </p>
        </div>
      </div>

      {/* Sub-tab strip */}
      <div style={{
        display:      'flex',
        gap:          3,
        marginBottom: 22,
        background:   '#050508',
        border:       '1px solid #111120',
        borderRadius: 7,
        padding:      3,
      }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              flex:          1,
              background:    sub === t.id ? '#0d0d1c' : 'transparent',
              border:        `1px solid ${sub === t.id ? ACC : 'transparent'}`,
              color:         sub === t.id ? ACC : T.mute,
              borderRadius:  5,
              padding:       '8px 12px',
              fontSize:      10,
              fontFamily:    'Inter, sans-serif',
              cursor:        'pointer',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              fontWeight:    600,
              transition:    'all .2s',
              display:       'flex',
              alignItems:    'center',
              justifyContent: 'center',
              gap:           5,
            }}
          >
            <span style={{ opacity: .85 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-module panels */}
      {sub === 'topic' && (
        <TopicSearch
          activeCase={activeCase}
          onSave={(q, r, n) => handleSave(q, r, n, 'topic')}
        />
      )}

      {sub === 'statute' && (
        <StatuteSearch
          activeCase={activeCase}
          onSave={(q, r, n) => handleSave(q, r, n, 'statute')}
        />
      )}

      {sub === 'saved' && (
        <SavedAuthorities
          caseId={caseId}
          records={records}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
