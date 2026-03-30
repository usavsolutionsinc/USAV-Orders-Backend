import { z } from 'zod';
import { createCrudHandler, ApiError } from '@/lib/api';
import {
  appendRepairStatusHistory,
  getAllRepairs,
  updateRepairStatus,
  updateRepairNotes,
  updateRepairField,
  searchRepairs,
  type RepairTab,
} from '@/lib/neon/repair-service-queries';
import { publishRepairChanged } from '@/lib/realtime/publish';

// ── Validation schemas ───────────────────────────────────────

const updateRepairSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(Number),
  status: z.string().optional(),
  notes: z.string().optional(),
  field: z.string().optional(),
  value: z.unknown().optional(),
  statusHistoryEntry: z.any().optional(),
});

// ── Tab normalization ────────────────────────────────────────

function normalizeTab(raw: string): RepairTab {
  if (raw === 'incoming') return 'incoming';
  if (raw === 'done') return 'done';
  return 'active';
}

// ── Handler ──────────────────────────────────────────────────

const handler = createCrudHandler({
  name: 'repair-service',
  cacheNamespace: 'api:repair-service',
  cacheTTL: 300,
  cacheTags: ['repair-service'],

  updateSchema: updateRepairSchema,

  list: async (params) => {
    const tab = normalizeTab(params.tab);
    const repairs = await getAllRepairs(params.limit, params.offset, { tab });
    return { rows: repairs };
  },

  search: async (query, params) => {
    const tab = normalizeTab(params.tab);
    return searchRepairs(query, { tab });
  },

  update: async (body) => {
    const { id, status, notes, field, value, statusHistoryEntry } = body;

    if (!id) throw ApiError.badRequest('ID is required');

    if (status) await updateRepairStatus(id, status);
    if (notes !== undefined) await updateRepairNotes(id, notes);
    if (field && value !== undefined) await updateRepairField(id, field, value);
    if (statusHistoryEntry) await appendRepairStatusHistory(id, statusHistoryEntry);

    return { success: true as const };
  },

  hooks: {
    afterUpdate: async (result) => {
      // Publish realtime event — the body.id was already validated by the schema
      // We access it via the update function's closure over body
    },
  },
});

// Override PATCH to include realtime publishing with the parsed body
const originalPatch = handler.PATCH;
handler.PATCH = async function PATCH(req) {
  // Clone the request so we can read body twice (once here for realtime, once in handler)
  const clonedReq = req.clone();
  const response = await originalPatch(req);

  // If successful, publish realtime event
  if (response.status === 200) {
    try {
      const body = await clonedReq.json();
      if (body?.id) {
        await publishRepairChanged({
          repairIds: [Number(body.id)],
          source: 'repair-service.patch',
        });
      }
    } catch {
      // Non-critical
    }
  }

  return response;
};

export const { GET, PATCH } = handler;
