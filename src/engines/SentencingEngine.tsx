/**
 * AFS Legal OS V2 — Sentencing Engine (Phase 6C)
 *
 * Dual-role criminal engine: activated after conviction (from Judgment) or
 * after a Guilty plea (from the Plea Engine).
 *
 * PROSECUTION sub-tabs:
 *   1. Conviction Record      — record counts convicted, acquitted, and sentence date
 *   2. Aggravating Factors    — AI-assisted aggravating factors builder per count
 *   3. Sentencing Address     — draft prosecution sentencing address/submissions
 *   4. Appeal Assessment      — appeal against acquittal or inadequate sentence
 *
 * DEFENCE sub-tabs:
 *   1. Conviction Record      — record findings per count, trigger allocutus workflow
 *   2. Allocutus Drafter      — personal circumstances, remorse, dependants, first offender
 *   3. Mitigation Address     — full mitigation address with AI-assisted Ogundipe factors
 *   4. Appeal Deadline        — ACJA appeal countdown + bail pending appeal trigger
 *
 * counsel_role governs which sub-tabs and AI prompts are active.
 * matter_track is always 'criminal' for this engine.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { loadBlindSpot, saveBlindSpot, saveDeadline } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type ProsSubTab = 'conviction_record_pros' | 'aggravating_factors' | 'sentencing_address' | 'appeal_assessment';
type DefSubTab  = 'conviction_record_def'  | 'allocutus_drafter'   | 'mitigation_address' | 'appeal_deadline';
type SubTab     = ProsSubTab | DefSubTab;

type CountFinding = 'Convicted' | 'Acquitted' | 'Pending';
type SentenceType = 'Custodial' | 'Fine' | 'Suspended' | 'Community Service' | 'Death' | 'Other';

interface ConvictionCount {
  id:        number;
  count:     string;
  offence:   string;
  section:   string;
  finding:   CountFinding;
  sentence:  string;   // e.g. "5 years IHL" or "₦500,000 fine"
}

interface AggravatingFactor {
  id:        number;
  category:  string;  // e.g. "Prior Convictions", "Harm to Victim", "Breach of Trust"
  detail:    string;
  weight:    'HIGH' | 'MEDIUM' | 'LOW';
}

interface MitigatingFactor {
  id:        number;
  category:  string;  // e.g. "First Offender", "Remorse", "Dependants", "Cooperation"
  detail:    string;
  weight:    'HIGH' | 'MEDIUM' | 'LOW';
}

interface SavedData {
  // Shared
  convictionCounts?:       ConvictionCount[];
  judgmentDate?:           string;
  sentenceDate?:           string;
  court?:                  string;
  // Prosecution
  aggravatingFactors?:     AggravatingFactor[];
  aggravatingContext?:     string;
  aggravatingResult?:      string;
  sentenceAddressContext?: string;
  sentenceAddressResult?:  string;
  sentenceType?:           SentenceType | '';
  sentenceSought?:         string;
  sentenceRecorded?:       string;
  prosAppealContext?:      string;
  prosAppealResult?:       string;
  // Defence
  mitigatingFactors?:      MitigatingFactor[];
  allocutusContext?:       string;
  allocutusResult?:        string;
  mitigationContext?:      string;
  mitigationResult?:       string;
  appealDeadlineDate?:     string;
  appealDeadlineNote?:     string;
  appealDeadlineSaved?:    boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEY
// ─────────────────────────────────────────────────────────────────────────────

const MODULE = 'sentencing_engine';

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Btn({
  label, onClick, loading = false, accent = '#c09030', off = false,
}: {
  label: string; onClick: () => void; loading?: boolean; accent?: string; off?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || off}
      style={{
        background: loading || off
          ? '#101018'
          : `linear-gradient(135deg,#000000,${accent})`,
        color:      loading || off ? '#2a2a38' : '#f0ece0',
        border: 'none', borderRadius: 6, padding: '11px 26px',
        fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
        cursor: loading || off ? 'not-allowed' : 'pointer',
        fontWeight: 600, letterSpacing: '.04em',
      }}
    >
      {loading ? '⟳ Working…' : label}
    </button>
  );
}

function ResultBlock({
  title, content, onClear, accent = '#c09030',
}: {
  title: string; content: string; onClear: () => void; accent?: string;
}) {
  return (
    <div style={{ marginTop: 18, background: '#08080e', border: `1px solid ${accent}30`, borderRadius: 8, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </span>
        <button onClick={onClear} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          clear ×
        </button>
      </div>
      <Md content={content} />
    </div>
  );
}

function SubTabBar({
  tabs, active, onSelect, accent,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  accent: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            background:   active === t.id ? `${accent}18` : 'transparent',
            border:       `1px solid ${active === t.id ? accent : '#1e1e2e'}`,
            color:        active === t.id ? accent : T.mute,
            borderRadius: 5, padding: '6px 14px',
            fontSize: 12, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif', letterSpacing: '.04em',
            transition: 'all .15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
      {text}
    </label>
  );
}

function Textarea({
  value, onChange, rows = 4, placeholder = '',
}: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#08080e', border: '1px solid #1e1e2e',
        borderRadius: 6, padding: '10px 14px', color: T.fg,
        fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
        resize: 'vertical', boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function Input({
  value, onChange, placeholder = '', type = 'text',
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#08080e', border: '1px solid #1e1e2e',
        borderRadius: 6, padding: '8px 12px', color: T.fg,
        fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
        boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function Select({
  value, onChange, options,
}: {
  value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: '#08080e', border: '1px solid #1e1e2e',
        borderRadius: 6, padding: '8px 12px', color: T.fg,
        fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
        outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SectionTitle({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ fontSize: 11, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14, borderBottom: `1px solid ${accent}20`, paddingBottom: 8 }}>
      {text}
    </div>
  );
}

function WeightBadge({ weight }: { weight: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const col = weight === 'HIGH' ? '#c05050' : weight === 'MEDIUM' ? '#c09030' : '#40a860';
  return (
    <span style={{ fontSize: 9, color: col, border: `1px solid ${col}40`, borderRadius: 3, padding: '1px 5px', fontFamily: 'Inter, sans-serif', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
      {weight}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVICTION COUNTS PANEL — shared between prosecution and defence records
// ─────────────────────────────────────────────────────────────────────────────

function ConvictionCountsPanel({
  counts, onUpdate, accent,
}: {
  counts: ConvictionCount[];
  onUpdate: (c: ConvictionCount[]) => void;
  accent: string;
}) {
  const addCount = () => {
    onUpdate([...counts, {
      id: Date.now(), count: `Count ${counts.length + 1}`,
      offence: '', section: '', finding: 'Pending', sentence: '',
    }]);
  };

  const update = (id: number, field: keyof ConvictionCount, val: string) => {
    onUpdate(counts.map(c => c.id === id ? { ...c, [field]: val } : c));
  };

  const remove = (id: number) => onUpdate(counts.filter(c => c.id !== id));

  return (
    <div>
      {counts.map(c => (
        <div key={c.id} style={{ background: '#0a0a14', border: `1px solid #1e1e2e`, borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
              <input
                value={c.count}
                onChange={e => update(c.id, 'count', e.target.value)}
                style={{ background: 'transparent', border: 'none', color: accent, fontSize: 13, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, outline: 'none', width: 100 }}
              />
              <Select
                value={c.finding}
                onChange={v => update(c.id, 'finding', v)}
                options={['Pending', 'Convicted', 'Acquitted']}
              />
            </div>
            <button onClick={() => remove(c.id)} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 13, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <Label text="Offence" />
              <Input value={c.offence} onChange={v => update(c.id, 'offence', v)} placeholder="e.g. Armed Robbery" />
            </div>
            <div>
              <Label text="Section / Law" />
              <Input value={c.section} onChange={v => update(c.id, 'section', v)} placeholder="e.g. s.1(2)(a) Robbery & Firearms Act" />
            </div>
          </div>
          <div>
            <Label text="Sentence Imposed (if convicted)" />
            <Input value={c.sentence} onChange={v => update(c.id, 'sentence', v)} placeholder="e.g. 10 years IHL without option of fine" />
          </div>
        </div>
      ))}
      <button
        onClick={addCount}
        style={{ background: 'transparent', border: `1px dashed ${accent}40`, borderRadius: 6, padding: '8px 20px', color: accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
      >
        + Add Count
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION — CONVICTION RECORD
// ─────────────────────────────────────────────────────────────────────────────

function ProsConvictionRecord({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const counts    = data.convictionCounts ?? [];
  const judgDate  = data.judgmentDate    ?? '';
  const sentDate  = data.sentenceDate    ?? '';
  const court     = data.court           ?? '';
  const sentType  = (data.sentenceType   ?? '') as SentenceType | '';
  const sentRec   = data.sentenceRecorded ?? '';

  return (
    <div>
      <SectionTitle text="Conviction Record — Prosecution" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Record the court's findings per count and the sentence imposed. This record anchors all downstream prosecution sentencing work.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div>
          <Label text="Court" />
          <Input value={court} onChange={v => onSave({ court: v })} placeholder="e.g. FHC Abuja" />
        </div>
        <div>
          <Label text="Judgment Date" />
          <Input type="date" value={judgDate} onChange={v => onSave({ judgmentDate: v })} />
        </div>
        <div>
          <Label text="Sentencing Date" />
          <Input type="date" value={sentDate} onChange={v => onSave({ sentenceDate: v })} />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Label text="Sentence Type" />
        <Select
          value={sentType}
          onChange={v => onSave({ sentenceType: v as SentenceType })}
          options={['', 'Custodial', 'Fine', 'Suspended', 'Community Service', 'Death', 'Other']}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <SectionTitle text="Findings Per Count" accent={accent} />
        <ConvictionCountsPanel
          counts={counts}
          onUpdate={c => onSave({ convictionCounts: c })}
          accent={accent}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <Label text="Overall Sentence Recorded" />
        <Textarea
          value={sentRec}
          onChange={v => onSave({ sentenceRecorded: v })}
          rows={3}
          placeholder="Record the full sentence as pronounced by the court…"
        />
      </div>

      {counts.filter(c => c.finding === 'Convicted').length > 0 && (
        <div style={{ background: `${accent}10`, border: `1px solid ${accent}30`, borderRadius: 8, padding: '14px 18px' }}>
          <div style={{ fontSize: 11, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            Conviction Summary
          </div>
          {counts.filter(c => c.finding === 'Convicted').map(c => (
            <div key={c.id} style={{ fontSize: 13, color: T.fg, fontFamily: "'Times New Roman', Times, serif", marginBottom: 6 }}>
              <span style={{ color: accent }}>{c.count}</span> — {c.offence} ({c.section}){c.sentence ? `: ${c.sentence}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION — AGGRAVATING FACTORS
// ─────────────────────────────────────────────────────────────────────────────

function AggravatingFactorsPanel({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const { call, loading, error, clearError } = useAI();
  const factors  = data.aggravatingFactors ?? [];
  const context  = data.aggravatingContext ?? '';
  const result   = data.aggravatingResult  ?? '';

  const CATEGORIES = [
    'Prior Convictions', 'Premeditation', 'Harm to Victim', 'Breach of Trust',
    'Organised Crime / Gang', 'Weapon Used', 'Vulnerability of Victim',
    'Multiple Offences', 'Obstruction of Justice', 'Value Involved', 'Other',
  ];

  const addFactor = () => {
    onSave({
      aggravatingFactors: [...factors, {
        id: Date.now(), category: CATEGORIES[0], detail: '', weight: 'MEDIUM',
      }],
    });
  };

  const updateFactor = (id: number, field: keyof AggravatingFactor, val: string) => {
    onSave({
      aggravatingFactors: factors.map(f => f.id === id ? { ...f, [field]: val } : f),
    });
  };

  const removeFactor = (id: number) => {
    onSave({ aggravatingFactors: factors.filter(f => f.id !== id) });
  };

  const buildAI = useCallback(async () => {
    const counts   = (data.convictionCounts ?? []).filter(c => c.finding === 'Convicted');
    const existing = factors.map(f => `${f.category}: ${f.detail}`).join('\n');
    const res = await call({
      system: `You are a Nigerian prosecution counsel preparing sentencing submissions. Identify and articulate aggravating factors under Nigerian sentencing jurisprudence. Apply relevant statutory provisions and sentencing authorities. Be specific and evidence-based.`,
      userMsg: `Matter: ${data.court || 'Criminal matter'}
Convicted on: ${counts.map(c => `${c.count} — ${c.offence} (${c.section})`).join('; ')}
Additional context: ${context}
Factors already identified: ${existing || 'None'}

Provide a structured analysis of all relevant aggravating factors for sentencing. For each factor: (1) identify the factor, (2) cite the evidential basis from the trial, (3) state its weight, (4) reference Nigerian sentencing authorities where applicable. Conclude with a recommended sentence range and the sentencing address strategy.`,
    });
    if (res) onSave({ aggravatingResult: res });
  }, [call, data, factors, context]);

  return (
    <div>
      <SectionTitle text="Aggravating Factors — Prosecution" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Build the aggravating factors register. Each factor strengthens the prosecution's sentencing address and supports a higher sentence. Add factors manually or use AI to analyse the trial record.
      </p>

      {factors.map(f => (
        <div key={f.id} style={{ background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <Label text="Category" />
              <Select
                value={f.category}
                onChange={v => updateFactor(f.id, 'category', v)}
                options={CATEGORIES}
              />
            </div>
            <div style={{ minWidth: 110 }}>
              <Label text="Weight" />
              <Select
                value={f.weight}
                onChange={v => updateFactor(f.id, 'weight', v as 'HIGH' | 'MEDIUM' | 'LOW')}
                options={['HIGH', 'MEDIUM', 'LOW']}
              />
            </div>
            <button onClick={() => removeFactor(f.id)} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 13, cursor: 'pointer', marginTop: 22 }}>×</button>
          </div>
          <Label text="Detail / Evidence Basis" />
          <Textarea value={f.detail} onChange={v => updateFactor(f.id, 'detail', v)} rows={2} placeholder="Describe the specific factual basis for this factor…" />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button
          onClick={addFactor}
          style={{ background: 'transparent', border: `1px dashed ${accent}40`, borderRadius: 6, padding: '8px 20px', color: accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
        >
          + Add Factor
        </button>
      </div>

      {factors.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <WeightBadge weight="HIGH" />
            <span style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif' }}>{factors.filter(f => f.weight === 'HIGH').length} HIGH · {factors.filter(f => f.weight === 'MEDIUM').length} MEDIUM · {factors.filter(f => f.weight === 'LOW').length} LOW</span>
          </div>
        </div>
      )}

      <SectionTitle text="AI Aggravating Analysis" accent={accent} />
      <Label text="Additional Trial Context" />
      <Textarea
        value={context}
        onChange={v => onSave({ aggravatingContext: v })}
        rows={3}
        placeholder="Add any additional context about the crime, victim impact, accused's conduct at trial, prior record, etc…"
      />
      <div style={{ marginTop: 12 }}>
        <Btn label="Analyse Aggravating Factors" onClick={buildAI} loading={loading} accent={accent} />
      </div>
      {error && <ErrorBlock message={error} onDismiss={clearError} />}
      {result && (
        <ResultBlock
          title="Aggravating Factors Analysis"
          content={result}
          onClear={() => onSave({ aggravatingResult: '' })}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION — SENTENCING ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

function SentencingAddressPanel({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const { call, loading, error, clearError } = useAI();
  const context     = data.sentenceAddressContext ?? '';
  const result      = data.sentenceAddressResult  ?? '';
  const sentSought  = data.sentenceSought          ?? '';

  const draft = useCallback(async () => {
    const counts    = (data.convictionCounts ?? []).filter(c => c.finding === 'Convicted');
    const factors   = (data.aggravatingFactors ?? []).map(f => `[${f.weight}] ${f.category}: ${f.detail}`).join('\n');
    const aiFactors = data.aggravatingResult ?? '';
    const res = await call({
      system: `You are a Nigerian prosecution counsel drafting sentencing submissions. Write in formal Nigerian legal style appropriate for a superior court of record. Apply Nigerian sentencing jurisprudence, ACJA 2015, and relevant statutory sentencing provisions. Structure the address formally.`,
      userMsg: `Matter: ${data.court || 'Criminal matter'}
Convicted on: ${counts.map(c => `${c.count} — ${c.offence} (${c.section})`).join('; ')}
Aggravating factors identified:
${factors || aiFactors || 'See analysis'}
Sentence sought: ${sentSought || 'Maximum under the law'}
Additional context: ${context}

Draft a comprehensive prosecution sentencing address in formal court style. Structure it as follows:
1. Introduction — counsel for prosecution
2. Convictions recorded
3. Aggravating factors (each with evidential basis)
4. Relevant authorities on sentencing tariff
5. Sentence sought and why it is appropriate
6. Closing
The address should be persuasive, evidence-based, and grounded in Nigerian law.`,
    });
    if (res) onSave({ sentenceAddressResult: res });
  }, [call, data, sentSought, context]);

  return (
    <div>
      <SectionTitle text="Prosecution Sentencing Address" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Draft the prosecution's address to the court on sentence. The AI will draw on all registered aggravating factors and the conviction record.
      </p>

      <div style={{ marginBottom: 16 }}>
        <Label text="Sentence Sought" />
        <Input
          value={sentSought}
          onChange={v => onSave({ sentenceSought: v })}
          placeholder="e.g. Maximum sentence of 21 years IHL under s.1(2)(a) Robbery & Firearms Act"
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Additional Submissions / Court Preferences / Precedents" />
        <Textarea
          value={context}
          onChange={v => onSave({ sentenceAddressContext: v })}
          rows={4}
          placeholder="Add any specific submissions, precedents you want emphasised, judge's known tendencies, or special aggravating circumstances not captured in the factors panel…"
        />
      </div>

      <Btn label="Draft Sentencing Address" onClick={draft} loading={loading} accent={accent} />
      {error && <ErrorBlock message={error} onDismiss={clearError} />}
      {result && (
        <ResultBlock
          title="Prosecution Sentencing Address"
          content={result}
          onClear={() => onSave({ sentenceAddressResult: '' })}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROSECUTION — APPEAL ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────

function ProsAppealAssessment({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const { call, loading, error, clearError } = useAI();
  const context = data.prosAppealContext ?? '';
  const result  = data.prosAppealResult  ?? '';

  const assess = useCallback(async () => {
    const counts    = data.convictionCounts ?? [];
    const acquitted = counts.filter(c => c.finding === 'Acquitted');
    const convicted = counts.filter(c => c.finding === 'Convicted');
    const res = await call({
      system: `You are a senior Nigerian prosecution counsel. Advise on whether to appeal an acquittal or inadequate sentence under Nigerian criminal appeal law. Apply ACJA 2015, Constitution of Nigeria, and relevant appellate jurisprudence.`,
      userMsg: `Matter: ${data.court || 'Criminal matter'}
Convicted on: ${convicted.map(c => `${c.count} — ${c.offence}: ${c.sentence}`).join('; ') || 'None'}
Acquitted on: ${acquitted.map(c => `${c.count} — ${c.offence}`).join('; ') || 'None'}
Sentence imposed: ${data.sentenceRecorded || 'Not recorded'}
Context: ${context}

Advise prosecution on:
1. Whether there are grounds to appeal against any acquittal — identify the specific legal errors
2. Whether the sentence imposed is manifestly inadequate — grounds for appeal against sentence
3. Time limit for prosecution appeal under ACJA and applicable rules
4. Prospects of success and recommended approach
5. Whether a cross-appeal is advisable if the defence appeals`,
    });
    if (res) onSave({ prosAppealResult: res });
  }, [call, data, context]);

  return (
    <div>
      <SectionTitle text="Prosecution Appeal Assessment" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Assess whether to appeal an acquittal or challenge an inadequate sentence. The AI will review the trial outcome and advise on grounds and prospects.
      </p>

      <div style={{ marginBottom: 16 }}>
        <Label text="Additional Context (Grounds You Are Considering)" />
        <Textarea
          value={context}
          onChange={v => onSave({ prosAppealContext: v })}
          rows={4}
          placeholder="Describe any specific errors of law or fact at trial, the sentence you sought vs what was imposed, any judicial misdirection, or constitutional issues…"
        />
      </div>

      <Btn label="Assess Appeal Grounds" onClick={assess} loading={loading} accent={accent} />
      {error && <ErrorBlock message={error} onDismiss={clearError} />}
      {result && (
        <ResultBlock
          title="Prosecution Appeal Assessment"
          content={result}
          onClear={() => onSave({ prosAppealResult: '' })}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE — CONVICTION RECORD
// ─────────────────────────────────────────────────────────────────────────────

function DefConvictionRecord({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const counts   = data.convictionCounts ?? [];
  const judgDate = data.judgmentDate    ?? '';
  const sentDate = data.sentenceDate    ?? '';
  const court    = data.court           ?? '';

  const convicted = counts.filter(c => c.finding === 'Convicted');

  return (
    <div>
      <SectionTitle text="Conviction Record — Defence" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Record the court's findings per count. On conviction, the allocutus and mitigation tabs activate. Appeal deadline counting begins from the date of conviction/sentence.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div>
          <Label text="Court" />
          <Input value={court} onChange={v => onSave({ court: v })} placeholder="e.g. FHC Lagos" />
        </div>
        <div>
          <Label text="Judgment Date" />
          <Input type="date" value={judgDate} onChange={v => onSave({ judgmentDate: v })} />
        </div>
        <div>
          <Label text="Sentencing Date" />
          <Input type="date" value={sentDate} onChange={v => onSave({ sentenceDate: v })} />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <SectionTitle text="Findings Per Count" accent={accent} />
        <ConvictionCountsPanel
          counts={counts}
          onUpdate={c => onSave({ convictionCounts: c })}
          accent={accent}
        />
      </div>

      {convicted.length > 0 && (
        <div style={{ background: '#180808', border: '1px solid #401818', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#c05050', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
            ⚠ Conviction Confirmed — Immediate Actions Required
          </div>
          <div style={{ fontSize: 13, color: T.fg, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>
            {convicted.map(c => (
              <div key={c.id} style={{ marginBottom: 4 }}>
                <span style={{ color: accent }}>{c.count}</span> — {c.offence}: {c.sentence || 'Sentence pending'}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: '#c09030', fontFamily: 'Inter, sans-serif' }}>
            → Prepare allocutus immediately. → Calculate ACJA appeal deadline. → Consider bail pending appeal.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE — ALLOCUTUS DRAFTER
// ─────────────────────────────────────────────────────────────────────────────

function AllocutusDrafter({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const { call, loading, error, clearError } = useAI();
  const context = data.allocutusContext ?? '';
  const result  = data.allocutusResult  ?? '';

  const MITIGATING = [
    'First Offender', 'Young Offender', 'Remorse Expressed', 'Plea of Guilty',
    'Cooperation with Authorities', 'Full Restitution', 'Dependants / Family Hardship',
    'Medical Condition', 'Community Standing', 'Length of Pre-Trial Detention',
    'Minimal Role in Offence', 'Provocation', 'Other',
  ];

  const factors   = data.mitigatingFactors ?? [];

  const addFactor = () => {
    onSave({
      mitigatingFactors: [...factors, {
        id: Date.now(), category: MITIGATING[0], detail: '', weight: 'MEDIUM',
      }],
    });
  };

  const updateFactor = (id: number, field: keyof MitigatingFactor, val: string) => {
    onSave({
      mitigatingFactors: factors.map(f => f.id === id ? { ...f, [field]: val } : f),
    });
  };

  const removeFactor = (id: number) => {
    onSave({ mitigatingFactors: factors.filter(f => f.id !== id) });
  };

  const draftAllocutus = useCallback(async () => {
    const convicted = (data.convictionCounts ?? []).filter(c => c.finding === 'Convicted');
    const fList     = factors.map(f => `${f.category}: ${f.detail}`).join('\n');
    const res = await call({
      system: `You are a Nigerian defence counsel preparing an allocutus (plea in mitigation) for delivery in open court after conviction. The allocutus is a formal court address. It must be dignified, factual, and persuasive. Do not include admissions of guilt beyond what is already established by the conviction. Apply Nigerian sentencing mitigation principles including the Ogundipe factors and totality principle.`,
      userMsg: `Accused context: ${context}
Convicted on: ${convicted.map(c => `${c.count} — ${c.offence}`).join('; ')}
Mitigating factors:
${fList || 'Not yet specified'}

Draft a formal allocutus for delivery in court. Structure as:
1. Introduction — counsel appearing for the accused
2. Personal circumstances of the accused (age, family, occupation, health, community ties)
3. Each mitigating factor with supporting detail
4. First-offender status (if applicable) and relevant authorities
5. Prayer for leniency with specific sentence sought
6. Closing statement
The allocutus must be court-ready and deliverable as-is by defence counsel.`,
    });
    if (res) onSave({ allocutusResult: res });
  }, [call, data, factors, context]);

  return (
    <div>
      <SectionTitle text="Allocutus Drafter — Defence" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        An allocutus is the defence counsel's formal plea to the court on behalf of the accused after conviction. Build the mitigating factors register and draft the allocutus.
      </p>

      <div style={{ marginBottom: 20 }}>
        <Label text="Accused's Personal Circumstances" />
        <Textarea
          value={context}
          onChange={v => onSave({ allocutusContext: v })}
          rows={4}
          placeholder="Age, occupation, family situation, number of dependants, health condition, community standing, length of pre-trial detention, cooperation with police, any restitution made, remorse shown…"
        />
      </div>

      <SectionTitle text="Mitigating Factors" accent={accent} />

      {factors.map(f => (
        <div key={f.id} style={{ background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <Label text="Category" />
              <Select
                value={f.category}
                onChange={v => updateFactor(f.id, 'category', v)}
                options={MITIGATING}
              />
            </div>
            <div style={{ minWidth: 110 }}>
              <Label text="Weight" />
              <Select
                value={f.weight}
                onChange={v => updateFactor(f.id, 'weight', v as 'HIGH' | 'MEDIUM' | 'LOW')}
                options={['HIGH', 'MEDIUM', 'LOW']}
              />
            </div>
            <button onClick={() => removeFactor(f.id)} style={{ background: 'transparent', border: 'none', color: T.mute, fontSize: 13, cursor: 'pointer', marginTop: 22 }}>×</button>
          </div>
          <Label text="Supporting Detail" />
          <Textarea value={f.detail} onChange={v => updateFactor(f.id, 'detail', v)} rows={2} placeholder="Specific facts supporting this factor…" />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button
          onClick={addFactor}
          style={{ background: 'transparent', border: `1px dashed ${accent}40`, borderRadius: 6, padding: '8px 20px', color: accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
        >
          + Add Mitigating Factor
        </button>
      </div>

      <Btn label="Draft Allocutus" onClick={draftAllocutus} loading={loading} accent={accent} />
      {error && <ErrorBlock message={error} onDismiss={clearError} />}
      {result && (
        <ResultBlock
          title="Allocutus — Ready for Delivery"
          content={result}
          onClear={() => onSave({ allocutusResult: '' })}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE — MITIGATION ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

function MitigationAddress({
  data, onSave, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  accent: string;
}) {
  const { call, loading, error, clearError } = useAI();
  const context = data.mitigationContext ?? '';
  const result  = data.mitigationResult  ?? '';

  const draft = useCallback(async () => {
    const convicted = (data.convictionCounts ?? []).filter(c => c.finding === 'Convicted');
    const factors   = (data.mitigatingFactors ?? []).map(f => `[${f.weight}] ${f.category}: ${f.detail}`).join('\n');
    const accCtx    = data.allocutusContext ?? '';
    const res = await call({
      system: `You are a senior Nigerian defence counsel drafting written mitigation submissions after conviction. This is a formal legal document submitted to the court. Apply Nigerian sentencing mitigation jurisprudence including the Ogundipe factors (from Ogundipe v. State), totality principle, principle against crushing sentences, and constitutional right to fair sentencing. Cite Nigerian authorities on sentence mitigation.`,
      userMsg: `Matter: ${data.court || 'Criminal matter'}
Convicted on: ${convicted.map(c => `${c.count} — ${c.offence} (${c.section}): ${c.sentence}`).join('; ')}
Accused's circumstances: ${accCtx || 'See allocutus drafter'}
Mitigating factors:
${factors || 'See allocutus drafter'}
Additional submissions: ${context}

Draft comprehensive written mitigation submissions. Structure as:
1. Introduction
2. The Ogundipe Factors — address each applicable factor
3. Personal circumstances of the accused in detail
4. Totality principle — if multiple counts
5. Relevant Nigerian authorities on sentencing mitigation
6. Alternative sentencing options (suspended sentence, non-custodial if available)
7. Relief sought — specific sentence proposed
8. Conclusion
This document is a standalone formal court submission, not just an allocutus.`,
    });
    if (res) onSave({ mitigationResult: res });
  }, [call, data, context]);

  return (
    <div>
      <SectionTitle text="Mitigation Address — Defence" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Draft the full written mitigation address applying the Ogundipe factors and Nigerian sentencing authorities. This is a standalone court submission distinct from the oral allocutus.
      </p>

      <div style={{ marginBottom: 16 }}>
        <Label text="Additional Submissions / Precedents / Special Circumstances" />
        <Textarea
          value={context}
          onChange={v => onSave({ mitigationContext: v })}
          rows={5}
          placeholder="Add specific Nigerian cases you want cited, any constitutional arguments on sentencing, parity arguments (co-accused received a lesser sentence), or any exceptional circumstances…"
        />
      </div>

      <Btn label="Draft Mitigation Address" onClick={draft} loading={loading} accent={accent} />
      {error && <ErrorBlock message={error} onDismiss={clearError} />}
      {result && (
        <ResultBlock
          title="Mitigation Address — Defence Submissions"
          content={result}
          onClear={() => onSave({ mitigationResult: '' })}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFENCE — APPEAL DEADLINE
// ─────────────────────────────────────────────────────────────────────────────

function AppealDeadlinePanel({
  data, onSave, caseId, accent,
}: {
  data: SavedData;
  onSave: (patch: Partial<SavedData>) => void;
  caseId: string;
  accent: string;
}) {
  const { call, loading, error, clearError } = useAI();
  const deadlineDate = data.appealDeadlineDate ?? '';
  const deadlineNote = data.appealDeadlineNote ?? '';
  const saved        = data.appealDeadlineSaved ?? false;

  // Auto-compute 30-day appeal deadline from sentence date
  const sentDate = data.sentenceDate ?? data.judgmentDate ?? '';
  const autoDeadline = React.useMemo(() => {
    if (!sentDate) return '';
    const d = new Date(sentDate);
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  }, [sentDate]);

  const [aiResult, setAiResult] = React.useState('');

  const analyseAppeal = useCallback(async () => {
    const convicted = (data.convictionCounts ?? []).filter(c => c.finding === 'Convicted');
    const res = await call({
      system: `You are a senior Nigerian defence counsel advising on criminal appeal after conviction. Apply ACJA 2015, Court of Appeal Rules, Supreme Court Rules, and relevant constitutional provisions on criminal appeal rights.`,
      userMsg: `Convicted on: ${convicted.map(c => `${c.count} — ${c.offence} (${c.section}): ${c.sentence}`).join('; ')}
Sentence date: ${data.sentenceDate || data.judgmentDate || 'Not recorded'}
Court: ${data.court || 'Not recorded'}

Advise the defence on:
1. ACJA 2015 appeal deadline — exact days from conviction/sentence
2. Which court has jurisdiction to hear the appeal (based on the court of first instance)
3. Grounds of appeal available — against conviction and/or sentence
4. Bail pending appeal under ACJA — grounds and procedure
5. Records to compile for the appeal
6. Immediate steps to take today
7. Any constitutional arguments on the conviction or sentence`,
    });
    if (res) setAiResult(res);
  }, [call, data]);

  const saveToDeadlines = useCallback(async () => {
    const dl = deadlineDate || autoDeadline;
    if (!dl) return;
    await saveDeadline({
      id:          `sent_appeal_${Date.now()}`,
      label:       'Appeal Deadline — Notice of Appeal',
      date:        dl,
      type:        'Appeal Window',
      status:      'Active',
      notes:       deadlineNote || 'ACJA criminal appeal deadline. File Notice of Appeal immediately.',
      aiGenerated: false,
      caseId,
    });
    onSave({ appealDeadlineSaved: true });
  }, [deadlineDate, autoDeadline, deadlineNote, caseId, onSave]);

  const daysRemaining = React.useMemo(() => {
    const dl = deadlineDate || autoDeadline;
    if (!dl) return null;
    const diff = Math.ceil((new Date(dl).getTime() - Date.now()) / 86400000);
    return diff;
  }, [deadlineDate, autoDeadline]);

  return (
    <div>
      <SectionTitle text="Appeal Deadline & Bail Pending Appeal" accent={accent} />
      <p style={{ fontSize: 13, color: T.mute, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        The appeal deadline runs from the date of conviction or sentence. Track it here, save it to the Deadline Engine, and assess bail pending appeal under ACJA 2015.
      </p>

      {sentDate && (
        <div style={{ background: '#081808', border: '1px solid #204020', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#40a860', fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            Auto-Calculated Deadline
          </div>
          <div style={{ fontSize: 22, color: '#40a860', fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 }}>
            {autoDeadline}
          </div>
          <div style={{ fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif', marginTop: 4 }}>
            30 days from sentence date ({sentDate})
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <Label text="Appeal Deadline Date (Confirm or Override)" />
          <Input type="date" value={deadlineDate} onChange={v => onSave({ appealDeadlineDate: v })} />
        </div>
        {daysRemaining !== null && (
          <div style={{ display: 'flex', alignItems: 'center', paddingTop: 22 }}>
            <span style={{
              fontSize: 18, fontWeight: 700,
              color: daysRemaining <= 7 ? '#c05050' : daysRemaining <= 14 ? '#c09030' : '#40a860',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              {daysRemaining < 0 ? '⚠ EXPIRED' : `${daysRemaining} days remaining`}
            </span>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label text="Deadline Notes" />
        <Input
          value={deadlineNote}
          onChange={v => onSave({ appealDeadlineNote: v })}
          placeholder="e.g. Client to bring all trial documents by Wednesday. Brief counsel for appeal."
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Btn
          label={saved ? '✓ Saved to Deadlines' : 'Save to Deadline Engine'}
          onClick={saveToDeadlines}
          accent={accent}
          off={saved || (!deadlineDate && !autoDeadline)}
        />
        <Btn label="Analyse Appeal Grounds" onClick={analyseAppeal} loading={loading} accent={accent} />
      </div>

      {error && <ErrorBlock message={error} onDismiss={clearError} />}

      {aiResult && (
        <ResultBlock
          title="Appeal Assessment — Defence"
          content={aiResult}
          onClear={() => setAiResult('')}
          accent={accent}
        />
      )}

      <div style={{ marginTop: 24, background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 8, padding: '16px 18px' }}>
        <div style={{ fontSize: 11, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
          Immediate Post-Conviction Checklist
        </div>
        {[
          'Advise client of conviction and sentence immediately',
          'Calculate appeal deadline from today — 30 days under ACJA',
          'File Notice of Appeal within time — do not let deadline lapse',
          'Apply for bail pending appeal — grounds: arguable grounds of appeal + custodial sentence',
          'Compile records for appeal — charge, proceedings, judgment, sentence ruling',
          'Obtain full typed record of proceedings from court registry',
          'Advise client not to dispose of assets pending appeal',
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 13, color: T.fg, fontFamily: "'Times New Roman', Times, serif" }}>
            <span style={{ color: accent, minWidth: 18 }}>{i + 1}.</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function SentencingEngine({ activeCase }: Props) {
  const role   = activeCase.counsel_role ?? 'prosecution';
  const isPros = role === 'prosecution';

  const accent = COUNSEL_ROLE_COLORS[role]?.col ?? '#c09030';

  const PROS_TABS: { id: ProsSubTab; label: string }[] = [
    { id: 'conviction_record_pros', label: 'Conviction Record' },
    { id: 'aggravating_factors',    label: 'Aggravating Factors' },
    { id: 'sentencing_address',     label: 'Sentencing Address' },
    { id: 'appeal_assessment',      label: 'Appeal Assessment' },
  ];

  const DEF_TABS: { id: DefSubTab; label: string }[] = [
    { id: 'conviction_record_def', label: 'Conviction Record' },
    { id: 'allocutus_drafter',     label: 'Allocutus' },
    { id: 'mitigation_address',    label: 'Mitigation Address' },
    { id: 'appeal_deadline',       label: 'Appeal Deadline' },
  ];

  const tabs    = isPros ? PROS_TABS : DEF_TABS;
  const firstId = isPros ? 'conviction_record_pros' : 'conviction_record_def';

  const [activeTab, setActiveTab] = useState<SubTab>(firstId);
  const [data, setData]           = useState<SavedData>({});
  const [hydrated, setHydrated]   = useState(false);

  // Load persisted data
  useEffect(() => {
    loadBlindSpot<SavedData>(activeCase.id, MODULE, {}).then(saved => {
      setData(saved);
      setHydrated(true);
    });
  }, [activeCase.id]);

  // Persist on every change
  const save = useCallback(async (patch: Partial<SavedData>) => {
    setData(prev => {
      const next = { ...prev, ...patch };
      saveBlindSpot(activeCase.id, MODULE, next);
      return next;
    });
  }, [activeCase.id]);

  if (!hydrated) {
    return (
      <div style={{ padding: 40, color: T.mute, fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
        Loading sentencing data…
      </div>
    );
  }

  // Warn if not criminal track
  if (activeCase.matter_track && activeCase.matter_track !== 'criminal') {
    return (
      <div style={{ padding: 40, color: T.mute, fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
        The Sentencing Engine is only available on criminal matters.
      </div>
    );
  }

  const convicted = (data.convictionCounts ?? []).filter(c => c.finding === 'Convicted');

  return (
    <div style={{ padding: '32px 28px', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: accent, fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
            {isPros ? 'Prosecution' : 'Defence'} · Sentencing Engine
          </span>
          {convicted.length > 0 && (
            <span style={{ fontSize: 10, color: '#c05050', border: '1px solid #401818', borderRadius: 3, padding: '2px 8px', fontFamily: 'Inter, sans-serif', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
              {convicted.length} Count{convicted.length !== 1 ? 's' : ''} Convicted
            </span>
          )}
        </div>
        <div style={{ fontSize: 22, color: T.fg, fontFamily: "'Times New Roman', Times, serif", fontWeight: 700, marginBottom: 6 }}>
          {isPros ? 'Sentencing Submissions' : 'Allocutus & Mitigation'}
        </div>
        <div style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter, sans-serif' }}>
          {isPros
            ? 'Build aggravating factors, draft the prosecution sentencing address, and assess appeal options.'
            : 'Draft the allocutus, build mitigation submissions, and track the ACJA appeal deadline.'}
        </div>
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={tabs as { id: string; label: string }[]}
        active={activeTab}
        onSelect={id => setActiveTab(id as SubTab)}
        accent={accent}
      />

      {/* Panel routing */}
      {isPros ? (
        <>
          {activeTab === 'conviction_record_pros' && (
            <ProsConvictionRecord data={data} onSave={save} accent={accent} />
          )}
          {activeTab === 'aggravating_factors' && (
            <AggravatingFactorsPanel data={data} onSave={save} accent={accent} />
          )}
          {activeTab === 'sentencing_address' && (
            <SentencingAddressPanel data={data} onSave={save} accent={accent} />
          )}
          {activeTab === 'appeal_assessment' && (
            <ProsAppealAssessment data={data} onSave={save} accent={accent} />
          )}
        </>
      ) : (
        <>
          {activeTab === 'conviction_record_def' && (
            <DefConvictionRecord data={data} onSave={save} accent={accent} />
          )}
          {activeTab === 'allocutus_drafter' && (
            <AllocutusDrafter data={data} onSave={save} accent={accent} />
          )}
          {activeTab === 'mitigation_address' && (
            <MitigationAddress data={data} onSave={save} accent={accent} />
          )}
          {activeTab === 'appeal_deadline' && (
            <AppealDeadlinePanel data={data} onSave={save} caseId={activeCase.id} accent={accent} />
          )}
        </>
      )}
    </div>
  );
}
