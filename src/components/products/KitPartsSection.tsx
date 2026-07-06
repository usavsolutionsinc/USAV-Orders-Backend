'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Loader2, Trash2, Pencil } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { KIT_PART_TYPES } from '@/lib/schemas/kit-parts';

interface KitPartRow {
  id: number;
  component_name: string;
  component_type: string;
  qty_required: number;
  /** Condition grades this part is required for; null/empty = all conditions. */
  required_for: string[] | null;
  is_critical: boolean;
  sort_order: number;
}

interface KitPartsSectionProps {
  catalogId: number;
  kitParts: KitPartRow[];
  onRefresh: () => void;
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case 'PART': return 'bg-surface-canvas text-text-muted border-border-soft';
    case 'ACCESSORY': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'CABLE': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'ADAPTER': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'REMOTE': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'MANUAL': return 'bg-amber-50 text-amber-700 border-amber-200';
    // ds-allow-raw-neutral: identity tone — deliberate warm stone chip, distinct from the gray default
    case 'PACKAGING': return 'bg-stone-50 text-stone-600 border-stone-200';
    default: return 'bg-surface-canvas text-text-muted border-border-soft';
  }
}

/**
 * Add/edit/delete editor for a SKU's kit parts ("what's in the box" BOM). The
 * sibling of QcChecklistSection — same anchor (sku_catalog.id), same CRUD house
 * pattern. Rows authored here are read at pack time by /api/get-title-by-sku and
 * rendered to the packer by <PackChecklist>; critical rows drive the "all
 * required items in the box" signal.
 */
export function KitPartsSection({ catalogId, kitParts, onRefresh }: KitPartsSectionProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [componentName, setComponentName] = useState('');
  const [componentType, setComponentType] = useState('PART');
  const [qtyRequired, setQtyRequired] = useState('1');
  const [requiredForText, setRequiredForText] = useState('');
  const [isCritical, setIsCritical] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const resetForm = () => {
    setComponentName('');
    setComponentType('PART');
    setQtyRequired('1');
    setRequiredForText('');
    setIsCritical(true);
    setShowAdd(false);
    setEditingId(null);
  };

  const openEditForm = (part: KitPartRow) => {
    setEditingId(part.id);
    setComponentName(part.component_name);
    setComponentType(part.component_type);
    setQtyRequired(String(part.qty_required));
    setRequiredForText((part.required_for ?? []).join(', '));
    setIsCritical(part.is_critical);
    setShowAdd(true);
  };

  const payload = useCallback(() => {
    const requiredFor = requiredForText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const qty = Number(qtyRequired);
    return {
      componentType,
      qtyRequired: Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1,
      requiredFor: requiredFor.length ? requiredFor : null,
      isCritical,
    };
  }, [componentType, qtyRequired, requiredForText, isCritical]);

  const handleSave = useCallback(async () => {
    if (!componentName.trim()) return;
    setSaving(true);
    try {
      const p = payload();
      if (editingId) {
        await fetch(`/api/sku-catalog/${catalogId}/kit-parts`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partId: editingId, componentName: componentName.trim(), ...p }),
        });
      } else {
        await fetch(`/api/sku-catalog/${catalogId}/kit-parts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentName: componentName.trim(),
            sortOrder: kitParts.length,
            ...p,
          }),
        });
      }
      resetForm();
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [catalogId, editingId, componentName, payload, kitParts.length, onRefresh]);

  const handleRemove = useCallback(async (partId: number) => {
    setRemoving(partId);
    try {
      await fetch(`/api/sku-catalog/${catalogId}/kit-parts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partId }),
      });
      resetForm();
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }, [catalogId, onRefresh]);

  return (
    <div className="space-y-2">
      {kitParts.length === 0 && !showAdd && (
        <p className="text-micro font-semibold text-text-faint px-1">
          Nothing in the box yet. Add the parts &amp; accessories a packer should include.
        </p>
      )}

      {kitParts.map((part, idx) => {
        const conditions = part.required_for ?? [];
        return (
          <div
            key={part.id}
            className="flex items-center gap-2 rounded-xl bg-surface-canvas px-2.5 py-2 group"
          >
            <span className="shrink-0 w-5 text-center text-micro font-black text-text-faint tabular-nums">{idx + 1}</span>
            <span className="flex-1 min-w-0 truncate text-caption font-bold text-text-default">
              {part.component_name}
            </span>
            {part.qty_required > 1 && (
              <span className="shrink-0 text-eyebrow font-black tabular-nums text-text-soft">×{part.qty_required}</span>
            )}
            {conditions.length > 0 && (
              <span className={`shrink-0 rounded-full border border-border-soft bg-surface-card px-1.5 py-0.5 text-text-soft ${microBadge}`}>
                {conditions.join(' / ')}
              </span>
            )}
            {part.is_critical && (
              <span className={`shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700 ${microBadge}`}>
                REQUIRED
              </span>
            )}
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${typeBadgeClass(part.component_type)}`}>
              {part.component_type}
            </span>
            <HoverTooltip label="Edit part" asChild>
              <IconButton
                icon={<Pencil className="h-3 w-3" />}
                ariaLabel="Edit part"
                tone="accent"
                onClick={() => openEditForm(part)}
                className="shrink-0 p-1 rounded-lg text-text-faint hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover:opacity-100"
              />
            </HoverTooltip>
          </div>
        );
      })}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border-soft bg-surface-card p-2.5 space-y-2">
              <input
                type="text"
                value={componentName}
                onChange={(e) => setComponentName(e.target.value)}
                placeholder="Item name (e.g. Power adapter, Remote)"
                className="w-full rounded-lg border border-border-soft bg-surface-canvas px-2.5 py-1.5 text-caption font-bold text-text-default placeholder:text-text-faint"
              />
              <div className="flex gap-2">
                <HoverTooltip label="Component type" asChild>
                  <select
                    value={componentType}
                    onChange={(e) => setComponentType(e.target.value)}
                    className="flex-1 rounded-lg border border-border-soft bg-surface-canvas px-2.5 py-1.5 text-caption font-bold text-text-default"
                    aria-label="Component type"
                  >
                    {KIT_PART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </HoverTooltip>
                <HoverTooltip label="Quantity required in the box" asChild>
                  <input
                    type="number"
                    min={1}
                    value={qtyRequired}
                    onChange={(e) => setQtyRequired(e.target.value)}
                    placeholder="Qty"
                    className="w-20 rounded-lg border border-border-soft bg-surface-canvas px-2.5 py-1.5 text-caption font-bold text-text-default placeholder:text-text-faint"
                    aria-label="Quantity required in the box"
                  />
                </HoverTooltip>
              </div>

              <HoverTooltip label="Condition grades this part is required for. Blank = required for every condition." asChild>
                <input
                  type="text"
                  value={requiredForText}
                  onChange={(e) => setRequiredForText(e.target.value)}
                  placeholder="Required for conditions, comma-separated (blank = all)"
                  className="w-full rounded-lg border border-border-soft bg-surface-canvas px-2.5 py-1.5 text-caption font-bold text-text-default placeholder:text-text-faint"
                  aria-label="Condition grades this part is required for. Blank = required for every condition."
                />
              </HoverTooltip>

              <label className="flex items-center gap-2 px-0.5 text-caption font-bold text-text-muted select-none">
                <input
                  type="checkbox"
                  checked={isCritical}
                  onChange={(e) => setIsCritical(e.target.checked)}
                  className="h-4 w-4 rounded border-border-default text-blue-600"
                />
                Required item — drives the &ldquo;all items in the box&rdquo; pack signal
              </label>

              <div className="flex items-center gap-2">
                <Button
                  variant="brand"
                  size="sm"
                  loading={saving}
                  disabled={saving || !componentName.trim()}
                  onClick={handleSave}
                  className="flex-1"
                >
                  {editingId ? 'Update' : 'Add Item'}
                </Button>
                {editingId && (
                  <HoverTooltip label="Delete item" asChild>
                    <IconButton
                      icon={removing === editingId ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Trash2 className="h-3 w-3 text-red-600" />}
                      ariaLabel="Delete item"
                      onClick={() => handleRemove(editingId)}
                      disabled={removing === editingId}
                      className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-red-600 hover:bg-red-50"
                    />
                  </HoverTooltip>
                )}
                <Button variant="secondary" size="sm" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showAdd && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="h-3 w-3" />}
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
        >
          Add Item
        </Button>
      )}
    </div>
  );
}
