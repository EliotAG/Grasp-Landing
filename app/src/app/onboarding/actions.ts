"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(2, "Name is too short").max(80),
});

export async function createOrganization(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.organizationId) redirect("/dashboard");

  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "Invalid name");
  }

  const baseSlug = slugify(parsed.data.name) || "workspace";
  let slug = baseSlug;
  let suffix = 1;

  // Race-condition-free slug collision retry.
  while (true) {
    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) break;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  await prisma.organization.create({
    data: {
      name: parsed.data.name,
      slug,
      memberships: {
        create: {
          userId: session.user.id,
          role: "owner",
        },
      },
    },
  });

  // Org info is hydrated in the session callback on every request, so the
  // next page load will see the new membership without any token refresh.
  redirect("/dashboard");
}
