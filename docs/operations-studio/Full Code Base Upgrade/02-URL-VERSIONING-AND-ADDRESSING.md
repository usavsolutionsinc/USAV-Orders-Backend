# URL, Addressing & Versioning Strategy

> Direct answer to the owner's question:
> *"In terms of making it fully modular, the URLs would have to be made into just
> different versions and numbers, correct? What would be industry standard?"*

---

## TL;DR — the verdict

**No. Do not turn page URLs into version numbers. That is an anti-pattern, and it is
the opposite of what modular tools do.**

The industry standard — Notion, Linear, Figma, GitHub, Stripe — is:

1. **URLs stay stable, semantic, and human-readable.** They address a *resource* and
   a *view*, not a build number.
2. **Versioning lives on the entity, not the URL.** Each editable thing keeps an
   immutable/append version history in the database; you *pin* a version with a
   query param (`?v=`) or a sub-path (`/history`, `/versions/3`) when you need to —
   you never rename the route.
3. **Draft vs published is a flag, not a separate URL namespace.**

You have already built the correct version of this. `workflow_definitions` and
`station_definitions` both carry `version` + `is_active`, and the Studio pins a
version with `/studio?v=<id>`. The modular upgrade **generalizes that one pattern**;
it does not introduce numbered routes.

---

## Why "URLs as version numbers" is wrong

| If you number the URLs… | What breaks |
|---|---|
| `/v3/receiving`, `/v4/receiving` | Links rot the moment you publish; bookmarks, QR codes, shared deep-links all break. |
| Route = version | You can't have a *draft* and a *published* version addressable at once without duplicating the whole route tree. |
| Numbers in the path | Humans can't read or guess URLs; search, history, and "copy link" become meaningless. |
| Version baked into the page | Per-org versioning is impossible (org A on v3, org B on v5 — same route, different content). |
| Routing tied to versions | Every publish is a deploy/route change instead of a row update. |

Numbering is appropriate in exactly one place: **API contracts** (e.g. Stripe's
date-based API versions) — and even there it's a header/account setting, not the
resource URL. Your app's **page** URLs are navigation, not API contracts.

---

## What the industry actually does

| Product | URL shape | Where versioning lives |
|---|---|---|
| **Notion** | `notion.so/<workspace>/<Human-Readable-Title>-<opaqueId>` | Page history is an entity feature (revisions); URL is a stable slug + id. |
| **Linear** | `linear.app/<workspace>/issue/<TEAM>-<number>` and named **saved views** | Issue ids are stable & semantic; views are addressable filter-states, not versions. |
| **Figma** | `figma.com/design/<fileKey>/<name>` | **Version history** is inside the file; the URL never changes per version. |
| **GitHub** | `/owner/repo/tree/<ref>/path` | Immutable **commit SHAs** pin a version; the path stays stable. `main` is a moving pointer. |
| **Stripe** | stable resource URLs | **API version** is an account/date setting (a header), never in the resource path. |

The recurring pattern: **stable addressable resource + immutable revisions +
optional pin.** A resource has one canonical URL; a *specific version* is reachable
by adding a pin, not by minting a new route.

---

## The recommended model for this codebase

### 1. Navigation URLs — keep your current conventions

You already do this well in `src/lib/sidebar-navigation.ts`:

- Path per page: `/receiving`, `/studio`, `/inventory`.
- Sub-views as params with a pure round-trip contract (`to()` / `resolveMode()`):
  `?mode=`, `?view=`, `?tab=`, `?section=`.
- Resource detail as a semantic dynamic segment: `/products/[sku]`,
  `/receiving/lines/[id]`, `/o/[orderId]`.

**Keep all of it. Add nothing numbered.**

### 2. Versioned, editable resources — pin with `?v=`

The Studio is the template:

```
/studio?v=<definitionId>&z=<0|1>&focus=<nodeId>&lens=<build|live|gaps>
```

- `v` absent → the org's **active** version (the safe default everyone sees).
- `v=<id>` → pin a specific version (a draft, or a historical published one).
- Draft vs published is the row's `is_active` flag, surfaced in the version
  switcher (`"name · v3 (active)"` / `"(draft)"`), **not** a different route.

Apply the same to every new editable thing (`page_definitions`, `nav_definitions`):
canonical URL is the semantic page; `?v=` pins a revision; a `/history` affordance
(or a Studio panel) lists revisions.

### 3. Addressable view-state — extend the round-trip contract

Anything worth deep-linking (a focused node, an open inspector tab, a filter set)
goes in the query string and gets a `to()` + `resolveMode()` pair so
`resolveMode(apply(to(x))) === x` holds (enforced by `sidebar-navigation.test.ts`).
This is how Linear's "saved views" feel — shareable state, stable route.

### 4. Short, opaque external links — already present

`/o/[orderId]`, `/p/[tracking]`, `/l/[ref]`, `/q/[payload]`, and the GS1
`/01/[gtin]/21/[serial]` routes are the right tool for QR/printed/shared links:
short, stable, opaque-id-based. Versioning never touches these.

---

## DO / DON'T

| ✅ DO | ❌ DON'T |
|---|---|
| Keep semantic route names (`/receiving`, `/studio`) | Rename routes to numbers (`/v3/receiving`) |
| Pin versions with `?v=<id>` | Put the version in the path |
| Store `version` + `is_active` on the entity row | Make each version its own route |
| Use one canonical URL per resource + a `/history` view | Duplicate the route tree per version |
| Make draft vs published a flag | Make draft a separate URL namespace |
| Keep the `to()`/`resolveMode()` round-trip for new state | Hand-roll one-off query parsing per page |
| Version **API** contracts separately (header/date) if needed | Version **page** URLs |

---

## Migration notes

- **No route renames are required** for the modular upgrade. This is a feature: it
  means the work is additive and link-safe.
- When you add `page_definitions` / `nav_definitions`, copy the
  `workflow_definitions` shape verbatim: `(organization_id, key, version)` unique,
  `is_active` publish-flip, `config` jsonb. New tables go through the `/db-migrate`
  skill flow.
- If you ever expose a public/partner **API** that needs versioning, version it at
  the API layer (path prefix `/api/v1/...` or a version header) — that is the *only*
  place a number belongs, and it is unrelated to the app's page URLs.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
