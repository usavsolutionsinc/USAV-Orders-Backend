# 04 — Item Journey (“Where has this serial been?”)

> **Status:** Planned  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [Pain: Journey](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves) · [§4.3–§4.4 Connections façade & Journey](../master-index-plan.md#43-connection-façade-query-layer--not-a-new-hub-table)  
> **Related staff plans:** [02 Locations](./02-inventory-and-locations.md) · [03 Tickets](./03-testing-and-support-tickets.md) · [07 Pages](./07-pages-and-design.md)

---

## Why it matters

This is the question every dispute, missing unit, RMA, and “who touched this?” conversation needs answered in **one place**:

> Order # ↔ Serial ↔ Locations ↔ Tests ↔ Support ↔ Pickup / ship

If staff cannot answer it quickly, Cycle Forge feels unfinished — no matter how many stations we have.

---

## What’s happening now

- Pieces of the story exist: inventory events, Operations History / journey API, provenance header, photos, tickets (sometimes), allocations.
- Staff still **assemble** the story by visiting several screens.
- “Drift” in the product means **stock count mismatch alerts** — not this timeline. (See [00](./00-how-to-use-these-docs.md).)

---

## What needs to change

- One shared **Item Journey** panel on serial, inventory, testing, support, and operations drill-in.
- Journey merges: receive origin, moves, tests, tickets, photos, pick/pack/ship, pickup when relevant.
- Deep links (chips) to order, bin, ticket, photos — same chips everywhere.
- Language: call it **Item Journey** in UI and training; reserve **drift** for stock alerts.

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Finding history | Multiple screens | One journey panel |
| Completeness | Gaps (esp. ship / ticket / bin) | Full lifecycle hops |
| Reuse | Each page builds its own list | One shared component |
| Naming | Mixed / confusing with “drift” | Journey vs drift clarified |
| Export / share | Partial (serial journey helpers) | Same story printable / shareable later |

---

## Done looks like

- [ ] Any serial deep link opens journey first.
- [ ] A new hire reconstructs a unit’s week without asking a senior.
- [ ] Support, warehouse, and packing all use the **same** panel language in 1-on-1 upgrades.
- [ ] “Drift” alerts remain a separate inventory health topic.

---

## Practice together (1-on-1)

1. Open a shipped serial from search.  
2. Journey shows: received → tested → putaway bin → allocated → picked → packed → shipped → related ticket (if any).  
3. Click bin chip → bin page; click ticket chip → support; back via browser — same serial context.
