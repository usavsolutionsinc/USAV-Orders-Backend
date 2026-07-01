/**
 * lookup-po resolver — the two-phase fetch ladder, classified into a result.
 *
 *   Phase 1 (localOnly): resolve from LOCAL data only (mirror/incoming), never
 *     blocking on Zoho, so a hit opens with no takeover loader. A local miss
 *     returns `zoho_pending`.
 *   Phase 2 (Zoho, the ONLY loader-bearing call): an ORDER scan that missed
 *     local data comes back not_found + zoho_pending with NO carton created — the
 *     PO may have just been imported by the mirror cron, so re-ping WITHOUT
 *     localOnly. Tracking misses do NOT escalate here: they already created an
 *     unfound carton (returned as `unmatched`) and self-promote in the
 *     background via the caller's own follow-up.
 *
 * Returns a {@link LookupPoResolution} the hook applies; throws on a hard
 * failure (`!success`) so the caller's existing catch reports it. Pure +
 * dependency-injected (`lookupPo`, `showLoader`) → DB/React-free.
 */

import type { LookupPoDeps, LookupPoInput, LookupPoResolution } from '../types';

export async function resolveViaLookupPo(
  input: LookupPoInput,
  deps: LookupPoDeps,
): Promise<LookupPoResolution> {
  let data = await deps.lookupPo({
    trackingNumber: input.callValue,
    staffId: input.staffId,
    mode: input.callMode,
    localOnly: true,
    intakeSurface: input.intakeSurface,
  });

  if (!data?.success) {
    throw new Error((typeof data?.error === 'string' ? data.error : '') || 'Lookup failed');
  }

  // The PO header matched but its line items could not import because Zoho isn't
  // connected — the caller surfaces the real cause and routes to reconnect.
  if (data.integration_error === 'zoho_not_connected') {
    return { kind: 'integration-error', data };
  }

  // Phase 2 — Zoho fallback (loader-bearing). ONLY for explicit order# scans:
  // tracking/auto unfound cartons promote in the background; they must never
  // block the operator behind a synchronous Zoho round-trip + takeover loader.
  const isOrderScan = input.callMode === 'order' || input.originalMode === 'order';
  if (data.not_found === true && data.zoho_pending === true && isOrderScan) {
    deps.showLoader();
    try {
      const zohoData = await deps.lookupPo({
        trackingNumber: input.callValue,
        staffId: input.staffId,
        mode: input.callMode,
        intakeSurface: input.intakeSurface,
      });
      if (zohoData?.success) data = zohoData;
    } catch {
      /* keep the local not_found result — the caller's toast reports it */
    }
  }

  const isMatched =
    Boolean(data.matched) && Array.isArray(data.lines) && data.lines.length > 0;

  // Order# lookups that resolve to nothing are a clean not-found (a mistyped
  // PO/order number must NOT create a phantom box); ticket# lookups behave the
  // same — the caller toasts instead.
  if (!isMatched && (input.originalMode === 'order' || input.originalMode === 'ticket' || data.not_found)) {
    return { kind: 'not_found', data };
  }

  return isMatched ? { kind: 'matched', data } : { kind: 'unmatched', data };
}
