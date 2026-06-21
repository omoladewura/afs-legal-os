/**
 * AFS Advocates — CaseDocketTab
 *
 * Full docket management engine: entries timeline, BUTS briefing, manual
 * compress, AI limitation tracker, deadline engine, and hearing calendar.
 *
 * Sub-tabs:
 *   Entries   — docket entry form + timeline
 *   Deadlines — DeadlineEngine (limitation periods, filing dates)
 *   Calendar  — HearingCalendar (monthly grid + upcoming list)
 *
 * All persistence goes through storage/helpers (IndexedDB via Dexie).
 * The Case object on activeCase.recent_entries is the live source of truth
 * for this tab; deadlines are loaded from the deadlines table separately.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import {
  loadEntries, saveEntry, deleteEntry as dbDeleteEntry,
  loadDeadlines, saveDeadline, deleteDeadline as dbDeleteDeadline,
  saveCase, loadCase,
} from '@/storage/helpers';
import { uid } from '@/utils';
import { callClaude, withRetry } from '@/services/api';
import { indexCaseChunk } from '@/services/caseRag';
import { T } from '@/constants/tokens';
import { CASE_DOC_TYPES, CASE_STATUSES, STATUS_COLORS } from '@/constants/dashboard';
import { DeadlineEngine, HearingCalendar } from '@/engines/DeadlineCalendarTrackers';
import type { Case, DocketEntry, Deadline } from '@/types';
import { TypeDeleteModal } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL STYLE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #cccccc',
  borderRadius: 5, color: '#e0dcd0', padding: '10px 13px',
  fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
  outline: 'none', boxSizing: 'border-box',
};

const selS: React.CSSProperties = {
  ...iS, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
};

const lbS: React.CSSProperties = {
  fontSize: 9, color: '#5a5a72', fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.1em', textTransform: 'uppercase',
  fontWeight: 600, display: 'block', marginBottom: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const sc = STATUS_COLORS[status] ?? STATUS_COLORS['Filed'];
  return (
    <span style={{
      background: sc.bg, border: `1px solid ${sc.bdr}`, color: sc.col,
      fontSize: 9, padding: '2px 8px', borderRadius: 3,
      fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em',
      fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap',
    }}>
      {status || 'Filed'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function entriesToText(entries: DocketEntry[]): string {
  if (!entries.length) return 'None.';
  return entries.map(e =>
    `[${e.dateFiled}]${e.filedBy ? ` Filed by ${e.filedBy} —` : ''} ${e.docTitle}` +
    `${e.docType ? ` (${e.docType})` : ''} [${e.status || 'Filed'}]` +
    `${e.nextAdjournedDate ? ` · Next: ${e.nextAdjournedDate}` : ''}` +
    `${e.notes ? `\n  Notes: ${e.notes}` : ''}`
  ).join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLE MARKDOWN RENDERER (for BUTS output)
// ─────────────────────────────────────────────────────────────────────────────

function MdLine({ line }: { line: string }) {
  const renderInline = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith('**') && p.endsWith('**') && p.length > 4
        ? <strong key={i} style={{ color: '#ddd9cc', fontWeight: 600 }}>{p.slice(2, -2)}</strong>
        : p
    );

  if (line.startsWith('### ')) return <h3 style={{ fontSize: 10, color: '#606070', fontWeight: 600, marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: "'Times New Roman', Times, serif" }}>{line.slice(4)}</h3>;
  if (line.startsWith('## '))  return <h2 style={{ fontSize: 17, color: '#b8985a', fontWeight: 400, marginTop: 22, marginBottom: 7, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>{line.slice(3)}</h2>;
  if (line.startsWith('# '))   return <h1 style={{ fontSize: 22, color: '#111111', fontWeight: 400, borderBottom: `1px solid ${T.bdr}`, paddingBottom: 10, marginTop: 28, marginBottom: 12, fontFamily: "'Times New Roman', Times, serif" }}>{line.slice(2)}</h1>;
  if (line.startsWith('- ') || line.startsWith('• '))
    return <li style={{ margin: '5px 0 5px 20px', fontSize: 15, color: '#c2beb2', lineHeight: 1.85, listStyleType: 'disc', fontFamily: "'Times New Roman', Times, serif" }}>{renderInline(line.replace(/^[-•] /, ''))}</li>;
  if (/^\d+\.\s/.test(line))
    return <li style={{ margin: '5px 0 5px 28px', fontSize: 15, color: '#c2beb2', lineHeight: 1.85, listStyleType: 'decimal', fontFamily: "'Times New Roman', Times, serif" }}>{renderInline(line.replace(/^\d+\.\s*/, ''))}</li>;
  if (/^[-═─]{3,}$/.test(line.trim()))
    return <hr style={{ border: 'none', borderTop: `1px solid ${T.bdr}`, margin: '16px 0' }} />;
  if (line.trim() === '') return <div style={{ height: 8 }} />;
  return <p style={{ margin: '6px 0', fontSize: 15, color: '#cac6ba', lineHeight: 1.9, fontFamily: "'Times New Roman', Times, serif" }}>{renderInline(line)}</p>;
}

function Md({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split('\n');
  const nodes = lines.map((l, i) => <MdLine key={i} line={l} />);
  // wrap li sequences
  const wrapped: React.ReactNode[] = [];
  let k = 0;
  while (k < nodes.length) {
    const n = nodes[k] as React.ReactElement;
    if (n?.type === 'li') {
      const isOl = (n.props as {style?: React.CSSProperties})?.style?.listStyleType === 'decimal';
      const items: React.ReactNode[] = [];
      while (k < nodes.length && (nodes[k] as React.ReactElement)?.type === 'li') { items.push(nodes[k]); k++; }
      wrapped.push(React.createElement(isOl ? 'ol' : 'ul', { key: 'l' + k, style: { margin: '5px 0 5px 20px', padding: 0 } }, items));
    } else { wrapped.push(n); k++; }
  }
  return <div style={{ animation: 'fadeUp .3s ease' }}>{wrapped}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

export function CaseDocketTab({ activeCase }: Props) {
  const { updateActiveCase } = useAppStore();

  // ── Sub-tab ───────────────────────────────────────────────────────────────
  const [subTab, setSubTab] = useState<'entries' | 'deadlines' | 'calendar'>('entries');

  // ── Delete confirmation modal ─────────────────────────────────────────────
  const [deleteModal, setDeleteModal] = useState<{ id: string; label: string } | null>(null);

  // ── Entries state ─────────────────────────────────────────────────────────
  const [entries,  setEntries]  = useState<DocketEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  // Phase 2B — offline-from-cache detection (same heuristic as CaseDocket)
  const [fromCache, setFromCache] = useState(false);

  // ── Entry form ────────────────────────────────────────────────────────────
  const [showForm,     setShowForm]    = useState(false);
  const [efDate,       setEfDate]      = useState('');
  const [efBy,         setEfBy]        = useState('');
  const [efTitle,      setEfTitle]     = useState('');
  const [efNotes,      setEfNotes]     = useState('');
  const [efType,       setEfType]      = useState('');
  const [efNextDate,   setEfNextDate]  = useState('');
  const [efStatus,     setEfStatus]    = useState('Filed');
  const [efAttach,     setEfAttach]    = useState<{ name: string; type: string; data: string; size: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── BUTS (Bring Me Up To Speed) ───────────────────────────────────────────
  const [butsOpen, setButsOpen] = useState(false);
  const [butsL,    setButsL]    = useState(false);
  const [butsRes,  setButsRes]  = useState('');
  const [butsErr,  setButsErr]  = useState('');

  // ── Compress ──────────────────────────────────────────────────────────────
  const [compL, setCompL] = useState(false);

  // ── Deadlines ─────────────────────────────────────────────────────────────
  const [deadlines,  setDeadlines]  = useState<Deadline[]>([]);
  const [limitL,     setLimitL]     = useState(false);
  const [limitErr,   setLimitErr]   = useState('');

  // ── Load entries + deadlines on mount / case change ───────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFromCache(false);
    const start = Date.now();
    Promise.all([
      loadEntries(activeCase.id),
      loadDeadlines(activeCase.id),
    ]).then(([ents, dls]) => {
      if (cancelled) return;
      setEntries(ents);
      setDeadlines(dls);
      // Phase 2B — flag when data likely came from IndexedDB (fast return or offline)
      setFromCache(!navigator.onLine || (Date.now() - start) < 200);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeCase.id]);

  // ── Add entry ─────────────────────────────────────────────────────────────
  async function addEntry() {
    if (!efTitle.trim() || !efDate) return;
    const entry: DocketEntry = {
      id:                uid(),
      caseId:            activeCase.id,
      dateFiled:         efDate,
      filedBy:           efBy.trim(),
      docTitle:          efTitle.trim(),
      notes:             efNotes.trim(),
      docType:           efType,
      nextAdjournedDate: efNextDate,
      status:            efStatus,
      attachment:        efAttach,
      createdAt:         new Date().toISOString(),
    };
    await saveEntry(entry);
    setEntries(prev => [entry, ...prev]);

    // Reset form
    setEfDate(''); setEfBy(''); setEfTitle(''); setEfNotes('');
    setEfType(''); setEfNextDate(''); setEfStatus('Filed'); setEfAttach(null);
    setShowForm(false);

    // Auto-compress if too many entries
    if (entries.length >= 19) silentCompress([entry, ...entries]);
  }

  // ── Delete entry ──────────────────────────────────────────────────────────
  async function removeEntry(id: string) {
    setDeleteModal({ id, label: 'docket entry' });
  }

  async function confirmRemoveEntry(id: string) {
    await dbDeleteEntry(id);
    setEntries(prev => prev.filter(e => e.id !== id));
    setDeleteModal(null);
  }

  // ── Attachment handler ────────────────────────────────────────────────────
  function handleFile(file: File | null) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { alert('File too large — maximum 4MB.'); return; }
    const reader = new FileReader();
    reader.onload = e => setEfAttach({ name: file.name, type: file.type, data: e.target!.result as string, size: file.size });
    reader.readAsDataURL(file);
  }

  function openAttachment(attach: { name: string; type: string; data: string } | null) {
    if (!attach?.data) return;
    if (attach.type?.startsWith('image/')) {
      const w = window.open(); if (!w) return;
      w.document.write(`<html><body style="margin:0;background:#111"><img src="${attach.data}" style="max-width:100%;display:block" /></body></html>`);
    } else {
      const a = document.createElement('a'); a.href = attach.data; a.download = attach.name; a.click();
    }
  }

  // ── Bring Me Up To Speed ──────────────────────────────────────────────────
  async function buts() {
    if (butsL) return;
    setButsL(true); setButsErr(''); setButsRes(''); setButsOpen(true);
    const c = activeCase;
    const prompt = `CASE: ${c.caseName}
COURT: ${c.court || 'Not specified'}
SUIT NO: ${c.suitNo || 'Not specified'}
DATE COMMENCED: ${c.dateCommenced || 'Not specified'}
CLAIMANTS: ${c.claimants.map(x => x.name).filter(Boolean).join(', ') || 'Not listed'}
DEFENDANTS: ${c.defendants.map(x => x.name).filter(Boolean).join(', ') || 'Not listed'}
${c.compressed_summary ? `\nCOMPRESSED HISTORY (older entries):\n${c.compressed_summary}` : ''}
\nRECENT ENTRIES (newest first):\n${entriesToText(entries) || 'No entries recorded.'}

Provide a structured briefing:

## 1. What Has Happened
[Chronological account of proceedings to date]

## 2. Where Things Currently Stand
[Current stage of the case — last action taken, present status]

## 3. Next Steps
[Immediate actions required — specific, not generic]

## 4. Approaching Deadlines
[Dates flagged in the docket that are upcoming]

## 5. Procedural Gaps
[E.g. motion filed but no counter-affidavit; order made but no compliance entry]

## 6. Flags & Concerns
[Anything unusual, potentially missed, or requiring urgent attention]`;
    try {
      const butsRoleLabel = activeCase.counsel_role
        ? ({ claimant_side: 'Claimant Side', defendant_side: 'Defendant Side', prosecution: 'Prosecution', defence: 'Defence' }[activeCase.counsel_role] ?? activeCase.role ?? 'Counsel')
        : (activeCase.role ?? 'Counsel');
      const butsTrackLabel = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
      const res = await withRetry(() => callClaude({
        system: `You are Senior Counsel at AFS Advocates reviewing a litigation file. You are acting as ${butsRoleLabel} on a ${butsTrackLabel} matter. Brief the instructing solicitor directly, specifically, and practically from that perspective. Reference actual documents and dates from the docket. This is for a Nigerian advocate managing their own case file.`,
        userMsg: prompt,
        maxTokens: 2000,
      }));
      setButsRes(res);
    } catch (e: unknown) {
      setButsErr((e as Error).message || 'Failed. Please try again.');
    } finally {
      setButsL(false);
    }
  }

  // ── Manual compress ───────────────────────────────────────────────────────
  async function compressNow() {
    if (compL || entries.length === 0) return;
    setCompL(true);
    const half       = Math.ceil(entries.length / 2);
    const toCompress = entries.slice(half);   // older half
    const keep       = entries.slice(0, half); // newer half
    try {
      const summary = await withRetry(() => callClaude({
        system: 'You are a legal case management assistant. Compress Nigerian litigation docket entries into a tight factual summary. Preserve every date, party, document name, and key decision.',
        userMsg: `Case: ${activeCase.caseName}\n\nEntries:\n${entriesToText(toCompress)}\n\nExisting summary:\n${activeCase.compressed_summary || 'None.'}\n\nProduce merged summary.`,
        maxTokens: 1500,
      }));
      // Persist summary to case
      const fresh = await loadCase(activeCase.id);
      if (fresh) {
        fresh.compressed_summary = summary;
        await saveCase(fresh);
        updateActiveCase({ compressed_summary: summary });
      }
      // Delete compressed entries from IndexedDB
      await Promise.all(toCompress.map(e => dbDeleteEntry(e.id)));
      setEntries(keep);
    } catch (e: unknown) {
      alert('Compression failed: ' + (e as Error).message);
    } finally {
      setCompL(false);
    }
  }

  // ── Silent auto-compress ──────────────────────────────────────────────────
  async function silentCompress(allEntries: DocketEntry[]) {
    if (allEntries.length < 20) return;
    const toCompress = allEntries.slice(10);
    const keep       = allEntries.slice(0, 10);
    try {
      const summary = await withRetry(() => callClaude({
        system: 'You are a legal case management assistant. Compress Nigerian litigation docket entries into a concise factual summary. Preserve every date, party, document name, court order, and key decision.',
        userMsg: `Case: ${activeCase.caseName}\n\nEntries:\n${entriesToText(toCompress)}\n\nExisting summary:\n${activeCase.compressed_summary || 'None yet.'}\n\nMerge into a single compressed summary.`,
        maxTokens: 1000,
      }));
      const fresh = await loadCase(activeCase.id);
      if (fresh) {
        fresh.compressed_summary = summary;
        await saveCase(fresh);
        updateActiveCase({ compressed_summary: summary });
      }
      await Promise.all(toCompress.map(e => dbDeleteEntry(e.id)));
      setEntries(keep);

      // Phase 6: index the compressed docket chunk so case history RAG can
      // retrieve it. Fire-and-forget — indexCaseChunk never throws.
      indexCaseChunk({
        caseId:  activeCase.id,
        chunkId: `docket-compress-${Date.now()}`,
        text:    summary,
        type:    'docket_summary',
      });
    } catch { /* silent */ }
  }

  // ── Deadline CRUD ─────────────────────────────────────────────────────────
  async function addDeadline(dl: Deadline) {
    const withCase = { ...dl, caseId: activeCase.id };
    await saveDeadline(withCase);
    setDeadlines(prev => [...prev, withCase].sort((a, b) => a.date.localeCompare(b.date)));
  }

  async function removeDeadline(id: string) {
    await dbDeleteDeadline(id);
    setDeadlines(prev => prev.filter(d => d.id !== id));
  }

  async function updateDeadlineStatus(id: string, status: string) {
    const dl = deadlines.find(d => d.id === id);
    if (!dl) return;
    const updated = { ...dl, status };
    await saveDeadline(updated);
    setDeadlines(prev => prev.map(d => d.id === id ? updated : d));
  }

  // ── AI Limitation Tracker ─────────────────────────────────────────────────
  async function runLimitationTracker() {
    setLimitL(true); setLimitErr('');
    const today = new Date().toISOString().slice(0, 10);
    const limitRoleLabel = activeCase.counsel_role
      ? ({ claimant_side: 'Claimant Side', defendant_side: 'Defendant Side', prosecution: 'Prosecution', defence: 'Defence' }[activeCase.counsel_role] ?? activeCase.role ?? '')
      : (activeCase.role ?? '');
    const limitTrackLabel = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
    const caseCtx = `Case: ${activeCase.caseName}\nTrack: ${limitTrackLabel}\nRole: ${limitRoleLabel}\nCourt: ${activeCase.court || 'Not specified'}\nDate commenced: ${activeCase.dateCommenced || 'Not specified'}\nClaims/facts: ${activeCase.intelligence_data?.facts || activeCase.intelligence_data?.legal_issues || 'Not provided'}`;
    try {
      const raw = await withRetry(() => callClaude({
        system: 'You are a Nigerian litigation expert. Return only valid JSON arrays. No markdown, no backticks, no preamble.',
        userMsg: `Analyse this case and identify ALL applicable limitation periods and critical deadlines under Nigerian law.\n\n${caseCtx}\n\nReturn a JSON array. Each object: title (string), type (one of: "Limitation Period","Filing Deadline","Appeal Window","Compliance Date"), date (ISO date YYYY-MM-DD calculated from today ${today}), notes (cite statute and section). If insufficient facts, return [{"title":"Insufficient facts — run Intelligence Engine first","type":"Custom","date":"${today}","notes":"Please run the Trial Intelligence Engine to provide case facts before using the AI Limitation Tracker."}]. ONLY the JSON array.`,
        maxTokens: 1200,
      }));
      const cleaned = raw.replace(/^```json|^```|```$/gm, '').trim();
      const arr = JSON.parse(cleaned);
      if (!Array.isArray(arr)) throw new Error('Not an array');
      const newDeadlines: Deadline[] = arr.map((d: { title?: string; type?: string; date?: string; notes?: string }) => ({
        id:           uid(),
        label:        d.title || 'Untitled',
        type:         d.type  || 'Limitation Period',
        date:         d.date  || today,
        notes:        d.notes || '',
        status:       'Pending',
        aiGenerated:  true,
        caseId:       activeCase.id,
      }));
      await Promise.all(newDeadlines.map(d => saveDeadline(d)));
      setDeadlines(prev => [...prev, ...newDeadlines].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (e: unknown) {
      setLimitErr('Could not identify limitation periods. Please ensure the Intelligence Engine has been run. Error: ' + (e as Error).message);
    }
    setLimitL(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <div style={{ width: 28, height: 28, border: '2px solid #cccccc', borderTop: `2px solid ${T.gold}`, borderRadius: '50%', margin: '0 auto 14px', animation: 'spin .9s linear infinite' }} />
      <p style={{ fontSize: 14, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>Loading docket…</p>
    </div>
  );

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Phase 2B — offline-from-cache badge */}
      {fromCache && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', marginBottom: 14,
          background: '#fffbf0', border: '1px solid #e0cfa0', borderRadius: 4,
        }}>
          <span style={{ fontSize: 13, lineHeight: 1, color: '#7a4a00' }}>◌</span>
          <p style={{
            fontSize: 11, margin: 0, color: '#7a4a00',
            fontFamily: "'Times New Roman', Times, serif",
          }}>
            Showing locally cached docket — AI features require a connection
          </p>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteModal && (
        <TypeDeleteModal
          label={deleteModal.label}
          onConfirm={() => confirmRemoveEntry(deleteModal.id)}
          onCancel={() => setDeleteModal(null)}
        />
      )}

      {/* ── Sub-tab navigation ── */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 20, background: '#050508', border: '1px solid #111120', borderRadius: 7, padding: 3 }}>
        {([
          { id: 'entries',   label: 'Entries',   icon: '§' },
          { id: 'deadlines', label: 'Deadlines', icon: '⏱' },
          { id: 'calendar',  label: 'Calendar',  icon: '◫' },
        ] as const).map(sub => {
          const isActive = subTab === sub.id;
          const urgentDl = sub.id === 'deadlines' && deadlines.some(d =>
            d.status !== 'Dismissed' &&
            Math.round((new Date(d.date + 'T00:00:00').getTime() - Date.now()) / 86400000) <= 7
          );
          return (
            <button
              key={sub.id}
              onClick={() => setSubTab(sub.id)}
              style={{
                flex: 1, background: isActive ? '#0d0d1c' : 'transparent',
                border: `1px solid ${isActive ? T.gold : 'transparent'}`,
                color: isActive ? T.gold : T.mute,
                borderRadius: 5, padding: '7px 12px', fontSize: 10,
                fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
                letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600,
                transition: 'all .2s', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
              }}>
              <span style={{ opacity: .7 }}>{sub.icon}</span>
              {sub.label}
              {urgentDl && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c05050', display: 'inline-block', animation: 'glow 1.5s ease infinite' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ENTRIES SUB-TAB
      ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'entries' && (
        <>
          {/* Action row */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${T.bdr}` }}>
            {/* BUTS button */}
            <button
              onClick={buts}
              disabled={butsL}
              style={{
                background: butsL ? 'transparent' : 'linear-gradient(135deg,#c4a030,#a07820)',
                color: butsL ? T.mute : '#05050c',
                border: butsL ? '1px solid #1e1e2e' : 'none',
                borderRadius: 5, padding: '9px 18px', fontSize: 13,
                fontFamily: "'Times New Roman', Times, serif", cursor: butsL ? 'not-allowed' : 'pointer',
                fontWeight: 600, letterSpacing: '.03em',
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
              {butsL
                ? <><span style={{ width: 9, height: 9, border: '1.5px solid #2a2a38', borderTop: `1.5px solid ${T.gold}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} /> Briefing…</>
                : '◉ Bring Me Up To Speed'}
            </button>

            {/* New Entry toggle */}
            <button
              onClick={() => setShowForm(f => !f)}
              style={{
                background: showForm ? '#ffffff' : 'transparent',
                border: `1px solid ${showForm ? T.gold : '#cccccc'}`,
                color: showForm ? T.gold : T.mute,
                borderRadius: 5, padding: '9px 16px', fontSize: 12,
                fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em',
              }}>
              {showForm ? 'Cancel' : '+ New Entry'}
            </button>

            {/* Compress */}
            {entries.length > 4 && (
              <button
                onClick={compressNow}
                disabled={compL}
                style={{
                  background: 'transparent', border: '1px solid #cccccc',
                  color: compL ? T.mute : '#5a5a78', borderRadius: 5,
                  padding: '9px 13px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif",
                  cursor: compL ? 'not-allowed' : 'pointer', letterSpacing: '.04em',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                {compL
                  ? <><span style={{ width: 8, height: 8, border: '1.5px solid #1e1e2e', borderTop: `1.5px solid ${T.gold}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} /> Compressing…</>
                  : 'Compress Now'}
              </button>
            )}

            <span style={{ marginLeft: 'auto', fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.05em' }}>
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              {activeCase.compressed_summary ? ' · history compressed' : ''}
            </span>
          </div>

          {/* BUTS Panel */}
          {butsOpen && (
            <div style={{ background: '#ffffff', border: `1px solid ${butsErr ? '#4a1828' : T.gold}`, borderRadius: 10, padding: '20px 24px', marginBottom: 20, animation: 'fadeUp .25s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <p style={{ fontSize: 9, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600 }}>Senior Counsel's Briefing</p>
                <button onClick={() => setButsOpen(false)} style={{ background: 'transparent', border: 'none', color: T.mute, cursor: 'pointer', fontSize: 15, padding: '0 4px', lineHeight: 1 }}>✕</button>
              </div>
              {butsL
                ? <div style={{ textAlign: 'center', padding: '32px 0' }}>
                    <div style={{ width: 28, height: 28, border: '2px solid #cccccc', borderTop: `2px solid ${T.gold}`, borderRadius: '50%', margin: '0 auto 14px', animation: 'spin .9s linear infinite' }} />
                    <p style={{ fontSize: 15, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>Reviewing the file…</p>
                  </div>
                : butsErr
                  ? <p style={{ color: '#c07070', fontSize: 13, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>{butsErr}</p>
                  : butsRes ? <Md text={butsRes} /> : null}
            </div>
          )}

          {/* Compressed history */}
          {activeCase.compressed_summary && (
            <details style={{ background: '#ffffff', border: '1px solid #181828', borderRadius: 8, marginBottom: 16 }}>
              <summary style={{ padding: '11px 16px', fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.12em', textTransform: 'uppercase', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ width: 5, height: 5, background: T.gold, borderRadius: '50%', display: 'inline-block', flexShrink: 0, animation: 'glow 2.5s ease infinite' }} />
                Compressed History — Older Entries
                <span style={{ marginLeft: 'auto', fontSize: 9, color: '#cccccc' }}>▸</span>
              </summary>
              <div style={{ padding: '0 18px 16px', borderTop: '1px solid #131322' }}>
                <pre style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.9, whiteSpace: 'pre-wrap', margin: '12px 0 0', wordBreak: 'break-word' }}>{activeCase.compressed_summary}</pre>
              </div>
            </details>
          )}

          {/* Entry form */}
          {showForm && (
            <div style={{ background: '#0d0d1c', border: `1px solid ${T.gold}`, borderRadius: 10, padding: '22px 24px', marginBottom: 20, animation: 'fadeUp .22s ease' }}>
              <p style={{ fontSize: 9, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 18 }}>New Docket Entry</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13, marginBottom: 13 }}>
                <div>
                  <label style={lbS}>Date Filed <span style={{ color: '#b06060' }}>*</span></label>
                  <input type="date" value={efDate} onChange={e => setEfDate(e.target.value)} style={iS} />
                </div>
                <div>
                  <label style={lbS}>Filed By (Named Party)</label>
                  <input value={efBy} onChange={e => setEfBy(e.target.value)} placeholder="e.g. GTBank, 2nd Defendant" style={iS} />
                </div>
              </div>

              <div style={{ marginBottom: 13 }}>
                <label style={lbS}>Document Title <span style={{ color: '#b06060' }}>*</span></label>
                <input value={efTitle} onChange={e => setEfTitle(e.target.value)} placeholder="e.g. Statement of Claim, Motion on Notice, Judgment" style={iS} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 13, marginBottom: 13 }}>
                <div>
                  <label style={lbS}>Document Type</label>
                  <select value={efType} onChange={e => setEfType(e.target.value)} style={selS}>
                    <option value="">Select…</option>
                    {CASE_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbS}>Status</label>
                  <select value={efStatus} onChange={e => setEfStatus(e.target.value)} style={selS}>
                    {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbS}>Next Adjourned Date</label>
                  <input type="date" value={efNextDate} onChange={e => setEfNextDate(e.target.value)} style={iS} />
                </div>
              </div>

              <div style={{ marginBottom: 13 }}>
                <label style={lbS}>Notes / Description</label>
                <textarea value={efNotes} onChange={e => setEfNotes(e.target.value)} rows={3} placeholder="Key terms, summary, important points about this filing…" style={{ ...iS, resize: 'vertical', lineHeight: 1.75, minHeight: 70 } as React.CSSProperties} />
              </div>

              {/* Attachment */}
              <div style={{ marginBottom: 18 }}>
                <label style={lbS}>Attachment (PDF or Image — max 4MB)</label>
                <input type="file" ref={fileRef} style={{ display: 'none' }} accept=".pdf,.jpg,.jpeg,.png,.gif,.webp" onChange={e => handleFile(e.target.files?.[0] ?? null)} />
                {efAttach
                  ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#ffffff', border: '1px solid #cccccc', borderRadius: 5, padding: '9px 12px' }}>
                      <span style={{ fontSize: 14 }}>📎</span>
                      <span style={{ flex: 1, fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{efAttach.name}</span>
                      <span style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>{(efAttach.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => setEfAttach(null)} style={{ background: 'transparent', border: 'none', color: '#804040', cursor: 'pointer', fontSize: 13, padding: '0 3px', flexShrink: 0 }}>✕</button>
                    </div>
                  : <button onClick={() => fileRef.current?.click()} style={{ background: '#ffffff', border: '1px dashed #1e1e2e', color: T.mute, borderRadius: 5, padding: '10px', fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', width: '100%', textAlign: 'center', letterSpacing: '.04em' }}>📎 Attach PDF or Image</button>}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={addEntry}
                  disabled={!efTitle.trim() || !efDate}
                  style={{
                    flex: 1,
                    background: efTitle.trim() && efDate ? 'linear-gradient(135deg,#c4a030,#a07820)' : '#101018',
                    color: efTitle.trim() && efDate ? '#05050c' : '#2a2a38',
                    border: efTitle.trim() && efDate ? 'none' : '1px solid #181828',
                    borderRadius: 5, padding: '11px', fontSize: 15,
                    fontFamily: "'Times New Roman', Times, serif",
                    cursor: efTitle.trim() && efDate ? 'pointer' : 'not-allowed',
                    fontWeight: 600, letterSpacing: '.03em',
                  }}>
                  File Entry →
                </button>
                <button onClick={() => setShowForm(false)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 5, padding: '11px 18px', fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {entries.length === 0 && !showForm && (
            <div style={{ textAlign: 'center', padding: '56px 24px', background: '#0d0d18', border: '1px solid #181828', borderRadius: 10 }}>
              <div style={{ fontSize: 34, opacity: .07, marginBottom: 14 }}>§</div>
              <p style={{ fontSize: 18, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 6 }}>No entries recorded yet.</p>
              <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, maxWidth: 400, margin: '0 auto 18px' }}>
                Record each document after verifying and filing in court. Build the docket as the case progresses.
              </p>
              <button onClick={() => setShowForm(true)} style={{ background: 'transparent', border: `1px solid ${T.gold}`, color: '#444444', borderRadius: 5, padding: '9px 24px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em' }}>
                + File First Entry
              </button>
            </div>
          )}

          {/* Timeline */}
          {entries.length > 0 && (
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 19, top: 24, bottom: 24, width: 1, background: '#131320', zIndex: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {entries.map(entry => {
                  const sc = STATUS_COLORS[entry.status] ?? STATUS_COLORS['Filed'];
                  return (
                    <div key={entry.id} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: 14 }}>
                      <div style={{ width: 38, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 20, zIndex: 1 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc.col, border: '2px solid #07070f', flexShrink: 0 }} />
                      </div>
                      <div style={{ flex: 1, background: '#0d0d18', border: '1px solid #181828', borderRadius: 9, padding: '15px 17px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                              <span style={{ fontSize: 10, color: '#444444', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, letterSpacing: '.02em' }}>
                                {new Date(entry.dateFiled + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                              {entry.filedBy && (
                                <span style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
                                  filed by <span style={{ color: T.dim }}>{entry.filedBy}</span>
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 16, color: '#e0dcd0', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 7, lineHeight: 1.25 }}>
                              {entry.docTitle}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {entry.docType && (
                                <span style={{ fontSize: 9, color: '#4a5068', fontFamily: "'Times New Roman', Times, serif", border: '1px solid #1a1a2a', padding: '2px 7px', borderRadius: 2 }}>{entry.docType}</span>
                              )}
                              <StatusBadge status={entry.status || 'Filed'} />
                              {entry.nextAdjournedDate && (
                                <span style={{ fontSize: 9, color: '#7a5028', fontFamily: "'Times New Roman', Times, serif", border: '1px solid #2a1e08', padding: '2px 8px', borderRadius: 2 }}>
                                  ⏱ Next: {new Date(entry.nextAdjournedDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                              )}
                              {entry.attachment && (
                                <button onClick={() => openAttachment(entry.attachment)} style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
                                  📎 {entry.attachment.name.length > 20 ? entry.attachment.name.slice(0, 17) + '…' : entry.attachment.name}
                                </button>
                              )}
                            </div>
                            {entry.notes && (
                              <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8, borderTop: '1px solid #131322', paddingTop: 8, marginTop: 9 }}>{entry.notes}</p>
                            )}
                          </div>
                          <button
                            onClick={() => removeEntry(entry.id)}
                            title="Remove entry"
                            style={{ background: 'transparent', border: 'none', color: '#2a1a1a', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0, transition: 'color .15s', lineHeight: 1 }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#804040'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#2a1a1a'; }}>
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DEADLINES SUB-TAB
      ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'deadlines' && (
        <DeadlineEngine
          deadlines={deadlines}
          onAdd={addDeadline}
          onDelete={removeDeadline}
          onUpdateStatus={updateDeadlineStatus}
          onAITrack={runLimitationTracker}
          limitL={limitL}
          limitErr={limitErr}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          CALENDAR SUB-TAB
      ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'calendar' && (
        <HearingCalendar
          entries={entries}
          deadlines={deadlines}
        />
      )}
    </div>
  );
}
