import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { insertTechSerialForTracking } from '@/lib/tech/insertTechSerialForTracking';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tracking, serial, techId, allowFbaDuplicates } = body;

    if (!tracking || !serial || !techId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Tracking, serial, and techId are required',
        },
        { status: 400 },
      );
    }

    const result = await insertTechSerialForTracking(
      pool,
      { tracking, serial, techId, allowFbaDuplicates },
    );

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      serialNumbers: result.serialNumbers,
      serialType: result.serialType,
      isComplete: false,
    });
  } catch (error: any) {
    console.error('Error adding serial:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add serial',
        details: error.message,
      },
      { status: 500 },
    );
  }
}
