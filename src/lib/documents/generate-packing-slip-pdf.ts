/**
 * Minimal single-page text PDF for generated packing slips when a marketplace
 * API does not return a slip document. No external PDF dependency.
 */

export interface PackingSlipPdfInput {
  orderRef: string;
  platform: string | null;
  lines: Array<{ sku?: string | null; title?: string | null; quantity?: string | null }>;
  tracking?: string | null;
  shipTo?: string | null;
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildLines(input: PackingSlipPdfInput): string[] {
  const rows: string[] = [
    'PACKING SLIP',
    `Order: ${input.orderRef}`,
    input.platform ? `Platform: ${input.platform}` : '',
    input.tracking ? `Tracking: ${input.tracking}` : '',
    input.shipTo ? `Ship to: ${input.shipTo}` : '',
    '',
    'Items:',
  ].filter(Boolean);

  if (input.lines.length === 0) {
    rows.push('  (no line items)');
  } else {
    for (const line of input.lines) {
      const sku = line.sku?.trim() || '—';
      const title = line.title?.trim() || '—';
      const qty = line.quantity?.trim() || '1';
      rows.push(`  ${qty} x ${sku} — ${title}`);
    }
  }
  return rows;
}

/** Build a valid minimal PDF buffer with left-aligned text lines. */
export function generatePackingSlipPdf(input: PackingSlipPdfInput): Buffer {
  const lines = buildLines(input);
  const fontSize = 11;
  const lineHeight = 14;
  const startY = 780;
  const startX = 48;

  const contentStream = [
    'BT',
    `/F1 ${fontSize} Tf`,
    ...lines.flatMap((line, index) => {
      const y = startY - index * lineHeight;
      return [`${startX} ${y} Td`, `(${escapePdfText(line)}) Tj`, index < lines.length - 1 ? '0 -14 Td' : ''];
    }).filter(Boolean),
    'ET',
  ].join('\n');

  const contentLength = Buffer.byteLength(contentStream, 'utf8');
  const objects: string[] = [];

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
  );
  objects.push(`4 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }

  const xrefStart = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body, 'utf8');
}
