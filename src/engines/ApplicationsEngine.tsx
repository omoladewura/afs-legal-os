/**
 * AFS Legal OS V2 — Applications Engine (Phase B)
 *
 * Universal applications drafter. Available to all four roles across
 * civil and criminal matters. Intent-driven four-step workflow:
 *
 *   Step 1 — Intent       : lawyer describes what they want in plain language
 *   Step 2 — Classification: Claude classifies → type, package, gaps. Lawyer confirms.
 *   Step 3 — New Facts    : optional developments since Intelligence Engine last ran
 *   Step 4 — Generation   : one Claude call builds the complete document package
 *
 * Supported packages:
 *   Civil   — Motion Ex Parte | Motion on Notice | Opposition to Motion
 *   Criminal— Bail Application | Preliminary Objection/Quash Charge | Stay of Proceedings
 *   Appeal  — Extension of Time | Stay of Execution | Deem Notice / Regularise Records
 *
 * Storage: saveBlindSpot key `applications_${caseId}` (version history array).
 * Dedicated D1 via Worker: PUT /application | GET /applications?caseId=x | DELETE /application?id=x
 * AI: useAI(activeCase)
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS, MATTER_TRACK_COLORS } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type MainTab = 'new' | 'history';
type Step    = 1 | 2 | 3 | 4;

interface Classification {
  appType:          string;
  packageRequired:  string[];
  informationGaps:  string[];
  recommendation:   string;
}

interface ApplicationRecord {
  id:         string;
  caseId:     string;
  appType:    string;
  intent:     string;
  newFacts:   string;
  documents:  string;
  createdAt:  string;
}

interface SavedData {
  history: ApplicationRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MODULE = 'applications';

const DEFAULT_DATA: SavedData = { history: [] };

const WORKER_URL   = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const WORKER_TOKEN = 'AFS2026SecureToken99';

// All supported application types with their expected document packages
const APPLICATION_CATALOGUE: Record<string, string[]> = {
  'Civil — Motion Ex Parte':             ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
  'Civil — Motion on Notice':            ['Motion Paper', 'Supporting Affidavit', 'Written Address in Support', 'List of Authorities'],
  'Civil — Opposition to Motion':        ['Counter-Affidavit', 'Written Address in Opposition', 'List of Authorities'],
  'Criminal — Bail Application':         ['Formal Application', 'Affidavit in Support', 'Written Address', 'Proposed Bail Conditions'],
  'Criminal — Preliminary Objection':    ['Notice of Preliminary Objection', 'Written Address'],
  'Criminal — Stay of Proceedings':      ['Motion on Notice', 'Affidavit', 'Written Address'],
  'Appeal — Extension of Time':          ['Motion on Notice', 'Affidavit Explaining Delay', 'Written Address', 'Proposed Notice of Appeal'],
  'Appeal — Stay of Execution':          ['Motion on Notice', 'Affidavit', 'Written Address'],
  'Appeal — Regularise Records':         ['Motion on Notice', 'Affidavit', 'Written Address'],
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKER HELPERS (D1 persistence for application records)
// ─────────────────────────────────────────────────────────────────────────────

async function workerSaveApplication(record: ApplicationRecord): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/application`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WORKER_TOKEN}` },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* offline — local save is the source of truth */ }
}

async function workerLoadApplications(caseId: string): Promise<ApplicationRecord[]> {
  try {
    const res = await fetch(`${WORKER_URL}/applications?caseId=${encodeURIComponent(caseId)}`, {
      headers: { 'Authorization': `Bearer ${WORKER_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { records?: ApplicationRecord[] };
    return data.records ?? [];
  } catch { return []; }
}

async function workerDeleteApplication(id: string): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/application?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${WORKER_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* offline — local save handles it */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Btn({
  label, onClick, loading = false, accent = '#4090d0', off = false, small = false,
}: {
  label: string; onClick: () => void; loading?: boolean; accent?: string; off?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || off}
      style={{
        background: loading || off ? '#101018' : `linear-gradient(135deg,#000000,${accent})`,
        color:   loading || off ? '#2a2a38' : '#f0ece0',
        border: 'none', borderRadius: 6,
        padding: small ? '7px 16px' : '11px 26px',
        fontSize: small ? 12 : 14,
        fontFamily: "'Times New Roman', Times, serif",
        cursor: loading || off ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function StepBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: '50%',
      background: active ? '#4090d0' : '#181828',
      color: active ? '#fff' : '#505068',
      fontWeight: 700, fontSize: 13, border: `1px solid ${active ? '#4090d0' : '#282840'}`,
    }}>{n}</span>
  );
}

function MandatoryNotice() {
  return (
    <div style={{
      background: '#1a1000', border: '1px solid #5a3800', borderRadius: 6,
      padding: '10px 14px', marginTop: 18, fontSize: 12, color: '#c09040',
      lineHeight: 1.6,
    }}>
      <strong>⚠ Counsel Review Required.</strong> These drafts are AI-generated starting points.
      All documents must be reviewed and settled by counsel before filing. Any affidavit
      must be duly sworn before a Commissioner for Oaths or other competent authority
      before it may be used in proceedings.
    </div>
  );
}

function ClassificationTag({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{
      display: 'inline-block', background: `${accent}22`, border: `1px solid ${accent}55`,
      color: accent, borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600,
      marginRight: 6, marginBottom: 4,
    }}>{text}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildClassificationPrompt(
  intent: string,
  matterTrack: string,
  counselRole: string,
  court: string,
): string {
  return `You are classifying an application request from a Nigerian lawyer.

MATTER CONTEXT:
- Track: ${matterTrack}
- Role: ${counselRole}
- Court: ${court}

LAWYER'S INTENT:
"${intent}"

AVAILABLE APPLICATION TYPES:
Civil: Motion Ex Parte | Motion on Notice | Opposition to Motion
Criminal: Bail Application | Preliminary Objection | Stay of Proceedings
Appeal: Extension of Time | Stay of Execution | Regularise Records

Classify this request and respond with ONLY valid JSON in this exact format:
{
  "appType": "<one of the exact types listed above, prefixed with track, e.g. 'Civil — Motion on Notice'>",
  "packageRequired": ["<document 1>", "<document 2>", "..."],
  "informationGaps": ["<gap 1>", "<gap 2>"],
  "recommendation": "<one concise sentence on the critical strategic point for this application>"
}

For informationGaps, list specific facts or documents the lawyer needs to provide for a complete draft. Keep to 3–5 gaps maximum. If none, return an empty array.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildGenerationPrompt(
  appType: string,
  intent: string,
  newFacts: string,
  classification: Classification,
  activeCase: Case,
): string {
  const caseName  = activeCase.caseName;
  const court     = activeCase.court;
  const suitNo    = activeCase.suitNo;
  const track     = activeCase.matter_track ?? 'civil';
  const role      = activeCase.counsel_role ?? 'claimant_side';
  const intPkg    = activeCase.intelligence_data?.intPkg ?? '';

  const claimants  = activeCase.claimants.map(p => p.name).join(', ') || 'Claimant';
  const defendants = activeCase.defendants.map(p => p.name).join(', ') || 'Defendant';

  const partyBlock = track === 'criminal'
    ? `Prosecution: ${claimants}\nDefendant/Accused: ${defendants}`
    : `Claimant(s): ${claimants}\nDefendant(s): ${defendants}`;

  const packageList = classification.packageRequired.join(', ');

  return `You are drafting a complete application package for a Nigerian court. Draft every document in the package in full — no placeholders, no "[to be filled]", no partial outlines. Every document must be ready for counsel to review and file.

CASE DETAILS:
Case Name: ${caseName}
Suit No: ${suitNo || '[Suit No. to be assigned]'}
Court: ${court}
${partyBlock}
Matter Track: ${track}
Counsel Role: ${role}

APPLICATION TYPE: ${appType}
DOCUMENTS TO DRAFT: ${packageList}

LAWYER'S INSTRUCTIONS:
"${intent}"
${newFacts ? `\nNEW DEVELOPMENTS:\n"${newFacts}"` : ''}
${intPkg ? `\nINTELLIGENCE PACKAGE (established facts and issues):\n${intPkg.slice(0, 2000)}` : ''}

DRAFTING RULES — MANDATORY:
1. Draft every document in the package in full, in sequence.
2. Use Nigerian court heading format: correct court name, suit number, parties, date lines.
3. Use precise Nigerian procedural language and correct statutory references.
4. For any affidavit: use numbered paragraphs, first-person deponent voice, correct jurat line ("Sworn to at _____ this ___ day of ______ 20__ / Before me: ___________  Commissioner for Oaths").
5. For written addresses: use formal address structure (Introduction → Issues for Determination → Argument → Conclusion and Relief). Cite only real, verifiable Nigerian authorities — do NOT invent case names.
6. For bail applications: address community ties, flight risk, gravity of offence, health, dependants, and prosecution strength (without conceding guilt). Cite Dokubo-Asari v FRN, Ani v State, Bamaiyi v State where applicable.
7. For extension of time: account for every day of delay in the affidavit. Apply the two-condition test from Bowaje v Adediwura.
8. For stay of execution pending appeal: address three conditions — good grounds of appeal, special circumstances, balance of hardship.
9. For preliminary objection: address jurisdiction, charge duplicity, wrong statute, vague particulars, or missing elements as applicable.
10. After each document, insert a horizontal line (---) before the next document.
11. Library Rule: every legal proposition must be supported by a cited authority in your library or a major Nigerian statute. Do not fabricate citations.

Begin drafting now. Do not add any preamble — go straight to the first document heading.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ApplicationsEngine({ activeCase }: Props) {
  const { ask, loading, error, clearError } = useAI(activeCase);

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState<MainTab>('new');

  // ── Workflow state ─────────────────────────────────────────────────────────
  const [step,           setStep]           = useState<Step>(1);
  const [intent,         setIntent]         = useState('');
  const [classification, setClassification] = useState<Classification | null>(null);
  const [classRaw,       setClassRaw]       = useState('');
  const [classError,     setClassError]     = useState('');
  const [confirmed,      setConfirmed]      = useState(false);
  const [newFacts,       setNewFacts]       = useState('');
  const [generated,      setGenerated]      = useState('');

  // ── History ────────────────────────────────────────────────────────────────
  const [history,        setHistory]        = useState<ApplicationRecord[]>([]);
  const [historyLoaded,  setHistoryLoaded]  = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ApplicationRecord | null>(null);

  const roleColor  = COUNSEL_ROLE_COLORS[activeCase.counsel_role ?? 'claimant_side'];
  const trackColor = MATTER_TRACK_COLORS[activeCase.matter_track ?? 'civil'];

  // ── Load history ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try D1 first, then local blind_spot fallback
      const remote = await workerLoadApplications(activeCase.id);
      if (!cancelled) {
        if (remote.length > 0) {
          setHistory(remote);
          // Keep local in sync
          await saveBlindSpot(activeCase.id, MODULE, { history: remote });
        } else {
          const local = await loadBlindSpot<SavedData>(activeCase.id, MODULE, DEFAULT_DATA);
          if (!cancelled) setHistory(local.history ?? []);
        }
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCase.id]);

  // ── Persist history helper ─────────────────────────────────────────────────
  const persistHistory = useCallback(async (updated: ApplicationRecord[]) => {
    setHistory(updated);
    await saveBlindSpot(activeCase.id, MODULE, { history: updated });
  }, [activeCase.id]);

  // ── Step 2 — Classify ──────────────────────────────────────────────────────
  const handleClassify = useCallback(async () => {
    if (!intent.trim()) return;
    setClassError('');
    setClassification(null);

    const prompt = buildClassificationPrompt(
      intent,
      activeCase.matter_track ?? 'civil',
      activeCase.counsel_role ?? 'claimant_side',
      activeCase.court,
    );

    const raw = await ask({
      system: 'You are a Nigerian litigation expert. Respond with valid JSON only. No markdown fences, no preamble.',
      userMsg: prompt,
      skipLibrary: true,
      maxTokens: 600,
    });

    if (!raw) return;
    setClassRaw(raw);

    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean) as Classification;
      setClassification(parsed);
      setStep(2);
    } catch {
      setClassError(`Classification parse error. Raw response:\n${raw}`);
    }
  }, [intent, ask, activeCase]);

  // ── Step 4 — Generate ──────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!classification) return;
    setGenerated('');

    const prompt = buildGenerationPrompt(
      classification.appType,
      intent,
      newFacts,
      classification,
      activeCase,
    );

    const result = await ask({
      userMsg: prompt,
      maxTokens: 4000,
      libraryOpts: {
        queryHint: `${classification.appType} Nigerian court applications procedure`,
        topK: 10,
      },
    });

    if (!result) return;
    setGenerated(result);
    setStep(4);
  }, [classification, intent, newFacts, ask, activeCase]);

  // ── Save package ───────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!classification || !generated) return;
    const record: ApplicationRecord = {
      id:        uid(),
      caseId:    activeCase.id,
      appType:   classification.appType,
      intent,
      newFacts,
      documents: generated,
      createdAt: new Date().toISOString(),
    };
    const updated = [record, ...history];
    await persistHistory(updated);
    await workerSaveApplication(record);
    alert('Package saved to history.');
  }, [classification, generated, intent, newFacts, history, activeCase.id, persistHistory]);

  // ── Delete package ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this application package?')) return;
    const updated = history.filter(r => r.id !== id);
    await persistHistory(updated);
    await workerDeleteApplication(id);
    if (selectedRecord?.id === id) setSelectedRecord(null);
  }, [history, persistHistory, selectedRecord]);

  // ── Reset workflow ─────────────────────────────────────────────────────────
  const resetWorkflow = useCallback(() => {
    setStep(1); setIntent(''); setClassification(null);
    setClassRaw(''); setClassError(''); setConfirmed(false);
    setNewFacts(''); setGenerated(''); clearError();
  }, [clearError]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 28px', fontFamily: "'Times New Roman', Times, serif", color: '#e8e4d8' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <span style={{ fontSize: 26, color: '#4090d0' }}>⚡</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f0ece0', letterSpacing: '.02em' }}>
            Applications Engine
          </div>
          <div style={{ fontSize: 12, color: '#6a6a88', marginTop: 2 }}>
            Draft complete application packages — Civil · Criminal · Appeal
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: roleColor.bg, border: `1px solid ${roleColor.bdr}`, color: roleColor.col }}>
            {activeCase.counsel_role?.replace('_', ' ').toUpperCase()}
          </span>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, background: trackColor.bg, border: `1px solid ${trackColor.bdr}`, color: trackColor.col }}>
            {(activeCase.matter_track ?? 'civil').toUpperCase()}
          </span>
        </div>
      </div>

      {/* ── Main tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #181828', paddingBottom: 0 }}>
        {([['new', '⚡ New Application'], ['history', `📋 History (${history.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setMainTab(id); if (id === 'history') setSelectedRecord(null); }}
            style={{
              background: mainTab === id ? '#181828' : 'transparent',
              color: mainTab === id ? '#f0ece0' : '#505068',
              border: 'none', borderBottom: mainTab === id ? '2px solid #4090d0' : '2px solid transparent',
              padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
              fontWeight: mainTab === id ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>

      {/* ══ NEW APPLICATION TAB ══ */}
      {mainTab === 'new' && (
        <div>
          {/* ── Step progress bar ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            {([1, 2, 3, 4] as const).map((n, i) => (
              <React.Fragment key={n}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StepBadge n={n} active={step >= n} />
                  <span style={{ fontSize: 12, color: step >= n ? '#c8c0b0' : '#404058' }}>
                    {['Intent', 'Classify', 'Facts', 'Draft'][i]}
                  </span>
                </div>
                {i < 3 && <div style={{ flex: 1, height: 1, background: step > n ? '#4090d0' : '#181828' }} />}
              </React.Fragment>
            ))}
          </div>

          {error && <ErrorBlock message={error} />}
          {classError && <ErrorBlock message={classError} />}

          {/* ── STEP 1 — Intent ── */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 10 }}>
              <StepBadge n={1} active={step >= 1} /> &nbsp; Describe what you need
            </div>
            <div style={{ fontSize: 12, color: '#808098', marginBottom: 10 }}>
              Write in plain language — what application do you want to bring and why? The AI will classify it.
            </div>
            <textarea
              value={intent}
              onChange={e => setIntent(e.target.value)}
              placeholder="e.g. I need to apply for bail for my client who has been in custody since arrest last month. He is a first offender, has a permanent address in Lagos, and is employed as a teacher. The prosecution has very weak circumstantial evidence."
              disabled={loading}
              style={{
                width: '100%', minHeight: 110, background: '#0a0a14', border: '1px solid #1e1e34',
                borderRadius: 6, padding: '10px 12px', color: '#e8e4d8', fontSize: 13,
                fontFamily: "'Times New Roman', Times, serif", resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 12 }}>
              <Btn
                label="Classify Application →"
                onClick={handleClassify}
                loading={loading}
                off={!intent.trim()}
                accent="#4090d0"
              />
              {step > 1 && (
                <button onClick={resetWorkflow} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#505068', cursor: 'pointer', fontSize: 12 }}>
                  ↺ Start over
                </button>
              )}
            </div>
          </div>

          {/* ── STEP 2 — Classification ── */}
          {classification && step >= 2 && (
            <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 8, padding: '18px 20px', marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 14 }}>
                <StepBadge n={2} active={true} /> &nbsp; Classification Result
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#505068', marginBottom: 6 }}>APPLICATION TYPE</div>
                <div style={{ fontSize: 14, color: '#5090d0', fontWeight: 600 }}>{classification.appType}</div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#505068', marginBottom: 6 }}>DOCUMENT PACKAGE</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {classification.packageRequired.map((doc, i) => (
                    <ClassificationTag key={i} text={doc} accent="#4090d0" />
                  ))}
                </div>
              </div>

              {classification.informationGaps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#505068', marginBottom: 6 }}>INFORMATION GAPS (address before filing)</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#c09040', fontSize: 13 }}>
                    {classification.informationGaps.map((g, i) => <li key={i} style={{ marginBottom: 3 }}>{g}</li>)}
                  </ul>
                </div>
              )}

              {classification.recommendation && (
                <div style={{ marginBottom: 14, padding: '8px 12px', background: '#0d1020', borderLeft: '3px solid #4090d0', fontSize: 13, color: '#a0b8d8', fontStyle: 'italic' }}>
                  {classification.recommendation}
                </div>
              )}

              {!confirmed ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Btn label="Confirm & Continue →" onClick={() => { setConfirmed(true); setStep(3); }} accent="#40a060" />
                  <Btn label="Re-classify" onClick={() => { setClassification(null); setStep(1); }} accent="#808098" small />
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#40a060' }}>✓ Confirmed — proceed to Step 3</div>
              )}
            </div>
          )}

          {/* ── STEP 3 — New Facts ── */}
          {confirmed && step >= 3 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0', marginBottom: 10 }}>
                <StepBadge n={3} active={true} /> &nbsp; New Developments <span style={{ fontSize: 12, color: '#505068', fontWeight: 400 }}>(optional)</span>
              </div>
              <div style={{ fontSize: 12, color: '#808098', marginBottom: 10 }}>
                Add any facts or events that arose after the Intelligence Engine last ran — recent hearings, new evidence, changed circumstances.
              </div>
              <textarea
                value={newFacts}
                onChange={e => setNewFacts(e.target.value)}
                placeholder="e.g. Court adjourned matter to 25 June 2026. Prosecution disclosed that key witness is unavailable until August. Accused has now secured surety willing to offer property worth ₦15m."
                disabled={loading}
                style={{
                  width: '100%', minHeight: 90, background: '#0a0a14', border: '1px solid #1e1e34',
                  borderRadius: 6, padding: '10px 12px', color: '#e8e4d8', fontSize: 13,
                  fontFamily: "'Times New Roman', Times, serif", resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ marginTop: 12 }}>
                <Btn
                  label="Generate Full Package →"
                  onClick={() => { setStep(4); handleGenerate(); }}
                  loading={loading}
                  accent="#4090d0"
                />
              </div>
            </div>
          )}

          {/* ── STEP 4 — Generated Package ── */}
          {step === 4 && (
            <div>
              {loading && (
                <div style={{ color: '#4090d0', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
                  ⟳ Drafting {classification?.packageRequired.length ?? ''} documents…
                </div>
              )}

              {generated && !loading && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ece0' }}>
                      <StepBadge n={4} active={true} /> &nbsp; Generated Package — {classification?.appType}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Btn label="Save to History" onClick={handleSave} accent="#40a060" small />
                      <Btn label="New Application" onClick={resetWorkflow} accent="#808098" small />
                    </div>
                  </div>

                  <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '20px 22px', lineHeight: 1.85, fontSize: 13 }}>
                    <Md text={generated} />
                  </div>

                  <MandatoryNotice />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ HISTORY TAB ══ */}
      {mainTab === 'history' && (
        <div>
          {!historyLoaded && (
            <div style={{ color: '#505068', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading history…</div>
          )}

          {historyLoaded && history.length === 0 && (
            <div style={{ color: '#505068', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
              No saved application packages yet. Draft one in the New Application tab.
            </div>
          )}

          {historyLoaded && history.length > 0 && !selectedRecord && (
            <div>
              <div style={{ fontSize: 13, color: '#808098', marginBottom: 16 }}>
                {history.length} saved package{history.length !== 1 ? 's' : ''} — click any to view
              </div>
              {history.map(rec => (
                <div key={rec.id}
                  style={{
                    background: '#080814', border: '1px solid #1e1e34', borderRadius: 7,
                    padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                  onClick={() => setSelectedRecord(rec)}
                >
                  <div>
                    <div style={{ fontSize: 14, color: '#5090d0', fontWeight: 600, marginBottom: 4 }}>{rec.appType}</div>
                    <div style={{ fontSize: 12, color: '#808098' }}>
                      {new Date(rec.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' — '}
                      <span style={{ fontStyle: 'italic' }}>{rec.intent.slice(0, 90)}{rec.intent.length > 90 ? '…' : ''}</span>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(rec.id); }}
                    style={{ background: 'none', border: 'none', color: '#503030', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}
                    title="Delete"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {historyLoaded && selectedRecord && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <button onClick={() => setSelectedRecord(null)}
                    style={{ background: 'none', border: 'none', color: '#4090d0', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 6 }}>
                    ← Back to history
                  </button>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f0ece0' }}>{selectedRecord.appType}</div>
                  <div style={{ fontSize: 12, color: '#505068' }}>
                    {new Date(selectedRecord.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <Btn label="Delete" onClick={() => handleDelete(selectedRecord.id)} accent="#803030" small />
              </div>

              {selectedRecord.intent && (
                <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#a0a0c0' }}>
                  <strong style={{ color: '#505068' }}>ORIGINAL INTENT: </strong>{selectedRecord.intent}
                </div>
              )}
              {selectedRecord.newFacts && (
                <div style={{ background: '#080814', border: '1px solid #1e1e34', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#a0a0c0' }}>
                  <strong style={{ color: '#505068' }}>NEW FACTS: </strong>{selectedRecord.newFacts}
                </div>
              )}

              <div style={{ background: '#06060f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '20px 22px', lineHeight: 1.85, fontSize: 13 }}>
                <Md text={selectedRecord.documents} />
              </div>

              <MandatoryNotice />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
