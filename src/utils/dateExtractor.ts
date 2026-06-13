/**
 * AFS Legal OS — Date Extractor (Phase E)
 *
 * Scans DocketEntry[] and extracts real anchor dates for each procedural
 * trigger event type defined in periodRules.ts.
 *
 * Each anchor has a confidence level:
 *   'high'     — exact title / keyword match (e.g. "Judgment Delivered" → judgment event)
 *   'inferred' — keyword found in notes or docType field, not docTitle
 *   'none'     — no anchor found for this event type
 *
 * Only anchors with confidence 'high' or 'inferred' are returned.
 * 'none' anchors are omitted — unstarted clocks are excluded entirely.
 */

import type { DocketEntry } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AnchorConfidence = 'high' | 'inferred';

export interface ExtractedAnchor {
  /** The trigger event type (matches PeriodRule.triggerEvent). */
  eventType:  string;

  /** YYYY-MM-DD date string — the date of the triggering docket entry. */
  date:       string;

  /** Confidence level of the extraction. */
  confidence: AnchorConfidence;

  /** The docket entry that was matched. */
  source:     DocketEntry;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT-SPECIFIC KEYWORD MAPS
// ─────────────────────────────────────────────────────────────────────────────
//
// Keys are trigger event type strings (must match PeriodRule.triggerEvent).
// Values are arrays: first sub-array = HIGH confidence keywords (docTitle match),
//                    second sub-array = INFERRED confidence keywords (any field).
//
// Ordering: more specific terms first to reduce false positives.

type KeywordMap = {
  high:     string[];
  inferred: string[];
};

const EVENT_KEYWORDS: Record<string, KeywordMap> = {

  // Civil triggers
  service: {
    high: [
      'service of process',
      'process served',
      'writ served',
      'originating summons served',
      'service effected',
      'endorsement of service',
      'bailiff return of service',
      'affidavit of service',
    ],
    inferred: [
      'served',
      'service',
      'served on defendant',
      'served on respondent',
    ],
  },

  service_outside: {
    high: [
      'substituted service',
      'service outside jurisdiction',
      'service outside lagos',
      'service by substitution',
      'order for substituted service',
    ],
    inferred: [
      'outside jurisdiction',
      'substituted',
    ],
  },

  soc_served: {
    high: [
      'statement of claim served',
      'service of statement of claim',
      'statement of claim filed and served',
    ],
    inferred: [
      'statement of claim',
      'soc filed',
      'soc served',
    ],
  },

  sod_served: {
    high: [
      'statement of defence served',
      'service of statement of defence',
      'statement of defence filed and served',
    ],
    inferred: [
      'statement of defence',
      'sod filed',
      'sod served',
    ],
  },

  judgment: {
    high: [
      'judgment delivered',
      'judgment of the court',
      'court delivers judgment',
      'final judgment entered',
      'judgment entered',
      'judgment in favour',
      'judgment against',
    ],
    inferred: [
      'judgment',
      'final judgment',
      'ruling on merit',
    ],
  },

  ruling: {
    high: [
      'ruling delivered',
      'interlocutory ruling',
      'ruling on motion',
      'ruling on application',
      'ruling on objection',
      'court rules on',
    ],
    inferred: [
      'ruling',
      'court rules',
    ],
  },

  magistrate_judgment: {
    high: [
      'magistrate judgment',
      'magistrate delivers judgment',
      'magistrate court judgment',
      'judgment magistrate court',
    ],
    inferred: [
      'magistrate',
      'magistrates court',
    ],
  },

  ca_judgment: {
    high: [
      'court of appeal judgment',
      'ca judgment',
      'court of appeal delivers judgment',
      'judgment of the court of appeal',
      'appeal court judgment',
    ],
    inferred: [
      'court of appeal',
    ],
  },

  // Criminal triggers
  arrest: {
    high: [
      'arrest of accused',
      'accused arrested',
      'client arrested',
      'suspect arrested',
      'warrant of arrest executed',
    ],
    inferred: [
      'arrested',
      'arrest',
      'in custody',
    ],
  },

  remand: {
    high: [
      'remand order',
      'accused remanded',
      'remanded in custody',
      'bail refused',
      'bail denied',
      'remanded to prison',
    ],
    inferred: [
      'remand',
      'bail refused',
      'custody',
    ],
  },

  arraignment: {
    high: [
      'arraignment',
      'accused arraigned',
      'plea taken',
      'charge read to accused',
      'first appearance',
      'arraigned before court',
    ],
    inferred: [
      'arraigned',
      'plea',
      'first appearance',
    ],
  },

  conviction: {
    high: [
      'conviction',
      'accused convicted',
      'found guilty',
      'guilty verdict',
      'convicted of',
      'sentence imposed',
      'sentenced to',
      'custodial sentence',
      'term of imprisonment',
    ],
    inferred: [
      'convicted',
      'guilty',
      'sentence',
      'sentenced',
    ],
  },

  magistrate_conviction: {
    high: [
      'magistrate conviction',
      'magistrate court conviction',
      'convicted magistrate court',
      'magistrate sentence',
    ],
    inferred: [
      'magistrate guilty',
    ],
  },

  ca_criminal_judgment: {
    high: [
      'court of appeal criminal judgment',
      'ca criminal judgment',
      'court of appeal dismisses appeal',
      'court of appeal allows appeal',
      'court of appeal judgment criminal',
    ],
    inferred: [
      'court of appeal',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans all docket entries and returns the *earliest* anchor for each
 * trigger event type (earliest = most conservative deadline computation).
 *
 * Returns a map keyed by eventType → ExtractedAnchor.
 * Events with no match are not included in the output.
 */
export function extractAnchors(
  entries: DocketEntry[],
): Record<string, ExtractedAnchor> {
  const result: Record<string, ExtractedAnchor> = {};

  // Sort entries chronologically so we pick the earliest matching entry
  const sorted = [...entries].sort(
    (a, b) => new Date(a.dateFiled).getTime() - new Date(b.dateFiled).getTime(),
  );

  for (const eventType of Object.keys(EVENT_KEYWORDS)) {
    const kwMap = EVENT_KEYWORDS[eventType];

    // First pass — HIGH confidence (title match)
    for (const entry of sorted) {
      const title = (entry.docTitle ?? '').toLowerCase();
      const matched = kwMap.high.some(kw => title.includes(kw.toLowerCase()));
      if (matched) {
        result[eventType] = {
          eventType,
          date:       entry.dateFiled,
          confidence: 'high',
          source:     entry,
        };
        break; // earliest high-confidence match wins
      }
    }

    // If already found at HIGH confidence, skip INFERRED pass
    if (result[eventType]) continue;

    // Second pass — INFERRED confidence (any field)
    for (const entry of sorted) {
      const corpus = [
        entry.docTitle ?? '',
        entry.notes   ?? '',
        entry.docType ?? '',
      ].join(' ').toLowerCase();

      const matched = kwMap.inferred.some(kw => corpus.includes(kw.toLowerCase()));
      if (matched) {
        result[eventType] = {
          eventType,
          date:       entry.dateFiled,
          confidence: 'inferred',
          source:     entry,
        };
        break;
      }
    }
  }

  return result;
}

/**
 * Returns true if an anchor exists for a given event type.
 * Convenience wrapper used by the period computer.
 */
export function hasAnchor(
  anchors:   Record<string, ExtractedAnchor>,
  eventType: string,
): boolean {
  return eventType in anchors;
}
