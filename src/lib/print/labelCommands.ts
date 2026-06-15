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
import bwipjs from 'bwip-js/browser';
import {
  receivingLabelPlatformDisplay,
  receivingLabelPoCornerDisplay,
} from '@/lib/print/printReceivingLabel';
import { conditionLabel } from '@/lib/conditions';

const DPI = 203;
const MM_PER_INCH = 25.4;
// Matches the shared HTML face's 9 CSS px at the CX418's 203 DPI.
const LABEL_FACE_FONT_SIZE = Math.round((9 * DPI) / 96);
const LABEL_NOTE_FONT_SIZE = Math.round((7.5 * DPI) / 96);
const LABEL_HRI_FONT_SIZE = Math.round((9 * DPI) / 96);

function inchesToMillimeters(inches: number): string {
  return (inches * MM_PER_INCH).toFixed(1);
}

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

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function packMonochromeBitmap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const alpha = rgba[pixel + 3];
      const luminance =
        rgba[pixel] * 0.2126 + rgba[pixel + 1] * 0.7152 + rgba[pixel + 2] * 0.0722;
      if (alpha >= 128 && luminance < 160) {
        bitmap[y * bytesPerRow + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
    // CX418's TSPL2 raster mode treats cleared bits as heated dots, opposite
    // the conventional packing above. Flip each completed row so white media
    // stays unheated and only the label artwork prints black.
    for (let byte = 0; byte < bytesPerRow; byte += 1) {
      bitmap[y * bytesPerRow + byte] ^= 0xff;
    }
  }
  return bitmap;
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  initialSize: number,
  weight = 700,
): void {
  let size = initialSize;
  do {
    context.font = `${weight} ${size}px Arial, sans-serif`;
    if (context.measureText(text).width <= maxWidth || size <= 8) break;
    size -= 1;
  } while (size > 8);
  context.fillText(text, x, y);
}

/**
 * CX418-compatible TSPL2 raster job. The printer's bundled macOS driver uses
 * this same approach: render the full page, then send one BITMAP command.
 */
export function buildReceivingLabelBitmapCommands(
  payload: ReceivingLabelPayload,
  size: PaperSize,
  copies = 1,
): Uint8Array {
  if (typeof document === 'undefined') {
    throw new Error('Bitmap label rendering requires a browser document');
  }

  const heightIn = size.heightIn > 0 ? size.heightIn : 1;
  const width = Math.round(size.widthIn * DPI);
  const height = Math.round(heightIn * DPI);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Unable to create label bitmap canvas');

  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000';
  context.textBaseline = 'top';

  const f = fieldsFor(payload);
  const padding = 10;
  const matrixSize = Math.min(height - 32, 164);
  const matrixX = width - matrixSize - padding;
  const infoWidth = matrixX - padding - 8;

  drawFittedText(
    context,
    f.platform,
    padding,
    8,
    infoWidth - 76,
    LABEL_FACE_FONT_SIZE,
    700,
  );
  context.textAlign = 'right';
  drawFittedText(context, f.date, matrixX - 8, 8, 76, LABEL_FACE_FONT_SIZE, 700);
  context.textAlign = 'left';

  let noteY = 51;
  for (const line of f.noteLines) {
    drawFittedText(context, line, padding, noteY, infoWidth, LABEL_NOTE_FONT_SIZE, 600);
    noteY += 22;
  }

  drawFittedText(
    context,
    f.cond,
    padding,
    height - 31,
    Math.floor(infoWidth * 0.58),
    LABEL_FACE_FONT_SIZE,
    900,
  );
  context.textAlign = 'right';
  drawFittedText(
    context,
    f.po,
    matrixX - 8,
    height - 31,
    Math.floor(infoWidth * 0.42),
    LABEL_FACE_FONT_SIZE,
    900,
  );
  context.textAlign = 'left';

  if (f.data) {
    const matrix = document.createElement('canvas');
    bwipjs.toCanvas(matrix, {
      bcid: 'datamatrix',
      text: f.data,
      scale: 4,
      includetext: false,
      paddingwidth: 2,
      paddingheight: 2,
      backgroundcolor: 'FFFFFF',
      barcolor: '000000',
    });
    context.imageSmoothingEnabled = false;
    context.drawImage(matrix, matrixX, 7, matrixSize, matrixSize);
    context.textAlign = 'center';
    drawFittedText(
      context,
      f.data,
      matrixX + matrixSize / 2,
      height - 24,
      matrixSize,
      LABEL_HRI_FONT_SIZE,
      800,
    );
  }

  const rotated = document.createElement('canvas');
  rotated.width = width;
  rotated.height = height;
  const rotatedContext = rotated.getContext('2d', { alpha: false });
  if (!rotatedContext) throw new Error('Unable to rotate label bitmap');
  rotatedContext.fillStyle = '#fff';
  rotatedContext.fillRect(0, 0, width, height);
  rotatedContext.translate(width, height);
  rotatedContext.rotate(Math.PI);
  rotatedContext.drawImage(canvas, 0, 0);

  const image = rotatedContext.getImageData(0, 0, width, height);
  const bitmap = packMonochromeBitmap(image.data, width, height);
  const bytesPerRow = Math.ceil(width / 8);
  const header = [
    `SIZE ${inchesToMillimeters(size.widthIn)} mm,${inchesToMillimeters(heightIn)} mm`,
    'GAP 3.0 mm,0 mm',
    'DIRECTION 1,0',
    'REFERENCE 0,0',
    'DENSITY 10',
    'CLS',
    `BITMAP 0,0,${bytesPerRow},${height},1,`,
  ].join('\r\n');
  const footer = `\r\nPRINT ${Math.max(1, copies)},1\r\n`;
  return joinBytes([asciiBytes(header), bitmap, asciiBytes(footer)]);
}

// ---------------------------------------------------------------------------
// TSPL
// ---------------------------------------------------------------------------
function tspl(f: LabelFields, size: PaperSize, copies: number): string {
  const heightIn = size.heightIn > 0 ? size.heightIn : 1;
  const wDots = Math.round(size.widthIn * DPI);
  const hDots = Math.round(heightIn * DPI);
  const padding = 10;
  const dm = Math.min(hDots - padding * 2, Math.round(0.84 * DPI));
  const dmX = Math.max(wDots - dm - padding, padding);
  const infoRight = dmX - 8;
  const dateX = Math.max(padding, infoRight - Math.max(72, f.date.length * 8));

  const L: string[] = [
    `SIZE ${inchesToMillimeters(size.widthIn)} mm,${inchesToMillimeters(heightIn)} mm`,
    'GAP 3.0 mm,0 mm',
    'DIRECTION 1,0',
    'REFERENCE 0,0',
    'DENSITY 10',
    'CODEPAGE 1252',
    'CLS',
    `TEXT ${padding},10,"2",0,1,1,"${f.platform}"`,
    `TEXT ${dateX},12,"1",0,1,1,"${f.date}"`,
  ];
  let y = 50;
  for (const line of f.noteLines) {
    L.push(`TEXT ${padding},${y},"2",0,1,1,"${line}"`);
    y += 26;
  }
  L.push(`TEXT ${padding},${hDots - 37},"3",0,1,1,"${f.cond}"`);
  const poX = Math.max(padding, infoRight - Math.max(56, f.po.length * 12));
  L.push(`TEXT ${poX},${hDots - 29},"2",0,1,1,"${f.po}"`);
  if (f.data) L.push(`DMATRIX ${dmX},${padding},${dm},${dm},"${f.data}"`);
  L.push(`PRINT ${Math.max(1, copies)},1`);
  return `${L.join('\r\n')}\r\n`;
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
