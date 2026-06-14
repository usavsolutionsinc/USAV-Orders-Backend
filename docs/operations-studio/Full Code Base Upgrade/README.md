# Full Code Base Upgrade — Operations Studio Modularization

> The plan to turn this codebase from fixed pages into a **fully modular, editable,
> observable operations system** that lives inside the `/studio` page — with
> industry-standard, Notion × Linear, icons-first 2026 UX.
>
> Every claim here is grounded in the real repo (paths verified). This set sits under
> `docs/operations-studio/` and extends the existing layer docs (`README.md`,
> `operations-studio-plan.md`, `station-builder-ui-plan.md`, `NODE_*`).

---

## Start here

| # | Document | Read it for |
|---|---|---|
| — | **README.md** (this file) | the map + headline answers |
| 00 | [`00-CODEBASE-MAP.md`](./00-CODEBASE-MAP.md) | what exists today (the grounded current state) |
| 01 | [`01-MODULAR-SYSTEM-PROMPT.md`](./01-MODULAR-SYSTEM-PROMPT.md) | **the centerpiece** — paste-ready build prompt |
| 02 | [`02-URL-VERSIONING-AND-ADDRESSING.md`](./02-URL-VERSIONING-AND-ADDRESSING.md) | the URL / versioning answer in full |
| 03 | [`03-DESIGN-LANGUAGE-2026.md`](./03-DESIGN-LANGUAGE-2026.md) | Notion × Linear, icons-first design language |
| 04 | [`04-DATA-FLOW-OBSERVABILITY.md`](./04-DATA-FLOW-OBSERVABILITY.md) | static map + live overlay (see all flows) |
| 05 | [`05-EDITABILITY-MODULARITY-SPEC.md`](./05-EDITABILITY-MODULARITY-SPEC.md) | everything-as-data editing model |
| 06 | [`06-PHASED-IMPLEMENTATION-PLAN.md`](./06-PHASED-IMPLEMENTATION-PLAN.md) | file-level phases + the next 5 PRs |

**To drive the build:** paste the opening message in `01` §0 to Claude Code, scoped
to one phase from `06`. Invoke the `ops-studio` skill first; obey its laws.

---

## The three headline answers

### 1. "Move the Studio tab into the More block" — already done ✅
`studio` is registered in `src/lib/sidebar-navigation.ts` with `kind: 'bottom'`,
which the master-nav (`MasterNavDropdown.tsx`) renders under the **"More"** heading.
It's excluded from the always-visible rail (`MASTER_NAV_RAIL_PAGES`) and is
mobile-restricted (a desktop owner tool). No code change needed.

### 2. "Do the URLs have to become version numbers?" — **No.** ❌→✅
That's an anti-pattern. Industry standard (Notion, Linear, Figma, GitHub, Stripe):
**URLs stay stable and semantic; versioning lives on the entity as immutable
revisions, pinned with `?v=`.** You already do this — `workflow_definitions` /
`station_definitions` carry `version` + `is_active`, and the Studio pins with
`/studio?v=<id>`. Generalize that one pattern; rename **no** routes. Full reasoning:
[`02`](./02-URL-VERSIONING-AND-ADDRESSING.md).

### 3. "Make it fully modular / editable / observable" — the path
**Blocks and nodes stay code; composition and config become data.** The engine
(`src/lib/workflow/`) and station registries (`src/lib/stations/`) already prove the
model; the upgrade widens it to **pages-as-data** and **nav-as-data** on the same
versioned, draft-first, diagnostics-gated, addressable pattern — observed live and
static on one canvas. Full spec: [`05`](./05-EDITABILITY-MODULARITY-SPEC.md) +
[`04`](./04-DATA-FLOW-OBSERVABILITY.md); plan: [`06`](./06-PHASED-IMPLEMENTATION-PLAN.md).

---

## The one-paragraph thesis

The Studio becomes the **single place** the owner builds, observes, and diagnoses the
whole operation. One canvas with semantic zoom (business map → flow graph → station
detail → block binding) and five render-layer lenses (Build / Live / Flow² / People /
Gaps). Everything editable is a **versioned row** (graph, station, page, nav), edited
as a **draft** and **published atomically** behind **blocking diagnostics** and a
**step-up** grant — never by mutating the active version, never by renaming a route.
Live data rides **Ably, never polling**. The look is **Notion × Linear, icons-first**,
built on the existing design system. Read-only observation ships first; editing
unlocks layer by layer.

---

## Guardrails (the laws, in one place)

1. Studio is a **page** (`src/app/studio/`), not an `/admin` tab or a one-off panel.
2. **One canvas, semantic zoom** L0→L3 — no separate page per detail level.
3. **Lenses repaint; never reload / re-layout / navigate.**
4. **Ably for live, snapshots for trends — no polling on the canvas.**
5. **Gaps = diagnostics rules** (`workflow/diagnostics.ts`); `error` blocks publish.
6. **Draft-first, publish atomically** (diagnostics → flip `is_active` → record actor).
7. **Perms:** view `studio.view`, edit/publish `studio.manage` + step-up; registry
   changes pair with `route-permission-manifest.test.ts`.
8. **Registries drive the UI;** labels read their SoTs (`workflow-stages.ts`, etc.).
9. **URLs stay semantic;** versions pin with `?v=`; deep-links round-trip.
10. **New tables go through the `/db-migrate` flow.**

---

## Note on how this was produced

A deep scan of the real codebase grounded every path and claim (103 page routes, 572
API routes, the `src/lib/workflow/` engine contract, `src/lib/stations/` block model,
`src/lib/sidebar-navigation.ts` nav registry, `src/lib/drizzle/schema.ts` versioning
tables, `src/lib/realtime/channels.ts`, and the `src/design-system/` tokens +
primitives). Where these docs name a file, function, table, or flag, it was read in
this repo — not assumed.

_Index for the Full Code Base Upgrade spec._
