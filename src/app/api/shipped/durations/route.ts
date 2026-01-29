import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    // 1. Get current record
    const currentResult = await pool.query('SELECT * FROM shipped WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    const current = currentResult.rows[0];

    let boxingDuration = 'N/A';
    let testingDuration = 'N/A';

    // 2. Calculate Boxing Duration
    if (current.boxed_by && current.date_time && current.date_time !== '1') {
      const prevBoxingResult = await pool.query(
        `SELECT date_time FROM shipped 
         WHERE boxed_by = $1 AND date_time < $2 AND date_time != '1'
         ORDER BY date_time DESC LIMIT 1`,
        [current.boxed_by, current.date_time]
      );

      if (prevBoxingResult.rows.length > 0) {
        const prevTime = new Date(prevBoxingResult.rows[0].date_time).getTime();
        const currTime = new Date(current.date_time).getTime();
        const diffMs = currTime - prevTime;
        boxingDuration = formatDuration(diffMs);
      }
    }

    // 3. Calculate Testing Duration
    if (current.tested_by) {
      // Map name to tech table
      const techMap: Record<string, string> = {
        'Michael': 'tech_1',
        'Thuc': 'tech_2',
        'Sang': 'tech_3'
      };
      
      const techTable = techMap[current.tested_by];
      
      if (techTable) {
        // We need to find the timestamp for THIS order's test in the tech table first
        // Usually tracking or serial matches
        const tracking = current.shipping_tracking_number;
        const serial = current.serial_number;
        
        const currentTestResult = await db.execute(sql.raw(`
          SELECT date_time as timestamp FROM ${techTable}
          WHERE shipping_tracking_number = '${tracking}' OR serial_number = '${serial}'
          ORDER BY id DESC LIMIT 1
        `));

        if (currentTestResult.length > 0) {
          const currentTestTimestamp = currentTestResult[0].timestamp as string;
          
          const prevTestResult = await db.execute(sql.raw(`
            SELECT date_time as timestamp FROM ${techTable}
            WHERE date_time < '${currentTestTimestamp}'
            ORDER BY date_time DESC LIMIT 1
          `));

          if (prevTestResult.length > 0) {
            const prevTime = parseDate(prevTestResult[0].timestamp as string).getTime();
            const currTime = parseDate(currentTestTimestamp).getTime();
            const diffMs = currTime - prevTime;
            testingDuration = formatDuration(diffMs);
          }
        }
      }
    }

    return NextResponse.json({ boxingDuration, testingDuration });
  } catch (error: any) {
    console.error('Error calculating durations:', error);
    return NextResponse.json({ error: 'Failed to calculate durations', details: error.message }, { status: 500 });
  }
}

function parseDate(dateStr: string): Date {
  if (dateStr.includes('/')) {
    // Handle M/D/YYYY HH:mm:ss
    const [datePart, timePart] = dateStr.split(' ');
    const [m, d, y] = datePart.split('/').map(Number);
    const [h, min, s] = timePart.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, s);
  }
  return new Date(dateStr);
}

function formatDuration(ms: number): string {
  if (ms < 0) return '---';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }
  
  return `${minutes}m ${seconds}s`;
}
