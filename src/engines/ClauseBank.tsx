/**
 * AFS Advocates — Clause Bank
 * Phase C1
 *
 * Replaces the old Asset Library (whole-document file cabinet) with a
 * fragment intelligence store: short, reusable pieces of drafting language
 * that worked — prayers, grounds of appeal, objection formulations,
 * affidavit paragraphs — tagged and searchable, not buried in a PDF.
 *
 * Two ways in:
 *   1. Settings Panel — full management view (search, add, edit, delete).
 *   2. <ClauseBankPicker /> — a compact popover any drafting engine can
 *      mount via a "Pull from Clause Bank" button mid-draft.
 *
 * Storage: localStorage, namespaced 'afs_clause_bank'. Self-contained —
 * does not depend on the IndexedDB media_library tables the old Asset
 * Library used, since fragments are plain text, not files.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { T, S } from '@/constants/tokens';
import { uid } from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ClauseFragmentType =
  | 'prayer'
  | 'ground'
  | 'objection'
  | 'affidavit_paragraph'
  | 'recital'
  | 'submission'
  | 'other';

export const CLAUSE_TYPE_LABELS: Record<ClauseFragmentType, string> = {
  prayer:               'Prayer',
  ground:                'Ground of Appeal',
  objection:             'Objection',
  affidavit_paragraph:   'Affidavit Paragraph',
  recital:               'Recital',
  submission:            'Submission',
  other:                 'Other',
};

export type CourtLevel =
  | 'magistrate'
  | 'high_court'
  | 'federal_high_court'
  | 'nicn'
  | 'tribunal'
  | 'court_of_appeal'
  | 'supreme_court'
  | 'any';

export const COURT_LEVEL_LABELS: Record<CourtLevel, string> = {
  magistrate:          'Magistrate Court',
  high_court:          'High Court',
  federal_high_court:  'Federal High Court',
  nicn:                'NICN',
  tribunal:            'Tribunal',
  court_of_appeal:     'Court of Appeal',
  supreme_court:       'Supreme Court',
  any:                 'Any Court',
};

export type ClauseMatterTrack = 'civil' | 'criminal' | 'matrimonial' | 'any';

export interface ClauseFragment {
  id:          string;
  text:        string;
  type:        ClauseFragmentType;
  courtLevel:  CourtLevel;
  matterTrack: ClauseMatterTrack;
  sourceLabel?: string;   // e.g. "Suit FHC/L/CS/123/2024 — won"
  notes?:      string;
  createdAt:   string;
  usageCount:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE — localStorage, self-contained
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY = 'afs_clause_bank';

export function loadFragments(): ClauseFragment[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: ClauseFragment[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    // storage full or unavailable — fail silently, non-critical feature
  }
}

export function saveFragment(input: {
  text: string;
  type: ClauseFragmentType;
  courtLevel: CourtLevel;
  matterTrack: ClauseMatterTrack;
  sourceLabel?: string;
  notes?: string;
}): ClauseFragment {
  const fragment: ClauseFragment = {
    id:          uid(),
    text:        input.text.trim(),
    type:        input.type,
    courtLevel:  input.courtLevel,
    matterTrack: input.matterTrack,
    sourceLabel: input.sourceLabel?.trim() || undefined,
    notes:       input.notes?.trim() || undefined,
    createdAt:   new Date().toISOString(),
    usageCount:  0,
  };
  const items = loadFragments();
  items.unshift(fragment);
  persist(items);
  return fragment;
}

export function deleteFragment(id: string) {
  persist(loadFragments().filter(f => f.id !== id));
}

export function markFragmentUsed(id: string) {
  const items = loadFragments();
  const idx = items.findIndex(f => f.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], usageCount: items[idx].usageCount + 1 };
    persist(items);
  }
}

/** Simple relevance search over text/notes/sourceLabel/type — no AI call, just term matching. */
export function searchFragments(
  query: string,
  filters?: { type?: ClauseFragmentType; courtLevel?: CourtLevel; matterTrack?: ClauseMatterTrack },
): ClauseFragment[] {
  let items = loadFragments();
  if (filters?.type) items = items.filter(f => f.type === filters.type);
  if (filters?.courtLevel) items = items.filter(f => f.courtLevel === filters.courtLevel || f.courtLevel === 'any');
  if (filters?.matterTrack) items = items.filter(f => f.matterTrack === filters.matterTrack || f.matterTrack === 'any');

  const q = query.trim().toLowerCase();
  if (!q) return items;

  const terms = q.split(/\s+/).filter(Boolean);
  return items
    .map(f => {
      const haystack = `${f.text} ${f.notes ?? ''} ${f.sourceLabel ?? ''} ${CLAUSE_TYPE_LABELS[f.type]}`.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      return { f, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.f);
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI BITS
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface FragmentCardProps {
  fragment: ClauseFragment;
  onCopy:   (f: ClauseFragment) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}

function FragmentCard({ fragment, onCopy, onDelete, compact }: FragmentCardProps) {
  return (
    <div style={{
      background: T.bg, border: `1px solid ${T.bdrL}`,
      borderRadius: 6, padding: compact ? '10px 12px' : '12px 14px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{
          fontSize: 9, color: T.dim, border: `1px solid ${T.bdr}`,
          borderRadius: 3, padding: '1px 7px', textTransform: 'uppercase',
          letterSpacing: '.06em', fontFamily: "'Times New Roman', Times, serif",
        }}>
          {CLAUSE_TYPE_LABELS[fragment.type]}
        </span>
        <span style={{
          fontSize: 9, color: T.mute, border: `1px solid ${T.bdrL}`,
          borderRadius: 3, padding: '1px 7px',
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          {COURT_LEVEL_LABELS[fragment.courtLevel]}
        </span>
        {fragment.usageCount > 0 && (
          <span style={{ fontSize: 9, color: '#bbbbbb', fontFamily: "'Times New Roman', Times, serif" }}>
            used {fragment.usageCount}×
          </span>
        )}
      </div>

      <p style={{
        fontSize: 13, color: T.text, lineHeight: 1.6, margin: '0 0 8px',
        fontFamily: "'Times New Roman', Times, serif",
        display: '-webkit-box', WebkitLineClamp: compact ? 3 : 6,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {fragment.text}
      </p>

      {fragment.sourceLabel && (
        <p style={{ ...S.hint, fontSize: 11, margin: '0 0 6px', fontStyle: 'italic' }}>
          {fragment.sourceLabel}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#bbbbbb', fontFamily: "'Times New Roman', Times, serif" }}>
          {fmtDate(fragment.createdAt)}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onCopy(fragment)}
            style={{
              background: T.text, color: '#fff', border: 'none',
              borderRadius: 3, padding: '5px 12px', fontSize: 11,
              cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            {compact ? 'Pull In' : 'Copy'}
          </button>
          {onDelete && (
            <button
              onClick={() => onDelete(fragment.id)}
              style={{
                background: 'none', border: '1px solid #e8d0d0',
                color: '#b04040', borderRadius: 3, padding: '5px 8px', fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD FRAGMENT FORM
// ─────────────────────────────────────────────────────────────────────────────

function AddFragmentForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [text, setText]               = useState('');
  const [type, setType]               = useState<ClauseFragmentType>('prayer');
  const [courtLevel, setCourtLevel]   = useState<CourtLevel>('any');
  const [matterTrack, setMatterTrack] = useState<ClauseMatterTrack>('any');
  const [sourceLabel, setSourceLabel] = useState('');
  const [notes, setNotes]             = useState('');

  function submit() {
    if (!text.trim()) return;
    saveFragment({ text, type, courtLevel, matterTrack, sourceLabel, notes });
    onAdded();
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: T.card, border: `1px solid ${T.bdrL}`,
    borderRadius: 4, color: T.text, fontFamily: "'Times New Roman', Times, serif",
    fontSize: 12, padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.bdr}`,
      borderRadius: 7, padding: 16, marginBottom: 14,
    }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste the fragment — a prayer, ground, objection, or affidavit paragraph that worked…"
        rows={4}
        style={{ ...inputStyle, marginBottom: 10, resize: 'vertical' }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        <select value={type} onChange={e => setType(e.target.value as ClauseFragmentType)} style={inputStyle}>
          {Object.entries(CLAUSE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={courtLevel} onChange={e => setCourtLevel(e.target.value as CourtLevel)} style={inputStyle}>
          {Object.entries(COURT_LEVEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={matterTrack} onChange={e => setMatterTrack(e.target.value as ClauseMatterTrack)} style={inputStyle}>
          <option value="any">Any Track</option>
          <option value="civil">Civil</option>
          <option value="criminal">Criminal</option>
          <option value="matrimonial">Matrimonial</option>
        </select>
      </div>
      <input
        value={sourceLabel}
        onChange={e => setSourceLabel(e.target.value)}
        placeholder="Source (optional) — e.g. Suit FHC/L/CS/123/2024"
        style={{ ...inputStyle, marginBottom: 10 }}
      />
      <input
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        style={{ ...inputStyle, marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={submit}
          disabled={!text.trim()}
          style={{
            background: text.trim() ? T.text : '#cccccc', color: '#fff', border: 'none',
            borderRadius: 4, padding: '8px 18px', fontSize: 12,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          Save Fragment
        </button>
        <button
          onClick={onCancel}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`, color: T.mute,
            borderRadius: 4, padding: '8px 16px', fontSize: 12, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL MANAGEMENT VIEW — mounted in Settings Panel
// ─────────────────────────────────────────────────────────────────────────────

export function ClauseBank() {
  const [items, setItems]       = useState<ClauseFragment[]>([]);
  const [query, setQuery]       = useState('');
  const [typeFilter, setTypeFilter] = useState<ClauseFragmentType | 'all'>('all');
  const [showAdd, setShowAdd]   = useState(false);
  const [toast, setToast]       = useState('');

  useEffect(() => { setItems(loadFragments()); }, []);

  function refresh() {
    setItems(loadFragments());
    setShowAdd(false);
  }

  function handleCopy(f: ClauseFragment) {
    navigator.clipboard?.writeText(f.text).catch(() => {});
    markFragmentUsed(f.id);
    setItems(loadFragments());
    setToast('Copied to clipboard');
    setTimeout(() => setToast(''), 1800);
  }

  function handleDelete(id: string) {
    deleteFragment(id);
    setItems(loadFragments());
  }

  const filtered = useMemo(() => {
    return searchFragments(query, typeFilter === 'all' ? undefined : { type: typeFilter });
  }, [items, query, typeFilter]);

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '8px 18px', borderRadius: 5,
          fontSize: 12, zIndex: 9999, fontFamily: "'Times New Roman', Times, serif",
        }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <p style={{ ...S.hint, margin: 0 }}>
          Reusable drafting fragments — prayers, grounds, objections, affidavit paragraphs.
          Save what worked; pull it back in mid-draft from any drafting engine.
        </p>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
              borderRadius: 4, padding: '7px 14px', fontSize: 11, cursor: 'pointer',
              flexShrink: 0, fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            + Add Fragment
          </button>
        )}
      </div>

      {showAdd && <AddFragmentForm onAdded={refresh} onCancel={() => setShowAdd(false)} />}

      {items.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '40px 20px', background: T.bg,
          border: `1px solid ${T.bdrL}`, borderRadius: 7,
        }}>
          <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
            No fragments saved yet. Add one above, or pull from a drafting engine.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search fragments…"
              style={{
                flex: 1, minWidth: 160, background: T.bg, border: `1px solid ${T.bdrL}`,
                borderRadius: 4, color: T.text, fontFamily: "'Times New Roman', Times, serif",
                fontSize: 12, padding: '7px 11px', outline: 'none',
              }}
            />
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as ClauseFragmentType | 'all')}
              style={{
                background: T.bg, border: `1px solid ${T.bdrL}`, borderRadius: 4,
                color: T.text, fontFamily: "'Times New Roman', Times, serif",
                fontSize: 12, padding: '7px 11px',
              }}
            >
              <option value="all">All Types</option>
              {Object.entries(CLAUSE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <p style={{ ...S.hint, textAlign: 'center', padding: '20px 0' }}>No fragments match.</p>
          ) : (
            filtered.map(f => <FragmentCard key={f.id} fragment={f} onCopy={handleCopy} onDelete={handleDelete} />)
          )}

          <p style={{
            fontSize: 10, color: T.bdr, textAlign: 'center', marginTop: 14,
            fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em',
          }}>
            {filtered.length} of {items.length} fragment{items.length !== 1 ? 's' : ''} · Clause Bank
          </p>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PICKER POPOVER — mounted via "Pull from Clause Bank" button in drafting engines
// ─────────────────────────────────────────────────────────────────────────────

interface ClauseBankPickerProps {
  matterTrack?: ClauseMatterTrack;
  onPull: (text: string, fragmentId: string) => void;
  onClose: () => void;
}

export function ClauseBankPicker({ matterTrack, onPull, onClose }: ClauseBankPickerProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ClauseFragment[]>([]);

  useEffect(() => {
    setItems(searchFragments(query, matterTrack ? { matterTrack } : undefined));
  }, [query, matterTrack]);

  function pull(f: ClauseFragment) {
    markFragmentUsed(f.id);
    onPull(f.text, f.id);
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
        zIndex: 9500, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '8vh 20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.bg, border: `1px solid ${T.bdr}`, borderRadius: 8,
          padding: 20, maxWidth: 520, width: '100%', maxHeight: '70vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ ...S.h3, margin: 0 }}>Pull from Clause Bank</p>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 16, color: T.mute, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type what you need — e.g. 'prayer for injunction'…"
          style={{
            width: '100%', background: T.card, border: `1px solid ${T.bdrL}`,
            borderRadius: 4, color: T.text, fontFamily: "'Times New Roman', Times, serif",
            fontSize: 13, padding: '9px 12px', outline: 'none', marginBottom: 12,
            boxSizing: 'border-box',
          }}
        />
        {items.length === 0 ? (
          <p style={{ ...S.hint, textAlign: 'center', padding: '20px 0' }}>
            {query ? 'No matching fragments.' : 'No fragments saved yet — add some from the Settings Panel.'}
          </p>
        ) : (
          items.slice(0, 25).map(f => (
            <FragmentCard key={f.id} fragment={f} onCopy={pull} compact />
          ))
        )}
      </div>
    </div>
  );
}
