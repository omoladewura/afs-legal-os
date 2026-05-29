/**
 * AFS Advocates — Deadline, Calendar, Filings & Timeline Engines
 * Phase 2 Migration: full port of 13_engine_deadline_calendar_tracker.txt
 *
 * Exports four components used in the Docket tab:
 *   DeadlineEngine    — limitation periods, filing deadlines, appeal windows
 *   HearingCalendar   — monthly calendar with hearing dates + deadlines overlaid
 *   FilingsTracker    — searchable/filterable filings registry table
 *   CaseTimeline      — chronological timeline grouped by month
 */

import { useState } from 'react';
import type { Case, Deadline, DocketEntry } from '@/types';
import { T } from '@/constants/tokens';
import { CASE_STATUSES, CASE_DOC_TYPES, DEADLINE_TYPES, STATUS_C } from '@/constants/legal';
import { uid } from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const iS: React.CSSProperties = {
  width: '100%', background: '#07070f', border: '1px solid #1e1e2e',
  borderRadius: 5, color: '#e0dcd0', padding: '9px 12px',
  fontSize: 14, fontFamily: "'Cormorant Garamond', serif",
  outline: 'none', boxSizing: 'border-box',
};

const lbS: React.CSSProperties = {
  fontSize: 9, color: '#5a5a72', fontFamily: 'Inter, sans-serif',
  letterSpacing: '.1em', textTransform: 'uppercase',
  fontWeight: 600, display: 'block', marginBottom: 5,
};

const selS: React.CSSProperties = {
  ...iS, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
};

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayStr(): string {
  return todayDate().toISOString().slice(0, 10);
}

function daysUntil(dateStr: string): number {
  return Math.round((new Date(dateStr + 'T00:00:00').getTime() - todayDate().getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', opts ?? {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE (shared by FilingsTracker + CaseTimeline)
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const sc = STATUS_C[status as keyof typeof STATUS_C] ?? STATUS_C['Filed'];
  return (
    <span style={{ background: sc.bg, border: `1px solid ${sc.bdr}`, color: sc.col, fontSize: 9, padding: '2px 8px', borderRadius: 3, fontFamily: 'Inter, sans-serif', letterSpacing: '.06em', fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap' }}>
      {status || 'Filed'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEADLINE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  'Limitation Period': '⏰',
  'Filing Deadline':   '📋',
  'Response Deadline': '↩',
  'Compliance Date':   '✓',
  'Appeal Window':     '↑',
  'Hearing Date':      '⚖',
  'Payment Deadline':  '💰',
  'Custom':            '◎',
};

function urgency(days: number): { col: string; bg: string; bdr: string; tag: string; pulse: boolean } {
  if (days < 0)   return { col: '#c05050', bg: '#1a0808', bdr: '#4a1818', tag: 'OVERDUE',           pulse: true  };
  if (days <= 7)  return { col: '#d06040', bg: '#1a0e08', bdr: '#5a2010', tag: `${days}d · URGENT`, pulse: true  };
  if (days <= 30) return { col: '#c09030', bg: '#1a1400', bdr: '#4a3800', tag: `${days}d`,           pulse: false };
  if (days <= 60) return { col: '#a0b030', bg: '#121800', bdr: '#303800', tag: `${days}d`,           pulse: false };
  return                 { col: '#40a868', bg: '#081810', bdr: '#1a4028', tag: `${days}d`,           pulse: false };
}

interface DeadlineEngineProps {
  deadlines:       Deadline[];
  onAdd:           (dl: Deadline) => void;
  onDelete:        (id: string) => void;
  onUpdateStatus:  (id: string, status: string) => void;
  onAITrack:       () => void;
  limitL:          boolean;
  limitErr:        string;
}

export function DeadlineEngine({
  deadlines, onAdd, onDelete, onUpdateStatus, onAITrack, limitL, limitErr,
}: DeadlineEngineProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [dlTitle,  setDlTitle]  = useState('');
  const [dlType,   setDlType]   = useState('Limitation Period');
  const [dlDate,   setDlDate]   = useState('');
  const [dlNotes,  setDlNotes]  = useState('');
  const [dlWarn,   setDlWarn]   = useState(30);

  const active    = (deadlines ?? []).filter(d => d.status !== 'Dismissed').sort((a, b) => daysUntil(a.date) - daysUntil(b.date));
  const dismissed = (deadlines ?? []).filter(d => d.status === 'Dismissed');
  const overdue   = active.filter(d => daysUntil(d.date) < 0).length;
  const urgent    = active.filter(d => { const x = daysUntil(d.date); return x >= 0 && x <= 7; }).length;
  const upcoming  = active.filter(d => { const x = daysUntil(d.date); return x > 7 && x <= 30; }).length;

  function submit() {
    if (!dlTitle.trim() || !dlDate) return;
    onAdd({
      id: uid(), label: dlTitle.trim(), type: dlType, date: dlDate,
      notes: dlNotes.trim(), status: 'Pending',
      aiGenerated: false, caseId: '',
    } as unknown as Deadline);
    setDlTitle(''); setDlDate(''); setDlNotes('');
    setDlType('Limitation Period'); setDlWarn(30); setFormOpen(false);
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Deadline Engine</p>
          <h3 style={{ fontSize: 20, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic' }}>Limitation &amp; Deadline Tracker</h3>
        </div>
        <button
          onClick={onAITrack} disabled={limitL}
          style={{ background: 'transparent', border: `1px solid ${limitL ? '#1e1e2e' : '#2a2208'}`, color: limitL ? T.mute : T.gold, borderRadius: 5, padding: '7px 13px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: limitL ? 'not-allowed' : 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {limitL
            ? <><span style={{ width: 8, height: 8, border: '1.5px solid #1e1e2e', borderTop: `1.5px solid ${T.gold}`, borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} /> Analysing...</>
            : '✦ AI Limitation Tracker'}
        </button>
        <button
          onClick={() => setFormOpen(o => !o)}
          style={{ background: formOpen ? '#0a0a14' : 'transparent', border: `1px solid ${formOpen ? T.gold : '#1e1e2e'}`, color: formOpen ? T.gold : T.mute, borderRadius: 5, padding: '7px 13px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', flexShrink: 0 }}>
          {formOpen ? '✕ Cancel' : '+ Add Deadline'}
        </button>
      </div>

      {/* Error */}
      {limitErr && (
        <div style={{ background: '#1a0810', border: '1px solid #4a1830', borderRadius: 6, padding: '11px 16px', color: '#c07070', fontSize: 13, fontFamily: 'Inter, sans-serif', lineHeight: 1.5, marginBottom: 14 }}>
          {limitErr}
        </div>
      )}

      {/* Summary pills */}
      {(overdue + urgent + upcoming) > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {overdue > 0 && (
            <div style={{ background: '#1a0808', border: '1px solid #4a1818', borderRadius: 5, padding: '6px 13px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: '#c05050' }}>⚠</span>
              <span style={{ fontSize: 9, color: '#c05050', fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>{overdue} Overdue</span>
            </div>
          )}
          {urgent > 0 && (
            <div style={{ background: '#1a0e08', border: '1px solid #4a2010', borderRadius: 5, padding: '6px 13px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: '#d06040' }}>⏱</span>
              <span style={{ fontSize: 9, color: '#d06040', fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>{urgent} This Week</span>
            </div>
          )}
          {upcoming > 0 && (
            <div style={{ background: '#1a1400', border: '1px solid #3a2e00', borderRadius: 5, padding: '6px 13px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#c09030', fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>{upcoming} This Month</span>
            </div>
          )}
        </div>
      )}

      {/* Add form */}
      {formOpen && (
        <div style={{ background: '#0d0d1c', border: `1px solid ${T.gold}`, borderRadius: 10, padding: '20px 22px', marginBottom: 18, animation: 'fadeUp .22s ease' }}>
          <p style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 16 }}>New Deadline</p>
          <div style={{ marginBottom: 12 }}>
            <label style={lbS}>Title <span style={{ color: '#b06060' }}>*</span></label>
            <input value={dlTitle} onChange={e => setDlTitle(e.target.value)} placeholder="e.g. Limitation Period - Breach of Contract" style={iS} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 11, marginBottom: 12 }}>
            <div>
              <label style={lbS}>Type</label>
              <select value={dlType} onChange={e => setDlType(e.target.value)} style={selS}>
                {DEADLINE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={lbS}>Deadline Date <span style={{ color: '#b06060' }}>*</span></label>
              <input type="date" value={dlDate} onChange={e => setDlDate(e.target.value)} style={iS} />
            </div>
            <div>
              <label style={lbS}>Warn (days before)</label>
              <input type="number" value={dlWarn} onChange={e => setDlWarn(Number(e.target.value))} min={1} max={365} style={iS} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbS}>Notes / Legal Basis</label>
            <textarea value={dlNotes} onChange={e => setDlNotes(e.target.value)} rows={2} placeholder="e.g. Section 9, Limitation Act - 6 years from breach date" style={{ ...iS, resize: 'vertical', lineHeight: 1.75, minHeight: 58 } as React.CSSProperties} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={submit} disabled={!dlTitle.trim() || !dlDate}
              style={{ flex: 1, background: dlTitle.trim() && dlDate ? 'linear-gradient(135deg,#c4a030,#a07820)' : '#101018', color: dlTitle.trim() && dlDate ? '#05050c' : '#2a2a38', border: dlTitle.trim() && dlDate ? 'none' : '1px solid #181828', borderRadius: 5, padding: '10px', fontSize: 15, fontFamily: "'Cormorant Garamond', serif", cursor: dlTitle.trim() && dlDate ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
              Track Deadline →
            </button>
            <button onClick={() => setFormOpen(false)} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 5, padding: '10px 16px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {active.length === 0 && !formOpen && (
        <div style={{ textAlign: 'center', padding: '52px 24px', background: '#080808', border: '1px solid #111120', borderRadius: 10 }}>
          <div style={{ fontSize: 36, opacity: .06, marginBottom: 12 }}>⏱</div>
          <p style={{ fontSize: 18, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 8 }}>No deadlines tracked.</p>
          <p style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.7, maxWidth: 440, margin: '0 auto 18px' }}>
            Track limitation periods, filing deadlines, compliance dates, and appeal windows. Missing a limitation period is irreversible.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onAITrack} disabled={limitL} style={{ background: 'transparent', border: `1px solid ${T.gold}`, color: T.gold, borderRadius: 5, padding: '8px 20px', fontSize: 13, fontFamily: "'Cormorant Garamond', serif", cursor: limitL ? 'not-allowed' : 'pointer', letterSpacing: '.04em' }}>✦ AI Limitation Tracker</button>
            <button onClick={() => setFormOpen(true)} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 5, padding: '8px 18px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}>+ Add Manually</button>
          </div>
        </div>
      )}

      {/* Deadline cards */}
      {active.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map(dl => {
            const days = daysUntil(dl.date);
            const uc   = urgency(days);
            return (
              <div key={dl.id} style={{ background: uc.bg, border: `1px solid ${uc.bdr}`, borderLeft: `3px solid ${uc.col}`, borderRadius: '0 8px 8px 0', padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 2, opacity: .8 }}>{TYPE_ICONS[dl.type] ?? '◎'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 8, color: uc.col, fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', border: `1px solid ${uc.bdr}44`, padding: '1px 7px', borderRadius: 2 }}>{dl.type}</span>
                      {dl.status === 'Done' && <span style={{ fontSize: 8, color: '#40b068', fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', border: '1px solid #1a4028', background: '#081810', padding: '1px 7px', borderRadius: 2 }}>✓ COMPLETED</span>}
                    </div>
                    <p style={{ fontSize: 16, color: uc.col, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 5, lineHeight: 1.25 }}>{dl.label}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, color: `${uc.col}bb`, fontFamily: 'Inter, sans-serif' }}>
                        {formatDate(dl.date, { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                      <span style={{ fontSize: 10, color: uc.col, fontFamily: 'Inter, sans-serif', fontWeight: 700, border: `1px solid ${uc.bdr}`, padding: '2px 9px', borderRadius: 3, animation: uc.pulse ? 'glow 1.5s ease infinite' : 'none' }}>
                        {days < 0 ? `OVERDUE · ${Math.abs(days)} days` : days === 0 ? 'DUE TODAY' : `${uc.tag} remaining`}
                      </span>
                    </div>
                    {dl.notes && (
                      <p style={{ fontSize: 12, color: `${uc.col}88`, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', lineHeight: 1.75, marginTop: 7, borderTop: `1px solid ${uc.bdr}44`, paddingTop: 7 }}>{dl.notes}</p>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                    {dl.status !== 'Done' && (
                      <button onClick={() => onUpdateStatus(dl.id, 'Done')} style={{ background: '#081810', border: '1px solid #1a4028', color: '#40a868', borderRadius: 3, padding: '4px 10px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>✓ Done</button>
                    )}
                    <button onClick={() => onUpdateStatus(dl.id, 'Dismissed')} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: '#3a3a52', borderRadius: 3, padding: '4px 10px', fontSize: 9, cursor: 'pointer', fontFamily: 'Inter, sans-serif', letterSpacing: '.06em' }}>Dismiss</button>
                    <button
                      onClick={() => onDelete(dl.id)}
                      style={{ background: 'transparent', border: 'none', color: '#2a1a1a', cursor: 'pointer', fontSize: 12, padding: '2px 4px', lineHeight: 1, transition: 'color .15s' }}
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
      )}

      {/* Dismissed accordion */}
      {dismissed.length > 0 && (
        <details style={{ marginTop: 14, background: '#080808', border: '1px solid #111120', borderRadius: 8 }}>
          <summary style={{ padding: '10px 16px', fontSize: 9, color: '#2a2a3e', fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', listStyle: 'none', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ marginLeft: 'auto', opacity: .5 }}>{dismissed.length} dismissed ▸</span>
          </summary>
          <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #111120', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {dismissed.map(dl => (
              <div key={dl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span style={{ fontSize: 12, color: '#2a2a3a', fontFamily: "'Cormorant Garamond', serif", flex: 1, textDecoration: 'line-through' }}>{dl.label} — {dl.date}</span>
                <button
                  onClick={() => onDelete(dl.id)}
                  style={{ background: 'transparent', border: 'none', color: '#3a1a1a', cursor: 'pointer', fontSize: 11, padding: '0 4px', transition: 'color .15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#804040'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#3a1a1a'; }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEARING CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  type:    'hearing' | 'deadline';
  label:   string;
  status?: string;
  dlType?: string;
}

interface HearingCalendarProps {
  entries:   DocketEntry[];
  deadlines: Deadline[];
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export function HearingCalendar({ entries, deadlines }: HearingCalendarProps) {
  const [viewDate,      setViewDate]  = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDate,  setSelected]  = useState<string | null>(null);

  const today    = todayDate();
  const todaySt  = todayStr();

  // Build event map keyed by YYYY-MM-DD
  const eventMap: Record<string, CalendarEvent[]> = {};
  (entries ?? []).forEach(e => {
    if (!e.nextAdjournedDate) return;
    const k = e.nextAdjournedDate;
    if (!eventMap[k]) eventMap[k] = [];
    eventMap[k].push({ type: 'hearing', label: e.docTitle, status: e.status ?? 'Filed' });
  });
  (deadlines ?? []).filter(d => d.status !== 'Dismissed').forEach(d => {
    const k = d.date;
    if (!eventMap[k]) eventMap[k] = [];
    eventMap[k].push({ type: 'deadline', label: d.label, dlType: d.type });
  });

  const year     = viewDate.getFullYear();
  const month    = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInM  = new Date(year, month + 1, 0).getDate();

  type Cell = { day: number; dateStr: string; events: CalendarEvent[] } | null;
  const cells: Cell[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInM; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr, events: eventMap[dateStr] ?? [] });
  }

  const upcomingDates = Object.entries(eventMap)
    .filter(([k]) => k >= todaySt)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 6);

  function prevMonth() { const d = new Date(viewDate); d.setMonth(d.getMonth() - 1); setViewDate(d); setSelected(null); }
  function nextMonth() { const d = new Date(viewDate); d.setMonth(d.getMonth() + 1); setViewDate(d); setSelected(null); }

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>
      <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Hearing Calendar</p>
      <h3 style={{ fontSize: 20, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 18 }}>Hearing &amp; Deadline Calendar</h3>

      {/* Calendar grid */}
      <div style={{ background: '#080808', border: '1px solid #111120', borderRadius: 10, padding: '20px 22px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <button onClick={prevMonth} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 4, padding: '5px 14px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>←</button>
          <span style={{ fontSize: 18, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, letterSpacing: '.04em' }}>{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 4, padding: '5px 14px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>→</button>
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>
          {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 8, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 0', fontWeight: 600 }}>{d}</div>)}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
          {cells.map((cell, i) => {
            if (!cell) return <div key={'e' + i} />;
            const isToday  = cell.dateStr === todaySt;
            const isPast   = cell.dateStr < todaySt;
            const hasH     = cell.events.some(e => e.type === 'hearing');
            const hasD     = cell.events.some(e => e.type === 'deadline');
            const isSel    = selectedDate === cell.dateStr;
            const hasEv    = cell.events.length > 0;
            return (
              <div
                key={cell.dateStr}
                onClick={() => hasEv && setSelected(isSel ? null : cell.dateStr)}
                style={{ textAlign: 'center', borderRadius: 5, padding: '5px 2px', cursor: hasEv ? 'pointer' : 'default', background: isSel ? '#1a1408' : isToday ? '#0e0c04' : 'transparent', border: `1px solid ${isSel ? T.gold : isToday ? '#2a2208' : hasEv ? '#1a1a28' : 'transparent'}`, transition: 'all .15s', minHeight: 34 }}>
                <div style={{ fontSize: 11, color: isToday ? T.gold : isPast ? '#252535' : T.dim, fontFamily: 'Inter, sans-serif', fontWeight: isToday ? 600 : 400, marginBottom: 2 }}>{cell.day}</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
                  {hasH && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#5090d0', display: 'inline-block' }} />}
                  {hasD && <span style={{ width: 5, height: 5, borderRadius: 2, background: '#c05050', display: 'inline-block' }} />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 12, paddingTop: 10, borderTop: '1px solid #111120' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5090d0', display: 'inline-block' }} />
            <span style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif' }}>Hearing date</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#c05050', display: 'inline-block' }} />
            <span style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif' }}>Deadline</span>
          </div>
          <button onClick={() => { const d = new Date(); d.setDate(1); setViewDate(d); }} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: T.mute, fontSize: 9, fontFamily: 'Inter, sans-serif', cursor: 'pointer', textDecoration: 'underline' }}>Today</button>
        </div>
      </div>

      {/* Selected date detail */}
      {selectedDate && eventMap[selectedDate] && (
        <div style={{ background: '#0d0d18', border: `1px solid ${T.gold}`, borderRadius: 8, padding: '16px 20px', marginBottom: 14, animation: 'fadeUp .2s ease' }}>
          <p style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          {eventMap[selectedDate].map((ev, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid #131322' : 'none' }}>
              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{ev.type === 'hearing' ? '⚖' : '⏱'}</span>
              <div>
                <p style={{ fontSize: 14, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 3, lineHeight: 1.25 }}>{ev.label}</p>
                <span style={{ fontSize: 8, color: ev.type === 'hearing' ? '#5090d0' : '#c05050', fontFamily: 'Inter, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, border: `1px solid ${ev.type === 'hearing' ? '#1a3060' : '#4a1818'}`, background: ev.type === 'hearing' ? '#081428' : '#1a0808', padding: '1px 6px', borderRadius: 2 }}>
                  {ev.type === 'hearing' ? ev.status : ev.dlType ?? 'Deadline'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming list */}
      {upcomingDates.length > 0 ? (
        <div>
          <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Upcoming Dates</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {upcomingDates.map(([dateStr, evs]) => {
              const d    = new Date(dateStr + 'T12:00:00');
              const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              const urgCol = diff === 0 ? '#d06040' : diff <= 7 ? '#c09030' : diff <= 30 ? '#a0a070' : T.dim;
              return (
                <div
                  key={dateStr}
                  onClick={() => { const nd = new Date(dateStr + 'T12:00:00'); nd.setDate(1); setViewDate(nd); setSelected(dateStr); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#080808', border: '1px solid #111120', borderRadius: 6, padding: '10px 14px', cursor: 'pointer', transition: 'border-color .15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1e1e2e'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#111120'; }}>
                  <div style={{ flexShrink: 0, minWidth: 68 }}>
                    <div style={{ fontSize: 13, color: urgCol, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, lineHeight: 1 }}>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                    <div style={{ fontSize: 8, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.06em' }}>{diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${diff}d away`}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {evs.map((ev, i) => <p key={i} style={{ fontSize: 13, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.label}</p>)}
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    {evs.some(e => e.type === 'hearing')  && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5090d0', display: 'inline-block' }} />}
                    {evs.some(e => e.type === 'deadline') && <span style={{ width: 7, height: 7, borderRadius: 2, background: '#c05050', display: 'inline-block' }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '32px 24px', background: '#080808', border: '1px solid #111120', borderRadius: 8 }}>
          <p style={{ fontSize: 15, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>No upcoming hearings or deadlines.</p>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', lineHeight: 1.7, marginTop: 6 }}>Add entries with Next Adjourned Dates in the Docket tab, or track deadlines in the Deadline Engine.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FILINGS TRACKER
// ─────────────────────────────────────────────────────────────────────────────

interface FilingsTrackerProps {
  activeCase: Case;
}

export function FilingsTracker({ activeCase }: FilingsTrackerProps) {
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType,   setFilterType]   = useState('');
  const [searchQ,      setSearchQ]      = useState('');

  const entries = activeCase.recent_entries ?? [];
  const today   = todayDate();

  const filtered = entries.filter(e => {
    if (filterStatus && e.status !== filterStatus) return false;
    if (filterType   && e.docType !== filterType)  return false;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      return (
        e.docTitle.toLowerCase().includes(q) ||
        (e.notes   ?? '').toLowerCase().includes(q) ||
        (e.filedBy ?? '').toLowerCase().includes(q) ||
        (e.docType ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const stats = [
    { label: 'Total Filed', val: entries.length,                                                                                                                col: T.gold },
    { label: 'Pending',     val: entries.filter(e => ['Filed','Pending Hearing','Awaiting Response'].includes(e.status)).length,                                col: '#9060c0' },
    { label: 'Adjourned',   val: entries.filter(e => e.status === 'Adjourned').length,                                                                          col: '#b07030' },
    { label: 'Concluded',   val: entries.filter(e => ['Decided','Complied With','Settled','Withdrawn','Struck Out'].includes(e.status)).length,                 col: '#40a868' },
  ];

  const filterIS: React.CSSProperties = { background: '#07070f', border: '1px solid #1e1e2e', borderRadius: 5, color: '#e0dcd0', padding: '8px 12px', fontSize: 12, fontFamily: "'Cormorant Garamond', serif", outline: 'none' };

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>
      <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Filings Tracker</p>
      <h3 style={{ fontSize: 20, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 16 }}>Filings Registry</h3>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ background: '#080808', border: '1px solid #111120', borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ fontSize: 22, color: s.col, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 8, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 2, minWidth: 150 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.mute, fontSize: 13, pointerEvents: 'none', fontFamily: "'Cormorant Garamond', serif" }}>⌕</span>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search filings…" style={{ ...filterIS, paddingLeft: 30, width: '100%', boxSizing: 'border-box' }} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...filterIS, flex: 1, minWidth: 110, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' } as React.CSSProperties}>
          <option value="">All Statuses</option>
          {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...filterIS, flex: 1, minWidth: 110, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' } as React.CSSProperties}>
          <option value="">All Types</option>
          {CASE_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filterStatus || filterType || searchQ) && (
          <button onClick={() => { setFilterStatus(''); setFilterType(''); setSearchQ(''); }} style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 5, padding: '6px 11px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>✕ Clear</button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', background: '#080808', border: '1px solid #111120', borderRadius: 10 }}>
          <p style={{ fontSize: 17, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>
            {entries.length === 0 ? 'No filings recorded yet. Add entries via the Docket tab.' : 'No filings match this filter.'}
          </p>
        </div>
      ) : (
        <div style={{ background: '#080808', border: '1px solid #111120', borderRadius: 10, overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr 90px 90px 100px', gap: 0, background: '#050508', padding: '9px 14px', borderBottom: '1px solid #111120' }}>
            {['Date Filed', 'Document / Filing', 'Filed By', 'Status', 'Next Date'].map(h => (
              <span key={h} style={{ fontSize: 8, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{h}</span>
            ))}
          </div>

          {filtered.map((entry, i) => {
            const sc       = STATUS_C[entry.status as keyof typeof STATUS_C] ?? STATUS_C['Filed'];
            const nextDate = entry.nextAdjournedDate ? new Date(entry.nextAdjournedDate + 'T12:00:00') : null;
            const isPast   = nextDate && nextDate < today;
            return (
              <div
                key={entry.id}
                style={{ display: 'grid', gridTemplateColumns: '88px 1fr 90px 90px 100px', gap: 0, padding: '11px 14px', borderBottom: i < filtered.length - 1 ? '1px solid #0d0d14' : 'none', transition: 'background .15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#0a0a12'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                <div style={{ paddingRight: 8 }}>
                  <div style={{ fontSize: 11, color: T.dim, fontFamily: 'Inter, sans-serif', lineHeight: 1.2 }}>{formatDate(entry.dateFiled, { day: 'numeric', month: 'short' })}</div>
                  <div style={{ fontSize: 9, color: '#1e1e2e', fontFamily: 'Inter, sans-serif' }}>{new Date(entry.dateFiled + 'T12:00:00').getFullYear()}</div>
                </div>
                <div style={{ paddingRight: 8, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#e0dcd0', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.docTitle}</div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {entry.docType && <span style={{ fontSize: 8, color: '#3a3a52', fontFamily: 'Inter, sans-serif', border: '1px solid #1a1a2a', padding: '1px 6px', borderRadius: 2 }}>{entry.docType}</span>}
                    {entry.attachment && <span style={{ fontSize: 8, color: '#2a3a4a', fontFamily: 'Inter, sans-serif' }}>📎</span>}
                  </div>
                </div>
                <div style={{ paddingRight: 8 }}>
                  <span style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{entry.filedBy || '—'}</span>
                </div>
                <div style={{ paddingRight: 8 }}>
                  <StatusBadge status={entry.status || 'Filed'} />
                </div>
                <div>
                  {nextDate
                    ? <span style={{ fontSize: 10, color: isPast ? '#3a3a52' : '#b07030', fontFamily: 'Inter, sans-serif', fontWeight: isPast ? 400 : 600 }}>{nextDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    : <span style={{ color: '#1e1e2e', fontSize: 11, fontFamily: 'Inter, sans-serif' }}>—</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Compressed summary */}
      {activeCase.compressed_summary && (
        <details style={{ marginTop: 14, background: '#080808', border: '1px solid #111120', borderRadius: 8 }}>
          <summary style={{ padding: '10px 16px', fontSize: 9, color: '#2a2a3e', fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', listStyle: 'none', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, background: T.gold, borderRadius: '50%', animation: 'glow 2.5s ease infinite', display: 'inline-block', flexShrink: 0 }} />
            Compressed Filing History
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#1e1e2e' }}>▸</span>
          </summary>
          <div style={{ padding: '0 16px 14px', borderTop: '1px solid #111120' }}>
            <pre style={{ fontSize: 12, color: T.dim, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.9, whiteSpace: 'pre-wrap', margin: '12px 0 0', wordBreak: 'break-word' }}>{activeCase.compressed_summary}</pre>
          </div>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE TIMELINE
// ─────────────────────────────────────────────────────────────────────────────

interface CaseTimelineProps {
  activeCase: Case;
}

export function CaseTimeline({ activeCase }: CaseTimelineProps) {
  const entries = activeCase.recent_entries ?? [];

  if (entries.length === 0) return (
    <div style={{ textAlign: 'center', padding: '68px 24px', animation: 'fadeUp .3s ease' }}>
      <div style={{ fontSize: 40, opacity: .07, marginBottom: 16 }}>⏳</div>
      <p style={{ fontSize: 22, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 8 }}>Timeline is empty.</p>
      <p style={{ fontSize: 13, color: T.dim, fontFamily: 'Inter, sans-serif', lineHeight: 1.7 }}>Add entries to the Docket to build the case timeline.</p>
    </div>
  );

  // Sort ascending for chronological display
  const sorted = [...entries].sort((a, b) => new Date(a.dateFiled + 'T12:00:00').getTime() - new Date(b.dateFiled + 'T12:00:00').getTime());

  // Group by YYYY-MM
  const groups: Record<string, { label: string; entries: DocketEntry[] }> = {};
  sorted.forEach(e => {
    const d   = new Date(e.dateFiled + 'T12:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = { label: lbl, entries: [] };
    groups[key].entries.push(e);
  });

  const claimantStr  = activeCase.claimants.map(p => p.name).filter(Boolean).join(' & ') || '[Claimant]';
  const defendantStr = activeCase.defendants.map(p => p.name).filter(Boolean).join(' & ') || '[Defendant]';

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>
      <p style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Case Timeline</p>
      <h3 style={{ fontSize: 20, color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 3 }}>{activeCase.caseName}</h3>
      <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 22 }}>
        {claimantStr}<span style={{ color: '#2a2a3e', margin: '0 8px' }}>v.</span>{defendantStr}
      </p>

      {/* Case commencement marker */}
      {activeCase.dateCommenced && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 14, alignItems: 'center' }}>
          <div style={{ width: 90, flexShrink: 0, textAlign: 'right', paddingRight: 18 }}>
            <span style={{ fontSize: 9, color: '#3a3a52', fontFamily: 'Inter, sans-serif' }}>
              {formatDate(activeCase.dateCommenced, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2a2a3e', border: '2px solid #07070f', flexShrink: 0 }} />
          <div style={{ flex: 1, marginLeft: 12 }}>
            <span style={{ fontSize: 11, color: '#3a3a52', fontFamily: 'Inter, sans-serif', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>Case Commenced</span>
          </div>
        </div>
      )}

      {/* Compressed summary block */}
      {activeCase.compressed_summary && (
        <div style={{ marginLeft: 100, marginBottom: 22, background: '#0a0a14', border: '1px solid #1a1a2e', borderLeft: '3px solid #2a2860', borderRadius: '0 8px 8px 0', padding: '12px 16px' }}>
          <p style={{ fontSize: 9, color: '#4a4a68', fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>Earlier History — Compressed</p>
          <pre style={{ fontSize: 12, color: '#4a4a68', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{activeCase.compressed_summary}</pre>
        </div>
      )}

      {/* Timeline */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 99, top: 0, bottom: 0, width: 1, background: 'linear-gradient(180deg,transparent,#1e1e2e 4%,#1e1e2e 96%,transparent)', zIndex: 0 }} />

        {Object.values(groups).map((group, gi) => (
          <div key={gi} style={{ marginBottom: 24 }}>
            {/* Month label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, position: 'relative' }}>
              <div style={{ width: 90, flexShrink: 0, textAlign: 'right', paddingRight: 18, zIndex: 1 }}>
                <span style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, background: '#0a0a14', padding: '3px 7px', borderRadius: 3, border: '1px solid #2a2208', whiteSpace: 'nowrap' }}>
                  {group.label}
                </span>
              </div>
              <div style={{ flex: 1, height: 1, background: '#181828' }} />
            </div>

            {group.entries.map(entry => {
              const sc = STATUS_C[entry.status as keyof typeof STATUS_C] ?? STATUS_C['Filed'];
              const d  = new Date(entry.dateFiled + 'T12:00:00');
              return (
                <div key={entry.id} style={{ display: 'flex', gap: 0, marginBottom: 10, position: 'relative' }}>
                  {/* Date label */}
                  <div style={{ width: 90, flexShrink: 0, textAlign: 'right', paddingRight: 18, paddingTop: 13, zIndex: 1 }}>
                    <div style={{ fontSize: 10, color: T.dim, fontFamily: 'Inter, sans-serif', lineHeight: 1.2 }}>
                      {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>

                  {/* Dot */}
                  <div style={{ position: 'relative', zIndex: 1, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 15 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: sc.col, border: '2px solid #07070f', flexShrink: 0, boxShadow: `0 0 7px ${sc.col}44` }} />
                  </div>

                  {/* Entry card */}
                  <div
                    style={{ flex: 1, marginLeft: 12, background: '#0d0d18', border: '1px solid #181828', borderRadius: 8, padding: '12px 16px', transition: 'border-color .15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#262634'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#181828'; }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                      <span style={{ fontSize: 15, color: '#e0dcd0', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, flex: 1, lineHeight: 1.25 }}>{entry.docTitle}</span>
                      <StatusBadge status={entry.status || 'Filed'} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      {entry.docType && <span style={{ fontSize: 9, color: '#3a3a52', fontFamily: 'Inter, sans-serif', border: '1px solid #1a1a2a', padding: '1px 6px', borderRadius: 2 }}>{entry.docType}</span>}
                      {entry.filedBy && <span style={{ fontSize: 9, color: T.mute, fontFamily: 'Inter, sans-serif' }}>by {entry.filedBy}</span>}
                      {entry.nextAdjournedDate && (
                        <span style={{ fontSize: 9, color: '#7a5028', fontFamily: 'Inter, sans-serif', border: '1px solid #2a1e08', padding: '1px 7px', borderRadius: 2 }}>
                          ⏱ {formatDate(entry.nextAdjournedDate, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {entry.attachment && <span style={{ fontSize: 9, color: '#2a3a4a', fontFamily: 'Inter, sans-serif' }}>📎 {entry.attachment.name}</span>}
                    </div>
                    {entry.notes && (
                      <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.8, borderTop: '1px solid #131322', paddingTop: 7, marginTop: 8, fontStyle: 'italic' }}>
                        {entry.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p style={{ textAlign: 'center', fontSize: 10, color: '#1e1e2e', fontFamily: 'Inter, sans-serif', marginTop: 20, letterSpacing: '.1em' }}>
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} on the record
        {activeCase.dateCommenced ? ` · Commenced ${formatDate(activeCase.dateCommenced, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
      </p>
    </div>
  );
}
