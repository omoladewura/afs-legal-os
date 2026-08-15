/**
 * AFS Legal OS — Contract Engine — Negotiate Mode Panel
 *
 * Roadmap ref: 5b (Contract Engine — Dashboard Wiring)
 *
 * Wires the Negotiate-mode chain exactly as documented on ContractDashboard.tsx:
 *   round tracking (4a) → negotiate prompt/flow (4b)
 *
 * runNegotiateRound() (4b) already calls 4a's runRoundAdvance() internally
 * and re-tags only new/changed clauses via 2d/2e/2f — this panel's job is
 * just collecting the counterparty input, calling runNegotiateRound(), and
 * rendering the result, highlighting whichever clauses actually revised
 * this round.
 *
 * Requires a register already on file (from Draft or Review mode) — same
 * precondition runNegotiateRound() itself enforces.
 */

import React, { useEffect, useState } from 'react';
import { T, S } from '@/constants/tokens';
import { loadContractClauses } from '@/storage/helpers';
import { runNegotiateRound } from './negotiateRound';
import { ClauseRegisterView, MissingProfileBanner, ErrorBanner } from './ClauseRegisterView';
import type { ClientPositionProfile, ContractClause } from './types';

export interface NegotiateModePanelProps {
  contractId: string;
  profile: ClientPositionProfile | null;
}

export function NegotiateModePanel({ contractId, profile }: NegotiateModePanelProps) {
  const [contractType, setContractType] = useState('');
  const [counterpartyInput, setCounterpartyInput] = useState('');

  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [revisedNumbers, setRevisedNumbers] = useState<string[]>([]);
  const [missingProfileWarning, setMissingProfileWarning] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [lastMessage, setLastMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingExisting(true);
    loadContractClauses(contractId).then(existing => {
      if (cancelled) return;
      setClauses(existing);
      setLoadingExisting(false);
    });
    return () => { cancelled = true; };
  }, [contractId]);

  const canRun = counterpartyInput.trim().length > 0 && clauses.length > 0 && !running;

  async function runRound() {
    if (!canRun) return;
    setError('');
    setRunning(true);
    setLastMessage('');

    const result = await runNegotiateRound({
      contract_id: contractId,
      counterparty_input: counterpartyInput,
      profile,
      contract_type: contractType.trim() || undefined,
    });

    setRunning(false);
    if (!result.ok) {
      setError(result.error || 'Negotiate round failed');
      return;
    }

    setClauses(result.clauses);
    setRevisedNumbers(result.revised_clause_numbers);
    setMissingProfileWarning(result.missing_profile_warning);
    setLastMessage(
      result.revised_clause_numbers.length === 0
        ? 'No clauses required a change this round.'
        : `Revised clause(s): ${result.revised_clause_numbers.join(', ')}.`,
    );
    setCounterpartyInput('');
  }

  if (!loadingExisting && clauses.length === 0) {
    return (
      <p style={S.empty}>
        No clause register on file for this matter yet — run Draft or Review mode first.
      </p>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Contract Type (optional)</label>
        <input
          value={contractType}
          onChange={e => setContractType(e.target.value)}
          placeholder="e.g. Commercial Lease Agreement"
          style={S.inp}
          disabled={running}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Counterparty Input This Round *</label>
        <textarea
          value={counterpartyInput}
          onChange={e => setCounterpartyInput(e.target.value)}
          placeholder="Paste the counterparty's counter-proposal, redlines, or negotiation notes…"
          style={S.ta}
          disabled={running}
        />
      </div>

      <button
        type="button"
        onClick={runRound}
        disabled={!canRun}
        style={canRun ? S.btn : S.btnOff}
      >
        {running ? 'Drafting this round\u2019s positions…' : 'Run Negotiation Round'}
      </button>

      {error && <div style={{ marginTop: 14 }}><ErrorBanner message={error} /></div>}
      {lastMessage && !error && (
        <p style={{ ...S.hint, marginTop: 14 }}>{lastMessage}</p>
      )}
      {missingProfileWarning && <div style={{ marginTop: 14 }}><MissingProfileBanner message={missingProfileWarning} /></div>}

      <div style={{ marginTop: 20 }}>
        {loadingExisting ? (
          <p style={S.empty}>Loading clause register…</p>
        ) : (
          <ClauseRegisterView clauses={clauses} highlightNumbers={revisedNumbers} />
        )}
      </div>
    </div>
  );
}
