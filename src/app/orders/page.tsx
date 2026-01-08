import PageLayout from '@/components/PageLayout';
import OrdersSidebar from '@/components/OrdersSidebar';

export default function OrdersPage() {
    return (
        <PageLayout
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid="719315456"
            showChecklist={false}
            customSidebar={<OrdersSidebar />}
        />
    );
}
