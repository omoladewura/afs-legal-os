/**
 * AFS Legal OS — CrossExamTopicSelector
 * Phase 3B: Topic Selection UI
 *
 * BUILD ORDER (3B):
 *   1. src/types/crossExam.ts                    (Phase 3A)
 *   2. src/storage/db.ts                         (Phase 3A)
 *   3. src/storage/crossExamHelpers.ts           (Phase 3B — build first)
 *   4. THIS FILE                                  ← build here
 *   5. TrialEngine.tsx patch                     (Phase 3B — patch after this)
 *
 * PURPOSE:
 *   Before Phase 3C can generate a tree, counsel must select which topics
 *   to cross-examine each witness on. This component:
 *     - Seeds topics from intelligence_data.extraction.disputed_areas and
 *       intelligence_data.extraction.legal_issues (Intelligence Engine output)
 *     - Allows manual topic additions
 *     - Creates / deletes CrossExamTreeRecord stubs in Dexie
 *     - Shows the generation status of each tree (stub / generating / ready)
 *     - Passes selectedTopicIds up so Phase 3C generation can be triggered
 *       from the parent (CrossExaminationTab in TrialEngine.tsx)
 *
 * GATE:
 *   Requires Intelligence Engine Step 5 AND a locked Case Theory.
 *   Both checks delegate to the same helpers used by Phase 0 to keep
 *   enforcement consistent.
 *
 * PROPS CONTRACT (consumed by TrialEngine.tsx CrossExaminationTab):
 *   activeCase      — the active Case record
 *   witnessId       — id of the opposing witness being prepared for
 *   witnessName     — display name
 *   witnessStatement — full statement text (from TrialWitness.statement_text)
 *   hasTheory       — from useCaseTheory(caseId).hasTheory
 *   isIntelComplete — from isIntelligenceComplete(activeCase)
 *   onBeginGeneration — called when counsel clicks "Generate Trees"
 *                       receives array of CrossExamTreeRecord stubs that are
 *                       ready to send to Phase 3C
 */

import { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import type { CrossExamTreeRecord } from '@/types/crossExam';
import { T, S } from '@/constants/tokens';
import {
  loadWitnessTrees,
  createTopicStub,
  deleteTree,
} from '@/storage/crossExamHelpers';
import { CrossExamValidatorPanel } from '@/engines/trial/CrossExamValidatorPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a free-text topic label to a URL-safe slug for use as topicId.
 * e.g. "Prior inconsistent statement" → "prior-inconsistent-statement"
 */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80); // cap length — topicId is a Dexie key segment
}

/**
 * Seed topics from Intelligence Engine extraction output.
 * Returns a deduplicated list of { label, source } tuples.
 */
function seedTopicsFromIntelligence(activeCase: Case): Array<{
  label:  string;
  source: CrossExamTreeRecord['topicSource'];
}> {
  const extraction = activeCase.intelligence_data?.extraction;
  if (!extraction) return [];

  const topics: Array<{ label: string; source: CrossExamTreeRecord['topicSource'] }> = [];

  (extraction.disputed_areas ?? []).forEach(area => {
    topics.push({ label: area, source: 'disputed_area' });
  });

  (extraction.legal_issues ?? []).forEach(issue => {
    topics.push({ label: issue, source: 'legal_issue' });
  });

  // Deduplicate by label (case-insensitive)
  const seen = new Set<string>();
  return topics.filter(t => {
    const key = t.label.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function GateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '20px 24px',
      border: `1px solid ${T.bdr}`,
      borderRadius: 6,
      background: T.card,
      fontFamily: "'Times New Roman', Times, serif",
      fontSize: 13,
      color: T.dim,
      lineHeight: 1.7,
    }}>
      {children}
    </div>
  );
}

function SeedBadge({ source }: { source: CrossExamTreeRecord['topicSource'] }) {
  const labels: Record<CrossExamTreeRecord['topicSource'], string> = {
    disputed_area: 'Disputed Area',
    legal_issue:   'Legal Issue',
    manual:        'Manual',
  };
  const colors: Record<CrossExamTreeRecord['topicSource'], string> = {
    disputed_area: T.err,
    legal_issue:   T.info,
    manual:        T.gold,
  };
  return (
    <span style={{
      fontSize: 9,
      fontFamily: "'Times New Roman', Times, serif",
      fontWeight: 700,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: colors[source],
      border: `1px solid ${colors[source]}`,
      borderRadius: 3,
      padding: '1px 6px',
      marginLeft: 8,
    }}>
      {labels[source]}
    </span>
  );
}

function StatusPip({ tree }: { tree: CrossExamTreeRecord | undefined }) {
  if (!tree || Object.keys(tree.nodes).length === 0) {
    return <span style={{ fontSize: 11, color: T.mute }}>Not generated</span>;
  }
  if (tree.trialReady) {
    return <span style={{ fontSize: 11, color: T.ok, fontWeight: 700 }}>✓ Trial-ready</span>;
  }
  const nodeCount = Object.keys(tree.nodes).length;
  return (
    <span style={{ fontSize: 11, color: T.warn }}>
      {nodeCount} nodes — pending review
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossExamTopicSelectorProps {
  activeCase:       Case;
  witnessId:        string;
  witnessName:      string;
  /** From useCaseTheory(caseId).hasTheory */
  hasTheory:        boolean;
  /** From isIntelligenceComplete(activeCase) — Phase 0A helper */
  isIntelComplete:  boolean;
  /**
   * Called when counsel clicks "Generate Trees for Selected Topics".
   * Receives the stubs that have been created / confirmed in Dexie.
   * Phase 3C generation is triggered in the parent (CrossExaminationTab).
   */
  onBeginGeneration: (stubs: CrossExamTreeRecord[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CrossExamTopicSelector({
  activeCase,
  witnessId,
  witnessName,
  hasTheory,
  isIntelComplete,
  onBeginGeneration,
}: CrossExamTopicSelectorProps) {
  const caseId = activeCase.id;

  // ── State ──────────────────────────────────────────────────────────────────

  // All persisted trees for this witness (loaded from Dexie)
  const [trees,     setTrees]     = useState<CrossExamTreeRecord[]>([]);
  const [loading,   setLoading]   = useState(true);

  // The set of topicIds that are checked in the UI
  // Initialised to all already-persisted topics on load
  const [checked,   setChecked]   = useState<Set<string>>(new Set());

  // Suggested topics (seeded from Intelligence Engine + already saved)
  const [suggested, setSuggested] = useState<Array<{
    label:  string;
    source: CrossExamTreeRecord['topicSource'];
  }>>([]);

  // Manual addition input
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState('');

  // Working state for the "Generate" button
  const [generating, setGenerating] = useState(false);

  // Phase 3E — which topic is open in the validator panel (null = list view)
  const [reviewingTopicId, setReviewingTopicId] = useState<string | null>(null);

  // ── Load from Dexie ────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    const saved = await loadWitnessTrees(caseId, witnessId);
    setTrees(saved);

    // Mark all already-persisted topics as checked by default
    setChecked(prev => {
      const next = new Set(prev);
      saved.forEach(t => next.add(t.topicId));
      return next;
    });

    setLoading(false);
  }, [caseId, witnessId]);

  // ── Seed suggestions from Intelligence Engine ──────────────────────────────

  useEffect(() => {
    const intelTopics  = seedTopicsFromIntelligence(activeCase);
    // Build a map of already-saved topic labels so we don't double-show them
    // in the "seed" section (they still appear in the persisted list below)
    setSuggested(intelTopics);
  }, [activeCase]);

  // ── Initial load ───────────────────────────────────────────────────────────

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const treeMap = new Map(trees.map(t => [t.topicId, t]));

  // Topics that are in `suggested` but not yet saved as a tree stub
  const unseededSuggestions = suggested.filter(s => !treeMap.has(slugify(s.label)));

  // Topics already saved (either from intelligence seed or manual)
  const savedTopics = trees;

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function addSuggestedTopic(label: string, source: CrossExamTreeRecord['topicSource']) {
    const topicId = slugify(label);
    if (treeMap.has(topicId)) return; // already added
    const stub = await createTopicStub(caseId, witnessId, topicId, label, source);
    setChecked(prev => new Set(prev).add(topicId));
    setTrees(prev => [...prev, stub]);
  }

  async function addManualTopic() {
    const label = manualInput.trim();
    if (!label) { setManualError('Enter a topic label.'); return; }
    if (label.length < 4) { setManualError('Topic too short — be more specific.'); return; }

    const topicId = slugify(label);
    if (treeMap.has(topicId)) {
      setManualError('A topic with this label already exists.');
      return;
    }

    setManualError('');
    const stub = await createTopicStub(caseId, witnessId, topicId, label, 'manual');
    setChecked(prev => new Set(prev).add(topicId));
    setTrees(prev => [...prev, stub]);
    setManualInput('');
  }

  async function removeTopic(topicId: string) {
    const tree = treeMap.get(topicId);
    if (tree && Object.keys(tree.nodes).length > 0) {
      // Don't silently delete a generated tree — let Phase 3F handle deletion
      // after validation. Here we just uncheck it.
      setChecked(prev => { const n = new Set(prev); n.delete(topicId); return n; });
      return;
    }
    await deleteTree(caseId, witnessId, topicId);
    setTrees(prev => prev.filter(t => t.topicId !== topicId));
    setChecked(prev => { const n = new Set(prev); n.delete(topicId); return n; });
  }

  function toggleTopic(topicId: string) {
    setChecked(prev => {
      const n = new Set(prev);
      if (n.has(topicId)) n.delete(topicId); else n.add(topicId);
      return n;
    });
  }

  async function handleGenerate() {
    const selectedTopicIds = Array.from(checked);
    if (selectedTopicIds.length === 0) return;
    setGenerating(true);

    // Ensure a stub exists for every checked topic (idempotent)
    const stubs: CrossExamTreeRecord[] = [];
    for (const topicId of selectedTopicIds) {
      const existing = treeMap.get(topicId);
      if (existing) {
        stubs.push(existing);
      }
      // If not in treeMap it can't be checked (we only check after adding),
      // so this path should never fire, but guard anyway.
    }

    setGenerating(false);
    onBeginGeneration(stubs);
  }

  // ── Phase 3E — Validator panel route ─────────────────────────────────────────

  // When a topic is open in the validator panel, render it fullscreen (replaces list view)
  const reviewingTree = reviewingTopicId ? treeMap.get(reviewingTopicId) ?? null : null;

  if (reviewingTree) {
    return (
      <CrossExamValidatorPanel
        tree={reviewingTree}
        activeCase={activeCase}
        onClose={() => setReviewingTopicId(null)}
        onTrialReady={() => {
          // Refresh trees from Dexie so the parent list shows the updated trialReady flag
          reload();
          setReviewingTopicId(null);
        }}
      />
    );
  }

  // ── Gate checks ────────────────────────────────────────────────────────────

  if (!isIntelComplete) {
    return (
      <GateMessage>
        <strong style={{ color: T.err }}>Intelligence Engine Step 5 not complete.</strong>
        <br />
        Complete the Intelligence Engine through Step 5 (Risk Verdict + Authority Grounding)
        before preparing cross-examination topics. Topic suggestions are seeded from the
        Intelligence Engine's disputed areas and legal issues.
      </GateMessage>
    );
  }

  if (!hasTheory) {
    return (
      <GateMessage>
        <strong style={{ color: T.err }}>No locked Case Theory.</strong>
        <br />
        Lock your Case Theory in the <strong>Theory Brief</strong> tab before selecting
        cross-examination topics. Every generated tree is anchored to the locked theory.
      </GateMessage>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const checkedCount = checked.size;

  return (
    <div style={{ fontFamily: "'Times New Roman', Times, serif" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.7 }}>
          Select the topics you will cross-examine <strong>{witnessName}</strong> on.
          Topics seeded from Intelligence Engine disputed areas and legal issues are
          shown below. Add custom topics as needed, then click Generate to build the
          offline tree for each selected topic.
        </div>
      </div>

      {/* ── Intelligence-seeded suggestions ── */}
      {unseededSuggestions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={S.label}>Suggested Topics (from Intelligence Engine)</div>
          <div style={{
            border: `1px solid ${T.bdrL}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            {unseededSuggestions.map((s, i) => (
              <div key={slugify(s.label)} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderTop: i > 0 ? `1px solid ${T.bdrL}` : 'none',
                background: T.bg,
              }}>
                <div style={{ fontSize: 13, color: T.text }}>
                  {s.label}
                  <SeedBadge source={s.source} />
                </div>
                <button
                  onClick={() => addSuggestedTopic(s.label, s.source)}
                  style={{
                    fontSize: 11,
                    color: T.ok,
                    background: 'transparent',
                    border: `1px solid ${T.ok}`,
                    borderRadius: 3,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: 700,
                    letterSpacing: '.04em',
                  }}
                >
                  + Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Saved / selected topics ── */}
      {savedTopics.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={S.label}>Selected Topics</div>
          <div style={{
            border: `1px solid ${T.bdr}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            {savedTopics.map((t, i) => {
              const isChecked = checked.has(t.topicId);
              return (
                <div key={t.topicId} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderTop: i > 0 ? `1px solid ${T.bdrL}` : 'none',
                  background: isChecked ? T.bg : T.card,
                }}>
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleTopic(t.topicId)}
                    style={{ accentColor: '#8a1a1a', width: 15, height: 15, cursor: 'pointer' }}
                  />

                  {/* Label + badge + status */}
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: T.text }}>{t.topicLabel}</span>
                    <SeedBadge source={t.topicSource} />
                  </div>

                  {/* Generation status + Phase 3E validate button */}
                  <StatusPip tree={treeMap.get(t.topicId)} />
                  {Object.keys(t.nodes).length > 0 && (
                    <button
                      onClick={() => setReviewingTopicId(t.topicId)}
                      style={{
                        fontSize:   11,
                        color:      t.trialReady ? T.ok : '#8a1a1a',
                        background: 'transparent',
                        border:     `1px solid ${t.trialReady ? T.ok : '#8a1a1a'}`,
                        borderRadius: 3,
                        padding:    '3px 10px',
                        cursor:     'pointer',
                        fontFamily: "'Times New Roman', Times, serif",
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {t.trialReady ? '✓ Validated' : 'Validate & Review'}
                    </button>
                  )}

                  {/* Remove */}
                  <button
                    onClick={() => removeTopic(t.topicId)}
                    title={
                      Object.keys(t.nodes).length > 0
                        ? 'Generated trees must be removed in the Review tab'
                        : 'Remove this topic'
                    }
                    style={{
                      fontSize: 11,
                      color: T.mute,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Manual addition ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.label}>Add Custom Topic</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={manualInput}
            onChange={e => { setManualInput(e.target.value); setManualError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') addManualTopic(); }}
            placeholder="e.g. Alibi — exact movements on 14 March"
            style={{ ...S.inp, flex: 1 }}
          />
          <button
            onClick={addManualTopic}
            style={{
              fontSize: 12,
              color: T.bg,
              background: T.dim,
              border: 'none',
              borderRadius: 4,
              padding: '0 18px',
              cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            Add Topic
          </button>
        </div>
        {manualError && (
          <div style={{ fontSize: 11, color: T.err, marginTop: 5 }}>{manualError}</div>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ fontSize: 12, color: T.mute, marginBottom: 12 }}>
          Loading saved topics…
        </div>
      )}

      {/* ── Generate button ── */}
      <div style={{
        borderTop: `1px solid ${T.bdrL}`,
        paddingTop: 18,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <button
          onClick={handleGenerate}
          disabled={checkedCount === 0 || generating}
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "'Times New Roman', Times, serif",
            color: checkedCount === 0 ? T.mute : T.bg,
            background: checkedCount === 0 ? T.card : '#8a1a1a',
            border: `1px solid ${checkedCount === 0 ? T.bdr : '#8a1a1a'}`,
            borderRadius: 5,
            padding: '10px 22px',
            cursor: checkedCount === 0 ? 'not-allowed' : 'pointer',
            transition: 'background .15s',
          }}
        >
          {generating
            ? 'Preparing…'
            : `Generate Trees for ${checkedCount} Topic${checkedCount === 1 ? '' : 's'}`}
        </button>

        {checkedCount === 0 && (
          <span style={{ fontSize: 12, color: T.mute }}>
            Select at least one topic to generate.
          </span>
        )}
      </div>

      {/* ── Explanatory note ── */}
      <div style={{
        marginTop: 16,
        fontSize: 11,
        color: T.mute,
        lineHeight: 1.7,
        fontStyle: 'italic',
      }}>
        Generation creates one offline Yes/No decision tree per topic, anchored to
        {witnessName}'s statement and your locked Case Theory. Trees work entirely
        offline once generated — no internet required in court.
      </div>

    </div>
  );
}
