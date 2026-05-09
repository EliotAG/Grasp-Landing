import { OrganizationTextChannel } from "@prisma/client";

import { prisma } from "@/lib/db";

export const TEXT_CHANNEL_LABEL: Record<OrganizationTextChannel, string> = {
  teams: "Microsoft Teams",
  slack: "Slack",
};

export async function getOrganizationPrimaryTextChannel(
  organizationId: string,
): Promise<OrganizationTextChannel> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryTextChannel: true },
  });
  return org?.primaryTextChannel ?? OrganizationTextChannel.teams;
}

export function parseOrganizationTextChannel(
  value: FormDataEntryValue | string | null | undefined,
): OrganizationTextChannel | null {
  return value === OrganizationTextChannel.teams ||
    value === OrganizationTextChannel.slack
    ? value
    : null;
}
