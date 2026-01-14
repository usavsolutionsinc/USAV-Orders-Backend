import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { completedTaskId, staffId, role, stationId } = await request.json();

        if (!completedTaskId || !staffId || !role || !stationId) {
            return NextResponse.json({ 
                error: 'completedTaskId, staffId, role, and stationId are required' 
            }, { status: 400 });
        }

        // Get the completed task details
        const completedTask = await pool.query(`
            SELECT * FROM completed_tasks WHERE id = $1
        `, [completedTaskId]);

        if (completedTask.rows.length === 0) {
            return NextResponse.json({ error: 'Completed task not found' }, { status: 404 });
        }

        const task = completedTask.rows[0];
        const now = new Date().toISOString();

        // Re-create the task template (or reactivate if it still exists)
        let templateId = task.template_id;
        
        // Check if template still exists
        const existingTemplate = await pool.query(`
            SELECT id FROM task_templates WHERE id = $1
        `, [templateId]);

        if (existingTemplate.rows.length === 0) {
            // Template was deleted, recreate it
            const newTemplate = await pool.query(`
                INSERT INTO task_templates 
                (title, description, role, station_id, order_number, tracking_number, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [
                task.task_title,
                task.task_description,
                role,
                stationId,
                task.order_number,
                task.tracking_number,
                task.original_created_at || now
            ]);
            templateId = newTemplate.rows[0].id;
        }

        // Mark the completed task as restored
        await pool.query(`
            UPDATE completed_tasks 
            SET restored_at = $1 
            WHERE id = $2
        `, [now, completedTaskId]);

        // Remove any completed status from daily_task_instances for today
        const today = new Date().toISOString().split('T')[0];
        await pool.query(`
            DELETE FROM daily_task_instances 
            WHERE template_id = $1 AND staff_id = $2 AND task_date = $3 AND status = 'completed'
        `, [templateId, staffId, today]);

        return NextResponse.json({ 
            success: true, 
            message: 'Task restored successfully',
            templateId 
        });
    } catch (error) {
        console.error('Error restoring task:', error);
        return NextResponse.json({ error: 'Failed to restore task' }, { status: 500 });
    }
}
