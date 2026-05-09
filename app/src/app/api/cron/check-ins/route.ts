/**
 * Cron drain for scheduled check-ins.
 *
 * Vercel cron (or any external scheduler) hits this at a steady tick
 * — once every 15 minutes is a reasonable starting cadence. We drain
 * up to N due rows per run and return a digest for log inspection.
 *
 * Auth: bearer token against `CRON_SECRET`. Vercel Cron sends this
 * automatically when the env var is set on the project.
 *
 * The route is intentionally synchronous: we wait for each dispatch
 * because the underlying LLM call is the bottleneck and we want
 * back-pressure to be visible (timeouts surface as 504s). For larger
 * orgs this will need a queue; v1 keeps it simple.
 */

import { NextResponse } from "next/server";

import { drainDueCheckIns } from "@/lib/agent/check-ins";

export const runtime = "nodejs";
// Allow up to 5 minutes for the drain. Each scheduled check-in does
// one Anthropic round-trip + Teams + sim send; budgeted at ~6s each
// that's enough headroom for a few dozen rows per tick. If we ever
// see this hit, we should switch to a per-row queue worker.
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

  const summary = await drainDueCheckIns({
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  // Compact response — useful in the Vercel cron log without being
  // PII-heavy. Per-row outcomes go in `results` for debugging.
  return NextResponse.json({
    drained: summary.drained,
    okCount: summary.results.filter((r) => r.result.ok).length,
    failedCount: summary.results.filter((r) => !r.result.ok).length,
    results: summary.results.map((r) => ({
      checkInId: r.checkInId,
      ok: r.result.ok,
      skippedReason: r.result.skippedReason ?? null,
      channels: r.result.channels ?? null,
      error: r.result.error ?? null,
    })),
  });
}

/**
 * POST is supported for manual / scripted runs (e.g. an admin button
 * or a CI smoke test) so the cron path doesn't need to be triggered
 * from outside Vercel's scheduler. Same auth.
 */
export async function POST(req: Request): Promise<Response> {
  return GET(req);
}
