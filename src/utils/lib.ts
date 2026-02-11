export type ColumnType =
  | 'SERIAL'
  | 'TEXT'
  | 'VARCHAR(20)'
  | 'VARCHAR(50)'
  | 'VARCHAR(100)'
  | 'TIMESTAMP'
  | 'INTEGER'
  | 'JSONB'
  | 'BOOLEAN';

export interface ColumnDef {
  name: string;
  type: ColumnType;
  notNull?: boolean;
  primaryKey?: boolean;
  default?: string;
}

export interface SchemaDef {
  table: string;
  columns: ColumnDef[];
}

export function defineSchema(table: string, columns: ColumnDef[]): SchemaDef {
  return { table, columns };
}
