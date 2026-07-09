/**
 * Tenant letterhead — the company block rendered on printed repair paper,
 * walk-in receipts, and warehouse labels. Workspace-dynamic (per org.name +
 * settings.letterhead), never the platform Cycle Forge brand — see
 * src/lib/branding/constants.ts and docs/cycle-forge-branding-spec.md §3.
 */

import type { OrgSettings } from '@/lib/tenancy/settings';

export interface OrgLetterhead {
  /** Workspace display name — `organizations.name`. */
  name: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
}

export function getOrgLetterhead(org: { name: string; settings: OrgSettings }): OrgLetterhead {
  const letterhead = org.settings.letterhead;
  return {
    name: org.name,
    addressLine1: letterhead?.addressLine1 ?? '',
    addressLine2: letterhead?.addressLine2 ?? '',
    phone: letterhead?.phone ?? '',
    email: letterhead?.email ?? '',
  };
}

/** `{org.name} Warehouse Location` / `Warehouse Rack` — the warehouse label eyebrow. */
export function orgWarehouseLabel(orgName: string, suffix: 'Location' | 'Rack'): string {
  return `${orgName} Warehouse ${suffix}`;
}
