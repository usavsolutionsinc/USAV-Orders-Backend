import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Create postgres connection
const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';

// Disable prefetch as it is not supported for "Transaction" pool mode
export const client = postgres(connectionString, { 
    prepare: false,
    onnotice: () => {}, // Suppress notices
});

export const db = drizzle(client, { schema });
