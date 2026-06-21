/**
 * AFS Advocates — Evidence Vault
 * Phase 2 — Full implementation
 *
 * Per-case document upload system. Categories: Contracts | Affidavits |
 * Receipts | Chats | Audio | Photos | Court Orders | Expert Reports.
 *
 * Features:
 *  - Drag-and-drop or click-to-upload (images, PDFs, any file)
 *  - Auto-detect category from filename / MIME type
 *  - Lawyer's notes per document
 *  - Preview: images render inline, PDFs use <object>, others show download
 *  - SAN Document Intelligence — AI reads images & PDFs and returns
 *    a full litigation assessment (summary, significance, strengths,
 *    vulnerabilities, action items)
 *  - Category filter chips + search
 *  - Delete with confirmation
 *  - All file bytes stored in IndexedDB (evidence_files table)
 *  - Metadata stored in evidence_meta table
 *  - 2 MB file limit (IndexedDB, not localStorage)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Case, EvidenceItem }                          from '@/types';
import { T }                                               from '@/constants/tokens';
import { queryLibrary, deriveQuery }                       from '@/services/library';
import { Md, TypeDeleteModal }                             from '@/components/common/ui';
import { uid }                                             from '@/utils';
import {
  loadEvidenceMeta,
  saveEvidenceMeta,
  saveEvidenceFile,
  loadEvidenceFile,
  deleteEvidenceFile,
  saveMediaItem,
  saveMediaAsTemplate,
  loadCaseMedia,
  loadGlobalMedia,
  deleteMediaItem,
} from '@/storage/helpers';
import type { MediaLibraryItem } from '@/storage/db';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_URL   = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const EV_MAX_BYTES = 2 * 1024 * 1024; // 2 MB per file
const MEDIA_MAX_BYTES = 2 * 1024 * 1024; // Phase 8B — same ceiling, mirrors EV_MAX_BYTES

const EV_CATS = [
  { id: 'contract',    label: 'Contracts',      icon: '📜', col: '#7060d0' },
  { id: 'affidavit',  label: 'Affidavits',     icon: '✋', col: '#4a7ed0' },
  { id: 'receipt',    label: 'Receipts',       icon: '🧾', col: '#60a060' },
  { id: 'chat',       label: 'Chats',          icon: '💬', col: '#d09040' },
  { id: 'audio',      label: 'Audio',          icon: '🔊', col: '#d07060' },
  { id: 'photo',      label: 'Photos',         icon: '📷', col: '#60b0b0' },
  { id: 'court_order',label: 'Court Orders',   icon: '⚖',  col: '#c0a030' },
  { id: 'expert',     label: 'Expert Reports', icon: '🔬', col: '#a060c0' },
  { id: 'other',      label: 'Other',          icon: '📄', col: '#606070' },
] as const;

type CatId = typeof EV_CATS[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activeCase: Case;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function catFor(file: File): CatId {
  const name = file.name.toLowerCase();
  if (name.includes('contract') || name.includes('agreement') || name.includes('deed')) return 'contract';
  if (name.includes('affidavit') || name.includes('sworn'))                              return 'affidavit';
  if (name.includes('receipt') || name.includes('invoice') || name.includes('payment')) return 'receipt';
  if (file.type.startsWith('image/'))                                                    return 'photo';
  if (file.type.startsWith('audio/') || file.type.startsWith('video/'))                 return 'audio';
  if (name.includes('order') || name.includes('judgment') || name.includes('ruling'))   return 'court_order';
  if (name.includes('expert') || name.includes('report') || name.includes('opinion'))   return 'expert';
  if (name.includes('chat') || name.includes('whatsapp') || name.includes('message'))   return 'chat';
  return 'other';
}

function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function fmtSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Clipboard image pastes often come back as a File named just "image.png"
 * or with an empty name, depending on the browser. Give it a unique,
 * recognisable name so multiple pastes don't collide or look identical
 * in a future Media Library listing (Phase 8D/8E).
 */
function defaultPasteFilename(file: File): string {
  if (file.name && file.name !== 'image.png' && file.name !== 'blob') return file.name;
  const ext = (file.type.split('/')[1] || 'dat').split(';')[0];
  return `pasted-${Date.now()}.${ext}`;
}

/**
 * Phase 8E — small icon mapper for the merged Media Library list (case +
 * global items). Mirrors AssetLibrary.tsx's iconFor so the two surfaces
 * that render MediaLibraryItem rows stay visually consistent.
 */
function mediaIconFor(fileType: string): string {
  if (fileType.startsWith('image/'))  return '🖼';
  if (fileType === 'application/pdf') return '📄';
  if (fileType.startsWith('audio/'))  return '🔊';
  if (fileType.startsWith('video/'))  return '🎬';
  if (fileType.startsWith('text/'))   return '📝';
  return '📎';
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Preview Panel
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewProps {
  meta:        EvidenceItem;
  b64:         string | null;
  analysis:    string | undefined;
  loadingAI:   boolean;
  activeCase:  Case;
  onBack:      () => void;
  onDelete:    (id: string) => void;
  onAnalyse:   (meta: EvidenceItem) => void;
}

function PreviewPanel({
  meta, b64, analysis, loadingAI, activeCase, onBack, onDelete, onAnalyse,
}: PreviewProps) {
  const cat     = EV_CATS.find(c => c.id === meta.category) ?? EV_CATS[EV_CATS.length - 1];
  const isImage = meta.fileType?.startsWith('image/');
  const isPdf   = meta.fileType === 'application/pdf';
  const src     = b64 ? `data:${meta.fileType};base64,${b64}` : null;

  return (
    <div style={{ animation: 'fadeUp .2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <button onClick={onBack}
          style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
          ← Vault
        </button>
        <span style={{ fontSize: 16, opacity: .7 }}>{cat.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.filename}
          </p>
          <p style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>
            {cat.label} · {fmtDate(meta.timestamp)} · {fmtSize(meta.fileSize)}
          </p>
        </div>
        {src && (
          <a href={src} download={meta.filename}
            style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 12px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', textDecoration: 'none', flexShrink: 0 }}>
            ↓ Save
          </a>
        )}
        <button onClick={() => onDelete(meta.id)}
          style={{ background: 'transparent', border: '1px solid #2a1a1a', color: '#804040', borderRadius: 4, padding: '7px 11px', fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", flexShrink: 0 }}>
          Delete
        </button>
      </div>

      {/* File Preview */}
      {src && (
        <div style={{ background: '#050508', border: '1px solid #111120', borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'center' }}>
          {isImage && (
            <img src={src} alt={meta.filename} style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 5, objectFit: 'contain' }} />
          )}
          {isPdf && (
            <object data={src} type="application/pdf" width="100%" style={{ height: 520, borderRadius: 5 }}>
              <div style={{ padding: '40px 24px' }}>
                <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 14 }}>PDF preview unavailable in this browser.</p>
                <a href={src} download={meta.filename}
                  style={{ color: '#444444', fontSize: 12, fontFamily: "'Times New Roman', Times, serif", border: `1px solid ${T.gold}`, padding: '8px 20px', borderRadius: 4, textDecoration: 'none' }}>
                  Download PDF
                </a>
              </div>
            </object>
          )}
          {!isImage && !isPdf && (
            <div style={{ padding: '44px 24px' }}>
              <p style={{ fontSize: 46, marginBottom: 12, opacity: .2 }}>{cat.icon}</p>
              <p style={{ fontSize: 15, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 6 }}>{meta.filename}</p>
              <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 22 }}>
                {meta.fileType || 'Unknown type'} · {fmtSize(meta.fileSize)}
              </p>
              <a href={src} download={meta.filename}
                style={{ color: '#444444', fontSize: 12, fontFamily: "'Times New Roman', Times, serif", border: `1px solid ${T.gold}`, padding: '9px 22px', borderRadius: 4, textDecoration: 'none' }}>
                ↓ Download File
              </a>
            </div>
          )}
        </div>
      )}

      {/* Lawyer's Notes */}
      {meta.notes && (
        <div style={{ background: '#080808', border: '1px solid #1a1a2a', borderRadius: 6, padding: '12px 16px', marginBottom: 14 }}>
          <p style={{ fontSize: 9, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>Lawyer's Notes</p>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7 }}>{meta.notes}</p>
        </div>
      )}

      {/* SAN Document Intelligence */}
      <div style={{ background: '#ffffff', border: '1px solid #1a1a2e', borderRadius: 7, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (loadingAI || analysis) ? 14 : 0 }}>
          <div>
            <p style={{ fontSize: 9, color: '#7060d0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>
              SAN — Document Intelligence
            </p>
            <p style={{ fontSize: 11, color: '#252540', fontFamily: "'Times New Roman', Times, serif" }}>
              {(isImage || isPdf) ? 'AI reads this document and gives you its full litigation assessment.' : 'AI analysis available for images and PDFs.'}
            </p>
          </div>
          {(isImage || isPdf) && !loadingAI && (
            <button onClick={() => onAnalyse(meta)}
              style={{ background: 'transparent', border: '1px solid #2a2248', color: '#7060d0', borderRadius: 4, padding: '6px 13px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', flexShrink: 0, marginLeft: 12 }}>
              {analysis ? '↺ Re-Analyse' : 'Analyse →'}
            </button>
          )}
        </div>

        {loadingAI && (
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <div style={{ width: 24, height: 24, border: `2px solid ${T.bdr}`, borderTop: '2px solid #7060d0', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin .9s linear infinite' }} />
            <p style={{ fontSize: 13, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>SAN is reading this document…</p>
          </div>
        )}

        {analysis && !loadingAI && (
          <div style={{ borderTop: '1px solid #1a1a2e', paddingTop: 14 }}>
            <Md text={analysis} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Upload Panel
// ─────────────────────────────────────────────────────────────────────────────

interface UploadProps {
  onBack:    () => void;
  onUploaded: (item: EvidenceItem) => void;
  caseId:    string;
}

function UploadPanel({ onBack, onUploaded, caseId }: UploadProps) {
  const [upFile,    setUpFile]    = useState<File | null>(null);
  const [upCat,     setUpCat]     = useState<CatId>('other');
  const [upNotes,   setUpNotes]   = useState('');
  const [dragOver,  setDragOver]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err,       setErr]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setUpFile(file);
    setErr('');
    setUpCat(catFor(file));
  }

  async function handleUpload() {
    if (!upFile) return;
    if (upFile.size > EV_MAX_BYTES) {
      setErr(`File is ${(upFile.size / 1024 / 1024).toFixed(1)} MB — maximum is 2 MB. Compress or reduce the file size before uploading.`);
      return;
    }
    setUploading(true);
    setErr('');
    try {
      const b64  = await fileToB64(upFile);
      const id   = uid();
      const meta: EvidenceItem = {
        id,
        caseId,
        category:  upCat,
        filename:  upFile.name,
        fileType:  upFile.type,
        fileSize:  upFile.size,
        notes:     upNotes.trim(),
        timestamp: new Date().toISOString(),
      };
      const saved = await saveEvidenceFile(id, b64, caseId);
      if (!saved) {
        setErr('Storage quota exceeded. Delete some documents or upload smaller files.');
        setUploading(false);
        return;
      }
      onUploaded(meta);
    } catch (e: unknown) {
      setErr('Upload failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
    setUploading(false);
  }

  return (
    <div style={{ animation: 'fadeUp .2s ease' }}>
      {/* Back nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <button onClick={onBack}
          style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
          ← Vault
        </button>
        <p style={{ fontSize: 9, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600 }}>
          Add Document to Evidence Vault
        </p>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#888888' : '#cccccc'}`,
          borderRadius: 8, padding: '38px 24px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 20,
          transition: 'border-color .15s',
          background: dragOver ? '#ffffff' : 'transparent',
        }}
      >
        <input
          ref={fileRef} type="file" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {upFile ? (
          <>
            <p style={{ fontSize: 30, marginBottom: 8 }}>📄</p>
            <p style={{ fontSize: 14, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 4 }}>{upFile.name}</p>
            <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{fmtSize(upFile.size)} · Click to change</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 30, marginBottom: 10, opacity: .18 }}>📁</p>
            <p style={{ fontSize: 15, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 6 }}>
              Drop file here or click to browse
            </p>
            <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              Images · PDFs · Documents · Audio — up to 2 MB per file
            </p>
          </>
        )}
      </div>

      {/* Category Selector */}
      <p style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 9 }}>
        Category
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 20 }}>
        {EV_CATS.map(cat => (
          <button key={cat.id} onClick={() => setUpCat(cat.id)}
            style={{
              background: upCat === cat.id ? '#0f0f1e' : '#080808',
              border: `1px solid ${upCat === cat.id ? cat.col : '#eeeeee'}`,
              borderRadius: 6, padding: '10px 8px', cursor: 'pointer', textAlign: 'center', transition: 'all .15s',
            }}>
            <span style={{ fontSize: 18, display: 'block', marginBottom: 4 }}>{cat.icon}</span>
            <span style={{ fontSize: 9, color: upCat === cat.id ? cat.col : '#3a3a50', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.07em' }}>
              {cat.label}
            </span>
          </button>
        ))}
      </div>

      {/* Notes */}
      <p style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 7 }}>
        Lawyer's Notes{' '}
        <span style={{ color: '#252535', textTransform: 'none', letterSpacing: 'normal', fontSize: 10, fontWeight: 400 }}>(optional)</span>
      </p>
      <textarea
        value={upNotes} onChange={e => setUpNotes(e.target.value)} rows={3}
        placeholder="What does this document establish? Any concerns? Link to which issue in the case?"
        style={{
          width: '100%', background: '#080808', border: '1px solid #1a1a2a',
          borderRadius: 5, color: T.text, fontFamily: "'Times New Roman', Times, serif",
          fontSize: 13, padding: '10px 12px', resize: 'vertical', lineHeight: 1.65,
          boxSizing: 'border-box', marginBottom: 16, outline: 'none',
        }}
      />

      {err && (
        <div style={{ background: '#1a0808', border: '1px solid #2a1010', borderRadius: 5, padding: '10px 14px', marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: '#d06060', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>{err}</p>
        </div>
      )}

      <button onClick={handleUpload} disabled={!upFile || uploading}
        style={{
          background: T.gold, color: '#050505', border: 'none', borderRadius: 5,
          padding: '11px 28px', fontSize: 13, fontFamily: "'Times New Roman', Times, serif",
          cursor: upFile && !uploading ? 'pointer' : 'not-allowed',
          opacity: upFile && !uploading ? 1 : .35,
          letterSpacing: '.04em', fontWeight: 600,
        }}>
        {uploading ? 'Adding to Vault…' : 'Add to Evidence Vault →'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function EvidenceVault({ activeCase }: Props) {
  const caseId = activeCase.id;

  // ── State ────────────────────────────────────────────────────────────────────
  const [items,      setItems]      = useState<EvidenceItem[]>([]);
  const [filterCat,  setFilterCat]  = useState<string>('all');
  const [searchQ,    setSearchQ]    = useState('');
  const [view,       setView]       = useState<'list' | 'upload' | 'preview'>('list');
  const [previewMeta,setPreviewMeta]= useState<EvidenceItem | null>(null);
  const [previewB64, setPreviewB64] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, string>>({});
  const [aiLoading,  setAiLoading]  = useState<Record<string, boolean>>({});
  const [deleteModal,setDeleteModal]= useState<string | null>(null);

  // ── Phase 8E — merged Media Library (case-scoped + global-scoped) ───────────
  // Queried together via loadCaseMedia(caseId) + loadGlobalMedia() and merged
  // client-side — no dedup needed, since a global item's caseId is always
  // null and can never also match the case-scoped query. Rendered as its
  // own section below the document list so counsel sees this case's pasted
  // assets *and* every global template together, with no separate trip to
  // the Asset Library tab to go looking for a template.
  const [mediaItems,    setMediaItems]    = useState<MediaLibraryItem[]>([]);
  const [mediaLoading,  setMediaLoading]  = useState(true);
  const [mediaSearchQ,  setMediaSearchQ]  = useState('');
  const [mediaPreview,  setMediaPreview]  = useState<MediaLibraryItem | null>(null);
  const [mediaDeleteId, setMediaDeleteId] = useState<string | null>(null);
  const [rowPromoting,  setRowPromoting]  = useState<Record<string, boolean>>({});

  // ── Phase 8B — quick paste/upload capture for the Media Library ─────────────
  // Independent of the categorised Document Upload flow above (UploadPanel /
  // handleUploaded / evidence_meta + evidence_files). This captures a file
  // pasted (Ctrl/Cmd+V) anywhere in the Vault — no category, no notes step —
  // and saves it directly into media_library with scope:'case' (8B.ii).
  // It does not yet appear in the document list below — merging case +
  // global media into this view lands in Phase 8E.
  const [quickMedia,    setQuickMedia]    = useState<MediaLibraryItem | null>(null);
  const [quickMediaErr, setQuickMediaErr] = useState('');
  const [promoting,     setPromoting]     = useState(false);

  /**
   * Phase 8E — promotes a media item (by id) to global/template scope and
   * keeps the merged `mediaItems` list in sync in place, rather than
   * re-querying both tables. Shared by the quick-paste toast's "Save as
   * Template" button and the per-row action in the merged Media Library
   * list below.
   */
  const promoteToTemplate = useCallback(async (id: string) => {
    const updated = await saveMediaAsTemplate(id);
    if (updated) {
      setMediaItems(prev => prev.map(m => (m.id === id ? updated : m)));
      setQuickMedia(qm => (qm && qm.id === id ? updated : qm));
    }
    return updated;
  }, []);

  /**
   * Phase 8C — "Save as Template", from the quick-paste toast. Flips the
   * just-saved item's scope to 'global' and clears its caseId, in place.
   * The same row then becomes available to every matter via the global
   * Asset Library (Phase 8D) and stays visible right here too (Phase 8E).
   */
  async function handleSaveAsTemplate() {
    if (!quickMedia || quickMedia.scope === 'global') return;
    setPromoting(true);
    const updated = await promoteToTemplate(quickMedia.id);
    if (!updated) setQuickMediaErr('Could not save as template — please try again.');
    setPromoting(false);
  }

  /** Phase 8E — "Save as Template" from a row in the merged Media Library list. */
  async function handleRowSaveAsTemplate(id: string) {
    setRowPromoting(p => ({ ...p, [id]: true }));
    const updated = await promoteToTemplate(id);
    setRowPromoting(p => ({ ...p, [id]: false }));
    if (!updated) alert('Could not save as template — please try again.');
  }

  const captureQuickMedia = useCallback(async (file: File) => {
    setQuickMediaErr('');
    if (file.size > MEDIA_MAX_BYTES) {
      setQuickMediaErr(`Pasted file is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum is 2 MB.`);
      return;
    }
    try {
      const b64 = await fileToB64(file);
      const item: MediaLibraryItem = {
        id:        uid(),
        caseId,
        scope:     'case',
        filename:  defaultPasteFilename(file),
        fileType:  file.type || 'application/octet-stream',
        fileSize:  file.size,
        data:      b64,
        notes:     '',
        createdAt: new Date().toISOString(),
      };
      const saved = await saveMediaItem(item);
      if (!saved) {
        setQuickMediaErr('Could not save to the Media Library — storage may be full.');
        return;
      }
      setQuickMedia(item);
      // Phase 8E — prepend straight into the merged list rather than
      // re-querying both tables; this item is case-scoped so it belongs
      // at the front of the merged case+global view immediately.
      setMediaItems(prev => [item, ...prev]);
    } catch {
      setQuickMediaErr('Could not read the pasted item.');
    }
  }, [caseId]);

  useEffect(() => {
    function onWindowPaste(e: ClipboardEvent) {
      // Don't hijack paste inside text fields — the search box, the Notes
      // textarea in UploadPanel, etc. should keep their normal paste
      // behaviour. Only capture when the paste lands on open space.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      const clipItems = e.clipboardData?.items;
      if (!clipItems || clipItems.length === 0) return;

      let file: File | null = null;
      for (let i = 0; i < clipItems.length; i++) {
        if (clipItems[i].kind === 'file') {
          file = clipItems[i].getAsFile();
          if (file) break;
        }
      }
      if (!file) return;

      e.preventDefault();
      captureQuickMedia(file);
    }

    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [captureQuickMedia]);

  // ── Phase 8E — load the merged Media Library on mount / case change ────────
  // Pulls case-scoped items (this matter only) and global-scoped templates
  // (every matter) via two indexed lookups and merges them client-side —
  // this is the "pull case-scoped + global-scoped together" query.
  const loadMedia = useCallback(async () => {
    setMediaLoading(true);
    try {
      const [caseItems, globalItems] = await Promise.all([
        loadCaseMedia(caseId),
        loadGlobalMedia(),
      ]);
      const merged = [...caseItems, ...globalItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setMediaItems(merged);
    } finally {
      setMediaLoading(false);
    }
  }, [caseId]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  /** Phase 8E — delete a media item (case- or global-scoped) from the merged list. */
  async function confirmDeleteMedia(id: string) {
    await deleteMediaItem(id);
    setMediaItems(prev => prev.filter(m => m.id !== id));
    if (mediaPreview?.id === id) setMediaPreview(null);
    setMediaDeleteId(null);
  }

  // ── Load evidence metadata on mount ──────────────────────────────────────────
  useEffect(() => {
    loadEvidenceMeta(caseId).then(loaded => {
      setItems(loaded);
      const cached: Record<string, string> = {};
      loaded.forEach(it => { if (it.aiAnalysis) cached[it.id] = it.aiAnalysis; });
      setAiAnalysis(cached);
    });
  }, [caseId]);

  // ── Category counts ───────────────────────────────────────────────────────────
  const catCounts: Record<string, number> = {};
  items.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filteredItems = items.filter(it => {
    const matchCat = filterCat === 'all' || it.category === filterCat;
    const q = searchQ.toLowerCase();
    const matchQ = !q ||
      it.filename.toLowerCase().includes(q) ||
      (it.notes || '').toLowerCase().includes(q) ||
      (EV_CATS.find(c => c.id === it.category)?.label || '').toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  // ── Filtered media (Phase 8E — search over the merged case+global list) ───────
  const mediaQ = mediaSearchQ.toLowerCase();
  const filteredMedia = mediaItems.filter(it =>
    !mediaQ ||
    it.filename.toLowerCase().includes(mediaQ) ||
    (it.notes || '').toLowerCase().includes(mediaQ)
  );

  // ── Upload completion ─────────────────────────────────────────────────────────
  const handleUploaded = useCallback(async (meta: EvidenceItem) => {
    const updated = [meta, ...items];
    await saveEvidenceMeta(updated);
    setItems(updated);
    setView('list');
  }, [items]);

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteItem(id: string) {
    setDeleteModal(id);
  }

  async function confirmDeleteItem(id: string) {
    await deleteEvidenceFile(id, caseId);
    const updated = items.filter(i => i.id !== id);
    await saveEvidenceMeta(updated);
    setItems(updated);
    if (previewMeta?.id === id) setView('list');
    setDeleteModal(null);
  }

  // ── Open preview ──────────────────────────────────────────────────────────────
  async function openPreview(meta: EvidenceItem) {
    setPreviewMeta(meta);
    setPreviewB64(null);
    setView('preview');
    const b64 = await loadEvidenceFile(meta.id, meta.caseId);
    setPreviewB64(b64);
  }

  // ── SAN AI analysis — routed through Worker ───────────────────────────────────
  async function runAiAnalysis(meta: EvidenceItem) {
    const b64 = await loadEvidenceFile(meta.id, meta.caseId);
    if (!b64) { alert('File data not found in storage.'); return; }

    const isImage = meta.fileType?.startsWith('image/');
    const isPdf   = meta.fileType === 'application/pdf';
    if (!isImage && !isPdf) { alert('AI analysis is available for images and PDFs only.'); return; }

    setAiLoading(l => ({ ...l, [meta.id]: true }));
    try {
      const catLabel = EV_CATS.find(c => c.id === meta.category)?.label ?? meta.category;
      const roleLabel  = activeCase.counsel_role
        ? ({ claimant_side: 'Claimant Side', defendant_side: 'Defendant Side', prosecution: 'Prosecution', defence: 'Defence' }[activeCase.counsel_role] ?? activeCase.role ?? 'Claimant')
        : (activeCase.role ?? 'Claimant');
      const trackLabel = activeCase.matter_track === 'criminal' ? 'Criminal' : 'Civil';
      const caseCtx  = `Case: ${activeCase.caseName} | Court: ${activeCase.court || 'Not specified'} | Track: ${trackLabel} | Role: ${roleLabel}`;

      const contentBlock = isImage
        ? { type: 'image',    source: { type: 'base64', media_type: meta.fileType, data: b64 } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };

      const textBlock = {
        type: 'text',
        text: `You are a Nigerian litigation strategist reviewing a case document.\n\n${caseCtx}\nDocument category: ${catLabel}\nDocument name: ${meta.filename}\n\nAnalyse this document and provide:\n\n**DOCUMENT SUMMARY**\nWhat this document is and what it establishes on its face.\n\n**LEGAL SIGNIFICANCE**\nHow this document affects the case from the perspective of the ${roleLabel}. What does it prove, corroborate, or undermine?\n\n**STRENGTHS**\nWhat this document establishes well. What arguments it supports.\n\n**VULNERABILITIES**\nHow opposing counsel might attack this document. Authenticity? Completeness? Context? Hearsay? Secondary evidence rule issues?\n\n**IMMEDIATE ACTION ITEMS**\nWhat the lawyer must do with or because of this document — now.\n\nBe direct, specific, and brutally honest. Every point matters in litigation.`,
      };

      const evSystem = 'You are SAN — Senior Advocate at AFS Advocates. Analyse legal documents with precision and honesty. Your assessments go directly into active litigation strategy. Be specific to the Nigerian legal context — Evidence Act, Rules of Court, documentary evidence requirements.';
      let effectiveEvSystem = evSystem;
      try {
        const ctx = await queryLibrary(deriveQuery(evSystem, meta.filename), { topK: 6, threshold: 0.70 });
        if (ctx.ok && ctx.block) effectiveEvSystem = `${ctx.block}\n${evSystem}`;
      } catch { /* library unavailable — proceed */ }

      const resp = await fetch(`${WORKER_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system:     effectiveEvSystem,
          max_tokens: 1200,
          messages:   [{ role: 'user', content: [contentBlock, textBlock] }],
        }),
      });

      const data = await resp.json() as { content?: Array<{ type: string; text?: string }>; error?: { message: string } };
      if (data.error) throw new Error(data.error.message);
      const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
      setAiAnalysis(a => ({ ...a, [meta.id]: text }));

      // Persist to evidence_meta so the analysis survives reloads and the
      // file bytes never need to be re-sent just to re-display it.
      const updatedItems = items.map(it => it.id === meta.id ? { ...it, aiAnalysis: text } : it);
      setItems(updatedItems);
      saveEvidenceMeta(updatedItems).catch(() => { /* non-fatal — UI already reflects result */ });
    } catch (e: unknown) {
      setAiAnalysis(a => ({ ...a, [meta.id]: 'Analysis failed: ' + (e instanceof Error ? e.message : 'Unknown error') }));
    }
    setAiLoading(l => ({ ...l, [meta.id]: false }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: PREVIEW
  // ─────────────────────────────────────────────────────────────────────────────

  if (view === 'preview' && previewMeta) {
    return (
      <PreviewPanel
        meta={previewMeta}
        b64={previewB64}
        analysis={aiAnalysis[previewMeta.id]}
        loadingAI={aiLoading[previewMeta.id] ?? false}
        activeCase={activeCase}
        onBack={() => setView('list')}
        onDelete={deleteItem}
        onAnalyse={runAiAnalysis}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: UPLOAD
  // ─────────────────────────────────────────────────────────────────────────────

  if (view === 'upload') {
    return (
      <UploadPanel
        caseId={caseId}
        onBack={() => setView('list')}
        onUploaded={handleUploaded}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: VAULT MAIN LIST
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ animation: 'fadeUp .3s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
        <div>
          <p style={{ fontSize: 10, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Evidence Vault · Step 7
          </p>
          <h2 style={{ fontSize: 22, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, marginBottom: 4 }}>
            Case Documents
          </h2>
          <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Upload, categorise, and analyse every document in this matter.
          </p>
        </div>
        <button onClick={() => setView('upload')}
          style={{ background: 'transparent', border: `1px solid ${T.gold}`, color: '#444444', borderRadius: 5, padding: '9px 18px', fontSize: 12, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', flexShrink: 0 }}>
          + Add Document
        </button>
      </div>

      {/* Phase 8B/8C — quick paste capture, saved to media_library; "Save as Template" flips it to scope:'global' */}
      {(quickMedia || quickMediaErr) && (
        <div style={{
          background: quickMediaErr ? '#1a0808' : '#08140c',
          border: `1px solid ${quickMediaErr ? '#2a1010' : '#1a3a26'}`,
          borderRadius: 6, padding: '10px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          {quickMediaErr ? (
            <p style={{ fontSize: 12, color: '#d06060', fontFamily: "'Times New Roman', Times, serif" }}>
              {quickMediaErr}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: '#60a878', fontFamily: "'Times New Roman', Times, serif" }}>
              {quickMedia!.scope === 'global'
                ? <>🌐 Saved as global template: {quickMedia!.filename} ({fmtSize(quickMedia!.fileSize)}) — available across every matter.</>
                : <>✅ Saved to Case Media Library: {quickMedia!.filename} ({fmtSize(quickMedia!.fileSize)})</>}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {quickMedia && quickMedia.scope === 'case' && (
              <button onClick={handleSaveAsTemplate} disabled={promoting}
                style={{ background: 'transparent', border: '1px solid #1a3a26', color: '#60a878', borderRadius: 3, padding: '4px 10px', fontSize: 10, fontFamily: "'Times New Roman', Times, serif", cursor: promoting ? 'not-allowed' : 'pointer', opacity: promoting ? .5 : 1, letterSpacing: '.03em' }}>
                {promoting ? 'Saving…' : 'Save as Template'}
              </button>
            )}
            <button onClick={() => { setQuickMedia(null); setQuickMediaErr(''); }}
              style={{ background: 'transparent', border: '1px solid #1a1a2a', color: T.mute, borderRadius: 3, padding: '4px 9px', fontSize: 10, cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Category Filter Chips */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <button onClick={() => setFilterCat('all')}
            style={{ background: filterCat === 'all' ? '#0f0f1e' : 'transparent', border: `1px solid ${filterCat === 'all' ? T.gold : '#1a1a2a'}`, color: filterCat === 'all' ? T.gold : T.mute, borderRadius: 4, padding: '5px 11px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            All ({items.length})
          </button>
          {EV_CATS.filter(c => catCounts[c.id]).map(c => (
            <button key={c.id} onClick={() => setFilterCat(filterCat === c.id ? 'all' : c.id)}
              style={{ background: filterCat === c.id ? '#0f0f1e' : 'transparent', border: `1px solid ${filterCat === c.id ? c.col : '#1a1a2a'}`, color: filterCat === c.id ? c.col : T.mute, borderRadius: 4, padding: '5px 11px', fontSize: 9, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{c.icon}</span>{c.label} ({catCounts[c.id]})
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      {items.length > 0 && (
        <input
          value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="Search by filename, notes, or category…"
          style={{ width: '100%', background: '#080808', border: '1px solid #1a1a2a', borderRadius: 5, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontSize: 12, padding: '9px 12px', marginBottom: 18, boxSizing: 'border-box', outline: 'none' }}
        />
      )}

      {/* Empty State */}
      {filteredItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', background: '#050508', border: '1px solid #0f0f18', borderRadius: 8 }}>
          {items.length === 0 ? (
            <>
              <p style={{ fontSize: 48, marginBottom: 14, opacity: .05 }}>📁</p>
              <p style={{ fontSize: 24, color: '#111111', fontFamily: "'Times New Roman', Times, serif", fontWeight: 300, fontStyle: 'italic', marginBottom: 10 }}>
                Vault is Empty
              </p>
              <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.75, maxWidth: 460, margin: '0 auto 24px' }}>
                Upload every document this case turns on — the contract, the court order, the chat screenshots, the photographs. Everything goes in the Vault. Nothing gets lost.
              </p>
              <button onClick={() => setView('upload')}
                style={{ background: T.gold, color: '#050505', border: 'none', borderRadius: 5, padding: '10px 26px', fontSize: 14, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer', letterSpacing: '.04em', fontWeight: 600 }}>
                Add First Document →
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 18, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 14 }}>
                No documents match that search.
              </p>
              <button onClick={() => { setFilterCat('all'); setSearchQ(''); }}
                style={{ background: 'transparent', border: '1px solid #cccccc', color: T.mute, borderRadius: 4, padding: '7px 14px', fontSize: 11, fontFamily: "'Times New Roman', Times, serif", cursor: 'pointer' }}>
                Clear Filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredItems.map(it => {
            const cat = EV_CATS.find(c => c.id === it.category) ?? EV_CATS[EV_CATS.length - 1];
            const isImage = it.fileType?.startsWith('image/');
            return (
              <div
                key={it.id}
                style={{ background: '#080808', border: '1px solid #111120', borderRadius: 7, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'border-color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = cat.col + '55')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#eeeeee')}
              >
                {/* Icon / thumbnail */}
                <div
                  onClick={() => openPreview(it)}
                  style={{ width: 46, height: 46, borderRadius: 5, background: '#050508', border: `1px solid ${cat.col}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                  {isImage ? (
                    <ThumbnailLoader itemId={it.id} fileType={it.fileType} caseId={it.caseId} />
                  ) : (
                    <span style={{ fontSize: 22 }}>{cat.icon}</span>
                  )}
                </div>

                {/* Metadata */}
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => openPreview(it)}>
                  <p style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                    {it.filename}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, color: cat.col, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>{cat.label}</span>
                    <span style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{fmtDate(it.timestamp)}</span>
                    {it.fileSize && <span style={{ fontSize: 9, color: '#252535', fontFamily: "'Times New Roman', Times, serif" }}>{fmtSize(it.fileSize)}</span>}
                  </div>
                  {it.notes && (
                    <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                      {it.notes}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button onClick={e => { e.stopPropagation(); openPreview(it); }}
                    style={{ background: 'transparent', border: '1px solid #1a1a2e', color: T.mute, borderRadius: 3, padding: '5px 9px', fontSize: 10, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.04em' }}>
                    Open
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteItem(it.id); }}
                    style={{ background: 'transparent', border: '1px solid #1e1010', color: '#604040', borderRadius: 3, padding: '5px 7px', fontSize: 10, cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer count */}
      {items.length > 0 && (
        <p style={{ fontSize: 10, color: '#1e1e2a', fontFamily: "'Times New Roman', Times, serif", textAlign: 'center', marginTop: 20, letterSpacing: '.06em' }}>
          {filteredItems.length} of {items.length} document{items.length !== 1 ? 's' : ''} · Evidence Vault · {activeCase.caseName}
        </p>
      )}

      {/* ───────────────────────────────────────────────────────────────────
          MEDIA LIBRARY — Phase 8E
          Case-scoped paste captures (Phase 8B) merged with global-scoped
          templates (Phase 8D), queried together via loadCaseMedia() +
          loadGlobalMedia() and combined client-side. Counsel sees every
          reusable asset right here — no separate trip to the Asset
          Library tab to go looking for a template.
         ─────────────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 40, paddingTop: 28, borderTop: '1px solid #0f0f18' }}>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, color: '#444444', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            Media Library
          </p>
          <p style={{ fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
            Pasted assets for this case, plus global templates available across every matter.
          </p>
        </div>

        {mediaLoading ? (
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
            Loading media library…
          </p>
        ) : mediaItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px', background: '#050508', border: '1px solid #0f0f18', borderRadius: 8 }}>
            <p style={{ fontSize: 32, marginBottom: 10, opacity: .08 }}>📎</p>
            <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
              Paste an image or file (Ctrl/Cmd+V) anywhere in the Vault to add it here. Promote any item to a global template and it's available across every matter.
            </p>
          </div>
        ) : (
          <>
            {mediaItems.length > 4 && (
              <input
                value={mediaSearchQ} onChange={e => setMediaSearchQ(e.target.value)}
                placeholder="Search media by filename or notes…"
                style={{ width: '100%', background: '#080808', border: '1px solid #1a1a2a', borderRadius: 5, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontSize: 12, padding: '9px 12px', marginBottom: 14, boxSizing: 'border-box', outline: 'none' }}
              />
            )}
            {filteredMedia.length === 0 ? (
              <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
                No media match that search.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {filteredMedia.map(it => (
                  <MediaRow
                    key={it.id}
                    item={it}
                    promoting={!!rowPromoting[it.id]}
                    onPreview={setMediaPreview}
                    onDelete={setMediaDeleteId}
                    onSaveAsTemplate={handleRowSaveAsTemplate}
                  />
                ))}
              </div>
            )}
            <p style={{ fontSize: 10, color: '#1e1e2a', fontFamily: "'Times New Roman', Times, serif", textAlign: 'center', marginTop: 16, letterSpacing: '.06em' }}>
              {filteredMedia.length} of {mediaItems.length} media item{mediaItems.length !== 1 ? 's' : ''} · {mediaItems.filter(m => m.scope === 'global').length} global
            </p>
          </>
        )}
      </div>

      {/* Media preview modal */}
      {mediaPreview && (
        <MediaPreviewModal
          item={mediaPreview}
          promoting={!!rowPromoting[mediaPreview.id]}
          onClose={() => setMediaPreview(null)}
          onDelete={setMediaDeleteId}
          onSaveAsTemplate={handleRowSaveAsTemplate}
        />
      )}

      {/* Media delete confirm */}
      {mediaDeleteId && (() => {
        const target = mediaItems.find(m => m.id === mediaDeleteId);
        const isGlobal = target?.scope === 'global';
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: '#080808', border: '1px solid #1a1a2a', borderRadius: 8, padding: 26, maxWidth: 420, width: '100%' }}>
              <p style={{ fontSize: 15, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginTop: 0, marginBottom: 10 }}>
                {isGlobal ? 'Remove Global Template?' : 'Remove from Case Media?'}
              </p>
              <p style={{ fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65, marginBottom: 20 }}>
                {isGlobal
                  ? `"${target?.filename}" is a global template — removing it deletes it from every matter that can see it, not just this one. This cannot be undone.`
                  : `"${target?.filename}" will be removed from this case's Media Library. This cannot be undone.`}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => confirmDeleteMedia(mediaDeleteId)}
                  style={{ background: '#8a1a1a', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", fontWeight: 600 }}>
                  Remove
                </button>
                <button onClick={() => setMediaDeleteId(null)}
                  style={{ background: 'transparent', border: '1px solid #1a1a2a', color: T.mute, borderRadius: 4, padding: '9px 18px', fontSize: 12, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THUMBNAIL LOADER — async image thumbnail for list rows
// ─────────────────────────────────────────────────────────────────────────────

function ThumbnailLoader({ itemId, fileType, caseId }: { itemId: string; fileType: string; caseId: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEvidenceFile(itemId, caseId).then(b64 => {
      if (!cancelled && b64) setSrc(`data:${fileType};base64,${b64}`);
    });
    return () => { cancelled = true; };
  }, [itemId, fileType]);

  if (!src) return <span style={{ fontSize: 22 }}>📷</span>;
  return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA ROW — Phase 8E merged Media Library list row (case + global items)
// ─────────────────────────────────────────────────────────────────────────────

interface MediaRowProps {
  item:             MediaLibraryItem;
  promoting:        boolean;
  onPreview:        (item: MediaLibraryItem) => void;
  onDelete:         (id: string) => void;
  onSaveAsTemplate: (id: string) => void;
}

function MediaRow({ item, promoting, onPreview, onDelete, onSaveAsTemplate }: MediaRowProps) {
  const isImage  = item.fileType.startsWith('image/');
  const src      = isImage ? (item.data.startsWith('data:') ? item.data : `data:${item.fileType};base64,${item.data}`) : null;
  const isGlobal = item.scope === 'global';

  return (
    <div style={{ background: '#080808', border: '1px solid #111120', borderRadius: 7, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div onClick={() => onPreview(item)}
        style={{ width: 42, height: 42, borderRadius: 5, background: '#050508', border: '1px solid #1a1a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', cursor: 'pointer', fontSize: 19 }}>
        {isImage && src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : mediaIconFor(item.fileType)}
      </div>

      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onPreview(item)}>
        <p style={{ fontSize: 12, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.filename}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ fontSize: 8, color: isGlobal ? '#60a878' : '#6080c0', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>
            {isGlobal ? '🌐 Global' : '📍 This Case'}
          </span>
          <span style={{ fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>{fmtSize(item.fileSize)}</span>
          <span style={{ fontSize: 9, color: '#252535', fontFamily: "'Times New Roman', Times, serif" }}>{fmtDate(item.createdAt)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {!isGlobal && (
          <button onClick={e => { e.stopPropagation(); onSaveAsTemplate(item.id); }} disabled={promoting}
            style={{ background: 'transparent', border: '1px solid #1a3a26', color: '#60a878', borderRadius: 3, padding: '5px 9px', fontSize: 9, cursor: promoting ? 'not-allowed' : 'pointer', opacity: promoting ? .5 : 1, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.03em' }}>
            {promoting ? 'Saving…' : 'Save as Template'}
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onPreview(item); }}
          style={{ background: 'transparent', border: '1px solid #1a1a2e', color: T.mute, borderRadius: 3, padding: '5px 9px', fontSize: 10, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
          Open
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(item.id); }}
          style={{ background: 'transparent', border: '1px solid #1e1010', color: '#604040', borderRadius: 3, padding: '5px 7px', fontSize: 10, cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA PREVIEW MODAL — Phase 8E
// ─────────────────────────────────────────────────────────────────────────────

interface MediaPreviewModalProps {
  item:             MediaLibraryItem;
  promoting:        boolean;
  onClose:          () => void;
  onDelete:         (id: string) => void;
  onSaveAsTemplate: (id: string) => void;
}

function MediaPreviewModal({ item, promoting, onClose, onDelete, onSaveAsTemplate }: MediaPreviewModalProps) {
  const src      = item.data.startsWith('data:') ? item.data : `data:${item.fileType};base64,${item.data}`;
  const isImage  = item.fileType.startsWith('image/');
  const isPdf    = item.fileType === 'application/pdf';
  const isGlobal = item.scope === 'global';

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#080808', border: '1px solid #1a1a2a', borderRadius: 10, padding: 24, maxWidth: 680, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, color: T.text, fontWeight: 600, fontFamily: "'Times New Roman', Times, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.filename}
            </p>
            <p style={{ fontSize: 10, color: isGlobal ? '#60a878' : T.mute, marginTop: 3, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.08em', textTransform: 'uppercase' }}>
              {isGlobal ? '🌐 Global Template' : '📍 This Case'} · {fmtSize(item.fileSize)} · {fmtDate(item.createdAt)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <a href={src} download={item.filename}
              style={{ background: 'transparent', border: '1px solid #1a1a2a', color: T.mute, borderRadius: 4, padding: '6px 13px', fontSize: 11, textDecoration: 'none', fontFamily: "'Times New Roman', Times, serif" }}>
              ↓ Download
            </a>
            <button onClick={onClose}
              style={{ background: 'transparent', border: '1px solid #1a1a2a', color: T.mute, borderRadius: 4, padding: '6px 11px', fontSize: 11, cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ background: '#050508', border: '1px solid #0f0f18', borderRadius: 7, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
          {isImage && <img src={src} alt={item.filename} style={{ maxWidth: '100%', maxHeight: 520, display: 'block', objectFit: 'contain' }} />}
          {isPdf && (
            <object data={src} type="application/pdf" width="100%" style={{ height: 460, display: 'block' }}>
              <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif" }}>PDF preview unavailable.</p>
              </div>
            </object>
          )}
          {!isImage && !isPdf && (
            <div style={{ padding: '44px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 40, marginBottom: 10, opacity: .3 }}>{mediaIconFor(item.fileType)}</p>
              <p style={{ fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif" }}>{item.fileType} · {fmtSize(item.fileSize)}</p>
            </div>
          )}
        </div>

        {item.notes && (
          <div style={{ marginTop: 14, background: '#050508', border: '1px solid #0f0f18', borderRadius: 5, padding: '10px 14px' }}>
            <p style={{ fontSize: 9, color: T.mute, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, fontFamily: "'Times New Roman', Times, serif", marginBottom: 5 }}>Notes</p>
            <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.65, fontFamily: "'Times New Roman', Times, serif" }}>{item.notes}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          {!isGlobal && (
            <button onClick={() => onSaveAsTemplate(item.id)} disabled={promoting}
              style={{ background: 'transparent', border: '1px solid #1a3a26', color: '#60a878', borderRadius: 4, padding: '8px 16px', fontSize: 11, cursor: promoting ? 'not-allowed' : 'pointer', opacity: promoting ? .5 : 1, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.03em' }}>
              {promoting ? 'Saving…' : 'Save as Template'}
            </button>
          )}
          <button onClick={() => onDelete(item.id)}
            style={{ background: 'transparent', border: '1px solid #2a1010', color: '#a06060', borderRadius: 4, padding: '8px 16px', fontSize: 11, cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif" }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
