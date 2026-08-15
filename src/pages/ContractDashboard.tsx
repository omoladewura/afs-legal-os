/**
 * AFS Legal OS — Contract Engine Dashboard
 *
 * Roadmap ref: 5a (Contract Engine — Dashboard Wiring)
 *
 * UI SHELL ONLY — no logic wired in yet. This gives the Contract Engine a
 * top-level entry point (reached from HomePage, same tier as SAN Mode and
 * Billions Voice) with a Draft / Review / Negotiate tab strip. Each tab
 * currently renders a placeholder panel.
 *
 * Styled against src/constants/tokens.ts's white "newspaper" theme, same
 * as HomePage — not the stale dark-theme hex codes left over in some
 * older engine files (e.g. ResearchResolver.tsx), which predate T.
 *
 * 5b wires the real modes in:
 *   Draft     → ClientPositionProfileForm (2a) → Pass 0 (2b) → clause
 *               register (2c) → knowledge tiers (2d) → research checklist
 *               (2e) → flagging pass (2f)
 *   Review    → document ingest (3a/3b) → no-skim verification (3c) →
 *               2d/2e/2f re-routed (3d)
 *   Negotiate → round tracking (4a) → negotiate prompt/flow (4b)
 *
 * Not part of this shell: a persisted "contract matter" registry (title,
 * counterparty, list of past matters to reopen). `contract_id` today is
 * just a string shared by ClientPositionProfile and ContractClause rows
 * (see contracts/types.ts) — deciding how a matter gets its id and how
 * counsel picks one back up belongs to 5b, not this shell.
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';

type ContractTabId = 'draft' | 'review' | 'negotiate';

const TABS: Array<{ id: ContractTabId; icon: string; label: string; sub: string }> = [
  { id: 'draft',     icon: '✍', label: 'Draft',     sub: 'Build a new contract' },
  { id: 'review',    icon: '§', label: 'Review',     sub: 'Analyse an existing contract' },
  { id: 'negotiate', icon: '⇄', label: 'Negotiate',  sub: 'Track rounds & positions' },
];

const TAB_COPY: Record<ContractTabId, { title: string; body: string }> = {
  draft: {
    title: 'Draft Mode',
    body:
      'Capture the Client Position Profile, run Pass 0 to identify contract type ' +
      'and jurisdiction, generate the clause register, and resolve each clause ' +
      'through the library for knowledge-tier and flag-tier tagging.',
  },
  review: {
    title: 'Review Mode',
    body:
      'Ingest an existing contract (PDF or Word), verify every clause was ' +
      'addressed with no skimming, then route the same knowledge-tier, ' +
      'research-needed, and flagging logic used in Draft.',
  },
  negotiate: {
    title: 'Negotiate Mode',
    body:
      'Read the prior round\u2019s clauses, track round history, and generate ' +
      'next-round positions — re-tagging only the clauses that changed.',
  },
};

function PlaceholderPanel({ tab }: { tab: ContractTabId }) {
  const copy = TAB_COPY[tab];
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.bdr}`,
        borderRadius: 6,
        padding: '26px 24px',
      }}
    >
      <p
        style={{
          fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10,
        }}
      >
        {copy.title}
      </p>
      <p
        style={{
          fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.75, marginBottom: 18, maxWidth: 560,
        }}
      >
        {copy.body}
      </p>
      <div
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: '#ffffff', border: `1px solid ${T.bdr}`, borderRadius: 4,
          padding: '7px 14px',
        }}
      >
        <span style={{ fontSize: 11, color: T.warn }}>◌</span>
        <span
          style={{
            fontSize: 11, color: T.warn, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.04em',
          }}
        >
          Not yet wired — coming in Roadmap 5b
        </span>
      </div>
    </div>
  );
}

export function ContractDashboard() {
  const { setView } = useAppStore();
  const [activeTab, setActiveTab] = useState<ContractTabId>('draft');

  return (
    <div style={{ animation: 'fadeUp .3s ease', maxWidth: 620, margin: '0 auto' }}>

      {/* Masthead — same pattern as HomePage */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <button
            onClick={() => setView('home')}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
              borderRadius: 3, padding: '6px 16px', fontSize: 12,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <p style={{
            fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.2em', textTransform: 'uppercase',
          }}>
            Smart Tools · Contracts
          </p>
        </div>
        <div style={{ borderTop: `2px solid ${T.text}`, paddingTop: 12 }}>
          <h1 style={{
            fontSize: 30, color: T.text, fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, fontStyle: 'italic', lineHeight: 1.15, marginBottom: 10,
          }}>
            Contract Engine
          </h1>
          <p style={{
            fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif",
            lineHeight: 1.65, borderTop: `1px solid ${T.bdr}`, paddingTop: 10,
          }}>
            Draft new contracts, review ones handed to you, and track negotiation rounds — all under one clause register with knowledge-tier grounding.
          </p>
        </div>
      </div>

      {/* Tab strip */}
      <div style={{
        display: 'flex', gap: 1, marginBottom: 18,
        border: `1px solid ${T.bdr}`, borderRadius: 4, overflow: 'hidden',
      }}>
        {TABS.map((tab, i) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, background: activeTab === tab.id ? T.card : '#ffffff',
              borderLeft: i === 0 ? 'none' : `1px solid ${T.bdr}`,
              borderTop: 'none', borderRight: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? T.text : 'transparent'}`,
              color: activeTab === tab.id ? T.text : T.mute,
              padding: '11px 8px 9px', fontSize: 11,
              fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer',
              letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 700,
              transition: 'all .15s', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
            }}
          >
            <span style={{ fontSize: 15 }}>{tab.icon}</span>
            <span>{tab.label}</span>
            <span style={{ fontSize: 8, opacity: .75, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{tab.sub}</span>
          </button>
        ))}
      </div>

      <PlaceholderPanel tab={activeTab} />

      <p style={{
        marginTop: 32, fontSize: 11, color: T.mute, textAlign: 'center',
        fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8,
      }}>
        AFS Legal OS · Contract Engine — Draft, Review, and Negotiate under one clause register.
      </p>
    </div>
  );
}
