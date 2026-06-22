'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchHistory } from './dashboard-management-shared';

/**
 * Owns the dashboard search box + recent-search history (localStorage-backed),
 * syncs the value from the `searchValue` prop, and wires the
 * `dashboard-focus-search` window event + sessionStorage one-shot that focus the
 * input when the user lands here from a deep link.
 */
export function useDashboardSearchHistory(searchValue: string, onSearchChange?: (value: string) => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSearchQuery(searchValue);
  }, [searchValue]);

  useEffect(() => {
    const focusSearchInput = () => {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    };
    const handleFocusSearch = () => {
      focusSearchInput();
    };
    window.addEventListener('dashboard-focus-search' as any, handleFocusSearch as any);
    try {
      const shouldFocus = sessionStorage.getItem('dashboard-focus-search') === '1';
      if (shouldFocus) {
        sessionStorage.removeItem('dashboard-focus-search');
        focusSearchInput();
      }
    } catch (_error) {
      // no-op
    }
    return () => {
      window.removeEventListener('dashboard-focus-search' as any, handleFocusSearch as any);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dashboard_search_history');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setSearchHistory(parsed.map((item: any) => ({ ...item, timestamp: new Date(item.timestamp) })));
    } catch (_error) {
      setSearchHistory([]);
    }
  }, []);

  const saveSearchHistory = (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const newHistory = [
      { query: trimmedQuery, timestamp: new Date() },
      ...searchHistory.filter((h) => h.query !== trimmedQuery).slice(0, 4),
    ];
    setSearchHistory(newHistory);
    localStorage.setItem('dashboard_search_history', JSON.stringify(newHistory));
  };

  const handleSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      saveSearchHistory(trimmedQuery);
    }
    await onSearchChange?.(trimmedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSearchChange]);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    void handleSearch(value);
  }, [handleSearch]);

  const clearSearchHistory = () => {
    setSearchHistory([]);
    setShowAllSearchHistory(false);
    localStorage.removeItem('dashboard_search_history');
  };

  const visibleSearchHistory = showAllSearchHistory ? searchHistory : searchHistory.slice(0, 3);

  return {
    searchQuery,
    setSearchQuery,
    searchHistory,
    showAllSearchHistory,
    setShowAllSearchHistory,
    searchInputRef,
    handleSearch,
    handleInputChange,
    clearSearchHistory,
    visibleSearchHistory,
  };
}
