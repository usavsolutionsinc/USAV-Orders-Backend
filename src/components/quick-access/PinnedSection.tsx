'use client';

import { useRouter } from 'next/navigation';
import { History, Star, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { Row } from './Row';
import { PinThisPageButton } from './PinThisPageButton';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { resolveQuickAccessMeta } from '@/lib/quick-access/page-label';

interface PinnedSectionProps {
  onNavigate: () => void;
}

export function PinnedSection({ onNavigate }: PinnedSectionProps) {
  const router = useRouter();
  const { settings, unpin } = useQuickAccess();

  return (
    <div className="px-2 pb-2 pt-1">
      <div className="flex items-center justify-between px-2 pb-0.5">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Pinned</p>
        <PinThisPageButton />
      </div>

      {settings.pinned.length === 0 ? (
        <p className="px-2 py-3 text-caption font-medium text-text-soft">
          No pinned pages yet. Use <span className="font-semibold text-blue-600">Pin page</span> to bookmark the current page.
        </p>
      ) : (
        <div className="space-y-0.5">
          {settings.pinned.map((p) => {
            const meta = resolveQuickAccessMeta(p.href, p.label);
            return (
              <Row
                key={p.id}
                icon={<Star className="h-3.5 w-3.5" />}
                label={p.label}
                subLabel={meta ?? undefined}
                trailing={
                  <HoverTooltip label="Unpin" asChild focusable={false}>
                    <IconButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        unpin(p.id);
                      }}
                      ariaLabel={`Unpin ${p.label}`}
                      className="invisible flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-surface-strong hover:text-text-muted group-hover:visible"
                      icon={<X className="h-3.5 w-3.5" />}
                    />
                  </HoverTooltip>
                }
                onClick={() => {
                  router.push(p.href);
                  onNavigate();
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
