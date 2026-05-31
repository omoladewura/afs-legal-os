/**
 * AFS Advocates — Utility Functions
 * Pure functions shared across components and engines.
 */

// ── Text rendering ────────────────────────────────────────────────────────────

/**
 * Splits AI-generated text into plain text and [RESEARCH] card segments.
 * Used by every engine that renders AI output.
 */
export interface TextSegment   { type: 'text';     content:   string }
export interface ResearchSegment { type: 'research'; principle: string; authority: string; platform: string }
export type Segment = TextSegment | ResearchSegment;

export function parseSegments(text: string): Segment[] {
  if (!text) return [];

  const segments: Segment[] = [];
  const re = /\[RESEARCH\]([\s\S]*?)\[\/RESEARCH\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      if (chunk.trim()) segments.push({ type: 'text', content: chunk });
    }

    const inner = match[1].trim();
    const principleMatch = inner.match(/^Principle:\s*(.+?)(?:\n|$)/m);
    const authorityMatch  = inner.match(/^Authority needed:\s*(.+?)(?:\n|$)/m);
    const platformMatch   = inner.match(/^Platform:\s*(.+?)(?:\n|$)/m);

    segments.push({
      type:      'research',
      principle: principleMatch ? principleMatch[1].trim() : inner,
      authority: authorityMatch ? authorityMatch[1].trim() : '',
      platform:  platformMatch  ? platformMatch[1].trim()  : '',
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex);
    if (tail.trim()) segments.push({ type: 'text', content: tail });
  }

  return segments.length ? segments : [{ type: 'text', content: text }];
}

// ── ID generation ─────────────────────────────────────────────────────────────

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function cid(): string {
  return 'c_' + uid();
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/** Format a date string (YYYY-MM-DD) to '14 Jan 2025' */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** Days between now and a YYYY-MM-DD date string */
export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now    = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Case context builder ──────────────────────────────────────────────────────

import type { Case } from '@/types';

/**
 * Builds a structured text context block from a case object.
 * Used as a prefix for AI prompts to provide case awareness.
 */
export function buildCaseContext(activeCase: Case | null): string {
  if (!activeCase) return '';

  const intel = activeCase.intelligence_data || ({} as Record<string, string>);
  const parts: string[] = [];

  if (activeCase.caseName)    parts.push('Case: '           + activeCase.caseName);
  if (activeCase.court)       parts.push('Court: '          + activeCase.court);
  if (activeCase.suitNo)      parts.push('Suit No: '        + activeCase.suitNo);
  if (activeCase.role)        parts.push('Our Role: '       + activeCase.role);
  if (activeCase.dateCommenced) parts.push('Date Commenced: ' + activeCase.dateCommenced);

  const claimants  = (activeCase.claimants  || []).map(p => p.name).filter(Boolean);
  const defendants = (activeCase.defendants || []).map(p => p.name).filter(Boolean);
  if (claimants.length)  parts.push('Claimant(s): '  + claimants.join(', '));
  if (defendants.length) parts.push('Defendant(s): ' + defendants.join(', '));

  if (intel.facts)         parts.push('\nKey Facts:\n'        + intel.facts);
  if (intel.legal_issues)  parts.push('\nLegal Issues:\n'     + intel.legal_issues);
  if (intel.disputes)      parts.push('\nKey Disputes:\n'     + intel.disputes);
  if (intel.risks)         parts.push('\nRisks Identified:\n' + intel.risks);

  return parts.join('\n');
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

// ── File handling ─────────────────────────────────────────────────────────────

/** Reads a File object to a base64 data URL string */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve((e.target?.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

/** Reads a File to a full data URL (includes mime prefix) */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}
