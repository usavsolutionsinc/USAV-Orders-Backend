import PackerDashboard from '@/components/PackerDashboard';

export default async function PackerPage({
  searchParams,
}: {
  searchParams: Promise<{ staffId?: string }>;
}) {
  const params = await searchParams;
  const staffId = String(params?.staffId || '').trim();
  const packerId = /^\d+$/.test(staffId) ? staffId : '4';

  return <PackerDashboard packerId={packerId} />;
}
