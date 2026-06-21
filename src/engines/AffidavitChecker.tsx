/**
 * AFS Legal OS — Affidavit Checker
 *
 * Phase 2C — extracted as a standalone tool from the retired
 * ComplianceEngine.tsx. The other three ComplianceEngine sub-modules
 * (Full Compliance Audit, Limitation Calculator, Service Validator) were
 * folded into Intelligence Engine Step 2b and now auto-run once after
 * extraction, persisted to intelligence_data.commencement_audit.
 *
 * The Affidavit Checker doesn't fit that pattern — it isn't a one-time,
 * post-extraction verdict. A case can produce many affidavits over its
 * life (supporting, counter, of service, further...), each checked
 * independently. So it stays an on-demand tool: paste an affidavit,
 * get a defect analysis, repeat as needed. Output is not persisted to
 * intelligence_data — each run is local to this panel.
 *
 * Mounted inside CaseCommand's §4 Compliance Audit card, below the
 * read-only commencement_audit display.
 */

import React, { useState } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { callClaudeText, withRetry } from '@/services/api';
import { Md, Spinner } from '@/components/common/ui';
import { useIntelligence } from '@/hooks/useIntelligence';
import { getPrompt } from '@/law/prompts';

const SERIF = "'Times New Roman', Times, serif";

const AFF_TYPES = [
  'Supporting Affidavit (Motion)',
  'Counter-Affidavit',
  'Affidavit of Service',
  'Further Affidavit',
  'Affidavit of Facts',
  'Affidavit in Proof of Title',
  'Affidavit to Lead Secondary Evidence',
];

interface Props {
  activeCase: Case;
}

export function AffidavitChecker({ activeCase }: Props) {
  const { fullContext } = useIntelligence(activeCase, 'facts');

  const [open,    setOpen]    = useState(false);
  const [affType, setAffType] = useState('');
  const [affText, setAffText] = useState('');
  const [result,  setResult]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function run() {
    if (!affText.trim()) return;
    setLoading(true); setError(''); setResult('');

    const prompt = `Nigerian court affidavit defect analysis. Court: ${activeCase.court || 'Not specified'}.

AFFIDAVIT TYPE: ${affType || 'Not specified'}
AFFIDAVIT TEXT:
${affText}

Analyse for defects under the Evidence Act 2011 and applicable Rules of Court:

## FORMAL DEFECTS
Check: proper jurat, date, commissioner for oaths/deponent rank, oath vs affirmation, witness signature.

## PARAGRAPH NUMBERING & STRUCTURE
Check: paragraphs numbered consecutively, each paragraph contains single statement of fact.

## HEARSAY COMPLIANCE
Identify any hearsay paragraphs. ${getPrompt('evidence_act_s115_hearsay')}

## EXHIBIT COMPLIANCE
Are exhibits referenced correctly? Proper identification markings? Exhibited before swearing?

## DEPONENT COMPETENCE
Is the deponent competent? Do they have personal knowledge or have they correctly attributed sources?

## ARGUMENTATIVE / LEGAL CONCLUSION PARAGRAPHS
Identify any paragraphs that contain legal arguments or conclusions — these are objectionable.

## REBUTTAL VULNERABILITY
What paragraphs are most vulnerable to a motion to strike? How would opposing counsel attack this affidavit?

## CORRECTIVE ACTION
For each defect: the specific correction required before the affidavit is court-ready.

Be specific. Reference Evidence Act 2011 sections and applicable court rules.`;

    try {
      const text = await withRetry(() => callClaudeText({
        system:       fullContext,
        userMsg:      prompt,
        maxTokens:    1800,
        matter_track: activeCase.matter_track,
        counsel_role: activeCase.counsel_role,
      }));
      setResult(text);
    } catch (e) {
      setError('API error: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  const taS: React.CSSProperties = {
    width: '100%', background: T.bg, border: `1px solid ${T.bdr}`,
    borderRadius: 5, color: T.text, padding: '10px 12px',
    fontSize: 13, fontFamily: SERIF, outline: 'none', resize: 'vertical',
    lineHeight: 1.7, boxSizing: 'border-box',
  };
  const selS: React.CSSProperties = {
    width: '100%', background: T.bg, border: `1px solid ${T.bdr}`,
    borderRadius: 5, color: T.text, padding: '9px 11px',
    fontSize: 13, fontFamily: SERIF, outline: 'none', boxSizing: 'border-box',
  };
  const lblS: React.CSSProperties = {
    fontSize: 9, color: T.dim, fontFamily: SERIF, letterSpacing: '.1em',
    textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 5,
  };

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.bdrL}` }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        <span style={{ fontSize: 13 }}>📜</span>
        <span style={{ fontSize: 9, color: T.dim, fontFamily: SERIF, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
          Affidavit Checker
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: T.mute }}>{open ? '▾' : '▸'}</span>
      </button>

      {!open && (
        <p style={{ fontSize: 12, color: T.mute, fontFamily: SERIF, fontStyle: 'italic', marginTop: 6 }}>
          Paste any affidavit for this case to check it for defects — jurat, hearsay, exhibits, argumentative paragraphs.
        </p>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={lblS}>Affidavit Type</label>
            <select value={affType} onChange={e => setAffType(e.target.value)} style={selS}>
              <option value=''>Select type…</option>
              {AFF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <textarea
            value={affText}
            onChange={e => setAffText(e.target.value)}
            placeholder="Paste the full affidavit text here — from the heading and introduction through to the jurat and signature block. The more complete the text, the more thorough the defect analysis."
            rows={10}
            style={{ ...taS, marginBottom: 12 }}
          />

          <button
            onClick={run}
            disabled={loading || !affText.trim()}
            style={{
              background: loading || !affText.trim() ? T.bdr : T.text,
              color: '#fff', border: 'none', borderRadius: 5,
              padding: '9px 18px', fontSize: 11, fontFamily: SERIF,
              letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700,
              cursor: loading || !affText.trim() ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading ? <><Spinner size={10} color="#fff" /> Checking…</> : '📜 Check for Defects'}
          </button>

          {(loading || result || error) && (
            <div style={{ marginTop: 14, background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 6, padding: '14px 16px' }}>
              {loading && (
                <div style={{ textAlign: 'center', padding: '14px 0' }}>
                  <Spinner size={14} />
                  <p style={{ fontSize: 11, color: T.mute, fontFamily: SERIF, marginTop: 8 }}>Checking affidavit…</p>
                </div>
              )}
              {error && !loading && (
                <p style={{ fontSize: 12, color: T.err, fontFamily: SERIF, lineHeight: 1.6 }}>{error}</p>
              )}
              {result && !loading && <Md text={result} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
