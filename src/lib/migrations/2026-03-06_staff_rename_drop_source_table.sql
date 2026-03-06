-- Rename staff ID 7 → Kai, ID 8 → Lien
UPDATE staff SET name = 'Kai'  WHERE id = 7;
UPDATE staff SET name = 'Lien' WHERE id = 8;

-- Drop the source_table column (no longer used)
ALTER TABLE staff DROP COLUMN IF EXISTS source_table;
