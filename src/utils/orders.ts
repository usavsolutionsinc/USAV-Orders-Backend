import { defineSchema } from './lib';

export default defineSchema('orders', [
  { name: 'id', type: 'SERIAL', primaryKey: true },
  { name: 'order_id', type: 'TEXT' },
  { name: 'item_number', type: 'TEXT' },
  { name: 'product_title', type: 'TEXT' },
  { name: 'condition', type: 'TEXT' },
  { name: 'shipping_tracking_number', type: 'TEXT' },
  { name: 'sku', type: 'TEXT' },
  { name: 'status', type: 'TEXT' },
  { name: 'status_history', type: 'JSONB' },
  { name: 'is_shipped', type: 'BOOLEAN', notNull: true, default: 'false' },
  { name: 'packer_id', type: 'INTEGER', default: '5' },
  { name: 'notes', type: 'TEXT' },
  { name: 'quantity', type: 'TEXT', default: '1' },
  { name: 'out_of_stock', type: 'TEXT' },
  { name: 'account_source', type: 'TEXT' },
  { name: 'order_date', type: 'TIMESTAMP' },
  { name: 'tester_id', type: 'INTEGER', default: '6' },
  { name: 'ship_by_date', type: 'TIMESTAMP' },
  { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
]);
