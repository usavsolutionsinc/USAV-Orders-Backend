import { defineSchema } from './lib';

export default defineSchema('tech_serial_numbers', [
  { name: 'id', type: 'SERIAL', primaryKey: true },
  { name: 'shipping_tracking_number', type: 'TEXT', notNull: true },
  { name: 'serial_number', type: 'TEXT' },
  { name: 'serial_type', type: 'VARCHAR(20)', notNull: true, default: "'SERIAL'" },
  { name: 'test_date_time', type: 'TIMESTAMP', default: 'now()' },
  { name: 'created_at', type: 'TIMESTAMP', default: 'now()' },
  { name: 'tested_by', type: 'INTEGER', default: '6' },
]);
