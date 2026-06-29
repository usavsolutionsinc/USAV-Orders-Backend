# Onboarding & activation — foundational plan

**Status:** plan only (2026-06-27). Greenfield on the app side; every dependency it leans on already exists.
**Owner surface:** first sign-in → `/dashboard` (this repo). **Inbound edge:** CycleForge marketing site (separate repo).
**Companion plans:** [`saas-commercialization-plan.md`](saas-commercialization-plan.md) (Phase 2 = identity + onboarding), [`beta-intake-funnel-plan.md`](beta-intake-funnel-plan.md), [`identity-layer-plan.md`](identity-layer-plan.md).

---

## 1 · Why

A brand-new tenant signs up and lands on a **blank `/dashboard`** with no orders, no channels connected, no guidance. This is the single highest-friction moment in the funnel and the one gap the design-system audit flagged as genuinely unbuilt:

- It is the **trial→paid activation step**. Per the verified v1-tracker-tier strategy the entry is a **14-day Starter trial, no perpetual free tier** — so activation inside that window *is* the conversion metric. A blank dashboard wastes the trial clock.
- It is the **last mile of the landing-page funnel**. The CycleForge site does the selling; the app has to do the *welcoming*. Today the handoff drops the user onto an empty screen with zero continuity from the marketing promise.
- A blank table reads as **broken**; a "Connect your first channel" CTA reads as **ready**. Empty states are cheap trust.

**Non-goal:** this is not a product tour or a tooltip coachmark engine. It is a **self-dismissing, read-time-derived activation checklist** plus typed empty states. Steps complete because the underlying data exists, never because the user clicked "done."

---

## 2 · The funnel, end-to-end (cross-repo)

```
  ┌───────────────────────── CycleForge marketing repo ──────────────────────────┐
  │  /  hero + builder canvas → pricing → CTA                                     │
  │        ├─ "Apply for beta"  → $50 application form → POST /api/beta/apply ────┼──┐
  │        └─ "Start free trial" → /signup?plan=&utm_*=&ref= ─────────────────────┼─┐│
  └──────────────────────────────────────────────────────────────────────────────┘ ││
                                                                                     ││
  ┌───────────────────────────── THIS repo (USAV-Orders-Backend) ──────────────────┐││
  │  POST /api/auth/signup   → org(plan=trial, trial_ends_at=+14d) + admin staff ◄──┘│
  │        seedOrgCatalog + seedDefaultWorkflowForOrg + Stripe customer             ◄┘
  │        ▼ (today: redirect /dashboard)                                            │
  │  NEW → redirect /dashboard?welcome=1   ─ first-run signal                        │
  │        ▼                                                                          │
  │  BootGate (shouldHold) ── first-run check ── warm onboarding stats               │
  │        ▼                                                                          │
  │  GettingStartedChecklist (read-time steps) ── self-dismisses at 100%             │
  │        ▼   each step deep-links to the real surface that satisfies it            │
  │  Connect channel → Import/receive order → Print label → Invite teammate          │
  │        ▼                                                                          │
  │  Activation reached → trial→paid upgrade CTA (Settings → Organization / Billing) │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

Two inbound doors, **one onboarding experience**. The beta-apply door (left) is async and human-approved (see [`beta-intake-funnel-plan.md`](beta-intake-funnel-plan.md)); the self-serve trial door (right) is instant. Both converge on the same first-run checklist — the only difference is which marketing params rode in on the signup URL.

---

## 3 · What already exists (reuse, do not rebuild)

The whole point of this doc: onboarding is **orchestration of shipped parts**, not new capability.

| Piece | Where | Reuse as |
|---|---|---|
| Self-serve signup → org + admin + 14d trial | `src/app/api/auth/signup/route.ts` | Add the `?welcome=1` redirect + persist inbound marketing params |
| First-paint splash gate | `src/components/boot/BootGate.tsx` (`shouldHold`, `consumeBootSplash()`) | Inject first-run detection; warm stats before reveal |
| Org switcher / workspace identity | `ActiveWorkspaceCard` in `src/components/settings/sections/OrganizationSection.tsx` | **Already shipped** — the "which workspace am I in" surface lives in **Settings → Organization**. Onboarding links *to* it, doesn't duplicate it |
| Plan tiers + entitlements | `src/lib/billing/plans.ts`, `src/hooks/useEntitlements.ts` | Gate which steps show per plan; drive the upgrade CTA |
| Channel connect | `GET/POST /api/catalog/platform-accounts`, `src/app/settings/integrations/page.tsx` | The "Connect a channel" step target |
| Empty-state primitive | `src/design-system/primitives/EmptyState.tsx` (used in ~8 places) | The typed empty states on dashboard + tables |
| Checklist state hook | `src/hooks/useChecklist.ts` | Candidate for the checklist UI state (evaluate vs. read-time-only) |
| Auth context w/ memberships | `src/contexts/AuthContext.tsx` (`user`, `memberships[]`, permissions) | Source of org/plan/role for step gating |
| Count surfaces | `/api/catalog/platform-accounts`, `/api/receiving-lines/incoming/summary`, org-scoped `orders`/`staff` queries | Inputs to the onboarding-stats endpoint (§8) |

**Not started (this plan builds):** `src/components/onboarding/*`, the onboarding-stats endpoint, the first-run signal, the dashboard checklist card, and the marketing-param capture.

---

## 4 · The model — read-time steps, self-dismissing

```ts
// src/lib/onboarding/steps.ts  (NEW — the single source of truth for activation)
export type OnboardingStat = {
  platformAccounts: number;
  ordersIngested: number;   // received OR imported
  labelsPrinted: number;
  staffCount: number;
  // per-plan flags from useEntitlements
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'connect', label: 'Connect a sales channel', href: '/settings/integrations',
    done: (s) => s.platformAccounts > 0 },
  { id: 'order',   label: 'Bring in your first order', href: '/dashboard?unshipped',
    done: (s) => s.ordersIngested > 0 },
  { id: 'label',   label: 'Print your first label',    href: '/dashboard?unshipped',
    done: (s) => s.labelsPrinted > 0 },
  { id: 'invite',  label: 'Invite a teammate',         href: '/settings/organization',
    done: (s) => s.staffCount > 1 },
];
```

Rules that keep this honest and cheap:

- **Steps are derived, never stored.** No `onboarding_progress` table at v1. A step is complete iff the data that proves it exists. This means it self-heals (a user who connected eBay before we shipped onboarding already shows step 1 done) and there is nothing to migrate.
- **The card self-dismisses at 100%.** When `completed === steps.length` it renders `null`. No permanent chrome.
- **Dismissible early.** A "Skip for now" stores one boolean in `staff_preferences` (`onboardingDismissed`) — parallel to the existing `unshippedBoard` prefs already in that JSONB (`src/lib/schemas/staff-preferences.ts`). Skipping hides the card but never deletes the underlying truth, so it can reappear if explicitly re-opened from Settings.
- **Steps gate by plan + role.** "Invite a teammate" only shows to admins (`admin.manage_staff`); channel/receiving steps respect entitlement flags from `plans.ts`. Use `useEntitlements()` so a Starter org never sees a step it can't act on.

---

## 5 · Step catalog (v1 — outbound-tracker scope)

Aligned to the verified v1 north star (replace the fulfillment Google Sheet): the default checklist is **outbound-only**. Inbound/receiving/testing steps are deferred behind their plan tiers, matching the upsell ladder.

| Step | Done when | Target surface | Plan/role gate |
|---|---|---|---|
| Connect a sales channel | `platform_accounts > 0` (or eBay/Amazon account linked) | `/settings/integrations` | any · admin |
| Bring in your first order | org has ≥1 order (eBay sync **or** manual/CSV import) | `/dashboard?unshipped` | any |
| Print your first label | ≥1 label recorded (`order_labels`) | `/dashboard?unshipped` | any |
| Invite a teammate | `staff_count > 1` | `/settings/organization` (Invitations) | any · admin only |

> **Growth/Pro extension (later):** once inbound/inventory tiers are live, append plan-gated steps — "Receive your first carton" (`receiving_lines > 0` → `/receiving`), "Set up a workflow" (`/studio`). The step array is plan-filtered, so this is additive config, not a redesign.

---

## 6 · Landing-page handoff contract (the cross-repo seam)

The marketing site and the app are **separate repos** (CycleForge at `/Users/icecube/repos/CycleForge`). The only coupling is the signup URL and the (already-planned) beta-apply API. This plan adds **continuity params** so onboarding can reflect the marketing promise.

**Self-serve trial door — CycleForge CTA links to:**
```
https://app.cycleforge.com/signup?plan=starter&utm_source=&utm_campaign=&ref=
```

**Contract:**
- `signup` route reads `plan` (validated against `plans.ts` tiers; ignored if unknown — trial is still the real starting plan) and the `utm_*`/`ref` params.
- These are **persisted on the org at creation** (e.g. `organizations.settings.acquisition = { plan, utm, ref, appliedAt }`) so attribution survives and a future "you came in on the Growth plan" nudge is possible. No new table.
- `CLIENT_PUBLIC_PATHS` (`src/contexts/AuthContext.tsx`) **and** `PUBLIC_PATHS` (`proxy.ts`) must both list `/signup` — these two hand-synced lists already drifted once (caused `/signup`→`/signin` bounce, fixed in Phase 0). Re-verify on any path change.

**Beta-apply door:** unchanged from [`beta-intake-funnel-plan.md`](beta-intake-funnel-plan.md) — the marketing form POSTs cross-origin to `POST /api/beta/apply` in this repo; that endpoint needs **CORS for the marketing domain**. Approved applicants receive a signup link carrying a `ref=beta` param, which onboarding can use to show a tailored first step (their floor was pre-mapped → "Review your seeded workflow").

> The marketing site currently hardcodes "7 of 20 spots left" — must go data-driven or be removed before launch (trust risk, tracked in CycleForge README). Out of scope for this repo but noted because it sits on the same seam.

---

## 7 · Surfaces (where it renders)

Each region obeys exactly one job — no archetype mixing (per `.claude/rules/contextual-display.md`).

1. **First-run signal** — signup redirects to `/dashboard?welcome=1` instead of `/dashboard`. The param is consumed once (mirror `consumeBootSplash()`), then stripped from the URL so a refresh doesn't re-trigger.
2. **BootGate hook** — `shouldHold` gains a first-run branch; `prefetch` warms the onboarding-stats query (§8) alongside the dashboard data so the checklist paints with the splash, never a flash of empty.
3. **Dashboard checklist card** — a `CardShell` (accent tone) pinned at the top of `/dashboard` *while incomplete*. Linear vertical scaffold, progress bar + `% set up` eyebrow + one `ChecklistRow` per step (icon + label + `Check` when done, deep-links when not). Uses semantic tokens only; self-dismisses at 100%.
4. **Typed empty states** — the dashboard orders table and any first-run table render `EmptyState` with **first-use copy + primary CTA** (not "No results"), branching by type (first-use vs. no-match vs. error) per the workbench rules. This is the cheapest, highest-trust half of the work and can ship before the checklist.
5. **Settings → Organization** — already hosts the org switcher (`ActiveWorkspaceCard`). Add (a) a "Setup" re-open entry that un-dismisses the checklist, and (b) the trial-state + upgrade CTA next to the plan line, linking to `/settings/billing`.

---

## 8 · Data — one cheap aggregate endpoint

```
GET /api/onboarding/stats   → { platformAccounts, ordersIngested, labelsPrinted, staffCount }
```

- **Counts only**, org-scoped via the standard tenant path (`withTenantTransaction` / GUC) — never cross-tenant. One round-trip, all `COUNT(*)` with `staleTime`d React Query (the values change rarely during a first session).
- Reuses existing query surfaces rather than new joins: platform accounts from the catalog table, orders/labels/staff from their org-scoped tables. Degrade-not-fail: a sub-count that errors returns `0`, never 500s the dashboard.
- Route follows the house skeleton: `withAuth(handler, { permission })` → domain helper → map → return (no audit needed; it's a read).

---

## 9 · Phased rollout

| Phase | Ships | Depends on | Effort |
|---|---|---|---|
| **O0 — Empty states** | Typed first-use `EmptyState` on dashboard + first-run tables | nothing (primitive exists) | S |
| **O1 — Stats + steps lib** | `/api/onboarding/stats`, `src/lib/onboarding/steps.ts` | O0 | S |
| **O2 — Checklist card** | `GettingStartedChecklist` on `/dashboard`, `?welcome=1` redirect, BootGate hook, dismiss pref | O1 | M |
| **O3 — Marketing seam** | Capture `plan`/`utm`/`ref` at signup → `organizations.settings.acquisition`; CycleForge CTA points at `/signup?...`; verify dual public-path lists | O2 | S |
| **O4 — Conversion loop** | Trial-state + upgrade CTA in Settings → Org/Billing; `ref=beta` tailored first step | O2, Stripe Phase 0 (done) | M |

Critical path to "a new trial tenant is welcomed, not stranded" = **O0 → O1 → O2** (~days, all reuse). O3/O4 close the attribution and conversion loop.

---

## 10 · Open decisions / risks

- **Read-time vs. stored progress.** v1 is read-time (no table). If we later want "dismissed step 3 permanently" or analytics on *time-to-activation*, a thin `onboarding_events` append-log (org_id, step_id, at) is the additive upgrade — decide when O4 needs funnel metrics, not before.
- **Where the checklist lives.** Recommended: inline card at top of `/dashboard` (in-context, dismissible). Rejected alternatives: a dedicated `/onboarding` page (extra navigation, feels like a wall) and a blocking modal (hostile on a tool the user is trialing). Confirm before O2.
- **`useChecklist.ts` reuse.** Evaluate whether the existing hook fits the read-time model or whether steps should be pure-derived with no hook — avoid bending an interactive-checklist hook into a derived-state display.
- **Beta vs. self-serve divergence.** Keep it to **one param-driven first step**, not two onboarding flows. Two flows is the drift risk (intake-without-product → consultancy, per the beta memory).
- **PIN-only owner auth.** Onboarding assumes a real owner identity; today owner auth is PIN-only with no email verification (`saas-commercialization-plan` blocker #3, `identity-layer-plan.md`). Onboarding doesn't block on it, but the "invite a teammate" and trial-reminder emails depend on a verified email existing — sequence email verification alongside O4.

---

## Appendix · Adjacent item — configurable table mode (status, not in this plan's scope)

Noted here because it surfaced in the same audit and is **further along than onboarding** — it does not need a plan, only finishing:

- **Already wired:** `?layout=board|table` switch in `src/components/unshipped/UnshippedTable.tsx:96`; the full **hydrate→persist** column-preference pattern is proven in `UnshippedShelfBoard` (1/2/3 columns, lane order, per-lane prefs) against `staff_preferences.unshippedBoard` (`src/lib/schemas/staff-preferences.ts`) via `useStaffPreferences`.
- **To finish & connect:** extend `staff-preferences` with a `shippedBoard`/table-columns block (parallel to `unshippedBoard`); add a "Columns" visibility popover to the shipped/dashboard table headers reusing `HorizontalButtonSlider`; teach the generic `DataTable` (`src/design-system/components/DataTable/DataTable.tsx`) to honor a `columnVisibility` map; wire the same `?layout=`/columns URL params the unshipped board already reads. The infra exists end-to-end — this is wiring bespoke tables (`OrdersQueueTable`, `DashboardShippedTable`) onto the established pattern, not new design.
</content>
</invoke>
