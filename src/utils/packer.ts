import { detectCarrier, type Carrier } from '@/lib/tracking-format';
import { classifyInput, looksLikeFnsku } from '@/lib/scan-resolver';
import { normalizeSku } from '@/utils/sku';

export type TrackingType = 'FNSKU' | 'SKU' | 'CLEAN' | 'FBA' | 'ORDERS';

export interface ScanClassification {
  trackingType: TrackingType;
  carrier: Carrier;
  normalizedInput: string;
  skuBase?: string;
  skuQty?: number;
  skuStatic?: string;
  cleanSize?: 'BIG' | 'MEDIUM' | 'SMALL';
}

const SKU_COLON_RE = /:/;
const CLEAN_RE = /clean\s*(big|medium|small)/i;
const FBA_RE = /^FBA-/i;

export function classifyScan(input: string): ScanClassification {
  const raw = String(input || '').trim();
  const normalizedInput = raw.replace(/\s+/g, ' ').trim();
  const carrier = detectCarrier(normalizedInput);

  if (SKU_COLON_RE.test(normalizedInput)) {
    const [leftPart, ...restParts] = normalizedInput.split(':');
    const rightPart = restParts.join(':').trim();
    let skuLeft = String(leftPart || '').trim();
    let qty = 1;
    const xMatch = skuLeft.match(/^(.+?)\s*[xX]\s*(\d+)$/);
    if (xMatch) {
      skuLeft = String(xMatch[1] || '').trim();
      qty = parseInt(String(xMatch[2] || '1'), 10) || 1;
    }
    const skuBase = normalizeSku(skuLeft);
    const skuStatic = rightPart ? `${skuBase}:${rightPart}` : undefined;
    return { trackingType: 'SKU', carrier, normalizedInput, skuBase, skuQty: qty, skuStatic };
  }

  const cleanMatch = normalizedInput.match(CLEAN_RE);
  if (cleanMatch) {
    const size = cleanMatch[1].toUpperCase() as 'BIG' | 'MEDIUM' | 'SMALL';
    return { trackingType: 'CLEAN', carrier, normalizedInput, cleanSize: size };
  }

  // Use the canonical FNSKU detector from scan-resolver
  if (looksLikeFnsku(normalizedInput)) {
    return { trackingType: 'FNSKU', carrier, normalizedInput };
  }

  if (FBA_RE.test(normalizedInput)) {
    return { trackingType: 'FBA', carrier, normalizedInput };
  }

  // Use classifyInput for tracking detection instead of manual carrier checks
  const { type } = classifyInput(normalizedInput);
  if (type === 'tracking') {
    return { trackingType: 'ORDERS', carrier, normalizedInput };
  }

  return { trackingType: 'ORDERS', carrier, normalizedInput };
}
