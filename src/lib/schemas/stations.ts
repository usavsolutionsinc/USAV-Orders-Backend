/**
 * Zod schemas for the station-builder API (/api/stations).
 *
 * Structural validation only — REGISTRY validation (does this block/source/
 * action id exist, is the block allowed in that slot) happens in the route
 * against src/lib/stations, so the schema doesn't have to chase the registry.
 */

import { z } from 'zod';
import { SLOT_IDS } from '@/lib/stations/contract';

const KeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, 'keys are alphanumeric/_/- only');

export const BlockInstanceSchema = z.object({
  id: KeySchema,
  block: KeySchema,
  source: z
    .object({
      id: z.string().min(1).max(128),
      filters: z.record(z.string(), z.unknown()).optional(),
      fields: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  display: z.record(z.string(), z.unknown()).optional(),
  actions: z.array(z.string().min(1).max(128)).max(20).optional(),
  done_when: z.string().min(1).max(128).nullable().optional(),
});
export type BlockInstanceInput = z.infer<typeof BlockInstanceSchema>;

export const StationConfigSchema = z.object({
  slots: z.union([
    z.literal('legacy'),
    z
      .object(
        Object.fromEntries(
          SLOT_IDS.map((slot) => [slot, z.array(BlockInstanceSchema).max(12).optional()]),
        ) as Record<(typeof SLOT_IDS)[number], z.ZodOptional<z.ZodArray<typeof BlockInstanceSchema>>>,
      )
      .strict(),
  ]),
});
export type StationConfigInput = z.infer<typeof StationConfigSchema>;

export const StationDraftSaveBody = z.object({
  pageKey: KeySchema,
  modeKey: KeySchema,
  label: z.string().min(1).max(120),
  workflowNodeId: z.string().max(128).nullable().optional(),
  config: StationConfigSchema,
});
export type StationDraftSaveInput = z.infer<typeof StationDraftSaveBody>;

export const StationPublishBody = z.object({
  id: z.number().int().positive(),
});

// ─── Node-bound stations (Operations Studio Phase D / ST5) ───────────────────
// The node id is taken from the request PATH (never the body, like orgId). The
// body only carries the editable composition: a label + the slots config. The
// reserved page_key/mode_key are derived server-side from the node id.

export const NodeStationSaveBody = z.object({
  label: z.string().min(1).max(120),
  config: StationConfigSchema,
});
export type NodeStationSaveInput = z.infer<typeof NodeStationSaveBody>;

export const NodeStationPublishBody = z.object({
  id: z.number().int().positive(),
});
export type NodeStationPublishInput = z.infer<typeof NodeStationPublishBody>;
