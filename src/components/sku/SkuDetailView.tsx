'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Plus,
  Minus,
  MapPin,
  Camera,
  Package,
  ExternalLink,
  History,
  Edit,
  Check,
  X,
  Copy,
  Loader2,
} from '@/components/Icons';
import {
  sectionLabel,
  fieldLabel,
  dataValue,
  monoValue,
  cardTitle,
} from '@/design-system/tokens/typography/presets';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkuDetailData {
  sku: string;
  productTitle: string | null;
  productImage: string | null;
  stock: { id: number | null; qty: number };
  catalog: {
    id: number;
    category: string | null;
    upc: string | null;
    ean: string | null;
    imageUrl: string | null;
    isActive: boolean;
  } | null;
  ecwid: {
    id: string;
    name: string;
    sku: string;
    price: number | null;
    thumbnailUrl: string | null;
    inStock: boolean;
    description: string | null;
  } | null;
  history: Array<{
    id: number;
    static_sku: string | null;
    serial_number: string | null;
    shipping_tracking_number: string | null;
    notes: string | null;
    location: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  photos: Array<{
    id: number;
    skuId: number;
    url: string;
    photoType: string | null;
    takenByStaffId: number | null;
    createdAt: string;
  }>;
  ledger: Array<{
    id: number;
    sku: string;
    delta: number;
    reason: string;
    staff_id: number | null;
    created_at: string;
  }>;
  locations: string[];
  allLocations: Array<{
    id: number;
    name: string;
    room: string | null;
    description: string | null;
    barcode: string | null;
    sort_order: number;
  }>;
  transfers: Array<{
    id: number;
    entity_type: string;
    entity_id: number;
    sku: string;
    from_location: string | null;
    to_location: string;
    staff_id: number | null;
    notes: string | null;
    created_at: string;
  }>;
}

const REASON_OPTIONS = [
  'RECEIVED',
  'SOLD',
  'DAMAGED',
  'ADJUSTMENT',
  'RETURNED',
  'CYCLE_COUNT',
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

interface SkuDetailViewProps {
  sku: string;
  /** 'panel' = slide-in overlay (used from SkuBrowser), 'page' = full-page layout */
  variant?: 'panel' | 'page';
  /** Called when panel close button is clicked (panel variant only) */
  onClose?: () => void;
}

export default function SkuDetailView({ sku, variant = 'page', onClose }: SkuDetailViewProps) {
  const router = useRouter();
  const [data, setData] = useState<SkuDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Stock adjustment
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState<string>('ADJUSTMENT');
  const [showSetMode, setShowSetMode] = useState(false);
  const [absoluteQty, setAbsoluteQty] = useState('');

  // Location
  const [editingLocation, setEditingLocation] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');

  // Photo lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Copied feedback
  const [copiedField, setCopiedField] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/sku-stock/${encodeURIComponent(sku)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
      setData(json);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Failed to load SKU detail');
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const patchStock = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/sku-stock/${encodeURIComponent(sku)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json?.error || 'Update failed');
        }
        await fetchData();
        setAdjustDelta(0);
        setAbsoluteQty('');
        setShowSetMode(false);
      } catch (err: any) {
        setError(err?.message || 'Update failed');
      } finally {
        setSaving(false);
      }
    },
    [sku, fetchData],
  );

  const handleAdjust = (delta: number) => {
    patchStock({ action: 'adjust', delta, reason: adjustReason });
  };

  const handleSetAbsolute = () => {
    const qty = parseInt(absoluteQty, 10);
    if (!isFinite(qty) || qty < 0) return;
    patchStock({ action: 'set', absoluteQty: qty, reason: 'SET' });
  };

  const handleLocationSave = () => {
    if (!selectedLocation.trim()) return;
    patchStock({ action: 'location', location: selectedLocation.trim() });
    setEditingLocation(false);
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField((c) => (c === field ? '' : c)), 1200);
    } catch { /* clipboard denied */ }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch { return d; }
  };

  // ── Loading / Error states ──

  const isPanel = variant === 'panel';

  const handleClose = () => {
    if (onClose) onClose();
    else router.push('/sku-stock');
  };

  const wrapPanel = (content: React.ReactNode) => {
    if (!isPanel) return content;
    return (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-[100] flex h-screen w-[420px] max-w-full flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
        {content}
      </motion.div>
    );
  };

  if (loading) {
    return wrapPanel(
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-gray-600">Loading SKU detail...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return wrapPanel(
      <div className="flex h-full flex-col items-center justify-center bg-gray-50 px-6">
        <p className="mb-4 text-sm font-bold text-red-600">{error}</p>
        <button
          onClick={handleClose}
          className="text-sm font-bold text-blue-600 underline"
        >
          Back to SKU Stock
        </button>
      </div>
    );
  }

  if (!data) return isPanel ? wrapPanel(null) : null;

  // Group DB locations by room for the dropdown
  const locationsByRoom = (data.allLocations || []).reduce<Record<string, typeof data.allLocations>>((acc, loc) => {
    const room = loc.room || 'Other';
    if (!acc[room]) acc[room] = [];
    acc[room].push(loc);
    return acc;
  }, {});

  const allLocationNames = (data.allLocations || []).map((l) => l.name);

  return wrapPanel(
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <button
          onClick={handleClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          aria-label={isPanel ? 'Close' : 'Back'}
        >
          {isPanel ? <X className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={`${cardTitle} truncate`}>
            {data.productTitle || data.sku}
          </h1>
          <button
            onClick={() => handleCopy(data.sku, 'sku')}
            className={`${monoValue} text-[11px] text-gray-500 hover:text-blue-600 transition-colors flex items-center gap-1`}
          >
            {data.sku}
            {copiedField === 'sku' ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
        {data.ecwid?.price != null && (
          <div className="text-right">
            <p className="text-lg font-black text-gray-900">
              ${data.ecwid.price.toFixed(2)}
            </p>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${data.ecwid.inStock ? 'text-emerald-600' : 'text-red-500'}`}>
              {data.ecwid.inStock ? 'In Stock' : 'Out of Stock'}
            </p>
          </div>
        )}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
        {/* ── Product Hero ── */}
        {data.productImage && (
          <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
            <img
              src={data.productImage}
              alt={data.productTitle || data.sku}
              className="w-full h-48 object-contain bg-gray-50"
              loading="eager"
            />
          </div>
        )}

        {/* ── Stock Card ── */}
        <div className="rounded-xl bg-white border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className={sectionLabel}>Stock Quantity</h2>
            <button
              onClick={() => setShowSetMode(!showSetMode)}
              className="text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800"
            >
              {showSetMode ? 'Quick Adjust' : 'Set Exact'}
            </button>
          </div>

          {error && (
            <p className="mb-2 text-xs font-bold text-red-500">{error}</p>
          )}

          {showSetMode ? (
            /* Set absolute quantity */
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={absoluteQty}
                onChange={(e) => setAbsoluteQty(e.target.value)}
                placeholder={String(data.stock.qty)}
                className="h-10 w-24 rounded-lg border border-gray-300 px-3 text-center text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleSetAbsolute}
                disabled={saving || !absoluteQty}
                className="h-10 px-4 rounded-lg bg-blue-600 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Set'}
              </button>
            </div>
          ) : (
            /* Quick +/- adjustment */
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
                <button
                  onClick={() => handleAdjust(-1)}
                  disabled={saving}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-40 transition-colors"
                  aria-label="Decrease stock"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="w-16 text-center">
                  <span className="text-2xl font-black text-gray-900">
                    {data.stock.qty}
                  </span>
                </div>
                <button
                  onClick={() => handleAdjust(1)}
                  disabled={saving}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm hover:bg-emerald-50 disabled:opacity-40 transition-colors"
                  aria-label="Increase stock"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* Bulk adjust */}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={adjustDelta || ''}
                  onChange={(e) => setAdjustDelta(parseInt(e.target.value, 10) || 0)}
                  placeholder="±"
                  className="h-10 w-16 rounded-lg border border-gray-300 px-2 text-center text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => adjustDelta !== 0 && handleAdjust(adjustDelta)}
                  disabled={saving || adjustDelta === 0}
                  className="h-10 px-3 rounded-lg bg-gray-900 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-40"
                >
                  Apply
                </button>
              </div>

              {/* Reason selector */}
              <select
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="h-10 rounded-lg border border-gray-300 px-2 text-xs font-bold text-gray-700 focus:border-blue-500"
              >
                {REASON_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Location Card ── */}
        <div className="rounded-xl bg-white border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className={sectionLabel}>
              <MapPin className="inline h-3 w-3 mr-1" />
              Location
            </h2>
            {!editingLocation && (
              <button
                onClick={() => {
                  setEditingLocation(true);
                  setSelectedLocation(data.locations[0] || '');
                }}
                className="text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800"
              >
                Change
              </button>
            )}
          </div>

          {editingLocation ? (
            <div className="flex items-center gap-2">
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500"
              >
                <option value="">Select location...</option>
                {Object.entries(locationsByRoom).map(([room, locs]) => (
                  <optgroup key={room} label={room}>
                    {locs.map((loc) => (
                      <option key={loc.id} value={loc.name}>{loc.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input
                type="text"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                placeholder="Or type custom..."
                className="h-10 w-40 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500"
              />
              <button
                onClick={handleLocationSave}
                disabled={saving || !selectedLocation.trim()}
                className="h-10 px-3 rounded-lg bg-emerald-600 text-white"
                aria-label="Save location"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => setEditingLocation(false)}
                className="h-10 px-3 rounded-lg bg-gray-200 text-gray-600"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.locations.length > 0 ? (
                data.locations.map((loc) => (
                  <span
                    key={loc}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700"
                  >
                    <MapPin className="h-3 w-3" />
                    {loc}
                  </span>
                ))
              ) : (
                <span className="text-xs font-bold text-gray-400">No location set</span>
              )}
            </div>
          )}
        </div>

        {/* ── Catalog Info ── */}
        {data.catalog && (
          <div className="rounded-xl bg-white border border-gray-200 p-4">
            <h2 className={`${sectionLabel} mb-3`}>Catalog Details</h2>
            <div className="grid grid-cols-2 gap-3">
              {data.catalog.category && (
                <div>
                  <p className={fieldLabel}>Category</p>
                  <p className={dataValue}>{data.catalog.category}</p>
                </div>
              )}
              {data.catalog.upc && (
                <div>
                  <p className={fieldLabel}>UPC</p>
                  <button
                    onClick={() => handleCopy(data.catalog!.upc!, 'upc')}
                    className={`${monoValue} text-[11px] hover:text-blue-600 transition-colors`}
                  >
                    {data.catalog.upc}
                    {copiedField === 'upc' && <Check className="inline h-3 w-3 ml-1 text-emerald-500" />}
                  </button>
                </div>
              )}
              {data.catalog.ean && (
                <div>
                  <p className={fieldLabel}>EAN</p>
                  <p className={monoValue + ' text-[11px]'}>{data.catalog.ean}</p>
                </div>
              )}
              <div>
                <p className={fieldLabel}>Status</p>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  data.catalog.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                }`}>
                  {data.catalog.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Ecwid Product Info ── */}
        {data.ecwid && (
          <div className="rounded-xl bg-white border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className={sectionLabel}>Ecwid Product</h2>
              <a
                href={`https://my.ecwid.com/store/${process.env.NEXT_PUBLIC_ECWID_STORE_ID || ''}#product:id=${data.ecwid.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800"
              >
                Open in Ecwid
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {data.ecwid.description && (
              <p className="text-xs font-medium text-gray-600 line-clamp-3">
                {data.ecwid.description}
              </p>
            )}
          </div>
        )}

        {/* ── Packing Photos ── */}
        <div className="rounded-xl bg-white border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className={sectionLabel}>
              <Camera className="inline h-3 w-3 mr-1" />
              Photos ({data.photos.length})
            </h2>
          </div>

          {data.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {data.photos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setLightboxUrl(photo.url)}
                  className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 hover:ring-2 hover:ring-blue-400 transition-all"
                >
                  <img
                    src={photo.url}
                    alt={`SKU photo ${photo.id}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {photo.photoType && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">
                      {photo.photoType}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs font-bold text-gray-400">No photos for this SKU</p>
          )}
        </div>

        {/* ── Serial / Tracking History ── */}
        <div className="rounded-xl bg-white border border-gray-200 p-4">
          <h2 className={`${sectionLabel} mb-3`}>
            <Package className="inline h-3 w-3 mr-1" />
            Inventory History ({data.history.length})
          </h2>

          {data.history.length > 0 ? (
            <div className="space-y-2">
              {data.history.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg bg-gray-50 border border-gray-100 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {row.serial_number && (
                        <button
                          onClick={() => handleCopy(row.serial_number!, `serial-${row.id}`)}
                          className="text-[11px] font-bold font-mono text-gray-900 hover:text-blue-600 transition-colors block"
                        >
                          SN: {row.serial_number}
                          {copiedField === `serial-${row.id}` && (
                            <Check className="inline h-3 w-3 ml-1 text-emerald-500" />
                          )}
                        </button>
                      )}
                      {row.shipping_tracking_number && (
                        <button
                          onClick={() => handleCopy(row.shipping_tracking_number!, `tracking-${row.id}`)}
                          className="text-[11px] font-bold font-mono text-gray-500 hover:text-blue-600 transition-colors block"
                        >
                          Tracking: {row.shipping_tracking_number}
                          {copiedField === `tracking-${row.id}` && (
                            <Check className="inline h-3 w-3 ml-1 text-emerald-500" />
                          )}
                        </button>
                      )}
                      {row.notes && (
                        <p className="text-[11px] font-medium text-gray-500 mt-1">{row.notes}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {row.location && (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700">
                          {row.location}
                        </span>
                      )}
                      <p className="text-[10px] font-bold text-gray-400 mt-1">
                        {formatDate(row.updated_at || row.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-bold text-gray-400">No inventory records</p>
          )}
        </div>

        {/* ── Audit Ledger ── */}
        {data.ledger.length > 0 && (
          <div className="rounded-xl bg-white border border-gray-200 p-4">
            <h2 className={`${sectionLabel} mb-3`}>
              <History className="inline h-3 w-3 mr-1" />
              Stock Audit Log
            </h2>
            <div className="space-y-1">
              {data.ledger.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-black ${entry.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </span>
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-600">
                      {entry.reason}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400">
                    {formatDate(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* ── Location Transfer History ── */}
        {data.transfers && data.transfers.length > 0 && (
          <div className="rounded-xl bg-white border border-gray-200 p-4">
            <h2 className={`${sectionLabel} mb-3`}>
              <MapPin className="inline h-3 w-3 mr-1" />
              Location Transfers
            </h2>
            <div className="space-y-1">
              {data.transfers.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="text-gray-400">{t.from_location || '—'}</span>
                    <span className="text-gray-300">&rarr;</span>
                    <span className="text-blue-700">{t.to_location}</span>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400">
                    {formatDate(t.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Photo Lightbox ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 z-10"
            aria-label="Close photo"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="SKU photo enlarged"
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
