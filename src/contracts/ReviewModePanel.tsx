/**
 * AFS Legal OS — Contract Engine — Review Mode Panel
 *
 * Roadmap ref: 5b (Contract Engine — Dashboard Wiring)
 *
 * Wires the Review-mode chain exactly as documented on ContractDashboard.tsx:
 *   document ingest (3a/3b) → no-skim verification (3c) →
 *   2d/2e/2f re-routed (3d)
 *
 * runReviewAnalysis() (3d) already does the ingest-text → clause split →
 * 2d → 2e → 2f → no-skim sequencing internally, so this panel's job is just
 * collecting the upload + jurisdiction/contract-type inputs, calling
 * ingestContractDocument() (3a/3b dispatcher) then runReviewAnalysis(),
 * and rendering the result — no duplicate orchestration logic.
 *
 * Jurisdiction is a required input here (not inferred) per reviewAnalysis.ts's
 * file header — Review mode has no Pass-0 equivalent in the roadmap.
 */

import React, { useEffect, useRef, useState } from 'react';
import { T, S } from '@/constants/tokens';
import { loadContractClauses } from '@/storage/helpers';
import { ingestContractDocument, type DocumentIngestResult } from './reviewIngest';
import { runReviewAnalysis, type ReviewAnalysisResult } from './reviewAnalysis';
import { ClauseRegisterView, MissingProfileBanner, ErrorBanner } from './ClauseRegisterView';
import type { ClientPositionProfile, ContractClause } from './types';

export interface ReviewModePanelProps {
  contractId: string;
  profile: ClientPositionProfile | null;
}

export function ReviewModePanel({ contractId, profile }: ReviewModePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [jurisdiction, setJurisdiction] = useState('');
  const [contractType, setContractType] = useState('');

  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [result, setResult]   = useState<ReviewAnalysisResult | null>(null);
  const [ingestError, setIngestError] = useState('');
  const [stage, setStage] = useState<'idle' | 'ingesting' | 'analyzing' | 'done'>('idle');
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

  const running = stage === 'ingesting' || stage === 'analyzing';
  const canRun = !!file && jurisdiction.trim().length > 0 && !running;

  async function runReview() {
    if (!file || !canRun) return;
    setIngestError('');
    setResult(null);

    setStage('ingesting');
    const ingestResult: DocumentIngestResult = await ingestContractDocument(file);
    if (!ingestResult.ok) {
      setIngestError(ingestResult.error || 'Document ingestion failed');
      setStage('idle');
      return;
    }

    setStage('analyzing');
    const analysis = await runReviewAnalysis({
      contract_id: contractId,
      ingestResult,
      jurisdiction: jurisdiction.trim(),
      contract_type: contractType.trim() || undefined,
      profile,
    });
    setResult(analysis);
    if (!analysis.ok) {
      setIngestError(analysis.error || 'Review analysis failed');
      setStage('idle');
      return;
    }
    setClauses(analysis.clauses);
    setStage('done');
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Contract Document (PDF or .docx) *</label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          disabled={running}
          style={{ fontSize: 12, fontFamily: "'Times New Roman', Times, serif" }}
        />
        {file && <p style={{ ...S.hint, margin: '6px 0 0' }}>{file.name}</p>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Jurisdiction *</label>
        <input
          value={jurisdiction}
          onChange={e => setJurisdiction(e.target.value)}
          placeholder='e.g. "NG" or "NG-LA"'
          style={S.inp}
          disabled={running}
        />
        <p style={S.hint}>Whole-contract, not per-clause — Review mode doesn't infer this from the document.</p>
      </div>

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

      <button
        type="button"
        onClick={runReview}
        disabled={!canRun}
        style={canRun ? S.btn : S.btnOff}
      >
        {stage === 'ingesting' ? 'Extracting document text…'
          : stage === 'analyzing' ? 'Analysing — no-skim check, knowledge tiers, flagging…'
          : clauses.length > 0 ? 'Re-run Review' : 'Run Review'}
      </button>

      {ingestError && <div style={{ marginTop: 14 }}><ErrorBanner message={ingestError} /></div>}

      {result?.ok && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 5,
          background: result.no_skim.passed ? '#eef6ee' : '#fbf3e8',
          border: `1px solid ${result.no_skim.passed ? T.ok : T.warn}`,
        }}>
          <p style={{ fontSize: 12, margin: 0, color: result.no_skim.passed ? T.ok : T.warn, fontFamily: "'Times New Roman', Times, serif" }}>
            No-skim check: {result.no_skim.clause_count_out} of {result.no_skim.clause_count_in} clauses addressed.
            {result.no_skim.passed ? ' All clauses covered.' : ''}
          </p>
          {result.no_skim.warning && (
            <p style={{ fontSize: 12, margin: '6px 0 0', color: T.warn, fontFamily: "'Times New Roman', Times, serif" }}>
              {result.no_skim.warning}
            </p>
          )}
        </div>
      )}

      {result?.missing_profile_warning && <div style={{ marginTop: 16 }}><MissingProfileBanner message={result.missing_profile_warning} /></div>}

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
