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
  canZohoReceive,
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
  /** Gates "Mark as scanned" (local). */
  canReceive: boolean;
  /** Gates the Zoho "Receive"/"Receive all" option — false for unfound cartons. */
  canZohoReceive: boolean;
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
      // Match the workspace track used by the cards above it.
      maxWidth="max-w-3xl"
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
          label: 'Save all to Zoho',
          icon: <Clipboard className="h-3.5 w-3.5 shrink-0" />,
          onClick: onReceive,
          disabled: !canZohoReceive,
          title: 'Save all received quantities + edits to the Zoho purchase receive (no print)',
        },
        {
          label: receiveMenuLabel,
          icon: <PackageCheck className="h-3.5 w-3.5 shrink-0" />,
          onClick: onReceive,
          disabled: !canZohoReceive,
          title: receiveMenuTitle,
        },
      ]}
    />
  );
}
