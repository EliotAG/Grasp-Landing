/**
 * Chunk + embed a TrainingDocument and persist the resulting
 * TrainingDocumentChunk rows.
 *
 * Public surface:
 *   - `indexTrainingDocument(documentId)` — full re-index of one doc
 *     (delete-then-replace; safe to call repeatedly).
 *   - `indexPendingTrainingDocuments(planId?)` — drain helper for
 *     ops scripts and (later) cron.
 *
 * The embedder is optional. When `OPENAI_API_KEY` is unset we still
 * persist chunk rows (empty `embedding`), which lets the lexical
 * fallback path retrieve them. Status flips to `indexed` either way
 * so the dashboard accurately reflects "the agent can search this".
 *
 * Re-index is destructive: we drop existing chunks for the doc inside
 * a transaction so a partial run can't leave half-old / half-new
 * chunks around. The corpus per plan is small enough that this is a
 * non-issue performance-wise.
 */

import { prisma } from "@/lib/db";
import { chunkText, type ChunkResult } from "./chunker";
import { getEmbedder } from "./embedder";

export interface IndexResult {
  documentId: string;
  chunkCount: number;
  embedded: boolean;
  durationMs: number;
}

export async function indexTrainingDocument(
  documentId: string,
): Promise<IndexResult> {
  const started = Date.now();
  const doc = await prisma.trainingDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      extractedText: true,
      pageCount: true,
      processingStatus: true,
    },
  });
  if (!doc) {
    throw new Error(`TrainingDocument ${documentId} not found`);
  }
  if (doc.processingStatus !== "parsed") {
    throw new Error(
      `TrainingDocument ${documentId} not yet parsed (status=${doc.processingStatus})`,
    );
  }
  if (!doc.extractedText || doc.extractedText.trim().length === 0) {
    // Mark as indexed-with-zero-chunks so the dashboard pill is
    // accurate ("nothing extractable; agent has nothing to search")
    // and the indexer doesn't keep retrying.
    await prisma.$transaction([
      prisma.trainingDocumentChunk.deleteMany({
        where: { trainingDocumentId: doc.id },
      }),
      prisma.trainingDocument.update({
        where: { id: doc.id },
        data: {
          indexStatus: "indexed",
          indexedAt: new Date(),
          indexError: null,
        },
      }),
    ]);
    return {
      documentId: doc.id,
      chunkCount: 0,
      embedded: false,
      durationMs: Date.now() - started,
    };
  }

  const chunks = chunkText(doc.extractedText, doc.pageCount);
  const embedder = getEmbedder();

  let embeddings: number[][] | null = null;
  if (embedder && chunks.length > 0) {
    try {
      embeddings = await embedInBatches(
        embedder.embedBatch.bind(embedder),
        chunks.map((c) => c.content),
      );
      // Sanity check — guard against a provider returning a
      // wrong-dim vector that would corrupt the cosine path.
      if (embeddings.length !== chunks.length) {
        throw new Error(
          `Embedder returned ${embeddings.length} vectors for ${chunks.length} chunks`,
        );
      }
      for (const v of embeddings) {
        if (v.length !== embedder.dim) {
          throw new Error(
            `Embedder returned ${v.length}-dim vector; expected ${embedder.dim}`,
          );
        }
      }
    } catch (err) {
      // Degrade to the lexical path rather than failing the whole
      // index — chunks are still useful.
      embeddings = null;
      await prisma.trainingDocument.update({
        where: { id: doc.id },
        data: {
          indexError: `Embedding failed; lexical fallback in use: ${errorMessage(err)}`,
        },
      });
    }
  }

  await prisma.$transaction([
    prisma.trainingDocumentChunk.deleteMany({
      where: { trainingDocumentId: doc.id },
    }),
    prisma.trainingDocumentChunk.createMany({
      data: chunks.map((c, i) => ({
        trainingDocumentId: doc.id,
        ord: c.ord,
        content: c.content,
        charCount: c.charCount,
        pageHint: c.pageHint,
        embedding: embeddings?.[i] ?? [],
        embeddingModel: embeddings ? embedder!.model : null,
      })),
    }),
    prisma.trainingDocument.update({
      where: { id: doc.id },
      data: {
        indexStatus: "indexed",
        indexedAt: new Date(),
        indexError: embeddings ? null : undefined,
      },
    }),
  ]);

  return {
    documentId: doc.id,
    chunkCount: chunks.length,
    embedded: Boolean(embeddings),
    durationMs: Date.now() - started,
  };
}

/**
 * Best-effort fire-and-forget wrapper for the upload action and
 * other call sites that don't want to await the embedding round
 * trip. Marks the doc as `failed` with the error so the dashboard
 * surfaces it.
 */
export async function indexTrainingDocumentSafe(
  documentId: string,
): Promise<void> {
  try {
    await indexTrainingDocument(documentId);
  } catch (err) {
    await prisma.trainingDocument
      .update({
        where: { id: documentId },
        data: {
          indexStatus: "failed",
          indexError: errorMessage(err),
        },
      })
      .catch(() => {
        /* swallow — original error is logged below */
      });
    console.error(
      `[rag] indexTrainingDocument failed for ${documentId}:`,
      err,
    );
  }
}

/**
 * Walk all docs in `pending` (or `failed`) state and index them.
 * Used by `pnpm tsx scripts/reindex-training-docs.ts` and the
 * future indexing cron.
 */
export async function indexPendingTrainingDocuments(opts: {
  planId?: string;
  limit?: number;
} = {}): Promise<IndexResult[]> {
  const docs = await prisma.trainingDocument.findMany({
    where: {
      ...(opts.planId ? { changePlanId: opts.planId } : {}),
      processingStatus: "parsed",
      indexStatus: { in: ["pending", "failed"] },
    },
    select: { id: true },
    take: opts.limit ?? 50,
    orderBy: { createdAt: "asc" },
  });
  const results: IndexResult[] = [];
  for (const d of docs) {
    try {
      results.push(await indexTrainingDocument(d.id));
    } catch (err) {
      await prisma.trainingDocument
        .update({
          where: { id: d.id },
          data: {
            indexStatus: "failed",
            indexError: errorMessage(err),
          },
        })
        .catch(() => {});
      console.error(`[rag] index failed for ${d.id}:`, err);
    }
  }
  return results;
}

// OpenAI's embeddings endpoint accepts up to 2048 inputs per call,
// but we keep batches small to avoid surprising-large request bodies
// and to spread retries across smaller chunks if a 5xx happens.
const BATCH_SIZE = 64;

async function embedInBatches(
  embed: (inputs: string[]) => Promise<number[][]>,
  inputs: string[],
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const vecs = await embed(batch);
    out.push(...vecs);
  }
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
