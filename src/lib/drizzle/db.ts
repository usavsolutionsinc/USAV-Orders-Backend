// Use @neondatabase/serverless neon-http for drizzle — HTTP transport, no
// persistent connection, Neon compute can sleep between requests.
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';

export const client = neon(connectionString);
export const db = drizzle(client, { schema });
