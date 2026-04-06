import pool from '@/lib/db';
import type { IntentDomain, IntentParams } from '@/lib/ai/intent-router';
import { normalizeTrackingCanonical } from '@/lib/tracking-format';

function pct(value: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function normalizeLookupLike(value: string): string {
  return `%${value.trim()}%`;
}


function formatTitle(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value || '').trim();
  return cleaned || fallback;
}

function formatCountLabel(count: number, singular: string, plural?: string): string {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural || `${singular}s`}`;
}

type QueryRow = Record<string, unknown>;

export async function fetchOrdersContext(params: IntentParams): Promise<string> {
  if (params.orderId) {
    const specific = await pool.query(
      `
        SELECT
          o.order_id,
          o.product_title,
          o.condition,
          o.sku,
          o.status,
          o.out_of_stock,
          stn.tracking_number_raw,
          COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
            OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
          wa.assigned_tech_id,
          s.name AS tech_name,
          wa.deadline_at
        FROM orders o
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
        LEFT JOIN LATERAL (
          SELECT assigned_tech_id, deadline_at
          FROM work_assignments
          WHERE entity_type = 'ORDER'
            AND entity_id = o.id
            AND work_type = 'TEST'
            AND status <> 'CANCELED'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        ) wa ON TRUE
        LEFT JOIN staff s ON s.id = wa.assigned_tech_id
        WHERE o.order_id ILIKE $1
        ORDER BY o.id DESC
        LIMIT 1
      `,
      [normalizeLookupLike(params.orderId)]
    );

    if (specific.rows.length > 0) {
      const row = specific.rows[0] as QueryRow;
      const lines = [
        '=== ORDER LOOKUP (live) ===',
        `Order: ${formatTitle(row.order_id as string, 'Unknown')}`,
        `Product: ${formatTitle(row.product_title as string, 'Unknown product')}`,
        `Status: ${row.is_shipped ? 'Shipped' : 'Pending'}${row.status ? ` | Workflow: ${row.status}` : ''}`,
      ];
      if (row.tech_name) lines.push(`Assigned tech: ${row.tech_name}`);
      if (row.deadline_at) lines.push(`Deadline: ${row.deadline_at}`);
      if (row.tracking_number_raw) lines.push(`Tracking: ${row.tracking_number_raw}`);
      if (row.sku) lines.push(`SKU: ${row.sku}`);
      if (row.condition) lines.push(`Condition: ${row.condition}`);
      if (row.out_of_stock) lines.push(`Missing part / OOS: ${row.out_of_stock}`);
      return lines.join('\n');
    }
  }

  const [summary, overdue] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
              OR stn.is_out_for_delivery OR stn.is_delivered, false)
          )::int AS pending_total,
          COUNT(*) FILTER (
            WHERE NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
              OR stn.is_out_for_delivery OR stn.is_delivered, false)
              AND wa_t.assigned_tech_id IS NULL
          )::int AS unassigned,
          COUNT(*) FILTER (
            WHERE wa_d.deadline_at::date < CURRENT_DATE
              AND NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                OR stn.is_out_for_delivery OR stn.is_delivered, false)
          )::int AS overdue,
          COUNT(*) FILTER (
            WHERE wa_d.deadline_at::date = CURRENT_DATE
              AND NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                OR stn.is_out_for_delivery OR stn.is_delivered, false)
          )::int AS due_today,
          COUNT(*) FILTER (
            WHERE COALESCE(BTRIM(o.out_of_stock), '') <> ''
          )::int AS out_of_stock
        FROM orders o
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
        LEFT JOIN LATERAL (
          SELECT assigned_tech_id
          FROM work_assignments
          WHERE entity_type = 'ORDER'
            AND entity_id = o.id
            AND work_type = 'TEST'
            AND status <> 'CANCELED'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        ) wa_t ON TRUE
        LEFT JOIN LATERAL (
          SELECT deadline_at
          FROM work_assignments
          WHERE entity_type = 'ORDER'
            AND entity_id = o.id
            AND work_type = 'TEST'
            AND status <> 'CANCELED'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        ) wa_d ON TRUE
      `
    ),
    pool.query(
      `
        SELECT
          o.order_id,
          o.product_title,
          COALESCE((CURRENT_DATE - wa.deadline_at::date), 0)::int AS days_overdue
        FROM orders o
        JOIN LATERAL (
          SELECT deadline_at
          FROM work_assignments
          WHERE entity_type = 'ORDER'
            AND entity_id = o.id
            AND work_type = 'TEST'
            AND status <> 'CANCELED'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        ) wa ON TRUE
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
        WHERE wa.deadline_at::date < CURRENT_DATE
          AND NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
            OR stn.is_out_for_delivery OR stn.is_delivered, false)
        ORDER BY wa.deadline_at ASC, o.id ASC
        LIMIT 5
      `
    ),
  ]);

  const counts = (summary.rows[0] || {}) as QueryRow;
  const urgent = overdue.rows
    .map((row) => {
      const orderId = String(row.order_id || '').trim();
      const shortOrderId = orderId ? `#${orderId.slice(-4)}` : 'Unknown order';
      const product = formatTitle(row.product_title as string, 'Unknown product');
      const days = Number(row.days_overdue || 0);
      return `${shortOrderId} (${product}, ${formatCountLabel(days, 'day')} overdue)`;
    })
    .join(', ');

  return [
    '=== PENDING ORDERS (live) ===',
    `Total unshipped: ${counts.pending_total ?? 0}`,
    `Overdue: ${counts.overdue ?? 0} | Due today: ${counts.due_today ?? 0} | Unassigned: ${counts.unassigned ?? 0}`,
    `Out of stock: ${counts.out_of_stock ?? 0}`,
    urgent ? `Most urgent: ${urgent}` : 'Most urgent: none',
  ].join('\n');
}

export async function fetchStaffContext(params: IntentParams): Promise<string> {
  const values: Array<string> = [];
  let whereClause = `WHERE s.active = true`;

  if (params.staffName) {
    values.push(normalizeLookupLike(params.staffName));
    whereClause += ` AND s.name ILIKE $1`;
  }

  const result = await pool.query(
    `
      WITH today_tech AS (
        SELECT tested_by AS sid, COUNT(*)::int AS today_count
        FROM tech_serial_numbers
        WHERE tested_by IS NOT NULL
          AND created_at::date = CURRENT_DATE
        GROUP BY tested_by
      ),
      week_tech AS (
        SELECT tested_by AS sid, COUNT(*)::int AS week_count
        FROM tech_serial_numbers
        WHERE tested_by IS NOT NULL
          AND created_at::date >= CURRENT_DATE - INTERVAL '6 day'
        GROUP BY tested_by
      ),
      today_pack AS (
        SELECT packed_by AS sid, COUNT(*)::int AS today_pack
        FROM packer_logs
        WHERE packed_by IS NOT NULL
          AND created_at::date = CURRENT_DATE
        GROUP BY packed_by
      ),
      week_pack AS (
        SELECT packed_by AS sid, COUNT(*)::int AS week_pack
        FROM packer_logs
        WHERE packed_by IS NOT NULL
          AND created_at::date >= CURRENT_DATE - INTERVAL '6 day'
        GROUP BY packed_by
      )
      SELECT
        s.name,
        s.role,
        COALESCE(sg.daily_goal, 50) AS goal,
        COALESCE(tt.today_count, 0) AS tech_today,
        COALESCE(wt.week_count, 0) AS tech_week,
        COALESCE(tp.today_pack, 0) AS pack_today,
        COALESCE(wp.week_pack, 0) AS pack_week
      FROM staff s
      LEFT JOIN staff_goals sg ON sg.staff_id = s.id
      LEFT JOIN today_tech tt ON tt.sid = s.id
      LEFT JOIN week_tech wt ON wt.sid = s.id
      LEFT JOIN today_pack tp ON tp.sid = s.id
      LEFT JOIN week_pack wp ON wp.sid = s.id
      ${whereClause}
      ORDER BY s.role, s.name
    `,
    values
  );

  const techLines: string[] = [];
  const packerLines: string[] = [];

  for (const row of result.rows as QueryRow[]) {
    const role = String(row.role || '').toLowerCase();
    const name = formatTitle(row.name as string, 'Unknown');
    const goal = Number(row.goal || 50);
    const techToday = Number(row.tech_today || 0);
    const techWeek = Number(row.tech_week || 0);
    const packToday = Number(row.pack_today || 0);
    const packWeek = Number(row.pack_week || 0);

    if (role.includes('tech')) {
      techLines.push(`  ${name} - goal ${goal} | today ${techToday} (${pct(techToday, goal)}) | week ${techWeek}`);
    } else {
      packerLines.push(`  ${name} - packed today: ${packToday} | week: ${packWeek}`);
    }
  }

  return [
    '=== STAFF PERFORMANCE (today / this week) ===',
    techLines.length ? 'Technicians:' : 'Technicians: none',
    ...(techLines.length ? techLines : []),
    packerLines.length ? 'Packers:' : 'Packers: none',
    ...(packerLines.length ? packerLines : []),
  ].join('\n');
}

export async function fetchRepairContext(params: IntentParams): Promise<string> {
  const lookup = params.ticketNumber || params.orderId;
  if (lookup) {
    const detail = await pool.query(
      `
        SELECT
          rs.ticket_number,
          rs.status,
          rs.product_title,
          rs.issue,
          rs.serial_number,
          rs.contact_info,
          wa.out_of_stock,
          s.name AS tech_name
        FROM repair_service rs
        LEFT JOIN LATERAL (
          SELECT out_of_stock, assigned_tech_id
          FROM work_assignments
          WHERE entity_type = 'REPAIR'
            AND entity_id = rs.id
            AND work_type = 'REPAIR'
            AND status IN ('ASSIGNED', 'IN_PROGRESS')
          ORDER BY id DESC
          LIMIT 1
        ) wa ON TRUE
        LEFT JOIN staff s ON s.id = wa.assigned_tech_id
        WHERE rs.ticket_number ILIKE $1
           OR rs.contact_info ILIKE $1
           OR rs.product_title ILIKE $1
           OR rs.serial_number ILIKE $1
        ORDER BY rs.updated_at DESC, rs.id DESC
        LIMIT 1
      `,
      [normalizeLookupLike(lookup)]
    );

    if (detail.rows.length > 0) {
      const row = detail.rows[0] as QueryRow;
      const lines = [
        '=== REPAIR LOOKUP ===',
        `Ticket: ${formatTitle(row.ticket_number as string, 'Unknown')}`,
        `Status: ${formatTitle(row.status as string, 'Unknown')}`,
        `Product: ${formatTitle(row.product_title as string, 'Unknown product')}`,
      ];
      if (row.tech_name) lines.push(`Assigned tech: ${row.tech_name}`);
      if (row.issue) lines.push(`Issue: ${row.issue}`);
      if (row.serial_number) lines.push(`Serial: ${row.serial_number}`);
      if (row.contact_info) lines.push(`Customer: ${row.contact_info}`);
      if (row.out_of_stock) lines.push(`Waiting on parts: ${row.out_of_stock}`);
      return lines.join('\n');
    }
  }

  const values: Array<string> = [];
  let statusFilter = '';
  if (params.repairStatus) {
    if (params.repairStatus === 'waiting_for_parts') {
      statusFilter = ` AND COALESCE(BTRIM(wa.out_of_stock), '') <> ''`;
    } else {
      values.push(params.repairStatus);
      statusFilter = ` AND rs.status = $1`;
    }
  }

  const result = await pool.query(
    `
      SELECT
        rs.status,
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (
          WHERE COALESCE(BTRIM(wa.out_of_stock), '') <> ''
        )::int AS waiting_parts
      FROM repair_service rs
      LEFT JOIN LATERAL (
        SELECT out_of_stock, assigned_tech_id
        FROM work_assignments
        WHERE entity_type = 'REPAIR'
          AND entity_id = rs.id
          AND work_type = 'REPAIR'
          AND status IN ('ASSIGNED', 'IN_PROGRESS')
        ORDER BY id DESC
        LIMIT 1
      ) wa ON TRUE
      WHERE rs.status NOT IN ('Done', 'Shipped', 'Picked Up')
      ${statusFilter}
      GROUP BY rs.status
      ORDER BY rs.status
    `,
    values
  );

  const total = result.rows.reduce((sum, row) => sum + Number(row.cnt || 0), 0);
  const lines = result.rows.map((row) => {
    const waiting = Number(row.waiting_parts || 0);
    const waitingSuffix = waiting > 0 ? ` (${waiting} waiting for parts)` : '';
    return `${row.status}: ${row.cnt}${waitingSuffix}`;
  });

  return ['=== OPEN REPAIRS ===', ...lines, `Total open: ${total}`].join('\n');
}

export async function fetchReceivingContext(): Promise<string> {
  const [receiving, lines] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS awaiting_unboxing,
          COUNT(*) FILTER (WHERE received_at::date = CURRENT_DATE)::int AS received_today,
          COUNT(*) FILTER (WHERE is_return = true)::int AS returns_pending
        FROM receiving
        WHERE unboxed_at IS NULL
      `
    ),
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE workflow_status = 'EXPECTED')::int AS expected_count,
          COUNT(*) FILTER (WHERE workflow_status = 'ARRIVED')::int AS arrived_count
        FROM receiving_lines
      `
    ),
  ]);

  const summary = (receiving.rows[0] || {}) as QueryRow;
  const statusCounts = (lines.rows[0] || {}) as QueryRow;
  const pendingLines = Number(statusCounts.expected_count || 0) + Number(statusCounts.arrived_count || 0);

  return [
    '=== RECEIVING ===',
    `Packages awaiting unboxing: ${summary.awaiting_unboxing ?? 0} (${summary.received_today ?? 0} received today, ${summary.returns_pending ?? 0} return)`,
    `PO line items still expected: ${pendingLines}`,
  ].join('\n');
}

export async function fetchFbaContext(params: IntentParams): Promise<string> {
  const values: string[] = [];
  let whereClause = `WHERE COALESCE(fs.status, 'PLANNED') != 'SHIPPED'`;

  if (params.orderId) {
    values.push(normalizeLookupLike(params.orderId));
    whereClause += ` AND fs.shipment_ref ILIKE $1`;
  }

  const result = await pool.query(
    `
      SELECT
        fs.status,
        COUNT(*)::int AS shipments,
        COALESCE(SUM(fs.ready_item_count), 0)::int AS ready,
        COALESCE(SUM(fs.packed_item_count), 0)::int AS packed
      FROM fba_shipments fs
      ${whereClause}
      GROUP BY fs.status
      ORDER BY fs.status
    `,
    values
  );

  return [
    '=== FBA SHIPMENTS ===',
    ...result.rows.map(
      (row) => `${row.status}: ${formatCountLabel(Number(row.shipments || 0), 'shipment')} | ready: ${row.ready} items, packed: ${row.packed}`
    ),
  ].join('\n');
}

export async function fetchInventoryContext(params: IntentParams): Promise<string> {
  if (params.sku) {
    const specific = await pool.query(
      `
        SELECT sku, product_title, stock
        FROM sku_stock
        WHERE LOWER(COALESCE(sku, '')) ILIKE LOWER($1)
           OR LOWER(COALESCE(product_title, '')) ILIKE LOWER($1)
        ORDER BY sku ASC NULLS LAST, id DESC
        LIMIT 5
      `,
      [normalizeLookupLike(params.sku)]
    );

    return [
      '=== INVENTORY / SKU STOCK ===',
      ...specific.rows.map((row) => `  ${formatTitle(row.sku as string, 'Unknown SKU')}: ${row.stock ?? '0'} units (${formatTitle(row.product_title as string, 'Unknown product')})`),
    ].join('\n');
  }

  const result = await pool.query(
    `
      SELECT
        sku,
        product_title,
        COALESCE(NULLIF(regexp_replace(COALESCE(stock, ''), '[^0-9]', '', 'g'), ''), '0')::int AS qty
      FROM sku_stock
      ORDER BY qty ASC, sku ASC NULLS LAST
      LIMIT 10
    `
  );

  return [
    '=== INVENTORY / SKU STOCK ===',
    'Low stock items (bottom 10):',
    ...result.rows.map((row) => `  ${formatTitle(row.sku as string, 'Unknown SKU')}: ${row.qty} units`),
  ].join('\n');
}

export async function fetchExceptionsContext(): Promise<string> {
  const result = await pool.query(
    `
      SELECT source_station, COUNT(*)::int AS cnt
      FROM orders_exceptions
      WHERE status = 'open'
      GROUP BY source_station
      ORDER BY source_station
    `
  );

  const total = result.rows.reduce((sum, row) => sum + Number(row.cnt || 0), 0);
  const stations = result.rows
    .map((row) => `${formatTitle(String(row.source_station || ''), 'Unknown')} station: ${row.cnt}`)
    .join(' | ');

  return [
    '=== OPEN EXCEPTIONS ===',
    `Unresolved tracking exceptions: ${total}`,
    stations ? `  ${stations}` : '  none',
  ].join('\n');
}

export async function fetchShippedContext(params: IntentParams): Promise<string> {
  if (!params.orderId && !params.trackingNumber) return '';

  const values: string[] = [];
  let orderCondition = 'FALSE';
  let trackingCondition = 'FALSE';

  if (params.orderId) {
    values.push(normalizeLookupLike(params.orderId));
    orderCondition = `o.order_id ILIKE $${values.length}`;
  }
  if (params.trackingNumber) {
    values.push(normalizeTrackingCanonical(params.trackingNumber));
    trackingCondition = `stn.tracking_number_normalized = $${values.length}`;
  }

  const result = await pool.query(
    `
      SELECT
        o.order_id,
        o.product_title,
        o.condition,
        stn.tracking_number_raw,
        stn.latest_status_label,
        stn.latest_status_category,
        stn.carrier,
        stn.delivered_at,
        STRING_AGG(DISTINCT tsn.serial_number, ', ') FILTER (WHERE tsn.serial_number IS NOT NULL) AS serials,
        STRING_AGG(DISTINCT s.name, ', ') FILTER (WHERE s.name IS NOT NULL) AS tested_by
      FROM orders o
      JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id
      LEFT JOIN staff s ON s.id = tsn.tested_by
      WHERE ${orderCondition} OR ${trackingCondition}
      GROUP BY o.id, stn.id
      ORDER BY o.id DESC
      LIMIT 3
    `,
    values
  );

  if (result.rows.length === 0) {
    return '=== SHIPPED LOOKUP ===\nNo shipped order matched that order ID or tracking number.';
  }

  return [
    '=== SHIPPED LOOKUP ===',
    ...result.rows.map((row) => {
      const parts = [
        `${formatTitle(row.order_id as string, 'Unknown order')} (${formatTitle(row.product_title as string, 'Unknown product')})`,
        row.latest_status_label ? `status: ${row.latest_status_label}` : null,
        row.latest_status_category ? `category: ${row.latest_status_category}` : null,
        row.carrier ? `carrier: ${row.carrier}` : null,
        row.delivered_at ? `delivered_at: ${row.delivered_at}` : null,
        row.serials ? `serials: ${row.serials}` : null,
        row.tested_by ? `tested_by: ${row.tested_by}` : null,
        row.tracking_number_raw ? `tracking: ${row.tracking_number_raw}` : null,
        row.condition ? `condition: ${row.condition}` : null,
      ].filter(Boolean);
      return `  ${parts.join(' | ')}`;
    }),
  ].join('\n');
}

export async function buildContextBlock(
  intents: IntentDomain[],
  params: IntentParams
): Promise<string> {
  const selected = intents.slice(0, 3);
  const tasks = selected.map(async (intent) => {
    switch (intent) {
      case 'orders':
        return fetchOrdersContext(params);
      case 'staff':
        return fetchStaffContext(params);
      case 'repair':
        return fetchRepairContext(params);
      case 'receiving':
        return fetchReceivingContext();
      case 'fba':
        return fetchFbaContext(params);
      case 'inventory':
        return fetchInventoryContext(params);
      case 'exceptions':
        return fetchExceptionsContext();
      case 'shipped':
        if (!params.orderId && !params.trackingNumber) return '';
        return fetchShippedContext(params);
      default:
        return '';
    }
  });

  const blocks = (await Promise.all(tasks)).map((block) => block.trim()).filter(Boolean);
  return blocks.join('\n\n');
}
