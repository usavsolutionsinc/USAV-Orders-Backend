/**
 * One-off: bake a Vercel Sandbox snapshot with headless LibreOffice
 * pre-installed, so DOCX→PDF conversion (lib/manuals/docxToPdf) boots in
 * ~2-5s instead of ~30-60s.
 *
 * Run once:
 *   tsx scripts/create-manual-convert-snapshot.ts
 *
 * It prints a snapshot id — set it as an env var on the project (all envs):
 *   MANUAL_CONVERT_SNAPSHOT_ID=snap_xxxxxxxxxxxx
 *
 * Auth: needs VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID in the
 * environment (or a logged-in Vercel OIDC context). Re-run if you ever change
 * the install set below; snapshots are immutable.
 */
import { Sandbox } from '@vercel/sandbox';

async function main() {
  console.log('Creating sandbox (node24)…');
  const sandbox = await Sandbox.create({ runtime: 'node24', timeout: 300_000 });

  try {
    console.log('Installing libreoffice-writer (this is the slow part)…');
    const install = await sandbox.runCommand('sh', [
      '-c',
      'sudo dnf install -y --skip-broken libreoffice-writer 2>&1',
    ]);
    if (install.exitCode !== 0) {
      throw new Error(`install failed (${install.exitCode}): ${await install.stderr()}`);
    }

    // Sanity-check soffice is on PATH before freezing the image.
    const which = await sandbox.runCommand('sh', ['-c', 'command -v soffice']);
    if (which.exitCode !== 0) {
      throw new Error('soffice not found after install');
    }
    console.log('soffice at:', (await which.stdout()).trim());

    console.log('Snapshotting…');
    const snap = await sandbox.snapshot();
    console.log('\n✅ Snapshot ready.\n');
    console.log(`   MANUAL_CONVERT_SNAPSHOT_ID=${snap.snapshotId}\n`);
    console.log('Set that as a project env var (all environments), then redeploy.');
  } finally {
    await sandbox.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
