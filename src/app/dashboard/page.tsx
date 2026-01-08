import PageLayout from '@/components/PageLayout';
import DashboardSidebar from '@/components/DashboardSidebar';

export default function DashboardPage() {
    return (
        <PageLayout
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            showChecklist={false}
            showSidebar={false}
            editMode={true}
            customSidebar={<DashboardSidebar />}
        />
    );
}

