import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// GET - Fetch all receiving tasks
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const urgent = searchParams.get('urgent');

        let query = 'SELECT * FROM receiving_tasks WHERE 1=1';
        const params: any[] = [];
        let paramCount = 1;

        if (status) {
            query += ` AND status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        if (urgent === 'true') {
            query += ` AND urgent = true`;
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);
        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Error fetching receiving tasks:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving tasks',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// POST - Create new receiving task
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, orderNumber, urgent, notes, staffId } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        const result = await pool.query(
            `INSERT INTO receiving_tasks (tracking_number, order_number, urgent, notes, staff_id, status)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [trackingNumber, orderNumber || null, urgent || false, notes || null, staffId || null, 'pending']
        );

        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error) {
        console.error('Error creating receiving task:', error);
        return NextResponse.json({ 
            error: 'Failed to create receiving task',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// PUT - Update receiving task
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, status, urgent, notes, receivedDate, processedDate, staffId } = body;

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const updates: string[] = [];
        const params: any[] = [];
        let paramCount = 1;

        if (status !== undefined) {
            updates.push(`status = $${paramCount}`);
            params.push(status);
            paramCount++;
        }

        if (urgent !== undefined) {
            updates.push(`urgent = $${paramCount}`);
            params.push(urgent);
            paramCount++;
        }

        if (notes !== undefined) {
            updates.push(`notes = $${paramCount}`);
            params.push(notes);
            paramCount++;
        }

        if (receivedDate !== undefined) {
            updates.push(`received_date = $${paramCount}`);
            params.push(receivedDate);
            paramCount++;
        }

        if (processedDate !== undefined) {
            updates.push(`processed_date = $${paramCount}`);
            params.push(processedDate);
            paramCount++;
        }

        if (staffId !== undefined) {
            updates.push(`staff_id = $${paramCount}`);
            params.push(staffId);
            paramCount++;
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        params.push(id);
        const result = await pool.query(
            `UPDATE receiving_tasks SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            params
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating receiving task:', error);
        return NextResponse.json({ 
            error: 'Failed to update receiving task',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// DELETE - Delete receiving task
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        await pool.query('DELETE FROM receiving_tasks WHERE id = $1', [id]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting receiving task:', error);
        return NextResponse.json({ 
            error: 'Failed to delete receiving task',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

