/**
 * AFS Legal OS — Article Generator — Types
 *
 * Kept in its own module, same pattern as src/contracts/types.ts and
 * src/research/types.ts — domain-specific shapes live next to the domain.
 *
 * Roadmap ref: 7a (D1 table), 7b (this shape is what gets read from and
 * written to that table)
 *
 * One row per generated topic. `area` mirrors one entry from AREAS in
 * src/constants/legal.ts (see 7b's cross-area selection logic in
 * topicSelector.ts) — kept as a plain string rather than a union so a future
 * addition to AREAS never requires a migration here, same reasoning as
 * jurisdiction being a free-text column on contract_clauses (1c).
 */
export interface ArticleTopicLogEntry {
  id: string;

  /** The specific, concrete topic Supo generated — not just the practice area. */
  topic: string;

  /** One entry from AREAS (src/constants/legal.ts) — the practice area this topic falls under. */
  area: string;

  created_at: string;
}
