/**
 * Per-org warranty term resolution. The term lives in organizations.settings
 * (`warrantyDays`, policed by src/lib/tenancy/settings.ts) and defaults to 30.
 * Kept out of clock.ts so that module stays pure/isomorphic.
 */

import pool from '@/lib/db';
import { parseOrgSettings } from '@/lib/tenancy/settings';
import { DEFAULT_WARRANTY_DAYS } from './clock';

export async function resolveWarrantyDays(organizationId: string | null | undefined): Promise<number> {
  if (!organizationId) return DEFAULT_WARRANTY_DAYS;
  try {
    const { rows } = await pool.query<{ settings: unknown }>(
      `SELECT settings FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId],
    );
    if (rows.length === 0) return DEFAULT_WARRANTY_DAYS;
    const settings = parseOrgSettings(rows[0].settings) as { warrantyDays?: unknown };
    const days = settings.warrantyDays;
    return typeof days === 'number' && Number.isFinite(days) && days > 0
      ? Math.floor(days)
      : DEFAULT_WARRANTY_DAYS;
  } catch {
    return DEFAULT_WARRANTY_DAYS;
  }
}
