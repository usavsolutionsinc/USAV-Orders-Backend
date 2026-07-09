import { describe, expect, it } from 'vitest';
import {
  appendOptimisticSerial,
  confirmOptimisticSerial,
  markSerialRemoving,
  removeSerialById,
  rollbackOptimisticSerial,
} from './optimistic-serials';

describe('optimistic-serials', () => {
  it('appends a pending-add chip', () => {
    const next = appendOptimisticSerial([], 'ABC123', -1);
    expect(next).toEqual([{ id: -1, serial_number: 'ABC123', _optimistic: 'adding' }]);
  });

  it('confirms a temp serial with the server unit', () => {
    const next = confirmOptimisticSerial(
      [{ id: -1, serial_number: 'ABC123', _optimistic: 'adding' }],
      -1,
      { id: 42, serial_number: 'ABC123' },
    );
    expect(next).toEqual([{ id: 42, serial_number: 'ABC123', condition_grade: null }]);
  });

  it('marks and removes a serial optimistically', () => {
    const base = [{ id: 7, serial_number: 'SN7' }];
    const removing = markSerialRemoving(base, 7);
    expect(removing[0]._optimistic).toBe('removing');
    expect(removeSerialById(removing, 7)).toEqual([]);
    expect(rollbackOptimisticSerial([{ id: -2, serial_number: 'X', _optimistic: 'adding' }], -2)).toEqual([]);
  });
});
