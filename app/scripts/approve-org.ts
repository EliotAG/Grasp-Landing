/**
 * Approve a Grasp workspace for live activation.
 *
 * Usage (local against .env.local):
 *   pnpm dotenv -e .env.local -- pnpm tsx scripts/approve-org.ts <slug>
 *   pnpm dotenv -e .env.local -- pnpm tsx scripts/approve-org.ts --list
 *
 * Usage against production (pull the env first):
 *   vercel env pull .env.production --environment=production
 *   pnpm dotenv -e .env.production -- pnpm tsx scripts/approve-org.ts <slug>
 *
 * The slug comes from `Organization.slug` and is shown in the address
 * bar / dashboard. To find it without leaving the terminal: `--list`.
 *
 * Pass `--revoke` to undo (rare; mostly for testing the gate UX).
 *
 * Approving sets `Organization.approvedAt = now()`, which the session
 * callback in lib/auth.ts reads on every request. Members of the org
 * see the pilot banner disappear on next page load (JWT sessions
 * re-evaluate the callback automatically; no logout required).
 */

import { prisma } from "@/lib/db";

async function listPending() {
  const orgs = await prisma.organization.findMany({
    where: { approvedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      slug: true,
      name: true,
      createdAt: true,
      _count: {
        select: { memberships: true, employees: true, changePlans: true },
      },
    },
  });

  if (orgs.length === 0) {
    console.log("No pending workspaces.");
    return;
  }

  console.log(`${orgs.length} pending workspace(s):\n`);
  for (const o of orgs) {
    const age = Math.round(
      (Date.now() - o.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    console.log(
      `  ${o.slug.padEnd(28)}  ${o.name}  ` +
        `(${age}d old · ${o._count.memberships} member(s), ` +
        `${o._count.employees} employees, ` +
        `${o._count.changePlans} plan(s))`,
    );
  }
  console.log(
    "\nApprove with:  pnpm tsx scripts/approve-org.ts <slug>",
  );
}

async function approve(slug: string, revoke: boolean) {
  const org = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, approvedAt: true },
  });
  if (!org) {
    console.error(`No workspace with slug "${slug}".`);
    process.exit(1);
  }

  if (revoke) {
    if (!org.approvedAt) {
      console.log(`"${org.name}" is already pending approval — no change.`);
      return;
    }
    await prisma.organization.update({
      where: { id: org.id },
      data: { approvedAt: null },
    });
    console.log(`Revoked approval for "${org.name}" (${slug}).`);
    return;
  }

  if (org.approvedAt) {
    console.log(
      `"${org.name}" was already approved at ${org.approvedAt.toISOString()} — no change.`,
    );
    return;
  }

  const approvedAt = new Date();
  await prisma.organization.update({
    where: { id: org.id },
    data: { approvedAt },
  });
  console.log(
    `Approved "${org.name}" (${slug}) at ${approvedAt.toISOString()}.`,
  );
  console.log(
    "Members will see the closed-pilot banner disappear on next page load.",
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage:\n" +
        "  pnpm tsx scripts/approve-org.ts <slug>            approve workspace\n" +
        "  pnpm tsx scripts/approve-org.ts <slug> --revoke   revoke approval\n" +
        "  pnpm tsx scripts/approve-org.ts --list            list pending workspaces",
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args[0] === "--list") {
    await listPending();
    return;
  }

  const slug = args[0]!.trim();
  const revoke = args.includes("--revoke");
  await approve(slug, revoke);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
