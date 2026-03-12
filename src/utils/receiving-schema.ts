import pool from '@/lib/db';

export async function resolveReceivingSchema() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'receiving'
       AND column_name = 'quantity'`
  );

  const columnNames = new Set<string>(result.rows.map((r: any) => String(r.column_name)));

  return {
    dateColumn: 'created_at' as const,
    hasQuantity: columnNames.has('quantity'),
  };
}

