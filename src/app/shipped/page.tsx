import PageLayout from '@/components/PageLayout';
import ShippedSidebar from '@/components/ShippedSidebar';

export default function ShippedPage() {
    return (
        <PageLayout
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid="316829503"
            showChecklist={false}
            customSidebar={<ShippedSidebar />}
        />
    );
}
