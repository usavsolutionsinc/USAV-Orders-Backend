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

const NasStorageTargetSchema = z.object({
  root: z.string().default(''),
  folder: z.string().default(''),
});

export const DEFAULT_NAS_STORAGE_TARGETS = {
  receiving: {
    root: '/Volumes/USAV Media/Puchasing photos/2026',
    folder: 'JUN 2026',
  },
  shipping: {
    root: '/Volumes/Shipping/2026',
    folder: 'Jun 2026',
  },
  claims: {
    root: '/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026',
    folder: '',
  },
} as const;

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
  // Warranty term (days) used by the Warranty Claim Logger clock. Per-org,
  // default 30. Resolved via src/lib/warranty/term.ts and snapshotted onto
  // warranty_claims.warranty_days at log time.
  warrantyDays: z.number().int().min(1).max(3650).default(30),
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
  // Workflow-specific NAS storage targets. `root` is the real mount/path used
  // by the office/NAS agent; `folder` is the active relative folder for that
  // workflow, typically the current month. Receiving still supports per-station
  // overrides through stationNasPhotoFolders.
  nasStorageTargets: z
    .object({
      receiving: NasStorageTargetSchema.default(DEFAULT_NAS_STORAGE_TARGETS.receiving),
      shipping: NasStorageTargetSchema.default(DEFAULT_NAS_STORAGE_TARGETS.shipping),
      claims: NasStorageTargetSchema.default(DEFAULT_NAS_STORAGE_TARGETS.claims),
    })
    .default(DEFAULT_NAS_STORAGE_TARGETS),
  // Per-org packing-checklist enforcement (the "box until matched" toggle).
  // 'advisory' (default) — the kit-parts pack checklist is informational; a
  //   discrepancy is surfaced but never blocks. Matches the repo's "QC never
  //   blocks" philosophy.
  // 'block_until_matched' — the packer is shown a hard blocker until every
  //   *critical* expected kit part is confirmed. GRACEFUL DEGRADATION is
  //   load-bearing: enforcement only bites when expected items are KNOWN (the
  //   SKU has critical sku_kit_parts rows). A SKU with no BOM ⇒ nothing to
  //   match ⇒ the pack proceeds regardless of the mode, so a tenant who hasn't
  //   populated its catalog can never brick its own packing by flipping this on.
  packing: z
    .object({
      enforcement: z.enum(['advisory', 'block_until_matched']).default('advisory'),
    })
    .default({ enforcement: 'advisory' }),
  // Per-org photo AI-analysis engine. Each org chooses which inference path runs
  // when a photo is enriched into photo_analysis (see src/lib/photos/analyze.ts):
  //   'local-vision' — the org's own RTX 5070 Ti vision box (LAN/Cloudflare-tunnel);
  //                    photos never leave the building. THE LOCAL-FIRST DEFAULT.
  //   'hermes'       — the self-hosted text gateway infers metadata from PO context.
  //   'gcp-vision'   — Google Cloud Vision (photos uploaded to Google).
  //   'catalog'      — no model; deterministic PO-derived metadata only.
  // `enabled` is the per-org master switch (the global PHOTOS_ANALYZE_ENABLED env is
  // the fallback when an org hasn't set one). `localVisionBaseUrl` is the
  // SERVER-reachable base URL of the org's vision box (the cron analyze job runs on
  // Vercel and can't reach the LAN, so this must be the Cloudflare-tunnel URL, not the
  // browser's LAN `NEXT_PUBLIC_VISION_BASE_URL`); empty falls back to the env default.
  // `provider`/`enabled` are intentionally OPTIONAL (no zod default) so a resolver can
  // tell "org explicitly chose X" from "unset → use env/local-first default".
  photoAnalysis: z
    .object({
      provider: z.enum(['hermes', 'gcp-vision', 'local-vision', 'catalog']).optional(),
      enabled: z.boolean().optional(),
      localVisionBaseUrl: z.string().default(''),
    })
    .default({ localVisionBaseUrl: '' }),
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

/** Packing-checklist enforcement mode for this org. See OrgSettingsSchema.packing. */
export type PackingEnforcement = OrgSettings['packing']['enforcement'];

export function getPackingEnforcement(settings: OrgSettings): PackingEnforcement {
  return settings.packing?.enforcement ?? 'advisory';
}

/** Per-org photo-analysis settings (see OrgSettingsSchema.photoAnalysis). */
export type PhotoAnalysisSettings = OrgSettings['photoAnalysis'];

export function getPhotoAnalysisSettings(settings: OrgSettings): PhotoAnalysisSettings {
  return settings.photoAnalysis ?? { localVisionBaseUrl: '' };
}

export type NasStorageTargetKey = keyof typeof DEFAULT_NAS_STORAGE_TARGETS;

export function getNasStorageTarget(
  settings: OrgSettings,
  key: NasStorageTargetKey,
): { root: string; folder: string } {
  const target = settings.nasStorageTargets?.[key] ?? DEFAULT_NAS_STORAGE_TARGETS[key];
  return {
    root: (target.root || '').trim().replace(/\/+$/, ''),
    folder: (target.folder || '').trim().replace(/^\/+|\/+$/g, ''),
  };
}
