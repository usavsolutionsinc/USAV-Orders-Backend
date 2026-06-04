'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SkuHit {
  sku: string;
  product_title: string | null;
  stock: number;
  bin_count: number;
  total_qty: number;
}

export function looksLikeBinBarcode(v: string): boolean {
  const trimmed = v.trim();
  if (!trimmed) return false;
  return /^[^\s]+-[^\s-]+-[^\s-]+$/.test(trimmed);
}

export function useWarehouseSkuSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [hits, setHits] = useState<SkuHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/inventory/sku-search?q=${encodeURIComponent(q)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (res.ok) {
        setHits(Array.isArray(data?.results) ? data.results : []);
      } else {
        setHits([]);
      }
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!value.trim()) {
      setHits(null);
      return;
    }
    if (looksLikeBinBarcode(value)) {
      setHits(null);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(value.trim());
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, runSearch]);

  const handleSearch = useCallback((submitted: string) => {
    const trimmed = submitted.trim();
    if (!trimmed) return;
    if (looksLikeBinBarcode(trimmed)) {
      router.push(`/bin/${encodeURIComponent(trimmed)}`);
      setOpen(false);
      return;
    }
    void runSearch(trimmed);
    setOpen(true);
  }, [router, runSearch]);

  const handleClear = useCallback(() => {
    setValue('');
    setHits(null);
    setOpen(false);
  }, []);

  return {
    value,
    setValue,
    hits,
    loading,
    open,
    setOpen,
    handleSearch,
    handleClear,
  };
}
