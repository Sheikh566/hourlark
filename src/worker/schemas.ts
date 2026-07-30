import { z } from "zod";

import { roles } from "@/domain/types";

export const idSchema = z.string().uuid();
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const isoTimestampSchema = z.iso.datetime({ offset: true });

export const timerInputSchema = z.object({
  description: z.string().trim().max(500).default(""),
  project_id: idSchema.nullable().optional(),
  tag_ids: z.array(idSchema).max(20).default([]),
  billable: z.boolean().optional(),
});

export const entryCreateSchema = timerInputSchema.extend({
  member_id: idSchema.optional(),
  started_at: isoTimestampSchema,
  stopped_at: isoTimestampSchema,
  rate_minor: z.number().int().min(0).nullable().optional(),
  rate_currency: currencySchema.nullable().optional(),
});

export const entryUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    description: z.string().trim().max(500).optional(),
    project_id: idSchema.nullable().optional(),
    tag_ids: z.array(idSchema).max(20).optional(),
    started_at: isoTimestampSchema.optional(),
    stopped_at: isoTimestampSchema.nullable().optional(),
    billable: z.boolean().optional(),
    rate_minor: z.number().int().min(0).nullable().optional(),
    rate_currency: currencySchema.nullable().optional(),
    recalculate_rate: z.boolean().optional(),
    override_reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (value) => value.rate_minor === undefined || value.rate_minor === null || value.rate_currency,
    { message: "Currency is required with an explicit rate.", path: ["rate_currency"] },
  );

export const entryListQuerySchema = z.object({
  start: isoTimestampSchema,
  end: isoTimestampSchema,
  member_id: idSchema.optional(),
  project_id: idSchema.optional(),
  client_id: idSchema.optional(),
  tag_id: idSchema.optional(),
  billable: z.enum(["true", "false"]).optional(),
  running: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(200).optional(),
  include_deleted: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

export const clientInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  billing_contact_name: z.string().trim().max(200).nullable().optional(),
  billing_email: z.email().nullable().optional(),
  billing_address: z.string().trim().max(2000).nullable().optional(),
  tax_identifier: z.string().trim().max(100).nullable().optional(),
  default_rate_minor: z.number().int().min(0).nullable().optional(),
  currency: currencySchema,
  notes: z.string().trim().max(5000).nullable().optional(),
});

export const projectInputSchema = z.object({
  client_id: idSchema,
  name: z.string().trim().min(1).max(200),
  color: colorSchema,
  billable_default: z.boolean(),
  hourly_rate_minor: z.number().int().min(0).nullable().optional(),
  currency: currencySchema,
  budget_minutes: z.number().int().min(0).nullable().optional(),
  visibility: z.enum(["all", "assigned"]),
  notes: z.string().trim().max(5000).nullable().optional(),
  member_ids: z.array(idSchema).default([]),
  confirm_client_change: z.boolean().optional(),
});

export const tagInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: colorSchema,
});

export const memberCreateSchema = z.object({
  email: z.email(),
  display_name: z.string().trim().min(1).max(200),
  role: z.enum(roles).default("member"),
  timezone: z.string().trim().min(1),
  weekly_target_minutes: z.number().int().min(0).nullable().optional(),
});

export const memberUpdateSchema = z.object({
  version: z.number().int().positive(),
  display_name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(roles).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  timezone: z.string().trim().min(1).optional(),
  weekly_target_minutes: z.number().int().min(0).nullable().optional(),
  project_ids: z.array(idSchema).optional(),
});

export const settingsUpdateSchema = z.object({
  version: z.number().int().positive(),
  app_name: z.string().trim().min(1).max(100).optional(),
  company_name: z.string().trim().min(1).max(200).optional(),
  company_domain: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).optional(),
  currency: currencySchema.optional(),
  week_start: z.enum(["monday", "sunday"]).optional(),
  allowed_email_domains: z.array(z.string().trim().min(1)).min(1).optional(),
  default_rate_minor: z.number().int().min(0).nullable().optional(),
  members_can_set_billable: z.boolean().optional(),
  lock_entries_after_days: z.number().int().min(0).nullable().optional(),
  rounding_increment_minutes: z
    .union([
      z.literal(0),
      z.literal(1),
      z.literal(5),
      z.literal(6),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ])
    .optional(),
  rounding_method: z.enum(["nearest", "up", "down"]).optional(),
  report_show_descriptions: z.boolean().optional(),
  report_show_tags: z.boolean().optional(),
  report_show_members: z.boolean().optional(),
});

export const reportQuerySchema = entryListQuerySchema
  .omit({ include_deleted: true, limit: true })
  .extend({
    timezone: z.string().trim().min(1),
    group_by: z
      .enum(["client", "project", "member", "day", "week", "month", "description"])
      .default("project"),
    secondary_group_by: z
      .enum(["client", "project", "member", "day", "week", "month", "description"])
      .optional(),
    cursor: z.string().optional(),
    page_size: z.coerce.number().int().min(1).max(200).default(100),
    sort: z.enum(["started_desc", "started_asc", "duration_desc"]).default("started_desc"),
  });

export const pdfExportSchema = reportQuerySchema.extend({
  client_id: idSchema,
  project_ids: z.array(idSchema).default([]),
  title: z.string().trim().min(1).max(200).default("Time Report"),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  show_members: z.boolean().default(true),
  show_descriptions: z.boolean().default(true),
  show_tags: z.boolean().default(true),
  show_rates: z.boolean().default(true),
  pdf_grouping: z.enum(["project", "date"]).default("project"),
});
