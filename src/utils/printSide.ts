/**
 * AFS Legal OS — printSide utility
 *
 * Extracted from TrialEngine.tsx so it can be consumed by:
 *   - TrialEngine.tsx          (witness pack / statement audit / theory print)
 *   - CrossExamPostSession.tsx (Phase 5B: cross-examination tree paper backup)
 *
 * MIGRATION: In TrialEngine.tsx, delete the local `printSide` function and
 * add:  import { printSide } from '@/utils/printSide';
 *
 * The function is intentionally side-effectful (opens a print window) and
 * has no return value — callers do not need to await anything.
 */

/**
 * Open a new browser tab containing formatted content and trigger the
 * system print dialog.
 *
 * @param caseName     Case name shown in the document header
 * @param designation  Witness name / section label shown in the header
 * @param sideLabel    Title of this particular document (e.g. "Side A — …")
 * @param content      Plain text body — rendered inside <pre> with pre-wrap
 * @param confidential When true, stamps "Confidential — Counsel Eyes Only"
 */
export function printSide(
  caseName:     string,
  designation:  string,
  sideLabel:    string,
  content:      string,
  confidential: boolean,
): void {
  const win = window.open('', '_blank');
  if (!win) return;

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  win.document.write(`<!DOCTYPE html><html><head>
    <title>${esc(sideLabel)} — ${esc(designation)}</title>
    <style>
      body{font-family:'Times New Roman',Times,serif;max-width:780px;margin:36px auto;
           line-height:1.85;color:#111;font-size:13px;}
      h1{font-size:17px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:6px;}
      .meta{font-size:11px;color:#555;margin-bottom:20px;}
      .conf{color:#8a1a1a;font-weight:700;letter-spacing:.12em;font-size:10px;
            border:2px solid #8a1a1a;padding:4px 12px;display:inline-block;margin-bottom:14px;
            text-transform:uppercase;}
      pre{white-space:pre-wrap;font-family:'Times New Roman',Times,serif;
          font-size:13px;line-height:1.85;margin:0;}
      @media print{body{margin:20mm;}}
    </style></head><body>
    ${confidential ? '<div class="conf">Confidential — Counsel Eyes Only — Not to be brought to Court</div>' : ''}
    <h1>${esc(sideLabel)}</h1>
    <div class="meta">${esc(caseName)} · ${esc(designation)}</div>
    <pre>${esc(content)}</pre>
    </body></html>`);

  win.document.close();
  win.print();
}
