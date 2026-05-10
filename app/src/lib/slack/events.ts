import { createHmac, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";

import { loadAgentContextByEmail } from "@/lib/agent/context";
import { runAgentTurn } from "@/lib/agent/conversation";
import { prisma } from "@/lib/db";
import { getSlackUserInfo, postSlackMessage } from "./client";
import { upsertSlackContact } from "./bootstrap";
import {
  getEnabledSlackConfigs,
  getSlackConfigByTeamId,
  type OrganizationSlackConfig,
} from "./integration";

const MAX_SIGNATURE_AGE_SECONDS = 60 * 5;

type SlackEnvelope =
  | { type: "url_verification"; challenge?: string; team_id?: string }
  | {
      type: "event_callback";
      team_id?: string;
      event_id?: string;
      event?: SlackMessageEvent;
    };

interface SlackMessageEvent {
  type?: string;
  channel_type?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackSignatureResult {
  ok: boolean;
  config: OrganizationSlackConfig | null;
  error?: string;
}

export async function verifySlackRequest(
  rawBody: string,
  headers: Headers,
  hintedTeamId?: string | null,
): Promise<SlackSignatureResult> {
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !signature) {
    return { ok: false, config: null, error: "Missing Slack signature headers." };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return { ok: false, config: null, error: "Invalid Slack timestamp." };
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - seconds);
  if (age > MAX_SIGNATURE_AGE_SECONDS) {
    return { ok: false, config: null, error: "Stale Slack signature timestamp." };
  }

  const configs = hintedTeamId
    ? [await getSlackConfigByTeamId(hintedTeamId)]
    : await getEnabledSlackConfigs();
  for (const config of configs.filter(
    (candidate): candidate is OrganizationSlackConfig =>
      Boolean(candidate?.credentials),
  )) {
    const credentials = config.credentials;
    if (!credentials) continue;
    const expected = signSlackBody(
      credentials.signingSecret,
      timestamp,
      rawBody,
    );
    if (safeEqual(signature, expected)) {
      return { ok: true, config };
    }
  }

  return {
    ok: false,
    config: null,
    error: "Slack signature did not match any configured workspace.",
  };
}

export async function handleSlackEnvelope(
  envelope: SlackEnvelope,
  config: OrganizationSlackConfig,
): Promise<Response> {
  if (envelope.type === "url_verification") {
    return Response.json({ challenge: envelope.challenge ?? "" });
  }

  if (envelope.type !== "event_callback") {
    return new Response(null, { status: 200 });
  }

  if (envelope.event_id) {
    const isDuplicate = await recordSlackEvent(
      envelope.event_id,
      envelope.team_id ?? config.credentials?.teamId ?? null,
      config.organizationId,
    );
    if (isDuplicate) return new Response(null, { status: 200 });
  }

  const event = envelope.event;
  if (!event || !isUserDm(event, config.botUserId)) {
    return new Response(null, { status: 200 });
  }

  if (!config.credentials) {
    return new Response("Slack is not configured.", { status: 500 });
  }

  const text = (event.text ?? "").trim();
  if (!text || !event.user || !event.channel) {
    return new Response(null, { status: 200 });
  }

  try {
    const profile = await getSlackUserInfo(config.credentials, event.user);
    const employee = await resolveEmployeeForSlackUser(
      config.organizationId,
      config.credentials.teamId,
      profile.id,
      profile.email,
    );
    const contactOrganizationId = employee?.organizationId ?? config.organizationId;
    if (contactOrganizationId) {
      await upsertSlackContact({
        organizationId: contactOrganizationId,
        employeeId: employee?.id ?? null,
        slackTeamId: config.credentials.teamId,
        slackUserId: profile.id,
        slackDmChannelId: event.channel,
        userEmail: profile.email,
        userName: profile.name,
        bootstrapError: null,
      });
    }

    const ctx = employee ? await loadAgentContextByEmail(employee.email) : null;
    if (!ctx) {
      await postSlackMessage(
        config.credentials,
        event.channel,
        "Thanks. There isn't an active change rollout that includes you right now, so I'm just standing by. I'll be in touch when leadership kicks off the next one.",
      );
      return new Response(null, { status: 200 });
    }

    const turn = await runAgentTurn({
      context: ctx,
      userText: text,
      channel: "slack",
    });
    await postSlackMessage(config.credentials, event.channel, turn.reply);
  } catch (err) {
    console.error("[slack] event handling failed", err);
    if (event.channel && config.credentials) {
      await postSlackMessage(
        config.credentials,
        event.channel,
        "I hit an error on my side processing that. Try again in a moment, and if it keeps happening, flag it to the leadership team.",
      ).catch((sendErr) => {
        console.error("[slack] error reply failed", sendErr);
      });
    }
  }

  return new Response(null, { status: 200 });
}

export function readSlackTeamId(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { team_id?: unknown; team?: { id?: unknown } };
    if (typeof parsed.team_id === "string") return parsed.team_id;
    if (typeof parsed.team?.id === "string") return parsed.team.id;
  } catch {
    return null;
  }
  return null;
}

export function parseSlackEnvelope(rawBody: string): SlackEnvelope | null {
  try {
    return JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return null;
  }
}

function signSlackBody(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): string {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

function isUserDm(event: SlackMessageEvent, botUserId: string | null): boolean {
  if (event.type !== "message") return false;
  if (event.channel_type !== "im") return false;
  if (event.subtype || event.bot_id) return false;
  if (!event.user || event.user === botUserId) return false;
  return true;
}

async function recordSlackEvent(
  eventId: string,
  slackTeamId: string | null,
  organizationId: string | null,
): Promise<boolean> {
  try {
    await prisma.slackEventReceipt.create({
      data: {
        slackEventId: eventId,
        slackTeamId,
        organizationId,
      },
    });
    return false;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return true;
    }
    throw err;
  }
}

async function resolveEmployeeForSlackUser(
  organizationId: string | null,
  slackTeamId: string,
  slackUserId: string,
  email: string | null,
): Promise<{ id: string; organizationId: string; email: string } | null> {
  const contact = await prisma.slackContact.findUnique({
    where: {
      slackTeamId_slackUserId: { slackTeamId, slackUserId },
    },
    select: {
      employee: { select: { id: true, organizationId: true, email: true } },
    },
  });
  if (contact?.employee) return contact.employee;
  if (!organizationId || !email) return null;
  return prisma.employee.findFirst({
    where: {
      organizationId,
      email: { equals: email, mode: "insensitive" },
    },
    select: { id: true, organizationId: true, email: true },
  });
}
