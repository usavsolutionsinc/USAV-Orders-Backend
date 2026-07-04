# ROI Execution Plans — USAV-Orders-Backend (2026-07-04)

Produced from a fresh three-lens scan (SaaS-readiness · reliability/tech-debt · ops
throughput), reconciled against `docs/partial/HUMAN-TODO.md` and the tenancy audit
reports. Optimized for **revenue + safety + throughput** (not net-new differentiation).

## Headline

The codebase is **much closer to sellable and healthier than its size suggests**
(755 routes, ~505k LOC, 348 migrations). Stripe billing is production-grade,
onboarding is genuinely self-serve, RLS is really enforced (192/247 tables FORCEd),
receiving is well unit-tested, only 8 (benign) circular deps. **The dominant ROI
theme across all three lenses: a large amount of high-value work is already coded
and merged but switched off.** The fastest wins are finishing/flipping, not building.

## Plans

| File | Cluster | Gist | Effort |
|------|---------|------|--------|
| [01_tier0_flip_switch_wins.md](01_tier0_flip_switch_wins.md) | Tier 0 | Trial expiry · packer-log enrichment go-live · poller intervals · Redis | S each |
| [02_path_to_sellable.md](02_path_to_sellable.md) | Tier 1 | Entitlement enforcement (revenue switch) **+** cross-tenant leak closure — coupled | M |
| [03_reliability_foundation.md](03_reliability_foundation.md) | Tier 2 | Decompose receiving-lines GET · test replenishment · workflow-tap observability | M–L |
| [04_ops_quick_wins.md](04_ops_quick_wins.md) | Tier 3 | ?staff= picker · SKU edit · Zendesk-in-packing · ShipStation outbound · dormant rollouts | S–M |

## Recommended sequence

1. **Tier 0 this week** — all small, mostly finishing existing code (Plan 01).
2. **#5 + #6 together** (Plan 02) — the two halves of "can charge strangers safely."
   **Never ship the revenue switch (#5) without the leak closure (#6).**
3. **Tier 2 #8/#9** (Plan 03) — harden the receiving hot path once revenue is on.
4. **Tier 3** (Plan 04) — daily-value quick wins, interleaved as capacity allows.

## Status of this session's execution (Tier 0, "plan + start #2/#3")

- **#3 (poller intervals) — DONE in code (small).** Verified the agent's "ambiguous
  seconds/ms" concern was wrong (all values are ms with `_` separators) and that
  **no `refetchIntervalInBackground: true` exists**, so React Query already pauses
  polling when the tab is hidden — the big cost worry was already mitigated. Made two
  low-risk edits: `useTodayStaffAvailability.ts` 3× `60_000`→`120_000` (realtime-
  backed fallback) and `ReceivingPhotosSection.tsx` `15_000`→`30_000`. **Net: #3 is a
  minor win; the real Neon lever is #2 + the receiving-lines query cost (Plan 03).**
- **#2 (packer-log enrichment) — code VERIFIED READY; go-live is owner-gated.** See
  Plan 01 for the exact runbook. Fixed a doc bug in `feature-flags.ts` (comment
  referenced a nonexistent `.mjs` backfill script; corrected to `.ts`).

> Working tree already had 264 modified files from in-flight work at session start;
> all edits above were to **clean** files and stack cleanly. Nothing committed
> (per workflow: commit via GitHub Desktop).
