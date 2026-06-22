/**
 * Zod schemas for the Operations Studio workflow APIs (/api/studio).
 *
 * Structural validation only — a draft may legitimately contain gaps
 * (dangling ports, unbound stations); those are the diagnostics engine's
 * domain (src/lib/workflow/diagnostics.ts), and only PUBLISH blocks on its
 * error-severity findings. The schema enforces shape and referential
 * integrity inside the payload (every edge endpoint is a node in the same
 * body), never business rules.
 */

import { z } from 'zod';

/** Canvas node/edge ids: client-generated, url-safe. */
const CanvasIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9:_-]+$/i, 'ids are alphanumeric/:/_/- only');

/** Engine registry keys (e.g. 'list_ebay'). Existence is checked in the route. */
const NodeTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'node types are snake_case');

export const StudioGraphNodeSchema = z.object({
  id: CanvasIdSchema,
  type: NodeTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const StudioGraphEdgeSchema = z.object({
  id: CanvasIdSchema,
  source: CanvasIdSchema,
  sourcePort: z.string().min(1).max(64),
  target: CanvasIdSchema,
});

/**
 * Canvas sticky-note annotation (Phase E3) — a free-text decoration, NOT an
 * engine node. Text is length-bounded (a note, not a document); position is in
 * the same React Flow coordinate space as nodes; color is an optional tone key.
 */
export const StudioAnnotationSchema = z.object({
  id: CanvasIdSchema,
  text: z.string().max(2000),
  x: z.number().finite(),
  y: z.number().finite(),
  color: z.string().max(32).optional(),
});

export const StudioDraftCreateBody = z.object({
  /** Definition to copy from; omitted = the org's active definition. */
  sourceId: z.number().int().positive().optional(),
});
export type StudioDraftCreateInput = z.infer<typeof StudioDraftCreateBody>;

/**
 * Body for POST /api/studio/templates/[id]/import (Phase E4). `name` is an
 * optional override for the new definition's name; omitted = the template's
 * name. The clone collides safely by version, so a repeat import lands as the
 * next version of the same name rather than failing.
 */
export const StudioTemplateImportBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});
export type StudioTemplateImportInput = z.infer<typeof StudioTemplateImportBody>;

export const StudioGraphSaveBody = z
  .object({
    nodes: z.array(StudioGraphNodeSchema).max(200),
    edges: z.array(StudioGraphEdgeSchema).max(400),
    // Canvas sticky-notes (Phase E3): a decoration layer saved alongside the
    // graph. Bounded count; optional (older clients omit it → empty array).
    annotations: z.array(StudioAnnotationSchema).max(100).default([]),
  })
  .superRefine((body, ctx) => {
    const nodeIds = new Set(body.nodes.map((n) => n.id));
    if (nodeIds.size !== body.nodes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: 'duplicate node ids' });
    }
    const edgeIds = new Set(body.edges.map((e) => e.id));
    if (edgeIds.size !== body.edges.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edges'], message: 'duplicate edge ids' });
    }
    const annIds = new Set(body.annotations.map((a) => a.id));
    if (annIds.size !== body.annotations.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['annotations'], message: 'duplicate annotation ids' });
    }
    body.edges.forEach((e, i) => {
      if (!nodeIds.has(e.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'source'],
          message: `edge source "${e.source}" is not a node in this payload`,
        });
      }
      if (!nodeIds.has(e.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'target'],
          message: `edge target "${e.target}" is not a node in this payload`,
        });
      }
    });
  });
export type StudioGraphSaveInput = z.infer<typeof StudioGraphSaveBody>;
