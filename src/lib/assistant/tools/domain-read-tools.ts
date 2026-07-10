/**
 * Domain read-tool adapters — thin wrappers over existing helpers
 * (operations journey, orders context, serial lookup, warranty, assignments,
 * inbox queues, photos, receiving resolve, ticket entities).
 *
 * No new SQL. Injectable Deps for DB-free unit tests.
 */

import { z } from 'zod';
import {
  fetchOrdersContext,
  fetchShippedContext,
} from '@/lib/ai/context-fetchers';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { listSupportFollowupsForStaff } from '@/lib/inbox/support-followups-queries';
import { getAssignmentsWithStaff } from '@/lib/neon/assignments-queries';
import { isPrimaryTechStaff } from '@/lib/neon/staff-stations-queries';
import {
  findByNormalizedSerial,
  findShippedOrderByTsnSerial,
  findShippedOrderForSerialUnit,
} from '@/lib/neon/serial-units-queries';
import type { JourneyDimension } from '@/lib/operations/journey-helpers';
import {
  formatPhotoSearchForPrompt,
  searchPhotos,
} from '@/lib/photos/queries/search';
import { resolveShipmentForScan } from '@/lib/receiving/resolve-shipment-for-scan';
import { searchHitHref } from '@/lib/search/search-hit';
import {
  looksLikeTicketScan,
  resolveSupportTicketToReceiving,
} from '@/lib/support/tickets';
import type { OrgId } from '@/lib/tenancy/constants';
import { listClaims, getClaim } from '@/lib/warranty/claims';
import { lookupCoverage } from '@/lib/warranty/coverage';
import { getPackingKpisForDay } from '@/lib/packing/packer-kpi-queries';
import type { AssistantToolDef, AssistantToolDeps } from './types';

const rowLimit = (max: number, def: number) => z.number().int().min(1).max(max).default(def);

// ─── get_operations_journey ──────────────────────────────────────────────────
// journey.ts is `server-only` — lazy-load defaults so the tool registry stays
// importable from node:test (same pattern as search tools avoiding hermes-client).

export interface OperationsJourneyDeps {
  withTxn: <T>(
    orgId: OrgId,
    fn: (client: import('pg').PoolClient) => Promise<T>,
  ) => Promise<T>;
  resolve: (
    client: import('pg').PoolClient,
    orgId: OrgId,
    dim: JourneyDimension,
    value: string,
  ) => Promise<import('@/lib/operations/journey-helpers').EntityAnchors | null>;
  read: (
    client: import('pg').PoolClient,
    orgId: OrgId,
    anchors: import('@/lib/operations/journey-helpers').EntityAnchors,
    filters: import('@/lib/operations/journey-helpers').JourneyFilters,
  ) => Promise<import('@/lib/operations/journey-helpers').JourneyEvent[]>;
}

async function loadDefaultJourneyDeps(): Promise<OperationsJourneyDeps> {
  const [{ withTenantTransaction }, journey] = await Promise.all([
    import('@/lib/tenancy/db'),
    import('@/lib/operations/journey'),
  ]);
  return {
    withTxn: withTenantTransaction,
    resolve: journey.resolveEntity,
    read: journey.readJourneyEntity,
  };
}

const operationsJourneyInput = z.object({
  dim: z.enum(['order', 'serial', 'tracking']),
  value: z.string().min(1).max(200),
  limit: rowLimit(80, 40),
});

export const getOperationsJourney: AssistantToolDef<typeof operationsJourneyInput> = {
  name: 'get_operations_journey',
  description:
    'THE cross-station timeline for one order/serial/tracking — receiving → test → pack → ship → return → warranty. Use when the user asks "what happened to", "full history", "trace", or after hybrid_entity_search finds an id. Returns anchors + trimmed events with sources.',
  permission: 'operations.view',
  inputSchema: operationsJourneyInput,
  run: async (input, ctx, _deps) => {
    const journeyDeps =
      (_deps as AssistantToolDeps & { journey?: OperationsJourneyDeps }).journey ??
      (await loadDefaultJourneyDeps());
    return journeyDeps.withTxn(ctx.organizationId, async (client) => {
      const anchors = await journeyDeps.resolve(
        client,
        ctx.organizationId,
        input.dim as JourneyDimension,
        input.value.trim(),
      );
      if (!anchors) return { found: false as const, dim: input.dim, value: input.value.trim() };
      const events = await journeyDeps.read(client, ctx.organizationId, anchors, {
        limit: input.limit,
      } satisfies import('@/lib/operations/journey-helpers').JourneyFilters);
      // Trim raw payloads for the model context window.
      const trimmed = events.slice(0, input.limit).map((e) => ({
        source: e.source,
        id: e.id,
        at: e.at,
        group: e.group,
        summary: summarizeJourneyRaw(e.raw),
      }));
      return {
        found: true as const,
        anchors: {
          kind: anchors.kind,
          orderId: anchors.orderId,
          orderNumber: anchors.orderNumber,
          shipmentId: anchors.shipmentId,
          serials: anchors.serials,
          trackingNumbers: anchors.trackingNumbers,
        },
        events: trimmed,
        sources: [...new Set(trimmed.map((e) => e.source))],
        href: anchors.orderId
          ? searchHitHref('ORDER', anchors.orderId)
          : anchors.serialUnitIds?.[0]
            ? searchHitHref('SERIAL_UNIT', anchors.serialUnitIds[0])
            : null,
      };
    });
  },
};

function summarizeJourneyRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return String(raw ?? '');
  const o = raw as Record<string, unknown>;
  const parts = [
    o.type ?? o.event_type ?? o.action ?? o.status ?? null,
    o.station ?? o.source_station ?? null,
    o.notes ?? o.note ?? o.message ?? null,
  ].filter(Boolean);
  return parts.map(String).join(' · ').slice(0, 200) || JSON.stringify(o).slice(0, 160);
}

// ─── get_order_lookup ────────────────────────────────────────────────────────

export interface OrderLookupDeps {
  orders: typeof fetchOrdersContext;
  shipped: typeof fetchShippedContext;
}

const defaultOrderLookupDeps: OrderLookupDeps = {
  orders: fetchOrdersContext,
  shipped: fetchShippedContext,
};

export const getOrderLookup: AssistantToolDef<
  z.ZodObject<{
    orderId: z.ZodOptional<z.ZodString>;
    trackingNumber: z.ZodOptional<z.ZodString>;
  }>
> = {
  name: 'get_order_lookup',
  description:
    'Look up a specific order id or tracking number via live pending-order + shipped context blocks (same as Hermes enrichment). Use when the user names a concrete order/tracking and hybrid search is unnecessary. Prefer hybrid_entity_search for fuzzy product/SKU questions.',
  permission: 'dashboard.view',
  inputSchema: z
    .object({
      orderId: z.string().min(1).max(120).optional(),
      trackingNumber: z.string().min(1).max(120).optional(),
    })
    .refine((v) => v.orderId || v.trackingNumber, {
      message: 'orderId or trackingNumber is required',
    }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { orderLookup?: OrderLookupDeps }).orderLookup ??
      defaultOrderLookupDeps;
    const params = {
      orderId: input.orderId,
      trackingNumber: input.trackingNumber,
    };
    const [ordersBlock, shippedBlock] = await Promise.all([
      input.orderId ? d.orders(params, ctx.organizationId) : Promise.resolve(''),
      input.orderId || input.trackingNumber
        ? d.shipped(params, ctx.organizationId)
        : Promise.resolve(''),
    ]);
    const block = [ordersBlock, shippedBlock].map((b) => b.trim()).filter(Boolean).join('\n\n');
    return { found: block.length > 0, block: block || 'No matching order or tracking found.' };
  },
};

// ─── lookup_serial ───────────────────────────────────────────────────────────

export interface SerialLookupDeps {
  findUnit: typeof findByNormalizedSerial;
  findOrderForUnit: typeof findShippedOrderForSerialUnit;
  findOrderByTsn: typeof findShippedOrderByTsnSerial;
}

const defaultSerialLookupDeps: SerialLookupDeps = {
  findUnit: findByNormalizedSerial,
  findOrderForUnit: findShippedOrderForSerialUnit,
  findOrderByTsn: findShippedOrderByTsnSerial,
};

export const lookupSerial: AssistantToolDef<z.ZodObject<{ serial: z.ZodString }>> = {
  name: 'lookup_serial',
  description:
    'Resolve a serial for return-intake / shipped-order match: serial_units row + matched order (allocation or legacy TSN path). Distinct from get_unit_journey (workflow story) and get_operations_journey (cross-station timeline). Use for "is this a return", "which order shipped this serial".',
  permission: 'dashboard.view',
  inputSchema: z.object({ serial: z.string().min(3).max(120) }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { serialLookup?: SerialLookupDeps }).serialLookup ??
      defaultSerialLookupDeps;
    const serial = input.serial.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const unit = await d.findUnit(serial, ctx.organizationId);
    if (unit) {
      const matched = await d.findOrderForUnit(
        Number(unit.id),
        { organizationId: ctx.organizationId },
        ctx.organizationId,
      );
      return {
        found: true as const,
        is_return: Boolean(matched),
        unit: {
          id: Number(unit.id),
          serial_number: unit.serial_number,
          sku: unit.sku,
          current_status: unit.current_status,
          condition_grade: unit.condition_grade,
          current_location: unit.current_location,
        },
        matched_order: matched
          ? {
              order_pk: matched.order_pk,
              order_id: matched.order_id,
              product_title: matched.product_title,
              tracking_number: matched.tracking_number,
              allocation_state: matched.allocation_state,
            }
          : null,
        href: searchHitHref('SERIAL_UNIT', Number(unit.id)),
      };
    }
    const tsnMatch = await d.findOrderByTsn(
      serial,
      { organizationId: ctx.organizationId },
      ctx.organizationId,
    );
    if (!tsnMatch) return { found: false as const, serial };
    return {
      found: true as const,
      is_return: true,
      unit: null,
      matched_order: {
        order_pk: tsnMatch.order_pk,
        order_id: tsnMatch.order_id,
        product_title: tsnMatch.product_title,
        tracking_number: tsnMatch.tracking_number,
        allocation_state: tsnMatch.allocation_state,
      },
      href: searchHitHref('ORDER', Number(tsnMatch.order_pk)),
    };
  },
};

// ─── lookup_warranty_coverage ────────────────────────────────────────────────

export interface WarrantyCoverageDeps {
  lookup: typeof lookupCoverage;
  flagOn: typeof isWarrantyLogger;
}

const defaultWarrantyCoverageDeps: WarrantyCoverageDeps = {
  lookup: lookupCoverage,
  flagOn: isWarrantyLogger,
};

export const lookupWarrantyCoverage: AssistantToolDef<z.ZodObject<{ q: z.ZodString }>> = {
  name: 'lookup_warranty_coverage',
  description:
    'Check warranty coverage for an order #, serial, or SKU — start/expiry dates, days remaining, existing claim. Use for "is this under warranty", "when does warranty expire". Gracefully reports unavailable when WARRANTY_LOGGER is off.',
  permission: 'warranty.view',
  inputSchema: z.object({ q: z.string().min(1).max(200) }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { warrantyCoverage?: WarrantyCoverageDeps }).warrantyCoverage ??
      defaultWarrantyCoverageDeps;
    if (!d.flagOn()) return { available: false as const, reason: 'WARRANTY_LOGGER flag is OFF' };
    const coverage = await d.lookup(input.q.trim(), ctx.organizationId);
    return { available: true as const, coverage };
  },
};

// ─── list_warranty_claims ────────────────────────────────────────────────────

export interface WarrantyClaimsDeps {
  list: typeof listClaims;
  get: typeof getClaim;
  flagOn: typeof isWarrantyLogger;
}

const defaultWarrantyClaimsDeps: WarrantyClaimsDeps = {
  list: listClaims,
  get: getClaim,
  flagOn: isWarrantyLogger,
};

export const listWarrantyClaims: AssistantToolDef<
  z.ZodObject<{
    status: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    claimId: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'list_warranty_claims',
  description:
    'List or fetch warranty claims for this org. Pass claimId for one claim detail; otherwise filter by status/search. Use for "open warranty claims", "claim for order X".',
  permission: 'warranty.view',
  inputSchema: z.object({
    status: z.string().max(40).optional(),
    search: z.string().max(120).optional(),
    claimId: z.number().int().positive().optional(),
    limit: rowLimit(100, 25),
  }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { warrantyClaims?: WarrantyClaimsDeps }).warrantyClaims ??
      defaultWarrantyClaimsDeps;
    if (!d.flagOn()) return { available: false as const, reason: 'WARRANTY_LOGGER flag is OFF' };
    if (input.claimId) {
      const claim = await d.get(input.claimId, ctx.organizationId);
      return { available: true as const, claim };
    }
    const claims = await d.list(
      {
        status: (input.status as never) ?? null,
        search: input.search ?? null,
        limit: input.limit,
      },
      ctx.organizationId,
    );
    return { available: true as const, claims, count: claims.length };
  },
};

// ─── get_assignments ─────────────────────────────────────────────────────────

export interface AssignmentsDeps {
  list: typeof getAssignmentsWithStaff;
}

const defaultAssignmentsDeps: AssignmentsDeps = { list: getAssignmentsWithStaff };

export const getAssignments: AssistantToolDef<
  z.ZodObject<{
    entityType: z.ZodOptional<z.ZodString>;
    workType: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
    assignedTechId: z.ZodOptional<z.ZodNumber>;
    includeClosed: z.ZodDefault<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'get_assignments',
  description:
    'List work assignments with staff names (test/pack/repair queues). Filter by entityType, workType, status, assignedTechId. Use for "who is assigned", "open test assignments".',
  permission: 'work_orders.view',
  inputSchema: z.object({
    entityType: z.string().max(40).optional(),
    workType: z.string().max(40).optional(),
    status: z.string().max(40).optional(),
    assignedTechId: z.number().int().positive().optional(),
    includeClosed: z.boolean().default(false),
    limit: rowLimit(200, 50),
  }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { assignments?: AssignmentsDeps }).assignments ??
      defaultAssignmentsDeps;
    const assignments = await d.list(
      {
        entityType: input.entityType as never,
        workType: input.workType as never,
        status: input.status as never,
        assignedTechId: input.assignedTechId,
        includeClosed: input.includeClosed,
        limit: input.limit,
      },
      ctx.organizationId,
    );
    return { assignments, count: assignments.length };
  },
};

// ─── get_my_tech_queue ───────────────────────────────────────────────────────

export interface TechQueueDeps {
  isPrimaryTech: typeof isPrimaryTechStaff;
  query: AssistantToolDeps['query'];
}

const REP_LINE_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT rl.id AS line_id,
           rl.source_order_id,
           rl.zoho_purchaseorder_number AS line_po,
           COALESCE(zi.name, rl.item_name, rl.sku) AS product_title
      FROM receiving_lines rl
      LEFT JOIN items zi
        ON zi.zoho_item_id = rl.zoho_item_id AND zi.status = 'active'
       AND zi.organization_id = rl.organization_id
     WHERE rl.receiving_id = r.id AND rl.organization_id = $1
     ORDER BY rl.id ASC
     LIMIT 1
  ) rep ON true`;

export const getMyTechQueue: AssistantToolDef<z.ZodObject<Record<string, never>>> = {
  name: 'get_my_tech_queue',
  description:
    "The signed-in tech's personal inbox: return cartons pending test + priority order-ready-to-ship cartons (same as /api/inbox/tech-queue). Uses ctx.staffId — no staff id from the model.",
  permission: 'dashboard.view',
  inputSchema: z.object({}),
  run: async (_input, ctx, deps) => {
    if (!ctx.staffId) {
      return { items: [], counts: { return_pending_test: 0, order_ready_ship: 0 }, reason: 'no_staff' };
    }
    const techDeps = (deps as AssistantToolDeps & { techQueue?: TechQueueDeps }).techQueue;
    const isPrimary =
      techDeps?.isPrimaryTech ?? isPrimaryTechStaff;
    const query = techDeps?.query ?? deps.query;
    const isTech = await isPrimary(ctx.staffId, ctx.organizationId);
    if (!isTech) {
      return {
        items: [],
        counts: { return_pending_test: 0, order_ready_ship: 0 },
        reason: 'not_primary_tech',
      };
    }
    const [returns, ready] = await Promise.all([
      query(
        ctx.organizationId,
        `SELECT r.id AS receiving_id,
                rep.line_id,
                stn.tracking_number_raw AS tracking_number,
                rep.source_order_id AS order_number,
                rep.product_title,
                r.unboxed_at::text AS unboxed_at
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           ${REP_LINE_LATERAL}
          WHERE COALESCE(r.is_return, false) = true
            AND r.unboxed_at IS NOT NULL
            AND r.organization_id = $1
            AND EXISTS (
              SELECT 1 FROM receiving_lines rl
               LEFT JOIN receiving_line_testing rlt
                 ON rlt.receiving_line_id = rl.id AND rlt.organization_id = rl.organization_id
               WHERE rl.receiving_id = r.id
                 AND rl.organization_id = $1
                 AND COALESCE(rlt.needs_test, true) = true
                 AND COALESCE(rl.workflow_status::text, '') NOT IN ('DONE','PASSED','FAILED','RTV','SCRAP')
            )
          ORDER BY r.unboxed_at DESC
          LIMIT 50`,
        [ctx.organizationId],
      ),
      query(
        ctx.organizationId,
        `SELECT r.id AS receiving_id,
                rep.line_id,
                stn.tracking_number_raw AS tracking_number,
                COALESCE(rep.source_order_id, rep.line_po, r.zoho_purchaseorder_number) AS order_number,
                rep.product_title,
                r.unboxed_at::text AS unboxed_at
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           ${REP_LINE_LATERAL}
          WHERE COALESCE(r.is_priority, false) = true
            AND r.unboxed_at IS NOT NULL
            AND r.organization_id = $1
            AND r.unboxed_at >= NOW() - INTERVAL '3 days'
          ORDER BY r.unboxed_at DESC
          LIMIT 50`,
        [ctx.organizationId],
      ),
    ]);
    const items = [
      ...returns.rows.map((row) => ({ kind: 'return_pending_test' as const, ...row })),
      ...ready.rows.map((row) => ({ kind: 'order_ready_ship' as const, ...row })),
    ];
    return {
      items,
      counts: {
        return_pending_test: returns.rows.length,
        order_ready_ship: ready.rows.length,
      },
    };
  },
};

// ─── list_support_followups ──────────────────────────────────────────────────

export interface SupportFollowupsDeps {
  list: typeof listSupportFollowupsForStaff;
}

const defaultSupportFollowupsDeps: SupportFollowupsDeps = {
  list: listSupportFollowupsForStaff,
};

export const listSupportFollowups: AssistantToolDef<z.ZodObject<Record<string, never>>> = {
  name: 'list_support_followups',
  description:
    "Support tickets assigned to the signed-in staff for follow-up (same as /api/inbox/support). Uses ctx.staffId.",
  permission: 'dashboard.view',
  inputSchema: z.object({}),
  run: async (_input, ctx, deps) => {
    if (!ctx.staffId) return { items: [], count: 0, reason: 'no_staff' };
    const d =
      (deps as AssistantToolDeps & { supportFollowups?: SupportFollowupsDeps }).supportFollowups ??
      defaultSupportFollowupsDeps;
    const items = await d.list(ctx.organizationId, ctx.staffId);
    return { items, count: items.length };
  },
};

// ─── search_photos ───────────────────────────────────────────────────────────

export interface PhotosSearchDeps {
  search: typeof searchPhotos;
  format: typeof formatPhotoSearchForPrompt;
}

const defaultPhotosSearchDeps: PhotosSearchDeps = {
  search: searchPhotos,
  format: formatPhotoSearchForPrompt,
};

export const searchPhotosTool: AssistantToolDef<
  z.ZodObject<{
    q: z.ZodOptional<z.ZodString>;
    poRef: z.ZodOptional<z.ZodString>;
    damageDetected: z.ZodOptional<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'search_photos',
  description:
    'Search the media library by PO ref, free text, or damage flag. Returns a prompt-ready photo block plus structured rows. Use for "photos of PO", "damage photos".',
  permission: 'photos.view',
  inputSchema: z.object({
    q: z.string().max(200).optional(),
    poRef: z.string().max(120).optional(),
    damageDetected: z.boolean().optional(),
    limit: rowLimit(50, 15),
  }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { photosSearch?: PhotosSearchDeps }).photosSearch ??
      defaultPhotosSearchDeps;
    const rows = await d.search({
      organizationId: ctx.organizationId,
      q: input.q ?? null,
      poRef: input.poRef ?? null,
      damageDetected: input.damageDetected ?? null,
      limit: input.limit,
    });
    return { count: rows.length, block: d.format(rows), photos: rows };
  },
};

// ─── get_receiving_by_tracking ───────────────────────────────────────────────

export interface ReceivingByTrackingDeps {
  resolve: typeof resolveShipmentForScan;
  resolveTicket: (
    orgId: OrgId,
    scan: string,
  ) => Promise<{ receivingId: number; lineId?: number; supportTicketId: number } | null>;
}

const defaultReceivingByTrackingDeps: ReceivingByTrackingDeps = {
  resolve: resolveShipmentForScan,
  resolveTicket: resolveSupportTicketToReceiving,
};

export const getReceivingByTracking: AssistantToolDef<
  z.ZodObject<{ scanValue: z.ZodString }>
> = {
  name: 'get_receiving_by_tracking',
  description:
    'Read-only resolve of a tracking number, last-8, or #ticket to a receiving carton (no scan side-effects). Use for "which carton is tracking X", "open receiving for this scan". Prefer resolve_support_ticket for pure ticket questions.',
  permission: 'receiving.view',
  inputSchema: z.object({ scanValue: z.string().min(1).max(120) }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { receivingByTracking?: ReceivingByTrackingDeps })
        .receivingByTracking ?? defaultReceivingByTrackingDeps;
    const raw = input.scanValue.trim();
    if (looksLikeTicketScan(raw)) {
      const ticket = await d.resolveTicket(ctx.organizationId, raw);
      if (ticket) {
        return {
          found: true as const,
          via: 'support_ticket' as const,
          receivingId: ticket.receivingId,
          lineId: ticket.lineId ?? null,
          supportTicketId: ticket.supportTicketId,
          href: searchHitHref('RECEIVING', ticket.receivingId),
        };
      }
    }
    const resolved = await d.resolve(raw, ctx.organizationId);
    if (!resolved.receivingId && !resolved.shipmentId) {
      return { found: false as const, scanValue: raw, matchKind: resolved.matchKind };
    }
    return {
      found: Boolean(resolved.receivingId),
      via: 'shipment_scan' as const,
      receivingId: resolved.receivingId,
      shipmentId: resolved.shipmentId,
      receivingSource: resolved.receivingSource,
      matchKind: resolved.matchKind,
      href: resolved.receivingId ? searchHitHref('RECEIVING', resolved.receivingId) : null,
    };
  },
};

// ─── get_ticket_entities ─────────────────────────────────────────────────────
// zendesk-links → nas-agent-client is `server-only` — lazy default.

export interface TicketEntitiesDeps {
  get: (
    orgId: string,
    zendeskTicketId: number,
  ) => Promise<{ type: string; id: number; source: string } | null>;
}

async function loadDefaultTicketEntitiesDeps(): Promise<TicketEntitiesDeps> {
  const { getTicketEntity } = await import('@/lib/zendesk-links');
  return { get: getTicketEntity };
}

export const getTicketEntities: AssistantToolDef<
  z.ZodObject<{ zendeskTicketId: z.ZodNumber }>
> = {
  name: 'get_ticket_entities',
  description:
    'Resolve a Zendesk ticket id to its linked entity (ticket_links / external_id / unfound overlay) — reverse linkage, not only receiving. Use after resolve_support_ticket when you need the provider-native id path.',
  permission: 'receiving.view',
  inputSchema: z.object({ zendeskTicketId: z.number().int().positive() }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { ticketEntities?: TicketEntitiesDeps }).ticketEntities ??
      (await loadDefaultTicketEntitiesDeps());
    const entity = await d.get(ctx.organizationId, input.zendeskTicketId);
    if (!entity) return { found: false as const, zendeskTicketId: input.zendeskTicketId };
    return { found: true as const, entity };
  },
};

// ─── get_packing_kpi ─────────────────────────────────────────────────────────

export interface PackingKpiDeps {
  forDay: typeof getPackingKpisForDay;
}

const defaultPackingKpiDeps: PackingKpiDeps = { forDay: getPackingKpisForDay };

export const getPackingKpi: AssistantToolDef<
  z.ZodObject<{ dayPst: z.ZodOptional<z.ZodString> }>
> = {
  name: 'get_packing_kpi',
  description:
    'Packing station KPIs for a Pacific calendar day — per-packer small/medium/large counts, weighted minutes, and org capacity targets. Use for "packing pace today", "who packed most", "are we on capacity". Prefer local_ops intercept for simple shipped-count questions.',
  permission: 'operations.view',
  inputSchema: z.object({
    dayPst: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('YYYY-MM-DD in America/Los_Angeles; defaults to today PST'),
  }),
  run: async (input, ctx, deps) => {
    const d =
      (deps as AssistantToolDeps & { packingKpi?: PackingKpiDeps }).packingKpi ??
      defaultPackingKpiDeps;
    const day =
      input.dayPst ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    const summary = await d.forDay(ctx.organizationId, day);
    return { dayPst: day, ...summary };
  },
};
