/**
 * AFS Legal OS — ChecklistSidebar
 * Phase 9 · Grand Build Plan
 *
 * Case-level checklist sidebar. Engine-independent. Accessible from any engine
 * via the case command bar. Persists across the entire case lifecycle.
 *
 * 9A — Fundamentals Layer
 *      Fixed items present on every case regardless of type:
 *      conflict of interest check, KYC, retainer, demand letter / served process,
 *      CAC search where applicable, client authority to proceed.
 *
 * 9B — Case-Specific Layer
 *      Built from intelligence_data after Phase 3 extraction. Items specific
 *      to this case, court, matter type — never generic. Sources:
 *        · s84_flags (Phase 7B)             — one item per electronic document
 *        · commencement_audit findings       — RISK/DEFECTIVE actions
 *        · blind_spot_gate overrides         — items from overridden fatals
 *        · served_process_analysis           — defendant-side prerequisites
 *
 * 9C — Tick System
 *      Each item tickable. Green when done, red when fatal and undone,
 *      amber for advisory. Ticks persisted to case.checklist_ticks via onSave.
 *      Fatal items stay red until ticked — they cannot be hidden.
 *
 * 9D — Laws Needed Integration
 *      Laws Needed list (Phase 3C) lives under its own section.
 *      Items display as open (amber) until resolved. Resolved items
 *      remain visible with a green ✓ for 48h then collapse.
 *
 * USAGE:
 *   <ChecklistSidebar activeCase={activeCase} onSave={onSaveCase} open={open} onClose={() => setOpen(false)} />
 *
 * The sidebar renders as an overlay panel from the right edge. The trigger
 * (a persistent "Checklist" button) lives in CaseDashboard and is always
 * accessible regardless of which engine is active.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import type { Checklist9BItem } from '@/engines/IntelligenceEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemStatus = 'fatal' | 'advisory' | 'info';

interface ChecklistItem {
  id:      string;
  label:   string;
  detail?: string;
  status:  ItemStatus;
  source:  '9A' | '9B';
}

interface ChecklistTicks {
  [itemId: string]: {
    ticked:    boolean;
    ticked_at: string;
  };
}

interface Props {
  activeCase: Case;
  onSave:     (patch: Partial<Case>) => Promise<void>;
  open:       boolean;
  onClose:    () => void;
}

// ── 9A — Fundamentals Layer ───────────────────────────────────────────────────
const FUNDAMENTALS: ChecklistItem[] = [
  {
    id:     '9a_conflict',
    label:  'Conflict of interest check',
    detail: 'Checked all existing clients and matters for conflicts. Confirmed firm can act.',
    status: 'fatal',
    source: '9A',
  },
  {
    id:     '9a_kyc',
    label:  'KYC completed',
    detail: 'Client identity verified. Required AML/KYC documentation obtained and filed.',
    status: 'fatal',
    source: '9A',
  },
  {
    id:     '9a_retainer',
    label:  'Retainer signed',
    detail: 'Written retainer agreement signed by client. Scope, fees, and authority defined.',
    status: 'fatal',
    source: '9A',
  },
  {
    id:     '9a_demand_or_process',
    label:  'Demand letter served / Served process filed',
    detail: 'Commencing side: demand letter sent and served. Receiving side: process formally received and acknowledged.',
    status: 'fatal',
    source: '9A',
  },
  {
    id:     '9a_cac',
    label:  'CAC search conducted (if corporate party)',
    detail: 'Corporate Affairs Commission search obtained for any corporate party to confirm status and directors.',
    status: 'advisory',
    source: '9A',
  },
  {
    id:     '9a_authority',
    label:  'Client authority to proceed confirmed',
    detail: 'Client has given express, informed authority to commence or continue the matter as instructed.',
    status: 'fatal',
    source: '9A',
  },
];

// ── Status colours ─────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<ItemStatus, { dot: string; label: string; border: string; bg: string }> = {
  fatal:    { dot: '#c03030', label: '#c03030', border: '#e8b0b0', bg: '#fff5f5' },
  advisory: { dot: '#c08030', label: '#7a5000', border: '#e8d0a0', bg: '#fffbf0' },
  info:     { dot: '#3a6a9a', label: '#2a4a6a', border: '#b0c8e8', bg: '#f0f5ff' },
};

// ── ChecklistSidebar ──────────────────────────────────────────────────────────

export function ChecklistSidebar({ activeCase, onSave, open, onClose }: Props) {
  // ── Load ticks from case ──────────────────────────────────────────────────
  const [ticks, setTicks] = useState<ChecklistTicks>(
    (activeCase as any).checklist_ticks ?? {},
  );

  // Sync if activeCase changes (e.g. after onSave resolves)
  useEffect(() => {
    setTicks((activeCase as any).checklist_ticks ?? {});
  }, [activeCase.id]);

  // ── Build items ───────────────────────────────────────────────────────────
  const fundamentals = FUNDAMENTALS;

  // Phase 9B — read AI-generated items from intelligence_data
  const intel = activeCase.intelligence_data as any;
  const raw9B: Checklist9BItem[] = intel?.checklist_9b_items ?? [];
  // Map to ChecklistItem shape (source field narrowed to '9B')
  const caseSpecific: ChecklistItem[] = raw9B.map(item => ({
    id:     item.id,
    label:  item.label,
    detail: item.detail,
    status: item.status,
    source: '9B' as const,
  }));

  // Detect whether extraction has run (9B generates alongside extraction)
  const extractionDone = !!intel?.extraction;
  // Detect whether 9B is still generating (set by IntelligenceEngine.checklist9BLoading —
  // we can't read that state here, so we infer: extraction done but 9B empty = may still be running.
  // The sidebar shows a "generating" state in that window.)
  const checklist9BPending = extractionDone && raw9B.length === 0;

  const lawsNeeded: Array<{
    name: string; reason: string; flagged_by: string;
    resolved?: boolean; resolved_at?: string;
  }> = intel?.laws_needed ?? [];

  // ── Tick handler ──────────────────────────────────────────────────────────
  const tick = useCallback(async (id: string) => {
    const already = ticks[id]?.ticked;
    const updated: ChecklistTicks = {
      ...ticks,
      [id]: {
        ticked:    !already,
        ticked_at: new Date().toISOString(),
      },
    };
    setTicks(updated);
    await onSave({ checklist_ticks: updated } as any);
  }, [ticks, onSave]);

  // ── Summary counts ────────────────────────────────────────────────────────
  const allItems        = [...fundamentals, ...caseSpecific];
  const totalFatal      = allItems.filter(i => i.status === 'fatal').length;
  const doneFatal       = allItems.filter(i => i.status === 'fatal' && ticks[i.id]?.ticked).length;
  const totalAdvisory   = allItems.filter(i => i.status === 'advisory').length;
  const doneAdvisory    = allItems.filter(i => i.status === 'advisory' && ticks[i.id]?.ticked).length;
  const openLaws        = lawsNeeded.filter(e => !e.resolved).length;

  // ── 9C — All-clear gate ───────────────────────────────────────────────────
  // True when every fatal item is ticked AND no open laws remain.
  // Advisory items do not block — they colour amber until ticked.
  const allFatalCleared = totalFatal > 0 && doneFatal === totalFatal && openLaws === 0;
  // Partially clear = all fatals done but laws still open
  const fatalsCleared   = totalFatal > 0 && doneFatal === totalFatal;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          zIndex: 900, animation: 'fadeIn .15s ease',
        }}
      />

      {/* Panel */}
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn        { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeUp        { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin          { to { transform: rotate(360deg); } }
        .chk-item-fatal-open  { border-left: 3px solid #c03030 !important; }
        .chk-item-advisory-open { border-left: 3px solid #c08030 !important; }
      `}</style>
      <div style={{
        position:   'fixed',
        top:        0,
        right:      0,
        bottom:     0,
        width:      Math.min(420, window.innerWidth - 24),
        background: '#ffffff',
        borderLeft: '1px solid #cccccc',
        zIndex:     901,
        display:    'flex',
        flexDirection: 'column',
        animation:  'slideInRight .2s cubic-bezier(.25,.46,.45,.94)',
        overflowY:  'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding:      '16px 20px',
          borderBottom: '1px solid #e8e8e8',
          flexShrink:   0,
          background:   '#fafafa',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p style={{ fontSize: 8, color: '#888888', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                Phase 9 · Checklist Sidebar
              </p>
              <p style={{ fontSize: 18, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, marginBottom: 4 }}>
                Case Checklist
              </p>
              <p style={{ fontSize: 11, color: '#888888', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                {activeCase.caseName}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: '1px solid #cccccc', color: '#888888', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
              ✕
            </button>
          </div>

          {/* ── 9C — Summary strip ──────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {/* Fatal badge */}
            <span style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 2,
              fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
              letterSpacing: '.08em', textTransform: 'uppercase',
              background: fatalsCleared ? '#e8f5ee' : doneFatal > 0 ? '#fff8e8' : '#fff0f0',
              border: `1px solid ${fatalsCleared ? '#a8d0b8' : doneFatal > 0 ? '#e0c870' : '#e8b0b0'}`,
              color:   fatalsCleared ? '#1a5a30' : doneFatal > 0 ? '#7a5000' : '#8a1a1a',
            }}>
              {fatalsCleared ? '✓' : `${doneFatal}/${totalFatal}`} fatal{totalFatal !== 1 ? 's' : ''}
            </span>
            {/* Advisory badge */}
            {totalAdvisory > 0 && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 2,
                fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                letterSpacing: '.08em', textTransform: 'uppercase',
                background: doneAdvisory === totalAdvisory ? '#e8f5ee' : '#fffbf0',
                border: `1px solid ${doneAdvisory === totalAdvisory ? '#a8d0b8' : '#e8d0a0'}`,
                color:   doneAdvisory === totalAdvisory ? '#1a5a30' : '#7a5000',
              }}>
                {doneAdvisory}/{totalAdvisory} advisory
              </span>
            )}
            {/* Laws needed badge */}
            {openLaws > 0 && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 2,
                fontFamily: "'Times New Roman', Times, serif", fontWeight: 700,
                letterSpacing: '.08em', textTransform: 'uppercase',
                background: '#fff8e0', border: '1px solid #e0c870', color: '#7a5000',
              }}>
                {openLaws} law{openLaws !== 1 ? 's' : ''} needed
              </span>
            )}
          </div>

          {/* ── 9C — All-clear banner ───────────────────────────────────── */}
          {allFatalCleared && (
            <div style={{
              marginTop: 10,
              padding: '8px 12px',
              background: '#e8f5ee',
              border: '1px solid #a8d0b8',
              borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 8,
              animation: 'fadeUp .25s ease',
            }}>
              <span style={{ fontSize: 14, color: '#1a5a30', flexShrink: 0 }}>✓</span>
              <div>
                <p style={{
                  fontSize: 11, color: '#1a5a30',
                  fontFamily: "'Times New Roman', Times, serif",
                  fontWeight: 700, marginBottom: 1,
                }}>
                  All required items cleared
                </p>
                <p style={{
                  fontSize: 10, color: '#3a7a50',
                  fontFamily: "'Times New Roman', Times, serif",
                  fontStyle: 'italic',
                }}>
                  Matter is procedurally ready to advance
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 24px' }}>

          {/* ── 9A — Fundamentals Layer ─────────────────────────────────── */}
          <SectionHeader label="9A · Fundamentals" detail="Fixed on every case — conflict, KYC, retainer, authority" />
          <div style={{ padding: '0 16px' }}>
            {fundamentals.map(item => (
              <CheckItem
                key={item.id}
                item={item}
                ticked={!!ticks[item.id]?.ticked}
                tickedAt={ticks[item.id]?.ticked_at}
                onTick={() => tick(item.id)}
              />
            ))}
          </div>

          {/* ── 9B — Case-Specific Layer ─────────────────────────────────── */}
          <SectionHeader
            label="9B · Case-Specific"
            detail={
              !extractionDone
                ? 'Generated after extraction — run Intelligence Engine first'
                : checklist9BPending
                  ? 'Generating case-specific items…'
                  : caseSpecific.length > 0
                    ? `${caseSpecific.length} item${caseSpecific.length !== 1 ? 's' : ''} generated from pipeline`
                    : 'No case-specific items identified for this matter'
            }
          />
          <div style={{ padding: '0 16px' }}>
            {!extractionDone ? (
              <p style={{ fontSize: 12, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', padding: '8px 0 12px' }}>
                No case-specific items yet. Complete Phase 3 extraction in the Intelligence Engine to generate items specific to this case, court, and matter type.
              </p>
            ) : checklist9BPending ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 14px' }}>
                <div style={{
                  width: 14, height: 14, border: '2px solid #cccccc',
                  borderTopColor: '#888888', borderRadius: '50%',
                  animation: 'spin .8s linear infinite', flexShrink: 0,
                }} />
                <p style={{ fontSize: 12, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                  Generating case-specific checklist from extraction results…
                </p>
              </div>
            ) : caseSpecific.length === 0 ? (
              <p style={{ fontSize: 12, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', padding: '8px 0 12px' }}>
                No specific action items identified for this matter. The pipeline found no outstanding pre-action, procedural, or evidentiary requirements.
              </p>
            ) : (
              caseSpecific.map(item => (
                <CheckItem
                  key={item.id}
                  item={item}
                  ticked={!!ticks[item.id]?.ticked}
                  tickedAt={ticks[item.id]?.ticked_at}
                  onTick={() => tick(item.id)}
                  sourceTag={raw9B.find(r => r.id === item.id)?.source}
                />
              ))
            )}
          </div>

          {/* ── 9D — Laws Needed Integration ─────────────────────────────── */}
          <Laws9DSection lawsNeeded={lawsNeeded} openLaws={openLaws} />

        </div>

        {/* Footer */}
        <div style={{
          padding:   '10px 20px',
          borderTop: '1px solid #e8e8e8',
          background: '#fafafa',
          flexShrink: 0,
        }}>
          <p style={{ fontSize: 9, color: '#bbbbbb', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em', textAlign: 'center' }}>
            Checklist · Case level · Engine-independent · Persisted to case record
          </p>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ label, detail }: { label: string; detail: string }) {
  return (
    <div style={{
      padding:      '12px 16px 8px',
      borderBottom: '1px solid #f0f0f0',
      marginBottom: 4,
      marginTop:    8,
    }}>
      <p style={{ fontSize: 8, color: '#888888', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>
        {label}
      </p>
      <p style={{ fontSize: 10, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
        {detail}
      </p>
    </div>
  );
}

function CheckItem({
  item, ticked, tickedAt, onTick, sourceTag,
}: {
  item:      ChecklistItem;
  ticked:    boolean;
  tickedAt?: string;
  onTick:    () => void;
  sourceTag?: string;  // 9B items carry a human-readable source (e.g. 'Section 84', 'ADR certificate')
}) {
  const [expanded, setExpanded] = useState(false);
  const sc = STATUS_COLOR[item.status];
  const borderColor  = ticked ? '#a8d0b8' : sc.border;
  const bgColor      = ticked ? '#f0faf4' : sc.bg;
  // 9C — left accent: fatal unticked = red bar, advisory unticked = amber bar, done = none
  const leftAccent   = ticked
    ? 'none'
    : item.status === 'fatal'
      ? '3px solid #c03030'
      : item.status === 'advisory'
        ? '3px solid #c08030'
        : 'none';

  return (
    <div style={{
      border:       `1px solid ${borderColor}`,
      borderLeft:   leftAccent !== 'none' ? leftAccent : `1px solid ${borderColor}`,
      borderRadius: 5,
      padding:      '10px 12px',
      marginBottom: 6,
      background:   bgColor,
      transition:   'all .15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Tick box */}
        <button
          onClick={onTick}
          title={ticked ? 'Mark undone' : 'Mark done'}
          style={{
            width:        18,
            height:       18,
            borderRadius: 3,
            border:       `2px solid ${ticked ? '#2a8a4a' : sc.dot}`,
            background:   ticked ? '#2a8a4a' : 'transparent',
            color:        '#ffffff',
            fontSize:     11,
            cursor:       'pointer',
            flexShrink:   0,
            marginTop:    1,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            fontWeight:   700,
            transition:   'all .12s',
          }}>
          {ticked ? '✓' : ''}
        </button>

        {/* Label and meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
            <p style={{
              fontSize:   12,
              color:      ticked ? '#3a6a4a' : sc.label,
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: item.status === 'fatal' && !ticked ? 600 : 400,
              lineHeight: 1.4,
              textDecoration: ticked ? 'line-through' : 'none',
              flex:       1,
            }}>
              {item.label}
            </p>
            {/* Status badge — only show for fatal and only when not ticked */}
            {item.status === 'fatal' && !ticked && (
              <span style={{
                fontSize:    8,
                color:       '#c03030',
                fontFamily:  "'Times New Roman', Times, serif",
                fontWeight:  700,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                border:      '1px solid #e8b0b0',
                background:  '#fff5f5',
                borderRadius: 2,
                padding:     '1px 5px',
                flexShrink:  0,
                whiteSpace:  'nowrap',
              }}>
                Required
              </span>
            )}
          </div>

          {/* Source badge for 9B items */}
          {sourceTag && (
            <p style={{
              fontSize: 9, color: '#aaaaaa',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.04em', marginTop: 2,
            }}>
              {sourceTag}
            </p>
          )}

          {/* Detail toggle */}
          {item.detail && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 3 }}>
              <p style={{ fontSize: 9, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
                {expanded ? '▲ hide' : '▼ detail'}
              </p>
            </button>
          )}
          {expanded && item.detail && (
            <p style={{ fontSize: 11, color: '#666666', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.55, marginTop: 4, paddingTop: 4, borderTop: '1px solid #e8e8e8' }}>
              {item.detail}
            </p>
          )}

          {/* Ticked-at timestamp */}
          {ticked && tickedAt && (
            <p style={{ fontSize: 9, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", marginTop: 2 }}>
              ✓ {new Date(tickedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 9D — Laws Needed Section ──────────────────────────────────────────────────
// Implements the full 9D spec:
//   - Open items always visible, amber accent, expandable reason, impact statement
//   - Resolved items visible for 48h after resolution (then collapsed by default)
//   - "Show resolved" toggle surfaces items collapsed past 48h
//   - Permanent reminder of what the engine is working without
function Laws9DSection({ lawsNeeded, openLaws }: {
  lawsNeeded: Array<{
    name: string; reason: string; flagged_by: string;
    flagged_at?: string; resolved?: boolean; resolved_at?: string;
  }>;
  openLaws: number;
}) {
  const [showResolved, setShowResolved] = useState(false);

  const now = Date.now();
  const FORTY_EIGHT_H = 48 * 60 * 60 * 1000;

  const openItems = lawsNeeded.filter(l => !l.resolved);
  const resolvedItems = lawsNeeded.filter(l => l.resolved);

  // Resolved items within 48h — show by default
  const recentResolved = resolvedItems.filter(l =>
    l.resolved_at && (now - new Date(l.resolved_at).getTime()) < FORTY_EIGHT_H
  );
  // Resolved items older than 48h — hidden unless showResolved is toggled
  const oldResolved = resolvedItems.filter(l =>
    !l.resolved_at || (now - new Date(l.resolved_at).getTime()) >= FORTY_EIGHT_H
  );

  const visibleResolved = showResolved ? resolvedItems : recentResolved;
  const hiddenCount = oldResolved.length;

  const detail = openLaws > 0
    ? `${openLaws} open — engine reasoning is limited without these`
    : lawsNeeded.length > 0
      ? 'All laws retrieved from library'
      : 'No laws flagged yet';

  return (
    <>
      <SectionHeader label="9D · Laws Needed" detail={detail} />
      <div style={{ padding: '0 16px' }}>
        {lawsNeeded.length === 0 ? (
          <p style={{ fontSize: 12, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', padding: '8px 0 12px' }}>
            No laws flagged yet. Laws the engine identifies as required but absent from the library will appear here as a permanent reminder of what the analysis is working without.
          </p>
        ) : (
          <>
            {/* Open items — always visible */}
            {openItems.length === 0 && visibleResolved.length === 0 && hiddenCount === 0 && (
              <p style={{ fontSize: 12, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', padding: '8px 0 12px' }}>
                All laws resolved.
              </p>
            )}
            {openItems.map((law, i) => (
              <LawNeededItem key={`open_${i}`} law={law} />
            ))}

            {/* Recently resolved items (within 48h) */}
            {recentResolved.length > 0 && (
              <>
                {recentResolved.map((law, i) => (
                  <LawNeededItem key={`recent_${i}`} law={law} />
                ))}
              </>
            )}

            {/* Show resolved toggle — for items older than 48h */}
            {hiddenCount > 0 && (
              <button
                onClick={() => setShowResolved(s => !s)}
                style={{
                  background: 'none', border: 'none', padding: '4px 0 10px',
                  cursor: 'pointer', display: 'block',
                }}>
                <p style={{
                  fontSize: 9, color: '#aaaaaa',
                  fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.04em',
                }}>
                  {showResolved
                    ? `▲ hide resolved (${hiddenCount})`
                    : `▼ show ${hiddenCount} resolved law${hiddenCount !== 1 ? 's' : ''}`}
                </p>
              </button>
            )}

            {/* Old resolved items — shown when toggle is on */}
            {showResolved && oldResolved.map((law, i) => (
              <LawNeededItem key={`old_${i}`} law={law} />
            ))}

            {/* Impact summary — when laws are open */}
            {openLaws > 0 && (
              <div style={{
                marginTop: 8, padding: '8px 10px',
                background: '#fff8e8', border: '1px solid #e0c870',
                borderRadius: 4,
              }}>
                <p style={{
                  fontSize: 10, color: '#7a5000',
                  fontFamily: "'Times New Roman', Times, serif",
                  lineHeight: 1.55,
                }}>
                  ⚑ The engine is reasoning without {openLaws} law{openLaws !== 1 ? 's' : ''}. Upload to the library and re-run the relevant phase to resolve. Every downstream engine inherits these gaps from the locked CaseTheoryRecord.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function LawNeededItem({ law }: {
  law: {
    name: string; reason: string; flagged_by: string;
    flagged_at?: string; resolved?: boolean; resolved_at?: string;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const resolved = !!law.resolved;

  // Phase label — clean up the raw flagged_by string
  const phaseLabel = law.flagged_by
    ?.replace('Phase 3A Extraction',           'Phase 3A · Extraction')
    ?.replace('Phase 4A Commencement Audit',   'Phase 4A · Commencement Audit')
    ?.replace('Phase 4B Defence Audit',        'Phase 4B · Defence Audit')
    ?.replace('Phase 6A Blind Spot Audit',     'Phase 6A · Blind Spot Audit')
    ?.replace('Phase 7A Evidence Mapping',     'Phase 7A · Evidence Matrix')
    ?? law.flagged_by;

  // Impact — what the engine cannot fully assess without this law
  const impactMap: Record<string, string> = {
    'Phase 3A · Extraction':          'Extraction reasoning is incomplete without this statute',
    'Phase 4A · Commencement Audit':  'Commencement audit findings may be inaccurate without this law',
    'Phase 4B · Defence Audit':       'Defence audit and preliminary objection analysis is limited',
    'Phase 6A · Blind Spot Audit':    'Blind spot audit may have missed findings grounded in this law',
    'Phase 7A · Evidence Matrix':     'Evidence matrix may be missing admissibility requirements from this law',
  };
  const impact = impactMap[phaseLabel] ?? `Engine reasoning grounded in this law is incomplete`;

  return (
    <div style={{
      border:       `1px solid ${resolved ? '#a8d0b8' : '#e0c870'}`,
      borderLeft:   resolved ? `1px solid #a8d0b8` : `3px solid #c08030`,
      borderRadius: 5,
      padding:      '9px 12px',
      marginBottom: 6,
      background:   resolved ? '#f0faf4' : '#fffbf0',
      transition:   'all .15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 10, marginTop: 2, flexShrink: 0, color: resolved ? '#2a8a4a' : '#c08030' }}>
          {resolved ? '✓' : '⚑'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name */}
          <p style={{
            fontSize:       12,
            color:          resolved ? '#3a6a4a' : '#5a3a00',
            fontFamily:     "'Times New Roman', Times, serif",
            fontWeight:     600,
            lineHeight:     1.4,
            textDecoration: resolved ? 'line-through' : 'none',
          }}>
            {law.name}
          </p>

          {/* Impact statement — always visible when open */}
          {!resolved && (
            <p style={{
              fontSize:   10,
              color:      '#8a5a00',
              fontFamily: "'Times New Roman', Times, serif",
              fontStyle:  'italic',
              lineHeight: 1.4,
              marginTop:  3,
            }}>
              {impact}
            </p>
          )}

          {/* Reason — expandable */}
          {!resolved && law.reason && (
            <>
              <button
                onClick={() => setExpanded(e => !e)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 4 }}>
                <p style={{
                  fontSize: 9, color: '#aaaaaa',
                  fontFamily: "'Times New Roman', Times, serif",
                  letterSpacing: '.04em',
                }}>
                  {expanded ? '▲ hide reason' : '▼ why needed'}
                </p>
              </button>
              {expanded && (
                <p style={{
                  fontSize:   11,
                  color:      '#7a5a20',
                  fontFamily: "'Times New Roman', Times, serif",
                  lineHeight: 1.55,
                  marginTop:  4,
                  paddingTop: 4,
                  borderTop:  '1px solid #e8d0a0',
                }}>
                  {law.reason}
                </p>
              )}
            </>
          )}

          {/* Footer meta */}
          <p style={{ fontSize: 9, color: '#aaaaaa', fontFamily: "'Times New Roman', Times, serif", marginTop: 4 }}>
            {resolved
              ? `Resolved ${law.resolved_at
                  ? new Date(law.resolved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                  : ''} · ${phaseLabel}`
              : `${phaseLabel} · Upload to library to resolve`}
          </p>
        </div>
      </div>
    </div>
  );
}
