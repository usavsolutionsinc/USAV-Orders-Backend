-- FBA Shipment Lifecycle tables
-- Replaces the receiving WHERE target_channel='FBA' hack with an explicit
-- lifecycle: PLANNED -> READY_TO_GO -> LABEL_ASSIGNED -> SHIPPED

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE fba_shipment_status_enum AS ENUM ('PLANNED','READY_TO_GO','LABEL_ASSIGNED','SHIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE fba_scan_mode_enum AS ENUM ('TECH_PREP','PACKER_VERIFY','LABEL_BIND','SHIP_CLOSE','ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE fba_scan_event_enum AS ENUM (
    'FNSKU_SCANNED','READY_MARKED','PACK_VERIFIED','LABEL_BOUND','SHIPMENT_CLOSED','ADMIN_OVERRIDE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Table 1: fba_shipments (header) ─────────────────────────────────────────
-- One row per Amazon FBA outbound shipment.  entity_id in work_assignments
-- will reference this table when entity_type = 'FBA_SHIPMENT'.

CREATE TABLE IF NOT EXISTS fba_shipments (
  id                   SERIAL PRIMARY KEY,
  shipment_ref         TEXT NOT NULL,          -- Amazon shipment ID e.g. FBA15XXXXX
  destination_fc       TEXT,                   -- Amazon fulfillment-center code
  due_date             DATE,
  status               fba_shipment_status_enum NOT NULL DEFAULT 'PLANNED',
  created_by_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_tech_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_packer_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  shipped_at           TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fba_shipments_status
  ON fba_shipments(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fba_shipments_tech
  ON fba_shipments(assigned_tech_id)
  WHERE assigned_tech_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fba_shipments_packer
  ON fba_shipments(assigned_packer_id)
  WHERE assigned_packer_id IS NOT NULL;

-- ── Table 2: fba_shipment_items (qty-bucket per FNSKU per shipment) ──────────
-- One row per FNSKU per shipment.  actual_qty increments on each tech scan.
-- Product metadata is denormalised here because fba_fnskus is truncated on
-- every sheet-sync; copying at plan time prevents history loss.

CREATE TABLE IF NOT EXISTS fba_shipment_items (
  id                    SERIAL PRIMARY KEY,
  shipment_id           INTEGER NOT NULL REFERENCES fba_shipments(id) ON DELETE CASCADE,
  fnsku                 TEXT NOT NULL,
  product_title         TEXT,
  asin                  TEXT,
  sku                   TEXT,
  expected_qty          INTEGER NOT NULL DEFAULT 0,
  actual_qty            INTEGER NOT NULL DEFAULT 0,
  status                fba_shipment_status_enum NOT NULL DEFAULT 'PLANNED',
  ready_by_staff_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ready_at              TIMESTAMPTZ,
  verified_by_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  verified_at           TIMESTAMPTZ,
  labeled_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  labeled_at            TIMESTAMPTZ,
  shipped_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  shipped_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipment_id, fnsku)
);

CREATE INDEX IF NOT EXISTS idx_fba_items_shipment
  ON fba_shipment_items(shipment_id, status);

CREATE INDEX IF NOT EXISTS idx_fba_items_fnsku
  ON fba_shipment_items(fnsku);

-- ── Table 3: fba_label_batches (one shipping label → bundle of items) ────────

CREATE TABLE IF NOT EXISTS fba_label_batches (
  id                    SERIAL PRIMARY KEY,
  shipment_id           INTEGER NOT NULL REFERENCES fba_shipments(id) ON DELETE CASCADE,
  label_barcode         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN','SEALED','SHIPPED')),
  labeled_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipment_id, label_barcode)
);

CREATE INDEX IF NOT EXISTS idx_fba_label_batches_shipment
  ON fba_label_batches(shipment_id, status);

-- ── Table 4: fba_label_batch_items (junction) ────────────────────────────────

CREATE TABLE IF NOT EXISTS fba_label_batch_items (
  id         SERIAL PRIMARY KEY,
  batch_id   INTEGER NOT NULL REFERENCES fba_label_batches(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES fba_shipment_items(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, item_id)
);

-- ── Table 5: fba_scan_events (immutable audit log) ───────────────────────────
-- New FNSKU scans go here instead of tech_serial_numbers with serial_type='FNSKU'.
-- Historical rows in tech_serial_numbers remain untouched.

CREATE TABLE IF NOT EXISTS fba_scan_events (
  id                   SERIAL PRIMARY KEY,
  shipment_id          INTEGER REFERENCES fba_shipments(id) ON DELETE SET NULL,
  item_id              INTEGER REFERENCES fba_shipment_items(id) ON DELETE SET NULL,
  batch_id             INTEGER REFERENCES fba_label_batches(id) ON DELETE SET NULL,
  scanned_by_staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  scan_mode            fba_scan_mode_enum NOT NULL,
  event_type           fba_scan_event_enum NOT NULL,
  fnsku                TEXT,
  station              TEXT,
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Intentionally no updated_at — immutable audit log
);

CREATE INDEX IF NOT EXISTS idx_fba_scan_events_shipment
  ON fba_scan_events(shipment_id)
  WHERE shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fba_scan_events_item
  ON fba_scan_events(item_id)
  WHERE item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fba_scan_events_staff_date
  ON fba_scan_events(scanned_by_staff_id, created_at DESC);
