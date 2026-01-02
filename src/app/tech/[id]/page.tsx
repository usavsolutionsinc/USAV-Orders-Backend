import PageLayout from '@/components/PageLayout';

const techGids: Record<string, string> = {
    '1': '1309948852',
    '2': '486128229',
    '3': '1376429630',
};

export default function TechPage({ params }: { params: { id: string } }) {
    return (
        <PageLayout
            role="technician"
            userId={params.id}
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid={techGids[params.id]}
            showChecklist={true}
        />
    );
}
