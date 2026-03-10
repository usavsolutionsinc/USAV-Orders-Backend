'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Play } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import type { Order } from './upnext-types';

function getOrderIdLast4(orderId: string) {
  const digits = String(orderId || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(orderId || '').slice(-4);
}

function getDisplayShipByDate(order: Order) {
  const shipByRaw   = String(order.ship_by_date || '').trim();
  const createdAtRaw = String(order.created_at || '').trim();
  const isInvalid   = !shipByRaw || /^\d+$/.test(shipByRaw) || Number.isNaN(new Date(shipByRaw).getTime());
  return isInvalid ? createdAtRaw || null : shipByRaw;
}

function getDaysLateNumber(shipByDate: string | null | undefined, fallbackDate?: string | null) {
  const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
  const todayKey  = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;
  const [sy, sm, sd] = shipByKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
  const todayIndex  = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - shipByIndex);
}

function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

interface OrderCardProps {
  order: Order;
  effectiveTab: string;
  techId: string;
  showMissingPartsInput: number | null;
  missingPartsReason: string;
  onStart: (order: Order) => void;
  onMissingPartsToggle: (orderId: number) => void;
  onMissingPartsReasonChange: (reason: string) => void;
  onMissingPartsSubmit: (orderId: number) => void;
  onMissingPartsCancel: () => void;
}

export function OrderCard({
  order,
  effectiveTab,
  techId,
  showMissingPartsInput,
  missingPartsReason,
  onStart,
  onMissingPartsToggle,
  onMissingPartsReasonChange,
  onMissingPartsSubmit,
  onMissingPartsCancel,
}: OrderCardProps) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const showActions   = effectiveTab !== 'stock';
  const isStockTab    = effectiveTab === 'stock';
  const hasOutOfStock = String(order.out_of_stock || '').trim() !== '';
  const quantity      = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);

  const openDetails = () => {
    const detail: ShippedOrder = {
      id:                       order.id,
      ship_by_date:             order.ship_by_date || '',
      order_id:                 order.order_id || '',
      product_title:            order.product_title || '',
      item_number:              order.item_number || null,
      condition:                order.condition || '',
      shipping_tracking_number: order.shipping_tracking_number || '',
      serial_number:            '',
      sku:                      order.sku || '',
      tester_id:                Number.isFinite(Number(techId)) ? Number(techId) : null,
      tested_by:                null,
      test_date_time:           null,
      packer_id:                null,
      packed_by:                null,
      pack_date_time:           null,
      packer_photos_url:        [],
      tracking_type:            null,
      account_source:           order.account_source || null,
      notes:                    '',
      status_history:           [],
      is_shipped:               !!order.is_shipped,
      created_at:               order.created_at || null,
      quantity:                 order.quantity || '1',
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
      className={`rounded-2xl p-3 border-2 transition-all relative shadow-sm hover:shadow-md mb-2 cursor-pointer ${
        isStockTab
          ? 'bg-white border-red-300 hover:border-red-500'
          : 'bg-white border-gray-300 hover:border-gray-500'
      }`}
    >
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
        <PlatformExternalChip
          orderId={order.order_id}
          accountSource={order.account_source}
          canOpen={!!getExternalUrlByItemNumber(order.item_number)}
          onOpen={() => openExternalByItemNumber(order.item_number)}
        />
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-black text-gray-900">{quantity}</span>
            <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">-</span>
            <span className="text-[13px] font-black uppercase truncate text-gray-900">
              {order.condition || 'No Condition'}
            </span>
          </div>
          <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
            #{getOrderIdLast4(order.order_id)}
          </span>
        </div>
        <h4 className="text-base font-black text-gray-900 leading-tight">{order.product_title}</h4>
      </div>

      {hasOutOfStock && <OutOfStockField value={String(order.out_of_stock || '')} className="mb-4" />}

      {hasOutOfStock && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={(e) => { e.stopPropagation(); onStart(order); }}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
        </div>
      )}

      {showActions && !hasOutOfStock && (
        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); onMissingPartsToggle(order.id); }}
              className="flex-1 py-3 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
            >
              Out of Stock
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onStart(order); }}
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
                    onChange={(e) => onMissingPartsReasonChange(e.target.value)}
                    placeholder="What parts are missing?"
                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onMissingPartsCancel(); }}
                      className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onMissingPartsSubmit(order.id); }}
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
}
