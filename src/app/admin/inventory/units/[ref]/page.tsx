import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy admin route — the unit timeline now lives inside the inventory shell.
 * Preserve old bookmarks / cross-references by 308-redirecting to the
 * canonical `/inventory?unit=[ref]` URL.
 */
export default async function LegacyUnitTimelineRedirect({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const cleaned = decodeURIComponent(ref || '').trim();
  redirect(cleaned ? `/inventory?unit=${encodeURIComponent(cleaned)}` : '/inventory');
}
