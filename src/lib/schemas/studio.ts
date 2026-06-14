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

export const StudioDraftCreateBody = z.object({
  /** Definition to copy from; omitted = the org's active definition. */
  sourceId: z.number().int().positive().optional(),
});
export type StudioDraftCreateInput = z.infer<typeof StudioDraftCreateBody>;

export const StudioGraphSaveBody = z
  .object({
    nodes: z.array(StudioGraphNodeSchema).max(200),
    edges: z.array(StudioGraphEdgeSchema).max(400),
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
