/**
 * Shared types for the intake chat surface.
 *
 * Each chat row is one `IntakeMessage`. Rendering branches on `kind`, which
 * keeps the chat-canvas dispatcher narrow and the variant components focused.
 */
import type { PlannerContextSummary } from "@/lib/planner/context-summary";
import type { PlannerTurn } from "@/lib/planner/agent";

export type SuggestedUpdates = NonNullable<PlannerTurn["suggestedUpdates"]>;

export type IntakeMessage =
  | {
      id: string;
      kind: "text";
      role: "assistant" | "user" | "system";
      text: string;
      status?: string;
    }
  | {
      id: string;
      kind: "context-summary";
      role: "assistant";
      summary: PlannerContextSummary;
      applied: boolean;
      dismissed: boolean;
    }
  | {
      id: string;
      kind: "suggestions";
      role: "assistant";
      suggestions: SuggestedUpdates;
      applied: boolean;
      dismissed: boolean;
    }
  | {
      id: string;
      kind: "doc-progress";
      role: "system";
      filename: string;
      documentId: string | null;
    };
