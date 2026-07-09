'use client';

import { Package, Search } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderCloseButton,
  PaneHeaderTabs,
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import type { ShippedActiveSection } from '@/components/shipped/ShippedDetailsPanelContent';

export interface ShippedDetailsHeaderProps {
  orderIdDisplay: string;
  showExceptionsFallback: boolean;
  copiedOrderId: boolean;
  onCopyOrderId: () => void;
  onClose: () => void;
  actions: PaneHeaderActionBarAction[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  showCustomerTab: boolean;
  /** Outbound documents (label + slip) get their own tab on labels/fulfillment/staged contexts. */
  showDocumentsTab: boolean;
  activeSection: ShippedActiveSection;
  onSectionChange: (section: ShippedActiveSection) => void;
  /** Opens the full-page order view (/o/[id]). Omitted → the magnifier hides. */
  onOpenFullPage?: () => void;
}

/**
 * The slide-over header: order-id badge (click-to-copy), close button, action
 * bar, and section tabs.
 */
export function ShippedDetailsHeader({
  orderIdDisplay,
  showExceptionsFallback,
  copiedOrderId,
  onCopyOrderId,
  onClose,
  actions,
  onMoveUp,
  onMoveDown,
  showCustomerTab,
  showDocumentsTab,
  activeSection,
  onSectionChange,
  onOpenFullPage,
}: ShippedDetailsHeaderProps) {
  return (
    <PaneHeader
      className="shrink-0 border-b-0 bg-surface-card/90 backdrop-blur-xl"
      rowClassName="px-6"
      leftSlot={
        <>
          <PaneHeaderIconBadge Icon={Package} bg="bg-blue-600" tint="text-white" />
          <PaneHeaderLabel
            eyebrow={showExceptionsFallback ? 'Exceptions' : 'Order #'}
            value={
              <HoverTooltip label={copiedOrderId ? 'Copied' : 'Click to copy'} asChild>
                {/* ds-raw-button: text-left inline value (click-to-copy order id), not a styled CTA */}
                <button
                  type="button"
                  onClick={onCopyOrderId}
                  className="truncate text-left transition-colors hover:text-blue-700"
                  aria-label={`Copy ${orderIdDisplay}`}
                >
                  {orderIdDisplay}
                  {copiedOrderId && <span className="ml-1 text-emerald-600">✓</span>}
                </button>
              </HoverTooltip>
            }
            valueTitle={orderIdDisplay}
          />
        </>
      }
      rightSlot={
        <div className="flex items-center gap-1">
          {onOpenFullPage ? (
            <HoverTooltip label="Open full order page" asChild>
              <IconButton
                icon={<Search className="h-4 w-4" />}
                onClick={onOpenFullPage}
                ariaLabel="Open full order page"
                className="rounded-md p-1.5 hover:bg-surface-sunken"
              />
            </HoverTooltip>
          ) : null}
          <PaneHeaderCloseButton onClick={onClose} ariaLabel="Close details" />
        </div>
      }
      belowSlot={
        <>
          <div className="px-6 py-2">
            <PaneHeaderActionBar
              iconOnly
              variant="card"
              actions={actions}
              onPrev={onMoveUp}
              onNext={onMoveDown}
              prevTitle="Move up a row"
              nextTitle="Move down a row"
            />
          </div>
          <PaneHeaderTabs<ShippedActiveSection>
            dense
            tabs={[
              { value: 'shipping' as const, label: 'Shipping' },
              { value: 'product' as const, label: 'Product' },
              ...(showDocumentsTab ? [{ value: 'documents' as const, label: 'Documents' }] : []),
              { value: 'timeline' as const, label: 'Timeline' },
              ...(showCustomerTab ? [{ value: 'customer' as const, label: 'Customer' }] : []),
            ]}
            value={activeSection}
            onChange={onSectionChange}
            className="px-6"
          />
        </>
      }
    />
  );
}
