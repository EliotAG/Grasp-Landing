"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  saveCadence,
  saveCheckInSchedule,
  saveVoiceKickoff,
  testVoiceKickoffConnection,
} from "../actions";
import { useAutosave } from "../_state/use-autosave";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";
import {
  CHECK_IN_TEMPLATE_DESCRIPTIONS,
  CHECK_IN_TEMPLATE_LABELS,
  DEFAULT_CHECK_IN_TEMPLATES,
} from "@/lib/rollout-schedule";

type ScheduleKind = "day_3" | "week_1" | "week_3";

type ScheduleDraft = {
  kind: ScheduleKind;
  enabled: boolean;
  offsetDays: number;
};

// ---------- Date math --------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(startOfDay(date).getTime() + days * DAY_MS);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round(
    (startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS,
  );
}

function toInputDate(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

function parseInputDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShort(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function timelineStart(plan: WizardPlan): Date {
  const today = startOfDay(new Date());
  if (plan.targetDate && plan.targetDate.getTime() < today.getTime()) {
    return startOfDay(plan.kickoffDate ?? today);
  }
  return today;
}

function timelineTarget(plan: WizardPlan, start: Date): Date {
  const fallback = addDays(start, 30);
  if (!plan.targetDate) return fallback;
  const target = startOfDay(plan.targetDate);
  return target.getTime() <= start.getTime() ? fallback : target;
}

// ---------- Layout primitives ------------------------------------------------

function pctForOffset(offsetDays: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return clamp((offsetDays / totalDays) * 100, 0, 100);
}

function offsetForPct(pct: number, totalDays: number): number {
  return clamp(
    Math.round((pct / 100) * totalDays),
    1,
    Math.max(1, totalDays - 1),
  );
}

// Tick offsets for visual scale. Tries to keep ~5–10 evenly-spaced marks
// regardless of rollout length, snapped to whole days.
function buildTickOffsets(totalDays: number): number[] {
  if (totalDays <= 1) return [];
  const interval =
    totalDays <= 14
      ? 1
      : totalDays <= 35
        ? 7
        : totalDays <= 90
          ? 14
          : Math.max(7, Math.round(totalDays / 8));
  const ticks: number[] = [];
  for (let d = interval; d < totalDays; d += interval) ticks.push(d);
  return ticks;
}

// Suggest an offset for a newly-added check-in: midpoint of the largest gap
// between existing markers and the rollout window edges, snapped to days.
function placeInLargestGap(
  schedule: ScheduleDraft[],
  totalDays: number,
): number {
  const enabledOffsets = schedule
    .filter((t) => t.enabled)
    .map((t) => t.offsetDays)
    .sort((a, b) => a - b);
  const boundaries = [0, ...enabledOffsets, totalDays];
  let bestStart = 0;
  let bestEnd = totalDays;
  let bestLen = -Infinity;
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    if (b - a > bestLen) {
      bestLen = b - a;
      bestStart = a;
      bestEnd = b;
    }
  }
  const mid = Math.round((bestStart + bestEnd) / 2);
  return clamp(mid, 1, Math.max(1, totalDays - 1));
}

// Greedy two-row layout for flag labels above the rail to avoid overlap.
// Returns a row index per input position (0 = nearest the rail).
const FLAG_MIN_GAP_PCT = 14;
function assignFlagRows(positions: number[]): number[] {
  const sorted = positions
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p - b.p);
  const rows: number[] = new Array(positions.length).fill(0);
  const lastInRow: number[] = [];
  for (const { p, i } of sorted) {
    let r = 0;
    while (r < lastInRow.length && p - lastInRow[r] < FLAG_MIN_GAP_PCT) {
      r += 1;
    }
    rows[i] = r;
    lastInRow[r] = p;
  }
  return rows;
}

// ---------- Schedule helpers -------------------------------------------------

function initialSchedule(plan: WizardPlan): ScheduleDraft[] {
  const byKind = new Map(
    plan.checkInTemplates.map((template) => [template.kind, template]),
  );
  return DEFAULT_CHECK_IN_TEMPLATES.map((template) => {
    const saved = byKind.get(template.kind);
    return {
      kind: template.kind,
      enabled: saved?.enabled ?? template.enabled,
      offsetDays: saved?.offsetDays ?? template.offsetDays,
    };
  });
}

// ---------- Timeline rail ----------------------------------------------------

interface RolloutTimelineProps {
  schedule: ScheduleDraft[];
  startDate: Date;
  targetDate: Date;
  totalDays: number;
  onChangeOffset: (
    kind: ScheduleKind,
    nextOffset: number,
    persist: boolean,
  ) => void;
}

// Vertical layout constants for the rail (px). Keeping these as constants
// keeps marker / flag / stem geometry consistent regardless of which row a
// flag ends up in.
const RAIL_HEIGHT = 168;
const RAIL_Y = 118;
const MARKER_SIZE = 14;
const FLAG_HEIGHT_APPROX = 44;
const FLAG_GAP = 14; // px between flag bottom and marker top

function RolloutTimeline({
  schedule,
  startDate,
  targetDate,
  totalDays,
  onChangeOffset,
}: RolloutTimelineProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [draggingKind, setDraggingKind] = useState<ScheduleKind | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  const active = useMemo(
    () => schedule.filter((t) => t.enabled),
    [schedule],
  );
  const positions = useMemo(
    () => active.map((t) => pctForOffset(t.offsetDays, totalDays)),
    [active, totalDays],
  );
  const flagRows = useMemo(() => assignFlagRows(positions), [positions]);
  const ticks = useMemo(() => buildTickOffsets(totalDays), [totalDays]);

  const computePctFromClientX = useCallback((clientX: number) => {
    const el = railRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  }, []);

  function handleMarkerPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: ScheduleKind,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingKind(kind);
    setHoverPct(null);
  }

  function handleMarkerPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: ScheduleKind,
  ) {
    if (draggingKind !== kind) return;
    const pct = computePctFromClientX(event.clientX);
    if (pct === null) return;
    const nextOffset = offsetForPct(pct, totalDays);
    const current = schedule.find((t) => t.kind === kind);
    if (!current || current.offsetDays === nextOffset) return;
    onChangeOffset(kind, nextOffset, false);
  }

  function handleMarkerPointerUp(
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: ScheduleKind,
  ) {
    if (draggingKind !== kind) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingKind(null);
    const current = schedule.find((t) => t.kind === kind);
    if (current) {
      // Persist exactly once on drop, regardless of how far we dragged.
      onChangeOffset(kind, current.offsetDays, true);
    }
  }

  function handleRailPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (draggingKind) return;
    setHoverPct(computePctFromClientX(event.clientX));
  }

  function handleRailPointerLeave() {
    if (draggingKind) return;
    setHoverPct(null);
  }

  function handleMarkerKey(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    kind: ScheduleKind,
    offsetDays: number,
  ) {
    let delta = 0;
    if (event.key === "ArrowLeft") delta = event.shiftKey ? -7 : -1;
    else if (event.key === "ArrowRight") delta = event.shiftKey ? 7 : 1;
    else if (event.key === "Home") {
      event.preventDefault();
      onChangeOffset(kind, 1, true);
      return;
    } else if (event.key === "End") {
      event.preventDefault();
      onChangeOffset(kind, Math.max(1, totalDays - 1), true);
      return;
    }
    if (delta === 0) return;
    event.preventDefault();
    const next = clamp(offsetDays + delta, 1, Math.max(1, totalDays - 1));
    if (next !== offsetDays) onChangeOffset(kind, next, true);
  }

  const tooLittleHeadroom = totalDays < 2;

  return (
    <div className="relative">
      <div className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        <div className="flex items-baseline gap-2">
          <span>Now</span>
          <span className="text-[12px] font-medium normal-case tracking-normal text-ink/85">
            {formatShort(startDate)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium normal-case tracking-normal text-ink/85">
            {formatShort(targetDate)}
          </span>
          <span>Target</span>
        </div>
      </div>

      {tooLittleHeadroom ? (
        <div className="mt-4 rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.02] p-5 text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
          The rollout window is too short to schedule check-ins. Push the
          target completion date out a few days from the timeline step.
        </div>
      ) : (
        <div
          ref={railRef}
          onPointerMove={handleRailPointerMove}
          onPointerLeave={handleRailPointerLeave}
          className="relative mt-3 select-none"
          style={{ height: `${RAIL_HEIGHT}px` }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 h-px bg-[color:var(--color-line-strong)]"
            style={{ top: `${RAIL_Y}px` }}
          />

          {ticks.map((d) => {
            const left = pctForOffset(d, totalDays);
            return (
              <span
                key={d}
                aria-hidden
                className="pointer-events-none absolute h-[9px] w-px bg-[color:var(--color-line)]"
                style={{ left: `${left}%`, top: `${RAIL_Y - 4}px` }}
              />
            );
          })}

          <span
            aria-hidden
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-grasp)] ring-4 ring-[color:var(--color-grasp-soft)]"
            style={{ left: "0%", top: `${RAIL_Y}px` }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-ink)] ring-4 ring-black/5"
            style={{ left: "100%", top: `${RAIL_Y}px` }}
          />

          {hoverPct !== null && !draggingKind ? (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: `${hoverPct}%`,
                  top: `${FLAG_HEIGHT_APPROX + 12}px`,
                  bottom: `${RAIL_HEIGHT - RAIL_Y - 4}px`,
                  width: 0,
                  borderLeft: "1px dashed var(--color-line-strong)",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-[color:var(--color-line-strong)] bg-[color:var(--color-canvas)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-ink-2)] shadow-sm"
                style={{
                  left: `${clamp(hoverPct, 5, 95)}%`,
                  top: `${RAIL_Y + 14}px`,
                }}
              >
                {formatShort(
                  addDays(startDate, offsetForPct(hoverPct, totalDays)),
                )}
              </div>
            </>
          ) : null}

          {active.map((template, idx) => {
            const left = positions[idx];
            const row = flagRows[idx];
            const flagBottom = RAIL_Y - FLAG_GAP - row * (FLAG_HEIGHT_APPROX + 8);
            const flagTop = flagBottom - FLAG_HEIGHT_APPROX;
            const stemTop = flagBottom;
            const stemHeight = RAIL_Y - flagBottom - MARKER_SIZE / 2;
            const isDragging = draggingKind === template.kind;
            const date = addDays(startDate, template.offsetDays);
            return (
              <div
                key={template.kind}
                className="pointer-events-none absolute inset-y-0"
                style={{ left: `${left}%` }}
              >
                <div
                  className="pointer-events-auto absolute -translate-x-1/2 rounded-xl border border-[color:var(--color-line-strong)] bg-white/95 px-3 py-1.5 text-center shadow-[0_4px_18px_rgba(0,0,0,0.06)] backdrop-blur"
                  style={{
                    top: `${flagTop}px`,
                    transition:
                      "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
                    transform: `translateX(-50%) scale(${isDragging ? 1.03 : 1})`,
                    borderColor: isDragging
                      ? "var(--color-grasp)"
                      : "var(--color-line-strong)",
                  }}
                >
                  <div className="whitespace-nowrap text-[12.5px] font-semibold leading-tight text-ink">
                    {CHECK_IN_TEMPLATE_LABELS[template.kind]}
                  </div>
                  <div className="mt-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums text-[color:var(--color-muted)]">
                    {formatShort(date)} · Day {template.offsetDays}
                  </div>
                </div>

                <div
                  aria-hidden
                  className="pointer-events-none absolute -translate-x-1/2"
                  style={{
                    top: `${stemTop}px`,
                    height: `${Math.max(0, stemHeight)}px`,
                    width: "1px",
                    background: "var(--color-line-strong)",
                  }}
                />

                <button
                  type="button"
                  className={`pointer-events-auto absolute rounded-full border-2 bg-white shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-grasp)] focus-visible:ring-offset-2 ${
                    isDragging
                      ? "scale-125 cursor-grabbing"
                      : "cursor-grab hover:scale-110"
                  }`}
                  style={{
                    width: `${MARKER_SIZE}px`,
                    height: `${MARKER_SIZE}px`,
                    left: 0,
                    top: `${RAIL_Y - MARKER_SIZE / 2}px`,
                    transform: "translateX(-50%)",
                    borderColor: isDragging
                      ? "var(--color-grasp)"
                      : "var(--color-ink)",
                    touchAction: "none",
                  }}
                  aria-label={`${
                    CHECK_IN_TEMPLATE_LABELS[template.kind]
                  } on ${formatShort(date)}, day ${template.offsetDays}. Use arrow keys to adjust by one day, shift plus arrow for one week.`}
                  onPointerDown={(e) =>
                    handleMarkerPointerDown(e, template.kind)
                  }
                  onPointerMove={(e) =>
                    handleMarkerPointerMove(e, template.kind)
                  }
                  onPointerUp={(e) => handleMarkerPointerUp(e, template.kind)}
                  onPointerCancel={(e) =>
                    handleMarkerPointerUp(e, template.kind)
                  }
                  onKeyDown={(e) =>
                    handleMarkerKey(e, template.kind, template.offsetDays)
                  }
                />
              </div>
            );
          })}

          {active.length === 0 ? (
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full border border-dashed border-[color:var(--color-line-strong)] bg-white/70 px-4 py-1.5 text-[12px] font-medium text-[color:var(--color-muted)]"
              style={{ top: `${RAIL_Y - 50}px` }}
            >
              Add a check-in below to drop it on the timeline
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------- Main step --------------------------------------------------------

export function CadenceStep({
  plan,
  showNav = true,
}: {
  plan: WizardPlan;
  showNav?: boolean;
}) {
  const [hours, setHours] = useState<string>(
    plan.responseCadenceHours?.toString() ?? "",
  );
  const [onBehalf, setOnBehalf] = useState(plan.announcementSendOnBehalf);
  const [voiceEnabled, setVoiceEnabled] = useState(plan.voiceKickoffEnabled);
  const [voiceStatus, setVoiceStatus] = useState<
    "saving" | "saved" | null
  >(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceProbe, setVoiceProbe] = useState<
    | { state: "idle" }
    | { state: "running" }
    | { state: "ok"; detail: string }
    | { state: "error"; detail: string }
  >({ state: "idle" });
  const [schedule, setSchedule] = useState<ScheduleDraft[]>(() =>
    initialSchedule(plan),
  );
  const [scheduleStatus, setScheduleStatus] = useState<
    "saving" | "saved" | null
  >(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScheduleRef = useRef<ScheduleDraft[]>([]);

  useEffect(() => {
    return () => {
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
      if (saveDebounceTimer.current) clearTimeout(saveDebounceTimer.current);
      if (voiceFadeTimer.current) clearTimeout(voiceFadeTimer.current);
    };
  }, []);

  async function persistVoiceKickoff(next: { enabled: boolean }) {
    setVoiceError(null);
    setVoiceStatus("saving");
    const result = await saveVoiceKickoff(plan.id, { enabled: next.enabled });
    if (result.ok) {
      setVoiceStatus("saved");
      if (voiceFadeTimer.current) clearTimeout(voiceFadeTimer.current);
      voiceFadeTimer.current = setTimeout(() => setVoiceStatus(null), 1500);
    } else {
      setVoiceStatus(null);
      setVoiceError(result.error);
    }
  }

  async function runVoiceProbe() {
    setVoiceProbe({ state: "running" });
    const result = await testVoiceKickoffConnection(plan.id);
    setVoiceProbe(
      result.ok
        ? { state: "ok", detail: result.detail }
        : { state: "error", detail: result.detail },
    );
  }

  const startDate = useMemo(() => timelineStart(plan), [plan]);
  const targetDate = useMemo(
    () => timelineTarget(plan, startDate),
    [plan, startDate],
  );
  const totalDays = Math.max(1, daysBetween(startDate, targetDate));

  const { queue, flushNow } = useAutosave(
    (payload: {
      responseCadenceHours: string;
      announcementSendOnBehalf: boolean;
    }) =>
      saveCadence(plan.id, {
        responseCadenceHours: payload.responseCadenceHours as "" | number,
        announcementSendOnBehalf: payload.announcementSendOnBehalf,
      }),
  );

  function applyDefault() {
    setHours("48");
    flushNow({
      responseCadenceHours: "48",
      announcementSendOnBehalf: onBehalf,
    });
  }

  async function persistSchedule(next: ScheduleDraft[]) {
    setScheduleError(null);
    setScheduleStatus("saving");
    const result = await saveCheckInSchedule(plan.id, {
      templates: next.map((template) => ({
        kind: template.kind,
        enabled: template.enabled,
        offsetDays: Number(template.offsetDays),
      })),
    });
    if (result.ok) {
      setScheduleStatus("saved");
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
      savedFadeTimer.current = setTimeout(
        () => setScheduleStatus(null),
        1500,
      );
    } else {
      setScheduleStatus(null);
      setScheduleError(result.error);
    }
  }

  // Coalesces rapid commits (e.g. holding Arrow on a marker) into a single
  // server round-trip. A short delay is imperceptible for drop/commit cases
  // but prevents bursts of saves from saturating the network.
  function schedulePersist(next: ScheduleDraft[]) {
    latestScheduleRef.current = next;
    setScheduleStatus("saving");
    if (saveDebounceTimer.current) clearTimeout(saveDebounceTimer.current);
    saveDebounceTimer.current = setTimeout(() => {
      saveDebounceTimer.current = null;
      void persistSchedule(latestScheduleRef.current);
    }, 250);
  }

  function applyScheduleChange(
    next: ScheduleDraft[],
    shouldPersist: boolean,
  ) {
    setSchedule(next);
    if (shouldPersist) schedulePersist(next);
  }

  function handleTimelineChange(
    kind: ScheduleKind,
    nextOffset: number,
    shouldPersist: boolean,
  ) {
    const next = schedule.map((template) =>
      template.kind === kind
        ? { ...template, offsetDays: nextOffset }
        : template,
    );
    applyScheduleChange(next, shouldPersist);
  }

  function handleDateInput(kind: ScheduleKind, value: string) {
    const parsed = parseInputDate(value);
    if (!parsed) return;
    const offset = clamp(
      daysBetween(startDate, parsed),
      1,
      Math.max(1, totalDays - 1),
    );
    const next = schedule.map((template) =>
      template.kind === kind ? { ...template, offsetDays: offset } : template,
    );
    applyScheduleChange(next, true);
  }

  function handleRemove(kind: ScheduleKind) {
    const next = schedule.map((template) =>
      template.kind === kind ? { ...template, enabled: false } : template,
    );
    applyScheduleChange(next, true);
  }

  function handleAdd(kind: ScheduleKind) {
    const placement = placeInLargestGap(schedule, totalDays);
    const next = schedule.map((template) =>
      template.kind === kind
        ? { ...template, enabled: true, offsetDays: placement }
        : template,
    );
    applyScheduleChange(next, true);
  }

  const activeSchedule = [...schedule]
    .filter((template) => template.enabled)
    .sort((a, b) => a.offsetDays - b.offsetDays);
  const inactiveSchedule = schedule.filter((template) => !template.enabled);

  return (
    <div className="space-y-6">
      <div className="card space-y-5 p-7">
        <div>
          <label htmlFor="hours" className="label">
            Response cadence (hours)
          </label>
          <input
            id="hours"
            type="number"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              queue({
                responseCadenceHours: e.target.value,
                announcementSendOnBehalf: onBehalf,
              });
            }}
            onBlur={() =>
              flushNow({
                responseCadenceHours: hours,
                announcementSendOnBehalf: onBehalf,
              })
            }
            placeholder="48"
            className="input max-w-[160px]"
          />
          <p className="mt-2 text-[12px] text-[color:var(--color-muted)]">
            How quickly you commit to responding when Grasp surfaces a
            concern. Tracked across the rollout. Broken commitments destroy
            trust faster than any other single thing per the empirical
            review.{" "}
            <button
              type="button"
              onClick={applyDefault}
              className="text-[color:var(--color-grasp)] hover:underline"
            >
              Use 48-hour default
            </button>
          </p>
        </div>

        <div className="border-t border-[color:var(--color-line)] pt-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={onBehalf}
              onChange={(e) => {
                setOnBehalf(e.target.checked);
                flushNow({
                  responseCadenceHours: hours,
                  announcementSendOnBehalf: e.target.checked,
                });
              }}
              className="mt-1"
            />
            <span>
              <span className="text-[14px] font-medium">
                Let the agent send the announcement on my behalf
              </span>
              <span className="block text-[12px] text-[color:var(--color-muted)] mt-0.5">
                Off: the agent introduces itself and references your
                announcement, but you send it from your own account. On: the
                agent posts the announcement directly as Grasp.
              </span>
            </span>
          </label>
        </div>

        <div className="border-t border-[color:var(--color-line)] pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="label">Check-in schedule</p>
              <p className="mt-1 text-[12px] leading-[1.6] text-[color:var(--color-muted)]">
                Drag a marker on the rail or edit the date below. Grasp will
                materialize these dates when you activate the rollout.
              </p>
            </div>
            <div
              aria-live="polite"
              className="pt-0.5 text-[11px] font-medium"
              style={{ minHeight: "16px" }}
            >
              {scheduleStatus === "saving" ? (
                <span className="text-[color:var(--color-muted)]">Saving…</span>
              ) : scheduleStatus === "saved" ? (
                <span className="inline-flex items-center gap-1 text-[color:var(--color-grasp)]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-grasp)]" />
                  Saved
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-[color:var(--color-line)] bg-white/55 px-5 pb-4 pt-5">
            <RolloutTimeline
              schedule={schedule}
              startDate={startDate}
              targetDate={targetDate}
              totalDays={totalDays}
              onChangeOffset={handleTimelineChange}
            />
          </div>

          {activeSchedule.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {activeSchedule.map((template) => {
                const date = addDays(startDate, template.offsetDays);
                return (
                  <li
                    key={template.kind}
                    className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[color:var(--color-line)] bg-white/65 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <p className="text-[14px] font-semibold text-ink">
                          {CHECK_IN_TEMPLATE_LABELS[template.kind]}
                        </p>
                        <p className="text-[12px] font-medium tabular-nums text-[color:var(--color-muted)]">
                          {formatShort(date)} · Day {template.offsetDays}
                        </p>
                      </div>
                      <p className="mt-1 text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
                        {CHECK_IN_TEMPLATE_DESCRIPTIONS[template.kind]}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="date"
                        value={toInputDate(date)}
                        min={toInputDate(addDays(startDate, 1))}
                        max={toInputDate(addDays(startDate, totalDays - 1))}
                        onChange={(e) =>
                          handleDateInput(template.kind, e.target.value)
                        }
                        className="input h-9 w-[148px] px-2 py-1 text-[13px]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemove(template.kind)}
                        className="rounded-full p-1.5 text-[color:var(--color-muted)] transition hover:bg-black/[0.04] hover:text-red-700"
                        aria-label={`Remove ${
                          CHECK_IN_TEMPLATE_LABELS[template.kind]
                        }`}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          aria-hidden
                        >
                          <path
                            d="M3 3l8 8M11 3l-8 8"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.015] p-5 text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
              No check-ins on the timeline yet. Add at least one if you want
              Grasp to proactively follow up after kickoff.
            </div>
          )}

          {inactiveSchedule.length > 0 ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
                Add a check-in
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {inactiveSchedule.map((template) => (
                  <button
                    key={template.kind}
                    type="button"
                    onClick={() => handleAdd(template.kind)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-line-strong)] bg-white/85 px-3 py-1.5 text-[12.5px] font-medium text-[color:var(--color-ink-2)] transition hover:-translate-y-px hover:border-[color:var(--color-grasp)] hover:bg-white hover:text-[color:var(--color-grasp)]"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M5.5 1v9M1 5.5h9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    {CHECK_IN_TEMPLATE_LABELS[template.kind]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {scheduleError ? (
            <p className="mt-3 text-[12px] text-red-700">{scheduleError}</p>
          ) : null}
        </div>

        <div className="border-t border-[color:var(--color-line)] pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="label">Voice kickoff (optional)</p>
              <p className="mt-1 text-[12px] leading-[1.6] text-[color:var(--color-muted)]">
                When you activate, Grasp creates a unique Teams meeting on
                your Outlook calendar for each enrollee and sends them a
                real calendar invite. Grasp joins each meeting at the
                scheduled time to talk that person through the change live.
              </p>
            </div>
            <div
              aria-live="polite"
              className="pt-0.5 text-[11px] font-medium"
              style={{ minHeight: "16px" }}
            >
              {voiceStatus === "saving" ? (
                <span className="text-[color:var(--color-muted)]">Saving…</span>
              ) : voiceStatus === "saved" ? (
                <span className="inline-flex items-center gap-1 text-[color:var(--color-grasp)]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-grasp)]" />
                  Saved
                </span>
              ) : null}
            </div>
          </div>

          <label className="mt-4 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setVoiceEnabled(enabled);
                void persistVoiceKickoff({ enabled });
              }}
              className="mt-1"
            />
            <span>
              <span className="text-[14px] font-medium">
                Enable voice kickoff calls
              </span>
              <span className="block text-[12px] text-[color:var(--color-muted)] mt-0.5">
                Off: kickoff is text-only in Teams. On: when you activate,
                Grasp uses Microsoft Graph to put a Teams meeting on each
                enrollee&rsquo;s calendar using the workspace organizer mailbox
                and joins via Recall.ai + OpenAI Realtime at the scheduled time.
              </span>
            </span>
          </label>

          {voiceEnabled ? (
            <div className="mt-4 rounded-xl border border-[color:var(--color-line)] bg-white/60 p-4">
              <p className="text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
                Voice kickoff needs <span className="font-medium">tenant
                admin consent</span> on the Grasp bot&rsquo;s app
                registration for{" "}
                <code className="text-[11px]">OnlineMeetings.ReadWrite.All</code>{" "}
                and{" "}
                <code className="text-[11px]">Calendars.ReadWrite</code>, plus a
                Teams Application Access Policy granting Grasp permission
                to create meetings on your behalf. Run the Test connection
                button below before activating to make sure everything is
                wired up.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runVoiceProbe()}
                  disabled={voiceProbe.state === "running"}
                  className="rounded-full border border-[color:var(--color-line-strong)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[color:var(--color-ink-2)] transition hover:-translate-y-px hover:border-[color:var(--color-grasp)] hover:text-[color:var(--color-grasp)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {voiceProbe.state === "running"
                    ? "Testing…"
                    : "Test connection"}
                </button>
                {voiceProbe.state === "ok" ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-grasp)]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-grasp)]" />
                    {voiceProbe.detail}
                  </span>
                ) : voiceProbe.state === "error" ? (
                  <span className="text-[12px] leading-[1.5] text-red-700">
                    {voiceProbe.detail}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {voiceError ? (
            <p className="mt-3 text-[12px] text-red-700">{voiceError}</p>
          ) : null}
        </div>
      </div>

      {showNav ? <StepNav changePlanId={plan.id} step="support" /> : null}
    </div>
  );
}
