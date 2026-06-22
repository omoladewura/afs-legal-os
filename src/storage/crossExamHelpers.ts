/**
 * AFS Legal OS — Cross-Examination Storage Helpers
 * Phase 3B: Topic Selection
 *
 * BUILD ORDER (3B):
 *   1. src/types/crossExam.ts            (Phase 3A — already built)
 *   2. src/storage/db.ts                 (Phase 3A — already patched)
 *   3. THIS FILE                         ← build here
 *   4. src/engines/trial/CrossExamTopicSelector.tsx
 *
 * PURPOSE:
 *   All Dexie read/write for `cross_exam_trees` and `cross_exam_sessions`.
 *   Nothing outside this file should touch those tables directly — keeping
 *   all IndexedDB logic in one place mirrors the pattern used by
 *   loadBlindSpot / saveBlindSpot in src/storage/helpers.ts.
 *
 * CONSUMED BY:
 *   - Phase 3B  CrossExamTopicSelector (topic CRUD + tree stubs)
 *   - Phase 3C  tree generation (write generated nodes)
 *   - Phase 3D′ detour generation (patch individual nodes)
 *   - Phase 3E  validator (read + patch lastValidation / trialReady)
 *   - Phase 3F  review/edit UI (read + patch individual nodes)
 *   - Phase 4   Courtroom Walker (read trees + session CRUD)
 *   - Phase 5A  post-session feed (mark fedToContradictionMapper)
 */

import { db } from '@/storage/db';
import type {
  CrossExamTreeRecord,
  CrossExamSessionRecord,
  CrossExamNode,
  TreeValidationResult,
  TopicPolarity,
} from '@/types/crossExam';

// ─────────────────────────────────────────────────────────────────────────────
// Key helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary key for a cross_exam_trees record.
 * Must never use '/' or whitespace — Dexie compound keys are fine as
 * a separator-joined string when the component values are UUIDs/slugs.
 */
export function treeKey(caseId: string, witnessId: string, topicId: string): string {
  return `${caseId}::${witnessId}::${topicId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load all topic-trees for one witness on one case.
 * Called by Phase 3B topic-selector and Phase 4 session walker.
 */
export async function loadWitnessTrees(
  caseId: string,
  witnessId: string,
): Promise<CrossExamTreeRecord[]> {
  return db.cross_exam_trees
    .where('[caseId+witnessId]')
    .equals([caseId, witnessId])
    .toArray();
}

/**
 * Load a single tree by its composite key.
 * Returns null when the tree has not been generated yet.
 */
export async function loadTree(
  caseId: string,
  witnessId: string,
  topicId: string,
): Promise<CrossExamTreeRecord | null> {
  const rec = await db.cross_exam_trees.get(treeKey(caseId, witnessId, topicId));
  return rec ?? null;
}

/**
 * Write (create or overwrite) a tree record.
 * Sets updatedAt automatically.
 */
export async function saveTree(tree: CrossExamTreeRecord): Promise<void> {
  await db.cross_exam_trees.put({ ...tree, updatedAt: new Date().toISOString() });
}

/**
 * Delete a tree — used when counsel removes a topic in Phase 3B.
 */
export async function deleteTree(
  caseId: string,
  witnessId: string,
  topicId: string,
): Promise<void> {
  await db.cross_exam_trees.delete(treeKey(caseId, witnessId, topicId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic stub creation (Phase 3B)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a blank tree stub for a topic that has just been added.
 * The stub has an empty nodes map — Phase 3C generation fills it.
 * If a tree for this topic already exists it is NOT overwritten, so
 * calling this on a topic that was added, removed, then re-added is safe.
 */
export async function createTopicStub(
  caseId:      string,
  witnessId:   string,
  topicId:     string,
  topicLabel:  string,
  topicSource: CrossExamTreeRecord['topicSource'],
  polarity:    TopicPolarity = 'YES_advances',
): Promise<CrossExamTreeRecord> {
  const existing = await loadTree(caseId, witnessId, topicId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const stub: CrossExamTreeRecord = {
    id:              treeKey(caseId, witnessId, topicId),
    caseId,
    witnessId,
    topicId,
    topicLabel,
    topicSource,
    nodes:           {},
    rootNodeId:      '',    // set by Phase 3C after generation
    polarity,
    trialReady:      false,
    detoursComplete: false,
    generatedAt:     now,
    updatedAt:       now,
  };

  await db.cross_exam_trees.put(stub);
  return stub;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node-level patches (used by Phase 3C/3D/3D′/3F)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace the entire nodes map and rootNodeId on a tree.
 * Called by Phase 3C/3D after generation completes.
 */
export async function patchTreeNodes(
  caseId:     string,
  witnessId:  string,
  topicId:    string,
  nodes:      Record<string, CrossExamNode>,
  rootNodeId: string,
): Promise<void> {
  const key = treeKey(caseId, witnessId, topicId);
  await db.cross_exam_trees
    .where('id').equals(key)
    .modify({ nodes, rootNodeId, updatedAt: new Date().toISOString() });
}

/**
 * Patch a single node within a tree's nodes map.
 * Called by Phase 3D′ (add detour) and Phase 3F (edit node).
 * Uses Dexie's modify() so only the nodes map is touched, not the whole record.
 */
export async function patchNode(
  caseId:    string,
  witnessId: string,
  topicId:   string,
  node:      CrossExamNode,
): Promise<void> {
  const key = treeKey(caseId, witnessId, topicId);
  await db.cross_exam_trees.where('id').equals(key).modify(rec => {
    rec.nodes[node.id] = node;
    rec.updatedAt = new Date().toISOString();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator result write (Phase 3E)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist the validator result and update trialReady flag.
 * Called by Phase 3E after running both gates.
 */
export async function patchValidation(
  caseId:     string,
  witnessId:  string,
  topicId:    string,
  result:     TreeValidationResult,
): Promise<void> {
  const key = treeKey(caseId, witnessId, topicId);
  await db.cross_exam_trees.where('id').equals(key).modify({
    lastValidation: result,
    trialReady:     result.trialReady,
    updatedAt:      new Date().toISOString(),
  });
}

/**
 * Manually set trialReady — called by Phase 3F when counsel approves the tree
 * after reviewing the validator output.
 */
export async function setTrialReady(
  caseId:    string,
  witnessId: string,
  topicId:   string,
  ready:     boolean,
): Promise<void> {
  const key = treeKey(caseId, witnessId, topicId);
  await db.cross_exam_trees.where('id').equals(key).modify({
    trialReady: ready,
    updatedAt:  new Date().toISOString(),
  });
}

/**
 * Mark detours as complete — called by Phase 3D′ when the citation pass
 * has been run for every node with an expectedAnswer.
 */
export async function setDetoursComplete(
  caseId:    string,
  witnessId: string,
  topicId:   string,
): Promise<void> {
  const key = treeKey(caseId, witnessId, topicId);
  await db.cross_exam_trees.where('id').equals(key).modify({
    detoursComplete: true,
    updatedAt:       new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Polarity override (Phase 3F)
// ─────────────────────────────────────────────────────────────────────────────

export async function setTopicPolarity(
  caseId:    string,
  witnessId: string,
  topicId:   string,
  polarity:  TopicPolarity,
): Promise<void> {
  const key = treeKey(caseId, witnessId, topicId);
  await db.cross_exam_trees.where('id').equals(key).modify({
    polarity,
    updatedAt: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Session CRUD (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new session record.
 * Called by Phase 4 when counsel starts a courtroom walk.
 */
export async function createSession(
  session: CrossExamSessionRecord,
): Promise<void> {
  await db.cross_exam_sessions.put(session);
}

/**
 * Load the most-recent open session for a witness on a case.
 * Returns null if no open session exists — Phase 4 shows "Start new session".
 */
export async function loadOpenSession(
  caseId:    string,
  witnessId: string,
): Promise<CrossExamSessionRecord | null> {
  // Query all sessions for this witness, filter to open ones, return latest.
  const sessions = await db.cross_exam_sessions
    .where('[caseId+witnessId]')
    .equals([caseId, witnessId])
    .toArray();

  const open = sessions
    .filter(s => s.endedAt === null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return open[0] ?? null;
}

/**
 * Auto-save session state — called on every step by Phase 4F.
 * Full record overwrite (sessions are small — no need for partial modify).
 */
export async function saveSession(session: CrossExamSessionRecord): Promise<void> {
  await db.cross_exam_sessions.put(session);
}

/**
 * Close a session by writing endedAt.
 * Does NOT feed to Contradiction Mapper — that is Phase 5A's responsibility.
 */
export async function closeSession(sessionId: string): Promise<void> {
  await db.cross_exam_sessions.where('id').equals(sessionId).modify({
    endedAt: new Date().toISOString(),
  });
}

/**
 * Mark a session as fed to Contradiction Mapper.
 * Called by Phase 5A after the full log has been written.
 */
export async function markSessionFed(sessionId: string): Promise<void> {
  await db.cross_exam_sessions.where('id').equals(sessionId).modify({
    fedToContradictionMapper: true,
  });
}

/**
 * Load all closed, unfed sessions for Phase 5A to process.
 * A session is "unfed" when fedToContradictionMapper is false.
 */
export async function loadUnfedSessions(
  caseId: string,
): Promise<CrossExamSessionRecord[]> {
  const all = await db.cross_exam_sessions
    .where('caseId').equals(caseId)
    .toArray();

  return all.filter(s => s.endedAt !== null && !s.fedToContradictionMapper);
}
