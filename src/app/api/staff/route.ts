import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { staff } from '@/lib/drizzle/schema';
import { eq, and, asc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');
        const activeOnly = searchParams.get('active') !== 'false';

        const conditions = [];
        if (role) {
            conditions.push(eq(staff.role, role));
        }
        if (activeOnly) {
            conditions.push(eq(staff.active, true));
        }

        const results = await db
            .select()
            .from(staff)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(asc(staff.role), asc(staff.name));

        return NextResponse.json(results);
    } catch (error) {
        console.error('Error fetching staff:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch staff',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name, role, employee_id } = body;

        if (!name || !role) {
            return NextResponse.json({ error: 'name and role are required' }, { status: 400 });
        }

        if (!['technician', 'packer'].includes(role)) {
            return NextResponse.json({ error: 'role must be technician or packer' }, { status: 400 });
        }

        const [result] = await db.insert(staff).values({
            name,
            role,
            employeeId: employee_id || null,
            active: true,
        }).returning();

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        console.error('Error creating staff:', error);
        return NextResponse.json({ 
            error: 'Failed to create staff',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, name, role, employee_id, active } = body;

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (role !== undefined) {
            if (!['technician', 'packer'].includes(role)) {
                return NextResponse.json({ error: 'role must be technician or packer' }, { status: 400 });
            }
            updateData.role = role;
        }
        if (employee_id !== undefined) updateData.employeeId = employee_id || null;
        if (active !== undefined) updateData.active = active;

        const [result] = await db
            .update(staff)
            .set(updateData)
            .where(eq(staff.id, id))
            .returning();

        if (!result) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error updating staff:', error);
        return NextResponse.json({ 
            error: 'Failed to update staff',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
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
        const [result] = await db
            .update(staff)
            .set({ active: false })
            .where(eq(staff.id, parseInt(id)))
            .returning();

        if (!result) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, staff: result });
    } catch (error) {
        console.error('Error deleting staff:', error);
        return NextResponse.json({ 
            error: 'Failed to delete staff',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
