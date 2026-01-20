'use client';

import DashboardSidebar from '@/components/DashboardSidebar';
import PageLayout from '@/components/PageLayout';

export default function DashboardPage() {
    return (
        <div className="w-full h-full flex">
            <PageLayout
                sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
                showChecklist={false}
                showSidebar={false}
                editMode={true}
                customSidebar={<DashboardSidebar />}
            />
        </div>
    );
}

