# Tier 0 — Flip-the-Switch Wins (this week)

> **STATUS (re-verified + closed out 2026-07-09):** Tier 0 is **agent-complete**; every remaining
> step is an owner env flip.
> - **#1 trial expiry — CODE DONE (predates this doc's "Do" list):** `withAuth.ts` returns 402
>   `TRIAL_EXPIRED` and `page-guard.ts` redirects to `/settings/billing?status=trial_expired`;
>   exempt-path allowlist verified. 2026-07-09: gate refactored to injectable `TrialGateDeps` +
>   DB-free suite `src/lib/billing/trial-gate.test.ts` (9 cases: flag short-circuit with no DB read,
>   exempt paths, expiry predicate, paid-plan immunity, fail-open). **Owner:** flip
>   `TRIAL_ENFORCEMENT=1` (dogfood first), verify an expired-trial org is gated.
> - **#2 packer-log enrichment — LIVE:** flag **defaults ON** since 2026-07-09
>   (`feature-flags.ts` — env var is now a kill-switch only); backfill complete per the flag's
>   doc-comment. The runbook below is retained for rollback reference only.
> - **#3 poller intervals — DONE** (see below, unchanged).
> - **#4 rate limiting — CODE DONE 2026-07-09:** all 11 legacy sync `checkRateLimit()` call sites
>   migrated to org-scoped distributed `checkRateLimitForOrg` (ai-chat ×2, ai-search,
>   assistant-chat, incoming-refresh ×2, scan-tracking, shipping register/sync-one,
>   support-suggest, tech-scan). **Owner:** provision Upstash + set
>   `UPSTASH_REDIS_REST_URL/_TOKEN` in prod (until then the boot warning stays and limits are
>   per-instance). Note: `redis-caching-plan.md` Phases 0–4 were already DONE (2026-07-04) —
>   this doc's "Redis" item was only ever the rate-limit provisioning half.

Four small, high-impact items. Most are finishing/enabling code that already exists.

---

## #1 — Enforce trial expiry  ·  Revenue · Effort S

**Now:** `auth/signup/route.ts:108` sets `trial_ends_at = now()+14d`, but
`trial-gate.ts:25` `TRIAL_ENFORCEMENT` defaults off — trials never expire, so nothing
converts to paid.

**Do:**
1. Confirm the exempt-path allowlist in `trial-gate.ts` covers `billing/*`, `auth/*`,
   and static assets (it's already written — verify completeness).
2. Add an expiry check to the request path (middleware or the shared auth guard) that,
   when `trial_ends_at < now()` and no active subscription, redirects to
   `settings/billing` (still allowing billing/auth).
3. Flip `TRIAL_ENFORCEMENT=true` for the dogfood org first; verify a real expired trial
   is gated and billing/checkout still reachable.

**Acceptance:** an org past `trial_ends_at` with no subscription is redirected to
billing on protected routes; billing + sign-in remain reachable. **Owner action:** env
flip after code verify.

---

## #2 — Packer-log enrichment read model go-live  ·  Ops + Neon cost · Effort S

**Verified ready this session.** OFF branch is byte-identical, so this is a safe no-op
until backfilled + flipped.
- Writer: `src/lib/neon/packer-log-enrichment.ts:278` (`computePackerLogEnrichment`).
- Consumer gate: `src/lib/neon/packer-logs-week.ts:721` (`isPackerLogEnrichmentRead() ? enrichedQuery : legacyQuery`).
- Table migration: `src/lib/migrations/2026-06-29f_packer_log_enrichment.sql`.
- Backfill: `scripts/backfill-packer-log-enrichment.ts` (dry-run default; `--apply`,
  `--stale`, `--since=`, `--org=`).

**Impact:** replaces **~6 non-indexable LATERAL subqueries per row** on the
packer/shipped week query with a 1:1 join — the heaviest recurring read on the
shipped/packing surface.

**Go-live runbook (owner-gated — needs prod DB + Vercel env):**
1. Confirm `2026-06-29f_packer_log_enrichment.sql` is applied in prod (migration tracker).
2. Dry-run: `npx tsx scripts/backfill-packer-log-enrichment.ts` → review the candidate
   count.
3. Backfill: `npx tsx scripts/backfill-packer-log-enrichment.ts --apply` (optionally
   `--since=` to bound history first, then full).
4. Flip `PACKER_LOG_ENRICHMENT_READ=true` (Vercel env) → redeploy.
5. Verify: load the packerlogs week view; spot-check a few rows match the legacy output
   (title / v_sku / order match / tracking). If wrong, flip the env back (instant
   revert to the byte-identical legacy query) and `--stale` recompute.

**Acceptance:** packerlogs week view renders identically, faster; instant rollback path
confirmed. **Agent did:** verified readiness + fixed the `.mjs`→`.ts` doc bug in
`feature-flags.ts`. **Owner does:** backfill + env flip.

---

## #3 — Poller intervals  ·  Reliability/cost · Effort S · **DONE (code)**

**Correction to the initial scan:** the `refetchInterval` values are **not** ambiguous
seconds — they're all ms (`60_000`=60s, `15_000`=15s). And **no**
`refetchIntervalInBackground: true` exists anywhere (one file sets it `false`), so
React Query **already pauses polling when the tab is hidden**. The feared
"background polling burns Neon" cost was already mitigated by the library default.

**Done this session (clean files, low-risk):**
- `src/hooks/useTodayStaffAvailability.ts` — 3× `refetchInterval: 60_000` → `120_000`.
  The hook already has realtime Ably invalidation + `refetchOnWindowFocus`; the poll is
  a fallback, so 120s halves idle volume with no meaningful freshness cost.
- `src/components/station/receiving/ReceivingPhotosSection.tsx` — `15_000` → `30_000`
  (+ `staleTime` `10_000`→`20_000`). This poll is the pickup path for photos uploaded
  elsewhere; 30s is still responsive.

**Honest ROI note:** #3 is a *minor* win. The real Neon levers are #2 (this file) and
decomposing/optimizing the receiving-lines GET query (Plan 03 #8) — each poll of that
route re-runs a ~1455-line dynamic query.

**Acceptance:** intervals raised; no `refetchIntervalInBackground: true` introduced;
UX unaffected (both paths remain realtime-fresh).

---

## #4 — Provision Upstash Redis for rate limiting  ·  SaaS/reliability · Effort S (config)

**Now:** `src/lib/api-guard.ts:14-27` uses a distributed sliding-window limiter **only**
when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set; otherwise it falls
back to a per-instance in-memory `Map` (L39) — effectively no limit across serverless
instances. There's a loud prod boot warning already.

**Do (owner):** provision an Upstash Redis instance; set the two env vars; redeploy;
confirm the boot warning clears and a burst is throttled cross-instance.

**Acceptance:** rate limiting active across instances; noisy-neighbor / abuse protection
real before external tenants share the app. **Owner action:** provision + env.

---

## Cross-references
- [00 — Index](00_INDEX_ROI_EXECUTION.md) · [02 — Path to Sellable](02_path_to_sellable.md) (do #1/#4 alongside the revenue switch)
- `docs/partial/HUMAN-TODO.md` §A1 (Stripe go-live), I2-1 (Hermes), §D (backfills).
