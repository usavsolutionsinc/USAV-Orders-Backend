/**
 * Raw thermal-label command builders for product/testing unit labels.
 */

import type { LabelLanguage, PaperSize } from '@/lib/print/browserPrint';
import bwipjs from 'bwip-js/browser';
import {
  buildUnitPayload,
  unitLabelToFace,
  type PrintProductLabelInput,
} from '@/lib/print/unitLabelCore';
import {
  packMonochromeBitmap,
} from '@/lib/print/labelCommands';

const DPI = 203;
const MM_PER_INCH = 25.4;
const LABEL_FACE_FONT_SIZE = Math.round((9 * DPI) / 96);

function inchesToMillimeters(inches: number): string {
  return (inches * MM_PER_INCH).toFixed(1);
}

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

interface ProductLabelFields {
  titleLines: string[];
  cond: string;
  color: string;
  data: string;
}

function productFieldsFor(input: PrintProductLabelInput): ProductLabelFields {
  const sku = String(input.sku ?? '').trim();
  const matrix = {
    ...buildUnitPayload({
      sku,
      serialNumber: input.serialNumber?.trim() || null,
      qrPayload: input.qrPayload?.trim() || null,
      gtin: input.gtin?.trim() || null,
    }),
    scale: 4,
  };
  const face = unitLabelToFace({
    sku,
    title: input.title,
    serialNumber: input.serialNumber,
    condition: input.condition,
    color: input.color,
    matrix,
  });
  const title = sanitize(face.topLeft || sku);
  return {
    titleLines: wrap(title, 24, 2),
    cond: sanitize(face.bottomLeft),
    color: sanitize(face.bottomRight),
    data: sanitize(matrix.value),
  };
}

const GS = '\x1d';
const ESC = '\x1b';

function escposQr(data: string): string {
  if (!data) return '';
  const len = data.length + 3;
  const pL = String.fromCharCode(len & 0xff);
  const pH = String.fromCharCode((len >> 8) & 0xff);
  return (
    `${GS}(k\x04\x00\x31\x41\x32\x00` +
    `${GS}(k\x03\x00\x31\x43\x06` +
    `${GS}(k\x03\x00\x31\x45\x31` +
    `${GS}(k${pL}${pH}\x31\x50\x30${data}` +
    `${GS}(k\x03\x00\x31\x51\x30`
  );
}

function productTspl(f: ProductLabelFields, size: PaperSize, copies: number): string {
  const heightIn = size.heightIn > 0 ? size.heightIn : 1;
  const wDots = Math.round(size.widthIn * DPI);
  const hDots = Math.round(heightIn * DPI);
  const padding = 10;
  const dm = Math.min(hDots - padding * 2, Math.round(0.84 * DPI));
  const dmX = Math.max(wDots - dm - padding, padding);
  const infoRight = dmX - 8;

  const L: string[] = [
    `SIZE ${inchesToMillimeters(size.widthIn)} mm,${inchesToMillimeters(heightIn)} mm`,
    'GAP 3.0 mm,0 mm',
    'DIRECTION 1,0',
    'REFERENCE 0,0',
    'DENSITY 10',
    'CODEPAGE 1252',
    'CLS',
  ];
  let y = 10;
  for (const line of f.titleLines) {
    L.push(`TEXT ${padding},${y},"2",0,1,1,"${line}"`);
    y += 26;
  }
  L.push(`TEXT ${padding},${hDots - 37},"3",0,1,1,"${f.cond}"`);
  const colorX = Math.max(padding, infoRight - Math.max(56, f.color.length * 12));
  L.push(`TEXT ${colorX},${hDots - 29},"2",0,1,1,"${f.color}"`);
  if (f.data) L.push(`DMATRIX ${dmX},${padding},${dm},${dm},"${f.data}"`);
  L.push(`PRINT ${Math.max(1, copies)},1`);
  return `${L.join('\r\n')}\r\n`;
}

function productZpl(f: ProductLabelFields, size: PaperSize, copies: number): string {
  const heightIn = size.heightIn > 0 ? size.heightIn : 1;
  const wDots = Math.round(size.widthIn * DPI);
  const hDots = Math.round(heightIn * DPI);
  const dmX = Math.max(wDots - 170, 12);

  const L: string[] = ['^XA', `^PW${wDots}`, `^LL${hDots}`, '^CI28'];
  let y = 12;
  for (const line of f.titleLines) {
    L.push(`^FO12,${y}^A0N,22,22^FD${line}^FS`);
    y += 26;
  }
  L.push(`^FO12,${hDots - 43}^A0N,30,30^FD${f.cond}^FS`);
  L.push(`^FO${Math.round(wDots * 0.45)},${hDots - 33}^A0N,22,22^FD${f.color}^FS`);
  if (f.data) L.push(`^FO${dmX},20^BXN,6,200^FD${f.data}^FS`);
  L.push(`^PQ${Math.max(1, copies)}`);
  L.push('^XZ');
  return `${L.join('\n')}\n`;
}

function productEscpos(f: ProductLabelFields, copies: number): string {
  const body =
    `${ESC}@` +
    `${ESC}a\x01` +
    `${ESC}!\x18${f.titleLines.join('\n')}\n` +
    `${ESC}!\x10${f.cond}   ${f.color}\n` +
    `${ESC}!\x00\n` +
    escposQr(f.data) +
    '\n\n\n' +
    `${GS}V\x01`;
  return body.repeat(Math.max(1, copies));
}

export function buildProductLabelCommands(
  input: PrintProductLabelInput,
  language: LabelLanguage,
  size: PaperSize,
  copies = 1,
): string {
  const f = productFieldsFor(input);
  if (language === 'zpl') return productZpl(f, size, copies);
  if (language === 'escpos') return productEscpos(f, copies);
  if (language === 'none') return '';
  return productTspl(f, size, copies);
}

export function buildProductLabelBitmapCommands(
  input: PrintProductLabelInput,
  size: PaperSize,
  copies = 1,
): Uint8Array {
  if (typeof document === 'undefined') {
    throw new Error('Bitmap label rendering requires a browser document');
  }

  const f = productFieldsFor(input);
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

  const padding = 10;
  const matrixSize = Math.min(height - 32, 164);
  const matrixX = width - matrixSize - padding;
  const infoWidth = matrixX - padding - 8;

  let titleY = 8;
  for (const line of f.titleLines) {
    drawFittedText(context, line, padding, titleY, infoWidth, LABEL_FACE_FONT_SIZE, 700);
    titleY += 22;
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
    f.color,
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
