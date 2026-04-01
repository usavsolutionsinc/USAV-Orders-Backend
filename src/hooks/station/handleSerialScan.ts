import confetti from 'canvas-confetti';
import { classifyInput, findSerialInCatalog, looksLikeFnsku } from '@/lib/scan-resolver';
import type { ScanHandlerContext } from './types';

export async function handleSerialScan(input: string, ctx: ScanHandlerContext): Promise<void> {
  const contextOrder = ctx.reopenScanContextOrder();

  if (!contextOrder) {
    // No active order — add the serial to the last scanned tracking via SAL resolution.
    // The endpoint finds the most recent TRACKING_SCANNED SAL for this tech, inserts
    // the serial into tech_serial_numbers, and returns the order info to restore the card.
    ctx.setIsLoading(true);
    try {
      const res = await fetch('/api/tech/add-serial-to-last', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: input.toUpperCase(),
          techId: ctx.userId,
          scanSessionId: ctx.scanSessionIdRef.current || undefined,
          idempotencyKey: ctx.newIdempotencyKey(),
        }),
      });
      const data = await res.json();

      if (!data.success) {
        ctx.setErrorMessage(data.error || 'Failed to add serial');
        return;
      }

      ctx.syncActiveOrderState({
        id: data.order.id ?? null,
        orderId: data.order.orderId,
        productTitle: data.order.productTitle,
        itemNumber: data.order.itemNumber ?? null,
        sku: data.order.sku,
        condition: data.order.condition,
        notes: data.order.notes,
        tracking: data.order.tracking,
        serialNumbers: data.serialNumbers,
        testDateTime: null,
        testedBy: null,
        quantity: data.order.quantity || 1,
        shipByDate: data.order.shipByDate ?? null,
        createdAt: data.order.createdAt ?? null,
        orderFound: data.order.orderFound !== false,
        scanSessionId:
          typeof data.scanSessionId === 'string'
            ? data.scanSessionId
            : ctx.scanSessionIdRef.current,
      });

      ctx.setSuccessMessage(`Serial ${input.toUpperCase()} added ✓ (${data.serialNumbers.length} total)`);
      if (data.isComplete) {
        confetti({ particleCount: 100, spread: 70 });
      }
      ctx.queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
      ctx.triggerGlobalRefresh();
    } catch (err) {
      console.error('Add serial to last error:', err);
      ctx.setErrorMessage('Network error occurred');
    } finally {
      ctx.setIsLoading(false);
      ctx.setInputValue('');
      ctx.inputRef.current?.focus();
    }
    return;
  }

  // ── Partial serial resolution ────────────────────────────────────────────────
  // classifyInput returns serial_partial for ≤10-char inputs. Try to expand the
  // partial by suffix-matching it against already-scanned serials on this order.
  // Exactly one match → use the full canonical serial. Zero or multiple → passthrough.
  const { type: scanKind } = classifyInput(input);
  let finalSerial = input.toUpperCase();
  if (scanKind === 'serial_partial' && contextOrder.serialNumbers.length > 0) {
    const { matchType, matches } = findSerialInCatalog(input, contextOrder.serialNumbers);
    if (matchType !== 'none' && matches.length === 1) {
      finalSerial = matches[0].toUpperCase();
      ctx.setSuccessMessage(`Partial matched → ${finalSerial}`);
    } else if (matches.length > 1) {
      ctx.setErrorMessage(`Partial "${input}" is ambiguous — ${matches.length} serials match. Scan the full serial.`);
      ctx.setInputValue('');
      ctx.inputRef.current?.focus();
      return;
    }
  }

  const trk = String(contextOrder.tracking || '').trim();
  const isFbaDuplicateAllowedTracking = looksLikeFnsku(trk) || /^FBA/i.test(trk);

  ctx.setIsLoading(true);
  try {
    const sessionForSerial = (contextOrder.scanSessionId ?? ctx.scanSessionIdRef.current) || undefined;
    const res = await fetch('/api/tech/add-serial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracking: contextOrder.tracking,
        serial: finalSerial,
        techId: ctx.userId,
        allowFbaDuplicates: isFbaDuplicateAllowedTracking,
        scanSessionId: sessionForSerial,
        idempotencyKey: ctx.newIdempotencyKey(),
      }),
    });

    const data = await res.json();

    if (!data.success) {
      ctx.setErrorMessage(data.error || 'Failed to add serial');
      return;
    }

    const nextOrder = {
      ...contextOrder,
      serialNumbers: data.serialNumbers,
      scanSessionId:
        typeof data.scanSessionId === 'string'
          ? data.scanSessionId
          : contextOrder.scanSessionId ?? ctx.scanSessionIdRef.current,
    };

    // FBA/FNSKU orders always have orderFound=false (they don't map to an orders row),
    // so exclude them from the exception-card auto-clear logic. Without this, the card
    // disappears after the first serial and subsequent serials lose context.
    const qty = Math.max(1, Number(nextOrder.quantity) || 1);
    const completedExceptionOrder =
      nextOrder.orderFound === false &&
      nextOrder.sourceType !== 'fba' &&
      nextOrder.serialNumbers.length >= qty;

    if (completedExceptionOrder) {
      ctx.syncActiveOrderState(null);
    } else {
      ctx.syncActiveOrderState(nextOrder);
    }

    ctx.setSuccessMessage(`Serial ${finalSerial} added ✓ (${data.serialNumbers.length} total)`);

    if (data.isComplete) {
      confetti({ particleCount: 100, spread: 70 });
    }

    ctx.queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
    ctx.triggerGlobalRefresh();
  } catch (e) {
    console.error('Add serial error:', e);
    ctx.setErrorMessage('Network error occurred');
  } finally {
    ctx.setIsLoading(false);
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
  }
}
