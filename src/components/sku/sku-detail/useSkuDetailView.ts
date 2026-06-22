'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deactivateSkuCatalog, fetchSkuDetail, patchSkuStock } from './sku-detail-api';
import type { SkuDetailData, SkuDetailViewProps } from './sku-detail-types';

/**
 * Controller for the SKU detail view: loads the SKU's stock/catalog/ecwid/history
 * bundle, handles stock adjust/set + location change (all via PATCH /api/sku-stock),
 * the soft-delete deactivate, and the transient copy/lightbox/edit UI state.
 * Returns one bag consumed by the shell + cards.
 */
export function useSkuDetailView({ sku, variant = 'page', onClose }: SkuDetailViewProps) {
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

  // Deactivate (soft-delete) — endpoint refuses SKUs with bin stock (409).
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setData(await fetchSkuDetail(sku));
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
        await patchSkuStock(sku, body);
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
    } catch {
      /* clipboard denied */
    }
  };

  const isPanel = variant === 'panel';

  const handleClose = () => {
    if (onClose) onClose();
    else router.push('/inventory');
  };

  const handleDeactivate = async () => {
    const catalogId = data?.catalog?.id;
    if (!catalogId) return;
    setDeactivateError(null);
    try {
      await deactivateSkuCatalog(catalogId);
    } catch (err: any) {
      setDeactivateError(err?.message || 'Deactivate failed');
      throw err;
    }
  };

  return {
    data,
    loading,
    error,
    saving,
    adjustDelta,
    setAdjustDelta,
    adjustReason,
    setAdjustReason,
    showSetMode,
    setShowSetMode,
    absoluteQty,
    setAbsoluteQty,
    editingLocation,
    setEditingLocation,
    selectedLocation,
    setSelectedLocation,
    lightboxUrl,
    setLightboxUrl,
    copiedField,
    handleCopy,
    deactivateError,
    handleAdjust,
    handleSetAbsolute,
    handleLocationSave,
    handleDeactivate,
    isPanel,
    handleClose,
  };
}

export type SkuDetailController = ReturnType<typeof useSkuDetailView>;
