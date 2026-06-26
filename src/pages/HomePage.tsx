import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { BillionsVoiceWidget } from '@/components/BillionsVoiceWidget';

export function HomePage() {
  const { setView, setDocketOpen, setDocketFilter } = useAppStore();
  const [showBillions, setShowBillions] = useState(false);

  function handleLogout() {
    useAppStore.setState({ isAuthenticated: false, view: 'gate', activeCase: null });
  }

  if (showBillions) {
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <button
          onClick={() => setShowBillions(false)}
          style={backBtnStyle}
        >
          ← Back
        </button>
        <BillionsVoiceWidget />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease', maxWidth: 620, margin: '0 auto' }}>

      {/* Masthead */}
      <div style={{ marginBottom: 40 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: 14,
        }}>
          <p style={{
            fontSize: 9, color: '#888888',
            fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '.2em', textTransform: 'uppercase',
          }}>
            AFS Advocates · Legal Intelligence OS
          </p>
          <button
            onClick={handleLogout}
            style={{
              background: 'none', border: 'none', color: '#888888',
              fontSize: 11, fontFamily: "'Times New Roman', Times, serif",
              cursor: 'pointer', letterSpacing: '.04em', textDecoration: 'underline',
              padding: 0,
            }}
          >
            Sign out
          </button>
        </div>
        <div style={{
          borderTop: '2px solid #111111',
          paddingTop: 12,
        }}>
          <h1 style={{
            fontSize: 32, color: '#111111',
            fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700, fontStyle: 'italic',
            lineHeight: 1.15, marginBottom: 10,
          }}>
            What are we building today?
          </h1>
          <p style={{
            fontSize: 14, color: '#555555',
            fontFamily: "'Times New Roman', Times, serif",
            lineHeight: 1.65,
            borderTop: '1px solid #cccccc', paddingTop: 10,
          }}>
            Open a case to access the full litigation suite, or go straight to SAN Mode or Billions Voice.
          </p>
        </div>
      </div>

      {/* Entry cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1px solid #cccccc', borderRadius: 4, overflow: 'hidden' }}>

        {/* Case Docket — all matters */}
        <button
          onClick={() => { setDocketFilter('all'); setDocketOpen(true); }}
          style={cardStyle}
          onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f3')}
          onMouseLeave={e => (e.currentTarget.style.background = '#ffffff')}
        >
          <div style={iconCol}>⚖</div>
          <div style={{ flex: 1 }}>
            <p style={cardTag}>Manage Cases</p>
            <p style={cardTitle}>Case Docket</p>
            <p style={cardDesc}>Open, search, and manage all your matters. Every litigation engine is available inside each case file.</p>
          </div>
          <div style={arrowCol}>→</div>
        </button>

        <div style={{ height: 1, background: '#cccccc' }} />

        {/* SAN Mode */}
        <button
          onClick={() => setView('san')}
          style={cardStyle}
          onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f3')}
          onMouseLeave={e => (e.currentTarget.style.background = '#ffffff')}
        >
          <div style={iconCol}>⚡</div>
          <div style={{ flex: 1 }}>
            <p style={cardTag}>Senior Advocate Navigator</p>
            <p style={cardTitle}>SAN Mode</p>
            <p style={cardDesc}>Strategic case analysis, argument sequencing, and judicial reasoning — the SAN lens on every issue.</p>
          </div>
          <div style={arrowCol}>→</div>
        </button>

        <div style={{ height: 1, background: '#cccccc' }} />

        {/* Billions Voice */}
        <button
          onClick={() => setShowBillions(true)}
          style={cardStyle}
          onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f3')}
          onMouseLeave={e => (e.currentTarget.style.background = '#ffffff')}
        >
          <div style={iconCol}>✦</div>
          <div style={{ flex: 1 }}>
            <p style={cardTag}>Rhetoric & Letter Writing</p>
            <p style={cardTitle}>Billions Voice</p>
            <p style={cardDesc}>Write any letter, speech, or message with historical rhetoric woven in — elevated to the level they deserve.</p>
          </div>
          <div style={arrowCol}>→</div>
        </button>

      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid #cccccc',
  borderRadius: 3, color: '#444444', padding: '6px 16px',
  fontSize: 12, fontFamily: "'Times New Roman', Times, serif",
  cursor: 'pointer', marginBottom: 24,
};

const cardStyle: React.CSSProperties = {
  background: '#ffffff', border: 'none',
  padding: '20px 22px', textAlign: 'left',
  cursor: 'pointer', transition: 'background .12s',
  display: 'flex', alignItems: 'flex-start', gap: 18, width: '100%',
};

const iconCol: React.CSSProperties = {
  fontSize: 18, color: '#444444', flexShrink: 0,
  lineHeight: 1, marginTop: 3, width: 24, textAlign: 'center',
};

const arrowCol: React.CSSProperties = {
  fontSize: 18, color: '#aaaaaa', flexShrink: 0,
  alignSelf: 'center',
};

const cardTag: React.CSSProperties = {
  fontSize: 9, color: '#888888',
  fontFamily: "'Times New Roman', Times, serif",
  letterSpacing: '.14em', textTransform: 'uppercase',
  fontWeight: 700, marginBottom: 3,
};

const cardTitle: React.CSSProperties = {
  fontSize: 17, color: '#111111',
  fontFamily: "'Times New Roman', Times, serif",
  fontWeight: 700, lineHeight: 1.2, marginBottom: 5,
};

const cardDesc: React.CSSProperties = {
  fontSize: 12, color: '#666666',
  fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.65,
};
