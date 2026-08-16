/**
 * AFS Legal OS — Research Assistant Dashboard
 *
 * Roadmap ref: 6d (Research Assistant — dashboard entry point)
 *
 * Wires 6b's ResearchSession shape and 6c's runResearchTurn()/createResearchSession()
 * into a standalone screen, same "own top-level view" pattern as ContractDashboard
 * (5a/5b) and SanMode — not nested inside a case workspace.
 *
 * NOT YET PERSISTED — per research/types.ts's file header, 6b deliberately
 * left storage undecided. This screen therefore holds the ResearchSession in
 * plain React state only. Refreshing the page loses the session; that is the
 * documented, intentional state of the roadmap as of 6d, not a bug of this
 * screen. A future roadmap item can add persistence against the same shape
 * without this component changing its contract with runResearchTurn().
 *
 * TURN FLOW — "Start Research" creates a fresh session (6c's factory) and
 * immediately runs the first turn. After that, "Continue" runs one more turn
 * at a time — never auto-loops — so counsel reads each finding before Supo
 * spends another call. This mirrors 6c's own one-turn-per-call contract; the
 * component does not add its own auto-advance behaviour on top of it.
 * "Stop Here" sets status to 'abandoned' per research/types.ts's status enum,
 * distinct from Supo's own 'exhausted' verdict.
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T, S } from '@/constants/tokens';
import { createResearchSession, runResearchTurn, MAX_RESEARCH_TURNS } from '@/research/queryGenerator';
import type { ResearchSession } from '@/research/types';

function StatusPill({ status }: { status: ResearchSession['status'] }) {
  const copy: Record<ResearchSession['status'], { label: string; color: string }> = {
    active:    { label: 'Active',    color: T.info },
    exhausted: { label: 'Exhausted', color: T.ok },
    abandoned: { label: 'Abandoned', color: T.mute },
  };
  const { label, color } = copy[status];
  return (
    <span style={{
      fontSize: 10, color, border: `1px solid ${color}`, borderRadius: 3,
      padding: '2px 8px', fontFamily: "'Times New Roman', Times, serif",
      letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700,
    }}>
      {label}
    </span>
  );
}

function EntryCard({ index, entry }: { index: number; entry: ResearchSession['entries'][number] }) {
  return (
    <div style={{
      border: `1px solid ${T.bdrL}`, borderRadius: 5, padding: '14px 16px',
      marginBottom: 12, background: '#ffffff',
    }}>
      <p style={{ ...S.h3, margin: '0 0 6px' }}>Turn {index + 1}</p>
      <p style={{ ...S.p, fontStyle: 'italic', margin: '0 0 8px' }}>{entry.query}</p>
      <p style={{ ...S.p, margin: 0, whiteSpace: 'pre-wrap' }}>{entry.findings}</p>
      <p style={{
        fontSize: 11, color: entry.exhausted ? T.ok : T.mute, marginTop: 10,
        fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6,
        borderTop: `1px solid ${T.bdrL}`, paddingTop: 8,
      }}>
        {entry.exhausted ? '✓ ' : ''}{entry.exhausted_reasoning}
      </p>
    </div>
  );
}

export function ResearchDashboard() {
  const { setView } = useAppStore();

  const [problemStatement, setProblemStatement] = useState('');
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const canStart = problemStatement.trim().length > 0 && !running;

  async function advance(base: ResearchSession) {
    setRunning(true);
    setError('');
    const result = await runResearchTurn(base);
    setRunning(false);
    setSession(result.session);
    if (!result.ok) {
      setError(result.error || 'Supo could not complete this turn.');
    }
  }

  function startResearch() {
    if (!canStart) return;
    const fresh = createResearchSession(problemStatement);
    setSession(fresh);
    advance(fresh);
  }

  function continueResearch() {
    if (!session || session.status !== 'active' || running) return;
    advance(session);
  }

  function stopHere() {
    if (!session || session.status !== 'active') return;
    setSession({ ...session, status: 'abandoned', updated_at: new Date().toISOString() });
  }

  function newSession() {
    setSession(null);
    setProblemStatement('');
    setError('');
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease', maxWidth: 620, margin: '0 auto' }}>

      {/* Masthead — same pattern as ContractDashboard */}
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
            Smart Tools · Research
          </p>
        </div>
        <div style={{ borderTop: `2px solid ${T.text}`, paddingTop: 12 }}>
          <h1 style={{
            fontSize: 30, color: T.text, fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, fontStyle: 'italic', lineHeight: 1.15, marginBottom: 10,
          }}>
            Research Assistant
          </h1>
          <p style={{
            fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif",
            lineHeight: 1.65, borderTop: `1px solid ${T.bdr}`, paddingTop: 10,
          }}>
            Give Supo a problem statement. Each turn runs one query against the last findings,
            up to {MAX_RESEARCH_TURNS} turns, until the problem is judged resolved.
          </p>
        </div>
      </div>

      {!session && (
        <div style={{
          background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 6,
          padding: '20px 20px 22px',
        }}>
          <label style={S.label}>Problem Statement *</label>
          <textarea
            value={problemStatement}
            onChange={e => setProblemStatement(e.target.value)}
            placeholder="State the legal question or research problem counsel needs resolved…"
            style={S.ta}
            disabled={running}
          />
          <button
            type="button"
            onClick={startResearch}
            disabled={!canStart}
            style={canStart ? S.btn : S.btnOff}
          >
            {running ? 'Running turn 1…' : 'Start Research'}
          </button>
        </div>
      )}

      {session && (
        <>
          {/* Session header strip */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 14, padding: '10px 14px', background: T.card,
            border: `1px solid ${T.bdrL}`, borderRadius: 4, gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{
                fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif",
                margin: '0 0 4px', lineHeight: 1.5,
              }}>
                {session.problem_statement}
              </p>
              <p style={{ ...S.hint, margin: 0 }}>
                {session.entries.length} of {MAX_RESEARCH_TURNS} turns
              </p>
            </div>
            <StatusPill status={session.status} />
          </div>

          {session.entries.map((entry, i) => (
            <EntryCard key={entry.id} index={i} entry={entry} />
          ))}

          {error && (
            <div style={{
              marginBottom: 14, padding: '10px 14px', background: '#fff4f4',
              border: `1px solid ${T.err}`, borderRadius: 5,
            }}>
              <p style={{ ...S.p, color: T.err, margin: 0, fontSize: 12 }}>{error}</p>
            </div>
          )}

          {session.status === 'active' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={continueResearch}
                disabled={running}
                style={{ ...(running ? S.btnOff : S.btn), marginTop: 0, flex: 2 }}
              >
                {running ? `Running turn ${session.entries.length + 1}…` : 'Continue'}
              </button>
              <button
                type="button"
                onClick={stopHere}
                disabled={running}
                style={{
                  flex: 1, background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
                  borderRadius: 4, padding: '11px 14px', fontSize: 12, cursor: running ? 'not-allowed' : 'pointer',
                  fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Stop Here
              </button>
            </div>
          )}

          {session.status !== 'active' && (
            <button type="button" onClick={newSession} style={{ ...S.btn, background: T.dim }}>
              New Research Session
            </button>
          )}
        </>
      )}

      <p style={{
        marginTop: 32, fontSize: 11, color: T.mute, textAlign: 'center',
        fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8,
      }}>
        AFS Legal OS · Research Assistant — one query at a time, grounded reasoning, an honest exhaustion verdict.
      </p>
    </div>
  );
}
