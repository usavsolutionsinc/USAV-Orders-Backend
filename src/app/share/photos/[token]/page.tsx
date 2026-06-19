import PublicSharePhotosPage from '@/components/photos/PublicSharePhotosPage';

export const dynamic = 'force-dynamic';

export default async function SharePhotosPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicSharePhotosPage token={token} />;
}
