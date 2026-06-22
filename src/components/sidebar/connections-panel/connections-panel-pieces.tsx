import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from '@/components/Icons';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';

export function SidebarSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-gray-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-gray-200 px-0 py-0 text-left hover:bg-gray-50"
      >
        <span className={`px-4 py-3 ${sectionLabel}`}>{title}</span>
        <span className="inline-flex h-full w-12 items-center justify-center border-l border-gray-200 text-gray-600">
          <span className="relative h-3.5 w-3.5">
            <span className="absolute left-0 top-1/2 h-px w-3.5 -translate-y-1/2 bg-current" />
            <motion.span
              initial={false}
              animate={{ scaleY: expanded ? 0 : 1, opacity: expanded ? 0 : 1 }}
              transition={framerTransition.overlayScrim}
              className="absolute left-1/2 top-0 h-3.5 w-px -translate-x-1/2 bg-current origin-center"
            />
          </span>
        </span>
      </button>
      {expanded && <div className="bg-white">{children}</div>}
    </section>
  );
}

export function LineItem({
  label,
  detail,
  right,
}: {
  label: string;
  detail?: string;
  right: ReactNode;
}) {
  return (
    <div className="flex items-stretch justify-between gap-3 border-b border-gray-200 bg-white">
      <div className="min-w-0 px-4 py-3">
        <p className={dataValue}>{label}</p>
        {detail ? <p className={`mt-0.5 ${fieldLabel} leading-relaxed text-gray-500`}>{detail}</p> : null}
      </div>
      <div className="flex shrink-0 items-stretch gap-0">{right}</div>
    </div>
  );
}

export function ActionButton({
  onClick,
  loading,
  title,
  tone = 'default',
  disabled,
}: {
  onClick: () => void;
  loading?: boolean;
  title: string;
  tone?: 'default' | 'blue' | 'green' | 'indigo';
  disabled?: boolean;
}) {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-300 bg-blue-50 text-blue-700'
      : tone === 'green'
        ? 'border-green-300 bg-green-50 text-green-700'
        : tone === 'indigo'
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex h-full w-12 items-center justify-center border-l transition-colors disabled:opacity-50 ${toneClass}`}
      title={title}
      aria-label={title}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}
