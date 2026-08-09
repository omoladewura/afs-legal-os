/**
 * AFS Legal OS — Client Position Profile Capture Form
 *
 * Roadmap ref: 2a (Contract Engine — Draft Mode)
 *
 * Pure input → storage flow. Captures counsel's read on the client's
 * negotiating position for one contract matter and writes it to the
 * client_position_profile table via the 1f dual-write helpers.
 *
 * Deliberately NO AI calls here — that starts at 2b (Pass 0). This form's
 * only job is getting a clean ClientPositionProfile record onto disk so
 * 2b/2c/2f have something to read.
 *
 * Usage:
 *   <ClientPositionProfileForm
 *     contractId={contractId}
 *     onSaved={(profile) => { ... }}
 *   />
 *
 * On mount, it loads any existing profile for this contractId (edit flow —
 * counsel revisiting a matter) and pre-fills the form; if none exists yet,
 * it starts blank and generates a new id on first save.
 */

import React, { useEffect, useState } from 'react';
import { T, S } from '@/constants/tokens';
import { uid } from '@/utils';
import { loadClientPositionProfile, saveClientPositionProfile } from '@/storage/helpers';
import type { ClientPositionProfile } from '@/contracts/types';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLE HELPERS — same shape as ClauseBank's inline styles, kept local
// rather than imported since neither file exports a shared form-field style.
// ─────────────────────────────────────────────────────────────────────────────

const fieldWrap: React.CSSProperties = { marginBottom: 16 };

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: T.dim, marginBottom: 6,
  fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.02em',
};

const hintStyle: React.CSSProperties = {
  ...S.hint, fontSize: 11, margin: '4px 0 0',
};

const inputStyle: React.CSSProperties = {
  width: '100%', background: T.bg, border: `1px solid ${T.bdrL}`,
  borderRadius: 4, color: T.text, fontFamily: "'Times New Roman', Times, serif",
  fontSize: 13, padding: '9px 12px', outline: 'none', boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 72, resize: 'vertical', lineHeight: 1.6,
};

const selectStyle: React.CSSProperties = { ...inputStyle };

// ─────────────────────────────────────────────────────────────────────────────
// TAG LIST INPUT — shared control for priorities / deal_breakers / concessions
// ─────────────────────────────────────────────────────────────────────────────

interface TagListInputProps {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

function TagListInput({ label, hint, placeholder, values, onChange }: TagListInputProps) {
  const [draft, setDraft] = useState('');

  function commit() {
    const v = draft.trim();
    if (!v) return;
    onChange([...values, v]);
    setDraft('');
  }

  function remove(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
          }}
          placeholder={placeholder}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={commit}
          disabled={!draft.trim()}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`, color: T.dim,
            borderRadius: 4, padding: '0 16px', fontSize: 12,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
            fontFamily: "'Times New Roman', Times, serif", flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>
      {hint && <p style={hintStyle}>{hint}</p>}
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {values.map((v, i) => (
            <span
              key={`${v}-${i}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: T.bg, border: `1px solid ${T.bdrL}`, borderRadius: 4,
                padding: '4px 6px 4px 10px', fontSize: 12, color: T.text,
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${v}`}
                style={{
                  background: 'none', border: 'none', color: T.mute,
                  cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px',
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM STATE SHAPE — string-list fields kept as arrays directly; everything
// else mirrors ClientPositionProfile's editable fields 1:1.
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  client_role:            string;
  risk_posture:            ClientPositionProfile['risk_posture'];
  priorities:              string[];
  deal_breakers:           string[];
  concessions_available:   string[];
  commercial_context:      string;
  prior_relationship:      string;
  jurisdiction_preference: string;
  special_instructions:    string;
}

const BLANK_FORM: FormState = {
  client_role:            '',
  risk_posture:            'balanced',
  priorities:              [],
  deal_breakers:           [],
  concessions_available:   [],
  commercial_context:      '',
  prior_relationship:      '',
  jurisdiction_preference: '',
  special_instructions:    '',
};

const RISK_POSTURE_LABELS: Record<ClientPositionProfile['risk_posture'], string> = {
  conservative: 'Conservative — protect the client, concede readily on non-essentials',
  balanced:     'Balanced — standard market terms, push back on the substantive points',
  aggressive:   'Aggressive — hold the line, make the other side justify every ask',
};

// ─────────────────────────────────────────────────────────────────────────────
// FORM COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface ClientPositionProfileFormProps {
  contractId: string;
  onSaved?:  (profile: ClientPositionProfile) => void;
  onCancel?: () => void;
}

export function ClientPositionProfileForm({ contractId, onSaved, onCancel }: ClientPositionProfileFormProps) {
  const [existing, setExisting] = useState<ClientPositionProfile | null>(null);
  const [form, setForm]         = useState<FormState>(BLANK_FORM);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadClientPositionProfile(contractId).then(profile => {
      if (cancelled) return;
      setExisting(profile);
      if (profile) {
        setForm({
          client_role:            profile.client_role,
          risk_posture:            profile.risk_posture,
          priorities:              profile.priorities,
          deal_breakers:           profile.deal_breakers,
          concessions_available:   profile.concessions_available,
          commercial_context:      profile.commercial_context,
          prior_relationship:      profile.prior_relationship,
          jurisdiction_preference: profile.jurisdiction_preference ?? '',
          special_instructions:    profile.special_instructions,
        });
      } else {
        setForm(BLANK_FORM);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [contractId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  const canSave = form.client_role.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const now = new Date().toISOString();
    const profile: ClientPositionProfile = {
      id:                      existing?.id ?? uid(),
      contract_id:             contractId,
      client_role:             form.client_role.trim(),
      risk_posture:            form.risk_posture,
      priorities:              form.priorities,
      deal_breakers:           form.deal_breakers,
      concessions_available:   form.concessions_available,
      commercial_context:      form.commercial_context.trim(),
      prior_relationship:      form.prior_relationship.trim(),
      jurisdiction_preference: form.jurisdiction_preference.trim() || undefined,
      special_instructions:    form.special_instructions.trim(),
      created_at:              existing?.created_at ?? now,
      updated_at:               now,
    };

    const ok = await saveClientPositionProfile(profile);
    setSaving(false);

    if (!ok) {
      setToast('Save failed — check storage and try again');
      setTimeout(() => setToast(''), 2600);
      return;
    }

    setExisting(profile);
    setToast(existing ? 'Profile updated' : 'Profile saved');
    setTimeout(() => setToast(''), 1800);
    onSaved?.(profile);
  }

  if (loading) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <p style={{ ...S.hint }}>Loading client position profile…</p>
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '8px 18px', borderRadius: 5,
          fontSize: 12, zIndex: 9999, fontFamily: "'Times New Roman', Times, serif",
        }}>
          {toast}
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <p style={{ ...S.h3, margin: 0 }}>
          {existing ? 'Client Position Profile' : 'New Client Position Profile'}
        </p>
        <p style={{ ...S.hint, margin: '4px 0 0' }}>
          Who the client is in this deal, how hard to push, and what can't move.
          Feeds clause generation (2c) and the missing-profile warning — nothing
          here calls the AI, this just captures counsel's instructions.
        </p>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Client Role *</label>
        <input
          value={form.client_role}
          onChange={e => set('client_role', e.target.value)}
          placeholder="e.g. Lessor, Employer, Buyer"
          style={inputStyle}
        />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Risk Posture</label>
        <select
          value={form.risk_posture}
          onChange={e => set('risk_posture', e.target.value as FormState['risk_posture'])}
          style={selectStyle}
        >
          {(Object.keys(RISK_POSTURE_LABELS) as ClientPositionProfile['risk_posture'][]).map(k => (
            <option key={k} value={k}>{RISK_POSTURE_LABELS[k]}</option>
          ))}
        </select>
      </div>

      <TagListInput
        label="Priorities"
        hint="Ranked, most important first — add in the order they matter."
        placeholder="e.g. fast completion, confidentiality"
        values={form.priorities}
        onChange={v => set('priorities', v)}
      />

      <TagListInput
        label="Deal Breakers"
        hint="Non-negotiables — clauses that cannot be conceded."
        placeholder="e.g. no personal guarantee"
        values={form.deal_breakers}
        onChange={v => set('deal_breakers', v)}
      />

      <TagListInput
        label="Concessions Available"
        hint="Things the client is willing to trade away."
        placeholder="e.g. extended notice period"
        values={form.concessions_available}
        onChange={v => set('concessions_available', v)}
      />

      <div style={fieldWrap}>
        <label style={labelStyle}>Commercial Context</label>
        <textarea
          value={form.commercial_context}
          onChange={e => set('commercial_context', e.target.value)}
          placeholder="Background and facts about the deal…"
          style={textareaStyle}
        />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Prior Relationship</label>
        <input
          value={form.prior_relationship}
          onChange={e => set('prior_relationship', e.target.value)}
          placeholder="Any existing relationship with the counterparty"
          style={inputStyle}
        />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Jurisdiction Preference</label>
        <input
          value={form.jurisdiction_preference}
          onChange={e => set('jurisdiction_preference', e.target.value)}
          placeholder='e.g. "NG" or "NG-LA" (optional)'
          style={inputStyle}
        />
        <p style={hintStyle}>
          Feeds Pass 0 (2b) as a starting hint. Whole-contract, not per-clause.
          Leave blank to let Pass 0 infer it from the facts.
        </p>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Special Instructions</label>
        <textarea
          value={form.special_instructions}
          onChange={e => set('special_instructions', e.target.value)}
          placeholder="Anything else counsel needs on record for this matter…"
          style={textareaStyle}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          style={{
            background: canSave ? T.text : '#cccccc', color: '#fff', border: 'none',
            borderRadius: 4, padding: '9px 20px', fontSize: 12,
            cursor: canSave ? 'pointer' : 'not-allowed',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          {saving ? 'Saving…' : existing ? 'Save Changes' : 'Save Profile'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`, color: T.mute,
              borderRadius: 4, padding: '9px 16px', fontSize: 12, cursor: 'pointer',
              fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {!form.client_role.trim() && (
        <p style={{ ...hintStyle, marginTop: 10 }}>* Client Role is required before saving.</p>
      )}
    </div>
  );
}
