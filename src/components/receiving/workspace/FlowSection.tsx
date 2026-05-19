'use client';

import { type ReactNode } from 'react';
import { ChevronDown } from '@/components/Icons';
import {
  FLOW_SECTION_BTN_CLASS,
  FLOW_SECTION_TITLE_CLASS,
  FLOW_SECTION_SUMMARY_CLASS,
  FLOW_SECTION_TONE_STYLES,
  RECEIVING_TRAIL_SLOT_CLASS,
  type FlowSectionTone,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

interface FlowSectionProps {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Color lane for this section — applied to the header trigger only. */
  tone: FlowSectionTone;
  /** Wrapping paddings around section body when open (default matches other panels). */
  bodyClassName?: string;
  /**
   * When true, the FlowSection drops its own white surface and rail — it
   * assumes the parent (a `<WorkspaceCard>` for example) is providing the
   * card frame. The header still carries the tone-colored background so the
   * section remains visually grouped, but no doubled-up background occurs.
   */
  embedded?: boolean;
  children: ReactNode;
}

/**
 * Collapsible flow section used by the receiving workspace (Shipment / Item /
 * Support lanes). Header carries a tone-colored background + rail and stays
 * the only colored surface; body is white so the dense fields read clean.
 *
 * Pass `embedded` when nesting inside another card frame to avoid a
 * doubled-up white surface.
 */
export function FlowSection({
  title,
  summary,
  open,
  onToggle,
  tone,
  bodyClassName = 'px-2 py-2.5',
  embedded = false,
  children,
}: FlowSectionProps) {
  const styles = FLOW_SECTION_TONE_STYLES[tone];
  return (
    <div className={embedded ? '' : 'bg-white'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${FLOW_SECTION_BTN_CLASS} ${styles.header} relative ${embedded ? 'rounded-t-2xl' : ''}`}
      >
        <span
          className={`absolute inset-y-0 left-0 w-[3px] ${styles.rail} ${embedded ? 'rounded-l-2xl' : ''}`}
          aria-hidden
        />
        <span className={`${FLOW_SECTION_TITLE_CLASS} ${styles.title}`}>{title}</span>
        {summary != null && summary !== '' ? (
          <span className="min-w-0 flex-1 text-right">
            <span className={FLOW_SECTION_SUMMARY_CLASS}>{summary}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span className={RECEIVING_TRAIL_SLOT_CLASS}>
          <ChevronDown
            className={`h-[14px] w-[14px] shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open ? (
        <>
          <div className="border-t border-slate-100" aria-hidden />
          <div className={bodyClassName}>{children}</div>
        </>
      ) : null}
    </div>
  );
}
