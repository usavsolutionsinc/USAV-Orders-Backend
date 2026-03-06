import { Suspense } from 'react';
import TechDashboard from '@/components/TechDashboard';

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
      <TechDashboard techId={techId} />
    </Suspense>
  );
}
