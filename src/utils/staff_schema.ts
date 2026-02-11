import { defineSchema } from './lib';

export default defineSchema('staff', [
  { name: 'id', type: 'SERIAL', primaryKey: true },
  { name: 'name', type: 'VARCHAR(100)', notNull: true },
  { name: 'role', type: 'VARCHAR(50)', notNull: true },
  { name: 'employee_id', type: 'VARCHAR(50)' },
  { name: 'active', type: 'BOOLEAN', default: 'true' },
  { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  { name: 'source_table', type: 'TEXT' },
]);
