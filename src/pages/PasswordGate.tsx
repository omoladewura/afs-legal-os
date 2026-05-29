/**
 * AFS Advocates — Password Gate
 * Shown on first load. Accepts password + API key setup.
 * On success, calls authenticate() to transition to the home view.
 */

import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { saveApiKey } from '@/services/api';
import { T, S } from '@/constants/tokens';
import { Spinner } from '@/components/common/ui';

/** The access password. Change here if you need to update it. */
const PASSWORD = 'Felix@100';

export function PasswordGate() {
  const { authenticate } = useAppStore();

  const [pw,       setPw]       = useState('');
  const [apiKey,   setApiKey]   = useState(() => {
    try { return localStorage.getItem('afs_api_key') || ''; } catch { return ''; }
  });
  const [error,    setError]    = useState('');
  const [shaking,  setShaking]  = useState(false);

  function handleSubmit() {
    if (pw !== PASSWORD) {
      setError('Incorrect password.');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      return;
    }
    if (apiKey.trim()) {
      saveApiKey(apiKey.trim());
    }
    authenticate();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <div className="pw-gate">
      <div style={{
        width: '100%', maxWidth: 400,
        animation: shaking ? 'shake .3s ease' : 'fadeUp .4s ease',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p style={{ fontSize: 28, color: T.gold, fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, letterSpacing: '.12em', marginBottom: 6 }}>
            AFS | Advocates
          </p>
          <p style={{ fontSize: 10, color: T.mute, fontFamily: 'Inter, sans-serif', letterSpacing: '.2em', textTransform: 'uppercase' }}>
            Legal Case Intelligence OS · v11
          </p>
        </div>

        {/* Password field */}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Access Password</label>
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            placeholder="Enter password"
            style={S.inp}
            autoFocus
          />
        </div>

        {/* API Key field */}
        <div style={{ marginBottom: 24 }}>
          <label style={S.label}>Anthropic API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="sk-ant-…  (saved locally)"
            style={S.inp}
          />
          <p style={{ ...S.hint, marginTop: 6 }}>
            Your key is stored only in your browser. Never sent anywhere except the Anthropic API.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p style={{ fontSize: 13, color: '#c05050', fontFamily: 'Inter, sans-serif', marginBottom: 12 }}>
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          style={{
            ...S.btn,
            opacity: !pw.trim() ? 0.4 : 1,
          }}
          disabled={!pw.trim()}
        >
          Enter System
        </button>
      </div>
    </div>
  );
}
