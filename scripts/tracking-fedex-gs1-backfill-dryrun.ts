/**
 * tracking-fedex-gs1-backfill-dryrun.ts
 * ─────────────────────────────────────────────────────────────────
 * READ-ONLY dry-run report for the §3.3 FedEx-GS1-only STN re-normalization
 * (docs/new-additions/tracking-canonicalization-stn-plan.md).
 *
 * It answers, against LIVE data, the questions the plan says must be settled
 * BEFORE any backfill migration is authored or applied:
 *
 *   1. How many STN rows would the HARDENED normalizer rewrite? (expected ~228,
 *      all FedEx — never USPS.)
 *   2. Of those, which are a safe RENAME (no existing row owns the canonical
 *      human number) vs a MERGE (a human-number row already exists → keep the
 *      oldest id, re-point FK referrers, union events, delete the dup)?
 *   3. What is the FK fan-out on each merge LOSER — i.e. every table.column that
 *      references shipping_tracking_numbers(id) and how many rows point at a
 *      row that would be deleted? (discovered dynamically from pg_constraint).
 *   4. The 12-vs-15 split — how many collapse to a 12-digit Express number vs a
 *      15-digit Ground number (the plan wants Ground's 15-digit human form spot-
 *      checked against real labels before trusting the merge).
 *   5. A hard assertion that ZERO candidate rows are USPS — proves the §3.1
 *      anchor (`^96\d{31,32}$`) holds in production, not just in tests.
 *
 * STRICTLY read-only: issues only SELECTs, opens no transaction, writes nothing.
 * Run:  npx tsx --env-file=.env scripts/tracking-fedex-gs1-backfill-dryrun.ts
 */
import { Pool } from 'pg';
import {
  extractCanonicalTracking,
  stripFedexConcatPrefix,
  detectCarrier,
} from '@/lib/tracking-format';

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL (or DATABASE_URL_UNPOOLED) required');
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });

// The exact envelope the hardened stripFedexConcatPrefix acts on. Kept in the
// SQL as a Postgres regex so the candidate set is computed server-side; the JS
// stripFedexConcatPrefix then independently confirms each one collapses.
const ENVELOPE_SQL_REGEX = '^96[0-9]{31,32}$';

interface StnRow {
  id: number;
  tracking_number_raw: string;
  tracking_number_normalized: string;
  carrier: string;
  created_at: string | null;
}

interface FkRef {
  table: string;
  column: string;
}

/** Every table.column with a FOREIGN KEY referencing shipping_tracking_numbers(id). */
async function discoverFkReferrers(): Promise<FkRef[]> {
  const { rows } = await pool.query<{ table: string; column: string }>(`
    SELECT (con.conrelid::regclass)::text AS table,
           att.attname               AS column
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.contype = 'f'
       AND con.confrelid = 'shipping_tracking_numbers'::regclass
     ORDER BY 1, 2`);
  return rows;
}

async function countFkRows(ref: FkRef, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ${ref.table} WHERE ${ref.column} = ANY($1::bigint[])`,
    [ids],
  );
  return rows[0]?.n ?? 0;
}

function pct(n: number, total: number): string {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  console.log('═══ FedEx-GS1 STN re-normalization — DRY RUN (read-only) ═══\n');

  // ── Baseline sanity (matches the plan's live snapshot) ────────────────────
  const totals = await pool.query<{ rows: number; distinct_norm: number }>(`
    SELECT COUNT(*)::int AS rows,
           COUNT(DISTINCT tracking_number_normalized)::int AS distinct_norm
      FROM shipping_tracking_numbers`);
  console.log(
    `STN rows: ${totals.rows[0].rows}  ·  distinct normalized: ${totals.rows[0].distinct_norm}`,
  );

  // ── 1. Candidate rows the hardened normalizer would rewrite ───────────────
  const candidates = await pool.query<StnRow>(
    `SELECT id, tracking_number_raw, tracking_number_normalized, carrier,
            created_at::text AS created_at
       FROM shipping_tracking_numbers
      WHERE tracking_number_normalized ~ $1
      ORDER BY id ASC`,
    [ENVELOPE_SQL_REGEX],
  );
  const total = candidates.rows.length;
  console.log(`\n1) GS1 envelope candidates (~"96"+33-34 digit): ${total}`);

  // Carrier breakdown + the §3.1 USPS=0 assertion.
  const byCarrier = new Map<string, number>();
  for (const r of candidates.rows) {
    byCarrier.set(r.carrier, (byCarrier.get(r.carrier) ?? 0) + 1);
  }
  console.log('   carrier breakdown (STN.carrier column):');
  for (const [c, n] of [...byCarrier.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${c.padEnd(10)} ${n}`);
  }
  // Independent detection on each candidate string — the real §3.1 guarantee.
  const uspsDetected = candidates.rows.filter(
    (r) => detectCarrier(r.tracking_number_normalized) === 'USPS',
  );
  console.log(
    `   USPS-detected among candidates: ${uspsDetected.length}  ${
      uspsDetected.length === 0 ? '✅ (anchor holds)' : '❌ INVESTIGATE before backfill'
    }`,
  );

  // ── 2. Classify each candidate: rename vs merge vs noop ───────────────────
  // Compute the canonical human number in JS using the SAME SoT normalizer the
  // app uses, then see whether a row already owns that normalized value.
  const enriched = candidates.rows.map((r) => {
    const canonical = extractCanonicalTracking(r.tracking_number_normalized);
    const stripped = stripFedexConcatPrefix(r.tracking_number_normalized);
    return { ...r, canonical, stripped, humanLen: canonical.length };
  });

  // Guard: anything where the JS strip is a no-op (canonical == normalized) is
  // NOT actually collapsible — exclude it from the rewrite set and flag it.
  const noop = enriched.filter((r) => r.canonical === r.tracking_number_normalized);
  const rewritable = enriched.filter((r) => r.canonical !== r.tracking_number_normalized);
  if (noop.length > 0) {
    console.log(
      `\n   ⚠ ${noop.length} candidate(s) matched the SQL envelope but JS strip left them unchanged — excluded.`,
    );
  }

  const canonicals = [...new Set(rewritable.map((r) => r.canonical))];
  const existing = canonicals.length
    ? await pool.query<{ id: number; tracking_number_normalized: string; created_at: string | null }>(
        `SELECT id, tracking_number_normalized, created_at::text AS created_at
           FROM shipping_tracking_numbers
          WHERE tracking_number_normalized = ANY($1::text[])`,
        [canonicals],
      )
    : { rows: [] as Array<{ id: number; tracking_number_normalized: string; created_at: string | null }> };
  const ownerByCanonical = new Map<string, { id: number }>();
  for (const e of existing.rows) ownerByCanonical.set(e.tracking_number_normalized, { id: e.id });

  const renames = rewritable.filter((r) => !ownerByCanonical.has(r.canonical));
  const merges = rewritable.filter((r) => ownerByCanonical.has(r.canonical));

  console.log('\n2) Rewrite classification:');
  console.log(`   safe RENAME (no existing owner of the human number): ${renames.length}`);
  console.log(`   MERGE onto an existing human-number row:            ${merges.length}`);

  // ── 4. 12-vs-15 split (Express vs Ground human form) ──────────────────────
  const len12 = rewritable.filter((r) => r.humanLen === 12).length;
  const len15 = rewritable.filter((r) => r.humanLen === 15).length;
  const lenOther = rewritable.filter((r) => r.humanLen !== 12 && r.humanLen !== 15);
  console.log('\n3) Collapsed human-number length split:');
  console.log(`   12-digit (FedEx Express): ${len12}  (${pct(len12, rewritable.length)})`);
  console.log(`   15-digit (FedEx Ground):  ${len15}  (${pct(len15, rewritable.length)})  ← spot-check vs real Ground labels`);
  if (lenOther.length) {
    console.log(`   other lengths: ${lenOther.length} → ${[...new Set(lenOther.map((r) => r.humanLen))].join(', ')}`);
  }

  // A few concrete examples for eyeballing (the plan's "verify against a couple
  // of real Ground labels"). Show 15-digit ones first.
  const samples = [...rewritable].sort((a, b) => b.humanLen - a.humanLen).slice(0, 8);
  console.log('\n   sample collapses (normalized → canonical, len):');
  for (const s of samples) {
    console.log(`     ${s.tracking_number_normalized}  →  ${s.canonical}  (${s.humanLen})`);
  }

  // ── 3. FK fan-out on merge LOSERS ─────────────────────────────────────────
  // For each merge group, the LOSER is the envelope row (its id is deleted and
  // its FK referrers re-pointed at the winner = oldest id owning the canonical).
  const loserIds = merges.map((m) => m.id);
  console.log(`\n4) FK fan-out on the ${loserIds.length} merge loser id(s):`);
  const referrers = await discoverFkReferrers();
  if (referrers.length === 0) {
    console.log('   (no FK referrers discovered — unexpected; investigate)');
  }
  let anyFk = false;
  for (const ref of referrers) {
    const n = await countFkRows(ref, loserIds);
    if (n > 0) {
      anyFk = true;
      console.log(`   ${ref.table}.${ref.column}: ${n} row(s) to re-point`);
    }
  }
  if (!anyFk && loserIds.length > 0) {
    console.log('   none — merge losers have no FK referrers (delete-only merge).');
  }
  console.log(`   (${referrers.length} FK column(s) reference shipping_tracking_numbers.id in total)`);

  // ── Machine-readable summary ──────────────────────────────────────────────
  console.log('\n═══ SUMMARY ═══');
  console.log(
    JSON.stringify(
      {
        candidates: total,
        usps_among_candidates: uspsDetected.length,
        noop_excluded: noop.length,
        rewritable: rewritable.length,
        renames: renames.length,
        merges: merges.length,
        len12_express: len12,
        len15_ground: len15,
        len_other: lenOther.length,
        merge_loser_ids: loserIds.length,
        fk_referrer_columns: referrers.length,
      },
      null,
      2,
    ),
  );
  console.log('\nNothing was modified. This is a read-only report.');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('dry-run failed:', err);
    return pool.end().finally(() => process.exit(1));
  });
