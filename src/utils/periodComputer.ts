/**
 * AFS Legal OS — Period Computer (Phase E)
 *
 * Combines extracted docket anchors with period rules to produce a list
 * of ComputedPeriod objects. Each ComputedPeriod represents a real,
 * live procedural deadline with:
 *   - Exact trigger date (extracted from docket)
 *   - Computed deadline date (trigger + days)
 *   - Days remaining (can be negative = overdue)
 *   - Status bucket: overdue / critical / urgent / upcoming / safe
 *   - Confidence level (high / inferred)
 *   - Whether the deadline is fatal to the right
 *
 * Only periods whose trigger event has an extracted anchor are returned.
 * Unstarted clocks are excluded entirely — they do not appear as zero.
 *
 * STATUS THRESHOLDS
 * ─────────────────
 *   overdue   → days remaining < 0
 *   critical  → 0 ≤ days ≤ 7
 *   urgent    → 8 ≤ days ≤ 21
 *   upcoming  → 22 ≤ days ≤ 60
 *   safe      → > 60 days
 */

import type { MatterTrack, CounselRole } from '@/types';
import { getRulesForContext, type PeriodRule } from '@/constants/periodRules';
import type { ExtractedAnchor } from './dateExtractor';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodStatus = 'overdue' | 'critical' | 'urgent' | 'upcoming' | 'safe';

export interface ComputedPeriod {
  /** The rule that generated this period. */
  rule: PeriodRule;

  /** YYYY-MM-DD — date of the trigger docket event. */
  triggerDate: string;

  /** YYYY-MM-DD — computed deadline date (triggerDate + rule.days). */
  deadlineDate: string;

  /** Calendar days remaining until deadline. Negative = overdue. */
  daysRemaining: number;

  /** Status bucket derived from daysRemaining. */
  status: PeriodStatus;

  /** Confidence of the trigger anchor extraction. */
  confidence: 'high' | 'inferred';

  /** Human-readable label for the trigger entry found in docket. */
  triggerEntryTitle: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysRemaining(deadlineStr: string): number {
  const deadline = new Date(deadlineStr + 'T00:00:00');
  const today    = todayMidnight();
  return Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function statusFromDays(days: number): PeriodStatus {
  if (days < 0)  return 'overdue';
  if (days <= 7)  return 'critical';
  if (days <= 21) return 'urgent';
  if (days <= 60) return 'upcoming';
  return 'safe';
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a matter's track + role + extracted anchors, returns all
 * ComputedPeriod objects for which a trigger anchor was found.
 *
 * @param track   - Matter track (civil | criminal)
 * @param role    - Counsel role (claimant_side | defendant_side | prosecution | defence)
 * @param anchors - Output of extractAnchors() from dateExtractor.ts
 *
 * @returns ComputedPeriod[] sorted by daysRemaining ascending (most urgent first).
 */
export function computePeriods(
  track:   MatterTrack,
  role:    CounselRole,
  anchors: Record<string, ExtractedAnchor>,
): ComputedPeriod[] {
  const rules   = getRulesForContext(track, role);
  const periods: ComputedPeriod[] = [];

  for (const rule of rules) {
    const anchor = anchors[rule.triggerEvent];

    // Skip rules with no anchor — unstarted clocks are excluded
    if (!anchor) continue;

    const deadline = addDays(anchor.date, rule.days);
    const days     = daysRemaining(deadline);
    const status   = statusFromDays(days);

    periods.push({
      rule,
      triggerDate:       anchor.date,
      deadlineDate:      deadline,
      daysRemaining:     days,
      status,
      confidence:        anchor.confidence,
      triggerEntryTitle: anchor.source.docTitle,
    });
  }

  // Sort by urgency: overdue first, then fewest days remaining
  periods.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return periods;
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNT HELPERS — used by CaseDashboard for the red badge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the count of periods in overdue / critical / urgent status.
 * Used to set the red badge count on the Alerts tab.
 */
export function countUrgentPeriods(periods: ComputedPeriod[]): number {
  return periods.filter(
    p => p.status === 'overdue' || p.status === 'critical' || p.status === 'urgent',
  ).length;
}

/**
 * Returns the count of fatal overdue periods only.
 * Used as a secondary indicator in the dashboard header.
 */
export function countFatalOverdue(periods: ComputedPeriod[]): number {
  return periods.filter(p => p.status === 'overdue' && p.rule.fatal).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS — used by AlertsEngine alert cards
// ─────────────────────────────────────────────────────────────────────────────

/** Formats a YYYY-MM-DD date string for display. */
export function formatPeriodDate(ds: string): string {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Returns a human-readable countdown string. */
export function formatDaysRemaining(days: number): string {
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} OVERDUE`;
  if (days === 0) return 'DUE TODAY';
  if (days === 1) return '1 day remaining';
  return `${days} days remaining`;
}

/**
 * Returns the status display config for rendering period alert cards.
 * Mirrors the SEV palette used in AlertsEngine but mapped to period status.
 */
export function periodStatusConfig(status: PeriodStatus): {
  bg: string; bdr: string; col: string; icon: string; label: string;
} {
  switch (status) {
    case 'overdue':  return { bg: '#1a0808', bdr: '#5a1818', col: '#d05050', icon: '🔴', label: 'OVERDUE'  };
    case 'critical': return { bg: '#1a0808', bdr: '#5a1818', col: '#d05050', icon: '🔴', label: 'CRITICAL' };
    case 'urgent':   return { bg: '#1a0e04', bdr: '#4a2010', col: '#c07040', icon: '🟠', label: 'URGENT'   };
    case 'upcoming': return { bg: '#1a1400', bdr: '#483800', col: '#b09030', icon: '🟡', label: 'UPCOMING' };
    case 'safe':     return { bg: '#071810', bdr: '#1a4028', col: '#408860', icon: '🟢', label: 'SAFE'     };
  }
}
