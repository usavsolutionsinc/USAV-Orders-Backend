import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');
        const staffId = searchParams.get('staffId');

        if (!role || !staffId) {
            return NextResponse.json({ error: 'role and staffId are required' }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];

        // Get templates and their instances for today with tags
        const result = await pool.query(`
            SELECT 
                t.id,
                t.title,
                t.description,
                t.role,
                t.order_number,
                t.tracking_number,
                t.created_at,
                i.status,
                i.started_at,
                i.completed_at,
                i.duration_minutes,
                i.notes,
                i.task_date,
                COALESCE(
                    json_agg(
                        json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color)
                        ORDER BY tg.name
                    ) FILTER (WHERE tg.id IS NOT NULL),
                    '[]'
                ) as tags
            FROM task_templates t
            LEFT JOIN daily_task_instances i 
                ON t.id = i.template_id 
                AND i.staff_id = $1 
                AND i.task_date = $2
            LEFT JOIN task_tags tt ON t.id = tt.task_template_id
            LEFT JOIN tags tg ON tt.tag_id = tg.id
            WHERE t.role = $3
            GROUP BY t.id, t.title, t.description, t.role, t.order_number, t.tracking_number, 
                     t.created_at, i.status, i.started_at, i.completed_at, i.duration_minutes, 
                     i.notes, i.task_date
            ORDER BY t.id ASC
        `, [staffId, today, role]);

        const items = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            role: row.role,
            order_number: row.order_number,
            tracking_number: row.tracking_number,
            tags: row.tags,
            created_at: row.created_at,
            instance: row.task_date ? {
                template_id: row.id,
                status: row.status,
                started_at: row.started_at,
                completed_at: row.completed_at,
                duration_minutes: row.duration_minutes,
                notes: row.notes,
                task_date: row.task_date
            } : undefined
        }));

        return NextResponse.json(items);
    } catch (error) {
        console.error('Error fetching checklist:', error);
        return NextResponse.json({ error: 'Failed to fetch checklist' }, { status: 500 });
    }
}
