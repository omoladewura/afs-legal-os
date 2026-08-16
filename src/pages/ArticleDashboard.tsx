/**
 * AFS Legal OS — Article Generator Dashboard
 *
 * Roadmap ref: not itself a numbered roadmap item — Section 7 (7a–7d) built
 * every piece of the Article Generator's engine but never a screen counsel
 * can actually press a button on, unlike every other engine (5a/5b gave the
 * Contract Engine one, 6d gave the Research Assistant one). This closes
 * that gap using only what 7a–7d already built, the same "just routing, no
 * new logic" convention as 3d/7c — no new AI calls are added here that
 * don't already exist in articleResearch.ts / queryGenerator.ts /
 * articleDraftGenerator.ts.
 *
 * FLOW — three stages, one screen:
 *   1. "New Topic"  → startArticleResearch() (7c): selects a topic (7b) and
 *                      creates a fresh, empty ResearchSession (6c's factory).
 *                      No AI research call yet — counsel sees the topic
 *                      before spending any research-turn calls on it.
 *   2. Research      → runResearchTurn() (6c), one turn at a time, same
 *                      manual "Continue"/"Stop Here" pattern as
 *                      ResearchDashboard (6d) — never auto-loops.
 *   3. "Generate Draft" → generateArticleDraft() (7d), enabled once there's
 *                      at least one finding (session.entries.length > 0),
 *                      same precondition 7d itself enforces — counsel does
 *                      not have to run every turn to exhaustion first.
 *
 * NOT PERSISTED — same reasoning as ResearchDashboard (6d): 6b never added
 * session storage, and 7d never added draft storage. Everything here is
 * plain React state; refreshing the page loses the in-progress topic,
 * research, and draft. The one piece that IS persisted is the topic log
 * itself (7a's D1 table), written by selectNextTopic() inside
 * startArticleResearch() — that happens regardless of this screen.
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T, S } from '@/constants/tokens';
import { startArticleResearch } from '@/articles/articleResearch';
import { runResearchTurn, MAX_RESEARCH_TURNS } from '@/research/queryGenerator';
import { generateArticleDraft } from '@/articles/articleDraftGenerator';
import type { ResearchSession } from '@/research/types';
import type { ArticleTopicLogEntry } from '@/articles/types';
import type { ArticleDraft } from '@/articles/articleDraftGenerator';

function StatusPill({ status }: { status: ResearchSession['status'] }) {
  const copy: Record<ResearchSession['status'], { label: string; color: string }> = {
    active:    { label: 'Researching', color: T.info },
    exhausted: { label: 'Exhausted',   color: T.ok },
    abandoned: { label: 'Stopped',     color: T.mute },
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

function EntryRow({ index, entry }: { index: number; entry: ResearchSession['entries'][number] }) {
  return (
    <div style={{
      border: `1px solid ${T.bdrL}`, borderRadius: 5, padding: '12px 14px',
      marginBottom: 10, background: '#ffffff',
    }}>
      <p style={{ ...S.h3, margin: '0 0 5px' }}>Turn {index + 1}</p>
      <p style={{ ...S.p, fontStyle: 'italic', margin: '0 0 6px', fontSize: 13 }}>{entry.query}</p>
      <p style={{ ...S.p, margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{entry.findings}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      marginBottom: 14, padding: '10px 14px', background: '#fff4f4',
      border: `1px solid ${T.err}`, borderRadius: 5,
    }}>
      <p style={{ ...S.p, color: T.err, margin: 0, fontSize: 12 }}>{message}</p>
    </div>
  );
}

type Stage = 'idle' | 'selecting' | 'researching' | 'drafting';

export function ArticleDashboard() {
  const { setView } = useAppStore();

  const [topicEntry, setTopicEntry] = useState<ArticleTopicLogEntry | null>(null);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');

  const busy = stage === 'selecting' || stage === 'researching' || stage === 'drafting';

  async function newTopic() {
    setStage('selecting');
    setError('');
    setDraft(null);
    setSession(null);
    setTopicEntry(null);

    const result = await startArticleResearch();
    setStage('idle');
    if (!result.ok || !result.session || !result.topicEntry) {
      setError(result.error || 'Topic selection failed.');
      return;
    }
    setTopicEntry(result.topicEntry);
    setSession(result.session);
  }

  async function continueResearch() {
    if (!session || session.status !== 'active' || busy) return;
    setStage('researching');
    setError('');
    const result = await runResearchTurn(session);
    setStage('idle');
    setSession(result.session);
    if (!result.ok) {
      setError(result.error || 'Supo could not complete this turn.');
    }
  }

  function stopHere() {
    if (!session || session.status !== 'active') return;
    setSession({ ...session, status: 'abandoned', updated_at: new Date().toISOString() });
  }

  async function makeDraft() {
    if (!session || !topicEntry || session.entries.length === 0 || busy) return;
    setStage('drafting');
    setError('');
    const result = await generateArticleDraft(session, topicEntry);
    setStage('idle');
    if (!result.ok || !result.draft) {
      setError(result.error || 'Draft generation failed.');
      return;
    }
    setDraft(result.draft);
  }

  function startOver() {
    setTopicEntry(null);
    setSession(null);
    setDraft(null);
    setError('');
    setStage('idle');
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease', maxWidth: 620, margin: '0 auto' }}>

      {/* Masthead — same pattern as ContractDashboard / ResearchDashboard */}
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
            Smart Tools · Articles
          </p>
        </div>
        <div style={{ borderTop: `2px solid ${T.text}`, paddingTop: 12 }}>
          <h1 style={{
            fontSize: 30, color: T.text, fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, fontStyle: 'italic', lineHeight: 1.15, marginBottom: 10,
          }}>
            Article Generator
          </h1>
          <p style={{
            fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif",
            lineHeight: 1.65, borderTop: `1px solid ${T.bdr}`, paddingTop: 10,
          }}>
            Picks a topic, researches it turn by turn with Supo, then writes a copy-ready draft.
            Output stays here — nothing is published automatically.
          </p>
        </div>
      </div>

      {!topicEntry && (
        <div style={{
          background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 6,
          padding: '20px 20px 22px', textAlign: 'center',
        }}>
          <p style={{ ...S.hint, marginBottom: 14 }}>
            No topic selected yet — Supo picks something specific, cross-area, and not recently covered.
          </p>
          <button
            type="button"
            onClick={newTopic}
            disabled={busy}
            style={busy ? S.btnOff : { ...S.btn, marginTop: 0 }}
          >
            {stage === 'selecting' ? 'Selecting a topic…' : 'New Topic'}
          </button>
          {error && <div style={{ marginTop: 14, textAlign: 'left' }}><ErrorBanner message={error} /></div>}
        </div>
      )}

      {topicEntry && session && (
        <>
          {/* Topic strip */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 14, padding: '10px 14px', background: T.card,
            border: `1px solid ${T.bdrL}`, borderRadius: 4, gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ ...S.hint, margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10 }}>
                {topicEntry.area}
              </p>
              <p style={{
                fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif",
                margin: 0, lineHeight: 1.5,
              }}>
                {topicEntry.topic}
              </p>
            </div>
            <StatusPill status={session.status} />
          </div>

          {!draft && session.entries.map((entry, i) => (
            <EntryRow key={entry.id} index={i} entry={entry} />
          ))}

          {error && <ErrorBanner message={error} />}

          {!draft && (
            <>
              {session.status === 'active' && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={continueResearch}
                    disabled={busy}
                    style={{ ...(busy ? S.btnOff : S.btn), marginTop: 0, flex: 2 }}
                  >
                    {stage === 'researching'
                      ? `Running turn ${session.entries.length + 1}…`
                      : session.entries.length === 0 ? 'Start Research' : 'Continue Research'}
                  </button>
                  <button
                    type="button"
                    onClick={stopHere}
                    disabled={busy}
                    style={{
                      flex: 1, background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
                      borderRadius: 4, padding: '11px 14px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    Stop Here
                  </button>
                </div>
              )}

              <p style={{ ...S.hint, textAlign: 'center', marginBottom: 10 }}>
                {session.entries.length} of {MAX_RESEARCH_TURNS} research turns
              </p>

              <button
                type="button"
                onClick={makeDraft}
                disabled={busy || session.entries.length === 0}
                style={busy || session.entries.length === 0 ? S.btnOff : { ...S.btn, marginTop: 0, background: T.dim }}
              >
                {stage === 'drafting' ? 'Writing draft…' : 'Generate Draft'}
              </button>
            </>
          )}

          {draft && (
            <div style={{
              background: '#ffffff', border: `1px solid ${T.bdr}`, borderRadius: 6,
              padding: '22px 24px',
            }}>
              <h2 style={{
                fontSize: 22, color: T.text, fontFamily: "'Times New Roman', Times, serif",
                fontWeight: 700, fontStyle: 'italic', lineHeight: 1.3, marginBottom: 14,
              }}>
                {draft.title}
              </h2>
              <div style={{
                fontSize: 14, color: T.sub, fontFamily: "'Times New Roman', Times, serif",
                lineHeight: 1.85, whiteSpace: 'pre-wrap',
              }}>
                {draft.body}
              </div>
            </div>
          )}

          {(session.status !== 'active' || draft) && (
            <button type="button" onClick={startOver} style={{ ...S.btn, background: T.dim }}>
              Start a New Article
            </button>
          )}
        </>
      )}

      <p style={{
        marginTop: 32, fontSize: 11, color: T.mute, textAlign: 'center',
        fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.8,
      }}>
        AFS Legal OS · Article Generator — topic, research, draft — nothing leaves this screen automatically.
      </p>
    </div>
  );
}
