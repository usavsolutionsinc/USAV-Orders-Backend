-- Migration: Change parts_needed to process in repair_service table
-- This adds a new process column (JSON) and migrates existing data

-- Step 1: Add the new process column as JSON (stored as TEXT)
ALTER TABLE repair_service 
ADD COLUMN IF NOT EXISTS process TEXT DEFAULT '[]';

-- Step 2: Add the name column if it doesn't exist
ALTER TABLE repair_service 
ADD COLUMN IF NOT EXISTS name TEXT;

-- Step 3: Migrate existing parts_needed data to process (if parts_needed exists)
-- This will convert any existing parts_needed text into a process entry
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'repair_service' 
    AND column_name = 'parts_needed'
  ) THEN
    -- Migrate existing parts_needed to process format
    UPDATE repair_service 
    SET process = CASE 
      WHEN parts_needed IS NOT NULL AND parts_needed != '' THEN 
        json_build_array(
          json_build_object(
            'parts', parts_needed,
            'person', 'System',
            'date', COALESCE(date_time, NOW()::TEXT)
          )
        )::TEXT
      ELSE '[]'
    END
    WHERE process = '[]' OR process IS NULL;
    
    -- Drop the old parts_needed column
    ALTER TABLE repair_service DROP COLUMN parts_needed;
  END IF;
END $$;

-- Step 4: Ensure process column is never NULL
UPDATE repair_service 
SET process = '[]' 
WHERE process IS NULL;
