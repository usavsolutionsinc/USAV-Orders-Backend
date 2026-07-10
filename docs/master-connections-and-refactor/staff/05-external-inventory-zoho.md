# 05 — External inventory (Zoho & swappable providers)

> **Status:** Planned  
> **Last updated:** 2026-07-10  
> **Staff hub:** [INDEX.md](./INDEX.md)  
> **Technical counterpart:** [§5 Integration architecture](../master-index-plan.md#5-integration-architecture-external-providers)  
> **Related staff plans:** [01 Big picture](./01-big-picture.md) · [06 Local pickup](./06-local-pickup.md) · [02 Locations](./02-inventory-and-locations.md)

---

## Why it matters

Zoho (or any ERP) is excellent as a **catalog and accounting mirror**. It is a poor substitute for **which bin, which test, which pack photo**. If we hard-wire the product to Zoho forever, we cannot sell Cycle Forge to tenants who use something else — and we keep teaching staff the wrong source of truth.

---

## What’s happening now

- Zoho is deeply integrated: POs, some stock mirrors, fulfillment sync, credentials in Settings.
- Day-to-day, people still say “check Zoho” for questions the floor system already answered.
- Connecting / syncing feels like special Zoho buttons and crons, not one “inventory provider” idea.
- Local bins, tests, and packing are already more accurate for warehouse work — but the product story doesn’t always say that out loud.

---

## What needs to change

- Position Zoho as **one inventory provider** a tenant can connect (and someday replace).
- **Local floor truth** stays: room/bin, serial status, tests, pack, local pickup.
- Provider supplies: master SKU list, aggregate on-hand, optional push/reconcile.
- Settings “Sync now” and background jobs share the same provider path.
- Language in 1-on-1s: “Cycle Forge owns the floor; Zoho mirrors the books/catalog.”

---

## Side-by-side

| Topic | Now | Change |
|-------|-----|--------|
| Mental model | Zoho ≈ inventory system | Zoho ≈ connected catalog/ERP |
| Tenant choice | Effectively Zoho-shaped | Choose / swap provider |
| Sync UX | Scattered Zoho tools | One integrations + provider sync |
| Bin / test / pack | Local (good) | Explicitly SoT in docs & UI |
| Future ERP | Painful | Adapter-shaped |

---

## Done looks like

- [ ] New staff 1-on-1s never say “Zoho is our WMS.”
- [ ] Settings shows inventory provider clearly; sync is one action.
- [ ] A second provider can be stubbed without rewriting receiving/testing.
- [ ] Disputes about bin location are resolved in Cycle Forge, not Zoho.

---

## Notes for a 1-on-1 with a lead

- Dogfood tenant can keep Zoho.
- Product becomes sellable to non-Zoho warehouses.
- Less risk when Zoho APIs or plans change — blast radius is the adapter, not the whole app.
