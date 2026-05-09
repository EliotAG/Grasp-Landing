/**
 * Retrieval over a change plan's TrainingDocumentChunk corpus.
 *
 * Two paths, same return shape:
 *
 *   1. Semantic — when an embedder is configured AND chunks have
 *      stored embedding vectors. Embed the query, score by cosine.
 *
 *   2. Lexical fallback — token-overlap with idf weighting. Only
 *      used when there are no usable embeddings (no provider key,
 *      or embeddings failed at index time). Quality is materially
 *      worse than embeddings but it's enough to make the agent
 *      useful for keyword-anchored questions.
 *
 * Both paths return the same `RetrievedChunk` shape so the agent
 * tool doesn't need to branch.
 *
 * Per-plan corpora are small at MLP volume (a handful of SOPs ≈
 * hundreds of chunks at most), so we pull all chunks into memory and
 * score in JS rather than reaching for pgvector. If a plan ever has
 * tens of thousands of chunks we'd revisit.
 */

import { prisma } from "@/lib/db";
import { cosine, getEmbedder } from "./embedder";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  ord: number;
  pageHint: number | null;
  content: string;
  score: number;
  /// "semantic" | "lexical" — surfaced so the agent can be honest
  /// about how confident the retrieval was when needed.
  mode: "semantic" | "lexical";
}

export interface RetrieveOptions {
  /// Hard cap on the number of chunks to consider. Keeps memory
  /// bounded even if a plan accumulates a lot of docs over time.
  poolLimit?: number;
  /// Number of results to return after ranking.
  topK?: number;
  /// Minimum score below which a chunk is dropped from results.
  /// Different defaults for semantic (cosine 0..1) vs lexical
  /// (sum-of-idf, plan-relative).
  minScore?: number;
}

const DEFAULT_POOL_LIMIT = 1000;
const DEFAULT_TOP_K = 4;

/**
 * Search the indexed training docs for `planId` and return the
 * top-K chunks ranked by relevance to `query`.
 *
 * Returns `[]` when:
 *   - no docs are indexed for the plan,
 *   - the embedder call fails (caller still hears "no match"),
 *   - all candidate scores fall below the minimum.
 */
export async function retrieveChunks(
  planId: string,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const topK = options.topK ?? DEFAULT_TOP_K;
  const poolLimit = options.poolLimit ?? DEFAULT_POOL_LIMIT;

  const chunks = await prisma.trainingDocumentChunk.findMany({
    where: { trainingDocument: { changePlanId: planId } },
    take: poolLimit,
    orderBy: [{ trainingDocumentId: "asc" }, { ord: "asc" }],
    select: {
      id: true,
      trainingDocumentId: true,
      ord: true,
      pageHint: true,
      content: true,
      embedding: true,
      embeddingModel: true,
      trainingDocument: { select: { filename: true } },
    },
  });
  if (chunks.length === 0) return [];

  const embedder = getEmbedder();
  const usable = embedder
    ? chunks.filter(
        (c) =>
          c.embedding.length === embedder.dim &&
          c.embeddingModel === embedder.model,
      )
    : [];

  if (embedder && usable.length > 0) {
    let queryVec: number[];
    try {
      const [v] = await embedder.embedBatch([trimmed]);
      queryVec = v ?? [];
    } catch (err) {
      console.error("[rag] query embed failed; falling back to lexical:", err);
      return lexicalScore(chunks, trimmed, topK, options.minScore);
    }
    if (queryVec.length !== embedder.dim) {
      return lexicalScore(chunks, trimmed, topK, options.minScore);
    }
    const minScore = options.minScore ?? 0.2; // cosine threshold
    return usable
      .map((c) => ({
        chunkId: c.id,
        documentId: c.trainingDocumentId,
        filename: c.trainingDocument.filename,
        ord: c.ord,
        pageHint: c.pageHint,
        content: c.content,
        score: cosine(queryVec, c.embedding),
        mode: "semantic" as const,
      }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  return lexicalScore(chunks, trimmed, topK, options.minScore);
}

// --------------------------------------------------------------------
// Lexical fallback — token-overlap weighted by idf.
// --------------------------------------------------------------------

interface ChunkRow {
  id: string;
  trainingDocumentId: string;
  ord: number;
  pageHint: number | null;
  content: string;
  trainingDocument: { filename: string };
}

function lexicalScore(
  chunks: ChunkRow[],
  query: string,
  topK: number,
  minScoreOpt?: number,
): RetrievedChunk[] {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) return [];

  // Plan-relative document frequencies. Tokens that show up in
  // every chunk (stop words, the org name, etc) get an idf near 0
  // and contribute little to the ranking.
  const docFreq = new Map<string, number>();
  const chunkTokens: string[][] = chunks.map((c) => {
    const toks = uniqueTokens(c.content);
    for (const t of toks) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    return toks;
  });
  const N = chunks.length;
  const idf = (token: string): number => {
    const df = docFreq.get(token) ?? 0;
    if (df === 0) return 0;
    return Math.log(1 + N / df);
  };

  // Each chunk's score = sum(idf(t)) over query tokens that appear
  // in the chunk. Multi-word phrase matches get a small bonus.
  const scored = chunks.map((c, i) => {
    const tokenSet = new Set(chunkTokens[i]);
    let score = 0;
    let hits = 0;
    for (const qt of queryTokens) {
      if (tokenSet.has(qt)) {
        score += idf(qt);
        hits += 1;
      }
    }
    // Phrase bonus: contiguous query substring appearing verbatim.
    if (
      query.length > 8 &&
      c.content.toLowerCase().includes(query.toLowerCase())
    ) {
      score += 1.5;
      hits += queryTokens.length;
    }
    return { c, score, hits };
  });

  const minScore = minScoreOpt ?? 0.5; // idf-units, plan-relative
  return scored
    .filter((s) => s.hits > 0 && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      chunkId: s.c.id,
      documentId: s.c.trainingDocumentId,
      filename: s.c.trainingDocument.filename,
      ord: s.c.ord,
      pageHint: s.c.pageHint,
      content: s.c.content,
      score: s.score,
      mode: "lexical" as const,
    }));
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "in", "is", "it", "its", "of", "on", "or", "that",
  "the", "this", "to", "was", "were", "will", "with", "we", "you",
  "your", "our", "i", "me", "my", "do", "does", "did", "what",
  "when", "where", "which", "who", "why", "how",
]);

function uniqueTokens(text: string): string[] {
  const toks = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return Array.from(new Set(toks));
}
