import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');
        const userId = searchParams.get('userId');

        if (!role || !userId) {
            return NextResponse.json({ error: 'role and userId are required' }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];

        // Get templates and their instances for today
        const result = await pool.query(`
            SELECT 
                t.id,
                t.title,
                t.description,
                t.role,
                t.created_at,
                i.completed,
                i.completed_at,
                i.task_date
            FROM task_templates t
            LEFT JOIN daily_task_instances i 
                ON t.id = i.task_template_id 
                AND i.user_id = $1 
                AND i.task_date = $2
            WHERE t.role = $3
            ORDER BY t.id ASC
        `, [userId, today, role]);

        const items = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            role: row.role,
            created_at: row.created_at,
            instance: row.task_date ? {
                template_id: row.id,
                completed: row.completed,
                completed_at: row.completed_at,
                task_date: row.task_date
            } : undefined
        }));

        return NextResponse.json(items);
    } catch (error) {
        console.error('Error fetching checklist:', error);
        return NextResponse.json({ error: 'Failed to fetch checklist' }, { status: 500 });
    }
}
