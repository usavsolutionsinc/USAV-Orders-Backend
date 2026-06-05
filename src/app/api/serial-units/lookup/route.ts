import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { findByNormalizedSerial } from '@/lib/neon/serial-units-queries';

/**
 * GET /api/serial-units/lookup?serial=<value>
 *
 * Exact serial existence check used by the RETURN receiving flow. Normalizes
 * the serial (trim + uppercase) and does a single indexed lookup on the unique
 * `serial_units.normalized_serial` column — cheap, no ILIKE scan.
 *
 * Returns the matched unit's public-facing fields plus `is_return`, which is
 * true when the unit's current status is SHIPPED (an item we shipped that's
 * now coming back = a genuine return).
 *
 * Response: {
 *   success: true,
 *   serial:  <normalized>,
 *   found:   boolean,
 *   is_return: boolean,
 *   unit: {
 *     serial_number, sku, current_status, condition_grade,
 *     current_location, updated_at, is_return
 *   } | null
 * }
 */
export const GET = withAuth(async (request) => {
  const raw = request.nextUrl.searchParams.get('serial') ?? '';
  const trimmed = raw.trim();
  if (!trimmed) {
    return NextResponse.json(
      { success: false, error: 'serial query param is required' },
      { status: 400 },
    );
  }

  try {
    const row = await findByNormalizedSerial(trimmed);
    if (!row) {
      return NextResponse.json({
        success: true,
        serial: trimmed.toUpperCase(),
        found: false,
        is_return: false,
        unit: null,
      });
    }

    const isReturn = row.current_status === 'SHIPPED';
    return NextResponse.json({
      success: true,
      serial: row.normalized_serial,
      found: true,
      is_return: isReturn,
      unit: {
        serial_number: row.serial_number,
        sku: row.sku,
        current_status: row.current_status,
        condition_grade: row.condition_grade,
        current_location: row.current_location,
        updated_at: row.updated_at,
        is_return: isReturn,
      },
    });
  } catch (err) {
    console.error('serial-units/lookup failed', err);
    return NextResponse.json(
      { success: false, error: 'Serial lookup failed' },
      { status: 500 },
    );
  }
});
