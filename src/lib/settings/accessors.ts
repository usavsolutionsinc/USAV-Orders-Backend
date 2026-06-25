/**
 * Settings Registry — typed server-side accessors for ORG-scope settings.
 *
 * Domain code reads org policy through these thin getters (same convention as
 * getPackingEnforcement / getActiveNasBaseUrl in ../tenancy/settings.ts): a
 * fully-typed value with the registry default baked in. Keep each accessor's key
 * + default in sync with its registry row.
 *
 * NOTE: these return the CONFIGURED value and do not apply the plan-entitlement
 * gate. A caller that reads a plan-gated setting (nasBackup `direct`, the
 * vision.* knobs) must also check `hasFeature(orgId, …)` before acting on a
 * gated value — see the resolver (./resolve.ts) which the API uses for UI.
 */

import type { OrgSettings } from '@/lib/tenancy/settings';

function readOrg<T extends string | number | boolean>(
  s: OrgSettings,
  key: string,
  fallback: T,
): T {
  const v = (s as unknown as Record<string, unknown>)[key];
  return v === undefined || v === null ? fallback : (v as T);
}

export type ReceivingPhotoPolicy = 'optional' | 'require_one' | 'require_per_item';
export const getReceivingPhotoPolicy = (s: OrgSettings): ReceivingPhotoPolicy =>
  readOrg<ReceivingPhotoPolicy>(s, 'receiving.photoPolicy', 'optional');

export type ReceivingNasBackup = 'off' | 'mirror' | 'direct';
export const getReceivingNasBackup = (s: OrgSettings): ReceivingNasBackup =>
  readOrg<ReceivingNasBackup>(s, 'receiving.nasBackup', 'mirror');

export type ReceivingAutoTicket = 'off' | 'on_qa_fail' | 'on_unfound';
export const getReceivingAutoTicket = (s: OrgSettings): ReceivingAutoTicket =>
  readOrg<ReceivingAutoTicket>(s, 'receiving.autoTicket', 'off');

/** Default putaway bin barcode. Falls back to the legacy env value then UNSORTED. */
export const getReceivingDefaultPutawayBin = (s: OrgSettings, envFallback?: string): string => {
  const env = (envFallback ?? '').trim();
  return readOrg<string>(s, 'receiving.defaultPutawayBin', env || 'UNSORTED');
};

export const getReceivingAutoPrintLabel = (s: OrgSettings): boolean =>
  readOrg<boolean>(s, 'receiving.autoPrintLabel', false);

export const getReceivingConfirmSerialRemoval = (s: OrgSettings): boolean =>
  readOrg<boolean>(s, 'receiving.confirmSerialRemoval', true);

export const getReceivingVisionConsensus = (s: OrgSettings): number =>
  readOrg<number>(s, 'receiving.vision.consensusNeeded', 2);

export const getReceivingVisionScanInterval = (s: OrgSettings): number =>
  readOrg<number>(s, 'receiving.vision.scanIntervalMs', 280);

export const getReceivingVisionSendMaxDim = (s: OrgSettings): number =>
  readOrg<number>(s, 'receiving.vision.sendMaxDim', 1600);
