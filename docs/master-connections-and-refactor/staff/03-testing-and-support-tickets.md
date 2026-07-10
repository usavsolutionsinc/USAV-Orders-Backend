# 03 — Testing & support tickets

> **Status:** Planned  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [Pain: Testing ↔ tickets](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves) · [§4.5 Testing–ticket pattern](../master-index-plan.md#45-testing--ticket-integration-pattern)  
> **Related staff plans:** [04 Item Journey](./04-item-journey.md) · [01 Big picture](./01-big-picture.md) · [08 Roadmap](./08-roadmap-and-phases.md)

---

## Why it matters

When a unit fails testing, support and warehouse must share **one thread**. Today failures are recorded, but tickets often stay tied to the **carton or shipment**, so the next person scanning the **serial** may not see the claim. That breaks trust between stations.

---

## What’s happening now

- Testing can show and reply on a ticket when the **receiving line / carton** already has one.
- Filing a Zendesk claim from receiving works and is reused in testing reply UI.
- Failures create internal signals (“why it failed”) but **do not automatically create or attach a ticket to the serial**.
- From Support, jumping straight to “this exact unit’s test + bin + photos” is incomplete.

---

## What needs to change

- Tickets can hang on the **serial** as well as the carton/shipment.
- On test **FAIL** (and similar exceptions), the system **links** (and optionally creates) a ticket — with a clear flag so we can roll out safely.
- From the ticket, staff open the unit’s **Item Journey** (test result, photos, location).
- From the unit / testing screen, staff open the same ticket without guessing.

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Ticket anchor | Mostly receiving / shipment | Also serial unit |
| On FAIL | Signal + history; ticket is manual | Auto-link (optional auto-create) |
| Testing UI | Reply if carton has ticket | Always resolve ticket for this unit when linked |
| Support UI | Ticket-centric | Ticket ↔ unit ↔ location bidirectional |
| Duplicate systems | Tempting to invent another queue | One ticket registry for all stations |

---

## Done looks like

- [ ] Fail a unit in testing → ticket appears on that serial within the same flow.
- [ ] Open Support → open ticket → jump to unit journey and bin.
- [ ] Open testing → see ticket chip → reply without leaving context.
- [ ] In a 1-on-1, the fail → ticket → journey loop is practiced in under two minutes.

---

## Practice together (1-on-1)

1. Scan unit into testing → mark FAIL with reason.  
2. Confirm ticket link (or created claim) shows on the unit.  
3. Open Support → same ticket → open unit → see fail reason + photos + location.
