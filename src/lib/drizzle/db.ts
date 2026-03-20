import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Create postgres connection
const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';
function readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

const connectTimeoutSeconds = Math.max(1, Math.ceil(readPositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10000) / 1000));
const idleTimeoutSeconds = Math.max(1, Math.ceil(readPositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 30000) / 1000));

// Disable prefetch as it is not supported for "Transaction" pool mode
export const client = postgres(connectionString, { 
    prepare: false,
    onnotice: () => {}, // Suppress notices
    connect_timeout: connectTimeoutSeconds,
    idle_timeout: idleTimeoutSeconds,
    max_lifetime: 60 * 30,
});

export const db = drizzle(client, { schema });
