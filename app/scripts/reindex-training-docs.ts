/**
 * Re-index all training documents that aren't currently `indexed`.
 *
 * Usage:
 *   pnpm tsx scripts/reindex-training-docs.ts             # all plans
 *   pnpm tsx scripts/reindex-training-docs.ts <planId>    # one plan
 *
 * Useful after a model swap (you want fresh embeddings on every
 * chunk) or after fixing an embedder outage. The indexer is
 * idempotent — re-running on already-indexed docs is a no-op
 * because we filter for `pending` / `failed`.
 */

import { indexPendingTrainingDocuments } from "@/lib/agent/rag/indexer";
import { isEmbedderConfigured } from "@/lib/agent/rag/embedder";

async function main() {
  const planId = process.argv[2];
  console.log(
    `[reindex] embedder configured: ${isEmbedderConfigured()} (without it, lexical-fallback chunks are still persisted)`,
  );
  const results = await indexPendingTrainingDocuments({
    planId,
    limit: 200,
  });
  if (results.length === 0) {
    console.log("[reindex] no docs in pending or failed state.");
    return;
  }
  for (const r of results) {
    console.log(
      `[reindex] doc=${r.documentId} chunks=${r.chunkCount} embedded=${r.embedded} (${r.durationMs}ms)`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
