"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";
import { defaultCheckInTemplateRows } from "@/lib/rollout-schedule";

/**
 * Create an empty draft change plan and route into the wizard.
 *
 * The wizard's per-step server actions own all subsequent persistence —
 * this entry point only needs the bare minimum to land a row that the
 * wizard can attach to. A working title is set by default so the row is
 * not literally nameless on the list view.
 */
const NewSchema = z.object({
  name: z
    .string()
    .trim()
    .max(140)
    .optional()
    .transform((v) => (v ? v : "Untitled draft")),
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function createChangePlan(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    redirect("/sign-in");
  }

  const parsed = NewSchema.safeParse({
    name: formData.get("name"),
    summary: formData.get("summary"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");
  }

  const created = await prisma.changePlan.create({
    data: {
      organizationId: session!.user.organizationId!,
      createdByUserId: session!.user.id,
      name: parsed.data.name,
      summary: parsed.data.summary,
      lastSavedAt: new Date(),
    },
    select: { id: true },
  });

  await prisma.rolloutCheckInTemplate.createMany({
    data: defaultCheckInTemplateRows(created.id),
    skipDuplicates: true,
  });

  revalidatePath("/changes");
  revalidatePath("/dashboard");

  redirect(`/changes/${created.id}/intake`);
}
