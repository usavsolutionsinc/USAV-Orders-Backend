// Reads scripts/qr-audit-results.json and prints two markdown tables:
//   1. Working QR codes (decoded URL returns a real PDF)
//   2. Broken QR codes (404, non-PDF response, decode-but-no-PDF, etc.)
// PDFs with no QR detected are listed in a third small table at the end so
// they aren't silently lost.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const IN = join(process.cwd(), 'scripts', 'qr-audit-results.json');
const OUT = join(process.cwd(), 'scripts', 'qr-audit-report.md');

const data = JSON.parse(await readFile(IN, 'utf8'));

function mdEscape(s) {
  if (s == null) return '';
  return String(s).replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 180);
}

const working = []; // { manualId, displayName, sourceUrl, page, decoded, status, contentType }
const broken = [];
const noQr = [];
const errored = [];

function classify(f) {
  const c = f.check;
  if (!c) return 'broken';
  if (c.error === 'not-a-url') return 'broken';
  if (c.error) return 'broken'; // network failure
  if (c.status == null) return 'broken';
  if (c.status >= 200 && c.status < 400) return 'working';
  return 'broken';
}

for (const r of data) {
  if (r.error) {
    errored.push(r);
    continue;
  }
  if (!r.qrFindings || r.qrFindings.length === 0) {
    noQr.push(r);
    continue;
  }
  for (const f of r.qrFindings) {
    const row = {
      manualId: r.manualId,
      displayName: r.displayName,
      sourceUrl: r.sourceUrl,
      page: f.page,
      decoded: f.decoded,
      check: f.check,
      isPdf: !!(f.check?.isPdfMagic || /application\/pdf/i.test(f.check?.contentType || '')),
    };
    if (classify(f) === 'working') working.push(row);
    else broken.push(row);
  }
}

function tableHeader(cols) {
  return `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |`;
}

function workingRow(row) {
  return `| ${row.manualId} | ${mdEscape(row.displayName)} | p${row.page} | ${row.check.status} | ${row.isPdf ? 'PDF' : 'page'} | ${mdEscape(row.decoded)} |`;
}

function brokenRow(row) {
  const reason = row.check?.error
    ? row.check.error
    : row.check?.status == null
      ? 'no-response'
      : !/application\/pdf/i.test(row.check.contentType || '') && !row.check.isPdfMagic
        ? `not-a-pdf (${row.check.contentType || 'unknown'})`
        : `http-${row.check.status}`;
  return `| ${row.manualId} | ${mdEscape(row.displayName)} | p${row.page} | ${row.check?.status ?? '—'} | ${mdEscape(reason)} | ${mdEscape(row.decoded)} |`;
}

function noQrRow(r) {
  return `| ${r.manualId} | ${mdEscape(r.displayName)} | ${r.pageCount} | ${mdEscape(r.sourceUrl)} |`;
}

function erroredRow(r) {
  return `| ${r.manualId} | ${mdEscape(r.displayName)} | ${mdEscape(r.error)} |`;
}

const out = [];
out.push('# Manual QR audit\n');
out.push(`- Scanned: **${data.length}** blob-backed PDFs`);
out.push(`- QR codes decoded: **${working.length + broken.length}**`);
const workingPdf = working.filter((r) => r.isPdf).length;
const workingPage = working.length - workingPdf;
out.push(`- Working (HTTP 2xx — link resolves): **${working.length}** (of which **${workingPdf}** serve a PDF, **${workingPage}** serve a non-PDF page e.g. YouTube/product page)`);
out.push(`- Broken (4xx / 5xx / network error / not-a-url): **${broken.length}**`);
out.push(`- PDFs with no QR detected: **${noQr.length}**`);
out.push(`- PDFs that errored during scan: **${errored.length}**\n`);

out.push('## ✅ Working QR codes\n');
out.push(tableHeader(['manual id', 'manual', 'page', 'status', 'kind', 'decoded URL']));
for (const r of working.sort((a, b) => a.manualId - b.manualId)) out.push(workingRow(r));
out.push('');

out.push('## ❌ Broken QR codes\n');
out.push(tableHeader(['manual id', 'manual', 'page', 'status', 'reason', 'decoded URL']));
for (const r of broken.sort((a, b) => a.manualId - b.manualId)) out.push(brokenRow(r));
out.push('');

if (noQr.length) {
  out.push('## ⚪ PDFs with no QR detected\n');
  out.push(tableHeader(['manual id', 'manual', 'pages', 'source URL']));
  for (const r of noQr.sort((a, b) => a.manualId - b.manualId)) out.push(noQrRow(r));
  out.push('');
}

if (errored.length) {
  out.push('## ⚠️ Scan errors\n');
  out.push(tableHeader(['manual id', 'manual', 'error']));
  for (const r of errored.sort((a, b) => a.manualId - b.manualId)) out.push(erroredRow(r));
  out.push('');
}

const text = out.join('\n');
await writeFile(OUT, text);
console.log(`Wrote ${OUT}`);
console.log(`Working: ${working.length} | Broken: ${broken.length} | No QR: ${noQr.length} | Errors: ${errored.length}`);
