'use client';

import { Clipboard, PackageCheck, Printer } from '@/components/Icons';
import { FloatingButton } from '@/design-system/primitives';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

/**
 * Floating action button for the line editor. Primary action is
 * "Print · receive"; the split menu exposes print-only, mark-as-scanned, and
 * receive-without-print. The pill floats fixed at the bottom of the page (via
 * the `FloatingButton` primitive) and is tinted with the assigned tech's
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
    <FloatingButton
      label={primaryLabel}
      title={primaryTitle}
      disabled={primaryDisabled}
      onClick={onPrintAndReceive}
      icon={<Printer className="h-4 w-4 shrink-0" />}
      // 45rem = 720px — the LineEditPanel cards' rendered width (max-w-3xl
      // column minus its px-6 gutters). FloatingButton applies its own px
      // OUTSIDE the max-width container, so passing max-w-3xl here made the
      // pill 48px wider than the cards above it.
      maxWidth="max-w-[45rem]"
      fullWidth
      tone="emerald"
      toneClasses={
        techTheme ? { bg: techTheme.bg, hover: techTheme.hover } : undefined
      }
      menuLabel={splitMenuAriaLabel}
      menuTitle={splitMenuHoverTitle}
      menu={[
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
      ]}
    />
  );
}
