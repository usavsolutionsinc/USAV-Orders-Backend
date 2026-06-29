import { Check } from '@/components/Icons';
import type { AddedItem } from './mobile-identify-shared';

export function SessionList({ added }: { added: AddedItem[] }) {
  return (
    <div className="mb-1 w-[min(92vw,420px)] space-y-1">
      {added.slice(0, 3).map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="truncate text-white/80">{a.title}</span>
          <span className="ml-auto text-white/30">added</span>
        </div>
      ))}
      {added.length > 0 && (
        <div className="text-center text-caption text-white/40">{added.length} added this session</div>
      )}
    </div>
  );
}
