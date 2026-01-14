import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { templateId, staffId, role, status, notes, stationId, staffName } = await request.json();

        if (!templateId || !staffId || !role || !status) {
            return NextResponse.json({ 
                error: 'templateId, staffId, role, and status are required' 
            }, { status: 400 });
        }

        const validStatuses = ['pending', 'in_progress', 'completed'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ 
                error: `status must be one of: ${validStatuses.join(', ')}` 
            }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        // Check if instance exists for today
        const existing = await pool.query(`
            SELECT * FROM daily_task_instances 
            WHERE template_id = $1 AND staff_id = $2 AND task_date = $3
        `, [templateId, staffId, today]);

        let result;
        if (existing.rows.length > 0) {
            const existingTask = existing.rows[0];
            
            // Calculate duration if completing
            let durationMinutes = null;
            if (status === 'completed' && existingTask.started_at) {
                const startTime = new Date(existingTask.started_at).getTime();
                const endTime = new Date(now).getTime();
                durationMinutes = Math.round((endTime - startTime) / 60000);
            }

            // Update existing instance
            const updates: string[] = ['status = $1'];
            const params: any[] = [status];
            let paramCount = 2;

            // Set started_at when moving to in_progress
            if (status === 'in_progress' && !existingTask.started_at) {
                updates.push(`started_at = $${paramCount}`);
                params.push(now);
                paramCount++;
            }

            // Set completed_at and duration when completing
            if (status === 'completed') {
                updates.push(`completed_at = $${paramCount}`);
                params.push(now);
                paramCount++;
                
                if (durationMinutes !== null) {
                    updates.push(`duration_minutes = $${paramCount}`);
                    params.push(durationMinutes);
                    paramCount++;
                }
            } else {
                // Clear completed_at if moving back from completed
                updates.push(`completed_at = NULL`);
            }

            if (notes !== undefined) {
                updates.push(`notes = $${paramCount}`);
                params.push(notes || null);
                paramCount++;
            }

            params.push(templateId, staffId, today);
            result = await pool.query(`
                UPDATE daily_task_instances 
                SET ${updates.join(', ')}
                WHERE template_id = $${paramCount} AND staff_id = $${paramCount + 1} AND task_date = $${paramCount + 2}
                RETURNING *
            `, params);

            // Archive to completed_tasks table if completing
            if (status === 'completed') {
                const templateData = await pool.query(`
                    SELECT title, description, order_number, tracking_number, created_at 
                    FROM task_templates 
                    WHERE id = $1
                `, [templateId]);
                
                if (templateData.rows.length > 0) {
                    const template = templateData.rows[0];
                    await pool.query(`
                        INSERT INTO completed_tasks 
                        (template_id, staff_id, task_title, task_description, role, station_id, 
                         order_number, tracking_number, completed_at, completed_by, duration_minutes, 
                         notes, original_created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    `, [
                        templateId, staffId, template.title, template.description, role, 
                        stationId, template.order_number, template.tracking_number, now, 
                        staffName, durationMinutes, notes, template.created_at
                    ]);
                }
            }
        } else {
            // Create new instance
            const startedAt = status === 'in_progress' ? now : null;
            const completedAt = status === 'completed' ? now : null;

            // Check which columns actually exist in the table
            const tableInfo = await pool.query(`
                SELECT column_name, is_nullable 
                FROM information_schema.columns 
                WHERE table_name = 'daily_task_instances'
            `);
            
            const columns = tableInfo.rows.map(r => r.column_name);
            const notNullColumns = tableInfo.rows.filter(r => r.is_nullable === 'NO').map(r => r.column_name);

            const insertMap: Record<string, any> = {
                template_id: templateId,
                staff_id: staffId,
                task_date: today,
                status: status,
                started_at: startedAt,
                completed_at: completedAt,
                notes: notes || null,
                role: role
            };

            // Handle legacy/extra columns
            if (columns.includes('user_id')) {
                insertMap['user_id'] = staffId.toString();
            }
            if (columns.includes('station_id')) {
                const numericStationId = stationId ? (stationId.includes('_') ? stationId.split('_')[1] : stationId) : null;
                insertMap['station_id'] = numericStationId;
            }
            if (columns.includes('is_completed')) {
                insertMap['is_completed'] = status === 'completed';
            }

            // Ensure all NOT NULL columns have a value
            for (const col of notNullColumns) {
                if (!(col in insertMap) && col !== 'id' && col !== 'created_at') {
                    insertMap[col] = ''; // Fallback for unexpected NOT NULL columns
                }
            }

            const colNames = Object.keys(insertMap);
            const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ');
            const values = Object.values(insertMap);

            result = await pool.query(`
                INSERT INTO daily_task_instances (${colNames.join(', ')})
                VALUES (${placeholders})
                RETURNING *
            `, values);

            // Archive to completed_tasks table if creating as completed
            if (status === 'completed') {
                const templateData = await pool.query(`
                    SELECT title, description, order_number, tracking_number, created_at 
                    FROM task_templates 
                    WHERE id = $1
                `, [templateId]);
                
                if (templateData.rows.length > 0) {
                    const template = templateData.rows[0];
                    await pool.query(`
                        INSERT INTO completed_tasks 
                        (template_id, staff_id, task_title, task_description, role, station_id, 
                         order_number, tracking_number, completed_at, completed_by, duration_minutes, 
                         notes, original_created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    `, [
                        templateId, staffId, template.title, template.description, role, 
                        stationId, template.order_number, template.tracking_number, now, 
                        staffName, null, notes, template.created_at
                    ]);
                }
            }
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Error toggling task:', error);
        return NextResponse.json({ error: 'Failed to toggle task' }, { status: 500 });
    }
}
