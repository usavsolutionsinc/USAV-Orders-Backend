/**
 * ShipStation tenant config — the only file that couples the ShipStation clients
 * to the vault + tenant layer. Resolves per-org credentials (v2 label engine +
 * optional v1 order pull) and the warehouse ship-from origin, and hands back
 * bound clients. Keeps ./client and ./orders-v1 pure/injectable.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { getIntegrationCredentials, type ShipStationCredentials } from '@/lib/integrations/credentials';
import { getOrganization } from '@/lib/tenancy/organizations';
import { createShipStationV2Client, type ShipStationV2Client } from './client';
import { createShipStationV1Client, type ShipStationV1Client } from './orders-v1';
import type { ShipAddress } from './types';

export class ShipStationNotConnectedError extends Error {
  constructor(message = 'ShipStation is not connected for this organization.') {
    super(message);
    this.name = 'ShipStationNotConnectedError';
  }
}

export class ShipFromNotConfiguredError extends Error {
  constructor(
    message = 'No warehouse ship-from address is configured. Set it under Settings → Shipping or the SHIPSTATION_SHIP_FROM_* env vars.',
  ) {
    super(message);
    this.name = 'ShipFromNotConfiguredError';
  }
}

export async function resolveShipStationCreds(orgId: OrgId): Promise<ShipStationCredentials | null> {
  return getIntegrationCredentials<ShipStationCredentials>(orgId, 'shipstation');
}

export async function isShipStationConnected(orgId: OrgId): Promise<boolean> {
  const creds = await resolveShipStationCreds(orgId);
  return Boolean(creds?.apiKey);
}

/** The v2 label engine (rates/labels/void). Throws NotConnected if no v2 key. */
export async function getShipStationV2(orgId: OrgId): Promise<ShipStationV2Client> {
  const creds = await resolveShipStationCreds(orgId);
  if (!creds?.apiKey) throw new ShipStationNotConnectedError();
  return createShipStationV2Client(creds.apiKey);
}

/** The legacy v1 order client — null when the v1 key/secret aren't configured
 *  (order pull + stored-weight lookup are optional on top of the v2 engine). */
export async function getShipStationV1(orgId: OrgId): Promise<ShipStationV1Client | null> {
  const creds = await resolveShipStationCreds(orgId);
  if (!creds?.v1ApiKey || !creds?.v1ApiSecret) return null;
  return createShipStationV1Client(creds.v1ApiKey, creds.v1ApiSecret);
}

type ShipFromSettings = {
  name?: string;
  company?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

function shipFromFromSettings(sf: ShipFromSettings | undefined, orgName?: string): ShipAddress | null {
  if (!sf || !sf.addressLine1 || !sf.city || !sf.state || !sf.postalCode) return null;
  return {
    name: sf.name || orgName || 'Warehouse',
    company: sf.company || null,
    phone: sf.phone || null,
    addressLine1: sf.addressLine1,
    addressLine2: sf.addressLine2 || null,
    cityLocality: sf.city,
    stateProvince: sf.state,
    postalCode: sf.postalCode,
    countryCode: (sf.country || 'US').toUpperCase(),
    residential: false,
  };
}

function shipFromFromEnv(orgName?: string): ShipAddress | null {
  const addressLine1 = process.env.SHIPSTATION_SHIP_FROM_ADDRESS1;
  const city = process.env.SHIPSTATION_SHIP_FROM_CITY;
  const state = process.env.SHIPSTATION_SHIP_FROM_STATE;
  const postalCode = process.env.SHIPSTATION_SHIP_FROM_POSTAL;
  if (!addressLine1 || !city || !state || !postalCode) return null;
  return {
    name: process.env.SHIPSTATION_SHIP_FROM_NAME || orgName || 'Warehouse',
    company: process.env.SHIPSTATION_SHIP_FROM_COMPANY || null,
    phone: process.env.SHIPSTATION_SHIP_FROM_PHONE || null,
    addressLine1,
    addressLine2: process.env.SHIPSTATION_SHIP_FROM_ADDRESS2 || null,
    cityLocality: city,
    stateProvince: state,
    postalCode,
    countryCode: (process.env.SHIPSTATION_SHIP_FROM_COUNTRY || 'US').toUpperCase(),
    residential: false,
  };
}

/** The warehouse origin for a rate/label. Prefers the org's structured
 *  Settings → shipFrom; falls back to SHIPSTATION_SHIP_FROM_* env. */
export async function resolveShipFrom(orgId: OrgId): Promise<ShipAddress> {
  const org = await getOrganization(orgId);
  const fromSettings = shipFromFromSettings(org?.settings.shipFrom, org?.name);
  if (fromSettings) return fromSettings;
  const fromEnv = shipFromFromEnv(org?.name);
  if (fromEnv) return fromEnv;
  throw new ShipFromNotConfiguredError();
}
