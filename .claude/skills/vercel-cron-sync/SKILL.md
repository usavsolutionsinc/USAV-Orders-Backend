---
name: vercel-cron-sync
description: Inspect, validate, and edit the Vercel Cron schedule in vercel.json. Confirms each cron's handler route exists and prints schedules in human-readable form.
allowed-tools: Bash, Read, Edit
disable-model-invocation: true
---

# Vercel Cron Sync

Single source of truth for scheduled jobs is `vercel.json` `crons[]`. This skill keeps that list honest.

## Steps

1. **Read current state** — load `vercel.json` and list every cron with its schedule and target path.

2. **Decode schedules** — for each cron, translate the cron expression to plain English (e.g. `0 */2 * * *` → "every 2 hours, on the hour"). Surface anything that looks unintentionally aggressive (every minute, every 5 minutes) — Vercel Cron has plan limits.

3. **Verify handlers exist** — for each `path`, strip query string and confirm a matching `route.ts` exists under `src/app/api/`:
   ```bash
   ls "src/app/api${PATH_NO_QUERY}/route.ts"
   ```
   Report any cron pointing at a missing route.

4. **Surface duplicates** — multiple crons hitting the same path with overlapping schedules.

5. **Edit mode** — if the user names a change ("add daily 2am inventory snapshot", "remove the qstash/ebay refresh"), modify `vercel.json` in place. Preserve formatting. Validate the resulting JSON before saving.

6. **Do not deploy.** Print the diff and let the user push.

## Rules

- Every Vercel Cron `path` must start with `/api/`. Routes outside `src/app/api/` are not reachable.
- Cron handlers must verify the `Authorization: Bearer $CRON_SECRET` header. If a referenced route doesn't, flag it.
- Don't conflate Vercel Cron with QStash schedules — QStash schedule sync is a separate concern and is **not** managed by this skill.
- Don't introduce sub-minute schedules; Vercel Cron's minimum is 1 minute, and the plan's effective minimum may be higher.

## Quick reference

- `* * * * *` = every minute
- `0 * * * *` = every hour on the hour
- `0 */N * * *` = every N hours
- `M H * * *` = daily at H:M UTC
- `M H * * 1-5` = weekdays at H:M UTC
- `M H * * 0,6` = weekends at H:M UTC

All schedules are UTC.
