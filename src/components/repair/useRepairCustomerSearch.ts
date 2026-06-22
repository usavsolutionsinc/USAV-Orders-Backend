'use client';

import { useEffect, useState } from 'react';

export interface ExistingCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  updated_at: string | null;
}

/**
 * Debounced (220ms) existing-customer lookup for the contact step. Only runs
 * while `enabled` (contact step + "existing" mode); aborts in-flight requests
 * on change/unmount.
 */
export function useRepairCustomerSearch(enabled: boolean, query: string) {
  const [customerResults, setCustomerResults] = useState<ExistingCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState('');

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingCustomers(true);
      setCustomerSearchError('');
      try {
        const q = query.trim();
        const res = await fetch(`/api/repair/customers?q=${encodeURIComponent(q)}&limit=25`, {
          signal: controller.signal,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to fetch customers');
        }
        if (!active) return;
        const rows = Array.isArray(payload?.customers) ? payload.customers : [];
        setCustomerResults(rows);
      } catch (error: unknown) {
        if (!active || controller.signal.aborted) return;
        setCustomerResults([]);
        setCustomerSearchError(error instanceof Error ? error.message : 'Failed to fetch customers');
      } finally {
        if (active) setLoadingCustomers(false);
      }
    }, 220);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, query]);

  return { customerResults, loadingCustomers, customerSearchError };
}
