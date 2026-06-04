/**
 * Real end-to-end test for the B1 triage-pile suggestion.
 *
 * Pulls real scanned PO-mailbox rows from the DB, fetches each email's live
 * body from Gmail, runs the ACTUAL extractWithLlm() against the Hermes
 * gateway, and prints the suggested pile + confidence alongside the other
 * extracted fields.
 *
 * Run with the tunnel URL overriding the local 127.0.0.1 placeholder:
 *   HERMES_API_URL='https://<tunnel-host>/v1' npx tsx scripts/_diag-triage-pile.mts
 *
 * Optional: pass row ids to target specific emails:
 *   HERMES_API_URL=... npx tsx scripts/_diag-triage-pile.mts 123 456
 */
import dotenv from 'dotenv';
// Neither call overrides vars already in process.env, so an inline
// HERMES_API_URL on the command line wins. .env.local takes precedence
// over .env, matching Next's runtime resolution.
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import pool from '@/lib/db';
import * as ELL from '@/lib/po-gmail/extract-llm';
import * as MSG from '@/lib/po-gmail/messages';

// tsx transpiles these TS modules to CJS; under an ESM entrypoint the named
// exports may land on `.default`. Resolve both shapes.
const extractWithLlm =
  (ELL as any).extractWithLlm ?? (ELL as any).default?.extractWithLlm;
const fetchMessage = (MSG as any).fetchMessage ?? (MSG as any).default?.fetchMessage;

async function main() {
  const hermes = String(process.env.HERMES_API_URL ?? '');
  const host = hermes ? new URL(hermes).host : '(unset)';
  console.log(`Hermes gateway: ${host}  ·  model: ${process.env.AI_MODEL ?? '(default)'}`);
  if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
    console.warn(
      '⚠️  HERMES_API_URL still points at localhost — the gateway is on the tunnel.\n' +
        "   Re-run with: HERMES_API_URL='https://<tunnel-host>/v1' npx tsx scripts/_diag-triage-pile.mts",
    );
    await pool.end();
    return;
  }

  const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  const where = ids.length
    ? `WHERE id = ANY($1::int[])`
    : `WHERE gmail_msg_id IS NOT NULL AND pile = 'inbox'`;
  const params = ids.length ? [ids.map(Number)] : [];

  const { rows } = await pool.query(
    `SELECT id, gmail_msg_id, email_subject, email_from, po_numbers, pile
       FROM email_missing_purchase_orders
       ${where}
      ORDER BY scanned_at DESC
      LIMIT ${ids.length ? ids.length : 5}`,
    params,
  );

  if (!rows.length) {
    console.log('No matching scanned rows found.');
    await pool.end();
    return;
  }
  console.log(`Testing ${rows.length} real email(s)\n${'='.repeat(60)}`);

  for (const row of rows) {
    console.log(`\n# row ${row.id}  ·  current pile: ${row.pile}`);
    console.log(`  subject: ${row.email_subject ?? '(none)'}`);
    console.log(`  from:    ${row.email_from ?? '(none)'}`);
    try {
      const env = await fetchMessage(row.gmail_msg_id);
      const t0 = Date.now();
      const llm = await extractWithLlm({
        subject: row.email_subject ?? env.subject,
        from: row.email_from ?? env.from,
        bodyText: env.bodyText,
        knownPoNumbers: row.po_numbers,
      });
      const ms = Date.now() - t0;
      const pile = llm.fields?.triage_pile;
      console.log(
        `  → SUGGESTED PILE: ${pile ? `${pile.value} (${pile.confidence})` : '⟨none returned⟩'}   [${ms}ms, ${llm.model}]`,
      );
      const f = llm.fields ?? {};
      const show = (k: string) =>
        f[k] ? `${k}=${JSON.stringify(f[k].value)}(${f[k].confidence})` : null;
      const fields = ['vendor', 'po_date', 'total', 'line_items_count']
        .map(show)
        .filter(Boolean)
        .join('  ');
      if (fields) console.log(`    fields: ${fields}`);
    } catch (err) {
      console.log(`  ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
