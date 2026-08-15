/**
 * AFS Legal OS — Contract Engine Dashboard
 *
 * Roadmap ref: 5a (Contract Engine — Dashboard Wiring) + 5b (mode wiring)
 *
 * 5a gave this shell a Draft / Review / Negotiate tab strip with placeholder
 * panels. 5b (this revision) wires the real modes in:
 *   Draft     → ClientPositionProfileForm (2a) → Pass 0 (2b) → clause
 *               register (2c) → knowledge tiers (2d) → research checklist
 *               (2e) → flagging pass (2f)      — DraftModePanel
 *   Review    → document ingest (3a/3b) → no-skim verification (3c) →
 *               2d/2e/2f re-routed (3d)         — ReviewModePanel
 *   Negotiate → round tracking (4a) → negotiate prompt/flow (4b)
 *                                                — NegotiateModePanel
 *
 * Styled against src/constants/tokens.ts's white "newspaper" theme, same
 * as HomePage — not the stale dark-theme hex codes left over in some
 * older engine files (e.g. ResearchResolver.tsx), which predate T.
 *
 * CURRENT-MATTER DECISION (deferred by 5a to 5b, resolved here): there is
 * still no persisted "contract matter" registry (title, counterparty, list
 * of past matters to reopen) anywhere in the roadmap — building one is a
 * new roadmap item, not something to silently fold into this shell. What
 * this shell needs in the meantime is just enough to make `contract_id`
 * durable across a session and across the three tabs (they must all
 * operate on the same matter). So: one "current matter" id, persisted in
 * localStorage under `afs_contract_current_id`, shared by all three tabs.
 * "Start New Matter" clears it and mints a fresh one — the old matter's
 * data is untouched in D1/IndexedDB (same as every other contract_id),
 * just no longer the one this shell points at. A real multi-matter
 * registry with a picker is future work, not a 5b regression.
 *
 * Client Position Profile (2a) is loaded once here, at the shell level, and
 * passed down to all three panels — Draft edits/saves it, Review and
 * Negotiate read it (for flagging-pass / negotiate-prompt context and the
 * missing-profile warning) without each panel re-fetching it independently.
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';
import { uid } from '@/utils';
import { loadClientPositionProfile } from '@/storage/helpers';
import { DraftModePanel } from '@/contracts/DraftModePanel';
import { ReviewModePanel } from '@/contracts/ReviewModePanel';
import { NegotiateModePanel } from '@/contracts/NegotiateModePanel';
import type { ClientPositionProfile } from '@/contracts/types';

type ContractTabId = 'draft' | 'review' | 'negotiate';

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT-MATTER ID — see file header for why this exists at this layer
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_MATTER_KEY = 'afs_contract_current_id';

function getOrCreateCurrentMatterId(): string {
  try {
    const existing = localStorage.getItem(CURRENT_MATTER_KEY);
    if (existing) return existing;
    const fresh = uid();
    localStorage.setItem(CURRENT_MATTER_KEY, fresh);
    return fresh;
  } catch {
    return uid();
  }
}

function startNewMatterId(): string {
  const fresh = uid();
  try { localStorage.setItem(CURRENT_MATTER_KEY, fresh); } catch { /* ignore */ }
  return fresh;
}

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

function ModeHeader({ tab }: { tab: ContractTabId }) {
  const copy = TAB_COPY[tab];
  return (
    <div style={{ marginBottom: 16 }}>
      <p
        style={{
          fontSize: 10, color: T.text, fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
        }}
      >
        {copy.title}
      </p>
      <p
        style={{
          fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif",
          lineHeight: 1.7, maxWidth: 560, margin: 0,
        }}
      >
        {copy.body}
      </p>
    </div>
  );
}

export function ContractDashboard() {
  const { setView } = useAppStore();
  const [activeTab, setActiveTab] = useState<ContractTabId>('draft');

  const [contractId, setContractId] = useState<string>(() => getOrCreateCurrentMatterId());
  const [profile, setProfile] = useState<ClientPositionProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setProfileLoading(true);
    loadClientPositionProfile(contractId).then(p => {
      if (cancelled) return;
      setProfile(p);
      setProfileLoading(false);
    });
    return () => { cancelled = true; };
  }, [contractId]);

  function handleNewMatter() {
    if (!confirm('Start a new matter? The current one stays saved and can be reopened by its contract id, but this shell will switch to a fresh, empty register.')) {
      return;
    }
    setContractId(startNewMatterId());
    setActiveTab('draft');
  }

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

      {/* Current-matter strip — see file header for the 5b current-matter decision */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14, padding: '7px 12px', background: T.card,
        border: `1px solid ${T.bdrL}`, borderRadius: 4,
      }}>
        <p style={{
          fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '.04em', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          Matter <span style={{ color: T.dim }}>{contractId}</span>
        </p>
        <button
          type="button"
          onClick={handleNewMatter}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
            borderRadius: 3, padding: '4px 10px', fontSize: 10, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif", flexShrink: 0, marginLeft: 10,
          }}
        >
          Start New Matter
        </button>
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

      <ModeHeader tab={activeTab} />

      <div
        style={{
          background: T.card,
          border: `1px solid ${T.bdr}`,
          borderRadius: 6,
          padding: '20px 20px 22px',
        }}
      >
        {profileLoading ? (
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
            Loading matter…
          </p>
        ) : (
          <>
            {activeTab === 'draft' && (
              <DraftModePanel
                contractId={contractId}
                profile={profile}
                onProfileSaved={setProfile}
              />
            )}
            {activeTab === 'review' && (
              <ReviewModePanel contractId={contractId} profile={profile} />
            )}
            {activeTab === 'negotiate' && (
              <NegotiateModePanel contractId={contractId} profile={profile} />
            )}
          </>
        )}
      </div>

      <p style={{
        marginTop: 32, fontSize: 11, color: T.mute, textAlign: 'center',
        fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8,
      }}>
        AFS Legal OS · Contract Engine — Draft, Review, and Negotiate under one clause register.
      </p>
    </div>
  );
}
