'use client';

import { Package } from '@/components/Icons';
import { QtyBadge } from '@/components/ui/QtyBadge';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderCloseButton,
  PaneHeaderStatusPill,
  PaneHeaderTabs,
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import type { ShippedActiveSection } from '@/components/shipped/ShippedDetailsPanelContent';
import type { StatusTone } from '@/components/shipped/details-panel/shipped-details-logic';

export interface ShippedDetailsHeaderProps {
  orderIdDisplay: string;
  showExceptionsFallback: boolean;
  copiedOrderId: boolean;
  onCopyOrderId: () => void;
  onClose: () => void;
  quantity: unknown;
  /** Show the status pill (named tester or out-of-stock — real signal only). */
  showStatusPill: boolean;
  statusTone: StatusTone;
  statusLabel: string;
  actions: PaneHeaderActionBarAction[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  hasReturnContent: boolean;
  showCustomerTab: boolean;
  activeSection: ShippedActiveSection;
  onSectionChange: (section: ShippedActiveSection) => void;
}

/**
 * The slide-over header: order-id badge (click-to-copy), close button, and the
 * below-row strip (qty + status pill, the navigation/action bar, and tabs).
 */
export function ShippedDetailsHeader({
  orderIdDisplay,
  showExceptionsFallback,
  copiedOrderId,
  onCopyOrderId,
  onClose,
  quantity,
  showStatusPill,
  statusTone,
  statusLabel,
  actions,
  onMoveUp,
  onMoveDown,
  hasReturnContent,
  showCustomerTab,
  activeSection,
  onSectionChange,
}: ShippedDetailsHeaderProps) {
  return (
    <PaneHeader
      className="shrink-0 border-b-0 bg-white/90 backdrop-blur-xl"
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
      rightSlot={<PaneHeaderCloseButton onClick={onClose} ariaLabel="Close details" />}
      belowSlot={
        <>
          <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
            <QtyBadge quantity={quantity as never} />
            {/* Only surface a status pill when it carries real signal (named
                tester or out-of-stock). Skip when tech scan exists but the
                tester id is missing — that rendered "Tested by Not specified". */}
            {showStatusPill && (
              <PaneHeaderStatusPill tone={statusTone} pulse>
                {statusLabel}
              </PaneHeaderStatusPill>
            )}
          </div>
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
            tabs={[
              ...(hasReturnContent ? [{ value: 'return' as const, label: 'Return' }] : []),
              { value: 'shipping' as const, label: 'Shipping' },
              { value: 'product' as const, label: 'Product' },
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
