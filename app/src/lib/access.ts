/**
 * Closed-pilot access gate.
 *
 * Anyone can sign up, create a workspace, upload an org chart, and
 * draft a change plan. But the steps that talk to real employees —
 * activating a rollout, publishing an amendment, or configuring the
 * Teams/Slack integration — are gated on `Organization.approvedAt`.
 *
 * Operators (Grasp staff) flip the bit out of band:
 *   pnpm tsx scripts/approve-org.ts <slug>
 *
 * Why org-level rather than user-level: a workspace is the unit a
 * customer is "approved" at. Once leadership and Grasp have aligned
 * on a pilot, the whole company should be unlocked at once.
 */

import { Session } from "next-auth";

export interface OrgApprovalState {
  /** Workspace exists. Null if the session has no organizationId. */
  organizationId: string | null;
  /** Approval timestamp; null while pending. */
  approvedAt: Date | null;
  /** Convenience: approvedAt != null. */
  approved: boolean;
}

export function readOrgApproval(
  session: Session | null | undefined,
): OrgApprovalState {
  const organizationId = session?.user?.organizationId ?? null;
  const approvedAt = session?.user?.organizationApprovedAt ?? null;
  return {
    organizationId,
    approvedAt,
    approved: Boolean(approvedAt),
  };
}

export class WorkspacePendingApprovalError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Your workspace is still pending approval — a Grasp founder will reach out shortly. Activation, amendments, and integrations unlock once your workspace is approved.",
    );
    this.name = "WorkspacePendingApprovalError";
  }
}

/**
 * Throws WorkspacePendingApprovalError if the current session's org
 * isn't approved. Use this at the top of any server action that
 * touches a real employee (activate rollout, publish amendment,
 * configure integration, send proactive message, etc.).
 *
 * Server actions should catch this and surface its message via their
 * existing { ok: false, error } envelope rather than letting it bubble
 * to a 500 page.
 */
export function assertOrgApproved(
  session: Session | null | undefined,
): asserts session is Session & {
  user: NonNullable<Session["user"]> & { organizationApprovedAt: Date };
} {
  const state = readOrgApproval(session);
  if (!state.organizationId) {
    throw new WorkspacePendingApprovalError(
      "Sign in to a workspace before performing this action.",
    );
  }
  if (!state.approved) throw new WorkspacePendingApprovalError();
}

/**
 * Friendly copy used in the in-app banner and on every "this is gated"
 * surface, kept in one place so the language stays consistent. The
 * banner shows the short headline, gated cards show the full body.
 */
export const PILOT_GATE_COPY = {
  headline: "Your workspace is in closed pilot.",
  body: "You can plan rollouts, upload your org chart, and explore everything the dashboard surfaces. Activating a rollout and connecting Teams or Slack unlock once a Grasp founder approves your workspace.",
  shortBody:
    "Activation and integrations unlock once a Grasp founder approves your workspace.",
  ctaSms: "sms:8325707361&body=Hi, please approve my Grasp workspace.",
  ctaSmsLabel: "Text the founders",
} as const;
