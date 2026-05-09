import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { readOrgApproval } from "@/lib/access";
import { isAgentGraspAdminSession } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (!session.user.organizationId) redirect("/onboarding");

  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    select: { name: true },
  });

  const userLabel =
    session.user.name?.trim() || session.user.email || "Signed in";
  const userInitial = (
    session.user.name?.trim()?.[0] ||
    session.user.email?.[0] ||
    "?"
  ).toUpperCase();

  const { approved: orgApproved } = readOrgApproval(session);

  return (
    <AppShell
      orgName={org?.name ?? "Workspace"}
      userLabel={userLabel}
      userInitial={userInitial}
      orgApproved={orgApproved}
      showAdminNav={isAgentGraspAdminSession(session)}
    >
      {children}
    </AppShell>
  );
}
