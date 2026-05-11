/**
 * POST /api/intake/[id]/tool
 *
 * Browser → server bridge for Realtime tool calls. The Realtime model emits a
 * function-call event over the data channel; the browser parses the
 * arguments, hits this route, and sends the JSON result back into the data
 * channel as a `function_call_output` item.
 *
 * We re-validate plan ownership here because the ephemeral OpenAI key issued
 * to the browser is scoped to the OpenAI session, not to our DB; this route
 * is the only thing standing between a leaked client and another tenant's
 * plan.
 *
 * Body: { name: string; arguments: object }
 * Response: { ok: true; data: ... } | { ok: false; error: string }
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dispatchIntakeTool } from "@/lib/planner/intake-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ToolRequestBody {
  name?: string;
  arguments?: unknown;
}

export async function POST(
  req: Request,
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

  let body: ToolRequestBody | null = null;
  try {
    body = (await req.json()) as ToolRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON" },
      { status: 400 },
    );
  }
  const toolName = body?.name?.trim();
  if (!toolName) {
    return NextResponse.json(
      { error: "Missing tool name" },
      { status: 400 },
    );
  }

  try {
    const result = await dispatchIntakeTool(plan.id, toolName, body?.arguments);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tool execution failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
