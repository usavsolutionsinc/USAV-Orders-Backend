import pool from '@/lib/db';
import type { PhotoEntityType } from './types';

/** Resolve po_ref denorm from the primary linked entity at upload time. */
export async function resolvePoRef(
  entityType: PhotoEntityType,
  entityId: number,
): Promise<string | null> {
  switch (entityType) {
    case 'RECEIVING': {
      const r = await pool.query<{ po: string | null }>(
        `SELECT COALESCE(
           NULLIF(TRIM(rl.zoho_purchaseorder_id), ''),
           NULLIF(TRIM(r.zoho_purchase_receive_id), ''),
           'PO_' || r.id::text
         ) AS po
         FROM receiving r
         LEFT JOIN receiving_lines rl ON rl.receiving_id = r.id
        WHERE r.id = $1
        ORDER BY rl.id ASC NULLS LAST
        LIMIT 1`,
        [entityId],
      );
      return r.rows[0]?.po ?? null;
    }
    case 'RECEIVING_LINE': {
      const r = await pool.query<{ po: string | null }>(
        `SELECT COALESCE(
           NULLIF(TRIM(rl.zoho_purchaseorder_id), ''),
           NULLIF(TRIM(r.zoho_purchase_receive_id), ''),
           'PO_' || r.id::text
         ) AS po
         FROM receiving_lines rl
         JOIN receiving r ON r.id = rl.receiving_id
        WHERE rl.id = $1 LIMIT 1`,
        [entityId],
      );
      return r.rows[0]?.po ?? null;
    }
    case 'PACKER_LOG': {
      const r = await pool.query<{ ref: string | null }>(
        `SELECT COALESCE(
           NULLIF(TRIM(order_id), ''),
           NULLIF(TRIM(scan_ref), ''),
           'PACK_' || id::text
         ) AS ref
         FROM packer_logs WHERE id = $1 LIMIT 1`,
        [entityId],
      );
      return r.rows[0]?.ref ?? null;
    }
    case 'SERIAL_UNIT': {
      const r = await pool.query<{ ref: string | null }>(
        `SELECT COALESCE(
           NULLIF(TRIM(unit_uid), ''),
           NULLIF(TRIM(sku), ''),
           'UNIT_' || id::text
         ) AS ref
         FROM serial_units WHERE id = $1 LIMIT 1`,
        [entityId],
      );
      return r.rows[0]?.ref ?? null;
    }
    default:
      return null;
  }
}
