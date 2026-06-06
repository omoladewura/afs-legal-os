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
        width: '100%', maxWidth: 400,
        animation: shaking ? 'shake .3s ease' : 'fadeUp .4s ease',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p style={{
            fontSize: 28, color: T.gold,
            fontFamily: "'Cormorant Garamond', serif",
            fontWeight: 300, letterSpacing: '.12em', marginBottom: 6,
          }}>
            AFS | Advocates
          </p>
          <p style={{
            fontSize: 10, color: T.mute,
            fontFamily: 'Inter, sans-serif',
            letterSpacing: '.2em', textTransform: 'uppercase',
          }}>
            Legal Case Intelligence OS · v11
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
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
            fontSize: 13, color: '#c05050',
            fontFamily: 'Inter, sans-serif', marginBottom: 12,
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
