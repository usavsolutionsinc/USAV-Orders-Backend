/**
 * DOM / browser environment helpers.
 * All functions guard against SSR — safe to call in server components.
 */

/**
 * Returns true when running in a browser (window is defined).
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Copies text to the clipboard. Returns true on success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scrolls to the top of the page smoothly.
 */
export function scrollToTop(behavior: ScrollBehavior = 'smooth'): void {
  if (!isBrowser()) return;
  window.scrollTo({ top: 0, behavior });
}

/**
 * Scrolls a given element into view.
 */
export function scrollIntoView(
  element: Element | null,
  options: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' },
): void {
  element?.scrollIntoView(options);
}

/**
 * Downloads a Blob or data URL as a file.
 */
export function downloadFile(url: string, filename: string): void {
  if (!isBrowser()) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * Returns the current viewport width.
 */
export function getViewportWidth(): number {
  if (!isBrowser()) return 0;
  return window.innerWidth;
}

/**
 * Returns the current viewport height.
 */
export function getViewportHeight(): number {
  if (!isBrowser()) return 0;
  return window.innerHeight;
}

/**
 * Dispatches a custom DOM event on `window`.
 */
export function dispatchWindowEvent<T = unknown>(eventName: string, detail?: T): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}
