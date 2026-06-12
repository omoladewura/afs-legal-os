/**
 * AFS Legal OS V2 — No-Case Submission Engine (Phase 6B)
 *
 * Dual-role criminal engine: activated at the close of the prosecution case.
 *
 * DEFENCE sub-tabs (primary):
 *   1. Submission Drafter   — per-count grounds, Ajidagba/Ibeziako test, full submission
 *   2. Authorities Builder  — Nigerian no-case authorities relevant to each count
 *   3. Ruling Tracker       — record the ruling (Discharge or Overruled per count)
 *
 * PROSECUTION sub-tabs:
 *   1. Response Drafter     — respond to the no-case submission, defend evidence sufficiency
 *   2. Evidence Summary     — structured argument per count that prima facie case exists
 *   3. Ruling Tracker       — record the ruling and route to correct next stage
 *
 * counsel_role governs which sub-tabs and AI prompts are active.
 * matter_track is always 'criminal' for this engine.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type DefSubTab  = 'submission_drafter' | 'authorities_builder' | 'ruling_tracker_def';
type ProsSubTab = 'response_drafter'  | 'evidence_summary'    | 'ruling_tracker_pros';
type SubTab     = DefSubTab | ProsSubTab;

type CountRuling = 'Pending' | 'Discharged' | 'Overruled' | 'Part Discharged';

interface NoCaseCount {
  id:        number;
  count:     string;
  offence:   string;
  elements:  string;   // essential ingredients that are unproved
  gap:       string;   // specific gap in prosecution evidence
  grounds:   string;   // drafted grounds for this count
}

interface CountRulingRecord {
  id:      number;
  count:   string;
  offence: string;
  ruling:  CountRuling;
  reasons: string;
  date:    string;
}

interface SavedData {
  // Defence
  noCaseCounts?:          NoCaseCount[];
  submissionDraft?:       string;
  authoritiesResult?:     string;
  defRulings?:            CountRulingRecord[];
  defRulingNotes?:        string;
  // Prosecution
  responseContext?:       string;
  responseResult?:        string;
  prosCounts?:            ProsSufficiencyCount[];
  prosEvidenceSummary?:   string;
  prosRulings?:           CountRulingRecord[];
  prosRulingNotes?:       string;
}

interface ProsSufficiencyCount {
  id:        number;
  count:     string;
  offence:   string;
  defGround: string;   // what defence is arguing
  prosArg:   string;   // prosecution's response argument
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#070710', border: '1px solid #1a1a28',
  borderRadius: 5, color: '#e0dcd0', padding: '11px 14px', fontSize: 15,
  fontFamily: "'Times New Roman', Times, serif", outline: 'none', boxSizing: 'border-box',
};
const taS: React.CSSProperties = { ...iS, resize: 'vertical', lineHeight: 1.82, minHeight: 110 };
const labelS: React.CSSProperties = {
  fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif',
  letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 6,
};
const cardS: React.CSSProperties = {
  background: '#080810', border: '1px solid #14141e',
  borderRadius: 8, padding: '20px 22px', marginBottom: 16,
};
const hS: React.CSSProperties = {
  fontSize: 20, color: T.text, fontWeight: 400,
  fontFamily: "'Times New Roman', Times, serif", marginBottom: 6, letterSpacing: '.02em',
};
const dimS: React.CSSProperties = {
  fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
  lineHeight: 1.6, marginBottom: 14,
};

function Btn({
  onClick, loading, disabled, label, accent = '#c09030',
}: { onClick: () => void; loading: boolean; disabled?: boolean; label: string; accent?: string }) {
  const off = disabled && !loading;
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background: loading || off ? '#101018' : `linear-gradient(135deg,#000000,${accent})`,
        color:      loading || off ? '#2a2a38' : '#f0ece0',
        border: 'none', borderRadius: 6, padding: '11px 26px',
        fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
        cursor: loading || off ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function ResultBlock({ title, content, onClear, accent = '#c09030' }: {
  title: string; content: string; onClear: () => void; accent?: string;
}) {
  return (
    <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${accent}30`, borderRadius: 8, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </span>
        <button onClick={onClear} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          clear ×
        </button>
      </div>
      <Md content={content} />
    </div>
  );
}

function SubTabBar({ tabs, active, onSelect, accent }: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  accent: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24 }}>
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              background:    isActive ? `${accent}18` : 'transparent',
              border:        `1px solid ${isActive ? `${accent}50` : '#1e1e2e'}`,
              color:         isActive ? accent : T.mute,
              borderRadius:  5,
              padding:       '7px 16px',
              fontSize:      11,
              fontFamily:    'Inter, sans-serif',
              cursor:        'pointer',
              fontWeight:    600,
              letterSpacing: '.06em',
              transition:    'all .15s',
              whiteSpace:    'nowrap',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

const emptyNoCaseCount = (idx: number): NoCaseCount => ({
  id: Date.now() + idx,
  count: `Count ${idx + 1}`,
  offence: '',
  elements: '',
  gap: '',
  grounds: '',
});

function SubmissionDrafterTab({
  counts, setCounts, submissionDraft, setSubmissionDraft, accent, activeCase,
}: {
  counts: NoCaseCount[];
  setCounts: (fn: (p: NoCaseCount[]) => NoCaseCount[]) => void;
  submissionDraft: string;
  setSubmissionDraft: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const add    = () => setCounts(p => [...p, emptyNoCaseCount(p.length)]);
  const remove = (id: number) => setCounts(p => p.filter(c => c.id !== id));
  const update = (id: number, field: keyof NoCaseCount, value: string) =>
    setCounts(p => p.map(c => c.id === id ? { ...c, [field]: value } : c));

  const hasGrounds = counts.some(c => c.offence && (c.gap || c.grounds));

  const draftSubmission = useCallback(async () => {
    if (!hasGrounds) return;
    const countsSummary = counts.map((c, i) =>
      `COUNT ${i + 1} — ${c.offence}:\nEssential ingredients not proved: ${c.elements || '[not specified]'}\nSpecific gap in prosecution evidence: ${c.gap || '[not described]'}\nDrafted grounds: ${c.grounds || '[generate from gap]'}`
    ).join('\n\n');

    const r = await call({
      system: `You are a Nigerian criminal defence counsel drafting a No-Case Submission for filing in court. Apply ACJA 2015 s.303(1) and the authorities in Ajidagba v. State (1981) 1 NCLR 91, Ibeziako v. Commissioner of Police (1963), and Tongo v. COP. The test is whether there is evidence on which a reasonable tribunal, properly directing itself, could convict. Your drafting must be formal, precise, and court-ready.`,
      userMsg: `Draft a No-Case Submission for the matter:\n\n${activeCase.caseName}\n${activeCase.court}\n\nCounts and grounds:\n\n${countsSummary}\n\nDraft a full No-Case Submission document in the following structure:\n\n1. **Caption** — formal court caption with matter name, charge number, court\n2. **Introduction** — who is making the submission and under which provision (ACJA s.303(1) or equivalent CPA provision)\n3. **The Applicable Legal Standard** — state the Ajidagba/Ibeziako test precisely, with citations\n4. **Count-by-Count Submissions** — for each count:\n   a. Restate the charge and the essential ingredients prosecution must prove\n   b. Summarise what prosecution actually led in evidence\n   c. Identify the specific ingredient(s) not proved\n   d. Cite any authority supporting this ground\n   e. Conclude: prosecution has failed to make out a prima facie case on this count\n5. **Conclusion and Prayer** — invite the court to discharge the accused on the named counts and make the necessary orders\n6. **Signature block** — defence counsel's signature block\n\nUse formal Nigerian legal drafting. Each count must be argued separately and precisely.`,
    });
    if (r) setSubmissionDraft(r);
  }, [counts, hasGrounds, activeCase, call]);

  return (
    <div>
      <div style={cardS}>
        <h3 style={hS}>No-Case Submission Drafter</h3>
        <p style={dimS}>
          Build the grounds per count and generate a full court-ready no-case submission
          under ACJA 2015 s.303(1). The test is whether there is evidence on which a reasonable
          court could convict — not whether the prosecution has proved its case.
        </p>

        {/* Legal standard reminder */}
        <div style={{
          padding: '12px 16px', background: `${accent}08`,
          border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
          fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
        }}>
          <strong style={{ color: accent }}>The No-Case Standard (Ajidagba v. State)</strong>
          {' '}— A no-case submission succeeds where: (1) the prosecution has not led any evidence on
          an essential ingredient of the offence, OR (2) the evidence led is so manifestly unreliable,
          discredited, or inherently improbable that no reasonable tribunal could safely act on it.
        </div>

        {counts.map((c, idx) => (
          <div key={c.id} style={{
            background: '#0a0a14', border: `1px solid ${accent}28`,
            borderRadius: 7, padding: '16px 18px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input
                style={{ ...iS, width: 100, flex: '0 0 100px', fontWeight: 700, fontSize: 13 }}
                value={c.count}
                onChange={e => update(c.id, 'count', e.target.value)}
                placeholder="Count 1"
              />
              <input
                style={{ ...iS, flex: 1, fontSize: 13 }}
                value={c.offence}
                onChange={e => update(c.id, 'offence', e.target.value)}
                placeholder="Offence name (e.g. Armed Robbery)"
              />
              {counts.length > 1 && (
                <button
                  onClick={() => remove(c.id)}
                  style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
                >
                  remove
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelS}>Essential Ingredients Not Proved</label>
                <textarea
                  style={{ ...taS, minHeight: 90 }}
                  value={c.elements}
                  onChange={e => update(c.id, 'elements', e.target.value)}
                  placeholder="Which essential ingredient(s) of this offence has prosecution failed to prove at all? e.g. (b) use of offensive weapon — no witness identified any weapon"
                />
              </div>
              <div>
                <label style={labelS}>Specific Gap in Prosecution Evidence</label>
                <textarea
                  style={{ ...taS, minHeight: 90 }}
                  value={c.gap}
                  onChange={e => update(c.id, 'gap', e.target.value)}
                  placeholder="Describe the exact gap: which witness said what (or failed to say), which exhibit is missing, which testimony is contradicted..."
                />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelS}>Drafted Grounds (optional — AI will generate if blank)</label>
                <textarea
                  style={{ ...taS, minHeight: 70 }}
                  value={c.grounds}
                  onChange={e => update(c.id, 'grounds', e.target.value)}
                  placeholder="Draft the grounds in your own words, or leave blank for AI to generate from the gap description above."
                />
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <button
            onClick={add}
            style={{
              background: 'transparent', border: `1px dashed ${accent}50`,
              color: accent, borderRadius: 6, padding: '9px 20px',
              fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              letterSpacing: '.06em',
            }}
          >
            + Add count
          </button>
          <Btn
            onClick={draftSubmission}
            loading={loading}
            disabled={!hasGrounds}
            label="Draft Full No-Case Submission"
            accent={accent}
          />
        </div>

        {error && <ErrorBlock message={error} />}
      </div>

      {submissionDraft && (
        <div style={cardS}>
          <h3 style={hS}>No-Case Submission (Draft)</h3>
          <p style={dimS}>Edit the draft below before filing. The draft is auto-saved.</p>
          <textarea
            style={{ ...taS, minHeight: 500 }}
            value={submissionDraft}
            onChange={e => setSubmissionDraft(e.target.value)}
          />
          <button
            onClick={() => setSubmissionDraft('')}
            style={{
              marginTop: 10, background: 'transparent', border: '1px solid #301818',
              color: '#c05050', borderRadius: 5, padding: '6px 16px',
              fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
            }}
          >
            clear draft ×
          </button>
        </div>
      )}
    </div>
  );
}

function AuthoritiesBuilderTab({
  counts, authoritiesResult, setAuthoritiesResult, accent, activeCase,
}: {
  counts: NoCaseCount[];
  authoritiesResult: string;
  setAuthoritiesResult: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();
  const [offenceFocus, setOffenceFocus] = useState('');

  const buildAuthorities = useCallback(async () => {
    const offences = offenceFocus || counts.map(c => c.offence).filter(Boolean).join(', ');
    if (!offences) return;

    const r = await call({
      system: `You are a Nigerian criminal defence counsel. Provide Nigerian case authorities on no-case submissions, with specific application to the offences in question.`,
      userMsg: `Provide Nigerian legal authorities for a no-case submission in ${activeCase.caseName}.\n\nOffences in the charge: ${offences}\n\nProvide:\n\n1. **The Governing Standard** — Ajidagba v. State (1981), Ibeziako v. COP, and any Supreme Court authorities refining the test. For each: case name, citation, court, and the precise ratio on the no-case standard.\n\n2. **Authorities on Specific Ingredients** — for each offence listed, are there authorities on which essential ingredients must be proved by the prosecution (i.e., authorities where no-case was upheld or a conviction was quashed for failure to prove a specific ingredient)?\n\n3. **Witness Credibility** — authorities where no-case was upheld because prosecution witnesses were so discredited or inconsistent that no court could rely on them.\n\n4. **ACJA s.303 Procedure** — authorities on the proper procedure for no-case submissions under ACJA 2015, including whether defence is entitled to be heard.\n\n5. **Recent Authorities** — any post-2015 decisions from the Court of Appeal or Supreme Court developing the no-case standard.\n\nFor each authority: name, citation, court, year, and the specific proposition for which it is cited.`,
    });
    if (r) setAuthoritiesResult(r);
  }, [offenceFocus, counts, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Authorities Builder</h3>
      <p style={dimS}>
        Generate Nigerian legal authorities for the no-case submission — the governing test,
        offence-specific ingredient authorities, and witness credibility cases. These authorities
        form the legal foundation of each ground in the submission.
      </p>

      <label style={labelS}>Offences to research (or auto-populate from counts above)</label>
      <textarea
        style={{ ...taS, minHeight: 80, marginBottom: 14 }}
        value={offenceFocus}
        onChange={e => setOffenceFocus(e.target.value)}
        placeholder={
          counts.some(c => c.offence)
            ? `Auto-populated: ${counts.map(c => c.offence).filter(Boolean).join(', ')} — or override here`
            : 'e.g. Armed Robbery, Obtaining by False Pretences, Murder...'
        }
      />

      <Btn
        onClick={buildAuthorities}
        loading={loading}
        disabled={!offenceFocus && !counts.some(c => c.offence)}
        label="Build Authorities"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {authoritiesResult && (
        <ResultBlock
          title="No-Case Submission Authorities"
          content={authoritiesResult}
          onClear={() => setAuthoritiesResult('')}
          accent={accent}
        />
      )}
    </div>
  );
}

const COUNT_RULING_OPTIONS: CountRuling[] = ['Pending', 'Discharged', 'Overruled', 'Part Discharged'];

const RULING_COLORS: Record<CountRuling, { bg: string; bdr: string; col: string }> = {
  'Pending':         { bg: '#0d0d18', bdr: '#202030', col: '#505080' },
  'Discharged':      { bg: '#0d1800', bdr: '#1a4000', col: '#50c050' },
  'Overruled':       { bg: '#1a0808', bdr: '#4a1818', col: '#c05050' },
  'Part Discharged': { bg: '#181000', bdr: '#3a2800', col: '#b08030' },
};

const emptyRuling = (idx: number): CountRulingRecord => ({
  id: Date.now() + idx,
  count: `Count ${idx + 1}`,
  offence: '',
  ruling: 'Pending',
  reasons: '',
  date: '',
});

function RulingTrackerTab({
  rulings, setRulings, notes, setNotes, accent, activeCase, isDefence,
}: {
  rulings: CountRulingRecord[];
  setRulings: (fn: (p: CountRulingRecord[]) => CountRulingRecord[]) => void;
  notes: string;
  setNotes: (v: string) => void;
  accent: string;
  activeCase: Case;
  isDefence: boolean;
}) {
  const { call, loading, error } = useAI();
  const [nextStepsResult, setNextStepsResult] = useState('');

  const add    = () => setRulings(p => [...p, emptyRuling(p.length)]);
  const remove = (id: number) => setRulings(p => p.filter(r => r.id !== id));
  const update = (id: number, field: keyof CountRulingRecord, value: string | CountRuling) =>
    setRulings(p => p.map(r => r.id === id ? { ...r, [field]: value } : r));

  const discharged    = rulings.filter(r => r.ruling === 'Discharged' || r.ruling === 'Part Discharged').length;
  const overruled     = rulings.filter(r => r.ruling === 'Overruled').length;
  const pending       = rulings.filter(r => r.ruling === 'Pending').length;
  const allRulingsDone = rulings.length > 0 && pending === 0;

  const getNextSteps = useCallback(async () => {
    const rulingSummary = rulings.map(r =>
      `${r.count} (${r.offence}): RULING — ${r.ruling}${r.reasons ? `. Court's reasons: ${r.reasons}` : ''}. Date: ${r.date || 'not recorded'}`
    ).join('\n');

    const r = await call({
      system: isDefence
        ? `You are a Nigerian criminal defence counsel. Apply ACJA 2015, Evidence Act 2011, and CFRN 1999. Advise on next steps following a no-case ruling.`
        : `You are a Nigerian prosecution counsel. Apply ACJA 2015. Advise prosecution on next steps following a no-case ruling.`,
      userMsg: `No-case ruling outcome for ${activeCase.caseName} at ${activeCase.court}:\n\n${rulingSummary}\n\nAdditional notes: ${notes || 'none'}\n\n${isDefence ? `Advise DEFENCE on:\n1. **For counts DISCHARGED** — what are the immediate steps? Is the accused entitled to immediate release on those counts? What orders must defence seek?\n2. **For counts OVERRULED** — what are the next steps? Defence case opens — what must defence prepare immediately?\n3. **Mixed outcome** (some discharged, some overruled) — how does the matter proceed? Does the accused enter the dock for remaining counts only?\n4. **ACJA Implications** — any ACJA rights or timelines triggered by this ruling?\n5. **Bail Implications** — any impact of the ruling on the accused's bail status?\n6. **Appeal against No-Case Ruling** — is an appeal available against an overruled no-case submission? (Note: generally not until after judgment)\n7. **Immediate Defence Actions** — what must defence do in the next 7 days?`
        : `Advise PROSECUTION on:\n1. **For counts DISCHARGED** — can prosecution appeal? On what grounds? What is the process?\n2. **For counts OVERRULED** — what is prosecution's next step? Defence case now opens.\n3. **Mixed outcome** — how does the matter continue for remaining counts?\n4. **If all counts overruled** — prosecution's position is strengthened. What does prosecution do at the defence case stage?\n5. **Cross-examination of defence witnesses** — what must prosecution prepare?\n6. **Immediate Prosecution Actions** — what must prosecution do in the next 7 days?`}`,
    });
    if (r) setNextStepsResult(r);
  }, [rulings, notes, isDefence, activeCase, call]);

  return (
    <div>
      <div style={cardS}>
        {/* Summary banner */}
        {allRulingsDone && (
          <div style={{
            padding: '12px 16px', marginBottom: 18, borderRadius: 6,
            background: discharged > overruled ? '#0d1800' : overruled > discharged ? '#1a0808' : '#181000',
            border: `1px solid ${discharged > overruled ? '#285000' : overruled > discharged ? '#4a1818' : '#3a2800'}`,
          }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {discharged > 0 && (
                <span style={{ fontSize: 11, color: '#50c050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
                  ✓ DISCHARGED: {discharged} count{discharged !== 1 ? 's' : ''}
                </span>
              )}
              {overruled > 0 && (
                <span style={{ fontSize: 11, color: '#c05050', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
                  ✗ OVERRULED: {overruled} count{overruled !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {discharged > 0 && isDefence && (
              <p style={{ fontSize: 12, color: '#50c050', fontFamily: "'Times New Roman', Times, serif", marginTop: 8, marginBottom: 0 }}>
                The accused has been discharged on {discharged} count{discharged !== 1 ? 's' : ''}. Ensure immediate release orders are sought for those counts.
              </p>
            )}
            {overruled > 0 && !isDefence && (
              <p style={{ fontSize: 12, color: '#c09030', fontFamily: "'Times New Roman', Times, serif", marginTop: 8, marginBottom: 0 }}>
                {overruled} count{overruled !== 1 ? 's' : ''} survive{overruled === 1 ? 's' : ''} — the defence case now opens. Prepare cross-examination of defence witnesses.
              </p>
            )}
          </div>
        )}

        <h3 style={hS}>No-Case Ruling Tracker</h3>
        <p style={dimS}>
          Record the court's ruling on each count. On Discharged — the accused must be released
          on those counts. On Overruled — the defence case opens. Track each count separately as
          mixed rulings are common in multi-count matters.
        </p>

        {rulings.map((r) => {
          const col = RULING_COLORS[r.ruling];
          return (
            <div key={r.id} style={{
              background: col.bg, border: `1px solid ${col.bdr}`,
              borderRadius: 7, padding: '16px 18px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  style={{ ...iS, width: 100, flex: '0 0 100px', fontSize: 13, fontWeight: 700 }}
                  value={r.count}
                  onChange={e => update(r.id, 'count', e.target.value)}
                  placeholder="Count 1"
                />
                <input
                  style={{ ...iS, flex: 1, fontSize: 13 }}
                  value={r.offence}
                  onChange={e => update(r.id, 'offence', e.target.value)}
                  placeholder="Offence"
                />
                <select
                  value={r.ruling}
                  onChange={e => update(r.id, 'ruling', e.target.value as CountRuling)}
                  style={{
                    ...iS, width: 'auto', minWidth: 160, fontSize: 12,
                    padding: '6px 10px', cursor: 'pointer', appearance: 'none',
                    background: col.bg, border: `1px solid ${col.bdr}`, color: col.col,
                  }}
                >
                  {COUNT_RULING_OPTIONS.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                <input
                  style={{ ...iS, width: 130, flex: '0 0 130px', fontSize: 12 }}
                  type="date"
                  value={r.date}
                  onChange={e => update(r.id, 'date', e.target.value)}
                />
                {rulings.length > 1 && (
                  <button
                    onClick={() => remove(r.id)}
                    style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
                  >
                    remove
                  </button>
                )}
              </div>
              <label style={labelS}>Court's Reasons / Notes</label>
              <textarea
                style={{ ...taS, minHeight: 70 }}
                value={r.reasons}
                onChange={e => update(r.id, 'reasons', e.target.value)}
                placeholder="Summary of court's reasons for the ruling on this count..."
              />
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            onClick={add}
            style={{
              background: 'transparent', border: `1px dashed ${accent}50`,
              color: accent, borderRadius: 6, padding: '9px 20px',
              fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              letterSpacing: '.06em',
            }}
          >
            + Add count
          </button>
        </div>

        <label style={labelS}>Overall Notes / Orders Made</label>
        <textarea
          style={{ ...taS, minHeight: 80, marginBottom: 14 }}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Adjournment date, bail orders, release orders, next hearing purpose..."
        />

        <Btn
          onClick={getNextSteps}
          loading={loading}
          disabled={!allRulingsDone}
          label={`Generate ${isDefence ? 'Defence' : 'Prosecution'} Next Steps`}
          accent={accent}
        />
        {!allRulingsDone && rulings.length > 0 && (
          <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', marginTop: 8 }}>
            Record the ruling on every count before generating next steps.
          </p>
        )}

        {error && <ErrorBlock message={error} />}
        {nextStepsResult && (
          <ResultBlock
            title={`${isDefence ? 'Defence' : 'Prosecution'} — Post-Ruling Next Steps`}
            content={nextStepsResult}
            onClear={() => setNextStepsResult('')}
            accent={accent}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION SUB-TABS
// ─────────────────────────────────────────────────────────────────────────────

const emptyProsSufficiency = (idx: number): ProsSufficiencyCount => ({
  id: Date.now() + idx,
  count: `Count ${idx + 1}`,
  offence: '',
  defGround: '',
  prosArg: '',
});

function ResponseDrafterTab({
  responseContext, setResponseContext, responseResult, setResponseResult, accent, activeCase,
}: {
  responseContext: string;
  setResponseContext: (v: string) => void;
  responseResult: string;
  setResponseResult: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const draft = useCallback(async () => {
    if (!responseContext.trim()) return;
    const r = await call({
      system: `You are a Nigerian prosecution counsel drafting a formal response to a no-case submission. Apply ACJA 2015 s.303, the Ajidagba/Ibeziako standard, and Evidence Act 2011. Your task is to demonstrate that there is prima facie evidence on each count that a reasonable tribunal could act upon.`,
      userMsg: `Draft a prosecution response to the no-case submission in ${activeCase.caseName} at ${activeCase.court}.\n\nContext (defence grounds / case summary):\n${responseContext}\n\nStructure the response as follows:\n\n1. **Introduction** — prosecution's right to respond; the applicable standard\n2. **Restatement of the Test** — the Ajidagba/Ibeziako test and why the submission fails\n3. **Response per Count** — for each count:\n   a. Restate the essential ingredients\n   b. Identify the evidence led — which witness, which exhibit, which testimony\n   c. Address each defence ground directly and explain why it fails\n   d. Cite authority where applicable\n   e. Conclusion: prima facie case established on this count\n4. **Weight of Evidence is Not the Issue** — remind the court that this is not the stage for weighing evidence (cite authority)\n5. **Prayer** — invite the court to overrule the submission and call the accused to enter a defence\n6. **Signature block**\n\nUse formal Nigerian court drafting. Be precise and address each defence ground directly.`,
    });
    if (r) setResponseResult(r);
  }, [responseContext, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Response Drafter</h3>
      <p style={dimS}>
        Draft a formal prosecution response to the no-case submission. The prosecution must
        demonstrate that it has led prima facie evidence on each essential ingredient of every
        count — not that it has proved its case beyond reasonable doubt.
      </p>

      <div style={{
        padding: '12px 16px', background: `${accent}08`,
        border: `1px solid ${accent}20`, borderRadius: 6, marginBottom: 18,
        fontSize: 13, color: T.sub, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7,
      }}>
        <strong style={{ color: accent }}>Prosecution's Response Standard</strong>
        {' '}— The court does not weigh evidence at this stage. The test is whether there is
        any credible evidence on each essential ingredient on which a reasonable tribunal could
        convict. Prosecution need not rebut every weakness alleged — it must show that evidence
        exists on each ingredient.
      </div>

      <label style={labelS}>Defence Grounds / Case Summary (paste or describe)</label>
      <textarea
        style={{ ...taS, minHeight: 200, marginBottom: 14 }}
        value={responseContext}
        onChange={e => setResponseContext(e.target.value)}
        placeholder="Paste or summarise the defence no-case submission grounds. Include: which counts are contested, which essential ingredients are alleged to be unproved, and what specific evidence gaps are identified. Also summarise the prosecution evidence led: witnesses called, exhibits admitted."
      />

      <Btn
        onClick={draft}
        loading={loading}
        disabled={!responseContext.trim()}
        label="Draft Prosecution Response"
        accent={accent}
      />
      {error && <ErrorBlock message={error} />}
      {responseResult && (
        <ResultBlock
          title="Prosecution Response — No-Case Submission"
          content={responseResult}
          onClear={() => setResponseResult('')}
          accent={accent}
        />
      )}
    </div>
  );
}

function EvidenceSummaryTab({
  prosCounts, setProsCounts, prosEvidenceSummary, setProsEvidenceSummary, accent, activeCase,
}: {
  prosCounts: ProsSufficiencyCount[];
  setProsCounts: (fn: (p: ProsSufficiencyCount[]) => ProsSufficiencyCount[]) => void;
  prosEvidenceSummary: string;
  setProsEvidenceSummary: (v: string) => void;
  accent: string;
  activeCase: Case;
}) {
  const { call, loading, error } = useAI();

  const add    = () => setProsCounts(p => [...p, emptyProsSufficiency(p.length)]);
  const remove = (id: number) => setProsCounts(p => p.filter(c => c.id !== id));
  const update = (id: number, field: keyof ProsSufficiencyCount, value: string) =>
    setProsCounts(p => p.map(c => c.id === id ? { ...c, [field]: value } : c));

  const generateSummary = useCallback(async () => {
    const countsSummary = prosCounts.map(c =>
      `${c.count} — ${c.offence}:\nDefence ground: ${c.defGround || '[not specified]'}\nProsecution argument prepared: ${c.prosArg || '[generate from context]'}`
    ).join('\n\n');

    const r = await call({
      system: `You are a Nigerian prosecution counsel. Generate a structured evidence summary for the prosecution's response to a no-case submission.`,
      userMsg: `Generate a per-count prosecution evidence summary for ${activeCase.caseName}:\n\n${countsSummary}\n\nFor each count:\n1. **Essential Ingredients** — list every ingredient prosecution must prove\n2. **Prosecution Evidence Available** — which witness(es) address each ingredient? Which exhibit?\n3. **Defence Ground Summary** — what is defence alleging is unproved?\n4. **Prosecution Rebuttal** — explain precisely why the evidence led is sufficient for prima facie purposes\n5. **Authority** — cite any authority on this ingredient's proof standard at no-case stage\n6. **Verdict** — PRIMA FACIE CASE ESTABLISHED / ARGUABLE / AT RISK\n\nEnd with overall prosecution assessment and confidence level on surviving the no-case submission.`,
    });
    if (r) setProsEvidenceSummary(r);
  }, [prosCounts, activeCase, call]);

  return (
    <div style={cardS}>
      <h3 style={hS}>Evidence Summary — Per Count</h3>
      <p style={dimS}>
        Build a structured count-by-count summary of the prosecution's evidence. This is the
        analytical backbone of the response — showing precisely what evidence exists for each
        essential ingredient that the defence claims is not proved.
      </p>

      {prosCounts.map((c, idx) => (
        <div key={c.id} style={{
          background: '#0a0a14', border: `1px solid ${accent}22`,
          borderRadius: 7, padding: '16px 18px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <input
              style={{ ...iS, width: 100, flex: '0 0 100px', fontSize: 13, fontWeight: 700 }}
              value={c.count}
              onChange={e => update(c.id, 'count', e.target.value)}
              placeholder="Count 1"
            />
            <input
              style={{ ...iS, flex: 1, fontSize: 13 }}
              value={c.offence}
              onChange={e => update(c.id, 'offence', e.target.value)}
              placeholder="Offence"
            />
            {prosCounts.length > 1 && (
              <button
                onClick={() => remove(c.id)}
                style={{ background: 'transparent', border: 'none', color: '#c05050', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
              >
                remove
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelS}>Defence Ground (what defence argues)</label>
              <textarea
                style={{ ...taS, minHeight: 80 }}
                value={c.defGround}
                onChange={e => update(c.id, 'defGround', e.target.value)}
                placeholder="e.g. PW1 gave no evidence of the use of any weapon — essential ingredient (b) not proved"
              />
            </div>
            <div>
              <label style={labelS}>Prosecution Argument</label>
              <textarea
                style={{ ...taS, minHeight: 80 }}
                value={c.prosArg}
                onChange={e => update(c.id, 'prosArg', e.target.value)}
                placeholder="e.g. PW1 at page 4 of his statement describes the accused holding an iron rod — Exhibit B (the rod) was admitted. This is prima facie evidence of the weapon."
              />
            </div>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          onClick={add}
          style={{
            background: 'transparent', border: `1px dashed ${accent}50`,
            color: accent, borderRadius: 6, padding: '9px 20px',
            fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
            letterSpacing: '.06em',
          }}
        >
          + Add count
        </button>
        <Btn
          onClick={generateSummary}
          loading={loading}
          disabled={!prosCounts.some(c => c.offence)}
          label="Generate Evidence Summary"
          accent={accent}
        />
      </div>

      {error && <ErrorBlock message={error} />}
      {prosEvidenceSummary && (
        <ResultBlock
          title="Prosecution Evidence Summary"
          content={prosEvidenceSummary}
          onClear={() => setProsEvidenceSummary('')}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'no_case_submission';

export function NoCaseSubmission({ activeCase }: Props) {
  const role      = activeCase.counsel_role ?? 'defence';
  const isPros    = role === 'prosecution';
  const isDefence = !isPros;
  const accent    = COUNSEL_ROLE_COLORS[role]?.col ?? '#40a860';

  const defSubTabs: { id: DefSubTab; label: string }[] = [
    { id: 'submission_drafter',  label: '1 — Submission Drafter' },
    { id: 'authorities_builder', label: '2 — Authorities' },
    { id: 'ruling_tracker_def',  label: '3 — Ruling Tracker' },
  ];
  const prosSubTabs: { id: ProsSubTab; label: string }[] = [
    { id: 'response_drafter',   label: '1 — Response Drafter' },
    { id: 'evidence_summary',   label: '2 — Evidence Summary' },
    { id: 'ruling_tracker_pros', label: '3 — Ruling Tracker' },
  ];

  const [subTab, setSubTab] = useState<SubTab>(isDefence ? 'submission_drafter' : 'response_drafter');

  // Defence state
  const [noCaseCounts,          setNoCaseCounts]          = useState<NoCaseCount[]>([emptyNoCaseCount(0)]);
  const [submissionDraft,       setSubmissionDraft]       = useState('');
  const [authoritiesResult,     setAuthoritiesResult]     = useState('');
  const [defRulings,            setDefRulings]            = useState<CountRulingRecord[]>([emptyRuling(0)]);
  const [defRulingNotes,        setDefRulingNotes]        = useState('');

  // Prosecution state
  const [responseContext,       setResponseContext]       = useState('');
  const [responseResult,        setResponseResult]        = useState('');
  const [prosCounts,            setProsCounts]            = useState<ProsSufficiencyCount[]>([emptyProsSufficiency(0)]);
  const [prosEvidenceSummary,   setProsEvidenceSummary]   = useState('');
  const [prosRulings,           setProsRulings]           = useState<CountRulingRecord[]>([emptyRuling(0)]);
  const [prosRulingNotes,       setProsRulingNotes]       = useState('');

  // Load
  useEffect(() => {
    loadBlindSpot(activeCase.id, STORAGE_KEY).then((d: SavedData | null) => {
      if (!d) return;
      if (d.noCaseCounts?.length)   setNoCaseCounts(d.noCaseCounts);
      if (d.submissionDraft)        setSubmissionDraft(d.submissionDraft);
      if (d.authoritiesResult)      setAuthoritiesResult(d.authoritiesResult);
      if (d.defRulings?.length)     setDefRulings(d.defRulings);
      if (d.defRulingNotes)         setDefRulingNotes(d.defRulingNotes);
      if (d.responseContext)        setResponseContext(d.responseContext);
      if (d.responseResult)         setResponseResult(d.responseResult);
      if (d.prosCounts?.length)     setProsCounts(d.prosCounts);
      if (d.prosEvidenceSummary)    setProsEvidenceSummary(d.prosEvidenceSummary);
      if (d.prosRulings?.length)    setProsRulings(d.prosRulings);
      if (d.prosRulingNotes)        setProsRulingNotes(d.prosRulingNotes);
    }).catch(() => {});
  }, [activeCase.id]);

  // Persist
  const persist = useCallback(() => {
    const data: SavedData = {
      noCaseCounts, submissionDraft, authoritiesResult, defRulings, defRulingNotes,
      responseContext, responseResult, prosCounts, prosEvidenceSummary, prosRulings, prosRulingNotes,
    };
    saveBlindSpot(activeCase.id, STORAGE_KEY, data).catch(() => {});
  }, [
    noCaseCounts, submissionDraft, authoritiesResult, defRulings, defRulingNotes,
    responseContext, responseResult, prosCounts, prosEvidenceSummary, prosRulings, prosRulingNotes,
    activeCase.id,
  ]);

  useEffect(() => { persist(); }, [persist]);

  const headingLabel = isDefence ? 'No-Case Submission — Defence' : 'No-Case Submission — Prosecution Response';
  const headingDesc  = isDefence
    ? 'Draft the no-case submission per count, build supporting authorities, and track the court\'s ruling. The Ajidagba/Ibeziako test governs.'
    : 'Draft the prosecution response, build per-count evidence summaries, and track the court\'s ruling for routing to the next stage.';

  // Discharged count badge (defence)
  const dischargedCount = isDefence
    ? defRulings.filter(r => r.ruling === 'Discharged' || r.ruling === 'Part Discharged').length
    : prosRulings.filter(r => r.ruling === 'Overruled').length;

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, color: accent, fontFamily: 'Inter, sans-serif',
            letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700,
            background: `${accent}14`, border: `1px solid ${accent}30`,
            padding: '3px 9px', borderRadius: 3,
          }}>
            Criminal · {isDefence ? 'Defence' : 'Prosecution'}
          </span>
          <span style={{
            fontSize: 9, color: '#888', fontFamily: 'Inter, sans-serif',
            letterSpacing: '.1em', textTransform: 'uppercase',
          }}>
            Phase 6B
          </span>
          {isDefence && submissionDraft && (
            <span style={{
              fontSize: 9, color: accent, fontFamily: 'Inter, sans-serif',
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              background: `${accent}14`, border: `1px solid ${accent}30`,
              padding: '3px 9px', borderRadius: 3,
            }}>
              ✓ DRAFT READY
            </span>
          )}
          {dischargedCount > 0 && (
            <span style={{
              fontSize: 9, fontFamily: 'Inter, sans-serif',
              letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
              padding: '3px 9px', borderRadius: 3,
              ...(isDefence
                ? { color: '#50c050', background: '#0d1800', border: '1px solid #285000' }
                : { color: '#c09030', background: '#180f00', border: '1px solid #3a2800' }),
            }}>
              {isDefence
                ? `✓ ${dischargedCount} COUNT${dischargedCount !== 1 ? 'S' : ''} DISCHARGED`
                : `✗ ${dischargedCount} COUNT${dischargedCount !== 1 ? 'S' : ''} OVERRULED → SURVIVE`}
            </span>
          )}
        </div>
        <h2 style={{
          fontSize: 26, color: T.text, fontWeight: 300,
          fontFamily: "'Cormorant Garamond', serif", marginBottom: 6,
        }}>
          {headingLabel}
        </h2>
        <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          {headingDesc}
        </p>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={isDefence ? defSubTabs : prosSubTabs}
        active={subTab}
        onSelect={id => setSubTab(id as SubTab)}
        accent={accent}
      />

      {/* Defence sub-tabs */}
      {isDefence && subTab === 'submission_drafter' && (
        <SubmissionDrafterTab
          counts={noCaseCounts} setCounts={setNoCaseCounts}
          submissionDraft={submissionDraft} setSubmissionDraft={setSubmissionDraft}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isDefence && subTab === 'authorities_builder' && (
        <AuthoritiesBuilderTab
          counts={noCaseCounts}
          authoritiesResult={authoritiesResult} setAuthoritiesResult={setAuthoritiesResult}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isDefence && subTab === 'ruling_tracker_def' && (
        <RulingTrackerTab
          rulings={defRulings} setRulings={setDefRulings}
          notes={defRulingNotes} setNotes={setDefRulingNotes}
          accent={accent} activeCase={activeCase} isDefence={true}
        />
      )}

      {/* Prosecution sub-tabs */}
      {isPros && subTab === 'response_drafter' && (
        <ResponseDrafterTab
          responseContext={responseContext} setResponseContext={setResponseContext}
          responseResult={responseResult}   setResponseResult={setResponseResult}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'evidence_summary' && (
        <EvidenceSummaryTab
          prosCounts={prosCounts} setProsCounts={setProsCounts}
          prosEvidenceSummary={prosEvidenceSummary} setProsEvidenceSummary={setProsEvidenceSummary}
          accent={accent} activeCase={activeCase}
        />
      )}
      {isPros && subTab === 'ruling_tracker_pros' && (
        <RulingTrackerTab
          rulings={prosRulings} setRulings={setProsRulings}
          notes={prosRulingNotes} setNotes={setProsRulingNotes}
          accent={accent} activeCase={activeCase} isDefence={false}
        />
      )}
    </div>
  );
}
