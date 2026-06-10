/**
 * scan-history-route — maps a phone scan's `routed_to` (a /m/* mobile path)
 * to the equivalent DESKTOP page, plus a human label.
 *
 * Phone receiving Data Matrix labels resolve (via barcode-routing) to one of
 * three mobile routes. On desktop we open the corresponding workspace page:
 *
 *   /m/r/{id}  receiving / PO   →  /receiving?mode=history&recvId={id}
 *              History shows every carton regardless of state, so the deep
 *              link always lands; the default (unbox) view only lists active
 *              work and silently missed already-received cartons.
 *   /m/l/{id}  receiving line   →  /receiving/lines/{id}
 *   /m/u/{id}  serial unit      →  /serial/{id}
 *
 * Anything else (generic order scans, unknowns) is not a receiving handle and
 * returns null — those don't belong in the receiving scan-history list.
 */

export type ScanHandleType = 'receiving' | 'receiving-line' | 'serial-unit';

export interface ScanHandleRoute {
  type: ScanHandleType;
  /** Numeric id extracted from the mobile route. */
  id: string;
  /** Desktop page to navigate to when tapped. */
  desktopHref: string;
  /** Short label for the handle, e.g. "Receipt", "Line", "Unit". */
  typeLabel: string;
}

const HANDLE_PATTERNS: Array<{
  re: RegExp;
  type: ScanHandleType;
  typeLabel: string;
  desktop: (id: string) => string;
}> = [
  {
    re: /^\/m\/r\/(\d+)\b/,
    type: 'receiving',
    typeLabel: 'Receipt',
    desktop: (id) => `/receiving?mode=history&recvId=${id}`,
  },
  {
    re: /^\/m\/l\/(\d+)\b/,
    type: 'receiving-line',
    typeLabel: 'Line',
    desktop: (id) => `/receiving/lines/${id}`,
  },
  {
    re: /^\/m\/u\/(\d+)\b/,
    type: 'serial-unit',
    typeLabel: 'Unit',
    desktop: (id) => `/serial/${id}`,
  },
];

/**
 * SQL LIKE prefixes for the receiving handle routes — used by the history
 * endpoint to filter `mobile_scan_events.routed_to` to receiving scans only.
 */
export const RECEIVING_ROUTE_PREFIXES = ['/m/r/%', '/m/l/%', '/m/u/%'] as const;

/** Returns the desktop mapping for a receiving handle route, or null. */
export function mapScanToDesktopRoute(routedTo: string | null | undefined): ScanHandleRoute | null {
  const path = String(routedTo || '').trim();
  if (!path) return null;
  for (const p of HANDLE_PATTERNS) {
    const m = path.match(p.re);
    if (m) {
      return {
        type: p.type,
        id: m[1],
        desktopHref: p.desktop(m[1]),
        typeLabel: p.typeLabel,
      };
    }
  }
  return null;
}
