/**
 * Assistant read tools (plan §3.1 + Sparkles exact-data wiring) — the AI's
 * eyes over the org's operation: signals, journeys, feeds, graph, benchmarks,
 * KPIs, notes, mutation + chat history, plus the search narrow waist
 * (hybrid / exact / support-ticket resolve).
 *
 * Conventions:
 *   • Every SQL leads with `organization_id = $1` (explicit predicate on top
 *     of the tenant-pool GUC). The single deliberate variation is
 *     insight_links, whose global seeded rows are `organization_id IS NULL`
 *     by design (migration 2026-07-03n).
 *   • workflow_nodes/workflow_edges carry no org column — tenant scope rides
 *     the parent workflow_definitions row, so graph tools verify definition
 *     ownership first and join through it (never trust a bare definition id).
 *   • Search tools return SearchHit[] (or ticket→receiving refs) via existing
 *     domain helpers — never inline SQL for entity lookup.
 *   • Row caps everywhere: these results land in a model context window.
 */

import { z } from 'zod';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@/lib/search/build-search-text';
import { searchAllEntities } from '@/lib/search/global-entity-search';
import { hybridSearch } from '@/lib/search/hybrid-retrieval';
import { searchHitHref } from '@/lib/search/search-hit';
import {
  formatSupportTicketLabel,
  resolveSupportTicketToReceiving,
} from '@/lib/support/tickets';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { AssistantToolCtx, AssistantToolDef, AssistantToolDeps } from './types';

/** Thin adapters — same bodies as search-tools.ts executors, without importing
 *  hermes-client (server-only) into the assistant registry / unit tests. */
async function runHybridEntitySearch(
  orgId: OrgId,
  args: { query: string; entityTypes?: string[]; limit?: number },
) {
  const rawTypes = Array.isArray(args.entityTypes) ? args.entityTypes : [];
  const entityTypes = rawTypes.filter((t): t is SearchEntityType =>
    (SEARCH_ENTITY_TYPES as readonly string[]).includes(t),
  );
  const limit =
    typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit > 0
      ? args.limit
      : undefined;
  return hybridSearch(orgId, String(args.query ?? ''), {
    entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
    limit,
  });
}

async function runExactIdSerialSearch(
  orgId: OrgId,
  args: { query: string; limit?: number },
) {
  const results = await searchAllEntities(orgId, args.query, args.limit ?? 20);
  return results.map((r, rank) => ({ ...r, score: 1000 - rank, chips: [] }));
}

const rangeDays = z.number().int().min(1).max(365).default(30);
const rowLimit = (max: number, def: number) => z.number().int().min(1).max(max).default(def);

// ─── entity_signals aggregates ───────────────────────────────────────────────

export const getSignalsByNode: AssistantToolDef<
  z.ZodObject<{
    nodeId: z.ZodOptional<z.ZodString>;
    signalKind: z.ZodOptional<z.ZodString>;
    rangeDays: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'get_signals_by_node',
  description:
    'Aggregate "why" signals grouped by workflow node: for each node (and signal kind), the count and most recent occurrence in the range. Use to see WHERE problems cluster on the operations graph. Filter by nodeId and/or signalKind (return_reason | warranty_denial | exception_why | triage_outcome | test_fail_reason | buyer_note).',
  permission: 'dashboard.view',
  inputSchema: z.object({
    nodeId: z.string().max(128).optional(),
    signalKind: z.string().max(64).optional(),
    rangeDays,
  }),
  run: async (input, ctx, deps) => {
    const r = await deps.query(
      ctx.organizationId,
      `SELECT node_id, signal_kind, reason_code,
              COUNT(*)::int AS count,
              MAX(occurred_at)::text AS last_occurred_at
         FROM entity_signals
        WHERE organization_id = $1
          AND occurred_at >= NOW() - make_interval(days => $2)
          AND ($3::text IS NULL OR node_id = $3)
          AND ($4::text IS NULL OR signal_kind = $4)
        GROUP BY node_id, signal_kind, reason_code
        ORDER BY count DESC
        LIMIT 100`,
      [ctx.organizationId, input.rangeDays, input.nodeId ?? null, input.signalKind ?? null],
    );
    return { rangeDays: input.rangeDays, groups: r.rows };
  },
};

export const getTopReasons: AssistantToolDef<
  z.ZodObject<{
    signalKind: z.ZodOptional<z.ZodString>;
    entityType: z.ZodOptional<z.ZodString>;
    rangeDays: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'get_top_reasons',
  description:
    'Top reasons across the org in a date range: signal counts grouped by (signal_kind, reason_code) with a sample note. Answers "why are units failing testing this week", "top return reasons this month". Optionally scope to one signalKind or entityType (RECEIVING | RECEIVING_LINE | SERIAL_UNIT | ORDER | FBA_SHIPMENT | REPAIR | WARRANTY_CLAIM).',
  permission: 'dashboard.view',
  inputSchema: z.object({
    signalKind: z.string().max(64).optional(),
    entityType: z.string().max(32).optional(),
    rangeDays,
    limit: rowLimit(50, 15),
  }),
  run: async (input, ctx, deps) => {
    const r = await deps.query(
      ctx.organizationId,
      `SELECT signal_kind, reason_code,
              COUNT(*)::int AS count,
              MAX(occurred_at)::text AS last_occurred_at,
              (ARRAY_AGG(notes ORDER BY occurred_at DESC) FILTER (WHERE notes IS NOT NULL))[1] AS sample_note
         FROM entity_signals
        WHERE organization_id = $1
          AND occurred_at >= NOW() - make_interval(days => $2)
          AND ($3::text IS NULL OR signal_kind = $3)
          AND ($4::text IS NULL OR entity_type = $4)
        GROUP BY signal_kind, reason_code
        ORDER BY count DESC
        LIMIT $5`,
      [ctx.organizationId, input.rangeDays, input.signalKind ?? null, input.entityType ?? null, input.limit],
    );
    return { rangeDays: input.rangeDays, reasons: r.rows };
  },
};

// ─── unit journey ────────────────────────────────────────────────────────────

export const getUnitJourney: AssistantToolDef<
  z.ZodObject<{ serial: z.ZodOptional<z.ZodString>; serialUnitId: z.ZodOptional<z.ZodNumber> }>
> = {
  name: 'get_unit_journey',
  description:
    'One serialized unit\'s full story: identity + current status, its workflow-engine position, its lifecycle event trail (newest first), and its "why" signals. Look up by serial number or serial_unit id.',
  permission: 'dashboard.view',
  inputSchema: z
    .object({
      serial: z.string().min(3).max(120).optional(),
      serialUnitId: z.number().int().positive().optional(),
    })
    .refine((v) => v.serial || v.serialUnitId, { message: 'serial or serialUnitId is required' }),
  run: async (input, ctx, deps) => {
    const normalized = input.serial ? input.serial.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    const unit = await deps.query(
      ctx.organizationId,
      `SELECT id, serial_number, normalized_serial, sku, current_status,
              current_location, created_at::text AS created_at
         FROM serial_units
        WHERE organization_id = $1
          AND ($2::int IS NOT NULL AND id = $2
               OR $3::text IS NOT NULL AND normalized_serial = $3)
        ORDER BY id DESC
        LIMIT 1`,
      [ctx.organizationId, input.serialUnitId ?? null, normalized],
    );
    if (unit.rows.length === 0) return { found: false as const };
    const unitId = Number((unit.rows[0] as { id: number }).id);

    const [events, engine, signals] = await Promise.all([
      deps.query(
        ctx.organizationId,
        `SELECT event_type, prev_status, next_status, station, notes,
                occurred_at::text AS at
           FROM inventory_events
          WHERE organization_id = $1 AND serial_unit_id = $2
          ORDER BY id DESC
          LIMIT 60`,
        [ctx.organizationId, unitId],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT s.workflow_definition_id, s.current_node_id, s.status,
                s.entered_node_at::text AS entered_node_at, n.type AS node_type
           FROM item_workflow_state s
           LEFT JOIN workflow_nodes n ON n.id = s.current_node_id
          WHERE s.organization_id = $1 AND s.serial_unit_id = $2
          LIMIT 1`,
        [ctx.organizationId, unitId],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT signal_kind, reason_code, notes, severity, occurred_at::text AS at
           FROM entity_signals
          WHERE organization_id = $1 AND entity_type = 'SERIAL_UNIT' AND entity_id = $2
          ORDER BY occurred_at DESC
          LIMIT 20`,
        [ctx.organizationId, unitId],
      ),
    ]);

    return {
      found: true as const,
      unit: unit.rows[0],
      engine: engine.rows[0] ?? null,
      events: events.rows,
      signals: signals.rows,
    };
  },
};

// ─── feeds ───────────────────────────────────────────────────────────────────

export const getFeedState: AssistantToolDef<
  z.ZodObject<{
    feedKey: z.ZodString;
    staffId: z.ZodOptional<z.ZodNumber>;
    station: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'get_feed_state',
  description:
    "One operator feed's working set: counts by state plus the newest items (memberships minus the given staff member's dismissals when staffId+station are provided). Feed keys: receiving_triage | receiving_unbox | testing_queue | orders_unshipped | fba_outbound | repairs_queue | warranty_claims. NOTE: feeds are populated from Phase 4 onward — empty results before that are expected, not an error.",
  permission: 'dashboard.view',
  inputSchema: z.object({
    feedKey: z.string().max(64),
    staffId: z.number().int().positive().optional(),
    station: z.string().max(20).optional(),
    limit: rowLimit(50, 20),
  }),
  run: async (input, ctx, deps) => {
    const exclusionJoin = `
      LEFT JOIN staff_rail_exclusions x
        ON x.organization_id = m.organization_id
       AND x.feed_key = m.feed_key
       AND x.entity_type = m.entity_type
       AND x.entity_id = m.entity_id
       AND x.staff_id = $4 AND x.station = $5`;
    const useExclusions = input.staffId != null && !!input.station;
    const r = await deps.query(
      ctx.organizationId,
      `SELECT m.entity_type, m.entity_id, m.state, m.priority_tier, m.title,
              m.subtitle, m.tone, m.node_id, m.occurred_at::text AS occurred_at
         FROM feed_memberships m
         ${useExclusions ? exclusionJoin : ''}
        WHERE m.organization_id = $1 AND m.feed_key = $2
          AND m.state <> 'done'
          ${useExclusions ? 'AND x.id IS NULL' : ''}
        ORDER BY m.occurred_at DESC
        LIMIT $3`,
      useExclusions
        ? [ctx.organizationId, input.feedKey, input.limit, input.staffId, input.station]
        : [ctx.organizationId, input.feedKey, input.limit],
    );
    const counts = await deps.query(
      ctx.organizationId,
      `SELECT state, COUNT(*)::int AS count
         FROM feed_memberships
        WHERE organization_id = $1 AND feed_key = $2
        GROUP BY state`,
      [ctx.organizationId, input.feedKey],
    );
    return { feedKey: input.feedKey, counts: counts.rows, items: r.rows };
  },
};

// ─── graph ───────────────────────────────────────────────────────────────────

async function resolveDefinition(
  ctx: AssistantToolCtx,
  deps: AssistantToolDeps,
  definitionId?: number,
): Promise<Record<string, unknown> | null> {
  const r = await deps.query(
    ctx.organizationId,
    definitionId
      ? `SELECT id, name, version, is_active FROM workflow_definitions
          WHERE organization_id = $1 AND id = $2 LIMIT 1`
      : `SELECT id, name, version, is_active FROM workflow_definitions
          WHERE organization_id = $1 AND is_active = TRUE
          ORDER BY version DESC LIMIT 1`,
    definitionId ? [ctx.organizationId, definitionId] : [ctx.organizationId],
  );
  return r.rows[0] ?? null;
}

export const getGraph: AssistantToolDef<z.ZodObject<{ definitionId: z.ZodOptional<z.ZodNumber> }>> = {
  name: 'get_graph',
  description:
    "The org's operations workflow graph: nodes (id, type, config) and edges (source port → target). Defaults to the ACTIVE definition; pass definitionId for a draft. Use before explaining or proposing graph changes.",
  permission: 'studio.view',
  inputSchema: z.object({ definitionId: z.number().int().positive().optional() }),
  run: async (input, ctx, deps) => {
    const definition = await resolveDefinition(ctx, deps, input.definitionId);
    if (!definition) return { found: false as const };
    const defId = Number(definition.id);
    const [nodes, edges] = await Promise.all([
      deps.query(
        ctx.organizationId,
        `SELECT id, type, config FROM workflow_nodes WHERE workflow_definition_id = $1 ORDER BY position_x ASC`,
        [defId],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT id, source_node, source_port, target_node FROM workflow_edges WHERE workflow_definition_id = $1`,
        [defId],
      ),
    ]);
    return { found: true as const, definition, nodes: nodes.rows, edges: edges.rows };
  },
};

export const getNodeDetail: AssistantToolDef<
  z.ZodObject<{ nodeId: z.ZodString; definitionId: z.ZodOptional<z.ZodNumber> }>
> = {
  name: 'get_node_detail',
  description:
    'One workflow node in depth: type + config, its outbound wiring, live occupancy (units parked at it by engine status), declared surfaces (node_surfaces), and its recent signals. Use when a user asks about a specific station/step.',
  permission: 'studio.view',
  inputSchema: z.object({
    nodeId: z.string().max(128),
    definitionId: z.number().int().positive().optional(),
  }),
  run: async (input, ctx, deps) => {
    const definition = await resolveDefinition(ctx, deps, input.definitionId);
    if (!definition) return { found: false as const };
    const defId = Number(definition.id);

    const node = await deps.query(
      ctx.organizationId,
      `SELECT id, type, config FROM workflow_nodes WHERE workflow_definition_id = $1 AND id = $2 LIMIT 1`,
      [defId, input.nodeId],
    );
    if (node.rows.length === 0) return { found: false as const };

    const [edges, occupancy, surfaces, signals] = await Promise.all([
      deps.query(
        ctx.organizationId,
        `SELECT source_port, target_node FROM workflow_edges
          WHERE workflow_definition_id = $1 AND source_node = $2`,
        [defId, input.nodeId],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT status, COUNT(*)::int AS count
           FROM item_workflow_state
          WHERE organization_id = $1 AND workflow_definition_id = $2 AND current_node_id = $3
          GROUP BY status`,
        [ctx.organizationId, defId, input.nodeId],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT feed_key, role, config FROM node_surfaces
          WHERE organization_id = $1 AND workflow_definition_id = $2 AND node_id = $3`,
        [ctx.organizationId, defId, input.nodeId],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT signal_kind, reason_code, COUNT(*)::int AS count
           FROM entity_signals
          WHERE organization_id = $1 AND node_id = $2
            AND occurred_at >= NOW() - make_interval(days => 30)
          GROUP BY signal_kind, reason_code
          ORDER BY count DESC
          LIMIT 20`,
        [ctx.organizationId, input.nodeId],
      ),
    ]);

    return {
      found: true as const,
      definition,
      node: node.rows[0],
      edges: edges.rows,
      occupancy: occupancy.rows,
      surfaces: surfaces.rows,
      recentSignals: signals.rows,
    };
  },
};

// ─── benchmarks + KPIs ───────────────────────────────────────────────────────

export const getBenchmarks: AssistantToolDef<
  z.ZodObject<{ subjectKind: z.ZodOptional<z.ZodString>; subjectRef: z.ZodOptional<z.ZodString> }>
> = {
  name: 'get_benchmarks',
  description:
    'Industry benchmarks and comparisons (insight_links): typical values for the used-electronics-reseller vertical (test-fail %, return %, receive→list days) plus any org-specific rows. Use for "how do we compare to typical". Global seeded rows have organizationId null.',
  permission: 'dashboard.view',
  inputSchema: z.object({
    subjectKind: z.string().max(32).optional(),
    subjectRef: z.string().max(128).optional(),
  }),
  run: async (input, ctx, deps) => {
    // Deliberate variation: global seeded rows are organization_id IS NULL by
    // design (migration 2026-07-03n) — a tenant reads global + own.
    const r = await deps.query(
      ctx.organizationId,
      `SELECT organization_id, linkage_type, subject_kind, subject_ref, metrics, source,
              created_at::text AS created_at
         FROM insight_links
        WHERE (organization_id = $1 OR organization_id IS NULL)
          AND ($2::text IS NULL OR subject_kind = $2)
          AND ($3::text IS NULL OR subject_ref = $3)
        ORDER BY organization_id NULLS LAST, subject_kind, subject_ref
        LIMIT 100`,
      [ctx.organizationId, input.subjectKind ?? null, input.subjectRef ?? null],
    );
    return { benchmarks: r.rows };
  },
};

export const getKpis: AssistantToolDef<z.ZodObject<{ rangeDays: z.ZodDefault<z.ZodNumber> }>> = {
  name: 'get_kpis',
  description:
    'Org-scoped operational KPIs for a range: lifecycle event counts by type (received, tested, packed, shipped, returned...) and signal counts by kind. The raw material for throughput/quality questions and benchmark comparisons.',
  permission: 'dashboard.view',
  inputSchema: z.object({ rangeDays }),
  run: async (input, ctx, deps) => {
    const [events, signals] = await Promise.all([
      deps.query(
        ctx.organizationId,
        `SELECT event_type, COUNT(*)::int AS count
           FROM inventory_events
          WHERE organization_id = $1 AND occurred_at >= NOW() - make_interval(days => $2)
          GROUP BY event_type
          ORDER BY count DESC
          LIMIT 40`,
        [ctx.organizationId, input.rangeDays],
      ),
      deps.query(
        ctx.organizationId,
        `SELECT signal_kind, COUNT(*)::int AS count
           FROM entity_signals
          WHERE organization_id = $1 AND occurred_at >= NOW() - make_interval(days => $2)
          GROUP BY signal_kind
          ORDER BY count DESC`,
        [ctx.organizationId, input.rangeDays],
      ),
    ]);
    return { rangeDays: input.rangeDays, eventCounts: events.rows, signalCounts: signals.rows };
  },
};

// ─── search + history ────────────────────────────────────────────────────────

export const searchNotes: AssistantToolDef<
  z.ZodObject<{
    query: z.ZodString;
    signalKind: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'search_notes',
  description:
    'Full-text search over signal notes and reason codes (buyer notes, return reasons, tech fail notes, exception reasons). Supports quoted phrases and OR. Returns matching signals newest-first.',
  permission: 'dashboard.view',
  inputSchema: z.object({
    query: z.string().min(2).max(200),
    signalKind: z.string().max(64).optional(),
    limit: rowLimit(50, 20),
  }),
  run: async (input, ctx, deps) => {
    const r = await deps.query(
      ctx.organizationId,
      `SELECT entity_type, entity_id, signal_kind, reason_code, notes, severity,
              occurred_at::text AS at
         FROM entity_signals
        WHERE organization_id = $1
          AND notes_tsv @@ websearch_to_tsquery('simple', $2)
          AND ($3::text IS NULL OR signal_kind = $3)
        ORDER BY occurred_at DESC
        LIMIT $4`,
      [ctx.organizationId, input.query, input.signalKind ?? null, input.limit],
    );
    return { matches: r.rows };
  },
};

export const getMutationHistory: AssistantToolDef<
  z.ZodObject<{ status: z.ZodOptional<z.ZodString>; limit: z.ZodDefault<z.ZodNumber> }>
> = {
  name: 'get_mutation_history',
  description:
    "The AI's own change history: agent_mutations rows (kind, status, payload summary, when, by whom) newest-first, optionally filtered by status (proposed | under_review | approved | applied | rejected | reverted). Use to answer \"what did you change\" and to learn from accepted/rejected outcomes.",
  permission: 'dashboard.view',
  inputSchema: z.object({
    status: z.string().max(20).optional(),
    limit: rowLimit(50, 20),
  }),
  run: async (input, ctx, deps) => {
    const r = await deps.query(
      ctx.organizationId,
      `SELECT id, mutation_kind, status, payload, review_notes,
              proposed_by_staff_id, applied_by, applied_at::text AS applied_at,
              ai_chat_session_id, created_at::text AS created_at
         FROM agent_mutations
        WHERE organization_id = $1
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [ctx.organizationId, input.status ?? null, input.limit],
    );
    return { mutations: r.rows };
  },
};

export const getChatHistory: AssistantToolDef<
  z.ZodObject<{ sessionId: z.ZodOptional<z.ZodString>; limit: z.ZodDefault<z.ZodNumber> }>
> = {
  name: 'get_chat_history',
  description:
    'Past assistant conversations for this org: recent sessions (id, title, last activity), or one session\'s messages when sessionId is given. Use to recall prior context ("as we discussed yesterday...").',
  permission: 'dashboard.view',
  inputSchema: z.object({
    sessionId: z.string().max(80).optional(),
    limit: rowLimit(100, 30),
  }),
  run: async (input, ctx, deps) => {
    if (input.sessionId) {
      // Newest N messages, returned oldest→newest for natural reading.
      const r = await deps.query(
        ctx.organizationId,
        `SELECT role, content, at FROM (
           SELECT id, role, content, created_at::text AS at
             FROM ai_chat_messages
            WHERE organization_id = $1 AND session_id = $2
            ORDER BY id DESC
            LIMIT $3
         ) latest
         ORDER BY id ASC`,
        [ctx.organizationId, input.sessionId, input.limit],
      );
      return { sessionId: input.sessionId, messages: r.rows };
    }
    const r = await deps.query(
      ctx.organizationId,
      `SELECT id, title, updated_at::text AS updated_at
         FROM ai_chat_sessions
        WHERE organization_id = $1
        ORDER BY updated_at DESC
        LIMIT $2`,
      [ctx.organizationId, input.limit],
    );
    return { sessions: r.rows };
  },
};

// ─── Search narrow waist (adapters over existing domain helpers) ─────────────

async function defaultGetSupportTicket(
  orgId: string,
  ticketId: number,
): Promise<{
  id: number;
  provider: string;
  externalTicketId: string | null;
  subjectCache: string | null;
  statusCache: string | null;
} | null> {
  const r = await tenantQuery<{
    id: string;
    provider: string;
    external_ticket_id: string | null;
    subject_cache: string | null;
    status_cache: string | null;
  }>(
    orgId,
    `SELECT id, provider, external_ticket_id, subject_cache, status_cache
       FROM support_tickets
      WHERE organization_id = $1 AND id = $2
      LIMIT 1`,
    [orgId, ticketId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    provider: row.provider,
    externalTicketId: row.external_ticket_id,
    subjectCache: row.subject_cache,
    statusCache: row.status_cache,
  };
}

const searchEntityTypeSchema = z.enum([
  'ORDER',
  'SERIAL_UNIT',
  'RECEIVING',
  'SKU',
  'REPAIR',
  'FBA_SHIPMENT',
]);

export const hybridEntitySearch: AssistantToolDef<
  z.ZodObject<{
    query: z.ZodString;
    entityTypes: z.ZodOptional<z.ZodArray<typeof searchEntityTypeSchema>>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>
> = {
  name: 'hybrid_entity_search',
  description:
    'Search warehouse entities (orders, serialized units, receiving cartons, SKU catalog, repairs, FBA shipments) by natural language or identifier. Returns SearchHit[] with title, subtitle, href, score. Use FIRST for find/where/which/show/list questions and any order id, serial, SKU, tracking, or carton lookup. Prefer this over guessing. Optionally scope entityTypes.',
  permission: 'assistant.chat',
  inputSchema: z.object({
    query: z.string().min(1).max(300),
    entityTypes: z.array(searchEntityTypeSchema).max(SEARCH_ENTITY_TYPES.length).optional(),
    limit: rowLimit(50, 12),
  }),
  run: async (input, ctx, deps) => {
    const search = deps.hybridEntitySearch ?? runHybridEntitySearch;
    const result = await search(ctx.organizationId, {
      query: input.query,
      entityTypes: input.entityTypes,
      limit: input.limit,
    });
    return result;
  },
};

export const exactIdSerialSearch: AssistantToolDef<
  z.ZodObject<{ query: z.ZodString; limit: z.ZodDefault<z.ZodNumber> }>
> = {
  name: 'exact_id_serial_search',
  description:
    'Deterministic exact-identifier lookup across parent tables: order id, tracking number, SKU code, repair ticket, numeric record id, or support-ticket-shaped #NNNN. Returns SearchHit[]. Use when the user pasted a bare identifier (no spaces) and hybrid_entity_search is not needed. For #ticket scans prefer resolve_support_ticket.',
  permission: 'assistant.chat',
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    limit: rowLimit(50, 20),
  }),
  run: async (input, ctx, deps) => {
    const search = deps.exactIdSerialSearch ?? runExactIdSerialSearch;
    const hits = await search(ctx.organizationId, {
      query: input.query,
      limit: input.limit,
    });
    return { hits };
  },
};

export const resolveSupportTicket: AssistantToolDef<
  z.ZodObject<{ scanValue: z.ZodString }>
> = {
  name: 'resolve_support_ticket',
  description:
    'Resolve a support ticket scan (#4821 or 4821) to its linked receiving carton via support_tickets + ticket_links — the same path receiving Unbox uses. Returns the ticket row, receivingId, optional lineId, and an href to open the carton. Use whenever the user mentions a #ticket or bare ticket number that looks like a support ticket.',
  permission: 'assistant.chat',
  inputSchema: z.object({
    scanValue: z.string().min(1).max(32),
  }),
  run: async (input, ctx, deps) => {
    const resolve = deps.resolveSupportTicket ?? resolveSupportTicketToReceiving;
    const getTicket = deps.getSupportTicket ?? defaultGetSupportTicket;
    const resolved = await resolve(ctx.organizationId, input.scanValue);
    if (!resolved) {
      return { found: false as const, scanValue: input.scanValue.trim() };
    }
    const ticket = await getTicket(ctx.organizationId, resolved.supportTicketId);
    return {
      found: true as const,
      supportTicketId: resolved.supportTicketId,
      label: formatSupportTicketLabel(resolved.supportTicketId),
      receivingId: resolved.receivingId,
      lineId: resolved.lineId ?? null,
      href: searchHitHref('RECEIVING', resolved.receivingId),
      ticket: ticket
        ? {
            id: ticket.id,
            provider: ticket.provider,
            externalTicketId: ticket.externalTicketId,
            subjectCache: ticket.subjectCache,
            statusCache: ticket.statusCache,
          }
        : null,
    };
  },
};
