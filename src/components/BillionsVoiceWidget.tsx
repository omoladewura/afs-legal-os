/**
 * BillionsVoiceWidget
 *
 * Drop this file into src/components/ (or src/engines/) of the AFS project.
 * Then import and render <BillionsVoiceWidget /> anywhere on HomePage.
 *
 * Usage in HomePage.tsx:
 *   import { BillionsVoiceWidget } from '@/components/BillionsVoiceWidget';
 *   // Then place <BillionsVoiceWidget /> wherever you want the card on the page.
 *
 * The card uses an archaic book / parchment aesthetic — sober umber-cream
 * palette, Times New Roman / Georgia — completely isolated from the AFS dark theme.
 * When the card is clicked it opens a full-screen modal that runs the tool.
 * The tool calls the Anthropic API directly (no library dependency).
 */

import { useState, useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS (verbatim from the original Billions Voice tool)
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a master of rhetoric and historical storytelling, trained in the style of Chuck Rhoades from Billions — a man who reaches into the depths of history, myth, scripture, and literature not to decorate his words, but to make them unforgettable and irrefutable.

When given a piece of writing, you choose ONE of these weapons — whichever cuts deepest for that specific message:

WEAPONS AVAILABLE:
1. A STORY — A real, verifiable historical event, ancient myth, biblical parable, warrior's tale, or scene from literature/poetry that mirrors or reframes the user's message. Tell it briefly but vividly. Let it do the work.
2. A QUOTE — A precise line from history, literature, scripture, or philosophy, deployed at the right moment like a blade.
3. AN ANALOGY — A powerful structural comparison drawn from ancient battles, nature, law, medicine, or sport.

STORY SOURCES you may draw from (all must be real and verifiable):
- Ancient Greek and Roman history (Thermopylae, Caesar, Hannibal, Socrates' death, the Siege of Troy)
- Mythology (Greek, Roman, Norse, Egyptian, Mesopotamian)
- Biblical and Quranic parables and events
- Samurai and Eastern philosophy stories (Miyamoto Musashi, Sun Tzu, the 47 Ronin)
- Great speeches and their contexts (Churchill, Lincoln, Frederick Douglass, MLK)
- Classic literature (Homer, Dante, Milton, Shakespeare, Dostoevsky, Hemingway)
- Poetry (Rumi, Keats, Whitman, Dickinson, Rilke, Dylan Thomas)
- Historical trials, battles, betrayals, sacrifices
- Stoic philosophers (Marcus Aurelius, Seneca, Epictetus)

RULES:
- NEVER invent or fabricate. Every story, quote, or reference must be real and verifiable.
- Weave the story or reference INTO the rewrite naturally. It should feel like it was always part of the message.
- The story must mirror or reframe the user's situation — not just be tangentially related.
- Be brief with the story. Three sentences of story can carry more than three paragraphs.
- After the story lands, return to the user's point. The story serves the message, not the other way around.
- Match the register of the original (formal, casual, angry, tender) but always elevate.
- The silence after the story is the power. Never over-explain inside the rewrite.

Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "rewritten": "The full rewritten message with the story or reference woven in naturally",
  "weapon_type": "story or quote or analogy",
  "weapon_title": "Name of the story, event, myth, work, or person",
  "the_passage": "The specific story excerpt, quote, or analogy as it appears or is echoed in the rewrite",
  "source_context": "What this is — where it comes from, when, who was involved. 2-4 sentences. Real facts only.",
  "why_it_fits": "Why this specific story or reference was chosen for this specific message — the emotional and rhetorical logic",
  "verification": "Where someone could verify this: the book, historical record, scripture chapter, speech title, etc."
}`;

const SCRIBE_INTERVIEWER_PROMPT = `You are The Scribe — the intake voice of the Rhoades Method. Your job is to conduct a brief, intelligent interview to understand exactly what a person needs to write. You ask ONE question at a time. You are not clinical. You are perceptive, warm, and precise — like a great editor sitting across a table.

Your questions uncover:
1. What they are writing (letter, speech, apology, toast, confrontation, resignation, love note, etc.)
2. Who it is for — and what the relationship is
3. The core thing the reader must feel, know, or do after reading it
4. The tone they want (formal, intimate, fierce, tender, etc.)
5. Anything that must be said but cannot be said plainly — the subtext
6. Any constraints (what must never appear, length, occasion)

Ask between 4 and 7 questions total. After each answer, decide if you have enough to compose, or if one more question would unlock something important. Do not over-ask. When you are satisfied, end your message with exactly the phrase: "I have what I need."

Rules:
- ONE question per message. Never list multiple questions.
- Never be clinical or bullet-pointed. Be warm, direct, literary.
- Your questions can be short — even a single sentence. They should feel like a perceptive person asking, not a form.
- Reference what they said in prior answers when relevant.
- When satisfied: write a brief closing sentence acknowledging what they've shared, then end with "I have what I need." on its own line.

Respond as plain text — no JSON, no markdown.`;

const SCRIBE_COMPOSER_PROMPT = `You are the rhetorical voice of the Rhoades Method — trained in the style of Chuck Rhoades from Billions. You have received a complete intake from The Scribe: the full conversation in which a person answered every question needed to compose their piece.

Your task: Write the final composition — letter, speech, toast, apology, confrontation, or whatever was requested — with historical rhetoric woven in naturally.

You draw from:
- Ancient Greek and Roman history and mythology
- Biblical and Quranic parables
- Samurai, Eastern philosophy, Sun Tzu
- Churchill, Lincoln, MLK speeches
- Shakespeare, Dante, Homer, Rumi, Milton, Dostoevsky
- Stoics: Marcus Aurelius, Seneca, Epictetus

Rules:
- NEVER invent or fabricate references. Every story, quote, or analogy must be real and verifiable.
- Match the tone and register they described — formal, intimate, fierce, tender — but always elevate.
- The historical reference must mirror or reframe the situation. It serves the message. It should feel inevitable, not decorative.
- Write the full piece. No preamble. No "here is your letter." Just the piece itself.
- Then, after the piece, provide a JSON block for the archive. This must be on a new line, starting with <<<ARCHIVE>>> and containing valid JSON only:

<<<ARCHIVE>>>
{
  "weapon_type": "story or quote or analogy",
  "weapon_title": "Name of the story, event, myth, work, or person",
  "the_passage": "The specific story excerpt, quote, or analogy as it appears or is echoed in the piece",
  "source_context": "What this is — where it comes from, when, who was involved. 2-4 sentences. Real facts only.",
  "why_it_fits": "Why this specific reference was chosen — the emotional and rhetorical logic",
  "verification": "Where someone could verify this: the book, historical record, scripture chapter, speech title, etc."
}`;

const NAMEIT_PROMPT = `You are the sharpest rhetorical mind in the room — trained in the style of the characters in Billions who reach for history, myth, scripture, and literature to name a situation so precisely that plain language becomes impossible afterward.

The user will describe a situation in plain language. Your job is to produce exactly THREE candidate lines — each a different kind of weapon — that NAME the situation with devastating precision.

These lines are not rewrites. They are not summaries. They are framings — compressed cultural references that instantly recontextualize the situation for whoever hears them.

Think of Dake saying: "Nearer My God to Thee. That was the song the band was playing on the Titanic. I offered you a lifeboat. You picked up a violin."
Think of someone saying: "They will do me like Louis XIV."
Think of: "You offered them a door out of the cave. They preferred the shadows."

These lines work because they make the situation LEGIBLE in a new way. They borrow weight from history or myth and transfer it to the moment.

RULES:
- NEVER fabricate or invent. Every reference must be real and verifiable.
- Each of the three lines must draw from a DIFFERENT source category:
  • One from history (a real event, battle, political moment, historical figure's fate)
  • One from myth or scripture (Greek/Roman/Norse myth, Biblical/Quranic parable)
  • One from literature, film, or philosophy (Shakespeare, Dostoevsky, Plato, a great speech)
- The line must be SHORT — one or two sentences maximum. It lands and stops.
- After the line, a brief explanation of WHY it cuts — the rhetorical logic (2-3 sentences, plain language)
- Include where to verify the reference

Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "lines": [
    {
      "line": "The actual one or two sentence framing",
      "category": "history",
      "source_name": "Name of the event, figure, or work",
      "why_it_cuts": "Why this framing names the situation so precisely — the emotional and rhetorical logic in 2-3 sentences",
      "verification": "Where to verify: the historical record, scripture verse, work title, etc."
    },
    {
      "line": "The actual one or two sentence framing",
      "category": "myth or scripture",
      "source_name": "Name of the myth, parable, or text",
      "why_it_cuts": "Why this framing names the situation so precisely",
      "verification": "Where to verify"
    },
    {
      "line": "The actual one or two sentence framing",
      "category": "literature or philosophy",
      "source_name": "Name of the work or philosopher",
      "why_it_cuts": "Why this framing names the situation so precisely",
      "verification": "Where to verify"
    }
  ]
}`;

const DISSECTION_PROMPT = `You are the foremost analyst of rhetoric — a scholar trained in the tradition of the characters in Billions who dissect language the way surgeons dissect bodies: with precision, without sentiment, naming every choice.

The user will give you a piece of rhetoric — a speech, email, argument, confrontation, letter, or any piece of writing. Your job is to reverse-engineer it completely:

1. IDENTIFY THE WEAPON — What rhetorical device did they deploy? Story, quote, analogy, emotional appeal, logical structure, threat, seduction, authority, scarcity, guilt, flattery, fear?
2. NAME THE MOVE — What is the underlying strategic move? Divide and conquer? Establish moral high ground? Create urgency? Make the reader complicit? Preempt objections?
3. WHERE IT LANDS — What is the precise moment in the text where the power concentrates? Quote the exact phrase or sentence that carries the most weight.
4. THE WEAK POINT — Every rhetorical construction has a seam. Where is it? What assumption does it rely on that could be challenged?
5. THE COUNTER — If you needed to respond to this and dismantle it, what single rhetorical move would you make? Draw from history, myth, scripture, or literature — one weapon that neutralizes theirs.

RULES:
- Be surgical. This is analysis, not admiration or criticism.
- Name things precisely. "Guilt transfer" is better than "they made you feel bad."
- The counter must be a real, verifiable historical or literary reference — not advice.
- Never fabricate references.

Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "weapon_identified": "The primary rhetorical weapon or device deployed",
  "strategic_move": "The underlying strategic intention — what they were trying to make you think, feel, or do",
  "power_phrase": "The single phrase or sentence where the most rhetorical force concentrates",
  "power_phrase_analysis": "Why this phrase carries so much weight — the precise mechanism",
  "the_seam": "The weak point, the hidden assumption, the place where this rhetoric could be challenged",
  "the_counter": {
    "move": "The counter-rhetorical move you would make",
    "weapon_type": "story or quote or analogy",
    "weapon_title": "Name of the historical event, myth, work, or figure",
    "the_line": "The specific reference or line you would deploy",
    "source_context": "What this reference is and where it comes from. 2-4 sentences. Real facts only.",
    "why_it_neutralizes": "Why this specific counter dismantles their construction",
    "verification": "Where to verify: book, historical record, scripture, speech, etc."
  }
}`;

const REPLY_PROMPT = `You are the most dangerous voice in any room — trained in the style of the characters in Billions who never receive a challenge without answering it at a higher frequency.

The user will give you a message they received — a challenge, a threat, a manipulation, a slight, an ultimatum, a flattery designed to extract something, or any communication that requires a response with weight.

Your job is to craft the reply. Not a rebuttal. Not a defense. A reply that resets the terms of the exchange entirely.

The reply must:
1. Acknowledge what was sent without capitulating to its framing
2. Reframe the situation using a historical story, quote, or analogy that shifts the power dynamic
3. Deliver its point with finality — the reader should feel that continuing the argument would be unwise
4. Match the tone of what was received, but exceed its altitude

RULES:
- The historical reference must be real and verifiable. Never fabricate.
- The reply must feel like it could actually be sent — not a fantasy. Elevated, yes. Impossible, no.
- Do not explain the reference inside the reply. It lands or it doesn't.
- Match register: if they wrote formally, reply formally elevated. If they were casual and cutting, be casual and lethal.
- The reply should be proportionate in length — slightly shorter than or equal to what they sent, never longer.

Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "reply": "The full reply, ready to send",
  "weapon_type": "story or quote or analogy",
  "weapon_title": "Name of the story, event, myth, work, or person deployed",
  "the_passage": "The specific reference as it appears or is echoed in the reply",
  "source_context": "What this is — where it comes from, when, who was involved. 2-4 sentences. Real facts only.",
  "the_reframe": "What power dynamic shift the reply achieves — what the reader will feel after reading it",
  "why_it_ends_it": "Why this reply makes continuing the argument difficult or unwise for them",
  "verification": "Where someone could verify this reference"
}`;

// ─────────────────────────────────────────────────────────────────────────────
// PARCHMENT PALETTE  (used by the card and modal; never touches AFS tokens)
// ─────────────────────────────────────────────────────────────────────────────
const P = {
  bg:       '#f5f0e8',   // aged cream
  surface:  '#ede6d6',   // slightly darker parchment
  border:   '#c8b99a',   // old map ink
  rule:     '#b0987a',   // sepia rule
  ink:      '#1c1610',   // dense black ink
  inkDim:   '#4a3f2f',   // faded ink
  inkMute:  '#7a6a55',   // marginal annotation
  gold:     '#8b6914',   // muted antique gold
  goldL:    '#a07820',   // slightly lighter
  accent:   '#5c3a1e',   // umber / walnut
  red:      '#7a2020',   // dark red rubric
  ff:       "'Times New Roman', Georgia, serif",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function apiCall(systemPrompt: string, userContent: string, maxTokens = 1800): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const data = await response.json();
  return data.content?.map((i: any) => i.text || '').join('').trim();
}

function parseJSON(text: string) {
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

function copyToClipboard(text: string) {
  try { navigator.clipboard.writeText(text); } catch {
    const el = document.createElement('textarea');
    el.value = text; document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING QUOTES
// ─────────────────────────────────────────────────────────────────────────────
const LOADING_QUOTES = [
  { text: 'Fortune favours the bold.', attr: 'Virgil, Aeneid' },
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', attr: 'Marcus Aurelius' },
  { text: 'Cowards die many times before their deaths; the valiant never taste of death but once.', attr: 'Shakespeare, Julius Caesar' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', attr: 'Aristotle' },
  { text: 'Do not go gentle into that good night.', attr: 'Dylan Thomas' },
  { text: 'Yield and overcome.', attr: 'Lao Tzu, Tao Te Ching' },
  { text: 'Even the darkest night will end and the sun will rise.', attr: 'Victor Hugo, Les Misérables' },
  { text: 'Know thyself.', attr: 'Delphic Oracle' },
  { text: 'The only way out is through.', attr: 'Robert Frost' },
];

function LoadingQuote() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setIdx(i => (i + 1) % LOADING_QUOTES.length); setFade(true); }, 400);
    }, 3200);
    return () => clearInterval(t);
  }, []);
  const q = LOADING_QUOTES[idx];
  return (
    <div style={{ textAlign: 'center', padding: '28px 0', opacity: fade ? 1 : 0, transition: 'opacity 0.4s' }}>
      <p style={{ fontFamily: P.ff, fontSize: 15, fontStyle: 'italic', color: P.inkMute, margin: '0 0 6px', lineHeight: 1.6 }}>
        &ldquo;{q.text}&rdquo;
      </p>
      <p style={{ fontFamily: P.ff, fontSize: 11, color: P.rule, letterSpacing: '0.1em', margin: 0 }}>— {q.attr}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
type AppMode = 'elevate' | 'compose' | 'nameit' | 'dissect' | 'reply';

const MODES_DEF = [
  { key: 'elevate' as AppMode, roman: 'I',   label: 'Elevate',   sub: 'Rewrite with rhetorical force',   glyph: '✦', rubric: P.gold },
  { key: 'compose' as AppMode, roman: 'II',  label: 'Compose',   sub: 'Build something from nothing',    glyph: '⌘', rubric: P.accent },
  { key: 'nameit'  as AppMode, roman: 'III', label: 'Name It',   sub: 'Find the one line that cuts',     glyph: '⚔', rubric: '#4a6055' },
  { key: 'dissect' as AppMode, roman: 'IV',  label: 'Dissect',   sub: 'Reverse-engineer any rhetoric',   glyph: '⚗', rubric: P.red },
  { key: 'reply'   as AppMode, roman: 'V',   label: 'The Reply', sub: 'Answer at a higher frequency',    glyph: '↩', rubric: '#5c6e38' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLE HELPERS (inside modal)
// ─────────────────────────────────────────────────────────────────────────────
const label9 = (color = P.inkMute): React.CSSProperties => ({
  fontFamily: P.ff, fontSize: 9, letterSpacing: '4px', textTransform: 'uppercase',
  color, marginBottom: 10, display: 'block',
});

const pill = (active: boolean, activeColor: string): React.CSSProperties => ({
  background: active ? `${activeColor}18` : 'transparent',
  border: `1px solid ${active ? activeColor : P.border}`,
  color: active ? activeColor : P.inkMute,
  padding: '6px 16px', fontSize: 10, letterSpacing: '2px',
  textTransform: 'uppercase', cursor: 'pointer',
  fontFamily: P.ff, borderRadius: 1, transition: 'all 0.2s',
});

const ta = (h = 180): React.CSSProperties => ({
  width: '100%', minHeight: h, background: '#fffdf8',
  border: `1px solid ${P.border}`, borderRadius: 2,
  color: P.ink, fontSize: 15, lineHeight: 1.8,
  padding: '18px 20px', resize: 'vertical', outline: 'none',
  fontFamily: P.ff, boxSizing: 'border-box', transition: 'border-color 0.25s',
});

const actionBtn = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? 'transparent' : `linear-gradient(135deg, ${P.gold}, ${P.goldL})`,
  border: disabled ? `1px solid ${P.border}` : 'none',
  color: disabled ? P.rule : '#fffdf8',
  padding: '12px 36px', fontSize: 10, letterSpacing: '5px',
  textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: P.ff, fontWeight: 'bold', borderRadius: 1, transition: 'all 0.3s',
});

const copyBtn = (copied: boolean): React.CSSProperties => ({
  background: copied ? `${P.gold}18` : 'transparent',
  border: `1px solid ${copied ? P.gold : P.border}`,
  color: copied ? P.gold : P.inkMute,
  padding: '8px 20px', fontSize: 10, letterSpacing: '2px',
  textTransform: 'uppercase', cursor: 'pointer',
  fontFamily: P.ff, borderRadius: 1, transition: 'all 0.2s',
  display: 'flex', alignItems: 'center', gap: 6,
});

// ─────────────────────────────────────────────────────────────────────────────
// MODAL CONTENT (the full Billions Voice tool)
// ─────────────────────────────────────────────────────────────────────────────
function BillionsVoiceModal({ onClose }: { onClose: () => void }) {
  const [appMode, setAppMode] = useState<AppMode>('elevate');

  // ── Elevate state
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('auto');
  const [tone, setTone] = useState('auto');
  const [intensity, setIntensity] = useState(3);
  const [era, setEra] = useState('any');
  const [context, setContext] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const typeRef = useRef<any>(null);

  // ── Compose / Scribe state
  const [scribeMessages, setScribeMessages] = useState<{ role: string; text: string }[]>([]);
  const [scribeInput, setScribeInput] = useState('');
  const [scribeLoading, setScribeLoading] = useState(false);
  const [scribePhase, setScribePhase] = useState<'idle' | 'interviewing' | 'done'>('idle');
  const [scribeResult, setScribeResult] = useState<any>(null);
  const [scribeError, setScribeError] = useState<string | null>(null);
  const [scribeCopied, setScribeCopied] = useState(false);
  const [scribeDisplayed, setScribeDisplayed] = useState('');
  const [scribeTyping, setScribeTyping] = useState(false);
  const scribeTypeRef = useRef<any>(null);
  const scribeBottomRef = useRef<HTMLDivElement>(null);
  const scribeInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Name It state
  const [nameItInput, setNameItInput] = useState('');
  const [nameItLoading, setNameItLoading] = useState(false);
  const [nameItResult, setNameItResult] = useState<any>(null);
  const [nameItError, setNameItError] = useState<string | null>(null);
  const [nameItCopied, setNameItCopied] = useState<number | null>(null);
  const [nameItExpanded, setNameItExpanded] = useState<number | null>(null);

  // ── Dissect state
  const [dissectInput, setDissectInput] = useState('');
  const [dissectLoading, setDissectLoading] = useState(false);
  const [dissectResult, setDissectResult] = useState<any>(null);
  const [dissectError, setDissectError] = useState<string | null>(null);
  const [dissectSection, setDissectSection] = useState<string | null>(null);
  const [dissectCopied, setDissectCopied] = useState(false);

  // ── Reply state
  const [replyInput, setReplyInput] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyResult, setReplyResult] = useState<any>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyRevealed, setReplyRevealed] = useState(false);
  const [replyCopied, setReplyCopied] = useState(false);
  const [replyDisplayed, setReplyDisplayed] = useState('');
  const [replyTyping, setReplyTyping] = useState(false);
  const replyTypeRef = useRef<any>(null);

  // ── Typewriter: Elevate
  useEffect(() => {
    if (!result?.rewritten) { setDisplayedText(''); return; }
    if (typeRef.current) clearInterval(typeRef.current);
    setDisplayedText(''); setIsTyping(true);
    const full = result.rewritten; let i = 0;
    typeRef.current = setInterval(() => {
      i++; setDisplayedText(full.slice(0, i));
      if (i >= full.length) { clearInterval(typeRef.current); setIsTyping(false); }
    }, 18);
    return () => clearInterval(typeRef.current);
  }, [result]);

  // ── Typewriter: Scribe
  useEffect(() => {
    if (!scribeResult?.body) { setScribeDisplayed(''); return; }
    if (scribeTypeRef.current) clearInterval(scribeTypeRef.current);
    setScribeDisplayed(''); setScribeTyping(true);
    const full = scribeResult.body; let i = 0;
    scribeTypeRef.current = setInterval(() => {
      i++; setScribeDisplayed(full.slice(0, i));
      if (i >= full.length) { clearInterval(scribeTypeRef.current); setScribeTyping(false); }
    }, 14);
    return () => clearInterval(scribeTypeRef.current);
  }, [scribeResult]);

  // ── Typewriter: Reply
  useEffect(() => {
    if (!replyResult?.reply) { setReplyDisplayed(''); return; }
    if (replyTypeRef.current) clearInterval(replyTypeRef.current);
    setReplyDisplayed(''); setReplyTyping(true);
    const full = replyResult.reply; let i = 0;
    replyTypeRef.current = setInterval(() => {
      i++; setReplyDisplayed(full.slice(0, i));
      if (i >= full.length) { clearInterval(replyTypeRef.current); setReplyTyping(false); }
    }, 16);
    return () => clearInterval(replyTypeRef.current);
  }, [replyResult]);

  // Scroll scribe to bottom
  useEffect(() => {
    scribeBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scribeMessages, scribeLoading]);

  // ── Mode/tone/era/intensity definitions
  const modeInstructions: Record<string, string> = {
    auto: 'Choose whatever weapon cuts deepest — story, quote, or analogy. Trust your instincts.',
    story: 'You MUST use a real story this time — a historical event, ancient myth, parable, or literary scene. No pure quotes.',
    quote: 'You MUST use a quote this time — one precise line from history, literature, scripture, or philosophy.',
    analogy: 'You MUST use an analogy this time — a structural comparison drawn from history, nature, war, or ancient wisdom.',
  };
  const tones = [
    { key: 'auto',     label: 'Auto',     i: '' },
    { key: 'dominate', label: 'Dominate', i: 'The register is DOMINANCE. Cold, certain, immovable.' },
    { key: 'persuade', label: 'Persuade', i: 'The register is PERSUASION. Logic wrapped in beauty.' },
    { key: 'wound',    label: 'Wound',    i: 'The register is WOUND. Precise, surgical, devastating.' },
    { key: 'mourn',    label: 'Mourn',    i: 'The register is MOURNING. Tender but not weak.' },
    { key: 'inspire',  label: 'Inspire',  i: 'The register is INSPIRATION. History is watching.' },
    { key: 'seduce',   label: 'Seduce',   i: 'The register is SEDUCTION. Warm, intimate, irresistible.' },
  ];
  const intensityLevels: Record<number, { label: string; i: string }> = {
    1: { label: 'A whisper',       i: 'INTENSITY: 1 — Restrained. Understatement is the weapon.' },
    2: { label: 'A suggestion',    i: 'INTENSITY: 2 — Subtle. Woven in naturally, never announced.' },
    3: { label: 'Measured force',  i: 'INTENSITY: 3 — Balanced. Reference carries real weight.' },
    4: { label: 'Full conviction', i: 'INTENSITY: 4 — Bold and unapologetic. Almost mythic.' },
    5: { label: 'Annihilation',    i: 'INTENSITY: 5 — Maximum. Nothing held back.' },
  };
  const eras = [
    { key: 'any',         label: 'Any era',     i: '' },
    { key: 'greece',      label: 'Greece',       i: 'ERA: Draw ONLY from Ancient Greek history, myth, and literature.' },
    { key: 'rome',        label: 'Rome',         i: 'ERA: Draw ONLY from Roman history, myth, and literature.' },
    { key: 'bible',       label: 'Scripture',    i: 'ERA: Draw ONLY from Biblical or Quranic sources.' },
    { key: 'eastern',     label: 'Eastern',      i: 'ERA: Draw ONLY from Chinese, Japanese, Persian, or Indian sources.' },
    { key: 'norse',       label: 'Norse',        i: 'ERA: Draw ONLY from Norse mythology and Viking history.' },
    { key: 'renaissance', label: 'Renaissance',  i: 'ERA: Draw ONLY from Renaissance sources — 14th–17th century.' },
    { key: 'modern',      label: 'Modern',       i: 'ERA: Draw ONLY from 19th and 20th century history and literature.' },
  ];
  const toneI = tones.find(t => t.key === tone)?.i || '';
  const intensityI = intensityLevels[intensity].i;
  const eraI = eras.find(e => e.key === era)?.i || '';

  const typeColors: Record<string, any> = {
    story:   { border: P.gold,  accent: P.goldL, badge: 'Ancient Story' },
    quote:   { border: '#a07820', accent: P.accent, badge: 'The Quote' },
    analogy: { border: '#4a6055', accent: '#4a6055', badge: 'The Analogy' },
  };
  const tc = result && typeColors[result.weapon_type] ? typeColors[result.weapon_type] : typeColors.quote;

  // ── API CALLS ──────────────────────────────────────────────────────────────

  const elevate = async () => {
    if (!input.trim()) return;
    setLoading(true); setError(null); setResult(null); setRevealed(false); setCopied(false);
    try {
      const text = await apiCall(
        SYSTEM_PROMPT,
        `${modeInstructions[mode]}${toneI ? `\n\nTONE: ${toneI}` : ''}\n\nINTENSITY: ${intensityI}${eraI ? `\n\n${eraI}` : ''}${context.trim() ? `\n\nCONTEXT: ${context.trim()}` : ''}\n\nHere is the text to elevate:\n\n${input}`
      );
      setResult(parseJSON(text));
    } catch { setError('Something went wrong. Try again.'); }
    finally { setLoading(false); }
  };

  const scribeStart = async () => {
    setScribePhase('interviewing'); setScribeLoading(true); setScribeError(null);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, system: SCRIBE_INTERVIEWER_PROMPT, messages: [{ role: 'user', content: 'I need to write something. Begin the interview.' }] }),
      });
      const data = await res.json();
      const text = data.content?.map((b: any) => b.text || '').join('').trim();
      setScribeMessages([{ role: 'scribe', text }]);
    } catch { setScribeError('The Scribe could not be reached. Try again.'); setScribePhase('idle'); }
    finally { setScribeLoading(false); }
  };

  const scribeReply = async () => {
    if (!scribeInput.trim() || scribeLoading) return;
    const userMsg = { role: 'user', text: scribeInput.trim() };
    const newMsgs = [...scribeMessages, userMsg];
    setScribeMessages(newMsgs); setScribeInput(''); setScribeLoading(true);
    const isDone = scribeMessages.at(-1)?.text.includes('I have what I need');
    if (isDone) {
      // compose
      try {
        const convoText = newMsgs.map(m => `${m.role === 'scribe' ? 'THE SCRIBE' : 'PERSON'}: ${m.text}`).join('\n\n');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1800, system: SCRIBE_COMPOSER_PROMPT, messages: [{ role: 'user', content: `Here is the full intake conversation:\n\n${convoText}\n\nNow write the piece.` }] }),
        });
        const data = await res.json();
        const full = data.content?.map((b: any) => b.text || '').join('').trim();
        const archiveSplit = full.split('<<<ARCHIVE>>>');
        const body = archiveSplit[0].trim();
        let archive = null;
        if (archiveSplit[1]) { try { archive = parseJSON(archiveSplit[1].trim()); } catch {} }
        setScribeResult({ body, archive }); setScribePhase('done');
      } catch { setScribeError('The composition failed. Try again.'); }
      finally { setScribeLoading(false); }
    } else {
      try {
        const apiMsgs = newMsgs.map(m => ({ role: m.role === 'scribe' ? 'assistant' : 'user', content: m.text }));
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, system: SCRIBE_INTERVIEWER_PROMPT, messages: apiMsgs }),
        });
        const data = await res.json();
        const text = data.content?.map((b: any) => b.text || '').join('').trim();
        setScribeMessages([...newMsgs, { role: 'scribe', text }]);
      } catch { setScribeError('The Scribe went silent. Try again.'); }
      finally { setScribeLoading(false); }
    }
  };

  const runNameIt = async () => {
    if (!nameItInput.trim()) return;
    setNameItLoading(true); setNameItError(null); setNameItResult(null); setNameItExpanded(null);
    try {
      const text = await apiCall(NAMEIT_PROMPT, `Here is the situation:\n\n${nameItInput.trim()}`);
      setNameItResult(parseJSON(text));
    } catch { setNameItError('Something went wrong. Try again.'); }
    finally { setNameItLoading(false); }
  };

  const runDissect = async () => {
    if (!dissectInput.trim()) return;
    setDissectLoading(true); setDissectError(null); setDissectResult(null); setDissectSection(null);
    try {
      const text = await apiCall(DISSECTION_PROMPT, `Here is the rhetoric to dissect:\n\n${dissectInput.trim()}`);
      setDissectResult(parseJSON(text));
    } catch { setDissectError('Something went wrong. Try again.'); }
    finally { setDissectLoading(false); }
  };

  const runReply = async () => {
    if (!replyInput.trim()) return;
    setReplyLoading(true); setReplyError(null); setReplyResult(null); setReplyRevealed(false); setReplyCopied(false);
    try {
      const text = await apiCall(REPLY_PROMPT, `Here is the message I received:\n\n${replyInput.trim()}`);
      setReplyResult(parseJSON(text));
    } catch { setReplyError('Something went wrong. Try again.'); }
    finally { setReplyLoading(false); }
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  const activeM = MODES_DEF.find(m => m.key === appMode)!;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: P.bg, fontFamily: P.ff, color: P.ink, overflowY: 'auto' }}>
      <style>{`
        @keyframes bvFadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes bvBlink  { 0%,100% { opacity:1; } 50% { opacity:0; } }
        .bv-ta:focus { border-color: ${P.rule} !important; }
        .bv-pill:hover { opacity:0.8; }
      `}</style>

      {/* Top rule */}
      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${P.rule}, ${P.gold}, ${P.rule}, transparent)`, flexShrink: 0 }} />

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 28px', borderBottom: `1px solid ${P.border}`, background: P.surface, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '6px', color: P.rule, textTransform: 'uppercase', marginBottom: 3 }}>The Rhoades Method</div>
          <div style={{ fontSize: 18, fontWeight: 400, color: P.ink, fontStyle: 'italic' }}>Stories That Change Everything</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${P.border}`, color: P.inkMute, padding: '7px 18px', fontSize: 10, letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: P.ff, borderRadius: 1 }}>
          ✕ Close
        </button>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: `1px solid ${P.border}`, background: P.surface, flexShrink: 0 }}>
        {MODES_DEF.map((m, i) => {
          const active = appMode === m.key;
          return (
            <button key={m.key} onClick={() => setAppMode(m.key)} style={{
              background: active ? P.bg : 'transparent',
              border: 'none',
              borderTop: `3px solid ${active ? m.rubric : 'transparent'}`,
              borderLeft: i > 0 ? `1px solid ${P.border}` : 'none',
              padding: '14px 10px 12px', cursor: 'pointer',
              fontFamily: P.ff, textAlign: 'left', transition: 'all 0.25s',
            }}>
              <div style={{ fontSize: 7, letterSpacing: '3px', color: active ? m.rubric : P.rule, textTransform: 'uppercase', marginBottom: 5 }}>{m.roman}</div>
              <div style={{ fontSize: 11, color: active ? P.ink : P.inkMute, letterSpacing: 0.5 }}>
                <span style={{ marginRight: 5, opacity: active ? 1 : 0.4 }}>{m.glyph}</span>{m.label}
              </div>
              <div style={{ fontSize: 9, color: active ? P.inkMute : P.rule, fontStyle: 'italic', marginTop: 2 }}>{m.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ maxWidth: 800, width: '100%', margin: '0 auto', padding: '36px 28px 72px', animation: 'bvFadeUp 0.35s ease' }}>

        {/* ── ELEVATE ── */}
        {appMode === 'elevate' && (
          <div>
            {/* Weapon */}
            <div style={{ marginBottom: 24 }}>
              <span style={label9()}>Weapon</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['auto','story','quote','analogy'].map(w => (
                  <button key={w} className="bv-pill" onClick={() => setMode(w)} style={pill(mode === w, P.gold)}>{w}</button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div style={{ marginBottom: 24 }}>
              <span style={label9()}>Tone</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tones.map(t => (
                  <button key={t.key} className="bv-pill" onClick={() => setTone(t.key)} style={pill(tone === t.key, P.gold)}>{t.label}</button>
                ))}
              </div>
            </div>

            {/* Intensity */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ ...label9(), marginBottom: 0 }}>Intensity</span>
                <span style={{ fontSize: 11, fontStyle: 'italic', color: P.inkMute }}>{intensityLevels[intensity].label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setIntensity(n)} style={{
                    width: 40, height: 6, border: 'none', borderRadius: 1, cursor: 'pointer', padding: 0, transition: 'all 0.2s',
                    background: n <= intensity ? P.gold : P.border,
                    transform: n === intensity ? 'scaleY(1.7)' : 'scaleY(1)',
                  }} />
                ))}
              </div>
            </div>

            {/* Era */}
            <div style={{ marginBottom: 28 }}>
              <span style={label9()}>Draw from</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {eras.map(e => (
                  <button key={e.key} className="bv-pill" onClick={() => setEra(e.key)} style={pill(era === e.key, '#4a6055')}>{e.label}</button>
                ))}
              </div>
            </div>

            {/* Your words */}
            <div style={{ marginBottom: 20 }}>
              <span style={label9()}>Your words</span>
              <textarea className="bv-ta" value={input} onChange={e => setInput(e.target.value)}
                placeholder="Write what you need to say. A letter. A confrontation. A speech. A threat. A love note. Anything."
                style={ta(180)} />
            </div>

            {/* Context */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ ...label9(), marginBottom: 0 }}>What I&rsquo;m trying to do</span>
                <span style={{ fontSize: 10, fontStyle: 'italic', color: P.rule }}>optional</span>
              </div>
              <textarea className="bv-ta" value={context} onChange={e => setContext(e.target.value)} rows={2}
                placeholder="e.g. Convince my business partner to stay. End a friendship without burning it."
                style={{ ...ta(60), resize: 'none', fontStyle: 'italic', color: P.inkMute }} />
            </div>

            <button onClick={elevate} disabled={loading || !input.trim()} style={actionBtn(loading || !input.trim())}>
              {loading ? 'Searching the ages…' : 'Elevate'}
            </button>

            {loading && <LoadingQuote />}
            {error && <p style={{ color: P.red, fontStyle: 'italic', fontSize: 14, marginTop: 16 }}>{error}</p>}

            {result && (
              <div style={{ marginTop: 40, animation: 'bvFadeUp 0.5s ease' }}>
                {/* divider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
                  <div style={{ flex: 1, height: 1, background: P.border }} />
                  <span style={{ fontSize: 9, letterSpacing: '5px', textTransform: 'uppercase', color: tc.accent }}>{tc.badge}</span>
                  <div style={{ flex: 1, height: 1, background: P.border }} />
                </div>

                {/* Rewrite */}
                <div style={{ borderLeft: `3px solid ${tc.border}`, padding: '22px 24px', background: '#fffdf8', marginBottom: 20 }}>
                  <span style={{ ...label9(P.inkMute), marginBottom: 14 }}>The Rewrite</span>
                  <p style={{ fontSize: 17, lineHeight: 1.85, color: P.ink, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {displayedText}
                    {isTyping && <span style={{ display: 'inline-block', width: 2, height: '1em', background: P.gold, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'bvBlink 0.75s step-end infinite' }} />}
                  </p>
                </div>

                {/* Action row */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
                  <button style={copyBtn(copied)} onClick={() => { copyToClipboard(result.rewritten); setCopied(true); setTimeout(() => setCopied(false), 2200); }}>
                    {copied ? '✓ Copied' : '⎘ Copy rewrite'}
                  </button>
                  <button style={pill(false, P.gold)} onClick={() => { setResult(null); elevate(); }}>Run again</button>
                </div>

                {/* Passage */}
                {result.the_passage && (
                  <div style={{ textAlign: 'center', padding: '20px 20px 28px', marginBottom: 28, borderBottom: `1px solid ${P.border}` }}>
                    <span style={{ ...label9(P.rule), display: 'block', marginBottom: 12 }}>
                      {result.weapon_type === 'story' ? 'The Story' : result.weapon_type === 'analogy' ? 'The Analogy' : 'The Line'}
                    </span>
                    <blockquote style={{ fontSize: 18, fontStyle: 'italic', color: tc.accent, margin: '0 0 8px', lineHeight: 1.65 }}>
                      &ldquo;{result.the_passage}&rdquo;
                    </blockquote>
                    <p style={{ fontSize: 12, color: P.inkMute, margin: 0 }}>— {result.weapon_title}</p>
                  </div>
                )}

                {/* Archive toggle */}
                <button onClick={() => setRevealed(r => !r)} style={{ ...pill(revealed, P.accent), display: 'block', margin: '0 auto 24px' }}>
                  {revealed ? 'Close archive' : 'Open archive'}
                </button>

                {revealed && (
                  <div style={{ animation: 'bvFadeUp 0.35s ease' }}>
                    {[
                      { label: 'Source', value: result.weapon_title, hero: true },
                      { label: 'What it is', value: result.source_context },
                      { label: 'Why it fits', value: result.why_it_fits },
                      { label: 'Verify it yourself', value: result.verification, mono: true },
                    ].map((item, i) => (
                      <div key={i} style={{ marginBottom: 22 }}>
                        <span style={{ ...label9(item.hero ? tc.accent : P.inkMute), marginBottom: 6 }}>{item.label}</span>
                        <p style={{ fontSize: item.hero ? 18 : item.mono ? 13 : 15, color: item.hero ? P.ink : item.mono ? '#4a6055' : P.inkDim, margin: 0, lineHeight: 1.7, fontStyle: item.hero ? 'italic' : 'normal', fontFamily: item.mono ? 'monospace' : P.ff }}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── COMPOSE ── */}
        {appMode === 'compose' && (
          <div>
            {scribePhase === 'idle' && (
              <div style={{ textAlign: 'center', paddingTop: 20 }}>
                <p style={{ fontSize: 16, fontStyle: 'italic', color: P.inkDim, lineHeight: 1.8, marginBottom: 32, maxWidth: 520, margin: '0 auto 32px' }}>
                  The Scribe will interview you — one question at a time — until it has everything needed to compose your piece.
                </p>
                <button onClick={scribeStart} style={actionBtn(false)}>Begin the interview</button>
                {scribeError && <p style={{ color: P.red, fontStyle: 'italic', marginTop: 16 }}>{scribeError}</p>}
              </div>
            )}

            {scribePhase === 'interviewing' && (
              <div>
                <div style={{ minHeight: 200, marginBottom: 24 }}>
                  {scribeMessages.map((msg, i) => (
                    <div key={i} style={{ marginBottom: 20, animation: 'bvFadeUp 0.3s ease' }}>
                      <span style={{ ...label9(msg.role === 'scribe' ? P.gold : P.inkMute), marginBottom: 6 }}>
                        {msg.role === 'scribe' ? 'The Scribe' : 'You'}
                      </span>
                      <p style={{ fontSize: 15, color: msg.role === 'scribe' ? P.ink : P.inkDim, lineHeight: 1.8, margin: 0, fontStyle: msg.role === 'scribe' ? 'normal' : 'italic', borderLeft: msg.role === 'scribe' ? `3px solid ${P.gold}` : `3px solid ${P.border}`, paddingLeft: 16 }}>
                        {msg.text}
                      </p>
                    </div>
                  ))}
                  {scribeLoading && <LoadingQuote />}
                  <div ref={scribeBottomRef} />
                </div>

                {!scribeLoading && scribeMessages.length > 0 && (
                  <div>
                    <textarea ref={scribeInputRef} className="bv-ta" value={scribeInput} onChange={e => setScribeInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); scribeReply(); } }}
                      placeholder="Your answer…" rows={3} style={{ ...ta(80), resize: 'none' }} />
                    <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                      <button onClick={scribeReply} disabled={!scribeInput.trim()} style={actionBtn(!scribeInput.trim())}>
                        {scribeMessages.at(-1)?.text.includes('I have what I need') ? 'Compose the piece' : 'Send'}
                      </button>
                    </div>
                    {scribeError && <p style={{ color: P.red, fontStyle: 'italic', marginTop: 12 }}>{scribeError}</p>}
                  </div>
                )}
              </div>
            )}

            {scribePhase === 'done' && scribeResult && (
              <div style={{ animation: 'bvFadeUp 0.5s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
                  <div style={{ flex: 1, height: 1, background: P.border }} />
                  <span style={{ fontSize: 9, letterSpacing: '5px', textTransform: 'uppercase', color: P.accent }}>The Piece</span>
                  <div style={{ flex: 1, height: 1, background: P.border }} />
                </div>

                <div style={{ borderLeft: `3px solid ${P.accent}`, padding: '22px 24px', background: '#fffdf8', marginBottom: 20 }}>
                  <p style={{ fontSize: 16, lineHeight: 2, color: P.ink, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {scribeDisplayed}
                    {scribeTyping && <span style={{ display: 'inline-block', width: 2, height: '1em', background: P.gold, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'bvBlink 0.75s step-end infinite' }} />}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
                  <button style={copyBtn(scribeCopied)} onClick={() => { copyToClipboard(scribeResult.body); setScribeCopied(true); setTimeout(() => setScribeCopied(false), 2200); }}>
                    {scribeCopied ? '✓ Copied' : '⎘ Copy piece'}
                  </button>
                  <button style={pill(false, P.gold)} onClick={() => { setScribePhase('idle'); setScribeMessages([]); setScribeResult(null); }}>
                    Start again
                  </button>
                </div>

                {scribeResult.archive && (
                  <div style={{ marginTop: 8 }}>
                    {[
                      { label: 'The Reference', value: scribeResult.archive.weapon_title, hero: true },
                      { label: 'What it is', value: scribeResult.archive.source_context },
                      { label: 'Why it fits', value: scribeResult.archive.why_it_fits },
                      { label: 'Verify', value: scribeResult.archive.verification, mono: true },
                    ].map((item, i) => (
                      <div key={i} style={{ marginBottom: 20 }}>
                        <span style={{ ...label9(item.hero ? P.accent : P.inkMute), marginBottom: 6 }}>{item.label}</span>
                        <p style={{ fontSize: item.hero ? 17 : item.mono ? 13 : 14, color: item.hero ? P.ink : item.mono ? '#4a6055' : P.inkDim, margin: 0, lineHeight: 1.7, fontStyle: item.hero ? 'italic' : 'normal', fontFamily: item.mono ? 'monospace' : P.ff }}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── NAME IT ── */}
        {appMode === 'nameit' && (
          <div>
            <p style={{ fontSize: 14, fontStyle: 'italic', color: P.inkMute, marginBottom: 24, lineHeight: 1.7 }}>
              Describe your situation plainly. Receive three framings — each from a different source — that name it with devastating precision.
            </p>
            <div style={{ marginBottom: 20 }}>
              <span style={label9()}>Describe the situation</span>
              <textarea className="bv-ta" value={nameItInput} onChange={e => setNameItInput(e.target.value)}
                placeholder="e.g. I built something, my partner took credit, and everyone believed them."
                style={ta(120)} />
            </div>
            <button onClick={runNameIt} disabled={nameItLoading || !nameItInput.trim()} style={actionBtn(nameItLoading || !nameItInput.trim())}>
              {nameItLoading ? 'Searching…' : 'Name it'}
            </button>
            {nameItLoading && <LoadingQuote />}
            {nameItError && <p style={{ color: P.red, fontStyle: 'italic', marginTop: 16 }}>{nameItError}</p>}

            {nameItResult?.lines && (
              <div style={{ marginTop: 36, animation: 'bvFadeUp 0.45s ease' }}>
                {nameItResult.lines.map((line: any, i: number) => {
                  const catColors: Record<string, string> = { history: P.gold, 'myth or scripture': P.accent, 'literature or philosophy': '#4a6055' };
                  const cc = catColors[line.category] || P.gold;
                  const open = nameItExpanded === i;
                  return (
                    <div key={i} style={{ marginBottom: 20, border: `1px solid ${open ? P.rule : P.border}`, borderRadius: 2, overflow: 'hidden', transition: 'all 0.25s' }}>
                      <div style={{ padding: '18px 20px', cursor: 'pointer', background: open ? P.surface : P.bg }} onClick={() => setNameItExpanded(open ? null : i)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <p style={{ fontSize: 16, fontStyle: 'italic', color: P.ink, margin: 0, lineHeight: 1.6, flex: 1 }}>&ldquo;{line.line}&rdquo;</p>
                          <span style={{ fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: cc, flexShrink: 0, marginTop: 2 }}>{line.category}</span>
                        </div>
                        <p style={{ fontSize: 11, color: P.inkMute, margin: '8px 0 0', letterSpacing: '0.5px' }}>{line.source_name}</p>
                      </div>
                      {open && (
                        <div style={{ padding: '0 20px 20px', background: P.surface, animation: 'bvFadeUp 0.25s ease' }}>
                          <div style={{ borderTop: `1px solid ${P.border}`, paddingTop: 16, marginBottom: 12 }}>
                            <span style={{ ...label9(P.inkMute), marginBottom: 6 }}>Why it cuts</span>
                            <p style={{ fontSize: 14, color: P.inkDim, margin: 0, lineHeight: 1.7 }}>{line.why_it_cuts}</p>
                          </div>
                          <div style={{ marginBottom: 12 }}>
                            <span style={{ ...label9(P.inkMute), marginBottom: 6 }}>Verify</span>
                            <p style={{ fontSize: 12, color: '#4a6055', margin: 0, fontFamily: 'monospace' }}>{line.verification}</p>
                          </div>
                          <button style={copyBtn(nameItCopied === i)} onClick={() => { copyToClipboard(line.line); setNameItCopied(i); setTimeout(() => setNameItCopied(null), 2200); }}>
                            {nameItCopied === i ? '✓ Copied' : '⎘ Copy line'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── DISSECT ── */}
        {appMode === 'dissect' && (
          <div>
            <p style={{ fontSize: 14, fontStyle: 'italic', color: P.inkMute, marginBottom: 24, lineHeight: 1.7 }}>
              Paste any rhetoric — email, speech, letter, argument. Receive a complete reverse-engineering: the weapon, the move, the weak point, and the counter.
            </p>
            <div style={{ marginBottom: 20 }}>
              <span style={label9()}>Paste the rhetoric</span>
              <textarea className="bv-ta" value={dissectInput} onChange={e => setDissectInput(e.target.value)}
                placeholder="Paste any piece of writing here…" style={ta(200)} />
            </div>
            <button onClick={runDissect} disabled={dissectLoading || !dissectInput.trim()} style={actionBtn(dissectLoading || !dissectInput.trim())}>
              {dissectLoading ? 'Dissecting…' : 'Dissect'}
            </button>
            {dissectLoading && <LoadingQuote />}
            {dissectError && <p style={{ color: P.red, fontStyle: 'italic', marginTop: 16 }}>{dissectError}</p>}

            {dissectResult && (
              <div style={{ marginTop: 36, animation: 'bvFadeUp 0.45s ease' }}>
                {[
                  { key: 'weapon', label: 'Weapon Identified', value: dissectResult.weapon_identified },
                  { key: 'move',   label: 'Strategic Move',    value: dissectResult.strategic_move },
                  { key: 'phrase', label: 'Power Phrase',      value: dissectResult.power_phrase, sub: dissectResult.power_phrase_analysis },
                  { key: 'seam',   label: 'The Seam',          value: dissectResult.the_seam },
                ].map(item => {
                  const open = dissectSection === item.key;
                  return (
                    <div key={item.key} style={{ marginBottom: 12, border: `1px solid ${open ? P.rule : P.border}`, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ padding: '14px 18px', cursor: 'pointer', background: open ? P.surface : P.bg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setDissectSection(open ? null : item.key)}>
                        <span style={{ fontSize: 9, letterSpacing: '4px', textTransform: 'uppercase', color: P.inkMute }}>{item.label}</span>
                        <span style={{ color: P.rule, fontSize: 12 }}>{open ? '−' : '+'}</span>
                      </div>
                      {open && (
                        <div style={{ padding: '0 18px 18px', background: P.surface, animation: 'bvFadeUp 0.2s ease' }}>
                          <p style={{ fontSize: 15, color: P.ink, margin: '0 0 8px', lineHeight: 1.7, fontStyle: item.key === 'phrase' ? 'italic' : 'normal' }}>{item.value}</p>
                          {item.sub && <p style={{ fontSize: 13, color: P.inkMute, margin: 0, lineHeight: 1.6 }}>{item.sub}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Counter */}
                {dissectResult.the_counter && (() => {
                  const c = dissectResult.the_counter;
                  const open = dissectSection === 'counter';
                  return (
                    <div style={{ marginTop: 24, border: `2px solid ${P.accent}`, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ padding: '14px 18px', cursor: 'pointer', background: open ? P.surface : P.bg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setDissectSection(open ? null : 'counter')}>
                        <span style={{ fontSize: 9, letterSpacing: '4px', textTransform: 'uppercase', color: P.accent }}>The Counter</span>
                        <span style={{ color: P.accent, fontSize: 12 }}>{open ? '−' : '+'}</span>
                      </div>
                      {open && (
                        <div style={{ padding: '0 18px 20px', background: P.surface, animation: 'bvFadeUp 0.2s ease' }}>
                          <div style={{ marginBottom: 14 }}>
                            <span style={{ ...label9(P.accent), marginBottom: 6 }}>The Move</span>
                            <p style={{ fontSize: 15, color: P.ink, margin: 0, lineHeight: 1.7 }}>{c.move}</p>
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <span style={{ ...label9(P.inkMute), marginBottom: 6 }}>The Line — {c.weapon_title}</span>
                            <p style={{ fontSize: 15, fontStyle: 'italic', color: P.accent, margin: 0, lineHeight: 1.7 }}>{c.the_line}</p>
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <span style={{ ...label9(P.inkMute), marginBottom: 6 }}>What it is</span>
                            <p style={{ fontSize: 14, color: P.inkDim, margin: 0, lineHeight: 1.6 }}>{c.source_context}</p>
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <span style={{ ...label9(P.inkMute), marginBottom: 6 }}>Why it neutralises</span>
                            <p style={{ fontSize: 14, color: P.inkDim, margin: 0, lineHeight: 1.6 }}>{c.why_it_neutralizes}</p>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button style={copyBtn(dissectCopied)} onClick={() => { copyToClipboard(c.the_line); setDissectCopied(true); setTimeout(() => setDissectCopied(false), 2200); }}>
                              {dissectCopied ? '✓ Copied' : '⎘ Copy counter'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* ── REPLY ── */}
        {appMode === 'reply' && (
          <div>
            <p style={{ fontSize: 14, fontStyle: 'italic', color: P.inkMute, marginBottom: 24, lineHeight: 1.7 }}>
              Paste what was sent to you — challenge, threat, manipulation, ultimatum, slight. Receive a reply that resets the terms of the exchange entirely.
            </p>
            <div style={{ marginBottom: 20 }}>
              <span style={label9()}>The message you received</span>
              <textarea className="bv-ta" value={replyInput} onChange={e => setReplyInput(e.target.value)}
                placeholder="Paste the message here…" style={ta(160)} />
            </div>
            <button onClick={runReply} disabled={replyLoading || !replyInput.trim()} style={actionBtn(replyLoading || !replyInput.trim())}>
              {replyLoading ? 'Forging the reply…' : 'Craft the reply'}
            </button>
            {replyLoading && <LoadingQuote />}
            {replyError && <p style={{ color: P.red, fontStyle: 'italic', marginTop: 16 }}>{replyError}</p>}

            {replyResult && (
              <div style={{ marginTop: 36, animation: 'bvFadeUp 0.45s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <div style={{ flex: 1, height: 1, background: P.border }} />
                  <span style={{ fontSize: 9, letterSpacing: '5px', textTransform: 'uppercase', color: '#5c6e38' }}>The Reply</span>
                  <div style={{ flex: 1, height: 1, background: P.border }} />
                </div>

                <div style={{ borderLeft: `3px solid #5c6e38`, padding: '22px 24px', background: '#fffdf8', marginBottom: 20 }}>
                  <p style={{ fontSize: 16, lineHeight: 1.9, color: P.ink, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {replyDisplayed}
                    {replyTyping && <span style={{ display: 'inline-block', width: 2, height: '1em', background: P.gold, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'bvBlink 0.75s step-end infinite' }} />}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
                  <button style={copyBtn(replyCopied)} onClick={() => { copyToClipboard(replyResult.reply); setReplyCopied(true); setTimeout(() => setReplyCopied(false), 2200); }}>
                    {replyCopied ? '✓ Copied' : '⎘ Copy reply'}
                  </button>
                  <button style={pill(false, P.gold)} onClick={() => { setReplyResult(null); setReplyInput(''); }}>Start over</button>
                </div>

                <button onClick={() => setReplyRevealed(r => !r)} style={{ ...pill(replyRevealed, P.accent), display: 'block', margin: '0 auto 24px' }}>
                  {replyRevealed ? 'Close archive' : 'Open archive'}
                </button>

                {replyRevealed && (
                  <div style={{ animation: 'bvFadeUp 0.35s ease' }}>
                    {[
                      { label: 'Weapon Deployed', value: replyResult.weapon_title, hero: true },
                      { label: 'What it is', value: replyResult.source_context },
                      { label: 'The reframe', value: replyResult.the_reframe },
                      { label: 'Why it ends it', value: replyResult.why_it_ends_it },
                      { label: 'Verify', value: replyResult.verification, mono: true },
                    ].map((item, i) => (
                      <div key={i} style={{ marginBottom: 20 }}>
                        <span style={{ ...label9(item.hero ? '#5c6e38' : P.inkMute), marginBottom: 6 }}>{item.label}</span>
                        <p style={{ fontSize: item.hero ? 17 : item.mono ? 13 : 14, color: item.hero ? P.ink : item.mono ? '#4a6055' : P.inkDim, margin: 0, lineHeight: 1.7, fontStyle: item.hero ? 'italic' : 'normal', fontFamily: item.mono ? 'monospace' : P.ff }}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Footer rule */}
      <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 9, letterSpacing: '4px', color: P.rule, textTransform: 'uppercase', padding: '18px 0 24px', borderTop: `1px solid ${P.border}`, flexShrink: 0 }}>
        Only real. Only verifiable. Only unforgettable.
      </div>
      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${P.rule}, ${P.gold}, ${P.rule}, transparent)`, flexShrink: 0 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOMEPAGE CARD  (the thing you drop onto the AFS HomePage)
// ─────────────────────────────────────────────────────────────────────────────
export function BillionsVoiceWidget() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <>
      {/* ── The Card ── */}
      <div
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          cursor: 'pointer',
          background: hovered ? '#f0e8d4' : '#f5f0e8',
          border: `1px solid ${hovered ? '#a07820' : '#c8b99a'}`,
          borderTop: `3px solid ${hovered ? '#a07820' : '#8b6914'}`,
          borderRadius: 7,
          padding: '16px 18px',
          fontFamily: "'Times New Roman', Georgia, serif",
          transition: 'all 0.2s',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          userSelect: 'none',
        }}
      >
        {/* Top row: glyph + name + badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, color: '#8b6914', flexShrink: 0, lineHeight: 1, marginTop: 1 }}>
            ✦
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 13, color: '#1c1610', fontFamily: "'Times New Roman', Georgia, serif", fontWeight: 600, lineHeight: 1.3, margin: 0 }}>
                The Rhoades Method
              </p>
              <span style={{
                fontSize: 7, color: '#8b6914',
                fontFamily: "'Times New Roman', Georgia, serif",
                letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
                border: '1px solid #c8b99a', padding: '1px 5px', borderRadius: 2,
              }}>
                Rhetoric
              </span>
            </div>
            <div style={{ fontSize: 8, color: '#7a6a55', fontFamily: "'Times New Roman', Georgia, serif", letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2, fontWeight: 600 }}>
              Historical Rhetorical Engine
            </div>
          </div>
        </div>

        {/* Description */}
        <p style={{ fontSize: 11, color: '#4a3f2f', fontFamily: "'Times New Roman', Georgia, serif", lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
          Elevate · Compose · Name It · Dissect · Reply — armed with verified history, myth, and literature.
        </p>
      </div>

      {/* ── The Modal ── */}
      {open && <BillionsVoiceModal onClose={() => setOpen(false)} />}
    </>
  );
}

export default BillionsVoiceWidget;
