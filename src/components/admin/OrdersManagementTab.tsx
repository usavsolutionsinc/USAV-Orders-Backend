'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ExternalLink } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { AdminDetailsStack } from '@/components/shipped/stacks/adminDetailsStack';
import { getOrderPlatformLabel } from '@/utils/order-platform';
import { getOrderIdUrl, getTrackingUrl } from '@/utils/order-links';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { DaysLateBadge } from '@/components/ui/DaysLateBadge';
import { OrderStaffAssignmentButtons } from '@/components/ui/OrderStaffAssignmentButtons';
import { useOrderAssignment } from '@/hooks';
import type { Order, Staff } from './types';

export function OrdersManagementTab() {
  const queryClient = useQueryClient();
  const [filterTab, setFilterTab] = useState<'all' | 'unassigned' | 'assigned' | 'out of stock'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [focusedOrderId, setFocusedOrderId] = useState<number | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [bulkTesterId, setBulkTesterId] = useState<number | null>(null);
  const [bulkPackerId, setBulkPackerId] = useState<number | null>(null);
  const appliedOrderParamRef = useRef(false);
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();

  const { data: ordersData } = useQuery<{ orders: Order[] }>({
    queryKey: ['orders'],
    queryFn: async () => {
      const res = await fetch('/api/orders');
      if (!res.ok) throw new Error('Failed to fetch orders');
      return res.json();
    },
  });

  const allOrders = ordersData?.orders || [];

  const { data: activeStaff = [] } = useQuery<Staff[]>({
    queryKey: ['staff', 'admin-orders-active'],
    queryFn: async () => {
      const res = await fetch('/api/staff?active=true');
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json();
    },
  });

  const orders = allOrders.filter((order) => {
    if (order.is_shipped) return false;
    const normalizedSearchTerm = searchTerm.toLowerCase();
    const matchesTab = (() => {
      if (filterTab === 'out of stock') return order.out_of_stock && (order.is_shipped === false || !order.is_shipped);
      if (filterTab === 'unassigned') return order.packer_id == null && order.tester_id == null;
      if (filterTab === 'assigned') return order.packer_id != null || order.tester_id != null;
      return true;
    })();

    const matchesSearch =
      String(order.product_title || '').toLowerCase().includes(normalizedSearchTerm) ||
      String(order.sku || '').toLowerCase().includes(normalizedSearchTerm) ||
      String(order.order_id || '').toLowerCase().includes(normalizedSearchTerm);

    return matchesTab && matchesSearch;
  });

  const technicianNameOrder = ['michael', 'sang', 'thuc', 'cuong'];
  const packerNameOrder = ['tuan', 'thuy'];
  const testerOptions = technicianNameOrder
    .map((name) => activeStaff.find((member) => member.role === 'technician' && member.name.trim().toLowerCase() === name))
    .filter((member): member is Staff => Boolean(member))
    .map((member) => ({ id: member.id, name: member.name }));
  const packerOptions = packerNameOrder
    .map((name) => activeStaff.find((member) => member.role === 'packer' && member.name.trim().toLowerCase() === name))
    .filter((member): member is Staff => Boolean(member))
    .map((member) => ({ id: member.id, name: member.name }));

  const cuongTesterId =
    activeStaff.find((member) => member.role === 'technician' && member.name.trim().toLowerCase() === 'cuong')?.id ?? null;
  const thuyPackerId =
    activeStaff.find((member) => member.role === 'packer' && member.name.trim().toLowerCase() === 'thuy')?.id ?? null;

  const unassignedRemainingOrderIds = allOrders
    .filter((order) => !order.is_shipped && order.tester_id == null && order.packer_id == null)
    .map((order) => order.id);

  const getStaffNameById = (id: number | null | undefined) => {
    if (!id) return null;
    return activeStaff.find((member) => member.id === id)?.name || null;
  };

  const bulkAssignMutation = useOrderAssignment();
  const rowAssignMutation = useOrderAssignment();

  useEffect(() => {
    if (allOrders.length === 0) return;
    const idsInData = new Set(allOrders.map((order) => order.id));
    setSelectedOrderIds((current) => current.filter((id) => idsInData.has(id)));
    setFocusedOrderId((current) => (current && idsInData.has(current) ? current : null));
  }, [allOrders]);

  useEffect(() => {
    if (appliedOrderParamRef.current) return;
    if (typeof window === 'undefined') return;
    const orderParam = Number(new URLSearchParams(window.location.search).get('orderId'));
    if (!orderParam || Number.isNaN(orderParam) || allOrders.length === 0) return;

    const match = allOrders.find((order) => order.id === orderParam);
    if (!match) return;

    appliedOrderParamRef.current = true;
    setFocusedOrderId(match.id);
    setSelectedOrderIds((current) => (current.includes(match.id) ? current : [...current, match.id]));
    setIsDetailsPanelOpen(true);
  }, [allOrders]);

  const selectedOrder = allOrders.find((order) => order.id === focusedOrderId) || null;

  const openDetailsForOrder = (orderId: number) => {
    setFocusedOrderId(orderId);
    setIsDetailsPanelOpen(true);
  };

  const selectOrder = (orderId: number, openDetailsOnSelect = false) => {
    setSelectedOrderIds((current) => (current.includes(orderId) ? current : [...current, orderId]));
    if (openDetailsOnSelect) {
      openDetailsForOrder(orderId);
    }
  };

  const toggleSelectOrder = (orderId: number, openDetailsOnSelect = false) => {
    const isSelected = selectedOrderIds.includes(orderId);
    setSelectedOrderIds((current) => (isSelected ? current.filter((id) => id !== orderId) : [...current, orderId]));
    if (!isSelected && openDetailsOnSelect) {
      openDetailsForOrder(orderId);
    }
  };

  const handleApplyBulk = async () => {
    if (selectedOrderIds.length === 0) return;
    if (bulkTesterId === null && bulkPackerId === null) return;
    await bulkAssignMutation.mutateAsync({
      orderIds: selectedOrderIds,
      testerId: bulkTesterId,
      packerId: bulkPackerId,
    });
    setSelectedOrderIds([]);
    setFocusedOrderId(null);
    setIsDetailsPanelOpen(false);
  };

  const handleAssignLeftUnassignedToCuongThuy = async () => {
    if (!cuongTesterId || !thuyPackerId) return;
    if (unassignedRemainingOrderIds.length === 0) return;
    await bulkAssignMutation.mutateAsync({
      orderIds: unassignedRemainingOrderIds,
      testerId: cuongTesterId,
      packerId: thuyPackerId,
    });
  };

  const getOrderIdLast4 = (orderId: string) => {
    const digits = String(orderId || '').replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
    return String(orderId || '').slice(-4);
  };

  const getTrackingLast4 = (tracking: string | null) => {
    const raw = String(tracking || '');
    return raw.length > 4 ? raw.slice(-4) : raw || '---';
  };

  const getDisplayShipByDate = (order: Order) => {
    const shipByRaw = String(order.ship_by_date || '').trim();
    const createdAtRaw = String(order.created_at || '').trim();
    const isInvalidShipBy = !shipByRaw || /^\d+$/.test(shipByRaw) || Number.isNaN(new Date(shipByRaw).getTime());
    if (isInvalidShipBy) return createdAtRaw || null;
    return shipByRaw;
  };

  return (
    <div className="flex flex-col lg:flex-row items-start gap-4">
      <div className={`flex-1 space-y-4 min-w-0 transition-all duration-300 ${isDetailsPanelOpen ? 'lg:pr-[430px]' : ''}`}>
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <SearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product title, SKU, or Order ID..."
            className="flex-1 max-w-md w-full"
          />

          <div className="flex gap-2 p-1 bg-white rounded-2xl border border-gray-200 shadow-sm w-fit">
            {(['all', 'unassigned', 'assigned', 'out of stock'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`px-4 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-wider transition-all ${
                  filterTab === tab
                    ? tab === 'out of stock'
                      ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                      : tab === 'unassigned'
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                        : tab === 'assigned'
                          ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                          : 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3 bg-white p-4 rounded-3xl border border-gray-200 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Order Management</h2>
          <div className="ml-auto flex items-center justify-end gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
              {orders.length} shown • {selectedOrderIds.length} selected
            </span>
            <button
              type="button"
              onClick={handleAssignLeftUnassignedToCuongThuy}
              disabled={
                bulkAssignMutation.isPending ||
                !cuongTesterId ||
                !thuyPackerId ||
                unassignedRemainingOrderIds.length === 0
              }
              className="px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-[9px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              Assign Left Unassigned: Cuong + Thuy
            </button>
            <button
              type="button"
              onClick={() => {
                const isAllSelected = orders.length > 0 && selectedOrderIds.length === orders.length;
                if (isAllSelected) {
                  setSelectedOrderIds([]);
                  setFocusedOrderId(null);
                  return;
                }
                setSelectedOrderIds(orders.map((order) => order.id));
              }}
              disabled={orders.length === 0}
              className="px-3 py-1.5 rounded-xl border border-gray-200 text-[9px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {orders.length > 0 && selectedOrderIds.length === orders.length ? 'Unselect All' : 'Select All'}
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {orders.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-3xl border border-gray-200">
              <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No orders found</p>
            </div>
          ) : (
            orders.map((order) => {
              const isSelected = selectedOrderIds.includes(order.id);
              const isFocused = focusedOrderId === order.id;
              const platformLabel = getOrderPlatformLabel(order.order_id, order.account_source) || 'UNKNOWN';
              const isEbayOrder = platformLabel.toLowerCase().includes('ebay');
              const orderUrl = getOrderIdUrl(order.order_id);
              const productPageUrl = getExternalUrlByItemNumber(order.item_number || null);

              return (
                <div
                  key={order.id}
                  className={`text-left bg-white border hover:shadow-sm p-5 rounded-3xl transition-all ${
                    isSelected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'
                  } ${isFocused ? 'shadow-sm' : ''}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOrder(order.id, true)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <ShipByDate date={getDisplayShipByDate(order) || ''} className="h-9 px-3 rounded-lg bg-blue-50 border border-blue-100" />
                        <DaysLateBadge
                          shipByDate={order.ship_by_date}
                          fallbackDate={order.created_at}
                          variant="full"
                          className="h-9 rounded-lg"
                        />
                        <span className="inline-flex items-center h-9 px-3 rounded-lg bg-gray-100 border border-gray-200 text-[10px] font-black text-gray-800">
                          Qty:{Math.max(1, parseInt(String(order.quantity ?? '1'), 10) || 1)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <PlatformExternalChip
                          orderId={order.order_id}
                          accountSource={order.account_source}
                          canOpen={!!productPageUrl}
                          onOpen={() => openExternalByItemNumber(order.item_number || null)}
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const value = order.shipping_tracking_number || '';
                            if (value) navigator.clipboard.writeText(value);
                          }}
                          className="inline-flex items-center h-9 gap-1.5 px-3 rounded-lg bg-blue-50 border border-blue-100 text-[10px] font-black text-blue-700"
                          title="Click to copy tracking number"
                        >
                          <span className="text-[8px] text-blue-400 uppercase">Tracking</span>
                          <span className="font-mono">{getTrackingLast4(order.shipping_tracking_number)}</span>
                          {getTrackingUrl(order.shipping_tracking_number || '') && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = getTrackingUrl(order.shipping_tracking_number || '');
                                if (url) window.open(url, '_blank', 'noopener,noreferrer');
                              }}
                              className="inline-flex items-center justify-center"
                              title="Open tracking in external page"
                              aria-label="Open tracking in external page"
                            >
                              <ExternalLink className="w-3 h-3 text-blue-600" />
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const value = order.order_id || '';
                            if (value) navigator.clipboard.writeText(value);
                          }}
                          className="inline-flex items-center h-9 gap-1.5 px-3 rounded-lg bg-gray-50 border border-gray-100 text-[10px] font-black text-gray-800"
                          title="Click to copy order ID"
                        >
                          <span className="text-[8px] text-gray-400 uppercase">Order</span>
                          <span className="font-mono">#{getOrderIdLast4(order.order_id)}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (orderUrl && !isEbayOrder) {
                                window.open(orderUrl, '_blank', 'noopener,noreferrer');
                              }
                            }}
                            disabled={isEbayOrder || !orderUrl}
                            className="inline-flex items-center justify-center text-blue-600 disabled:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={
                              isEbayOrder
                                ? 'Order page link disabled for eBay orders'
                                : /^\d{3}-\d+-\d+$/.test(order.order_id)
                                  ? 'Open Amazon order in Seller Central in new tab'
                                  : 'Open Ecwid order in new tab'
                            }
                            aria-label={isEbayOrder ? 'Order page link disabled for eBay orders' : 'Open order in external page'}
                          >
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              className="inline-flex items-center justify-center"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </span>
                          </button>
                        </button>
                      </div>
                    </div>

                    {order.out_of_stock && filterTab === 'out of stock' && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500 text-white rounded shadow-sm w-fit">
                        <AlertCircle className="w-3 h-3" />
                        <span className="text-[8px] font-black uppercase tracking-wider">Out of Stock</span>
                      </div>
                    )}

                    <h3 className="text-base font-black text-gray-900 leading-tight">{order.product_title}</h3>

                    <OrderStaffAssignmentButtons
                      testerOptions={testerOptions}
                      packerOptions={packerOptions}
                      testerId={order.tester_id}
                      packerId={order.packer_id}
                      onAssignTester={(staffId) => {
                        rowAssignMutation.mutate({
                          orderId: order.id,
                          testerId: staffId,
                        });
                        selectOrder(order.id, false);
                      }}
                      onAssignPacker={(staffId) => {
                        rowAssignMutation.mutate({
                          orderId: order.id,
                          packerId: staffId,
                        });
                        selectOrder(order.id, false);
                      }}
                      onContainerClick={(e) => e.stopPropagation()}
                      disabled={rowAssignMutation.isPending}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      {isDetailsPanelOpen && (
        <AdminDetailsStack
          order={selectedOrder}
          selectedCount={selectedOrderIds.length}
          testerOptions={testerOptions}
          packerOptions={packerOptions}
          testerName={getStaffNameById(selectedOrder?.tester_id)}
          packerName={getStaffNameById(selectedOrder?.packer_id)}
          bulkTesterId={bulkTesterId}
          bulkPackerId={bulkPackerId}
          onBulkTesterChange={setBulkTesterId}
          onBulkPackerChange={setBulkPackerId}
          onApplyBulk={handleApplyBulk}
          isApplyingBulk={bulkAssignMutation.isPending}
          onClose={() => {
            setIsDetailsPanelOpen(false);
            setFocusedOrderId(null);
          }}
          onOrderUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
          }}
        />
      )}
    </div>
  );
}
