import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { templateId, staffId, role, status, notes } = await request.json();

        if (!templateId || !staffId || !role || !status) {
            return NextResponse.json({ 
                error: 'templateId, staffId, role, and status are required' 
            }, { status: 400 });
        }

        const validStatuses = ['pending', 'in_progress', 'completed'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ 
                error: `status must be one of: ${validStatuses.join(', ')}` 
            }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        // Check if instance exists for today
        const existing = await pool.query(`
            SELECT * FROM daily_task_instances 
            WHERE template_id = $1 AND staff_id = $2 AND task_date = $3
        `, [templateId, staffId, today]);

        let result;
        if (existing.rows.length > 0) {
            const existingTask = existing.rows[0];
            
            // Calculate duration if completing
            let durationMinutes = null;
            if (status === 'completed' && existingTask.started_at) {
                const startTime = new Date(existingTask.started_at).getTime();
                const endTime = new Date(now).getTime();
                durationMinutes = Math.round((endTime - startTime) / 60000);
            }

            // Update existing instance
            const updates: string[] = ['status = $1'];
            const params: any[] = [status];
            let paramCount = 2;

            // Set started_at when moving to in_progress
            if (status === 'in_progress' && !existingTask.started_at) {
                updates.push(`started_at = $${paramCount}`);
                params.push(now);
                paramCount++;
            }

            // Set completed_at and duration when completing
            if (status === 'completed') {
                updates.push(`completed_at = $${paramCount}`);
                params.push(now);
                paramCount++;
                
                if (durationMinutes !== null) {
                    updates.push(`duration_minutes = $${paramCount}`);
                    params.push(durationMinutes);
                    paramCount++;
                }
            } else {
                // Clear completed_at if moving back from completed
                updates.push(`completed_at = NULL`);
            }

            if (notes !== undefined) {
                updates.push(`notes = $${paramCount}`);
                params.push(notes || null);
                paramCount++;
            }

            params.push(templateId, staffId, today);
            result = await pool.query(`
                UPDATE daily_task_instances 
                SET ${updates.join(', ')}
                WHERE template_id = $${paramCount} AND staff_id = $${paramCount + 1} AND task_date = $${paramCount + 2}
                RETURNING *
            `, params);
        } else {
            // Create new instance
            const startedAt = status === 'in_progress' ? now : null;
            const completedAt = status === 'completed' ? now : null;

            result = await pool.query(`
                INSERT INTO daily_task_instances 
                (staff_id, task_date, status, started_at, completed_at, notes, template_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [staffId, today, status, startedAt, completedAt, notes || null, templateId]);
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Error toggling task:', error);
        return NextResponse.json({ error: 'Failed to toggle task' }, { status: 500 });
    }
}
