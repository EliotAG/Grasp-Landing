/**
 * Closed-pilot gate card.
 *
 * Drop-in replacement for the primary action on any surface that's
 * gated by `Organization.approvedAt`. Uses warm-amber framing (matching
 * the app-shell banner) so "you're not done yet" reads as
 * informational, not as an error.
 *
 * Each call passes its own `title` + `body` so the message is
 * specific to the surface (activation vs Teams setup vs amendment),
 * but the visual treatment + the SMS CTA stay consistent.
 */

import { PILOT_GATE_COPY } from "@/lib/access";

export function PendingApprovalGate({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={`max-w-[380px] rounded-2xl border border-amber-200/70 bg-amber-50/70 p-5 ${className ?? ""}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
        Closed pilot
      </p>
      <h2 className="serif mt-1 text-[19px] leading-[1.25] text-amber-950">
        {title}
      </h2>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-amber-900/85">
        {body}
      </p>
      <a
        href={PILOT_GATE_COPY.ctaSms}
        className="mt-4 inline-flex items-center justify-center rounded-full border border-amber-300 bg-white/70 px-4 py-2 text-[13px] font-semibold text-amber-950 no-underline transition-colors hover:bg-white"
      >
        {PILOT_GATE_COPY.ctaSmsLabel} →
      </a>
    </div>
  );
}
