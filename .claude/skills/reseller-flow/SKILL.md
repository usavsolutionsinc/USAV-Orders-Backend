---
name: reseller-flow
description: Domain skill for modeling used-goods reseller operations (eBay + other platforms) as workflow graphs and station configs — canonical lifecycle states, condition grading, serialized units, multi-channel listing, returns/warranty loops, and the seed templates. Use when designing, seeding, or reviewing an operations graph or template for this business or a small-reseller tenant.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Used-reseller operations — the domain model behind every graph

Graphs and station configs built in the Studio must speak THIS business correctly: used
products bought in bulk or singly (Zoho POs, Amazon/eBay/Goodwill sourcing), arriving as
cartons, broken into **serialized units**, tested and **condition-graded**, listed across
channels (eBay primary; Ecwid storefront; Square; Amazon FBA; local pickup), shipped, and
looping back through returns/warranty. This skill is the vocabulary + the invariants; the
mechanics live in `/workflow-node` and `/station-block`.

## The canonical unit lifecycle (the "12345" spine)

`src/lib/receiving/workflow-stages.ts` is the numbered-state SoT — render and reference
states as `order + name`, never re-declare them:

```
① EXPECTED → ② ARRIVED → ③ MATCHED → ④ UNBOXED → ⑤ AWAITING_TEST → ⑥ IN_TEST
   → ⑦ PASSED ──────────────────────▶ (listing/fulfillment stages) → ⑨ DONE
   → ⑦ FAILED ─▶ disposition routing: ⑧ RTV | ⑧ SCRAP | rework → ⑤
```

Three orthogonal axes are NOT workflow stages — never conflate them with position:
- **Condition** — `src/lib/conditions.ts` grades (BRAND_NEW … USED_A/B/C, PARTS), labels
  only via `conditionLabel(code, variant)`.
- **Disposition** — ACCEPT / HOLD / RTV / SCRAP / REWORK (what we *decided*, not where it *is*).
- **Priority** — `priority_tier` (SoT `priority-override.ts`; platform-tier triage:
  unfound → amazon → ebay → goodwill).
A graph models *position*; condition/disposition values are produced AT nodes and consulted
BY edges (a `grade_condition` node's output port may key on disposition class).

## Invariants any reseller graph must satisfy (diagnostics will enforce; design for them)

1. **Everything serialized flows; nothing teleports.** A unit reaches LISTED only through
   test+grade. There is no edge that skips inspection for used goods — exception: a
   `BRAND_NEW` bypass lane is legitimate, but it must be an explicit conditional edge the
   owner can see, not an implicit shortcut.
2. **Every FAILED has a routed exit.** fail → repair (rework loop back to test), RTV, or
   parts_harvest/scrap. A dangling fail port is the single most common real-world gap
   (units pile in limbo) — it is a publish-blocking diagnostic.
3. **Returns re-enter as intake, not as a side table.** RMA/warranty intake → retest →
   regrade → (relist | repair | parts). The shipped↔returned serial pairing query exists
   (relational-reuse plan) — returns nodes consume it; never a parallel returns tracker.
4. **Channel listing nodes are interchangeable behind one port contract**
   (`listed`/`error`): `list_ebay` (existing `ebay-api` integration — do NOT add Nango for
   eBay), `list_ecwid`, `list_square`, `fba_prep` (planned→tech→packed→combine pipeline).
   Adding a marketplace = one node type + its data sources/actions, zero graph-engine work.
5. **The SKU string is never a join key across systems.** `items` (Zoho) vs `sku_catalog`
   are independent numbering schemes; titles come from `items.name`. Graph/station configs
   reference ids, not SKU text.
6. **Identity travels with the unit**: serial/unit-id chips via the CopyChip SoT helpers;
   photos to NAS (browser-direct WebDAV); test evidence and verdicts anchor on
   `receiving_line_id` (audit-trail-anchor direction), not on tracking numbers.

## Per-staff station slicing (small-team reality)

Small resellers run 1–5 people wearing partial hats. Model stations so each maps to a
permission cluster, e.g.: Door/Receiver (`receiving.scan_po`) · Unboxer
(`receiving.mark_received`, photos) · Tech (test/grade) · Lister (listing perms) ·
Packer/Shipper · Owner (everything + `studio.manage`). A staff member's daily view = the
stations they're permitted; the Studio People lens must show full coverage — every node
reachable by at least one active staff member, or it's a `coverage-gap` diagnostic.

## Seed templates (`workflow_definitions` seeds — keep in a migration/seed script)

1. **Standard refurb-and-list** (this company's flow): PO import → door scan → triage
   (found/unfound) → unbox → test → grade → photograph → list_ebay (+secondary channels)
   → pick/pack → ship; fail→repair loop; returns→retest loop.
2. **Test-only consignment**: intake → test → grade → report/return-to-consignor (no
   listing nodes); demonstrates subtraction, not new node types.
3. **Returns triage**: rma_intake → retest → (restock | relist-as-lower-grade | parts
   harvest | scrap) — the loop-heavy template.
4. **FBA prep lane**: planned → tech → pack → combine-shipment — the worked example of
   "one person plans, one person combines": same graph, two stations, two permission sets.

Templates are **data** (importable subgraphs). A tenant customizes by rewiring in the
Studio — if a template need can only be met with a new node type, that's a `/workflow-node`
task first.

## When designing a new flow, walk this checklist

- [ ] Every stage shown as `order + name` from the stage registry (no invented states)
- [ ] Fail/error/return ports all routed; loops have exits
- [ ] Condition/disposition produced at nodes, consumed by edges — not modeled as stages
- [ ] Each station maps to a real permission cluster; coverage check passes
- [ ] Channel nodes behind the common `listed`/`error` contract; eBay via existing client
- [ ] Returns wired through the existing serial-pairing path
- [ ] Volume reality check: where does this business's WIP actually pile up? Set `slaHours`
      on those nodes so the Flow² lens has thresholds from day one
