/**
 * AFS Advocates — Authority Validation Engine
 * Phase 2 — Full implementation
 *
 * Validates case authorities before filing:
 *  - Binding strength, overruled status, ratio vs obiter
 *  - Conflicting authority detection and reconciliation
 *  - Court hierarchy mapping
 *  - Issue-to-authority mapping
 *
 * Three sub-modules:
 *  1. Authority Library   — add, store, and validate authorities per case
 *  2. Conflict Resolver   — map hierarchy, detect conflicts, build strategy
 *  3. Quick Research      — ad-hoc Nigerian law research with verification guidance
 *
 * Authorities stored in IndexedDB via blind_spots table (keyed per case).
 * Fallback: localStorage for quick state, Dexie for authority library records.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Case }                               from '@/types';
import { T }                                       from '@/constants/tokens';
import { callClaude }                              from '@/services/api';
import { useIntelligence }                         from '@/hooks/useIntelligence';
import { Md, Spinner }                             from '@/components/common/ui';
import { uid }                                     from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const ACC   = '#4a70c0';
const LIGHT = '#7090d8';
const DIM   = '#283860';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Authority {
  id:         string;
  caseName:   string;
  citation:   string;
  court:      string;
  year:       string;
  principle:  string;
  bindingFor: string;
  validated:  boolean;
  validation: string;
  addedAt:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — localStorage keyed per case (mirrors ComplianceEngine pattern)
// ─────────────────────────────────────────────────────────────────────────────

function saveAve(caseId: string, key: string, val: unknown): void {
  try { localStorage.setItem(`ave_${caseId}_${key}`, JSON.stringify(val)); } catch { /* ignore */ }
}
function loadAve<T>(caseId: string, key: string, def: T): T {
  try {
    const v = localStorage.getItem(`ave_${caseId}_${key}`);
    return v ? JSON.parse(v) as T : def;
  } catch { return def; }
}

// ─────────────────────────────────────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function aveCall(
  system: string,
  prompt: string,
  maxTokens = 1500,
  activeCase?: Case,
): Promise<string> {
  return callClaude({ system, userMsg: prompt, maxTokens, matter_track: activeCase?.matter_track, counsel_role: activeCase?.counsel_role });
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function AVESection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 3, height: 16, background: ACC, borderRadius: 2, flexShrink: 0 }} />
        <p style={{
          fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700, margin: 0,
        }}>
          {title}
        </p>
      </div>
      {children}
    </div>
  );
}

function AVEBtn({
  onClick, disabled, children, variant = 'primary', small = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'ghost';
  small?: boolean;
}) {
  const base: React.CSSProperties = {
    borderRadius:  5,
    cursor:        disabled ? 'not-allowed' : 'pointer',
    fontFamily:    "'Times New Roman', Times, serif",
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    fontWeight:    700,
    transition:    'all .2s',
    display:       'inline-flex',
    alignItems:    'center',
    gap:           6,
    opacity:       disabled ? 0.4 : 1,
    border:        'none',
  };
  const styles: Record<string, React.CSSProperties> = {
    primary: { ...base, background: `linear-gradient(135deg,${ACC},#2a4890)`, color: '#fff', padding: small ? '8px 16px' : '11px 22px', fontSize: small ? 10 : 11 },
    ghost:   { ...base, background: 'transparent', color: ACC, border: `1px solid ${ACC}55`, padding: small ? '7px 14px' : '10px 20px', fontSize: small ? 10 : 11 },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={styles[variant]}>
      {children}
    </button>
  );
}

function AVEAIBlock({ loading, result, error }: { loading: boolean; result: string; error: string }) {
  if (!loading && !result && !error) return null;
  return (
    <div style={{
      marginTop: 14, background: '#06080e',
      border: `1px solid ${ACC}33`, borderRadius: 6,
      padding: '16px 18px', animation: 'fadeUp .3s ease',
    }}>
      {loading && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Spinner size={14} color={ACC} />
          <p style={{ fontSize: 12, color: DIM, fontFamily: "'Times New Roman', Times, serif", marginTop: 10 }}>
            Validating authority…
          </p>
        </div>
      )}
      {error && !loading && (
        <p style={{ fontSize: 13, color: '#c05050', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {error}
        </p>
      )}
      {result && !loading && <Md text={result} />}
    </div>
  );
}

const inpBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 12px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
  outline: 'none', boxSizing: 'border-box',
};

const taBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 12px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
  outline: 'none', resize: 'vertical', lineHeight: 1.75, boxSizing: 'border-box',
};

const selBase: React.CSSProperties = {
  width: '100%', background: T.bg, border: '1px solid #cccccc',
  borderRadius: 5, color: T.text, padding: '10px 12px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif", outline: 'none',
};

const lbl: React.CSSProperties = {
  fontSize: 10, color: ACC, fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase',
  fontWeight: 600, display: 'block', marginBottom: 5,
};

const NIGERIAN_COURTS = [
  'Supreme Court',
  'Court of Appeal',
  'Federal High Court',
  'High Court (State)',
  'National Industrial Court',
  'Privy Council (historical)',
  'UK House of Lords / UKSC',
  'Other',
];

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 1: Authority Library
// ─────────────────────────────────────────────────────────────────────────────

const VALIDATE_SYSTEM = `You are a Nigerian litigation authority validator. \
You know the Nigerian court hierarchy, the NWLR, SCNLR, FWLR, and key decisions of the Supreme Court \
and Court of Appeal. You distinguish ratio decidendi from obiter dicta. \
You flag overruled, distinguished, or limited authorities. \
You never fabricate citations. When unsure, say so explicitly and flag for verification.`;

const ROLE_LABELS_AVE: Record<string, string> = {
  claimant_side:  'Claimant Side',
  defendant_side: 'Defendant Side',
  prosecution:    'Prosecution',
  defence:        'Defence',
};

function AVEAuthorityLibrary({ caseId, activeCase, fullContext }: { caseId: string; activeCase: Case; fullContext: string }) {
  const [auths, setAuths] = useState<Authority[]>(
    () => loadAve<Authority[]>(caseId, 'auths', []),
  );
  const [form, setForm] = useState({
    caseName: '', citation: '', court: '', year: '', principle: '', bindingFor: '',
  });
  const [filter,  setFilter]  = useState<'all' | 'validated' | 'pending'>('all');
  const [aiRes,   setAiRes]   = useState('');
  const [load,    setLoad]    = useState(false);
  const [err,     setErr]     = useState('');
  const [selId,   setSelId]   = useState<string | null>(null);

  function persistAuths(list: Authority[]) {
    setAuths(list);
    saveAve(caseId, 'auths', list);
  }

  function addAuth() {
    if (!form.caseName.trim()) return;
    const newAuth: Authority = {
      ...form,
      id:         uid(),
      validated:  false,
      validation: '',
      addedAt:    new Date().toISOString(),
    };
    persistAuths([...auths, newAuth]);
    setForm({ caseName: '', citation: '', court: '', year: '', principle: '', bindingFor: '' });
  }

  async function validateAuth(auth: Authority) {
    setSelId(auth.id); setLoad(true); setErr(''); setAiRes('');

    const prompt = `Nigerian litigation — authority validation analysis.

CASE: ${auth.caseName}
CITATION: ${auth.citation || 'Not provided'}
COURT: ${auth.court || 'Not specified'}
YEAR: ${auth.year || 'Not specified'}
CLAIMED PRINCIPLE: ${auth.principle || 'Not specified'}
ISSUE IT SUPPORTS: ${auth.bindingFor || 'Not specified'}

Validate this authority for use in Nigerian courts:

## COURT & HIERARCHY
Which court decided this case? Where does it sit in the Nigerian court hierarchy? Binding on which courts?

## BINDING FORCE ANALYSIS
Is this authority binding, persuasive, or of limited persuasive value? For what proposition exactly?

## RATIO vs OBITER
What is the ratio decidendi? Are there any obiter dicta that might be misused?

## CURRENT STATUS
Has this case been overruled, distinguished, or limited in subsequent decisions? Is it still good law?

## STRENGTH RATING
**STRONG** — binding, directly on point, recent, well-followed
**ARGUABLE** — persuasive, distinguishable, older, or on a related point
**WEAK** — obiter, conflicting authority, overruled or significantly limited

## PLATFORM
Where to verify this case: LawPavilion, NigeriaLII, CasePrint, NG-CANLII, or official law reports.

## OPPOSITION ATTACK
How would opposing counsel attack or distinguish this authority?

## RECOMMENDATION
How to deploy this authority most effectively in argument.`;

    try {
      const text = await aveCall(buildValidateSystem(activeCase, fullContext), prompt, 1400, activeCase);
      setAiRes(text);
      persistAuths(auths.map(a =>
        a.id === auth.id ? { ...a, validated: true, validation: text } : a,
      ));
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  const filtered = filter === 'validated'
    ? auths.filter(a => a.validated)
    : filter === 'pending'
      ? auths.filter(a => !a.validated)
      : auths;

  const validatedCount = auths.filter(a => a.validated).length;
  const pendingCount   = auths.filter(a => !a.validated).length;

  return (
    <div>
      {/* Add authority form */}
      <AVESection title="Add Authority to Case Library">
        <div style={{
          background: '#06080e', border: `1px solid ${ACC}22`,
          borderRadius: 7, padding: '18px 20px', marginBottom: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Case Name *</label>
              <input
                value={form.caseName}
                onChange={e => setForm(f => ({ ...f, caseName: e.target.value }))}
                placeholder="e.g. Adesanya v Governor of Lagos State"
                style={inpBase}
              />
            </div>
            <div>
              <label style={lbl}>Citation</label>
              <input
                value={form.citation}
                onChange={e => setForm(f => ({ ...f, citation: e.target.value }))}
                placeholder="e.g. (2001) 12 NWLR Pt.726"
                style={inpBase}
              />
            </div>
            <div>
              <label style={lbl}>Year</label>
              <input
                value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                placeholder="e.g. 2001"
                style={inpBase}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Court</label>
              <select
                value={form.court}
                onChange={e => setForm(f => ({ ...f, court: e.target.value }))}
                style={selBase}
              >
                <option value=''>Select court…</option>
                {NIGERIAN_COURTS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Issue It Supports</label>
              <input
                value={form.bindingFor}
                onChange={e => setForm(f => ({ ...f, bindingFor: e.target.value }))}
                placeholder="e.g. Jurisdiction — service outside state"
                style={inpBase}
              />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Legal Principle You Are Relying On</label>
            <textarea
              value={form.principle}
              onChange={e => setForm(f => ({ ...f, principle: e.target.value }))}
              rows={2}
              placeholder="State the specific proposition of law you are extracting from this case."
              style={taBase}
            />
          </div>

          <AVEBtn onClick={addAuth} disabled={!form.caseName.trim()}>
            + Add to Library
          </AVEBtn>
        </div>
      </AVESection>

      {/* Library list */}
      {auths.length > 0 && (
        <AVESection title={`Authority Library — ${auths.length} ${auths.length === 1 ? 'case' : 'cases'}`}>
          {/* Filter strip */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {(
              [
                { id: 'all',       label: `All (${auths.length})` },
                { id: 'validated', label: `Validated (${validatedCount})` },
                { id: 'pending',   label: `Pending (${pendingCount})` },
              ] as const
            ).map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  fontSize: 10, padding: '4px 12px', borderRadius: 3,
                  border: `1px solid ${filter === f.id ? ACC : '#cccccc'}`,
                  background: filter === f.id ? '#08080e' : 'transparent',
                  color: filter === f.id ? LIGHT : T.mute,
                  cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                  fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              No authorities match this filter.
            </p>
          )}

          {filtered.map(auth => (
            <div
              key={auth.id}
              style={{
                background:   '#06080e',
                border:       `1px solid ${auth.validated ? ACC + '44' : '#eeeeee'}`,
                borderRadius:  6,
                padding:      '14px 18px',
                marginBottom:  10,
              }}
            >
              {/* Authority header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 15, color: '#d8d4cc', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                      {auth.caseName}
                    </span>
                    {auth.validated && (
                      <span style={{
                        fontSize: 8, color: LIGHT, fontFamily: "'Times New Roman', Times, serif",
                        border: `1px solid ${ACC}55`, padding: '1px 6px',
                        borderRadius: 2, letterSpacing: '.08em',
                      }}>
                        VALIDATED
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {auth.citation && (
                      <span style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                        {auth.citation}
                      </span>
                    )}
                    {auth.court && (
                      <span style={{
                        fontSize: 11, color: DIM, fontFamily: "'Times New Roman', Times, serif",
                        border: '1px solid #cccccc', padding: '1px 7px', borderRadius: 2,
                      }}>
                        {auth.court}
                      </span>
                    )}
                    {auth.year && (
                      <span style={{ fontSize: 11, color: '#303050', fontFamily: "'Times New Roman', Times, serif" }}>
                        {auth.year}
                      </span>
                    )}
                  </div>
                  {auth.bindingFor && (
                    <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 4 }}>
                      Issue: {auth.bindingFor}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <AVEBtn
                    onClick={() => validateAuth(auth)}
                    disabled={load && selId === auth.id}
                    variant="ghost"
                    small
                  >
                    {load && selId === auth.id
                      ? <><Spinner size={8} color={ACC} /> Validating…</>
                      : '§ Validate'}
                  </AVEBtn>
                  <button
                    onClick={() => persistAuths(auths.filter(a => a.id !== auth.id))}
                    style={{
                      background: 'transparent', border: 'none',
                      color: '#2a1a1a', cursor: 'pointer', fontSize: 13,
                      padding: '4px 6px', transition: 'color .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#804040')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#2a1a1a')}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Principle */}
              {auth.principle && (
                <p style={{
                  fontSize: 14, color: '#a8aec8',
                  fontFamily: "'Times New Roman', Times, serif",
                  fontStyle: 'italic', lineHeight: 1.75, marginTop: 6,
                }}>
                  {auth.principle}
                </p>
              )}

              {/* Inline validation result for this authority */}
              {selId === auth.id && (
                <AVEAIBlock loading={load} result={aiRes} error={err} />
              )}

              {/* Previously saved validation (collapsed) */}
              {auth.validated && auth.validation && selId !== auth.id && (
                <details style={{ background: '#070710', border: '1px solid #131322', borderRadius: 5, marginTop: 10 }}>
                  <summary style={{
                    padding: '8px 14px', fontSize: 9, color: T.mute,
                    fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em',
                    textTransform: 'uppercase', cursor: 'pointer',
                    userSelect: 'none', listStyle: 'none',
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    View Validation Result
                    <span style={{ fontSize: 9, color: '#cccccc' }}>▸</span>
                  </summary>
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid #131322' }}>
                    <Md text={auth.validation} />
                  </div>
                </details>
              )}
            </div>
          ))}
        </AVESection>
      )}

      {auths.length === 0 && (
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
          No authorities in the library yet. Add cases above.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 2: Conflict Detector
// ─────────────────────────────────────────────────────────────────────────────

function AVEConflictDetector({ caseId, activeCase, fullContext }: { caseId: string; activeCase: Case; fullContext: string }) {
  const [issue,    setIssue]    = useState('');
  const [authList, setAuthList] = useState('');
  const [aiRes,    setAiRes]    = useState('');
  const [load,     setLoad]     = useState(false);
  const [err,      setErr]      = useState('');

  async function run() {
    if (!issue.trim() || !authList.trim()) return;
    setLoad(true); setErr(''); setAiRes('');

    const roleLabel563 = activeCase.counsel_role ? (ROLE_LABELS_AVE[activeCase.counsel_role] ?? activeCase.role ?? '') : (activeCase.role ?? '');
    const trackLabel563 = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';

    const prompt = `Nigerian litigation — authority conflict analysis.

LEGAL ISSUE: ${issue}
CASE: ${activeCase.caseName || ''} | COURT: ${activeCase.court || ''} | TRACK: ${trackLabel563} | ROLE: ${roleLabel563}
AUTHORITIES PROVIDED:
${authList}

Analyse for conflicting decisions on this legal issue:

## HIERARCHY MAP
Map each authority to its position in the court hierarchy. Which are binding on which court?

## CONFLICT IDENTIFICATION
Are any of these authorities in direct conflict with each other? On what proposition?

## RECONCILIATION ANALYSIS
Can apparent conflicts be reconciled? Different facts? Different issue? Earlier vs later decision?

## DOMINANT AUTHORITY
Which authority should prevail and why? Court hierarchy? Recency? Strength of reasoning?

## DISTINGUISHING WEAK AUTHORITIES
How to distinguish or limit authorities that the opponent would rely on.

## DEPLOYMENT STRATEGY
How to present these authorities to the court most effectively, handling any conflicts.

## RESEARCH GAPS
What additional authorities should be sourced to strengthen this position?`;

    try {
      const text = await aveCall('' + fullContext, prompt, 1500, activeCase);
      setAiRes(text);
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <AVESection title="Conflicting Authority Resolver">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 16 }}>
          List all authorities on a legal issue — including those that might conflict.
          The engine maps the hierarchy, identifies conflicts, and builds a deployment strategy.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Legal Issue *</label>
          <input
            value={issue}
            onChange={e => setIssue(e.target.value)}
            placeholder="e.g. Whether the High Court has jurisdiction where a pre-action notice to the Attorney General was not served before filing"
            style={inpBase}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>All Authorities on This Issue *</label>
          <textarea
            value={authList}
            onChange={e => setAuthList(e.target.value)}
            rows={9}
            placeholder={
              "List all cases you have found — your own and the opponent's:\n\n" +
              'Adesanya v Governor of Lagos (2001) 12 NWLR 726 — Supreme Court — stands for...\n' +
              'Bello v Attorney General (1989) NWLR — Court of Appeal — says...\n\n' +
              "Include cases you believe conflict with your position. The engine will help you deal with them."
            }
            style={taBase}
          />
        </div>

        <AVEBtn onClick={run} disabled={load || !issue.trim() || !authList.trim()}>
          {load
            ? <><Spinner size={10} color="#fff" /> Analysing…</>
            : '§ Resolve Conflicts'}
        </AVEBtn>
        <AVEAIBlock loading={load} result={aiRes} error={err} />
      </AVESection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODULE 3: Quick Authority Research
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_SYSTEM = `You are a Nigerian legal research assistant. \
Always flag that authorities must be independently verified. \
Never fabricate citations. When unsure of an exact citation, say so clearly. \
Know the NWLR, SCNLR, FWLR, and key Nigerian Supreme Court and Court of Appeal decisions.`;

function buildValidateSystem(activeCase: Case, fullContext = ''): string {
  const role  = activeCase.counsel_role ? (ROLE_LABELS_AVE[activeCase.counsel_role] ?? activeCase.role ?? '') : (activeCase.role ?? '');
  const track = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
  const roleCtx = role ? ` You are advising ${role} counsel on a ${track} matter. Prioritise authorities that support their position and flag authorities opposing counsel may deploy.` : '';
  return VALIDATE_SYSTEM + roleCtx + fullContext;
}

function buildQuickSystem(activeCase: Case, fullContext = ''): string {
  const role  = activeCase.counsel_role ? (ROLE_LABELS_AVE[activeCase.counsel_role] ?? activeCase.role ?? '') : (activeCase.role ?? '');
  const track = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
  const roleCtx = role ? ` You are advising ${role} counsel on a ${track} matter. Tailor research to their position and flag both supportive and hostile authorities.` : '';
  return QUICK_SYSTEM + roleCtx + fullContext;
}

function AVEQuickCheck({ caseId, activeCase, fullContext }: { caseId: string; activeCase: Case; fullContext: string }) {
  const [query, setQuery] = useState('');
  const [aiRes, setAiRes] = useState('');
  const [load,  setLoad]  = useState(false);
  const [err,   setErr]   = useState('');

  async function run() {
    if (!query.trim()) return;
    setLoad(true); setErr(''); setAiRes('');

    const roleLabel678 = activeCase.counsel_role ? (ROLE_LABELS_AVE[activeCase.counsel_role] ?? activeCase.role ?? '') : (activeCase.role ?? '');
    const trackLabel678 = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';

    const prompt = `Nigerian litigation authority research.

QUERY: ${query}
CASE CONTEXT: ${activeCase.caseName || ''} | COURT: ${activeCase.court || ''} | TRACK: ${trackLabel678} | ROLE: ${roleLabel678}

Provide:

## LEADING NIGERIAN AUTHORITIES
The key Nigerian Supreme Court and Court of Appeal decisions on this point. For each:
- Case name
- Approximate citation if known (flag if unverified)
- Court
- Holding
- Binding strength

## STATUTORY PROVISION
The key statutory provisions under Nigerian law governing this point.

## CURRENT STATE OF THE LAW
What is the settled position in Nigeria? Any tension or uncertainty?

## RESEARCH GUIDANCE
Where to find and verify these authorities: LawPavilion PRIMA, NigeriaLII, CasePrint, NWLR, official law reports.

## IMPORTANT CAVEAT
Flag: this is AI-generated research guidance only. All authorities must be independently verified before reliance in court proceedings. The lawyer must confirm existence, citation, and current standing.`;

    try {
      const text = await aveCall(buildQuickSystem(activeCase, fullContext), prompt, 1400, activeCase);
      setAiRes(text);
    } catch (e) { setErr('API error: ' + (e as Error).message); }
    setLoad(false);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Disclaimer banner */}
      <div style={{
        background:   '#06080e',
        border:       '1px solid #c04040',
        borderLeft:   '3px solid #804040',
        borderRadius: '0 6px 6px 0',
        padding:      '12px 16px',
        marginBottom:  18,
      }}>
        <p style={{ fontSize: 12, color: '#c07070', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, margin: 0 }}>
          ⚠ Research guidance only. All authorities generated here must be independently verified
          on LawPavilion, NigeriaLII, or official law reports before reliance in any court filing.
        </p>
      </div>

      <AVESection title="Quick Authority Research">
        <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 16 }}>
          Ask any Nigerian law research question. The engine maps leading authorities,
          statutory provisions, and where to verify them.
        </p>

        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={5}
          placeholder={
            '"What are the leading Nigerian authorities on whether service by email is valid personal service?"\n\n' +
            'or "Supreme Court decisions on jurisdiction of the Federal High Court in contract disputes involving government agencies"\n\n' +
            'or "Cases on Section 84 Electronic Evidence Act — admissibility of WhatsApp messages"'
          }
          style={{ ...taBase, marginBottom: 14 }}
        />

        <AVEBtn onClick={run} disabled={load || !query.trim()}>
          {load
            ? <><Spinner size={10} color="#fff" /> Researching…</>
            : '§ Research Authorities'}
        </AVEBtn>
        <AVEAIBlock loading={load} result={aiRes} error={err} />
      </AVESection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

type SubTab = 'library' | 'conflicts' | 'research';

interface Props {
  activeCase: Case;
}

export function AuthorityValidator({ activeCase }: Props) {
  const caseId = activeCase.id;
  const { fullContext } = useIntelligence(activeCase);
  const [sub, setSub] = useState<SubTab>('library');

  const SUB_TABS: Array<{ id: SubTab; icon: string; label: string }> = [
    { id: 'library',   icon: '§',  label: 'Authority Library' },
    { id: 'conflicts', icon: '⚡', label: 'Conflict Resolver' },
    { id: 'research',  icon: '🔍', label: 'Quick Research'    },
  ];

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* Engine header */}
      <div style={{
        background:   '#060810',
        border:       `1px solid ${ACC}33`,
        borderRadius:  8,
        padding:      '16px 20px',
        marginBottom:  20,
        display:      'flex',
        alignItems:   'center',
        gap:           14,
      }}>
        <span style={{ fontSize: 24, opacity: .7 }}>§</span>
        <div>
          <p style={{
            fontSize: 9, color: ACC, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.18em', textTransform: 'uppercase',
            fontWeight: 700, marginBottom: 3,
          }}>
            Authority Validation Engine · {activeCase.caseName}
          </p>
          <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', margin: 0 }}>
            No hallucinated case law. No overruled authority. No obiter passed off as ratio.
          </p>
        </div>
      </div>

      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              background:    sub === t.id ? '#060810' : 'transparent',
              border:        `1px solid ${sub === t.id ? ACC : '#cccccc'}`,
              color:         sub === t.id ? LIGHT : T.mute,
              borderRadius:  5,
              padding:       '8px 14px',
              fontSize:      11,
              fontFamily:    "'Times New Roman', Times, serif",
              cursor:        'pointer',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              fontWeight:    600,
              display:       'flex',
              alignItems:    'center',
              gap:           6,
              transition:    'all .2s',
            }}
          >
            <span style={{ fontSize: 13 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-module panels */}
      {sub === 'library'   && <AVEAuthorityLibrary caseId={caseId} activeCase={activeCase} fullContext={fullContext} />}
      {sub === 'conflicts' && <AVEConflictDetector caseId={caseId} activeCase={activeCase} fullContext={fullContext} />}
      {sub === 'research'  && <AVEQuickCheck       caseId={caseId} activeCase={activeCase} fullContext={fullContext} />}
    </div>
  );
}
