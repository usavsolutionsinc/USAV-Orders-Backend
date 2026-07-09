'use client';

import { useMemo } from 'react';
import { ExternalLink } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { WorkspaceCard } from '@/design-system/components';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

function parseLinksParam(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (!t) continue;
      out.push(t);
    }
    return out;
  } catch {
    return [];
  }
}

export default function OpenLinksPage() {
  const links = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return parseLinksParam(sp.get('links'));
  }, []);

  const openAll = () => {
    for (const href of links) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <WorkspaceCard variant="solid" bodyClassName="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black uppercase tracking-widest text-text-default">
              Listing links
            </div>
            <div className="mt-1 text-caption text-text-muted">
              Open links from here to avoid popup blockers on “Open all”.
            </div>
          </div>
          <HoverTooltip label={links.length ? 'Open every link' : 'No links'} asChild>
            <Button type="button" size="sm" variant="primary" onClick={openAll} disabled={!links.length}>
              Open all
            </Button>
          </HoverTooltip>
        </div>

        {!links.length ? (
          <div className="rounded-md border border-border-hairline bg-surface-card/70 px-3 py-2 text-caption text-text-muted">
            No links provided.
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((href, i) => (
              <button
                key={`${href}-${i}`}
                type="button"
                onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border-hairline bg-surface-card/70 px-3 py-2 text-left text-caption font-semibold text-text-muted transition hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate">{href}</span>
                <ExternalLink className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </WorkspaceCard>
    </div>
  );
}

