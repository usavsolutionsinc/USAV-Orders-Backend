import { Suspense } from 'react';
import TechDashboard from '@/components/TechDashboard';

export default async function TechPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <Suspense fallback={null}>
            <TechDashboard techId={id} />
        </Suspense>
    );
}
