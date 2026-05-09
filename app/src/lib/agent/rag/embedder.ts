/**
 * Embedding-provider abstraction for the agent's training-doc RAG.
 *
 * Anthropic doesn't ship an embeddings API, so we go to OpenAI's
 * `text-embedding-3-small` (1536d) when `OPENAI_API_KEY` is configured.
 * When it isn't, `getEmbedder()` returns `null` and the retrieval
 * layer (see ./retrieve.ts) falls back to a lexical token-overlap
 * scorer over the same chunk corpus.
 *
 * Why we don't hard-require an embedding key:
 *   - dev environments shouldn't need a second paid API key just to
 *     wire up the RAG plumbing; lexical fallback is bad-but-real
 *     signal for keyword-heavy questions like "what's the SLA";
 *   - the chunk + tool wiring lives unchanged across both paths;
 *   - production deployments that care about semantic recall flip
 *     the env var on and re-index — same schema, same code path.
 *
 * The `provider` string written to TrainingDocumentChunk.embeddingModel
 * is what the indexer uses to decide whether a chunk needs re-embedding
 * after a model swap.
 */

export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_EMBEDDING_DIM = 1536;

export interface Embedder {
  /// Stable id we persist on the chunk row. Lets us re-embed
  /// selectively after a model swap.
  model: string;
  /// Dimension of returned vectors — used for sanity checks before
  /// we write Float[] columns.
  dim: number;
  /// Embed a batch of strings. Implementations should be tolerant of
  /// 1..N inputs and return vectors in matching order.
  embedBatch(inputs: string[]): Promise<number[][]>;
}

let cached: Embedder | null | undefined;

export function isEmbedderConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Returns the configured embedder, or null when no provider is
 * available. Callers MUST handle null and fall back to the lexical
 * retrieval path — never throw.
 */
export function getEmbedder(): Embedder | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    cached = null;
    return null;
  }
  cached = {
    model: `openai:${OPENAI_EMBEDDING_MODEL}`,
    dim: OPENAI_EMBEDDING_DIM,
    async embedBatch(inputs: string[]): Promise<number[][]> {
      if (inputs.length === 0) return [];
      // Hand-rolled fetch keeps us off the OpenAI SDK dep — we only
      // need this one endpoint and the wire format is stable.
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: inputs,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `OpenAI embeddings failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
        );
      }
      const json = (await res.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };
      // Defensive sort: OpenAI documents in-order responses, but we
      // pin on the explicit `index` to make ordering bugs impossible.
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    },
  };
  return cached;
}

/**
 * Cosine similarity between two same-dim vectors. Returns 0 when
 * either vector is zero-norm so callers can sort without NaN traps.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
