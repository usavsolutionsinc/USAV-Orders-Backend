'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { MarkAsShippedForm } from '@/components/shipped/stacks/MarkAsShippedForm';
import { ShippedNotesComposer } from '@/components/shipped/details-panel/ShippedNotesComposer';
import { ShippedOutOfStockComposer } from '@/components/shipped/details-panel/ShippedOutOfStockComposer';
import type { ShippedActiveInput } from '@/components/shipped/stacks/types';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { getStaffColorHex } from '@/utils/staff-colors';
import { PACKER_IDS } from '@/utils/staff';
import type { StaffRecipient } from '@/components/quick-access/StaffRecipientList';

export interface ShippedPanelEditorDockProps {
  shipped: ShippedOrder;
  activeInput: ShippedActiveInput;
  setActiveInput: React.Dispatch<React.SetStateAction<ShippedActiveInput>>;
  /** Which header actions are available in this panel context. */
  showMarkAsShipped?: boolean;
  showOutOfStock?: boolean;
  showNotes?: boolean;
  notes: string;
  setNotes: (value: string) => void;
  isSavingNotes: boolean;
  onSaveNotes: () => void;
  outOfStock: string;
  setOutOfStock: (value: string) => void;
  isSavingOutOfStock: boolean;
  onSaveOutOfStock: () => void;
  shippingTrackingNumber: string;
  onMarkShippedSuccess: () => void;
}

/**
 * Fixed footer region for header-action editors (mark shipped, out-of-stock,
 * notes). Saved values render as read-only cards here; queue rows show icons.
 */
export function ShippedPanelEditorDock({
  shipped,
  activeInput,
  setActiveInput,
  showMarkAsShipped = false,
  showOutOfStock = false,
  showNotes = true,
  notes,
  setNotes,
  isSavingNotes,
  onSaveNotes,
  outOfStock,
  setOutOfStock,
  isSavingOutOfStock,
  onSaveOutOfStock,
  shippingTrackingNumber,
  onMarkShippedSuccess,
}: ShippedPanelEditorDockProps) {
  const [packerOptions, setPackerOptions] = useState<StaffRecipient[]>([]);

  const savedNotes = String(notes || shipped.notes || '').trim();
  const savedOutOfStock = String(
    outOfStock || (shipped as { out_of_stock?: string }).out_of_stock || '',
  ).trim();
  const hasSavedNotes = savedNotes.length > 0;
  const hasSavedOutOfStock = savedOutOfStock.length > 0;
  const showOutOfStockRegion =
    showOutOfStock && (activeInput === 'out_of_stock' || hasSavedOutOfStock);
  const showNotesRegion = showNotes && (activeInput === 'notes' || hasSavedNotes);
  const hasExpandedEditor = showMarkAsShipped && activeInput === 'mark_shipped';

  const hasDockContent = hasExpandedEditor || showOutOfStockRegion || showNotesRegion;

  useEffect(() => {
    if (!showMarkAsShipped || activeInput !== 'mark_shipped') return;
    let active = true;
    getActiveStaff()
      .then((data: StaffMember[]) => {
        if (!active) return;
        setPackerOptions(
          data
            .slice()
            .sort((a, b) => {
              const ai = PACKER_IDS.indexOf(a.id);
              const bi = PACKER_IDS.indexOf(b.id);
              return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
            })
            .map((member) => ({
              id: member.id,
              name: member.name,
              role: member.role,
              color_hex: getStaffColorHex({ id: member.id }),
            })),
        );
      })
      .catch((error) => console.error('Failed to load packer options:', error));
    return () => {
      active = false;
    };
  }, [activeInput, showMarkAsShipped]);

  if (!hasDockContent) return null;

  return (
    <div className="shrink-0 border-t border-border-soft bg-surface-card/95 backdrop-blur-md">
      <AnimatePresence initial={false}>
        {hasExpandedEditor ? (
          <motion.div
            key="mark-shipped"
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.upNextCollapse}
            className="overflow-hidden"
          >
            <div className="px-8 pt-3 pb-1">
              <MarkAsShippedForm
                shippingTrackingNumber={shippingTrackingNumber || shipped.shipping_tracking_number || ''}
                packerOptions={packerOptions}
                onSuccess={onMarkShippedSuccess}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {showOutOfStockRegion ? (
        activeInput === 'out_of_stock' ? (
          <ShippedOutOfStockComposer
            value={outOfStock}
            onChange={setOutOfStock}
            onCancel={() => {
              setOutOfStock(String((shipped as { out_of_stock?: string }).out_of_stock || ''));
              setActiveInput('none');
            }}
            onSubmit={onSaveOutOfStock}
            isSaving={isSavingOutOfStock}
          />
        ) : (
          <ShippedOutOfStockComposer
            value={savedOutOfStock}
            readOnly
            onClick={() => setActiveInput('out_of_stock')}
          />
        )
      ) : null}

      {showNotesRegion ? (
        activeInput === 'notes' ? (
          <ShippedNotesComposer
            value={notes}
            onChange={setNotes}
            onCancel={() => {
              setNotes(shipped.notes || '');
              setActiveInput('none');
            }}
            onSubmit={onSaveNotes}
            isSaving={isSavingNotes}
          />
        ) : (
          <ShippedNotesComposer
            value={savedNotes}
            readOnly
            onClick={() => setActiveInput('notes')}
          />
        )
      ) : null}
    </div>
  );
}
