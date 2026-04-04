import { PackerPageContent } from '@/components/packer/PackerPageContent';

export default async function PackerPage({
  searchParams,
}: {
  searchParams: Promise<{ staffId?: string }>;
}) {
  const params = await searchParams;
  const staffId = String(params?.staffId || '').trim();
  const packerId = /^\d+$/.test(staffId) ? staffId : '4';

  return <PackerPageContent packerId={packerId} />;
}
