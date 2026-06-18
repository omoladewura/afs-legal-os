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
