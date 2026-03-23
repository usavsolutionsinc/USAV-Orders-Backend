'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, Pencil, Plus, Star, Trash2, X } from '@/components/Icons';

interface FnSkuCatalogItem {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

interface FbaFavorite {
  id: number;
  sku: string;          // stores the FNSKU
  label: string;
  product_title: string | null;
  notes: string | null;
  sort_order: number;
}

interface Props {
  /** Called when the user taps "Use" — paste FNSKU into plan */
  onUseFavorite: (fnsku: string, label: string) => void;
}

// ─── Mini toast ──────────────────────────────────────────────────────────────
function MiniToast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, [onDone]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 text-[9px] font-bold text-emerald-700"
    >
      {message}
    </motion.div>
  );
}

export function FbaFnSkuFavoritesSection({ onUseFavorite }: Props) {
  const [favorites, setFavorites]       = useState<FbaFavorite[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [editingId, setEditingId]       = useState<number | null>(null);
  const [manage, setManage]             = useState(false);
  const [toast, setToast]               = useState<string | null>(null);

  // Form state
  const [searchQ, setSearchQ]           = useState('');
  const [searchRes, setSearchRes]       = useState<FnSkuCatalogItem[]>([]);
  const [searching, setSearching]       = useState(false);
  const [selected, setSelected]         = useState<FnSkuCatalogItem | null>(null);
  const [label, setLabel]               = useState('');
  const [notesDraft, setNotesDraft]     = useState('');
  const [saving, setSaving]             = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────
  const loadFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/favorites?workspace=fba');
      const data = await res.json();
      const rows = Array.isArray(data?.favorites) ? data.favorites : [];
      setFavorites(rows.map((r: any) => ({
        id: Number(r.id),
        sku: r.sku || '',
        label: r.label || r.sku || '',
        product_title: r.productTitle || null,
        notes: r.notes || null,
        sort_order: Number(r.sortOrder) || 0,
      })));
    } catch { /* no-op */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  // ── FNSKU catalog search (debounced) ─────────────────────────────────────
  useEffect(() => {
    if (!showForm) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQ.trim();
    if (!q) { setSearchRes([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/fba/fnskus/search?q=${encodeURIComponent(q)}&limit=20`);
        const data = await res.json();
        setSearchRes(Array.isArray(data?.items) ? data.items : []);
      } catch { setSearchRes([]); } finally { setSearching(false); }
    }, 220);
  }, [searchQ, showForm]);

  // ── Form helpers ─────────────────────────────────────────────────────────
  const resetForm = () => {
    setShowForm(false); setEditingId(null);
    setSearchQ(''); setSearchRes([]); setSelected(null);
    setLabel(''); setNotesDraft(''); setSaving(false);
  };

  const openEdit = (fav: FbaFavorite) => {
    setEditingId(fav.id);
    setLabel(fav.label);
    setNotesDraft(fav.notes || '');
    setSearchQ(fav.sku);
    setSelected({ fnsku: fav.sku, product_title: fav.product_title, asin: null, sku: null });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!selected?.fnsku || !label.trim()) return;
    setSaving(true);
    try {
      const payload = {
        workspaceKey: 'fba',
        sku: selected.fnsku,
        label: label.trim(),
        productTitle: selected.product_title || null,
        notes: notesDraft.trim() || null,
        sortOrder: editingId === null ? favorites.length * 10 + 10 : undefined,
      };
      const isEdit = editingId !== null;
      const res = await fetch(
        isEdit ? `/api/favorites/${editingId}` : '/api/favorites',
        { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      if (res.ok) {
        resetForm();
        await loadFavorites();
        setToast(isEdit ? 'Favorite updated' : 'Favorite saved');
      }
    } catch { /* no-op */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/favorites/${id}?workspace=fba`, { method: 'DELETE' });
      setFavorites((p) => p.filter((f) => f.id !== id));
      setToast('Removed');
    } catch { /* no-op */ }
  };

  return (
    <div className="pb-2">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1.5">
        <Star className="h-3 w-3 text-violet-400 shrink-0" />
        <span className="flex-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">FNSKU Favorites</span>
        <AnimatePresence>
          {toast && <MiniToast key="toast" message={toast} onDone={() => setToast(null)} />}
        </AnimatePresence>
        <button
          type="button"
          onClick={() => setManage((p) => !p)}
          className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors ${manage ? 'bg-zinc-200 text-zinc-700' : 'text-zinc-300 hover:text-zinc-500'}`}
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          onClick={() => { resetForm(); setShowForm((p) => !p); }}
          className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-600 text-white transition-colors hover:bg-violet-700"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Add/Edit form */}
      <AnimatePresence initial={false}>
        {showForm && (
          <motion.div
            key="form"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-2 space-y-1.5 rounded-xl border border-violet-100 bg-violet-50/40 p-2.5">
              {/* FNSKU catalog search */}
              <div className="relative rounded-lg border border-zinc-200 bg-white">
                <input
                  value={searchQ}
                  onChange={(e) => { setSearchQ(e.target.value); setSelected(null); }}
                  placeholder="Search FNSKU, title, ASIN…"
                  className="w-full rounded-lg bg-transparent px-2.5 py-1.5 font-mono text-[11px] font-bold text-zinc-900 outline-none placeholder:font-sans placeholder:text-[10px] placeholder:font-normal placeholder:text-zinc-400"
                />
                <AnimatePresence>
                  {(searching || searchRes.length > 0) && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg"
                    >
                      {searching ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-zinc-400">
                          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                        </div>
                      ) : searchRes.map((item) => (
                        <button
                          key={item.fnsku}
                          type="button"
                          onClick={() => {
                            setSelected(item);
                            setSearchQ(item.fnsku);
                            if (!label) setLabel(item.product_title || item.fnsku);
                            setSearchRes([]);
                          }}
                          className="flex w-full flex-col border-b border-zinc-50 px-3 py-2 text-left last:border-0 hover:bg-violet-50"
                        >
                          <span className="font-mono text-[11px] font-bold text-zinc-900">{item.fnsku}</span>
                          <span className="truncate text-[9px] text-zinc-400">{item.product_title || item.asin || 'No title'}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Selected indicator */}
              {selected && (
                <div className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1">
                  <Check className="h-2.5 w-2.5 text-violet-500 shrink-0" />
                  <span className="font-mono text-[10px] font-bold text-violet-700">{selected.fnsku}</span>
                  {selected.product_title && <span className="truncate text-[9px] text-zinc-400">· {selected.product_title}</span>}
                </div>
              )}

              {/* Label */}
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g. Headphones Pro)"
                className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-900 outline-none placeholder:text-[10px] placeholder:font-normal placeholder:text-zinc-400 focus:border-violet-300"
              />

              {/* Notes */}
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Notes (optional)"
                rows={2}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-zinc-700 outline-none placeholder:font-normal placeholder:text-zinc-400 focus:border-violet-300"
              />

              {/* Footer */}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={resetForm} className="text-[9px] font-bold uppercase tracking-wide text-zinc-400 hover:text-zinc-600">Cancel</button>
                {editingId !== null && (
                  <button type="button" onClick={() => { handleDelete(editingId!); resetForm(); }}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  disabled={!selected || !label.trim() || saving}
                  onClick={handleSave}
                  className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1 text-[9px] font-black uppercase tracking-wide text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                  {editingId !== null ? 'Update' : 'Save'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Favorites list */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
        </div>
      ) : favorites.length === 0 ? (
        <p className="py-3 text-center text-[9px] font-semibold italic text-zinc-300">
          No favorites yet — save frequent FNSKUs for quick access
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-100 mx-3">
          <AnimatePresence initial={false}>
            {favorites.map((fav, i) => (
              <motion.div
                key={fav.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12, scale: 0.96 }}
                transition={{ duration: 0.18, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                className={`flex items-center gap-2 border-b border-zinc-50 px-2.5 py-2 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/40'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-zinc-900">{fav.label}</p>
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className="font-mono text-[9px] font-semibold text-zinc-400">{fav.sku}</span>
                    {fav.notes && (
                      <span className="truncate text-[9px] italic text-zinc-300">· {fav.notes}</span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {manage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(fav)}
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:text-zinc-600"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(fav.id)}
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-red-100 bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </>
                  ) : (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.88 }}
                      onClick={() => { onUseFavorite(fav.sku, fav.label); setToast(`Added ${fav.sku}`); }}
                      className="flex h-6 items-center gap-1 rounded-lg bg-violet-600 px-2 text-[9px] font-black text-white transition-colors hover:bg-violet-700"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      Add
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
