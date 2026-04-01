import type { ScanHandlerContext } from './types';

/**
 * Handles colon-format SKU scans (e.g. "PROD-123:A" or "SKUx2:tag").
 *
 * Flow (mirrors GAS Tech-sheet colon handler):
 *  1. Require an active or recently-scanned order as the anchor.
 *  2. POST to /api/tech/scan-sku with the full colon code, tracking, and salId.
 *  3. Server looks up serial(s) from sku.serial_number, inserts them via SAL context,
 *     decrements sku_stock, and writes shipping_tracking_number back to the sku row.
 *  4. Update the active order card with the new serial list.
 */
export async function handleSkuScan(input: string, ctx: ScanHandlerContext): Promise<void> {
  const contextOrder = ctx.reopenScanContextOrder();

  if (!contextOrder) {
    ctx.setErrorMessage('Scan a tracking number or FNSKU first, then scan the SKU code');
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
    return;
  }

  ctx.setIsLoading(true);
  try {
    const res = await fetch('/api/tech/scan-sku', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode: input,
        tracking: contextOrder.tracking,
        salId: contextOrder.salId ?? null,
        techId: ctx.userId,
        scanSessionId: (contextOrder.scanSessionId ?? ctx.scanSessionIdRef.current) || undefined,
        idempotencyKey: ctx.newIdempotencyKey(),
      }),
    });

    const data = await res.json();

    if (!data.success) {
      ctx.setErrorMessage(data.error || 'SKU not found');
      return;
    }

    const nextSerials = Array.isArray(data.updatedSerials)
      ? data.updatedSerials
      : contextOrder.serialNumbers;

    // Accumulate every storage SKU code scanned during this session so the
    // details panel can show which physical bins were pulled.
    const matchedSku = typeof data.matchedSku === 'string' ? data.matchedSku : input.split(':')[0].trim();
    const prevSkuCodes = contextOrder.scannedSkuCodes ?? [];
    const nextSkuCodes = prevSkuCodes.includes(matchedSku)
      ? prevSkuCodes
      : [...prevSkuCodes, matchedSku];

    ctx.syncActiveOrderState({
      ...contextOrder,
      serialNumbers: nextSerials,
      scannedSkuCodes: nextSkuCodes,
      scanSessionId:
        typeof data.scanSessionId === 'string'
          ? data.scanSessionId
          : contextOrder.scanSessionId ?? ctx.scanSessionIdRef.current,
    });

    const addedCount = Array.isArray(data.serialNumbers) ? data.serialNumbers.length : 0;
    const titleSuffix = data.productTitle ? ` · ${data.productTitle}` : '';
    const notesSuffix = data.notes ? ' · Notes on file' : '';
    ctx.setSuccessMessage(
      addedCount > 0
        ? `SKU matched — added ${addedCount} serial${addedCount !== 1 ? 's' : ''} · Stock: −${data.quantityDecremented}${titleSuffix}${notesSuffix}`
        : `SKU matched — Stock: −${data.quantityDecremented}${titleSuffix}${notesSuffix}`,
    );

    if (data.notes) {
      setTimeout(() => alert(`Notes for SKU:\n\n${data.notes}`), 150);
    }

    ctx.queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
    ctx.triggerGlobalRefresh();
  } catch (e) {
    console.error('SKU scan error:', e);
    ctx.setErrorMessage('Failed to process SKU scan');
  } finally {
    ctx.setIsLoading(false);
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
  }
}
