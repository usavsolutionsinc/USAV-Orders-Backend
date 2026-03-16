# Realtime Outbox Rollout

This is the production-safe rollout path for Supabase-style DB-driven realtime in this repo.

## Implemented first slice

- Durable `realtime_outbox` table
- Trigger-based event enqueueing for `repair_service`
- Internal webhook receiver at `/api/webhooks/realtime-db`
- Relay worker at `scripts/realtime-outbox-relay.js`
- Ably DB channel helpers
- Repair UI subscription to the new `db:public:repair_service` channel

## Deliberately not done yet

- No full-table rollout
- No pure `pg_notify` dependency
- No presence feature
- No replacement of existing manual Ably publishes
- No optimistic concurrency added to scan-heavy append-only flows

## Deploy order

1. Apply [2026-03-16_realtime_outbox_repair_service.sql](/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/src/lib/migrations/2026-03-16_realtime_outbox_repair_service.sql)
2. Set `REALTIME_WEBHOOK_SECRET`
3. Deploy the app with `/api/webhooks/realtime-db`
4. Run `node scripts/realtime-outbox-relay.js` on a small always-on worker
5. Verify repair updates still propagate through the old `repair.changed` channel
6. Verify DB-driven updates arrive on `db:public:repair_service`
7. Only then remove duplicate manual repair publishes if desired

## Next tables

- `orders`
- `work_assignments`
- `receiving`
- `receiving_lines`

Each table should get its own migration and rollout window instead of sharing one blanket migration.
