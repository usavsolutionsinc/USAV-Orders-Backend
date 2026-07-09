'use client';

import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';

interface StatusCardProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** Primary big number / status pill. */
  primary?: ReactNode;
  /** Secondary muted line under the primary value. */
  secondary?: ReactNode;
  /** Tertiary one-line note (shown smaller, still inside the card body). */
  tertiary?: ReactNode;
  /** Drill-down link target. */
  href?: string;
  /** Drill-down link label. */
  linkLabel?: string;
  /** Loading state — replaces the metric with a skeleton bar. */
  loading?: boolean;
  /** Error state — replaces the metric with a red note. */
  error?: string | null;
  /** Empty state — shown when there's nothing to report. */
  empty?: string | null;
  /** Optional accent style for the primary number. */
  tone?: 'default' | 'good' | 'warn' | 'bad';
  /** Optional full-width body for richer cards (audit preview, etc.) — overrides primary/secondary/tertiary if provided. */
  children?: ReactNode;
  /** Span 2 grid columns on >=md breakpoints. Useful for the audit row. */
  wide?: boolean;
}

const TONE_CLASS: Record<NonNullable<StatusCardProps['tone']>, string> = {
  default: 'text-text-default',
  good:    'text-emerald-600',
  warn:    'text-amber-600',
  bad:     'text-rose-600',
};

export function StatusCard({
  icon: Icon,
  title,
  primary,
  secondary,
  tertiary,
  href,
  linkLabel = 'Open →',
  loading,
  error,
  empty,
  tone = 'default',
  children,
  wide,
}: StatusCardProps) {
  return (
    <section
      className={`rounded-lg border border-border-soft bg-surface-card p-5 shadow-sm ${wide ? 'md:col-span-2' : ''}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="h-4 w-4 text-text-soft" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-soft">{title}</h3>
        </div>
        {href && (
          <Link
            href={href}
            className="text-xs font-medium text-sky-600 hover:text-sky-700"
          >
            {linkLabel}
          </Link>
        )}
      </header>

      <div className="mt-3">
        {children ? (
          children
        ) : loading ? (
          <div className="space-y-2">
            <div className="h-7 w-24 animate-pulse rounded bg-surface-sunken" />
            <div className="h-3 w-40 animate-pulse rounded bg-surface-sunken" />
          </div>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : empty ? (
          <p className="text-sm text-text-soft">{empty}</p>
        ) : (
          <>
            {primary !== undefined && (
              <div className={`text-3xl font-semibold ${TONE_CLASS[tone]}`}>{primary}</div>
            )}
            {secondary !== undefined && (
              <div className="mt-1 text-sm text-text-muted">{secondary}</div>
            )}
            {tertiary !== undefined && (
              <div className="mt-1 text-xs text-text-soft">{tertiary}</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
