/**
 * Singleton Anthropic SDK client.
 *
 * The wizard uses the official `@anthropic-ai/sdk` directly — no Vercel AI
 * SDK wrapper. Forced-tool-use for structured output lives in `./structured.ts`;
 * long-form streaming for the announcement draft uses
 * `client.messages.stream(...)` from this client directly.
 *
 * If `ANTHROPIC_API_KEY` is unset, callers should degrade gracefully (the
 * wizard remains usable, just without AI assist). `isAiEnabled()` is the
 * canonical check.
 */
import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | null | undefined;
};

export const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5";

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getAnthropic(): Anthropic {
  if (globalForAnthropic.anthropic) return globalForAnthropic.anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Gate AI features behind isAiEnabled() before calling getAnthropic().",
    );
  }
  const client = new Anthropic({ apiKey });
  if (process.env.NODE_ENV !== "production") {
    globalForAnthropic.anthropic = client;
  }
  return client;
}
