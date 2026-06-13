import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T, S } from '@/constants/tokens';

const PASSWORD = 'Felix@100';

export function PasswordGate() {
  const { authenticate } = useAppStore();
  const [pw,      setPw]      = useState('');
  const [error,   setError]   = useState('');
  const [shaking, setShaking] = useState(false);

  function handleSubmit() {
    if (pw !== PASSWORD) {
      setError('Incorrect password.');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      return;
    }
    authenticate();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <div className="pw-gate">
      <div style={{
        width: '100%', maxWidth: 380,
        animation: shaking ? 'shake .3s ease' : 'fadeUp .4s ease',
      }}>
        {/* Masthead */}
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div style={{
            borderTop: '3px solid #111111',
            borderBottom: '1px solid #111111',
            padding: '10px 0 8px',
            marginBottom: 8,
          }}>
            <p style={{
              fontSize: 30, color: '#111111',
              fontFamily: "'Times New Roman', Times, serif",
              fontWeight: 700, letterSpacing: '.06em',
            }}>
              AFS | Advocates
            </p>
          </div>
          <p style={{
            fontSize: 10, color: '#888888',
            fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.18em', textTransform: 'uppercase',
          }}>
            Legal Intelligence OS · v11
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
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

        {error && (
          <p style={{
            fontSize: 12, color: '#8a1a1a',
            fontFamily: "'Times New Roman', Times, serif",
            fontStyle: 'italic', marginBottom: 12,
          }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          style={{ ...S.btn, opacity: !pw.trim() ? 0.4 : 1 }}
          disabled={!pw.trim()}
        >
          Enter System
        </button>
      </div>
    </div>
  );
}
