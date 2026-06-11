/**
 * AFS Legal OS V2 — Procedural Timeline Engine (Phase 3)
 *
 * Renders the role-correct procedural stage chain for any matter.
 * Consumes ROLE_STAGES from roleWorkspace.ts and:
 *   · Marks completed stages (all stages before current)
 *   · Highlights the current stage
 *   · Shows upcoming stages as pending
 *   · Allows manual stage override via "Set as Current Stage"
 *   · Shows docket entries that triggered each stage detection
 *   · Integrates with the dynamic Next Action computation
 *
 * Legacy V1 matters (no counsel_role) fall back to the docket-based CaseTimeline.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { T } from '@/constants/tokens';
import { useAppStore } from '@/state/appStore';
import { loadEntries, loadDeadlines, saveCase } from '@/storage/helpers';
import { ROLE_STAGES, STAGE_KEYWORDS, ROLE_POSITION_CONFIG } from '@/constants/roleWorkspace';
import { computeNextAction } from '@/utils/nextAction';
import type { Case, DocketEntry, Deadline, CounselRole } from '@/types';
import { COUNSEL_ROLE_COLORS, MATTER_TRACK_LABELS } from '@/types';
import { CaseTimeline } from './CaseTimeline';

// ── Types ─────────────────────────────────────────────────────────────────────

type StageState = 'completed' | 'current' | 'upcoming';

interface StageWithState {
  id:          string;
  label:       string;
  desc:        string;
  icon:        string;
  state:       StageState;
  matchedEntries: DocketEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildStagesWithState(
  role:           CounselRole,
  currentStageId: string | null,
  entries:        DocketEntry[],
): StageWithState[] {
  const stages = ROLE_STAGES[role] ?? [];
  const currentIndex = currentStageId
    ? stages.findIndex(s => s.id === currentStageId)
    : -1;

  // Build corpus per stage (entries whose title/notes match stage keywords)
  const corpus = entries.map(e =>
    `${e.docTitle} ${e.notes ?? ''} ${e.docType ?? ''}`.toLowerCase()
  );

  return stages.map((stage, i) => {
    let state: StageState;
    if (currentIndex < 0) {
      state = 'upcoming';
    } else if (i < currentIndex) {
      state = 'completed';
    } else if (i === currentIndex) {
      state = 'current';
    } else {
      state = 'upcoming';
    }

    const keywords = STAGE_KEYWORDS[stage.id] ?? [];
    const matchedEntries = entries.filter((_, ei) =>
      keywords.some(kw => corpus[ei]?.includes(kw.toLowerCase()))
    );

    return { ...stage, state, matchedEntries };
  });
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

// ── Stage card ────────────────────────────────────────────────────────────────

interface StageCardProps {
  stage:       StageWithState;
  accent:      string;
  roleBg:      string;
  roleBdr:     string;
  isLast:      boolean;
  onSetCurrent: (id: string) => void;
  isSetting:   boolean;
}

function StageCard({
  stage, accent, roleBg, roleBdr, isLast, onSetCurrent, isSetting,
}: StageCardProps) {
  const [expanded, setExpanded] = useState(stage.state === 'current');

  const dotColor = stage.state === 'completed'
    ? '#2e6a48'
    : stage.state === 'current'
      ? accent
      : '#252535';

  const dotBg = stage.state === 'completed'
    ? '#071a0e'
    : stage.state === 'current'
      ? `${accent}22`
      : '#07070f';

  const cardBg = stage.state === 'current'
    ? roleBg
    : stage.state === 'completed'
      ? '#07090a'
      : '#07070f';

  const cardBdr = stage.state === 'current'
    ? roleBdr
    : stage.state === 'completed'
      ? '#0e1a14'
      : '#111120';

  const labelColor = stage.state === 'completed'
    ? '#2e6a48'
    : stage.state === 'current'
      ? accent
      : '#252535';

  const descColor = stage.state === 'current'
    ? T.sub
    : stage.state === 'completed'
      ? '#304040'
      : '#1e1e2e';

  return (
    <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
      {/* Timeline spine */}
      <div style={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Dot */}
        <div style={{
          width: stage.state === 'current' ? 14 : 10,
          height: stage.state === 'current' ? 14 : 10,
          borderRadius: '50%',
          background: dotBg,
          border: `2px solid ${dotColor}`,
          flexShrink: 0,
          marginTop: 18,
          zIndex: 1,
          boxShadow: stage.state === 'current' ? `0 0 12px ${accent}55` : 'none',
          transition: 'all .2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {stage.state === 'completed' && (
            <span style={{ fontSize: 6, color: '#2e6a48', lineHeight: 1 }}>✓</span>
          )}
        </div>

        {/* Spine line */}
        {!isLast && (
          <div style={{
            flex: 1,
            width: 1,
            background: stage.state === 'completed'
              ? 'linear-gradient(180deg,#1a3028,#111120)'
              : '#111120',
            marginTop: 4,
            minHeight: 24,
          }} />
        )}
      </div>

      {/* Card */}
      <div style={{
        flex: 1,
        marginBottom: isLast ? 0 : 10,
        marginLeft: 8,
      }}>
        <div
          onClick={() => setExpanded(e => !e)}
          style={{
            background: cardBg,
            border: `1px solid ${cardBdr}`,
            borderLeft: stage.state === 'current' ? `3px solid ${accent}` : `1px solid ${cardBdr}`,
            borderRadius: '0 8px 8px 0',
            padding: '14px 16px',
            cursor: 'pointer',
            transition: 'border-color .15s, background .15s',
          }}
          onMouseEnter={e => {
            if (stage.state !== 'current') {
              (e.currentTarget as HTMLDivElement).style.borderColor = '#1e1e2e';
            }
          }}
          onMouseLeave={e => {
            if (stage.state !== 'current') {
              (e.currentTarget as HTMLDivElement).style.borderColor = cardBdr;
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Stage label */}
            <span style={{
              fontSize: stage.state === 'current' ? 15 : 13,
              color: labelColor,
              fontFamily: "'Cormorant Garamond', serif",
              fontWeight: stage.state === 'current' ? 600 : 400,
              flex: 1,
              lineHeight: 1.25,
            }}>
              {stage.label}
            </span>

            {/* State badge */}
            {stage.state === 'current' && (
              <span style={{
                fontSize: 8, color: accent,
                fontFamily: 'Inter, sans-serif',
                fontWeight: 700, letterSpacing: '.1em',
                textTransform: 'uppercase',
                background: `${accent}18`,
                border: `1px solid ${accent}40`,
                padding: '2px 8px', borderRadius: 3,
              }}>
                Current Stage
              </span>
            )}
            {stage.state === 'completed' && (
              <span style={{
                fontSize: 8, color: '#2e6a48',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600, letterSpacing: '.08em',
                textTransform: 'uppercase',
                background: '#071a0e',
                border: '1px solid #0e3020',
                padding: '2px 7px', borderRadius: 3,
              }}>
                ✓ Done
              </span>
            )}

            {/* Expand chevron */}
            <span style={{
              fontSize: 9, color: descColor,
              fontFamily: 'Inter, sans-serif',
              transition: 'transform .15s',
              transform: expanded ? 'rotate(180deg)' : 'none',
            }}>▾</span>
          </div>

          {/* Collapsed desc (always visible for current) */}
          {(!expanded || stage.state !== 'current') && (
            <p style={{
              fontSize: 11, color: descColor,
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.6, marginTop: 5,
              display: expanded ? 'none' : 'block',
            }}>
              {stage.desc}
            </p>
          )}

          {/* Expanded panel */}
          {expanded && (
            <div style={{ marginTop: 10, borderTop: `1px solid ${cardBdr}`, paddingTop: 10 }}>
              {/* Full description */}
              <p style={{
                fontSize: 12, color: stage.state === 'current' ? T.sub : descColor,
                fontFamily: "'Cormorant Garamond', serif",
                lineHeight: 1.75, fontStyle: 'italic', marginBottom: 10,
              }}>
                {stage.desc}
              </p>

              {/* Matched docket entries */}
              {stage.matchedEntries.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <p style={{
                    fontSize: 8, color: T.mute,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '.1em', textTransform: 'uppercase',
                    fontWeight: 600, marginBottom: 6,
                  }}>
                    Docket Entries at This Stage
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {stage.matchedEntries.slice(0, 4).map(entry => (
                      <div key={entry.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: '#080810', border: '1px solid #0d0d1c',
                        borderRadius: 5, padding: '6px 10px',
                      }}>
                        <span style={{ fontSize: 9, color: '#3a3a5a', fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>
                          {fmtDate(entry.dateFiled)}
                        </span>
                        <span style={{ fontSize: 12, color: T.dim, fontFamily: "'Cormorant Garamond', serif", flex: 1 }}>
                          {entry.docTitle}
                        </span>
                        {entry.status && (
                          <span style={{
                            fontSize: 8, color: '#3a3a5a',
                            fontFamily: 'Inter, sans-serif',
                            border: '1px solid #1a1a2e',
                            padding: '1px 5px', borderRadius: 2,
                          }}>
                            {entry.status}
                          </span>
                        )}
                      </div>
                    ))}
                    {stage.matchedEntries.length > 4 && (
                      <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', paddingLeft: 4 }}>
                        +{stage.matchedEntries.length - 4} more entries
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Set as current stage button (only for non-current stages) */}
              {stage.state !== 'current' && (
                <button
                  onClick={e => { e.stopPropagation(); onSetCurrent(stage.id); }}
                  disabled={isSetting}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${accent}40`,
                    color: accent,
                    borderRadius: 5,
                    padding: '5px 12px',
                    fontSize: 10,
                    fontFamily: 'Inter, sans-serif',
                    cursor: isSetting ? 'not-allowed' : 'pointer',
                    letterSpacing: '.04em',
                    opacity: isSetting ? 0.5 : 1,
                  }}
                >
                  {isSetting ? 'Saving…' : '→ Set as Current Stage'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface ProceduralTimelineProps {
  activeCase: Case;
}

export function ProceduralTimeline({ activeCase }: ProceduralTimelineProps) {
  const { updateActiveCase } = useAppStore();
  const [entries,   setEntries]   = useState<DocketEntry[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isSetting, setIsSetting] = useState(false);
  const [view,      setView]      = useState<'procedural' | 'docket'>('procedural');

  const counselRole = activeCase.counsel_role as CounselRole | undefined;
  const posConfig   = counselRole ? ROLE_POSITION_CONFIG[counselRole] : null;
  const accent      = posConfig?.accentColor ?? '#888888';
  const roleColors  = counselRole ? COUNSEL_ROLE_COLORS[counselRole] : null;
  const roleBg      = roleColors?.bg  ?? '#0a0a14';
  const roleBdr     = roleColors?.bdr ?? '#1e1e2e';

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      loadEntries(activeCase.id),
      loadDeadlines(activeCase.id),
    ]).then(([ents, dls]) => {
      if (!live) return;
      setEntries(ents ?? []);
      setDeadlines(dls ?? []);
      setLoading(false);
    }).catch(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [activeCase.id]);

  // ── Compute next action ──────────────────────────────────────────────────────
  const nextActionResult = computeNextAction(activeCase, entries, deadlines);
  const { currentStageId } = nextActionResult;

  // ── Build stage chain ────────────────────────────────────────────────────────
  const stagesWithState = counselRole
    ? buildStagesWithState(counselRole, currentStageId, entries)
    : [];

  const completedCount = stagesWithState.filter(s => s.state === 'completed').length;
  const totalCount     = stagesWithState.length;

  // ── Set current stage handler ────────────────────────────────────────────────
  const handleSetCurrent = useCallback(async (stageId: string) => {
    setIsSetting(true);
    const patch = { current_stage: stageId };
    updateActiveCase(patch);
    try {
      await saveCase({ ...activeCase, ...patch });
    } catch (e) {
      console.error('[ProceduralTimeline] saveCase failed', e);
    } finally {
      setIsSetting(false);
    }
  }, [activeCase, updateActiveCase]);

  // ── Legacy fallback ──────────────────────────────────────────────────────────
  if (!counselRole) {
    return <CaseTimeline activeCase={activeCase} />;
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase' }}>
          Loading timeline…
        </div>
      </div>
    );
  }

  const matterTrackLabel = activeCase.matter_track
    ? MATTER_TRACK_LABELS[activeCase.matter_track]
    : null;

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{
          fontSize: 9, color: T.mute,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '.2em', textTransform: 'uppercase',
          fontWeight: 600, marginBottom: 3,
        }}>
          {matterTrackLabel ? `${matterTrackLabel} · ` : ''}Procedural Timeline
        </p>
        <h3 style={{
          fontSize: 20, color: T.goldL,
          fontFamily: "'Cormorant Garamond', serif",
          fontWeight: 300, fontStyle: 'italic', marginBottom: 4,
        }}>
          {posConfig?.positionLabel ?? 'Procedural Stages'}
        </h3>
        <p style={{
          fontSize: 12, color: T.dim,
          fontFamily: "'Cormorant Garamond', serif",
          fontStyle: 'italic',
        }}>
          {posConfig?.positionDesc}
        </p>
      </div>

      {/* ── View toggle ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {(['procedural', 'docket'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              background: view === v ? `${accent}18` : 'transparent',
              border: `1px solid ${view === v ? accent + '50' : '#1e1e2e'}`,
              color: view === v ? accent : T.mute,
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 10,
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
              letterSpacing: '.04em',
              fontWeight: view === v ? 600 : 400,
              transition: 'all .15s',
            }}
          >
            {v === 'procedural' ? 'Procedural Stages' : 'Docket History'}
          </button>
        ))}
      </div>

      {view === 'docket' ? (
        <CaseTimeline activeCase={activeCase} />
      ) : (
        <>
          {/* ── Progress bar ──────────────────────────────────────────────────── */}
          {totalCount > 0 && (
            <div style={{
              background: '#080810',
              border: '1px solid #111120',
              borderRadius: 8,
              padding: '14px 18px',
              marginBottom: 18,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9, color: T.mute,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '.12em', textTransform: 'uppercase',
                    fontWeight: 600,
                  }}>
                    Stage Progress
                  </span>
                  {nextActionResult.source === 'inferred' && (
                    <span style={{
                      fontSize: 8, color: '#5a4a20',
                      fontFamily: 'Inter, sans-serif',
                      letterSpacing: '.08em',
                      border: '1px solid #2a2208',
                      background: '#0e0c04',
                      padding: '1px 7px', borderRadius: 3,
                    }}>
                      ⚡ Auto-detected from docket
                    </span>
                  )}
                  {nextActionResult.source === 'explicit' && (
                    <span style={{
                      fontSize: 8, color: '#2e5a38',
                      fontFamily: 'Inter, sans-serif',
                      letterSpacing: '.08em',
                      border: '1px solid #1a3820',
                      background: '#071008',
                      padding: '1px 7px', borderRadius: 3,
                    }}>
                      ✓ Stage manually set
                    </span>
                  )}
                </div>
                <span style={{
                  fontSize: 11, color: accent,
                  fontFamily: "'Cormorant Garamond', serif",
                  fontWeight: 600,
                }}>
                  {completedCount} / {totalCount}
                </span>
              </div>

              {/* Progress track */}
              <div style={{
                height: 4, background: '#111120', borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${totalCount > 0 ? ((completedCount + (currentStageId ? 0.5 : 0)) / totalCount) * 100 : 0}%`,
                  background: `linear-gradient(90deg, ${accent}88, ${accent})`,
                  borderRadius: 2,
                  transition: 'width .4s ease',
                }} />
              </div>

              {/* Stage pills summary */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e6a48', border: '1px solid #1a4028', display: 'inline-block' }} />
                  <span style={{ fontSize: 9, color: '#2e6a48', fontFamily: 'Inter, sans-serif' }}>{completedCount} completed</span>
                </div>
                {currentStageId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: `${accent}22`, border: `1px solid ${accent}`, display: 'inline-block', boxShadow: `0 0 6px ${accent}44` }} />
                    <span style={{ fontSize: 9, color: accent, fontFamily: 'Inter, sans-serif' }}>
                      {nextActionResult.currentStageLabel}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#07070f', border: '1px solid #252535', display: 'inline-block' }} />
                  <span style={{ fontSize: 9, color: '#252535', fontFamily: 'Inter, sans-serif' }}>
                    {totalCount - completedCount - (currentStageId ? 1 : 0)} upcoming
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Next Action strip ─────────────────────────────────────────────── */}
          <div style={{
            background: `${accent}0c`,
            border: `1px solid ${accent}28`,
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 18,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 14, color: accent, flexShrink: 0, marginTop: 1 }}>→</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 8, color: accent,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '.14em', textTransform: 'uppercase',
                    fontWeight: 700,
                  }}>
                    {posConfig?.nextActionLabel ?? 'Next Action'}
                  </span>
                  {nextActionResult.nextStageLabel && (
                    <span style={{
                      fontSize: 8, color: T.mute,
                      fontFamily: 'Inter, sans-serif',
                      letterSpacing: '.06em',
                    }}>
                      → {nextActionResult.nextStageLabel}
                    </span>
                  )}
                </div>
                <p style={{
                  fontSize: 13, color: T.sub,
                  fontFamily: "'Cormorant Garamond', serif",
                  lineHeight: 1.6,
                }}>
                  {nextActionResult.action}
                </p>

                {/* Urgency note */}
                {nextActionResult.urgency && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    marginTop: 8,
                    background: nextActionResult.urgency.level === 'HIGH' ? '#1a0808' : '#181000',
                    border: `1px solid ${nextActionResult.urgency.level === 'HIGH' ? '#4a1818' : '#3a2800'}`,
                    borderRadius: 5, padding: '6px 10px',
                  }}>
                    <span style={{ fontSize: 10, color: nextActionResult.urgency.level === 'HIGH' ? '#c05050' : '#b07030' }}>
                      {nextActionResult.urgency.level === 'HIGH' ? '⚠' : '!'}
                    </span>
                    <span style={{
                      fontSize: 11, color: nextActionResult.urgency.level === 'HIGH' ? '#c05050' : '#b07030',
                      fontFamily: 'Inter, sans-serif', lineHeight: 1.4,
                    }}>
                      {nextActionResult.urgency.note}
                    </span>
                  </div>
                )}

                {/* Overdue deadlines warning */}
                {nextActionResult.hasOverdueDeadlines && !nextActionResult.urgency && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    marginTop: 8,
                    background: '#1a0808', border: '1px solid #4a1818',
                    borderRadius: 5, padding: '6px 10px',
                  }}>
                    <span style={{ fontSize: 10, color: '#c05050' }}>⚠</span>
                    <span style={{ fontSize: 11, color: '#c05050', fontFamily: 'Inter, sans-serif' }}>
                      {nextActionResult.overdueCount} overdue deadline{nextActionResult.overdueCount > 1 ? 's' : ''} — check Deadlines.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Stage chain ───────────────────────────────────────────────────── */}
          {stagesWithState.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '52px 24px',
              background: '#080808', border: '1px solid #111120',
              borderRadius: 10,
            }}>
              <div style={{ fontSize: 36, opacity: .06, marginBottom: 12 }}>⟳</div>
              <p style={{ fontSize: 18, color: T.dim, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>
                No procedural stages defined for this role.
              </p>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {stagesWithState.map((stage, i) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  accent={accent}
                  roleBg={roleBg}
                  roleBdr={roleBdr}
                  isLast={i === stagesWithState.length - 1}
                  onSetCurrent={handleSetCurrent}
                  isSetting={isSetting}
                />
              ))}
            </div>
          )}

          {/* ── Footer note ───────────────────────────────────────────────────── */}
          <p style={{
            textAlign: 'center', fontSize: 10,
            color: '#1e1e2e', fontFamily: 'Inter, sans-serif',
            marginTop: 20, letterSpacing: '.08em',
          }}>
            {totalCount} procedural stages · {
              nextActionResult.source === 'inferred'
                ? 'Stage auto-detected from docket entries'
                : nextActionResult.source === 'explicit'
                  ? 'Stage manually set'
                  : 'Set the current stage to track progress'
            }
          </p>
        </>
      )}
    </div>
  );
}
