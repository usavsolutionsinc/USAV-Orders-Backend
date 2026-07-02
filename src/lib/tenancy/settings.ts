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

// Tenant letterhead — drives the company block on printed repair paper and
// walk-in receipts (src/lib/branding/letterhead.ts), distinct from the
// platform-fixed Cycle Forge branding in src/lib/branding/constants.ts.
const LetterheadSchema = z.object({
  addressLine1: z.string().max(120).default(''),
  addressLine2: z.string().max(120).default(''),
  phone: z.string().max(40).default(''),
  email: z.string().email().or(z.literal('')).default(''),
});

// Structured warehouse origin for outbound shipping labels (ship_from). Lives
// in the settings jsonb bag (no DDL); env SHIPSTATION_SHIP_FROM_* is the
// fallback. A rate/label needs a complete origin (line1 + city + state + zip).
const ShipFromSchema = z.object({
  name: z.string().max(80).default(''),
  company: z.string().max(80).default(''),
  phone: z.string().max(40).default(''),
  addressLine1: z.string().max(120).default(''),
  addressLine2: z.string().max(120).default(''),
  city: z.string().max(80).default(''),
  state: z.string().max(40).default(''),
  postalCode: z.string().max(20).default(''),
  country: z.string().max(2).default('US'),
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
  letterhead: LetterheadSchema.default({ addressLine1: '', addressLine2: '', phone: '', email: '' }),
  // Warehouse origin for outbound shipping labels (ShipStation ship_from).
  // Optional — falls back to SHIPSTATION_SHIP_FROM_* env when unset.
  shipFrom: ShipFromSchema.optional(),
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
  // Per-org fulfillment substitution policy — the ordered-vs-fulfilled deviation
  // flow (release the original allocation + allocate a substitute unit, recorded
  // in order_unit_amendments). Mirrors `packing` above.
  // substitutionEnforcement:
  //   'advisory' (default) — the substitution re-allocates immediately and the
  //     order can ship; the amendment is recorded APPLIED. Matches the repo's
  //     "never block the floor" philosophy.
  //   'block_until_approved' — the substitution is recorded PENDING and the
  //     order cannot pack/ship until a supervisor approves it (gate read by
  //     /api/pack/ship).
  // substitutionAllowedNodes: which station may RAISE a substitution. Default
  //   ['pick'] mirrors industry WMS (pick-exception); a tenant opens 'test' /
  //   'pack' from /studio. The route refuses a raise from a node not listed here.
  fulfillment: z
    .object({
      substitutionEnforcement: z.enum(['advisory', 'block_until_approved']).default('advisory'),
      substitutionAllowedNodes: z.array(z.enum(['pick', 'test', 'pack'])).default(['pick']),
    })
    .default({ substitutionEnforcement: 'advisory', substitutionAllowedNodes: ['pick'] }),
  // Per-org workflow-engine overrides (flag-gated, default empty). `verdictStatus`
  // maps a test verdict to the unit status + inventory-event it produces,
  // overriding the hardcoded VERDICT_TO_STATUS (src/lib/tech/recordTestVerdict.ts).
  // Read ONLY when UNIFIED_ENGINE_VERDICT_CONFIG is on; an unset verdict falls back
  // to the built-in. Values are constrained to the existing serial states / event
  // types so an override can never write an out-of-range status.
  workflow: z
    .object({
      verdictStatus: z
        .record(
          z.enum(['PASS', 'TEST_AGAIN', 'TESTING_FAILED']),
          z.object({
            nextStatus: z.enum(['TESTED', 'IN_TEST', 'ON_HOLD']),
            eventType: z.enum(['TEST_PASS', 'TEST_FAIL', 'TEST_START']),
          }),
        )
        .optional(),
    })
    .default({}),
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

/** Fulfillment-substitution policy for this org. See OrgSettingsSchema.fulfillment. */
export type SubstitutionEnforcement = OrgSettings['fulfillment']['substitutionEnforcement'];
export type SubstitutionNode = OrgSettings['fulfillment']['substitutionAllowedNodes'][number];

export function getSubstitutionEnforcement(settings: OrgSettings): SubstitutionEnforcement {
  return settings.fulfillment?.substitutionEnforcement ?? 'advisory';
}

export function getSubstitutionAllowedNodes(settings: OrgSettings): SubstitutionNode[] {
  return settings.fulfillment?.substitutionAllowedNodes ?? ['pick'];
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
