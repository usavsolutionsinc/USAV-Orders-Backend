import PageLayout from '@/components/PageLayout';

export default function TechPage({ params }: { params: { id: string } }) {
    return (
        <PageLayout
            role="technician"
            userId={params.id}
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            showChecklist={true}
        />
    );
}
