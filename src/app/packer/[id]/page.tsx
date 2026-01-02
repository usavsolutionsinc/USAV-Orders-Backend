import PageLayout from '@/components/PageLayout';

export default function PackerPage({ params }: { params: { id: string } }) {
    return (
        <PageLayout
            role="packer"
            userId={params.id}
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            showChecklist={true}
        />
    );
}
