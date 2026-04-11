'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Loader2, Trash2, ExternalLink, FileText, Pencil, X } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';

interface ManualRow {
  id: number;
  display_name: string | null;
  google_file_id: string;
  type: string | null;
  updated_at: string | null;
}

interface ManualsSectionProps {
  catalogId: number;
  manuals: ManualRow[];
  onRefresh: () => void;
}

const MANUAL_TYPES = ['manual', 'troubleshooting', 'installation', 'quick-start', 'safety', 'warranty', 'other'];

function typeBadgeClass(type: string | null): string {
  switch ((type || '').toLowerCase()) {
    case 'manual': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'troubleshooting': return 'bg-red-50 text-red-700 border-red-200';
    case 'installation': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'quick-start': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'safety': return 'bg-orange-50 text-orange-700 border-orange-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

export function ManualsSection({ catalogId, manuals, onRefresh }: ManualsSectionProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [googleFileId, setGoogleFileId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [manualType, setManualType] = useState('manual');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const resetForm = () => {
    setGoogleFileId('');
    setDisplayName('');
    setManualType('manual');
    setShowAdd(false);
    setEditingId(null);
  };

  const openEditForm = (manual: ManualRow) => {
    setEditingId(manual.id);
    setGoogleFileId(manual.google_file_id);
    setDisplayName(manual.display_name || '');
    setManualType(manual.type || 'manual');
    setShowAdd(true);
  };

  const handleSave = useCallback(async () => {
    if (!googleFileId.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/sku-catalog/${catalogId}/manuals`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manualId: editingId,
            displayName: displayName.trim() || null,
            type: manualType,
            googleFileId: googleFileId.trim(),
          }),
        });
      } else {
        await fetch(`/api/sku-catalog/${catalogId}/manuals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            googleFileId: googleFileId.trim(),
            displayName: displayName.trim() || null,
            type: manualType,
          }),
        });
      }
      resetForm();
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [catalogId, editingId, googleFileId, displayName, manualType, onRefresh]);

  const handleRemove = useCallback(async (manualId: number) => {
    setRemoving(manualId);
    try {
      await fetch(`/api/sku-catalog/${catalogId}/manuals`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualId }),
      });
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }, [catalogId, onRefresh]);

  return (
    <div className="space-y-2">
      {manuals.length === 0 && !showAdd && (
        <p className="text-[10px] font-semibold text-gray-400 px-1">No manuals linked yet.</p>
      )}

      {manuals.map((manual) => (
        <div key={manual.id}>
          <div className="flex items-start gap-2 rounded-xl bg-gray-50 px-2.5 py-2 group">
            <FileText className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[11px] font-bold text-gray-800">
                  {manual.display_name || 'Untitled Manual'}
                </span>
                {manual.type && (
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${typeBadgeClass(manual.type)}`}>
                    {manual.type}
                  </span>
                )}
              </div>
              <a
                href={`https://docs.google.com/document/d/${manual.google_file_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold text-blue-600 hover:text-blue-800"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-2.5 w-2.5" /> Open
              </a>
            </div>
            <button
              type="button"
              onClick={() => openEditForm(manual)}
              className="shrink-0 p-1 rounded-lg text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100"
              title="Edit manual"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-gray-200 bg-white p-2.5 space-y-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-bold text-gray-900 placeholder:text-gray-400"
              />
              <input
                type="text"
                value={googleFileId}
                onChange={(e) => setGoogleFileId(e.target.value)}
                placeholder="Google Doc file ID"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-mono font-bold text-gray-900 placeholder:text-gray-400"
              />
              <select
                value={manualType}
                onChange={(e) => setManualType(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-bold text-gray-900"
              >
                {MANUAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !googleFileId.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  {editingId ? 'Update' : 'Add Manual'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => handleRemove(editingId)}
                    disabled={removing === editingId}
                    className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-600 hover:bg-red-50"
                  >
                    {removing === editingId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
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

      {!showAdd && (
        <button
          type="button"
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add Manual
        </button>
      )}
    </div>
  );
}
