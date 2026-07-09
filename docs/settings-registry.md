# Settings Registry — one declarative pattern for per-page, per-tenant settings

> Status: Phase 1 (framework core + receiving as first instance). This doc is the durable
> reference for how configurable behavior is declared, stored, gated, and rendered across the app.

## The problem

Configurable behavior used to be hand-built per feature: a bespoke React section, a hand-validated
route, and a manually-read key, every time. That does not scale to dozens of toggles across ~17
operator pages. The Settings Registry replaces it with the same move this codebase already made for
permissions (`permission-registry.ts`), station blocks (`src/lib/stations`), and workflow nodes
(`src/lib/workflow/registry.ts`): **one flat declarative registry that is the single source of
truth, with storage, validation, UI, gating, and audit all derived from it.**

## The three SaaS axes — keep them separate

Three orthogonal concepts already exist in the codebase. The framework's job is to wire them together
at read time, never to conflate them.

| Axis | Question it answers | Storage | Mechanism |
|---|---|---|---|
| **Entitlement** | Does the plan *unlock* this? (billable) | `organizations.plan` → `src/lib/billing/plans.ts` | `hasFeature(orgId, feature)` / `withAuth({ feature })` |
| **Feature flag** | Is this *rolled out* yet? (temporary) | `organization_feature_flags` | `resolveForOrg()` in `src/lib/feature-flags.ts` |
| **Setting** | How does this org/user *configure* it? | `organizations.settings` / `staff_preferences.prefs` | this framework |

Decision rule for any new behavior: **billable capability → entitlement; risky/staged rollout →
feature flag; user/org configuration → a registry row.**

## The registry (declare once)

Each setting is one entry in `src/lib/settings/registry.ts`, modeled on `PERMISSIONS` in
`permission-registry.ts`. From this single array the framework derives everything else.

```ts
export interface SettingDef {
  key: string;            // 1:1 with its JSONB storage key, e.g. 'receiving.photoPolicy'
  page: SettingPage;      // which surface it attaches to ('receiving' | 'global' | …)
  group: string;          // UI grouping within the page panel ('Capture', 'Scanning', …)
  scope: 'org' | 'staff'; // org → organizations.settings; staff → staff_preferences.prefs
  personalizable?: boolean;// org-scope only: may a staffer override the org default?
  label: string;
  description?: string;
  control: 'toggle' | 'segmented' | 'select' | 'number' | 'text';
  schema: z.ZodTypeAny;   // validation + the default (every schema uses .default(…))
  options?: readonly SettingOption[];   // for segmented/select
  min?: number; max?: number; step?: number; unit?: string;  // for number
  permission?: string;    // required to write an org-scope value (e.g. 'admin.view')
  entitlement?: EntitlementFeature;     // plan gate; locks the control when absent
  advanced?: boolean;     // collapse under an "Advanced" disclosure
}
```

A guard test (`registry.test.ts`, mirroring `permission-registry.test.ts`) enforces unique keys,
non-empty labels, declared pages, valid control/options pairing, and a `.default()` on every schema —
so nothing slips in unreviewed.

## Storage — flat namespaced keys, zero migrations

Both JSONB homes already exist and are tenant-RLS-enforced, so **new settings need no migration** —
they are just new keys.

The one real constraint: `updateOrgSettings` / `updateStaffPreferences` merge with the Postgres `||`
operator, which is a **shallow** merge. A deeply-nested page namespace
(`settings.pages.receiving.x`) would clobber sibling pages on every write. So the framework stores
**flat, dotted, namespaced keys at the top level**:

- org:   `organizations.settings['receiving.photoPolicy']`
- staff: `staff_preferences.prefs['receiving.defaultScanMode']`

This makes `||` per-key safe (each setting is an independent top-level key), keeps registry-key ===
storage-key (no path math), and reads trivially. `OrgSettingsSchema.passthrough()` already tolerates
these keys on old rows, so growth is migration-free. The existing typed keys (`timezone`,
`warrantyDays`, `theme`, `unshippedBoard`) are untouched and keep their dedicated accessors.

Because `StaffPreferencesPutBody` is `.strict()`, the framework does **not** write through the old
`/api/staff-preferences` route. It writes top-level namespaced keys through dedicated raw writers
(`mergeOrgSettingsRaw`, `mergeStaffPreferencesRaw`) that reuse the same `||` merge + cache
invalidation. Grouping by `page`/`group` is a pure registry-filter concern, never a storage concern.

## The three-layer resolver

Effective value resolves most-specific-wins, in `src/lib/settings/resolve.ts`:

```
resolve(def):
  1. entitlement missing on org's plan  → LOCKED   (value = schema default, control disabled)
  2. scope === 'staff'                   → staffVal  ?? schemaDefault
  3. scope === 'org' && personalizable   → staffVal  ?? orgVal ?? schemaDefault
  4. scope === 'org'                     → orgVal    ?? schemaDefault   (hard policy)
```

Stored values are `safeParse`d against the registry schema; an invalid stored value falls back to the
default rather than crashing the read. A locked setting always resolves to its free default
regardless of any stale stored value — entitlement is enforced at read time, not just in the UI.

Case 3 (**org sets the default, staff may override**) is the SaaS-grade behavior. The working
precedent is `staff_preferences.unshippedBoard`; this generalizes it to every page.

## Read path

- **Server domain code** reads org policy through hand-written typed accessors in
  `src/lib/settings/accessors.ts` (same pattern as `getPackingEnforcement` / `getActiveNasBaseUrl`):

  ```ts
  export const getReceivingPhotoPolicy = (s: OrgSettings): ReceivingPhotoPolicy =>
    readOrgSetting(s, 'receiving.photoPolicy', 'optional');
  ```

  These return a fully-typed, defaulted value and are what gets threaded into decision points
  (e.g. the photo gate in `api/receiving/mark-received`).

- **Client UI** reads effective values (with org→staff layering applied server-side) via
  `usePageSettings('receiving')` / `useSetting(key)` in `src/hooks/useSettings.ts`. Non-admins can't
  read org settings broadly, so the server resolves and returns only the effective values the staffer
  is allowed to see.

## Write path

One generic route, `src/app/api/settings/route.ts`:

- `GET ?page=receiving` → resolves every setting on that page and returns
  `{ canManageOrg, plan, items: [{ key, value, source, locked }] }`. The client renders controls from
  the imported registry and fills them from `items`.
- `PUT { key, value, target }` → looks up the def, `safeParse`s the value against `def.schema`,
  enforces entitlement (`getEntitlements`) and permission (`ctx.permissions.has(def.permission)` for
  org writes; self-writes need none), writes via the raw merger for `target` (`org` | `staff`),
  records an audit row (`AUDIT_ACTION.SETTINGS_UPDATE`), and returns the re-resolved value.

The route uses an auth-only `withAuth(handler)` and does **per-setting** permission checks inside the
handler, because one route serves settings with different permissions.

## Entitlement gating + lock UI

A setting's `entitlement` (a `keyof Entitlements['features']`) gates it by plan. Three new/used gates
in Phase 1:

| Setting | Entitlement | Tier |
|---|---|---|
| `receiving.nasBackup = direct` | `nasArchive` | growth+ |
| `receiving.autoTicket` | `automations` (existing) | pro+ |
| `receiving.vision.*` | `advancedVision` | pro+ |

Client lock UI computes entitlements with `entitlementsForPlan(user.organizationPlan)` (no fetch —
`plans.ts` is a pure module) via `useEntitlements()`. A locked control renders disabled with an
upgrade affordance (the `Locked` pattern from `OperationsAnalyticsView`). The server also refuses to
write a gated value, so the lock can't be bypassed.

## Rendering & attachment

`src/components/settings/SettingsPanel.tsx` is the one generic renderer:

```
<SettingsPanel page="receiving" />
  ├─ filter registry by page; split Personal (staff) vs Organization (org; hidden if !canManageOrg)
  ├─ group by `group`; collapse `advanced` rows under a disclosure
  └─ <SettingControl def value source locked onChange />   // dispatch on control type
```

`SettingControl` dispatches to toggle (reusing the `ToggleRow` switch), segmented (the
`AppearanceSection` button-grid style), select, number, and text.

**Attachment, phased:**

1. **Canonical home (Phase 1):** the registry auto-generates a `/settings?section=<page>` entry per
   page (reuses `settings-sections.ts`). Everything in one place, lowest risk.
2. **In-context gear (Phase 2):** a ⚙ affordance per page opens the *same* `SettingsPanel` as a
   popover. Per-archetype slot: Station = scan-bar right slot; Workbench/Monitor = `headerAbove` right
   edge; Canvas = inspector header.

## Adding a new setting (the recipe)

1. Add one row to `SETTINGS` in `registry.ts`.
2. If server domain code reads it, add a one-line typed accessor in `accessors.ts`.
3. Thread the accessor (server) or `useSetting` (client) into the one decision point.

UI, storage, validation, audit, permission gating, and plan-gating are automatic.

## Receiving catalog (first instance)

**Organization policy** (`scope: 'org'`, admin-gated):

| key | control | entitlement | decision point |
|---|---|---|---|
| `receiving.photoPolicy` | segmented (optional / require_one / require_per_item) | — | `api/receiving/mark-received` |
| `receiving.nasBackup` | segmented (off / mirror / direct) | direct → `nasArchive` | `lib/photos/mirror-nas.ts` |
| `receiving.autoTicket` | segmented (off / on_qa_fail / on_unfound) | `automations` | **new** trigger (deferred) |
| `receiving.defaultPutawayBin` | text | — | `mark-received` (replaces env) |
| `receiving.autoPrintLabel` | toggle | — | label helpers |
| `receiving.confirmSerialRemoval` | toggle | — | `ActiveLineConditionSerial` |
| `receiving.vision.consensusNeeded` / `scanIntervalMs` / `sendMaxDim` | number | `advancedVision` | `useLiveLabelScan` |

**Personal** (`scope: 'staff'`, or `org + personalizable`):

| key | control | scope | decision point |
|---|---|---|---|
| `receiving.defaultScanMode` | segmented (tracking / order) | org+personalizable | `ReceivingUnboxScanBar` |
| `receiving.defaultLandingMode` | select | staff | `useReceivingDashboardMode` |
| `receiving.scanSound` / `scanHaptics` | toggle | staff | scan handlers |
| `receiving.autoFocusSerial` | toggle | staff | `useTrackingScan` |
| `receiving.autoPushPhoneCamera` | toggle | org+personalizable | `useTrackingScan` |
| `receiving.accordionExpand` | segmented (active / all) | staff | `useReceivingWorkspacePane` |
| `receiving.autoAdvanceSerial` | toggle | staff | `UnitSlotList` |

`receiving.autoTicket` is the one item that is genuinely new behavior (there is no auto-trigger to
gate today), so its trigger is built separately from this framework.

## File map

| Concern | File |
|---|---|
| Registry + types | `src/lib/settings/registry.ts`, `src/lib/settings/types.ts` |
| Resolver | `src/lib/settings/resolve.ts` |
| Typed org accessors | `src/lib/settings/accessors.ts` |
| Guard test | `src/lib/settings/registry.test.ts` |
| Raw JSONB writers | `src/lib/tenancy/organizations.ts` (`mergeOrgSettingsRaw`), `src/lib/neon/staff-preferences-queries.ts` (`mergeStaffPreferencesRaw`) |
| Entitlements | `src/lib/billing/plans.ts` (`nasArchive`, `advancedVision`) |
| API | `src/app/api/settings/route.ts` |
| Client hooks | `src/hooks/useSettings.ts`, `src/hooks/useEntitlements.ts` |
| Renderer | `src/components/settings/SettingsPanel.tsx`, `src/components/settings/controls/SettingControl.tsx` |
| Section wiring | `src/components/settings/settings-sections.ts`, `src/app/settings/page.tsx` |

## Phased rollout

- **Phase 1 (done):** framework core + full receiving catalog declared/rendered/plan-gated +
  settings-page home. Behaviorally wired into decision points: `defaultPutawayBin` (server,
  mark-received), `confirmSerialRemoval` (client, ActiveLineConditionSerial), `autoFocusSerial` +
  `autoPushPhoneCamera` + `accordionExpand` (client, `useTrackingScan` via stable refs synced by
  effect), `nasBackup` (server, mirror-selection SQL gate).
- **Deferred (need a product call, not just plumbing):** `defaultScanMode` (arming a mode would
  override the dash→PO# auto-detect), `defaultLandingMode` (sync-hook would flicker — wants a
  server-resolve/redirect), `photoPolicy` + `autoPrintLabel` (touch the blocking receive/print
  path), `scanSound` / `scanHaptics` (no existing audio to gate).
- **Phase 2:** in-context ⚙ gears per archetype; push more pages' behaviors into the registry.
- **Phase 3:** the `receiving.autoTicket` trigger (net-new behavior) + upgrade-prompt polish.
