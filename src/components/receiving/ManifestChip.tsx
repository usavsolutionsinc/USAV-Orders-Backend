'use client';

import { CopyChip } from '@/components/ui/CopyChip';
import { Package } from '@/components/Icons';

/**
 * The manifest (preboxed kit) chip — "KIT-… · 3 units". Violet / Package icon so
 * it reads as the *logical kit* identity, distinct from the teal LPN box chip and
 * the emerald serial chip (a unit can be in both a kit AND a box). Tapping copies
 * the `manifest_uid` so it can be pasted into a scan bar.
 */
export interface ManifestChipProps {
  manifestUid: string;
  unitCount?: number | null;
  dense?: boolean;
  width?: string;
}

export function ManifestChip({ manifestUid, unitCount, dense = false, width }: ManifestChipProps) {
  const uid = (manifestUid || '').trim();
  if (!uid) return null;

  const display =
    unitCount != null && Number.isFinite(unitCount)
      ? `${uid} · ${Math.max(0, Math.floor(unitCount))} ${unitCount === 1 ? 'unit' : 'units'}`
      : uid;

  return (
    <CopyChip
      value={uid}
      display={display}
      icon={<Package className="h-4 w-4 shrink-0" />}
      underlineClass="border-violet-500"
      iconClass="text-violet-600"
      truncateDisplay={false}
      width={width}
      dense={dense}
    />
  );
}
