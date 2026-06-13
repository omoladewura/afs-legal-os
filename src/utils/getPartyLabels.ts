/**
 * AFS Legal OS — Party Label Utility
 *
 * Single source of truth for party labels across all engines.
 * Derives labels from originating_process, with optional counsel overrides.
 *
 * Priority: custom_party_a_label > originating_process config > matter_track default
 *
 * Usage in any engine:
 *   import { getPartyLabels } from '@/utils/getPartyLabels';
 *   const { partyA, partyB, partyAPlural, partyBPlural } = getPartyLabels(activeCase);
 */

import { getOriginatingProcess } from '@/types';
import type { Case } from '@/types';

export interface PartyLabels {
  /** Singular — "Claimant", "Applicant", "Petitioner", "Prosecution" */
  partyA:       string;
  /** Singular — "Defendant", "Respondent", "Accused" */
  partyB:       string;
  /** Plural — "Claimants", "Applicants" etc */
  partyAPlural: string;
  /** Plural — "Defendants", "Respondents" etc */
  partyBPlural: string;
  /** "For the Claimant" / "For the Applicant" */
  forPartyA:    string;
  /** "For the Defendant" / "For the Respondent" */
  forPartyB:    string;
  /** Which side counsel is on — partyA or partyB labels */
  ourSide:      string;
  /** Opposing side labels */
  theirSide:    string;
}

export function getPartyLabels(activeCase: Case | null): PartyLabels {
  if (!activeCase) return defaults();

  const isCriminal = activeCase.matter_track === 'criminal';

  // ── Criminal — fixed labels ───────────────────────────────────────────────
  if (isCriminal) {
    const isDefence = activeCase.counsel_role === 'defence';
    return {
      partyA:       'Prosecution',
      partyB:       'Accused',
      partyAPlural: 'Prosecution',
      partyBPlural: 'Accused',
      forPartyA:    'For the Prosecution',
      forPartyB:    'For the Accused',
      ourSide:      isDefence ? 'Accused'      : 'Prosecution',
      theirSide:    isDefence ? 'Prosecution'  : 'Accused',
    };
  }

  // ── Civil — derive from originating process ───────────────────────────────
  const proc = getOriginatingProcess(activeCase.originating_process);

  // Counsel overrides take priority (stored on Case object)
  const customA = (activeCase as any).custom_party_a_label as string | undefined;
  const customB = (activeCase as any).custom_party_b_label as string | undefined;

  const a       = customA || proc.partyALabel;
  const b       = customB || proc.partyBLabel;
  const aPlural = customA || proc.partyAPlural;
  const bPlural = customB || proc.partyBPlural;

  const isClaimantSide = activeCase.counsel_role === 'claimant_side';

  return {
    partyA:       a,
    partyB:       b,
    partyAPlural: aPlural,
    partyBPlural: bPlural,
    forPartyA:    `For the ${a}`,
    forPartyB:    `For the ${b}`,
    ourSide:      isClaimantSide ? a : b,
    theirSide:    isClaimantSide ? b : a,
  };
}

/** Safe fallback — used when no case is loaded */
function defaults(): PartyLabels {
  return {
    partyA:       'Claimant',
    partyB:       'Defendant',
    partyAPlural: 'Claimants',
    partyBPlural: 'Defendants',
    forPartyA:    'For the Claimant',
    forPartyB:    'For the Defendant',
    ourSide:      'Claimant',
    theirSide:    'Defendant',
  };
}
