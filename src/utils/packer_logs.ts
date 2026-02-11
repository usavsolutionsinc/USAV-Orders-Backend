import { defineSchema } from './lib';

export default defineSchema('packer_logs', [
  { name: 'id', type: 'SERIAL', primaryKey: true },
  { name: 'shipping_tracking_number', type: 'TEXT', notNull: true },
  { name: 'tracking_type', type: 'VARCHAR(20)', notNull: true },
  { name: 'pack_date_time', type: 'TIMESTAMP' },
  { name: 'packed_by', type: 'INTEGER' },
  { name: 'packer_photos_url', type: 'JSONB' },
  { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
]);
