'use client';

/**
 * Standalone preview of the card-fan-carousel component.
 * Open at /design-demo/card-fan to see the fan with stock photos.
 */

import SocialCards, { type CardItem } from '@/components/ui/card-fan-carousel';

const DEMO_CARDS: CardItem[] = [
  { imgUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=700&fit=crop', alt: 'Headphones' },
  { imgUrl: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&h=700&fit=crop', alt: 'Camera gear' },
  { imgUrl: 'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=400&h=700&fit=crop', alt: 'Boxed electronics' },
  { imgUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400&h=700&fit=crop', alt: 'Smart watch' },
  { imgUrl: 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=400&h=700&fit=crop', alt: 'Laptop on bench' },
  { imgUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&h=700&fit=crop', alt: 'Phone' },
  { imgUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&h=700&fit=crop', alt: 'Laptop' },
  { imgUrl: 'https://images.unsplash.com/photo-1487215078519-e21cc028cb29?w=400&h=700&fit=crop', alt: 'Workbench' },
  { imgUrl: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&h=700&fit=crop', alt: 'Components' },
  { imgUrl: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=400&h=700&fit=crop', alt: 'Gadgets' },
];

export default function CardFanDemoPage() {
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-slate-200">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-8 px-6 py-12">
        <header className="text-center">
          <h1 className="text-2xl font-black text-slate-800">Card Fan Carousel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hover a card to spread the fan · use the arrows to page through · this is the
            same display the live unbox photo peek renders.
          </p>
        </header>
        <SocialCards cards={DEMO_CARDS} />
      </div>
    </div>
  );
}
