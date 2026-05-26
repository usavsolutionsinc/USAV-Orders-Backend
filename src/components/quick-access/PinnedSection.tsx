'use client';

import { useRouter } from 'next/navigation';
import { X } from '@/components/Icons';
import { Row } from './Row';
import { PinThisPageButton } from './PinThisPageButton';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';

const BookmarkIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

interface PinnedSectionProps {
  onNavigate: () => void;
}

export function PinnedSection({ onNavigate }: PinnedSectionProps) {
  const router = useRouter();
  const { settings, unpin } = useQuickAccess();

  return (
    <div className="px-2 pb-2 pt-1">
      <div className="flex items-center justify-between px-2 pb-0.5">
        <p className="text-micro font-bold uppercase tracking-widest text-gray-400">Pinned</p>
        <PinThisPageButton />
      </div>

      {settings.pinned.length === 0 ? (
        <p className="px-2 py-3 text-caption font-medium text-gray-500">
          No pinned pages yet. Use <span className="font-semibold text-blue-600">+ Pin page</span> to bookmark the current page.
        </p>
      ) : (
        <div className="space-y-0.5">
          {settings.pinned.map((p) => (
            <Row
              key={p.id}
              icon={<BookmarkIcon className="h-4 w-4" />}
              iconBg="bg-gray-900"
              label={p.label}
              subLabel={<span className="font-mono">{p.href}</span>}
              trailing={
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    unpin(p.id);
                  }}
                  aria-label={`Unpin ${p.label}`}
                  title="Unpin"
                  className="invisible flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700 group-hover:visible"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              }
              onClick={() => {
                router.push(p.href);
                onNavigate();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PinnedSection;
