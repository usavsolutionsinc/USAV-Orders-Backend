import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  findByNormalizedSerial,
  findShippedOrderForSerialUnit,
  findShippedOrderByTsnSerial,
  type MatchedOrderForSerial,
} from '@/lib/neon/serial-units-queries';

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
 *   } | null,
 *   matched_order: {
 *     order_id, item_number, account_source, product_title, sku, condition,
 *     tracking_number, allocation_state
 *   } | null   // the shipped sales order this serial belongs to, when known
 *              // (item_number → listing link via getExternalUrlByItemNumber)
 * }
 */
export const GET = withAuth(async (request, ctx) => {
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

    // Resolve the originating sales order two ways:
    //   1. inventory-v2: serial_units → order_unit_allocations → orders, when
    //      the unit exists and is SHIPPED.
    //   2. legacy/tech ships: tech_serial_numbers.shipment_id → orders, which
    //      is where most of our shipped serials actually live (they were never
    //      written to serial_units). Used as the fallback so a real shipped
    //      serial still matches even with no v2 row.
    // Both are org-scoped so a serial never surfaces another tenant's order.
    let matched: (MatchedOrderForSerial & { serial_number?: string }) | null =
      row && row.current_status === 'SHIPPED'
        ? await findShippedOrderForSerialUnit(row.id, {
            organizationId: ctx.organizationId,
          })
        : null;
    if (!matched) {
      matched = await findShippedOrderByTsnSerial(trimmed, {
        organizationId: ctx.organizationId,
      });
    }

    // Not found anywhere — neither an inventory unit nor a shipped serial.
    if (!row && !matched) {
      return NextResponse.json({
        success: true,
        serial: trimmed.toUpperCase(),
        found: false,
        is_return: false,
        unit: null,
        matched_order: null,
      });
    }

    // A serial we shipped (v2 SHIPPED, or any tech ship resolved above) coming
    // back across receiving is a genuine return.
    const isReturn = row?.current_status === 'SHIPPED' || !!matched;

    // Prefer the real serial_units row; otherwise synthesize a minimal unit
    // from the shipped-order match so the UI band still renders the facts.
    const unit = row
      ? {
          serial_number: row.serial_number,
          sku: row.sku,
          current_status: row.current_status,
          condition_grade: row.condition_grade,
          current_location: row.current_location,
          updated_at: row.updated_at,
          is_return: isReturn,
        }
      : {
          serial_number: matched?.serial_number ?? trimmed.toUpperCase(),
          sku: matched?.sku ?? null,
          current_status: 'SHIPPED',
          condition_grade: null,
          current_location: null,
          updated_at: null,
          is_return: true,
        };

    return NextResponse.json({
      success: true,
      serial: row?.normalized_serial ?? trimmed.toUpperCase(),
      found: true,
      is_return: isReturn,
      unit,
      matched_order: matched
        ? {
            order_id: matched.order_id,
            item_number: matched.item_number,
            account_source: matched.account_source,
            product_title: matched.product_title,
            sku: matched.sku,
            condition: matched.condition,
            tracking_number: matched.tracking_number,
            allocation_state: matched.allocation_state,
          }
        : null,
    });
  } catch (err) {
    console.error('serial-units/lookup failed', err);
    return NextResponse.json(
      { success: false, error: 'Serial lookup failed' },
      { status: 500 },
    );
  }
});
