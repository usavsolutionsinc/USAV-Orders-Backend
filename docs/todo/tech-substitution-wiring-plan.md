# Tech station — fulfillment substitution wiring plan

**Status:** Phases 0–2 SHIPPED 2026-07-10 — policy endpoint (`GET /api/fulfillment/substitution-policy`, tech.view) +
`useSubstitutionPolicy`; `tech.substitute_unit` permission (registry + seed + backfill migration
`2026-07-09c_tech_substitute_permission_backfill.sql`, UNAPPLIED) with the substitute POST accepting
packing.substitute_unit OR tech.substitute_unit in-handler; `canShowTechSubstitution` eligibility lib + tests;
`TechSubstituteSection` mounted in `ActiveOrderWorkspace` (active + preview) with the pending-amendment amber banner
and tech-logs/`usav-refresh-data` post-submit reconciliation. §8 decisions taken: permission Option B, no-allocation
Option A (clear empty state), preview substitution allowed when previewOrderId valid, supervisor approval
pending-read-only. **Phase 3 deferred** (collision with in-flight StationTesting/controller work). **Phases 4–5
pending.** Rollout prerequisites (§3.1–3.2, §7) still required: apply migrations, FULFILLMENT_SUBSTITUTION=true,
org `substitutionAllowedNodes` += 'test'.  
**Created:** 2026-07-01  
**Target surface:** `/tech` shipping mode (`ActiveOrderWorkspace` right-pane crossfade)  
**Audience:** Claude Code / implementers — execute phases in order; resolve open decisions in §8 before Phase 0 permission work.

---

## Executive summary

Expose the **ordered-vs-fulfilled substitution flow** (customer reason + substitute serial when shipping a different unit than ordered) on the tech shipping station. The UI, hooks, API, and reason vocabulary **already exist** under `src/components/fulfillment/` but are only mounted in `/design-demo/substitution*`. This plan wires `SubstituteUnitCard` into `ActiveOrderWorkspace` with policy gating, permission alignment, and follow-up work for scan-session sync, mobile, and OOS dock parity.

**Keep separate:** Out of stock / missing parts (`OutOfStockEditorBlock` → `/api/orders/missing-parts`) is a different domain action from substitution (`POST /api/orders/[id]/substitute`).

---

## 1. Goals and non-goals

### Goals

- Let a tech, while an order is active in shipping mode, record that they are shipping a **different unit** than what was ordered/allocated.
- Surface the existing reason vocabulary (`CUSTOMER_REQUEST`, `DAMAGE_FOUND`, etc.) via `SubstituteReasonPicker`.
- Show substitution history on the order via `OrderAmendmentsSection`.
- Respect org policy: `substitutionAllowedNodes`, `substitutionEnforcement`, and the `FULFILLMENT_SUBSTITUTION` rollout flag.
- Fit the station archetype: scan bar stays in sidebar; detail + actions live in the right-pane crossfade (`ActiveOrderWorkspace`).

### Non-goals (this pass)

- Replacing the tech serial scan loop with allocation-first picking.
- Building supervisor approval UI on `/tech` (approve/reject stays pack/supervisor surfaces for now; show pending state only).
- Merging OOS and substitution into one form (they are different domain actions).
- Pack-station mount (same `SubstituteUnitCard` can be a follow-up; tech is the priority).

---

## 2. Two flows — keep them distinct in the UI

| | **Substitution** | **Out of stock / missing parts** |
|---|---|---|
| **Operator intent** | "I'm shipping a different unit than ordered" | "We can't fulfill — need to order parts" |
| **Components** | `SubstituteUnitCard` → `SubstitutePanel` → `SubstituteReasonPicker` | `OutOfStockEditorBlock` → `UpNextActionDock` |
| **API** | `POST /api/orders/[id]/substitute` | `POST /api/orders/missing-parts` |
| **Data** | `order_unit_amendments` + re-allocation | `orders.out_of_stock` text |
| **Permission** | `packing.substitute_unit` (today) → `tech.substitute_unit` (recommended) | existing orders flow |
| **Today on `/tech`** | Not mounted | Preview mode only (`UpNextActionDock`) |

**UX rule:** In `ActiveOrderWorkspace`, show substitution as its own section ("Substitute unit"). Keep OOS in the bottom dock — extend the dock to **active mode**, not just preview (Phase 4).

---

## 3. Prerequisites and blockers

### 3.1 Feature flag

Substitution APIs are gated on `FULFILLMENT_SUBSTITUTION=true` (server env). Default is **OFF**.

**Action:** Confirm migration `2026-06-27e_order_unit_amendments.sql` is applied in target environments. Enable flag in staging first.

### 3.2 Org settings — `test` node must be allowed

Default org settings only allow substitution from **`pick`** (`src/lib/tenancy/settings.ts` → `substitutionAllowedNodes` default `['pick']`).

The substitute route returns **403** if `raised_at_node: 'test'` is not in `allowedNodes`.

**Action (ops):** For USAV, set `fulfillment.substitutionAllowedNodes` to include `'test'` via org settings (Studio or direct JSONB update).

### 3.3 Permission — techs need substitute permission

The substitute route requires `packing.substitute_unit`, not a `tech.*` permission today.

**Decision (pick one before Phase 0):**

| Option | Pros | Cons |
|--------|------|------|
| **A. Grant `packing.substitute_unit` to `technician` role** | Zero API changes; fastest | Semantically odd |
| **B. Add `tech.substitute_unit` permission** | Clean RBAC | Route + registry + manifest + role backfill |
| **C. Route accepts `packing.substitute_unit` OR `tech.substitute_unit`** | Gradual migration | Two permissions to maintain |

**Recommendation:** **Option B** — add `tech.substitute_unit`, update substitute route to accept either permission. Backfill technician role in a migration (pattern: `2026-07-01h_rma_permission_backfill.sql`).

Reads (`pick-tasks`, `amendments`) use `orders.view` — verify technician role has it.

### 3.4 Allocations prerequisite — highest technical risk

`SubstituteUnitCard` loads **open allocations** via `GET /api/orders/[id]/pick-tasks`. If the order has no `order_unit_allocations` rows, the card shows: *"No open allocations to substitute on this order."*

Many tech-station orders may only have `tech_serial_numbers` / SAL scans, **not** unified-engine allocations.

**Decision (pick one):**

| Option | Description |
|--------|-------------|
| **A. Ship as-is** | Substitution only works for allocation-backed orders; empty state otherwise |
| **B. Bridge from active scan session** | Display-only bridge from SAL — **blocked without backend** for API |
| **C. Tech-specific substitute path** | New API: substitute against `tech_serial_numbers` session anchor — larger domain change |

**Recommendation for v1:** **Option A** with clear empty state. **Spike in Phase 0:** sample recent tech-scanned orders — what % have open allocations? If &lt;50%, prioritize **Option C** as Phase 2 before wide rollout.

---

## 4. Architecture overview

```
Sidebar (StationTesting)          Right pane (ActiveOrderWorkspace)
├── StationScanBar                ├── Pane header (variant + Active/Preview)
├── ActiveOrderScanFeedback       ├── OrderPreviewPanel / ActiveOrderBody
└── UpNextOrder                   ├── Scanned serials list
                                  ├── [NEW] Pending substitution banner
                                  ├── [NEW] TechSubstituteSection
                                  │         └── SubstituteUnitCard
                                  │               ├── SubstitutePanel
                                  │               │     └── SubstituteReasonPicker
                                  │               └── OrderAmendmentsSection
                                  ├── ListingResizePanel
                                  └── UpNextActionDock (preview + active)

Gates:
  FULFILLMENT_SUBSTITUTION env
  GET /api/fulfillment/substitution-policy → canSubstitute
  tech.substitute_unit (or packing.substitute_unit)
  substitutionAllowedNodes includes 'test'
```

**Event bridge (existing):** `useStationTestingController` → `tech-active-order-changed` → `useTechOrderPanes` → `TechRightPane` → `ActiveOrderWorkspace`.

---

## 5. Phased implementation

### Phase 0 — Discovery and policy surface (1–2 days)

#### 0.1 Allocation coverage spike

- Query staging/prod: orders with tech SAL scans in last 30 days vs orders with open `order_unit_allocations`.
- Document % eligible for `SubstituteUnitCard` as-is.

#### 0.2 Client policy endpoint

Create `src/app/api/fulfillment/substitution-policy/route.ts` (mirror `GET /api/packing/policy`):

```ts
// Response shape:
{
  enabled: boolean,           // isFulfillmentSubstitution()
  enforcement: 'advisory' | 'block_until_approved',
  allowedNodes: ('pick'|'test'|'pack')[],
  canSubstitute: boolean,     // enabled && allowedNodes.includes('test') && has substitute permission
}
```

- Route permission: `tech.view`
- Server: `getOrganization` + `getSubstitutionEnforcement` + `getSubstitutionAllowedNodes` + `ctx.permissions`

#### 0.3 Client hook

Create `src/hooks/fulfillment/useSubstitutionPolicy.ts` — `useQuery` → policy endpoint.

#### 0.4 Permission (if Option B)

- Add `tech.substitute_unit` to `src/lib/auth/permission-registry.ts`
- Update `src/lib/auth/route-permission-manifest.test.ts`
- Update `src/app/api/orders/[id]/substitute/route.ts` to accept tech permission
- Migration: grant to `technician` role

**Exit criteria:** Policy endpoint correct in staging; technician can POST substitute when flag + node + permission aligned.

---

### Phase 1 — Core mount on active order workspace (2–3 days)

#### 1.1 Eligibility helper

Create `src/lib/tech/substitution-eligibility.ts` + unit tests:

```ts
export function canShowTechSubstitution(input: {
  policy: SubstitutionPolicy | undefined;
  activeOrder: ActiveStationOrder;
  mode: 'active' | 'preview';
  previewOrderId?: number | null;
}): { show: boolean; orderId: number | null; orderLabel: string }
```

| Condition | Result |
|-----------|--------|
| `!policy?.canSubstitute` | hide |
| `sourceType === 'exception'` | hide |
| FBA / FNSKU session | hide |
| Repair session | hide |
| `activeOrder.id` null or ≤ 0 (and no preview id) | hide |
| `orderFound === false` | hide |

#### 1.2 Wrapper component

Create `src/components/tech/TechSubstituteSection.tsx` — thin wrapper:

```tsx
<SubstituteUnitCard
  orderId={orderId}
  orderLabel={orderLabel}
  raisedAtNode="test"
  enforcement={enforcement}
/>
```

#### 1.3 Mount in `ActiveOrderWorkspace`

File: `src/components/tech/ActiveOrderWorkspace.tsx`

- After `ActiveOrderBody` / preview panel, before `ListingResizePanel`
- `useSubstitutionPolicy()` + eligibility `useMemo`
- Preview mode: use `previewOrder.id` when valid

#### 1.4 Layout

- Section separator: `border-t border-gray-200 pt-5 mt-5`
- Part of scroll body, not pinned footer

**Exit criteria:** Scan order → right pane crossfade → substitution visible → submit creates amendment → timeline updates.

---

### Phase 2 — Post-submit reconciliation (2–3 days)

#### 2.1 Invalidate on success

On `useSubstituteUnit` success:

- `invalidateQueries(['tech-logs', techId])`
- `dispatchEvent('usav-refresh-data')`
- Optional: `tech-order-amended` event for controller to refetch serials

#### 2.2 Serial list sync

After substitution, refetch order serials or update `activeOrder` from API response (`fulfilled` unit info).

#### 2.3 Pending amendment banner

When `enforcement === 'block_until_approved'` and amendments query has `PENDING`:

- Amber callout at top of workspace body: order cannot ship until approved.

**Exit criteria:** Post-substitute UI reflects new unit or shows explicit refresh prompt.

---

### Phase 3 — Sidebar + scan feedback alignment (1–2 days)

Parallel UX improvements from tech display audit:

1. Render `errorMessage` / `successMessage` in `StationTesting` (mirror `StationPacking`)
2. Show `activeOrder.inlineMicrocopy` in `ActiveOrderScanFeedback` + `ActiveOrderBody`
3. Extract shared `inferVariant()` → `src/lib/station/active-order-variant.ts`; use in `ActiveOrderWorkspace` header (exception variant)

---

### Phase 4 — OOS dock on active orders (1 day)

Today `UpNextActionDock` only mounts in preview mode.

- Extend `ActiveOrderWorkspace` to mount dock in **active** mode when `activeOrder.id` is valid
- Build `Order` shape via `activeOrderToOrderShape` (same as `ActiveOrderBody`)
- `useUpNextOrderActions` already handles `tech-upnext-action-oos-set` — no change needed

**Copy clarity:**

- Dock: **Out of Stock** = missing parts
- Substitution section: **Substitute unit** = different item shipping

---

### Phase 5 — Mobile `/tech` (1–2 days)

**Problem:** `RouteShell` shows Actions OR History on mobile. Substitution is in History; scanning is in Actions.

**Recommendation v1:** Auto-switch to `?pane=history` on first visible `tech-active-order-changed`. Toast in Actions: "Order opened in History →".

---

### Phase 6 — Testing

| Layer | What |
|-------|------|
| Unit | `substitution-eligibility.ts` |
| Unit | Existing `substitution-reasons.test.ts` |
| Integration | Playwright on `/tech` with mocked substitute API (extend `design-demo/substitution-live` pattern) |
| E2E staging | Scan → substitute `CUSTOMER_REQUEST` + note → verify amendment + audit |
| Permission | User without permission — hidden UI, API 403 |
| Policy | `allowedNodes: ['pick']` only — hidden on tech |
| Pending | `block_until_approved` — pack/ship 409 `amendment_pending` |

**CI:** `permission-registry-guard`, `route-auth-check`, `reason-codes.guard.test.ts`.

---

### Phase 7 — Rollout checklist

1. DB migrations applied (`order_unit_amendments`)
2. `FULFILLMENT_SUBSTITUTION=true` staging → prod
3. Org: `substitutionAllowedNodes` includes `'test'`
4. Grant `tech.substitute_unit` to technician role
5. Staff training: substitution vs OOS
6. Monitor: amendment insert rate, 403/409 on substitute, empty allocation rate

---

## 6. File change manifest

### New files

| File | Purpose |
|------|---------|
| `src/app/api/fulfillment/substitution-policy/route.ts` | Client-readable policy |
| `src/hooks/fulfillment/useSubstitutionPolicy.ts` | React Query hook |
| `src/lib/tech/substitution-eligibility.ts` | Pure gating logic |
| `src/lib/tech/substitution-eligibility.test.ts` | Unit tests |
| `src/components/tech/TechSubstituteSection.tsx` | Thin wrapper over `SubstituteUnitCard` |
| `src/lib/migrations/2026-07-01n_tech_substitute_permission_backfill.sql` | Role grant (if Option B) |
| `src/lib/station/active-order-variant.ts` | Shared variant inference (Phase 3) |

### Modified files

| File | Change |
|------|--------|
| `src/components/tech/ActiveOrderWorkspace.tsx` | Mount substitution; extend dock; pending banner |
| `src/components/tech/ActiveOrderBody.tsx` | `inlineMicrocopy` callout (Phase 3) |
| `src/components/station/StationTesting.tsx` | Scan feedback messages (Phase 3) |
| `src/components/station/ActiveOrderScanFeedback.tsx` | Extract variant helper; microcopy |
| `src/app/api/orders/[id]/substitute/route.ts` | Accept `tech.substitute_unit` |
| `src/lib/auth/permission-registry.ts` | New permission |
| `src/lib/auth/route-permission-manifest.test.ts` | Manifest row |
| `.env.example` | Document `FULFILLMENT_SUBSTITUTION` |

### Reuse unchanged (do not fork)

| File | Role |
|------|------|
| `src/components/fulfillment/SubstituteUnitCard.tsx` | Container |
| `src/components/fulfillment/SubstitutePanel.tsx` | Form |
| `src/components/fulfillment/SubstituteReasonPicker.tsx` | Reason pills |
| `src/components/fulfillment/OrderAmendmentsSection.tsx` | History timeline |
| `src/lib/fulfillment/substitution-reasons.ts` | Reason SoT (`CUSTOMER_REQUEST`, etc.) |
| `src/hooks/fulfillment/useSubstitution.ts` | Mutations + queries |
| `src/hooks/useSubstitutionReasons.ts` | Tenant reason vocabulary |

---

## 7. UI placement spec (`ActiveOrderWorkspace`)

Scroll body top → bottom:

1. Pane header — order id, variant icon, Active/Preview
2. `OrderPreviewPanel` — stat strip
3. Out-of-stock callout (if `out_of_stock`)
4. `inlineMicrocopy` warnings (Phase 3)
5. Scanned serials (`ActiveOrderBody`)
6. Pending substitution banner (Phase 2)
7. **Substitute unit** — `TechSubstituteSection` (Phase 1)
8. `ListingResizePanel` (below scroll)

Pinned footer: `UpNextActionDock` — Start + OOS (preview + active after Phase 4)

---

## 8. Open decisions (resolve before implementation)

1. **Permission model** — Option A / B / C (§3.3). **Default recommendation: B.**
2. **No-allocation orders** — empty state A vs tech API C (§3.4). **Default recommendation: A + spike.**
3. **Preview-before-start substitution** — allow on Up Next preview, or only after tracking scan?
4. **Supervisor approval on tech** — read-only pending only, or inline approve for `packing.approve_amendment` holders?
5. **Default `substitutionAllowedNodes`** — change schema default to include `'test'` for new orgs?

---

## 9. Suggested timeline

| Week | Deliverable |
|------|-------------|
| 1 | Phase 0 + Phase 1 — policy API, permission, workspace mount |
| 2 | Phase 2 + 4 — post-submit sync, OOS on active, pending banner |
| 3 | Phase 3 + 5 + 6 — scan feedback, mobile pane, E2E |
| 4 | Prod rollout + allocation bridge if spike shows high empty-state rate |

---

## 10. Success metrics

- Tech completes substitution end-to-end without leaving `/tech` shipping mode.
- `CUSTOMER_REQUEST` + note in `order_unit_amendments` and audit log.
- `block_until_approved` orders show pending state and block at pack/ship.
- Zero permission-manifest / route-auth CI regressions.
- Low confusion between OOS dock and Substitute section (training + copy).

---

## 11. Reference — existing substitution stack

### Reason codes (SoT)

`src/lib/fulfillment/substitution-reasons.ts`:

- `CUSTOMER_REQUEST` — Buyer asked for a different variant or item
- `CONDITION_REGRADE`, `DAMAGE_FOUND`, `WRONG_ITEM_LISTED`, `OUT_OF_STOCK`, `BETTER_AVAILABLE`, `OTHER`

### API

- `POST /api/orders/[id]/substitute` — `packing.substitute_unit`, body includes `reason_code`, `customer_request_note`, `substitute_serial`, `raised_at_node`
- `GET /api/orders/[id]/amendments` — `orders.view`
- `GET /api/orders/[id]/pick-tasks` — `orders.view`

### Design demos (visual reference)

- `/design-demo/substitution` — static fixtures
- `/design-demo/substitution-live` — real hooks, mocked fetch

### Related docs

- `docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md` — reason_codes / substitution vocabulary (D1)
- `.claude/rules/display/station.md` — station archetype (scan bar vs right pane)
- `.claude/rules/display/motion-crossfade.md` — `TechRightPane` crossfade pattern

---

## 12. Implementation order for Claude Code

Execute strictly in this order:

1. Resolve §8 decisions (at minimum: permission Option B, allocation Option A).
2. **Phase 0** — policy route + hook + permission migration.
3. **Phase 1** — eligibility + `TechSubstituteSection` + `ActiveOrderWorkspace` mount.
4. **Phase 2** — post-submit invalidation + pending banner.
5. **Phase 4** — OOS dock on active mode (can parallel Phase 2).
6. **Phase 3** — scan feedback / variant / microcopy (can parallel).
7. **Phase 5** — mobile pane auto-switch.
8. **Phase 6** — tests before prod.
9. **Phase 7** — rollout checklist.

Do **not** fork `SubstitutePanel` or `SubstituteReasonPicker` — compose existing fulfillment components.
