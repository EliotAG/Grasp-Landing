/**
 * Streaming announcement-draft endpoint.
 *
 * Server actions can return streams in Next.js, but consuming a stream from
 * a `useFormState`-style flow is awkward — the announcement step renders
 * tokens directly, so a plain fetch + ReadableStream reader is cleaner.
 *
 * Auth: same org as the change plan. POST body: { changePlanId }.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/anthropic";
import { streamAnnouncementDraft } from "@/lib/ai/wizard/draft-announcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "AI is not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    changePlanId?: string;
  } | null;
  const changePlanId = body?.changePlanId;
  if (!changePlanId) {
    return NextResponse.json({ error: "Missing changePlanId" }, { status: 400 });
  }

  const plan = await prisma.changePlan.findFirst({
    where: { id: changePlanId, organizationId: session.user.organizationId },
    include: {
      stakeholderGroups: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!plan.summary?.trim()) {
    return NextResponse.json(
      { error: "Add a summary in the first step first." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamAnnouncementDraft({
          changeName: plan.name,
          changeSummary: plan.summary!,
          coreMechanism: plan.coreMechanism,
          responseCadenceHours: plan.responseCadenceHours,
          kickoffDate: plan.kickoffDate,
          targetDate: plan.targetDate,
          stakeholderGroups: plan.stakeholderGroups.map((g) => ({
            name: g.name,
            description: g.description,
            behaviorSpec: g.behaviorSpec,
          })),
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
