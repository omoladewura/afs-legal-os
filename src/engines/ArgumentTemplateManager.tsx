/**
 * AFS Legal OS — Argument Template Manager
 * Trial Engine Consolidation, Phase 2C.
 *
 * Three tabs:
 *   Tab 1 — Templates Library : browse, edit, delete saved templates
 *   Tab 2 — New Template      : pull law delta → AI-draft skeleton → save
 *   Tab 3 — Apply to Case     : select template + facts → merge draft → hand off
 *
 * Templates are global (not scoped to a case) — one ArgumentTemplate can be
 * reused across every matter of the same appType/jurisdiction/court_level.
 * The active case (passed as optional prop) is only needed in Tab 3 for
 * "Apply to Case" and for injecting court/jurisdiction into the delta preview.
 *
 * Storage: db.argument_templates via loadArgumentTemplates / saveArgumentTemplate /
 *          deleteArgumentTemplate in src/storage/helpers.ts.
 * Law delta: getJurisdictionDelta() from src/law/registry.ts (synchronous).
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Case } from '@/types';
import type { ArgumentTemplate } from '@/storage/db';
import { T, S } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import {
  loadArgumentTemplates,
  saveArgumentTemplate,
  deleteArgumentTemplate,
  uid,
} from '@/storage/helpers';
import { getJurisdictionDelta } from '@/law/registry';
import { APP_TYPES, type AppTypeConfig } from './ApplicationsEngine';
import { Md, ErrorBlock, TypeDeleteModal, toast } from '@/components/common/ui';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** If provided, pre-populates court field in New Template and enables Apply tab. */
  activeCase?: Case;
  /** Optional callback when "Use in Current Case" is triggered in Tab 3. */
  onApplyDraft?: (draft: string, appType: AppTypeConfig) => void;
}

type MainTab = 'library' | 'new' | 'apply';

interface FormState {
  appTypeId:   string;
  jurisdiction: string;
  court_level:  string;
  skeleton:     string;
  statutory_basis:     string;
  leading_authorities: string;
  tests:               string;
  law_delta:           string;
}

const EMPTY_FORM: FormState = {
  appTypeId:            '',
  jurisdiction:         '',
  court_level:          '',
  skeleton:             '',
  statutory_basis:      '',
  leading_authorities:  '',
  tests:                '',
  law_delta:            '',
};

const COURT_LEVELS = [
  'Supreme Court',
  'Court of Appeal',
  'Federal High Court',
  'High Court',
  'Magistrate Court',
  'Customary Court of Appeal',
  'Sharia Court of Appeal',
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function completeness(t: ArgumentTemplate): number {
  const fields = [t.skeleton, t.statutory_basis, t.leading_authorities, t.tests, t.law_delta];
  const filled = fields.filter(f => f && f.trim().length > 20).length;
  return Math.round((filled / fields.length) * 100);
}

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function resolvedAppType(id: string): AppTypeConfig | undefined {
  return APP_TYPES.find(a => a.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ArgumentTemplateManager({ activeCase, onApplyDraft }: Props) {
  const [tab, setTab] = useState<MainTab>('library');

  // shared template list
  const [templates, setTemplates] = useState<ArgumentTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // editing an existing template opens the "new" form pre-populated
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const all = await loadArgumentTemplates();
      setTemplates(all);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // When an edit is requested: load the template into the form and switch tab
  const handleEdit = useCallback((t: ArgumentTemplate) => {
    setEditingId(t.id);
    setTab('new');
  }, []);

  const handleSaved = useCallback(() => {
    setEditingId(null);
    reload();
    setTab('library');
  }, [reload]);

  // ── Tab nav ───────────────────────────────────────────────────────────────

  const tabs: Array<{ id: MainTab; label: string }> = [
    { id: 'library', label: 'Templates Library' },
    { id: 'new',     label: editingId ? 'Edit Template' : 'New Template' },
    { id: 'apply',   label: 'Apply to Case' },
  ];

  return (
    <div style={{ fontFamily: "'Times New Roman', Times, serif", color: T.text }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${T.bdr}`, paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ ...S.h1, marginTop: 0, borderBottom: 'none', paddingBottom: 0 }}>
          Argument Template Manager
        </h1>
        <p style={{ ...S.hint, margin: 0 }}>
          Build reusable argument skeletons for recurring application types.
          Templates cut drafting cost by 40–60% — only case-specific facts change each time.
        </p>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.bdr}`, marginBottom: 24 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); if (t.id !== 'new') setEditingId(null); }}
            style={{
              background:    tab === t.id ? '#ffffff' : T.card,
              border:        `1px solid ${T.bdr}`,
              borderBottom:  tab === t.id ? '1px solid #ffffff' : `1px solid ${T.bdr}`,
              marginBottom:  tab === t.id ? -1 : 0,
              padding:       '8px 18px',
              fontSize:      12,
              fontFamily:    "'Times New Roman', Times, serif",
              fontWeight:    tab === t.id ? 700 : 400,
              cursor:        'pointer',
              color:         tab === t.id ? T.text : T.dim,
              letterSpacing: '.04em',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'library' && (
        <LibraryTab
          templates={templates}
          loading={loadingTemplates}
          onEdit={handleEdit}
          onDeleted={reload}
        />
      )}
      {tab === 'new' && (
        <NewTemplateTab
          editingTemplate={editingId ? templates.find(t => t.id === editingId) ?? null : null}
          activeCase={activeCase}
          onSaved={handleSaved}
          onCancel={() => { setEditingId(null); setTab('library'); }}
        />
      )}
      {tab === 'apply' && (
        <ApplyTab
          templates={templates}
          activeCase={activeCase}
          onApplyDraft={onApplyDraft}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

function LibraryTab({
  templates, loading, onEdit, onDeleted,
}: {
  templates: ArgumentTemplate[];
  loading:   boolean;
  onEdit:    (t: ArgumentTemplate) => void;
  onDeleted: () => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ArgumentTemplate | null>(null);
  const [expanded, setExpanded]         = useState<string | null>(null);

  if (loading) {
    return <p style={S.hint}>Loading templates…</p>;
  }

  if (templates.length === 0) {
    return (
      <div style={{
        background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 4,
        padding: '32px 24px', textAlign: 'center',
      }}>
        <p style={{ ...S.hint, marginBottom: 8 }}>No templates saved yet.</p>
        <p style={{ ...S.hint, margin: 0, color: T.mute }}>
          Go to <em>New Template</em> to create your first reusable argument skeleton.
        </p>
      </div>
    );
  }

  // Group by appType
  const grouped = templates.reduce<Record<string, ArgumentTemplate[]>>((acc, t) => {
    (acc[t.appType] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div>
      {Object.entries(grouped).map(([appType, group]) => (
        <div key={appType} style={{ marginBottom: 28 }}>
          <h2 style={S.h2}>{appType}</h2>
          {group.map(t => {
            const pct  = completeness(t);
            const open = expanded === t.id;
            return (
              <div
                key={t.id}
                style={{
                  border: `1px solid ${T.bdr}`, borderRadius: 4,
                  marginBottom: 8, background: '#ffffff',
                }}
              >
                {/* Row header */}
                <div
                  onClick={() => setExpanded(open ? null : t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', cursor: 'pointer', gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>
                      {t.jurisdiction}
                    </span>
                    <span style={{ fontSize: 12, color: T.dim, marginLeft: 10 }}>
                      {t.court_level}
                    </span>
                  </div>
                  <CompletenessBar pct={pct} />
                  <span style={{ fontSize: 11, color: T.mute, flexShrink: 0 }}>
                    {fmt(t.created_at)}
                  </span>
                  <span style={{ fontSize: 11, color: T.dim }}>{open ? '▲' : '▼'}</span>
                </div>

                {/* Expanded detail */}
                {open && (
                  <div style={{ borderTop: `1px solid ${T.bdrL}`, padding: '14px 16px' }}>
                    <TemplateDetail template={t} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        onClick={() => onEdit(t)}
                        style={{ ...ghostBtn, color: T.info }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        style={{ ...ghostBtn, color: T.err }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {deleteTarget && (
        <TypeDeleteModal
          label={`"${deleteTarget.appType} — ${deleteTarget.jurisdiction}"`}
          onConfirm={async () => {
            await deleteArgumentTemplate(deleteTarget.id);
            toast.show(`Template deleted.`, 'ok');
            setDeleteTarget(null);
            onDeleted();
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function CompletenessBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? T.ok : pct >= 50 ? T.warn : T.err;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <div style={{
        width: 60, height: 4, background: T.bdrL, borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700 }}>{pct}%</span>
    </div>
  );
}

function TemplateDetail({ template: t }: { template: ArgumentTemplate }) {
  return (
    <div>
      {t.statutory_basis && (
        <div style={{ marginBottom: 10 }}>
          <span style={S.label}>Statutory Basis</span>
          <p style={{ ...S.p, margin: 0, fontSize: 13 }}>{t.statutory_basis}</p>
        </div>
      )}
      {t.leading_authorities && (
        <div style={{ marginBottom: 10 }}>
          <span style={S.label}>Leading Authorities</span>
          <p style={{ ...S.p, margin: 0, fontSize: 13 }}>{t.leading_authorities}</p>
        </div>
      )}
      {t.tests && (
        <div style={{ marginBottom: 10 }}>
          <span style={S.label}>Applicable Tests</span>
          <p style={{ ...S.p, margin: 0, fontSize: 13 }}>{t.tests}</p>
        </div>
      )}
      {t.skeleton && (
        <div style={{ marginBottom: 10 }}>
          <span style={S.label}>Argument Skeleton</span>
          <div style={{
            background: T.card, border: `1px solid ${T.bdrL}`,
            borderRadius: 3, padding: '10px 12px', maxHeight: 240, overflowY: 'auto',
          }}>
            <Md text={t.skeleton} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — NEW / EDIT TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

function NewTemplateTab({
  editingTemplate, activeCase, onSaved, onCancel,
}: {
  editingTemplate: ArgumentTemplate | null;
  activeCase?:     Case;
  onSaved:         () => void;
  onCancel:        () => void;
}) {
  const ai = useAI();

  const [form, setForm] = useState<FormState>(() => {
    if (editingTemplate) {
      const at = APP_TYPES.find(a => a.label === editingTemplate.appType);
      return {
        appTypeId:            at?.id ?? '',
        jurisdiction:         editingTemplate.jurisdiction,
        court_level:          editingTemplate.court_level,
        skeleton:             editingTemplate.skeleton,
        statutory_basis:      editingTemplate.statutory_basis,
        leading_authorities:  editingTemplate.leading_authorities,
        tests:                editingTemplate.tests,
        law_delta:            editingTemplate.law_delta,
      };
    }
    return {
      ...EMPTY_FORM,
      jurisdiction: activeCase?.court ?? '',
    };
  });

  // Reset form when editingTemplate changes (user clicks edit on a different template)
  useEffect(() => {
    if (editingTemplate) {
      const at = APP_TYPES.find(a => a.label === editingTemplate.appType);
      setForm({
        appTypeId:            at?.id ?? '',
        jurisdiction:         editingTemplate.jurisdiction,
        court_level:          editingTemplate.court_level,
        skeleton:             editingTemplate.skeleton,
        statutory_basis:      editingTemplate.statutory_basis,
        leading_authorities:  editingTemplate.leading_authorities,
        tests:                editingTemplate.tests,
        law_delta:            editingTemplate.law_delta,
      });
    }
  }, [editingTemplate]);

  const [saving, setSaving]       = useState(false);
  const [error,  setError]        = useState('');

  const set = (k: keyof FormState, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  const selectedType = resolvedAppType(form.appTypeId);

  // ── Pull from Registry ────────────────────────────────────────────────────

  const handlePullRegistry = useCallback(() => {
    if (!selectedType || !form.jurisdiction) return;
    const delta = getJurisdictionDelta(selectedType.label, form.jurisdiction);
    if (!delta) {
      toast.show('No jurisdiction-specific rules found for this combination. Try refining the court field.', 'warn');
      return;
    }
    set('law_delta', delta);
    toast.show('Law delta pulled from registry.', 'ok');
  }, [selectedType, form.jurisdiction]);

  // ── AI-Draft Skeleton ─────────────────────────────────────────────────────

  const handleAIDraft = useCallback(async () => {
    if (!selectedType) return;
    setError('');

    const delta  = form.law_delta || getJurisdictionDelta(selectedType.label, form.jurisdiction);
    const jLabel = form.jurisdiction || 'Nigeria (jurisdiction not specified)';

    const system = [
      'You are a Nigerian senior advocate drafting a reusable argument template for an applications engine.',
      'This template must work for ANY case of this application type in this court — never include case-specific facts.',
      'Produce only the reusable framework. Facts, parties, and exhibits are always case-specific and must be left as blank placeholders.',
      'Structure your output in clearly labelled markdown sections.',
    ].join(' ');

    const userMsg = [
      `APPLICATION TYPE: ${selectedType.label}`,
      `JURISDICTION / COURT: ${jLabel}`,
      form.court_level ? `COURT LEVEL: ${form.court_level}` : '',
      '',
      delta ? `JURISDICTION DELTA (governing rules — apply these precisely):\n${delta}` : '',
      '',
      'Produce a reusable argument skeleton with the following sections:',
      '',
      '## STATUTORY BASIS',
      'List the statutes, sections, and constitutional provisions that govern this application.',
      '',
      '## APPLICABLE LEGAL TESTS',
      'State each test the court must apply — verbatim from binding authority where possible.',
      '',
      '## LEADING AUTHORITIES',
      'Cite 3–5 Supreme Court or Court of Appeal decisions that state the applicable principles. Format: Case Name (year) Court — principle stated.',
      '',
      '## ARGUMENT SKELETON',
      'Write the reusable argument structure. Use [HEADING] for structural markers.',
      'Under each heading write the legal propositions and applicable tests — no case-specific facts.',
      'Use [FACT: description] as placeholders where case-specific facts would be inserted.',
      'Use [EXHIBIT: description] where exhibits are referenced.',
      'End with a RELIEF SOUGHT section using [RELIEF] placeholders.',
      '',
      '## JURISDICTION NOTES',
      'Any specific procedural requirements, practice directions, or surety/filing rules for this court.',
      '',
      'Do NOT invent case citations. Use [AUTHORITY NEEDED: topic] if uncertain on a specific point.',
    ].filter(Boolean).join('\n');

    const result = await ai.ask({
      system,
      userMsg,
      maxTokens: 2000,
      skipLibrary: false,
      libraryOpts: {
        queryHint: `${selectedType.label} ${jLabel} Nigerian court argument template`,
        topK: 8,
      },
    });

    if (!result) {
      setError(ai.error || 'AI draft failed. Check connection and retry.');
      return;
    }

    // Parse sections from AI output
    const extract = (heading: string): string => {
      const re = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=##|$)`, 'i');
      const m  = result.match(re);
      return m ? m[1].trim() : '';
    };

    const statutory   = extract('STATUTORY BASIS');
    const tests       = extract('APPLICABLE LEGAL TESTS');
    const authorities = extract('LEADING AUTHORITIES');
    // Skeleton = ARGUMENT SKELETON + JURISDICTION NOTES combined
    const skelParts = [extract('ARGUMENT SKELETON'), extract('JURISDICTION NOTES')]
      .filter(Boolean).join('\n\n---\n\n## JURISDICTION NOTES\n\n');

    if (statutory)   set('statutory_basis',      statutory);
    if (tests)       set('tests',                tests);
    if (authorities) set('leading_authorities',  authorities);
    if (skelParts)   set('skeleton',             skelParts);

    toast.show('AI skeleton drafted. Review and edit before saving.', 'ok');
  }, [ai, selectedType, form.jurisdiction, form.court_level, form.law_delta]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedType) { setError('Select an application type.'); return; }
    if (!form.jurisdiction.trim()) { setError('Enter a jurisdiction / court name.'); return; }
    if (!form.skeleton.trim()) { setError('Argument skeleton is required before saving.'); return; }

    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const t: ArgumentTemplate = {
        id:                   editingTemplate?.id ?? uid(),
        appType:              selectedType.label,
        jurisdiction:         form.jurisdiction.trim(),
        court_level:          form.court_level.trim(),
        skeleton:             form.skeleton.trim(),
        statutory_basis:      form.statutory_basis.trim(),
        leading_authorities:  form.leading_authorities.trim(),
        tests:                form.tests.trim(),
        law_delta:            form.law_delta.trim(),
        needsCaseTheory:      selectedType.needsCaseTheory,
        created_at:           editingTemplate?.created_at ?? now,
        updated_at:           now,
      };
      await saveArgumentTemplate(t);
      toast.show(`Template saved: ${selectedType.label} — ${form.jurisdiction}`, 'ok');
      onSaved();
    } catch (e) {
      setError('Save failed. Please try again.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, [selectedType, form, editingTemplate, onSaved]);

  const canDraft = !!(selectedType && form.jurisdiction.trim());
  const canSave  = canDraft && !!form.skeleton.trim() && !saving;

  return (
    <div>
      {editingTemplate && (
        <div style={{
          background: '#fdf6e8', border: `1px solid #e0cfa0`,
          borderRadius: 4, padding: '8px 14px', marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, color: T.warn }}>
            Editing: <strong>{editingTemplate.appType} — {editingTemplate.jurisdiction}</strong>
          </span>
          <button onClick={onCancel} style={{ ...ghostBtn, color: T.dim }}>Cancel</button>
        </div>
      )}

      {/* Step 1 — Application Type */}
      <Section label="1 — Application Type">
        <select
          value={form.appTypeId}
          onChange={e => set('appTypeId', e.target.value)}
          style={S.sel}
        >
          <option value=''>Select application type…</option>
          {['civil', 'criminal', 'appeal', 'all'].map(track => (
            <optgroup key={track} label={track.charAt(0).toUpperCase() + track.slice(1)}>
              {APP_TYPES.filter(a => a.track === track).map(a => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.label}
                  {a.needsCaseTheory ? ' ◆' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {selectedType && (
          <p style={{ ...S.hint, marginTop: 6, marginBottom: 0 }}>
            {selectedType.hint}
            {selectedType.needsCaseTheory && (
              <span style={{ color: T.info, marginLeft: 8 }}>
                ◆ Theory injection enabled for this type.
              </span>
            )}
          </p>
        )}
      </Section>

      {/* Step 2 — Jurisdiction & Court Level */}
      <Section label="2 — Jurisdiction / Court">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <span style={S.label}>Court / Jurisdiction</span>
            <input
              style={S.inp}
              value={form.jurisdiction}
              onChange={e => set('jurisdiction', e.target.value)}
              placeholder="e.g. Delta State High Court, Asaba Division"
            />
          </div>
          <div>
            <span style={S.label}>Court Level</span>
            <select
              value={form.court_level}
              onChange={e => set('court_level', e.target.value)}
              style={S.sel}
            >
              <option value=''>Select court level…</option>
              {COURT_LEVELS.map(cl => (
                <option key={cl} value={cl}>{cl}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handlePullRegistry}
          disabled={!canDraft}
          style={{ ...secondaryBtn(canDraft), marginTop: 12 }}
        >
          Pull from Registry
        </button>

        {/* Law delta read-only panel */}
        {form.law_delta && (
          <div style={{ marginTop: 14 }}>
            <span style={S.label}>Law Delta (Registry Output)</span>
            <div style={{
              background: '#f8f8f6', border: `1px solid ${T.bdrL}`,
              borderRadius: 3, padding: '10px 12px',
              maxHeight: 220, overflowY: 'auto',
            }}>
              <Md text={form.law_delta} />
            </div>
            <p style={{ ...S.hint, marginTop: 4, marginBottom: 0 }}>
              This delta will be injected into the AI-draft call and saved with the template.
            </p>
          </div>
        )}
      </Section>

      {/* Step 3 — AI-Draft Skeleton */}
      <Section label="3 — Draft Skeleton">
        <p style={{ ...S.hint, marginBottom: 10 }}>
          Click <strong>AI-Draft Skeleton</strong> to generate a reusable argument framework.
          The AI will use the jurisdiction delta and the law registry to produce a skeleton
          with no case-specific facts — only structure, tests, and authorities.
        </p>
        <button
          onClick={handleAIDraft}
          disabled={!canDraft || ai.loading}
          style={canDraft && !ai.loading ? S.btn : S.btnOff}
        >
          {ai.loading ? 'Drafting…' : 'AI-Draft Skeleton'}
        </button>
        {ai.error && <ErrorBlock message={ai.error} onDismiss={ai.clearError} />}
      </Section>

      {/* Step 4 — Review & Edit */}
      <Section label="4 — Review & Edit">
        <FieldGroup label="Statutory Basis">
          <textarea
            style={{ ...S.ta, minHeight: 80 }}
            value={form.statutory_basis}
            onChange={e => set('statutory_basis', e.target.value)}
            placeholder="e.g. s.35 CFRN, s.158–162 ACJL Delta 2017…"
          />
        </FieldGroup>
        <FieldGroup label="Leading Authorities">
          <textarea
            style={{ ...S.ta, minHeight: 80 }}
            value={form.leading_authorities}
            onChange={e => set('leading_authorities', e.target.value)}
            placeholder="e.g. Dokubo-Asari v FRN (2007) SC — bail pending trial test…"
          />
        </FieldGroup>
        <FieldGroup label="Applicable Legal Tests">
          <textarea
            style={{ ...S.ta, minHeight: 80 }}
            value={form.tests}
            onChange={e => set('tests', e.target.value)}
            placeholder="The court must be satisfied that: (i)… (ii)… (iii)…"
          />
        </FieldGroup>
        <FieldGroup label="Argument Skeleton">
          <textarea
            style={{ ...S.ta, minHeight: 280 }}
            value={form.skeleton}
            onChange={e => set('skeleton', e.target.value)}
            placeholder="[HEADING: INTRODUCTION]\n\n[FACT: Brief facts of the application]\n\n[HEADING: THE LAW]\n\n…"
          />
          <p style={{ ...S.hint, marginTop: 4, marginBottom: 0 }}>
            Use <code>[FACT: …]</code> for case-specific fact placeholders.
            Use <code>[EXHIBIT: …]</code> for exhibits.
            Use <code>[AUTHORITY NEEDED: …]</code> for gaps.
          </p>
        </FieldGroup>

        {error && <ErrorBlock message={error} onDismiss={() => setError('')} />}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{ flex: 1, ...(canSave ? S.btn : S.btnOff), marginTop: 0 }}
          >
            {saving ? 'Saving…' : editingTemplate ? 'Save Changes' : 'Save Template'}
          </button>
          {editingTemplate && (
            <button
              onClick={onCancel}
              style={{ ...ghostBtn, color: T.dim, padding: '11px 24px', border: `1px solid ${T.bdr}` }}
            >
              Cancel
            </button>
          )}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — APPLY TO CASE
// ─────────────────────────────────────────────────────────────────────────────

function ApplyTab({
  templates, activeCase, onApplyDraft,
}: {
  templates:    ArgumentTemplate[];
  activeCase?:  Case;
  onApplyDraft?: (draft: string, appType: AppTypeConfig) => void;
}) {
  const ai = useAI(activeCase);

  const [selectedId, setSelectedId] = useState('');
  const [facts,      setFacts]      = useState('');
  const [draft,      setDraft]      = useState('');
  const [error,      setError]      = useState('');

  const selected = templates.find(t => t.id === selectedId) ?? null;
  const selType  = selected ? resolvedAppType(APP_TYPES.find(a => a.label === selected.appType)?.id ?? '') : undefined;

  // Pre-filter templates to those relevant to the active case's court
  const relevantFirst = !activeCase
    ? templates
    : [
        ...templates.filter(t =>
          activeCase.court.toLowerCase().includes(t.jurisdiction.split(/[\s,]/)[0].toLowerCase())
        ),
        ...templates.filter(t =>
          !activeCase.court.toLowerCase().includes(t.jurisdiction.split(/[\s,]/)[0].toLowerCase())
        ),
      ];

  const handleDraft = useCallback(async () => {
    if (!selected || !selType) return;
    setError('');
    setDraft('');

    const caseCtx = activeCase
      ? `CASE: ${activeCase.caseName} | COURT: ${activeCase.court} | SUIT: ${activeCase.suitNo || '[TBA]'} | ROLE: ${activeCase.role}`
      : '';

    const system = [
      'You are a Nigerian senior advocate completing a written address for an application.',
      'You have been given a reusable argument skeleton (framework) and the case-specific facts.',
      'Your job is to merge the skeleton with the facts to produce a complete, court-ready argument.',
      'Replace every [FACT: …] placeholder with the relevant case-specific fact.',
      'Replace every [EXHIBIT: …] placeholder with the actual exhibit reference.',
      'Replace every [AUTHORITY NEEDED: …] placeholder with the best available authority — use [RESEARCH NEEDED] if you cannot supply one with certainty.',
      'Do not add new arguments not supported by the facts. Do not remove any structural heading.',
      'Write as senior counsel addressing a superior court. Measured, precise, authoritative.',
    ].join(' ');

    const userMsg = [
      caseCtx,
      '',
      `APPLICATION TYPE: ${selected.appType}`,
      `JURISDICTION: ${selected.jurisdiction} | COURT LEVEL: ${selected.court_level}`,
      '',
      selected.law_delta ? `JURISDICTION DELTA:\n${selected.law_delta}\n` : '',
      `STATUTORY BASIS: ${selected.statutory_basis}`,
      `APPLICABLE TESTS: ${selected.tests}`,
      `LEADING AUTHORITIES: ${selected.leading_authorities}`,
      '',
      '## ARGUMENT SKELETON (to be completed with case facts)',
      selected.skeleton,
      '',
      '## CASE-SPECIFIC FACTS (use these to complete the skeleton)',
      facts.trim() || '(No facts provided — use [FACT: to be completed] placeholders throughout.)',
    ].filter(s => s !== null).join('\n');

    const result = await ai.ask({
      system,
      userMsg,
      maxTokens: 2500,
      libraryOpts: {
        queryHint: `${selected.appType} ${selected.jurisdiction} written address`,
        topK: 6,
      },
    });

    if (!result) {
      setError(ai.error || 'Draft failed. Check connection and retry.');
      return;
    }
    setDraft(result);
  }, [ai, selected, selType, activeCase, facts]);

  const canDraft = !!selected && !ai.loading;

  return (
    <div>
      {!activeCase && (
        <div style={{
          background: '#fdf6e8', border: `1px solid #e0cfa0`,
          borderRadius: 4, padding: '8px 14px', marginBottom: 18,
        }}>
          <span style={{ fontSize: 13, color: T.warn }}>
            No case loaded. Open this manager from inside a case to enable case context and the "Use in Case" action.
          </span>
        </div>
      )}

      {templates.length === 0 ? (
        <p style={S.hint}>No templates saved yet. Create one in the <em>New Template</em> tab first.</p>
      ) : (
        <>
          {/* Template selector */}
          <Section label="1 — Select Template">
            <select
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setDraft(''); setFacts(''); }}
              style={S.sel}
            >
              <option value=''>Select a template…</option>
              {relevantFirst.map(t => (
                <option key={t.id} value={t.id}>
                  {t.appType} — {t.jurisdiction} ({t.court_level || 'any level'})
                </option>
              ))}
            </select>
          </Section>

          {/* Preview selected template */}
          {selected && (
            <Section label="2 — Template Preview">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <TagBadge label={selected.jurisdiction} />
                {selected.court_level && <TagBadge label={selected.court_level} />}
                {selected.needsCaseTheory && <TagBadge label="◆ Theory Injection" color={T.info} />}
                <TagBadge label={`${completeness(selected)}% complete`} color={completeness(selected) >= 80 ? T.ok : T.warn} />
              </div>
              {selected.tests && (
                <div style={{ marginBottom: 10 }}>
                  <span style={S.label}>Tests the Court Will Apply</span>
                  <p style={{ ...S.p, fontSize: 13, margin: 0 }}>{selected.tests}</p>
                </div>
              )}
              {selected.skeleton && (
                <div>
                  <span style={S.label}>Argument Structure (skeleton)</span>
                  <div style={{
                    background: T.card, border: `1px solid ${T.bdrL}`,
                    borderRadius: 3, padding: '10px 12px', maxHeight: 200, overflowY: 'auto',
                  }}>
                    <Md text={selected.skeleton.slice(0, 1200) + (selected.skeleton.length > 1200 ? '\n\n*[Skeleton truncated — full version used in draft]*' : '')} />
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Case-specific facts */}
          {selected && (
            <Section label="3 — Case-Specific Facts">
              <p style={{ ...S.hint, marginBottom: 8 }}>
                Enter only what is specific to this case. The template provides the framework —
                these facts will be merged into the skeleton to produce a complete argument.
              </p>
              <textarea
                style={{ ...S.ta, minHeight: 180 }}
                value={facts}
                onChange={e => setFacts(e.target.value)}
                placeholder={`Parties:\n\nKey facts:\n\nReliefs sought:\n\nKey exhibits:\n\nAny specific grounds for this application:`}
              />
              <button
                onClick={handleDraft}
                disabled={!canDraft}
                style={canDraft ? S.btn : S.btnOff}
              >
                {ai.loading ? 'Drafting…' : 'Draft with Template'}
              </button>
              {error && <ErrorBlock message={error} onDismiss={() => setError('')} />}
            </Section>
          )}

          {/* Draft output */}
          {draft && (
            <Section label="4 — Draft Output">
              <p style={{ ...S.hint, marginBottom: 10 }}>
                Review the draft. Token cost for this call was significantly lower because the
                argument framework was not re-derived — only the case-specific merging was done.
              </p>
              <div style={{
                background: '#ffffff', border: `1px solid ${T.bdr}`,
                borderRadius: 4, padding: '16px 18px', marginBottom: 14,
                maxHeight: 480, overflowY: 'auto',
              }}>
                <Md text={draft} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(draft);
                    toast.show('Draft copied to clipboard.', 'ok');
                  }}
                  style={{ ...secondaryBtn(true), flex: 1 }}
                >
                  Copy Draft
                </button>
                {onApplyDraft && selType && (
                  <button
                    onClick={() => { onApplyDraft(draft, selType); toast.show('Draft sent to Applications Engine.', 'ok'); }}
                    style={{ flex: 1, ...S.btn, marginTop: 0 }}
                  >
                    Use in Current Case →
                  </button>
                )}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={S.h3}>{label}</h3>
      {children}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={S.label}>{label}</span>
      {children}
    </div>
  );
}

function TagBadge({ label, color = T.dim }: { label: string; color?: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
      background: `${color}18`, color,
      border: `1px solid ${color}44`, borderRadius: 2,
      padding: '2px 8px',
      fontFamily: "'Times New Roman', Times, serif",
    }}>
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const ghostBtn: React.CSSProperties = {
  background:    'transparent',
  border:        'none',
  fontSize:      13,
  fontFamily:    "'Times New Roman', Times, serif",
  cursor:        'pointer',
  padding:       '4px 0',
  fontWeight:    600,
  letterSpacing: '.02em',
};

function secondaryBtn(enabled: boolean): React.CSSProperties {
  return {
    background:    enabled ? '#ffffff' : T.card,
    color:         enabled ? T.text    : T.mute,
    border:        `1px solid ${enabled ? T.bdr : T.bdrL}`,
    borderRadius:  4,
    padding:       '9px 18px',
    fontSize:      13,
    fontFamily:    "'Times New Roman', Times, serif",
    cursor:        enabled ? 'pointer' : 'not-allowed',
    fontWeight:    600,
    letterSpacing: '.02em',
    transition:    'opacity .2s',
    marginTop:     0,
    width:         'auto',
  };
}
