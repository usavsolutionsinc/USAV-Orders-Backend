/**
 * Inventory v2 repositories — barrel export.
 *
 * Scaffolded in Phase 0 (2026-05-17) per
 * context/inventory_system_upgrade_plan.md. Reads are wired up; writes
 * are minimal foundations (upsertSerialUnit, appendInventoryEvent,
 * appendLedgerRow, allocate/advanceState/release, recordChange).
 *
 * Existing routes have not been migrated to these helpers yet — that
 * lands in Phase 2 (receiving putaway) through Phase 5 (packing SHIPPED
 * transaction). New routes should prefer these over raw SQL.
 */
export * as serialUnitsRepo from './serialUnits';
export * as inventoryEventsRepo from './inventoryEvents';
export * as stockLedgerRepo from './stockLedger';
export * as locationsRepo from './locations';
export * as allocationsRepo from './allocations';
export * as conditionHistoryRepo from './conditionHistory';
