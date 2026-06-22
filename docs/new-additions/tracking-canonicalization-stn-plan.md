# Tracking-number canonicalization & STN ingestion — plan

**Status:** proposal · **Created:** 2026-06-22 · **Owner:** receiving / shipping
**Scope:** how scanned vs. pasted tracking numbers of different lengths converge for matching against
`shipping_tracking_numbers` (STN). Records what already exists so we don't rebuild it.

> TL;DR — STN already implements raw/canonical separation, global dedup, provenance, fuzzy search, and
> a full status lifecycle. The durable work is **narrow**: harden one normalizer helper (FedEx GS1 only,
> never USPS), prefer STN's exact-normalized join over last‑8, and optionally backfill ~228 FedEx rows.
> Do **not** build a new ingestion funnel or a traces table — they already exist.

---

## 0. Origin

Surfaced while debugging "scan finds the PO but the carton is empty / 'No PO found'." Two separate issues
came out of it:

1. **The actual bug for the reported PO** was *not* tracking length — it was an unconnected Zoho
   credential vault (`CREDENTIAL_NOT_CONNECTED`). See `project_zoho_two_credential_paths` in auto-memory.
2. **The long-term fragility** is reconciling a scanned barcode (e.g. a 34‑digit FedEx GS1/"96" label)
   with the short human number that gets pasted into Zoho's reference# (e.g. `382141152045`). This plan
   covers #2.

Concrete example: scanner read `9632001960200651497200382141152045`; Zoho reference# held `382141152045`.
Last‑8 (`41152045`) matched only because the human number is the literal tail of the GS1 barcode — luck,
not robustness.

---

## 1. What already exists in STN (verified against live DB, 2026‑06‑22)

`shipping_tracking_numbers` — 41 columns. Relevant existing capability:

| Capability | Mechanism (already in place) |
|---|---|
| Raw + canonical separation | `tracking_number_raw` + `tracking_number_normalized` (both NOT NULL) |
| Global dedup / one row per shipment | `UNIQUE (tracking_number_normalized)` → exact-equality match, **not** last‑8 |
| Provenance ("scan trace" origin) | `source_system` |
| Fuzzy raw search | `gin_trgm_ops` index on `lower(tracking_number_raw)` |
| Single ingestion funnel | `registerShipment` / `registerShipmentPermissive` → `upsertShipment` (`ON CONFLICT (tracking_number_normalized)`) |
| One normalizer (already shared) | `src/lib/shipping/normalize.ts` re-exports `normalizeTrackingNumber` from `src/lib/tracking-format.ts` |
| Status lifecycle + polling + webhooks | `is_delivered`/`delivered_at`/`latest_event_at`, `next_check_at`/`consecutive_error_count`, `webhook_subscription_status`, `latest_payload`/`metadata` JSONB |

Implication: an earlier draft proposed adding a `tracking_scan_traces` table, a new `ingestTrackingScan()`
funnel, and raw retention. **All redundant** — STN covers it. The convergence already happens for anything
that normalizes to the same string; the only gap is values that *should* normalize equal but don't.

### Live data snapshot
- 6,106 STN rows; 6,106 distinct `tracking_number_normalized` (dedup key is clean today).
- **15 last‑8 collision groups** — same trailing 8 digits, different real shipments. Proof last‑8 is
  lossy and must stay a *fallback*, never a primary key.
- 4,184 rows have a long (≥18‑digit) normalized value (mix of legit USPS 22‑digit and FedEx GS1 concat).

---

## 2. The bug this investigation caught

A helper added this session — `extractCanonicalTracking` / `stripFedexConcatPrefix` in
`src/lib/tracking-format.ts` — strips a trailing FedEx-looking slice from long numeric barcodes. Run
against all long STN rows it would rewrite **740**, broken down by carrier:

| Carrier | Rows rewritten by the FedEx-tail strip | Verdict |
|---|---|---|
| USPS | **413** | ❌ wrong — truncates valid 22‑digit USPS |
| UNKNOWN | 99 | ❌ mostly USPS IMpb |
| FEDEX | 228 | ⚠️ plausible; 12‑vs‑15 human-number unverified |

Root cause of the false positives: the strip guesses by *trailing pattern*. USPS/IMpb numbers routinely
end in a 12‑digit run that matches FedEx Express `[39]\d{11}`, e.g.
`9235990407314810260579` (valid USPS) → `314810260579`. Folding this into the global normalized key would
**merge ~500 distinct shipments**.

Current blast radius: the helper is wired only into `lookup-po` tracking-mode, **not** into the STN key,
so STN is not corrupted. But the helper must not be trusted to key anything until hardened.

---

## 3. Corrected plan (small, evidence-driven)

No new infrastructure. Three narrow changes:

### 3.1 Harden (or revert) `stripFedexConcatPrefix` — **required**
- Fire **only** on structurally-unambiguous FedEx GS1 application-identifier barcodes: anchor on the real
  prefix forms (`96` + AI such as `9621`/`9622`, length ≥ 32). Never USPS, never a bare trailing-pattern
  guess.
- This drops the 413 USPS rewrites to **zero**.
- Before trusting even the 228 FEDEX rows, verify the FedEx human number is the trailing **12** vs **15**
  against a couple of real Ground labels (Ground human tracking is often 15‑digit).
- Tests: cross-carrier suite asserting the 413 USPS examples pass through **untouched**; the GS1‑34 FedEx
  example collapses to its human number; UPS `1Z…` and plain 12/15‑digit numbers unchanged.

### 3.2 Prefer STN exact-normalized join; demote last‑8 to fallback — **recommended**
- Receiving's `findScanByTracking` (`src/app/api/receiving/lookup-po/route.ts`) should try exact
  `tracking_number_normalized` first, fall back to last‑8 only on a miss, and **log** when it falls back
  (the 15 collision groups make last‑8 ambiguous).
- Centralize in one helper `resolveShipmentForScan(raw, orgId) → { shipmentId, receivingId, matchKind:
  'exact' | 'last8' | 'none' }` and replace the scattered `RIGHT(regexp_replace(...),8)` SQL.

### 3.3 Optional FedEx-only backfill — **defer until 3.1 verified**
- Re-normalize *only* the ~228 structurally-confirmed FedEx GS1 rows; merge-onto-existing handling
  (keep oldest id, union events, re-point `shipment_id` FKs on `receiving`/`receiving_scans`/`orders`).
- Hand-written, idempotent, tenant-scoped per `db-migration-author` rules. **Dry-run report first.**
- Skip USPS entirely.

---

## 4. Explicitly out of scope (already exists / rejected)
- ❌ New `ingestTrackingScan()` funnel — `registerShipmentPermissive` already is it.
- ❌ `tracking_scan_traces` table / raw_traces JSONB — `tracking_number_raw` + `source_system` +
  `metadata`/`latest_payload` already retain the trace.
- ❌ Folding the *current* (unsafe) `extractCanonicalTracking` into the global `normalizeTrackingNumber` —
  would corrupt ~500 USPS rows. Only the hardened FedEx-GS1 version may ever be considered for that, and
  only with the §3.3 backfill.

---

## 5. Decision log
- **Last‑8 stays a fallback, not a key.** Justified by 15 live collision groups.
- **Canonicalization is FedEx-GS1-anchored, never trailing-pattern.** Justified by 413 USPS false
  positives in live data.
- **STN is the join SoT.** Its `UNIQUE (tracking_number_normalized)` already converges everything that
  normalizes equally; the work is making true GS1/human pairs normalize equally — nothing more.

## 6. Pointers
- Normalizer SoT: `src/lib/tracking-format.ts` (+ `src/utils/carrier-patterns.ts` for patterns).
- Shipping re-export + status maps: `src/lib/shipping/normalize.ts`.
- STN funnel + matching: `src/lib/shipping/sync-shipment.ts`, `src/lib/shipping/repository.ts`.
- Receiving scan ingestion: `src/lib/receiving/record-scan.ts`, `src/app/api/receiving/lookup-po/route.ts`.
- Related plans: `docs/receiving-scans-stn-link-plan.md`, `docs/incoming-tracking-todo-plan.md`,
  `docs/tracking-live-sync-plan.md`.
- Related memory: `project_zoho_two_credential_paths`, `project_tracking_last8_match`.
