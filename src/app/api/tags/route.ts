import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const ALLOWED_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

export async function GET() {
    try {
        const result = await pool.query('SELECT * FROM tags ORDER BY name');
        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Error fetching tags:', error);
        return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { name, color } = await request.json();

        if (!name || !color) {
            return NextResponse.json({ error: 'name and color are required' }, { status: 400 });
        }

        if (!ALLOWED_COLORS.includes(color)) {
            return NextResponse.json({ 
                error: `color must be one of: ${ALLOWED_COLORS.join(', ')}` 
            }, { status: 400 });
        }

        const result = await pool.query(
            'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
            [name, color]
        );

        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error: any) {
        if (error.code === '23505') { // Unique constraint violation
            return NextResponse.json({ error: 'Tag name already exists' }, { status: 409 });
        }
        console.error('Error creating tag:', error);
        return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { id, name, color } = await request.json();

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const updates: string[] = [];
        const params: any[] = [];
        let paramCount = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramCount}`);
            params.push(name);
            paramCount++;
        }

        if (color !== undefined) {
            if (!ALLOWED_COLORS.includes(color)) {
                return NextResponse.json({ 
                    error: `color must be one of: ${ALLOWED_COLORS.join(', ')}` 
                }, { status: 400 });
            }
            updates.push(`color = $${paramCount}`);
            params.push(color);
            paramCount++;
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        params.push(id);
        const query = `UPDATE tags SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error: any) {
        if (error.code === '23505') {
            return NextResponse.json({ error: 'Tag name already exists' }, { status: 409 });
        }
        console.error('Error updating tag:', error);
        return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        await pool.query('DELETE FROM tags WHERE id = $1', [id]);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting tag:', error);
        return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }
}

