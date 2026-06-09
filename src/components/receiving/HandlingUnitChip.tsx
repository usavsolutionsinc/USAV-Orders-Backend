'use client';

import { CopyChip } from '@/components/ui/CopyChip';
import { Package } from '@/components/Icons';
import { handlingUnitHandle } from '@/lib/barcode-routing';

/**
 * The LPN (handling-unit) chip — "Box H-123 · 4 units". Teal / Package icon so
 * it reads as the *physical box* identity, visually distinct from the gray PO
 * chip and the blue tracking chip (the operator always sees both "which
 * receipt" and "which box"). Tapping copies the `H-{id}` handle so it can be
 * pasted into a scan bar.
 *
 * Pass either `code` (e.g. an external tote barcode) or `handlingUnitId` (mints
 * the `H-{id}` handle). `unitCount`, when set, renders the "· N units" suffix.
 */
export interface HandlingUnitChipProps {
  handlingUnitId?: number | null;
  code?: string | null;
  unitCount?: number | null;
  dense?: boolean;
  width?: string;
}

export function HandlingUnitChip({
  handlingUnitId,
  code,
  unitCount,
  dense = false,
  width,
}: HandlingUnitChipProps) {
  const handle =
    (code && code.trim()) ||
    (handlingUnitId != null ? handlingUnitHandle(handlingUnitId) : '');
  if (!handle) return null;

  const display =
    unitCount != null && Number.isFinite(unitCount)
      ? `${handle} · ${Math.max(0, Math.floor(unitCount))} ${unitCount === 1 ? 'unit' : 'units'}`
      : handle;

  return (
    <CopyChip
      value={handle}
      display={display}
      icon={<Package className="h-4 w-4 shrink-0" />}
      underlineClass="border-teal-500"
      iconClass="text-teal-600"
      truncateDisplay={false}
      width={width}
      dense={dense}
    />
  );
}
