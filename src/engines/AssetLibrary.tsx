/**
 * AFS Advocates — Global Asset Library
 * Phase 8D
 *
 * Displays every media_library item with scope:'global' — template assets
 * that are available across every matter, not tied to any one case.
 *
 * An item reaches this library via two paths:
 *   1. Phase 8C "Save as Template" — from the EvidenceVault paste capture
 *   2. The "Add Template" button here — direct upload straight to global scope
 *
 * Phase 8E will merge these global items into EvidenceVault's per-case view
 * so counsel never has to search manually.
 */

import React, { useState, useEffect, useRef } from 'react';
import { T, S } from '@/constants/tokens';
import { uid } from '@/utils';
import {
  loadGlobalMedia,
  saveMediaItem,
  deleteMediaItem,
} from '@/storage/helpers';
import type { MediaLibraryItem } from '@/storage/db';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — mirrors EvidenceVault ceiling

// File-type groups with display icons
const TYPE_ICON: Record<string, string> = {
  'image':       '🖼',
  'application/pdf': '📄',
  'audio':       '🔊',
  'video':       '🎬',
  'text':        '📝',
};

function iconFor(fileType: string): string {
  if (fileType.startsWith('image/'))       return TYPE_ICON['image'];
  if (fileType === 'application/pdf')      return TYPE_ICON['application/pdf'];
  if (fileType.startsWith('audio/'))       return TYPE_ICON['audio'];
  if (fileType.startsWith('video/'))       return TYPE_ICON['video'];
  if (fileType.startsWith('text/'))        return TYPE_ICON['text'];
  return '📎';
}

function fmtSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Asset Row
// ─────────────────────────────────────────────────────────────────────────────

interface AssetRowProps {
  item:      MediaLibraryItem;
  onPreview: (item: MediaLibraryItem) => void;
  onDelete:  (id: string) => void;
}

function AssetRow({ item, onPreview, onDelete }: AssetRowProps) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: hover ? T.card : T.bg,
        border: `1px solid ${hover ? T.bdr : T.bdrL}`,
        borderRadius: 6, padding: '10px 14px',
        transition: 'all .15s', cursor: 'pointer',
      }}
    >
      {/* Icon / thumbnail */}
      <div
        onClick={() => onPreview(item)}
        style={{
          width: 42, height: 42, borderRadius: 5,
          background: T.card, border: `1px solid ${T.bdrL}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, overflow: 'hidden', fontSize: 20,
        }}
      >
        {item.fileType.startsWith('image/')
          ? <ImageThumb data={item.data} fileType={item.fileType} />
          : iconFor(item.fileType)
        }
      </div>

      {/* Metadata */}
      <div style={{ flex: 1, minWidth: 0 }} onClick={() => onPreview(item)}>
        <p style={{
          fontSize: 13, color: T.text,
          fontFamily: "'Times New Roman', Times, serif",
          fontWeight: 600, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
        }}>
          {item.filename}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            fontSize: 9, color: T.mute,
            fontFamily: "'Times New Roman', Times, serif",
            textTransform: 'uppercase', letterSpacing: '.08em',
          }}>
            {item.fileType.split('/').pop()?.toUpperCase()}
          </span>
          <span style={{ fontSize: 9, color: '#bbbbbb', fontFamily: "'Times New Roman', Times, serif" }}>
            {fmtSize(item.fileSize)}
          </span>
          <span style={{ fontSize: 9, color: '#bbbbbb', fontFamily: "'Times New Roman', Times, serif" }}>
            {fmtDate(item.createdAt)}
          </span>
        </div>
        {item.notes && (
          <p style={{
            fontSize: 11, color: T.mute, marginTop: 2,
            fontFamily: "'Times New Roman', Times, serif",
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', fontStyle: 'italic',
          }}>
            {item.notes}
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={e => { e.stopPropagation(); onPreview(item); }}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`,
            color: T.dim, borderRadius: 3, padding: '5px 10px',
            fontSize: 10, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.04em',
          }}
        >
          Open
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(item.id); }}
          style={{
            background: 'none', border: '1px solid #e8d0d0',
            color: '#b04040', borderRadius: 3, padding: '5px 8px',
            fontSize: 10, cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// Small inline thumbnail for image assets in the list row
function ImageThumb({ data, fileType }: { data: string; fileType: string }) {
  const src = data.startsWith('data:')
    ? data
    : `data:${fileType};base64,${data}`;
  return (
    <img
      src={src} alt=""
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Preview Modal
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewModalProps {
  item:    MediaLibraryItem;
  onClose: () => void;
}

function PreviewModal({ item, onClose }: PreviewModalProps) {
  const src = item.data.startsWith('data:')
    ? item.data
    : `data:${item.fileType};base64,${item.data}`;
  const isImage = item.fileType.startsWith('image/');
  const isPdf   = item.fileType === 'application/pdf';

  // Close on backdrop click or Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
        zIndex: 9000, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.bg, border: `1px solid ${T.bdr}`,
          borderRadius: 10, padding: 24, maxWidth: 720, width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,.18)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 18, gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{
              fontSize: 15, color: T.text, fontWeight: 600,
              fontFamily: "'Times New Roman', Times, serif",
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {item.filename}
            </p>
            <p style={{
              fontSize: 10, color: T.mute, marginTop: 2,
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.08em', textTransform: 'uppercase',
            }}>
              Global Template · {fmtSize(item.fileSize)} · {fmtDate(item.createdAt)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <a
              href={src} download={item.filename}
              style={{
                background: 'none', border: `1px solid ${T.bdr}`,
                color: T.dim, borderRadius: 4, padding: '6px 13px',
                fontSize: 11, cursor: 'pointer', textDecoration: 'none',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              ↓ Download
            </a>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: `1px solid ${T.bdr}`,
                color: T.mute, borderRadius: 4, padding: '6px 11px',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{
          background: T.card, border: `1px solid ${T.bdrL}`,
          borderRadius: 7, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 160,
        }}>
          {isImage && (
            <img
              src={src} alt={item.filename}
              style={{
                maxWidth: '100%', maxHeight: 560,
                display: 'block', objectFit: 'contain',
              }}
            />
          )}
          {isPdf && (
            <object
              data={src} type="application/pdf"
              width="100%" style={{ height: 480, display: 'block' }}
            >
              <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 14 }}>
                  PDF preview unavailable.
                </p>
                <a
                  href={src} download={item.filename}
                  style={{
                    color: T.dim, fontSize: 12, textDecoration: 'none',
                    fontFamily: "'Times New Roman', Times, serif",
                    border: `1px solid ${T.bdr}`, padding: '8px 18px', borderRadius: 4,
                  }}
                >
                  Download PDF
                </a>
              </div>
            </object>
          )}
          {!isImage && !isPdf && (
            <div style={{ padding: '44px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 44, marginBottom: 12, opacity: .3 }}>
                {iconFor(item.fileType)}
              </p>
              <p style={{ fontSize: 14, color: T.dim, fontFamily: "'Times New Roman', Times, serif", marginBottom: 6 }}>
                {item.filename}
              </p>
              <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif", marginBottom: 20 }}>
                {item.fileType} · {fmtSize(item.fileSize)}
              </p>
              <a
                href={src} download={item.filename}
                style={{
                  color: T.dim, fontSize: 12, textDecoration: 'none',
                  fontFamily: "'Times New Roman', Times, serif",
                  border: `1px solid ${T.bdr}`, padding: '9px 22px', borderRadius: 4,
                }}
              >
                ↓ Download File
              </a>
            </div>
          )}
        </div>

        {item.notes && (
          <div style={{
            marginTop: 14, background: T.card,
            border: `1px solid ${T.bdrL}`, borderRadius: 5,
            padding: '10px 14px',
          }}>
            <p style={{
              fontSize: 9, color: T.mute, letterSpacing: '.12em',
              textTransform: 'uppercase', fontWeight: 700,
              fontFamily: "'Times New Roman', Times, serif", marginBottom: 5,
            }}>
              Notes
            </p>
            <p style={{
              fontSize: 13, color: T.dim, lineHeight: 1.65,
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              {item.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Add Template Drawer
// ─────────────────────────────────────────────────────────────────────────────

interface AddTemplateProps {
  onAdded: (item: MediaLibraryItem) => void;
  onClose: () => void;
}

function AddTemplateDrawer({ onAdded, onClose }: AddTemplateProps) {
  const [file,     setFile]     = useState<File | null>(null);
  const [notes,    setNotes]    = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    setErr('');
  }

  async function handleSave() {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setErr(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum is 2 MB.`);
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const b64 = await fileToB64(file);
      const item: MediaLibraryItem = {
        id:        uid(),
        caseId:    null,
        scope:     'global',
        filename:  file.name || `asset-${Date.now()}`,
        fileType:  file.type || 'application/octet-stream',
        fileSize:  file.size,
        data:      b64,
        notes:     notes.trim(),
        createdAt: new Date().toISOString(),
      };
      const ok = await saveMediaItem(item);
      if (!ok) {
        setErr('Storage quota exceeded. Delete some templates or upload a smaller file.');
        setSaving(false);
        return;
      }
      onAdded(item);
    } catch (e: unknown) {
      setErr('Upload failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
    setSaving(false);
  }

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.bdr}`,
      borderRadius: 8, padding: 20, marginBottom: 20,
      animation: 'fadeUp .18s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{ ...S.label, marginBottom: 0 }}>Add Global Template</p>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: T.mute,
            cursor: 'pointer', fontSize: 14, padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files[0]; if (f) handleFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? T.bdr : T.bdrL}`,
          borderRadius: 6, padding: '28px 20px',
          textAlign: 'center', cursor: 'pointer',
          background: dragOver ? '#f0f0f0' : T.bg,
          transition: 'all .15s', marginBottom: 14,
        }}
      >
        <input
          ref={fileRef} type="file" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file ? (
          <>
            <p style={{ fontSize: 26, marginBottom: 6 }}>{iconFor(file.type)}</p>
            <p style={{ fontSize: 13, color: T.text, fontFamily: "'Times New Roman', Times, serif", fontWeight: 600, marginBottom: 2 }}>
              {file.name}
            </p>
            <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              {fmtSize(file.size)} · Click to change
            </p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 26, marginBottom: 8, opacity: .2 }}>📎</p>
            <p style={{ fontSize: 14, color: T.dim, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 4 }}>
              Drop a file or click to browse
            </p>
            <p style={{ fontSize: 11, color: T.mute, fontFamily: "'Times New Roman', Times, serif" }}>
              Images, PDFs, documents — up to 2 MB
            </p>
          </>
        )}
      </div>

      {/* Notes */}
      <p style={{ ...S.label, marginBottom: 6 }}>
        Notes{' '}
        <span style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: 10, fontWeight: 400, color: T.mute }}>
          (optional)
        </span>
      </p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        placeholder="What is this template for? Any usage notes?"
        style={{
          ...S.ta, minHeight: 60, marginBottom: 14,
          background: T.bg, fontSize: 12,
        }}
      />

      {err && (
        <div style={{
          background: '#fff5f5', border: '1px solid #f0d0d0',
          borderRadius: 4, padding: '8px 12px', marginBottom: 12,
        }}>
          <p style={{ fontSize: 12, color: '#a03030', fontFamily: "'Times New Roman', Times, serif" }}>
            {err}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleSave}
          disabled={!file || saving}
          style={{
            ...S.btn, marginTop: 0, width: 'auto', padding: '9px 22px',
            opacity: (!file || saving) ? .35 : 1,
            cursor: (!file || saving) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save as Global Template →'}
        </button>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`,
            color: T.mute, borderRadius: 4, padding: '9px 18px',
            fontSize: 12, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function AssetLibrary() {
  const [items,       setItems]       = useState<MediaLibraryItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [preview,     setPreview]     = useState<MediaLibraryItem | null>(null);
  const [deleteId,    setDeleteId]    = useState<string | null>(null);
  const [showAdd,     setShowAdd]     = useState(false);
  const [searchQ,     setSearchQ]     = useState('');
  const [typeFilter,  setTypeFilter]  = useState<string>('all');
  const [toast,       setToast]       = useState('');

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadGlobalMedia().then(loaded => {
      // Newest first
      setItems(loaded.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
      setLoading(false);
    });
  }, []);

  // ── Toast helper ─────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  }

  // ── Add template ─────────────────────────────────────────────────────────
  function handleAdded(item: MediaLibraryItem) {
    setItems(prev => [item, ...prev]);
    setShowAdd(false);
    showToast(`"${item.filename}" added to the Asset Library.`);
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function confirmDelete(id: string) {
    const item = items.find(i => i.id === id);
    await deleteMediaItem(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setDeleteId(null);
    if (item) showToast(`"${item.filename}" removed.`);
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  // Derive available type groups from loaded items
  const typeGroups = Array.from(
    new Set(items.map(i => {
      if (i.fileType.startsWith('image/'))        return 'image';
      if (i.fileType === 'application/pdf')       return 'pdf';
      if (i.fileType.startsWith('audio/'))        return 'audio';
      if (i.fileType.startsWith('video/'))        return 'video';
      if (i.fileType.startsWith('text/'))         return 'text';
      return 'other';
    }))
  );

  function groupFor(fileType: string): string {
    if (fileType.startsWith('image/'))        return 'image';
    if (fileType === 'application/pdf')       return 'pdf';
    if (fileType.startsWith('audio/'))        return 'audio';
    if (fileType.startsWith('video/'))        return 'video';
    if (fileType.startsWith('text/'))         return 'text';
    return 'other';
  }

  const filtered = items.filter(i => {
    const matchType = typeFilter === 'all' || groupFor(i.fileType) === typeFilter;
    const q = searchQ.toLowerCase();
    const matchQ = !q ||
      i.filename.toLowerCase().includes(q) ||
      (i.notes || '').toLowerCase().includes(q) ||
      i.fileType.toLowerCase().includes(q);
    return matchType && matchQ;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ animation: 'fadeUp .2s ease' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: '#111111', color: '#ffffff', borderRadius: 6,
          padding: '10px 18px', fontSize: 12,
          fontFamily: "'Times New Roman', Times, serif",
          boxShadow: '0 4px 20px rgba(0,0,0,.22)',
          animation: 'fadeUp .18s ease',
        }}>
          {toast}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <PreviewModal item={preview} onClose={() => setPreview(null)} />
      )}

      {/* Delete confirmation */}
      {deleteId && (() => {
        const item = items.find(i => i.id === deleteId);
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
            zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
            <div style={{
              background: T.bg, border: `1px solid ${T.bdr}`,
              borderRadius: 8, padding: 28, maxWidth: 420, width: '100%',
            }}>
              <p style={{ ...S.h3, marginTop: 0 }}>Remove from Library?</p>
              <p style={{ ...S.hint, marginBottom: 20 }}>
                "{item?.filename}" will be removed from the global Asset Library.
                Any case that has already pulled it in (Phase 8E) will lose access.
                This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => confirmDelete(deleteId)}
                  style={{
                    background: '#8a1a1a', color: '#fff', border: 'none',
                    borderRadius: 4, padding: '9px 20px', fontSize: 12,
                    cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: 600,
                  }}
                >
                  Remove
                </button>
                <button
                  onClick={() => setDeleteId(null)}
                  style={{
                    background: 'none', border: `1px solid ${T.bdr}`,
                    color: T.mute, borderRadius: 4, padding: '9px 18px',
                    fontSize: 12, cursor: 'pointer',
                    fontFamily: "'Times New Roman', Times, serif",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add template drawer */}
      {showAdd && (
        <AddTemplateDrawer
          onAdded={handleAdded}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', marginBottom: 18, gap: 12,
      }}>
        <div>
          <p style={{
            fontSize: 9, color: T.mute, fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.14em', textTransform: 'uppercase',
            fontWeight: 700, marginBottom: 3,
          }}>
            🌐 Global · {items.length} {items.length === 1 ? 'Template' : 'Templates'}
          </p>
          <p style={{ ...S.hint, marginBottom: 0 }}>
            Reusable assets available across every matter. Promote any pasted file
            from the Evidence Vault using "Save as Template", or add one directly here.
          </p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`,
              color: T.dim, borderRadius: 4, padding: '8px 16px',
              fontSize: 11, cursor: 'pointer', flexShrink: 0,
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '.03em',
            }}
          >
            + Add Template
          </button>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{
            width: 22, height: 22, border: `2px solid ${T.bdrL}`,
            borderTop: `2px solid ${T.dim}`, borderRadius: '50%',
            margin: '0 auto 12px', animation: 'spin .9s linear infinite',
          }} />
          <p style={{ fontSize: 12, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
            Loading library…
          </p>
        </div>
      ) : items.length === 0 ? (
        /* ── Empty state ── */
        <div style={{
          textAlign: 'center', padding: '52px 24px',
          background: T.card, border: `1px solid ${T.bdrL}`,
          borderRadius: 8,
        }}>
          <p style={{ fontSize: 40, marginBottom: 12, opacity: .15 }}>📎</p>
          <p style={{
            fontSize: 18, color: T.text, fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 300, fontStyle: 'italic', marginBottom: 10,
          }}>
            No Global Templates Yet
          </p>
          <p style={{
            fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif",
            lineHeight: 1.75, maxWidth: 440, margin: '0 auto 24px',
          }}>
            Templates saved here are available across every matter — boilerplate
            precedents, letterheads, standard forms, standing instructions.
            Paste a file anywhere in the Evidence Vault and tap "Save as Template",
            or add one directly above.
          </p>
        </div>
      ) : (
        <>
          {/* Search + type filter */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name, notes, or type…"
              style={{
                flex: 1, minWidth: 180,
                background: T.bg, border: `1px solid ${T.bdrL}`,
                borderRadius: 4, color: T.text,
                fontFamily: "'Times New Roman', Times, serif",
                fontSize: 12, padding: '8px 12px', outline: 'none',
              }}
            />
            {typeGroups.length > 1 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['all', ...typeGroups] as string[]).map(g => (
                  <button
                    key={g}
                    onClick={() => setTypeFilter(g)}
                    style={{
                      background: typeFilter === g ? '#111111' : 'none',
                      border: `1px solid ${typeFilter === g ? '#111111' : T.bdrL}`,
                      color: typeFilter === g ? '#ffffff' : T.mute,
                      borderRadius: 3, padding: '5px 10px', fontSize: 9,
                      cursor: 'pointer', textTransform: 'uppercase',
                      letterSpacing: '.07em',
                      fontFamily: "'Times New Roman', Times, serif",
                      transition: 'all .12s',
                    }}
                  >
                    {g === 'all' ? `All (${items.length})` : g}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* No results */}
          {filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '36px 20px',
              background: T.card, border: `1px solid ${T.bdrL}`, borderRadius: 7,
            }}>
              <p style={{ fontSize: 14, color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' }}>
                No templates match that search.
              </p>
              <button
                onClick={() => { setSearchQ(''); setTypeFilter('all'); }}
                style={{
                  marginTop: 12, background: 'none', border: `1px solid ${T.bdr}`,
                  color: T.mute, borderRadius: 3, padding: '6px 14px',
                  fontSize: 11, cursor: 'pointer',
                  fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {filtered.map(item => (
                <AssetRow
                  key={item.id}
                  item={item}
                  onPreview={setPreview}
                  onDelete={setDeleteId}
                />
              ))}
            </div>
          )}

          {/* Footer count */}
          <p style={{
            fontSize: 10, color: T.bdr, textAlign: 'center', marginTop: 18,
            fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.06em',
          }}>
            {filtered.length} of {items.length} global template{items.length !== 1 ? 's' : ''} · Asset Library
          </p>
        </>
      )}
    </div>
  );
}
