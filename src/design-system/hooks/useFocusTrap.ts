'use client';

import { useEffect, useRef } from 'react';

/**
 * Everything natively tabbable. Visibility is checked at keydown time (via
 * getClientRects) so conditionally-hidden controls drop out of the cycle.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Trap Tab/Shift+Tab inside a modal container while `active` is true.
 *
 * The container should be the dialog root (give it `tabIndex={-1}` +
 * `role="dialog"` + `aria-modal="true"`). On activate, focus moves into the
 * container so the first Tab lands on the first control instead of the page
 * behind the scrim; on deactivate, focus is restored to whatever had it before
 * the dialog opened. Focus that escapes by any other means (e.g. a click on
 * the browser chrome, programmatic focus) is pulled back on `focusin`.
 *
 * Content portalled outside the container (HoverTooltip labels) is fine as
 * long as it is not focusable.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );

    const focusFirst = () => {
      const items = focusables();
      if (items.length > 0) {
        items[0].focus({ preventScroll: true });
      } else {
        container.focus({ preventScroll: true });
      }
    };

    if (!container.contains(document.activeElement)) {
      focusFirst();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      // The dialog root is `tabIndex={-1}` — programmatically focusable but not
      // in FOCUSABLE_SELECTOR. Tab from it must land on the first control, not
      // leak to the page behind the scrim.
      if (current === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !container.contains(e.target)) {
        container.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [active]);

  return containerRef;
}
