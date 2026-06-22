'use client';

import { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { framerPresence, framerTransition, staggerRevealContainer } from '@/design-system';
import { OrderCard } from './station/upnext/OrderCard';
import { RepairCard } from './station/upnext/RepairCard';
import { FbaItemCard } from './station/upnext/FbaItemCard';
import { ReceivingAssignmentCard } from './station/upnext/ReceivingAssignmentCard';
import { UpNextFilterBar } from './station/upnext/UpNextFilterBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from './ui/HorizontalButtonSlider';
import { QUICK_FILTER_ITEMS, SORT_FILTER_IDS, type UpNextTabId } from '@/utils/upnext-shared';
import { useUpNextController } from '@/hooks/station/useUpNextController';
import {
  UP_NEXT_TAB_ICONS,
  HIDDEN_PILL_IDS,
  HIDDEN_SECTION_IDS,
  type TabId,
  type UpNextOrderProps,
} from './station/upnext/upnext-order-shared';
import { useUpNextOrderActions } from './station/upnext/useUpNextOrderActions';
import { UpNextLoadingSkeleton } from './station/upnext/UpNextLoadingSkeleton';
import { UpNextTabContent } from './station/upnext/UpNextTabContent';
import { ScanToPreviewInput } from './station/upnext/ScanToPreviewInput';
import { SectionHeader } from './station/upnext/UpNextOrderPieces';

export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted, filterBarPortalRef }: UpNextOrderProps) {
  const ctrl = useUpNextController({ techId, onAllCompleted });

  // Destructure controller for convenience
  const {
    effectiveTab, visibleTabs, selectTab, rawTabCounts,
    searchText, setSearchText, quickFilter, setQuickFilter,
    sortedOrders, filteredOrders, filteredStockOrders, filteredRepairs,
    filteredFbaItems, filteredReceivingItems,
    nonStockOrders, stockOrders,
    loading,
    expandedItemKey, toggleExpandedItem,
    lateCount, dueTodayCount, shouldShowStockSection, showNoCurrentOrdersBanner,
  } = ctrl;
  const tabCounts = rawTabCounts;

  const { selectedOrderId } = useUpNextOrderActions(ctrl, { techId, onStart, onMissingParts });

  // Map controller-supplied tabs to HorizontalButtonSlider's `nav` shape:
  // icons + counts; uniform blue active state matches the global sidebar.
  // Pills hidden per HIDDEN_PILL_IDS (does NOT affect "all"-view content).
  const sliderItems: HorizontalSliderItem[] = useMemo(
    () =>
      visibleTabs
        .filter((tab) => !HIDDEN_PILL_IDS.has(tab.id as UpNextTabId))
        .map((tab) => ({
          id: tab.id,
          label: tab.label,
          count: tab.count,
          icon: UP_NEXT_TAB_ICONS[tab.id as UpNextTabId],
        })),
    [visibleTabs],
  );

  const renderOrderCard = (order: any, key?: string, effectiveOrderTab?: 'orders' | 'stock') => (
    <OrderCard
      key={key || order.id}
      order={order}
      effectiveTab={effectiveOrderTab || effectiveTab}
      techId={techId}
      isSelected={selectedOrderId === order.id}
    />
  );

  const isFiltering = Boolean(searchText.trim() || (quickFilter !== 'all' && !SORT_FILTER_IDS.has(quickFilter)));
  const renderRows = useCallback(
    (children: React.ReactNode) => {
      if (isFiltering) {
        return <div className="flex flex-col">{children}</div>;
      }
      // The container orchestrates the cascade; each card opts into the matching
      // stagger-reveal entrance via `entrance="stagger"` on its CardShell, so the
      // queue arrives with the same spring as the station scan bar.
      return (
        <motion.div
          variants={staggerRevealContainer()}
          initial="hidden"
          animate="show"
          className="flex flex-col"
        >
          {/* `initial` enabled so the first-load cascade plays; without it
              AnimatePresence suppresses the children's initial mount animation. */}
          <AnimatePresence mode="popLayout">
            {children}
          </AnimatePresence>
        </motion.div>
      );
    },
    [isFiltering],
  );

  const allSections = [
    {
      id: 'orders',
      label: 'Pending Orders',
      headerColor: 'orange' as const,
      count: sortedOrders.length,
      render: () => (
        <>
          {sortedOrders.map((order) => renderOrderCard(order))}
        </>
      ),
    },
    {
      id: 'fba',
      label: 'FBA Plan Items',
      headerColor: 'purple' as const,
      count: filteredFbaItems.length,
      render: () => (
        <>
          {filteredFbaItems.map((item) => (
            <FbaItemCard
              key={item.item_id}
              item={item}
              isExpanded={expandedItemKey === `fba-${item.item_id}`}
              onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
            />
          ))}
        </>
      ),
    },
    {
      id: 'repair',
      label: 'Repair Service',
      headerColor: 'orange' as const,
      count: filteredRepairs.length,
      render: () => (
        <>
          {filteredRepairs.map((repair) => (
            <RepairCard
              key={`repair-${repair.repairId}`}
              repair={repair}
              techId={techId}
              isExpanded={expandedItemKey === `repair-${repair.repairId}`}
              onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
            />
          ))}
        </>
      ),
    },
    {
      id: 'receiving',
      label: 'Receiving',
      headerColor: 'orange' as const,
      count: filteredReceivingItems.length,
      render: () => (
        <>
          {filteredReceivingItems.map((item) => (
            <ReceivingAssignmentCard key={item.assignment_id} item={item} />
          ))}
        </>
      ),
    },
  ].filter((section) => section.count > 0 && !HIDDEN_SECTION_IDS.has(section.id as UpNextTabId));

  if (loading) {
    return <UpNextLoadingSkeleton />;
  }

  return (
    <div className="relative flex flex-col">
        {/* ── Sticky tab bar — pinned above scrolling card list. Uses the
              shared HorizontalButtonSlider (nav variant) so /tech's Up Next
              switcher matches the global sidebar's view switcher.
              Suppressed entirely when no tabs survive HIDDEN_UP_NEXT_TAB_IDS
              filtering (e.g., when only orders are present). ── */}
        <div className="sticky top-0 z-10 bg-white pb-0.5">
          {sliderItems.length > 0 ? (
            <HorizontalButtonSlider
              items={sliderItems}
              value={effectiveTab}
              onChange={(id) => selectTab(id as TabId)}
              variant="nav"
              aria-label="Up Next tabs"
            />
          ) : null}

          {/* ── Urgency summary bar ── */}
          <AnimatePresence initial={false}>
            {tabCounts.all > 0 && (lateCount > 0 || dueTodayCount > 0) && (
              <motion.div
                {...framerPresence.collapseHeight}
                transition={framerTransition.upNextCollapse}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 px-1 pt-0.5">
                  {lateCount > 0 && (
                    <span className="flex items-center gap-1 text-eyebrow font-black uppercase tracking-widest text-red-500">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                      {lateCount} late
                    </span>
                  )}
                  {lateCount > 0 && dueTodayCount > 0 && (
                    <span className="text-gray-500 text-eyebrow">·</span>
                  )}
                  {dueTodayCount > 0 && (
                    <span className="flex items-center gap-1 text-eyebrow font-black uppercase tracking-widest text-amber-500">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {dueTodayCount} due today
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Primary tab content ── */}
        <div>
          <UpNextTabContent
            ctrl={ctrl}
            techId={techId}
            isFiltering={isFiltering}
            allSections={allSections}
            renderRows={renderRows}
            renderOrderCard={renderOrderCard}
          />
        </div>

        {shouldShowStockSection && (
          <div className="mt-3">
            <SectionHeader label="Out Of Stock" />
            {renderRows(
              filteredStockOrders.map((order) => (
                renderOrderCard(order, `stock-${order.id}`, 'stock')
              ))
            )}
          </div>
        )}

        {/* ── Filter bar ── */}
        {tabCounts[effectiveTab] > 0 && (() => {
          const filterBar = (
            <div className="md:hidden bg-white/90 backdrop-blur-sm border-t border-gray-100 px-1 py-1.5">
              <UpNextFilterBar
                searchText={searchText}
                onSearchChange={setSearchText}
                quickFilter={quickFilter}
                onQuickFilterChange={setQuickFilter}
                quickFilterItems={QUICK_FILTER_ITEMS[effectiveTab]}
                quickFilterVariant={QUICK_FILTER_ITEMS[effectiveTab].some((i) => i.tone) ? 'fba' : 'slate'}
                placeholder={`Search ${visibleTabs.find((t) => t.id === effectiveTab)?.label ?? ''}...`}
              />
            </div>
          );
          if (filterBarPortalRef?.current) return createPortal(filterBar, filterBarPortalRef.current);
          return <div className="sticky bottom-0 left-0 right-0 z-10">{filterBar}</div>;
        })()}

        {/* ── Scan-to-preview — floats at the bottom of the sidebar (desktop
              only). Stays visible while the queue scrolls so the tech can
              jump to any order without scrolling for it. Separate from the
              top-of-page scan-to-start bar; this surface is strictly
              view-only and triggers the same preview action as a card click. ── */}
        <div className="sticky bottom-0 left-0 right-0 z-20 -mx-1 mt-2 hidden md:block">
          <div className="pointer-events-none absolute inset-x-0 -top-3 h-3 bg-gradient-to-t from-white to-transparent" />
          <div className="bg-white/95 px-1 pb-1.5 pt-1 backdrop-blur-sm">
            <ScanToPreviewInput orders={[...nonStockOrders, ...stockOrders]} />
          </div>
        </div>

    </div>
  );
}
