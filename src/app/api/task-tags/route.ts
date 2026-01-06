import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// Get tags for a specific task
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const taskTemplateId = searchParams.get('taskTemplateId');

        if (!taskTemplateId) {
            return NextResponse.json({ error: 'taskTemplateId is required' }, { status: 400 });
        }

        const result = await pool.query(`
            SELECT t.* 
            FROM tags t
            INNER JOIN task_tags tt ON t.id = tt.tag_id
            WHERE tt.task_template_id = $1
            ORDER BY t.name
        `, [taskTemplateId]);

        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Error fetching task tags:', error);
        return NextResponse.json({ error: 'Failed to fetch task tags' }, { status: 500 });
    }
}

// Add tag to task
export async function POST(request: NextRequest) {
    try {
        const { taskTemplateId, tagId } = await request.json();

        if (!taskTemplateId || !tagId) {
            return NextResponse.json({ error: 'taskTemplateId and tagId are required' }, { status: 400 });
        }

        await pool.query(
            'INSERT INTO task_tags (task_template_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [taskTemplateId, tagId]
        );

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error) {
        console.error('Error adding task tag:', error);
        return NextResponse.json({ error: 'Failed to add task tag' }, { status: 500 });
    }
}

// Remove tag from task
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const taskTemplateId = searchParams.get('taskTemplateId');
        const tagId = searchParams.get('tagId');

        if (!taskTemplateId || !tagId) {
            return NextResponse.json({ error: 'taskTemplateId and tagId are required' }, { status: 400 });
        }

        await pool.query(
            'DELETE FROM task_tags WHERE task_template_id = $1 AND tag_id = $2',
            [taskTemplateId, tagId]
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error removing task tag:', error);
        return NextResponse.json({ error: 'Failed to remove task tag' }, { status: 500 });
    }
}

