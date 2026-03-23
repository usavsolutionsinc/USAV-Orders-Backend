import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { staff, staffWeeklySchedule } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { getCurrentStaffDayOfWeek } from '@/lib/staff-schedule';

function isDatabaseUnavailable(error: unknown) {
    return isTransientDbError(error);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');
        const activeOnly = searchParams.get('active') !== 'false';
        const presentToday = searchParams.get('presentToday') === 'true';
        const todayDayOfWeek = presentToday ? getCurrentStaffDayOfWeek() : null;
        const cacheLookup = createCacheLookupKey({
            role: role || '',
            activeOnly,
            presentToday,
            todayDayOfWeek: todayDayOfWeek != null ? String(todayDayOfWeek) : '',
        });

        const cached = await getCachedJson<any[]>('api:staff', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        const conditions: string[] = [];
        const params: any[] = [];
        let scheduleJoin = '';
        let scheduledTodaySelect = '';

        if (presentToday) {
            params.push(todayDayOfWeek);
            scheduleJoin = `
              LEFT JOIN staff_weekly_schedule sws
                ON sws.staff_id = s.id
               AND sws.day_of_week = $${params.length}
            `;
            scheduledTodaySelect = `,
              COALESCE(sws.is_scheduled, true) AS is_scheduled_today
            `;
            conditions.push('COALESCE(sws.is_scheduled, true) = true');
        }

        if (role) {
            params.push(role);
            conditions.push(`s.role = $${params.length}`);
        }
        if (activeOnly) {
            params.push(true);
            conditions.push(`s.active = $${params.length}`);
        }

        const sql = `
          SELECT s.id, s.name, s.role, s.employee_id, s.active, s.created_at
          ${scheduledTodaySelect}
          FROM staff s
          ${scheduleJoin}
          ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY s.role ASC, s.name ASC
        `;

        let result;
        try {
            result = await queryWithRetry(
                () => pool.query(sql, params),
                { retries: 3, delayMs: 1000 }
            );
        } catch (queryError: any) {
            // If the schedule table is not yet migrated, treat everyone as present.
            const missingScheduleTable =
                presentToday &&
                queryError?.code === '42P01' &&
                String(queryError?.message || '').includes('staff_weekly_schedule');

            if (!missingScheduleTable) {
                throw queryError;
            }

            const fallbackConditions: string[] = [];
            const fallbackParams: any[] = [];
            if (role) {
                fallbackParams.push(role);
                fallbackConditions.push(`s.role = $${fallbackParams.length}`);
            }
            if (activeOnly) {
                fallbackParams.push(true);
                fallbackConditions.push(`s.active = $${fallbackParams.length}`);
            }

            const fallbackSql = `
              SELECT s.id, s.name, s.role, s.employee_id, s.active, s.created_at
              FROM staff s
              ${fallbackConditions.length > 0 ? `WHERE ${fallbackConditions.join(' AND ')}` : ''}
              ORDER BY s.role ASC, s.name ASC
            `;

            result = await queryWithRetry(
                () => pool.query(fallbackSql, fallbackParams),
                { retries: 1, delayMs: 250 }
            );
        }

        const results = result.rows;

        await setCachedJson('api:staff', cacheLookup, results, 60, ['staff']);
        return NextResponse.json(results, { headers: { 'x-cache': 'MISS' } });
    } catch (error) {
        if (isDatabaseUnavailable(error)) {
            console.warn('Staff DB unavailable (GET):', error instanceof Error ? error.message : String(error));
            return NextResponse.json([], { headers: { 'x-db-fallback': 'unavailable' } });
        }
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
        const { name, role, employee_id, active } = body;

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
            active: typeof active === 'boolean' ? active : true,
        }).returning();

        await db
            .insert(staffWeeklySchedule)
            .values(
                Array.from({ length: 7 }, (_, day) => ({
                    staffId: result.id,
                    dayOfWeek: day,
                    isScheduled: true,
                }))
            )
            .onConflictDoNothing();

        await invalidateCacheTags(['staff']);
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

        await invalidateCacheTags(['staff']);
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

        await invalidateCacheTags(['staff']);
        return NextResponse.json({ success: true, staff: result });
    } catch (error) {
        console.error('Error deleting staff:', error);
        return NextResponse.json({ 
            error: 'Failed to delete staff',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
