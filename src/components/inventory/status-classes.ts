/**
 * Inventory unit-status colors now live in the shared canonical module
 * `@/lib/unit-status` (so inventory and the labels views stay in sync).
 * These aliases preserve the existing inventory import names.
 */
export {
    unitStatusBadgeClass as inventoryStatusBadgeClass,
    unitStatusChipClass as inventoryStatusChipClass,
} from '@/lib/unit-status';
