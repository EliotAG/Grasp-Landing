/**
 * POST /api/intake/[id]/realtime-session
 *
 * Mints an OpenAI Realtime session pre-configured with the intake system
 * prompt, current plan snapshot (inlined into instructions), and the planner
 * tool definitions. Returns the session metadata + ephemeral client_secret
 * the browser uses to open a WebRTC connection.
 *
 * Auth: caller must own the change plan via their session organization.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createIntakeRealtimeSession } from "@/lib/voice/intake-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, status: true },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (plan.status !== "draft") {
    return NextResponse.json(
      { error: "This plan is no longer in draft." },
      { status: 409 },
    );
  }

  try {
    const payload = await createIntakeRealtimeSession(plan.id);
    return NextResponse.json({
      sessionId: payload.session.id,
      model: payload.session.model,
      voice: payload.voice,
      clientSecret: payload.session.client_secret.value,
      clientSecretExpiresAt: payload.session.client_secret.expires_at,
      handshakeUrl: payload.handshakeUrl,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create voice session";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
