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
      <p style={{ ...T, fontSize: 15, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginTop: 14 }}>
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
      background: '#180808', border: '1px solid #4a1818',
      borderRadius: 6, padding: '12px 16px', marginBottom: 12,
    }}>
      <p style={{ fontSize: 13, color: '#c05050', fontFamily: 'Inter, sans-serif', margin: 0 }}>
        {message}
      </p>
    </div>
  );
}

// ── Md — Markdown-like renderer ───────────────────────────────────────────────
// Handles **bold** and ## headings in AI output — NOT a full markdown parser.

interface MdProps {
  text: string;
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} style={{ color: T.goldL, fontWeight: 600 }}>{part.slice(2, -2)}</strong>
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
          <li key={i} style={{ fontSize: 15, color: '#c2beb2', lineHeight: 1.85, fontFamily: "'Cormorant Garamond', serif", marginBottom: 3 }}>
            {renderInline(li)}
          </li>
        ))}
      </ul>
    );
    listBuf = [];
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      flushList();
      nodes.push(
        <h2 key={i} style={{ fontSize: 17, color: '#b8985a', fontWeight: 400, marginTop: 24, marginBottom: 8, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith('### ')) {
      flushList();
      nodes.push(
        <h3 key={i} style={{ fontSize: 10, color: '#606070', fontWeight: 600, marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: 'Inter, sans-serif' }}>
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      listBuf.push(trimmed.slice(2));
    } else if (trimmed) {
      flushList();
      nodes.push(
        <p key={i} style={{ margin: '7px 0', fontSize: 16, color: '#cac6ba', lineHeight: 1.95, fontFamily: "'Cormorant Garamond', serif" }}>
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
// Standard container for AI-generated output with copy/clear actions.

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
      background: '#080810', border: `1px solid ${T.bdr}`,
      borderRadius: 8, padding: '20px 24px', marginBottom: 16,
      animation: 'fadeUp .3s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{
          fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif',
          letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700,
        }}>{title}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleCopy}
            style={{
              background: 'transparent', border: `1px solid #1a1a28`,
              color: copied ? T.gold : T.mute, borderRadius: 4,
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
                background: 'transparent', border: `1px solid #1a1a28`,
                color: '#404050', borderRadius: 4, padding: '5px 10px',
                fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content — text and research cards */}
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <Md key={i} text={seg.content} />;
        }
        // Research card
        return (
          <div key={i} style={{
            background: '#0a0a00', border: '1px solid #3a2808',
            borderRadius: 6, padding: '14px 16px', margin: '10px 0',
          }}>
            <p style={{ fontSize: 9, color: T.gold, fontFamily: 'Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
              ◎ Research Required
            </p>
            <p style={{ fontSize: 14, color: '#cac6ba', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.7, marginBottom: 6 }}>
              <strong style={{ color: T.goldL }}>Principle:</strong> {seg.principle}
            </p>
            {seg.authority && (
              <p style={{ fontSize: 13, color: '#b09840', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.6, marginBottom: 4 }}>
                <strong>Authority needed:</strong> {seg.authority}
              </p>
            )}
            {seg.platform && (
              <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif' }}>
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
  'Claimant':   { bg: '#081428', bdr: '#1a3058', col: '#5090d0' },
  'Defendant':  { bg: '#180808', bdr: '#401818', col: '#c05050' },
  'Appellant':  { bg: '#100820', bdr: '#281848', col: '#9060c0' },
  'Respondent': { bg: '#081408', bdr: '#1a3818', col: '#40a868' },
};

export function RoleBadge({ role }: RoleBadgeProps) {
  const c = ROLE_COLORS[role] ?? { bg: '#0a0a14', bdr: '#1e1e2e', col: T.mute };
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.bdr}`, color: c.col,
      fontSize: 8, padding: '2px 8px', borderRadius: 2,
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
