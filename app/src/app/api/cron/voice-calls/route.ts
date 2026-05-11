/**
 * Cron drain for voice-kickoff calls.
 *
 * Mirrors `/api/cron/check-ins`: bearer-token guarded, drains a small
 * batch of due `ScheduledVoiceCall` rows per tick, deploys a Recall.ai
 * bot into each leader-pasted Teams meeting URL with the voice-tuned
 * system prompt.
 *
 * Voice timing matters more than text check-ins (a late bot means the
 * employee enters an empty room), so this cron is registered at every
 * minute in `vercel.json` and we use a 2-minute lead window so the bot
 * is in the room before the slot starts.
 */

import { NextResponse } from "next/server";

import {
  drainDueVoiceCalls,
  drainEmptyVoiceCallOutputMedia,
} from "@/lib/voice/dispatch";

export const runtime = "nodejs";
// Voice deployment is a single Recall.ai POST per row; budget is small.
export const maxDuration = 120;

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
  const lead = parseInt(url.searchParams.get("lead") ?? "", 10);

  const [dispatchSummary, cooldownSummary] = await Promise.all([
    drainDueVoiceCalls({
      limit: Number.isFinite(limit) ? limit : undefined,
      leadMinutes: Number.isFinite(lead) ? lead : undefined,
    }),
    drainEmptyVoiceCallOutputMedia({
      limit: Number.isFinite(limit) ? limit : undefined,
      cooldownSeconds: 60,
    }),
  ]);

  const results = [...dispatchSummary.results, ...cooldownSummary.results];

  const summary = {
    drained: dispatchSummary.drained + cooldownSummary.drained,
    results,
  };

  return NextResponse.json({
    drained: summary.drained,
    dispatchedDrained: dispatchSummary.drained,
    cooldownDrained: cooldownSummary.drained,
    okCount: summary.results.filter((r) => r.ok && !r.skippedReason).length,
    skippedCount: summary.results.filter((r) => r.skippedReason).length,
    failedCount: summary.results.filter((r) => !r.ok).length,
    results: summary.results.map((r) => ({
      callId: r.callId,
      enrollmentId: r.enrollmentId,
      ok: r.ok,
      recallBotId: r.recallBotId ?? null,
      skippedReason: r.skippedReason ?? null,
      error: r.error ?? null,
    })),
  });
}

/** Manual trigger / smoke test path; same auth. */
export async function POST(req: Request): Promise<Response> {
  return GET(req);
}
