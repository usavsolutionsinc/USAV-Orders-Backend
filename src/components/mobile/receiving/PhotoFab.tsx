'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Camera } from '@/components/Icons';

interface PhotoFabProps {
  href: string;
  label?: string;
  /** Hide the FAB on scroll-down, show on scroll-up. Default true. */
  hideOnScroll?: boolean;
}

/**
 * Labeled camera FAB pinned to the bottom-right of the viewport so it stays
 * inside the thumb zone for one-handed use. Pill-shape (icon + label) is more
 * discoverable than an icon-only circular FAB; the explicit "Add Photo" copy
 * is the entire point of the receiving pipeline on mobile.
 *
 * The FAB hides when the user scrolls down (gets out of the way of content)
 * and reappears on scroll-up, mirroring native iOS/Android conventions.
 */
export function PhotoFab({ href, label = 'Add Photo', hideOnScroll = true }: PhotoFabProps) {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    if (!hideOnScroll) return;
    lastY.current = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY.current;
        // Ignore tiny jitter; require >8px movement before flipping.
        if (Math.abs(dy) > 8) {
          // Always show near the top so first-time users see it.
          if (y < 80) setVisible(true);
          else setVisible(dy < 0);
          lastY.current = y;
        }
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [hideOnScroll]);

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      className={`fixed bottom-5 right-4 z-30 flex h-14 items-center gap-2.5 rounded-full bg-blue-600 px-5 text-white shadow-lg shadow-blue-600/25 transition-all duration-200 active:bg-blue-700 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0'
      }`}
    >
      <Camera className="h-6 w-6" />
      <span className="text-sm font-black uppercase tracking-[0.14em]">{label}</span>
    </Link>
  );
}
