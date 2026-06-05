/**
 * Per-tenant settings schema + safe parser.
 *
 * `organizations.settings` is a jsonb bag — schema is policed here, not in
 * Postgres, so we can iterate without DDL churn. Anything callers want to
 * persist on an organization goes through `parseOrgSettings` first.
 *
 * Defaults match the current single-tenant USAV behavior so a missing key
 * never crashes downstream formatters.
 */

import { z } from 'zod';

const BrandSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const OrgSettingsSchema = z.object({
  timezone: z.string().default('America/Los_Angeles'),
  currency: z.string().length(3).default('USD'),
  locale: z.string().default('en-US'),
  brand: BrandSchema.default({}),
  // Toggle to require email-then-PIN signin instead of tap-your-name. Off
  // by default to preserve the existing USAV station UX.
  emailFirstSignin: z.boolean().default(false),
  // When true, every new staff invite must use a passkey (no PIN). For
  // customers with stricter device policies.
  requirePasskeyForNewStaff: z.boolean().default(false),
  // Hard cap on simultaneous active sessions per staff. 0 = unlimited.
  maxConcurrentSessions: z.number().int().min(0).default(0),
  // Per-station default folder for the receiving NAS photo picker. Keys are
  // station codes (TECH/PACK/UNBOX/SALES/FBA); values are a relative folder
  // path the picker auto-opens for an operator on that station (e.g.
  // "JUN 2026" or "2 Zendesk 2026/sub"). "" / missing = start at the root.
  // Admin-configured (see StationNasFoldersTab); resolved per-operator via
  // their primary station.
  stationNasPhotoFolders: z.record(z.string(), z.string()).default({}),
  // Receiving photos are written straight to the office NAS over WebDAV — the
  // browser PUTs to whichever base URL is `active`. Two slots so an admin can
  // keep a testing NAS and the production NAS configured and flip between them
  // without retyping. Values are the base URL of the (Cloudflare-fronted) NAS
  // file server, no trailing slash, e.g. "https://nas.usav.example". Admin-
  // configured (see StationNasFoldersTab); the active URL is surfaced to the
  // client via GET /api/nas-config.
  nasPhotoServers: z
    .object({
      test: z.string().default(''),
      prod: z.string().default(''),
      active: z.enum(['test', 'prod']).default('prod'),
    })
    .default({ test: '', prod: '', active: 'prod' }),
}).passthrough();

export type OrgSettings = z.infer<typeof OrgSettingsSchema>;

export function parseOrgSettings(raw: unknown): OrgSettings {
  // Tolerant parse: invalid persisted settings fall back to defaults rather
  // than crashing the request that needs them.
  const result = OrgSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : OrgSettingsSchema.parse({});
}

/**
 * The base URL the browser should write/read receiving photos against, picked
 * from whichever NAS slot (`test` | `prod`) the admin has marked active. Empty
 * string when nothing is configured. No trailing slash.
 */
export function getActiveNasBaseUrl(settings: OrgSettings): string {
  const servers = settings.nasPhotoServers;
  if (!servers) return '';
  const url = servers.active === 'test' ? servers.test : servers.prod;
  return (url || '').trim().replace(/\/+$/, '');
}

/**
 * Every configured NAS base URL (test + prod), used as the server-side origin
 * allowlist when accepting a `photoUrl` on /api/receiving-photos. No trailing
 * slashes; empties dropped.
 */
export function getAllNasBaseUrls(settings: OrgSettings): string[] {
  const servers = settings.nasPhotoServers;
  if (!servers) return [];
  return [servers.test, servers.prod]
    .map((u) => (u || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
