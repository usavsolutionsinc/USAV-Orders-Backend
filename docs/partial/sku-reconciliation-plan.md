# SKU Reconciliation — Findings, Target, and Standard-Aligned Plan

**Date:** 2026-06-06 · **Source:** live-DB measurement (not assumptions) · Part of [[relational-reuse-plan]] Phase 3 §3

> **STATUS: PARTIAL — §6 pairing fn + §7 queue + write-path wiring + Step-D code + Step-B COLOR framework shipped.** Updated 2026-06-29.
> Shipped: §7 `pending_skus` queue; the §6 single guarded pairing fn (`resolveSkuCatalogRow` — guarded `-N`
> strip + queue-on-miss); queue-on-miss wiring in the receiving + Amazon-import write paths; the Step-D *code*
> hook (unmapped / `No data` Amazon rows routed to the queue); and **Step B as a COLOR axis** —
> owner confirmed the suffixes encode color, NOT condition — via the config-driven decoder
> `src/lib/inventory/sku-variant.ts` (`-B`→Black, `-W`→White confirmed; `-N`/`-S`/`-SW` explicit
> UNCONFIRMED placeholders that decode to null), the additive `color_code`/`color_label` migration
> (AUTHORED + **APPLIED ✅** — verified 2026-06-29, 0 pending), and additive read-path wiring
> (`resolveSkuCatalogRowWithColor`).
> Still deferred: **Step A** union seed and **Step E** FK wiring (both migration+deploy-coupled),
> the **Step D** `[OLD]-` archive (migration), the Step-B `-N`/`-S`/`-SW` COLOR VALUES (owner input),
> and `pending_skus` tenancy (`organization_id`). The color columns now exist — remaining backfill
> waits only on the owner-confirmed values.
> See the appended sections at the bottom for the completion passes and handoff.

---

## 0. TL;DR

There is essentially **one internal SKU scheme** — a 5-digit zero-padded base number + variant
suffix (`01103`, `00724-B`, `00046-P-17`) — used by `sku_catalog`, `sku_stock`, `orders`, and
`receiving_lines` alike. It only *looks* like disjoint namespaces because of three fixable problems:

1. **The hub is 91% incomplete** — `sku_stock` holds **2,354** distinct base SKUs; `sku_catalog`
   holds **455**. Only **206 bases are shared**; **2,148 physically-stocked base SKUs are absent
   from the catalog.**
2. **Variant suffixes use inconsistent vocabularies** — catalog: `-P-1`/`-P-2` (part index),
   `-BK`/`-WH`/`-GY` (2-letter colors); stock: `-B`/`-W`/`-N`/`-S` (1-letter condition/color).
   Same product+variant, different encoding → exact match fails (only **281 / 2,615** exact).
3. **Two genuinely-separate namespaces need a crosswalk, not a merge** — Amazon FBA seller-SKUs
   (`77-3QJO-XTVO`) and `[OLD]-` archived Zoho items.

This is a textbook **Master Data Management (MDM)** problem: build one product master, normalize the
variant axis, and hang external IDs off a crosswalk. The good news: **GTIN already exists on 1,198 /
1,220 catalog rows (98%)** — the GS1 anchor is largely in place.

---

## 1. Namespaces, measured

| Namespace | Where | Format | Volume | In `sku_catalog`? |
|---|---|---|---|---|
| **Internal base SKU** | sku_stock, sku_stock_ledger, orders, receiving_lines, sku_catalog | `NNNNN` (5-digit, 0-padded) | 2,354 distinct bases in stock | only 455 bases (19%) |
| **Variant suffix (catalog)** | sku_catalog | `-P-1` part idx, `-BK/-WH/-GY/-SV` colors | 746 suffixed rows | n/a |
| **Variant suffix (stock)** | sku_stock | `-B/-W/-N/-S/-SW`, `-1/-2/-3` | 291 suffixed rows | inconsistent w/ catalog |
| **Amazon FBA seller-SKU** | fba_fnskus.sku | `XX-XXXX-XXXX` | 201 | 0% (belongs in crosswalk) |
| **Archived Zoho items** | items.sku | `[OLD]-...` | 746 | excluded by design |
| **Channel junk** | orders.sku | literal `No data`, blanks | 75 ("No data", Amazon) | n/a |

External identifiers already present on the hub: **GTIN 1,198/1,220 (98%)**, UPC 1, EAN 1.
Platform crosswalk (`sku_platform_ids`) populated for: ecwid 193 products, ebay 16, amazon 16.

---

## 2. The reconciliation list (what to fix, by problem class)

### A. Hub completeness — import the physical SKU master *(highest priority)*
- **2,148 base SKUs** in `sku_stock` (with on-hand quantity, e.g. `01103` qty 113) are missing from
  `sku_catalog`. The warehouse — not Zoho — is the source of truth for *what is physically stocked*.
- **Fix:** seed `sku_catalog` from the union of in-use SKUs (`sku_stock` ∪ `orders` ∪
  `receiving_lines` ∪ `sku_stock_ledger`), titles enriched from `items`/`orders.product_title` where
  available, `is_active` flagged by presence of stock.
- **Result:** the hub becomes the true union; downstream FKs become >95% populated instead of ~11%.

### B. Variant-suffix normalization — one controlled vocabulary — **FRAMEWORK BUILT (2026-06-29, COLOR axis)**
- **RESOLVED (owner):** the 1-letter stock suffixes encode **COLOR**, not condition. This is a NEW axis,
  separate from the condition grade (`src/lib/conditions.ts` / `condition-tone.ts` — do NOT conflate).
- Catalog encodes parts as `-P-N` and colors as 2-letter (`-BK`,`-WH`,`-GY`,`-SV`); stock encodes
  color as 1-letter (`-B`,`-W`,`-N`,`-S`,`-SW`). The framework is the config-driven decoder
  `src/lib/inventory/sku-variant.ts`: `SKU_COLOR_SUFFIX_MAP` (config SoT) + `decodeSkuColorSuffix(sku)`
  → `{ base, colorCode, colorLabel } | null`. SEEDED CONFIDENTLY: `-B → BLACK`, `-W → WHITE`.
  Left as explicit **UNCONFIRMED** (decode to null, never tag): `-N`, `-S`, `-SW` — owner must supply the
  COLOR VALUE for each (do NOT guess Navy/Silver/Natural). Same guarded-pattern discipline as
  `strippableVariantBase`: never decodes a `-P-N` part index or a numeric counter suffix.
- **Remaining owner input (the gap):** the COLOR value for `-N` / `-S` / `-SW`. One answer per suffix
  flips its `SKU_COLOR_SUFFIX_MAP` entry to `confirmed: true` with a code/label — no other code change.
- **Migration APPLIED ✅ (2026-06-29):** the additive `sku_catalog.color_code` / `color_label` columns
  (`src/lib/migrations/2026-06-29_sku_variant_color_columns.sql`) are AUTHORED **and applied** (verified
  2026-06-29: 0 pending) — the columns now exist. The decoder backfill into those columns is gated only on
  the owner-confirmed COLOR VALUES (confirmed suffixes can backfill now).
- **Fix (forward):** stop encoding color in the SKU string; carry it as the structured `color_code`/`color_label`
  axis on the master (see §3).

### C. External-ID crosswalk — FBA / ASIN / channel SKUs
- `fba_fnskus.sku` (`77-3QJO-XTVO`) and FNSKU/ASIN are **not** products; they're Amazon identifiers.
  0 currently linked to the hub.
- **Fix:** resolve each FNSKU/ASIN to its internal base SKU and record it in `sku_platform_ids`
  (`platform='amazon_fba'`, `platform_sku=fnsku`, `platform_item_id=asin`). Never store these as a
  catalog SKU. (The 2026-04-07 backfill tried this but matched 0 because the SKUs weren't in the hub
  yet — step A unblocks it.)

### D. Archive / quarantine the dead namespaces
- **746 `[OLD]-` items** → mark `is_active=false` / exclude; do not reconcile.
- **75 `orders.sku='No data'`** (Amazon) → flag as unmapped; route to a channel-mapping exception
  queue, don't pollute the hub.

### E. Stamp the FK forward (the original P3 §3 goal — *after* A–C)
- Tables already have the column but it's barely populated because the hub was sparse:
  `orders` (161/1,221 matched), `fba_fnskus` (0/201). Tables missing it: `sku_stock`,
  `sku_stock_ledger`, `fba_shipment_items`, `stock_alerts`, `bin_contents`, `location_transfers`,
  `cycle_count_lines`, `items`.
- **Fix:** once the hub is the union (A), add `sku_catalog_id` where missing, backfill, add
  `NOT VALID` FKs, then `VALIDATE`. Writers stamp `sku_catalog_id` going forward; the text `sku`
  stays as a denormalized convenience column.

---

## 3. Target model (the goal)

A single **product master** with explicit variant modeling and an identifier crosswalk:

```
product (master / "golden record")          ← one row per real product+variant
  id (internal, stable, surrogate)
  base_sku           NNNNN                   ← the structured internal stock key
  variant_axes:
    color   (controlled: BLACK/WHITE/GRAY/SILVER/…)
    condition (controlled: NEW/USED_A/…/PARTS)   ← already an enum elsewhere
    part_index (for multi-part kits: P-1, P-2…)  ← or model as kit components
  title, category, is_active
  gtin  (GS1 global id — already 98% populated)

sku_platform_ids (crosswalk — already exists)  ← ASIN, FNSKU, ebay/ecwid/amazon listing SKU, zoho id
  (product_id, platform, platform_sku, platform_item_id)

sku_stock / orders / receiving / ledger …       ← carry sku_catalog_id FK + denorm text sku
```

The join key everywhere becomes `sku_catalog_id`; the text `sku` is display-only; external systems
resolve through the crosswalk; GTIN is the global anchor (and already drives the Digital-Link QRs).

---

## 4. Industry standard & how it maps here

| Standard practice | What it means | Status here |
|---|---|---|
| **Single product master / golden record** (MDM) | One authoritative row per product; everything FKs to it | Partial — `sku_catalog` exists but 19% complete → **step A** |
| **GS1 GTIN as global identifier** | GTIN-12/13 (UPC/EAN) identify the product globally | Strong — **98% GTIN coverage** already |
| **SKU = internal stock key, opaque or structured** | Don't overload the SKU string with variant meaning | Violated — variant in suffixes → **step B** |
| **Variant/option model (product ↔ variant axes)** | Color/condition/size as structured attributes, not string codes | Missing → **step B / §3** |
| **Identifier crosswalk (xref)** | ASIN/FNSKU/channel SKUs map to the master, never replace it | Infra exists (`sku_platform_ids`), underused → **step C** |
| **Match/merge + survivorship rules** | Dedup, choose winning attributes deterministically | Needed for the union seed → **step A** |
| **Data-quality exception queue + stewardship** | Unmappable rows (`No data`, `[OLD]-`) get triaged, not force-joined | Missing → **step D** |

---

## 5. Recommended sequence (each step shippable + verifiable)

1. **Seed the union hub (A)** — migration: insert missing in-use base SKUs into `sku_catalog`
   (idempotent, `ON CONFLICT DO NOTHING`), title/active enrichment. *No FKs yet.* Re-measure coverage.
2. **Crosswalk FBA/ASIN (C)** — link `fba_fnskus` → `sku_platform_ids` now that bases exist.
3. **Variant vocabulary (B)** — *needs your suffix→axis mapping*; add controlled variant columns +
   a suffix decoder; backfill.
4. **FK wiring (E)** — add `sku_catalog_id` + `NOT VALID` FKs + indexes; backfill; `VALIDATE` once
   coverage is high. Writers stamp the FK going forward.
5. **Archive/quarantine (D)** — flag `[OLD]-` inactive; route `No data`/unmapped to an exception list.

**Step B blocking question — ANSWERED (2026-06-29):** the stock suffixes `-B / -W / -N / -S / -SW`
encode **COLOR** (owner-confirmed), a NEW axis separate from condition grade. Framework built as the
config-driven `src/lib/inventory/sku-variant.ts` decoder. The **residual** owner input is narrower: the
specific COLOR VALUE for `-N` / `-S` / `-SW` (each is an explicit UNCONFIRMED placeholder that decodes to
null until confirmed). `-B → BLACK` and `-W → WHITE` are confirmed and seeded.

---

## 6. Multi-listing dedup (Ecwid) — keep every listing SKU, pair them to ONE product

**The situation (clarified + measured):** Zoho is the SoT; every other platform links back to it.
Ecwid lists the *same physical product* under several SKUs — sometimes a `-1/-2/-3` counting suffix,
but the data shows it's broader: **different base numbers and zero-padded vs unpadded forms** all for
one product. Example from the live crosswalk: canonical `00145 ← {01288, 01714, 145}`;
`00010 ← {00010-2, 10}`. The goal: keep each listing SKU in the DB, but treat them as **one product**
for pairing/identification.

**The right model is the one you already started — an identifier crosswalk.** Don't add product rows
for the duplicates; add *alias* rows that all FK to one canonical product.

```
sku_catalog            ← ONE row per Zoho SoT product (the canonical identity = sku_catalog_id)
sku_platform_ids       ← every listing/alias SKU (ecwid -1/-2/-3, alt numbers, padded/unpadded,
  (sku_catalog_id FK,     ebay, amazon, FNSKU/ASIN) → points at the ONE canonical product.
   platform, platform_sku)  Already holds 2,499 ecwid listings → 193 products.
operational tables     ← carry sku_catalog_id FK (the pairing key) + keep their text sku (display).
```

So an Ecwid duplicate is **preserved** (as a `sku_platform_ids` row) but **pairs** to the canonical
product through `sku_catalog_id`. "Show as one SKU" = render `sku_catalog.sku` resolved via the FK.

### The single pairing function (the heart of it) — **BUILT (2026-06-29)**

Shipped as `resolveSkuCatalogRow` in `src/lib/inventory/resolve-sku-catalog.ts` (the existing label/reprint
resolver, now extended) rather than a new `resolveSkuToCatalogId` symbol — same algorithm, one place. It keeps
the original chain (explicit id → exact → leading-zero → crosswalk) verbatim, then adds:
- **step 4 — guarded variant-suffix strip:** `strippableVariantBase()` strips ONLY a pure `^[0-9]{4,}-[0-9]+$`
  counter form (`00010-2` → `00010`) and retries the base lookup. It can never fire on `-P-N` part indices
  (non-numeric suffix; an explicit guard belts-and-suspenders it) or color/condition suffixes (`-B/-W/-BK/-WH`),
  so it can't mis-pair distinct SKUs. Skipped entirely when an explicit id was supplied.
- **step 5 — queue-on-miss:** on a total miss it calls `queuePendingSku()` (best-effort; the `null` return and
  every prior path are unchanged).
- **Deps-injected** (`ResolveSkuCatalogDeps = { lookup, queue }`) so the guard boundaries are unit-tested DB-free
  in `resolve-sku-catalog.test.ts` (strips `NNNN-N`, never `-P-N`, never non-numeric, exact/explicit win first,
  queues on miss).

```
resolveSkuToCatalogId(raw):
  1. normalize     → trim, upper, left-pad numeric base to 5 digits   (145 → 00145, 10 → 00010)
  2. exact         → sku_catalog.sku = normalized           ──► canonical id
  3. crosswalk     → sku_platform_ids.platform_sku = raw/normalized (UNIQUE) ──► canonical id
  4. guarded strip → if matches ^NNNNN-<digits>$  AND NOT  ^NNNNN-P-<digits>$,
                      drop the trailing -<digits> and retry 2–3        (00010-2 → 00010)
  5. else          → UNRESOLVED → exception queue (never guess)
```

**Guardrails proven by the data — do NOT use a naive "strip trailing -N":**
- `-P-N` (`00072-P-1`, `00080-P-2`) are **multi-part components = different physical items.** Never
  collapse them to a base. (350 such rows in catalog.)
- `-N` is **overloaded**: `00010-N` are ecwid listings (resolve via crosswalk) but `00003-N` are
  **not** ecwid — so always try the crosswalk (step 3) before any string-strip (step 4).
- Color/condition suffixes (`-BK/-WH`, `-B/-W/-N/-S`) are real variants — out of scope for listing
  dedup; they resolve to their own canonical variant row, not the bare base.

### How to wire it
1. **Backfill the crosswalk** so every in-use ecwid/listing SKU has a `sku_platform_ids` row → its
   canonical `sku_catalog_id` (uses the Zoho link as the authority, with the resolver as fallback).
   Add `UNIQUE(platform, platform_sku)` and an index on `platform_sku` for O(1) pairing.
2. **Add `sku_catalog_id` FK** to the operational tables (`sku_stock`, `orders`, `receiving_lines`,
   `sku_stock_ledger`); backfill it via `resolveSkuToCatalogId`. Keep the text `sku` as-is.
3. **One stock view per product:** because `sku_stock` currently has separate rows per listing SKU
   (`00010-1/-2/-3/-4`), aggregate on-hand by `sku_catalog_id` for the deduped "one product, one
   quantity" view — without deleting the per-listing rows.
4. **`resolveSkuToCatalogId` is the only pairing path** — every importer/scan/report calls it, so the
   rule lives in one place (mirrors how `resolvePriorOutbound` became the single reverse-link helper).

This keeps all listing SKUs queryable, never mutates Zoho's SoT, and makes pairing a single indexed FK
(`sku_catalog_id`) — the MDM identifier-crosswalk standard.

---

## 7. `pending_skus` — the "create in Zoho" to-do queue — **BUILT (2026-06-06)**

The unmatched-SKU half of the above is shipped. When a SKU can't resolve (the product isn't in Zoho
yet), it lands in a durable, deduped, prioritized queue; the FK auto-stamps when the Zoho SKU is created.

- **Table + trigger:** `src/lib/migrations/2026-06-06b_pending_skus.sql` (applied). `pending_skus`
  (status `PENDING|CREATED|IGNORED|DUPLICATE`, `occurrences`, nullable `sku_catalog_id`). A shared
  `fn_normalize_sku()` pads numeric bases to 5 (`9991→09991`, `01103-1` preserved). `trg_resolve_pending_sku`
  (AFTER INSERT on `sku_catalog`) auto-stamps `sku_catalog_id` + flips to `CREATED` — verified end-to-end.
- **Lib:** `src/lib/inventory/pending-skus.ts` — `queuePendingSku()`, `resolveSkuCatalogIdOrQueue()`
  (resolves via the existing crosswalk chain, queues on miss, **never auto-creates locally** — Zoho stays
  SoT), `listPendingSkus()`, `ignorePendingSku()`, `reconcilePendingForCatalog()` (sweep backstop).
- **Schema/types:** `pendingSkus` in `drizzle/schema.ts`. **Tests:** `pending-skus.test.ts`.
- **Unmatched state** = `sku_catalog_id IS NULL` on the operational row + a `PENDING` queue row.

**Write-path wiring — DONE (2026-06-29):** the receiving + Amazon-import write paths now record an unmatched
SKU in the queue (see Session 2026-06-29). `resolveSkuCatalogIdOrQueue()` itself remains an alternative entry
point; the wired paths queue via `queuePendingSku()` directly so the existing resolution result is untouched.

> **DONE 2026-06-28:** §7 is no longer dead code — `queuePendingSku()` is now reachable via
> `/api/sku-catalog/flag-missing`, and the `/api/pending-skus` to-do endpoint (GET list + PATCH ignore over
> `listPendingSkus`/`ignorePendingSku`) was added this session. `resolveSkuCatalogIdOrQueue()` remains
> test-only until the write paths call it.
>
> **CAVEAT:** `pending_skus` is **GLOBAL** — no `organization_id`, and `normalized_sku` is globally `UNIQUE`.
> Add `organization_id` before any multi-tenant use.

---

## Session 2026-06-28 — completion pass

- Added `src/app/api/pending-skus/route.ts` — `GET` (list via `listPendingSkus`) + `PATCH` (ignore via
  `ignorePendingSku`), reusing the existing `sku_stock.view` / `sku_stock.manage` permissions.
- Documented the **GLOBAL, no-`organization_id`** caveat of `pending_skus` (globally `UNIQUE` `normalized_sku`)
  inline in the new route.
- Corrected the stale "dead code / no callers" framing of §7: `queuePendingSku()` is reachable via
  `/api/sku-catalog/flag-missing`.
- No other code changed. Steps A–E remain unbuilt (see handoff).

## Session 2026-06-29 — §6 pairing fn + write-path wiring + Step-D code

CODE-only pass (no migrations, no DB changes — Step A/E/`[OLD]-` archive stay deferred; Step B owner-blocked):

- **§6 guarded pairing fn — `src/lib/inventory/resolve-sku-catalog.ts`.** Extended the existing
  `resolveSkuCatalogRow` (label/reprint resolver) with the guarded variant-suffix strip + queue-on-miss
  + Deps injection. Extracted the original DB lookup verbatim into `lookupSkuCatalogRow` so steps 1–4
  (explicit id → exact → leading-zero → crosswalk, incl. org scoping) are byte-for-byte preserved. New export
  `strippableVariantBase()` is the narrow `^[0-9]{4,}-[0-9]+$` strip (never `-P-N`, never non-numeric).
- **Tests — `src/lib/inventory/resolve-sku-catalog.test.ts`** (DB-free, fakes-injected, 12 cases): strip
  boundaries, exact/explicit win-first, the strip, and queue-on-miss. Run via
  `node --test --import tsx 'src/lib/inventory/resolve-sku-catalog.test.ts'` — green.
- **Write-path queue-on-miss wiring (additive, behavior-preserving):**
  - `src/lib/receiving/receive-line.ts` — when `line.sku` doesn't resolve to `sku_catalog`, capture it and
    `queuePendingSku({ source: 'receiving' })` **after** the receive transaction commits (fresh connection,
    best-effort try/catch — can't poison the txn or block the receive). `catalogId` / downstream writes
    unchanged; replay/idempotent short-circuits never queue.
  - `src/lib/amazon/order-sync.ts` — in the non-`importAll` branch, when the SKU is untracked the row now
    `queuePendingSku({ source: 'orders' })` best-effort before the existing `skippedUntracked++ / return`
    (also satisfies the **Step-D code** hook: unmapped / `No data` Amazon rows route to the queue).
- **Safety:** no call site was swapped to a helper; the inline resolution stayed in place and only an additive
  side-effect was added. `tsc --noEmit` clean across the repo.

## Session 2026-06-29 (b) — Step B COLOR-axis framework

CODE + AUTHORED-migration pass (no migration applied; owner-confirmed suffixes = COLOR, not condition):

- **Decoder — `src/lib/inventory/sku-variant.ts` (NEW).** Config-driven `SKU_COLOR_SUFFIX_MAP` +
  `decodeSkuColorSuffix(sku) → { base, colorCode, colorLabel } | null` + `skuColorVariant()` thin wrapper.
  Seeded confidently: `-B → BLACK`, `-W → WHITE`. Explicit UNCONFIRMED placeholders (`confirmed:false`,
  null code/label, commented "needs owner confirmation"): `-N`, `-S`, `-SW` → decode to null so they can
  NEVER mis-tag data. Guarded pattern (mirrors `strippableVariantBase`): never decodes a `-P-N` part index
  or a numeric counter suffix; case-insensitive token; correct base extraction.
- **A NEW axis, NOT condition.** Deliberately separate from `src/lib/conditions.ts` /
  `src/lib/condition-tone.ts` — color and condition grade do not overlap. No condition module was touched.
- **Migration — `src/lib/migrations/2026-06-29_sku_variant_color_columns.sql` (AUTHORED + APPLIED ✅).**
  Additive nullable `sku_catalog.color_code` + `color_label` (IF NOT EXISTS, idempotent), inheriting the
  existing `organization_id` tenant scoping. Applied + verified 2026-06-29 (db ledger 0 pending) — the
  columns now exist; inert until the decoder backfills; no existing column altered.
- **Migration status verified 2026-06-29 (db ledger 0 pending):** `2026-06-29_sku_variant_color_columns.sql`
  is now APPLIED — `sku_catalog.color_code` / `color_label` exist; remaining Step B is purely owner input
  (the COLOR VALUES for `-N` / `-S` / `-SW`).
- **Read-path wiring (additive) — `src/lib/inventory/resolve-sku-catalog.ts`.** New
  `resolveSkuCatalogRowWithColor(...)` resolves exactly as `resolveSkuCatalogRow` (zero behavior change),
  then attaches the color decoded from the INPUT SKU string as `colorVariant`. Existing resolution result
  unchanged; the 12 existing resolver tests stay green.
- **Tests — `src/lib/inventory/sku-variant.test.ts`** (DB-free, 13 cases): decodes `-B`/`-W`; null for
  `-N`/`-S`/`-SW` unconfirmed; never `-P-N` / numeric counter / unknown token; base extraction; wrapper.
  Run via `node --test --import tsx 'src/lib/inventory/sku-variant.test.ts'` — green. `tsc --noEmit` clean.

## Remaining work — handoff (updated 2026-06-29)

- **[DONE 2026-06-29]** ~~§6 guarded pairing fn~~ — shipped (`resolveSkuCatalogRow` + `strippableVariantBase`).
- **[DONE 2026-06-29]** ~~Wire the queue into the receiving + Amazon-import write paths~~ — shipped (queue-on-miss
  in `receive-line.ts` + `order-sync.ts`). `resolveSkuCatalogIdOrQueue()` remains an unused alternative entry
  point; the scan path (`testing`/mobile scan controllers) is NOT yet wired — extend there if a scan should queue.
- **[DONE 2026-06-29 · partial]** Step D — the **code** hook (route `No data`/unmapped Amazon rows to the queue)
  shipped via `order-sync.ts`. The **`[OLD]-` archive** (flag 746 Zoho items `is_active=false`) is a MIGRATION —
  still deferred below.
- **[MIGRATION]** Step D archive — flag `[OLD]-` items inactive (migration; deferred per CODE-only scope).
- **[MIGRATION-DEPLOY-COUPLED]** Step A union seed — the only existing seed
  (`2026-04-07_backfill_sku_catalog.sql`) seeds FROM Zoho `items` (the *opposite* of the plan's
  warehouse-as-SoT premise; ~91% of physical bases absent). Author the union seed
  (`sku_stock ∪ orders ∪ receiving_lines ∪ sku_stock_ledger`).
- **[MIGRATION-DEPLOY-COUPLED]** Step E FK wiring — none of the 8 listed tables got `sku_catalog_id`;
  add column + `NOT VALID` FK + backfill + `VALIDATE` across the 8 hot tables (high-risk).
- **[DONE 2026-06-29]** ~~Step B variant-suffix semantics — condition vs color~~ — RESOLVED as **COLOR**
  (owner-confirmed). Framework built: `src/lib/inventory/sku-variant.ts` config-driven decoder.
- **[OWNER-GATED · narrowed]** Step B residual — the COLOR VALUE for `-N` / `-S` / `-SW` (each an explicit
  UNCONFIRMED entry in `SKU_COLOR_SUFFIX_MAP`, decoding to null until set). Flip each to `confirmed:true`
  with a code/label once owner confirms; no other code change. `-B → BLACK`, `-W → WHITE` already done.
- **[MIGRATION-APPLIED ✅]** Step B columns — `2026-06-29_sku_variant_color_columns.sql` (additive
  `color_code` / `color_label`) is AUTHORED **and applied** (verified 2026-06-29, 0 pending); the columns
  exist. Remaining: backfill the columns from the decoder (confirmed suffixes only — gated on the owner
  COLOR VALUES above) and optionally add the columns to `drizzle/schema.ts`.
- **[TENANCY]** Add `organization_id` to `pending_skus` (and drop the global `UNIQUE` on `normalized_sku` in
  favor of a per-org key) before any multi-tenant use.
