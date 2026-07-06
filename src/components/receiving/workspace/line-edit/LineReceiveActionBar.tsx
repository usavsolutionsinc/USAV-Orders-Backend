'use client';

import { Clipboard, PackageCheck, Printer } from '@/components/Icons';
import { FloatingButton } from '@/design-system/primitives';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

/**
 * Floating action button for the line editor. Primary action is
 * "Receive" (printer icon implies print); the split menu exposes print-only, mark-as-scanned, and
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
  isLocalReceive = false,
  receiveMenuLabel,
  receiveMenuTitle,
  onPrintAndReceive,
  onPrintOnly,
  onMarkScanned,
  onReceive,
  onLocalReceive,
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
  /**
   * Unfound carton — there is no Zoho PO to receive against. Hides "Save all to
   * Zoho" and routes "Receive all" through the local (no-Zoho) receive path.
   */
  isLocalReceive?: boolean;
  receiveMenuLabel: string;
  receiveMenuTitle?: string;
  onPrintAndReceive: () => void;
  onPrintOnly: () => void;
  onMarkScanned: () => void;
  onReceive: () => void;
  /** Receive all open lines locally (RECEIVED, Zoho untouched) — no print. */
  onLocalReceive: () => void;
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
        // "Save all to Zoho" only makes sense for matched cartons — hidden for an
        // unfound carton, which has no Zoho PO to save against.
        ...(isLocalReceive
          ? []
          : [
              {
                label: 'Save all to Zoho',
                icon: <Clipboard className="h-3.5 w-3.5 shrink-0" />,
                onClick: onReceive,
                disabled: !canZohoReceive,
                title: 'Save all received quantities + edits to the Zoho purchase receive (no print)',
              },
            ]),
        {
          label: receiveMenuLabel,
          icon: <PackageCheck className="h-3.5 w-3.5 shrink-0" />,
          // Unfound → receive all locally (RECEIVED, Zoho untouched), gated on the
          // local receive precondition; matched → the Zoho receive.
          onClick: isLocalReceive ? onLocalReceive : onReceive,
          disabled: isLocalReceive ? !canReceive : !canZohoReceive,
          title: isLocalReceive
            ? 'Receive all open lines locally — external inventory is not touched'
            : receiveMenuTitle,
        },
      ]}
    />
  );
}
