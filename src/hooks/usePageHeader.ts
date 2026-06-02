'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useHeader } from '@/contexts/HeaderContext';

/**
 * Mount contextual content into the GlobalHeader's left/center zone for the
 * lifetime of the calling component.
 *
 *   usePageHeader(
 *     <div className="flex items-center gap-3">
 *       <h1 className="text-sm font-bold">Orders</h1>
 *       <button onClick={() => setSelecting(true)}>Select</button>
 *     </div>,
 *     [selecting],
 *   );
 *
 * The content is cleared automatically on unmount so it never leaks onto the
 * next page. Pass `deps` for any values the content closes over, exactly like
 * a useEffect dependency array.
 */
export function usePageHeader(content: ReactNode, deps: unknown[] = []): void {
  const { setPanelContent } = useHeader();

  useEffect(() => {
    setPanelContent(content);
    return () => setPanelContent(null);
    // `content` is recomputed every render; gate on caller-supplied deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPanelContent, ...deps]);
}
