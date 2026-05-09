/**
 * Proactive 1:1 messaging into Teams.
 *
 * Looks up a stored ConversationReference and replays it through
 * CloudAdapter.continueConversation, which mints a fresh TurnContext
 * and a connector client scoped to the right service URL. Used by
 * the wizard kickoff DMs and by the test page in /settings/teams.
 */

import { MessageFactory } from "@microsoft/agents-hosting";
import type { Attachment } from "@microsoft/agents-activity";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getTeamsAdapterForAuthConfig } from "./adapter";
import { getTeamsAuthConfigForCredentials } from "./auth-config";
import {
  describeTeamsConfigProblem,
  getOrganizationTeamsConfig,
} from "./integration";

export class TeamsSendError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TeamsSendError";
  }
}

export interface ProactiveSendOptions {
  /**
   * Optional attachments delivered alongside the text body. When set,
   * the activity ships as a list (`MessageFactory.list`) so Teams
   * surfaces both the body and the attachments in the same turn —
   * which is how the kickoff DM ships an .ics calendar invite.
   */
  attachments?: Attachment[];
}

export async function sendTeamsMessageByReferenceId(
  referenceId: string,
  text: string,
  options?: ProactiveSendOptions,
): Promise<void> {
  const ref = await prisma.teamsConversationReference.findUnique({
    where: { id: referenceId },
  });
  if (!ref) throw new TeamsSendError("Conversation reference not found");
  const organizationId =
    ref.organizationId ?? (await inferReferenceOrganizationId(ref));
  await sendTeamsMessage(
    organizationId,
    ref.reference as object,
    text,
    options,
  );
}

export async function sendTeamsMessageByAadObjectId(
  aadObjectId: string,
  text: string,
  options?: ProactiveSendOptions,
): Promise<void> {
  const ref = await prisma.teamsConversationReference.findUnique({
    where: { aadObjectId },
  });
  if (!ref) {
    throw new TeamsSendError(
      "No Teams conversation reference for this user. Bootstrap Teams for this user and wait for Teams to deliver the bot install/open event.",
    );
  }
  await sendTeamsMessage(
    ref.organizationId ?? (await inferReferenceOrganizationId(ref)),
    ref.reference as object,
    text,
    options,
  );
}

async function inferReferenceOrganizationId(ref: {
  id: string;
  aadObjectId: string;
  userEmail: string | null;
}): Promise<string | null> {
  const filters: Prisma.EmployeeWhereInput[] = [
    { microsoftAadObjectId: ref.aadObjectId },
  ];
  if (ref.userEmail) {
    filters.push({
      email: { equals: ref.userEmail, mode: Prisma.QueryMode.insensitive },
    });
  }
  const employee = await prisma.employee.findFirst({
    where: {
      OR: filters,
    },
    select: { id: true, organizationId: true },
  });
  if (!employee) return null;
  await prisma.teamsConversationReference.update({
    where: { id: ref.id },
    data: { organizationId: employee.organizationId, employeeId: employee.id },
  });
  return employee.organizationId;
}

async function sendTeamsMessage(
  organizationId: string | null,
  reference: object,
  text: string,
  options?: ProactiveSendOptions,
): Promise<void> {
  if (!organizationId) {
    throw new TeamsSendError(
      "Conversation reference is not linked to a workspace. Re-bootstrap Teams for this user.",
    );
  }

  const config = await getOrganizationTeamsConfig(organizationId);
  const problem = describeTeamsConfigProblem(config);
  if (problem || !config.credentials) {
    throw new TeamsSendError(problem ?? "Teams is not configured.");
  }

  const authConfig = getTeamsAuthConfigForCredentials(config.credentials);
  const adapter = getTeamsAdapterForAuthConfig(authConfig);

  try {
    // The SDK accepts ConversationReference shapes via JSON round-trip;
    // we cast here because Prisma's Json type erases the structure.
    await adapter.continueConversation(
      config.credentials.appId,
      reference as Parameters<typeof adapter.continueConversation>[1],
      async (context) => {
        const activity =
          options?.attachments && options.attachments.length > 0
            ? MessageFactory.list(options.attachments, text)
            : MessageFactory.text(text);
        await context.sendActivity(activity);
      },
    );
  } catch (err) {
    throw new TeamsSendError(
      err instanceof Error ? err.message : "Unknown send error",
      err,
    );
  }
}
