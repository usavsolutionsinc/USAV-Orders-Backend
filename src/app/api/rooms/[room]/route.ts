import { NextRequest, NextResponse } from 'next/server';
import { renameRoom, setRoomZoneLetter, softDeleteRoom } from '@/lib/neon/location-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * PATCH /api/rooms/[room]
 * Body: { name: string }   — rename the room everywhere it appears.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ room: string }> },
) {
  const gate = await requireRoutePerm(req, 'sku_stock.manage');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  const { room } = await params;
  const oldName = decodeURIComponent(room).trim();
  if (!oldName) {
    return NextResponse.json({ error: 'Current room name required' }, { status: 400 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const newName = typeof body?.name === 'string' ? body.name.trim() : '';
    const zoneLetterRaw =
      typeof body?.zoneLetter === 'string' ? body.zoneLetter : undefined;
    // Treat empty string as "clear", undefined as "don't touch."
    const zoneLetter =
      zoneLetterRaw === undefined
        ? undefined
        : zoneLetterRaw.trim().toUpperCase().charAt(0) || null;

    let renameResult = { updated: 0, barcodesRekeyed: 0 };
    let didRename = false;
    if (newName && newName !== oldName) {
      // Tenant-scoped: renameRoom org-gates every parent/bin/barcode UPDATE on
      // organization_id and stamps the org on the materialise INSERT, so a
      // rename never touches (or creates a NULL-org clone of) another tenant's
      // room that happens to share a name string.
      renameResult = await renameRoom(oldName, newName, orgId);
      if (renameResult.updated === 0 && renameResult.barcodesRekeyed === 0) {
        return NextResponse.json(
          { error: 'Room could not be renamed — the new name may already exist or the old room is gone.' },
          { status: 409 },
        );
      }
      didRename = true;
    }

    let letterResult: { ok: true } | { ok: false; reason: 'duplicate' | 'not_found' } | null = null;
    if (zoneLetter !== undefined) {
      const targetName = didRename ? newName : oldName;
      // Tenant-scoped: setRoomZoneLetter gates its UPDATE WHERE clauses on
      // organization_id so we never re-letter another tenant's room.
      letterResult = await setRoomZoneLetter(targetName, zoneLetter, orgId);
      if (!letterResult.ok && letterResult.reason === 'duplicate') {
        return NextResponse.json(
          { error: 'Another room is already using that zone letter' },
          { status: 409 },
        );
      }
      if (!letterResult.ok && letterResult.reason === 'not_found' && !didRename) {
        return NextResponse.json(
          { error: 'Room not found' },
          { status: 404 },
        );
      }
    }

    if (!didRename && letterResult === null) {
      return NextResponse.json({ success: true, updated: 0, barcodesRekeyed: 0 });
    }
    return NextResponse.json({ success: true, ...renameResult });
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: 'A room with that name already exists' },
        { status: 409 },
      );
    }
    console.error('[PATCH /api/rooms/[room]] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}

/** DELETE /api/rooms/[room] — soft-delete the room + all its bins. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ room: string }> },
) {
  const gate = await requireRoutePerm(req, 'bin.remove');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  const { room } = await params;
  const name = decodeURIComponent(room).trim();
  if (!name) {
    return NextResponse.json({ error: 'Room name required' }, { status: 400 });
  }
  try {
    // Tenant-scoped destructive write: softDeleteRoom gates its UPDATE on
    // organization_id so a tenant can only soft-delete its OWN room/bins. When
    // nothing matched under this org the room either doesn't exist or belongs
    // to another tenant — return a 404 (never a 403) per the ownership gate.
    const result = await softDeleteRoom(name, orgId);
    if (result.deactivated === 0) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[DELETE /api/rooms/[room]] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}
