/**
 * Per-org Universal Incoming settings resolver (plan §9.6).
 *
 * Reads `organizations.settings.inbound` (schema + defaults policed by
 * src/lib/tenancy/settings.ts — the SoT for that jsonb bag) and exposes the
 * tenant's inbound policy: post-merge display source, the Zoho PO fields that
 * carry an eBay order#, which signals may auto-merge, whether a fuzzy match needs
 * review, and which inbound sources are enabled. The Studio publish gate validates
 * bound sources ⊆ `enabledSources`; the merge/matcher read the rest.
 *
 * Deps-injected `query` (default pool.query) so tests run DB-free. Tolerant: a
 * missing org / unparseable settings falls back to the schema defaults rather
 * than throwing (mirrors resolveWarrantyDays).
 */

import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { parseOrgSettings, getInboundSettings, type InboundOrgSettings } from '@/lib/tenancy/settings';
import { isRegisteredInboundSource } from './source-registry';

export type { InboundOrgSettings };

export interface InboundSettingsDeps {
  query: <T>(sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: T[] }>;
}

const defaultDeps: InboundSettingsDeps = {
  query: (sql, params) => pool.query(sql, params as unknown[]) as unknown as Promise<{ rows: never[] }>,
};

/** Resolve the org's inbound policy (schema defaults when unset/invalid). */
export async function resolveInboundSettings(
  orgId: OrgId | null | undefined,
  deps: InboundSettingsDeps = defaultDeps,
): Promise<InboundOrgSettings> {
  if (!orgId) return getInboundSettings(parseOrgSettings({}));
  try {
    const { rows } = await deps.query<{ settings: unknown }>(
      `SELECT settings FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId],
    );
    return getInboundSettings(parseOrgSettings(rows[0]?.settings ?? {}));
  } catch {
    return getInboundSettings(parseOrgSettings({}));
  }
}

/**
 * True when `source` is BOTH a registered inbound source AND enabled for this
 * org. Unknown/registry-absent sources are never enabled (fail-closed).
 */
export function isInboundSourceEnabled(settings: InboundOrgSettings, source: string): boolean {
  const s = source.trim().toLowerCase();
  return isRegisteredInboundSource(s) && settings.enabledSources.map((x) => x.toLowerCase()).includes(s);
}
