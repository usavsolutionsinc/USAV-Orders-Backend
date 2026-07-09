# Testing vs Receiving / Unbox isolation

Cycle Forge keeps **Testing** (`/test`) and **Receiving** (`/unbox`, `/triage`, `/incoming`, `/pickup`, `/receiving/history`) as separate operator surfaces. They may share design-system components and product models, but **must not share mode state, API feeds, or storage keys**.

## Surface identifiers

| Surface | Route | Mode source | Scoped query params |
|---------|-------|-------------|---------------------|
| Unbox | `/unbox` | path (no `?mode=`) | `unboxview`, `recvId`, `lineId` |
| Triage / Receiving | `/triage` | path | `triview`, `triq` |
| Incoming | `/incoming` | path | `incview`, `state`, `sort`, `po_from`, `po_to`, `page` |
| History | `/receiving/history` | path | `q`, `field`, `scope` (history search) |
| Testing | `/test` (legacy `/tech`) | `?view=testing` \| `?view=testing-history` | `view`, `search` |

**Source of truth module:** `src/lib/surface-isolation.ts`

## API boundaries

| Endpoint | Permission | Allowed `view=` values |
|----------|------------|------------------------|
| `GET /api/receiving-lines` | `receiving.view` | All **except** `testing`, `needs-test` → **403** |
| `GET /api/testing/receiving-lines` | `tech.qc_pass` | **Only** `testing`, `needs-test` |

Client callers for testing rails:

- `TestingRecentRail` → `/api/testing/receiving-lines`
- `TestingHistoryList` → `/api/testing/receiving-lines`
- Mobile `TestingRecentPanel` → `/api/testing/receiving-lines` when `view=testing`

Receiving scan resolution (`resolve-testing-scan.ts`) still uses `/api/receiving-lines` with `view=all` for **read-only line lookup** — that is intentional (not a feed/list mode leak).

## TEST* tracking shortcut

`POST /api/receiving/lookup-po` previously created synthetic cartons for any tracking starting with `TEST`. This is now **gated** to:

- QA sandbox org (`resolveQaOrgId()`), or
- `ALLOW_TEST_TRACKING=true` in env

**Module:** `src/lib/tenancy/test-tracking.ts`

## URL hygiene

`useSurfaceParamHygiene()` (mounted on Receiving + Testing page shells) strips cross-surface params on navigation:

- On receiving paths: drops `view` (testing)
- On `/test`: drops `mode`, `unboxview`, `triview`, incoming filters, etc.

Mode switches in `useReceivingMode` and `TechSidebarPanel` also call `stripCrossSurfaceParams`.

## localStorage namespacing

Carton scratch keys are org-scoped:

```
receiving:{orgId}:sidebar.lineDetails.v1:{receivingId}
```

Legacy keys (`receiving.sidebar.lineDetails.v1:*`) are read as fallback only.

## Path-first receiving mode

Event listeners (e.g. `useReceivingSelection`) must use `resolveLiveReceivingMode(pathname, searchParams)` — **not** `searchParams.get('mode')` alone — so `/receiving/history` is detected as History without `?mode=history`.

## Anti-patterns

- Calling `/api/receiving-lines?view=testing` from production receiving UI
- Passing `staff_id` / `staff_name` in request bodies for attribution (use session actor)
- Using `?view=testing` on `/unbox` or `/triage` URLs
- Creating `TEST*` cartons outside QA org

## Verification checklist

1. Open `/test?view=testing` → scan / pair → confirm Unbox Recent rail unchanged
2. Open `/unbox` → scan real PO → confirm Testing rail unchanged
3. Deep-link `/unbox?view=testing` → `view` stripped on load
4. `GET /api/receiving-lines?view=testing` → 403
5. `GET /api/testing/receiving-lines?view=testing` → 200 (with `tech.qc_pass`)
6. Timeline actor matches logged-in staff after mark-received / status updates
