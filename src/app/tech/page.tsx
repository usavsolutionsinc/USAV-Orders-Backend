import { Suspense } from 'react';
import { TechPageContent } from '@/components/tech/TechPageContent';

export default async function TechPage({
  searchParams,
}: {
  searchParams: Promise<{ staffId?: string }>;
}) {
  const params = await searchParams;
  const staffId = String(params?.staffId || '').trim();
  const techId = /^\d+$/.test(staffId) ? staffId : '1';

  return (
    <Suspense fallback={null}>
      <TechPageContent techId={techId} />
    </Suspense>
  );
}
