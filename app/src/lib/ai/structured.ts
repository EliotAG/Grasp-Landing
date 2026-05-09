/**
 * Forced-tool-use helper for guaranteed-shape JSON output from Claude.
 *
 * Pattern documented by Anthropic for structured output:
 *   1. Define a single tool whose `input_schema` is a JSON Schema describing
 *      the desired output shape.
 *   2. Force the model to use that tool via `tool_choice: { type: "tool" }`.
 *   3. Read the tool-use block's `input` and validate it through the same
 *      Zod schema for runtime safety.
 *
 * This is what `generateObject` does inside the Vercel AI SDK; we keep it
 * inline so we own the call surface and don't carry an extra dependency.
 */
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DEFAULT_MODEL, getAnthropic } from "./anthropic";

export interface CallStructuredOptions {
  /** Anthropic model id; defaults to the env-configured Sonnet build. */
  model?: string;
  /** System prompt — sets role/constraints. */
  system: string;
  /** User prompt — the actual task input. */
  user: string;
  /** Temperature; defaults to 0.2 for deterministic structured output. */
  temperature?: number;
  /** Max output tokens; defaults to 2048. */
  maxTokens?: number;
  /**
   * Tool name surfaced to the model. Pick a verb-noun phrase that nudges
   * the model toward the right behavior (e.g. "extract_stakeholder_groups").
   */
  toolName: string;
  /** Short human description of what the tool returns; helps the model. */
  toolDescription: string;
}

/**
 * Call Claude with forced tool use, validate the output against `schema`,
 * and return the parsed value.
 *
 * Throws if the model refuses to call the tool or if the tool input fails
 * validation. Callers catching this should fall back to manual entry.
 */
export async function callStructured<T>(
  schema: z.ZodType<T>,
  opts: CallStructuredOptions,
): Promise<T> {
  const client = getAnthropic();

  // zod-to-json-schema returns a full JSON Schema document; Anthropic wants
  // just the schema body (object with type/properties/etc).
  const jsonSchema = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  });

  const response = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        // Anthropic requires `input_schema` to be a top-level object schema.
        input_schema: jsonSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `Claude did not call the forced tool "${opts.toolName}". stop_reason=${response.stop_reason}`,
    );
  }

  const parsed = schema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `Claude tool output failed validation for "${opts.toolName}": ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// Re-import the Anthropic namespace at the bottom so the type-only import
// stays out of the runtime cycle. (TS erases this entirely.)
import type Anthropic from "@anthropic-ai/sdk";
