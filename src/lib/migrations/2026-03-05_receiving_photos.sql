-- Receiving photos: one-to-many from receiving entries
CREATE TABLE IF NOT EXISTS receiving_photos (
    id SERIAL PRIMARY KEY,
    receiving_id INTEGER NOT NULL REFERENCES receiving(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    caption TEXT,
    uploaded_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receiving_photos_receiving_id ON receiving_photos(receiving_id);
