/**
 * Server-side NAS photo helpers — resolve the base URL + per-operator folder
 * the browser should read/write receiving photos against.
 *
 * The app is Vercel-hosted and can't reach the LAN NAS, so it never touches the
 * NAS itself; it only tells the browser WHERE the active NAS lives (the admin-
 * configured `nasPhotoServers` slot) and which folder to open/write into for
 * this operator's station. The browser does the actual WebDAV PUT / GET.
 */

import { getOrganization } from '@/lib/tenancy/organizations';
import { getActiveNasBaseUrl } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';
import { getStaffStations } from '@/lib/neon/staff-stations-queries';

export interface NasConfigForOperator {
  /** Active NAS base URL (no trailing slash); '' when nothing is configured. */
  baseUrl: string;
  /** Folder the picker/capture should open/write into; '' = NAS root. */
  folder: string;
}

/**
 * Resolve the default NAS folder for an operator from the org's admin-configured
 * `stationNasPhotoFolders`. Resolution order:
 *   1. the operator's primary-station folder (needs a staff_stations row),
 *   2. an explicit DEFAULT (all-stations) folder,
 *   3. if exactly one distinct folder is configured across every station, use it
 *      (covers orgs that set the same folder everywhere without per-staff
 *      stations), else '' (NAS root).
 * Best-effort: any settings/station hiccup resolves to '' rather than throwing.
 */
export async function resolveOperatorNasFolder(
  organizationId: OrgId,
  staffId: number,
): Promise<string> {
  try {
    const [org, stations] = await Promise.all([
      getOrganization(organizationId),
      getStaffStations(staffId),
    ]);
    const primary = stations.find((s) => s.is_primary)?.station ?? stations[0]?.station;
    const map = (org?.settings.stationNasPhotoFolders ?? {}) as Record<string, string>;
    const distinct = [
      ...new Set(Object.values(map).map((v) => (v || '').trim()).filter(Boolean)),
    ];
    const resolved =
      (primary && map[primary]) ||
      map.DEFAULT ||
      (distinct.length === 1 ? distinct[0] : '') ||
      '';
    return typeof resolved === 'string' ? resolved : '';
  } catch {
    return '';
  }
}

/** Active base URL + resolved folder for this operator, for GET /api/nas-config. */
export async function getNasConfigForOperator(
  organizationId: OrgId,
  staffId: number,
): Promise<NasConfigForOperator> {
  const [org, folder] = await Promise.all([
    getOrganization(organizationId),
    resolveOperatorNasFolder(organizationId, staffId),
  ]);
  // The browser no longer talks to the NAS directly — it goes through the
  // same-origin /api/nas proxy (which holds the real tunnel URL + x-agent-token
  // server-side). So the client base URL is the proxy when a NAS is configured,
  // and '' (not configured) otherwise. The actual upstream is resolved inside
  // the proxy from NAS_RW_URL / the active nasPhotoServers slot.
  const configured = org ? getActiveNasBaseUrl(org.settings) : '';
  const baseUrl = configured ? '/api/nas' : '';
  return { baseUrl, folder };
}
