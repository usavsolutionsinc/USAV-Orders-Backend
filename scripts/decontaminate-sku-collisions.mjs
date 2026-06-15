/**
 * De-contaminate cross-namespace SKU collisions between Zoho `items` and the
 * marketplace `sku_catalog`.
 *
 * Background
 * ----------
 * `sku_catalog.sku` is the MARKETPLACE SKU namespace (ecwid/ebay/amazon) and is
 * UNIQUE. Zoho `items` is a SEPARATE namespace that reuses the same zero-padded
 * strings for DIFFERENT products (e.g. Ecwid SKU 143 = "Bose UB-20 Wall Mount"
 * vs Zoho SKU 00143 = "Bose Solo Soundbar"). Historically a Zoho receiving line
 * bound its scanned units to whatever marketplace catalog row shared the SKU
 * string — mis-identifying the unit.
 *
 * The application now resolves SKU→catalog with a title-consistency guard so new
 * scans can't mis-bind. This script repairs the EXISTING mis-bound serial units
 * and establishes the correct, durable catalog identity using AUTHORITATIVE
 * sources only:
 *   - Zoho `items.name` (the canonical product title) and
 *   - the Ecwid product list (`sku_platform_ids` platform='ecwid' display_name,
 *     which mirrors public/platform to id/Ecwid.csv — 100% accurate per the owner).
 * Correct identity is established by EXACT (normalized) product-name equality
 * between the Zoho item and an Ecwid product — never by fuzzy title guessing
 * (which mis-matches short Bose titles, e.g. "Soundbar" vs "SoundDock").
 *
 * Per mis-bound unit the script picks ONE action:
 *   REPOINT  — the correct product already has a catalog row → point the unit at it.
 *   CREATE   — the correct Ecwid product has no catalog row yet → create it
 *              (sku = ecwid SKU, title = Zoho name), link the ecwid mapping, then point.
 *   BRIDGE   — also add a sku_platform_ids row (platform='zoho', platform_item_id =
 *              zoho_item_id) so the LINE (pre-scan) resolves to the right catalog too.
 *   NULL     — no authoritative match → clear the wrong binding (degrade to the
 *              Zoho name; operator can pair manually later).
 *
 * Safe by default: prints the full plan and writes nothing unless run with --apply.
 * All writes run in a single transaction.
 *
 *   node scripts/decontaminate-sku-collisions.mjs           # dry run
 *   node scripts/decontaminate-sku-collisions.mjs --apply    # commit
 */
import pg from 'pg';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const GUARD = 0.25; // must match SKU_TITLE_GUARD_MIN in sku-catalog-queries.ts

const envText = fs.readFileSync('.env.local', 'utf8') + '\n' + fs.readFileSync('.env', 'utf8');
const url = envText.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main() {
  // 1. The truly mis-bound serial units: bound catalog title disagrees with
  //    BOTH the listing item_name AND the clean Zoho items.name (matches the
  //    app's GREATEST(...) guard). Grouped by the receiving line.
  const { rows: misbound } = await pool.query(`
    SELECT su.id AS su_id, su.sku_catalog_id AS cur_cat,
           sc.product_title AS cur_title,
           rl.id AS line_id, rl.sku AS line_sku, rl.item_name AS line_name,
           rl.zoho_item_id, rl.organization_id,
           it.name AS zoho_name
      FROM serial_units su
      JOIN sku_catalog sc ON sc.id = su.sku_catalog_id
      JOIN receiving_lines rl ON rl.id = su.origin_receiving_line_id AND rl.item_name IS NOT NULL
      LEFT JOIN items it ON it.zoho_item_id = rl.zoho_item_id AND it.status = 'active'
     WHERE GREATEST(
             similarity(LOWER(sc.product_title), LOWER(COALESCE(rl.item_name, ''))),
             similarity(LOWER(sc.product_title), LOWER(COALESCE(it.name, '')))
           ) < ${GUARD}
     ORDER BY su.id`);

  // 2. Ecwid product crosswalk (authoritative): normalized display_name -> row.
  const { rows: ecwid } = await pool.query(
    `SELECT id, platform_sku, display_name, sku_catalog_id, organization_id
       FROM sku_platform_ids
      WHERE platform = 'ecwid' AND display_name IS NOT NULL AND display_name <> ''`);
  const ecByName = new Map();
  for (const r of ecwid) {
    const k = norm(r.display_name);
    if (k && !ecByName.has(k)) ecByName.set(k, r);
  }

  const client = await pool.connect();
  const plan = [];
  const counts = { REPOINT: 0, CREATE: 0, NULL: 0, CONFLICT: 0 };
  // cache: zoho_item_id -> resolved correct catalog id (so a group shares work)
  const resolvedByZoho = new Map();

  try {
    await client.query('BEGIN');

    for (const u of misbound) {
      const zname = (u.zoho_name || u.line_name || '').trim();
      const org = u.organization_id;
      let correctCat = u.zoho_item_id ? resolvedByZoho.get(u.zoho_item_id) : undefined;
      let action;
      let detail;

      if (correctCat === undefined) {
        const hit = ecByName.get(norm(zname));
        if (!hit) {
          action = 'NULL';
          detail = `no authoritative Ecwid name match for "${zname}"`;
          correctCat = null;
        } else if (hit.sku_catalog_id) {
          action = 'REPOINT';
          detail = `Ecwid ${hit.platform_sku} → catalog ${hit.sku_catalog_id}`;
          correctCat = hit.sku_catalog_id;
        } else {
          // Ecwid product exists but isn't promoted to a catalog row yet.
          const existing = await client.query(
            `SELECT id, product_title, similarity(LOWER(product_title), LOWER($2)) AS sim
               FROM sku_catalog WHERE sku = $1 LIMIT 1`,
            [hit.platform_sku, zname]);
          const ex = existing.rows[0];
          if (ex && Number(ex.sim) >= GUARD) {
            // A catalog row already holds this Ecwid SKU for the same product.
            correctCat = ex.id;
            action = 'REPOINT';
            detail = `existing catalog ${ex.id} (sku ${hit.platform_sku})`;
            if (APPLY) {
              await client.query(`UPDATE sku_platform_ids SET sku_catalog_id = $1 WHERE id = $2`, [ex.id, hit.id]);
            }
          } else if (ex) {
            // The Ecwid SKU string is ALSO taken by a different product — can't
            // create without clobbering. Leave for manual review; clear binding.
            action = 'CONFLICT';
            detail = `catalog sku ${hit.platform_sku} occupied by "${ex.product_title}" (sim ${(+ex.sim).toFixed(2)}) → NULL`;
            correctCat = null;
          } else {
            action = 'CREATE';
            detail = `new catalog sku ${hit.platform_sku} "${zname}", link Ecwid #${hit.id}`;
            if (APPLY) {
              const ins = await client.query(
                `INSERT INTO sku_catalog (sku, product_title, is_active, organization_id)
                 VALUES ($1, $2, true, $3) RETURNING id`,
                [hit.platform_sku, zname, org]);
              correctCat = ins.rows[0].id;
              await client.query(`UPDATE sku_platform_ids SET sku_catalog_id = $1 WHERE id = $2`, [correctCat, hit.id]);
            } else {
              correctCat = -1; // placeholder for dry run
            }
          }
        }

        // Durable Zoho→catalog bridge so the LINE resolves correctly pre-scan.
        if (correctCat && correctCat > 0 && u.zoho_item_id) {
          if (APPLY) {
            await client.query(
              `INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_item_id, account_name, is_active, organization_id)
               SELECT $1, 'zoho', $2, 'zoho', true, $3
               WHERE NOT EXISTS (
                 SELECT 1 FROM sku_platform_ids
                  WHERE platform = 'zoho' AND platform_item_id = $2 AND organization_id = $3)`,
              [correctCat, u.zoho_item_id, org]);
          }
          detail += ' + zoho bridge';
        }

        if (u.zoho_item_id) resolvedByZoho.set(u.zoho_item_id, correctCat);
      } else {
        action = correctCat ? 'REPOINT' : 'NULL';
        detail = correctCat ? `(grouped) → catalog ${correctCat}` : '(grouped) no match';
      }

      // Repoint or clear the serial unit.
      const target = correctCat && correctCat > 0 ? correctCat : null;
      if (APPLY) {
        await client.query(
          `UPDATE serial_units SET sku_catalog_id = $1, updated_at = NOW() WHERE id = $2`,
          [target, u.su_id]);
      }

      counts[action === 'CONFLICT' ? 'CONFLICT' : action]++;
      plan.push({ su: u.su_id, action, zoho: zname.slice(0, 46), wrong: (u.cur_title || '').slice(0, 40), detail });
    }

    if (APPLY) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  console.log(`\n${APPLY ? '✅ APPLIED' : '🔍 DRY RUN (no writes)'} — ${misbound.length} mis-bound serial units\n`);
  for (const p of plan) {
    console.log(`su#${p.su}  [${p.action}]  zoho="${p.zoho}"  wrong="${p.wrong}"\n     ${p.detail}`);
  }
  console.log('\nSUMMARY:', JSON.stringify(counts));
  if (!APPLY) console.log('\nRe-run with --apply to commit.');
  await pool.end();
}

main();
