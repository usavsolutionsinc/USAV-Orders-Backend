import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { role, title, description } = await request.json();

        if (!role || !title) {
            return NextResponse.json({ error: 'role and title are required' }, { status: 400 });
        }

        const result = await pool.query(
            'INSERT INTO task_templates (title, description, role) VALUES ($1, $2, $3) RETURNING *',
            [title, description || null, role]
        );

        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error) {
        console.error('Error creating template:', error);
        return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { id, title, description } = await request.json();

        if (!id || !title) {
            return NextResponse.json({ error: 'id and title are required' }, { status: 400 });
        }

        const result = await pool.query(
            'UPDATE task_templates SET title = $1, description = $2 WHERE id = $3 RETURNING *',
            [title, description || null, id]
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

        // Delete the template (this will cascade to daily_task_instances if set up)
        await pool.query('DELETE FROM task_templates WHERE id = $1', [id]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting template:', error);
        return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
    }
}

