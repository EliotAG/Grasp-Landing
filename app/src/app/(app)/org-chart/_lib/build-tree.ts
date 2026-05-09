/**
 * Pure helpers that turn the flat Employee[] from Prisma into a sorted
 * tree structure for the org-chart page.
 *
 * The page renders both a "tree" view and a "by team" view; both want a
 * consistent ordering for executives (CEO first, COO under, etc.) so the
 * sort lives here next to the tree shaping.
 *
 * Cycle / orphan defense:
 *   - Employees whose managerEmployeeId references a missing employee
 *     are promoted to additional roots rather than dropped.
 *   - A visited set during recursion guarantees we never loop, even if
 *     the upload action ever lets a malformed cycle slip through.
 */
import type { Employee } from "@prisma/client";

export interface TreeNode {
  employee: Employee;
  depth: number;
  /** Total descendants beneath this node (sum across all subtrees). */
  descendantCount: number;
  children: TreeNode[];
}

export interface BuiltTree {
  roots: TreeNode[];
  /** Maximum tree depth across all roots; 1 = roots only. */
  maxDepth: number;
  /** Distinct non-empty `team` values present in the chart. */
  teamCount: number;
}

// Lower rank sorts earlier. Anything not listed sorts last in alpha order.
// Mirrors the spec's "Executive at the top of the chart" intuition without
// hardcoding a particular pilot's team names too tightly.
const TEAM_RANK: Record<string, number> = {
  Executive: 0,
  Sales: 1,
  Engineering: 2,
  Operations: 3,
  IT: 4,
  Finance: 5,
};

// Within a sibling group, prefer the more senior title up top. Heuristic
// keyword match on the title string — simple, predictable, easy to extend.
const TITLE_RANK: { keyword: RegExp; rank: number }[] = [
  { keyword: /\bCEO\b/i, rank: 0 },
  { keyword: /\bCOO\b/i, rank: 1 },
  { keyword: /\bCFO\b/i, rank: 2 },
  { keyword: /\bCTO\b/i, rank: 3 },
  { keyword: /\b(SVP|EVP)\b/i, rank: 4 },
  { keyword: /\bVP\b/i, rank: 5 },
  { keyword: /\bDirector\b/i, rank: 6 },
  { keyword: /\bManager\b/i, rank: 7 },
  { keyword: /\bLead\b/i, rank: 8 },
];

function teamRank(team: string | null): number {
  if (!team) return 100;
  return TEAM_RANK[team] ?? 99;
}

function titleRank(title: string | null): number {
  if (!title) return 100;
  for (const { keyword, rank } of TITLE_RANK) {
    if (keyword.test(title)) return rank;
  }
  return 99;
}

function compareSiblings(a: Employee, b: Employee): number {
  const t = titleRank(a.title) - titleRank(b.title);
  if (t !== 0) return t;
  return a.name.localeCompare(b.name);
}

function compareRoots(a: Employee, b: Employee): number {
  const t = teamRank(a.team) - teamRank(b.team);
  if (t !== 0) return t;
  return compareSiblings(a, b);
}

export function buildTree(employees: Employee[]): BuiltTree {
  const byId = new Map<string, Employee>();
  for (const e of employees) byId.set(e.id, e);

  // Bucket children by their (resolved) parent id; orphans go to "roots".
  const childrenByParent = new Map<string | null, Employee[]>();
  for (const e of employees) {
    const parentId =
      e.managerEmployeeId && byId.has(e.managerEmployeeId)
        ? e.managerEmployeeId
        : null;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(e);
    childrenByParent.set(parentId, list);
  }

  const visited = new Set<string>();

  function buildNode(employee: Employee, depth: number): TreeNode {
    visited.add(employee.id);
    const rawChildren = childrenByParent.get(employee.id) ?? [];
    const children = rawChildren
      .filter((c) => !visited.has(c.id))
      .sort(compareSiblings)
      .map((c) => buildNode(c, depth + 1));
    const descendantCount = children.reduce(
      (sum, c) => sum + 1 + c.descendantCount,
      0,
    );
    return { employee, depth, descendantCount, children };
  }

  const rootEmployees = (childrenByParent.get(null) ?? []).slice().sort(compareRoots);
  const roots = rootEmployees.map((e) => buildNode(e, 0));

  // Any employee never reached (cycle survivors) becomes a fallback root
  // so they remain visible in the UI rather than silently dropped.
  for (const e of employees) {
    if (!visited.has(e.id)) {
      roots.push(buildNode(e, 0));
    }
  }

  let maxDepth = 0;
  function walkDepth(node: TreeNode) {
    if (node.depth + 1 > maxDepth) maxDepth = node.depth + 1;
    for (const c of node.children) walkDepth(c);
  }
  for (const r of roots) walkDepth(r);

  const teamCount = new Set(
    employees.map((e) => (e.team ?? "").trim()).filter(Boolean),
  ).size;

  return { roots, maxDepth, teamCount };
}

/**
 * Deterministic 2-letter initials from a full name.
 * "Marcus Reilly" → "MR", "Cher" → "CH", "Mary Anne O'Hara" → "MO".
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Six muted hues mapped from a team name via a stable hash. Picked to
 * sit comfortably alongside the canvas + grasp tokens in globals.css.
 */
const TEAM_PALETTE = [
  { bg: "rgba(46, 125, 50, 0.10)", fg: "#2e7d32" },   // grasp green
  { bg: "rgba(120, 90, 160, 0.10)", fg: "#5b3f87" },  // muted plum
  { bg: "rgba(180, 120, 60, 0.10)", fg: "#8a5a1f" },  // muted ochre
  { bg: "rgba(60, 110, 160, 0.10)", fg: "#2c5d8a" },  // muted blue
  { bg: "rgba(160, 80, 90, 0.10)", fg: "#7a3a44" },   // muted clay
  { bg: "rgba(80, 110, 90, 0.10)", fg: "#3f5a48" },   // muted moss
] as const;

export function teamColor(team: string | null): { bg: string; fg: string } {
  const key = (team ?? "Unassigned").trim() || "Unassigned";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}
