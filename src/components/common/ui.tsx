/**
 * AFS Advocates — Shared UI Primitives
 * White newspaper theme — Times New Roman throughout.
 */

import React from 'react';
import { T } from '@/constants/tokens';
import { copyToClipboard, parseSegments } from '@/utils';

// ── Spinner ───────────────────────────────────────────────────────────────────

interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 14, color = '#444444' }: SpinnerProps) {
  return (
    <span style={{
      display:      'inline-block',
      width:        size, height: size,
      border:       '2px solid #dddddd',
      borderTop:    `2px solid ${color}`,
      borderRadius: '50%',
      animation:    'spin .8s linear infinite',
      flexShrink:   0,
    }} />
  );
}

// ── LoadingBlock ──────────────────────────────────────────────────────────────

interface LoadingBlockProps {
  label?: string;
}

export function LoadingBlock({ label = 'Loading…' }: LoadingBlockProps) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <Spinner size={24} />
      <p style={{
        fontSize: 13, color: '#888888',
        fontFamily: "'Times New Roman', Times, serif",
        fontStyle: 'italic', marginTop: 14,
      }}>
        {label}
      </p>
    </div>
  );
}

// ── ErrorBlock ────────────────────────────────────────────────────────────────

interface ErrorBlockProps {
  message:    string;
  onDismiss?: () => void;
}

export function ErrorBlock({ message, onDismiss }: ErrorBlockProps) {
  if (!message) return null;
  return (
    <div style={{
      background: '#fff8f8', border: '1px solid #e8c0c0',
      borderRadius: 4, padding: '10px 14px', marginBottom: 12,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
    }}>
      <p style={{
        fontSize: 13, color: '#8a1a1a',
        fontFamily: "'Times New Roman', Times, serif", margin: 0, flex: 1,
      }}>
        {message}
      </p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#8a1a1a', fontSize: 14, padding: 0, flexShrink: 0, lineHeight: 1,
          }}
        >×</button>
      )}
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
// Stateless, event-emitter-driven toast notifications. Any file can call
// toast.error(msg) / toast.warn(msg) / toast.info(msg) without prop-drilling.
// <ToastHost /> is mounted once at the app root and renders whatever is queued.

type ToastLevel = 'error' | 'warn' | 'info';

interface ToastMessage {
  id:      string;
  message: string;
  level:   ToastLevel;
}

let toastQueue: ToastMessage[] = [];
const toastListeners = new Set<(toasts: ToastMessage[]) => void>();

function emitToasts() {
  toastListeners.forEach(listener => listener(toastQueue));
}

function pushToast(message: string, level: ToastLevel) {
  if (!message) return;
  const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  toastQueue = [...toastQueue, { id, message, level }];
  emitToasts();
  setTimeout(() => dismissToast(id), 6000);
}

function dismissToast(id: string) {
  toastQueue = toastQueue.filter(t => t.id !== id);
  emitToasts();
}

export const toast = {
  error: (message: string) => pushToast(message, 'error'),
  warn:  (message: string) => pushToast(message, 'warn'),
  info:  (message: string) => pushToast(message, 'info'),
};

const TOAST_STYLES: Record<ToastLevel, { bg: string; bdr: string; col: string; icon: string }> = {
  error: { bg: '#fff8f8', bdr: '#e8c0c0', col: T.err,  icon: '⚠' },
  warn:  { bg: '#fffaf2', bdr: '#e8d4a8', col: T.warn, icon: '!' },
  info:  { bg: '#f5f8fc', bdr: '#c0d0e8', col: T.info, icon: 'ⓘ' },
};

/** Mount once at the app root. Renders queued toasts bottom-right, auto-dismissing after 6s. */
export function ToastHost() {
  const [toasts, setToasts] = React.useState<ToastMessage[]>(toastQueue);

  React.useEffect(() => {
    const listener = (t: ToastMessage[]) => setToasts(t);
    toastListeners.add(listener);
    return () => { toastListeners.delete(listener); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 99999,
      display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 360, width: 'calc(100vw - 40px)',
    }}>
      {toasts.map(t => {
        const s = TOAST_STYLES[t.level];
        return (
          <div key={t.id} style={{
            background: s.bg, border: `1px solid ${s.bdr}`,
            borderRadius: 5, padding: '12px 14px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            animation: 'fadeUp .25s ease',
          }}>
            <span style={{ color: s.col, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>{s.icon}</span>
            <p style={{
              fontSize: 13, color: s.col, flex: 1, margin: 0,
              fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5,
            }}>
              {t.message}
            </p>
            <button
              onClick={() => dismissToast(t.id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: s.col, fontSize: 14, padding: 0, flexShrink: 0, lineHeight: 1,
              }}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Md — Markdown-like renderer ───────────────────────────────────────────────

interface MdProps {
  text: string;
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} style={{ color: '#111111', fontWeight: 700 }}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

export function Md({ text }: MdProps) {
  if (!text) return null;

  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listBuf: string[] = [];

  function flushList() {
    if (listBuf.length === 0) return;
    nodes.push(
      <ul key={nodes.length} style={{ paddingLeft: 22, margin: '6px 0 10px' }}>
        {listBuf.map((li, i) => (
          <li key={i} style={{
            fontSize: 14, color: '#222222', lineHeight: 1.8,
            fontFamily: "'Times New Roman', Times, serif", marginBottom: 3,
          }}>
            {renderInline(li)}
          </li>
        ))}
      </ul>
    );
    listBuf = [];
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('# ')) {
      flushList();
      nodes.push(
        <h1 key={i} style={{
          fontSize: 20, color: '#111111', fontWeight: 700,
          marginTop: 28, marginBottom: 10,
          fontFamily: "'Times New Roman', Times, serif",
          borderBottom: '1px solid #cccccc', paddingBottom: 6,
        }}>
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith('## ')) {
      flushList();
      nodes.push(
        <h2 key={i} style={{
          fontSize: 16, color: '#222222', fontWeight: 400,
          marginTop: 20, marginBottom: 8,
          fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic',
        }}>
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith('### ')) {
      flushList();
      nodes.push(
        <h3 key={i} style={{
          fontSize: 11, color: '#555555', fontWeight: 700,
          marginTop: 16, marginBottom: 6,
          textTransform: 'uppercase', letterSpacing: '.1em',
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      listBuf.push(trimmed.slice(2));
    } else if (trimmed) {
      flushList();
      nodes.push(
        <p key={i} style={{
          margin: '7px 0', fontSize: 14, color: '#222222',
          lineHeight: 1.85, fontFamily: "'Times New Roman', Times, serif",
        }}>
          {renderInline(trimmed)}
        </p>
      );
    } else {
      flushList();
    }
  });

  flushList();
  return <div>{nodes}</div>;
}

// ── ResultBlock ───────────────────────────────────────────────────────────────

interface ResultBlockProps {
  title:    string;
  content:  string;
  onClear?: () => void;
}

export function ResultBlock({ title, content, onClear }: ResultBlockProps) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    await copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const segments = parseSegments(content);

  return (
    <div style={{
      background: '#fafaf8', border: '1px solid #cccccc',
      borderRadius: 4, padding: '18px 22px', marginBottom: 16,
      animation: 'fadeUp .3s ease',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 14,
        borderBottom: '1px solid #eeeeee', paddingBottom: 10,
      }}>
        <p style={{
          fontSize: 10, color: '#444444',
          fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700,
        }}>{title}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleCopy}
            style={{
              background: 'transparent', border: '1px solid #cccccc',
              color: copied ? '#111111' : '#666666', borderRadius: 3,
              padding: '4px 10px', fontSize: 10,
              fontFamily: "'Times New Roman', Times, serif",
              cursor: 'pointer', transition: 'color .15s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {onClear && (
            <button
              onClick={onClear}
              style={{
                background: 'transparent', border: '1px solid #cccccc',
                color: '#999999', borderRadius: 3, padding: '4px 8px',
                fontSize: 10, fontFamily: "'Times New Roman', Times, serif",
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <Md key={i} text={seg.content} />;
        }
        return (
          <div key={i} style={{
            background: '#f5f5f3', border: '1px solid #cccccc',
            borderLeft: '3px solid #888888',
            borderRadius: 3, padding: '12px 14px', margin: '10px 0',
          }}>
            <p style={{
              fontSize: 9, color: '#555555',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.14em', textTransform: 'uppercase',
              fontWeight: 700, marginBottom: 8,
            }}>
              ◎ Research Required
            </p>
            <p style={{
              fontSize: 13, color: '#222222',
              fontFamily: "'Times New Roman', Times, serif",
              lineHeight: 1.7, marginBottom: 5,
            }}>
              <strong>Principle:</strong> {seg.principle}
            </p>
            {seg.authority && (
              <p style={{
                fontSize: 12, color: '#444444',
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: 1.6, marginBottom: 4,
              }}>
                <strong>Authority needed:</strong> {seg.authority}
              </p>
            )}
            {seg.platform && (
              <p style={{
                fontSize: 11, color: '#777777',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                Platform: {seg.platform}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── RoleBadge ─────────────────────────────────────────────────────────────────

interface RoleBadgeProps {
  role: string;
}

const ROLE_COLORS: Record<string, { bg: string; bdr: string; col: string }> = {
  'Claimant':    { bg: '#edf3fb', bdr: '#b8cfe8', col: '#1a4a8a' },
  'Defendant':   { bg: '#fbeaea', bdr: '#e0b8b8', col: '#7a1a1a' },
  'Appellant':   { bg: '#f5f2fb', bdr: '#ccc0e0', col: '#4a1a8a' },
  'Respondent':  { bg: '#eef7f1', bdr: '#b0d4bc', col: '#1a5a30' },
  'Prosecution': { bg: '#fdf3e0', bdr: '#e0cfa0', col: '#7a4a00' },
  'Defence':     { bg: '#e8f5ee', bdr: '#a8d0b8', col: '#1a5a30' },
};

export function RoleBadge({ role }: RoleBadgeProps) {
  const c = ROLE_COLORS[role] ?? { bg: '#f5f5f5', bdr: '#cccccc', col: '#444444' };
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.bdr}`, color: c.col,
      fontSize: 9, padding: '2px 8px', borderRadius: 2,
      fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700,
    }}>
      {role}
    </span>
  );
}

// ── CaseTheoryBanner ──────────────────────────────────────────────────────────
// Trial Engine Consolidation, Phase 1.
//
// Shown at the top of every engine that reads or propagates Case Theory
// (TrialEngine, FinalWrittenAddressEngine, ArgumentBuilder Trial/Civil
// tracks, ApplicationsEngine when the selected appType needs theory).
//
// Three states, in priority order:
//   1. No theory at all                    → soft red banner
//   2. Theory exists but is not locked      → amber banner
//   3. Theory exists and is locked          → collapsible green banner with
//                                              core proposition + score + version
//
// Pass the direct output of useCaseTheory() — props mirror that hook's shape
// so callers can spread it: <CaseTheoryBanner {...useCaseTheory(caseId)} />

interface CaseTheoryBannerProps {
  theory?:    { core_proposition: string } | null;
  locked?:    boolean;
  score?:     number | null;
  version?:   number;
  hasTheory?: boolean;
  loading?:   boolean;
  /** Optional — wires the banner's action button to navigate to the theory tab */
  onOpenTheory?: () => void;
}

export function CaseTheoryBanner({
  theory, locked, score, version, hasTheory, loading, onOpenTheory,
}: CaseTheoryBannerProps) {
  // React is already imported as the default export at the top of this file;
  // reuse React.useState rather than adding another named import.
  const [expanded, setExpanded] = React.useState(true);

  if (loading) return null;

  // ── State 1: no theory at all ────────────────────────────────────────────
  if (!theory) {
    return (
      <div style={{
        background: '#fff8f8', border: '1px solid #e8c0c0',
        borderRadius: 4, padding: '10px 14px', marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <p style={{
          fontSize: 13, color: '#8a1a1a', margin: 0,
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          No Case Theory set. Run Intelligence Engine then crystallise your theory.
        </p>
        {onOpenTheory && (
          <button onClick={onOpenTheory} style={{
            background: 'transparent', border: '1px solid #8a1a1a', color: '#8a1a1a',
            borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif", flexShrink: 0,
          }}>
            Build Theory →
          </button>
        )}
      </div>
    );
  }

  // ── State 2: theory exists but unlocked ──────────────────────────────────
  if (!locked) {
    return (
      <div style={{
        background: '#fdf6e8', border: '1px solid #e0cfa0',
        borderRadius: 4, padding: '10px 14px', marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <p style={{
          fontSize: 13, color: '#7a4a00', margin: 0,
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          Theory not yet locked — downstream engines will not use it.
        </p>
        {onOpenTheory && (
          <button onClick={onOpenTheory} style={{
            background: 'transparent', border: '1px solid #7a4a00', color: '#7a4a00',
            borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif", flexShrink: 0,
          }}>
            Review & Lock →
          </button>
        )}
      </div>
    );
  }

  // ── State 3: locked — collapsible summary ────────────────────────────────
  const s = score ?? 0;
  const scoreColor = s >= 80 ? '#2a6a3a' : s >= 50 ? '#7a4a00' : '#8a1a1a';

  return (
    <div style={{
      background: '#eef7f1', border: '1px solid #b0d4bc',
      borderRadius: 4, padding: '10px 14px', marginBottom: 14,
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
            color: '#1a5a30', background: '#ffffff', border: '1px solid #b0d4bc',
            borderRadius: 2, padding: '2px 8px', flexShrink: 0,
            fontFamily: "'Times New Roman', Times, serif",
          }}>
            Locked v{version ?? 1}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: scoreColor,
            fontFamily: "'Times New Roman', Times, serif", flexShrink: 0,
          }}>
            {s}/100
          </span>
          {!expanded && (
            <span style={{
              fontSize: 13, color: '#1a5a30', fontStyle: 'italic',
              fontFamily: "'Times New Roman', Times, serif",
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {theory.core_proposition}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#1a5a30', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>
      {expanded && (
        <p style={{
          fontSize: 13, color: '#1a3a23', margin: '8px 0 0', lineHeight: 1.7,
          fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic',
        }}>
          {theory.core_proposition}
        </p>
      )}
    </div>
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────

interface LabelProps {
  children: React.ReactNode;
}

export function Label({ children }: LabelProps) {
  return (
    <span style={{
      fontSize: 10, color: '#555555',
      fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.1em', textTransform: 'uppercase',
      fontWeight: 700, display: 'block', marginBottom: 6,
    }}>
      {children}
    </span>
  );
}

// ── TypeDeleteModal ───────────────────────────────────────────────────────────
// Replaces window.confirm for destructive delete actions.
// User must type "delete" exactly before the action fires.

import { useState as _useState } from 'react';

interface TypeDeleteModalProps {
  label:     string;           // what is being deleted, e.g. "docket entry" or "case file"
  onConfirm: () => void;
  onCancel:  () => void;
}

export function TypeDeleteModal({ label, onConfirm, onCancel }: TypeDeleteModalProps) {
  const [typed, setTyped] = _useState('');
  const ready = typed.trim().toLowerCase() === 'delete';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0a0a14', border: '2px solid #c04040',
        borderRadius: 10, padding: '28px 30px', maxWidth: 380, width: '90%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
      }}>
        <p style={{
          fontSize: 10, color: '#c04040', fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12,
        }}>
          ⚠ Confirm Deletion
        </p>
        <p style={{
          fontSize: 14, color: '#e0dcd0', fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.6, marginBottom: 18,
        }}>
          You are about to permanently delete this <strong>{label}</strong>. This cannot be undone.
        </p>
        <p style={{
          fontSize: 12, color: '#888888', fontFamily: "'Times New Roman', Times, serif",
          marginBottom: 10,
        }}>
          Type <strong style={{ color: '#c04040' }}>delete</strong> to confirm:
        </p>
        <input
          autoFocus
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && ready) onConfirm(); if (e.key === 'Escape') onCancel(); }}
          placeholder="delete"
          style={{
            width: '100%', background: '#070710', border: `1px solid ${ready ? '#c04040' : '#2a2a3a'}`,
            borderRadius: 5, color: '#e0dcd0', padding: '10px 14px', fontSize: 14,
            fontFamily: "'Times New Roman', Times, serif", outline: 'none',
            boxSizing: 'border-box', marginBottom: 18, transition: 'border-color .15s',
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            background: 'transparent', border: '1px solid #2a2a3a', color: '#888888',
            borderRadius: 5, padding: '8px 20px', fontSize: 12,
            fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!ready} style={{
            background: ready ? '#3a0808' : '#1a1a1a',
            border: `1px solid ${ready ? '#c04040' : '#2a2a3a'}`,
            color: ready ? '#e08080' : '#3a3a3a',
            borderRadius: 5, padding: '8px 20px', fontSize: 12,
            fontFamily: "'Times New Roman', Times, serif",
            cursor: ready ? 'pointer' : 'not-allowed', fontWeight: 600,
            transition: 'all .15s',
          }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
