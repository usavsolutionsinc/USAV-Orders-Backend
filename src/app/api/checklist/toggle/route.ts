import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { templateId, userId, role, completed } = await request.json();

        if (!templateId || !userId || !role || completed === undefined) {
            return NextResponse.json({ error: 'templateId, userId, role, and completed are required' }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];
        const completedAt = completed ? new Date().toISOString() : null;

        // Check if instance exists for today
        const existing = await pool.query(`
            SELECT * FROM daily_task_instances 
            WHERE template_id = $1 AND user_id = $2 AND task_date = $3
        `, [templateId, userId, today]);

        let result;
        if (existing.rows.length > 0) {
            // Update existing instance
            result = await pool.query(`
                UPDATE daily_task_instances 
                SET completed = $1, completed_at = $2
                WHERE template_id = $3 AND user_id = $4 AND task_date = $5
                RETURNING *
            `, [completed, completedAt, templateId, userId, today]);
        } else {
            // Create new instance
            result = await pool.query(`
                INSERT INTO daily_task_instances (user_id, role, task_date, completed, completed_at, template_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [userId, role, today, completed, completedAt, templateId]);
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Error toggling task:', error);
        return NextResponse.json({ error: 'Failed to toggle task' }, { status: 500 });
    }
}
