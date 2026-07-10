# 08 — Roadmap & phases (staff tracker)

> **Status:** Living  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [§8 Phased roadmap](../master-index-plan.md#8-phased-implementation-roadmap)  
> **Related staff plans:** All [01](./01-big-picture.md)–[07](./07-pages-and-design.md)

---

## How to read this

This is the **staff-facing** delivery board. Checkboxes here should match engineering progress in the technical index. When something ships, mark it here **and** in technical §8.

---

## Phase overview

| Phase | Name | Staff meaning | Staff plans most affected |
|-------|------|---------------|---------------------------|
| 0 | Foundations | Docs + dual index exist; rules agreed | 00, 01, 08 |
| 1 | Backend wiring | Fail→ticket, ship events, location honesty, Zoho sync path | 02, 03, 04, 05, 06 |
| 2 | Shared UI pieces | Journey panel + chips everyone reuses | 04, 07 |
| 3 | Page lifting | Inventory / support / admin feel like one product | 07, 02, 03 |
| 4 | Multi-provider | Zoho as adapter; room for another ERP | 05, 06 |

```mermaid
flowchart LR
  P0[0 Foundations] --> P1[1 Backend]
  P1 --> P2[2 Shared UI]
  P2 --> P3[3 Page lift]
  P3 --> P4[4 Multi-provider]
```

---

## Phase 0 — Foundations

| Staff checkpoint | Done? | Notes |
|------------------|-------|-------|
| Technical master index published | [x] | `master-index-plan.md` |
| Staff hub + topic plans published | [x] | This folder |
| Dual-layer editing rules understood | [ ] | Walk leads through [00](./00-how-to-use-these-docs.md) 1-on-1 |
| Catalog statuses kept current | [ ] | Update [INDEX.md](./INDEX.md) weekly |

---

## Phase 1 — Backend wiring (floor truth)

| Staff checkpoint | Done? | Maps to |
|------------------|-------|---------|
| Test FAIL links a ticket to the serial | [ ] | [03](./03-testing-and-support-tickets.md) |
| Pack/ship shows on the unit journey | [ ] | [04](./04-item-journey.md) |
| Moves always show from-bin → to-bin | [ ] | [02](./02-inventory-and-locations.md) |
| Pickup uses one operator path | [ ] | [06](./06-local-pickup.md) |
| Integrations “Sync” includes Zoho inventory path | [ ] | [05](./05-external-inventory-zoho.md) |

---

## Phase 2 — Shared UI

| Staff checkpoint | Done? | Maps to |
|------------------|-------|---------|
| Same journey panel on serial / inventory / testing / support | [ ] | [04](./04-item-journey.md), [07](./07-pages-and-design.md) |
| Order / serial / bin / ticket chips look identical everywhere | [ ] | [07](./07-pages-and-design.md) |

---

## Phase 3 — Page lifting

| Staff checkpoint | Done? | Maps to |
|------------------|-------|---------|
| Inventory feels like one workbench | [ ] | [07](./07-pages-and-design.md), [02](./02-inventory-and-locations.md) |
| Support ↔ unit navigation confirmed in 1-on-1 | [ ] | [03](./03-testing-and-support-tickets.md) |
| Admin/reports explained or lifted | [ ] | [07](./07-pages-and-design.md) |

---

## Phase 4 — Multi-provider

| Staff checkpoint | Done? | Maps to |
|------------------|-------|---------|
| Staff language in 1-on-1s says “provider,” not “Zoho is WMS” | [ ] | [05](./05-external-inventory-zoho.md) |
| Second provider stub exists (even if unused) | [ ] | Technical §8 Phase 4 |
| Core screens don’t require Zoho-shaped fields | [ ] | [05](./05-external-inventory-zoho.md) |

---

## Meeting cadence (suggested)

| Cadence | Action |
|---------|--------|
| Weekly ops | Flip checkboxes that shipped; note blockers in “Notes” |
| After each phase | Update status column on [INDEX.md](./INDEX.md) (`Planned` → `In progress` → `Done`) |
| Before a 1-on-1 | Skim the practice steps in 02–04 for that person’s role |

---

## Blockers / decisions log (edit freely)

| Date | Item | Owner | Resolution |
|------|------|-------|------------|
| 2026-07-10 | Dual staff + technical indexes created | — | Open |
| | Auto-create ticket on FAIL vs link-only? | Product | *TBD — flag-gated either way* |
| | When to show “rack” as a label in UI | Ops + eng | *TBD — barcode already encodes* |
