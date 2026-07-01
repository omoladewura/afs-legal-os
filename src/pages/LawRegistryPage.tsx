/**
 * AFS Advocates — Law Registry Page
 * Phase C2
 *
 * LawRegistry was previously buried inside SettingsPanel behind an expand
 * toggle. C2 promotes it to its own top-level tab in the main case navigation.
 *
 * Mount in SiteNav / router alongside the other top-level views:
 *   <Route path="/law-registry" element={<LawRegistryPage />} />
 *   — or —
 *   case 'law_registry': return <LawRegistryPage />;  // if using setView()
 *
 * The view key to wire into SiteNav: 'law_registry'
 */

import { useAppStore } from '@/state/appStore';
import { T, S } from '@/constants/tokens';
import { LawRegistry } from '@/components/LawRegistry';

export function LawRegistryPage() {
  const { setView } = useAppStore();

  return (
    <div style={{
      maxWidth: 900, margin: '0 auto',
      padding: '32px 24px 80px',
      fontFamily: "'Times New Roman', Times, serif",
    }}>
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

      <h1 style={{ ...S.h1, marginTop: 0 }}>Law Registry</h1>
      <p style={{ ...S.p, marginBottom: 28 }}>
        All procedural deadlines and legal assertions in one place. Override any
        period without a deploy — changes take effect immediately in IndexedDB.
        Every change is logged with a mandatory reason.
      </p>

      <LawRegistry />
    </div>
  );
}
