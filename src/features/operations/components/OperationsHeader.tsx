'use client';

import React from 'react';

export function OperationsHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-header w-full bg-surface-card border-b border-border-soft shadow-sm">
      <div className="h-11 px-4 flex items-center">
        <h2 className="text-sm font-black tracking-tight text-text-default uppercase">
          {title} <span className="text-text-faint font-medium ml-1">/ Operations</span>
        </h2>
      </div>
    </header>
  );
}
