/**
 * AFS Advocates — Settings Panel
 *
 * Admin screen for library management.
 * Accessible via the settings icon in SiteNav.
 *
 * Controls:
 *   - Process New Documents — triggers /ingest on the Worker
 *   - Library stats (documents processed, vectors live)
 *   - Failed files list (if any)
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T, S } from '@/constants/tokens';

const WORKER_URL = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const AUTH_TOKEN = 'Bearer AFS2026SecureToken99';

interface IngestSummary {
  total_in_library: number;
  already_done:     number;
  processed_now:    number;
  failed:           number;
}

interface IngestResult {
  ok:        boolean;
  elapsed_s?: string;
  message?:  string;
  summary?:  IngestSummary;
  processed?: string[];
  failed?:   { key: string; reason: string }[];
  error?:    string;
}

export function SettingsPanel() {
  const { setView } = useAppStore();

  const [ingesting,    setIngesting]    = useState(false);
  const [result,       setResult]       = useState<IngestResult | null>(null);
  const [showFailed,   setShowFailed]   = useState(false);
  const [showDone,     setShowDone]     = useState(false);

  async function runIngest() {
    setIngesting(true);
    setResult(null);
    setShowFailed(false);
    setShowDone(false);

    try {
      const res = await fetch(`${WORKER_URL}/ingest`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': AUTH_TOKEN,
        },
      });
      const data: IngestResult = await res.json();
      setResult(data);
    } catch (err) {
      setResult({
        ok:    false,
        error: err instanceof Error ? err.message : 'Network error — check connection and try again.',
      });
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div style={{
      maxWidth: 680, margin: '0 auto',
      padding: '32px 24px 80px',
      fontFamily: "'Times New Roman', Times, serif",
    }}>

      {/* Back button */}
      <button
        onClick={() => setView('home')}
        style={{
          background: 'none', border: `1px solid ${T.bdr}`,
          borderRadius: 5, color: T.mute,
          padding: '7px 16px', fontSize: 12,
          fontFamily: "'Times New Roman', Times, serif",
          cursor: 'pointer', marginBottom: 32,
        }}
      >
        ← Back
      </button>

      {/* Title */}
      <h1 style={{ ...S.h1, marginTop: 0 }}>Settings</h1>

      {/* ── Library Management ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24, marginBottom: 24,
      }}>
        <h2 style={{ ...S.h2, marginTop: 0 }}>Legal Library</h2>

        <p style={{ ...S.p, marginBottom: 20 }}>
          Upload PDFs to R2 via the Cloudflare dashboard, then tap the button
          below to process new documents into the knowledge base. All engines
          will have access immediately after processing completes.
        </p>

        {/* Process button */}
        <button
          onClick={runIngest}
          disabled={ingesting}
          style={ingesting ? S.btnOff : S.btn}
        >
          {ingesting ? 'Processing — please wait…' : 'Process New Documents'}
        </button>

        {/* In-progress notice */}
        {ingesting && (
          <p style={{
            ...S.hint, marginTop: 14, textAlign: 'center',
            fontStyle: 'italic',
          }}>
            Extracting text, chunking, and embedding your documents.
            This may take a minute for large batches. Do not close the app.
          </p>
        )}

        {/* Result */}
        {result && !ingesting && (
          <div style={{ marginTop: 24 }}>

            {/* Error state */}
            {!result.ok && (
              <div style={{
                background: '#fff5f5', border: '1px solid #ffcccc',
                borderRadius: 6, padding: 16,
              }}>
                <p style={{ ...S.p, color: '#cc0000', margin: 0 }}>
                  ✗ {result.error || 'Processing failed. Check Worker logs in Cloudflare dashboard.'}
                </p>
              </div>
            )}

            {/* Success state */}
            {result.ok && (
              <>
                {/* Plain message (e.g. nothing to do) */}
                {result.message && !result.summary && (
                  <p style={{ ...S.p, color: T.mute, fontStyle: 'italic' }}>
                    {result.message}
                  </p>
                )}

                {/* Summary grid */}
                {result.summary && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                    gap: 12, marginBottom: 20,
                  }}>
                    {[
                      { label: 'In Library',       value: result.summary.total_in_library },
                      { label: 'Already Processed', value: result.summary.already_done },
                      { label: 'Processed Now',     value: result.summary.processed_now },
                      { label: 'Failed',            value: result.summary.failed },
                    ].map(({ label, value }) => (
                      <div key={label} style={{
                        background: '#ffffff', border: `1px solid ${T.bdr}`,
                        borderRadius: 6, padding: '12px 16px',
                      }}>
                        <div style={{
                          fontSize: 11, color: T.mute, textTransform: 'uppercase',
                          letterSpacing: '.08em', marginBottom: 4,
                          fontFamily: "'Times New Roman', Times, serif",
                        }}>
                          {label}
                        </div>
                        <div style={{
                          fontSize: 22, fontWeight: 700, color: T.text,
                          fontFamily: "'Times New Roman', Times, serif",
                        }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Elapsed */}
                {result.elapsed_s && (
                  <p style={{ ...S.hint, marginBottom: 16 }}>
                    Completed in {result.elapsed_s}s
                  </p>
                )}

                {/* Processed files toggle */}
                {result.processed && result.processed.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <button
                      onClick={() => setShowDone(v => !v)}
                      style={{
                        background: 'none', border: 'none',
                        color: T.mute, fontSize: 13, cursor: 'pointer',
                        fontFamily: "'Times New Roman', Times, serif",
                        padding: 0, textDecoration: 'underline',
                      }}
                    >
                      {showDone ? '▾' : '▸'} {result.processed.length} document{result.processed.length !== 1 ? 's' : ''} processed successfully
                    </button>
                    {showDone && (
                      <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none' }}>
                        {result.processed.map(key => (
                          <li key={key} style={{
                            ...S.p, margin: '4px 0',
                            color: '#006600', fontSize: 13,
                          }}>
                            ✓ {key}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Failed files toggle */}
                {result.failed && result.failed.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowFailed(v => !v)}
                      style={{
                        background: 'none', border: 'none',
                        color: '#cc0000', fontSize: 13, cursor: 'pointer',
                        fontFamily: "'Times New Roman', Times, serif",
                        padding: 0, textDecoration: 'underline',
                      }}
                    >
                      {showFailed ? '▾' : '▸'} {result.failed.length} document{result.failed.length !== 1 ? 's' : ''} failed — tap to see details
                    </button>
                    {showFailed && (
                      <div style={{ marginTop: 10 }}>
                        {result.failed.map(({ key, reason }) => (
                          <div key={key} style={{
                            background: '#fff5f5', border: '1px solid #ffcccc',
                            borderRadius: 5, padding: '10px 14px', marginBottom: 8,
                          }}>
                            <p style={{ ...S.p, margin: 0, fontWeight: 600, fontSize: 13 }}>
                              {key}
                            </p>
                            <p style={{ ...S.hint, margin: '4px 0 0', fontSize: 13 }}>
                              {reason}
                            </p>
                          </div>
                        ))}
                        <p style={{ ...S.hint, marginTop: 10 }}>
                          For scanned files: run OCR first (Google Drive trick or iLovePDF),
                          re-upload to R2, then process again.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* ── System Info ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24,
      }}>
        <h2 style={{ ...S.h2, marginTop: 0 }}>System</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Worker',   value: 'afs-legal-rag.sobamboadeshupo.workers.dev' },
            { label: 'Database', value: 'afs-legal-meta (D1)' },
            { label: 'Storage',  value: 'afs-legal-library (R2)' },
            { label: 'Vectors',  value: 'afs-legal-library (Vectorize)' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <span style={{
                fontSize: 12, color: T.mute, minWidth: 72,
                textTransform: 'uppercase', letterSpacing: '.06em',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                {label}
              </span>
              <span style={{ fontSize: 13, color: T.dim, fontFamily: "'Times New Roman', Times, serif" }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
