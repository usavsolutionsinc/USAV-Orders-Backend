/**
 * Rate/label request validation + the pure ShipmentSpec builder.
 *
 * The operator routes (/api/shipping/rates, /api/shipping/labels[…/void])
 * validate their bodies with these Zod schemas and assemble the engine's
 * normalized ShipmentSpec through `buildShipmentSpec` — a pure function so the
 * body→spec mapping (explicit ship-from wins, country upper-cased, empty
 * carrier filters dropped) is unit-testable with zero DB/network.
 *
 * Keep this file pure: no vault, no tenancy, no fetch — mirrors ./client.ts's
 * credential-injected discipline.
 */

import { z } from 'zod';
import type { Parcel, ShipAddress, ShipmentSpec } from './types';

export const ShipAddressSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().nullish(),
  company: z.string().nullish(),
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().nullish(),
  cityLocality: z.string().trim().min(1),
  stateProvince: z.string().trim().min(1),
  postalCode: z.string().trim().min(1),
  /** ISO-3166 alpha-2; normalized to upper-case in buildShipmentSpec. */
  countryCode: z.string().trim().length(2),
  residential: z.boolean().nullish(),
});

export const ParcelSchema = z.object({
  weight: z.object({
    value: z.number().positive(),
    unit: z.enum(['ounce', 'pound', 'gram', 'kilogram']),
  }),
  dimensions: z
    .object({
      length: z.number().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      unit: z.enum(['inch', 'centimeter']),
    })
    .nullish(),
});

/** POST /api/shipping/rates body. `shipFrom` omitted → the org's warehouse
 *  origin (resolveShipFrom) is used. */
export const RatesBodySchema = z.object({
  shipTo: ShipAddressSchema,
  shipFrom: ShipAddressSchema.nullish(),
  parcels: z.array(ParcelSchema).min(1),
  carrierIds: z.array(z.string().trim().min(1)).nullish(),
  confirmation: z.enum(['none', 'delivery', 'signature', 'adult_signature']).nullish(),
});
export type RatesBody = z.infer<typeof RatesBodySchema>;

/** POST /api/shipping/labels body — buy the exact quoted rate. */
export const PurchaseLabelBodySchema = z.object({
  rateId: z.string().trim().min(1),
  /** Idempotency key — a retry with the same id must not buy a second label. */
  clientEventId: z.string().trim().min(1).max(120),
  labelFormat: z.enum(['pdf', 'png', 'zpl']).optional(),
  labelLayout: z.enum(['4x6', 'letter']).optional(),
});
export type PurchaseLabelBody = z.infer<typeof PurchaseLabelBodySchema>;

/** POST /api/shipping/labels/void body. Voiding reverses a paid carrier
 *  action — LABEL_VOIDED is an AUDIT_REASON_REQUIRED action. */
export const VoidLabelBodySchema = z.object({
  labelId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export type VoidLabelBody = z.infer<typeof VoidLabelBodySchema>;

type AddressInput = z.infer<typeof ShipAddressSchema>;

function toShipAddress(a: AddressInput): ShipAddress {
  return {
    name: a.name,
    phone: a.phone ?? null,
    company: a.company ?? null,
    addressLine1: a.addressLine1,
    addressLine2: a.addressLine2 ?? null,
    cityLocality: a.cityLocality,
    stateProvince: a.stateProvince,
    postalCode: a.postalCode,
    countryCode: a.countryCode.toUpperCase(),
    residential: a.residential ?? null,
  };
}

function toParcel(p: z.infer<typeof ParcelSchema>): Parcel {
  return {
    weight: { value: p.weight.value, unit: p.weight.unit },
    dimensions: p.dimensions
      ? {
          length: p.dimensions.length,
          width: p.dimensions.width,
          height: p.dimensions.height,
          unit: p.dimensions.unit,
        }
      : null,
  };
}

/**
 * Build the engine's ShipmentSpec from a validated rates body.
 *
 * - An explicit `body.shipFrom` wins; otherwise `fallbackShipFrom` (the org's
 *   resolved warehouse origin) is used.
 * - Country codes are normalized to upper-case (the client sends them raw).
 * - An empty `carrierIds` array is dropped (= quote all connected carriers).
 */
export function buildShipmentSpec(body: RatesBody, fallbackShipFrom: ShipAddress): ShipmentSpec {
  const carrierIds = (body.carrierIds ?? []).filter((id) => id.trim().length > 0);
  return {
    shipTo: toShipAddress(body.shipTo),
    shipFrom: body.shipFrom ? toShipAddress(body.shipFrom) : fallbackShipFrom,
    parcels: body.parcels.map(toParcel),
    carrierIds: carrierIds.length > 0 ? carrierIds : undefined,
    confirmation: body.confirmation ?? undefined,
  };
}
