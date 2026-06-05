'use client';

import { Clipboard, PackageCheck, Printer } from '@/components/Icons';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

/**
 * Bottom sticky action bar for the line editor. Primary action is
 * "Print · receive"; the split menu exposes print-only, mark-as-scanned, and
 * receive-without-print. The primary button is tinted with the assigned tech's
 * station theme when one is set.
 */
export function LineReceiveActionBar({
  assignedTechId,
  primaryLabel,
  primaryTitle,
  primaryDisabled,
  splitMenuAriaLabel,
  splitMenuHoverTitle,
  canPrint,
  canReceive,
  receiveMenuLabel,
  receiveMenuTitle,
  onPrintAndReceive,
  onPrintOnly,
  onMarkScanned,
  onReceive,
}: {
  assignedTechId: number | null | undefined;
  primaryLabel: string;
  primaryTitle: string;
  primaryDisabled: boolean;
  splitMenuAriaLabel: string;
  splitMenuHoverTitle: string;
  canPrint: boolean;
  canReceive: boolean;
  receiveMenuLabel: string;
  receiveMenuTitle?: string;
  onPrintAndReceive: () => void;
  onPrintOnly: () => void;
  onMarkScanned: () => void;
  onReceive: () => void;
}) {
  const techTheme =
    assignedTechId != null ? stationThemeColors[getStaffThemeById(assignedTechId)] : null;
  return (
    <StickyActionBar
      primaryFullWidth
      primary={{
        label: primaryLabel,
        onClick: onPrintAndReceive,
        disabled: primaryDisabled,
        title: primaryTitle,
        icon: <Printer className="h-4 w-4 shrink-0" />,
        toneClasses: {
          bg: techTheme?.bg ?? 'bg-emerald-600',
          hover: techTheme?.hover ?? 'hover:bg-emerald-700',
        },
        menuLabel: splitMenuAriaLabel,
        menuTitle: splitMenuHoverTitle,
        menu: [
          {
            label: 'Print only',
            icon: <Printer className="h-3.5 w-3.5 shrink-0" />,
            onClick: onPrintOnly,
            disabled: !canPrint,
          },
          {
            label: 'Mark as scanned',
            icon: <Clipboard className="h-3.5 w-3.5 shrink-0" />,
            onClick: onMarkScanned,
            disabled: !canReceive,
            title: 'Save quantities as Scanned only; skip Zoho purchase receive (no print)',
          },
          {
            label: receiveMenuLabel,
            icon: <PackageCheck className="h-3.5 w-3.5 shrink-0" />,
            onClick: onReceive,
            disabled: !canReceive,
            title: receiveMenuTitle,
          },
        ],
      }}
    />
  );
}
