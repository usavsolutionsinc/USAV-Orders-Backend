import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
    let orders = [];
    let error = null;

    try {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
            orders = result.rows;
        } finally {
            client.release();
        }
    } catch (e: any) {
        console.error('Database Error:', e);
        error = e.message || 'Failed to fetch orders';
        // Fallback mock data for demonstration if DB fails (optional, but good for dev)
        if (process.env.NODE_ENV === 'development') {
            orders = [
                { id: 'ORD-001', customer: 'Acme Corp', status: 'Pending', total: 1200.50, created_at: new Date().toISOString() },
                { id: 'ORD-002', customer: 'Globex', status: 'Shipped', total: 550.00, created_at: new Date().toISOString() },
            ];
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Order Management</h1>
                        <p className="mt-2 text-sm text-gray-500">Enterprise view of all system orders.</p>
                    </div>
                    <div className="flex gap-4">
                        <button className="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 border border-gray-300">
                            Export
                        </button>
                        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                            New Order
                        </button>
                    </div>
                </header>

                {error && (
                    <div className="mb-6 rounded-md bg-red-50 p-4 border border-red-200">
                        <div className="flex">
                            <div className="ml-3">
                                <h3 className="text-sm font-medium text-red-800">Error fetching orders</h3>
                                <div className="mt-2 text-sm text-red-700">
                                    <p>{error}</p>
                                    <p className="mt-1 text-xs">Make sure DATABASE_URL is set in .env.local and the 'orders' table exists.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    {['Order ID', 'Customer', 'Status', 'Total', 'Date', 'Actions'].map((header) => (
                                        <th
                                            key={header}
                                            scope="col"
                                            className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                                        >
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {orders.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500">
                                            No orders found.
                                        </td>
                                    </tr>
                                ) : (
                                    orders.map((order: any, idx: number) => (
                                        <tr key={order.id || idx} className="hover:bg-gray-50 transition-colors">
                                            <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                                                {order.id}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                                                {order.customer_name || order.customer || 'N/A'}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                                                <span
                                                    className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${(order.status || '').toLowerCase() === 'shipped' || (order.status || '').toLowerCase() === 'completed'
                                                            ? 'bg-green-100 text-green-800'
                                                            : (order.status || '').toLowerCase() === 'pending'
                                                                ? 'bg-yellow-100 text-yellow-800'
                                                                : 'bg-gray-100 text-gray-800'
                                                        }`}
                                                >
                                                    {order.status || 'Unknown'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                                                ${Number(order.total || order.amount || 0).toFixed(2)}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                                                {order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                                                <a href="#" className="text-blue-600 hover:text-blue-900">
                                                    View
                                                </a>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="border-t border-gray-200 bg-gray-50 px-6 py-3 flex justify-between items-center">
                        <span className="text-sm text-gray-500">Showing {orders.length} results</span>
                        <div className="flex gap-2">
                            <button disabled className="px-3 py-1 border rounded text-sm disabled:opacity-50">Previous</button>
                            <button disabled className="px-3 py-1 border rounded text-sm disabled:opacity-50">Next</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
