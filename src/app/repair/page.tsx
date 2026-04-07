import { redirect } from 'next/navigation';

/**
 * Legacy /repair route — redirects to /walk-in?mode=repairs.
 * Preserves tab and search params.
 */
export default function RepairPage({
    searchParams,
}: {
    searchParams: { [key: string]: string | string[] | undefined };
}) {
    const params = new URLSearchParams();
    params.set('mode', 'repairs');
    for (const [key, value] of Object.entries(searchParams || {})) {
        if (typeof value === 'string') params.set(key, value);
    }
    redirect(`/walk-in?${params.toString()}`);
}
