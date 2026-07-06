/**
 * Receiving surface-path helpers (Studio-driven operator surfaces, Phases 1–2).
 *
 * Two receiving modes have graduated to their own first-class routes — Unbox
 * (`/unbox`) and Triage (`/triage`); the rest still live on `/receiving?mode=…`.
 * These pure helpers keep the routes as a single source of truth (from the
 * surface registry) so no component hardcodes them, and let in-surface
 * navigations stay on the current surface instead of bouncing to `/receiving`.
 */

import { getSurface } from '@/lib/stations/surface-keys';

/** Canonical route of the Unbox surface (`/unbox`). */
export const UNBOX_SURFACE_ROUTE = getSurface('unbox').route;
/** Canonical route of the Triage surface (`/triage`). */
export const TRIAGE_SURFACE_ROUTE = getSurface('triage').route;
/** Canonical route of the Incoming surface (`/incoming`). */
export const INCOMING_SURFACE_ROUTE = getSurface('incoming').route;
/** Canonical route of the Local Pickup surface (`/pickup`). */
export const PICKUP_SURFACE_ROUTE = getSurface('pickup').route;
/** Canonical route of the Receiving History surface (`/receiving/history`). */
export const HISTORY_SURFACE_ROUTE = getSurface('history').route;

/**
 * Receiving modes that have their own top-level route, longest-first so a nested
 * path resolves to its surface (`/receiving/history` must precede any `/receiving`
 * prefix check). Extend as more modes graduate.
 */
const GRADUATED_ROUTES: ReadonlyArray<string> = [
  HISTORY_SURFACE_ROUTE, // `/receiving/history` — longest, checked first
  UNBOX_SURFACE_ROUTE,
  TRIAGE_SURFACE_ROUTE,
  INCOMING_SURFACE_ROUTE,
  PICKUP_SURFACE_ROUTE,
];

/**
 * Base path of the receiving-family surface the given pathname is on. In-surface
 * param updates should build their next URL on top of this so a click on
 * `/unbox` (or `/triage`) stays there rather than jumping to `/receiving`.
 */
export function receivingSurfaceBasePath(pathname: string | null | undefined): string {
  if (pathname) {
    for (const route of GRADUATED_ROUTES) {
      if (pathname === route || pathname.startsWith(`${route}/`)) return route;
    }
  }
  return '/receiving';
}

/**
 * Build the deep link that opens a carton (and optionally a line) in the Unbox
 * workspace. Replaces the old `/receiving?recvId=…` / `?mode=receive` intents.
 */
export function openInUnboxHref(receivingId: number, lineId?: number): string {
  const params = new URLSearchParams({ recvId: String(receivingId) });
  if (lineId != null && Number.isFinite(lineId) && lineId > 0) {
    params.set('lineId', String(lineId));
  }
  return `${UNBOX_SURFACE_ROUTE}?${params.toString()}`;
}
