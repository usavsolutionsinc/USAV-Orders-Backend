'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Play, Package, Calendar, X, Check, ExternalLink } from './Icons';
import { TabSwitch } from './ui/TabSwitch';
import { ShipByDate } from './ui/ShipByDate';
import { OutOfStockField } from './ui/OutOfStockField';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { PlatformExternalChip } from './ui/PlatformExternalChip';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';

// FBA queue item — one row per FNSKU across all active shipments
interface FBAQueueItem {
  item_id: number;
  shipment_id: number;
  shipment_ref: string;
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  expected_qty: number;
  actual_qty: number;
  status: 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  assigned_tech_name: string | null;
  due_date: string | null;
}

const FBA_ITEM_STATUS_BADGE: Record<string, string> = {
  PLANNED:        'bg-gray-100 text-gray-500 border-gray-200',
  READY_TO_GO:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  LABEL_ASSIGNED: 'bg-blue-100 text-blue-700 border-blue-200',
  SHIPPED:        'bg-purple-100 text-purple-700 border-purple-200',
};

interface Order {
  id: number;
  ship_by_date: string | null;
  created_at: string | null;
  order_id: string;
  product_title: string;
  item_number: string | null;
  account_source: string | null;
  sku: string;
  condition?: string | null;
  quantity?: string | null;
  status: string;
  shipping_tracking_number: string;
  out_of_stock: string | null;
  is_shipped: boolean;
}

interface RepairQueueItem {
  kind: 'REPAIR';
  repairId: number;
  assignmentId: number;
  assignmentStatus: string;
  ticketNumber: string;
  productTitle: string;
  issue: string;
  serialNumber: string;
  contactInfo: string;
  dateTime: string;
  repairStatus: string;
  price: string;
  assignedTechId: number | null;
  techName: string | null;
}

type QueueItem = ({ kind: 'ORDER' } & Order) | RepairQueueItem;

interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
}

export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted }: UpNextOrderProps) {
  const [activeTab, setActiveTab] = useState<'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock'>('orders');
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [allRepairs, setAllRepairs] = useState<RepairQueueItem[]>([]);
  const [fbaItems, setFbaItems] = useState<FBAQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [allCompletedToday, setAllCompletedToday] = useState(false);
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const hasCelebratedRef = useRef(false);

  const getOrderIdLast4 = (orderId: string) => {
    const digits = String(orderId || '').replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
    return String(orderId || '').slice(-4);
  };

  const getDisplayShipByDate = (order: Order) => {
    const shipByRaw = String(order.ship_by_date || '').trim();
    const createdAtRaw = String(order.created_at || '').trim();

    const isInvalidShipBy =
      !shipByRaw ||
      /^\d+$/.test(shipByRaw) ||
      Number.isNaN(new Date(shipByRaw).getTime());

    if (isInvalidShipBy) return createdAtRaw || null;
    return shipByRaw;
  };

  const getDaysLateNumber = (shipByDate: string | null | undefined, fallbackDate?: string | null | undefined) => {
    const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
    const todayKey = getCurrentPSTDateKey();
    if (!shipByKey || !todayKey) return 0;
    const [sy, sm, sd] = shipByKey.split('-').map(Number);
    const [ty, tm, td] = todayKey.split('-').map(Number);
    const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
    const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
    return Math.max(0, todayIndex - shipByIndex);
  };
  const getDaysLateTone = (daysLate: number) => {
    if (daysLate > 1) return 'text-red-600';
    if (daysLate === 1) return 'text-yellow-600';
    return 'text-emerald-600';
  };

  const getOrderBucket = (order: Order): 'orders' | 'returns' | 'test' | 'stock' => {
    const outOfStock = String(order.out_of_stock || '').trim();
    if (outOfStock) return 'stock';

    const orderId = String(order.order_id || '').toLowerCase();
    const accountSource = String(order.account_source || '').toLowerCase();
    const status = String(order.status || '').toLowerCase();
    const sku = String(order.sku || '').toLowerCase();
    const haystack = `${orderId} ${accountSource} ${status} ${sku}`;

    if (/\b(return|returns|rma)\b/.test(haystack)) return 'returns';
    // FBA orders now come from explicit fba_shipments table — no regex needed here
    if (/\b(test|testing|qa|sample)\b/.test(haystack)) return 'test';
    return 'orders';
  };

  const hasTrackingNumber = (order: Order): boolean =>
    String(order.shipping_tracking_number || '').trim().length > 0;

  const tabCounts = {
    ...allOrders.reduce(
      (acc, order) => {
        const bucket = getOrderBucket(order);
        acc[bucket] += 1;
        return acc;
      },
      { orders: 0, returns: 0, repair: 0, fba: 0, test: 0, stock: 0 } as Record<'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock', number>
    ),
    repair: allRepairs.length,
    fba: fbaItems.filter((i) => i.status !== 'SHIPPED').length,
  };

  const visibleTabs: Array<{ id: 'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock'; label: string; color: 'green' | 'yellow' | 'orange' | 'purple' | 'gray' | 'red' }> = [
    { id: 'orders', label: 'Orders', color: 'green' },
    ...(tabCounts.returns > 0 ? [{ id: 'returns' as const, label: 'Returns', color: 'yellow' as const }] : []),
    ...(tabCounts.repair > 0 ? [{ id: 'repair' as const, label: 'Repair', color: 'orange' as const }] : []),
    ...(tabCounts.fba > 0 ? [{ id: 'fba' as const, label: 'FBA', color: 'purple' as const }] : []),
    ...(tabCounts.test > 0 ? [{ id: 'test' as const, label: 'Test', color: 'gray' as const }] : []),
    { id: 'stock', label: 'Stock', color: 'red' },
  ];

  const activeTabVisible = visibleTabs.some((tab) => tab.id === activeTab);
  const effectiveTab = activeTabVisible ? activeTab : visibleTabs[0]?.id || 'orders';
  const orders = allOrders.filter((order) => getOrderBucket(order) === effectiveTab);
  const preferredSequence: Array<'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock'> = ['orders', 'returns', 'repair', 'fba', 'test', 'stock'];

  useEffect(() => {
    if (!activeTabVisible && effectiveTab !== activeTab) {
      setActiveTab(effectiveTab);
    }
  }, [activeTabVisible, effectiveTab, activeTab]);

  useEffect(() => {
    if (orders.length > 0) return;
    const next = preferredSequence.find((id) => tabCounts[id] > 0);
    if (next && next !== activeTab) {
      setActiveTab(next);
    }
  }, [orders.length, activeTab, tabCounts.orders, tabCounts.returns, tabCounts.repair, tabCounts.fba, tabCounts.test, tabCounts.stock]);

  useEffect(() => {
    fetchOrders();
    fetchFbaShipments();
    const interval = setInterval(() => {
      fetchOrders();
      fetchFbaShipments();
    }, 30000);
    return () => clearInterval(interval);
  }, [techId]);

  useEffect(() => {
    if (effectiveTab === 'orders' && allCompletedToday && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      return;
    }
    if (!allCompletedToday) {
      hasCelebratedRef.current = false;
    }
  }, [allCompletedToday, effectiveTab]);

  const fetchFbaShipments = async () => {
    try {
      const res = await fetch('/api/fba/items/queue?limit=100');
      if (res.ok) {
        const data = await res.json();
        setFbaItems(Array.isArray(data?.items) ? data.items : []);
      }
    } catch (error) {
      console.error('Error fetching FBA queue:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const [currentRes, stockRes, repairRes] = await Promise.all([
        fetch(`/api/orders/next?techId=${techId}&all=true&outOfStock=false&assignedOnly=true`),
        fetch(`/api/orders/next?techId=${techId}&all=true&outOfStock=true&assignedOnly=true`),
        fetch(`/api/repair-service/next?techId=${techId}`),
      ]);

      if (currentRes.ok) {
        const currentData = await currentRes.json();
        const currentOrders = (currentData.orders || []).filter(
          (order: Order) => !order.is_shipped && hasTrackingNumber(order)
        );
        const stockData = stockRes.ok ? await stockRes.json() : { orders: [] };
        const stockOrders = (stockData.orders || []).filter(
          (order: Order) => !order.is_shipped && hasTrackingNumber(order)
        );
        const merged = [...currentOrders, ...stockOrders];
        const deduped = merged.filter((row: Order, idx: number, arr: Order[]) =>
          arr.findIndex((cand: Order) => Number(cand.id) === Number(row.id)) === idx
        );
        setAllOrders(deduped);
        setAllCompletedToday(currentData.all_completed || false);
        if (currentData.all_completed && onAllCompleted) {
          onAllCompleted();
        }
      }

      if (repairRes.ok) {
        const repairData = await repairRes.json();
        setAllRepairs(Array.isArray(repairData.repairs) ? repairData.repairs : []);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (order: Order) => {
    try {
      const res = await fetch('/api/orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, techId }),
      });
      if (res.ok) {
        // Pass the shipping tracking number to StationTesting to start the work order
        onStart(order.shipping_tracking_number || order.order_id);
        fetchOrders(); // Fetch next orders
      }
    } catch (error) {
      console.error('Error starting order:', error);
    }
  };

  const handleSkip = async (e: React.MouseEvent, orderId: number) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/orders/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, techId }),
      });
      if (res.ok) {
        fetchOrders();
      }
    } catch (error) {
      console.error('Error skipping order:', error);
    }
  };

  const handleMissingParts = async (orderId: number) => {
    if (!missingPartsReason.trim()) return;
    try {
      const res = await fetch('/api/orders/missing-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          orderId,
          reason: missingPartsReason.trim()
        }),
      });
      if (res.ok) {
        onMissingParts(orderId, missingPartsReason.trim());
        setShowMissingPartsInput(null);
        setMissingPartsReason('');
        fetchOrders(); // Fetch next orders
      }
    } catch (error) {
      console.error('Error marking missing parts:', error);
    }
  };

  const getRepairAge = (dateTime: string): string => {
    if (!dateTime) return '';
    try {
      const parsed = typeof dateTime === 'string' && dateTime.startsWith('"')
        ? JSON.parse(dateTime)
        : dateTime;
      const dt = typeof parsed === 'object' && parsed?.start ? parsed.start : parsed;
      const ms = Date.now() - new Date(dt).getTime();
      const days = Math.floor(ms / 86400000);
      if (days === 0) return 'Today';
      if (days === 1) return '1 day ago';
      return `${days}d ago`;
    } catch {
      return '';
    }
  };

  const renderFbaItemCard = (item: FBAQueueItem) => {
    const badgeCls = FBA_ITEM_STATUS_BADGE[item.status] || FBA_ITEM_STATUS_BADGE['PLANNED'];
    const dueDateStr = item.due_date
      ? new Date(item.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;
    const qtyReady = Number(item.actual_qty) || 0;
    const qtyExpected = Number(item.expected_qty) || 0;

    return (
      <motion.div
        key={`fba-item-${item.item_id}`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="rounded-2xl p-3 border transition-all relative shadow-sm hover:shadow-md mb-2 bg-white border-gray-200 hover:border-purple-300 cursor-default"
      >
        {/* Header: shipment ref + due date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black font-mono text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-2 py-0.5">
              {item.shipment_ref}
            </span>
            {dueDateStr && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] font-bold text-gray-500">{dueDateStr}</span>
              </div>
            )}
          </div>
          <span className={`text-[9px] font-black uppercase tracking-widest border rounded-lg px-2 py-0.5 ${badgeCls}`}>
            {item.status.replace('_', ' ')}
          </span>
        </div>

        {/* Product info */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-black text-gray-700 tabular-nums">{qtyReady}</span>
            <span className="text-[11px] font-black text-gray-400">/</span>
            <span className="text-[13px] font-black text-gray-400">{qtyExpected > 0 ? qtyExpected : '?'}</span>
            <span className="text-[11px] font-black uppercase text-gray-400 tracking-wider">units</span>
            <span className="ml-auto text-[11px] font-mono font-black text-gray-400">{item.fnsku}</span>
          </div>
          <h4 className="text-sm font-black text-gray-900 leading-tight">
            {item.product_title || item.fnsku}
          </h4>
          {item.asin && (
            <p className="text-[10px] font-mono text-gray-400 mt-0.5">{item.asin}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          {item.assigned_tech_name && (
            <span className="text-[10px] font-black text-gray-500 truncate">Tech: {item.assigned_tech_name}</span>
          )}
          <div className="ml-auto h-1.5 w-24 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: qtyExpected > 0 ? `${Math.min(100, Math.round((qtyReady / qtyExpected) * 100))}%` : '0%' }}
            />
          </div>
        </div>
      </motion.div>
    );
  };

  const renderRepairCard = (repair: RepairQueueItem) => {
    const ticketShort = repair.ticketNumber ? repair.ticketNumber.slice(-4) : '????';
    const customerName = repair.contactInfo ? repair.contactInfo.split(',')[0]?.trim() : '';
    const customerPhone = repair.contactInfo ? repair.contactInfo.split(',')[1]?.trim() : '';
    const age = getRepairAge(repair.dateTime);

    const statusColor: Record<string, string> = {
      'Pending Repair': 'bg-amber-100 text-amber-700 border-amber-200',
      'Awaiting Parts': 'bg-orange-100 text-orange-700 border-orange-200',
      'Awaiting Pickup': 'bg-blue-100 text-blue-700 border-blue-200',
      'Repaired, Contact Customer': 'bg-emerald-100 text-emerald-700 border-emerald-200',
      'Awaiting Payment': 'bg-purple-100 text-purple-700 border-purple-200',
    };
    const statusClass = statusColor[repair.repairStatus] || 'bg-gray-100 text-gray-600 border-gray-200';

    const openRepair = () => {
      window.dispatchEvent(new CustomEvent('open-repair-search', { detail: { ticketNumber: repair.ticketNumber, repairId: repair.repairId } }));
    };

    return (
      <motion.div
        key={`repair-${repair.repairId}`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        onClick={openRepair}
        className="rounded-2xl p-3 border-2 border-orange-200 bg-orange-50 hover:border-orange-400 transition-all shadow-sm hover:shadow-md mb-2 cursor-pointer"
      >
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black text-orange-800 bg-white border border-orange-200 rounded-lg px-2 py-0.5">
              #{ticketShort}
            </span>
            {age && (
              <span className="text-[10px] font-bold text-orange-500">{age}</span>
            )}
          </div>
          <span className={`text-[10px] font-black uppercase tracking-wide border rounded-lg px-2 py-0.5 ${statusClass}`}>
            {repair.repairStatus}
          </span>
        </div>

        {/* Product */}
        <h4 className="text-sm font-black text-gray-900 leading-tight mb-1">
          {repair.productTitle || 'Unknown Product'}
        </h4>

        {/* Issue */}
        {repair.issue && (
          <p className="text-[11px] font-semibold text-gray-500 mb-2 line-clamp-2">{repair.issue}</p>
        )}

        {/* Customer + Serial row */}
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-gray-500 mb-3">
          <div className="flex items-center gap-1 min-w-0">
            <span className="truncate">{customerName}</span>
            {customerPhone && <span className="text-gray-400">· {customerPhone}</span>}
          </div>
          {repair.serialNumber && (
            <span className="font-mono text-gray-400 flex-shrink-0">{repair.serialNumber}</span>
          )}
        </div>

        {/* Footer: tech + price + open button */}
        <div className="flex items-center gap-2 pt-2 border-t border-orange-200">
          {repair.techName && (
            <span className="text-[10px] font-black text-orange-700 bg-white border border-orange-200 rounded-lg px-2 py-0.5 truncate flex-1">
              {repair.techName}
            </span>
          )}
          {repair.price && (
            <span className="text-[10px] font-black text-emerald-700">${repair.price}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); openRepair(); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ml-auto"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>
        </div>
      </motion.div>
    );
  };

  const renderOrderCard = (order: Order) => {
    const showActions = effectiveTab !== 'stock';
    const hasOutOfStock = String(order.out_of_stock || '').trim() !== '';
    const quantity = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
    const openDetails = () => {
      const detail: ShippedOrder = {
        id: order.id,
        ship_by_date: order.ship_by_date || '',
        order_id: order.order_id || '',
        product_title: order.product_title || '',
        item_number: order.item_number || null,
        condition: order.condition || '',
        shipping_tracking_number: order.shipping_tracking_number || '',
        serial_number: '',
        sku: order.sku || '',
        tester_id: Number.isFinite(Number(techId)) ? Number(techId) : null,
        tested_by: null,
        test_date_time: null,
        packer_id: null,
        packed_by: null,
        pack_date_time: null,
        packer_photos_url: [],
        tracking_type: null,
        account_source: order.account_source || null,
        notes: '',
        status_history: [],
        is_shipped: !!order.is_shipped,
        created_at: order.created_at || null,
        quantity: order.quantity || '1',
      };
      window.dispatchEvent(new CustomEvent('open-shipped-details', { detail }));
    };
    return (
    <motion.div
      key={order.id}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      onClick={openDetails}
      className="rounded-2xl p-3 border transition-all relative shadow-sm hover:shadow-md mb-2 bg-white border-gray-200 hover:border-blue-300 cursor-pointer"
    >
      {/* Ship By Date & Order ID Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShipByDate
            date={getDisplayShipByDate(order) || ''}
            showPrefix={false}
            className="[&>span]:text-[14px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
          />
          <span className={`text-[14px] font-black ${getDaysLateTone(getDaysLateNumber(order.ship_by_date, order.created_at))}`}>
            {getDaysLateNumber(order.ship_by_date, order.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <PlatformExternalChip
            orderId={order.order_id}
            accountSource={order.account_source}
            canOpen={!!getExternalUrlByItemNumber(order.item_number)}
            onOpen={() => openExternalByItemNumber(order.item_number)}
          />
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[13px] font-black ${quantity > 1 ? 'text-yellow-700' : 'text-gray-800'}`}>
              {quantity}
            </span>
            <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">
              -
            </span>
            <span className={`text-[13px] font-black uppercase truncate ${String(order.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-700' : 'text-gray-800'}`}>
              {order.condition || 'No Condition'}
            </span>
          </div>
          <span className="text-[13px] font-mono font-black text-gray-700 px-1.5 py-0.5 rounded border border-gray-300">
            #{getOrderIdLast4(order.order_id)}
          </span>
        </div>
        <h4 className="text-base font-black text-gray-900 leading-tight">
          {order.product_title}
        </h4>
      </div>

      {hasOutOfStock && (
        <OutOfStockField
          value={String(order.out_of_stock || '')}
          className="mb-4"
        />
      )}

      {hasOutOfStock && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleStart(order);
            }}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
        </div>
      )}

      {/* Action Buttons Row - bottom for safer tapping */}
      {showActions && !hasOutOfStock && (
        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMissingPartsInput(showMissingPartsInput === order.id ? null : order.id);
              }}
              className="flex-1 py-3 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
            >
              Out of Stock
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStart(order);
              }}
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
            >
              <Play className="w-4 h-4" />
              Start
            </button>
          </div>

          <AnimatePresence>
            {showMissingPartsInput === order.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 pt-1">
                  <input
                    type="text"
                    value={missingPartsReason}
                    onChange={(e) => setMissingPartsReason(e.target.value)}
                    placeholder="What parts are missing?"
                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMissingPartsInput(null);
                      }}
                      className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMissingParts(order.id);
                      }}
                      disabled={!missingPartsReason.trim()}
                      className="flex-1 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
    );
  };

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-3 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-20 mb-3"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-1.5">
      {/* Tab Switcher */}
      <TabSwitch
        tabs={visibleTabs}
        activeTab={effectiveTab}
        onTabChange={(tab) => setActiveTab(tab as 'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock')}
      />

      {/* Content Area */}
      {allCompletedToday && effectiveTab === 'orders' ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-emerald-50 rounded-2xl p-5 border-2 border-emerald-200 text-center space-y-3"
        >
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-sm font-black text-emerald-900 uppercase tracking-widest leading-tight">
            All orders have been completed today!
          </h3>
          <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-widest">
            Great job!
          </p>
        </motion.div>
      ) : effectiveTab === 'repair' ? (
        allRepairs.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl px-4 py-3 border border-gray-200">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No repairs in queue</p>
              <Package className="w-5 h-5 text-gray-300 flex-shrink-0" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <AnimatePresence mode="popLayout">
              {allRepairs.map((repair) => renderRepairCard(repair))}
            </AnimatePresence>
          </div>
        )
      ) : effectiveTab === 'fba' ? (
        fbaItems.filter((i) => i.status !== 'SHIPPED').length === 0 ? (
          <div className="bg-purple-50 rounded-2xl px-4 py-3 border border-purple-100">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-purple-400 uppercase tracking-widest">No active FBA items</p>
              <Package className="w-5 h-5 text-purple-200 flex-shrink-0" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <AnimatePresence mode="popLayout">
              {fbaItems
                .filter((i) => i.status !== 'SHIPPED')
                .map((item) => renderFbaItemCard(item))}
            </AnimatePresence>
          </div>
        )
      ) : orders.length === 0 ? (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-2xl px-4 py-3 border border-gray-200">
            {effectiveTab === 'stock' ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No out-of-stock orders</p>
                <Package className="w-5 h-5 text-gray-300 flex-shrink-0" />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No current orders</p>
                <Package className="w-5 h-5 text-gray-300 flex-shrink-0" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <AnimatePresence mode="popLayout">
            {orders.map((order) => renderOrderCard(order))}
          </AnimatePresence>
        </div>
      )}

    </div>
  );
}
