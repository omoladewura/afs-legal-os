// ── REPLACE these 4 functions in IntelligenceEngine.tsx ──────────────────────
// Find each function by name and replace it entirely.
// Nothing else in the file needs to change.

  // ── Step 1 → 2: Extract intelligence ──────────────────────────────────────
  async function runExtraction() {
    if (rawFacts.trim().length < 50) {
      setError('Please provide a fuller account of the facts (at least 50 characters).');
      return;
    }
    setLoading(true); setError('');
    try {
      const raw = await callClaude({
        system: `You are a trial intelligence extraction engine for Nigerian litigation.
Extract structured intelligence from the raw case facts provided by the user.
Role-aware: the lawyer acts for the ${role}.
Case context: ${caseCtx}

Output ONLY valid JSON — no markdown fences, no preamble, no explanation. Exactly this structure:
{
  "timeline": [{"date":"...","event":"...","significance":"..."}],
  "established_facts": ["..."],
  "disputed_areas": ["..."],
  "legal_issues": ["..."],
  "evidence_mentioned": ["..."],
  "gaps_identified": ["..."],
  "initial_risks": [{"risk":"...","severity":"HIGH|MEDIUM|LOW"}]
}

Rules:
- Every string value must be properly escaped. Never use unescaped double quotes inside string values.
- Use single quotes or rephrase if quoting speech — never raw double quotes inside JSON strings.
- Output ONLY the JSON object. Nothing before it, nothing after it.`,
        userMsg: `RAW FACTS / CLIENT NARRATION:\n\n${rawFacts}`,
        maxTokens: 4000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let ext: ExtractionResult;
      try {
        ext = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        ext = JSON.parse(repaired);
      }

      setExtraction(ext);
      advance(2, { extraction: ext, rawFacts });
    } catch (e) {
      setError('Extraction failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 2 → 3: Generate follow-up questions ──────────────────────────────
  async function generateFollowUp() {
    setLoading(true); setError('');
    try {
      const raw = await callClaude({
        system: `You are a trial intelligence engine for Nigerian litigation. Generate precise gap-filling follow-up questions. Role: ${role}. Output ONLY valid JSON — no markdown, no preamble. Exactly this structure: {"questions":[{"id":"q1","question":"...","purpose":"..."}]}`,
        userMsg: `${caseCtx}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nGenerate 6 targeted follow-up questions addressing the most critical gaps.`,
        maxTokens: 2000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: { questions: TIEData['followUpQs'] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const qs: TIEData['followUpQs'] = parsed.questions || [];
      const initAs: Record<string, string> = {};
      qs.forEach(q => { initAs[q.id] = ''; });
      setFollowUpQs(qs); setFollowUpAs(initAs);
      advance(3, { followUpQs: qs, followUpAs: initAs });
    } catch (e) {
      setError('Question generation failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 3 → 4: Build evidence matrix ─────────────────────────────────────
  async function buildEvidenceMatrix() {
    const answered = followUpQs.filter(q => followUpAs[q.id]?.trim()).length;
    if (answered < Math.min(3, followUpQs.length)) {
      setError('Please answer at least 3 questions before proceeding.');
      return;
    }
    setLoading(true); setError('');
    const qaText = followUpQs
      .map(q => `Q: ${q.question}\nA: ${followUpAs[q.id] || '(Not answered)'}`)
      .join('\n\n');
    try {
      const raw = await callClaude({
        system: `You are a trial evidence strategist for Nigerian litigation. Map required evidence to facts and legal issues. Role of client: ${role}. Output ONLY valid JSON — no markdown, no preamble. Exactly this structure: {"evidence_map":[{"issue":"...","evidence_needed":["..."],"evidence_available":["..."],"evidence_missing":["..."],"priority":"CRITICAL|HIGH|MEDIUM|LOW","notes":"..."}]}`,
        userMsg: `${caseCtx}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nFOLLOW-UP ANSWERS:\n${qaText}\n\nBuild the evidence matrix.`,
        maxTokens: 3000,
        skipLibrary: true,
      });

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON object found in response. Please try again.');
      cleaned = cleaned.slice(start, end + 1);

      let parsed: { evidence_map: EvidenceMapItem[] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const repaired = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(repaired);
      }

      const em: EvidenceMapItem[] = parsed.evidence_map || [];
      setEvidenceM(em);
      advance(4, { evidenceM: em });
    } catch (e) {
      setError('Evidence mapping failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }

  // ── Step 4 → 5: Generate Intelligence Package ─────────────────────────────
  async function generatePackage() {
    setLoading(true); setError('');
    const qaText = followUpQs
      .map(q => `Q: ${q.question}\nA: ${followUpAs[q.id] || '(Not answered)'}`)
      .join('\n\n');
    const claimsHead =
      role === 'Claimant'  ? 'CLAIMS & RELIEF' :
      role === 'Defendant' ? 'DEFENCE POSTURE & COUNTERCLAIMS' :
      'CLAIMS, DEFENCES & STRATEGY';
    try {
      const pkg = await callClaude({
        system: `You are a Senior Advocate at the Nigerian Bar with 30 years of trial experience. You produce trial intelligence packages of exceptional depth and precision. Role-aware, outcome-focused, and honest. Your analysis changes how lawyers approach cases.`,
        userMsg: `${caseCtx}\n\nRAW FACTS:\n${rawFacts}\n\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(extraction, null, 2)}\n\nFOLLOW-UP ANSWERS:\n${qaText}\n\nEVIDENCE MATRIX:\n${JSON.stringify(evidenceM, null, 2)}\n\nGenerate the full Trial Intelligence Package. Format as structured markdown:\n\n# ESTABLISHED FACTS\n[Undisputed facts with basis]\n\n# DISPUTED FACTS\n[Contested facts and likely nature of dispute]\n\n# MISSING EVIDENCE\n[Critical gaps — what must be obtained and how]\n\n# LEGAL ISSUES\n[Each issue distilled — element by element where applicable]\n\n# ${claimsHead}\n[Role-specific: causes of action / grounds of defence, elements, burden of proof, what must be proved]\n\n# RISK REGISTER\n[Every material risk — severity HIGH/MEDIUM/LOW, impact, mitigation]\n\n# IMMEDIATE ACTION ITEMS\n[Specific, time-sensitive steps the lawyer must take NOW]\n\nWrite with the precision of a Senior Advocate who has analysed every document and seen every angle. Be direct, specific, and unflinchingly honest.`,
        maxTokens: 4000,
        skipLibrary: true,
      });
      setIntPkg(pkg);
      advance(5, { intPkg: pkg });
    } catch (e) {
      setError('Package generation failed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setLoading(false); }
  }
