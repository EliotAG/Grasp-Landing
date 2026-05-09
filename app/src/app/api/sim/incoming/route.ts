/**
 * Inbound webhook: messages from the simulator.
 *
 * The simulator POSTs here whenever a "user" sends a reply in its UI.
 * We resolve that user back to a Grasp employee, look up their
 * currently-active enrollment, and run the real agent loop. If
 * there's no active enrollment we still respond — just with a
 * neutral message, since the operator may be poking the simulator
 * outside any rollout.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  sendSimMessage,
  verifySimulatorWebhook,
} from "@/lib/integrations/simulator";
import { loadAgentContextByEmail } from "@/lib/agent/context";
import { runAgentTurn } from "@/lib/agent/conversation";

interface IncomingPayload {
  user: { email: string; name: string };
  message: { id: string; text: string; createdAt: string };
}

export async function POST(req: Request): Promise<Response> {
  if (!verifySimulatorWebhook(req)) {
    return NextResponse.json(
      { error: "Unauthorized: missing or wrong bearer token" },
      { status: 401 },
    );
  }

  let payload: IncomingPayload;
  try {
    payload = (await req.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.user?.email || !payload.message?.text) {
    return NextResponse.json(
      { error: "user.email and message.text are required" },
      { status: 400 },
    );
  }

  // Resolve to an active enrollment, if any. The agent context loader
  // returns null when the email doesn't match an active rollout
  // member; in that case we fall back to a static reply so the
  // operator can keep playing in the simulator without errors.
  const ctx = await loadAgentContextByEmail(payload.user.email);

  let reply: string;
  let toolCallsMade = 0;
  let enrollmentId: string | null = null;

  if (!ctx) {
    // Soft fallback: still acknowledge so the simulator UI shows the
    // bot bubble. Confirm whether this is "we don't know you" or
    // "we know you but you're not in an active rollout" so the
    // operator gets useful debug info.
    const existing = await prisma.employee.findFirst({
      where: { email: { equals: payload.user.email, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    reply = existing
      ? `Hi ${existing.name.split(" ")[0]} — there isn't an active change rollout that includes you right now, so I'm just standing by. (Activate a plan that has ${existing.name} in a stakeholder group and I'll have something to talk about.)`
      : `I don't recognize ${payload.user.email} as anyone in the org chart — make sure that email is in your Employees table, then activate a plan that includes them.`;
  } else {
    enrollmentId = ctx.enrollmentId;
    try {
      const turn = await runAgentTurn({
        context: ctx,
        userText: payload.message.text,
        channel: "simulator",
      });
      reply = turn.reply;
      toolCallsMade = turn.toolCallsMade;
    } catch (err) {
      console.error("[sim] agent turn failed", err);
      reply =
        "Hit an error on my side processing that — try again in a moment, and if it keeps happening flag it to the leadership team.";
    }
  }

  // Send back through the simulator channel. We don't await this on
  // the response path so the simulator UI sees a fast 200 and picks
  // up the bot's bubble on its next poll.
  void sendSimMessage({
    email: payload.user.email,
    name: payload.user.name,
    text: reply,
  });

  return NextResponse.json({
    ok: true,
    matchedEmployeeId: ctx?.employee.id ?? null,
    enrollmentId,
    toolCallsMade,
  });
}
