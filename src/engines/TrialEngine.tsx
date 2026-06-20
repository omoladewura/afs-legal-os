/**
 * AFS Legal OS — Trial Engine
 *
 * Phase 3 (Trial Engine Consolidation — Build Plan v2):
 *   Unified engine absorbing CrossExamEngine and all examination tabs.
 *   This scaffold wires the shell, role detection, and seven-tab navigation.
 *   Tabs 1–7 render ComingSoon placeholders in this phase.
 *
 *   Tab 1 — Case Theory Brief       (Phase 4)
 *   Tab 2 — Witness Register        (Phase 5)
 *   Tab 3 — Examination-in-Chief    (Phase 6)
 *   Tab 4 — Cross-Examination       (Phase 7)
 *   Tab 5 — Contradiction Mapper    (Phase 8)
 *   Tab 6 — Impeachment Arsenal     (Phase 8)
 *   Tab 7 — Live Courtroom Mode     (Phase 8)
 *
 * Role detection: reads activeCase.counsel_role.
 *   prosecution / claimant_side → Prosecution/Claimant mode
 *   defence / defendant_side    → Defence/Defendant mode
 *   Determines witness panel arrangement and AI prompt framing throughout.
 *
 * Case Theory: CaseTheoryBanner rendered above tab nav at all times.
 *   Phases 4–8 read the locked theory from useCaseTheory.
 *
 * Storage: trial_ prefixed keys via loadBlindSpot / saveBlindSpot (additive).
 *          cx_ keys remain readable — backward compat preserved.
 *
 * @see CrossExamEngine.tsx  — deprecated, redirect stub in place (Phase 3D)
 * @see DefenceCaseEngine.tsx — exam_in_chief redirected here (Phase 3E)
 * @see ProsecutionCase.tsx  — cross_prep redirected here (Phase 3F)
 */

import { useState } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { CaseTheoryBanner } from '@/components/common/ui';
import { useCaseTheory } from '@/hooks/useCaseTheory';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props { activeCase: Case; }

type TrialTab =
  | 'theory_brief'
  | 'witness_register'
  | 'exam_in_chief'
  | 'cross_examination'
  | 'contradiction_mapper'
  | 'impeachment_arsenal'
  | 'live_courtroom';

interface TabDef {
  id:    TrialTab;
  label: string;
  icon:  string;
  desc:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const TRIAL_TABS: TabDef[] = [
  {
    id:    'theory_brief',
    icon:  '◈',
    label: 'Case Theory Brief',
    desc:  'Build, score, and lock your case theory. Library-grounded, AI-proposed, fully editable. Locked theory propagates to every downstream tab.',
  },
  {
    id:    'witness_register',
    icon:  '◉',
    label: 'Witness Register',
    desc:  'Central witness database. Own witnesses and opposing witnesses. Load witness statements on oath. Set call order.',
  },
  {
    id:    'exam_in_chief',
    icon:  '✍',
    label: 'Examination-in-Chief',
    desc:  'Three-sided witness preparation bundle: counsel question script · witness study pack · anticipated cross-examination preparation.',
  },
  {
    id:    'cross_examination',
    icon:  '⚔',
    label: 'Cross-Examination',
    desc:  'Statement audit, theory-breach question generator, contradiction mapper, impeachment arsenal, live courtroom mode.',
  },
  {
    id:    'contradiction_mapper',
    icon:  '⟲',
    label: 'Contradiction Mapper',
    desc:  'Log and categorise statement contradictions. Map each contradiction to the cross-examination question that exploits it.',
  },
  {
    id:    'impeachment_arsenal',
    icon:  '§',
    label: 'Impeachment Arsenal',
    desc:  'Evidence Act 2011 admissibility analysis. Prior inconsistent statement deployment. Credibility attack framework.',
  },
  {
    id:    'live_courtroom',
    icon:  '⬛',
    label: 'Live Courtroom Mode',
    desc:  'Real-time AI advice as witness answers are typed. Theory-aware next-question guidance.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ROLE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

type TrialRole = 'prosecution_claimant' | 'defence_defendant' | 'unknown';

function detectTrialRole(activeCase: Case): TrialRole {
  const r = activeCase.counsel_role;
  if (r === 'prosecution' || r === 'claimant_side') return 'prosecution_claimant';
  if (r === 'defence'     || r === 'defendant_side') return 'defence_defendant';
  return 'unknown';
}

const ROLE_LABEL: Record<TrialRole, string> = {
  prosecution_claimant: 'Prosecution / Claimant',
  defence_defendant:    'Defence / Defendant',
  unknown:              'Role not set',
};

const ROLE_COLOR: Record<TrialRole, string> = {
  prosecution_claimant: '#7a4a00',
  defence_defendant:    '#1a5a30',
  unknown:              '#555555',
};

// ─────────────────────────────────────────────────────────────────────────────
// COMING SOON PLACEHOLDER
// ─────────────────────────────────────────────────────────────────────────────

interface ComingSoonProps {
  tab:   TabDef;
  phase: number;
}

function ComingSoon({ tab, phase }: ComingSoonProps) {
  return (
    <div style={{
      padding: '48px 32px',
      textAlign: 'center',
      border: `1px dashed ${T.bdr}`,
      borderRadius: 6,
      background: T.surface ?? '#fafafa',
    }}>
      <div style={{
        fontSize: 28,
        marginBottom: 14,
        opacity: 0.35,
      }}>
        {tab.icon}
      </div>
      <h3 style={{
        fontSize: 16,
        color: T.text,
        fontFamily: "'Times New Roman', Times, serif",
        fontWeight: 700,
        marginBottom: 10,
      }}>
        {tab.label}
      </h3>
      <p style={{
        fontSize: 13,
        color: T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        lineHeight: 1.6,
        maxWidth: 480,
        margin: '0 auto 18px',
      }}>
        {tab.desc}
      </p>
      <span style={{
        display: 'inline-block',
        fontSize: 10,
        color: T.mute,
        fontFamily: "'Times New Roman', Times, serif",
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        border: `1px solid ${T.bdr}`,
        borderRadius: 3,
        padding: '3px 10px',
      }}>
        Implemented in Phase {phase}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB CONTENT ROUTER
// (Each case will be replaced by the real tab component in its phase)
// ─────────────────────────────────────────────────────────────────────────────

interface TabContentProps {
  tab:        TrialTab;
  activeCase: Case;
  role:       TrialRole;
}

function TabContent({ tab, activeCase, role }: TabContentProps) {
  const tabDef = TRIAL_TABS.find(t => t.id === tab)!;

  switch (tab) {
    // Phase 4
    case 'theory_brief':
      return <ComingSoon tab={tabDef} phase={4} />;

    // Phase 5
    case 'witness_register':
      return <ComingSoon tab={tabDef} phase={5} />;

    // Phase 6
    case 'exam_in_chief':
      return <ComingSoon tab={tabDef} phase={6} />;

    // Phase 7
    case 'cross_examination':
      return <ComingSoon tab={tabDef} phase={7} />;

    // Phase 8
    case 'contradiction_mapper':
    case 'impeachment_arsenal':
    case 'live_courtroom':
      return <ComingSoon tab={tabDef} phase={8} />;

    default:
      return null;
  }

  // Suppress unused-variable warnings for props consumed in future phases
  void activeCase; void role;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIAL ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function TrialEngine({ activeCase }: Props) {
  const [activeTab, setActiveTab] = useState<TrialTab>('theory_brief');

  const trialRole = detectTrialRole(activeCase);
  const roleColor = ROLE_COLOR[trialRole];
  const roleLabel = ROLE_LABEL[trialRole];

  // Case Theory hook — theory is consumed downstream by Phases 4–8
  const caseTheory = useCaseTheory(activeCase.id);

  return (
    <div>

      {/* ── Engine header ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h2 style={{
            fontSize: 20,
            color: T.text,
            fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700,
            margin: 0,
          }}>
            Trial Engine
          </h2>
          {/* Role mode badge */}
          <span style={{
            fontSize: 9,
            padding: '2px 9px',
            borderRadius: 2,
            fontFamily: "'Times New Roman', Times, serif",
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            border: `1px solid ${roleColor}22`,
            background: `${roleColor}11`,
            color: roleColor,
          }}>
            {roleLabel}
          </span>
        </div>
        <p style={{
          fontSize: 12,
          color: T.mute,
          fontFamily: "'Times New Roman', Times, serif",
          margin: 0,
          lineHeight: 1.5,
        }}>
          Unified examination and cross-examination engine. Case Theory Brief ·
          Witness Register · Examination-in-Chief · Cross-Examination ·
          Contradiction Mapper · Impeachment Arsenal · Live Courtroom Mode.
        </p>
      </div>

      {/* ── Case Theory Banner — always visible above tab nav ─────────────── */}
      <div style={{ marginBottom: 16 }}>
        <CaseTheoryBanner
          theory={caseTheory.theory}
          locked={caseTheory.locked}
          score={caseTheory.score}
          hasTheory={caseTheory.hasTheory}
        />
      </div>

      {/* ── Tab navigation ────────────────────────────────────────────────── */}
      <div
        className="tab-scroll"
        style={{ margin: '0 0 22px', gap: 2, paddingBottom: 0 }}
      >
        {TRIAL_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.desc}
              style={{
                flexShrink:    0,
                background:    isActive ? '#e8e8e8' : 'transparent',
                border:        '1px solid transparent',
                borderBottom:  isActive ? '2px solid #e8e8e8' : '1px solid transparent',
                marginBottom:  isActive ? '-2px' : '0',
                color:         isActive ? '#111111' : '#888888',
                borderRadius:  '3px 3px 0 0',
                padding:       '6px 14px',
                fontSize:      12,
                fontFamily:    "'Times New Roman', Times, serif",
                cursor:        'pointer',
                letterSpacing: '.03em',
                fontWeight:    isActive ? 700 : 400,
                transition:    'background .15s, color .15s',
                whiteSpace:    'nowrap',
                display:       'flex',
                alignItems:    'center',
                gap:           5,
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                  (e.currentTarget as HTMLElement).style.color = '#333333';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#888888';
                }
              }}
            >
              <span style={{ fontSize: 11 }}>{tab.icon}</span>
              {tab.label}
              {/* Theory locked dot on Case Theory Brief tab */}
              {tab.id === 'theory_brief' && caseTheory.hasTheory && (
                <span style={{
                  width: 5, height: 5,
                  borderRadius: '50%',
                  background: '#2a6a3a',
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active tab content ────────────────────────────────────────────── */}
      <TabContent
        tab={activeTab}
        activeCase={activeCase}
        role={trialRole}
      />

    </div>
  );
}
