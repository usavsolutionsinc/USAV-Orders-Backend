import type { useUpNextController } from '@/hooks/station/useUpNextController';
import { RepairCard } from './RepairCard';
import { FbaItemCard } from './FbaItemCard';
import { ReceivingAssignmentCard } from './ReceivingAssignmentCard';
import { EmptySlate, SectionHeader } from './UpNextOrderPieces';

type UpNextController = ReturnType<typeof useUpNextController>;

interface AllSection {
  id: string;
  label: string;
  headerColor: 'orange' | 'purple' | 'red';
  count: number;
  render: () => React.ReactNode;
}

/** The primary tab content — one big switch over `effectiveTab`. */
export function UpNextTabContent({
  ctrl,
  techId,
  isFiltering,
  allSections,
  renderRows,
  renderOrderCard,
}: {
  ctrl: UpNextController;
  techId: string;
  isFiltering: boolean;
  allSections: AllSection[];
  renderRows: (children: React.ReactNode) => React.ReactNode;
  renderOrderCard: (order: any, key?: string, effectiveOrderTab?: 'orders' | 'stock') => React.ReactNode;
}) {
  const {
    effectiveTab, filteredOrders, filteredStockOrders, filteredRepairs,
    filteredFbaItems, filteredReceivingItems,
    expandedItemKey, toggleExpandedItem, showNoCurrentOrdersBanner,
  } = ctrl;

  if (effectiveTab === 'stock') {
    return filteredStockOrders.length === 0 ? (
      <EmptySlate label={isFiltering ? 'No results' : 'No out-of-stock orders'} color="red" />
    ) : (
      <>{renderRows(
        filteredStockOrders.map((order) => (
          renderOrderCard(order, `stock-${order.id}`, 'stock')
        ))
      )}</>
    );
  }

  if (effectiveTab === 'all') {
    return allSections.length === 0 ? (
      isFiltering ? (
        <EmptySlate label="No results" color="gray" />
      ) : showNoCurrentOrdersBanner ? (
        <EmptySlate label="No current orders" color="green" />
      ) : (
        <EmptySlate label="No current work" color="green" />
      )
    ) : (
      <>
        {showNoCurrentOrdersBanner && (
          <div className="mb-3">
            <EmptySlate label="No current orders" color="green" />
          </div>
        )}
        {allSections.map((section, index) => (
          <div key={section.id} className={index === 0 ? '' : 'mt-3'}>
            {(index > 0 || showNoCurrentOrdersBanner) && (
              <SectionHeader label={section.label} color={section.headerColor} />
            )}
            {renderRows(section.render())}
          </div>
        ))}
      </>
    );
  }

  if (effectiveTab === 'repair') {
    return filteredRepairs.length === 0 ? (
      <EmptySlate label={isFiltering ? 'No results' : 'No repairs in queue'} />
    ) : (
      <>{renderRows(
        filteredRepairs.map((repair) => (
          <RepairCard
            key={repair.repairId}
            repair={repair}
            techId={techId}
            isExpanded={expandedItemKey === `repair-${repair.repairId}`}
            onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
          />
        ))
      )}</>
    );
  }

  if (effectiveTab === 'fba') {
    return filteredFbaItems.length === 0 ? (
      <EmptySlate label={isFiltering ? 'No results' : 'No FBA plan items'} color={isFiltering ? 'gray' : 'purple'} />
    ) : (
      <>{renderRows(
        filteredFbaItems.map((item) => (
          <FbaItemCard
            key={item.item_id}
            item={item}
            isExpanded={expandedItemKey === `fba-${item.item_id}`}
            onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
          />
        ))
      )}</>
    );
  }

  if (effectiveTab === 'receiving') {
    return filteredReceivingItems.length === 0 ? (
      <EmptySlate label={isFiltering ? 'No results' : 'No receiving items assigned'} color={isFiltering ? 'gray' : 'teal'} />
    ) : (
      <>{renderRows(
        filteredReceivingItems.map((item) => (
          <ReceivingAssignmentCard key={item.assignment_id} item={item} />
        ))
      )}</>
    );
  }

  return filteredOrders.length === 0 ? (
    <>
      <EmptySlate label={isFiltering ? 'No results' : 'No current orders'} color={isFiltering ? 'gray' : 'green'} />
      {!isFiltering && filteredRepairs.length > 0 && (
        <div className="mt-3">
          <SectionHeader label="Repair Service" />
          {renderRows(
            filteredRepairs.map((repair) => (
              <RepairCard
                key={`orders-repair-${repair.repairId}`}
                repair={repair}
                techId={techId}
                isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
              />
            ))
          )}
        </div>
      )}
    </>
  ) : (
    <>{renderRows(
      filteredOrders.map((order) => (
        renderOrderCard(order)
      ))
    )}</>
  );
}
