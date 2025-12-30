# Column Mapping: Google Sheets to Neon DB

This document shows the exact column mapping between Google Sheets and Neon Postgres database tables.

## ORDERS Sheet → `orders` Table

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: SIZE | `size` | VARCHAR(50) | |
| B: Platform | `platform` | VARCHAR(100) | |
| C: Order ID | `order_id` | VARCHAR(50) | Primary key (also stored as `id`) |
| D: Buyer Name | `buyer_name` | VARCHAR(255) | |
| E: Product Title | `product_title` | TEXT | |
| F: # | `quantity` | INTEGER | |
| G: Ship | `ship` | VARCHAR(50) | |
| H: SKU | `sku` | VARCHAR(100) | |
| I: Item # | `item_index` | VARCHAR(50) | |
| J: As | `asin` | VARCHAR(50) | |
| K: Shipping TRK # | `shipping_trk_number` | VARCHAR(100) | |
| L: (empty) | - | - | Skipped |
| M: OOS - We Need | `oos_needed` | TEXT | |
| N: Receiving TRK # | `receiving_trk_number` | VARCHAR(100) | |
| O: Stock Status / Location | `stock_status_location` | VARCHAR(255) | |
| P: Notes | `notes` | TEXT | |

## Tech_1, Tech_2, Tech_3 Sheets → `tech_1`, `tech_2`, `tech_3` Tables

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: Date / Time | `date_time` | TIMESTAMP | |
| B: Title - Testing | `title_testing` | TEXT | |
| C: Shipping TRK # / Testing | `shipping_trk_testing` | VARCHAR(100) | |
| D: Serial Number Data | `serial_number_data` | TEXT | |
| E: Input | `input` | VARCHAR(255) | |
| F: As | `asin` | VARCHAR(50) | |
| G: SKU | `sku` | VARCHAR(100) | |
| H: # | `quantity` | INTEGER | |

**Note:** Table numbering starts from 1 (tech_1, tech_2, tech_3), not 0.

## Packer_1, Packer_2, Packer_3 Sheets → `Packer_1`, `Packer_2`, `Packer_3` Tables

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: Date / Time | `date_time` | TIMESTAMP | |
| B: Tracking Number/FNSKU | `tracking_number_fnsku` | VARCHAR(100) | |
| C: ID | `order_id` | VARCHAR(50) | |
| D: Product Title | `product_title` | TEXT | |
| E: # (if exists) | `quantity` | INTEGER | Optional |

**Note:** Table numbering starts from 1 (Packer_1, Packer_2, Packer_3), not 0.

## Receiving Sheet → `receiving` Table

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: Date / Time | `date_time` | TIMESTAMP | |
| B: Tracking Number | `tracking_number` | VARCHAR(100) | |
| C: Carrier | `carrier` | VARCHAR(50) | |
| D: Qty | `qty` | INTEGER | |

## Shipped Sheet → `shipped` Table

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: Date / Time | `date_time` | TIMESTAMP | |
| B: Order ID | `order_id` | VARCHAR(50) | |
| C: Product Title | `product_title` | TEXT | |
| D: Sent | `sent` | VARCHAR(50) | |
| E: Shipping TRK # | `shipping_trk_number` | VARCHAR(100) | |
| F: Serial Number | `serial_number` | TEXT | |
| G: Box | `box` | VARCHAR(50) | |
| H: By | `by_name` | VARCHAR(100) | |
| I: SKU | `sku` | VARCHAR(100) | |
| J: Status | `status` | VARCHAR(50) | |

## Sku-Stock Sheet → `sku_stock` Table

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: SKU | `sku` | VARCHAR(100) | Primary key |
| B: Size | `size` | VARCHAR(50) | |
| C: Title | `title` | TEXT | |
| D: Condition | `condition` | VARCHAR(50) | |
| E: (Quantity) | `quantity` | INTEGER | Default 0 |

## Sku Sheet → `skus` Table

| Sheet Column | DB Column | Type | Notes |
|--------------|-----------|------|-------|
| A: Store Date / Time | `store_date_time` | TIMESTAMP | |
| B: Static SKU | `static_sku` | VARCHAR(100) | |
| C: Serial Numbers | `serial_numbers` | TEXT | |
| D: Shipping TRK # | `shipping_trk_number` | VARCHAR(100) | |
| E: Product Title | `product_title` | TEXT | |
| F: Size | `size` | VARCHAR(50) | |
| G: Notes | `notes` | TEXT | |
| H: Location | `location` | VARCHAR(255) | |

## Important Notes

1. **Table Numbering**: All tables start from 1, not 0:
   - `tech_1`, `tech_2`, `tech_3` (not tech_0, tech_1, tech_2)
   - `Packer_1`, `Packer_2`, `Packer_3` (not Packer_0, Packer_1)

2. **Column Name Matching**: The sync script tries multiple variations:
   - Exact match: `Order ID`
   - Lowercase: `order_id`
   - Mixed case: `Order ID`

3. **Date/Time Parsing**: Supports multiple formats:
   - `MM/DD/YYYY HH:MM:SS`
   - `MM/DD/YYYY HH:MM`
   - `MM/DD/YYYY`
   - `YYYY-MM-DD HH:MM:SS`

4. **Error Handling**: All sync functions include:
   - Transaction rollback on error
   - Detailed error logging with traceback
   - Continues processing other sheets on individual failures

## Debugging

If sync fails, check:
1. Column names match exactly (case-sensitive in some cases)
2. Date formats are parseable
3. Required fields (like Order ID) are present
4. Database connection is working
5. Google Sheets API permissions are correct

## API Endpoint

The sync endpoint `/api/sync-sheets` now includes:
- Debug logging with `[SYNC]` prefix
- Environment variable validation
- Detailed error messages
- Response includes debug information
