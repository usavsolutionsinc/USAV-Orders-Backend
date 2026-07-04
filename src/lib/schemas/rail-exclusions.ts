import { z } from 'zod';
import {
  RECEIVING_RAIL_ENTITY_TYPES,
  RECEIVING_RAIL_FEED_KEYS,
} from '@/lib/receiving/rail-exclusions';

/** One (entity_type, entity_id) target for a rail dismiss/restore. */
const RailExclusionItemSchema = z.object({
  entityType: z.enum(RECEIVING_RAIL_ENTITY_TYPES),
  entityId: z.number().int().positive(),
});

/** POST (dismiss) / DELETE (restore) body. */
export const RailExclusionBody = z.object({
  feedKey: z.enum(RECEIVING_RAIL_FEED_KEYS),
  items: z.array(RailExclusionItemSchema).min(1).max(500),
});

export type RailExclusionBodyT = z.infer<typeof RailExclusionBody>;
