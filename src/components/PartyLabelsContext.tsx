/**
 * AFS Legal OS — Party Labels Context
 *
 * Wraps CaseDashboard. Every engine reads correct party labels
 * via usePartyLabels() — no props, no hardcoding.
 *
 * Labels derive from activeCase.originating_process
 * with counsel overrides taking priority.
 */

import { createContext, useContext } from 'react';
import { getPartyLabels } from '@/utils/getPartyLabels';
import type { Case } from '@/types';
import type { PartyLabels } from '@/utils/getPartyLabels';

const PartyLabelsContext = createContext<PartyLabels>({
  partyA:       'Claimant',
  partyB:       'Defendant',
  partyAPlural: 'Claimants',
  partyBPlural: 'Defendants',
  forPartyA:    'For the Claimant',
  forPartyB:    'For the Defendant',
  ourSide:      'Claimant',
  theirSide:    'Defendant',
});

/** Wrap CaseDashboard with this — all child engines get correct labels */
export function PartyLabelsProvider({
  activeCase,
  children,
}: {
  activeCase: Case;
  children:   React.ReactNode;
}) {
  const labels = getPartyLabels(activeCase);
  return (
    <PartyLabelsContext.Provider value={labels}>
      {children}
    </PartyLabelsContext.Provider>
  );
}

/**
 * Use in any engine — one line replaces all hardcoded labels.
 *
 * Usage:
 *   const { partyA, partyB, partyAPlural, partyBPlural, ourSide, theirSide } = usePartyLabels();
 */
export function usePartyLabels(): PartyLabels {
  return useContext(PartyLabelsContext);
}
