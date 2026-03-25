'use client';

import type { ReactNode } from 'react';

interface StationFbaProps {
  embedded?: boolean;
  children: ReactNode;
}

/** FBA main column shell (welcome lives in the FBA sidebar). */
export default function StationFba({ embedded = false, children }: StationFbaProps) {
  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-white ${embedded ? '' : 'border-r border-gray-100'}`}
    >
      {children}
    </div>
  );
}
