import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';
import { BillionsVoiceWidget } from '@/components/BillionsVoiceWidget';

export function HomePage() {
  const { setView, setDocketOpen, authenticate } = useAppStore();
  const [showBillions, setShowBillions] = useState(false);

  function handleLogout() {
    useAppStore.setState({ isAuthenticated: false, view: 'gate', activeCase: null });
  }

  if (showBillions) {
    return (
      <div style={{ animation: 'fadeUp .3s ease' }}>
        <button
          onClick={() => setShowBillions(false)}
          style={{
            background: 'none', border: `1px solid ${T.bdr}`,
            borderRadius: 5, color: T.mute, padding: '7px 16px',
            fontSize: 12, fontFamily: "'Times New Roman', Times, serif",
            cursor: 'pointer', marginBottom: 24,
          }}
        >
          ← Back
        </button>
        <BillionsVoiceWidget />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeUp .3s ease', maxWidth: 640, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <p style={{ fontSize: 10, color: T.mute, fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 6 }}>
            AFS Advocates · Legal Intelligence OS
          </p>
          <button
            onClick={handleLogout}
            style={{
              background: 'none', border: 'none', color: T.mute,
              fontSize: 11, fontFamily: "'Times New Roman', Times, serif",
              cursor: 'pointer', letterSpacing: '.06em',
              padding: '2px 0',
            }}
          >
            Sign out
          </button>
        </div>
        <h1 style={{ fontSize: 32, color: T.goldL, fontWeight: 300, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', marginBottom: 8 }}>
          What are we building today?
        </h1>
        <p style={{ fontSize: 14, color: T.dim, fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6 }}>
          Open a case to access the full litigation suite, or go straight to SAN Mode or Billions Voice.
        </p>
      </div>

      {/* 3 Main Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <button
          onClick={() => setDocketOpen(true)}
          style={cardStyle('#000000')}
          onMouseEnter={e => hoverIn(e, '#000000')}
          onMouseLeave={e => hoverOut(e)}
        >
          <div style={cardIconStyle('#000000')}>⚖</div>
          <div style={{ flex: 1 }}>
            <p style={cardTitleStyle}>Case Docket</p>
            <p style={cardSubStyle('#000000')}>MANAGE YOUR CASES</p>
            <p style={cardDescStyle}>Open, search, and manage all your cases. Every litigation tool is available inside each case file.</p>
          </div>
          <div style={arrowStyle('#000000')}>→</div>
        </button>

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
    </div>
  );
}

function cardStyle(accent: string): React.CSSProperties {
  return {
    background: T.card, border: `1px solid ${T.bdr}`,
    borderRadius: 10, padding: '20px 22px', textAlign: 'left',
    cursor: 'pointer', transition: 'border-color .15s, background .15s',
    display: 'flex', alignItems: 'flex-start', gap: 16, width: '100%',
  };
}

function hoverIn(e: React.MouseEvent<HTMLButtonElement>, accent: string) {
  (e.currentTarget as HTMLButtonElement).style.borderColor = accent;
  (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f5';
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
  fontFamily: "'Times New Roman', Times, serif",
  fontWeight: 600, lineHeight: 1.3, marginBottom: 3,
};

function cardSubStyle(accent: string): React.CSSProperties {
  return {
    fontSize: 8, color: accent, fontFamily: "'Times New Roman', Times, serif",
    letterSpacing: '.14em', textTransform: 'uppercase',
    fontWeight: 600, marginBottom: 6,
  };
}

const cardDescStyle: React.CSSProperties = {
  fontSize: 12, color: T.mute,
  fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.6,
};

function arrowStyle(accent: string): React.CSSProperties {
  return { fontSize: 18, color: accent, flexShrink: 0, alignSelf: 'center', opacity: 0.7 };
}
