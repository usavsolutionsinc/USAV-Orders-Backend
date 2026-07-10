# 01 — Big picture: connect what we already have

> **Status:** Living  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [Technical §1–§3](../master-index-plan.md#1-executive-summary-goals--how-to-use)  
> **Related staff plans:** [02 Locations](./02-inventory-and-locations.md) · [04 Journey](./04-item-journey.md) · [08 Roadmap](./08-roadmap-and-phases.md)

---

## Why it matters

Cycle Forge is already a serious warehouse platform. The problem is not “we lack features” — it is that **features don’t talk to each other loudly enough**. Staff waste time hopping screens to reconstruct one unit’s story. Connecting those screens is how we become a cohesive product, not a pile of tools.

---

## What’s happening now

- Receiving, testing, packing, inventory, and support each work — but feel like **separate apps**.
- A serial’s history is split across Operations History, inventory panels, ticket threads, and photos.
- Zoho is deeply woven into day-to-day thinking (“check Zoho”) even when the floor already knows the truth.
- New features sometimes reinvent lists, timelines, or ticket links instead of reusing the same pattern.

---

## What needs to change

- Treat **one serial** as the spine of the story (Item Journey).
- Reuse the same journey panel, ticket chips, and location history on every relevant screen.
- Keep **floor operations** (bin, test, pack, pickup) as the source of truth; treat Zoho (or any ERP) as a **plug-in**.
- Every new feature must declare how it **connects** — not only what page it adds.

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Mental model | Many screens, many stories | One unit story, many views into it |
| Tickets | Mostly carton / shipment linked | Also unit-linked; fail → ticket path |
| Locations | Rooms & bins exist; story incomplete | Clear room → rack → bin + movement history |
| External ERP | Feels like “the inventory system” | Swappable catalog/stock adapter |
| New work | Easy to build a silo | Must update connection index + staff plan |

---

## Done looks like

- [ ] Staff can open any serial and see a single readable journey without hunting.
- [ ] Each person gets the relevant topic plans in a 1-on-1 (not a group deck).
- [ ] Engineers refuse PRs that add a parallel timeline or ticket system.
- [ ] Leadership can point at [08 Roadmap](./08-roadmap-and-phases.md) for “what’s next.”

---

## How this links to the rest

```
Big picture (this doc)
  ├── Locations (02)
  ├── Testing ↔ Tickets (03)
  ├── Item Journey (04)
  ├── External inventory (05)
  ├── Local pickup (06)
  ├── Pages & design (07)
  └── Roadmap (08)
         ↕
   Technical master index
```
