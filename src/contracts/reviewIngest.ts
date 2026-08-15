/**
 * AFS Legal OS — Contract Engine — Review Mode — Full-Text Ingestion
 *
 * Roadmap ref: 3a + 3b (Contract Engine — Review Mode)
 *
 * 3a — PDF path. Reuses the existing extractor: `extractTextFromPDF()` in
 * workers/rag-worker/src/index.ts, the same regex-based text-layer
 * extractor the /ingest library pipeline already uses for R2 documents.
 * Wired to a new stateless Worker route (POST /contract/extract-pdf) — no
 * new extraction logic, no R2/D1 writes.
 *
 * 3b — docx path. New extractor — no prior code to reuse this time
 * (`extractTextFromDocx()` in the Worker, built from scratch: minimal ZIP
 * + WordprocessingML reader, no npm dependency). Wired to its own
 * stateless route (POST /contract/extract-docx), same contract as 3a.
 *
 * Output is full contract text only. What happens next — clause-count
 * verification (3c), knowledge-tier/flagging reuse (3d) — is deliberately
 * out of scope here.
 *
 * Exported as plain async functions — no React/hook dependency — same
 * convention as pass0.ts / clauseRegister.ts / knowledgeTier.ts /
 * researchChecklist.ts / flaggingPass.ts.
 */

import { WORKER_URL, AUTH_TOKEN, ApiError, classifyError } from '@/services/api';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentIngestResult {
  filename:   string;
  text:       string;
  char_count: number;
  ok:         boolean;
  /** Set only when ok is false. */
  error?:     string;
}

const MAX_BYTES = 25 * 1024 * 1024;   // matches the Worker's own limit — fail fast client-side

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UPLOAD HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function uploadForExtraction(
  file: File,
  route: string,
  contentType: string,
): Promise<DocumentIngestResult> {
  const blank = (error: string): DocumentIngestResult => ({
    filename: file?.name ?? '',
    text: '',
    char_count: 0,
    ok: false,
    error,
  });

  if (!file) {
    return blank('No file provided');
  }
  if (file.size === 0) {
    return blank('File is empty');
  }
  if (file.size > MAX_BYTES) {
    return blank('File too large — max 25 MB');
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    return blank(`Could not read file: ${(e as Error).message}`);
  }

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${route}`, {
      method:  'POST',
      headers: {
        'Content-Type':  contentType,
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: buffer,
    });
  } catch (e) {
    return blank(classifyError(e));
  }

  let data: { ok?: boolean; text?: string; char_count?: number; error?: string };
  try {
    data = await res.json();
  } catch {
    return blank(`HTTP ${res.status} — could not parse response`);
  }

  if (!res.ok || !data.ok) {
    return blank(data.error ?? classifyError(new ApiError(`HTTP ${res.status}`, res.status)));
  }

  return {
    filename:   file.name,
    text:       data.text ?? '',
    char_count: data.char_count ?? (data.text?.length ?? 0),
    ok:         true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3a — PDF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts full contract text from an uploaded PDF File. Never throws — a
 * bad file, a network failure, or an extraction failure (e.g. a scanned
 * PDF with no text layer) degrades to `ok: false` with a user-facing
 * `error` string, same convention as the rest of the Contract Engine.
 */
export async function ingestContractPdf(file: File): Promise<DocumentIngestResult> {
  const looksLikePdf = file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    return { filename: file?.name ?? '', text: '', char_count: 0, ok: false, error: 'Not a PDF file' };
  }
  return uploadForExtraction(file, '/contract/extract-pdf', 'application/pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b — DOCX
// ─────────────────────────────────────────────────────────────────────────────

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extracts full contract text from an uploaded .docx File. Never throws —
 * a bad file, a network failure, or an extraction failure (corrupted,
 * password-protected, or an unsupported internal format) degrades to
 * `ok: false` with a user-facing `error` string, same convention as the
 * rest of the Contract Engine.
 */
export async function ingestContractDocx(file: File): Promise<DocumentIngestResult> {
  const looksLikeDocx = file?.type === DOCX_MIME || file?.name?.toLowerCase().endsWith('.docx');
  if (!looksLikeDocx) {
    return { filename: file?.name ?? '', text: '', char_count: 0, ok: false, error: 'Not a .docx file' };
  }
  return uploadForExtraction(file, '/contract/extract-docx', DOCX_MIME);
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCHER — picks the right path by file type, for callers that accept either
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches to ingestContractPdf() or ingestContractDocx() based on the
 * file's extension/MIME type. Convenience for a single Review Mode upload
 * control that accepts both formats — no extraction logic of its own.
 */
export async function ingestContractDocument(file: File): Promise<DocumentIngestResult> {
  const name = file?.name?.toLowerCase() ?? '';
  if (file?.type === 'application/pdf' || name.endsWith('.pdf')) {
    return ingestContractPdf(file);
  }
  if (file?.type === DOCX_MIME || name.endsWith('.docx')) {
    return ingestContractDocx(file);
  }
  return {
    filename: file?.name ?? '',
    text: '',
    char_count: 0,
    ok: false,
    error: 'Unsupported file type — only PDF and .docx are supported for Review ingestion',
  };
}
