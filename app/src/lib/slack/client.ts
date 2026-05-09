import type { SlackCredentials } from "./integration";

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

interface SlackEnvelope {
  ok: boolean;
  error?: string;
}

interface SlackUser {
  id: string;
  team_id?: string;
  name?: string;
  real_name?: string;
  profile?: {
    email?: string;
    real_name?: string;
    display_name?: string;
  };
}

async function slackFetch<T extends SlackEnvelope>(
  credentials: SlackCredentials,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload ?? {}),
    cache: "no-store",
  });

  let body: T;
  try {
    body = (await resp.json()) as T;
  } catch (err) {
    throw new SlackApiError(`Slack ${method} returned invalid JSON`, undefined, err);
  }

  if (!resp.ok || !body.ok) {
    const code = body.error ?? `http_${resp.status}`;
    throw new SlackApiError(`Slack ${method} failed: ${code}`, code);
  }

  return body;
}

export async function testSlackAuth(credentials: SlackCredentials): Promise<{
  teamId: string | null;
  teamName: string | null;
  botUserId: string | null;
}> {
  const body = await slackFetch<
    SlackEnvelope & {
      team_id?: string;
      team?: string;
      user_id?: string;
    }
  >(credentials, "auth.test");
  return {
    teamId: body.team_id ?? null,
    teamName: body.team ?? null,
    botUserId: body.user_id ?? null,
  };
}

export async function lookupSlackUserByEmail(
  credentials: SlackCredentials,
  email: string,
): Promise<{
  id: string;
  email: string | null;
  name: string | null;
}> {
  const body = await slackFetch<SlackEnvelope & { user: SlackUser }>(
    credentials,
    "users.lookupByEmail",
    { email },
  );
  const user = body.user;
  return {
    id: user.id,
    email: user.profile?.email ?? email,
    name:
      user.profile?.real_name ??
      user.profile?.display_name ??
      user.real_name ??
      user.name ??
      null,
  };
}

export async function getSlackUserInfo(
  credentials: SlackCredentials,
  slackUserId: string,
): Promise<{
  id: string;
  email: string | null;
  name: string | null;
}> {
  const body = await slackFetch<SlackEnvelope & { user: SlackUser }>(
    credentials,
    "users.info",
    { user: slackUserId },
  );
  const user = body.user;
  return {
    id: user.id,
    email: user.profile?.email ?? null,
    name:
      user.profile?.real_name ??
      user.profile?.display_name ??
      user.real_name ??
      user.name ??
      null,
  };
}

export async function openSlackDm(
  credentials: SlackCredentials,
  slackUserId: string,
): Promise<string> {
  const body = await slackFetch<
    SlackEnvelope & { channel?: { id?: string } }
  >(credentials, "conversations.open", { users: slackUserId });
  const channelId = body.channel?.id;
  if (!channelId) {
    throw new SlackApiError("Slack conversations.open did not return a channel id");
  }
  return channelId;
}

export async function postSlackMessage(
  credentials: SlackCredentials,
  channelId: string,
  text: string,
): Promise<{ ts: string | null }> {
  const body = await slackFetch<SlackEnvelope & { ts?: string }>(
    credentials,
    "chat.postMessage",
    { channel: channelId, text },
  );
  return { ts: body.ts ?? null };
}
