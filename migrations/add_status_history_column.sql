-- Migration: Add status_history column to orders table
-- Purpose: Track all status changes with timestamps and user information

BEGIN;

DO $$
BEGIN
    RAISE NOTICE '=== Adding status_history column to orders table ===';
    
    -- Add status_history column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'status_history'
    ) THEN
        ALTER TABLE orders ADD COLUMN status_history JSONB DEFAULT '[]'::jsonb;
        RAISE NOTICE '✓ Added status_history column';
    ELSE
        RAISE NOTICE '✓ status_history column already exists';
    END IF;
END $$;

COMMIT;

DO $$ 
BEGIN 
    RAISE NOTICE '=== Migration Complete! ===';
END $$;
