"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";
import { parseOrgChartCsv } from "@/lib/csv";

export type UploadResult = {
  ok: boolean;
  inserted?: number;
  errors?: { row: number; message: string }[];
  message?: string;
};

export async function uploadOrgChart(formData: FormData): Promise<UploadResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return { ok: false, message: "You must be signed in to a workspace." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Please choose a CSV file." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, message: "File too large (limit 5 MB)." };
  }

  const text = await file.text();
  const { rows, errors } = parseOrgChartCsv(text);

  if (rows.length === 0) {
    return {
      ok: false,
      message:
        errors[0]?.message ??
        "No valid rows found. Check that the file has name and email columns.",
      errors,
    };
  }

  const organizationId = session.user.organizationId;

  // Wipe + reinsert. Idempotent and matches "replace the chart" UX.
  // For pilot scale (~50–150 employees) this is fast enough not to need a
  // diff/upsert pass.
  //
  // Two-phase within a transaction so concurrent uploads can't interleave:
  //   1. delete everyone, then create without manager links
  //   2. resolve manager_email → managerEmployeeId and update
  const inserted = await prisma.$transaction(async (tx) => {
    await tx.employee.deleteMany({ where: { organizationId } });

    await tx.employee.createMany({
      data: rows.map((r) => ({
        organizationId,
        name: r.name,
        email: r.email,
        title: r.title || null,
        team: r.team || null,
      })),
    });

    const created = await tx.employee.findMany({
      where: { organizationId },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(created.map((r) => [r.email, r.id]));

    for (const r of rows) {
      if (!r.manager_email) continue;
      const managerId = idByEmail.get(r.manager_email);
      const employeeId = idByEmail.get(r.email);
      if (!managerId || !employeeId) continue;
      await tx.employee.update({
        where: { id: employeeId },
        data: { managerEmployeeId: managerId },
      });
    }

    return created.length;
  });

  revalidatePath("/org-chart");
  revalidatePath("/dashboard");

  return { ok: true, inserted, errors };
}
