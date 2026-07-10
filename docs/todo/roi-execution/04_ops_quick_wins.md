# Tier 3 — Ops Throughput Quick Wins & Dormant-Feature Rollouts

> **STATUS (2026-07-10 wave — A-items shipped, B-items = owner flips, C1 code shipped):**
> - **A1 staff picker** — SHIPPED on Receiving (triage), Unboxed, Packing via the new shared
>   `StaffFilterButton` (canonical `useStaffFilter`, `?staff=` SoT; receiving's `?staffId=` kept as
>   read-fallback). Testing surface skipped (in-flight collision).
> - **A2 SKU header + edit** — SHIPPED: `LineSkuHeaderChip` (copyable SkuScanRefChip + pencil →
>   inline override, Enter/Esc, optimistic) on `LineEditPanel`.
> - **A3 Zendesk-in-packing** — SHIPPED: `PackZendeskSection` (collapsed-by-default picker +
>   internal-note comment box on the active-order card; scan focus preserved).
> - **B1–B4** — code verified ready-to-flip (see S4 matrix in `../TODO-BACKLOG-SCOUT-MAP.md`);
>   every flip is an **owner env action**, most gated on a migration apply. B2's result-surfacing
>   UI remains unbuilt (photos files in-flight).
> - **C1 ShipStation** — code SHIPPED 2026-07-10: `POST /api/shipping/{rates,labels,labels/void}`
>   + station actions; live use needs per-org vault keys (owner).

Small, high-daily-value items and finished-but-dormant features. All grounded in
`docs/partial/HUMAN-TODO.md` §I (code-verified) + `src/lib/feature-flags.ts`.

---

## A. Small friction fixes (S–M, daily value)

### A1 — Shared `?staff=` picker on every station  ·  Effort M  (HUMAN-TODO I2-3)
Servers already read `?staff=` on `orders`, `shipped`, `receiving-lines`, `packerlogs`,
and the primitive `useStaffFilter.ts` exists — but the **only writer UI** is the Dashboard
`BoardStaffFilter` (`UnshippedShelfBoard.tsx:96`). Receiving exposes a *different*
`?staffId=`; Packing/Testing/Unboxed have no picker; the shared
`design-system/components/StaffFilter.tsx` is rendered **nowhere** (dead).
**Do:** mount the shared `StaffFilter` on Receiving/Packing/Testing/Unboxed, reconcile
`?staff=` vs `?staffId=`, retire the dead component. **Acceptance:** "show my work"
(all-staff → one-staff) works on every high-frequency station.

### A2 — SKU header + in-place edit on the receiving line-edit panel  ·  Effort S  (I2-2)
`LineMatchingSection.tsx:298-320` sets `sku` only as a side-effect of picking a match;
`LineEditPanel.tsx` never renders `row.sku` or lets you override it.
**Do:** render `row.sku` as a header chip + add a direct edit/override affordance.
**Acceptance:** SKU visible and directly editable on the line-edit panel.

### A3 — Zendesk ticket picker in the packing station  ·  Effort S–M  (I1-9)
Comment/assign/photo APIs exist (`api/zendesk/tickets/[id]/comments`, `.../assign`) but are
unreachable from any packing surface (`StationPacking.tsx`, `Pack.tsx`, `packer/**`).
**Do:** surface a ticket picker + comment box in packing, reusing the existing APIs.
**Acceptance:** a packer can attach a comment/photo to a ticket without leaving the station.

---

## B. Dormant features — mostly a flag flip + finish (near-zero build)

Each wraps a **default-OFF** env var over already-wired code (`src/lib/feature-flags.ts`).

### B1 — Ship `FULFILLMENT_SUBSTITUTION`  ·  Effort S–M
Fully wired: `src/lib/fulfillment/substitution.ts` + 4 gated routes
(`orders/[id]/substitute:42`, `order-amendments/[id]/decision:22`,
`orders/[id]/amendments:23`, `pack/ship:203`). Needs migration
`2026-06-27e_order_unit_amendments` applied, then flip. **Impact:** removes a hard stop
when a picked unit ≠ ordered unit (today there's no in-system substitute path).
**Acceptance:** substitute flow works end-to-end for the dogfood org; migration deploy-coupled.

### B2 — Enable + surface Hermes photo auto-analyze  ·  Effort S–M  (I2-1)
`photos/service.ts:222` already enqueues `analyze`; `photos/analyze.ts` has
hermes/vision/catalog providers + `damage_detected`. But `PHOTOS_ANALYZE_ENABLED` /
`_ON_UPLOAD` default false, with **no notification and no result UI**.
**Do:** flip per-org, fire a notification on `damage_detected`, surface results in the
receiving/packer photo UI + mobile. **Acceptance:** damage auto-flagged at receiving with
an operator notification.

### B3 — Roll out `PLACEMENT_STRANGLE_*`  ·  Effort S per site (after observe)
Declarative auto-bin placement for parts-sort / default putaway / RMA restock
(`feature-flags.ts:259-321`), replacing hardcoded env-constant bins. `PLACEMENT_PARITY_OBSERVE`
harness already built. **Do:** run observe window, confirm parity, flip
`_STRANGLE_PARTS_SORT` → `_ReceivingPutaway` → `_RmaRestock` in sequence. **Acceptance:**
auto-placement matches the observed manual decisions before each flip.

### B4 — `RECEIVING_UNIFIED_INBOUND`  ·  Effort M (needs migration + backfill)
Makes `lookup-po` match by LPN/shipment_id first — faster scan resolution on the hottest
receiving path. Runner-up (needs migration + backfill, so larger than a flip).

---

## C. Integration gaps (half-wired; credential-gated)

### C1 — ShipStation outbound label route/UI  ·  Effort M + API keys
The ShipStation v2 (ShipEngine) client is **complete** — rate-shop,
`purchaseLabelFromRate`, `voidLabel`, label download (`src/lib/shipping/shipstation/client.ts:297-305`).
But `find src/app/api -ipath "*shipstation*"` shows only an **inbound** webhook — **no
operator route** exposes rate-shop/buy-label. Label creation is still effectively manual.
**Do:** add an operator route over `getRates`/`purchaseLabelFromRate`/`voidLabel` + a
packing/shipping UI (needs API keys — HUMAN-TODO §A5). **Impact:** biggest per-event time
saved on every outbound shipment. **Acceptance:** staff buy a label from the app; void works.

### C2 — Credential-gated (owner action, track only)
Amazon SP-API multi-tenant (needs Appstore app + PII role, §A3), eBay buyer-purchase sync
(`isIncomingUniversal`, needs tokens, §A5), Nango connector config. Code shipped; blocked
on owner credentials, not engineering.

---

## Suggested order
A2 + A1 + A3 (small daily value) → B1 + B2 (dormant, high-impact) → B3 (after observe) →
C1 (when API keys exist) → B4 / C2 as prioritized.

## Cross-references
- [00 — Index](00_INDEX_ROI_EXECUTION.md) · [01 — Tier 0](01_tier0_flip_switch_wins.md)
- `docs/partial/HUMAN-TODO.md` §I1/I2 (verified net-new + finish-gaps), §A5, §H2.
- Skills: `/sidebar-mode` (A1), `/station-block` (station UI), `/db-migration-author` (B1/B4 migrations).
