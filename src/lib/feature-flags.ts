/**
 * Feature flags — inventory v2 rollout
 * ────────────────────────────────────────────────────────────────────
 * Each phase of the inventory rewrite (context/inventory_system_upgrade_plan.md)
 * lands behind one of these flags. Default OFF; flip on after the workflow
 * has been validated end-to-end against the new event/ledger pathway.
 *
 * All flags read from environment at request time so a redeploy can flip
 * them without code change. The truthy check accepts "true", "1", "on",
 * case-insensitive.
 */

function readBoolEnv(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

/**
 * Phase 2 — receiving putaway in one step.
 * When ON, mark-received emits inventory_events (RECEIVED + optional PUTAWAY)
 * and appends sku_stock_ledger rows for Tier 1/2 quantity in the same
 * transaction as the line update + serial_units upsert.
 */
export function isInventoryV2ReceivingPutaway(): boolean {
  return readBoolEnv('INVENTORY_V2_RECEIVING_PUTAWAY');
}

/** Phase 3 — tech station writes through serial_units + inventory_events. */
export function isInventoryV2TechLifecycle(): boolean {
  return readBoolEnv('INVENTORY_V2_TECH_LIFECYCLE');
}

/** Phase 4 — order allocation enabled (Zoho webhook auto-allocates). */
export function isInventoryV2Allocation(): boolean {
  return readBoolEnv('INVENTORY_V2_ALLOCATION');
}

/** Phase 5 — packer flow emits SHIPPED and decrements stock in one txn. */
export function isInventoryV2Packing(): boolean {
  return readBoolEnv('INVENTORY_V2_PACKING');
}

/** Phase 6 — FBA scans link specific serial_units to fba_shipment_items. */
export function isInventoryV2FbaSerialLink(): boolean {
  return readBoolEnv('INVENTORY_V2_FBA_SERIAL_LINK');
}

/** Phase 7 — returns intake + on-hold workflow. */
export function isInventoryV2Returns(): boolean {
  return readBoolEnv('INVENTORY_V2_RETURNS');
}

/** Snapshot of all inventory v2 flags. Useful for debug / admin pages. */
export function inventoryV2FlagSnapshot(): Record<string, boolean> {
  return {
    INVENTORY_V2_RECEIVING_PUTAWAY: isInventoryV2ReceivingPutaway(),
    INVENTORY_V2_TECH_LIFECYCLE: isInventoryV2TechLifecycle(),
    INVENTORY_V2_ALLOCATION: isInventoryV2Allocation(),
    INVENTORY_V2_PACKING: isInventoryV2Packing(),
    INVENTORY_V2_FBA_SERIAL_LINK: isInventoryV2FbaSerialLink(),
    INVENTORY_V2_RETURNS: isInventoryV2Returns(),
  };
}
