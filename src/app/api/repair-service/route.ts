import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { createCrudHandler, ApiError } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  appendRepairStatusHistory,
  getAllRepairs,
  updateRepairStatus,
  updateRepairNotes,
  updateRepairField,
  searchRepairs,
  createRepair,
  REPAIR_STATUS_OPTIONS,
  type RepairTab,
} from '@/lib/neon/repair-service-queries';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import type { AuthContext } from '@/lib/auth/auth-context';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';
import pool from '@/lib/db';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';

const ROUTE_REPAIR_SERVICE_POST = 'repair-service.post';

// ── Validation schemas ───────────────────────────────────────

const updateRepairSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(Number),
  status: z.string().optional(),
  notes: z.string().optional(),
  field: z.string().optional(),
  value: z.unknown().optional(),
  statusHistoryEntry: z.any().optional(),
});

// Manual repair-service entry (not the Zendesk-coupled /api/repair/submit
// intake form). A lightweight ticket an operator types in directly. Only the
// product title is required; everything else is optional and additive.
const createRepairSchema = z.object({
  productTitle: z.string().trim().min(1).max(300),
  contactInfo: z.string().trim().max(300).optional().default(''),
  price: z.string().trim().max(40).optional().default(''),
  issue: z.string().trim().max(2000).optional().default(''),
  serialNumber: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(4000).nullish(),
  ticketNumber: z.string().trim().max(120).nullish(),
  status: z.enum(REPAIR_STATUS_OPTIONS).optional(),
  // Linkage fields can be supplied at creation (manual pairing on intake).
  sourceOrderId: z.string().trim().max(120).nullish(),
  sourceTrackingNumber: z.string().trim().max(120).nullish(),
  sourceSku: z.string().trim().max(120).nullish(),
  intakeChannel: z.string().trim().max(40).optional(),
  // Optional client-supplied idempotency key (also accepted via Idempotency-Key
  // header) — replays the original 201 instead of double-creating a ticket.
  idempotencyKey: z.string().trim().max(200).nullish(),
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
    const orgId = params.organizationId ?? USAV_ORG_ID;
    const repairs = await getAllRepairs(params.limit, params.offset, { tab }, orgId);
    return { rows: repairs };
  },

  search: async (query, params) => {
    const tab = normalizeTab(params.tab);
    const orgId = params.organizationId ?? USAV_ORG_ID;
    return searchRepairs(query, { tab }, orgId);
  },

  update: async (body, _req, organizationId) => {
    const { id, status, notes, field, value, statusHistoryEntry } = body;

    if (!id) throw ApiError.badRequest('ID is required');

    const orgId = organizationId ?? USAV_ORG_ID;
    if (status) await updateRepairStatus(id, status, orgId);
    if (notes !== undefined) await updateRepairNotes(id, notes, orgId);
    if (field && value !== undefined) await updateRepairField(id, field, value, orgId);
    if (statusHistoryEntry) await appendRepairStatusHistory(id, statusHistoryEntry, orgId);

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
async function patchWithRealtime(req: NextRequest, ctx: { organizationId: string }) {
  // Clone the request so we can read body twice (once here for realtime, once in handler)
  const clonedReq = req.clone();
  const response = await originalPatch(req, ctx);

  // If successful, publish realtime event
  if (response.status === 200) {
    try {
      const body = await clonedReq.json();
      if (body?.id) {
        await publishRepairChanged({
          organizationId: ctx.organizationId,
          repairIds: [Number(body.id)],
          source: 'repair-service.patch',
        });
      }
    } catch {
      // Non-critical
    }
  }

  return response;
}

// POST — manual repair-service entry. Org-scoped create; audited; realtime.
async function createRepairHandler(req: NextRequest, ctx: AuthContext) {
  const raw = await req.json().catch(() => null);
  const parsed = createRepairSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // ─── Idempotency replay ───────────────────────────────────────────────────
  const idemKey = readIdempotencyKey(req, d.idempotencyKey ?? null);
  if (idemKey) {
    const hit = await getApiIdempotencyResponse(
      pool,
      ctx.organizationId,
      idemKey,
      ROUTE_REPAIR_SERVICE_POST,
    );
    if (hit) {
      return Response.json(hit.response_body, { status: hit.status_code });
    }
  }

  const repair = await createRepair(
    {
      productTitle: d.productTitle,
      contactInfo: d.contactInfo ?? '',
      price: d.price ?? '',
      issue: d.issue ?? '',
      serialNumber: d.serialNumber ?? '',
      notes: d.notes ?? null,
      ticketNumber: d.ticketNumber ?? null,
      status: d.status,
      sourceSystem: 'manual',
      sourceOrderId: d.sourceOrderId ?? null,
      sourceTrackingNumber: d.sourceTrackingNumber ?? null,
      sourceSku: d.sourceSku ?? null,
      intakeChannel: d.intakeChannel ?? 'manual',
      receivedByStaffId: ctx.staffId ?? null,
    },
    ctx.organizationId,
  );

  await invalidateCacheTags(['repair-service']);
  await publishRepairChanged({
    organizationId: ctx.organizationId,
    repairIds: [repair.id],
    source: 'repair-service.create',
  });
  await recordAudit(pool, ctx, req, {
    source: 'repair-service-api',
    action: AUDIT_ACTION.REPAIR_SERVICE_CREATE,
    entityType: AUDIT_ENTITY.REPAIR_SERVICE,
    entityId: repair.id,
    after: { ...repair },
  });

  const responseBody = { success: true, repair };
  if (idemKey) {
    await saveApiIdempotencyResponse(pool, {
      orgId: ctx.organizationId,
      idempotencyKey: idemKey,
      route: ROUTE_REPAIR_SERVICE_POST,
      staffId: ctx.staffId,
      statusCode: 201,
      responseBody,
    });
  }

  return Response.json(responseBody, { status: 201 });
}

export const GET = withAuth(handler.GET as any, { permission: 'repair.view', feature: 'repair' });
export const PATCH = withAuth(patchWithRealtime as any, { permission: 'repair.mark_repaired', feature: 'repair' });
export const POST = withAuth(createRepairHandler as any, { permission: 'repair.intake', feature: 'repair' });
