#!/usr/bin/env node
import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const dist = await pool.query(
    `SELECT COALESCE(workflow_status::text, '(null)') AS status, COUNT(*)::int AS n
       FROM receiving_lines
      GROUP BY 1
      ORDER BY n DESC`,
  );
  console.log('workflow_status distribution:');
  for (const r of dist.rows) console.log(`  ${r.status.padEnd(20)} ${r.n}`);

  const recent = await pool.query(
    `SELECT workflow_status::text AS status, COUNT(*)::int AS n
       FROM receiving_lines
      WHERE created_at > NOW() - INTERVAL '14 days'
      GROUP BY 1
      ORDER BY n DESC`,
  );
  console.log('\nLast 14d workflow_status distribution:');
  for (const r of recent.rows) console.log(`  ${String(r.status || '(null)').padEnd(20)} ${r.n}`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
