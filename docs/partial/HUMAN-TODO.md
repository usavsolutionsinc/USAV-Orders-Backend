# HUMAN-TODO — what's left for a person to do

**Created 2026-06-29. Scanned + updated 2026-07-03 (post Cycle Forge + polymorphic wave).** This is the single aggregated list of everything across `docs/partial/` (and cross-referenced plans) that **cannot
be done by the coding agent** — it needs your credentials, your business data, a running app, or a coordinated
deploy. All agent-completable code/doc work was finished and verified in prior passes. Latest dry-run: 400+ migrations on record (several July provenance + facts applied or pending). Per-item detail
lives in each source plan doc's "Remaining work — handoff" section; this file just collects + prioritizes them.

**2026-07-03 scan notes (latest wave):**
- **Polymorphic refactor advancing rapidly** (schema-wide + universal feed): `serial_unit_provenance` table + backfill (2026-07-01n) + dual-write AFTER INSERT/UPDATE trigger (2026-07-03a) now in tree (origin_* denorm preserved for Phase 4 drop). `feed_links` plan for universal triage feeds (non-destructive unlink) + receiving_line_facts + polymorphic `ops_events` spine shipped in spirit (facts, rails, journey enrichment). See `docs/todo/schema-wide-polymorphic-refactor-plan.md`, `universal-feed-polymorphic-plan.md`, `.claude/rules/polymorphic-tables.md`, and dirty-tree changes to `drizzle/schema.ts`, `serial-units-queries`, `receive-line.ts`, `serial-attach.ts`, `journey.ts`, `tech/*`, audit aggregators.
- **Photo reassignment** fully implemented: new PATCH `/api/photos/[id]/reassign` + lib + test + MovePhotoToPoPanel wired into shipped gallery, receiving photo UI, viewer. Audited via PHOTO_REASSIGN. (Recent commit + follow-ups.)
- **Universal incoming eBay purchase sync + ShipStation outbound**: eBay buyer-side POs into polymorphic incoming spine; ShipStation rate/label/void/webhook routes + credential/perm/facts extensions. New plans + code/docs.
- **Receiving / Ops / Media heavy lift**: facts spine, unified ReceivingFeedRail rails + ops event log, paired unmatched cartons + rail refinements, staff-filter indexes, idempotency hardening, media library (master folders CRUD + drag-reorder + finder UI), outbound documents. Many updates to receiving/*, packerlogs, photos queries, handling-units.
- **Other**: Tenant isolation backstop + CI route-auth ratchet; small UX; new docs in `docs/todo/` (universal-feed-polymorphic, schema-wide-polymorphic, incoming-universal-purchase-orders, media-library-modernization, outbound-*, shipstation-outbound, receiving-triage-*, returns-receiving-*) and root plans.
- Admin/Settings fragmentation + design-system adoption notes from prior scan still apply. Dead-code and partial/ README reconciled in recent passes.
- Working tree currently has uncommitted changes (provenance migrations untracked, receiving/serial/packer/audit/lib updates, schema, journey, photos, tech records) + recent commits for photo reassign, feeds plans, eBay/ShipStation, etc. Review via GitHub Desktop.

**Nothing is committed in the current dirty tree beyond the recent wave commits.** All pending changes (migrations, receiving core, etc.) sit for your review + commit.

Legend: ☐ = to do · 🔑 needs credentials/external account · 🧠 needs your decision/data · 🚀 deploy-coupled ·
🏃 needs the app running to verify · 🔁 ongoing/living · 💤 deferred-by-design (no action unless you want it).

---

## ⭐ Start here — highest leverage, lowest effort

1. **☐ 🔑 Stripe go-live** — the one thing blocking "can charge money" (tier0). ~30 min. → §A1
2. **☐ 🧠 Tell me the color for SKU suffixes `-N` / `-S` / `-SW`** — one-line config each; unblocks the whole SKU variant model (`-B`→Black, `-W`→White already done). → §B1
3. **☐ Run safe backfill / migrate scripts** (dry-run → `--apply`) for provenance facts + any unapplied July indexes (e.g. receiving staff filter). → §D
4. **☐ 🔑 NAS production uploads** — office-Mac agent + Caddy + Vercel env; unblocks prod photo uploads entirely. → §A2
5. **☐ 🔑 ShipStation + eBay buyer purchase sync setup** — new this wave (labels, webhooks, incoming POs). → new §A5
6. **☐ Review + test photo reassignment end-to-end** (real photos across POs) + serial provenance (trigger effects) in running app before deploy. → §E
7. **☐ Commit the working tree** via GitHub Desktop once you've reviewed it (includes untracked provenance migrations + receiving/packer updates).

---

## A. Owner-gated infrastructure 🔑  (no credentials exist for the agent — only you can do these)

### A1 — Stripe live go-live  ·  `tier0-execution-checklist.md`
- ☐ Run: `STRIPE_SECRET_KEY=sk_live_… node scripts/stripe/setup-webhook-and-portal.mjs --live` and capture the `whsec_…`.
- ☐ Vercel **Production** env: set `STRIPE_WEBHOOK_SECRET` (the `whsec_…`); confirm `sk_live`/`pk_live` keys + the 3 **live** `STRIPE_PRICE_*` (the `…LvhV85DRvt…` account, **not** the test `…Q2odN2RRiM…`); redeploy.
- ☐ Smoke-test: checkout → webhook mirrors `billing_subscriptions` → `organizations.plan` flips → portal cancel.
- (defer) `invoice.payment_failed` dunning.

### A2 — NAS production photo uploads  ·  `nas-receiving-write-tunnel-plan.md`  (app code is 100% done)
- ☐ Deploy the full `deploy/nas-media-agent/server.mjs` on the office Mac and **retire the slim archive-only `:8787` agent** (don't run two).
- ☐ Wire Caddy `handle_path /_agent/* → 127.0.0.1:8787`, then add LaunchAgents (agent + Caddy) and a `cloudflared` system service for reboot durability.
- ☐ Vercel Production env: set `NAS_RW_URL`, `NAS_AGENT_URL`, `NAS_AGENT_TOKEN`; redeploy.
- ☐ Phase 5 e2e probe: `PUT` 201 through the tunnel; mobile capture → `POST /api/receiving-photos` 200 → photo visible → gallery delete 204.

### A3 — Amazon SP-API multi-tenant + live PII  ·  `amazon-sp-api-order-import-plan.md`  (all code shipped)
- ☐ Publish the Selling-Partner **Appstore app** and obtain the restricted **PII (Direct-to-Consumer Delivery) role** so true multi-tenant OAuth + live shipping-address RDT work for non-USAV tenants.
- Note: the self-authorization paste path (`/api/amazon/connect`) already works as a single-tenant bootstrap meanwhile.

### A4 — Tenant-isolation / realtime infra  ·  `tier0-execution-checklist.md`
- ☐ Confirm `UPSTASH_REDIS_*` is set in Vercel prod (the rate limiter **fails open** without it).
- ☐ Update the external `realtime-db` emitter to send `organization_id` as `orgId` **before** the Ably one-shot deploy (else `db.row.changed` 400s post-deploy).
- ☐ On any **new** tenant DB: provision the non-BYPASSRLS `app_tenant` role (template `2026-06-21_app_tenant_role.sql.template`); already done on the current DB.

### A5 — ShipStation + eBay buyer purchase sync (new July wave)  ·  `shipstation-outbound.md`, `incoming-universal-purchase-orders-plan.md`
- ☐ 🔑 Obtain ShipStation API keys (or Nango connect) + webhook secrets; set `SHIPSTATION_*` (or equivalent) in Vercel; wire rate shopping + label purchase/void in prod.
- ☐ 🔑 eBay buyer-side (purchase) OAuth/app permissions + refresh tokens for universal incoming POs sync (separate from seller listings); test cron + polymorphic feed ingest.
- ☐ Smoke the new facts/perm extensions + credential connector for both (see recent permission manifest + integrations updates).
- ☐ Verify non-destructive feed unlinks (if `feed_links` impl lands) + label lifecycle audit.

---

## B. Owner decisions & data 🧠  (the agent cannot guess these without corrupting data / breaking auth)

### B1 — SKU color suffix values  ·  `sku-reconciliation-plan.md`  (axis confirmed = color)
- ☐ Tell me the color for `-N`, `-S`, `-SW` (e.g. `-N` = Navy? Natural?). `-B`→Black and `-W`→White are seeded; the rest decode to `null` (never mis-tag) until you confirm. Then it's a one-line flip per entry in `src/lib/inventory/sku-variant.ts` (`SKU_COLOR_SUFFIX_MAP`, set `confirmed:true` + code/label) + run the backfill.

### B2 — Identity session-collapse cutover  ·  `identity-layer-plan.md`  🏃
- ☐ Decide to proceed, then the cutover (rewire `server-session.ts` + every consumer to read `active_org_id`/`active_staff_id`, drop the re-mint) must be **verified in a running app** (sign-in / PIN / passkey / org-switch) before deploy. Groundwork is built + live (columns + the unused `switchActiveContext()` helper). Account-merge is already fully built + live.

### B3 — Receiving-scans S5 dedup-key strategy  ·  `receiving-scans-stn-link-plan.md`
- ☐ `receiving_scans.shipment_id` is intentionally nullable (non-carrier/SKU scans), so it can't directly replace the `(tracking_number, receiving_id)` unique key. Decide a composite / `COALESCE` strategy before S5 read-cutover + S6 column drop.

### B4 — Smaller decisions
- ☐ `unshipped-tracking-label-record-plan.md`: add the planned `shipping.upload_label` permission, or keep reusing `orders.create`/`orders.view` (current). Low stakes.
- ☐ `identity-layer-plan.md`: reconcile SSO storage — as-built `staff.sso_provider/sso_subject` vs the plan's `account_identities` (+ backfill).
- ☐ `relational-backend-reuse-plan.md` §4: polymorphic-attachment registry + generated-trigger macro — design call.
- ☐ `DEAD_CODE_CLEANUP_PLAN.md`: whether to flip knip strictness (`rules: { exports, types }`) to hard-error once the backlog drains.

### B5 — Admin / Settings SaaS surface split + design consistency (high multi-tenant UX impact)
- ☐ **Decide final split of concerns and naming**: Personal prefs (hardware, appearance, security, personal receiving) vs Organization config (billing, team, roles, integrations, org policies, audit) vs heavy operational catalogs/power tools (suppliers, locations, reason-codes, FBA catalog, PO mailbox, schedules, logs, quality, inventory-admin) vs future separate Platform admin. Confirm URL model (keep `/settings` + `/admin`, single `/settings?area=personal|org|ops`, or rename `/admin` → `/org-admin` or similar). Mixed personas (owners + power users) mean catalogs need appropriate sub-perm exposure without exposing pure admin (billing/team).
- ☐ **Prioritize & sequence the unification**: High-priority design-system consistency (adopt `SidebarShell`/`AdminSidebarShell` everywhere, standardize containers + `PageHeader` maxWidth strategy, token-only colors, linear scaffold, Workbench archetype for list+detail surfaces) vs defer until after billing hardening / RLS / onboarding. Review the proposed plan (archetypes, compose rails not fork, legacy redirect cleanup, expand settings-registry for more org policy).
- ☐ Owner review/approval of the split before large-scale refactors to admin components, settings sections, and navigation (master-nav modes). Most code changes are agent-safe once decisions lock; deep links + existing redirects must be preserved.

---

## C. Deploy-coupled migrations 🚀  (break production if applied standalone — must land WITH their deploy)

### C1 — The 2 `.gated` composite-PK contract swaps  ·  `tier0` / `serial-units-tenant-force`
- ☐ `src/lib/migrations/2026-06-14_fba_fnskus_composite_pk.sql.gated` (fba_fnskus PK → composite)
- ☐ `src/lib/migrations/2026-06-14_sku_catalog_composite_unique.sql.gated` (sku_catalog → composite UNIQUE)
- The EXPAND phase + the `ON CONFLICT` code are already live. To finish: rename `.gated` → `.sql` and run `db:migrate` **as part of the deploy that carries the code** — never standalone (they'd break live upserts).

### C2 — SKU master-data migrations  ·  `sku-reconciliation-plan.md`  (agent can author on request)
- ☐ Step A union seed — insert in-use base SKUs (`sku_stock ∪ orders ∪ receiving_lines ∪ ledger`) into `sku_catalog` (`ON CONFLICT DO NOTHING`), behind a coordinated migrate→re-measure→backfill.
- ☐ Step E FK wiring — add `sku_catalog_id` + `NOT VALID` FKs to the 8 hot tables (`sku_stock`, `sku_stock_ledger`, `fba_shipment_items`, `stock_alerts`, `bin_contents`, `location_transfers`, `cycle_count_lines`, `items`); backfill → `VALIDATE`. **High-risk** (hot tables) — stage carefully.

### C3 — Relational identity-hub migrations  ·  `relational-backend-reuse-plan.md`  (agent can author on request)
- ☐ §3 `sku_catalog` FK backfill (`NOT VALID` → `VALIDATE`) · §5 `external_id_mappings` table · §6 `serial_units.current_location_id` FK · §7 require `reason_code_id` in ledger writes. Each is backfill-then-validate and must land **with** the writers that start stamping the new columns.

### C4 — Receiving-scans S6 + LOCAL_PICKUP
- ☐ `receiving-scans-stn-link`: S6 drop `receiving_scans.tracking_number/carrier` — irreversible; only after S5 (§B3) + green `verify-stn-consolidation.sql` + a column-free-code-first deploy.
- ☐ `receiving-door-classification`: `LOCAL_PICKUP` intake_type round-trip needs a schema change (the carton `intake_type` enum excludes PICKUP).

> ⚠️ The migration runner (`scripts/run-pending-migrations.mjs`) applies **all** pending `.sql` at once — always `npm run db:migrate:dry` first, and apply deploy-coupled ones only with their code.

---

## D. Safe backfill scripts to run ✅  (additive, dry-run-first, agent already wrote them — you run them)

- ☐ `scripts/backfill-catalog-type-id.mjs` — populates `receiving.type_id` (column is live). Dry-run → `--apply`. · `platform-account-type-catalog`
- ☐ `scripts/backfill-receiving-scans-shipment-id.sql` — 2-pass historical link; run **after** `verify-stn-consolidation.sql` is green. · `receiving-scans-stn-link`
- ☐ `scripts/backfill-unit-quality.ts` — optional; `GET …/quality` self-heals, so non-urgent. Dry-run → `--apply`. · `condition-grading-repair-qc`
- ☐ New this wave: provenance backfills included in `2026-07-01n_serial_unit_provenance.sql` (run `npm run db:migrate`); receiving facts / staff-filter indexes (e.g. `2026-06-21_receiving_staff_filter_indexes.sql` if unapplied); any `feed_links` or line_facts population once writers land. Always `db:migrate:dry` first.

---

## E. Code that needs the app running to finish safely 🏃  (agent can write; you must integration-verify before deploy)

- ☐ `relational-backend-reuse`: `recordUnitEvent` per-hot-path retrofit (receiveLineUnits / pack-ship / returns / RMA). The façade is now `transition()`-routed + ready, but each path has branching / realtime / allocation logic that must be mapped + run-the-app verified individually (may be a non-goal — a fresh receiving-style create path is the better first consumer).
- ☐ `relational-backend-reuse`: migrate the 2 remaining raw `tech_serial_numbers` writers (`api/google-sheets/execute-script`, `api/receiving/serials` + `tech-logs-queries.createTechLog`) — need `attachTechSerial` to grow a `createdAt` param / a row-returning + 409-surfacing variant first (not a bare swap).
- ☐ B2 session-collapse cutover (see §B2).
- ☐ New this wave (high operator impact): photo reassign flow end-to-end (move receiving photo between cartons/POs/lines with audit), serial_unit_provenance trigger effects (new inserts/updates create edges correctly), eBay buyer PO sync + ShipStation label lifecycle, unified feed rails / facts spine in Receiving + Ops views, receiving staff filter on large data (after indexes). Run with real data + verify no cross-tenant or double-write drift.

---

## F. Ongoing / living trackers 🔁  (by design these never fully "close" — work as-needed)

- ☐ `dead-code-triage` / `DEAD_CODE_CLEANUP_PLAN`: triage the un-triaged knip "Unused Files" backlog (`mobile/**`, `fba/table/**`, `manuals/**`, `admin/connections/**` and any stale admin/settings tab routes) in small reviewed waves (high false-positive rate — dynamic imports, admin-tab routing, mobile-only loads). **Run `npm run knip:baseline` (+ commit) once your in-flight work settles** — the gate is currently red with baseline-drift findings, mostly concurrent WIP. Phase 5 deeper detection (route-reachability map / `ts-morph`) is 💤 until the backlog justifies it. (Admin/settings unification will surface more candidates.)
- ☐ `tier0-execution-checklist`: ongoing E2 `enforce_tenant_isolation` cohorts as each table's routes go all-`low`; 💤 D2 per-org crons via a service-org (Zoho/eBay/sheets/replenishment/warranty clock-sweep); 💤 Phase F identity/RBAC (auth-flow org-scoping, owner-email identity, onboarding/activation).
- ☐ `platform-account-type-catalog`: 💤 Phase 6 — drop `source_platform`/`intake_type` text columns + CHECKs **only** once readers move to resolvers (high-risk; still a large live read footprint incl. `fba` checks).
- ☐ `handling-unit-lpn`: 💤 H6 — drop `receiving.lpn` once flag-gated `RECEIVING_UNIFIED_INBOUND` Phase 3 stops referencing it.
- ☐ `unshipped-tracking-label-record`: 💤 continue per-panel `EventTimeline` rollout (repair detail, `UnitDetailWorkspace`).
- ☐ `serial-units-tenant-force`: 💤 §6 sibling tables + §7 `sku_catalog(sku)` cross-tenant key collision (separate Class-1 blocker for onboarding a 2nd org).
- ☐ `condition-grading` / `multi-tracking` / `amazon`: 💤 live eBay reverse-push · Zoho `cf_additional_tracking` mirror / ASN ingest · v0→2026-01-01 Orders API mapper cutover.
- ☐ **Polymorphic refactor (new living tracker)**: schema-wide + receiving deep dive + universal feed_links. Track phases: dual-write triggers live, reader migration + column drops (serial origin drop .BLOCKED planned), feed_links impl + cutover for triage rails, cross-surface standardization per `.claude/rules/polymorphic-tables.md` and the two plan docs. High impact on future Studio + tenant extensibility.
- ☐ **Receiving facts / unified feed + media/outbound**: ongoing rollout of declarative rails, facts spine, photo reassign + library modernizations, outbound docs integration, ShipStation/eBay buyer sync maturity.

---

## G. Legal baseline — Terms / Privacy / DPA 🧠  ·  (drafts shipped 2026-07-03; memory `legal-baseline-docs`)

The 3 documents are live in **two** places: the product at **Settings → Legal & Policies** (USAV — markdown source
at `src/content/legal/{terms,privacy,dpa}.json`, rendered by `LegalSection.tsx`) and the **marketing site** at
`/legal` + `/legal/terms` + `/legal/dpa` (CycleForge repo, alongside the kept `/privacy`). They carry a
**"Draft — pending legal review"** banner + a top disclaimer blockquote. Before they can be published as final /
relied upon:

- ☐ 🧠 **Fill the bracketed placeholders** — identical values across all 3 docs **and** both repos:
  `[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]`, `[GOVERNING-LAW STATE]`, `[EFFECTIVE DATE]`; the Terms
  dispute-resolution set (`[COUNTY / CITY, GOVERNING-LAW STATE]`, `[ARBITRATION BODY]`, `[RULES]`, `[SEAT / CITY…]`,
  `[one/three]`, `[30/60] days`, `[one (1) year]`, the two `[PLACEHOLDER — confirm…]`); and the DPA fill-ins
  (`[NUMBER, e.g. 14]`, `[NUMBER, e.g. 30]`, `[EU MEMBER STATE — e.g. Ireland]`, `[COMPETENT SUPERVISORY AUTHORITY]`).
- ☐ 🧠 **Attorney review** of all 3, then **flip the draft banners off** (remove the amber "Draft — pending legal
  review" callouts + the top `> DRAFT — NOT YET LEGAL ADVICE.` blockquotes) and set the real Effective date.
- ☑ 🧠 **Contact-email domain — RESOLVED: standardized on `.ai`.** All CycleForge addresses now use
  `@cycleforge.ai` (`legal@` / `privacy@` / `security@` / `dpo@` + support `hi@`) across the docs and both repos.
  Remaining: confirm the mailboxes/MX for these actually exist and route.
- ☐ 🧠 **GDPR Art. 27 EU/UK representative + DPO** — decide whether appointment is triggered; if so, name the
  representative/DPO + address (currently `dpo@cycleforge.ai`, marked "to be appointed if required").
- ☐ 🧠 **SCC module + UK Addendum** — confirm EU SCC **Module Two** (controller→processor) as default vs **Module
  Three** (customer-as-processor), and complete the UK Addendum tables in the DPA.
- ☐ 🔁 **Keep the two copies in sync** — if any doc changes, update **both** the USAV `src/content/legal/*.json`
  **and** the matching CycleForge page (`/legal/terms`, `/legal/dpa`, `/privacy`, and the `/legal` index) or they
  drift. The agent can regenerate both on request.
- ☐ 🚀 **Commit the CycleForge repo separately** — the marketing-site changes (`src/app/legal/**`,
  `src/components/footer.tsx`) live in `/Users/icecube/repos/CycleForge`, a **different** repo from USAV; commit +
  deploy it on its own. (Both repos are `tsc --noEmit` clean.)

---

## Fully done — safe to archive out of `/partial/` ✅

These have **zero** remaining work (agent or human); move them out of `docs/partial/` whenever you like:
`qc-crud-endpoints-plan.md` · `receiving-workspace-mode-primitives-plan.md` · `serial-units-tenant-force-plan.md`
(FORCE RLS live) · `handling-unit-lpn-plan.md` (migration applied) · `multi-tracking-po-plan.md` (superseded by
`shipment_links`, 28q applied) · plus `amazon-sp-api-order-import-plan.md` and `condition-grading-repair-qc-plan.md`
and `unshipped-tracking-label-record-plan.md` once you accept their 💤 deferred items as out-of-scope.

**New July 2026 partial/todo docs** (review their handoff sections for any fresh owner items): `universal-feed-polymorphic-plan.md` (plan-stage), `schema-wide-polymorphic-refactor-plan.md` (phases advancing), media-library-modernization, outbound-documents, shipstation-outbound, incoming-universal-purchase-orders, receiving-triage-*, returns-receiving-order-unification. Many live in `docs/todo/` now.

---

## Small `[CODE]` items the agent can still do — just ask
Not blockers, deferred only for caution: confirm Phase-4 triage "Link to PO" routes through `attach-box`
(`multi-tracking`) · thread `is_return`/`return_platform` to the A4 banner for eBay DH/USAV/MK precision
(`receiving-door`) · add a knip exempt for `src/app/design-demo` · add the `handling-units-crud` e2e spec. Say the
word and I'll do any of these.

**New this scan (July polymorphic/feed/media wave):** agent can author:
- `feed_links` table + dual-write hooks + ReceivingFeedRail consumers once plan decisions lock.
- Further readers for `serial_unit_provenance` (journey, timeline, audit).
- Full ShipStation client + webhook verifier + label UI polish (beyond the skeleton).
- Media library folder drag + share enhancements or outbound doc viewer.
- Polymorphic contract lint/guard in CI or Drizzle helpers per the new rule doc.

**Admin/Settings unification (mostly CODE once B5 decisions lock):** standardize shells + tokens + PageHeader containers across `/admin` (including inventory sub-area) and `/settings` (personal inline + dedicated org pages); retire/clean legacy redirects in `admin/page.tsx` + `settings/page.tsx`; adopt Workbench archetype + SidebarShell for heavy pickers (staff, roles, access matrix); expand settings-registry for more org policy where sensible; align with master-sidebar-nav + 2026 component adoption (buttons/inputs/tables in admin forms). Can execute in phases after owner signs off on split/naming/priority.

---

# G. Cycle Forge roadmap wave (added 2026-07-03)  ·  `docs/CYCLE-FORGE-ROADMAP` · dossier: `docs/CYCLE-FORGE-WAVE-REVIEW.md`

An autonomous build + adversarial-verification wave against the Cycle Forge roadmap. Integrated state at
generation: **full-repo `tsc` 0 errors · route-permission manifest matches live source · one bug found+fixed.**
Nothing committed. The 21 `review` items are agent-complete + verified — a person must **review, approve, and
commit** them (and flip each roadmap `Status: review → done`). The rest need credentials / decisions as marked.

### G1 — Built + verified, awaiting your review + approval 🏃  (roadmap `Status: review`)
Each is additive + reversible; `[verify-only]` = no code changed, agent proved the acceptance criteria.
- ☐ **P0-IDN-01** — serial reuse PO→Shipping `[verify-only]` — check unique idx `(org,normalized_serial)` + shipping resolves-not-mints.
- ☐ **P0-TRACE-01** — unit audit-event backbone (`inventory_events`); closed PUTAWAY org gap; backfill script written (unrun).
- ☐ **P1-TRACE-02** — universal timeline + serial↔order toggle; warranty panel migrated.
- ☐ **P1-TRACE-03** — first-trace view `/audit-log/trace?serial=`; fixed Tech-missing-verdicts + added actor to `readTimeline`.
- ☐ **P1-TRACE-04** — notification bell inbox `[verify-only]` — fires on unboxed returns + priority orders, once/carton.
- ☐ **P1-PCK-01** — testing-mode SKU pre-pack scan (read-only resolve, 4th "SKU" scan mode).
- ☐ **P1-PCK-02** — packing per-SKU instructions + QC flags pre-confirm. **⚠️ APPLIED migration `2026-06-21_sku_catalog_pack_notes.sql`** (additive, down-path documented) — the only live DB change this wave.
- ☐ **P1-PCK-03** — testing feed defaults recently-received-first (reused live refresh, no new poll).
- ☐ **P1-WORK-01** — work-order assign popover + global-header top-priority chip.
- ☐ **P1-WORK-02** — one shared `?staff=` filter (Dashboard + Receiving). *Had a latent 500 bug — fixed (see G2).*
- ☐ **P1-WORK-03** — F2 hotkey → focus next-PO-serial scan (Playwright-proven).
- ☐ **P1-RCV-01** — searchable receiving to-do seeded from email order#s; reversible check-off.
- ☐ **P1-MOB-01** — mobile `/m/pack` two-step scan flow (typed reducer machine; reuses PCK-01 resolve).
- ☐ **P2-FBA-01** — shipment→FNSKU→unit-path audit + 4 inconsistency flags.
- ☐ **P2-FBA-02** — bugfix: UPS-tracking no longer clobbers non-UPS links; FNSKU condition persists on reopen.
- ☐ **P2-RPR-01** — repair intake paperwork reachable from any step.
- ☐ **P2-RPR-02** — repair ticket CRUD + link/unlink + manual pairing (soft-delete only).
- ☐ **P2-AI-01** — OCR unresolved read → create-SKU OR flag-missing in one step (`/m/identify`).
- ☐ **P3-DS-03** — photos library "Group by ticket" view; receiving peek-fan (was already mounted).
- ☐ **P3-ADM-01** — `/operations` goal-first hero + live stats + local-agents row (deep-links `/studio`).
- ☐ **P3-ADM-03** — `/calendar` over `work_assignments` (reused `deadline_at`, no new column).

### G2 — Carry-forward actions from this wave  (not approvals)
- ☐ 🚀 **Apply** `src/lib/migrations/2026-06-21_receiving_staff_filter_indexes.sql` (`npm run db:migrate`) — 3 partial indexes for the P1-WORK-02 staff filter; **UNAPPLIED**. Needed before the filter runs on large receiving history (else table scan).
- ☐ **Review** the regenerated `docs/security/route-permissions.json` in your git diff (agent re-emitted it to cover the new routes; reversible via `git checkout`).
- ☐ ✅ *Done this wave (verify it held):* receiving staff-filter 500 fixed via alias-independent `EXISTS`; `shipped ?staff=` pushed into SQL; IncomingTodoList poll 60s→180s; repair POST idempotency added.

### G3 — 🔴 Pre-existing CRITICAL tenancy leaks surfaced by the audit  (NOT caused by this wave)
Belong to the tier0 tenant-isolation sweep (§A4 / `tier0-execution-checklist`); left untouched deliberately (security-sensitive). Say the word to take these on as a focused, verified pass.
- ☐ 🧠 `/api/repair-service` GET + PATCH — `createCrudHandler` callbacks call `getAllRepairs`/`searchRepairs`/update **without org scope**.
- ☐ 🧠 `/api/shipped` GET (non-search) + PATCH — `getAllShippedOrders`/`updateShippedOrderField` **missing `organizationId` arg**.
- ☐ 🧠 `/api/packerlogs` PUT + DELETE — no `organization_id` predicate; **delete by integer ID is cross-tenant**.
- ☐ 💤 `pending_skus` — global table (no `org_id`); new OCR flag-missing route is write-only enqueue (audit row org-scoped).

### G4 — Roadmap tasks still `todo` — need your credentials / decision  (roadmap `Status: todo`)
- ☐ 🔑 **P2-INT-02** Ecwid order pull + attach repair services · **P2-INT-03** eBay(OAuth)/Amazon connect testing · **P2-INT-04** Amazon incoming ingestion (needs INT-03) · **P3-ADM-04** product-manual PDF viewer (Cloudflare R2).
- ☐ 🧠 **P2-AI-02** AI claims assistant (TOS-compliant) · **P2-AI-03** AI product sourcing (Hermes) · **P3-BIZ-02** password signup + account creation → **P3-BIZ-01** payment plans + per-plan gates · **P3-ADM-02** staff global sign-in.
- ☐ 🧠 **P2-INT-01** Zoho webhook on receiving — SoR-delicate (crosses the SKU-quantity boundary); wants your sign-off on direction.
- ☐ 💤 **P3-DS-02** site-wide DS migration (do opportunistically as pages are touched) · **P2-RPR-03** warranty check-in + pickup dashboard (needs INT-02) · **P3-ADM-05** SOP generation on onboarding (needs P1/P2 flows stable).

---

# H. Polymorphic Refactor + Receiving Universal Feed + Media/Outbound wave (July 2026)

**Major cross-cutting theme this scan.** Multiple plans and impls converged on typed polymorphic spines, non-destructive feeds, provenance, and media modernization. See `docs/todo/schema-wide-polymorphic-refactor-plan.md`, `universal-feed-polymorphic-plan.md`, `polymorphic-tables-database-refactor-plan.md` (in todo?), `.claude/rules/polymorphic-tables.md`, new migration files, and the recent commits/dirty tree.

### H1 — Shipped / in-tree this wave (review + approve / test / apply)
- ☐ **serial_unit_provenance** (Phase 1 table + backfill 2026-07-01n; Phase 2 dual-write trigger 2026-07-03a). Schema modeled in Drizzle. Origin columns stay live (Phase 4 drop planned + blocked migration exists). Verify trigger fires on all three insert paths (upsertSerialUnit, mark-received, insertTechSerial) + updates. Run migrate + test provenance queries (journey, audit, timeline).
- ☐ **Photo reassignment** (committed): full vertical — API, domain lib+test, UI panels (MovePhotoToPoPanel in gallery/viewer + receiving), audit log, permission. Test real move (no data loss, audit row, gallery refresh, cross-PO visibility).
- ☐ **eBay buyer purchase sync + ShipStation** skeleton + facts/perm/connector wiring (committed plan + routes). Flesh + test with real tokens.
- ☐ Receiving facts spine + polymorphic ops_events + unified rails (ReceivingFeedRail, journey enrichment, packer-log, trace/tech-aggregators). Many code updates live in tree.
- ☐ Media library (folders CRUD, drag-reorder, finder-style, share toolbar) + photo library updates. Outbound documents plan + initial integration.
- ☐ Tenant backstop + many receiving idempotency / rail / staff-filter / handling unit refinements in dirty tree.

**Action:** Review the untracked migrations (`2026-07-01n_...`, `2026-07-03a_...`, the .BLOCKED drop), `npm run db:migrate:dry`, then apply with a deploy if green. Review regenerated route-permissions + security files.

### H2 — New human decisions / gated (add to A/B as needed)
- ☐ Decide timing + risk tolerance for Phase 4 origin column drop on serial_units (after all readers migrated off + provenance proven).
- ☐ Lock `feed_links` schema details + `feed_key` values for receiving triage states (Prioritize/Unfound/Done) + decide first consumer surface (sidebar bulk-delete).
- ☐ ShipStation vs existing carrier stack (USPS/UPS/FedEx) overlap strategy; which becomes primary for labels/rates for which channels.
- ☐ eBay buyer purchase vs seller-listing integration split (tokens, sync schedules, feed vs orders).

### H3 — Deferred / ongoing from this wave
- ☐ Full `feed_links` impl + cutover from the three old receiving triage sources (plan-stage only today).
- ☐ Reader migration to `serial_unit_provenance` across journey, audit timelines, ops views, Studio.
- ☐ Polymorphic standardization across the 10+ existing surfaces (photo_entity_links, shipment_links, part_links, external_id_mappings, etc.) per the rule doc and appendices.
- ☐ Continue media/outbound polish + integration with Studio/workflows.
- ☐ Cross-ref with tenancy (all new tables must be born with RLS + GUC).

Add any fresh items surfaced by reviewing the new plan docs to the appropriate § above. This wave is high-leverage for long-term SaaS extensibility and receiving UX consistency.

---

# I. Cycle Forge design/UX brain-dump — reconciled + net-new (added 2026-07-03, **code-verified**)

Owner supplied a full brain-dump of desired design/feature work. Each item was **deep-scanned against the current
tree** (3 parallel code audits) before landing here. The headline: **the large majority is already built** — either
shipped, or in §G as `Status: review` (built + adversarially verified, awaiting your commit). This section captures
the **entire** list so nothing is lost, marks each **DONE vs NET-NEW**, and details only the genuinely remaining work.

Legend as above (☐ / 🔑 / 🧠 / 🚀 / 🏃 / 🔁 / 💤). `[VERIFIED-DONE]` = agent confirmed it exists in the tree today.

## I0 — Already built / shipped — **no new work**, just review + commit (cross-ref)

| Brain-dump item | Status | Where (verified) |
|---|---|---|
| **Remove PO loading spinner → instant found/unfound** (the `/Goal`) | ✅ `[VERIFIED-DONE]` | `lookup-po/route.ts` has `resolvePoIdLocallyByTracking` (L333-365) + `localOnly` gate skipping Zoho (L1174); client `resolvers/lookup-po.ts` sends `localOnly:true` phase-1 (L29), loader only on order#-miss→Zoho re-ping. Background self-promote in `scan-apply.ts` L335-373. **Done.** |
| Serial reuse PO Unboxing ↔ Tech/Shipping | §G1 review | P0-IDN-01 `[verify-only]` |
| Unit audit backbone + first-trace timeline (received→tested-by/when→prepacked→returned→shipped-by/who) | §G1 review | P0-TRACE-01, P1-TRACE-03 (`/audit-log/trace?serial=`) |
| Universal timeline in detail panels + serial↔order toggle + "fix all timelines" | §G1 review | P1-TRACE-02 |
| Notification bell — returns unboxed + pending orders needing ship → primary station inbox | §G1 review | P1-TRACE-04 |
| Testing-mode packing-list selection + SKU-scan prefill from prepacked state | §G1 review | P1-PCK-01 (4th "SKU" scan mode) |
| Packing page modes + per-SKU QA / how-to-pack instructions + QC flags | §G1 review | P1-PCK-02 (migration `2026-06-21_sku_catalog_pack_notes.sql` **applied**) |
| Work-order assignment (testing/packing/picking) via popover + most-important in global header | §G1 review | P1-WORK-01 |
| Quick-key back-to-scan next PO/SN | §G1 review | P1-WORK-03 (F2 hotkey) |
| To-do list / search in incoming from email order#s | §G1 review | P1-RCV-01 |
| Mobile packer auto-progress (scan→order details, scan→what-to-pack) | ✅ `[VERIFIED-DONE]` + §G1 | `pack-scan-machine.ts` (idle→order_details→what_to_pack); P1-MOB-01 |
| Product-QR scan on phone → correct product display | ✅ `[VERIFIED-DONE]` | `/m/scan`→`UniversalScan`→`PrepackedProductSheet` resolver cascade (tracked/untracked/unknown) |
| Packing list viewable on phone (packer **and** tech) | ✅ `[VERIFIED-DONE]` (shared view) | `/m/pack` has no role gate; tech reaches same list. *No tech-specific list — see I2.* |
| FBA E2E: all-in-one shipment ID → FNSKU → unit-path audit trail | §G1 review | P2-FBA-01 (+ 4 inconsistency flags) |
| Dashboard tracking-popover save bug + FNSKU condition persist + FBA popover edits→DB | §G1 review | P2-FBA-02 (bugfix) |
| Repair service linear flow + view paperwork anytime | §G1 review | P2-RPR-01 |
| Full CRUD: ticket link/unlink, manual pairing, manual repair + scroll recent | §G1 review | P2-RPR-02 (soft-delete only) |
| OCR product title for local pickups → create-SKU or flag-missing | §G1 review | P2-AI-01 (`/m/identify`) |
| Photos library "group by ticket" + receiving quick-peek fan (bottom-right framer stack) | §G1 review | P3-DS-03 (peek-fan already mounted) |
| Operations page redesign — goal-first hero + live stats + local-agents row | §G1 review | P3-ADM-01 (deep-links `/studio`) |
| Ecwid order pull + attach repair services | §G4 todo 🔑 | P2-INT-02 |
| Test integrations (eBay/Amazon) by connecting an account | §G4 todo 🔑 | P2-INT-03 |
| AI claims assistant (TOS-compliant + "is this OK for TOS?" + undelivered/wrong-address) | §G4 todo 🧠 | P2-AI-02 |
| AI product sourcing (Hermes / ChatGPT) | §G4 todo 🧠 | P2-AI-03 |
| Payment plans + per-plan page gates (shown, locked behind paywall) | §G4 todo 🧠 | P3-BIZ-01 |
| Password signup + account creation + marketing site reflect reality | §G4 todo 🧠 | P3-BIZ-02 (+ update CycleForge repo) |
| SOP drafted when onboarding complete | §G4 defer 💤 | P3-ADM-05 |
| Site-wide Linear/Notion UX migration per page | §G4 defer 💤 | P3-DS-02 (opportunistic) |
| Detail-panel timelines everywhere + identifier strategy (serial vs order#) | §F + §H | per-panel `EventTimeline` rollout + polymorphic `serial_unit_provenance` readers |

> Action for all of I0: nothing to build. **Review + commit** the §G `review` items (flip each roadmap `Status: review → done`), and note the `/Goal` instant-PO work is already live in the tree.

## I1 — **Net-new** — verified absent/partial, the real remaining design work (ROI-ordered)

- ☐ **I1-1 · Mobile responsiveness across all desktop pages** 🏃 — **ABSENT (~0%).** `dashboard`/`products`/`inventory`/`warehouse`/`operations` trees use **zero** `sm:/md:/lg:` breakpoints; a phone is hard-redirected to `/m/*` by `ResponsiveLayout.tsx:124` (`isMobileAllowedPath`, `sidebar-navigation.ts:112`). Repo-wide only ~148/1048 non-mobile tsx use any breakpoint. **Large (L).** Decide: keep the `/m/*` split and only widen the allowlist, or make core pages reflow. *Prereq → I1-2.*
- ☐ **I1-2 · Unify mobile nav with the desktop SoT** — **ABSENT.** `MobileSidebarDrawer.tsx:66` hardcodes its own `NAV_ITEMS` ("single source of truth for the drawer") and never imports `APP_SIDEBAR_NAV` (`sidebar-navigation.ts`). Point the drawer at the shared nav + permission filter so the two stop diverging. **Medium (M).** Cheap structural win that de-risks I1-1.
- ☐ **I1-3 · Integrations tab → sidebar-MODES + Nextiva display-account mode** — **PARTIAL.** `settings/integrations/page.tsx` is a flat category catalog (no `?mode=`, no `HorizontalButtonSlider`, no `SidebarShell`); Nextiva is one vault card (`registry.ts:129`). But the Nextiva call-log/voicemail backend + UI is substantial and **already mode-driven inside the Support workspace** (`SupportWorkspace.tsx:36` `?mode=calls|voicemail`). Work: convert integrations page to the sidebar-mode archetype (per `/sidebar-mode` skill) and add a Nextiva "display account" mode (reuse `CallLogView`/`VoicemailQueue`). Model for "next integration added as a mode." **Medium (M).**
- ☐ **I1-4 · AI chat that toggles tenant settings via natural language** 🧠 — **ABSENT.** `api/ai/chat/route.ts` is read-only (intent detect → `buildContextBlock` SELECTs → gateway); no `tools` array sent to the model. `hermes-tool-call.ts` exists but every caller is classify/draft, none mutate settings. Settings mutation lives only at `api/settings/route.ts`. Work: register a settings-mutation **tool schema** (validate through `settings/registry.ts`), add a server-only `setTenantSetting()`, wire it into the chat handler with an admin-permission gate + audit. **Small–Medium (S–M).** High demo value.
- ☐ **I1-5 · Admin station-IP switching per user** 🧠 — **ABSENT.** `ip_address` appears only in audit capture; no station↔IP mapping table or switch logic. Needs: a `station_ip_assignments` table (org-scoped, born with RLS per `.claude/rules/polymorphic-tables.md`), admin UI to assign an IP to a computer, and resolution of the active staff's IP for records. **Medium (M).**
- ☐ **I1-6 · Multi-language (i18n) per staff** 🧠 — **ABSENT.** No `next-intl`/`i18next`/message catalogs; only `Intl.*` date/number formatting; no locale key in `settings/registry.ts` or `staff_preferences`. Needs a framework choice + a message-extraction pass across the site + a per-staff locale pref. **Large (L).** Biggest surface of anything here.
- ☐ **I1-7 · Per-tenant sidebar label/badge upgrades** 🧠 — **ABSENT.** `sidebar-navigation.ts` is fully static (hardcoded union + labels); no org-scoped override. Work: source label/badge overrides from `organizations.settings` (or the settings-registry) so each customer can relabel/badge sidebar entries. **Small–Medium (S–M).**
- ☐ **I1-8 · First-run onboarding walkthrough for new SaaS orgs** 🧠 — **ABSENT (guided tour).** Only static empty states (`FirstScanOnboardingCard.tsx`, `OrdersFirstRunEmptyState.tsx`) + backend template seeding (`studio/seed-org-workflow.ts`). No tour/checklist framework (no joyride/shepherd/driver.js). Work: a multi-step guided walkthrough that explains the product + links every station with use-cases and lands the org on `/operations`. Pairs with P3-ADM-01 (goal-hero) + P3-ADM-05 (SOP). **Medium (M).**
- ☐ **I1-9 · Zendesk ticket select + add comments from the PACKING flow** — **ABSENT.** Zendesk comment/assign/photo APIs exist (`api/zendesk/tickets/[id]/comments`, `.../assign`, `support/tickets/by-entity`) but are **unreachable from any packing surface** (`StationPacking.tsx`, `Pack.tsx`, `packer/**` have no ticket UI). Work: surface a ticket picker + comment box in the packing station reusing the existing APIs. **Small–Medium (S–M).**
- ☐ **I1-10 · Clean up testing & shipping display panels/components** — *(not deep-scanned; keep as a design pass.)* Tidy the testing/shipping panels for reliable full-detail display; align to Workbench archetype + house tokens. **Medium (M).**

## I2 — Finish-gaps on **already-built** features (verified partial; small closeouts)

- ☐ **I2-1 · Hermes visual auto-analyze — enable + notify + surface.** Auto-analyze-on-upload IS wired (`photos/service.ts:222` enqueues `analyze`; `photos/analyze.ts` has `hermes`/`vision`/`catalog` providers + `damage_detected`), but **gated OFF by default** (`PHOTOS_ANALYZE_ENABLED`/`_ON_UPLOAD` default false), produces **no notification**, and has **no upload-result UI** beyond search filtering. Work: flip flags per-org, fire a notification on `damage_detected`, surface results in receiving/packer photo UI + mobile. The LAN RTX "Vision" agent (`OperationsAgentsRow.tsx:42`) is a separate receiving-identify path — decide if the Windows/Mac visual-mode switch ties here. **Small–Medium (S–M).**
- ☐ **I2-2 · SKU header + in-place SKU edit on the receiving line-edit panel.** `LineMatchingSection.tsx` lets you search/pair by SKU and sets `sku` as a **side-effect of picking a match** (L298-320), but there's **no SKU header render nor an editable SKU field** on `LineEditPanel.tsx`. Work: render `row.sku` as a header chip + add a direct override/edit affordance in the line-edit panel. **Small (S).**
- ☐ **I2-3 · Shared `?staff=` filter — wire the pickers everywhere.** Primitive exists (`useStaffFilter.ts`, `STAFF_FILTER_PARAM='staff'`) and servers already read it on `orders`, `shipped`, `receiving-lines`, **and `packerlogs`** — but the only **writer UI** is the Dashboard/Unshipped inline `BoardStaffFilter` (`UnshippedShelfBoard.tsx:96`). Receiving reads `?staff=` yet has **no setter** (its sidebar uses a different `?staffId=`), and packing/testing/unboxed have no picker. Also the shared `design-system/components/StaffFilter.tsx` is rendered **nowhere** (dead). Work: mount the shared `StaffFilter` picker on Receiving/Packing/Testing/Unboxed (all-staff → one-staff), reconcile `?staff=` vs `?staffId=`, retire the dead component. Fulfills "filters in every mode." **Medium (M).**
- ☐ **I2-4 · Tech-specific mobile packing/testing list (optional).** Today tech reuses the shared `/m/pack` view; `ScanTestingPanel` serves testing at `/m/scan`. If a dedicated tech mobile list is wanted, build it; otherwise close as "shared view is sufficient." **Small (S) / 💤.**
- ☐ **I2-5 · Realtime triage live-move (optional polish).** Incoming/triage already update live via Ably→invalidate→refetch (`useRealtimeInvalidation.ts:133`, server publishers in `lookup-po` `after()`), with server-side segmentation (Prioritize/Unfound/Done). It is **not** an animated cross-table row-move. If you want true live-move animation between tabs, that's a client-side layout-animation upgrade on top of the existing events. **Medium (M) / 💤.**

> **Suggested sequence for §I net-new:** I2-2 + I2-3 + I1-9 (small, high daily value) → I1-4 (AI settings, demo value) → I1-2 then I1-1 (nav unify → responsive) → I1-3, I1-8 → I1-5/I1-6/I1-7/I1-10 as prioritized. Everything in §I0 is review-and-commit only.
