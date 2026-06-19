import { gs1UnitAi, serialUnitHandle } from '@/lib/barcode-routing';
import { buildFaceInfoHtml, type LabelFaceModel } from '@/lib/print/labelFace';
import { CONDITION_GRADES, conditionLabel } from '@/lib/conditions';

function conditionChipLabel(grade: string | null | undefined): string {
  const c = String(grade ?? '').trim().toUpperCase();
  if (!(CONDITION_GRADES as readonly string[]).includes(c)) return '';
  return conditionLabel(c, 'label');
}

export function buildUnitPayload(args: {
  sku: string;
  serialNumber: string | null;
  qrPayload?: string | null;
  gtin?: string | null;
}): { value: string; symbology: 'gs1datamatrix' | 'datamatrix' } {
  if (args.qrPayload && args.qrPayload.trim()) {
    const v = args.qrPayload.trim();
    const looksLikeAi = /\((?:01|21|10|17|414|254)\)/.test(v);
    return { value: v, symbology: looksLikeAi ? 'gs1datamatrix' : 'datamatrix' };
  }
  if (args.gtin && args.serialNumber) {
    return {
      value: gs1UnitAi({ gtin: args.gtin, serial: args.serialNumber }),
      symbology: 'gs1datamatrix',
    };
  }
  if (args.serialNumber) {
    return { value: serialUnitHandle(args.serialNumber), symbology: 'datamatrix' };
  }
  return { value: args.sku, symbology: 'datamatrix' };
}

export type PrintProductLabelInput = {
  sku: string;
  title?: string;
  serialNumber?: string;
  qrPayload?: string;
  gtin?: string;
  condition?: string | null;
  color?: string | null;
};

export function unitLabelToFace(input: {
  sku: string;
  title?: string | null;
  serialNumber?: string | null;
  condition?: string | null;
  color?: string | null;
  matrix: LabelFaceModel['matrix'];
}): LabelFaceModel {
  const title = (input.title ?? '').trim();
  return {
    kind: 'product',
    topLeft: title || input.sku,
    topRight: '',
    center: '',
    bottomLeft: conditionChipLabel(input.condition),
    bottomRight: (input.color ?? '').trim(),
    matrix: input.matrix,
  };
}

export function productLabelFace(input: PrintProductLabelInput) {
  const sku = input.sku?.trim();
  if (!sku) return null;
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
  return { sku, matrix, face, ...buildFaceInfoHtml(face) };
}
