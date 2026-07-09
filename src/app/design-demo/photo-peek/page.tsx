'use client';

/**
 * Isolation harness for PhotoPeekFan — renders the peek over a mock unbox panel
 * so the corner → fan → expand gesture can be exercised + Playwright-tested
 * without a real carton. Open /design-demo/photo-peek.
 */

import { PhotoPeekFan, type PeekCard } from '@/components/receiving/workspace/line-edit/PhotoPeekFan';

const CARDS: PeekCard[] = [
  { id: 'p1', imgUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=560&fit=crop', alt: 'Headphones' },
  { id: 'p2', imgUrl: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&h=560&fit=crop', alt: 'Camera gear' },
  { id: 'p3', imgUrl: 'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=400&h=560&fit=crop', alt: 'Boxed electronics' },
  { id: 'p4', imgUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400&h=560&fit=crop', alt: 'Smart watch' },
  { id: 'p5', imgUrl: 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=400&h=560&fit=crop', alt: 'Laptop' },
  { id: 'p6', imgUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&h=560&fit=crop', alt: 'Phone' },
  { id: 'p7', imgUrl: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&h=560&fit=crop', alt: 'Components' },
  { id: 'p8', imgUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&h=560&fit=crop', alt: 'Laptop 2' },
  { id: 'p9', imgUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=560&fit=crop', alt: 'Macbook' },
  { id: 'p10', imgUrl: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=400&h=560&fit=crop', alt: 'Gradient' },
  { id: 'p11', imgUrl: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=400&h=560&fit=crop', alt: 'Headphones 2' },
  { id: 'p12', imgUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=560&fit=crop', alt: 'Headphones 3' },
];

export default function PhotoPeekDemoPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-surface-sunken p-6">
      {/* Mock right-pane: same relative + gray surface as the unbox LineEditPanel. */}
      <div className="relative flex h-[720px] w-[900px] flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-canvas shadow-xl">
        <div className="border-b border-border-hairline px-5 py-3 text-caption font-black uppercase tracking-widest text-text-faint">
          Mock unbox panel
        </div>
        <div className="flex-1 space-y-3 p-5">
          <div className="h-24 rounded-xl bg-surface-card shadow-sm" />
          <div className="h-32 rounded-xl bg-surface-card shadow-sm" />
          <div className="h-40 rounded-xl bg-surface-card shadow-sm" />
        </div>
        <PhotoPeekFan cards={CARDS} />
      </div>
    </div>
  );
}
