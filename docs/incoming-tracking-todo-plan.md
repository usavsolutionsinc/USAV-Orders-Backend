# Incoming "Tracking To-Do" — plan

Turn the **Incoming** receiving mode into a top-down **to-do list** that drives the
inbound-ASN gap closed: surface the POs that have **no tracking yet**, let an operator
attach tracking **from the row**, and pin **unmatched shipping emails** above them as the
blocking first step (you can't attach tracking to a PO that doesn't exist yet).

This is mostly **composition + ordering** over pieces that already exist. One popover prop,
one read endpoint, one pinned sidebar section. No schema changes.

---

## 1. Why this shape

The inbound funnel has a hard dependency chain. The to-do list mirrors it, top to bottom:

```
TIER 0 (pinned top — BLOCKING)  Unmatched shipping emails
   email_missing_purchase_orders, pile ∈ (inbox, upload)
   → an email references an order#, but no PO exists in the system
   → action: "Match" → create/publish the Zoho PO
        │  once the PO exists & is issued ↓
TIER 1 (actionable)             POs with no tracking
   delivery_state = AWAITING_TRACKING  (stn.id IS NULL)
   → PO exists, no shipment/tracking registered
   → action: "Add tracking" → row-anchored attach popover
        │  once tracking attached + carrier sync runs ↓
   leaves the to-do → IN_TRANSIT / PENDING_CARRIER → … → DELIVERED → dock scan
```

Ordering is **read-time** (Tier 0 = rank 0, Tier 1 = rank 1; oldest-first within a tier).
No new priority column — same pattern as the existing receiving priority triage.

---

## 2. What already exists (reuse, don't rebuild)

| Piece | Location | Note |
|---|---|---|
| `AWAITING_TRACKING` bucket + count | `IncomingSidebarPanel.tsx:156-164`; summary `incoming/summary/route.ts:91-93` (`WHERE stn.id IS NULL`) | "No tracking" is already a first-class facet. Filter via `?state=AWAITING_TRACKING` (sidebar `setState`, line 598). |
| Attach-tracking popover | `IncomingAttachTrackingPopover.tsx` | Two-state machine: *search PO* → *attach tracking*. POSTs `{trackingNumber}` to `attach-box`. Today it **always starts in search**. |
| Attach-box writer | `api/receiving/po/[poId]/attach-box/route.ts` + `lib/receiving/attach-box.ts` | Guard `receiving.mark_received`; `poId` = `zoho_purchaseorder_id` (or PO#); get-or-creates the carton; emits audit (`RECEIVING_HEADER_UPDATE`). |
| Incoming rows carry the PO id | `api/receiving-lines/route.ts` `view=incoming` (rows expose `zoho_purchaseorder_id`, `zoho_purchaseorder_number`, `delivery_state`, tracking, `vendor_name`, `po_date`) | Every row already has the exact `poId` the popover needs. |
| Unmatched-email worklist | table `email_missing_purchase_orders` (`pile` inbox/upload/ignore/done); read `api/admin/po-gmail/triage`; mutate `PATCH api/admin/po-gmail/triage/[id]`; UI `PoMailboxAdminSection.tsx` | The "needs matching first" tier. **Admin-gated** (`admin.view`). |
| Email rescan (receiving-scoped) | `api/receiving-lines/incoming/email-rescan` (`receiving.view`) | Precedent: a receiving-scoped, counts-only wrapper so floor staff don't 403 on an admin route. We follow this pattern for the to-do read. |
| Feed invalidation | `invalidateReceivingFeeds()` in `lib/queries/receiving-queries.ts` | Popover already calls it. We add the new to-do query key here. |

**Key constraint:** the email worklist read/mutate routes are `admin.view`; the Incoming
sidebar runs under `receiving.view`. So Tier 0 needs a **receiving-scoped, counts + minimal
rows** read (no PII beyond what the sidebar shows), and the **match action** stays
admin-gated for v1 (deep-link out). See §6.

---

## 3. Build phases

### Phase 1 — Row-anchored attach (no backend) ✅ smallest, self-contained
1. **`IncomingAttachTrackingPopover` gains optional props:**
   ```ts
   interface Props {
     presetPo?: { poId: string; poNumber: string | null };
     trigger?: React.ReactNode;          // custom trigger; defaults to the existing button
     open?: boolean;                      // optional controlled mode
     onOpenChange?: (open: boolean) => void;
   }
   ```
   - When `presetPo` is set, seed `selected` from it and **start in the attach state**,
     skipping the search query (`enabled: open && !selected && …` already guards the search
     query, so a seeded `selected` disables it for free).
   - The standalone search usage (current `headerBelow` placement) keeps working unchanged —
     `presetPo` is purely additive.
2. **Inline "Add tracking" on `AWAITING_TRACKING` rows** in the right-pane table
   (`ReceivingLinesTable`): render the popover with `presetPo={{ poId: row.zoho_purchaseorder_id, poNumber: row.zoho_purchaseorder_number }}` and a compact trigger. Show it **only** when `row.delivery_state === 'AWAITING_TRACKING'`.
3. **One-click "Needs tracking" filter**: a shortcut that sets `?state=AWAITING_TRACKING`
   (reuse `setState`). Optionally surface it as a prominent pill at the top of the tile list.

*Deliverable:* operator can filter to no-tracking POs and attach tracking straight from the
row. This alone closes the core ask.

### Phase 2 — `/incoming/todo` read endpoint (receiving-scoped)
New `GET /api/receiving-lines/incoming/todo` — guard `receiving.view`, org-scoped, returns
both tiers in one shot, ranked:

```jsonc
{
  "success": true,
  "emails": {                  // TIER 0
    "count": 12,
    "items": [                 // pile IN ('inbox','upload'), ORDER BY scanned_at ASC, LIMIT 50
      { "id": "uuid", "order_numbers": ["A-1001"], "subject": "…",
        "from": "…", "received_at": "ISO", "snippet": "…", "pile": "inbox" }
    ],
    "truncated": false
  },
  "awaiting_tracking": {       // TIER 1
    "count": 37,
    "items": [                 // distinct PO, ORDER BY po_date ASC, LIMIT 50
      { "po_id": "1234…", "po_number": "PO-558", "vendor_name": "…", "po_date": "ISO" }
    ],
    "truncated": false
  }
}
```

- **Tier 0 query:** `SELECT … FROM email_missing_purchase_orders WHERE organization_id = $org AND pile IN ('inbox','upload') ORDER BY scanned_at ASC LIMIT 50`. Oldest first = FIFO to-do.
- **Tier 1 query:** reuse the **exact incoming predicate** (`workflow_status='EXPECTED' AND COALESCE(quantity_received,0)=0 AND zoho_purchaseorder_id IS NOT NULL AND ${NOT_ZOHO_RECEIVED_PREDICATE}`) joined to `shipping_tracking_numbers` with `stn.id IS NULL`, `GROUP BY zoho_purchaseorder_id` (one row per PO, not per line — matches the summary's `COUNT(DISTINCT …)`), `ORDER BY mirror.po_date ASC NULLS LAST LIMIT 50`.
- **No silent caps:** when `count > 50`, return `truncated:true` and the UI shows "+N more → open full list" (sets `?state=AWAITING_TRACKING`). Per the project's no-silent-truncation norm.
- Add `['receiving-lines-incoming-todo']` to `invalidateReceivingFeeds()` so attaching
  tracking / rescanning email / Zoho refresh all refresh the to-do.
- Read-only route → no idempotency/audit needed. Factor the Tier-1 predicate from a shared
  SQL fragment if one exists (it's the same CASE used by summary + list) to avoid drift.

### Phase 3 — Pinned two-tier to-do section in the sidebar
Add a **scrollable, pinned worklist** to `IncomingSidebarPanel`, above the tiles:
- New `useQuery(['receiving-lines-incoming-todo'], …)`, `refetchInterval: 30_000` (matches
  the summary cadence at line 679).
- **Tier 0 rows (red/amber accent, pinned top):** order#, subject snippet, age. Action
  **"Match"** → deep-link to the admin PO-mailbox triage focused on that row
  (e.g. the existing `PoMailboxAdminSection` route with a `focus={id}` param). v1 = visibility
  + jump-to-match (mutation stays admin-gated — see §6).
- **Tier 1 rows:** PO#, vendor, age. Action **"Add tracking"** → `IncomingAttachTrackingPopover`
  with `presetPo`. Clicking the row body also sets `?state=AWAITING_TRACKING` so the right
  pane mirrors the focus.
- **Empty state:** "All caught up — every issued PO has tracking." Section header carries the
  two tier counts as badges.
- **Layout:** the panel today is `h-auto shrink-0 overflow-visible` with "no scroll body"
  (line 750-751). The to-do list needs its **own bounded scroll region**
  (`max-h-[40vh] overflow-y-auto`) so it doesn't blow out the sidebar; keep the filter
  popover overflow-visible above it.

### Phase 4 — (optional) in-place match + realtime
- **Receiving-scoped match action** so Tier 0 is actionable without `admin.view`: a thin
  `receiving.view` (or a new `receiving.match_email`) wrapper that links an email to an
  existing Zoho PO by `reference_number`/order#, or kicks the create-draft flow. Requires a
  permission decision (§6) — deferred on purpose.
- **Ably realtime:** subscribe the to-do to the existing `shipment.changed` channel (used by
  `IncomingDetailsPanel`) + an email-signal channel so items drop instantly instead of on the
  30s poll.

---

## 4. The transitions that make it "work together"

| Event | Mechanism (already exists) | To-do effect |
|---|---|---|
| Email's PO uploaded/published | reconcile auto-resolve (`reconcile-run.ts`) + po-sync cron flips `pile='done'` (`cron/zoho/po-sync/route.ts:83-90`) | Leaves Tier 0; surfaces in Tier 1 after Zoho refresh (now issued, no tracking). |
| Tracking attached | `attach-box` registers shipment → next carrier sync flips `delivery_state` off `AWAITING_TRACKING` | Leaves Tier 1. Popover already calls `invalidateReceivingFeeds` → to-do refetches. |
| Box physically arrives | dock scan (`receiving_scans`) | Standard receive flow, unchanged. |

So the operator works the list top-down, items fall off as resolved, and the existing
crons/syncs keep it honest without any new background job.

---

## 5. Files to touch

| File | Change |
|---|---|
| `src/components/sidebar/receiving/IncomingAttachTrackingPopover.tsx` | Add `presetPo`/`trigger`/controlled-open props; seed `selected`, start in attach state. |
| `src/components/.../ReceivingLinesTable.*` (right-pane incoming table) | Inline "Add tracking" trigger on `AWAITING_TRACKING` rows. |
| `src/app/api/receiving-lines/incoming/todo/route.ts` | **New** — `receiving.view`, two-tier ranked read. |
| `src/lib/queries/receiving-queries.ts` | Add `['receiving-lines-incoming-todo']` to `invalidateReceivingFeeds`. |
| `src/components/sidebar/receiving/IncomingSidebarPanel.tsx` | Pinned to-do section + its query + the `AWAITING_TRACKING` quick filter. |
| (Phase 4) `src/app/api/receiving-lines/incoming/match-email/route.ts` | **New, optional** — receiving-scoped match. |

---

## 6. The one decision: who can "Match" a Tier-0 email

Matching = creating/publishing a Zoho PO — a meaningful upstream write. Today that lives
behind `admin.view` (`po-gmail/triage`, `create-zoho-draft`).

- **Recommended v1 (default):** Tier 0 is **read-only in the receiving sidebar** — it shows
  the count + rows and **deep-links** to the existing admin triage UI for the actual match.
  No permission changes, full reuse, ships immediately.
- **Phase 4 opt-in:** add a receiving-scoped match action (new `receiving.match_email`
  permission) so floor staff resolve Tier 0 in place. Bigger surface, needs the
  permission-registry guard + manifest test.

Recommendation: ship v1 deep-link, revisit in-place match once the to-do is in daily use.

---

## 7. Verification

- **Manual:** filter `?state=AWAITING_TRACKING` → "Add tracking" from a row → scan a number →
  row leaves the to-do after carrier sync; counts decrement. Rescan email → Tier 0 populates.
- **API review:** run `api-route-reviewer` on the new `/incoming/todo` route (auth guard +
  Zod on query params); it's read-only so no idempotency/audit expected.
- **E2E:** add a `tests/e2e` spec — "incoming → filter awaiting tracking → attach from row →
  PO drops out of the no-tracking list" (use the `e2e-spec-writer` conventions).
```
