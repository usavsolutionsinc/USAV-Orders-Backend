import PageLayout from '@/components/PageLayout';

const packerGids: Record<string, string> = {
    '1': '0',
    '2': '797238258',
};

export default async function PackerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <PageLayout
            role="packer"
            userId={id}
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid={packerGids[id]}
            showChecklist={true}
        />
    );
}
