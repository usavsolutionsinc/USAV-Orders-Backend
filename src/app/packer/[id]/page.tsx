import PageLayout from '@/components/PageLayout';

const packerGids: Record<string, string> = {
    '1': '0',
    '2': '797238258',
};

export default function PackerPage({ params }: { params: { id: string } }) {
    return (
        <PageLayout
            role="packer"
            userId={params.id}
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid={packerGids[params.id]}
            showChecklist={true}
        />
    );
}
