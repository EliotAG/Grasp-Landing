import { prisma } from "@/lib/db";
import { postSlackMessage } from "./client";
import {
  ensureSlackContactForEmployee,
  resolveSlackContactForEmployee,
} from "./bootstrap";
import {
  describeSlackConfigProblem,
  getOrganizationSlackConfig,
} from "./integration";

export class SlackSendError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SlackSendError";
  }
}

export async function sendSlackMessageByContactId(
  contactId: string,
  text: string,
): Promise<void> {
  const contact = await prisma.slackContact.findUnique({
    where: { id: contactId },
  });
  if (!contact) throw new SlackSendError("Slack contact not found");
  await sendSlackMessage(contact.organizationId, contact.slackDmChannelId, text);
  await prisma.slackContact.update({
    where: { id: contact.id },
    data: { lastActivityAt: new Date() },
  });
}

export async function sendSlackMessageByEmployee(
  employee: {
    id: string;
    organizationId: string;
    name: string;
    email: string;
  },
  text: string,
): Promise<void> {
  let contact = await resolveSlackContactForEmployee(employee);
  if (!contact?.slackDmChannelId) {
    const bootstrap = await ensureSlackContactForEmployee(employee);
    if (bootstrap.outcome !== "ready" && bootstrap.outcome !== "linked") {
      throw new SlackSendError(bootstrap.message);
    }
    contact = await resolveSlackContactForEmployee(employee);
  }
  if (!contact?.slackDmChannelId) {
    throw new SlackSendError("Slack DM channel was not opened for this employee.");
  }
  await sendSlackMessageByContactId(contact.id, text);
}

async function sendSlackMessage(
  organizationId: string,
  channelId: string | null,
  text: string,
): Promise<void> {
  if (!channelId) {
    throw new SlackSendError("Slack DM channel is missing for this contact.");
  }

  const config = await getOrganizationSlackConfig(organizationId);
  const problem = describeSlackConfigProblem(config);
  if (problem || !config.credentials) {
    throw new SlackSendError(problem ?? "Slack is not configured.");
  }

  try {
    await postSlackMessage(config.credentials, channelId, text);
  } catch (err) {
    throw new SlackSendError(
      err instanceof Error ? err.message : "Unknown Slack send error",
      err,
    );
  }
}
