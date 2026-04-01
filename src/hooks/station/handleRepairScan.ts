import type { ScanHandlerContext } from './types';

function parseRepairServiceId(value: string): number | null {
  const match = value.trim().toUpperCase().match(/^RS-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function handleRepairScan(input: string, ctx: ScanHandlerContext): Promise<void> {
  const repairId = parseRepairServiceId(input);
  if (!repairId) {
    ctx.setErrorMessage('Invalid repair service barcode');
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
    return;
  }

  ctx.setIsLoading(true);
  try {
    const res = await fetch('/api/tech/scan-repair-station', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repairScan: input.trim(),
        repairId,
        techId: ctx.userId,
        userName: ctx.userName || null,
        idempotencyKey: ctx.newIdempotencyKey(),
      }),
    });
    const data = await res.json();

    if (!res.ok || !data?.success || !data?.repair?.id) {
      ctx.setErrorMessage(data?.error || 'Repair not found');
      return;
    }

    const repair = data.repair;
    if (typeof data.scanSessionId === 'string' && data.scanSessionId) {
      ctx.scanSessionIdRef.current = data.scanSessionId;
    }

    window.dispatchEvent(new CustomEvent('open-repair-details', {
      detail: {
        repairId: Number(repair.id),
        assignmentId: null,
        assignedTechId: null,
      },
    }));
    ctx.setSuccessMessage(`Repair loaded: RS-${repair.id}`);
    ctx.clearManuals();
  } catch (error) {
    console.error('Repair scan failed:', error);
    ctx.setErrorMessage('Failed to load repair');
  } finally {
    ctx.setIsLoading(false);
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
  }
}
