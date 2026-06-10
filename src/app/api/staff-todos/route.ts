/**
 * /api/staff-todos — the logged-in staffer's own header to-do lists.
 *
 * Backs the header goal chip's "Recurring" and "To-do" modes (replacing the
 * localStorage v1). No special permission — like /api/staff-goals/me, every
 * authenticated staffer reads and writes only their OWN list; staffId always
 * comes from the verified session, never the request.
 *
 *   GET    ?station=TECH               → { items: StaffTodoRow[] }
 *   POST   { station, kind, text, intervalMs?, idempotencyKey? } → { item }
 *   PATCH  { action: 'toggle', id, done }                        → { item }
 *   PATCH  { action: 'set_interval', station, intervalMs }       → { items }
 *   DELETE ?id=123                                               → { success }
 *
 * Recurring "done" is derived client-side from recur_anchor_ms /
 * recur_interval_ms / last_completed_at_ms (see staff-todos-queries), so
 * cycle rollover needs no polling and no reset job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import {
  StaffTodoCreateBody,
  StaffTodoPatchBody,
  StaffTodoStation,
} from '@/lib/schemas/staff-todos';
import {
  archiveStaffTodo,
  createStaffTodo,
  getStaffTodo,
  listStaffTodos,
  setStaffTodoDone,
  setStaffTodoInterval,
} from '@/lib/neon/staff-todos-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const runtime = 'nodejs';

const ROUTE_STAFF_TODO_POST = 'staff-todos.post';
const AUDIT_SOURCE = 'staff-todos-api';

function parseStation(value: string | null): string | NextResponse {
  const parsed = StaffTodoStation.safeParse(String(value ?? '').toUpperCase());
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_STATION' }, { status: 400 });
  }
  return parsed.data;
}

export const GET = withAuth(async (req, ctx) => {
  const station = parseStation(req.nextUrl.searchParams.get('station'));
  if (station instanceof NextResponse) return station;
  const items = await listStaffTodos(ctx.staffId, station);
  return NextResponse.json({ items });
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(StaffTodoCreateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
  if (idemKey) {
    const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_STAFF_TODO_POST);
    if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
  }

  const item = await createStaffTodo({
    staffId: ctx.staffId,
    station: parsed.station,
    kind: parsed.kind,
    text: parsed.text,
    intervalMs: parsed.intervalMs ?? null,
  });

  await recordAudit(pool, ctx, req, {
    source: AUDIT_SOURCE,
    action: AUDIT_ACTION.STAFF_TODO_CREATE,
    entityType: AUDIT_ENTITY.STAFF_TODO,
    entityId: item.id,
    before: null,
    after: { station: parsed.station, kind: item.kind, text: item.text },
  });

  const responseBody = { success: true, item };
  if (idemKey) {
    await saveApiIdempotencyResponse(pool, {
      idempotencyKey: idemKey,
      route: ROUTE_STAFF_TODO_POST,
      staffId: ctx.staffId,
      statusCode: 201,
      responseBody,
    });
  }
  return NextResponse.json(responseBody, { status: 201 });
});

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(StaffTodoPatchBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  if (parsed.action === 'toggle') {
    const item = await setStaffTodoDone(ctx.staffId, parsed.id, parsed.done);
    if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    // Check/uncheck is high-frequency and fully reconstructable from
    // staff_todo_completions — no audit row for plain toggles.
    return NextResponse.json({ success: true, item });
  }

  // set_interval — applies to the station's whole recurring list.
  const { previousIntervalMs } = await setStaffTodoInterval(
    ctx.staffId,
    parsed.station,
    parsed.intervalMs,
  );
  const items = await listStaffTodos(ctx.staffId, parsed.station);
  await recordAudit(pool, ctx, req, {
    source: AUDIT_SOURCE,
    action: AUDIT_ACTION.STAFF_TODO_SET_INTERVAL,
    entityType: AUDIT_ENTITY.STAFF_TODO,
    entityId: `${ctx.staffId}:${parsed.station}`,
    before: previousIntervalMs == null ? null : { intervalMs: previousIntervalMs },
    after: { station: parsed.station, intervalMs: parsed.intervalMs },
  });
  return NextResponse.json({ success: true, items });
});

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }
  const before = await getStaffTodo(ctx.staffId, id);
  const archived = await archiveStaffTodo(ctx.staffId, id);
  if (!archived) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await recordAudit(pool, ctx, req, {
    source: AUDIT_SOURCE,
    action: AUDIT_ACTION.STAFF_TODO_ARCHIVE,
    entityType: AUDIT_ENTITY.STAFF_TODO,
    entityId: id,
    before: before ? { kind: before.kind, text: before.text } : null,
    after: null,
  });
  return NextResponse.json({ success: true });
});
