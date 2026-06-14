import { z } from 'zod';

/**
 * Request bodies for the org-scoped platform / type catalog CRUD
 * (/api/catalog/platforms, /api/catalog/types). Mirrors the sku-catalog schema
 * house style: trimmed strings, `.strict()`, update bodies require ≥1 field.
 *
 * `slug` is optional on create — the route derives it from `label` when absent
 * (see slugify in catalog-queries.ts) — and is never editable afterward, since
 * it is the per-org natural key callers resolve against.
 */

const trimmed = z.string().trim();
const slug = trimmed
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'slug must be lowercase letters, numbers, or underscores');

const typeKind = z.enum(['receiving', 'shipping', 'both']);

// ─── platforms ────────────────────────────────────────────────────────────────

export const PlatformCreateBody = z
  .object({
    label: trimmed.min(1, 'label is required'),
    slug: slug.optional(),
    tone: trimmed.min(1).nullable().optional(),
    provider: trimmed.min(1).nullable().optional(),
    sortOrder: z.number().int().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export const PlatformUpdateBody = z
  .object({
    label: trimmed.min(1).optional(),
    tone: trimmed.min(1).nullable().optional(),
    provider: trimmed.min(1).nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field must be provided' });

// ─── types ──────────────────────────────────────────────────────────────────

export const TypeCreateBody = z
  .object({
    label: trimmed.min(1, 'label is required'),
    slug: slug.optional(),
    kind: typeKind.optional(),
    isReturn: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export const TypeUpdateBody = z
  .object({
    label: trimmed.min(1).optional(),
    kind: typeKind.optional(),
    isReturn: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field must be provided' });
