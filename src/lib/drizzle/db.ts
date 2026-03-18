import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Create postgres connection
const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';

// Disable prefetch as it is not supported for "Transaction" pool mode
export const client = postgres(connectionString, { 
    prepare: false,
    onnotice: () => {}, // Suppress notices
    connect_timeout: 4,
    idle_timeout: 10,
    max_lifetime: 60 * 30,
});

export const db = drizzle(client, { schema });
