import PageLayout from '@/components/PageLayout';

const techGids: Record<string, string> = {
    '1': '1309948852',
    '2': '486128229',
    '3': '1376429630',
};

export default async function TechPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <PageLayout
            role="technician"
            userId={id}
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid={techGids[id]}
            showChecklist={true}
        />
    );
}
