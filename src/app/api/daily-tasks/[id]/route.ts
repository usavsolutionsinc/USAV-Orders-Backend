import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const instanceId = id;
    const client = await pool.connect();

    try {
        // Get current instance
        const currentResult = await client.query(
            `SELECT completed FROM daily_task_instances WHERE id = $1`,
            [instanceId]
        );

        if (currentResult.rows.length === 0) {
            return NextResponse.json(
                { error: 'Task instance not found' },
                { status: 404 }
            );
        }

        const currentCompleted = currentResult.rows[0].completed;
        const newCompleted = !currentCompleted;

        // Update the instance
        const updateResult = await client.query(
            `UPDATE daily_task_instances 
             SET completed = $1, completed_at = $2
             WHERE id = $3
             RETURNING id, completed, completed_at`,
            [
                newCompleted,
                newCompleted ? new Date().toISOString() : null,
                instanceId
            ]
        );

        const updated = updateResult.rows[0];

        return NextResponse.json({
            id: updated.id,
            completed: updated.completed,
            completedAt: updated.completed_at,
        });

    } catch (error) {
        console.error('Error updating daily task:', error);
        return NextResponse.json(
            { error: 'Failed to update daily task' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
