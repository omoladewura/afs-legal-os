/**
 * AFS Legal OS — Contract Engine — Clause Register View
 *
 * Roadmap ref: 5b (Contract Engine — Dashboard Wiring)
 *
 * Shared read-only rendering of a ContractClause[] register — used by
 * Draft, Review, and Negotiate mode panels alike, so the three modes show
 * one consistent register presentation (knowledge-tier badge, flag-tier
 * badge, research-needed checklist, round history) rather than three
 * independently-drifting clause list UIs.
 *
 * Pure presentational component — no storage reads/writes, no AI calls.
 * Takes a ContractClause[] and renders it; all mutation happens in the
 * panels that call the 2d/2e/2f/3c/4a/4b engines and pass the result down.
 */

import React, { useState } from 'react';
import { T, S } from '@/constants/tokens';
import type { ContractClause, FlagTier, KnowledgeTier } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// BADGE LABELS + COLOURS
// ─────────────────────────────────────────────────────────────────────────────

const KNOWLEDGE_TIER_LABEL: Record<KnowledgeTier, string> = {
  STATUTORY_LIBRARY: 'STATUTORY — LIBRARY',
  GENERAL_KNOWLEDGE:  'GENERAL KNOWLEDGE',
  RESEARCH_NEEDED:    'RESEARCH NEEDED',
};

const KNOWLEDGE_TIER_COLOR: Record<KnowledgeTier, string> = {
  STATUTORY_LIBRARY: T.ok,
  GENERAL_KNOWLEDGE:  T.info,
  RESEARCH_NEEDED:    T.warn,
};

const FLAG_TIER_LABEL: Record<FlagTier, string> = {
  STATUTORY:          'STATUTORY',
  GENERAL_PRUDENCE:    'GENERAL PRUDENCE',
  CLIENT_INSTRUCTION:  'CLIENT INSTRUCTION',
};

const FLAG_TIER_COLOR: Record<FlagTier, string> = {
  STATUTORY:          T.err,
  GENERAL_PRUDENCE:    T.mute,
  CLIENT_INSTRUCTION:  T.info,
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 9, fontWeight: 700,
        letterSpacing: '.08em', textTransform: 'uppercase',
        color, border: `1px solid ${color}`, borderRadius: 3,
        padding: '2px 6px', marginRight: 6, marginBottom: 4,
        fontFamily: "'Times New Roman', Times, serif",
      }}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUSE ROW
// ─────────────────────────────────────────────────────────────────────────────

function ClauseRow({ clause, highlighted }: { clause: ContractClause; highlighted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasHistory = clause.history.length > 1;

  return (
    <div
      style={{
        border: `1px solid ${highlighted ? T.info : T.bdrL}`,
        borderRadius: 5, padding: '12px 14px', marginBottom: 8,
        background: highlighted ? '#f3f6fb' : T.bg,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <p style={{
          fontSize: 12, fontWeight: 700, color: T.text, margin: 0,
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          {clause.clause_number}
          {clause.round_number > 1 && (
            <span style={{ fontWeight: 400, color: T.mute, fontSize: 10 }}> · round {clause.round_number}</span>
          )}
        </p>
      </div>

      <p style={{ ...S.p, margin: '6px 0 8px', whiteSpace: 'pre-wrap' }}>{clause.clause_text}</p>

      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {clause.knowledge_tier && (
          <Badge label={KNOWLEDGE_TIER_LABEL[clause.knowledge_tier]} color={KNOWLEDGE_TIER_COLOR[clause.knowledge_tier]} />
        )}
        {clause.flag_tier && (
          <Badge label={FLAG_TIER_LABEL[clause.flag_tier]} color={FLAG_TIER_COLOR[clause.flag_tier]} />
        )}
      </div>

      {clause.research_needed && clause.research_needed.length > 0 && (
        <div style={{ marginTop: 8, borderTop: `1px dashed ${T.bdrL}`, paddingTop: 8 }}>
          <p style={{ ...S.label, marginBottom: 4 }}>Research Checklist</p>
          {clause.research_needed.map((q, i) => (
            <p key={i} style={{ fontSize: 12, color: T.dim, margin: '3px 0', fontFamily: "'Times New Roman', Times, serif" }}>
              <span style={{ textTransform: 'uppercase', fontSize: 9, color: T.mute, letterSpacing: '.06em' }}>
                {q.authority_type.replace('_', ' ')}
              </span>
              {' — '}{q.query}
            </p>
          ))}
        </div>
      )}

      {hasHistory && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: 'none', color: T.mute, fontSize: 11,
              cursor: 'pointer', padding: 0, fontFamily: "'Times New Roman', Times, serif",
              textDecoration: 'underline',
            }}
          >
            {expanded ? 'Hide' : 'Show'} negotiation history ({clause.history.length} rounds)
          </button>
          {expanded && (
            <div style={{ marginTop: 6 }}>
              {clause.history.map((h, i) => (
                <div key={i} style={{ borderLeft: `2px solid ${T.bdrL}`, paddingLeft: 10, marginBottom: 8 }}>
                  <p style={{ fontSize: 10, color: T.mute, margin: 0, fontFamily: "'Times New Roman', Times, serif" }}>
                    Round {h.round_number} · {h.changed_by}{h.note ? ` — ${h.note}` : ''}
                  </p>
                  <p style={{ fontSize: 12, color: T.dim, margin: '2px 0 0', whiteSpace: 'pre-wrap', fontFamily: "'Times New Roman', Times, serif" }}>
                    {h.clause_text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER LIST
// ─────────────────────────────────────────────────────────────────────────────

export interface ClauseRegisterViewProps {
  clauses: ContractClause[];
  /** Clause numbers to visually highlight — e.g. just-revised clauses after a negotiate round. */
  highlightNumbers?: string[];
}

export function ClauseRegisterView({ clauses, highlightNumbers }: ClauseRegisterViewProps) {
  if (clauses.length === 0) {
    return <p style={S.empty}>No clauses on file yet.</p>;
  }
  const highlighted = new Set(highlightNumbers ?? []);
  return (
    <div>
      {clauses.map(c => (
        <ClauseRow key={c.id} clause={c} highlighted={highlighted.has(c.clause_number)} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSING-PROFILE BANNER — shared across Draft/Review/Negotiate (2f convention)
// ─────────────────────────────────────────────────────────────────────────────

export function MissingProfileBanner({ message }: { message: string }) {
  return (
    <div style={{
      background: '#fbf3e8', border: `1px solid ${T.warn}`, borderRadius: 5,
      padding: '10px 14px', marginBottom: 14,
    }}>
      <p style={{ fontSize: 12, color: T.warn, margin: 0, lineHeight: 1.6, fontFamily: "'Times New Roman', Times, serif" }}>
        {message}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR BANNER — shared convention: every engine returns { ok, error }
// ─────────────────────────────────────────────────────────────────────────────

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      background: '#fbeaea', border: `1px solid ${T.err}`, borderRadius: 5,
      padding: '10px 14px', marginBottom: 14,
    }}>
      <p style={{ fontSize: 12, color: T.err, margin: 0, lineHeight: 1.6, fontFamily: "'Times New Roman', Times, serif" }}>
        {message}
      </p>
    </div>
  );
}
