'use client';

import React from 'react';
import { Menu } from '@/components/Icons';

/** Operations shell header: menu only (opens mobile drawer via custom event). */
export function GlobalHeaderBar() {
  return (
    <header className="sticky top-0 z-40 flex h-12 w-full select-none items-center border-b border-gray-200 bg-white/90 px-3 backdrop-blur-md sm:px-4">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-drawer'))}
        aria-label="Open navigation"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
      >
        <Menu className="h-4 w-4" />
      </button>
    </header>
  );
}
