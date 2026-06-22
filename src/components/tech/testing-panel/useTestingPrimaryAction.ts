'use client';

import { useEffect } from 'react';
import { unitStatusToVerdict } from '@/components/receiving/workspace/TestingStatusPills';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';

export interface TestingPrimaryAction {
  primaryDisabled: boolean;
  primaryLabel: string;
  primaryTitle: string;
}

/**
 * View-model for the "Pass · Print Label" floating action: derives its
 * enabled/label/tooltip from the active serial's verdict + line state, and wires
 * the bare-Enter shortcut (ignored while typing in a field) to fire it.
 */
export function useTestingPrimaryAction(c: TestingController, row: ReceivingLineRow): TestingPrimaryAction {
  const { activeSerial, isPrinting, saving, handlePrimary } = c;
  const activeVerdict = unitStatusToVerdict(activeSerial?.current_status);
  const hasSku = Boolean((row.sku || '').trim());
  const hasActiveSerial = activeSerial != null;

  const primaryDisabled =
    !hasActiveSerial || activeVerdict !== 'PASS' || isPrinting || saving || !hasSku || row.receiving_id == null;

  const primaryTitle = row.receiving_id == null
    ? 'Line is not linked to a carton'
    : !hasSku
      ? 'Line has no SKU — link a product before printing'
      : !hasActiveSerial
        ? 'Scan a serial for this slot before printing'
        : activeVerdict == null
          ? 'Pick a testing verdict for this unit first'
          : activeVerdict !== 'PASS'
            ? 'Only Pass produces a label — Test Again re-queues; Testing Failed opens claim'
            : 'Print one tested-OK label for this unit (Enter)';

  const primaryLabel = isPrinting
    ? 'Printing…'
    : !hasSku
      ? 'Pass · No SKU'
      : !hasActiveSerial
        ? 'Pass · No Serial'
        : 'Pass · Print Label';

  // Bare Enter (not while typing) fires the primary action.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (primaryDisabled || isPrinting) return;
      event.preventDefault();
      void handlePrimary();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [primaryDisabled, isPrinting, handlePrimary]);

  return { primaryDisabled, primaryLabel, primaryTitle };
}
