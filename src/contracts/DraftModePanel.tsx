/**
 * AFS Legal OS — Contract Engine — Draft Mode Panel
 *
 * Roadmap ref: 5b (Contract Engine — Dashboard Wiring)
 *
 * Wires the Draft-mode chain exactly as documented on ContractDashboard.tsx:
 *   ClientPositionProfileForm (2a) → Pass 0 (2b) → clause register (2c) →
 *   knowledge tiers (2d) → research checklist (2e) → flagging pass (2f)
 *
 * On mount, loads any clauses already on file for this contractId (resuming
 * a matter, or picking up after a page reload) so the register isn't lost.
 * "Generate Draft" always runs the full 2b→2f chain in sequence — each step
 * is a hard precondition for the next, same convention the engines
 * themselves use (see clauseRegister.ts / knowledgeTier.ts file headers).
 */

import React, { useEffect, useState } from 'react';
import { T, S } from '@/constants/tokens';
import { loadContractClauses } from '@/storage/helpers';
import { ClientPositionProfileForm } from './ClientPositionProfileForm';
import { runPass0, type Pass0Result } from './pass0';
import { runClauseRegisterGeneration } from './clauseRegister';
import { runKnowledgeTierResolution } from './knowledgeTier';
import { runResearchChecklistGeneration } from './researchChecklist';
import { runFlaggingPass } from './flaggingPass';
import { ClauseRegisterView, MissingProfileBanner, ErrorBanner } from './ClauseRegisterView';
import type { ClientPositionProfile, ContractClause } from './types';

type Stage = 'idle' | 'pass0' | 'clauses' | 'tiers' | 'checklist' | 'flagging' | 'done';

const STAGE_LABEL: Record<Exclude<Stage, 'idle' | 'done'>, string> = {
  pass0:      'Running Pass 0 — classifying contract type & jurisdiction…',
  clauses:    'Generating clause register…',
  tiers:      'Resolving knowledge tiers against the library…',
  checklist:  'Generating [RESEARCH NEEDED] checklists…',
  flagging:   'Running flagging pass…',
};

export interface DraftModePanelProps {
  contractId: string;
  profile: ClientPositionProfile | null;
  onProfileSaved: (profile: ClientPositionProfile) => void;
}

export function DraftModePanel({ contractId, profile, onProfileSaved }: DraftModePanelProps) {
  const [showProfileForm, setShowProfileForm] = useState(!profile);
  const [facts, setFacts]                     = useState('');
  const [contractTypeHint, setContractTypeHint] = useState('');

  const [pass0Result, setPass0Result] = useState<Pass0Result | null>(null);
  const [clauses, setClauses]         = useState<ContractClause[]>([]);
  const [missingProfileWarning, setMissingProfileWarning] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(true);

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

  const running = stage !== 'idle' && stage !== 'done';
  const canGenerate = facts.trim().length > 0 && !running;

  async function runDraftPipeline() {
    if (!canGenerate) return;
    setError('');
    setPass0Result(null);

    // 2b — Pass 0
    setStage('pass0');
    const p0 = await runPass0({
      contract_id: contractId,
      facts,
      contract_type_hint: contractTypeHint.trim() || undefined,
      profile,
    });
    setPass0Result(p0);
    if (!p0.ok) {
      setError(p0.error || 'Pass 0 failed');
      setStage('idle');
      return;
    }

    // 2c — clause register
    setStage('clauses');
    const registerResult = await runClauseRegisterGeneration({
      contract_id: contractId,
      facts,
      profile,
      pass0: p0,
    });
    if (!registerResult.ok) {
      setError(registerResult.error || 'Clause register generation failed');
      setStage('idle');
      return;
    }
    setClauses(registerResult.clauses);

    // 2d — knowledge tiers
    setStage('tiers');
    const tierResult = await runKnowledgeTierResolution({
      contract_id: contractId,
      contract_type: p0.contract_type,
    });
    if (!tierResult.ok) {
      setError(tierResult.error || 'Knowledge-tier resolution failed');
      setStage('idle');
      return;
    }
    setClauses(tierResult.clauses);

    // 2e — research checklist
    setStage('checklist');
    const checklistResult = await runResearchChecklistGeneration(contractId, p0.contract_type);
    if (!checklistResult.ok) {
      setError(checklistResult.error || 'Research checklist generation failed');
      setStage('idle');
      return;
    }
    setClauses(checklistResult.clauses);

    // 2f — flagging pass
    setStage('flagging');
    const flagResult = await runFlaggingPass(contractId, profile);
    if (!flagResult.ok) {
      setError(flagResult.error || 'Flagging pass failed');
      setStage('idle');
      return;
    }
    setClauses(flagResult.clauses);
    setMissingProfileWarning(flagResult.missing_profile_warning);

    setStage('done');
  }

  return (
    <div>
      {/* ── 2a — Client Position Profile ───────────────────────────────── */}
      <div style={{ marginBottom: 20, border: `1px solid ${T.bdrL}`, borderRadius: 5, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ ...S.h3, margin: 0 }}>Client Position Profile</p>
          <button
            type="button"
            onClick={() => setShowProfileForm(s => !s)}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
              borderRadius: 4, padding: '5px 12px', fontSize: 11, cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            {showProfileForm ? 'Hide' : profile ? 'Edit' : 'Add'}
          </button>
        </div>
        {!showProfileForm && profile && (
          <p style={{ ...S.hint, margin: '8px 0 0' }}>
            {profile.client_role} · {profile.risk_posture} risk posture
            {profile.priorities.length ? ` · priorities: ${profile.priorities.join(', ')}` : ''}
          </p>
        )}
        {!showProfileForm && !profile && (
          <p style={{ ...S.hint, margin: '8px 0 0' }}>No profile on file — optional, but improves drafting and flagging.</p>
        )}
        {showProfileForm && (
          <div style={{ marginTop: 12 }}>
            <ClientPositionProfileForm
              contractId={contractId}
              onSaved={(saved) => { onProfileSaved(saved); setShowProfileForm(false); }}
              onCancel={() => setShowProfileForm(false)}
            />
          </div>
        )}
      </div>

      {/* ── 2b/2c input — facts + contract type hint ───────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <label style={S.label}>Contract Type (optional hint)</label>
        <input
          value={contractTypeHint}
          onChange={e => setContractTypeHint(e.target.value)}
          placeholder="e.g. Commercial Lease Agreement"
          style={S.inp}
          disabled={running}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Facts *</label>
        <textarea
          value={facts}
          onChange={e => setFacts(e.target.value)}
          placeholder="Describe the deal — parties, terms, background, anything counsel knows so far…"
          style={S.ta}
          disabled={running}
        />
      </div>

      <button
        type="button"
        onClick={runDraftPipeline}
        disabled={!canGenerate}
        style={canGenerate ? S.btn : S.btnOff}
      >
        {running ? STAGE_LABEL[stage as Exclude<Stage, 'idle' | 'done'>] : clauses.length > 0 ? 'Regenerate Draft' : 'Generate Draft'}
      </button>

      {error && <div style={{ marginTop: 14 }}><ErrorBanner message={error} /></div>}

      {pass0Result?.ok && (
        <div style={{ marginTop: 16, padding: '10px 14px', background: T.card, border: `1px solid ${T.bdrL}`, borderRadius: 5 }}>
          <p style={{ ...S.hint, margin: 0 }}>
            <strong>{pass0Result.contract_type}</strong> · jurisdiction <strong>{pass0Result.candidate_jurisdiction}</strong>{' '}
            ({pass0Result.jurisdiction_confidence} confidence)
            {pass0Result.governing_law_library_hit && pass0Result.governing_law_summary
              ? ` · governing law on file: ${pass0Result.governing_law_summary}`
              : ''}
          </p>
        </div>
      )}

      {missingProfileWarning && <div style={{ marginTop: 16 }}><MissingProfileBanner message={missingProfileWarning} /></div>}

      <div style={{ marginTop: 20 }}>
        {loadingExisting ? (
          <p style={S.empty}>Loading clause register…</p>
        ) : (
          <ClauseRegisterView clauses={clauses} />
        )}
      </div>
    </div>
  );
}
