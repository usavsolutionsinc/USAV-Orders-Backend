import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { role, title, description, order_number, tracking_number, created_by, tag_ids } = await request.json();

        if (!role || !title) {
            return NextResponse.json({ error: 'role and title are required' }, { status: 400 });
        }

        // Start transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Insert template
            const result = await client.query(
                `INSERT INTO task_templates (title, description, role, order_number, tracking_number, created_by) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [title, description || null, role, order_number || null, tracking_number || null, created_by || null]
            );

            const templateId = result.rows[0].id;

            // Add tags if provided
            if (tag_ids && Array.isArray(tag_ids) && tag_ids.length > 0) {
                for (const tagId of tag_ids) {
                    await client.query(
                        'INSERT INTO task_tags (task_template_id, tag_id) VALUES ($1, $2)',
                        [templateId, tagId]
                    );
                }
            }

            await client.query('COMMIT');
            return NextResponse.json(result.rows[0], { status: 201 });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error creating template:', error);
        return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { id, title, description, order_number, tracking_number } = await request.json();

        if (!id || !title) {
            return NextResponse.json({ error: 'id and title are required' }, { status: 400 });
        }

        const result = await pool.query(
            `UPDATE task_templates 
             SET title = $1, description = $2, order_number = $3, tracking_number = $4 
             WHERE id = $5 RETURNING *`,
            [title, description || null, order_number || null, tracking_number || null, id]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating template:', error);
        return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        // Delete the template (this will cascade to task_tags and daily_task_instances)
        await pool.query('DELETE FROM task_templates WHERE id = $1', [id]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting template:', error);
        return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
    }
}
