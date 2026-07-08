# Receiving actor attribution

All receiving / testing **write** routes must attribute events to the **verified session actor** (`ctx.staffId`). Client-supplied `staff_id`, `staffId`, or `staff_name` in JSON bodies are **ignored**.

## Rule

```typescript
const staffId =
  ctx.staffId != null && Number.isFinite(ctx.staffId) && ctx.staffId > 0
    ? Math.floor(ctx.staffId)
    : null;
```

Display names for external integrations (Zoho notes) are resolved **server-side** from `staff` where `id = ctx.staffId`.

## Routes audited (this change)

| Route | Notes |
|-------|-------|
| `POST /api/receiving/lines/[id]/status` | Was accepting `body.staff_id` |
| `POST /api/receiving/lines/[id]/putaway` | Was accepting `body.staff_id` |
| `POST /api/receiving/lines/[id]/putaway/reverse` | Was accepting `body.staff_id` |
| `POST /api/receiving/lines/[id]/move` | Was accepting `body.staff_id` |
| `POST /api/receiving/mark-received` | Was preferring `body.staff_name` |
| `POST /api/receiving/mark-received-po` | Was preferring `body.staff_name` |
| `POST /api/receiving/touch-scan` | Already uses `ctx.staffId` |
| `POST /api/receiving/lookup-po` | Already uses `ctx.staffId` |

## Timeline display

`src/lib/audit-log/receiving-aggregator.ts` resolves `actor_name` from `staff.name` joined on `received_by`, `unboxed_by`, and `inventory_events.actor_staff_id`. Incorrect names in the UI indicate **wrong actor written at event time** — fix the write route, not the aggregator.

## Adding new routes

1. Read `ctx.staffId` only
2. Pass `actorStaffId: ctx.staffId` to `recordInventoryEvent`, `recordOpsEvent`, `transitionReceivingLine`, `recordAudit`
3. Never add `staff_id` to public API contracts for attribution

## Symptom: wrong operator on Progress tab

Example: tracking `1ZY228K59072586469` showing "Michael" for UNBOXED when Michael did not perform the action.

**Likely cause:** a client (often testing UI) sent another staff member's id in the body while the session belonged to someone else, or testing-mode state caused actions on the wrong surface.

**Fix:** server-trusted actor (this doc) + surface isolation (`docs/testing-vs-receiving-isolation.md`).
