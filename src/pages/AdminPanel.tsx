/**
 * AFS Advocates — Admin Panel
 * Phase C2
 *
 * Developer-only route. Accessible at /admin by direct URL — not linked
 * anywhere in the main UI. Contains the RAG ingest trigger removed from
 * SettingsPanel in Phase C2.
 *
 * Mount this in your router:
 *   <Route path="/admin" element={<AdminPanel />} />
 */

import { useState } from 'react';
import { T, S } from '@/constants/tokens';
import { AUTH_TOKEN as RAW_AUTH_TOKEN } from '@/services/api';

const WORKER_URL = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const AUTH_TOKEN = `Bearer ${RAW_AUTH_TOKEN}`;

interface IngestSummary {
  total_in_library: number;
  already_done:     number;
  processed_now:    number;
  failed:           number;
}

interface IngestResult {
  ok:         boolean;
  elapsed_s?: string;
  message?:   string;
  summary?:   IngestSummary;
  processed?: string[];
  failed?:    { key: string; reason: string }[];
  error?:     string;
}

export function AdminPanel() {
  const [ingesting,  setIngesting]  = useState(false);
  const [result,     setResult]     = useState<IngestResult | null>(null);
  const [showFailed, setShowFailed] = useState(false);
  const [showDone,   setShowDone]   = useState(false);

  async function runIngest() {
    setIngesting(true);
    setResult(null);
    setShowFailed(false);
    setShowDone(false);
    try {
      const res = await fetch(`${WORKER_URL}/ingest`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
      });
      setResult(await res.json() as IngestResult);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div style={{
      maxWidth: 640, margin: '0 auto',
      padding: '48px 24px 80px',
      fontFamily: "'Times New Roman', Times, serif",
    }}>
      <p style={{
        fontSize: 9, color: T.mute, letterSpacing: '.14em',
        textTransform: 'uppercase', marginBottom: 6,
        fontFamily: "'Times New Roman', Times, serif",
      }}>
        Developer Route · /admin
      </p>
      <h1 style={{ ...S.h1, marginTop: 0 }}>Library Ingest</h1>
      <p style={{ ...S.p, marginBottom: 24 }}>
        Upload PDFs to R2 via the Cloudflare dashboard, then process them here.
        All engines gain access immediately after processing completes.
      </p>

      <button
        onClick={runIngest}
        disabled={ingesting}
        style={ingesting ? S.btnOff : S.btn}
      >
        {ingesting ? 'Processing — please wait…' : 'Process New Documents'}
      </button>

      {ingesting && (
        <p style={{ ...S.hint, marginTop: 14, fontStyle: 'italic' }}>
          Extracting text, chunking, and embedding. Do not close the app.
        </p>
      )}

      {result && !ingesting && (
        <div style={{ marginTop: 24 }}>
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

          {result.ok && (
            <>
              {result.message && !result.summary && (
                <p style={{ ...S.p, color: T.mute, fontStyle: 'italic' }}>{result.message}</p>
              )}

              {result.summary && (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 12, marginBottom: 20,
                }}>
                  {[
                    { label: 'In Library',        value: result.summary.total_in_library },
                    { label: 'Already Processed', value: result.summary.already_done },
                    { label: 'Processed Now',     value: result.summary.processed_now },
                    { label: 'Failed',            value: result.summary.failed },
                  ].map(({ label, value }) => (
                    <div key={label} style={{
                      background: T.card, border: `1px solid ${T.bdr}`,
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

              {result.elapsed_s && (
                <p style={{ ...S.hint, marginBottom: 16 }}>Completed in {result.elapsed_s}s</p>
              )}

              {result.processed && result.processed.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => setShowDone(v => !v)}
                    style={{
                      background: 'none', border: 'none', color: T.mute,
                      fontSize: 13, cursor: 'pointer', padding: 0,
                      textDecoration: 'underline',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    {showDone ? '▾' : '▸'} {result.processed.length} document{result.processed.length !== 1 ? 's' : ''} processed successfully
                  </button>
                  {showDone && (
                    <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none' }}>
                      {result.processed.map(key => (
                        <li key={key} style={{ ...S.p, margin: '4px 0', color: '#006600', fontSize: 13 }}>
                          ✓ {key}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {result.failed && result.failed.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowFailed(v => !v)}
                    style={{
                      background: 'none', border: 'none', color: '#cc0000',
                      fontSize: 13, cursor: 'pointer', padding: 0,
                      textDecoration: 'underline',
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    {showFailed ? '▾' : '▸'} {result.failed.length} document{result.failed.length !== 1 ? 's' : ''} failed
                  </button>
                  {showFailed && (
                    <div style={{ marginTop: 10 }}>
                      {result.failed.map(({ key, reason }) => (
                        <div key={key} style={{
                          background: '#fff5f5', border: '1px solid #ffcccc',
                          borderRadius: 5, padding: '10px 14px', marginBottom: 8,
                        }}>
                          <p style={{ ...S.p, margin: 0, fontWeight: 600, fontSize: 13 }}>{key}</p>
                          <p style={{ ...S.hint, margin: '4px 0 0', fontSize: 13 }}>{reason}</p>
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

      {/* System */}
      <div style={{
        marginTop: 48, borderTop: `1px solid ${T.bdrL}`, paddingTop: 24,
      }}>
        <p style={{
          fontSize: 9, color: T.mute, letterSpacing: '.12em',
          textTransform: 'uppercase', marginBottom: 14,
          fontFamily: "'Times New Roman', Times, serif",
        }}>
          Infrastructure
        </p>
        {[
          { label: 'Worker',   value: 'afs-legal-rag.sobamboadeshupo.workers.dev' },
          { label: 'Database', value: 'afs-legal-meta (D1)' },
          { label: 'Storage',  value: 'afs-legal-library (R2)' },
          { label: 'Vectors',  value: 'afs-legal-library (Vectorize)' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{
              fontSize: 11, color: T.mute, minWidth: 72,
              textTransform: 'uppercase', letterSpacing: '.06em',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              {label}
            </span>
            <span style={{ fontSize: 12, color: T.dim, fontFamily: "'Times New Roman', Times, serif" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
