---
name: workflow-node
description: Build or change an engine node type (NodeDefinition) for the operations workflow graph. Use whenever adding a process step the graph can route items through — intake, inspection, grading, repair, listing, fulfillment, returns — or changing node outputs/routing. Enforces the thin-adapter contract over existing src/lib/* domain modules.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Workflow node types — the thin-adapter contract

A node type is how a real operational step (test a unit, list it on eBay, pack it) becomes
routable in the owner's graph. The engine is **already built**: `src/lib/workflow/`
(`contract.ts`, `registry.ts`, `runtime.ts`, `router.ts`, `advance.ts`, `store.ts`,
`events.ts`). You are only ever adding a `NodeDefinition` adapter — never engine changes —
unless the contract itself is provably insufficient (stop and surface that).

## The one law

**A node's `run()` is a ~30-line adapter over an existing `src/lib/*` module.** If you are
writing receiving/testing/listing/shipping business logic inside `nodes/`, stop — find or
extend the domain module (`src/lib/receiving`, `tech`, `repair`, `ebay`, `orders-sync`,
`picking`, `shipping`, `rma`, `inventory`) and call it. The engine decides *routing*; the
domain module does *work*. This is what keeps the graph rewireable without breaking
operations.

## Authoring steps

1. **Read the contract** — `src/lib/workflow/contract.ts` (`NodeDefinition`, `NodeContext`,
   `NodeResult`) and one existing node under `src/lib/workflow/nodes/` as the model
   (architecture doc §3.4 has the inspection example).
2. **Create `src/lib/workflow/nodes/<name>.node.ts`:**
   - `type`: snake_case, stable forever once published graphs reference it (it is a data
     key in `workflow_nodes.type` — renaming is a migration, so choose carefully).
   - `category`: `intake | process | fulfill | logic | custom` — drives palette grouping.
   - `outputs`: the **named ports** that make conditional routing visible on the canvas.
     Model real outcomes, not booleans: inspection → `pass` / `fail`; listing →
     `listed` / `error`; grading → one port per disposition class if routing differs.
     Every output you declare MUST make sense to wire somewhere — the diagnostics engine
     flags unwired ports as publish-blocking errors.
   - `configSchema`: only knobs an owner should turn (thresholds, target platform,
     SLA hours). Secrets/credentials NEVER go in node config — they stay in env/integration
     config.
   - `run(ctx)`: call the domain module with `ctx.serialUnitId` / `ctx.actor` /
     `ctx.config` / `ctx.input`; map the domain result to an output port; `ctx.emit(...)`
     the workflow event; return `{ output, data?, await? }`.
3. **`await: true` for human-paced steps.** Anything a person finishes later (a tech mid-test,
   a packer mid-pack) returns `await: true` so the item parks at the node; the next scan or
   station action re-advances it. Auto-advancing nodes (pure logic, API calls) return their
   port immediately. Default to manual — the floor is scan-driven.
4. **Register** via the side-effect-import pattern: import the node module in
   `src/lib/workflow/index.ts` `registerBuiltins()`. The canvas palette, Studio Inspector,
   and `/api/workflow` metadata all pick it up automatically from `listNodeMeta()` — if you
   find yourself editing a component to "add" the node, you've broken law #8 of `/ops-studio`.
5. **Idempotency & durability:** `advanceItem` is QStash-retried and lock-guarded per
   serial unit. Your `run()` must tolerate a retry (the domain modules' existing routes
   mostly are — verify the one you call; if it isn't, make the domain call idempotent
   there, not in the node).
6. **Tests:** add cases to the existing patterns in `advance.test.ts` / `router.test.ts` —
   minimum: each output port routes correctly, retry of `run()` is safe, `await` parks
   without advancing.

## State & status discipline

- Engine state (`item_workflow_state`, `workflow_runs`) is a **pointer + log**, not a second
  status store. The operational source of truth stays `station_activity_logs` /
  `status_history` / domain tables — your domain call updates those; the engine only
  records position and transition.
- If the node corresponds to a receiving lifecycle stage, use the stage keys from
  `src/lib/receiving/workflow-stages.ts` (EXPECTED ① … DONE ⑧ with `order` numbers) for
  any status it writes — never invent a parallel status string.
- Permission for "who may advance items through this node" comes from the action/permission
  the underlying route already enforces (`withAuth`) — nodes add no auth layer of their own.

## Reseller node library (the target catalog)

Intake: `receive_carton`, `door_scan`, `po_import` · Process: `unbox`, `inspect_test`
(pass/fail), `grade_condition` (ports by disposition: accept/rework/rtv/scrap),
`repair` (done/parts_needed), `photograph`, `data_wipe` · Fulfill: `list_ebay`,
`list_other_platform` (one type per platform adapter), `price`, `pick_pack`, `ship`,
`fba_prep`, `local_pickup` · Returns: `rma_intake`, `retest`, `warranty_claim`,
`parts_harvest` · Logic: `conditional`, `n8n_webhook`. Check what exists in
`src/lib/workflow/nodes/` before adding; extend, don't duplicate.

## Checklist

- [ ] `run()` ≤ ~40 lines, delegates to an existing `src/lib/*` module
- [ ] Output ports = real outcomes; no dead ports
- [ ] `type` string final; config schema owner-safe (no secrets)
- [ ] Registered in `registerBuiltins()`; appears via `listNodeMeta()` with icon + label
- [ ] Retry-safe; `await` semantics correct for human-paced steps
- [ ] No new status vocabulary — SoT registries only
- [ ] router/advance tests extended
