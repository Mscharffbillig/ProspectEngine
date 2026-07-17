import { z } from "zod";

// Splits textarea input on newlines/commas into a clean string array.
export function toList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const campaignSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional().default(""),
  industries: z.array(z.string().min(1)).min(1, "At least one industry"),
  locations: z.array(z.string().min(1)).min(1, "At least one location"),
  min_company_size: z.coerce.number().int().min(0).optional().nullable(),
  max_company_size: z.coerce.number().int().min(0).optional().nullable(),
  include_keywords: z.array(z.string()),
  exclude_keywords: z.array(z.string()),
  preferred_characteristics: z.array(z.string()),
  excluded_characteristics: z.array(z.string()),
  workflow_problems: z.array(z.string()),
  geography: z.string().max(500).optional().default(""),
  max_candidates_per_run: z.coerce.number().int().min(1).max(500).default(50),
  min_qualification_score: z.coerce.number().int().min(-100).max(200).default(30),
  ai_enabled: z.coerce.boolean().default(false),
  status: z.enum(["draft", "active", "paused", "archived"]).default("active"),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

export const csvRowSchema = z.object({
  company_name: z.string().min(1),
  website: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  industry: z.string().optional().default(""),
  contact_name: z.string().optional().default(""),
  email: z
    .string()
    .optional()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Invalid email"),
  source: z.string().optional().default(""),
});

export type CsvRow = z.infer<typeof csvRowSchema>;
