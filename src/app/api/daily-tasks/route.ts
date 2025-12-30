import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const role = searchParams.get('role'); // 'packer' or 'technician'

    if (!userId || !role) {
        return NextResponse.json(
            { error: 'userId and role are required' },
            { status: 400 }
        );
    }

    const client = await pool.connect();
    try {
        // Get today's date (server time, UTC)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        // Fetch all task templates for this role
        const templatesResult = await client.query(
            `SELECT id, title, description FROM task_templates WHERE role = $1 ORDER BY id`,
            [role]
        );

        const templates = templatesResult.rows;

        if (templates.length === 0) {
            return NextResponse.json({ tasks: [] });
        }

        // For each template, check if instance exists for today, if not create it
        const tasks = [];
        for (const template of templates) {
            // Check if instance exists
            let instanceResult = await client.query(
                `SELECT id, completed, completed_at 
                 FROM daily_task_instances 
                 WHERE user_id = $1 AND template_id = $2 AND task_date = $3`,
                [userId, template.id, today]
            );

            let instance;
            if (instanceResult.rows.length === 0) {
                // Create new instance
                const insertResult = await client.query(
                    `INSERT INTO daily_task_instances (template_id, user_id, role, task_date, completed)
                     VALUES ($1, $2, $3, $4, FALSE)
                     RETURNING id, completed, completed_at`,
                    [template.id, userId, role, today]
                );
                instance = insertResult.rows[0];
            } else {
                instance = instanceResult.rows[0];
            }

            tasks.push({
                id: instance.id,
                templateId: template.id,
                title: template.title,
                description: template.description,
                completed: instance.completed,
                completedAt: instance.completed_at,
            });
        }

        return NextResponse.json({ tasks });

    } catch (error) {
        console.error('Error fetching daily tasks:', error);
        return NextResponse.json(
            { error: 'Failed to fetch daily tasks' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
