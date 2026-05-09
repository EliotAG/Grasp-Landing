/**
 * Cron drain for pending amendment deliveries.
 *
 * The publish-amendment server action dispatches the first N rows
 * inline so the leader sees immediate feedback. Anything past that
 * inline cap stays in `scheduled`; this route picks them up.
 *
 * Auth: bearer token against `CRON_SECRET` (same secret as the
 * check-ins cron). Vercel Cron sends it automatically when set.
 */

import { NextResponse } from "next/server";

import { drainPendingAmendmentDeliveries } from "@/lib/agent/amendments";

export const runtime = "nodejs";
// Each amendment delivery is one Anthropic round-trip + a couple
// channel sends. Same envelope as the check-ins drain.
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: "Unauthorized: missing or wrong bearer token" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "", 10);

  const summary = await drainPendingAmendmentDeliveries({
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return NextResponse.json({
    drained: summary.drained,
    okCount: summary.results.filter((r) => r.result.ok).length,
    failedCount: summary.results.filter((r) => !r.result.ok).length,
    results: summary.results.map((r) => ({
      deliveryId: r.deliveryId,
      ok: r.result.ok,
      skippedReason: r.result.skippedReason ?? null,
      channels: r.result.channels ?? null,
      error: r.result.error ?? null,
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  return GET(req);
}
