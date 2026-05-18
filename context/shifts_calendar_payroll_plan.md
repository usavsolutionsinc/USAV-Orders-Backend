# Shifts, calendar, and payroll — implementation plan

**Status:** DB tables landed (`2026-05-17_shifts_calendar_payroll.sql`). UI + API wiring follows.

---

## 1. Problem statement

The current model says "Michael is scheduled on Mondays" with a single boolean. That works for "is the calendar grid green or red" and nothing else.

The model needs to scale to four real problems:

| Problem                                       | Current answer                        | Needed answer                                                          |
| --------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| "Is Michael scheduled today?"                 | `staff_weekly_schedule.is_scheduled`  | Same — derived from a real shift row                                   |
| "What hours is Michael working today?"        | Implicit 9-5, hardcoded               | `shifts.starts_at` / `shifts.ends_at`                                  |
| "Who covered Sang's shift on 2026-05-18?"     | No data                               | `shifts.covers_shift_id`                                               |
| "How much do we owe Tuan for the pay period?" | No data                               | `time_punches` × `staff_pay_rates` over the `pay_periods` window       |

So the schema replaces a per-weekday boolean with a real shift-instance model, plus three more tables stacked on top for time-tracking and payroll.

---

## 2. Schema landed

See `src/lib/migrations/2026-05-17_shifts_calendar_payroll.sql`. Six tables + one function + one column on `staff`.

### 2.1 `shift_templates`

Recurring rule per (staff, weekday). One row = "Michael works Mondays 9 AM – 5 PM PT, starting 2026-01-01, indefinitely."

| Column             | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `staff_id`         | FK staff(id), cascade                                                |
| `day_of_week`      | 0–6 (Sun–Sat)                                                        |
| `starts_at_minute` | Minutes from local midnight; 540 = 9:00                              |
| `ends_at_minute`   | Minutes from local midnight; 1020 = 17:00                            |
| `timezone`         | IANA tz, default `America/Los_Angeles` — DST-safe                    |
| `location_id`      | Optional FK locations(id)                                            |
| `effective_from`   | DATE — first day this template applies                               |
| `effective_to`     | DATE NULL — open-ended                                               |

**Why not bake start/end as full timestamps?** Because then a DST change would force a schema update; minutes-from-midnight + tz survives DST transparently.

### 2.2 `shifts`

Concrete instance — one row = "Michael works 2026-05-18 09:00 PT → 17:00 PT, status=planned, template_id=12."

Materialized from a template by `materialize_shifts()` or inserted manually for ad-hoc / cover shifts.

Status lifecycle:

```
                                ┌─→ missed
planned ──→ confirmed ──→ in_progress ──→ completed
        └─→ cancelled (covered by another shift)
```

**Critical invariant:** a single `staff_id` cannot have two overlapping non-cancelled shifts. Enforced by a `btree_gist` exclusion constraint:

```sql
EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
WHERE (status NOT IN ('cancelled', 'missed'))
```

This is what makes "Tuan covers Sang" safe: when Tuan accepts cover, Sang's row gets `status='cancelled'` first, *then* Tuan's row gets inserted. The constraint guarantees the schedule can never be self-contradictory.

### 2.3 `time_punches`

Actual clock-in / clock-out. `shifts.starts_at` is **planned**, `time_punches.punched_in_at` is **real**. Payroll uses punches; scheduling uses shifts.

Constraints:
- One `time_punches` row per (staff, clock-in). FK `shift_id` is nullable so off-the-books punches still record.
- Unique partial index `WHERE punched_out_at IS NULL` — exactly one open punch per staff.
- `source` tracks who/what created the punch (`pin` / `passkey` / `badge` / `admin_override` / `auto_close`).

### 2.4 `staff_pay_rates`

Historical hourly rate. `effective_to IS NULL` = current rate. Payroll picks the rate that was effective during the punch's clock-in date — so back-dated raises don't rewrite past pay.

### 2.5 `pay_periods`

Optional batching. Status: `open → review → finalized → paid`. Once a period is finalized, the application should refuse to edit `time_punches` rows whose `punched_in_at` falls inside that period (frontend gate; can add a trigger later if needed).

### 2.6 `time_off_requests`

Vacation / sick / personal. When `status='approved'`, `materialize_shifts()` SKIPS generating shifts inside the window, so the calendar shows the gap explicitly.

### 2.7 `staff.shifts_materialized_through`

Per-staff bookmark — "shift rows from templates have been generated through this date already." The read path checks this column and runs `materialize_shifts()` on demand for any gap. This is what makes the system **cron-free**.

### 2.8 `materialize_shifts(staff_id, from, to)`

PL/pgSQL function — generates concrete shift rows from templates over `[from, to]`, honoring:

1. `staff_schedule_overrides` (legacy — admin tapped "off" on a date)
2. `staff_availability_rules` (legacy — weekday blocked by rule)
3. Approved `time_off_requests` (new)
4. Already-existing shifts for the same (staff, date) — no duplicates

Idempotent. Updates `staff.shifts_materialized_through` to the highest date covered.

Called by:
- Migration (seeds today + 14 days for every active staff)
- `GET /api/shifts?from=X&to=Y` read path (materializes any gap before responding)
- `POST /api/shifts/templates` (re-materializes for the affected staff)
- `POST /api/auth/signin` (ensures today's shift exists before allowing sign-in)

---

## 3. No-cron session invalidation

The whole point of the shifts model is the session check falls out naturally.

### 3.1 Sign-in (POST /api/auth/signin)

```ts
// Before issuing a session:
await materializeShifts(staffId, today, today);  // ensure today exists
const activeShift = await db.query(`
  SELECT id, ends_at FROM shifts
  WHERE staff_id = $1
    AND starts_at <= NOW()
    AND ends_at   >= NOW()
    AND status NOT IN ('cancelled', 'missed')
  ORDER BY ends_at DESC LIMIT 1
`, [staffId]);

if (!activeShift) {
  return NextResponse.json(
    { error: 'NOT_SCHEDULED', message: "You're not scheduled today" },
    { status: 403 }
  );
}

// Session lives until shift ends, not the fixed 24h
const session = await createSession({
  staffId,
  deviceKind,
  expiresAt: activeShift.ends_at,  // ← key change
});
```

### 3.2 Session load (loadSession hot path)

Already checks `expires_at <= NOW()`. **No change needed.** Sessions naturally die when the shift ends.

Optional belt-and-suspenders: add `not-scheduled-today` reason to `loadSessionWithReason`. Useful if a session was created mid-shift but the shift later got cancelled (rare but possible).

### 3.3 Cover-shift flow (Tuan covers Sang)

```sql
BEGIN;
-- Cancel Sang's shift
UPDATE shifts SET status = 'cancelled', updated_at = NOW()
WHERE id = $sang_shift_id;

-- Insert Tuan's cover shift, pointing back at Sang's row for audit
INSERT INTO shifts (staff_id, starts_at, ends_at, status, covers_shift_id, created_by)
VALUES ($tuan_id, $starts_at, $ends_at, 'confirmed', $sang_shift_id, $current_admin_id);

-- Revoke Sang's session immediately if he's signed in
UPDATE staff_sessions SET revoked_at = NOW()
WHERE staff_id = $sang_id AND revoked_at IS NULL;
COMMIT;
```

Now when Tuan walks up to the computer, his sign-in succeeds (he has a shift), and Sang's stale session is dead.

### 3.4 Auto-sign-out at end of shift

The proxy / AuthContext already redirect to `/signin` when the session is invalid. After `shift.ends_at` passes, the next request fails the `expires_at` check, the cookie gets cleared, the user lands on `/signin`. **No code change needed** — it's already wired.

---

## 4. Calendar UI ↔ table mapping

### 4.1 Read endpoint

```
GET /api/shifts?from=2026-05-11&to=2026-05-17
```

**Pseudocode:**

```ts
// 1. Lazy materialize for any staff whose horizon < `to`
const stale = await db.query(`
  SELECT id FROM staff
  WHERE active = true
    AND (shifts_materialized_through IS NULL OR shifts_materialized_through < $1::date)
`, [to]);
for (const { id } of stale.rows) {
  await db.query(`SELECT materialize_shifts($1, $2, $3)`, [id, from, to]);
}

// 2. Read shifts in range
const shifts = await db.query(`
  SELECT s.id, s.staff_id, s.starts_at, s.ends_at, s.status,
         s.covers_shift_id, s.location_id, s.notes,
         st.name AS staff_name, st.color_hex
  FROM shifts s
  JOIN staff st ON st.id = s.staff_id
  WHERE s.starts_at < $2::date + INTERVAL '1 day'
    AND s.ends_at >= $1::date
    AND s.status NOT IN ('cancelled', 'missed')
  ORDER BY s.starts_at, st.name
`, [from, to]);

return { shifts: shifts.rows };
```

Response shape — one row per shift, ready for the calendar:

```json
{
  "shifts": [
    {
      "id": 142,
      "staff_id": 1,
      "starts_at": "2026-05-18T16:00:00Z",  // 09:00 PT
      "ends_at":   "2026-05-19T00:00:00Z",  // 17:00 PT
      "status": "planned",
      "covers_shift_id": null,
      "staff_name": "Michael",
      "color_hex": "#10b981"
    },
    ...
  ]
}
```

### 4.2 Calendar component (`StaffScheduleBoard`)

Already built at `src/components/admin/StaffScheduleBoard.tsx`. **Needs rewiring** from the legacy data props to the `/api/shifts` response:

- Remove `scheduleMap` / `availabilityRuleMap` / `*DetailMap` props.
- Add `shifts: Shift[]` prop or fetch internally via `useQuery(['shifts', from, to])`.
- For each day column: filter shifts where `starts_at::date === day.date`, render an avatar pill per shift in the column.
- "Off" section disappears (no shift row = not working — there's nothing to render dim).
- "Blocked" treatment goes away too — if a staff has an approved time-off, `materialize_shifts` won't create a row, so the column simply doesn't list them.

### 4.3 Inline edits

Each avatar pill in the calendar opens a small popover:

```
┌──────────────────────────────┐
│ Michael · 9 AM – 5 PM        │
│ Status: Planned              │
│                              │
│ [Edit hours]                 │
│ [Cancel shift]               │
│ [Find a cover]               │
└──────────────────────────────┘
```

Mutations:

| Action            | Endpoint                                | Effect                                                                                 |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| Edit hours        | `PATCH /api/shifts/:id`                 | `UPDATE shifts SET starts_at, ends_at, updated_at = NOW() WHERE id = ?`                |
| Cancel shift      | `PATCH /api/shifts/:id` `status=cancelled` | Sets status + revokes session if currently signed in                                |
| Find a cover      | Opens cover modal                       | Lists active staff not already shifted in the window; on pick, runs the 3-step cover tx |

### 4.4 Empty days

Click an empty cell in a day column → modal "Add shift" with staff selector + hours. Posts to `POST /api/shifts` (manual shift, no template_id).

---

## 5. Endpoints

### 5.1 Shifts

```
GET    /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD
POST   /api/shifts                        # manual one-off shift
PATCH  /api/shifts/:id                    # edit hours / status / notes
POST   /api/shifts/:id/cover              # cover-shift transaction
```

### 5.2 Shift templates

```
GET    /api/shift-templates?staffId=N
POST   /api/shift-templates               # admin creates "Michael, Mondays, 9–5"
PATCH  /api/shift-templates/:id           # edit hours or set effective_to
DELETE /api/shift-templates/:id           # soft-delete by setting effective_to = today
```

On `POST` / `PATCH` / `DELETE`, the handler runs `materialize_shifts(staffId, today, today + 14)` so the calendar reflects the change immediately and `staff.shifts_materialized_through` stays accurate.

### 5.3 Time punches

```
POST   /api/punches/in                    # clock-in current user
POST   /api/punches/:id/out               # clock-out
GET    /api/punches?staffId=N&from=&to=
PATCH  /api/punches/:id                   # admin edit (sets edited_by + edited_reason)
```

The PIN sign-in flow can optionally create a punch on success. Two modes:

- **Loose** (current): sign-in does not punch. Punches are a separate "Clock in" button.
- **Strict** (recommended for payroll): sign-in == clock-in. On successful PIN, insert a `time_punches` row with `source='pin'` and `shift_id` = current active shift. Sign-out closes it.

### 5.4 Pay rates

```
GET    /api/staff/:id/pay-rate            # current effective rate
POST   /api/staff/:id/pay-rate            # admin sets new rate
                                          # closes previous open rate (sets effective_to)
GET    /api/staff/:id/pay-rate/history    # full history
```

### 5.5 Pay periods + payroll preview

```
GET    /api/pay-periods                   # list, paginated
POST   /api/pay-periods                   # admin creates next period
PATCH  /api/pay-periods/:id               # status transitions
GET    /api/pay-periods/:id/payroll       # computed totals, see below
```

Payroll computation (for one staff, one period):

```sql
SELECT
  staff_id,
  SUM(
    EXTRACT(EPOCH FROM (
      LEAST(punched_out_at, $period_end)
      - GREATEST(punched_in_at, $period_start)
    )) / 60.0 - COALESCE(break_minutes, 0)
  ) / 60.0 AS hours,
  SUM(
    (hourly_cents / 100.0) *
    (EXTRACT(EPOCH FROM (
      LEAST(punched_out_at, $period_end)
      - GREATEST(punched_in_at, $period_start)
    )) / 3600.0 - COALESCE(break_minutes, 0) / 60.0)
  ) AS gross_pay
FROM time_punches tp
JOIN LATERAL (
  SELECT hourly_cents FROM staff_pay_rates
  WHERE staff_id = tp.staff_id
    AND effective_from <= tp.punched_in_at::date
    AND (effective_to IS NULL OR effective_to >= tp.punched_in_at::date)
  ORDER BY effective_from DESC LIMIT 1
) rate ON true
WHERE tp.staff_id = $1
  AND tp.punched_out_at IS NOT NULL
  AND tp.punched_in_at  >= $period_start
  AND tp.punched_in_at  <  $period_end + INTERVAL '1 day'
GROUP BY staff_id;
```

### 5.6 Time off

```
POST   /api/time-off                      # staff requests
GET    /api/time-off?staffId=N&status=
PATCH  /api/time-off/:id                  # admin approves/denies
```

On `status='approved'`, the handler should *delete* any future planned shifts that fall inside the window (and revoke sessions if applicable) — same pattern as cover.

---

## 6. Calendar implementation order

1. **Replace `StaffScheduleBoard` data source** — drop the legacy props, fetch `useQuery(['shifts', from, to])` against the new endpoint. **Stop here, ship, validate.** Calendar still renders; admin editor below still works on legacy tables.
2. **`/api/shifts` read endpoint** with lazy materialization.
3. **Inline shift popover** with edit/cancel actions → `/api/shifts/:id` PATCH.
4. **Cover-shift modal** with the 3-step transaction.
5. **Manual shift creation** from empty cells.
6. **Shift templates UI** inside the existing staff edit panel — replaces the current Mon-Fri toggle grid with a "9:00–5:00 every weekday" rule editor.
7. **Remove the legacy schedule tables UI** from `StaffManagementTab` (the three boolean grids). The old SQL tables stay for safety until the new flow has soaked.

## 7. Payroll implementation order

1. **`staff_pay_rates` admin UI** — set initial rate per staff (one row each, `effective_from = hire_date`).
2. **Clock-in/out plumbing** — either tied to sign-in (strict) or as a separate button (loose). Decide based on how the shop wants to handle "I forgot to clock out."
3. **Pay period batching UI** — list of periods, current open one editable.
4. **Payroll preview view** — table of staff × hours × pay for the current open period.
5. **Period finalization** — lock punches in the window, generate exportable CSV/PDF.

## 8. Migration sequencing

Old → new is done **additively** to keep the app working throughout:

| Step | Action                                                                                      | Old tables still used? |
| ---- | ------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | Migration lands ✅ (done) — new tables + backfilled templates + 14-day shift seed           | yes                    |
| 2    | `StaffScheduleBoard` reads `/api/shifts`                                                    | no for display         |
| 3    | Cover-shift, time-off, shift-template UI shipped                                            | no for writes          |
| 4    | Sign-in checks for active shift, rejects unscheduled staff                                  | no                     |
| 5    | Payroll views shipped on top of `time_punches` + `staff_pay_rates`                          | no                     |
| 6    | Drop `staff_weekly_schedule`, `staff_week_plans`, `staff_schedule_overrides` after soak     | gone                   |
| 7    | (Optional) deprecate `staff_availability_rules` — folded into `time_off_requests` + templates | gone                  |

---

## 9. Open questions to resolve before coding the UI

1. **Sign-in == clock-in?** Strict mode is the payroll standard; loose mode is friendlier when staff forget. Pick one before wiring `/api/auth/signin`.
2. **Cover-shift permissions.** Only admins, or can any staff request a cover that the original-staff or admin approves?
3. **Default shift length per role.** Tech / packer might both default to 9–5; receivers might be 8–4. Add a `shift_templates.role` shortcut if so.
4. **Multi-location.** `location_id` is in the schema but unused. Wire it up when the second warehouse goes live.
5. **Overtime / breaks.** California requires meal breaks; payroll calc currently subtracts `break_minutes` flat. Add break enforcement (auto-clock-in/out at noon for 30 min?) if needed.
