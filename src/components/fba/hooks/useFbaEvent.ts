import { useEffect, useRef } from 'react';

/**
 * Subscribe to a single window CustomEvent.
 *
 * Uses a stable ref so the handler can close over the latest props/state
 * without re-subscribing the listener on every render.
 */
export function useFbaEvent<T = unknown>(
  eventName: string,
  handler: (detail: T, event: CustomEvent<T>) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (e: Event) => {
      const ce = e as CustomEvent<T>;
      handlerRef.current(ce.detail, ce);
    };
    window.addEventListener(eventName, listener);
    return () => window.removeEventListener(eventName, listener);
  }, [eventName]);
}

/**
 * Subscribe to multiple window CustomEvents with a single handler.
 *
 * Useful when several events should trigger the same action (e.g. refresh).
 */
export function useFbaEvents(
  eventNames: readonly string[],
  handler: () => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = () => handlerRef.current();
    for (const name of eventNames) {
      window.addEventListener(name, listener);
    }
    return () => {
      for (const name of eventNames) {
        window.removeEventListener(name, listener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventNames.join(',')]);
}
