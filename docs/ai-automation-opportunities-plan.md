# AI Automation Opportunities — Hermes Integration Roadmap

_Goal: inventory every **manual, human-driven task** across the USAV ops app that the
existing Hermes AI integration could plausibly take over (draft, classify, match, predict,
or fully automate), and sequence them by value and effort._

Author pass: 2026-06-03. Status: proposal / discovery. Companion to
[`ai-chat-ux-plan.md`](./ai-chat-ux-plan.md) (which covers the chat *surface*; this doc
covers everything the agent could *do* beyond chat).

---

## 1. Where the AI integration stands today

Hermes is wired in, but it is almost entirely **read-only Q&A**. Today it can:

| Capability | Where | Notes |
|---|---|---|
| Chat Q&A over live ops data | `src/app/api/ai/chat/route.ts` | local-ops → RAG → Hermes LLM cascade |
| Deterministic local-ops answers | `src/lib/ai/ops-assistant.ts` | shipping summaries, missing-attribution — no LLM |
| Intent + param extraction | `src/lib/ai/intent-router.ts` | regex domains: orders/staff/repair/receiving/fba/inventory/exceptions/bose |
| Bose service-manual RAG | `src/lib/ai/nemoclaw-rag.ts` | vector search + synthesis |
| **PO-email field extraction (LLM)** | `src/lib/po-gmail/extract-llm.ts` | **the one real "do work" automation today** |
| ML pairing *suggestions* | `sku_pairing_suggestions` table | suggestions only; human accepts/rejects |

**The proven template is already in the repo.** `extract-llm.ts` shows the pattern every
item below should follow: a forced OpenAI-style **tool call** against the local Hermes
gateway (`HERMES_API_URL`), `temperature: 0`, **per-field confidence scores**, and a UI
that requires **operator confirmation** before acting. Local-only, no cloud fallback.

**The gap:** Hermes can *answer* but cannot *act*, *draft*, *classify*, or *see*. Every
opportunity below is about extending that one extraction pattern to the rest of the app.

---

## 2. The five AI capability types (how to read this doc)

The ~50 distinct manual tasks found in the scan collapse into **five reusable capability
types**. Building each *once* unlocks many tasks:

| Type | What it does | Infra needed | Risk profile |
|---|---|---|---|
| **A. Draft** | Generate text a human edits before sending | text model (have it) | low — human edits |
| **B. Classify / route** | Pick a label/bucket from a fixed set + confidence | text model (have it) | low–med — confirm low-confidence |
| **C. Match / rank** | Fuzzy-link two records, rank candidates | text model + embeddings | med — confirm the link |
| **D. Predict / optimize** | Suggest a number/plan from history | text model + history queries | med — suggest, don't commit |
| **E. See (vision)** | Judge a photo (condition, damage, OCR) | **multimodal model (NOT loaded)** | high — needs new model |

> Types A–D run on the local text gateway you already have. **Type E (vision) requires a
> multimodal model** in the Hermes runtime — it's the one hard infra prerequisite, and it
> gates the highest-volume warehouse tasks (condition grading, damage claims, serial OCR).

---

## 3. Opportunities by capability

### A. Draft — text the agent writes, the human edits (LOW RISK, do first)

These are pure wins: the agent pre-fills, the human keeps the pen. Several already have
hand-built string templates that an LLM would write better with context.

| # | Manual task today | Where | Already partial? |
|---|---|---|---|
| A1 | **Zendesk receiving-claim body** — operator types "what happened" + edits subject/desc | `ReceivingClaimModal.tsx`; `zendesk-claim/preview/route.ts`; `lib/zendesk-claim-template.ts` | static template only |
| A2 | **Unfound-queue → Zendesk push** — compose ticket body for an unmatched item | `unfound-queue/[kind]/[id]/push-to-zendesk/route.ts` | server template |
| A3 | **Repair Zendesk ticket description** — RS#, product, SN, issue, due date | `lib/zendesk.ts:203` `buildRepairDescription` | hardcoded template |
| A4 | **Repair notes / repair-outcome description** — "Replaced driver in left cup" | `RepairDetailsPanel.tsx`; `repair-service/repaired/route.ts` | none |
| A5 | **Unfound USA/Vietnam team notes** — diagnostic next-steps for remote QA | `unfound-queue/[kind]/[id]/route.ts` | none |
| A6 | **Manual display-name** — name for a product manual (defaults to "{item} Manual") | `ManualAssignmentTab.tsx`; `manuals/upsert/route.ts` | dumb default |
| A7 | **eBay/Ecwid listing title & description** — verify/rewrite per platform | `sku-catalog/sync-ecwid-titles/route.ts` | sync only, no gen |
| A8 | **SKU catalog product title** from raw order titles | `sku-catalog/route.ts` POST | none |

**Why first:** the agent already drafts PO fields (`extract-llm.ts`); these reuse the exact
same gateway call with a different schema. Human-in-the-loop = near-zero downside.

### B. Classify / route — pick a label from a fixed set (LOW–MED RISK)

The app is full of dropdowns where a human reads context and picks an enum. Each is a
classification call with a confidence score; auto-fill high-confidence, confirm the rest.

| # | Manual task today | Where | Fixed set |
|---|---|---|---|
| B1 | **PO-email triage pile** — inbox / upload / ignore / done | `admin/po-gmail/triage/[id]/route.ts` | 4 piles |
| B2 | **Claim type + severity** — damage/missing/wrong/defect/unfound × low/med/high | `ReceivingClaimModal.tsx`; `lib/zendesk-claim-template.ts` | auto-'unfound' only |
| B3 | **Disposition code** — ACCEPT/HOLD/RTV/SCRAP/REWORK from condition+QA | `receiving-lines/route.ts`; `TestingStatusPills.tsx` | rule-of-thumb today |
| B4 | **Return platform / target sales channel** — ebay/amazon/walmart/ecwid/repair | `receiving/[id]/route.ts`; `Mode2Unboxing.tsx` | inventory-rule pick |
| B5 | **Repair issue category** from free-text symptom | `RepairIssuesManagementTab.tsx`; `repair/issues/route.ts` | static templates |
| B6 | **Work-order queue triage** — which queue a work item belongs to | `work-orders/route.ts:69` | entity-type derived |
| B7 | **Product category** assignment for a new SKU | `sku-catalog/route.ts` POST | none |
| B8 | **Dashboard smart filters** — turn "Michael's unshipped FBA" into a query | `dashboard/page.tsx` | text search only |

### C. Match / rank — fuzzy-link two records (MED RISK, confirm the link)

High-frequency exception-handling work. Some already have deterministic key-matching;
AI extends coverage to the fuzzy long tail that currently falls to humans.

| # | Manual task today | Where | Today |
|---|---|---|---|
| C1 | **Carton → Zoho PO line match** when tracking/SKU don't auto-resolve | `receiving/match/route.ts`; `receiving/lookup-po/route.ts` | priority tree + manual override |
| C2 | **Vendor disambiguation** for PO drafts (>1 Zoho vendor match) | `admin/po-gmail/create-zoho-draft/[id]/route.ts` | 422 → operator picks |
| C3 | **Tracking / order exception resolution** — unmatched scans | `lib/orders-exceptions.ts`; `lib/tracking-exceptions.ts`; `tracking-exceptions/route.ts` | key18+last8 only; rest manual |
| C4 | **Unmatched-receiving → PO** fuzzy match (vendor/date heuristics) | `lib/receiving/reconcile-unmatched.ts` | exact Zoho search, hourly cron |
| C5 | **SKU ↔ platform pairing** accept/reject (eBay/Walmart/Amazon) | `manuals/SkuPairingPanel.tsx`; `sku-catalog/pair*/route.ts` | **ML suggestions exist**; human decides |
| C6 | **item_number lookup** from product_title | `orders/set-item-number/route.ts` | manual entry |
| C7 | **Add-unmatched-line product search** — find the catalog item for a mystery carton item | `receiving/add-unmatched-line/route.ts`; `EcwidProductSearchPopover.tsx` | human searches |
| C8 | **Manual ↔ product Drive-doc match** — find the right PDF for a SKU | `ManualAssignmentTab.tsx`; `manuals/upsert/route.ts` | manual search |
| C9 | **Serial duplicate detection** across history | `lib/tech/serial-attach.ts` | format validation only |

### D. Predict / optimize — suggest a number or a plan (MED RISK, suggest only)

These need history queries the DB already supports. Suggest a default; never auto-commit a
money/shipping decision without confirmation.

| # | Manual task today | Where | Signal available |
|---|---|---|---|
| D1 | **FBA expected-qty** for a new/added FNSKU | `FbaCreateShipmentForm.tsx`; `StationFbaInput.tsx`; `fba/shipments/today/items/route.ts` | prior `actual_qty` per SKU |
| D2 | **FBA box / UPS-tracking allocation** (qty split across boxes) | `FbaPairedReviewPanel.tsx`; `FbaQtySplitPopover.tsx`; `shipments/[id]/tracking` | item qty, box count, weight |
| D3 | **Order → staff assignment** (load-balance tech/packer) | `orders/assign/route.ts`; `ManualAssignmentTab.tsx` | queue depth, skills, recent pace |
| D4 | **Order ship-by deadline** from channel SLA + capacity | `orders/assign/route.ts:92` | order source, category, queue |
| D5 | **Replenishment qty + vendor pick** | `ReplenishmentNeedTable.tsx`; `replenish/bulk-create-po/route.ts` | stock, pending, lead time, vendor hist |
| D6 | **Carrier selection** for outbound (cost/speed) | `shipping/track/register/route.ts` | dest ZIP, weight, carrier history |
| D7 | **Tech queue prioritization** — reorder within a tech's queue | `orders/next/route.ts` | deadline, est. test time, parts risk |
| D8 | **Repair cost estimate** | `RepairIntakeForm.tsx`; `repair/submit/route.ts:24` | historical repair price, Ecwid pricing |
| D9 | **Inventory count reconciliation** — accept/recount on variance | `inventory/counts/route.ts` | count variance history |

### E. See (vision) — judge a photo (HIGH VALUE, needs a multimodal model)

The highest-frequency warehouse judgments are visual and currently 100% human. **All of
these are blocked on loading a multimodal model into the Hermes runtime** — call that out
as a prerequisite, not a quick win.

| # | Manual task today | Where | Photos available |
|---|---|---|---|
| E1 | **Condition grade** (BRAND_NEW/USED_A/B/C/PARTS) from item photos | `ConditionPills.tsx`; `tech/test-result/route.ts`; `receiving-lines/route.ts` | carton/unit photos on NAS+Blob |
| E2 | **QA pass/fail** judgment from test/inspection photos | `TestingStatusPills.tsx`; `tech/test-result/route.ts` | inspection photos |
| E3 | **Claim photo auto-select** — pick the photos that show the damage | `ReceivingClaimModal.tsx:146` | all carton photos |
| E4 | **Serial OCR** — read serial off the unit photo instead of typing | `tech/scan-sku`; `receiving/scan-serial`; `InlineSerialAdder.tsx` | unit photos |
| E5 | **Packing-slip / box-content verification** — does the box match the order | `packing-logs/update/route.ts` | packer photos |
| E6 | **Damage classification** to drive disposition (SCRAP vs REWORK) | `receiving-lines` disposition | receiving photos |

### F. Proactive / agentic triggers — the agent acts on its own (HIGHEST RISK, last)

Once A–E earn trust, the agent can *initiate* instead of waiting to be asked. These need a
**write-capable tool layer** (Hermes is read-only today) plus audit logging and step-up
guards on anything money/Zoho-touching.

| # | Today a human decides… | Where | Trigger signal |
|---|---|---|---|
| F1 | **Auto-trigger replenishment** when stock < order qty | `orders/assign/route.ts:299` `ensureReplenishmentForOrder` | live `sku_stock` |
| F2 | **Auto-mark PO received** when all lines processed | `receiving/mark-received-po/route.ts` | line completion state |
| F3 | **Auto-close FBA shipment** when full / before deadline | `fba/shipments/close/route.ts` | item statuses, deadline |
| F4 | **Auto-resolve exceptions** beyond key-match (Zoho/delivery cross-check) | `lib/tracking-exceptions.ts` | Zoho, delivery status |
| F5 | **Auto-promote work-order status** OPEN→IN_PROGRESS on detected activity | `work-orders/route.ts` | scan activity |
| F6 | **Auto-fetch tracking** from carrier APIs instead of manual entry | `orders/[id]/tracking/route.ts` | carrier subscription/webhooks |

---

## 4. Prioritized roadmap

Sequenced by **(value ÷ effort)** and infra readiness. Phases 1–2 ship on the gateway you
already run; Phase 3 needs a vision model; Phase 4 needs write-tooling + guardrails.

| Phase | Theme | Items | Infra | Why here |
|---|---|---|---|---|
| **1 — Drafting wins** | Reuse `extract-llm` pattern for text | A1–A8 | have it | lowest risk, immediate operator time-savings, human keeps the pen |
| **2 — Classify + match** | Auto-fill dropdowns & exception queues | B1–B8, C1–C9, D1, D8 | have it (+embeddings for C5/C8) | removes the highest-count clicks; confidence-gated |
| **3 — Vision** | Load multimodal model; photo judgments | E1–E6 | **new multimodal model** | highest warehouse volume, but one real infra dependency |
| **4 — Optimize + act** | Predictions then autonomous triggers | D2–D7, D9, F1–F6 | **write-tool layer + audit + step-up** | needs trust earned in 1–3 and safe mutation plumbing |

**Quick wins (<1 day each, start here):**
- **A1 claim body** and **A3 repair description** — swap the static templates for an
  `extract-llm`-style draft call; the confirm-before-send UI already exists.
- **B1 PO-email triage pile** — the extraction pipeline already runs on these emails; add a
  pile-classification field to the same tool schema.
- **C5 surfacing** — you already compute pairing suggestions; just expose confidence and a
  one-click accept in `SkuPairingPanel`.

---

## 5. Cross-cutting prerequisites

1. **Write-capable tool layer.** Hermes is read-only. Phase 4 (and any "auto-X") needs a
   guarded mutation toolset — reuse the existing **step-up** flow (`project_stepup_client_wiring`)
   for anything money/Zoho/Amazon-touching, and emit audit-log rows on every agent action.
2. **A multimodal model** in the Hermes runtime for Phase 3. Today `AI_MODEL=gemma-4-e4b`
   is text-only. This is the single biggest infra decision in this doc.
3. **Confidence + confirmation everywhere.** Keep the `extract-llm.ts` discipline:
   per-field confidence, auto-act only on high confidence, always show the operator what
   the model decided and let them override.
4. **Local-first, no silent cloud fallback** — matches current policy; if the gateway is
   down, surface a clear error and let the human proceed manually.
5. **Embeddings/vector store** is already proven via NemoClaw RAG; reuse it for the
   match/rank items (C5, C8) rather than standing up new infra.

---

## 6. What NOT to hand to the AI

- **Final money/shipping commits** without human confirm (carrier purchase, PO submit to
  Zoho, force-close shipment) — suggest, never auto-execute.
- **Customer-facing sends** (Zendesk replies, pickup terms) — draft only.
- **Permission/role assignment**, integration connect/disconnect, feature flags — these are
  deliberate admin acts, not automation targets.
- **Physical barcode scans** where a scan is already faster and more reliable than vision
  (keep OCR as a *fallback* for damaged/unscannable labels, not the default path).

---

_Appendix — source scan: receiving/PO, FBA, repair/tech, orders/packing/shipping/Zoho, and
walk-in/inventory/admin workflows were each swept for human-driven decision points. ~50
distinct manual tasks consolidated into the six capability tables above. The single
existing "agent does work" precedent is `src/lib/po-gmail/extract-llm.ts`._
