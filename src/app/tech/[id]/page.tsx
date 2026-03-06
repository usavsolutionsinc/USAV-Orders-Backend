import { redirect } from 'next/navigation';

export default async function TechPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/tech?staffId=${encodeURIComponent(id)}`);
}
