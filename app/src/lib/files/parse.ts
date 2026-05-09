/**
 * Plain-text extraction for leader-uploaded training docs.
 *
 * Per spec §"Step 1 / Training materials" we accept PDF, DOCX, and Markdown.
 * Embedding/RAG retrieval is deferred — for now we just persist the
 * extracted text on the TrainingDocument row so the agent layer can consume
 * it later without re-fetching the blob.
 */
import mammoth from "mammoth";

export interface ParsedFile {
  text: string;
  pageCount: number | null;
}

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MD_MIMES = new Set(["text/markdown", "text/x-markdown", "text/plain"]);

export function isSupportedMime(mime: string): boolean {
  return mime === PDF_MIME || mime === DOCX_MIME || MD_MIMES.has(mime);
}

export async function parseTrainingDoc(
  buffer: Buffer,
  mime: string,
): Promise<ParsedFile> {
  if (mime === PDF_MIME) {
    // pdf-parse v2 has a nested default export; the named export is unstable
    // across versions, so we go through default and grab .pdf at runtime.
    const mod = (await import("pdf-parse")) as unknown as {
      default: (buf: Buffer) => Promise<{ text: string; numpages: number }>;
    };
    const result = await mod.default(buffer);
    return { text: result.text.trim(), pageCount: result.numpages ?? null };
  }
  if (mime === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value.trim(), pageCount: null };
  }
  if (MD_MIMES.has(mime)) {
    return { text: buffer.toString("utf-8").trim(), pageCount: null };
  }
  throw new Error(`Unsupported file type: ${mime}`);
}
