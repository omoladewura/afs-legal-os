/**
 * AFS Advocates — Brief Me Before Court
 *
 * One-click pre-hearing briefing. Pulls from:
 *   - Case identity + metadata
 *   - Intelligence Engine package
 *   - Appeal Engine data
 *   - Docket entries & compressed summary
 *   - Evidence Vault metadata
 *   - Deadlines
 *   - Optional Google Drive RAG
 *
 * Outputs 8 structured sections saved per-case.
 * Fully migrated from app.html Step 9.
 */

import React, { useState, useRef, useEffect } from 'react';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { useIntelligence } from '@/hooks/useIntelligence';
import { copyToClipboard } from '@/utils';
import { loadEvidenceMeta, loadDeadlines, loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import type { Case, EvidenceItem, Deadline } from '@/types';

// ── Evidence categories (mirrors EvidenceVault) ───────────────────────────────

const EV_CATS = [
  { id: 'contract',    label: 'Contracts'      },
  { id: 'affidavit',  label: 'Affidavits'     },
  { id: 'receipt',    label: 'Receipts'       },
  { id: 'chat',       label: 'Chats'          },
  { id: 'audio',      label: 'Audio'          },
  { id: 'photo',      label: 'Photos'         },
  { id: 'court_order',label: 'Court Orders'   },
  { id: 'expert',     label: 'Expert Reports' },
  { id: 'other',      label: 'Other'          },
] as const;

// ── Section config ────────────────────────────────────────────────────────────

interface SectionConfig {
  id:    string;
  icon:  string;
  label: string;
  col:   string;
  bg:    string;
  bdr:   string;
}

const BM_SECTIONS: SectionConfig[] = [
  { id: 'today_matter',         icon: '📋', label: "Today's Matter",              col: '#000000', bg: '#100d02', bdr: T.bdr },
  { id: 'pending_applications', icon: '⚖',  label: 'Pending Applications',        col: '#4a7ed0', bg: '#040c18', bdr: '#0e1e38' },
  { id: 'key_issues',           icon: '🎯', label: 'Key Issues Before the Court', col: '#a060d0', bg: '#0a0414', bdr: '#1e0a30' },
  { id: 'opponent_arguments',   icon: '🗡', label: "Opponent's Likely Arguments", col: '#d07060', bg: '#120404', bdr: '#380e0e' },
  { id: 'best_authorities',     icon: '📚', label: 'Best Authorities to Cite',    col: '#40a068', bg: '#020e06', bdr: '#0a2818' },
  { id: 'weaknesses',           icon: '⚠',  label: 'Weaknesses to Address',       col: '#c08040', bg: '#100800', bdr: '#341808' },
  { id: 'last_order',           icon: '📌', label: 'Last Court Order',            col: '#6090c0', bg: '#040c14', bdr: '#0c1e2c' },
  { id: 'urgent_tasks',         icon: '🚨', label: 'Urgent Tasks Before Court',   col: '#c04848', bg: '#120202', bdr: '#380808' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface BriefingSections {
  today_matter:         string;
  pending_applications: string;
  key_issues:           string;
  opponent_arguments:   string;
  best_authorities:     string;
  weaknesses:           string;
  last_order:           string;
  urgent_tasks:         string;
  [key: string]: string;
}

interface BriefingResult {
  sections:    BriefingSections;
  generatedAt: string;
  hearingDate: string;
  courtName:   string;
  todayMatter: string;
}

interface PersistedBmData {
  hearingDate:  string;
  courtName:    string;
  todayMatter:  string;
  briefing:     BriefingResult | null;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BriefMe({ activeCase }: Props) {
  const caseId = activeCase.id;
  const { fullContext } = useIntelligence(activeCase);

  const [hearingDate,  setHearingDate]  = useState('');
  const [courtName,    setCourtName]    = useState('');
  const [todayMatter,  setTodayMatter]  = useState('');
  const [useDrive,     setUseDrive]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [briefing,     setBriefing]     = useState<BriefingResult | null>(null);
  const [copied,       setCopied]       = useState('');
  const [allCopied,    setAllCopied]    = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBlindSpot<PersistedBmData>(caseId, 'briefme', { hearingDate: '', courtName: '', todayMatter: '', briefing: null })
      .then(d => {
        setHearingDate(d.hearingDate ?? '');
        setCourtName(d.courtName ?? '');
        setTodayMatter(d.todayMatter ?? '');
        setBriefing(d.briefing ?? null);
      });
  }, [caseId]);

  
  function persist(patch: Partial<PersistedBmData>): void {
    saveBlindSpot(caseId, 'briefme', { hearingDate, courtName, todayMatter, briefing, ...patch });
  }

  // ── Context packet builder ──────────────────────────────────────────────────

  async function buildContextPacket(): Promise<string> {
    const c = activeCase;
    const lines: string[] = [];

    lines.push(`CASE: ${c.caseName}`);
    lines.push(`SUIT NO: ${c.suitNo || 'Not specified'}`);
    lines.push(`COURT: ${c.court || 'Not specified'}`);
    const track = c.matter_track || 'civil';
    const counselRole = c.counsel_role || c.role || 'claimant_side';
    lines.push(`MATTER TRACK: ${track.toUpperCase()}`);
    lines.push(`COUNSEL ROLE: ${counselRole.toUpperCase().replace(/_/g, ' ')} (we act as ${counselRole.replace(/_/g, ' ')} on this matter)`);
    lines.push(`CLAIMANTS: ${c.claimants.map(p => p.name).filter(Boolean).join(', ') || 'Not specified'}`);
    lines.push(`DEFENDANTS: ${c.defendants.map(p => p.name).filter(Boolean).join(', ') || 'Not specified'}`);
    if (c.dateCommenced) lines.push(`DATE COMMENCED: ${c.dateCommenced}`);

    if (hearingDate) lines.push(`\nHEARING DATE: ${hearingDate}`);
    if (courtName)   lines.push(`COURT/JUDGE TODAY: ${courtName}`);
    if (todayMatter) lines.push(`TODAY'S APPLICATION / MATTER (as known): ${todayMatter}`);

    const intel = c.intelligence_data;
    if (intel) {
      if (intel.rawFacts) lines.push(`\n── CASE FACTS ──\n${intel.rawFacts}`);
      if (intel.intPkg)   lines.push(`\n── INTELLIGENCE PACKAGE ──\n${intel.intPkg}`);
      const ex = intel.extraction;
      if (ex) {
        if (ex.legal_issues?.length)    lines.push(`\nLEGAL ISSUES:\n${ex.legal_issues.map(i => `- ${i}`).join('\n')}`);
        if (ex.disputed_areas?.length)  lines.push(`\nDISPUTED AREAS:\n${ex.disputed_areas.map(i => `- ${i}`).join('\n')}`);
        if (ex.gaps_identified?.length) lines.push(`\nEVIDENCE GAPS:\n${ex.gaps_identified.map(i => `- ${i}`).join('\n')}`);
        if (ex.initial_risks?.length)   lines.push(`\nRISKS:\n${ex.initial_risks.map(r => `- [${r.severity}] ${r.risk}`).join('\n')}`);
      }
    }

    if (c.appeal_data?.package) {
      lines.push(`\n── APPELLATE PACKAGE ──\n${c.appeal_data.package}`);
    }

    if (c.compressed_summary) {
      lines.push(`\n── DOCKET HISTORY ──\n${c.compressed_summary}`);
    }

    const entries = c.recent_entries ?? [];
    if (entries.length) {
      lines.push(`\n── RECENT DOCKET ENTRIES (${entries.length}) ──`);
      entries.slice(0, 15).forEach(e => {
        let line = `[${e.dateFiled}] ${e.docTitle}${e.docType ? ` (${e.docType})` : ''} [${e.status || 'Filed'}]`;
        if (e.nextAdjournedDate) line += ` · Next: ${e.nextAdjournedDate}`;
        if (e.notes)             line += `\n  Notes: ${e.notes}`;
        lines.push(line);
      });
    }

    try {
      const evItems: EvidenceItem[] = await loadEvidenceMeta(caseId);
      if (evItems.length) {
        lines.push(`\n── EVIDENCE VAULT (${evItems.length} docs) ──`);
        evItems.forEach(ev => {
          const cat  = EV_CATS.find(c => c.id === ev.category)?.label ?? ev.category;
          const date = new Date(ev.timestamp).toLocaleDateString('en-GB');
          lines.push(`[${cat}] ${ev.filename}${ev.notes ? ` — ${ev.notes}` : ''} (${date})`);
        });
      }
    } catch { /* vault unavailable */ }

    try {
      const allDeadlines: Deadline[] = await loadDeadlines(caseId);
      const pending = allDeadlines.filter(d => d.status !== 'Dismissed');
      if (pending.length) {
        lines.push(`\n── DEADLINES ──`);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        pending.forEach(d => {
          const diff = Math.round((new Date(`${d.date}T00:00:00`).getTime() - today.getTime()) / 86400000);
          const tag  = diff < 0 ? '[OVERDUE]' : diff === 0 ? '[TODAY]' : `[${diff}d]`;
          lines.push(`${tag} ${d.label} — ${d.date}${d.notes ? ` · ${d.notes}` : ''}`);
        });
      }
    } catch { /* deadlines unavailable */ }

    return lines.join('\n');
  }

  // ── Generate briefing ───────────────────────────────────────────────────────

  async function generateBriefing(): Promise<void> {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const context = await buildContextPacket();

      const prompt = `You are Senior Counsel at AFS Advocates briefing yourself immediately before going to court. You have reviewed the entire case file below. Produce a tight, specific, actionable pre-hearing briefing.

Output ONLY valid JSON — no markdown fences, no preamble, exactly this structure:
{
  "today_matter": "Precise description of today's matter — what is listed, what we expect to do, the specific application or stage. If not specified, state the most likely matter based on the docket.",
  "pending_applications": "List every pending application in the file — who filed, what it is, its status, and whether it is likely to come up today. Be specific.",
  "key_issues": "The 3-5 most critical legal and factual issues presently before the court. What does the court need to decide? Order by importance.",
  "opponent_arguments": "What will opposing counsel argue today and at this stage? Anticipate their three strongest points, their likely procedural tactics, and any ambush moves based on the file.",
  "best_authorities": "The most useful Nigerian cases, statutes, and rules of court for today's hearing. Give case names, holdings, and why each is relevant RIGHT NOW. Cite rules of court where applicable.",
  "weaknesses": "Our current vulnerabilities — evidence gaps, procedural risks, factual weaknesses, commitments already made to court that constrain us. Be direct.",
  "last_order": "What was the last order made by the court in this case? Extract it from the docket. If none, state so clearly.",
  "urgent_tasks": "The 3-5 most urgent tasks to complete BEFORE the hearing — documents to prepare, instructions to take, filings to make, witnesses to reach. Ordered by urgency."
}

CASE FILE:
${context}`;

      const briefingTrack      = activeCase.matter_track || 'civil';
      const briefingCounselRole = activeCase.counsel_role || activeCase.role || 'claimant_side';
      const roleCtxMap: Record<string, string> = {
        claimant_side:  'You act for the CLAIMANT. Frame every section — risks, authorities, urgent tasks, opponent arguments — from the claimant\'s perspective. Flag default opportunities, enforcement readiness, and how to advance the claim today.',
        defendant_side: 'You act for the DEFENDANT. Frame every section from the defendant\'s perspective. Flag default judgment exposure, available applications, and how to resist or limit the claim today.',
        prosecution:    'You act as PROSECUTION COUNSEL. Frame every section from the prosecution\'s perspective under ACJA 2015. Flag evidence gaps, witness schedule, admissibility issues, and how to advance the prosecution case today.',
        defence:        'You act as DEFENCE COUNSEL. Frame every section from the defence\'s perspective under ACJA 2015. Flag bail status, remand deadlines, no-case threshold, cross-examination priorities, and how to protect the accused today.',
      };
      const roleInstruction = roleCtxMap[briefingCounselRole] ?? roleCtxMap['claimant_side'];

      const raw = await callClaude({
        system:    `You are Senior Counsel at AFS Advocates. You produce precise, actionable pre-court briefings for Nigerian litigation.\nMATTER TRACK: ${briefingTrack.toUpperCase()} | COUNSEL ROLE: ${briefingCounselRole.toUpperCase().replace(/_/g, ' ')}\n${roleInstruction}\nYou speak directly and specifically — no generalities. You reference actual documents, dates, and parties from the file. You output ONLY valid JSON as specified.` + fullContext,
        userMsg:   prompt,
        maxTokens: 3000,
        mcpDrive:  useDrive,
      });

      const clean  = raw.replace(/^```json|^```|```$/gm, '').trim();
      const parsed = JSON.parse(clean) as BriefingSections;

      const result: BriefingResult = {
        sections:    parsed,
        generatedAt: new Date().toISOString(),
        hearingDate,
        courtName,
        todayMatter,
      };

      setBriefing(result);
      persist({ briefing: result });
      setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    } catch (e) {
      setError((e as Error).message || 'Briefing failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Copy helpers ────────────────────────────────────────────────────────────

  async function copySection(id: string, text: string): Promise<void> {
    await copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  }

  async function copyAll(): Promise<void> {
    if (!briefing?.sections) return;
    const body = BM_SECTIONS
      .map(s => {
        const txt = briefing.sections[s.id];
        return txt ? `${'═'.repeat(56)}\n${s.icon} ${s.label.toUpperCase()}\n${'═'.repeat(56)}\n\n${txt}` : null;
      })
      .filter(Boolean)
      .join('\n\n\n');

    const full = [
      `BRIEF ME BEFORE COURT — ${activeCase.caseName}`,
      briefing.hearingDate ? `Hearing: ${briefing.hearingDate}` : '',
      `Generated: ${new Date(briefing.generatedAt).toLocaleString('en-GB')}`,
      '',
      body,
    ].filter(Boolean).join('\n');

    await copyToClipboard(full);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2500);
  }

  function clearBriefing(): void {
    if (!window.confirm('Clear this briefing? The inputs will remain.')) return;
    setBriefing(null);
    persist({ briefing: null });
  }

  const hasEnoughContext = !!(
    (activeCase.recent_entries ?? []).length > 0 ||
    activeCase.intelligence_data ||
    activeCase.compressed_summary
  );

  // ── Input styles ────────────────────────────────────────────────────────────

  const iS: React.CSSProperties = {
    width: '100%', background: '#ffffff', border: '1px solid #cccccc',
    borderRadius: 5, color: '#e0dcd0', padding: '10px 13px',
    fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
    outline: 'none', boxSizing: 'border-box',
  };
  const lbS: React.CSSProperties = {
    fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
    letterSpacing: '.1em', textTransform: 'uppercase',
    fontWeight: 600, display: 'block', marginBottom: 5,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ animation: 'fadeUp .3s ease' }} ref={topRef}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22, paddingBottom: 20, borderBottom: `1px solid ${T.bdr}` }}>
        <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#120800,#0a0300)', border: '1px solid #3a2008', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
          🎯
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600 }}>Brief Me · Step 9</span>
            {briefing && (
              <span style={{ fontSize: 8, color: '#40a860', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', border: '1px solid #1a4028', background: T.card, padding: '1px 7px', borderRadius: 2, textTransform: 'uppercase' }}>
                ✓ Briefing Ready
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 24, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, letterSpacing: '.02em', marginBottom: 5, lineHeight: 1.2 }}>
            Brief Me Before Court
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', lineHeight: 1.65 }}>
            One click pulls from your entire case file — docket, evidence vault, intelligence package, and Google Drive — and delivers a structured pre-hearing briefing.
          </p>
        </div>
      </div>

      {/* ── Thin context warning ── */}
      {!hasEnoughContext && (
        <div style={{ background: '#0e0a04', border: '1px solid #3a2808', borderRadius: 8, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⚠</span>
          <div>
            <p style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 3 }}>Thin case file detected</p>
            <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
              Add docket entries or run the Intelligence Engine first for a fuller briefing.
            </p>
          </div>
        </div>
      )}

      {/* ── Input panel ── */}
      <div style={{ background: '#0d0d18', border: `1px solid ${T.bdr}`, borderRadius: 10, padding: '22px 24px', marginBottom: 20 }}>
        <p style={{ fontSize: 9, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 16 }}>
          Hearing Context (Optional — improves accuracy)
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={lbS}>Hearing Date</label>
            <input
              type="date"
              value={hearingDate}
              onChange={e => { setHearingDate(e.target.value); persist({ hearingDate: e.target.value }); }}
              style={iS}
            />
          </div>
          <div>
            <label style={lbS}>Court / Judge (if known)</label>
            <input
              value={courtName}
              onChange={e => { setCourtName(e.target.value); persist({ courtName: e.target.value }); }}
              placeholder="e.g. Coram: Justice Okonkwo — Court 5"
              style={iS}
            />
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={lbS}>Today's Application / Matter (if already known)</label>
          <textarea
            value={todayMatter}
            onChange={e => { setTodayMatter(e.target.value); persist({ todayMatter: e.target.value }); }}
            rows={2}
            placeholder="e.g. Ruling on our Motion to Set Aside / cross-examination of DW1 / mention for hearing dates"
            style={{ ...iS, resize: 'vertical', lineHeight: 1.75 } as React.CSSProperties}
          />
        </div>

        {/* Drive toggle */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
          <button
            onClick={() => setUseDrive(v => !v)}
            style={{
              background: useDrive ? '#100f20' : 'transparent',
              border: `1px solid ${useDrive ? T.text + '50' : T.bdr}`,
              color: useDrive ? T.text : T.mute,
              borderRadius: 4, padding: '5px 13px', fontSize: 10,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: useDrive ? T.text : T.bdr, display: 'inline-block', flexShrink: 0 }} />
            Google Drive RAG
          </button>
          <span style={{ fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif" }}>
            — docket · evidence vault · intelligence engine
          </span>
        </div>

        {/* Generate button */}
        <button
          onClick={generateBriefing}
          disabled={loading}
          style={{
            width: '100%',
            background: loading ? '#eeeeee' : '#000000',
            color: loading ? T.mute : '#05050c',
            border: loading ? '1px solid #1e1e2e' : 'none',
            borderRadius: 7, padding: '14px 24px', fontSize: 17,
            fontFamily: "'Times New Roman', Times, serif",
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600, letterSpacing: '.04em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {loading ? (
            <>
              <span style={{ width: 14, height: 14, border: '2px solid #1a1400', borderTop: `2px solid ${T.text}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} />
              Reviewing the file and briefing…
            </>
          ) : briefing ? '🔄 Re-Generate Briefing' : '🎯 Generate Pre-Hearing Briefing'}
        </button>

        {error && (
          <div style={{ marginTop: 12, background: T.card, border: '1px solid #4a1818', borderRadius: 6, padding: '11px 16px', color: T.mute, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55 }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Briefing output ── */}
      {briefing && (
        <div style={{ animation: 'fadeUp .35s ease' }}>

          {/* Briefing header */}
          <div style={{ background: T.card, border: `1px solid ${T.text}33`, borderRadius: 10, padding: '18px 22px', marginBottom: 18, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 9, color: T.text, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 5 }}>
                Pre-Hearing Briefing · Ready
              </p>
              <h3 style={{ fontSize: 20, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>
                {activeCase.caseName}
              </h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {briefing.hearingDate && (
                  <span style={{ fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif", border: '1px solid #3a2208', padding: '2px 9px', borderRadius: 2 }}>
                    ⏱ {new Date(`${briefing.hearingDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                )}
                {briefing.courtName && (
                  <span style={{ fontSize: 10, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                    {briefing.courtName}
                  </span>
                )}
                <span style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                  Generated {new Date(briefing.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
              <button
                onClick={copyAll}
                style={{ background: allCopied ? '#071808' : 'transparent', border: `1px solid ${allCopied ? T.bdr : T.bdr}`, color: allCopied ? '#40a858' : T.mute, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}
              >
                {allCopied ? '✓ Copied' : 'Copy All'}
              </button>
              <button
                onClick={clearBriefing}
                style={{ background: 'transparent', border: '1px solid #2a1a1a', color: '#6a3030', borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Section cards */}
          {BM_SECTIONS.map(sec => {
            const text = briefing.sections[sec.id];
            if (!text) return null;
            return (
              <div
                key={sec.id}
                style={{ background: sec.bg, border: `1px solid ${sec.bdr}`, borderLeft: `3px solid ${sec.col}`, borderRadius: '0 10px 10px 0', padding: '18px 22px', marginBottom: 14 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>{sec.icon}</span>
                    <span style={{ fontSize: 9, color: sec.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600 }}>
                      {sec.label}
                    </span>
                  </div>
                  <button
                    onClick={() => copySection(sec.id, text)}
                    style={{ background: copied === sec.id ? '#071808' : 'transparent', border: `1px solid ${copied === sec.id ? T.bdr : T.bdr}`, color: copied === sec.id ? '#40a858' : T.mute, borderRadius: 3, padding: '3px 11px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.06em' }}
                  >
                    {copied === sec.id ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: 14, color: `${sec.col}dd`, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {text}
                </div>
              </div>
            );
          })}

          <p style={{ fontSize: 10, color: T.bdr, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, textAlign: 'center', marginTop: 8 }}>
            All outputs are AI-generated. Verify every authority and order before relying in court. You decide — SAN guides.
          </p>
        </div>
      )}

      {/* ── Empty state ── */}
      {!briefing && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: '#fafaf8', border: '1px dashed #cccccc', borderRadius: 4 }}>
          <div style={{ fontSize: 48, opacity: .06, marginBottom: 16 }}>🎯</div>
          <p style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 8 }}>
            No briefing generated yet
          </p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.85, maxWidth: 440, margin: '0 auto' }}>
            Add your hearing date and today's matter above, then press Generate. Brief Me pulls from your docket, evidence vault, intelligence package, and Google Drive to produce a complete pre-hearing briefing in seconds.
          </p>
        </div>
      )}

    </div>
  );
}
