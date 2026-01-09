import PackerDashboard from '@/components/PackerDashboard';

export default async function PackerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <PackerDashboard packerId={id} />
    );
}
