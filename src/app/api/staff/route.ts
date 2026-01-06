import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');
        const activeOnly = searchParams.get('active') !== 'false';

        let query = 'SELECT * FROM staff WHERE 1=1';
        const params: any[] = [];
        let paramCount = 1;

        if (role) {
            query += ` AND role = $${paramCount}`;
            params.push(role);
            paramCount++;
        }

        if (activeOnly) {
            query += ` AND active = true`;
        }

        query += ' ORDER BY role, name';

        const result = await pool.query(query, params);
        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Error fetching staff:', error);
        return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { name, role, employee_id } = await request.json();

        if (!name || !role) {
            return NextResponse.json({ error: 'name and role are required' }, { status: 400 });
        }

        if (!['technician', 'packer'].includes(role)) {
            return NextResponse.json({ error: 'role must be technician or packer' }, { status: 400 });
        }

        const result = await pool.query(
            'INSERT INTO staff (name, role, employee_id) VALUES ($1, $2, $3) RETURNING *',
            [name, role, employee_id || null]
        );

        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error) {
        console.error('Error creating staff:', error);
        return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { id, name, role, employee_id, active } = await request.json();

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

        if (role !== undefined) {
            if (!['technician', 'packer'].includes(role)) {
                return NextResponse.json({ error: 'role must be technician or packer' }, { status: 400 });
            }
            updates.push(`role = $${paramCount}`);
            params.push(role);
            paramCount++;
        }

        if (employee_id !== undefined) {
            updates.push(`employee_id = $${paramCount}`);
            params.push(employee_id || null);
            paramCount++;
        }

        if (active !== undefined) {
            updates.push(`active = $${paramCount}`);
            params.push(active);
            paramCount++;
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        params.push(id);
        const query = `UPDATE staff SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating staff:', error);
        return NextResponse.json({ error: 'Failed to update staff' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        // Soft delete - set active to false
        const result = await pool.query(
            'UPDATE staff SET active = false WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, staff: result.rows[0] });
    } catch (error) {
        console.error('Error deleting staff:', error);
        return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 });
    }
}

