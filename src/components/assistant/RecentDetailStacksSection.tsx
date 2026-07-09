'use client';

/**
 * RecentDetailStacksSection — the "recently opened detail stacks" list in the
 * context rail. Each row re-opens the slide-over in place (no navigation) via
 * the global detail-stack host.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from '@/components/Icons';
import { useAssistantDockControls } from '@/components/assistant/AssistantProvider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useRecentDetailStacks } from '@/hooks/useRecentDetailStacks';
import type { DetailStackEntry } from '@/lib/detail-stacks/history-store';
import { removeDetailStack } from '@/lib/detail-stacks/history-store';
import { openDetailStack } from '@/lib/detail-stacks/open-store';
import { DETAIL_STACK_DEFS } from '@/lib/detail-stacks/registry';

const RECENT_VISIBLE = 4;

export function RecentDetailStacksSection() {
  const assistant = useAssistantDockControls();
  const recents = useRecentDetailStacks();
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = recents.length > RECENT_VISIBLE;
  const visible = expanded || !hasOverflow ? recents : recents.slice(0, RECENT_VISIBLE);

  const openRecent = (entry: DetailStackEntry) => {
    if (assistant.open) assistant.setOpen(false);
    openDetailStack({ kind: entry.kind, id: entry.id });
  };

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center justify-between px-2 py-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Recently opened</p>
        {hasOverflow ? (
          /* ds-raw-button: compact expand/collapse — not a DS Button variant */
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="-my-0.5 inline-flex items-center gap-0.5 px-1 py-0.5 text-mini font-semibold text-text-faint hover:text-text-muted"
          >
            {expanded ? (
              <>
                Less <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                {recents.length - RECENT_VISIBLE} more <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        ) : null}
      </div>
      {recents.length === 0 ? (
        <p className="px-2 py-1.5 text-mini text-text-faint">Detail panels you open will appear here.</p>
      ) : (
        <ul className="space-y-0.5">
          {visible.map((e) => {
            const Icon = DETAIL_STACK_DEFS[e.kind].Icon;
            return (
              <li key={`${e.kind}:${e.id}`}>
                <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-sunken">
                  {/* ds-raw-button: full-width left-aligned re-open row — not a DS Button variant */}
                  <button
                    type="button"
                    onClick={() => openRecent(e)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    <span className="truncate text-caption font-semibold text-text-default">{e.label}</span>
                  </button>
                  <HoverTooltip label="Remove" focusable={false}>
                    {/* ds-raw-button: icon-only quiet remove affordance */}
                    <button
                      type="button"
                      onClick={() => removeDetailStack(e.kind, e.id)}
                      aria-label={`Remove ${e.label}`}
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3 text-text-faint hover:text-text-default" />
                    </button>
                  </HoverTooltip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
