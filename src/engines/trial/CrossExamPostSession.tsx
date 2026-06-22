/**
 * AFS Legal OS — CrossExamPostSession
 * Phase 5A: Post-session Contradiction Mapper auto-feed
 *
 * BUILD ORDER:
 *   1. src/types/crossExam.ts              (CrossExamSessionRecord, SessionStep,
 *                                           CrossExamTreeRecord, CrossExamNode)
 *   2. src/storage/crossExamHelpers.ts     (loadUnfedSessions, markSessionFed,
 *                                           loadWitnessTrees)
 *   3. src/storage/helpers.ts              (loadBlindSpot, saveBlindSpot, uid)
 *   4. THIS FILE
 *
 * ─── PURPOSE ────────────────────────────────────────────────────────────────
 *
 * After a session ends or is manually closed, this module:
 *
 *   1. Reads all sessions for this case where fedToContradictionMapper === false
 *      and endedAt is set (i.e. closed but not yet processed).
 *
 *   2. For each unfed session, collects every SessionStep where
 *      contradictionFired === true. These are steps where the witness gave
 *      an answer that diverged from the node's expectedAnswer and the
 *      pre-built detour fired (Phase 4D live write path).
 *
 *   3. Loads the relevant CrossExamTreeRecords to retrieve per-node context:
 *      - expectedAnswer / expectedAnswerSource (stmt1 / stmt1Src)
 *      - contradictionDetour.putToYouQuestion + citationRef (impact)
 *      - credibilityQuestion (additional notes)
 *
 *   4. Loads the existing cx_contradictions list from blind_spots (the same
 *      key used by CXContradictionMapper in CrossExamEngine.tsx).
 *
 *   5. Deduplicates: an entry is considered a duplicate if any existing record's
 *      notes field starts with the sentinel `[AUTO:${sessionId}:${nodeId}]`.
 *      This is stable across re-renders and repeated calls.
 *
 *   6. Appends any net-new records and saves the merged list back via
 *      saveBlindSpot(caseId, 'contradictions', merged).
 *
 *   7. Calls markSessionFed(sessionId) for each processed session so this
 *      operation is idempotent — reloading the app, crashing mid-feed, or
 *      calling runPostSessionFeed multiple times is safe.
 *
 * ─── DEDUP SENTINEL FORMAT ───────────────────────────────────────────────────
 *
 *   Every auto-fed ContradictionRecord has a notes field prefixed with:
 *     [AUTO:{sessionId}:{nodeId}] {original notes if any}
 *
 *   The dedup check scans existing records for this prefix. Manually-entered
 *   records (from the CXContradictionMapper UI) never carry this prefix and
 *   are never overwritten or removed.
 *
 * ─── PHASE 4D RELATIONSHIP ───────────────────────────────────────────────────
 *
 *   Phase 4D writes a contradiction entry LIVE (immediately at the moment the
 *   detour fires) using the same cx_contradictions key. This Phase 5A feed is
 *   the *bulk reconciliation pass* run after the session closes — it catches
 *   any steps that Phase 4D missed (e.g. app crash before live write completed)
 *   and does not duplicate entries Phase 4D already wrote successfully.
 *
 * ─── EXPORTED SURFACE ────────────────────────────────────────────────────────
 *
 *   runPostSessionFeed(caseId)           — standalone async function; call from
 *                                          anywhere (session end callback, page
 *                                          focus, manual retry button).
 *
 *   CrossExamPostSession                 — React component. Mounts silently,
 *                                          auto-runs on mount and whenever
 *                                          triggerSessionId changes. Renders a
 *                                          status strip when running or when
 *                                          results are available; renders nothing
 *                                          when idle.
 *
 * ─── CONSUMED BY ─────────────────────────────────────────────────────────────
 *
 *   CrossExamSessionManager — pass onSessionEnd → triggerSessionId
 *   CrossExamEngine (Contradiction Mapper tab) — may mount for manual retry
 *   Phase 5B printable backup — called from within this file after feed
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { T } from '@/constants/tokens';
import {
  loadUnfedSessions,
  markSessionFed,
  loadWitnessTrees,
} from '@/storage/crossExamHelpers';
import { loadBlindSpot, saveBlindSpot, uid } from '@/storage/helpers';
import type {
  CrossExamSessionRecord,
  CrossExamTreeRecord,
  CrossExamNode,
  SessionStep,
} from '@/types/crossExam';

// ─────────────────────────────────────────────────────────────────────────────
// Mirrored interface — matches ContradictionRecord in CrossExamEngine.tsx.
// Both sides read/write cx_contradictions via the same blind_spot key.
// If the canonical definition moves to types/index.ts, remove this mirror.
// ─────────────────────────────────────────────────────────────────────────────

interface ContradictionRecord {
  id:       string;
  witness:  string;
  stmt1:    string;   // what the witness was expected to say / original position
  stmt1Src: string;   // citation source for stmt1
  stmt2:    string;   // what the witness actually said (the contradiction)
  stmt2Src: string;   // "Session log — <ISO timestamp>"
  impact:   string;   // detour putToYouQuestion + credibilityQuestion
  notes:    string;   // [AUTO:sessionId:nodeId] sentinel + counsel notes
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSentinel(sessionId: string, nodeId: string): string {
  return `[AUTO:${sessionId}:${nodeId}]`;
}

function hasSentinel(notes: string, sessionId: string, nodeId: string): boolean {
  return notes.startsWith(makeSentinel(sessionId, nodeId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree index — keyed by (witnessId → Record<nodeId, treeRecord>)
// Lets us look up node context in O(1) across multiple trees / topics.
// ─────────────────────────────────────────────────────────────────────────────

type NodeIndex = Map<string, {
  tree:     CrossExamTreeRecord;
  topicId:  string;
}>;

function buildNodeIndex(trees: CrossExamTreeRecord[]): NodeIndex {
  const index: NodeIndex = new Map();
  for (const tree of trees) {
    for (const nodeId of Object.keys(tree.nodes)) {
      index.set(nodeId, { tree, topicId: tree.topicId });
    }
  }
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build one ContradictionRecord from a SessionStep + tree context
// ─────────────────────────────────────────────────────────────────────────────

function buildContradictionRecord(
  step:      SessionStep,
  session:   CrossExamSessionRecord,
  nodeIndex: NodeIndex,
  witnessLabel: string,
): ContradictionRecord | null {
  const entry = nodeIndex.get(step.nodeId);
  const node  = entry?.tree.nodes[step.nodeId];

  // stmt1 — what the witness was committed to / expected to say
  const stmt1    = node?.question ?? step.questionSnapshot;
  const stmt1Src = node?.expectedAnswerSource ?? 'Witness statement / established facts';

  // stmt2 — the divergent answer that triggered the contradiction
  const givenAnswer = step.answer;
  const expected    = node?.expectedAnswer;
  const stmt2 = expected
    ? `Witness answered ${givenAnswer} (expected: ${expected}). Question: "${step.questionSnapshot}"`
    : `Witness answered ${givenAnswer}. Question: "${step.questionSnapshot}"`;
  const stmt2Src = `Session log — ${step.loggedAt}`;

  // impact — detour questions if pre-built, else generic note
  let impact = '';
  const detour = node?.contradictionDetour;
  if (detour) {
    impact = `Put to witness: "${detour.putToYouQuestion}"\n\nCredibility challenge: "${detour.credibilityQuestion}"`;
    if (detour.citationRef) {
      impact = `Citation: ${detour.citationRef}\n\n` + impact;
    }
  } else {
    impact = 'Contradiction detected during cross-examination. Review session log for context.';
  }

  // notes — sentinel + any counsel notes on this step
  const sentinel = makeSentinel(session.id, step.nodeId);
  const notes    = step.notes
    ? `${sentinel} ${step.notes}`
    : sentinel;

  return {
    id:       uid(),
    witness:  witnessLabel,
    stmt1,
    stmt1Src,
    stmt2,
    stmt2Src,
    impact,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core feed logic — one session
// ─────────────────────────────────────────────────────────────────────────────

async function feedOneSession(
  session:    CrossExamSessionRecord,
  allTrees:   Map<string, CrossExamTreeRecord[]>,  // witnessId → trees
  existing:   ContradictionRecord[],
  witnessLabels: Map<string, string>,              // witnessId → display name
): Promise<ContradictionRecord[]> {
  const { witnessId } = session;

  // Collect fired steps across all topics
  const firedSteps: SessionStep[] = Object.values(session.topicStates).flatMap(
    ts => ts.completedSteps.filter(s => s.contradictionFired),
  );

  if (firedSteps.length === 0) return [];

  // Build node lookup for this witness
  const trees     = allTrees.get(witnessId) ?? [];
  const nodeIndex = buildNodeIndex(trees);
  const label     = witnessLabels.get(witnessId) ?? witnessId;

  const newRecords: ContradictionRecord[] = [];

  for (const step of firedSteps) {
    // Dedup check — skip if this (sessionId, nodeId) pair is already present
    const alreadyPresent = existing.some(r =>
      hasSentinel(r.notes, session.id, step.nodeId),
    );
    if (alreadyPresent) continue;

    // Also skip if an identical Phase 4D live write is already present
    // (Phase 4D writes with the same sentinel via the same helper)
    const rec = buildContradictionRecord(step, session, nodeIndex, label);
    if (rec) newRecords.push(rec);
  }

  return newRecords;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: runPostSessionFeed
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedResult {
  sessionsProcessed: number;
  newEntries:        number;
  errors:            string[];
}

/**
 * Standalone async function. Safe to call multiple times — idempotent.
 * Returns a summary of what happened.
 *
 * witnessLabels: optional map from witnessId → display name for the
 * Contradiction Mapper "witness" field. When omitted, witnessId is used.
 */
export async function runPostSessionFeed(
  caseId:        string,
  witnessLabels: Map<string, string> = new Map(),
): Promise<FeedResult> {
  const result: FeedResult = { sessionsProcessed: 0, newEntries: 0, errors: [] };

  try {
    // 1. Load all unfed sessions for this case
    const unfed = await loadUnfedSessions(caseId);
    if (unfed.length === 0) return result;

    // 2. Load existing contradiction records (may be empty)
    const existing: ContradictionRecord[] =
      (await loadBlindSpot<ContradictionRecord[]>(caseId, 'contradictions', [])) ?? [];

    // 3. Pre-load trees for all witnesses that appear in unfed sessions —
    //    one Dexie query per unique witnessId, then cache.
    const uniqueWitnessIds = [...new Set(unfed.map(s => s.witnessId))];
    const treeCache = new Map<string, CrossExamTreeRecord[]>();
    await Promise.all(
      uniqueWitnessIds.map(async wid => {
        try {
          const trees = await loadWitnessTrees(caseId, wid);
          treeCache.set(wid, trees);
        } catch (e) {
          result.errors.push(`Could not load trees for witness ${wid}: ${String(e)}`);
          treeCache.set(wid, []);
        }
      }),
    );

    // 4. Process sessions in chronological order (oldest first so Dexie
    //    writes for early sessions don't block later ones)
    const sorted = [...unfed].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    // Running accumulator — grows as we add records from each session
    let accumulated = [...existing];

    for (const session of sorted) {
      try {
        const newRecords = await feedOneSession(
          session,
          treeCache,
          accumulated,
          witnessLabels,
        );

        if (newRecords.length > 0) {
          accumulated = [...accumulated, ...newRecords];
          result.newEntries += newRecords.length;
        }

        // Mark as fed even if zero new records — prevents repeated processing
        await markSessionFed(session.id);
        result.sessionsProcessed += 1;
      } catch (e) {
        result.errors.push(
          `Session ${session.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        // Continue with remaining sessions — a single session failure should
        // not block others
      }
    }

    // 5. Write the merged list back once (not per-session — fewer Dexie writes)
    if (result.newEntries > 0) {
      await saveBlindSpot(caseId, 'contradictions', accumulated);
    }
  } catch (e) {
    result.errors.push(`Feed failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// React component — mounts silently, shows status strip when active
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamPostSessionProps {
  caseId: string;

  /**
   * Pass the sessionId from onSessionEnd to trigger a feed run.
   * When this value changes (including on first mount when it's non-null),
   * the feed runs automatically.
   * Passing null or undefined on first mount still triggers a sweep for any
   * unfed sessions left over from previous app sessions / crashes.
   */
  triggerSessionId?: string | null;

  /**
   * Optional map from witnessId → display name.
   * Used to populate the "witness" field in Contradiction Mapper entries.
   * Build from the cx_witnesses list: new Map(witnesses.map(w => [w.id, w.name]))
   */
  witnessLabels?: Map<string, string>;

  /** Called when the feed completes. Receives the number of new entries added. */
  onComplete?: (newCount: number) => void;
}

type FeedStatus = 'idle' | 'running' | 'done' | 'error';

export function CrossExamPostSession({
  caseId,
  triggerSessionId,
  witnessLabels,
  onComplete,
}: CrossExamPostSessionProps) {
  const [status,   setStatus]   = useState<FeedStatus>('idle');
  const [newCount, setNewCount] = useState(0);
  const [errors,   setErrors]   = useState<string[]>([]);

  // Prevent concurrent runs if triggerSessionId fires rapidly
  const runningRef = useRef(false);
  const labelsRef  = useRef(witnessLabels ?? new Map<string, string>());
  labelsRef.current = witnessLabels ?? new Map();

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('running');
    setErrors([]);

    try {
      const result = await runPostSessionFeed(caseId, labelsRef.current);
      setNewCount(result.newEntries);
      setErrors(result.errors);
      setStatus(result.errors.length > 0 ? 'error' : 'done');
      onComplete?.(result.newEntries);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setStatus('error');
    } finally {
      runningRef.current = false;
    }
  }, [caseId, onComplete]);

  // Run on mount (catches crashes / previously unfed sessions)
  // and whenever triggerSessionId changes (new session just ended)
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, triggerSessionId]);

  // ── Render — only visible when running, done with results, or errored ──────

  if (status === 'idle') return null;

  if (status === 'running') {
    return (
      <div style={styles.strip}>
        <span style={styles.spinner} aria-hidden>⏳</span>
        <span style={{ ...styles.label, color: T.mute }}>
          Syncing session log to Contradiction Mapper…
        </span>
      </div>
    );
  }

  if (status === 'done' && newCount === 0 && errors.length === 0) {
    // No new entries, no errors — nothing to show
    return null;
  }

  if (status === 'done') {
    return (
      <div style={{ ...styles.strip, background: '#1a2a1a' }}>
        <span aria-hidden>✓</span>
        <span style={{ ...styles.label, color: '#6abf6a' }}>
          {newCount === 0
            ? 'Contradiction Mapper already up to date.'
            : `${newCount} contradiction${newCount === 1 ? '' : 's'} added to Contradiction Mapper.`}
        </span>
      </div>
    );
  }

  // status === 'error'
  return (
    <div style={{ ...styles.strip, background: '#2a1a1a', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden>⚠</span>
        <span style={{ ...styles.label, color: '#e07070' }}>
          Contradiction Mapper feed — {errors.length} error{errors.length > 1 ? 's' : ''}
        </span>
        <button
          onClick={run}
          style={styles.retryBtn}
          aria-label="Retry feed"
        >
          Retry
        </button>
      </div>
      {errors.map((err, i) => (
        <div key={i} style={styles.errorLine}>{err}</div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  strip: {
    display:        'flex',
    alignItems:     'center',
    gap:            8,
    padding:        '8px 14px',
    borderRadius:   6,
    background:     '#1a1a1a',
    border:         `1px solid ${T.border ?? '#2a2a2a'}`,
    marginBottom:   10,
    fontFamily:     'Inter, sans-serif',
    fontSize:       12,
  } as React.CSSProperties,

  spinner: {
    fontSize: 13,
    lineHeight: 1,
  } as React.CSSProperties,

  label: {
    fontFamily: 'Inter, sans-serif',
    fontSize:   12,
    color:      T.mute,
  } as React.CSSProperties,

  retryBtn: {
    marginLeft:     4,
    padding:        '2px 10px',
    borderRadius:   4,
    border:         '1px solid #e07070',
    background:     'transparent',
    color:          '#e07070',
    fontFamily:     'Inter, sans-serif',
    fontSize:       11,
    cursor:         'pointer',
    minHeight:      28,
    minWidth:       48,
  } as React.CSSProperties,

  errorLine: {
    fontFamily: 'Inter, sans-serif',
    fontSize:   11,
    color:      '#e07070',
    paddingLeft: 20,
    opacity:    0.8,
  } as React.CSSProperties,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 5B — Printable paper backup
// ═════════════════════════════════════════════════════════════════════════════
//
// One printable page per topic-tree, rendered via printSide.
// Counsel prints before court as a paper fallback — works fully offline.
//
// Entry point:  printTreeBackup(tree, caseName, witnessName)
// React surface: <CrossExamPrintButton> — one per topic, or "Print all"
//
// TEXT RENDERER
// ─────────────────────────────────────────────────────────────────────────────
// The tree is a directed graph (branches can converge). The renderer does a
// depth-first walk from rootNodeId, tracking visited node ids to prevent
// infinite loops at convergence points. When a node has already been rendered,
// it emits a back-reference line instead of re-expanding the subtree.
//
// Visual conventions (plain text — readable in court):
//   [OPENER]      [ESCALATION]    [CLIMAX ★]    [RECOVERY]    [CONTRADICTION]
//   YES →         NO →
//   ✓ ADMISSION REACHED          ✗ CONTENT EXHAUSTED
//   ⚡ CONTRADICTION DETOUR       → REJOIN: <question snippet>
//
// Each node shows:
//   Tier tag, question text, expected answer + source (if set), purpose tag,
//   contradiction detour (citation → put-to-you → credibility), YES/NO branches.
// ─────────────────────────────────────────────────────────────────────────────

import { printSide } from '@/utils/printSide';

// ── Tier labels ───────────────────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  opener:        'OPENER',
  escalation:    'ESCALATION',
  climax:        'CLIMAX ★',
  recovery:      'RECOVERY',
  contradiction: 'CONTRADICTION',
};

// ── Purpose tag ───────────────────────────────────────────────────────────────

function purposeTag(purpose: CrossExamNode['purpose']): string {
  if (purpose.kind === 'theory_element')    return `[Theory: ${purpose.elementLabel}]`;
  if (purpose.kind === 'opposing_weakness') return `[Weakness: ${purpose.weaknessLabel}]`;
  return '';
}

// ── Single-node text block ────────────────────────────────────────────────────

function renderNodeBlock(
  node:   CrossExamNode,
  indent: string,
  branch: string,   // 'YES → ' | 'NO  → ' | '' (root)
): string {
  const tier  = TIER_LABEL[node.tier] ?? node.tier.toUpperCase();
  const lines: string[] = [];

  // Header line: branch label + tier + question
  lines.push(`${indent}${branch}[${tier}] ${node.question}`);

  // Expected answer + source
  if (node.expectedAnswer) {
    const src = node.expectedAnswerSource ? ` (${node.expectedAnswerSource})` : '';
    lines.push(`${indent}   Expected: ${node.expectedAnswer}${src}`);
  }

  // Purpose
  lines.push(`${indent}   ${purposeTag(node.purpose)}`);

  // Contradiction detour
  if (node.contradictionDetour) {
    const d = node.contradictionDetour;
    lines.push(`${indent}   ⚡ CONTRADICTION DETOUR`);
    if (d.citationRef)         lines.push(`${indent}      Citation:    ${d.citationRef}`);
    lines.push(`${indent}      Put to witness: ${d.putToYouQuestion}`);
    lines.push(`${indent}      Credibility:    ${d.credibilityQuestion}`);
    lines.push(`${indent}      → REJOIN node after detour`);
  }

  // Terminal label
  if (node.terminal) {
    const kind = node.terminalKind === 'admission_reached'
      ? '✓ ADMISSION REACHED — stop here'
      : '✗ CONTENT EXHAUSTED — topic finished';
    lines.push(`${indent}   ${kind}`);
  }

  return lines.join('\n');
}

// ── DFS renderer ─────────────────────────────────────────────────────────────

function renderTreeText(tree: CrossExamTreeRecord): string {
  const { nodes, rootNodeId, polarity, topicLabel, trialReady } = tree;
  const root = nodes[rootNodeId];
  if (!root) return '(tree has no root node)';

  const polarityNote = polarity === 'YES_advances'
    ? 'YES answer advances toward admission'
    : 'NO answer advances toward admission';
  const readyBadge   = trialReady ? '✓ TRIAL-READY' : '⚠ NOT YET TRIAL-READY';

  const header = [
    `Topic: ${topicLabel}`,
    `Polarity: ${polarityNote}   ${readyBadge}`,
    `Generated: ${new Date(tree.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    `${'─'.repeat(72)}`,
    '',
  ].join('\n');

  const visited = new Set<string>();
  const lines: string[] = [];

  function dfs(nodeId: string, indent: string, branch: string): void {
    const node = nodes[nodeId];
    if (!node) {
      lines.push(`${indent}${branch}(missing node: ${nodeId})`);
      return;
    }

    if (visited.has(nodeId)) {
      // Convergence point — back-reference instead of re-expanding
      lines.push(`${indent}${branch}→ [see above: "${node.question.slice(0, 60)}…"]`);
      return;
    }
    visited.add(nodeId);

    lines.push(renderNodeBlock(node, indent, branch));

    if (!node.terminal) {
      const childIndent = indent + '   ';

      if (node.yesNext) {
        lines.push('');
        dfs(node.yesNext, childIndent, 'YES → ');
      } else {
        lines.push(`${childIndent}YES → (no further branch)`);
      }

      if (node.noNext) {
        lines.push('');
        dfs(node.noNext, childIndent, 'NO  → ');
      } else {
        lines.push(`${childIndent}NO  → (no further branch)`);
      }
    }
  }

  dfs(rootNodeId, '', '');

  return header + lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: printTreeBackup — print one topic-tree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open the system print dialog for one topic-tree.
 * Works fully offline — no network calls.
 *
 * @param tree        The CrossExamTreeRecord to render
 * @param caseName    Case name for the print header
 * @param witnessName Witness display name for the print header
 */
export function printTreeBackup(
  tree:        CrossExamTreeRecord,
  caseName:    string,
  witnessName: string,
): void {
  const content = renderTreeText(tree);
  printSide(
    caseName,
    witnessName,
    `Cross-Examination Tree — ${tree.topicLabel}`,
    content,
    true,   // confidential — counsel eyes only
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: printAllTreeBackups — print every topic-tree for a witness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open one print window per topic-tree.
 * Browser popup blockers may suppress windows after the first — counsel
 * should print trees individually if the browser blocks multiples.
 *
 * @param trees       All CrossExamTreeRecord for this witness
 * @param caseName    Case name for the print header
 * @param witnessName Witness display name for the print header
 */
export function printAllTreeBackups(
  trees:       CrossExamTreeRecord[],
  caseName:    string,
  witnessName: string,
): void {
  for (const tree of trees) {
    printTreeBackup(tree, caseName, witnessName);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React component: CrossExamPrintPanel
// ─────────────────────────────────────────────────────────────────────────────
//
// Renders a compact print control strip above the session walker.
// Shows one button per topic-tree + a "Print all" button.
// Works fully offline — no state, no effects, pure render.
//
// PLACEMENT: Mount in CrossExamSessionManager above <CrossExamTopicSwitcher>,
// or in the Phase 3F review UI. Pass the same `trees` array already in scope.
//
// PROPS:
//   trees       — CrossExamTreeRecord[] for this witness (same array as the walker)
//   caseName    — from activeCase.caseName
//   witnessName — display name (from cx_witnesses or a passed label)

export interface CrossExamPrintPanelProps {
  trees:       CrossExamTreeRecord[];
  caseName:    string;
  witnessName: string;
}

export function CrossExamPrintPanel({
  trees,
  caseName,
  witnessName,
}: CrossExamPrintPanelProps) {
  if (trees.length === 0) return null;

  return (
    <div style={printPanelStyles.wrap}>
      <span style={printPanelStyles.label}>Paper backup:</span>

      {trees.map(tree => (
        <button
          key={tree.topicId}
          style={printPanelStyles.btn}
          onClick={() => printTreeBackup(tree, caseName, witnessName)}
          title={`Print tree for: ${tree.topicLabel}`}
          aria-label={`Print ${tree.topicLabel}`}
        >
          🖨 {tree.topicLabel}
        </button>
      ))}

      {trees.length > 1 && (
        <button
          style={{ ...printPanelStyles.btn, ...printPanelStyles.allBtn }}
          onClick={() => printAllTreeBackups(trees, caseName, witnessName)}
          title="Print all topic trees (one window per tree)"
          aria-label="Print all topic trees"
        >
          🖨 Print all ({trees.length})
        </button>
      )}
    </div>
  );
}

const printPanelStyles = {
  wrap: {
    display:     'flex',
    flexWrap:    'wrap',
    alignItems:  'center',
    gap:         6,
    padding:     '7px 14px',
    borderBottom: `1px solid #2a2a2a`,
    background:  '#111',
    fontFamily:  'Inter, sans-serif',
    fontSize:    12,
  } as React.CSSProperties,

  label: {
    color:       '#666',
    fontFamily:  'Inter, sans-serif',
    fontSize:    11,
    marginRight: 2,
    flexShrink:  0,
  } as React.CSSProperties,

  btn: {
    padding:      '4px 12px',
    borderRadius: 4,
    border:       '1px solid #333',
    background:   'transparent',
    color:        '#aaa',
    fontFamily:   'Inter, sans-serif',
    fontSize:     11,
    cursor:       'pointer',
    minHeight:    32,
    whiteSpace:   'nowrap',
  } as React.CSSProperties,

  allBtn: {
    borderColor: '#555',
    color:       '#ccc',
  } as React.CSSProperties,
} as const;
