# Packer/Tech Logs Component Update

## Summary
Replaced `TechLogs.tsx` and `PackerLogs.tsx` components with the more comprehensive `ShippedTable.tsx` component. Updated the `/api/packerlogs` endpoint to query directly from the existing `orders` table with a limit of 5000 records. Added `StationDetailsHandler` component to enable details panel functionality on tech and packer station pages.

## Changes Made

### 1. **Deleted Old Components**
- Removed `src/components/station/TechLogs.tsx`
- Removed `src/components/station/PackerLogs.tsx`

### 2. **Updated ShippedTable.tsx**
- Changed month display from full names (FEBRUARY) to 3-letter abbreviations (FEB)
- Updated both date formatting functions to use abbreviated months
- Format: `SUN, FEB 5TH` instead of `SUN, FEBRUARY 5TH`
- Added optional filter props: `packedBy` and `testedBy`
- Filters orders client-side based on the provided staff IDs
- Station 4 (Tuan) only shows orders where `packed_by = 4`
- Station 5 (Thuy) only shows orders where `packed_by = 5`
- Tech stations filter by `tested_by` ID

### 3. **Created StationDetailsHandler Component** (`src/components/station/StationDetailsHandler.tsx`)
- New component that listens for 'open-shipped-details' and 'close-shipped-details' events
- Displays the `ShippedDetailsPanel` when an order is clicked in the ShippedTable
- Reuses the same event system as the ShippedSidebar for consistency
- Lightweight wrapper specifically for tech and packer station pages

### 4. **Updated TechDashboard.tsx**
- Replaced `TechLogs` component with `ShippedTable`
- Added `StationDetailsHandler` to enable order details panel
- Passes `testedBy={techId}` to filter orders by the current technician
- Tech 1 (Michael) only sees orders tested by staff ID 1
- Tech 2 (Thuc) only sees orders tested by staff ID 2
- Tech 3 (Sang) only sees orders tested by staff ID 3

### 5. **Updated PackerDashboard.tsx**
- Replaced `PackerLogs` component with `ShippedTable`
- Added `StationDetailsHandler` to enable order details panel
- Passes `packedBy={packerId}` to filter orders by the current packer
- Packer 4 (Tuan) only sees orders packed by staff ID 4
- Packer 5 (Thuy) only sees orders packed by staff ID 5

### 6. **API Route** (`src/app/api/packerlogs/route.ts`)
- Queries directly from the `orders` table
- Default limit increased to 5000 records
- Full CRUD operations (GET, POST, PUT, DELETE)
- Maps order fields to packer log format for backward compatibility

## Architecture

The system now uses an event-driven architecture for displaying order details:

1. **ShippedTable** dispatches `open-shipped-details` events when a row is clicked
2. **StationDetailsHandler** listens for these events and displays the details panel
3. **ShippedDetailsPanel** shows the order details in a slide-out panel

This architecture ensures:
- Single instance of the details panel (no duplicates)
- Consistent behavior across all pages
- Loose coupling between components

## Benefits

- **Unified UI**: Tech and packer stations now use the same table component as the shipped page
- **Better UX**: Week-by-week navigation, search functionality, and detailed order information
- **Personalized Views**: Each station sees only their own work (filtered by packed_by or tested_by)
- **Maintainability**: Single source of truth for displaying shipped orders
- **Performance**: Efficient loading with 5000 record batches, client-side filtering
- **Consistency**: Same data formatting and display logic across the application
- **Accurate Statistics**: Station-specific counts and metrics based on filtered data

## Changes Made

### 1. Database Schema (`src/lib/drizzle/schema.ts`)
- Added new `packerLogs` table definition with the following fields:
  - `id` (SERIAL PRIMARY KEY)
  - `pack_date_time` (TEXT)
  - `order_id` (TEXT)
  - `product_title` (TEXT)
  - `condition` (TEXT)
  - `shipping_tracking_number` (TEXT)
  - `sku` (TEXT)
  - `status` (TEXT)
  - `status_history` (JSONB)
  - `is_shipped` (BOOLEAN NOT NULL DEFAULT false)
  - `ship_by_date` (TEXT)
  - `packer_id` (INTEGER) - References staff.id
  - `packed_by` (INTEGER) - References staff.id
  - `packer_photos_url` (TEXT)
  - `notes` (TEXT)
  - `quantity` (TEXT DEFAULT '1')
  - `out_of_stock` (TEXT)
  - `account_source` (TEXT)
  - `order_date` (TIMESTAMP)

- Added TypeScript types: `PackerLog` and `NewPackerLog`

### 2. New API Route (`src/app/api/packerlogs/route.ts`)
Created a new API endpoint at `/api/packerlogs` with full CRUD operations:

#### GET `/api/packerlogs`
- Query parameters:
  - `packerId` (optional) - Filter by packer ID
  - `limit` (default: 50) - Number of records to return
  - `offset` (default: 0) - Pagination offset
- Returns logs in descending order (most recent first)
- Includes backward compatibility fields (`timestamp`, `tracking`, `title`)

#### POST `/api/packerlogs`
- Creates a new packer log entry
- Accepts all fields from the schema
- Returns the created log

#### PUT `/api/packerlogs`
- Updates an existing packer log
- Requires `id` in the request body
- Returns the updated log

#### DELETE `/api/packerlogs?id={id}`
- Deletes a packer log by ID
- Returns success confirmation

### 3. Component Update (`src/components/station/PackerLogs.tsx`)
- Updated `PackerLog` interface to include all new fields
- Maintained backward compatibility with legacy field names
- Changed API endpoint from `/api/packing-logs` to `/api/packerlogs`
- Updated all field references to use new schema fields:
  - `packDateTime` instead of `timestamp`
  - `productTitle` instead of `title`
  - `shippingTrackingNumber` instead of `tracking`

### 4. Database Migration (`migrations/create_packer_logs_table.sql`)
- SQL script to create the `packer_logs` table
- Includes indexes for optimal query performance:
  - `idx_packer_logs_packed_by`
  - `idx_packer_logs_packer_id`
  - `idx_packer_logs_shipping_tracking`
  - `idx_packer_logs_order_id`
  - `idx_packer_logs_pack_date_time`
- Optional migration query to copy existing data from `orders` table

## How to Apply Changes

### Step 1: Run Database Migration
Execute the SQL migration to create the new table:

```bash
psql -d your_database_name -f migrations/create_packer_logs_table.sql
```

Or using your preferred database client, run the SQL in:
`migrations/create_packer_logs_table.sql`

### Step 2: (Optional) Migrate Existing Data
If you want to copy existing packed orders from the `orders` table to the new `packer_logs` table, uncomment and run the INSERT statement at the bottom of the migration file.

### Step 3: Test the API
Test the new API endpoint:

```bash
# Get logs for a specific packer
curl http://localhost:3000/api/packerlogs?packerId=4&limit=10

# Create a new log
curl -X POST http://localhost:3000/api/packerlogs \
  -H "Content-Type: application/json" \
  -d '{
    "packDateTime": "2026-02-05 10:30:00",
    "orderId": "12345",
    "productTitle": "Test Product",
    "shippingTrackingNumber": "1Z999AA10123456784",
    "packedBy": 4,
    "quantity": "1",
    "isShipped": true
  }'
```

### Step 4: Update Your Application
If you have other components or services that interact with packer logs, update them to use the new `/api/packerlogs` endpoint and the new field names.

## Backward Compatibility
The implementation maintains backward compatibility by:
1. Supporting both old and new field names in the component
2. Returning legacy fields (`timestamp`, `tracking`, `title`) in API responses
3. Gracefully handling missing fields with fallback values

## Benefits
- **Comprehensive tracking**: All order information available in packer logs
- **Better performance**: Dedicated table with optimized indexes
- **Full CRUD operations**: Complete API for managing packer logs
- **Type safety**: Full TypeScript types for schema
- **Flexibility**: Easy to add new fields or queries in the future

## Notes
- The old `/api/packing-logs` endpoint remains unchanged for backward compatibility with other parts of the application
- The component now uses `/api/packerlogs` for the new schema
- Both tables (`packing_logs` and `packer_logs`) exist for different purposes
