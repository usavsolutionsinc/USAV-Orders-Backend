'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';

interface AssignmentOverlayCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
  bodyClassName?: string;
  widthClassName?: string;
  showHeaderGradient?: boolean;
  showCloseButton?: boolean;
}

export function AssignmentOverlayCard({
  title,
  subtitle,
  meta,
  children,
  footer,
  onClose,
  className = '',
  bodyClassName = '',
  widthClassName = 'w-[94vw] max-w-[480px]',
  showHeaderGradient = true,
  showCloseButton = true,
}: AssignmentOverlayCardProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Close overlay"
        onClick={onClose}
        className="fixed inset-0 z-[1200] bg-slate-950/55 backdrop-blur-[4px]"
      />
      <section
        role="dialog"
        aria-modal="true"
        className={`fixed left-1/2 top-1/2 z-[1201] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-slate-300/70 bg-white shadow-[0_28px_72px_rgba(15,23,42,0.22)] ${widthClassName} ${className}`.trim()}
      >
        <header className={`border-b border-slate-400/20 px-4 py-3 ${showHeaderGradient ? 'bg-[linear-gradient(180deg,#2563EB,#3B82F6)] text-white' : ''}`.trim()}>
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`truncate text-[9px] font-black uppercase tracking-[0.10rem] ${showHeaderGradient ? 'text-blue-100' : 'text-slate-500'}`.trim()}>
                Assignment
              </p>
              <h3 className={`mt-1 text-[22px] font-black leading-[1.1] tracking-tight ${showHeaderGradient ? 'text-white' : 'text-slate-950'}`.trim()}>
                {title}
              </h3>
              {subtitle ? (
                <p className={`mt-1 text-[10px] font-medium ${showHeaderGradient ? 'text-blue-100' : 'text-slate-500'}`.trim()}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className={`mt-0.5 transition-colors duration-100 ease-out hover:opacity-100 active:scale-95 ${showHeaderGradient ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`.trim()}
                aria-label="Close"
                title="Close"
              >
                <X className="h-[14px] w-[14px]" />
              </button>
            ) : null}
          </div>
          {meta ? (
            <div className={`text-[9px] font-black uppercase tracking-[0.08em] ${showHeaderGradient ? 'text-blue-100' : 'text-slate-500'}`.trim()}>
              {meta}
            </div>
          ) : null}
        </header>

        <div className={`max-h-[70vh] overflow-y-auto px-4 py-3 ${bodyClassName}`.trim()}>
          {children}
        </div>

        {footer ? (
          <footer className="border-t border-slate-400/20 px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </section>
    </>
  );
}
