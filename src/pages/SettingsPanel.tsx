/**
 * AFS Advocates — Settings Panel
 * Phase C2
 *
 * Lean settings screen. After C2 restructure:
 *   - Legal Library (RAG ingest) → removed, lives at /admin by URL only
 *   - LawRegistry               → removed, promoted to its own nav tab (LawRegistryPage)
 *   - Legal Intelligence Monitor → stays, upgraded with docket cross-reference
 *   - Clause Bank               → stays (added in C1)
 *   - System info               → stays
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { T, S } from '@/constants/tokens';
import { ClauseBank } from '@/engines/ClauseBank';
import { AUTH_TOKEN as RAW_AUTH_TOKEN } from '@/services/api';
import { db } from '@/storage/db';
import type { Case } from '@/types';

const MONITOR_URL = 'https://afs-monitor-worker.sobamboadeshupo.workers.dev';
const AUTH_TOKEN  = `Bearer ${RAW_AUTH_TOKEN}`;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Populated client-side by docket cross-reference — not from the worker */
  affectedCases?: AffectedCase[];
}

interface MonitorStats {
  lastRunAt:       string | null;
  sourcesScanned:  number;
  alertsCreated:   number;
  errors:          string[];
  unreviewedCount: number;
  whitelist:       string[];
}

interface AffectedCase {
  id:       string;
  caseName: string;
  suitNo:   string;
  /** Short excerpt showing where the match was found */
  matchIn:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCKET CROSS-REFERENCE
// Search all local cases for mentions of an overruled/repealed document title.
// Searches: caseName, suitNo, intelligence_data.intPkg, compressed_summary,
// intelligence_data.legal_issues, intelligence_data.facts.
// ─────────────────────────────────────────────────────────────────────────────

function extractKeywords(docTitle: string): string[] {
  // Strip common noise words; keep proper nouns and significant terms
  const stopwords = new Set([
    'v', 'vs', 'and', 'or', 'the', 'of', 'in', 'for', 'a', 'an',
    'to', 'at', 'by', 'on', 'with', 'ltd', 'limited', 'nigeria',
    'nigerian', 'federal', 'state', 'republic', 'attorney', 'general',
  ]);
  return docTitle
    .toLowerCase()
    .replace(/[()[\]{}.,;:'"!?]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

async function crossReferenceAlerts(alerts: MonitorAlert[]): Promise<MonitorAlert[]> {
  // Only process overruled and repealed alerts — these are the ones that can
  // invalidate existing work product on open cases.
  const dangerous = alerts.filter(a =>
    a.alertType === 'overruled' || a.alertType === 'repealed'
  );
  if (dangerous.length === 0) return alerts;

  let allCases: Case[] = [];
  try {
    allCases = await db.cases.toArray();
  } catch {
    // db.cases unavailable — cross-reference silently skipped
    return alerts;
  }

  return alerts.map(alert => {
    if (alert.alertType !== 'overruled' && alert.alertType !== 'repealed') {
      return alert;
    }

    const keywords = extractKeywords(alert.docTitle);
    if (keywords.length === 0) return alert;

    const affectedCases: AffectedCase[] = [];

    for (const c of allCases) {
      // Build a searchable corpus from all text fields that would reference authorities
      const corpus: Array<{ text: string; label: string }> = [
        { text: c.caseName ?? '',          label: 'case name' },
        { text: c.suitNo ?? '',            label: 'suit number' },
        { text: c.compressed_summary ?? '', label: 'docket summary' },
        { text: c.intelligence_data?.intPkg ?? '',       label: 'intelligence package' },
        { text: c.intelligence_data?.legal_issues ?? '', label: 'legal issues' },
        { text: c.intelligence_data?.facts ?? '',        label: 'facts' },
        { text: c.intelligence_data?.rawFacts ?? '',     label: 'raw facts' },
      ];

      let matchLabel = '';
      for (const { text, label } of corpus) {
        if (!text) continue;
        const lower = text.toLowerCase();
        const hits = keywords.filter(kw => lower.includes(kw));
        // Require at least 2 keyword matches to avoid false positives on
        // single common words (e.g. "Abacha" alone could match many cases)
        if (hits.length >= Math.min(2, keywords.length)) {
          matchLabel = label;
          break;
        }
      }

      if (matchLabel) {
        affectedCases.push({
          id:       c.id,
          caseName: c.caseName,
          suitNo:   c.suitNo ?? '',
          matchIn:  matchLabel,
        });
      }
    }

    return { ...alert, affectedCases };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const { setView } = useAppStore();

  const [monAlerts,   setMonAlerts]   = useState<MonitorAlert[]>([]);
  const [monStats,    setMonStats]    = useState<MonitorStats | null>(null);
  const [monLoading,  setMonLoading]  = useState(false);
  const [monRunning,  setMonRunning]  = useState(false);
  const [monError,    setMonError]    = useState('');
  const [monActionId, setMonActionId] = useState('');
  const [monExpanded, setMonExpanded] = useState(false);

  // Run cross-reference whenever alerts change
  useEffect(() => {
    if (monAlerts.length === 0) return;
    crossReferenceAlerts(monAlerts).then(setMonAlerts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monAlerts.length]);

  // ── Monitor network functions ───────────────────────────────────────────────

  async function loadMonitorAlerts() {
    setMonLoading(true);
    setMonError('');
    try {
      const res  = await fetch(`${MONITOR_URL}/monitor/alerts?status=unreviewed`, {
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as { ok: boolean; alerts: MonitorAlert[] };
      if (data.ok) setMonAlerts(data.alerts ?? []);
      else setMonError('Failed to load alerts.');
    } catch {
      setMonError('Cannot reach monitor worker. Deploy afs-monitor-worker first.');
    }
    setMonLoading(false);
  }

  async function loadMonitorStats() {
    try {
      const res  = await fetch(`${MONITOR_URL}/monitor/stats`, {
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as MonitorStats & { ok: boolean };
      if (data.ok) setMonStats(data);
    } catch { /* non-fatal */ }
  }

  async function runManualScan() {
    setMonRunning(true);
    setMonError('');
    try {
      const res = await fetch(`${MONITOR_URL}/monitor/run`, {
        method: 'POST',
        headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as { ok: boolean };
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
        method: 'POST', headers: { Authorization: AUTH_TOKEN },
      });
      setMonAlerts(prev => prev.filter(a => a.id !== id));
    } catch { /* non-fatal */ }
    setMonActionId('');
  }

  async function downloadAlert(id: string) {
    setMonActionId(id);
    try {
      const res  = await fetch(`${MONITOR_URL}/monitor/alerts/${id}/download`, {
        method: 'POST', headers: { Authorization: AUTH_TOKEN },
      });
      const data = await res.json() as { ok: boolean; message?: string };
      if (data.ok) setMonAlerts(prev => prev.filter(a => a.id !== id));
      else alert(data.message ?? 'Download failed. Add to R2 manually then reprocess.');
    } catch { /* non-fatal */ }
    setMonActionId('');
  }

  function openSource(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function alertTypeLabel(t: AlertType): { label: string; color: string; bg: string } {
    if (t === 'overruled')   return { label: 'Overruled',    color: '#8a1a1a', bg: '#fbeaea' };
    if (t === 'repealed')    return { label: 'Repealed',     color: '#7a4a00', bg: '#fdf3e0' };
    if (t === 'new_statute') return { label: 'New Statute',  color: '#1a4a8a', bg: '#edf3fb' };
    return                          { label: 'New Judgment', color: '#1a5a30', bg: '#e8f5ee' };
  }

  // Count alerts that have affected open cases (for the badge)
  const docketHits = monAlerts.filter(a => a.affectedCases && a.affectedCases.length > 0).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      maxWidth: 680, margin: '0 auto',
      padding: '32px 24px 80px',
      fontFamily: "'Times New Roman', Times, serif",
    }}>

      {/* Back */}
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

      <h1 style={{ ...S.h1, marginTop: 0 }}>Settings</h1>

      {/* ── Legal Intelligence Monitor ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24, marginBottom: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ ...S.h2, marginTop: 0, marginBottom: 0 }}>Legal Intelligence Monitor</h2>
            {/* Red badge: unreviewed alerts */}
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
            {/* Amber badge: alerts with docket hits */}
            {docketHits > 0 && (
              <span style={{
                background: '#b85c00', color: '#fff',
                fontSize: 11, fontWeight: 700,
                padding: '2px 7px', borderRadius: 10,
                fontFamily: "'Times New Roman', Times, serif",
                letterSpacing: '.04em',
              }}
                title={`${docketHits} overruled/repealed judgment${docketHits > 1 ? 's' : ''} referenced in your open cases`}
              >
                ⚠ {docketHits} case{docketHits > 1 ? 's' : ''} affected
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
          statutes, repeals, and overruled cases. Overruled and repealed alerts are
          automatically cross-referenced against your open case dockets.
        </p>

        {monExpanded && (
          <>
            {/* Stats strip */}
            {monStats && (
              <div style={{
                display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16,
                fontSize: 12, color: T.mute,
                fontFamily: "'Times New Roman', Times, serif",
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

            {/* Empty state */}
            {monAlerts.length === 0 && !monLoading && !monError && (
              <p style={{ ...S.hint, color: T.mute }}>
                No unreviewed alerts. Click Scan Now to check sources, or wait for the daily 02:00 UTC cron.
              </p>
            )}

            {/* Alert list */}
            {monAlerts.map(alert => {
              const tag       = alertTypeLabel(alert.alertType);
              const isPending = monActionId === alert.id;
              const isDangerous = alert.alertType === 'overruled' || alert.alertType === 'repealed';
              const hasHits   = isDangerous && alert.affectedCases && alert.affectedCases.length > 0;

              return (
                <div key={alert.id} style={{
                  background: '#ffffff',
                  border: `1px solid ${hasHits ? '#c07040' : T.bdr}`,
                  borderRadius: 6, padding: '14px 16px', marginBottom: 10,
                }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <span style={{
                      background: tag.bg, color: tag.color,
                      border: `1px solid ${tag.color}33`,
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
                      fontFamily: "'Times New Roman', Times, serif",
                      letterSpacing: '.06em', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {tag.label}
                    </span>
                    <span style={{
                      fontSize: 13, color: T.text,
                      fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5,
                    }}>
                      {alert.docTitle}
                    </span>
                  </div>

                  {/* Meta */}
                  <div style={{
                    fontSize: 11, color: T.mute,
                    fontFamily: "'Times New Roman', Times, serif", marginBottom: 12,
                  }}>
                    {alert.sourceLabel} · Detected {new Date(alert.detectedAt).toLocaleDateString()}
                  </div>

                  {/* ── Docket cross-reference panel ── */}
                  {isDangerous && (
                    <div style={{
                      background: hasHits ? '#fdf5ee' : '#f8f8f6',
                      border: `1px solid ${hasHits ? '#e0b080' : T.bdrL}`,
                      borderRadius: 5, padding: '10px 12px', marginBottom: 12,
                    }}>
                      {hasHits ? (
                        <>
                          <p style={{
                            fontSize: 11, fontWeight: 700, color: '#8a4400',
                            fontFamily: "'Times New Roman', Times, serif", marginBottom: 8,
                          }}>
                            ⚠ Referenced in {alert.affectedCases!.length} open case{alert.affectedCases!.length > 1 ? 's' : ''} — review before dismissing
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {alert.affectedCases!.map(c => (
                              <div key={c.id} style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center', gap: 10,
                              }}>
                                <div>
                                  <span style={{
                                    fontSize: 12, color: T.text,
                                    fontFamily: "'Times New Roman', Times, serif",
                                  }}>
                                    {c.caseName}
                                  </span>
                                  {c.suitNo && (
                                    <span style={{ fontSize: 11, color: T.mute, marginLeft: 8, fontFamily: "'Times New Roman', Times, serif" }}>
                                      {c.suitNo}
                                    </span>
                                  )}
                                  <span style={{
                                    fontSize: 10, color: '#b06030', marginLeft: 8,
                                    fontFamily: "'Times New Roman', Times, serif",
                                    fontStyle: 'italic',
                                  }}>
                                    found in {c.matchIn}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p style={{
                          fontSize: 11, color: T.mute,
                          fontFamily: "'Times New Roman', Times, serif", margin: 0,
                        }}>
                          ✓ Not found in any open case docket on this device.
                        </p>
                      )}
                    </div>
                  )}

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

            {/* Whitelist */}
            <div style={{ marginTop: 16, borderTop: `1px solid ${T.bdrL}`, paddingTop: 14 }}>
              <p style={{ ...S.hint, fontSize: 11, color: T.mute, marginBottom: 6 }}>
                Whitelisted sources (hardcoded):
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  'nigerialii.org', 'supremecourt.gov.ng',
                  'nationalassembly.gov.ng', 'justice.gov.ng', 'placng.org',
                ].map(domain => (
                  <span key={domain} style={{
                    background: '#f0f0ee', border: `1px solid ${T.bdr}`,
                    borderRadius: 3, fontSize: 10, padding: '2px 8px', color: T.dim,
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

      {/* ── Clause Bank ── */}
      <section style={{
        background: T.card, border: `1px solid ${T.bdr}`,
        borderRadius: 8, padding: 24, marginBottom: 24,
      }}>
        <h2 style={{ ...S.h2, marginTop: 0 }}>Clause Bank</h2>
        <ClauseBank />
      </section>

    </div>
  );
}
