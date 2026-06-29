'use client';

import { useRouter } from 'next/navigation';
import { Row } from './Row';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';

const ClockIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

interface RecentSectionProps {
  onNavigate: () => void;
}

export function RecentSection({ onNavigate }: RecentSectionProps) {
  const router = useRouter();
  const { recents, settings, pin, isHrefPinned } = useQuickAccess();

  if (recents.length === 0) return null;

  // Hide pages that are already pinned — they're already in the section above
  const visible = recents.filter((r) => !isHrefPinned(r.href)).slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <div className="px-2 pb-2 pt-1">
      <p className="px-2 pb-0.5 text-micro font-bold uppercase tracking-widest text-gray-400">Recent</p>
      <div className="space-y-0.5">
        {visible.map((r) => (
          <Row
            key={r.href}
            icon={<ClockIcon className="h-4 w-4" />}
            iconBg="bg-gray-400"
            label={r.label}
            subLabel={<span className="font-mono">{r.href}</span>}
            trailing={
              settings.pinned.length < 30 ? (
                <HoverTooltip label="Pin" asChild focusable={false}>
                  <IconButton
                    tone="accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      pin({ href: r.href, label: r.label });
                    }}
                    ariaLabel={`Pin ${r.label}`}
                    className="invisible flex h-6 w-6 items-center justify-center rounded-md hover:bg-blue-50 group-hover:visible"
                    icon={
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    }
                  />
                </HoverTooltip>
              ) : null
            }
            onClick={() => {
              router.push(r.href);
              onNavigate();
            }}
          />
        ))}
      </div>
    </div>
  );
}
