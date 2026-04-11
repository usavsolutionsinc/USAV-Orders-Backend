'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Loader2, Trash2, Link2, Pencil, ExternalLink } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { getExternalUrlByPlatform, getPlatformLabelByItemNumber, getPlatformKeyByItemNumber } from '@/hooks/useExternalItemUrl';
import { getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';

interface PlatformIdRow {
  id: number;
  platform: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  account_name: string | null;
}

interface PairingSectionProps {
  catalogId: number;
  catalogSku?: string;
  platformIds: PlatformIdRow[];
  onRefresh: () => void;
}

export function PairingSection({ catalogId, catalogSku, platformIds, onRefresh }: PairingSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [itemValue, setItemValue] = useState('');
  const [accountName, setAccountName] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const detectedLabel = getPlatformLabelByItemNumber(itemValue);
  const detectedKey = getPlatformKeyByItemNumber(itemValue);

  const resetForm = () => {
    setShowForm(false);
    setEditingRowId(null);
    setItemValue('');
    setAccountName('');
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (pid: PlatformIdRow) => {
    setEditingRowId(pid.id);
    // Show whichever column has the value — ecwid uses platform_sku, others use platform_item_id
    setItemValue(pid.platform_sku || pid.platform_item_id || '');
    setAccountName(pid.account_name || '');
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    const trimmed = itemValue.trim();
    if (!trimmed) return;
    // Route value to the correct column based on detected platform
    const platformItemId = detectedKey === 'ecwid' ? null : trimmed;
    const platformSku = detectedKey === 'ecwid' ? trimmed : null;
    setSaving(true);
    try {
      if (editingRowId) {
        await fetch(`/api/sku-catalog/${catalogId}/platform-ids`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platformIdRowId: editingRowId,
            platform: detectedKey,
            platformItemId,
            platformSku,
            accountName: accountName.trim() || null,
          }),
        });
      } else {
        await fetch(`/api/sku-catalog/${catalogId}/platform-ids`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: detectedKey,
            platformItemId,
            platformSku,
            accountName: accountName.trim() || null,
          }),
        });
      }
      resetForm();
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [catalogId, editingRowId, detectedKey, itemValue, accountName, onRefresh]);

  const handleRemove = useCallback(async (rowId: number) => {
    setRemoving(rowId);
    try {
      await fetch(`/api/sku-catalog/${catalogId}/platform-ids`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformIdRowId: rowId }),
      });
      resetForm();
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }, [catalogId, onRefresh]);

  return (
    <div className="space-y-2">
      {/* Zoho source-of-truth row */}
      {catalogSku && (
        <div className="flex items-center gap-2 rounded-xl px-2.5 py-2 bg-gray-50">
          <span className="shrink-0 text-[11px] font-mono font-bold text-gray-800">
            {catalogSku}
          </span>
          <span className="flex-1" />
          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${getOrderPlatformColor('zoho')} ${getOrderPlatformBorderColor('zoho')}`}>
            ZOHO
          </span>
        </div>
      )}

      {platformIds.length === 0 && !catalogSku && !showForm && (
        <p className="text-[10px] font-semibold text-gray-400 px-1">No platform pairings yet.</p>
      )}

      {platformIds.map((pid) => {
        const identifier = pid.platform_sku || pid.platform_item_id;
        const extUrl = getExternalUrlByPlatform(pid.platform, identifier);
        const rawPlatform = (pid.platform || '').toLowerCase();
        const displayPlatform = rawPlatform === 'zoho' ? 'Ecwid'
          : rawPlatform === 'unknown' ? getPlatformLabelByItemNumber(identifier).toLowerCase()
          : pid.platform;
        const isEditing = editingRowId === pid.id;

        return (
          <div
            key={pid.id}
            className={`flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors ${
              isEditing ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-gray-50'
            }`}
          >
            <span className="shrink-0 text-[11px] font-mono font-bold text-gray-800">
              {pid.platform_sku || pid.platform_item_id || '—'}
            </span>
            {pid.account_name && (
              <span className="shrink-0 text-[9px] font-semibold text-gray-400">{pid.account_name}</span>
            )}
            <span className="flex-1" />
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${getOrderPlatformColor(displayPlatform)} ${getOrderPlatformBorderColor(displayPlatform)}`}>
              {displayPlatform}
            </span>
            <button
              type="button"
              onClick={() => isEditing ? resetForm() : openEdit(pid)}
              className={`shrink-0 p-1 rounded-lg transition-colors ${
                isEditing ? 'text-blue-600 bg-blue-100' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
              }`}
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {extUrl && (
              <a
                href={extUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                title="Open on marketplace"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        );
      })}

      {/* Shared form for Add + Edit */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-gray-200 bg-white p-2.5 space-y-2">
              <div className="relative">
                <input
                  type="text"
                  value={itemValue}
                  onChange={(e) => setItemValue(e.target.value)}
                  placeholder="Paste SKU / ASIN / item number"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-2.5 pr-20 text-[11px] font-bold text-gray-900 placeholder:text-gray-400"
                />
                {itemValue.trim() && (
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full border px-1.5 py-0.5 ${microBadge} bg-white ${getOrderPlatformColor(detectedKey)} ${getOrderPlatformBorderColor(detectedKey)}`}>
                    {detectedLabel}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Account name (optional)"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-bold text-gray-900 placeholder:text-gray-400"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !itemValue.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                  {editingRowId ? 'Update' : 'Pair'}
                </button>
                {editingRowId && (
                  <button
                    type="button"
                    onClick={() => handleRemove(editingRowId)}
                    disabled={removing === editingRowId}
                    className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-600 hover:bg-red-50"
                  >
                    {removing === editingRowId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showForm && (
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add Pairing
        </button>
      )}
    </div>
  );
}
