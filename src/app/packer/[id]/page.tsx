import { redirect } from 'next/navigation';

export default async function PackerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/packer?staffId=${encodeURIComponent(id)}`);
}
