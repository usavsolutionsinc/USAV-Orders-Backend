'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalStorage } from './_storage';

const DEFAULT_STAFF_ID = 8;

interface PersistedStaffIdOptions {
  storageKey?: string;
  fallback?: number;
}

/**
 * Resolves the active staff ID from URL → localStorage → fallback (default 8).
 * Persists the resolved value to localStorage so the last selection is remembered.
 */
export function usePersistedStaffId(
  options?: PersistedStaffIdOptions,
): [staffId: number, setStaffId: (id: number) => void] {
  const { storageKey = 'fba-staff-id', fallback = DEFAULT_STAFF_ID } = options ?? {};

  const searchParams = useSearchParams();
  const staffIdRaw = String(searchParams.get('staffId') || '').trim();
  const staffIdFromUrl = /^\d+$/.test(staffIdRaw) ? parseInt(staffIdRaw, 10) : null;

  const [saved, setSaved] = useLocalStorage<number>(storageKey, fallback);

  const staffId = staffIdFromUrl ?? saved;

  // Keep localStorage in sync when the URL provides a staffId
  useEffect(() => {
    if (staffIdFromUrl !== null && staffIdFromUrl !== saved) {
      setSaved(staffIdFromUrl);
    }
  }, [staffIdFromUrl, saved, setSaved]);

  return [staffId, setSaved];
}
