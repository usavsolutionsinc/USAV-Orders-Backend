import pool from '../db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface CustomerRecord {
  id: number;
  customer_name: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  contact_type: string | null;
  entity_type: string | null;
  entity_id: number | null;
}

export interface CustomerLookupRecord {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  updated_at: string | null;
}

/**
 * Find a customer by phone number.
 */
export async function findCustomerByPhone(phone: string, orgId?: OrgId): Promise<CustomerRecord | null> {
  if (orgId) {
    const result = await tenantQuery<CustomerRecord>(
      orgId,
      `SELECT id, customer_name, display_name, first_name, last_name, email, phone,
              contact_type, entity_type, entity_id
       FROM customers
       WHERE phone = $1 AND organization_id = $2
       LIMIT 1`,
      [phone, orgId],
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  }
  const result = await pool.query(
    `SELECT id, customer_name, display_name, first_name, last_name, email, phone,
            contact_type, entity_type, entity_id
     FROM customers
     WHERE phone = $1
     LIMIT 1`,
    [phone],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Find a customer by name (customer_name or display_name).
 */
export async function findCustomerByName(name: string, orgId?: OrgId): Promise<CustomerRecord | null> {
  if (orgId) {
    const result = await tenantQuery<CustomerRecord>(
      orgId,
      `SELECT id, customer_name, display_name, first_name, last_name, email, phone,
              contact_type, entity_type, entity_id
       FROM customers
       WHERE (customer_name = $1 OR display_name = $1) AND organization_id = $2
       LIMIT 1`,
      [name, orgId],
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  }
  const result = await pool.query(
    `SELECT id, customer_name, display_name, first_name, last_name, email, phone,
            contact_type, entity_type, entity_id
     FROM customers
     WHERE customer_name = $1 OR display_name = $1
     LIMIT 1`,
    [name],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a customer linked to a repair service entity.
 */
export async function createRepairCustomer(params: {
  name: string;
  phone: string;
  email?: string;
  repairId?: number;
}, orgId?: OrgId): Promise<CustomerRecord> {
  const parts = params.name.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const result = await client.query<CustomerRecord>(
        `INSERT INTO customers (
          customer_name, display_name, first_name, last_name,
          phone, email, contact_type, entity_type, entity_id,
          organization_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'repair_customer', $7, $8, $9, NOW(), NOW())
        RETURNING id, customer_name, display_name, first_name, last_name, email, phone,
                  contact_type, entity_type, entity_id`,
        [
          params.name,
          params.name,
          firstName,
          lastName,
          params.phone || null,
          params.email || null,
          params.repairId ? 'REPAIR' : null,
          params.repairId ?? null,
          orgId,
        ],
      );
      return result.rows[0];
    });
  }

  const result = await pool.query(
    `INSERT INTO customers (
      customer_name, display_name, first_name, last_name,
      phone, email, contact_type, entity_type, entity_id,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'repair_customer', $7, $8, NOW(), NOW())
    RETURNING id, customer_name, display_name, first_name, last_name, email, phone,
              contact_type, entity_type, entity_id`,
    [
      params.name,
      params.name,
      firstName,
      lastName,
      params.phone || null,
      params.email || null,
      params.repairId ? 'REPAIR' : null,
      params.repairId ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update customer entity_id after repair is created.
 */
export async function linkCustomerToRepair(customerId: number, repairId: number, orgId?: OrgId): Promise<void> {
  if (orgId) {
    await withTenantTransaction(orgId, async (client) => {
      await client.query(
        `UPDATE customers
         SET entity_type = 'REPAIR', entity_id = $1, updated_at = NOW()
         WHERE id = $2 AND entity_id IS NULL AND organization_id = $3`,
        [repairId, customerId, orgId],
      );
    });
    return;
  }
  await pool.query(
    `UPDATE customers
     SET entity_type = 'REPAIR', entity_id = $1, updated_at = NOW()
     WHERE id = $2 AND entity_id IS NULL`,
    [repairId, customerId],
  );
}

/**
 * Find or create a customer for a repair intake.
 * Matches by phone first, then by name. Creates if not found.
 */
export async function findOrCreateRepairCustomer(params: {
  name: string;
  phone: string;
  email?: string;
}, orgId?: OrgId): Promise<CustomerRecord> {
  // Try phone match first
  if (params.phone) {
    const byPhone = await findCustomerByPhone(params.phone, orgId);
    if (byPhone) return byPhone;
  }

  // Try name match
  if (params.name) {
    const byName = await findCustomerByName(params.name, orgId);
    if (byName) return byName;
  }

  // Create new
  return createRepairCustomer(params, orgId);
}

/**
 * Lookup customers for repair intake "add existing customer".
 * If query is blank, returns most recently updated customers.
 */
export async function searchRepairCustomers(query: string, limit = 20, orgId?: OrgId): Promise<CustomerLookupRecord[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Number(limit))) : 20;
  const normalized = String(query || '').trim();

  const result = orgId
    ? normalized
      ? await tenantQuery(
          orgId,
          `SELECT
             id,
             COALESCE(NULLIF(display_name, ''), NULLIF(customer_name, ''), CONCAT_WS(' ', NULLIF(first_name, ''), NULLIF(last_name, '')), 'Unknown') AS name,
             NULLIF(phone, '') AS phone,
             NULLIF(email, '') AS email,
             updated_at::text AS updated_at
           FROM customers
           WHERE
             organization_id = $3
             AND (
               COALESCE(display_name, '') ILIKE $1
               OR COALESCE(customer_name, '') ILIKE $1
               OR COALESCE(first_name, '') ILIKE $1
               OR COALESCE(last_name, '') ILIKE $1
               OR COALESCE(phone, '') ILIKE $1
               OR COALESCE(email, '') ILIKE $1
             )
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT $2`,
          [`%${normalized}%`, safeLimit, orgId],
        )
      : await tenantQuery(
          orgId,
          `SELECT
             id,
             COALESCE(NULLIF(display_name, ''), NULLIF(customer_name, ''), CONCAT_WS(' ', NULLIF(first_name, ''), NULLIF(last_name, '')), 'Unknown') AS name,
             NULLIF(phone, '') AS phone,
             NULLIF(email, '') AS email,
             updated_at::text AS updated_at
           FROM customers
           WHERE organization_id = $2
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT $1`,
          [safeLimit, orgId],
        )
    : normalized
    ? await pool.query(
        `SELECT
           id,
           COALESCE(NULLIF(display_name, ''), NULLIF(customer_name, ''), CONCAT_WS(' ', NULLIF(first_name, ''), NULLIF(last_name, '')), 'Unknown') AS name,
           NULLIF(phone, '') AS phone,
           NULLIF(email, '') AS email,
           updated_at::text AS updated_at
         FROM customers
         WHERE
           COALESCE(display_name, '') ILIKE $1
           OR COALESCE(customer_name, '') ILIKE $1
           OR COALESCE(first_name, '') ILIKE $1
           OR COALESCE(last_name, '') ILIKE $1
           OR COALESCE(phone, '') ILIKE $1
           OR COALESCE(email, '') ILIKE $1
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT $2`,
        [`%${normalized}%`, safeLimit],
      )
    : await pool.query(
        `SELECT
           id,
           COALESCE(NULLIF(display_name, ''), NULLIF(customer_name, ''), CONCAT_WS(' ', NULLIF(first_name, ''), NULLIF(last_name, '')), 'Unknown') AS name,
           NULLIF(phone, '') AS phone,
           NULLIF(email, '') AS email,
           updated_at::text AS updated_at
         FROM customers
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT $1`,
        [safeLimit],
      );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || 'Unknown'),
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  }));
}
