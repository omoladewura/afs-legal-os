import { useState, useCallback, useRef, useEffect } from 'react';
import type { SessionStep } from '@/types/crossExam';
import { T, S } from '@/constants/tokens';

export interface CrossExamManualOverrideProps {
  onManualStep: (step: SessionStep) => void;
}

type AnswerChoice = 'YES' | 'NO' | 'SKIPPED';

const ANSWER_OPTIONS: { value: AnswerChoice; label: string; colour: string }[] = [
  { value: 'YES',     label: 'YES',     colour: '#a02020' },
  { value: 'NO',      label: 'NO',      colour: '#1a6a3a' },
  { value: 'SKIPPED', label: 'SKIPPED', colour: '#555555' },
];

function AnswerSelector({ value, onChange }: { value: AnswerChoice; onChange: (v: AnswerChoice) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {ANSWER_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1, minHeight: 52, fontSize: 15, fontWeight: 700, letterSpacing: '.1em',
            color: value === opt.value ? '#ffffff' : opt.colour,
            background: value === opt.value ? opt.colour : 'transparent',
            border: `2px solid ${opt.colour}`, borderRadius: 8, cursor: 'pointer',
            fontFamily: "'Times New Roman', Times, serif", transition: 'background .15s, color .15s',
            touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ManualOverrideModal({ onConfirm, onDismiss }: {
  onConfirm: (question: string, answer: AnswerChoice, notes: string) => void;
  onDismiss: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer,   setAnswer]   = useState<AnswerChoice>('YES');
  const [notes,    setNotes]    = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTimeout(() => textareaRef.current?.focus(), 80); }, []);

  const canConfirm = question.trim().length > 0;

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(question.trim(), answer, notes.trim());
  }, [canConfirm, question, answer, notes, onConfirm]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  }, [onDismiss]);

  return (
    <div onClick={handleBackdropClick} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ width: '100%', maxWidth: 560, background: T.card, borderRadius: '14px 14px 0 0', padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 -4px 24px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: T.text, fontFamily: "'Times New Roman', Times, serif" }}>
            Manual Question
          </span>
          <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: T.mute, lineHeight: 1, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }} aria-label="Dismiss">
            ×
          </button>
        </div>

        <div>
          <span style={{ ...S.label, marginBottom: 6 }}>Question to put to the witness</span>
          <textarea ref={textareaRef} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Type your question here…" rows={4} style={{ ...S.ta, fontSize: 17, lineHeight: 1.55, fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', resize: 'vertical', minHeight: 96 }} />
        </div>

        <div>
          <span style={{ ...S.label, marginBottom: 6 }}>Witness answer received</span>
          <AnswerSelector value={answer} onChange={setAnswer} />
        </div>

        <div>
          <span style={{ ...S.label, marginBottom: 6 }}>Notes (optional)</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add a note for this question…" rows={2} style={{ ...S.ta, fontSize: 13, lineHeight: 1.6, resize: 'vertical', minHeight: 52 }} />
        </div>

        <button onClick={handleConfirm} disabled={!canConfirm} style={{ width: '100%', minHeight: 54, fontSize: 15, fontWeight: 700, letterSpacing: '.08em', color: canConfirm ? '#ffffff' : T.mute, background: canConfirm ? '#1a3a6a' : T.bdrL, border: 'none', borderRadius: 10, cursor: canConfirm ? 'pointer' : 'not-allowed', fontFamily: "'Times New Roman', Times, serif", transition: 'background .15s', WebkitTapHighlightColor: 'transparent' }}>
          Log question
        </button>
      </div>
    </div>
  );
}

function ManualTriggerButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 48, padding: '0 16px', background: 'transparent', border: `1px solid ${T.bdr}`, borderLeft: 'none', borderRight: 'none', width: '100%', cursor: 'pointer', fontFamily: "'Times New Roman', Times, serif", fontSize: 13, fontWeight: 600, color: T.dim, textAlign: 'left', flexShrink: 0, touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
      <span>Insert custom question</span>
    </button>
  );
}

export function CrossExamManualOverride({ onManualStep }: CrossExamManualOverrideProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleConfirm = useCallback(
    (question: string, answer: AnswerChoice, notes: string) => {
      const step: SessionStep = {
        nodeId:             `manual::${crypto.randomUUID()}`,
        questionSnapshot:   question,
        answer,
        contradictionFired: false,
        notes,
        loggedAt:           new Date().toISOString(),
      };
      onManualStep(step);
      setModalOpen(false);
    },
    [onManualStep],
  );

  return (
    <>
      <ManualTriggerButton onOpen={() => setModalOpen(true)} />
      {modalOpen && <ManualOverrideModal onConfirm={handleConfirm} onDismiss={() => setModalOpen(false)} />}
    </>
  );
}
