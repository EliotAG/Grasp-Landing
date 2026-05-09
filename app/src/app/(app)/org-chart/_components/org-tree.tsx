"use client";

/**
 * Top-down flow-chart org tree.
 *
 * The chart opens fully expanded with the CEO centered horizontally near
 * the top of the viewport. The user pans by click-and-drag and zooms
 * with the wheel/trackpad (or pinch on touch). Subtree collapse is still
 * available per-card and via the toolbar for users who want to focus on
 * one branch.
 *
 * Layout (pure, post-order width packing):
 *   - Leaves are NODE_W wide; an interior node's subtree width is the sum
 *     of its visible children's subtree widths plus H_GAP between each,
 *     floored at NODE_W so the parent never overhangs its own column.
 *   - Each node is centered horizontally above its visible children.
 *   - Y is purely depth * (NODE_H + V_GAP). No tidy-tree compaction
 *     across siblings — the spec's pilot scale (50–150 employees) doesn't
 *     need it and the simpler layout is more predictable.
 *
 * Pan & zoom:
 *   - View state is { x, y, k } where (x, y) is the canvas-space offset
 *     of the inner stage and k is the zoom factor.
 *   - Wheel zooms anchored at the cursor: the world point under the
 *     cursor stays put across the zoom step. Wheel listener is attached
 *     via addEventListener({ passive: false }) so we can preventDefault.
 *   - Pinch tracks two active pointers; midpoint anchors the zoom.
 *   - Drag on a single pointer translates (x, y).
 */

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  initials,
  teamColor,
  type TreeNode,
} from "../_lib/build-tree";

const NODE_W = 224;
const NODE_H = 92;
const H_GAP = 28;
const V_GAP = 56;
const PAD = 24;

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2;
const ZOOM_STEP = 1.2; // multiplier per +/- click

/** Pointer movement (px) below which a pointerup on a card counts as a tap. */
const TAP_SLOP_PX = 5;

interface PositionedNode {
  node: TreeNode;
  /** Top-left of the box, in canvas coords (already padded). */
  x: number;
  y: number;
  isCollapsed: boolean;
}

interface Edge {
  parentX: number;
  parentBottomY: number;
  childX: number;
  childTopY: number;
  /** Stable key so React reconciles connectors smoothly across re-layouts. */
  key: string;
}

interface Layout {
  positioned: PositionedNode[];
  edges: Edge[];
  width: number;
  height: number;
  /** Center of the first root, used to auto-center on mount. */
  firstRootCenterX: number;
}

interface View {
  x: number;
  y: number;
  k: number;
}

function computeLayout(
  roots: TreeNode[],
  collapsed: ReadonlySet<string>,
): Layout {
  const positioned: PositionedNode[] = [];
  const edges: Edge[] = [];

  function place(
    node: TreeNode,
    depth: number,
    leftX: number,
  ): { center: number; width: number } {
    const isCollapsed = collapsed.has(node.employee.id);
    const visibleChildren = isCollapsed ? [] : node.children;

    let center: number;
    let width: number;

    if (visibleChildren.length === 0) {
      center = leftX + NODE_W / 2;
      width = NODE_W;
    } else {
      let cursor = leftX;
      const childCenters: number[] = [];
      for (const child of visibleChildren) {
        const r = place(child, depth + 1, cursor);
        childCenters.push(r.center);
        cursor += r.width + H_GAP;
      }
      const span = cursor - leftX - H_GAP;
      width = Math.max(span, NODE_W);
      const childMid =
        (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      center = span >= NODE_W ? childMid : leftX + NODE_W / 2;

      const parentBottomY = PAD + depth * (NODE_H + V_GAP) + NODE_H;
      const childTopY = PAD + (depth + 1) * (NODE_H + V_GAP);
      for (let i = 0; i < visibleChildren.length; i++) {
        edges.push({
          parentX: center,
          parentBottomY,
          childX: childCenters[i],
          childTopY,
          key: `${node.employee.id}->${visibleChildren[i].employee.id}`,
        });
      }
    }

    positioned.push({
      node,
      x: center - NODE_W / 2,
      y: PAD + depth * (NODE_H + V_GAP),
      isCollapsed,
    });

    return { center, width };
  }

  let cursor = PAD;
  let firstRootCenterX = PAD + NODE_W / 2;
  for (let i = 0; i < roots.length; i++) {
    const r = place(roots[i], 0, cursor);
    if (i === 0) firstRootCenterX = r.center;
    cursor += r.width + H_GAP;
  }

  const width = Math.max(cursor - H_GAP + PAD, NODE_W + PAD * 2);
  const height = positioned.reduce(
    (m, p) => Math.max(m, p.y + NODE_H),
    NODE_H,
  ) + PAD;

  return { positioned, edges, width, height, firstRootCenterX };
}

function collectAllInteriorIds(roots: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(n: TreeNode) {
    if (n.children.length > 0) ids.add(n.employee.id);
    for (const c of n.children) walk(c);
  }
  for (const r of roots) walk(r);
  return ids;
}

function clampZoom(k: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k));
}

/**
 * Apply a zoom centered at viewport-relative point (cx, cy) such that the
 * world-space point under (cx, cy) stays fixed. Returns the new view.
 */
function zoomAt(view: View, cx: number, cy: number, nextK: number): View {
  const k = clampZoom(nextK);
  if (k === view.k) return view;
  // World point under cursor before zoom: (cx - x) / oldK, (cy - y) / oldK.
  // After zoom we want: x' + worldX * newK = cx, so x' = cx - worldX * newK.
  const wx = (cx - view.x) / view.k;
  const wy = (cy - view.y) / view.k;
  return { x: cx - wx * k, y: cy - wy * k, k };
}

export function OrgTreeWithControls({
  roots,
  total,
  teamCount,
  maxDepth,
}: {
  roots: TreeNode[];
  total: number;
  teamCount: number;
  maxDepth: number;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const layout = useMemo(
    () => computeLayout(roots, collapsed),
    [roots, collapsed],
  );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [isDragging, setIsDragging] = useState(false);
  // Suppress card position-transitions while we're actively dragging or
  // pinching so nothing trails behind the input. Re-enabled afterwards
  // so a future collapse/expand still eases.
  const [animateCards, setAnimateCards] = useState(true);
  // Smoothly animate the stage transform on programmatic moves (Recenter,
  // zoom buttons). Wheel/drag/pinch always set this false so the canvas
  // tracks input 1:1.
  const [smoothPan, setSmoothPan] = useState(false);

  // --- Pointer state (drag + pinch share the same map) ---------------
  const pointersRef = useRef<
    Map<number, { x: number; y: number }>
  >(new Map());
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startView: View;
    /** Employee id this gesture started on (if any). Used for tap-to-open. */
    employeeId: string | null;
    /** Set true once the pointer has moved beyond the click threshold. */
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{
    a: number;
    b: number;
    startDist: number;
    startMid: { x: number; y: number };
    startView: View;
  } | null>(null);

  const recenterOnFirstRoot = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setView((v) => ({
      x: el.clientWidth / 2 - layout.firstRootCenterX * v.k,
      y: 24 - PAD * v.k,
      k: v.k,
    }));
  }, [layout.firstRootCenterX]);

  // Center the first root once the viewport has measured itself. Using a
  // layout effect avoids a one-frame flash where the chart sits at (0,0).
  const initialCenteredRef = useRef(false);
  useLayoutEffect(() => {
    if (initialCenteredRef.current) return;
    const el = viewportRef.current;
    if (!el || el.clientWidth === 0) return;
    recenterOnFirstRoot();
    initialCenteredRef.current = true;
  }, [recenterOnFirstRoot]);

  // Wheel zoom — attached imperatively because React's onWheel is passive
  // in modern React, which prevents preventDefault from working.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      // Don't intercept wheel scrolls outside our element (shouldn't fire
      // anyway since this is a per-element listener, but be defensive).
      if (!el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Trackpad pinch and ctrl+wheel both come through with ctrlKey set;
      // either way, deltaY drives the zoom. Tune the factor so a normal
      // wheel notch (deltaY ≈ 100) feels like a ~15% step.
      const factor = Math.exp(-e.deltaY * 0.0015);
      setSmoothPan(false);
      setAnimateCards(false);
      setView((v) => zoomAt(v, cx, cy, v.k * factor));
      // Re-enable card transitions after a short idle window so a follow-up
      // collapse still animates. Small debounce avoids re-enabling between
      // ticks of a continuous wheel gesture.
      window.clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = window.setTimeout(() => {
        setAnimateCards(true);
      }, 180);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const wheelTimeoutRef = useRef<number>(0);

  // --- Pointer drag + pinch ------------------------------------------
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't hijack clicks on real interactive elements (collapse chevrons).
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, [data-no-pan]")) return;
      // Mouse: only the primary button starts a drag.
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

      if (pointersRef.current.size === 2) {
        // Promote to pinch. Cancel any in-flight drag.
        dragRef.current = null;
        const ids = Array.from(pointersRef.current.keys());
        const a = pointersRef.current.get(ids[0])!;
        const b = pointersRef.current.get(ids[1])!;
        pinchRef.current = {
          a: ids[0],
          b: ids[1],
          startDist: Math.hypot(a.x - b.x, a.y - b.y),
          startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          startView: viewRef.current,
        };
        setIsDragging(false);
        setSmoothPan(false);
        setAnimateCards(false);
        return;
      }

      // Single-pointer: start a drag. Remember which employee card (if
      // any) the gesture started on so we can navigate on a clean tap.
      const card = target.closest<HTMLElement>("[data-employee-id]");
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startView: viewRef.current,
        employeeId: card?.dataset.employeeId ?? null,
        moved: false,
      };
      setIsDragging(true);
      setAnimateCards(false);
      setSmoothPan(false);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const tracked = pointersRef.current.get(e.pointerId);
      if (!tracked) return;
      tracked.x = e.clientX;
      tracked.y = e.clientY;

      if (pinchRef.current) {
        const { a, b, startDist, startMid, startView } = pinchRef.current;
        const pa = pointersRef.current.get(a);
        const pb = pointersRef.current.get(b);
        if (!pa || !pb) return;
        const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const ratio = dist / startDist;
        const targetK = clampZoom(startView.k * ratio);
        const el = viewportRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        // Zoom anchored at the *original* midpoint relative to startView,
        // then translate by the midpoint drift so two-finger drag also pans.
        const startMidLocal = {
          x: startMid.x - rect.left,
          y: startMid.y - rect.top,
        };
        const wx = (startMidLocal.x - startView.x) / startView.k;
        const wy = (startMidLocal.y - startView.y) / startView.k;
        const curMid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const drift = {
          x: curMid.x - startMid.x,
          y: curMid.y - startMid.y,
        };
        setView({
          x: startMidLocal.x + drift.x - wx * targetK,
          y: startMidLocal.y + drift.y - wy * targetK,
          k: targetK,
        });
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      // Movement above the tap threshold is a real drag — disqualify the
      // gesture from opening a profile on pointerup.
      if (!drag.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) {
        drag.moved = true;
      }
      setView({
        x: drag.startView.x + dx,
        y: drag.startView.y + dy,
        k: drag.startView.k,
      });
    },
    [],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }

      if (pinchRef.current) {
        // Once we drop below 2 active pointers, pinch ends. If one finger
        // is still down we *don't* start a drag from it — that feels jarring
        // (the chart would jump to follow that finger). Wait for a fresh
        // pointerdown.
        pinchRef.current = null;
        if (pointersRef.current.size < 2) {
          requestAnimationFrame(() => setAnimateCards(true));
        }
        return;
      }

      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        const drag = dragRef.current;
        dragRef.current = null;
        setIsDragging(false);
        requestAnimationFrame(() => setAnimateCards(true));
        // Tap on a card with no real drag → open that person's profile.
        // We bail on pointercancel (e.g. browser scroll) since e.type is
        // "pointercancel" there and a cancelled gesture isn't a click.
        if (
          e.type === "pointerup" &&
          !drag.moved &&
          drag.employeeId
        ) {
          router.push(`/people/${drag.employeeId}`);
        }
      }
    },
    [router],
  );

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Re-center if the viewport resizes meaningfully *and* the user hasn't
  // touched the chart yet. After the first manual interaction we leave the
  // pan alone — yanking the canvas under the user is jarring.
  const userMovedRef = useRef(false);
  useEffect(() => {
    if (isDragging) userMovedRef.current = true;
  }, [isDragging]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (userMovedRef.current) return;
      recenterOnFirstRoot();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [recenterOnFirstRoot]);

  function zoomFromCenter(nextK: number, smooth = true) {
    const el = viewportRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    if (smooth) setSmoothPan(true);
    setView((v) => zoomAt(v, cx, cy, nextK));
    if (smooth) {
      window.setTimeout(() => setSmoothPan(false), 360);
    }
  }

  const zoomPct = Math.round(view.k * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-[color:var(--color-muted)]">
          {total} {total === 1 ? "person" : "people"}
          <span className="mx-2 opacity-40">·</span>
          {teamCount} {teamCount === 1 ? "team" : "teams"}
          <span className="mx-2 opacity-40">·</span>
          {maxDepth} {maxDepth === 1 ? "level" : "levels"} deep
          <span className="mx-2 opacity-40">·</span>
          <span className="text-[color:var(--color-muted)]/80">
            drag to pan · scroll to zoom
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          <div
            className="flex items-center rounded-full border border-[color:var(--color-line)] bg-white/60"
            role="group"
            aria-label="Zoom"
          >
            <button
              type="button"
              onClick={() => zoomFromCenter(view.k / ZOOM_STEP)}
              disabled={view.k <= ZOOM_MIN + 0.001}
              aria-label="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded-l-full text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <MinusIcon />
            </button>
            <button
              type="button"
              onClick={() => zoomFromCenter(1)}
              title="Reset zoom"
              className="min-w-[44px] border-x border-[color:var(--color-line)] px-2 py-0.5 text-center text-[11px] font-medium tabular-nums text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              onClick={() => zoomFromCenter(view.k * ZOOM_STEP)}
              disabled={view.k >= ZOOM_MAX - 0.001}
              aria-label="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded-r-full text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <PlusIcon />
            </button>
          </div>
          <span aria-hidden className="mx-1 h-4 w-px bg-[color:var(--color-line)]" />
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(collectAllInteriorIds(roots))}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={() => {
              userMovedRef.current = false;
              setSmoothPan(true);
              setView((v) => ({ ...v, k: 1 }));
              // Use a microtask so recenter sees k=1 in its closure.
              requestAnimationFrame(() => {
                recenterOnFirstRoot();
                window.setTimeout(() => setSmoothPan(false), 360);
              });
            }}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-muted)] transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            Recenter
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        className="card relative overflow-hidden touch-none select-none"
        style={{
          // Fill the available vertical space below the page header. The
          // 220px subtracts AppShell top padding + page header + this
          // component's own toolbar + breathing room. Floors at 520 so
          // small viewports still get a usable canvas.
          height: "max(520px, calc(100dvh - 220px))",
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        {/* Soft grid behind the chart — anchors the eye while panning.
            Pans and zooms with the canvas so dots feel fixed to the world. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(0,0,0,0.05) 1px, transparent 1px)",
            backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />

        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
            transformOrigin: "0 0",
            transition: smoothPan
              ? "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)"
              : undefined,
          }}
        >
          <ChartConnectors
            edges={layout.edges}
            width={layout.width}
            height={layout.height}
          />
          {layout.positioned.map((p) => (
            <NodeCard
              key={p.node.employee.id}
              positioned={p}
              onToggle={toggle}
              animate={animateCards}
            />
          ))}
        </div>

        {/* Subtle edge fades hint that the canvas extends beyond the
            viewport without adding any real chrome. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-8"
          style={{
            background:
              "linear-gradient(to right, var(--color-canvas), transparent)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8"
          style={{
            background:
              "linear-gradient(to left, var(--color-canvas), transparent)",
          }}
        />
      </div>
    </div>
  );
}

function ChartConnectors({
  edges,
  width,
  height,
}: {
  edges: Edge[];
  width: number;
  height: number;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      {edges.map((e) => {
        const midY = (e.parentBottomY + e.childTopY) / 2;
        const r = 8;
        const goesRight = e.childX > e.parentX;
        const dx = Math.abs(e.childX - e.parentX);
        if (dx < 0.5) {
          return (
            <path
              key={e.key}
              d={`M ${e.parentX} ${e.parentBottomY} L ${e.childX} ${e.childTopY}`}
              stroke="var(--color-line-strong)"
              strokeWidth={1.25}
              fill="none"
              strokeLinecap="round"
            />
          );
        }
        const cornerR = Math.min(r, dx / 2, (e.childTopY - e.parentBottomY) / 2);
        const horizontalDir = goesRight ? 1 : -1;
        const d = [
          `M ${e.parentX} ${e.parentBottomY}`,
          `V ${midY - cornerR}`,
          `Q ${e.parentX} ${midY} ${e.parentX + horizontalDir * cornerR} ${midY}`,
          `H ${e.childX - horizontalDir * cornerR}`,
          `Q ${e.childX} ${midY} ${e.childX} ${midY + cornerR}`,
          `V ${e.childTopY}`,
        ].join(" ");
        return (
          <path
            key={e.key}
            d={d}
            stroke="var(--color-line-strong)"
            strokeWidth={1.25}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

function NodeCard({
  positioned,
  onToggle,
  animate,
}: {
  positioned: PositionedNode;
  onToggle: (id: string) => void;
  /** When false (e.g. mid-pan/pinch) skip the position-easing transition. */
  animate: boolean;
}) {
  const router = useRouter();
  const { node, x, y, isCollapsed } = positioned;
  const { employee } = node;
  const palette = teamColor(employee.team);
  const hasChildren = node.children.length > 0;
  const hiddenCount = isCollapsed ? node.descendantCount : 0;

  return (
    <div
      data-employee-id={employee.id}
      role="link"
      tabIndex={0}
      aria-label={`Open profile for ${employee.name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/people/${employee.id}`);
        }
      }}
      className="absolute cursor-pointer rounded-2xl border border-[color:var(--color-line-strong)] bg-white/95 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)] backdrop-blur transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.05),0_14px_30px_-12px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-grasp)]/60"
      style={{
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        borderLeft: `3px solid ${palette.fg}`,
        transition: animate
          ? "left 280ms cubic-bezier(0.4, 0, 0.2, 1), top 280ms cubic-bezier(0.4, 0, 0.2, 1)"
          : undefined,
      }}
    >
      <div className="flex h-full items-center gap-3 px-3.5 py-2.5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold tracking-wide"
          style={{ background: palette.bg, color: palette.fg }}
        >
          {initials(employee.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-medium text-ink">
              {employee.name}
            </span>
          </div>
          {employee.title ? (
            <p className="truncate text-[11.5px] text-[color:var(--color-muted)]">
              {employee.title}
            </p>
          ) : null}
          {employee.team ? (
            <p
              className="truncate text-[10.5px] font-medium uppercase tracking-[0.06em]"
              style={{ color: palette.fg, opacity: 0.85 }}
            >
              {employee.team}
            </p>
          ) : null}
        </div>
      </div>

      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(employee.id)}
          aria-label={isCollapsed ? "Expand reports" : "Collapse reports"}
          aria-expanded={!isCollapsed}
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-[color:var(--color-line-strong)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[color:var(--color-muted)] shadow-sm transition-colors hover:bg-canvas hover:text-ink"
        >
          {isCollapsed ? (
            <>
              <span>+{hiddenCount}</span>
              <Chevron direction="down" />
            </>
          ) : (
            <Chevron direction="up" />
          )}
        </button>
      ) : null}
    </div>
  );
}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      style={{
        transform: direction === "up" ? "rotate(180deg)" : undefined,
      }}
    >
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <path
        d="M6 2v8M2 6h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <path
        d="M2 6h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
