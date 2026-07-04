'use client';

/**
 * /signals page body — hosts the two domain-linked history surfaces
 * (universal-feed plan Phase 5) as `?mode=` modes on one page:
 *   - timeline (default) → Monitor: org-scoped newest-first signal timeline.
 *   - browse             → Workbench: searchable list + selected-signal detail.
 * Each is a distinct archetype region; the mode rail switches between them and
 * clears mode-scoped params so a selection/filter never bleeds across modes.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SignalsHistoryWorkspace } from './SignalsHistoryWorkspace';
import { SignalsBrowseWorkspace } from './SignalsBrowseWorkspace';

const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'timeline', label: 'Timeline', tone: 'blue' },
  { id: 'browse', label: 'Browse', tone: 'blue' },
];

export function SignalsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'browse' ? 'browse' : 'timeline';

  const setMode = (next: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next === 'browse') sp.set('mode', 'browse');
    else sp.delete('mode'); // timeline is the default → drop the param
    // Mode-scoped params clear on switch (Workbench selection / Monitor window).
    sp.delete('signalId');
    sp.delete('window');
    const qs = sp.toString();
    router.replace(qs ? `/signals?${qs}` : '/signals', { scroll: false });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-border-hairline px-4 py-2">
        <HorizontalButtonSlider items={MODE_ITEMS} value={mode} onChange={setMode} variant="nav" dense />
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'browse' ? <SignalsBrowseWorkspace /> : <SignalsHistoryWorkspace />}
      </div>
    </div>
  );
}
