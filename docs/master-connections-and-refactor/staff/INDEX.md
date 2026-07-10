# Staff Upgrade Hub — Connections & Refactor

> **Audience:** One staff member at a time — ops lead walking someone through an upgrade, or a person reading their own now-vs-change plan.  
> **Last updated:** 2026-07-10  
> **Color planning view (all topics in one HTML):** [`../staff-connections-planning.html`](../staff-connections-planning.html)  
> **Technical counterpart:** [`../master-index-plan.md`](../master-index-plan.md)  
> **Hub:** [`../README.md`](../README.md)

---

## What this is

Cycle Forge already tracks units, bins, tests, tickets, and orders — but those stories often live on **separate screens**. An operator cannot easily answer: *“Where has this serial been, what failed, which ticket owns it, and which bin is it in?”*

These plans are for **1-on-1 staff upgrades**: sit with one person (or hand them one topic), compare **now vs change**, and practice the new flow together. Not a group pitch deck.

We are **connecting** what we already built: one **Item Journey** per serial, tickets that follow the unit (not only the carton), clear room/rack/bin placement history, and Zoho (or any ERP) as a **plug-in catalog** — not the warehouse brain. Local floor truth stays local.

---

## Suggested 1-on-1 order

Pick topics by role. You do not need every doc in one sitting.

| Order | Staff doc | Good for |
|-------|-----------|----------|
| 1 | [00 — How to use these docs](./00-how-to-use-these-docs.md) | Anyone editing or assigning plans |
| 2 | [01 — Big picture](./01-big-picture.md) | First session with anyone |
| 3 | [02 — Inventory & locations](./02-inventory-and-locations.md) | Putaway / warehouse |
| 4 | [03 — Testing & support tickets](./03-testing-and-support-tickets.md) | Testing / support |
| 5 | [04 — Item Journey](./04-item-journey.md) | Anyone who hunts serials |
| 6 | [05 — External inventory (Zoho)](./05-external-inventory-zoho.md) | Leads / inventory owners |
| 7 | [06 — Local pickup](./06-local-pickup.md) | Dock / receiving pickup |
| 8 | [07 — Pages & design](./07-pages-and-design.md) | Anyone confused by screen differences |
| 9 | [08 — Roadmap & phases](./08-roadmap-and-phases.md) | Tracking what shipped for that person |
| — | [Technical index](../master-index-plan.md) | Only if they need engineering depth |

---

## Plan catalog (living — update status here)

| # | Staff plan | Status | One-line “change” | Technical anchor |
|---|------------|--------|-------------------|------------------|
| 00 | [How to use these docs](./00-how-to-use-these-docs.md) | Living | Dual-layer editing rules | [Hub README](../README.md) |
| 01 | [Big picture](./01-big-picture.md) | Living | Connect silos; don’t rebuild | [§1–§3](../master-index-plan.md#1-executive-summary-goals--how-to-use) |
| 02 | [Inventory & locations](./02-inventory-and-locations.md) | Planned | Full room → rack → bin story + history | [§2.2 Inventory](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves), [§4.2](../master-index-plan.md#42-location-hierarchy-prescriptive) |
| 03 | [Testing & support tickets](./03-testing-and-support-tickets.md) | Planned | Failures auto-link tickets; jump both ways | [§2.2 Testing](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves), [§4.5](../master-index-plan.md#45-testing--ticket-integration-pattern) |
| 04 | [Item Journey](./04-item-journey.md) | Planned | One timeline per serial | [§2.2 Journey](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves), [§4.4](../master-index-plan.md#44-item-journey--merged-provenance-thread) |
| 05 | [External inventory (Zoho)](./05-external-inventory-zoho.md) | Planned | Zoho = swappable adapter; floor stays SoT | [§5](../master-index-plan.md#5-integration-architecture-external-providers) |
| 06 | [Local pickup](./06-local-pickup.md) | Planned | One pickup model; same receive story | [§2.2 Pickup](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves), [§5.5](../master-index-plan.md#55-local-pickup-under-the-adapter-model) |
| 07 | [Pages & design](./07-pages-and-design.md) | Planned | Same layout language everywhere | [§6](../master-index-plan.md#6-design-system-rules-shared-inventory--page-lift) |
| 08 | [Roadmap & phases](./08-roadmap-and-phases.md) | Living | Phased delivery staff can track | [§8](../master-index-plan.md#8-phased-implementation-roadmap) |

**Status values to use:** `Living` · `Planned` · `In progress` · `Done` · `Paused`

---

## Master–detail linkage (how the two indexes talk)

| Staff question | Staff doc | Technical detail |
|----------------|-----------|------------------|
| Why are we doing this? | [01](./01-big-picture.md) | Technical §1 goals |
| Where does a unit sit physically? | [02](./02-inventory-and-locations.md) | Locations + events + `bin_id` |
| What happens when a test fails? | [03](./03-testing-and-support-tickets.md) | `ticket_links`, signals, claim flow |
| “Where has this serial been?” | [04](./04-item-journey.md) | Connections façade / journey merge |
| Can we leave Zoho later? | [05](./05-external-inventory-zoho.md) | `IInventoryProvider` adapter |
| Walk-in seller drop-off | [06](./06-local-pickup.md) | Pickup intake + optional ERP push |
| Why do screens feel different? | [07](./07-pages-and-design.md) | Archetypes + shared panels |
| What’s next this quarter? | [08](./08-roadmap-and-phases.md) | Phases 0–4 checkboxes |

---

## Related engineering plans (deep follow-up)

Not for the 1-on-1 itself — open only if someone asks “is this already planned in code?”

| Topic | Engineering plan |
|-------|------------------|
| Polymorphic tables | [`docs/todo/schema-wide-polymorphic-refactor-plan.md`](../../todo/schema-wide-polymorphic-refactor-plan.md) |
| Operator surfaces / nav | [`docs/todo/studio-driven-operator-surfaces-refactor-plan.md`](../../todo/studio-driven-operator-surfaces-refactor-plan.md) |
| Inventory upgrade | [`context/inventory_system_upgrade_plan.md`](../../../context/inventory_system_upgrade_plan.md) |
| Gap closure / connectors | [`docs/roadmap/gap-closure-plan.md`](../../roadmap/gap-closure-plan.md) |
| Plan status roll-up | [`docs/todo/README.md`](../../todo/README.md) |

---

## Editing tip

Each staff plan has the same shape: **Now → Change → Done looks like → Links**. Keep language operator-facing. Put file paths and API names only in the “Technical counterpart” section or the technical index.
