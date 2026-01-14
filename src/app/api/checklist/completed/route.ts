import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const stationId = searchParams.get('stationId');
        const staffId = searchParams.get('staffId');

        if (!stationId || !staffId) {
            return NextResponse.json({ error: 'stationId and staffId are required' }, { status: 400 });
        }

        // Fetch completed tasks for this station/staff, ordered by most recent first
        const result = await pool.query(`
            SELECT 
                id, template_id, task_title, task_description, 
                order_number, tracking_number, completed_at, 
                completed_by, duration_minutes, notes
            FROM completed_tasks
            WHERE station_id = $1 AND staff_id = $2 AND restored_at IS NULL
            ORDER BY completed_at DESC
            LIMIT 50
        `, [stationId, parseInt(staffId)]);

        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Error fetching completed tasks:', error);
        return NextResponse.json({ error: 'Failed to fetch completed tasks' }, { status: 500 });
    }
}
