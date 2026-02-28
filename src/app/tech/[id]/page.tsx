import { Suspense } from 'react';
import TechDashboard from '@/components/TechDashboard';

const techGids: Record<string, string> = {
    '1': '1309948852',
    '2': '486128229',
    '3': '1376429630',
};

export default async function TechPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <Suspense fallback={null}>
            <TechDashboard
                techId={id}
                sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
                gid={techGids[id]}
            />
        </Suspense>
    );
}
