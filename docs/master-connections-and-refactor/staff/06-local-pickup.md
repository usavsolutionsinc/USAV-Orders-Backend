# 06 — Local pickup

> **Status:** Planned  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [Pain: Pickup](../master-index-plan.md#22-pain-points-domain-gaps-this-index-solves) · [§5.5 Local pickup](../master-index-plan.md#55-local-pickup-under-the-adapter-model)  
> **Related staff plans:** [05 External inventory](./05-external-inventory-zoho.md) · [02 Locations](./02-inventory-and-locations.md) · [04 Journey](./04-item-journey.md)

---

## Why it matters

Local pickup (seller drops inventory at the dock) is a first-class intake path. If it uses a **different mental model** than carrier POs, staff make mistakes, and the Item Journey has holes (“it came from pickup” missing from the serial story).

---

## What’s happening now

- There is a pickup mode in receiving and a finalize flow that can create a Zoho-style `LCPU-…` PO and a receiving record.
- An older pickup list/path still exists alongside the newer orders model — two ways to think about the same work.
- Zoho-synced pickup POs don’t always create the same **line-level** receive story as normal POs.
- Walk-in **sales** (Square cart) is a different product surface that can feel adjacent but isn’t the same as pickup **intake**.

---

## What needs to change

- **One** pickup intake model for operators.
- Pickup appears on Incoming / receiving with the same clarity as other intake kinds.
- Serials from pickup get the same journey: receive → test → bin → …
- Pushing a PO to Zoho (or another provider) is optional **writeback**, not the definition of pickup.
- Clear labels so walk-in sales ≠ pickup intake.

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Data model | New + legacy paths | Single pickup orders model |
| Operator UX | Mode exists; uneven vs PO receive | Same receive quality as carrier POs |
| ERP PO | Often required / hardcoded vendor | Optional provider push |
| Journey | Easy to miss pickup origin | Provenance shows pickup clearly |
| Sales vs intake | Easy to confuse | Explicit product split in nav/training |

---

## Done looks like

- [ ] Staff learn one pickup checklist in a 1-on-1.
- [ ] A pickup serial’s journey shows origin = pickup and full downstream hops.
- [ ] Incoming board shows pickup work without a secret second tool.
- [ ] Zoho outage does not block recording a local pickup on the floor.

---

## Practice together (1-on-1)

1. Start pickup → add lines → finalize.  
2. Unbox / test as usual.  
3. Open serial journey → origin shows pickup; bin after putaway.
