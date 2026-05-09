import Papa from "papaparse";
import { z } from "zod";

/**
 * Strict-but-forgiving CSV row schema for the org chart upload.
 *
 * Required columns: name, email
 * Optional columns: title, team, manager_email
 *
 * Header matching is case-insensitive and tolerant of common variants
 * ("Manager Email", "managerEmail", etc.).
 */
const rowSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email"),
  title: z.string().trim().optional().default(""),
  team: z.string().trim().optional().default(""),
  manager_email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .default(""),
});

export type ParsedEmployeeRow = z.infer<typeof rowSchema>;

export interface ParseResult {
  rows: ParsedEmployeeRow[];
  errors: { row: number; message: string }[];
}

const HEADER_ALIASES: Record<string, keyof ParsedEmployeeRow> = {
  name: "name",
  fullname: "name",
  full_name: "name",
  email: "email",
  emailaddress: "email",
  email_address: "email",
  workemail: "email",
  work_email: "email",
  title: "title",
  jobtitle: "title",
  job_title: "title",
  role: "title",
  team: "team",
  department: "team",
  group: "team",
  manageremail: "manager_email",
  manager_email: "manager_email",
  managersemail: "manager_email",
  reportsto: "manager_email",
  reports_to: "manager_email",
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-]/g, "");
}

export function parseOrgChartCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => {
      const key = normalizeHeader(h);
      return HEADER_ALIASES[key] ?? key;
    },
  });

  const rows: ParsedEmployeeRow[] = [];
  const errors: { row: number; message: string }[] = [];

  parsed.data.forEach((raw, idx) => {
    const result = rowSchema.safeParse({
      name: raw.name,
      email: raw.email,
      title: raw.title ?? "",
      team: raw.team ?? "",
      manager_email: raw.manager_email ?? "",
    });
    if (result.success) {
      rows.push(result.data);
    } else {
      errors.push({
        row: idx + 2, // +1 for header, +1 for 1-indexed
        message: result.error.errors[0]?.message ?? "Invalid row",
      });
    }
  });

  // De-duplicate by email (keep first occurrence).
  const seen = new Set<string>();
  const dedup = rows.filter((r) => {
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return true;
  });

  return { rows: dedup, errors };
}

export const ORG_CHART_CSV_TEMPLATE =
  "name,email,title,team,manager_email\n" +
  "Jane Doe,jane@company.com,VP Sales,Sales,ceo@company.com\n" +
  "John Smith,john@company.com,Sales Rep,Sales,jane@company.com\n";
