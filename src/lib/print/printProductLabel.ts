function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLabelHtml(sku: string, title: string, serialNumber: string): string {
  const safeSku = escapeHtml(sku);
  const safeTitle = escapeHtml(title);
  const safeSerial = escapeHtml(serialNumber);
  const barcodeValue = JSON.stringify(sku);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Label ${safeSku}</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <style>
      body { font-family: Arial, sans-serif; padding: 0; margin: 0; text-align: center; }
      canvas { margin: 2px 0; }
      .sku { font-size: 22px; font-weight: bold; margin: 2px 0; }
      .title { font-size: 11px; color: #666; margin: 2px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; padding: 0 4px; }
      .sn { font-size: 10px; color: #999; margin: 2px 0; font-family: monospace; }
    </style>
  </head>
  <body>
    <canvas id="barcode"></canvas>
    <div class="sku">${safeSku}</div>
    ${safeTitle ? `<div class="title">${safeTitle}</div>` : ''}
    ${safeSerial ? `<div class="sn">SN: ${safeSerial}</div>` : ''}
    <script>
      window.onload = function() {
        JsBarcode("#barcode", ${barcodeValue}, {
          format: "CODE128",
          lineColor: "#000",
          width: 2,
          height: 50,
          displayValue: false
        });
        setTimeout(function() { window.print(); window.close(); }, 500);
      };
    </script>
  </body>
</html>`;
}

export type PrintProductLabelInput = {
  sku: string;
  title?: string;
  serialNumber?: string;
};

export function printProductLabel(input: PrintProductLabelInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const serialNumber = input.serialNumber?.trim() ?? '';
  const title = input.title?.trim() ?? '';

  const printWindow = window.open('', '', 'width=400,height=300');
  if (!printWindow) return;

  printWindow.document.write(buildLabelHtml(sku, title, serialNumber));
  printWindow.document.close();
}

export type PrintProductLabelsInput = {
  sku: string;
  title?: string;
  serialNumbers: string[];
  staggerMs?: number;
};

export function printProductLabels(input: PrintProductLabelsInput): void {
  if (typeof window === 'undefined') return;

  const sku = input.sku?.trim();
  if (!sku) return;

  const serials = (input.serialNumbers ?? [])
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  if (serials.length === 0) return;

  const stagger = input.staggerMs ?? 200;

  serials.forEach((serialNumber, i) => {
    window.setTimeout(() => {
      printProductLabel({ sku, title: input.title, serialNumber });
    }, i * stagger);
  });
}
