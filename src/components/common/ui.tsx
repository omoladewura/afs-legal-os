/**
 * AFS Advocates — Shared UI Primitives
 * Small reusable components used across every engine.
 */

import React from 'react';
import { T } from '@/constants/tokens';
import { copyToClipboard, parseSegments } from '@/utils';

// ── Spinner ───────────────────────────────────────────────────────────────────

interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 14, color = T.gold }: SpinnerProps) {
  return (
    <span style={{
      display:      'inline-block',
      width:        size, height: size,
      border:       `2px solid ${T.bdr}`,
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

export function LoadingBlock({ label = 'Processing…' }: LoadingBlockProps) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 0' }}>
      <Spinner size={28} />
      <p style={{ fontSize: 15, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginTop: 14 }}>
        {label}
      </p>
    </div>
  );
}

// ── ErrorBlock ────────────────────────────────────────────────────────────────

interface ErrorBlockProps {
  message: string;
}

export function ErrorBlock({ message }: ErrorBlockProps) {
  if (!message) return null;
  return (
    <div style={{
      background: '#fff0f0', border: '1px solid #ffcccc',
      borderRadius: 6, padding: '12px 16px', marginBottom: 12,
    }}>
      <p style={{ fontSize: 13, color: '#c00000', fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
        {message}
      </p>
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
      ? <strong key={i} style={{ color: '#000000', fontWeight: 700 }}>{part.slice(2, -2)}</strong>
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
      <ul key={nodes.length} style={{ paddingLeft: 20, margin: '6px 0 10px' }}>
        {listBuf.map((li, i) => (
          <li key={i} style={{ fontSize: 15, color: '#000000', lineHeight: 1.85, fontFamily: "'Times New Roman', Times, serif", marginBottom: 3 }}>
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
        <h1 key={i} style={{ fontSize: 20, color: '#000000', fontWeight: 700, marginTop: 28, marginBottom: 10, fontFamily: "'Times New Roman', Times, serif", borderBottom: '1px solid #cccccc', paddingBottom: 6 }}>
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith('## ')) {
      flushList();
      nodes.push(
        <h2 key={i} style={{ fontSize: 17, color: '#000000', fontWeight: 600, marginTop: 22, marginBottom: 8, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith('### ')) {
      flushList();
      nodes.push(
        <h3 key={i} style={{ fontSize: 13, color: '#333333', fontWeight: 700, marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: "'Times New Roman', Times, serif" }}>
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      listBuf.push(trimmed.slice(2));
    } else if (trimmed) {
      flushList();
      nodes.push(
        <p key={i} style={{ margin: '7px 0', fontSize: 15, color: '#000000', lineHeight: 1.95, fontFamily: "'Times New Roman', Times, serif" }}>
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
      background: '#ffffff', border: '1px solid #cccccc',
      borderRadius: 8, padding: '20px 24px', marginBottom: 16,
      animation: 'fadeUp .3s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{
          fontSize: 10, color: '#000000', fontFamily: 'Inter, sans-serif',
          letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700,
        }}>{title}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleCopy}
            style={{
              background: 'transparent', border: '1px solid #cccccc',
              color: copied ? '#000000' : '#666666', borderRadius: 4,
              padding: '5px 12px', fontSize: 10,
              fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              letterSpacing: '.04em', transition: 'color .15s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {onClear && (
            <button
              onClick={onClear}
              style={{
                background: 'transparent', border: '1px solid #cccccc',
                color: '#999999', borderRadius: 4, padding: '5px 10px',
                fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
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
            background: '#f9f9f9', border: '1px solid #cccccc',
            borderRadius: 6, padding: '14px 16px', margin: '10px 0',
          }}>
            <p style={{ fontSize: 9, color: '#000000', fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
              ◎ Research Required
            </p>
            <p style={{ fontSize: 14, color: '#000000', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, marginBottom: 6 }}>
              <strong>Principle:</strong> {seg.principle}
            </p>
            {seg.authority && (
              <p style={{ fontSize: 13, color: '#333333', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6, marginBottom: 4 }}>
                <strong>Authority needed:</strong> {seg.authority}
              </p>
            )}
            {seg.platform && (
              <p style={{ fontSize: 11, color: '#666666', fontFamily: 'Inter, sans-serif' }}>
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
  'Claimant':   { bg: '#e8f0ff', bdr: '#aabbee', col: '#1a3a8a' },
  'Defendant':  { bg: '#fff0f0', bdr: '#ffaaaa', col: '#8a1a1a' },
  'Appellant':  { bg: '#f5f0ff', bdr: '#ccaaee', col: '#4a1a8a' },
  'Respondent': { bg: '#f0fff0', bdr: '#aaeebb', col: '#1a6a3a' },
};

export function RoleBadge({ role }: RoleBadgeProps) {
  const c = ROLE_COLORS[role] ?? { bg: '#f5f5f5', bdr: '#cccccc', col: '#444444' };
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.bdr}`, color: c.col,
      fontSize: 9, padding: '3px 10px', borderRadius: 3,
      fontFamily: 'Inter, sans-serif', letterSpacing: '.1em',
      textTransform: 'uppercase', fontWeight: 700,
    }}>
      {role}
    </span>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

interface LabelProps {
  children: React.ReactNode;
}

export function Label({ children }: LabelProps) {
  return (
    <span style={{
      fontSize: 10, color: T.dim,
      fontFamily: 'Inter, sans-serif',
      letterSpacing: '.1em', textTransform: 'uppercase',
      fontWeight: 600, display: 'block', marginBottom: 6,
    }}>
      {children}
    </span>
  );
}
