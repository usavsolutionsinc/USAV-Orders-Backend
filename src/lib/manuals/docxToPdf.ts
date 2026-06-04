import { Sandbox } from '@vercel/sandbox';

/**
 * Server-side DOCX → PDF conversion via headless LibreOffice in a Vercel
 * Sandbox (ephemeral microVM).
 *
 * Why a sandbox and not an in-process library: Vercel's serverless runtime
 * has no Word/Office engine, and JS-only converters (mammoth + HTML→PDF) lose
 * Word's table/header/styling fidelity. LibreOffice's `soffice --convert-to
 * pdf` produces true Word-grade output. The sandbox keeps the heavyweight
 * binary out of our function bundle and out of our own infra.
 *
 * Speed: a cold sandbox that has to `dnf install` LibreOffice takes ~30-60s.
 * Set MANUAL_CONVERT_SNAPSHOT_ID (see scripts/create-manual-convert-snapshot.ts)
 * to boot from a pre-baked image instead — conversions then run in ~2-5s.
 *
 * Auth: on Vercel deployments the SDK authenticates automatically via OIDC.
 * For local dev, set VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID in
 * .env.local — without them this throws and the caller surfaces the error.
 */

// LibreOffice Writer provides `soffice`; --headless needs no display server.
const LIBREOFFICE_INSTALL =
  'sudo dnf install -y --skip-broken libreoffice-writer 2>&1';

export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const snapshotId = process.env.MANUAL_CONVERT_SNAPSHOT_ID;

  const sandbox = snapshotId
    ? await Sandbox.create({ source: { type: 'snapshot', snapshotId }, timeout: 120_000 })
    : await Sandbox.create({ runtime: 'node24', timeout: 300_000 });

  try {
    // Cold (no snapshot) → install LibreOffice on the fly. Skipped when the
    // snapshot already carries it.
    if (!snapshotId) {
      const install = await sandbox.runCommand('sh', ['-c', LIBREOFFICE_INSTALL]);
      if (install.exitCode !== 0) {
        throw new Error(
          `libreoffice install failed (${install.exitCode}): ${await install.stderr()}`,
        );
      }
    }

    // Ship the .docx into the VM. writeFiles takes a Uint8Array, so no
    // command-line length limits or base64 round-trips.
    await sandbox.writeFiles([{ path: '/tmp/in.docx', content: new Uint8Array(docx) }]);

    // Convert. -env:UserInstallation points soffice at a throwaway profile so
    // it never hits a stale profile lock in the ephemeral VM.
    const convert = await sandbox.runCommand('soffice', [
      '--headless',
      '--norestore',
      '-env:UserInstallation=file:///tmp/loprofile',
      '--convert-to', 'pdf',
      '--outdir', '/tmp',
      '/tmp/in.docx',
    ]);
    if (convert.exitCode !== 0) {
      throw new Error(
        `libreoffice conversion failed (${convert.exitCode}): ${await convert.stderr()}`,
      );
    }

    const pdf = await sandbox.readFileToBuffer({ path: '/tmp/in.pdf' });
    if (!pdf || pdf.length === 0) {
      throw new Error('libreoffice produced no PDF output');
    }
    return pdf;
  } finally {
    await sandbox.stop();
  }
}
