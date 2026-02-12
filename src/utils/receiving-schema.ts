import pool from '@/lib/db';

type ReceivingDateColumn = 'receiving_date_time' | 'date_time';

export async function resolveReceivingSchema() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'receiving'
       AND column_name IN ('receiving_date_time', 'date_time', 'quantity')`
  );

  const columnNames = new Set<string>(result.rows.map((r: any) => String(r.column_name)));
  const dateColumn: ReceivingDateColumn = columnNames.has('receiving_date_time')
    ? 'receiving_date_time'
    : 'date_time';

  return {
    dateColumn,
    hasQuantity: columnNames.has('quantity')
  };
}

