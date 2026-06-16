/**
 * AFS Legal OS — Written Address Engine (Phase 3)
 *
 * New tab: `written_address`
 * Replaces tabs: `final_address` and `builder`
 * Absorbs: ArgumentBuilder · FinalAddressEngine · AuthorityValidator
 *          ResearchResolver · SynthesisEngine
 *
 * Four stages in a linear pipeline:
 *
 *   STAGE 1 — DRAFT
 *     Civil / FREP  → ArgumentBuilder
 *                     (trial address, interlocutory, final address,
 *                      reply on points of law)
 *     Criminal      → FinalAddressEngine
 *                     (prosecution / defence final address +
 *                      reply on points of law)
 *
 *   STAGE 2 — RESEARCH
 *     ResearchResolver
 *     Paste [RESEARCH NEEDED] blocks from Stage 1
 *     Generate LawPavilion queries → find real cases → resolve citations
 *
 *   STAGE 3 — VALIDATE
 *     AuthorityValidator
 *     Build authority library from Stage 1 draft
 *     Check binding strength, overruled status, conflicts, hierarchy
 *
 *   STAGE 4 — SYNTHESISE
 *     SynthesisEngine
 *     Reads Intelligence output + Stage 1 draft + Stage 3 authority library
 *     Produces Master Case Theory (Civil / Criminal / Appeal modes)
 *     Surfaces contradictions explicitly
 *
 * Civil and criminal routes diverge only at Stage 1 — the drafter.
 * Everything else (Stages 2–4) is shared across all tracks.
 *
 * Engine logic is untouched — components imported and rendered inside new shell.
 */

import React, { useState, useCallback } from 'react';
import { T } from '@/constants/tokens';
import { useAppStore } from '@/state/appStore';
import type { Case, DashTabId } from '@/types';
import { COUNSEL_ROLE_COLORS, MATTER_TRACK_COLORS, MATTER_TRACK_LABELS } from '@/types';

// Absorbed engines — logic untouched, rendered inside new shell
import { ArgumentBuilder }    from '@/engines/ArgumentBuilder';
import { FinalAddressEngine } from '@/engines/FinalAddressEngine';
import { ResearchResolver }   from '@/engines/ResearchResolver';
import { AuthorityValidator } from '@/engines/AuthorityValidator';
import { SynthesisEngine }    from '@/engines/SynthesisEngine';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type StageId = 'draft' | 'research' | 'validate' | 'synthesise';

interface StageConfig {
  id:       StageId;
  number:   number;
  icon:     string;
  label:    string;
  sublabel: string;
  desc:     string;
  color:    string;
  shared:   boolean; // true = same for civil + criminal; false = diverges by track
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const STAGES: StageConfig[] = [
  {
    id:       'draft',
    number:   1,
    icon:     '✍',
    label:    'Draft',
    sublabel: 'Stage 1',
    desc:     'Civil/FREP: ArgumentBuilder  ·  Criminal: FinalAddressEngine',
    color:    '#4a7ed0',
    shared:   false,
  },
  {
    id:       'research',
    number:   2,
    icon:     '🔍',
    label:    'Research',
    sublabel: 'Stage 2',
    desc:     'Paste [RESEARCH NEEDED] blocks → LawPavilion queries → resolve citations',
    color:    '#c4a030',
    shared:   true,
  },
  {
    id:       'validate',
    number:   3,
    icon:     '§',
    label:    'Validate',
    sublabel: 'Stage 3',
    desc:     'Authority library · Binding strength · Overruled status · Hierarchy',
    color:    '#c07030',
    shared:   true,
  },
  {
    id:       'synthesise',
    number:   4,
    icon:     '◉',
    label:    'Synthesise',
    sublabel: 'Stage 4',
    desc:     'Master Case Theory · Civil / Criminal / Appeal modes · Contradictions',
    color:    '#40a878',
    shared:   true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isCriminalTrack(activeCase: Case): boolean {
  return activeCase.matter_track === 'criminal';
}

function getDraftLabel(activeCase: Case): string {
  if (isCriminalTrack(activeCase)) return 'FinalAddressEngine — Prosecution / Defence';
  return 'ArgumentBuilder — Civil / FREP';
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE PROGRESS BAR
// ─────────────────────────────────────────────────────────────────────────────

function PipelineBar({
  activeStage,
  onStageClick,
}: {
  activeStage:   StageId;
  onStageClick:  (id: StageId) => void;
}) {
  const activeIndex = STAGES.findIndex(s => s.id === activeStage);

  return (
    <div style={{
      background:   T.card,
      border:       `1px solid ${T.bdr}`,
      borderRadius: 10,
      padding:      '16px 18px',
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{
        fontSize:     9,
        color:        T.dim,
        fontFamily:   "'Times New Roman', Times, serif",
        letterSpacing:'.14em',
        textTransform:'uppercase',
        fontWeight:   700,
        marginBottom: 14,
      }}>
        Written Address Engine — Pipeline
      </div>

      {/* Stage buttons */}
      <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
        {/* Connecting line */}
        <div style={{
          position:   'absolute',
          top:        '50%',
          left:       '10%',
          right:      '10%',
          height:     1,
          background: T.bdr,
          transform:  'translateY(-50%)',
          zIndex:     0,
        }} />

        {STAGES.map((stage, i) => {
          const active   = stage.id === activeStage;
          const complete = i < activeIndex;
          const col      = active ? stage.color : complete ? '#40a878' : T.mute;

          return (
            <button
              key={stage.id}
              onClick={() => onStageClick(stage.id)}
              style={{
                flex:        1,
                background:  active ? `${stage.color}12` : complete ? '#071a0e' : T.bg,
                border:      `1px solid ${active ? stage.color + '55' : complete ? '#1a4028' : T.bdr}`,
                borderRadius: 7,
                padding:     '12px 10px',
                textAlign:   'center',
                cursor:      'pointer',
                transition:  'all .15s',
                position:    'relative',
                zIndex:      1,
                margin:      '0 4px',
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.borderColor = stage.color + '40';
                  (e.currentTarget as HTMLElement).style.background  = `${stage.color}08`;
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.borderColor = complete ? '#1a4028' : T.bdr;
                  (e.currentTarget as HTMLElement).style.background  = complete ? '#071a0e' : T.bg;
                }
              }}
            >
              {/* Active top bar */}
              {active && (
                <div style={{
                  position:    'absolute',
                  top:         0, left: 0, right: 0,
                  height:      2,
                  background:  stage.color,
                  borderRadius:'7px 7px 0 0',
                }} />
              )}

              {/* Stage number / check */}
              <div style={{
                width:        22,
                height:       22,
                borderRadius: '50%',
                background:   active ? stage.color : complete ? '#40a878' : T.bdr,
                color:        '#fff',
                fontSize:     10,
                fontWeight:   700,
                display:      'flex',
                alignItems:   'center',
                justifyContent:'center',
                margin:       '0 auto 7px',
                transition:   'background .2s',
              }}>
                {complete ? '✓' : stage.number}
              </div>

              <div style={{
                fontSize:   8,
                color:      active ? stage.color : T.mute,
                fontFamily: "'Times New Roman', Times, serif",
                letterSpacing:'.1em',
                textTransform:'uppercase',
                fontWeight: 700,
                marginBottom: 2,
              }}>
                {stage.sublabel}
              </div>

              <div style={{
                fontSize:   12,
                color:      col,
                fontFamily: "'Times New Roman', Times, serif",
                fontWeight: active ? 700 : 400,
              }}>
                {stage.icon} {stage.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Stage flow note */}
      <div style={{
        marginTop:  10,
        fontSize:   10,
        color:      T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        fontStyle:  'italic',
        textAlign:  'center',
      }}>
        Stage 1 → Stage 2 → Stage 3 → Stage 4 · Civil and criminal diverge at Stage 1 only
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE HEADER (shown above each absorbed engine)
// ─────────────────────────────────────────────────────────────────────────────

function StageHeader({
  stage,
  activeCase,
  onNext,
  onPrev,
  isFirst,
  isLast,
}: {
  stage:      StageConfig;
  activeCase: Case;
  onNext:     () => void;
  onPrev:     () => void;
  isFirst:    boolean;
  isLast:     boolean;
}) {
  const isCriminal = isCriminalTrack(activeCase);
  const matterTrack = activeCase.matter_track;
  const counselRole = activeCase.counsel_role;

  const roleAccent = counselRole && COUNSEL_ROLE_COLORS[counselRole]
    ? COUNSEL_ROLE_COLORS[counselRole].col
    : '#888888';

  const trackLabel = matterTrack ? MATTER_TRACK_LABELS[matterTrack] : null;

  // Stage 1 shows which drafter is active
  const draftNote = stage.id === 'draft'
    ? (isCriminal
        ? '⚖ Criminal route — FinalAddressEngine active'
        : '§ Civil/FREP route — ArgumentBuilder active')
    : null;

  return (
    <div style={{
      display:      'flex',
      alignItems:   'flex-start',
      justifyContent:'space-between',
      gap:          12,
      marginBottom: 16,
      padding:      '12px 16px',
      background:   `${stage.color}08`,
      border:       `1px solid ${stage.color}30`,
      borderRadius: 7,
      borderLeft:   `3px solid ${stage.color}`,
      flexWrap:     'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16, color: stage.color }}>{stage.icon}</span>
          <div>
            <span style={{
              fontSize:     8,
              color:        stage.color,
              fontFamily:   "'Times New Roman', Times, serif",
              letterSpacing:'.14em',
              textTransform:'uppercase',
              fontWeight:   700,
              display:      'block',
              marginBottom: 1,
            }}>
              {stage.sublabel} — {stage.label}
            </span>
            <span style={{
              fontSize:   13,
              color:      T.sub,
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              {stage.desc}
            </span>
          </div>
        </div>

        {draftNote && (
          <div style={{
            fontSize:   10,
            color:      roleAccent,
            fontFamily: "'Times New Roman', Times, serif",
            marginTop:  4,
            fontStyle:  'italic',
          }}>
            {draftNote}
            {trackLabel && (
              <span style={{
                marginLeft:   8,
                fontSize:     9,
                padding:      '1px 6px',
                borderRadius: 3,
                background:   matterTrack ? MATTER_TRACK_COLORS[matterTrack].bg  : 'transparent',
                border:       matterTrack ? `1px solid ${MATTER_TRACK_COLORS[matterTrack].bdr}` : 'none',
                color:        matterTrack ? MATTER_TRACK_COLORS[matterTrack].col  : T.mute,
                fontStyle:    'normal',
              }}>
                {trackLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Navigation arrows */}
      <div style={{ display: 'flex', gap: 6, alignSelf: 'center', flexShrink: 0 }}>
        {!isFirst && (
          <button
            onClick={onPrev}
            style={{
              background:   T.bg,
              border:       `1px solid ${T.bdr}`,
              borderRadius: 5,
              padding:      '5px 12px',
              fontSize:     11,
              color:        T.mute,
              fontFamily:   "'Times New Roman', Times, serif",
              cursor:       'pointer',
              transition:   'all .15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = stage.color + '50';
              (e.currentTarget as HTMLElement).style.color       = stage.color;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = T.bdr;
              (e.currentTarget as HTMLElement).style.color       = T.mute;
            }}
          >
            ← Prev Stage
          </button>
        )}
        {!isLast && (
          <button
            onClick={onNext}
            style={{
              background:   `${stage.color}12`,
              border:       `1px solid ${stage.color}40`,
              borderRadius: 5,
              padding:      '5px 12px',
              fontSize:     11,
              color:        stage.color,
              fontFamily:   "'Times New Roman', Times, serif",
              cursor:       'pointer',
              transition:   'all .15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background  = `${stage.color}22`;
              (e.currentTarget as HTMLElement).style.borderColor = stage.color;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background  = `${stage.color}12`;
              (e.currentTarget as HTMLElement).style.borderColor = `${stage.color}40`;
            }}
          >
            Next Stage →
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT — WrittenAddressEngine
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

export function WrittenAddressEngine({ activeCase }: Props) {
  const { setDashTab } = useAppStore();

  const [activeStage, setActiveStage] = useState<StageId>('draft');

  const currentStageIndex = STAGES.findIndex(s => s.id === activeStage);
  const currentStage      = STAGES[currentStageIndex];
  const isCriminal        = isCriminalTrack(activeCase);

  const goNext = useCallback(() => {
    const next = STAGES[currentStageIndex + 1];
    if (next) setActiveStage(next.id);
  }, [currentStageIndex]);

  const goPrev = useCallback(() => {
    const prev = STAGES[currentStageIndex - 1];
    if (prev) setActiveStage(prev.id);
  }, [currentStageIndex]);

  const navigate = useCallback((tabId: string) => {
    setDashTab(tabId as DashTabId);
  }, [setDashTab]);

  // ResearchResolver needs an onBack prop — we wire it to stay in the engine
  // (back within the pipeline = go to Stage 1, or simply no-op since we
  //  have our own navigation controls)
  const handleResearchBack = useCallback(() => {
    setActiveStage('draft');
  }, []);

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>

      {/* ── Pipeline progress bar ─────────────────────────────────────────── */}
      <PipelineBar
        activeStage={activeStage}
        onStageClick={setActiveStage}
      />

      {/* ── Stage header ──────────────────────────────────────────────────── */}
      <StageHeader
        stage={currentStage}
        activeCase={activeCase}
        onNext={goNext}
        onPrev={goPrev}
        isFirst={currentStageIndex === 0}
        isLast={currentStageIndex === STAGES.length - 1}
      />

      {/* ── Stage 1 — Draft (track-aware) ────────────────────────────────── */}
      {activeStage === 'draft' && !isCriminal && (
        <ArgumentBuilder activeCase={activeCase} />
      )}
      {activeStage === 'draft' && isCriminal && (
        <FinalAddressEngine activeCase={activeCase} />
      )}

      {/* ── Stage 2 — Research ───────────────────────────────────────────── */}
      {activeStage === 'research' && (
        <ResearchResolver
          activeCase={activeCase}
          onBack={handleResearchBack}
        />
      )}

      {/* ── Stage 3 — Validate ───────────────────────────────────────────── */}
      {activeStage === 'validate' && (
        <AuthorityValidator activeCase={activeCase} />
      )}

      {/* ── Stage 4 — Synthesise ─────────────────────────────────────────── */}
      {activeStage === 'synthesise' && (
        <SynthesisEngine
          activeCase={activeCase}
          onNavigate={navigate}
        />
      )}

    </div>
  );
}
