/**
 * ZPL (Zebra Programming Language) templates for the three label classes.
 *
 * All three target 2x1" at 203 dpi (406 × 203 dots). The QR class on each
 * label encodes the same URL form the existing popup-HTML printer emits, so
 * scans land identically regardless of which dispatch path printed the label.
 *
 * Keep the templates dumb — string concatenation only. Caller is responsible
 * for escaping ^FH/^FS sequences if user content can contain ZPL specials.
 */

function esc(input: string | number | null | undefined): string {
  return String(input ?? '').replace(/[\^~]/g, ' ');
}

export interface CartonLabelInput {
  qrPayload: string;
  platform: string;
  typeLabel: string;
  conditionShort: string;
  poTail: string;
  date: string;
  notes?: string;
}

export function buildCartonZpl(input: CartonLabelInput): string {
  return [
    '^XA',
    '^PW406',
    '^LL203',
    '^LH0,0',
    '^CF0,18',
    `^FO10,10^FD${esc(input.platform)}^FS`,
    `^CF0,16^FO260,10^FD${esc(input.date)}^FS`,
    `^CF0,24^FO10,40^FD${esc(input.typeLabel)}^FS`,
    `^CF0,22^FO10,90^FD${esc(input.conditionShort)}^FS`,
    `^CF0,22^FO200,90^FD${esc(input.poTail)}^FS`,
    input.notes
      ? `^CF0,14^FO10,120^FB246,2,0,L,0^FD${esc(input.notes)}^FS`
      : '',
    `^FO260,40^BQN,2,5^FDLA,${esc(input.qrPayload)}^FS`,
    '^XZ',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ProductLabelInput {
  sku: string;
  qrPayload: string;
  title?: string | null;
  serialNumber?: string | null;
}

export function buildProductZpl(input: ProductLabelInput): string {
  return [
    '^XA',
    '^PW406',
    '^LL203',
    '^LH0,0',
    `^CF0,30^FO10,12^FD${esc(input.sku)}^FS`,
    input.title
      ? `^CF0,14^FO10,52^FB240,2,0,L,0^FD${esc(input.title)}^FS`
      : '',
    input.serialNumber
      ? `^CF0,14^FO10,108^FDSN: ${esc(input.serialNumber)}^FS`
      : '',
    `^FO10,130^BCN,55,N,N^FD${esc(input.sku)}^FS`,
    `^FO260,40^BQN,2,5^FDLA,${esc(input.qrPayload)}^FS`,
    '^XZ',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface BinLabelInput {
  qrPayload: string;
  barcode: string;
  room: string;
  rowLabel: string;
  colLabel: string;
  capacity?: number | null;
  binType?: string | null;
  name?: string | null;
}

export function buildBinZpl(input: BinLabelInput): string {
  const meta = [input.binType, input.capacity != null ? `CAP ${input.capacity}` : null]
    .filter(Boolean)
    .join(' · ');
  return [
    '^XA',
    '^PW406',
    '^LL203',
    '^LH0,0',
    `^CF0,22^FO10,10^FD${esc(input.room)}^FS`,
    `^CF0,16^FO10,40^FDRow ${esc(input.rowLabel)} · Col ${esc(input.colLabel)}^FS`,
    meta
      ? `^CF0,12^FO10,62^FD${esc(meta)}^FS`
      : '',
    `^CF0,26^FO10,98^FD${esc(input.barcode)}^FS`,
    `^FO10,130^BCN,55,N,N^FD${esc(input.barcode)}^FS`,
    `^FO260,30^BQN,2,5^FDLA,${esc(input.qrPayload)}^FS`,
    input.name
      ? `^CF0,12^FO260,150^FD${esc(input.name)}^FS`
      : '',
    '^XZ',
  ]
    .filter(Boolean)
    .join('\n');
}
