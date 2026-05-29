/**
 * AFS Advocates — Inheritance Mode Engine
 *
 * Mid-case handover intelligence. Upload every document received from the
 * previous lawyer — the AI runs a forensic State-of-Case Audit and produces:
 *   1. State-of-Case Audit + What the Previous Lawyer Did
 *   2. Gap & Damage Report  (not done / errors / too late / can be saved)
 *   3. Risk Register        (severity-coded, with required action per risk)
 *   4. Inheritance Intelligence Package  (posture · immediate actions · roadmap · strategy · SAN recommendation)
 *
 * Data flow:
 *   - onSave(result) → CaseDashboard → saveCase() → IndexedDB
 *   - Result also written to activeCase.inheritance_data for immediate render
 *
 * Props:
 *   activeCase — loaded Case object (may already have inheritance_data)
 *   onSave     — async callback, persists the audit result
 */

import { useState, useRef } from 'react';
import { T } from '@/constants/tokens';
import { callClaude } from '@/services/api';
import { uid } from '@/storage/helpers';
import { Spinner } from '@/components/common/ui';
import type { Case, InheritanceData, InheritanceRisk } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
  onSave:     (data: InheritanceData) => Promise<void>;
}

interface UploadFile {
  id:   string;
  name: string;
  type: string;  // mime type or 'text'
  data: string;  // base64 (images/pdf) or decoded string (text)
  raw:  string | null;
}

type SubTab = 'upload' | 'audit' | 'gap' | 'risk' | 'package';

// ── Constants ─────────────────────────────────────────────────────────────────

const INH_ACCENT = '#7a6fd0';
const INH_LIGHT  = '#a09ae0';
const MAX_FILES  = 8;

const SUB_TABS: Array<{ id: SubTab; icon: string; label: string }> = [
  { id: 'upload',  icon: '⬆', label: 'Upload & Audit' },
  { id: 'audit',   icon: '◉', label: 'State of Case'  },
  { id: 'gap',     icon: '⚠', label: 'Gap & Damage'   },
  { id: 'risk',    icon: '⛨', label: 'Risk Register'  },
  { id: 'package', icon: '📦', label: 'Intel Package'  },
];

// ── Severity colour ───────────────────────────────────────────────────────────

function sevCol(s: string): string {
  const u = (s || '').toUpperCase();
  if (u === 'HIGH')   return '#c05050';
  if (u === 'MEDIUM') return '#c09040';
  return '#5a8a5a';
}

// ── Prose renderer (plain text, pre-wrap) ─────────────────────────────────────

function Prose({ text, size = 15 }: { text?: string; size?: number }) {
  if (!text) return null;
  return (
    <div style={{ fontSize: size, color: '#cac6ba', lineHeight: 1.9, fontFamily: "'Cormorant Garamond', serif", whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
  );
}

// ── Bullet list renderer ──────────────────────────────────────────────────────

function BulletList({ items, accent = INH_ACCENT }: { items?: string[]; accent?: string }) {
  if (!items || items.length === 0) {
    return <p style={{ color: T.mute, fontStyle: 'italic', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>None identified.</p>;
  }
  return (
    <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
      {items.map((it, i) => (
        <li key={i} style={{ fontSize: 15, color: '#c8c4b8', lineHeight: 1.85, fontFamily: "'Cormorant Garamond', serif", marginBottom: 6, paddingLeft: 4 }}>
          <span style={{ color: accent, marginRight: 4 }}>▸</span>{it}
        </li>
      ))}
    </ul>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({
  label,
  text,
  secKey,
  copiedSec,
  onCopy,
}: {
  label:     string;
  text?:     string;
  secKey:    string;
  copiedSec: string | null;
  onCopy:    (text: string, key: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 28 }}>
      <p style={{ fontSize: 10, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, margin: 0 }}>
        {label}
      </p>
      {text && (
        <button
          onClick={() => onCopy(text, secKey)}
          style={{ background: 'transparent', border: '1px solid #1a1a28', color: copiedSec === secKey ? INH_ACCENT : T.mute, borderRadius: 3, padding: '3px 10px', fontSize: 10, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}
        >
          {copiedSec === secKey ? '✓ Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function InheritanceMode({ activeCase, onSave }: Props) {
  const saved = activeCase.inheritance_data ?? null;

  const [subTab,    setSubTab]    = useState<SubTab>(saved ? 'audit' : 'upload');
  const [uploads,   setUploads]   = useState<UploadFile[]>([]);
  const [pastedTxt, setPastedTxt] = useState('');
  const [caseCtx,   setCaseCtx]   = useState('');
  const [running,   setRunning]   = useState(false);
  const [runPhase,  setRunPhase]  = useState('');
  const [errMsg,    setErrMsg]    = useState('');
  const [result,    setResult]    = useState<InheritanceData | null>(saved);
  const [copiedSec, setCopiedSec] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Clipboard helper ────────────────────────────────────────────────────────

  function copyText(text: string, key: string) {
    try { navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopiedSec(key);
    setTimeout(() => setCopiedSec(null), 2400);
  }

  // ── File upload handler ─────────────────────────────────────────────────────

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    setErrMsg('');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'];
    const incoming: File[] = [];

    for (const f of Array.from(fileList)) {
      if (uploads.length + incoming.length >= MAX_FILES) {
        setErrMsg(`Maximum ${MAX_FILES} files per audit.`); break;
      }
      if (f.size > 15 * 1024 * 1024) { setErrMsg(`${f.name} exceeds 15 MB limit.`); continue; }
      if (!allowed.includes(f.type) && !/\.(txt|pdf|jpg|jpeg|png|webp)$/i.test(f.name)) {
        setErrMsg(`${f.name}: only images, PDF, and text files are accepted.`); continue;
      }
      incoming.push(f);
    }

    incoming.forEach(f => {
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = (e.target?.result as string) || '';
        const b64 = dataUrl.split(',')[1] || dataUrl;
        const isText = f.type === 'text/plain';
        setUploads(prev => [...prev, {
          id:   uid(),
          name: f.name,
          type: isText ? 'text' : f.type,
          data: isText ? atob(b64) : b64,
          raw:  isText ? atob(b64) : null,
        }]);
      };
      reader.readAsDataURL(f);
    });
  }

  function removeFile(id: string) {
    setUploads(prev => prev.filter(u => u.id !== id));
  }

  // ── Run the forensic audit ──────────────────────────────────────────────────

  async function runAudit() {
    if (!pastedTxt.trim() && uploads.length === 0) {
      setErrMsg('Upload at least one document or paste case text before running the audit.');
      return;
    }
    setRunning(true); setErrMsg(''); setRunPhase('Preparing document bundle…');

    // Build content array for the API call
    type ContentBlock =
      | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'image';    source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text';     text: string };

    const content: ContentBlock[] = [];

    const mediaFiles = uploads.filter(u => u.type !== 'text');
    const txtFiles   = uploads.filter(u => u.type === 'text');
    const extraMedia = mediaFiles.slice(5);  // API block limit

    mediaFiles.slice(0, 5).forEach(u => {
      if (u.type === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: u.data } });
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: u.type, data: u.data } });
      }
    });

    let promptText = '';
    if (caseCtx.trim())   promptText += `LAWYER'S SITUATION SUMMARY:\n${caseCtx.trim()}\n\n`;
    if (pastedTxt.trim()) promptText += `DOCUMENTS / CORRESPONDENCE (PASTED TEXT):\n${pastedTxt.trim()}\n\n`;
    if (txtFiles.length)  promptText += `TEXT FILES UPLOADED:\n${txtFiles.map(u => `--- ${u.name} ---\n${u.raw}`).join('\n\n')}\n\n`;
    if (extraMedia.length) promptText += `ADDITIONAL UPLOADED FILES (names only — beyond API block limit): ${extraMedia.map(u => u.name).join(', ')}\n\n`;

    promptText += `CASE BEING INHERITED: ${activeCase.caseName || '(unnamed)'}`;
    if (activeCase.court)  promptText += ` | Court: ${activeCase.court}`;
    if (activeCase.suitNo) promptText += ` | Suit: ${activeCase.suitNo}`;
    if (activeCase.role)   promptText += ` | Role: ${activeCase.role}`;

    content.push({ type: 'text', text: promptText });

    const system = `You are a forensic legal analyst embedded as a Senior Advocate at AFS Advocates, Lagos. A lawyer is inheriting a case mid-stream from another counsel. Your task is a complete forensic State-of-Case Audit. Analyse all uploaded documents, pleadings, orders, correspondence, and case context provided.

Respond ONLY with a single valid JSON object — no preamble, no backticks, no markdown. The JSON must have exactly these top-level keys:

{
  "state_of_case": "string — comprehensive narrative of the current case posture: what has been filed, what arguments have been made on the record, what the court has ruled, where proceedings currently stand, what stage the case is at. Be forensic. Cite document names and dates where visible.",

  "what_was_done": ["array of strings — specific acts the previous lawyer DID: each filing made, each hearing attended, each application filed, each order obtained or suffered, each concession made, each commitment to the court."],

  "gap_report": {
    "not_done": ["array — things that SHOULD have been done but were not. Missing pleadings, unserved processes, unfiled evidence, missed follow-up orders, arguments not raised, rights not exercised."],
    "errors_made": ["array — identifiable errors: bad pleadings, wrong parties, missed deadlines, incorrect procedure, bad concessions, improper admissions, waived rights."],
    "too_late": ["array — things that cannot be recovered: expired limitation windows, waived rights, concessions already on record, orders not appealed, time-barred steps."],
    "can_be_saved": ["array — things that look damaged but can still be remedied: errors correctable by amendment, gaps fillable by application, issues still open on the pleadings, rights not yet lost."]
  },

  "risk_register": [
    {
      "risk": "string — title of the risk",
      "severity": "HIGH | MEDIUM | LOW",
      "detail": "string — specific facts behind this risk and what it means for the case.",
      "action": "string — what the incoming lawyer must do about this risk."
    }
  ],

  "inheritance_package": {
    "current_posture": "string — one authoritative paragraph on where the case truly stands right now.",
    "immediate_actions": ["array — the first 5 things the incoming lawyer must do this week. Priority order. Specific steps only."],
    "remaining_steps": ["array — full procedural roadmap from current position through to judgment or resolution."],
    "strategy_options": "string — 2–3 strategic paths available from this inherited position.",
    "recommended_starting_posture": "string — SAN's clear recommendation on how to enter this case."
  }
}

Return ONLY the JSON object. No additional text.`;

    try {
      setRunPhase('Running forensic audit — analysing documents…');

      // Use direct fetch for multi-part content (callClaude only handles text)
      const apiKey = localStorage.getItem('afs_api_key') || '';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':                              'application/json',
          'x-api-key':                                 apiKey,
          'anthropic-version':                         '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content }],
        }),
      });

      const raw = await res.json();
      if (!res.ok || raw.error) throw new Error(raw.error?.message ?? `HTTP ${res.status}`);

      const txt = (raw.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('');

      let parsed: InheritanceData;
      try {
        const clean = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        parsed = JSON.parse(clean) as InheritanceData;
      } catch (pe) {
        throw new Error('AI returned malformed output — please try again. ' + (pe as Error).message);
      }

      parsed._auditDate   = new Date().toISOString();
      parsed._uploadNames = uploads.map(u => u.name);

      setResult(parsed);
      await onSave(parsed);
      setSubTab('audit');

    } catch (e) {
      setErrMsg('Audit failed: ' + ((e as Error).message || 'unknown error'));
    } finally {
      setRunning(false);
      setRunPhase('');
    }
  }

  const hasResult = !!result;

  // ── Shared input styles ─────────────────────────────────────────────────────

  const taStyle: React.CSSProperties = {
    width: '100%', background: T.bg, border: '1px solid #1e1e2e', borderRadius: 5,
    color: T.text, padding: '12px 14px', fontSize: 14,
    fontFamily: "'Cormorant Garamond', serif", outline: 'none',
    resize: 'vertical', lineHeight: 1.8, boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: INH_ACCENT, fontFamily: 'Inter, sans-serif',
    letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600,
    display: 'block', marginBottom: 8,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '0 2px 48px' }}>

      {/* ── Module header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ fontSize: 9, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', letterSpacing: '.22em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            Mid-Case Inheritance · Step 11
          </p>
          <h2 style={{ fontSize: 28, color: INH_LIGHT, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontStyle: 'italic', margin: 0 }}>
            Inheritance Mode
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: 'Inter, sans-serif', marginTop: 6, lineHeight: 1.6, maxWidth: 520 }}>
            Forensic audit of a case inherited from another counsel. Upload every document you have received — produces a State-of-Case Audit, Gap &amp; Damage Report, Risk Register, and full Intelligence Package.
          </p>
        </div>
        {hasResult && (
          <div style={{ background: '#0c0c18', border: `1px solid ${INH_ACCENT}33`, borderRadius: 6, padding: '8px 16px', textAlign: 'right' }}>
            <p style={{ fontSize: 9, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, margin: '0 0 3px' }}>Last Audit</p>
            <p style={{ fontSize: 12, color: T.dim, fontFamily: 'Inter, sans-serif', margin: 0 }}>
              {new Date(result!._auditDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        )}
      </div>

      {/* ── Sub-tab navigation ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: `1px solid ${T.bdr}`, paddingBottom: 0, overflowX: 'auto' }}>
        {SUB_TABS.map(st => {
          const locked   = st.id !== 'upload' && !hasResult;
          const isActive = subTab === st.id;
          return (
            <button
              key={st.id}
              onClick={() => { if (!locked) setSubTab(st.id); }}
              disabled={locked}
              style={{
                background:    'transparent',
                border:        'none',
                borderBottom:  isActive ? `2px solid ${INH_ACCENT}` : '2px solid transparent',
                color:         locked ? '#252535' : isActive ? INH_LIGHT : T.mute,
                padding:       '10px 16px 12px',
                fontSize:      11,
                fontFamily:    'Inter, sans-serif',
                cursor:        locked ? 'not-allowed' : 'pointer',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                fontWeight:    600,
                whiteSpace:    'nowrap',
                transition:    'all .2s',
                display:       'flex',
                alignItems:    'center',
                gap:           6,
              }}
            >
              <span style={{ opacity: locked ? 0.25 : 1 }}>{st.icon}</span>
              <span style={{ opacity: locked ? 0.25 : 1 }}>{st.label}</span>
              {st.id !== 'upload' && !hasResult && (
                <span style={{ fontSize: 8, color: '#1e1e2e', border: '1px solid #181828', padding: '1px 4px', borderRadius: 2 }}>PENDING</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════
          SUB-TAB: UPLOAD & AUDIT
      ══════════════════════════════════════ */}
      {subTab === 'upload' && (
        <div style={{ maxWidth: 780 }}>

          {/* Prior audit banner */}
          {hasResult && (
            <div style={{ background: '#0c1810', border: '1px solid #1a3820', borderRadius: 6, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18, color: '#5a9a5a' }}>✓</span>
                <div>
                  <p style={{ fontSize: 12, color: '#7ab87a', fontFamily: 'Inter, sans-serif', fontWeight: 600, margin: '0 0 2px' }}>
                    Audit complete — {new Date(result!._auditDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>
                    Files audited: {(result!._uploadNames || []).join(', ') || '(pasted text)'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSubTab('audit')} style={{ background: 'transparent', border: '1px solid #2a4a2a', color: '#7ab87a', borderRadius: 4, padding: '6px 14px', fontSize: 11, fontFamily: 'Inter, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                View Results →
              </button>
            </div>
          )}

          {/* Situation summary */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Your Summary of the Situation{' '}
              <span style={{ color: T.mute, textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, fontSize: 11 }}>(optional)</span>
            </label>
            <textarea
              value={caseCtx}
              onChange={e => setCaseCtx(e.target.value)}
              placeholder="e.g. I'm taking over from Barrister X. The case has been going for 3 years. Last order was in March — adjourned for trial. I believe a preliminary objection was filed but I'm not sure what happened. I have 4 documents…"
              rows={4}
              style={taStyle}
            />
          </div>

          {/* File upload zone */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Upload Documents{' '}
              <span style={{ color: T.mute, textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, fontSize: 11 }}>
                (images, PDFs, text files — up to {MAX_FILES} files, 15 MB each)
              </span>
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
              style={{ border: `1px dashed ${INH_ACCENT}66`, borderRadius: 6, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: '#08080f' }}
            >
              <div style={{ fontSize: 28, marginBottom: 8, opacity: .4 }}>⬆</div>
              <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>Click to upload or drag files here</p>
              <p style={{ fontSize: 11, color: '#303040', fontFamily: 'Inter, sans-serif', marginTop: 4 }}>
                Pleadings · Orders · Correspondence · Affidavits · Judgments · Any case document
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt"
              style={{ display: 'none' }}
              onChange={e => handleFiles(e.target.files)}
            />
          </div>

          {/* Uploaded file chips */}
          {uploads.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {uploads.map(u => (
                <div key={u.id} style={{ background: '#0e0e1c', border: `1px solid ${INH_ACCENT}33`, borderRadius: 4, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>
                    {u.type === 'application/pdf' ? '📄' : u.type === 'text' ? '📝' : '🖼'}
                  </span>
                  <span style={{ fontSize: 11, color: T.dim, fontFamily: 'Inter, sans-serif', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name}
                  </span>
                  <button onClick={() => removeFile(u.id)} style={{ background: 'transparent', border: 'none', color: '#4a4a5a', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Paste zone */}
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>
              Paste Text From Documents{' '}
              <span style={{ color: T.mute, textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, fontSize: 11 }}>(copy-paste from pleadings, orders, correspondence)</span>
            </label>
            <textarea
              value={pastedTxt}
              onChange={e => setPastedTxt(e.target.value)}
              placeholder="Paste the text of any documents here — court orders, pleadings, written addresses, correspondence, affidavits. The more context the AI has, the more precise the audit."
              rows={8}
              style={taStyle}
            />
            <p style={{ fontSize: 10, color: '#303040', fontFamily: 'Inter, sans-serif', marginTop: 5, textAlign: 'right' }}>
              {pastedTxt.length.toLocaleString()} characters
            </p>
          </div>

          {errMsg && (
            <div style={{ background: '#1a0810', border: '1px solid #4a1830', borderRadius: 5, padding: '10px 14px', color: '#c07070', fontSize: 13, fontFamily: 'Inter, sans-serif', marginBottom: 16 }}>
              {errMsg}
            </div>
          )}

          {/* Run button */}
          {(() => {
            const canRun = !running && (uploads.length > 0 || pastedTxt.trim().length > 0);
            return (
              <button
                onClick={runAudit}
                disabled={!canRun}
                style={canRun
                  ? { background: `linear-gradient(135deg,${INH_ACCENT},#5a50b0)`, color: '#f0f0ff', border: 'none', borderRadius: 6, padding: '15px 28px', fontSize: 16, fontFamily: "'Cormorant Garamond', serif", cursor: 'pointer', width: '100%', letterSpacing: '.04em', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }
                  : { background: '#101018', color: '#2a2a38', border: `1px solid ${T.bdr}`, borderRadius: 6, padding: '15px 28px', fontSize: 16, fontFamily: "'Cormorant Garamond', serif", cursor: 'not-allowed', width: '100%', letterSpacing: '.04em' }
                }
              >
                {running
                  ? <><Spinner size={14} color="#f0f0ff" /> {runPhase || 'Running audit…'}</>
                  : hasResult ? '⟳ Re-Run Forensic Audit' : '⟳ Run Forensic State-of-Case Audit'
                }
              </button>
            );
          })()}

          {running && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <p style={{ fontSize: 11, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', letterSpacing: '.08em' }}>{runPhase}</p>
              <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', marginTop: 4 }}>Analysing all documents — this may take 15–30 seconds</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════
          SUB-TAB: STATE OF CASE AUDIT
      ══════════════════════════════════════ */}
      {subTab === 'audit' && hasResult && result && (
        <div style={{ maxWidth: 780 }}>
          <SectionHead label="State-of-Case Audit" text={result.state_of_case} secKey="soc" copiedSec={copiedSec} onCopy={copyText} />
          <div style={{ background: '#070710', border: `1px solid ${INH_ACCENT}22`, borderRadius: 6, padding: '20px 22px', marginBottom: 24 }}>
            <Prose text={result.state_of_case} />
          </div>

          <SectionHead label="What the Previous Lawyer Did" text={(result.what_was_done || []).join('\n')} secKey="wwd" copiedSec={copiedSec} onCopy={copyText} />
          <div style={{ background: '#070710', border: '1px solid #1e1e2e', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
            <BulletList items={result.what_was_done} />
          </div>

          <div style={{ background: '#0a080f', border: `1px solid ${INH_ACCENT}33`, borderRadius: 6, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>Proceed to Gap &amp; Damage Report →</p>
            <button onClick={() => setSubTab('gap')} style={{ background: 'transparent', border: `1px solid ${INH_ACCENT}`, color: INH_LIGHT, borderRadius: 4, padding: '7px 18px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}>
              Gap Report →
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          SUB-TAB: GAP & DAMAGE REPORT
      ══════════════════════════════════════ */}
      {subTab === 'gap' && hasResult && result && (
        <div style={{ maxWidth: 780 }}>

          <SectionHead label="What Was Not Done (And Should Have Been)" text={(result.gap_report?.not_done || []).join('\n')} secKey="gnd" copiedSec={copiedSec} onCopy={copyText} />
          <div style={{ background: '#0f0808', border: '1px solid #2a1818', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
            <BulletList items={result.gap_report?.not_done} accent="#c07070" />
          </div>

          <SectionHead label="Errors Identified" text={(result.gap_report?.errors_made || []).join('\n')} secKey="gem" copiedSec={copiedSec} onCopy={copyText} />
          <div style={{ background: '#0f0808', border: '1px solid #2a1818', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
            <BulletList items={result.gap_report?.errors_made} accent="#c07070" />
          </div>

          <div style={{ marginBottom: 12, marginTop: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 10, color: '#c05050', fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, margin: 0 }}>
              ⛔ Now Too Late To Fix
            </p>
          </div>
          <div style={{ background: '#120606', border: '1px solid #3a1010', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
            <BulletList items={result.gap_report?.too_late} accent="#9a3030" />
          </div>

          <SectionHead label="✓ Still Recoverable" text={(result.gap_report?.can_be_saved || []).join('\n')} secKey="gcs" copiedSec={copiedSec} onCopy={copyText} />
          <div style={{ background: '#060f08', border: '1px solid #1a2e1a', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
            <BulletList items={result.gap_report?.can_be_saved} accent="#5a9a5a" />
          </div>

          <div style={{ background: '#0a080f', border: `1px solid ${INH_ACCENT}33`, borderRadius: 6, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>Proceed to Risk Register →</p>
            <button onClick={() => setSubTab('risk')} style={{ background: 'transparent', border: `1px solid ${INH_ACCENT}`, color: INH_LIGHT, borderRadius: 4, padding: '7px 18px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}>
              Risk Register →
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          SUB-TAB: RISK REGISTER
      ══════════════════════════════════════ */}
      {subTab === 'risk' && hasResult && result && (
        <div style={{ maxWidth: 780 }}>
          <SectionHead
            label="Risk Register"
            text={(result.risk_register || []).map(r => `[${r.severity}] ${r.risk}\n${r.detail}\nAction: ${r.action}`).join('\n\n')}
            secKey="rr"
            copiedSec={copiedSec}
            onCopy={copyText}
          />

          {(!result.risk_register || result.risk_register.length === 0) && (
            <p style={{ color: T.mute, fontStyle: 'italic', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              No risks identified — consider re-running with more documents pasted.
            </p>
          )}

          {(result.risk_register || []).map((r: InheritanceRisk, i: number) => (
            <div key={i} style={{ background: '#080810', border: `1px solid ${sevCol(r.severity)}33`, borderRadius: 6, padding: '16px 20px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <p style={{ fontSize: 15, color: T.text, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, margin: 0, flex: 1 }}>{r.risk}</p>
                <span style={{ fontSize: 9, color: sevCol(r.severity), border: `1px solid ${sevCol(r.severity)}55`, borderRadius: 2, padding: '3px 8px', fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                  {r.severity || 'UNKNOWN'}
                </span>
              </div>
              <p style={{ fontSize: 14, color: '#c0bbb0', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.85, margin: '0 0 10px' }}>{r.detail}</p>
              <div style={{ borderTop: '1px solid #111120', paddingTop: 10 }}>
                <p style={{ fontSize: 9, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 5 }}>Required Action</p>
                <p style={{ fontSize: 13, color: '#9090b0', fontFamily: 'Inter, sans-serif', lineHeight: 1.7, margin: 0 }}>{r.action}</p>
              </div>
            </div>
          ))}

          <div style={{ background: '#0a080f', border: `1px solid ${INH_ACCENT}33`, borderRadius: 6, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
            <p style={{ fontSize: 13, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>Proceed to Inheritance Intelligence Package →</p>
            <button onClick={() => setSubTab('package')} style={{ background: `linear-gradient(135deg,${INH_ACCENT},#5a50b0)`, color: '#f0f0ff', border: 'none', borderRadius: 4, padding: '8px 18px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', fontWeight: 600 }}>
              Intel Package →
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          SUB-TAB: INHERITANCE INTEL PACKAGE
      ══════════════════════════════════════ */}
      {subTab === 'package' && hasResult && result && (() => {
        const pkg = result.inheritance_package || {} as InheritanceData['inheritance_package'];

        const fullExport = [
          `INHERITANCE INTELLIGENCE PACKAGE`,
          `Case: ${activeCase.caseName || ''}${activeCase.suitNo ? ' | Suit: ' + activeCase.suitNo : ''}`,
          `Audit Date: ${new Date(result._auditDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          `\n${'═'.repeat(60)}\nCURRENT POSTURE\n${'═'.repeat(60)}\n${pkg.current_posture || ''}`,
          `\n${'═'.repeat(60)}\nIMMEDIATE ACTIONS (THIS WEEK)\n${'═'.repeat(60)}\n${(pkg.immediate_actions || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
          `\n${'═'.repeat(60)}\nREMAINING STEPS — PROCEDURAL ROADMAP\n${'═'.repeat(60)}\n${(pkg.remaining_steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
          `\n${'═'.repeat(60)}\nSTRATEGY OPTIONS\n${'═'.repeat(60)}\n${pkg.strategy_options || ''}`,
          `\n${'═'.repeat(60)}\nSAN'S RECOMMENDED STARTING POSTURE\n${'═'.repeat(60)}\n${pkg.recommended_starting_posture || ''}`,
        ].join('\n');

        return (
          <div style={{ maxWidth: 780 }}>

            {/* Current Posture */}
            <SectionHead label="Current Case Posture" text={pkg.current_posture} secKey="pcp" copiedSec={copiedSec} onCopy={copyText} />
            <div style={{ background: `${INH_ACCENT}09`, border: `1px solid ${INH_ACCENT}30`, borderRadius: 6, padding: '20px 22px', marginBottom: 24 }}>
              <Prose text={pkg.current_posture} />
            </div>

            {/* Immediate Actions */}
            <SectionHead label="Immediate Actions — This Week" text={(pkg.immediate_actions || []).join('\n')} secKey="pia" copiedSec={copiedSec} onCopy={copyText} />
            <div style={{ background: '#070710', border: '1px solid #1a1a28', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
              {(pkg.immediate_actions || []).length > 0 ? (pkg.immediate_actions || []).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12, padding: '10px 12px', background: '#0a0a18', borderRadius: 4, border: '1px solid #111122' }}>
                  <span style={{ fontSize: 11, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', fontWeight: 700, minWidth: 22, paddingTop: 3 }}>{i + 1}.</span>
                  <p style={{ fontSize: 15, color: '#cac6ba', fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.8, margin: 0 }}>{a}</p>
                </div>
              )) : <p style={{ color: T.mute, fontStyle: 'italic', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>None identified.</p>}
            </div>

            {/* Remaining Steps */}
            <SectionHead label="Procedural Roadmap — Remaining Steps" text={(pkg.remaining_steps || []).join('\n')} secKey="prs" copiedSec={copiedSec} onCopy={copyText} />
            <div style={{ background: '#070710', border: '1px solid #1a1a28', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
              <BulletList items={pkg.remaining_steps} accent={INH_ACCENT} />
            </div>

            {/* Strategy Options */}
            <SectionHead label="Strategy Options From This Position" text={pkg.strategy_options} secKey="pso" copiedSec={copiedSec} onCopy={copyText} />
            <div style={{ background: '#070710', border: '1px solid #1a1a28', borderRadius: 6, padding: '20px 22px', marginBottom: 24 }}>
              <Prose text={pkg.strategy_options} />
            </div>

            {/* SAN Recommendation */}
            <div style={{ marginBottom: 12, marginTop: 28 }}>
              <p style={{ fontSize: 10, color: INH_ACCENT, fontFamily: 'Inter, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, margin: '0 0 4px' }}>
                SAN's Recommended Starting Posture
              </p>
              <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', margin: 0 }}>Guidance only — the decision is yours</p>
            </div>
            <div style={{ background: `${INH_ACCENT}0d`, border: `1px solid ${INH_ACCENT}44`, borderRadius: 6, padding: '20px 22px', marginBottom: 28 }}>
              <Prose text={pkg.recommended_starting_posture} />
            </div>

            {/* Export + re-run */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
              <button
                onClick={() => copyText(fullExport, 'full_pkg')}
                style={{ background: 'transparent', border: `1px solid ${INH_ACCENT}`, color: INH_LIGHT, borderRadius: 4, padding: '9px 20px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em', fontWeight: 600 }}
              >
                {copiedSec === 'full_pkg' ? '✓ Copied' : 'Copy Full Package'}
              </button>
              <button
                onClick={() => setSubTab('upload')}
                style={{ background: 'transparent', border: '1px solid #1e1e2e', color: T.mute, borderRadius: 4, padding: '9px 20px', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', letterSpacing: '.04em' }}
              >
                ⟳ Re-run Audit
              </button>
            </div>

            {/* Handover confirmation */}
            <div style={{ background: '#060f08', border: '1px solid #1a3020', borderRadius: 6, padding: '16px 20px' }}>
              <p style={{ fontSize: 11, color: '#5a9a5a', fontFamily: 'Inter, sans-serif', letterSpacing: '.08em', fontWeight: 600, margin: '0 0 6px' }}>✓ INHERITANCE COMPLETE</p>
              <p style={{ fontSize: 13, color: T.dim, fontFamily: 'Inter, sans-serif', lineHeight: 1.7, margin: 0 }}>
                You now operate as if you built this case — with full awareness of what came before you. All other modules (Intelligence Engine, Argument Builder, Docket, Evidence Vault, Brief Me) are available and will function normally from this point forward.
              </p>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
