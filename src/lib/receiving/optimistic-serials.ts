import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Client-only flag on a serial_units snapshot while add/remove is in flight. */
export type OptimisticSerialFlag = 'adding' | 'removing';

export type LineSerial = NonNullable<ReceivingLineRow['serials']>[number] & {
  _optimistic?: OptimisticSerialFlag;
};

export function mintOptimisticSerialId(): number {
  return -(Date.now() % 1_000_000_000) - Math.floor(Math.random() * 1000);
}

function normSerial(sn: string): string {
  return sn.trim().toUpperCase();
}

export function appendOptimisticSerial(
  serials: LineSerial[] | null | undefined,
  serialNumber: string,
  tempId: number,
): LineSerial[] {
  const sn = serialNumber.trim();
  if (!sn) return [...(serials ?? [])];
  const norm = normSerial(sn);
  const base = [...(serials ?? [])];
  const existing = base.find(
    (s) => normSerial(s.serial_number) === norm && s._optimistic !== 'removing',
  );
  if (existing) return base;
  return [...base, { id: tempId, serial_number: sn, _optimistic: 'adding' }];
}

export function confirmOptimisticSerial(
  serials: LineSerial[] | null | undefined,
  tempId: number,
  serialUnit: { id?: number; serial_number?: string | null } | null | undefined,
): LineSerial[] {
  if (!serialUnit?.id) {
    return (serials ?? []).filter((s) => s.id !== tempId);
  }
  const sn = String(serialUnit.serial_number ?? '').trim();
  const norm = normSerial(sn);
  const withoutTemp = (serials ?? []).filter((s) => s.id !== tempId);
  if (withoutTemp.some((s) => s.id === serialUnit.id || normSerial(s.serial_number) === norm)) {
    return withoutTemp.map((s) => {
      const { _optimistic, ...rest } = s;
      return rest;
    });
  }
  return [
    ...withoutTemp,
    {
      id: serialUnit.id,
      serial_number: sn,
      condition_grade:
        (serialUnit as { condition_grade?: string | null }).condition_grade ?? null,
    },
  ];
}

export function rollbackOptimisticSerial(
  serials: LineSerial[] | null | undefined,
  tempId: number,
): LineSerial[] {
  return (serials ?? []).filter((s) => s.id !== tempId);
}

export function markSerialRemoving(
  serials: LineSerial[] | null | undefined,
  serialUnitId: number,
): LineSerial[] {
  return (serials ?? []).map((s) =>
    s.id === serialUnitId ? { ...s, _optimistic: 'removing' } : s,
  );
}

export function clearSerialRemoving(
  serials: LineSerial[] | null | undefined,
  serialUnitId: number,
): LineSerial[] {
  return (serials ?? []).map((s) => {
    if (s.id !== serialUnitId) return s;
    const { _optimistic, ...rest } = s;
    return rest;
  });
}

export function removeSerialById(
  serials: LineSerial[] | null | undefined,
  serialUnitId: number,
): LineSerial[] {
  return (serials ?? []).filter((s) => s.id !== serialUnitId);
}

export function readOptimisticFlag(
  serial: { _optimistic?: OptimisticSerialFlag },
): OptimisticSerialFlag | undefined {
  return serial._optimistic;
}
