/**
 * AFS Legal OS V2 — Role-Aware Library Options
 *
 * Maps matter_track + counsel_role → the correct Vectorize filter/namespace
 * for RAG retrieval. This is the single source of truth for which library
 * materials each role should retrieve.
 *
 * HOW IT WORKS
 * ────────────
 * Your Cloudflare Vectorize index stores every document with a metadata field:
 *   { counsel_role: 'claimant_side' | 'defendant_side' | 'prosecution' | 'defence' | 'petitioner_side' | 'respondent_side' | 'shared' }
 *
 * When a claimant-side engine calls Claude, Vectorize is queried with:
 *   filter: { counsel_role: 'claimant_side' }
 * …retrieving only claimant-relevant authorities (enforcement writs,
 * cause-of-action precedents, High Court Rules on originating processes).
 *
 * Defence engines retrieve:
 *   filter: { counsel_role: 'defence' }
 * …retrieving ACJA bail provisions, no-case submission authorities,
 * allocutus jurisprudence — never prosecution sentencing tariffs.
 *
 * Documents tagged 'shared' (e.g. Evidence Act general provisions,
 * Court hierarchy rules) are always included via a separate topK boost.
 *
 * INGESTION CONVENTION
 * ─────────────────────
 * When adding documents to Vectorize, tag them with:
 *   metadata.counsel_role = one of the four roles, or 'shared'
 *   metadata.matter_track = 'civil' | 'criminal' | 'shared'
 *
 * Examples:
 *   High Court Rules (originating process) → matter_track: 'civil', counsel_role: 'claimant_side'
 *   High Court Rules (appearance, SoD)     → matter_track: 'civil', counsel_role: 'defendant_side'
 *   ACJA 2015 bail provisions              → matter_track: 'criminal', counsel_role: 'defence'
 *   ACJA 2015 charge provisions            → matter_track: 'criminal', counsel_role: 'prosecution'
 *   Evidence Act 2011 (general)            → matter_track: 'shared', counsel_role: 'shared'
 *   Supreme Court Rules                    → matter_track: 'shared', counsel_role: 'shared'
 */

import type { MatterTrack, CounselRole } from '@/types';
import type { LibraryQueryOpts } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ROLE → RAG FILTER MAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each counsel_role, defines:
 *   filter    — Vectorize metadata filter (sent to Worker as-is)
 *   namespace — optional Vectorize namespace to query
 *   topK      — how many results to pull (role-specific tuning)
 *   threshold — minimum similarity score
 *   queryHint — semantic hint prepended to the embedding query string
 *               to steer results toward role-relevant vocabulary
 */
interface RoleRagConfig {
  filter:    Record<string, string>;
  namespace: string;
  topK:      number;
  threshold: number;
  queryHint: string;
}

export const ROLE_RAG_CONFIG: Record<CounselRole, RoleRagConfig> = {
  claimant_side: {
    filter:    { counsel_role: 'claimant_side' },
    namespace: 'civil_claimant',
    topK:      8,
    threshold: 0.68,
    queryHint: 'Nigerian civil litigation claimant originating process pleadings enforcement',
  },
  defendant_side: {
    filter:    { counsel_role: 'defendant_side' },
    namespace: 'civil_defendant',
    topK:      8,
    threshold: 0.68,
    queryHint: 'Nigerian civil litigation defendant defence preliminary objection stay strike out',
  },
  prosecution: {
    filter:    { counsel_role: 'prosecution' },
    namespace: 'criminal_prosecution',
    topK:      8,
    threshold: 0.68,
    queryHint: 'Nigerian criminal prosecution ACJA evidence admissibility conviction sentencing',
  },
  defence: {
    filter:    { counsel_role: 'defence' },
    namespace: 'criminal_defence',
    topK:      8,
    threshold: 0.68,
    queryHint: 'Nigerian criminal defence ACJA bail remand no-case submission acquittal appeal allocutus',
  },
  petitioner_side: {
    filter:    { counsel_role: 'petitioner_side' },
    namespace: 'matrimonial_petitioner',
    topK:      10,
    threshold: 0.60,
    queryHint: 'Nigerian matrimonial causes MCA petition dissolution nullity s.15(2) facts two-year bar co-respondent Form 6',
  },
  respondent_side: {
    filter:    { counsel_role: 'respondent_side' },
    namespace: 'matrimonial_respondent',
    topK:      10,
    threshold: 0.60,
    queryHint: 'Nigerian matrimonial causes MCA answer cross-petition condonation connivance bars s.28 decree nisi respondent',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRACK → NAMESPACE FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

/** Used when counsel_role is absent (legacy V1 matters). */
const TRACK_FALLBACK_NAMESPACE: Record<MatterTrack, string> = {
  civil:       'civil_shared',
  criminal:    'criminal_shared',
  matrimonial: 'matrimonial_shared',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the correct LibraryQueryOpts for a given matter_track + counsel_role.
 *
 * - V2 matters (with counsel_role): returns role-filtered opts.
 * - V1 legacy matters (no counsel_role): returns track-namespaced opts, no role filter.
 * - No track and no role: returns generic defaults.
 *
 * Pass the result directly as the `libraryOpts` field in ApiRequestOptions:
 *
 *   const result = await callClaude({
 *     system:      buildRoleSystemPrompt(activeCase.matter_track, activeCase.counsel_role),
 *     userMsg:     userInput,
 *     libraryOpts: buildRoleLibraryOpts(activeCase.matter_track, activeCase.counsel_role),
 *   });
 */
export function buildRoleLibraryOpts(
  matterTrack?: MatterTrack,
  counselRole?: CounselRole,
  extraHint?:   string,
): LibraryQueryOpts {
  // V2 matter — full role-aware config
  if (counselRole) {
    const cfg = ROLE_RAG_CONFIG[counselRole];
    return {
      filter:    cfg.filter,
      namespace: cfg.namespace,
      topK:      cfg.topK,
      threshold: cfg.threshold,
      queryHint: extraHint
        ? `${cfg.queryHint} ${extraHint}`.slice(0, 300)
        : cfg.queryHint,
    };
  }

  // V1 legacy matter — track-based namespace, no role filter
  if (matterTrack) {
    const matrimonialHint = 'Nigerian matrimonial causes MCA MCR petition dissolution nullity decree';
    return {
      namespace: TRACK_FALLBACK_NAMESPACE[matterTrack],
      topK:      8,
      threshold: matterTrack === 'matrimonial' ? 0.60 : 0.70,
      queryHint: matterTrack === 'criminal'
        ? 'Nigerian criminal litigation procedure evidence'
        : matterTrack === 'matrimonial'
        ? matrimonialHint
        : 'Nigerian civil litigation procedure High Court Rules',
    };
  }

  // Absolute fallback
  return {
    topK:      8,
    threshold: 0.70,
    queryHint: 'Nigerian litigation procedure',
  };
}

/**
 * Convenience: derive a query hint from the engine context and combine
 * with the role config hint. Pass this as `extraHint` to buildRoleLibraryOpts.
 *
 * Usage:
 *   const hint = deriveRoleHint('Default judgment in default of defence', 'motions');
 *   libraryOpts: buildRoleLibraryOpts(track, role, hint)
 */
export function deriveRoleHint(userInput: string, engineContext?: string): string {
  const parts = [engineContext, userInput.slice(0, 150)].filter(Boolean);
  return parts.join(' ').slice(0, 200);
}
