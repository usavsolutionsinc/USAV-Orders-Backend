'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Unlink, Link2, Package, Loader2 } from '@/components/Icons';
import { tableHeader, microBadge } from '@/design-system/tokens/typography/presets';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UnpairedItem {
  item_number: string;
  account_source: string | null;
  product_title: string | null;
  sku: string | null;
  order_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

interface PairedEntry {
  id: number;
  sku_catalog_id: number;
  platform: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  account_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface CatalogInfo {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  platform_ids: PairedEntry[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function platformLabel(platform: string): string {
  const p = platform.toLowerCase();
  if (p.startsWith('ebay')) return 'eBay';
  if (p === 'amazon' || p === 'amazon_fba') return p === 'amazon_fba' ? 'Amazon FBA' : 'Amazon';
  if (p === 'walmart') return 'Walmart';
  if (p === 'ecwid') return 'Ecwid';
  if (p === 'zoho') return 'Zoho';
  return platform;
}

function platformBadgeClass(platform: string): string {
  const p = platform.toLowerCase();
  if (p.startsWith('ebay')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  if (p === 'amazon' || p === 'amazon_fba') return 'bg-orange-50 text-orange-700 border-orange-200';
  if (p === 'walmart') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (p === 'ecwid') return 'bg-purple-50 text-purple-700 border-purple-200';
  if (p === 'zoho') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
}

// ─── Row variants (matches FbaFnskuChecklist) ────────────────────────────────

const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.16 } },
};

// ─── Status dot (matches FbaFnskuChecklist) ──────────────────────────────────

function PairingStatusDot({ paired }: { paired: boolean }) {
  if (paired) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100" title="Paired">
        <Check className="h-2.5 w-2.5 text-emerald-600" />
      </span>
    );
  }
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" title="Needs pairing" />;
}

// ─── Shimmer skeleton (matches FbaFnskuChecklist) ────────────────────────────

function ShimmerRows({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-50 px-4 py-2.5">
          <div className="space-y-1.5">
            <motion.div
              animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }}
              className="h-3 w-40 rounded bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 bg-[length:200%_100%]"
            />
            <div className="h-2 w-24 rounded bg-gray-100" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-5 w-14 rounded bg-gray-100" />
            <div className="h-5 w-20 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface SkuPairingProductTableProps {
  /** Currently selected unpaired item from the sidebar */
  selectedItem: UnpairedItem | null;
}

export function SkuPairingProductTable({ selectedItem }: SkuPairingProductTableProps) {
  const [unpaired, setUnpaired] = useState<UnpairedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load all unpaired items for the table view
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/sku-catalog/unpaired?limit=500');
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setUnpaired(data.items || []);
          setTotal(data.total || 0);
        }
      } catch {
        if (!cancelled) setUnpaired([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Listen for pair events to refresh
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener('sku-pairing-updated', handler);
    return () => window.removeEventListener('sku-pairing-updated', handler);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Column header — matches FbaFnskuChecklist column header */}
      <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-gray-200 bg-white/95 px-4 backdrop-blur-sm">
        <div className="w-6 shrink-0" />
        <p className={`min-w-0 flex-1 ${tableHeader}`}>Product / Item Number</p>
        <p className={`w-20 text-center ${tableHeader}`}>Platform</p>
        <p className={`w-16 text-right ${tableHeader}`}>Orders</p>
        <p className={`w-20 text-center ${tableHeader}`}>Status</p>
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {loading ? (
          <ShimmerRows count={8} />
        ) : unpaired.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-emerald-200 bg-emerald-50">
              <Package className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="text-sm font-semibold text-gray-700">All items paired</p>
            <p className="max-w-sm text-xs leading-5 text-gray-500">
              Every order item number has been linked to a Zoho SKU. New unpaired items will appear here as orders come in.
            </p>
          </motion.div>
        ) : (
          <AnimatePresence initial={false}>
            {unpaired.map((item, idx) => {
              const isHighlighted = selectedItem?.item_number === item.item_number;
              return (
                <motion.div
                  key={`${item.item_number}-${item.account_source}`}
                  variants={rowVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ delay: idx * 0.015 }}
                  layout
                  className={`flex items-center gap-2 border-b border-gray-100 px-4 py-3 transition-colors ${
                    isHighlighted
                      ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-200'
                      : idx % 2 === 0
                        ? 'bg-white hover:bg-gray-50/50'
                        : 'bg-gray-50/30 hover:bg-gray-50/70'
                  }`}
                >
                  {/* Status dot */}
                  <div className="w-6 shrink-0 flex items-center justify-center">
                    <PairingStatusDot paired={false} />
                  </div>

                  {/* Product info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[12px] font-semibold text-gray-900">
                        {item.product_title || 'Unknown Product'}
                      </p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-gray-500">
                      <span className="font-mono">{item.item_number}</span>
                      {item.sku && (
                        <>
                          <span className="opacity-40">-</span>
                          <span className="font-mono text-gray-400">{item.sku}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Platform badge */}
                  <div className="w-20 flex items-center justify-center">
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 ${microBadge} ${platformBadgeClass(item.account_source || '')}`}>
                      {platformLabel(item.account_source || 'unknown')}
                    </span>
                  </div>

                  {/* Order count */}
                  <div className="w-16 text-right">
                    <span className={`font-mono text-[13px] font-black tabular-nums ${item.order_count > 5 ? 'text-amber-600' : 'text-gray-900'}`}>
                      {item.order_count}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="w-20 flex items-center justify-center">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 ${microBadge} bg-amber-100 text-amber-700`}>
                      UNPAIRED
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
