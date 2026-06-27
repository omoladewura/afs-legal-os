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
import { LawRegistry } from '@/components/LawRegistry';
import { AssetLibrary } from '@/engines/AssetLibrary';
import { AUTH_TOKEN as RAW_AUTH_TOKEN } from '@/services/api';

const WORKER_URL  = 'https://afs-legal-rag.sobamboadeshupo.workers.dev';
const MONITOR_URL = 'https://afs-monitor-worker.sobamboadeshupo.workers.dev';
const AUTH_TOKEN  = `Bearer ${RAW_AUTH_TOKEN}`;

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

// ── Phase H — Legal Intelligence Monitor ─────────────────────────────────────

type AlertType   = 'new_judgment' | 'new_statute' | 'overruled' | 'repealed';
type AlertStatus = 'unreviewed' | 'dismissed' | 'downloaded';

interface MonitorAlert {
  id:          string;
  sourceId:    string;
  sourceLabel: string;
  sourceUrl:   string;
  docTitle:    string;
  alertType:   AlertType;
  status:      AlertStatus;
  detectedAt:  string;
}

interface MonitorStats {
  lastRunAt:       string | null;
  sourcesScanned:  number;
  alertsCreated:   number;
  errors:          string[];
  unreviewedCount: number;
  whitelist:       string[];
}

export function SettingsPanel() {
  const { setView } = useAppStore();

  const [ingesting,    setIngesting]    = useState(false);
  const [result,       setResult]       = useState<IngestResult | null>(null);
  const [showFailed,   setShowFailed]   = useState(false);
  const [showDone,     setShowDone]     = useState(false);

  // ── Phase H — Legal Intelligence Monitor state ───────────────────────────
  const [monAlerts,      setMonAlerts]      = useState<MonitorAlert[]>([]);
  const [monStats,       setMonStats]       = useState<MonitorStats | null>(null);
  const [monLoading,     setMonLoading]     = useState(false);
  const [monRunning,     setMonRunning]     = useState(false);
  const [monError,       setMonError]       = useState('');
  const [monActionId,    setMonActionId]    = useState('');  // alert id with pending action
  const [monExpanded,    setMonExpanded]    = useState(false);
  const [lawExpanded,    setLawExpanded]    = useState(false);
  const [assetExpanded,  setAssetExpanded]  = useState(false);

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

  // ── Phase H — Monitor functions ────────────────────────────────────────────

  async function loadMonitorAlerts() {
    setMonLoading(true);
    setMonError('');
    try {
      const res = await fetch(`${MONITOR_URL}/monitor/alerts?status=unreviewed`, {
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as { ok: boolean; alerts: MonitorAlert[]; unreviewedCount: number };
      if (data.ok) setMonAlerts(data.alerts ?? []);
      else setMonError('Failed to load alerts.');
    } catch (e) {
      setMonError('Cannot reach monitor worker. Deploy afs-monitor-worker first.');
    }
    setMonLoading(false);
  }

  async function loadMonitorStats() {
    try {
      const res = await fetch(`${MONITOR_URL}/monitor/stats`, {
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as MonitorStats & { ok: boolean };
      if (data.ok) setMonStats(data);
    } catch {
      // non-fatal — worker may not be deployed yet
    }
  }

  async function runManualScan() {
    setMonRunning(true);
    setMonError('');
    try {
      const res = await fetch(`${MONITOR_URL}/monitor/run`, {
        method: 'POST',
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as { ok: boolean; stats: MonitorStats };
      if (data.ok) {
        await loadMonitorStats();
        await loadMonitorAlerts();
      }
    } catch {
      setMonError('Scan failed. Ensure afs-monitor-worker is deployed.');
    }
    setMonRunning(false);
  }

  async function dismissAlert(id: string) {
    setMonActionId(id);
    try {
      await fetch(`${MONITOR_URL}/monitor/alerts/${id}/dismiss`, {
        method: 'POST',
        headers: { Authorization: AUTH_TOKEN },
      });
      setMonAlerts(prev => prev.filter(a => a.id !== id));
    } catch { /* non-fatal */ }
    setMonActionId('');
  }

  async function downloadAlert(id: string) {
    setMonActionId(id);
    try {
      const res = await fetch(`${MONITOR_URL}/monitor/alerts/${id}/download`, {
        method: 'POST',
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as { ok: boolean; message?: string };
      if (data.ok) {
        setMonAlerts(prev => prev.filter(a => a.id !== id));
      } else {
        alert(data.message ?? 'Download failed. Add document to R2 manually then reprocess.');
      }
    } catch { /* non-fatal */ }
    setMonActionId('');
  }

  function openSource(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function alertTypeLabel(t: AlertType): { label: string; color: string; bg: string } {
    if (t === 'overruled') return { label: 'Overruled',    color: '#8a1a1a', bg: '#fbeaea' };
    if (t === 'repealed')  return { label: 'Repealed',     color: '#7a4a00', bg: '#fdf3e0' };
    if (t === 'new_statute') return { label: 'New Statute', color: '#1a4a8a', bg: '#edf3fb' };
    return { label: 'New Judgment', color: '#1a5a30', bg: '#e8f5ee' };
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

      {/* ── Phase H — Legal Intelligence Monitor ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24,
      }}>
        {/* Header row with badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ ...S.h2, marginTop: 0, marginBottom: 0 }}>Legal Intelligence Monitor</h2>
            {monAlerts.length > 0 && (
              <span style={{
                background: '#cc0000', color: '#fff',
                fontSize: 11, fontWeight: 700,
                padding: '2px 7px', borderRadius: 10,
                fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.04em',
              }}>
                {monAlerts.length}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setMonExpanded(v => !v);
              if (!monExpanded) { void loadMonitorStats(); void loadMonitorAlerts(); }
            }}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`,
              borderRadius: 4, padding: '5px 14px',
              fontSize: 12, cursor: 'pointer', color: T.dim,
              fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            {monExpanded ? '▾ Hide' : '▸ Show'}
          </button>
        </div>

        <p style={{ ...S.hint, marginBottom: monExpanded ? 16 : 0 }}>
          Monitors whitelisted legal sources daily at 02:00 UTC. Detects new judgments,
          statutes, repeals, and overruled cases. Nothing is downloaded without your approval.
        </p>

        {monExpanded && (
          <>
            {/* Stats strip */}
            {monStats && (
              <div style={{
                display: 'flex', gap: 20, flexWrap: 'wrap',
                marginBottom: 16, fontSize: 12,
                color: T.mute, fontFamily: "'Times New Roman', Times, serif",
              }}>
                <span>Last run: {monStats.lastRunAt ? new Date(monStats.lastRunAt).toLocaleString() : 'Never'}</span>
                <span>Sources scanned: {monStats.sourcesScanned}</span>
                <span>Alerts ever created: {monStats.alertsCreated}</span>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <button
                onClick={() => void runManualScan()}
                disabled={monRunning}
                style={{
                  background: monRunning ? '#eeeeee' : T.text,
                  color: monRunning ? '#aaaaaa' : '#fff',
                  border: 'none', borderRadius: 4,
                  padding: '9px 20px', fontSize: 12,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: monRunning ? 'not-allowed' : 'pointer',
                  letterSpacing: '.04em',
                }}
              >
                {monRunning ? 'Scanning…' : '↻ Scan Now'}
              </button>
              <button
                onClick={() => void loadMonitorAlerts()}
                disabled={monLoading}
                style={{
                  background: 'none', border: `1px solid ${T.bdr}`,
                  borderRadius: 4, padding: '9px 20px', fontSize: 12,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: 'pointer', color: T.dim,
                }}
              >
                {monLoading ? 'Loading…' : 'Refresh Alerts'}
              </button>
            </div>

            {/* Error */}
            {monError && (
              <div style={{
                background: '#fbeaea', border: '1px solid #e0b8b8',
                borderRadius: 5, padding: '10px 14px', marginBottom: 16,
                color: '#8a1a1a', fontSize: 13,
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                {monError}
              </div>
            )}

            {/* Alert list */}
            {monAlerts.length === 0 && !monLoading && !monError && (
              <p style={{ ...S.hint, color: T.mute }}>
                No unreviewed alerts. Click Scan Now to check sources, or wait for the daily 02:00 UTC cron.
              </p>
            )}

            {monAlerts.map(alert => {
              const tag = alertTypeLabel(alert.alertType);
              const isPending = monActionId === alert.id;
              return (
                <div key={alert.id} style={{
                  background: '#ffffff', border: `1px solid ${T.bdr}`,
                  borderRadius: 6, padding: '14px 16px', marginBottom: 10,
                }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <span style={{
                      background: tag.bg, color: tag.color,
                      border: `1px solid ${tag.color}33`,
                      fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 3,
                      fontFamily: "'Times New Roman', Times, serif",
                      letterSpacing: '.06em', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {tag.label}
                    </span>
                    <span style={{
                      fontSize: 13, color: T.text,
                      fontFamily: "'Times New Roman', Times, serif",
                      lineHeight: 1.5,
                    }}>
                      {alert.docTitle}
                    </span>
                  </div>

                  {/* Meta */}
                  <div style={{
                    fontSize: 11, color: T.mute,
                    fontFamily: "'Times New Roman', Times, serif",
                    marginBottom: 12,
                  }}>
                    {alert.sourceLabel} · Detected {new Date(alert.detectedAt).toLocaleDateString()}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => void downloadAlert(alert.id)}
                      disabled={isPending}
                      style={{
                        background: T.text, color: '#fff',
                        border: 'none', borderRadius: 4,
                        padding: '6px 14px', fontSize: 12,
                        fontFamily: "'Times New Roman', Times, serif",
                        cursor: isPending ? 'not-allowed' : 'pointer',
                        opacity: isPending ? 0.6 : 1,
                      }}
                    >
                      Download & Add
                    </button>
                    <button
                      onClick={() => openSource(alert.sourceUrl)}
                      style={{
                        background: 'none', border: `1px solid ${T.bdr}`,
                        borderRadius: 4, padding: '6px 14px', fontSize: 12,
                        fontFamily: "'Times New Roman', Times, serif",
                        cursor: 'pointer', color: T.dim,
                      }}
                    >
                      View Source
                    </button>
                    <button
                      onClick={() => void dismissAlert(alert.id)}
                      disabled={isPending}
                      style={{
                        background: 'none', border: 'none',
                        fontSize: 12, color: T.mute,
                        fontFamily: "'Times New Roman', Times, serif",
                        cursor: isPending ? 'not-allowed' : 'pointer',
                        padding: '6px 4px',
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Whitelist info */}
            <div style={{
              marginTop: 16,
              borderTop: `1px solid ${T.bdrL}`,
              paddingTop: 14,
            }}>
              <p style={{ ...S.hint, fontSize: 11, color: T.mute, marginBottom: 6 }}>
                Whitelisted sources (hardcoded — cannot be overridden):
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  'nigerialii.org', 'supremecourt.gov.ng',
                  'nationalassembly.gov.ng', 'justice.gov.ng', 'placng.org',
                ].map(domain => (
                  <span key={domain} style={{
                    background: '#f0f0ee', border: `1px solid ${T.bdr}`,
                    borderRadius: 3, fontSize: 10,
                    padding: '2px 8px', color: T.dim,
                    fontFamily: "'Times New Roman', Times, serif",
                  }}>
                    {domain}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Law Registry ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24, marginTop: 24,
      }}>
        {/* Header row */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 12,
        }}>
          <h2 style={{ ...S.h2, marginTop: 0, marginBottom: 0 }}>Law Registry</h2>
          <button
            onClick={() => setLawExpanded(v => !v)}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`,
              borderRadius: 4, padding: '5px 14px',
              fontSize: 12, cursor: 'pointer', color: T.dim,
              fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            {lawExpanded ? '▾ Hide' : '▸ Show'}
          </button>
        </div>

        <p style={{ ...S.hint, marginBottom: lawExpanded ? 20 : 0 }}>
          All procedural deadlines and legal assertions in one place. Override any
          period without a deploy — changes take effect immediately in IndexedDB.
          Every change is logged with a mandatory reason.
        </p>

        {lawExpanded && <LawRegistry />}
      </section>

      {/* ── Asset Library (Phase 8D) ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h2 style={{ ...S.h2, marginTop: 0, marginBottom: 2 }}>Asset Library</h2>
          </div>
          <button
            onClick={() => setAssetExpanded(v => !v)}
            style={{
              background: 'none', border: `1px solid ${T.bdr}`,
              borderRadius: 4, padding: '5px 14px',
              fontSize: 12, cursor: 'pointer', color: T.dim,
              fontFamily: "'Times New Roman', Times, serif",
            }}
          >
            {assetExpanded ? '▾ Hide' : '▸ Show'}
          </button>
        </div>
        <p style={{ ...S.hint, marginBottom: assetExpanded ? 20 : 0 }}>
          Global template assets — precedents, letterheads, standing forms —
          available across every matter. Promote any pasted file from the
          Evidence Vault via "Save as Template", or upload one directly here.
        </p>
        {assetExpanded && <AssetLibrary />}
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
