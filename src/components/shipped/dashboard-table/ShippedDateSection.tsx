'use client';

import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { ShippedRecordRow } from '@/components/shipped/ShippedRecordRow';
import { getDetailId } from '@/components/shipped/shipped-record-mappers';
import type { DerivedPackerRecord } from '@/lib/shipped-records';

export interface ShippedDateSectionProps {
  date: string;
  /** This day's records, already sorted newest-first. */
  records: DerivedPackerRecord[];
  isMobile: boolean;
  selectMode: boolean;
  selectedIds: ReadonlySet<number>;
  selectedDetailId: number | null;
  onRowClick: (record: DerivedPackerRecord) => void;
  onToggle: (id: number, shiftKey: boolean) => void;
}

/** One packed-date band: a {@link DateGroupHeader} plus its shipped rows. */
export function ShippedDateSection({
  date,
  records,
  isMobile,
  selectMode,
  selectedIds,
  selectedDetailId,
  onRowClick,
  onToggle,
}: ShippedDateSectionProps) {
  return (
    <div className="flex flex-col">
      <DateGroupHeader date={date} total={records.length} />
      {records.map((record, index) => (
        <ShippedRecordRow
          key={record.id}
          record={record}
          index={index}
          isMobile={isMobile}
          selectMode={selectMode}
          checked={selectMode && selectedIds.has(Number(record.id))}
          selected={selectedDetailId === getDetailId(record)}
          onRowClick={onRowClick}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
