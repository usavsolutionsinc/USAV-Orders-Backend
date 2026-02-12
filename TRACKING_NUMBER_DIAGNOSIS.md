# Tracking Number Display Issue - Diagnosis & Solution

**Date:** February 12, 2026

## Issue Summary
Two tracking numbers were showing different behavior in the ShippedTable:
- ✅ `9434650206217172803024` - **DISPLAYS** in ShippedTable
- ❌ `1ZJ22B100331308040` - **DOES NOT DISPLAY** in ShippedTable

## Root Cause Analysis

### Diagnostic Script Created
Created `debug-tracking.js` to analyze why tracking numbers appear or don't appear in ShippedTable.

Usage:
```bash
node debug-tracking.js 9434650206217172803024 1ZJ22B100331308040
```

### Key Findings

#### Tracking #1: 9434650206217172803024 ✅
- **Orders Table:** Found (ID: 2179, Order: 12-14219-90327)
- **Packer Logs:** Found with `tracking_type = 'ORDERS'` ✓
- **Pack Date Time:** `2026-02-12 10:28:51` ✓
- **Result:** **DISPLAYS in ShippedTable**

#### Tracking #2: 1ZJ22B100331308040 ❌
- **Orders Table:** Found (ID: 2069, Order: 111-4476421-3215423)
- **Packer Logs:** Found BUT `tracking_type = 'UPS'` ⚠️
- **Pack Date Time:** `2026-02-12 18:39:08` ✓
- **Result:** **DOES NOT DISPLAY in ShippedTable**

### The Problem

The ShippedTable query (in `src/lib/neon/orders-queries.ts`) requires TWO conditions:
1. `pl.pack_date_time IS NOT NULL` ✓ (both have this)
2. `pl.tracking_type = 'ORDERS'` ❌ (second tracking has 'UPS')

**Query excerpt:**
```sql
LEFT JOIN LATERAL (
  SELECT packed_by, pack_date_time, packer_photos_url
  FROM packer_logs pl
  WHERE RIGHT(regexp_replace(pl.shipping_tracking_number, '\\D', '', 'g'), 8) =
        RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
    AND pl.tracking_type = 'ORDERS'  -- ⚠️ THIS IS THE FILTER
  ORDER BY pack_date_time DESC NULLS LAST, pl.id DESC
  LIMIT 1
) pl ON true
WHERE pl.pack_date_time IS NOT NULL
```

## Solution

To fix tracking number `1ZJ22B100331308040`, update its packer_logs entry:

```sql
UPDATE packer_logs
SET tracking_type = 'ORDERS'
WHERE shipping_tracking_number = '1ZJ22B100331308040';
```

## Additional Fix: Date Format Consistency

### Issue
The mobile app was posting timestamps with milliseconds:
- Before: `2026-02-12 18:39:08.188` ❌
- After: `2026-02-12 18:39:08` ✅

### Files Updated

1. **Mobile App** (`USAV_Orders_Backend_Mobile/src/services/api.ts`)
   - Changed from `now.toISOString()` to formatted string without milliseconds
   - Format: `YYYY-MM-DD HH:MM:SS`

2. **Backend** (`USAV-Orders-Backend/src/app/api/packing-logs/update/route.ts`)
   - Updated `uploadedAt` field in photos JSONB to match format
   - Consistent timestamp format across all fields

### Code Changes

**Before:**
```typescript
const isoTimestamp = now.toISOString(); // 2026-02-12T18:39:08.188Z
```

**After:**
```typescript
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hours = String(now.getHours()).padStart(2, '0');
const minutes = String(now.getMinutes()).padStart(2, '0');
const seconds = String(now.getSeconds()).padStart(2, '0');
const formattedTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
// Result: 2026-02-12 18:39:08
```

## Files Modified

1. `/USAV-Orders-Backend/debug-tracking.js` - **NEW** diagnostic script
2. `/USAV_Orders_Backend_Mobile/src/services/api.ts` - Updated timestamp format
3. `/USAV-Orders-Backend/src/app/api/packing-logs/update/route.ts` - Updated uploadedAt format

## Testing

Run the diagnostic script anytime to check tracking numbers:
```bash
cd /Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend
node debug-tracking.js <tracking_number>
```

The script will check:
- ✅ Orders table presence
- ✅ Packer logs table presence and tracking_type
- ✅ Tech serial numbers table
- ✅ ShippedTable query simulation
- ⚠️ Common issues and why records don't appear

## Prevention

To ensure all tracking numbers appear in ShippedTable:
1. Always use `tracking_type = 'ORDERS'` for order shipments
2. Ensure `pack_date_time` is set (not NULL)
3. Use consistent date format without milliseconds
4. Test with diagnostic script before going live
