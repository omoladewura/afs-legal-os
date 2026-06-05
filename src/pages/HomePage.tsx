/**
 * AFS Advocates — Home Page
 * Clean home with only 3 entry points:
 *   1. Case Docket — manage and open cases
 *   2. SAN Mode    — standalone, also available inside cases
 *   3. Billions Voice — standalone rhetoric & letter tool
 *
 * Settings panel: Worker URL + API key configuration
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';
import { BillionsVoiceWidget } from '@/components/BillionsVoiceWidget';
import { saveWorkerUrl, getWorkerUrl } from '@/services/library';
import { saveApiKey, hasApiKey } from '@/services/api';

export function HomePage() {
  const { setView, setDocketOpen } = useAppStore();
  const [showBillions, setShowBillions]   = useState(false);
  const [showSettings, setShowSettings]   = useState(false);
  const [workerUrl, setWorkerUrl]         = useState('');
  const [apiKey, setApiKey]               = useState('');
  const [saved, setSaved]                 = useState(false);
  const [ragStatus, setRagStatus]         = useState<'untested'|'ok'|'fail'>('untested');
  const [testing, setTesting]             = useState(false);

  // Load saved values on mount
  useEffect(() => {
    setWorkerUrl(getWorkerUrl());
  }, []);

  function handleSave() {
    if (workerUrl.trim()) saveWorkerUrl(workerUrl.trim());
    if (apiKey.trim())    saveApiKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTest() {
    if (!workerUrl.trim()) return;
    setTesting(true);
    setRagStatus('untested');
    try {
      const res = await fetch(`${workerUrl.trim()}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'test connection' }),
      });
      setRagStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setRagStatus('fail');
    } finally {
      setTesting(false);
    }
  }

  if (showBillions) {
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <button
          onClick={() => setShowBillions(false)}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`,
            borderRadius: 5, color: T.mute, padding: '7px 16px',
            fontSize: 12, fontFamily: 'Inter, sans-serif',
            cursor: 'pointer', marginBottom: 24,
          }}
        >
          ← Back
        </button>
        <BillionsVoiceWidget />
      </div>
    );
  }

  if (showSettings) {
    return (
      <div style={{ animation: 'fadeUp .3s ease', maxWidth: 640, margin: '0 auto' }}>

        <button
          onClick={() => setShowSettings(false)}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`,
            borderRadius: 5, color: T.mute, padding: '7px 16px',
            fontSize: 12, fontFamily: 'Inter, sans-serif',
            cursor: 'pointer', marginBottom: 32,
          }}
        >
          ← Back
        </button>

        <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 6 }}>
          AFS Advocates · Settings
        </p>
        <h1 style={{ fontSize: 28, color: T.goldL, fontWeight: 300, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 32 }}>
          System Configuration
        </h1>

        {/* RAG Worker URL */}
        <div style={{ marginBottom: 28 }}>
          <label style={labelStyle}>
            RAG Worker URL
          </label>
          <p style={hintStyle}>
            Your Cloudflare Worker URL. This connects all engines to your legal library.
          </p>
          <input
            type="url"
            value={workerUrl}
            onChange={e => setWorkerUrl(e.target.value)}
            placeholder="https://afs-legal-rag.sobamboadeshupo.workers.dev"
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button onClick={handleTest} disabled={testing || !workerUrl.trim()} style={secondaryBtnStyle}>
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {ragStatus === 'ok'   && <span style={{ color: '#4caf50', fontSize: 12, alignSelf: 'center' }}>✓ Connected</span>}
            {ragStatus === 'fail' && <span style={{ color: '#e53935', fontSize: 12, alignSelf: 'center' }}>✗ Unreachable</span>}
          </div>
        </div>

        {/* Anthropic API Key */}
        <div style={{ marginBottom: 28 }}>
          <label style={labelStyle}>
            Anthropic API Key
          </label>
          <p style={hintStyle}>
            Your API key from console.anthropic.com. Stored locally, never sent anywhere except Anthropic.
            {hasApiKey() && <span style={{ color: '#4caf50' }}> (Key saved)</span>}
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            style={inputStyle}
          />
        </div>

        {/* Save */}
        <button onClick={handleSave} style={primaryBtnStyle}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>

        {/* Status summary */}
        <div style={{ marginTop: 40, padding: '16px 20px', background: T.card, borderRadius: 8, border: `1px solid ${T.bdr}` }}>
          <p style={{ fontSize: 11, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 12 }}>System Status</p>
          <StatusRow label="Anthropic API Key" ok={hasApiKey()} />
          <StatusRow label="RAG Worker URL"     ok={Boolean(getWorkerUrl())} />
          <StatusRow label="Library Connected"  ok={ragStatus === 'ok'} pending={ragStatus === 'untested'} />
        </div>

      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease', maxWidth: 640, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 6 }}>
          AFS Advocates · Legal Intelligence OS
        </p>
        <h1 style={{ fontSize: 32, color: T.goldL, fontWeight: 300, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: 8 }}>
          What are we building today?
        </h1>
        <p style={{ fontSize: 14, color: T.dim, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
          Open a case to access the full litigation suite, or go straight to SAN Mode or Billions Voice.
        </p>
      </div>

      {/* 3 Main Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Case Docket */}
        <button
          onClick={() => setDocketOpen(true)}
          style={cardStyle('#c4a030')}
          onMouseEnter={e => hoverIn(e, '#c4a030')}
          onMouseLeave={e => hoverOut(e)}
        >
          <div style={cardIconStyle('#c4a030')}>⚖</div>
          <div style={{ flex: 1 }}>
            <p style={cardTitleStyle}>Case Docket</p>
            <p style={cardSubStyle('#c4a030')}>MANAGE YOUR CASES</p>
            <p style={cardDescStyle}>Open, search, and manage all your cases. Every litigation tool is available inside each case file.</p>
          </div>
          <div style={arrowStyle('#c4a030')}>→</div>
        </button>

        {/* SAN Mode */}
        <button
          onClick={() => setView('san')}
          style={cardStyle('#8050d0')}
          onMouseEnter={e => hoverIn(e, '#8050d0')}
          onMouseLeave={e => hoverOut(e)}
        >
          <div style={cardIconStyle('#8050d0')}>⚡</div>
          <div style={{ flex: 1 }}>
            <p style={cardTitleStyle}>SAN Mode</p>
            <p style={cardSubStyle('#8050d0')}>SENIOR ADVOCATE NAVIGATOR</p>
            <p style={cardDescStyle}>Strategic case analysis, argument sequencing, and judicial reasoning — the SAN lens on every issue.</p>
          </div>
          <div style={arrowStyle('#8050d0')}>→</div>
        </button>

        {/* Billions Voice */}
        <button
          onClick={() => setShowBillions(true)}
          style={cardStyle('#c06040')}
          onMouseEnter={e => hoverIn(e, '#c06040')}
          onMouseLeave={e => hoverOut(e)}
        >
          <div style={cardIconStyle('#c06040')}>✦</div>
          <div style={{ flex: 1 }}>
            <p style={cardTitleStyle}>Billions Voice</p>
            <p style={cardSubStyle('#c06040')}>RHETORIC & LETTER WRITING</p>
            <p style={cardDescStyle}>Write any letter, speech, or message with historical rhetoric woven in — elevated to the level they deserve.</p>
          </div>
          <div style={arrowStyle('#c06040')}>→</div>
        </button>

      </div>

      {/* Settings link */}
      <div style={{ marginTop: 40, textAlign: 'center' }}>
        <button
          onClick={() => setShowSettings(true)}
          style={{
            background: 'none', border: 'none', color: T.mute,
            fontSize: 12, fontFamily: 'Inter, sans-serif',
            cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          ⚙ Settings & Library Configuration
        </button>
      </div>

    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatusRow({ label, ok, pending }: { label: string; ok: boolean; pending?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: T.dim, fontFamily: 'Inter, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', color: pending ? T.mute : ok ? '#4caf50' : '#e53935' }}>
        {pending ? '— not tested' : ok ? '✓ Ready' : '✗ Not set'}
      </span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: T.dim, fontFamily: 'Inter, sans-serif',
  letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 6,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12, color: T.mute, fontFamily: 'Inter, sans-serif',
  lineHeight: 1.6, marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  background: T.card, border: `1px solid ${T.bdr}`,
  borderRadius: 6, color: T.text, fontSize: 13,
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
};

const primaryBtnStyle: React.CSSProperties = {
  background: '#c4a030', border: 'none', borderRadius: 6,
  color: '#fff', padding: '11px 28px', fontSize: 13,
  fontFamily: 'Inter, sans-serif', fontWeight: 600, cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  background: 'none', border: `1px solid ${T.bdr}`, borderRadius: 6,
  color: T.dim, padding: '8px 16px', fontSize: 12,
  fontFamily: 'Inter, sans-serif', cursor: 'pointer',
};

function cardStyle(accent: string): React.CSSProperties {
  return {
    background: T.card, border: `1px solid ${T.bdr}`,
    borderRadius: 10, padding: '20px 22px',
    textAlign: 'left', cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
    display: 'flex', alignItems: 'flex-start', gap: 16, width: '100%',
  };
}

function hoverIn(e: React.MouseEvent<HTMLButtonElement>, accent: string) {
  (e.currentTarget as HTMLButtonElement).style.borderColor = accent;
  (e.currentTarget as HTMLButtonElement).style.background = '#0f0f1c';
}

function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  (e.currentTarget as HTMLButtonElement).style.borderColor = T.bdr;
  (e.currentTarget as HTMLButtonElement).style.background = T.card;
}

function cardIconStyle(accent: string): React.CSSProperties {
  return { fontSize: 22, color: accent, flexShrink: 0, lineHeight: 1, marginTop: 2 };
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16, color: T.text,
  fontFamily: "'Cormorant Garamond', serif",
  fontWeight: 600, lineHeight: 1.3, marginBottom: 3,
};

function cardSubStyle(accent: string): React.CSSProperties {
  return {
    fontSize: 8, color: accent, fontFamily: 'Inter, sans-serif',
    letterSpacing: '.14em', textTransform: 'uppercase',
    fontWeight: 600, marginBottom: 6,
  };
}

const cardDescStyle: React.CSSProperties = {
  fontSize: 12, color: T.mute,
  fontFamily: 'Inter, sans-serif', lineHeight: 1.6,
};

function arrowStyle(accent: string): React.CSSProperties {
  return { fontSize: 18, color: accent, flexShrink: 0, alignSelf: 'center', opacity: 0.7 };
}
