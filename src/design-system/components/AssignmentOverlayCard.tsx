'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';

interface AssignmentOverlayCardProps {
  topBar?: ReactNode;
  headerEyebrow?: ReactNode;
  /** Omit or pass `null` to hide the `<h3>` (e.g. render the title inside `children` instead). */
  title?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
  bodyClassName?: string;
  widthClassName?: string;
  /** Merged into `<header>` (e.g. `py-2` for a denser toolbar + title block). */
  headerClassName?: string;
  /**
   * `center` — flex-centered in the viewport; dialog height follows content up to max-h.
   * `midAnchor` — horizontal center; bottom edge sits on the viewport midline so extra height grows upward only.
   * `bottom` — pinned above the safe bottom; extra height grows upward; max-h caps overflow.
   */
  dialogPosition?: 'center' | 'midAnchor' | 'bottom';
  showHeaderGradient?: boolean;
  showCloseButton?: boolean;
}

export function AssignmentOverlayCard({
  topBar,
  headerEyebrow,
  title,
  subtitle,
  meta,
  children,
  footer,
  onClose,
  className = '',
  bodyClassName = '',
  widthClassName = 'w-[94vw] max-w-[480px]',
  headerClassName = '',
  dialogPosition = 'center',
  showHeaderGradient = true,
  showCloseButton = true,
}: AssignmentOverlayCardProps) {
  const isBottom = dialogPosition === 'bottom';
  const isMidAnchor = dialogPosition === 'midAnchor';

  const maxHeightClass = isMidAnchor
    ? 'max-h-[calc(50vh-env(safe-area-inset-top,0px)-0.75rem)]'
    : 'max-h-[min(92vh,860px)]';

  const sectionShell = [
    'flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-300/70 bg-white shadow-[0_28px_72px_rgba(15,23,42,0.22)]',
    maxHeightClass,
    widthClassName,
    className,
  ]
    .join(' ')
    .trim();

  const headerBlock = (
    <header
      className={`shrink-0 border-b border-slate-400/20 px-4 py-3 ${showHeaderGradient ? 'bg-[linear-gradient(180deg,#2563EB,#3B82F6)] text-white' : ''} ${headerClassName}`.trim()}
    >
      {headerEyebrow ? (
        <div
          className={`mb-1.5 w-full min-w-0 ${showHeaderGradient ? 'text-blue-100' : 'text-slate-600'}`.trim()}
        >
          {headerEyebrow}
        </div>
      ) : null}
      <div
        className={`flex items-start justify-between gap-3 ${subtitle || meta ? 'mb-2' : 'mb-0'}`.trim()}
      >
        <div className="min-w-0 flex-1">
          {!headerEyebrow ? (
            <div className={`${showHeaderGradient ? 'text-blue-100' : 'text-slate-600'}`.trim()}>
              <p className={`truncate text-[9px] font-black uppercase tracking-[0.10rem] ${showHeaderGradient ? 'text-blue-100' : 'text-slate-500'}`.trim()}>
                Assignment
              </p>
            </div>
          ) : null}
          {title != null ? (
            <h3
              className={`text-[22px] font-black leading-[1.1] tracking-tight ${showHeaderGradient ? 'text-white' : 'text-slate-950'} ${!headerEyebrow ? 'mt-1' : ''}`.trim()}
            >
              {title}
            </h3>
          ) : null}
          {subtitle ? (
            <div
              className={`mt-2 min-w-0 ${showHeaderGradient ? 'text-blue-100' : ''}`.trim()}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        {showCloseButton ? (
          <button
            type="button"
            onClick={onClose}
            className={`mt-0.5 shrink-0 transition-colors duration-100 ease-out hover:opacity-100 active:scale-95 ${showHeaderGradient ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`.trim()}
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
  );

  const bodyClasses = `flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3 ${bodyClassName}`.trim();

  const dialog = (
    <section role="dialog" aria-modal="true" className={sectionShell}>
      {topBar ? <div className="shrink-0 border-b border-gray-100">{topBar}</div> : null}
      {headerBlock}

      <div className={bodyClasses}>{children}</div>

      {footer ? (
        <footer className="shrink-0 border-t border-slate-400/20 px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );

  return (
    <>
      <button
        type="button"
        aria-label="Close overlay"
        onClick={onClose}
        className="fixed inset-0 z-[1200] bg-slate-950/55 backdrop-blur-[4px]"
      />
      {isBottom ? (
        <div className="pointer-events-none fixed inset-0 z-[1201] flex items-end justify-center p-3 pb-[max(1rem,5vh)] sm:p-4 sm:pb-[max(1rem,5vh)]">
          <div className="pointer-events-auto min-w-0">{dialog}</div>
        </div>
      ) : isMidAnchor ? (
        <div className="pointer-events-auto fixed bottom-1/2 left-1/2 z-[1201] min-w-0 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 sm:max-w-[calc(100vw-2rem)]">
          {dialog}
        </div>
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-3 sm:p-4">
          <div className="pointer-events-auto min-w-0">{dialog}</div>
        </div>
      )}
    </>
  );
}
