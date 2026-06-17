/**
 * AFS Legal OS — Law Registry Admin UI (Law Change Risk Mitigation)
 *
 * Four panels in a single scrollable component:
 *   Panel 1 — Period Rules        22 registry entries; inline edit + stale badge
 *   Panel 2 — Prompt Assertions   19 prompt entries; read-only with stale badge
 *   Panel 3 — Active Overrides    Live read from IndexedDB; reset per row
 *   Panel 4 — Audit Log           Append-only; expandable per rule
 *
 * Mounted inside SettingsPanel.tsx below the Legal Intelligence Monitor section.
 */

import { useState, useEffect, useCallback } from 'react';
import { T, S } from '@/constants/tokens';
import {
  LAW_REGISTRY,
  setLaw,
  resetLaw,
  getAllOverrides,
  getAuditLog,
  type LawEntry,
} from '@/law/registry';
import { PROMPT_REGISTRY, type PromptEntry } from '@/law/prompts';
import { lawDb, type LawAuditEntry, type LawOverride } from '@/law/db';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const FONT = "'Times New Roman', Times, serif";
const STALE_MONTHS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isStale(lastVerified: string): boolean {
  const verified = new Date(lastVerified);
  const cutoff   = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  return verified < cutoff;
}

function unitLabel(entry: LawEntry): string {
  if (entry.valueType === 'months')  return entry.default === '1' ? 'month' : 'months';
  if (entry.valueType === 'minutes') return 'mins';
  return entry.default === '1' ? 'day' : 'days';
}

function categoryColor(cat: string): string {
  return cat === 'cap' ? '#1a3a6a' : '#1a5a30';
}

function categoryBg(cat: string): string {
  return cat === 'cap' ? '#edf3fb' : '#e8f5ee';
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function StaleBadge() {
  return (
    <span style={{
      background: '#fdf3e0', color: '#7a4a00',
      border: '1px solid #e0c888',
      fontSize: 10, fontWeight: 700,
      padding: '2px 7px', borderRadius: 3,
      fontFamily: FONT, letterSpacing: '.05em',
      whiteSpace: 'nowrap' as const, flexShrink: 0,
    }}>
      STALE
    </span>
  );
}

function OverrideBadge() {
  return (
    <span style={{
      background: '#edf3fb', color: '#1a3a6a',
      border: '1px solid #b8cce0',
      fontSize: 10, fontWeight: 700,
      padding: '2px 7px', borderRadius: 3,
      fontFamily: FONT, letterSpacing: '.05em',
      whiteSpace: 'nowrap' as const, flexShrink: 0,
    }}>
      OVERRIDE
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL 1 — PERIOD RULES
// ─────────────────────────────────────────────────────────────────────────────

interface EditState {
  value: string;
  note:  string;
  saving: boolean;
  error:  string;
}

function PeriodRulesPanel({ onOverrideChange }: { onOverrideChange: () => void }) {
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [edit, setEdit]             = useState<EditState>({ value: '', note: '', saving: false, error: '' });
  const [overrideMap, setOverrideMap] = useState<Map<string, string>>(new Map());

  // Load overrides so we know which rows are overridden
  useEffect(() => {
    getAllOverrides().then(m => setOverrideMap(new Map(m)));
  }, []);

  function openEdit(entry: LawEntry) {
    const current = overrideMap.get(entry.id) ?? entry.default;
    setEditingId(entry.id);
    setEdit({ value: current, note: '', saving: false, error: '' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit({ value: '', note: '', saving: false, error: '' });
  }

  async function saveEdit(entry: LawEntry) {
    if (!edit.note.trim()) {
      setEdit(e => ({ ...e, error: 'Reason is required.' }));
      return;
    }
    const n = parseFloat(edit.value);
    if (isNaN(n) || n < 0) {
      setEdit(e => ({ ...e, error: 'Value must be a positive number.' }));
      return;
    }
    setEdit(e => ({ ...e, saving: true, error: '' }));
    try {
      await setLaw(entry.id, String(n), edit.note.trim());
      const updated = await getAllOverrides();
      setOverrideMap(new Map(updated));
      onOverrideChange();
      cancelEdit();
    } catch {
      setEdit(e => ({ ...e, saving: false, error: 'Save failed — check IndexedDB permissions.' }));
    }
  }

  // Group by prefix
  const groups: { label: string; entries: LawEntry[] }[] = [
    { label: 'Civil — Appearance',  entries: LAW_REGISTRY.filter(e => e.id.startsWith('civil_appearance')) },
    { label: 'Civil — Pleadings',   entries: LAW_REGISTRY.filter(e => e.id.startsWith('civil_sod') || e.id.startsWith('civil_reply')) },
    { label: 'Civil — Appeals',     entries: LAW_REGISTRY.filter(e => e.id.startsWith('civil_appeal')) },
    { label: 'Civil — Interlocutory', entries: LAW_REGISTRY.filter(e => e.id === 'civil_interlocutory_appeal') },
    { label: 'Criminal — Custody & Arraignment', entries: LAW_REGISTRY.filter(e => e.id.startsWith('criminal_arraignment') || e.id.startsWith('criminal_remand') || e.id.startsWith('criminal_trial') || e.id.startsWith('criminal_prosecution')) },
    { label: 'Criminal — Appeals',  entries: LAW_REGISTRY.filter(e => e.id.startsWith('criminal_appeal')) },
    { label: 'Civil — Final Written Address',    entries: LAW_REGISTRY.filter(e => e.id.startsWith('civil_fwa_')) },
    { label: 'Criminal — Final Written Address', entries: LAW_REGISTRY.filter(e => e.id.startsWith('criminal_fwa_')) },
    { label: 'Matrimonial',         entries: LAW_REGISTRY.filter(e => e.id.startsWith('mca_')) },
    { label: 'FREP',                entries: LAW_REGISTRY.filter(e => e.id.startsWith('frep_')) },
  ].filter(g => g.entries.length > 0);

  return (
    <div>
      {groups.map(group => (
        <div key={group.label} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: T.mute,
            textTransform: 'uppercase', letterSpacing: '.1em',
            fontFamily: FONT, marginBottom: 8,
          }}>
            {group.label}
          </div>

          {group.entries.map(entry => {
            const stale      = isStale(entry.lastVerified);
            const overridden = overrideMap.has(entry.id);
            const current    = overrideMap.get(entry.id) ?? entry.default;
            const isEditing  = editingId === entry.id;

            return (
              <div key={entry.id} style={{
                background: '#ffffff',
                border: `1px solid ${isEditing ? '#b8cce0' : T.bdr}`,
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 8,
              }}>
                {/* Row header */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start',
                  justifyContent: 'space-between', gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    {/* Label + badges */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      gap: 6, flexWrap: 'wrap' as const, marginBottom: 4,
                    }}>
                      <span style={{
                        fontSize: 13, color: T.text, fontFamily: FONT,
                        fontWeight: 600, lineHeight: 1.4,
                      }}>
                        {entry.label}
                      </span>
                      {stale && <StaleBadge />}
                      {overridden && <OverrideBadge />}
                    </div>

                    {/* Source */}
                    <div style={{
                      fontSize: 11, color: T.mute, fontFamily: FONT,
                      marginBottom: 6,
                    }}>
                      {entry.source} · {entry.jurisdiction}
                    </div>

                    {/* Values row */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      gap: 16, flexWrap: 'wrap' as const,
                    }}>
                      <span style={{
                        background: categoryBg(entry.category),
                        color: categoryColor(entry.category),
                        border: `1px solid ${categoryColor(entry.category)}33`,
                        fontSize: 13, fontWeight: 700,
                        padding: '3px 10px', borderRadius: 4,
                        fontFamily: FONT,
                      }}>
                        {current} {unitLabel(entry)}
                      </span>
                      {overridden && (
                        <span style={{ fontSize: 11, color: T.mute, fontFamily: FONT }}>
                          default: {entry.default} {unitLabel(entry)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Edit button */}
                  {!isEditing && (
                    <button
                      onClick={() => openEdit(entry)}
                      style={{
                        background: 'none',
                        border: `1px solid ${T.bdr}`,
                        borderRadius: 4, padding: '5px 14px',
                        fontSize: 12, cursor: 'pointer',
                        color: T.dim, fontFamily: FONT,
                        flexShrink: 0,
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <div style={{
                    marginTop: 14,
                    borderTop: `1px solid ${T.bdrL}`,
                    paddingTop: 14,
                  }}>
                    {/* Value input */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{
                        ...S.label, display: 'block', marginBottom: 5,
                      }}>
                        New value ({entry.valueType})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={edit.value}
                        onChange={e => setEdit(v => ({ ...v, value: e.target.value }))}
                        style={{
                          ...S.inp, width: 100, boxSizing: 'border-box' as const,
                        }}
                      />
                    </div>

                    {/* Reason input */}
                    <div style={{ marginBottom: 12 }}>
                      <label style={{
                        ...S.label, display: 'block', marginBottom: 5,
                      }}>
                        Reason for change <span style={{ color: T.err }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Practice Direction PD/2025/03 amended period to 7 days"
                        value={edit.note}
                        onChange={e => setEdit(v => ({ ...v, note: e.target.value }))}
                        style={{
                          ...S.inp, width: '100%', boxSizing: 'border-box' as const,
                        }}
                      />
                    </div>

                    {/* Error */}
                    {edit.error && (
                      <p style={{
                        fontSize: 12, color: T.err, fontFamily: FONT,
                        margin: '0 0 10px',
                      }}>
                        {edit.error}
                      </p>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                      <button
                        onClick={() => saveEdit(entry)}
                        disabled={edit.saving}
                        style={{
                          background: edit.saving ? '#eeeeee' : T.text,
                          color: edit.saving ? T.mute : '#ffffff',
                          border: 'none', borderRadius: 4,
                          padding: '8px 20px', fontSize: 12,
                          fontFamily: FONT, cursor: edit.saving ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {edit.saving ? 'Saving…' : 'Save Override'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={edit.saving}
                        style={{
                          background: 'none', border: `1px solid ${T.bdr}`,
                          borderRadius: 4, padding: '8px 16px', fontSize: 12,
                          fontFamily: FONT, cursor: 'pointer', color: T.dim,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Notes (collapsed) */}
                {entry.notes && !isEditing && (
                  <p style={{
                    ...S.hint, fontSize: 11, color: T.mute,
                    marginTop: 8, marginBottom: 0, lineHeight: 1.5,
                  }}>
                    {entry.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL 2 — PROMPT ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

function PromptAssertionsPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groups: { label: string; entries: PromptEntry[] }[] = [
    { label: 'ACJA',            entries: PROMPT_REGISTRY.filter(e => e.id.startsWith('acja_')) },
    { label: 'Evidence Act',    entries: PROMPT_REGISTRY.filter(e => e.id.startsWith('evidence_act_')) },
    { label: 'Matrimonial — Dissolution Facts', entries: PROMPT_REGISTRY.filter(e => ['mca_dissolution_facts','mca_s30_two_year_bar','mca_s32_co_respondent','mca_condonation_ss2627','mca_nullity_bars_ss3537'].includes(e.id)) },
    { label: 'Matrimonial — Decree Enforcement', entries: PROMPT_REGISTRY.filter(e => ['mca_s57_absolute_rule','mca_s58_absolute_rule','cfrn_s241_2_appeal_absolute_bar','mca_maintenance_magistrate','mca_s241_1_f_iv_appeal_nisi'].includes(e.id)) },
    { label: 'FREP',            entries: PROMPT_REGISTRY.filter(e => e.id.startsWith('frep_')) },
  ].filter(g => g.entries.length > 0);

  return (
    <div>
      <p style={{
        ...S.hint, marginBottom: 16,
        background: '#fdf8ec', border: '1px solid #e0d8b8',
        borderRadius: 5, padding: '10px 14px',
      }}>
        Prompt text is read-only in this panel. To update an assertion, edit
        {' '}<code style={{ fontSize: 12, color: T.dim }}>src/law/prompts.ts</code>{' '}
        directly — this ensures a human review step before any change goes live.
      </p>

      {groups.map(group => (
        <div key={group.label} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: T.mute,
            textTransform: 'uppercase', letterSpacing: '.1em',
            fontFamily: FONT, marginBottom: 8,
          }}>
            {group.label}
          </div>

          {group.entries.map(entry => {
            const stale      = isStale(entry.lastVerified);
            const isExpanded = expandedId === entry.id;

            return (
              <div key={entry.id} style={{
                background: '#ffffff',
                border: `1px solid ${T.bdr}`,
                borderRadius: 6, padding: '12px 14px', marginBottom: 8,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start',
                  justifyContent: 'space-between', gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      gap: 6, flexWrap: 'wrap' as const, marginBottom: 4,
                    }}>
                      <span style={{
                        fontSize: 13, color: T.text, fontFamily: FONT,
                        fontWeight: 600, lineHeight: 1.4,
                      }}>
                        {entry.label}
                      </span>
                      {stale && <StaleBadge />}
                    </div>
                    <div style={{
                      fontSize: 11, color: T.mute, fontFamily: FONT, marginBottom: 4,
                    }}>
                      {entry.source}
                    </div>
                    <div style={{
                      fontSize: 11, color: T.dim, fontFamily: FONT,
                    }}>
                      Used in: {entry.engines.join(', ')}
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    style={{
                      background: 'none', border: `1px solid ${T.bdr}`,
                      borderRadius: 4, padding: '5px 12px',
                      fontSize: 12, cursor: 'pointer',
                      color: T.dim, fontFamily: FONT, flexShrink: 0,
                    }}
                  >
                    {isExpanded ? '▾ Hide' : '▸ View'}
                  </button>
                </div>

                {isExpanded && (
                  <div style={{
                    marginTop: 12,
                    borderTop: `1px solid ${T.bdrL}`,
                    paddingTop: 12,
                  }}>
                    <p style={{
                      fontSize: 12, color: T.dim, fontFamily: FONT,
                      lineHeight: 1.7, margin: 0,
                      background: '#f7f7f5', borderRadius: 4,
                      padding: '10px 12px',
                      whiteSpace: 'pre-wrap' as const,
                    }}>
                      {entry.value}
                    </p>
                    {entry.notes && (
                      <p style={{
                        ...S.hint, fontSize: 11, color: T.mute,
                        marginTop: 8, marginBottom: 0,
                      }}>
                        {entry.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL 3 — ACTIVE OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────

function ActiveOverridesPanel({ refreshKey }: { refreshKey: number }) {
  const [overrides, setOverrides] = useState<LawOverride[]>([]);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await lawDb.overrides.toArray();
    setOverrides(rows.sort((a, b) => b.changedAt.localeCompare(a.changedAt)));
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function handleReset(id: string) {
    setResettingId(id);
    const reason = window.prompt('Reason for resetting this override (required):');
    if (!reason?.trim()) {
      setResettingId(null);
      return;
    }
    await resetLaw(id, reason.trim());
    await load();
    setResettingId(null);
  }

  if (overrides.length === 0) {
    return (
      <p style={{ ...S.hint, color: T.mute, fontStyle: 'italic' }}>
        No active overrides. All rules are using their compiled defaults.
      </p>
    );
  }

  return (
    <div>
      {overrides.map(ov => {
        const entry = LAW_REGISTRY.find(e => e.id === ov.id);
        const isPending = resettingId === ov.id;
        return (
          <div key={ov.id} style={{
            background: '#ffffff', border: `1px solid ${T.bdr}`,
            borderRadius: 6, padding: '12px 14px', marginBottom: 8,
          }}>
            <div style={{
              display: 'flex', alignItems: 'flex-start',
              justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 13, color: T.text, fontFamily: FONT,
                  fontWeight: 600, marginBottom: 4,
                }}>
                  {entry?.label ?? ov.id}
                </div>
                <div style={{
                  display: 'flex', gap: 16, flexWrap: 'wrap' as const,
                  alignItems: 'center', marginBottom: 6,
                }}>
                  <span style={{
                    fontSize: 12, color: T.mute, fontFamily: FONT,
                  }}>
                    default: <strong style={{ color: T.dim }}>{entry?.default}</strong>
                  </span>
                  <span style={{ fontSize: 12, color: '#1a5a30', fontFamily: FONT }}>
                    → override: <strong>{ov.value}</strong>
                  </span>
                </div>
                <div style={{
                  fontSize: 11, color: T.mute, fontFamily: FONT, marginBottom: 2,
                }}>
                  Changed {new Date(ov.changedAt).toLocaleString()}
                </div>
                <div style={{
                  fontSize: 12, color: T.dim, fontFamily: FONT,
                  fontStyle: 'italic',
                }}>
                  "{ov.note}"
                </div>
              </div>

              <button
                onClick={() => void handleReset(ov.id)}
                disabled={isPending}
                style={{
                  background: 'none',
                  border: `1px solid ${T.err}33`,
                  borderRadius: 4, padding: '5px 12px',
                  fontSize: 12, cursor: isPending ? 'not-allowed' : 'pointer',
                  color: T.err, fontFamily: FONT, flexShrink: 0,
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                {isPending ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL 4 — AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

function AuditLogPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entries, setEntries]       = useState<LawAuditEntry[]>([]);
  const [loading, setLoading]       = useState(false);

  async function loadAudit(ruleId: string) {
    if (expandedId === ruleId) {
      setExpandedId(null);
      return;
    }
    setLoading(true);
    const rows = await getAuditLog(ruleId);
    setEntries(rows);
    setExpandedId(ruleId);
    setLoading(false);
  }

  // Rules that have any audit history (all registered rules shown for now —
  // the audit call will simply return [] for untouched rules)
  const allRules = LAW_REGISTRY;

  return (
    <div>
      <p style={{ ...S.hint, marginBottom: 14 }}>
        Tap a rule to expand its full history. Entries are append-only and never deleted.
      </p>

      {allRules.map(entry => {
        const isOpen = expandedId === entry.id;
        return (
          <div key={entry.id} style={{
            background: '#ffffff', border: `1px solid ${T.bdr}`,
            borderRadius: 6, marginBottom: 6,
          }}>
            <button
              onClick={() => void loadAudit(entry.id)}
              style={{
                width: '100%', background: 'none', border: 'none',
                padding: '11px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 10,
                textAlign: 'left' as const,
              }}
            >
              <span style={{
                fontSize: 13, color: T.text, fontFamily: FONT, fontWeight: 600,
              }}>
                {entry.label}
              </span>
              <span style={{
                fontSize: 11, color: T.mute, fontFamily: FONT, flexShrink: 0,
              }}>
                {isOpen ? '▾' : '▸'}
              </span>
            </button>

            {isOpen && (
              <div style={{
                borderTop: `1px solid ${T.bdrL}`,
                padding: '10px 14px',
              }}>
                {loading && (
                  <p style={{ ...S.hint, color: T.mute, fontStyle: 'italic' }}>
                    Loading…
                  </p>
                )}
                {!loading && entries.length === 0 && (
                  <p style={{ ...S.hint, color: T.mute, fontStyle: 'italic', margin: 0 }}>
                    No changes recorded — rule has never been overridden.
                  </p>
                )}
                {!loading && entries.map(log => (
                  <div key={log.id} style={{
                    borderLeft: `3px solid ${T.bdrL}`,
                    paddingLeft: 12, marginBottom: 12,
                  }}>
                    <div style={{
                      fontSize: 11, color: T.mute, fontFamily: FONT, marginBottom: 3,
                    }}>
                      {new Date(log.changedAt).toLocaleString()}
                    </div>
                    <div style={{
                      fontSize: 13, color: T.text, fontFamily: FONT, marginBottom: 3,
                    }}>
                      <span style={{ color: T.err }}>{log.oldValue}</span>
                      {' → '}
                      <span style={{ color: '#1a5a30', fontWeight: 700 }}>{log.newValue}</span>
                    </div>
                    <div style={{
                      fontSize: 12, color: T.dim, fontFamily: FONT, fontStyle: 'italic',
                    }}>
                      "{log.note}"
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

type PanelId = 'period' | 'prompts' | 'overrides' | 'audit';

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'period',    label: 'Period Rules' },
  { id: 'prompts',   label: 'Prompt Assertions' },
  { id: 'overrides', label: 'Active Overrides' },
  { id: 'audit',     label: 'Audit Log' },
];

export function LawRegistry() {
  const [activePanel, setActivePanel] = useState<PanelId>('period');
  const [overrideRefreshKey, setOverrideRefreshKey] = useState(0);

  function handleOverrideChange() {
    setOverrideRefreshKey(k => k + 1);
  }

  return (
    <div>
      {/* Intro */}
      <p style={{ ...S.hint, marginBottom: 20 }}>
        All procedural deadlines and legal assertions in one place. Edit a period
        rule below — the change takes effect immediately in IndexedDB with no
        deploy required. Every change is logged with a mandatory reason.
      </p>

      {/* Panel tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        borderBottom: `1px solid ${T.bdr}`, paddingBottom: 0,
        flexWrap: 'wrap' as const,
      }}>
        {PANELS.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePanel(p.id)}
            style={{
              background: 'none', border: 'none',
              borderBottom: activePanel === p.id
                ? `2px solid ${T.text}`
                : '2px solid transparent',
              padding: '8px 16px', fontSize: 12,
              fontFamily: FONT, cursor: 'pointer',
              color: activePanel === p.id ? T.text : T.mute,
              fontWeight: activePanel === p.id ? 700 : 400,
              marginBottom: -1,
              letterSpacing: '.04em',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      {activePanel === 'period' && (
        <PeriodRulesPanel onOverrideChange={handleOverrideChange} />
      )}
      {activePanel === 'prompts' && (
        <PromptAssertionsPanel />
      )}
      {activePanel === 'overrides' && (
        <ActiveOverridesPanel refreshKey={overrideRefreshKey} />
      )}
      {activePanel === 'audit' && (
        <AuditLogPanel />
      )}
    </div>
  );
}
