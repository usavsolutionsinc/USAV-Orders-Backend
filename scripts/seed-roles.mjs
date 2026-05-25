#!/usr/bin/env node
/**
 * Seed the 8 system roles into the `roles` table using the current static
 * matrix from src/lib/auth/permissions-shared.ts as the initial permission
 * set. Then back-fill `staff_roles` from the existing `staff.role` column
 * so every staff has at least one role assignment.
 *
 * Idempotent:
 *   - INSERT ... ON CONFLICT (key) DO NOTHING for roles.
 *   - INSERT ... ON CONFLICT (staff_id, role_id) DO NOTHING for staff_roles.
 *
 * Running this twice is safe and produces the same end state.
 */

import 'dotenv/config';
import pg from 'pg';

// Mirrors src/lib/auth/permissions-shared.ts:ROLE_PERMISSION_SETS exactly.
// Keep these in sync — when permission strings change, this file must
// update too, or the seed will drop unknown strings silently. Admin gets
// the union of all role permissions + admin-only ones (see ADMIN_ONLY).
const ROLE_PERMISSION_SETS = {
  receiver: [
    'receiving.view', 'receiving.scan_po', 'receiving.mark_received',
    'receiving.upload_photo', 'receiving.bin_assign',
    'sku_stock.view', 'bin.adjust', 'bin.set', 'bin.add_sku',
    'walk_in.view', 'print.label', 'work_orders.view', 'work_orders.claim',
    'work_orders.complete',
  ],
  packer: [
    'packing.view', 'packing.start_session', 'packing.scan_order',
    'packing.print_label', 'packing.complete_order',
    'sku_stock.view', 'bin.adjust', 'bin.set', 'bin.add_sku',
    'print.label', 'work_orders.view', 'work_orders.claim', 'work_orders.complete',
    'dashboard.view',
  ],
  technician: [
    'tech.view', 'tech.scan_serial', 'tech.qc_pass', 'tech.qc_fail', 'tech.assign_bin',
    'serial_units.grade',
    'repair.view', 'repair.intake', 'repair.mark_repaired',
    'sku_stock.view', 'bin.adjust', 'bin.set', 'bin.add_sku',
    'print.label', 'work_orders.view', 'work_orders.claim', 'work_orders.complete',
  ],
  shipper: [
    'shipping.view', 'shipping.mark_shipped', 'shipping.void_order',
    'orders.view', 'dashboard.view', 'print.label',
  ],
  inventory_manager: [
    'sku_stock.view', 'sku_stock.adjust', 'sku_stock.manage',
    'bin.adjust', 'bin.set', 'bin.rename', 'bin.swap', 'bin.remove', 'bin.add_sku',
    'cycle_count.view', 'cycle_count.approve',
    'replenish.view', 'replenish.create_po', 'replenish.approve_po',
    'fba.view', 'reports.view', 'operations.view',
    'stock_alerts.ack',
    'admin.view_logs',
  ],
  sales: [
    'dashboard.view', 'orders.view', 'orders.create', 'orders.import',
    'walk_in.view', 'walk_in.intake',
    'sku_stock.view', 'repair.view', 'reports.view',
  ],
  viewer: [
    'dashboard.view', 'operations.view', 'receiving.view', 'packing.view',
    'tech.view', 'shipping.view', 'fba.view', 'sku_stock.view',
    'cycle_count.view', 'replenish.view', 'work_orders.view',
    'walk_in.view', 'repair.view', 'orders.view', 'reports.view',
  ],
};

const ADMIN_ONLY = [
  'admin.view', 'admin.manage_staff', 'admin.manage_roles',
  'admin.manage_features', 'admin.view_logs', 'admin.view_sessions',
  'settings.workstation', 'settings.hardware',
  'integrations.zoho', 'integrations.ebay', 'integrations.ecwid',
  'fba.manage_fnskus', 'fba.stage_shipments',
  'reports.export', 'print.silent',
];

const ADMIN_PERMISSIONS = (() => {
  const set = new Set();
  for (const perms of Object.values(ROLE_PERMISSION_SETS)) for (const p of perms) set.add(p);
  for (const p of ADMIN_ONLY) set.add(p);
  return Array.from(set);
})();

// Theme-color matched to staff-colors.ts so existing avatars stay coherent.
const SEED = [
  { key: 'admin',             label: 'Admin',             color: '#1f2937', position: 1,  permissions: ADMIN_PERMISSIONS },
  { key: 'receiver',          label: 'Receiver',          color: '#0ea5e9', position: 10, permissions: ROLE_PERMISSION_SETS.receiver },
  { key: 'packer',            label: 'Packer',            color: '#1f2937', position: 20, permissions: ROLE_PERMISSION_SETS.packer },
  { key: 'technician',        label: 'Technician',        color: '#10b981', position: 30, permissions: ROLE_PERMISSION_SETS.technician },
  { key: 'shipper',           label: 'Shipper',           color: '#ef4444', position: 40, permissions: ROLE_PERMISSION_SETS.shipper },
  { key: 'inventory_manager', label: 'Inventory Manager', color: '#a855f7', position: 50, permissions: ROLE_PERMISSION_SETS.inventory_manager },
  { key: 'sales',             label: 'Sales',             color: '#ec4899', position: 60, permissions: ROLE_PERMISSION_SETS.sales },
  { key: 'viewer',            label: 'Viewer',            color: '#6b7280', position: 70, permissions: ROLE_PERMISSION_SETS.viewer },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // 1. Upsert system roles.
    for (const r of SEED) {
      await client.query(
        `INSERT INTO roles (key, label, color, position, permissions, is_system)
         VALUES ($1, $2, $3, $4, $5::TEXT[], TRUE)
         ON CONFLICT (key) DO UPDATE SET
           -- Only refresh the metadata (label/color/position). Permissions are
           -- not overwritten on re-seed so admin edits aren't blown away.
           label = EXCLUDED.label,
           color = EXCLUDED.color,
           position = EXCLUDED.position,
           is_system = TRUE,
           updated_at = NOW()`,
        [r.key, r.label, r.color, r.position, r.permissions],
      );
    }
    console.log(`✓ Seeded ${SEED.length} system roles`);

    // 2. Back-fill staff_roles from staff.role for any staff missing an
    //    assignment. Aliases (`receiving` → `receiver`, `readonly` → `viewer`)
    //    are resolved here so legacy rows map cleanly.
    const backfill = await client.query(`
      WITH role_map AS (
        SELECT id, key FROM roles
      ),
      canonical AS (
        SELECT
          s.id AS staff_id,
          CASE LOWER(COALESCE(s.role, 'viewer'))
            WHEN 'receiving' THEN 'receiver'
            WHEN 'readonly'  THEN 'viewer'
            ELSE LOWER(COALESCE(s.role, 'viewer'))
          END AS role_key
        FROM staff s
        WHERE COALESCE(s.active, TRUE) = TRUE
      )
      INSERT INTO staff_roles (staff_id, role_id, granted_at, granted_by)
      SELECT c.staff_id, rm.id, NOW(), NULL
        FROM canonical c
        JOIN role_map rm ON rm.key = c.role_key
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_roles sr WHERE sr.staff_id = c.staff_id
       )
      ON CONFLICT (staff_id, role_id) DO NOTHING
      RETURNING staff_id
    `);
    console.log(`✓ Back-filled staff_roles for ${backfill.rowCount} staff`);

    // 3. Sanity check.
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM roles)              AS total_roles,
        (SELECT COUNT(*) FROM roles WHERE is_system) AS system_roles,
        (SELECT COUNT(*) FROM staff_roles)        AS assignments,
        (SELECT COUNT(DISTINCT staff_id) FROM staff_roles) AS staff_with_role
    `);
    console.table(counts.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
