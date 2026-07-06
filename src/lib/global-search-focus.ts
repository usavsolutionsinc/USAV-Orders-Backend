/** Dispatched to focus the global header search field (⌘K / quick-access). */
export const GLOBAL_SEARCH_FOCUS_EVENT = 'usav-global-search-focus';

export function dispatchGlobalSearchFocus(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_FOCUS_EVENT));
}
