import type { NextRequest } from "next/server";

import {
  handleSlackEnvelope,
  parseSlackEnvelope,
  readSlackTeamId,
  verifySlackRequest,
} from "@/lib/slack/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  const teamId = readSlackTeamId(rawBody);
  const verification = await verifySlackRequest(rawBody, req.headers, teamId);
  if (!verification.ok || !verification.config) {
    return new Response(verification.error ?? "Unauthorized", { status: 401 });
  }

  const envelope = parseSlackEnvelope(rawBody);
  if (!envelope) return new Response("Invalid JSON", { status: 400 });

  return handleSlackEnvelope(envelope, verification.config);
}

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "grasp-slack-events",
    hint: "POST Slack Events API payloads to this URL.",
  });
}
