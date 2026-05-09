/**
 * Plain-text chunker for training documents.
 *
 * Goal: produce ~600-character windows with ~100 characters of
 * overlap, snapping to paragraph then sentence boundaries so we
 * don't slice through the middle of a clause. Overlap means a fact
 * that straddles two windows is retrievable from at least one.
 *
 * We do NOT do anything fancy (no token counting, no embedding-aware
 * splitter). At MLP corpus sizes (a handful of SOPs per plan) the
 * extra complexity isn't worth it — paragraph-aware sliding window
 * is solid baseline RAG behavior.
 */

export interface ChunkerOptions {
  targetSize?: number;
  overlap?: number;
}

export interface ChunkResult {
  ord: number;
  content: string;
  charCount: number;
  /// Approximate page hint when `pageCount` is provided. Computed
  /// from chunk-position-over-total-length × pageCount; off by a
  /// page or so but useful for "see page 4 of the SOP" framing.
  pageHint: number | null;
}

const DEFAULT_TARGET = 600;
const DEFAULT_OVERLAP = 100;

/**
 * Split `text` into ordered chunks of roughly `targetSize` chars.
 *
 * Algorithm:
 *   1. Normalize whitespace.
 *   2. Walk segments split on paragraph breaks (\n\n+).
 *   3. Build a current window by concatenating segments until we'd
 *      exceed `targetSize`.
 *   4. When a single segment is itself larger than the target, fall
 *      back to a sentence-boundary split, then a hard char split as
 *      a last resort.
 *   5. Once a window is emitted, seed the next window with the last
 *      `overlap` characters of the previous window.
 */
export function chunkText(
  raw: string,
  pageCount: number | null,
  options: ChunkerOptions = {},
): ChunkResult[] {
  const targetSize = options.targetSize ?? DEFAULT_TARGET;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const text = normalize(raw);
  if (text.length === 0) return [];

  const segments = splitParagraphs(text);
  const windows: string[] = [];
  let current = "";

  for (const seg of segments) {
    if (seg.length === 0) continue;

    // A single mega-paragraph blew the budget on its own. Sub-split
    // it into sentence pieces and feed those through the same loop.
    if (seg.length > targetSize) {
      // Flush whatever is buffered first so we don't merge a tail
      // sentence into the giant paragraph's first window.
      if (current.length > 0) {
        windows.push(current);
        current = tailOverlap(current, overlap);
      }
      const sub = splitForLargeSegment(seg, targetSize);
      for (const piece of sub) {
        if (current.length + piece.length + 1 > targetSize && current.length > 0) {
          windows.push(current);
          current = tailOverlap(current, overlap);
        }
        current = current.length === 0 ? piece : `${current}\n${piece}`;
      }
      continue;
    }

    if (current.length + seg.length + 2 > targetSize && current.length > 0) {
      windows.push(current);
      current = tailOverlap(current, overlap);
    }
    current = current.length === 0 ? seg : `${current}\n\n${seg}`;
  }
  if (current.length > 0) windows.push(current);

  const totalLen = text.length;
  let cursor = 0;
  return windows.map((w, i) => {
    // Position of this window's first char in the source text. The
    // sliding-window with overlap means we can approximate this by
    // a running cursor that advances by (window length - overlap).
    const start = cursor;
    cursor = Math.min(totalLen, start + Math.max(1, w.length - overlap));
    const pageHint =
      pageCount && pageCount > 0 && totalLen > 0
        ? Math.min(pageCount, Math.max(1, Math.floor((start / totalLen) * pageCount) + 1))
        : null;
    return {
      ord: i,
      content: w.trim(),
      charCount: w.length,
      pageHint,
    };
  });
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Collapse runs of 3+ blank lines to two so paragraph splitting
    // doesn't over-fragment poorly-formatted text dumps.
    .replace(/\n{3,}/g, "\n\n")
    // Strip stray whitespace at line ends.
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((s) => s.trim());
}

function splitForLargeSegment(seg: string, targetSize: number): string[] {
  // Sentence-ish split — keep the period attached to the preceding
  // sentence so the chunk reads naturally.
  const sentences = seg.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()) ?? [seg];
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= targetSize) {
      out.push(s);
      continue;
    }
    // Hard char split as a last resort. Splits at whitespace inside
    // a window so we don't sever tokens.
    let i = 0;
    while (i < s.length) {
      const slice = s.slice(i, i + targetSize);
      const lastSpace = slice.lastIndexOf(" ");
      const cut = lastSpace > targetSize * 0.6 ? lastSpace : slice.length;
      out.push(slice.slice(0, cut).trim());
      i += cut;
    }
  }
  return out.filter((s) => s.length > 0);
}

function tailOverlap(window: string, overlap: number): string {
  if (overlap <= 0 || window.length <= overlap) return "";
  return window.slice(window.length - overlap).trimStart();
}
