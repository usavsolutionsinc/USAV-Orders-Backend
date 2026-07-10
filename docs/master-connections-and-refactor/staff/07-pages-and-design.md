# 07 — Pages & design (same language everywhere)

> **Status:** Planned  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [§6 Design system & page lift](../master-index-plan.md#6-design-system-rules-shared-inventory--page-lift)  
> **Related staff plans:** [04 Item Journey](./04-item-journey.md) · [01 Big picture](./01-big-picture.md) · [08 Roadmap](./08-roadmap-and-phases.md)

---

## Why it matters

Inconsistent screens slow training and hide connections. If inventory, support, and admin each feel like a different product, staff won’t discover the journey, ticket chips, or location links — even when the data exists.

---

## What’s happening now

- Core stations (unbox, test, pack) share a stronger pattern: scan → work → recent activity.
- Inventory, support, admin, and some reports still feel **uneven** (different headers, denser tables, fewer shared chips).
- Some pages reinvent lists or timelines instead of reusing the shared journey / ticket / rail patterns.
- Selection, status dots, and tooltips are standardized in the design system — but not every page complies yet.

---

## What needs to change

- Every screen declares its job type:
  - **Station** — scan-driven (receive, test, pack)
  - **Workbench** — pick from list, edit detail (inventory, tickets)
  - **Monitor** — watch / history
  - **Canvas** — graph (studio, parts graph)
- Shared **Item Journey** and **entity chips** (order, serial, bin, ticket) on every entity-centric page.
- Admin and reports either join the same shell language or are clearly labeled as monitor tools.
- Visual rules stay simple: linear layout, status dots + tooltips, no random color inventing.

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Learning curve | Relearn each area | Same anatomy across areas |
| Journey / tickets | Spotty | Always present when relevant |
| Admin | Standalone feel | Lifted or clearly “monitor” |
| Inventory subpages | Many thin pages | Modes of one workbench |
| Design tokens | Strong rules, uneven adoption | Lift priority list executed |

---

## Done looks like

- [ ] In a 1-on-1, the person can describe “left list, right detail, journey at the bottom” for inventory **and** support.
- [ ] No page uses a native browser tooltip for status (“title=” ban stays).
- [ ] New screens start from a shell + shared chips, not a blank layout.
- [ ] Staff feedback shifts from “where do I click?” to “what’s the next ops decision?”

---

## Lift priority (staff-visible)

1. Journey + ticket chips on serial / testing / support  
2. Inventory workbench consistency  
3. Support bidirectional navigation  
4. Admin / reports clarity  
5. Polish remaining outliers (FBA sidebar, etc.)
