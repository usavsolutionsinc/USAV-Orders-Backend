import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Auto-sort to Parts bin — API contract tests.
 *
 * Tests the "For Parts" grading flow that was introduced alongside
 * src/lib/inventory/parts-sort.ts:
 *
 *   1. Grading an eligible STOCKED unit to PARTS moves it into the Technical
 *      Room parts bin (barcode TECH-PARTS) and returns parts_sorted:true.
 *   2. Grading a committed unit (ALLOCATED/PICKED/…) leaves its location intact
 *      and returns parts_sorted:false.
 *   3. PATCHing a receiving line to condition_grade:'PARTS' clears needs_test.
 *
 * Auth comes from the saved storageState (tests/.auth/admin.json) created by
 * global-setup, so request.* calls are authenticated as the admin staff.
 *
 * Every test is self-skipping when suitable data is absent and self-restoring
 * via finally blocks so the suite stays idempotent against the live Neon DB.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const COMMITTED_STATUSES = new Set([
  'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED', 'SHIPPED', 'SCRAPPED', 'RMA',
]);

/** GET /api/serial-units/:id → body.serial_unit */
async function getSerialUnit(request: APIRequestContext, id: number) {
  const res = await request.get(`/api/serial-units/${id}`);
  expect(res.status(), `GET serial-unit ${id}`).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.serial_unit as Record<string, unknown>;
}

/**
 * Find a receiving line we can attach a throwaway serial to (needs a carton).
 */
async function findAttachableLine(
  request: APIRequestContext,
): Promise<{ id: number; receiving_id: number } | null> {
  const res = await request.get('/api/receiving-lines?view=received&limit=50');
  if (!res.ok()) return null;
  const lines: any[] = (await res.json()).receiving_lines ?? [];
  const line = lines.find((l) => l.id > 0 && l.receiving_id != null) ?? null;
  return line ? { id: Number(line.id), receiving_id: Number(line.receiving_id) } : null;
}

/**
 * Discover a unit in one of the committed statuses. Looks inside the same
 * received-lines feed.
 */
async function findCommittedUnit(
  request: APIRequestContext,
): Promise<{ id: number; condition_grade: string | null; current_location: string | null; current_status: string } | null> {
  const stateQuery = [...COMMITTED_STATUSES].map((s) => `state=${s}`).join('&');
  const res = await request.get(`/api/inventory/units?${stateQuery}&limit=50`);
  if (!res.ok()) return null;
  const body = await res.json();
  const items: any[] = body.items ?? [];
  const it = items[0];
  if (!it) return null;
  return {
    id: Number(it.id),
    condition_grade: (it.condition_grade as string | null) ?? null,
    current_location: (it.current_location as string | null) ?? null,
    current_status: String(it.current_status),
  };
}

/**
 * POST /api/serial-units/:id/grade
 * Returns the parsed response body. 409 (grade unchanged) is treated as a
 * successful restore no-op so finally blocks can call this safely.
 */
async function postGrade(
  request: APIRequestContext,
  id: number,
  newGrade: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post(`/api/serial-units/${id}/grade`, {
    data: { new_grade: newGrade },
  });
  const body = await res.json();
  return { status: res.status(), body };
}

/**
 * POST /api/serial-units/:id/move
 * Best-effort: only called in finally when original_location is non-null.
 * Ignores failures so the grade restoration isn't blocked.
 */
async function moveUnit(
  request: APIRequestContext,
  id: number,
  binName: string,
): Promise<void> {
  try {
    await request.post(`/api/serial-units/${id}/move`, {
      data: { bin_name: binName },
    });
  } catch {
    // Best-effort restore; non-fatal in finally.
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('parts autosort', () => {
  /**
   * Test 1 — happy path: grading a unit to PARTS auto-sorts it into the bin.
   *
   * Seeds its OWN throwaway serial on a receiving line (scan-serial), so the
   * test never mutates real inventory and leaves zero residue: the unit is
   * deleted in finally. (Real stocked units live in legacy free-text bins that
   * /move can't restore, so seeding is the only API-clean approach.)
   *
   * The seeded unit starts RECEIVED; grading it PARTS must sort it to STOCKED in
   * the TECH-PARTS bin.
   */
  test('grade → PARTS auto-sorts a seeded unit into the parts bin', async ({ request }) => {
    const line = await findAttachableLine(request);
    test.skip(line === null, 'no receiving line with a carton to attach a test serial');
    const target = line!;

    const serialNumber = `E2E-PARTS-${Date.now()}`;
    let serialUnitId: number | null = null;

    try {
      // Seed: attach a throwaway serial (creates a serial_units row).
      const scanRes = await request.post('/api/receiving/scan-serial', {
        data: {
          receiving_id: target.receiving_id,
          receiving_line_id: target.id,
          serial_number: serialNumber,
        },
      });
      expect(scanRes.status(), 'scan-serial seed').toBe(200);
      const scanBody = await scanRes.json();
      expect(scanBody.success, 'seed success').toBe(true);
      serialUnitId = Number(scanBody.serial_unit.id);

      // Act: grade the seeded unit PARTS.
      const { status, body } = await postGrade(request, serialUnitId, 'PARTS');
      expect(status, 'grade endpoint HTTP status').toBe(200);
      expect(body.ok, 'ok flag').toBe(true);
      expect(body.parts_sorted, 'parts_sorted flag').toBe(true);
      const partsBin = body.parts_bin as Record<string, unknown> | null;
      expect(partsBin, 'parts_bin present').not.toBeNull();
      expect(partsBin!.barcode, 'parts bin barcode').toBe('TECH-PARTS');

      // Assert persisted state.
      const unit = await getSerialUnit(request, serialUnitId);
      expect(unit.condition_grade, 'condition_grade after sort').toBe('PARTS');
      expect(unit.current_status, 'status is STOCKED after sort').toBe('STOCKED');
      expect(unit.current_location, 'location is parts bin name').toBe('Tech Room — Parts');
    } finally {
      // Cleanup: delete the throwaway serial entirely (detach removes the row).
      if (serialUnitId !== null) {
        await request.delete('/api/receiving/scan-serial', {
          data: { serial_unit_id: serialUnitId, receiving_line_id: target.id },
        });
      }
    }
  });

  /**
   * Test 2 — committed-unit guard: grading a committed unit to PARTS must NOT
   * move it; parts_sorted should be false and current_location unchanged.
   *
   * Restore: re-grade to original (409 = no-op is fine; no location move since
   * the guard should have left the location untouched).
   */
  test('grade → PARTS does not move committed unit', async ({ request }) => {
    const candidate = await findCommittedUnit(request);
    test.skip(candidate === null, 'no committed unit (ALLOCATED/PICKED/etc.) found in this environment');
    const snap = candidate!;

    try {
      const { status, body } = await postGrade(request, snap.id, 'PARTS');

      // The grade write itself succeeds (200) but sort is skipped.
      expect(status, 'grade endpoint HTTP status for committed unit').toBe(200);
      expect(body.ok, 'ok flag').toBe(true);
      expect(body.parts_sorted, 'parts_sorted must be false for committed unit').toBe(false);

      // Location must not have changed.
      const unit = await getSerialUnit(request, snap.id);
      expect(unit.current_location, 'location unchanged for committed unit').toBe(snap.current_location);
    } finally {
      // Restore condition_grade if we changed it (409 = no-op is fine).
      if (snap.condition_grade !== null) {
        await postGrade(request, snap.id, snap.condition_grade);
      }
    }
  });

  /**
   * Test 3 — PATCH receiving line to PARTS clears needs_test.
   *
   * Finds a receiving line in view=received whose needs_test is true and whose
   * condition_grade is not already PARTS. PATCHes condition_grade:'PARTS' and
   * asserts the response and a re-GET show needs_test:false.
   *
   * Restore: PATCH back original condition_grade and needs_test:true, and move
   * any attached serials back to their original locations.
   */
  test('PATCH receiving line to PARTS clears needs_test', async ({ request }) => {
    // Find a suitable receiving line. MATCHED lines are where needs_test is
    // still pending; prefer one with NO attached serials so the PARTS patch only
    // flips needs_test (nothing to sort) → cleanest restore. Guard id > 0 to
    // skip synthetic unmatched-stub rows (negative ids).
    const listRes = await request.get('/api/receiving-lines?workflow_status=MATCHED&include=serials&limit=200');
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const lines: any[] = listBody.receiving_lines ?? [];

    const eligible = lines.filter(
      (l) => l.id > 0 && l.needs_test === true && l.condition_grade !== 'PARTS',
    );
    const line =
      eligible.find((l) => (l.serials ?? []).length === 0) ?? eligible[0] ?? null;
    test.skip(line === null, 'no MATCHED line with needs_test:true and condition_grade≠PARTS found');

    const lineId: number = line!.id;
    const originalGrade: string = line!.condition_grade ?? 'USED_A';
    const serials: any[] = line!.serials ?? [];

    // Snapshot serial locations before mutation so we can restore them.
    const serialSnapshots: Array<{ id: number; current_location: string | null }> = [];
    for (const s of serials) {
      const full = await getSerialUnit(request, Number(s.id));
      serialSnapshots.push({
        id: Number(full.id),
        current_location: (full.current_location as string | null) ?? null,
      });
    }

    try {
      const patchRes = await request.patch('/api/receiving-lines', {
        data: { id: lineId, condition_grade: 'PARTS' },
      });
      expect(patchRes.status(), 'PATCH status').toBe(200);
      const patchBody = await patchRes.json();
      expect(patchBody.success, 'PATCH success flag').toBe(true);

      // The PATCH response should already reflect the cleared flag.
      expect(
        patchBody.receiving_line?.needs_test,
        'needs_test in PATCH response',
      ).toBe(false);

      // Confirm via a fresh GET.
      const getRes = await request.get(`/api/receiving-lines?id=${lineId}`);
      expect(getRes.status()).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.success).toBe(true);
      expect(
        getBody.receiving_line?.needs_test,
        'needs_test on re-GET after PARTS patch',
      ).toBe(false);
    } finally {
      // Restore condition_grade and needs_test on the line.
      await request.patch('/api/receiving-lines', {
        data: { id: lineId, condition_grade: originalGrade, needs_test: true },
      });

      // Move any serials that were relocated back to their original bins.
      for (const snap of serialSnapshots) {
        if (snap.current_location !== null) {
          await moveUnit(request, snap.id, snap.current_location);
        }
      }
    }
  });
});
