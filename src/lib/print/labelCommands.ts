/**
 * Raw thermal-label command builders — TSPL, ZPL, and ESC/POS.
 *
 * Emits the printer's NATIVE language so the firmware renders text + the 2D code
 * itself (crisp, fast, and required for the browser-native print path in
 * `browserPrint.ts` where there is no driver/Chromium to rasterize HTML). Layout
 * adapts to the profile's paper size; tuned for 2"×1" but scales for larger
 * stock. ESC/POS targets 80mm receipt rolls and uses a QR code (DataMatrix
 * support is spotty on receipt firmware) carrying the same `R-{id}` value.
 */

import type { ReceivingLabelPayload } from '@/components/receiving/workspace/receiving-label-helpers';
import type { LabelLanguage, PaperSize } from '@/lib/print/browserPrint';
import { receivingHandle } from '@/lib/barcode-routing';
import {
  receivingLabelPlatformDisplay,
  receivingLabelPoCornerDisplay,
} from '@/lib/print/printReceivingLabel';
import { conditionLabel } from '@/lib/conditions';

const DPI = 203;

/** Strip characters that would break out of a quoted TSPL/ZPL field. */
function sanitize(s: string): string {
  return String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["~^]/g, ' ')
    .trim();
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

function qrValueFor(p: ReceivingLabelPayload): string {
  if (p.receivingId != null && Number.isFinite(p.receivingId)) {
    return receivingHandle(p.receivingId);
  }
  return String(p.scanValue ?? '').trim();
}

interface LabelFields {
  platform: string;
  date: string;
  cond: string;
  po: string;
  noteLines: string[];
  data: string;
}

function fieldsFor(p: ReceivingLabelPayload): LabelFields {
  return {
    platform: sanitize(receivingLabelPlatformDisplay(p)),
    date: sanitize(p.date),
    cond: sanitize(conditionLabel(p.conditionCode, 'label')),
    po: sanitize(receivingLabelPoCornerDisplay(p)),
    noteLines: wrap(sanitize((p.notes || '').trim()), 22, 3),
    data: sanitize(qrValueFor(p)),
  };
}

// ---------------------------------------------------------------------------
// TSPL
// ---------------------------------------------------------------------------
function tspl(f: LabelFields, size: PaperSize, copies: number): string {
  const heightIn = size.heightIn > 0 ? size.heightIn : 1;
  const wDots = Math.round(size.widthIn * DPI);
  const hDots = Math.round(heightIn * DPI);
  const dm = Math.min(hDots - 40, 150);
  const dmX = Math.max(wDots - dm - 12, 12);

  const L: string[] = [
    `SIZE ${size.widthIn},${heightIn}`,
    'GAP 0.12,0',
    'DIRECTION 1',
    'DENSITY 10',
    'CLS',
    `TEXT 12,12,"2",0,1,1,"${f.platform}"`,
    `TEXT ${Math.round(wDots * 0.6)},14,"1",0,1,1,"${f.date}"`,
  ];
  let y = 54;
  for (const line of f.noteLines) {
    L.push(`TEXT 12,${y},"2",0,1,1,"${line}"`);
    y += 26;
  }
  L.push(`TEXT 12,${hDots - 35},"3",0,1,1,"${f.cond}"`);
  L.push(`TEXT ${Math.round(wDots * 0.4)},${hDots - 27},"2",0,1,1,"${f.po}"`);
  if (f.data) L.push(`DMATRIX ${dmX},20,${dm},${dm},"${f.data}"`);
  L.push(`PRINT ${Math.max(1, copies)},1`);
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// ZPL
// ---------------------------------------------------------------------------
function zpl(f: LabelFields, size: PaperSize, copies: number): string {
  const heightIn = size.heightIn > 0 ? size.heightIn : 1;
  const wDots = Math.round(size.widthIn * DPI);
  const hDots = Math.round(heightIn * DPI);
  const dmX = Math.max(wDots - 170, 12);

  const L: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28',
    `^FO12,12^A0N,24,24^FD${f.platform}^FS`,
    `^FO${Math.round(wDots * 0.6)},14^A0N,18,18^FD${f.date}^FS`,
  ];
  let y = 52;
  for (const line of f.noteLines) {
    L.push(`^FO12,${y}^A0N,20,20^FD${line}^FS`);
    y += 24;
  }
  L.push(`^FO12,${hDots - 43}^A0N,30,30^FD${f.cond}^FS`);
  L.push(`^FO${Math.round(wDots * 0.4)},${hDots - 33}^A0N,22,22^FD${f.po}^FS`);
  if (f.data) L.push(`^FO${dmX},20^BXN,6,200^FD${f.data}^FS`);
  L.push(`^PQ${Math.max(1, copies)}`);
  L.push('^XZ');
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// ESC/POS (80mm receipt). QR carries the same R-{id} value.
// ---------------------------------------------------------------------------
const GS = '\x1d';
const ESC = '\x1b';

function escposQr(data: string): string {
  if (!data) return '';
  const len = data.length + 3;
  const pL = String.fromCharCode(len & 0xff);
  const pH = String.fromCharCode((len >> 8) & 0xff);
  return (
    `${GS}(k\x04\x00\x31\x41\x32\x00` + // model 2
    `${GS}(k\x03\x00\x31\x43\x06` + // module size 6
    `${GS}(k\x03\x00\x31\x45\x31` + // error correction M
    `${GS}(k${pL}${pH}\x31\x50\x30${data}` + // store data
    `${GS}(k\x03\x00\x31\x51\x30` // print
  );
}

function escpos(f: LabelFields, copies: number): string {
  const body =
    `${ESC}@` + // init
    `${ESC}a\x01` + // center
    `${ESC}!\x18${f.platform}\n` + // double height/width title
    `${ESC}!\x00${f.date}\n` +
    (f.noteLines.length ? `${f.noteLines.join('\n')}\n` : '') +
    `${ESC}!\x10${f.cond}   ${f.po}\n` + // emphasized
    `${ESC}!\x00\n` +
    escposQr(f.data) +
    '\n\n\n' +
    `${GS}V\x01`; // partial cut
  return body.repeat(Math.max(1, copies));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function buildReceivingLabelCommands(
  payload: ReceivingLabelPayload,
  language: LabelLanguage,
  size: PaperSize,
  copies = 1,
): string {
  const f = fieldsFor(payload);
  if (language === 'zpl') return zpl(f, size, copies);
  if (language === 'escpos') return escpos(f, copies);
  if (language === 'none') return '';
  return tspl(f, size, copies);
}

export function buildTestLabelCommands(
  language: LabelLanguage,
  size: PaperSize,
  deviceLabel: string,
  dateStr: string,
  copies = 1,
): string {
  const f: LabelFields = {
    platform: 'USAV print test',
    date: sanitize(dateStr),
    cond: sanitize(deviceLabel),
    po: size.label,
    noteLines: [],
    data: 'USAV-TEST',
  };
  if (language === 'zpl') return zpl(f, size, copies);
  if (language === 'escpos') return escpos(f, copies);
  if (language === 'none') return '';
  return tspl(f, size, copies);
}
