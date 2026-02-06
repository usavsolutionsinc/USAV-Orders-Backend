# ShippedDetailsPanel Updates - Photo Gallery & Account Source

## Changes Implemented

### 1. Photo Gallery Section (Top of Panel)

**Always Visible** - Shows at the very top, above shipping information

#### When Photos Exist:
- Large clickable card with gradient background (indigo to purple)
- Shows first photo as main preview (20x20px)
- Displays additional thumbnails if multiple photos exist
- Shows "+X" indicator if more than 3 photos
- Text: "X Photos Captured" + "Click to view all photos"
- Hover effects: shadow + border color change + scale animation
- Click opens full-screen photo viewer

#### When No Photos:
- Gray dashed border card
- Gray camera icon in circle
- Text: "NO PHOTOS TAKEN"
- Subtext: "No packing photos for this order"

**Photo Viewer Modal:**
- Full-screen black overlay
- Photo counter (e.g., "1 / 3")
- Left/right arrow navigation
- Close button (X) in top right
- Click outside to close

---

### 2. Account Source Badge

**Location:** To the right of "Order ID" label under Shipping Information

**Display Logic:**

| Order ID Pattern | Display |
|-----------------|---------|
| `000-0000000-0000000` (3 digits first) | `Amazon` |
| `00-00000-00000` (2 digits first) | `eBay - {account_source}` |
| `0000` (4 digits only) | `ECWID` |
| Contains "FBA" | `FBA` |
| Any other | Shows `account_source` value or nothing |

**Badge Styling:**
- Blue background (`bg-blue-50`)
- Blue text (`text-blue-600`)
- Rounded pill shape
- Small uppercase text
- Positioned at top-right of Order ID field

---

## Database Changes

### ShippedOrder Interface
Added field:
```typescript
account_source: string | null; // Account source (Amazon, eBay account name, etc.)
```

### SQL Queries Updated
All 4 queries now select `o.account_source`:
1. `getAllShippedOrders()` ✅
2. `getShippedOrderById()` ✅
3. `searchShippedOrders()` ✅
4. `getShippedOrderByTracking()` ✅

---

## Component Changes

### New Helper Function
```typescript
getAccountSourceLabel(orderId: string, accountSource: string | null)
```
- Detects order ID pattern
- Returns appropriate label
- Handles FBA, Amazon, eBay, ECWID cases

### State Variables
- `photoViewerOpen: boolean` - Controls modal visibility
- `currentPhotoIndex: number` - Tracks which photo is displayed
- `photoUrls: string[]` - Parsed from `packer_photos_url`
- `hasPhotos: boolean` - Whether any photos exist

### Event Handlers
- `openPhotoViewer(index)` - Opens modal at specific photo
- `closePhotoViewer()` - Closes modal
- `handleNextPhoto()` - Navigate to next photo
- `handlePrevPhoto()` - Navigate to previous photo

---

## Visual Structure

```
┌─────────────────────────────────────┐
│ Header (Order ID + Close Button)   │
├─────────────────────────────────────┤
│                                     │
│ ╔═══════════════════════════════╗  │
│ ║ PACKING PHOTOS                ║  │ ← Always at top
│ ║ [Photo Preview] 3 Photos      ║  │
│ ║ Click to view all photos →    ║  │
│ ╚═══════════════════════════════╝  │
│                                     │
│ ┌─────────────────────────────┐    │
│ │ SHIPPING INFORMATION        │    │
│ │                             │    │
│ │ Tracking Number             │    │
│ │ ┌─────────────────────────┐ │    │
│ │ │ Order ID      [Amazon]  │ │    │ ← Badge here
│ │ └─────────────────────────┘ │    │
│ │ Serial Number               │    │
│ └─────────────────────────────┘    │
│                                     │
│ [Product Details Section...]        │
│ [Packing Information Section...]    │
│ [Testing Information Section...]    │
└─────────────────────────────────────┘
```

---

## Testing

### Photo Gallery Tests:
- [ ] Photos display when `packer_photos_url` has values
- [ ] Empty state shows when `packer_photos_url` is null/empty
- [ ] Click on photo card opens full-screen viewer
- [ ] Arrow navigation works between photos
- [ ] Photo counter displays correctly
- [ ] Close button works (X and click outside)
- [ ] Multiple photo thumbnails display correctly
- [ ] "+X" indicator shows for more than 3 photos

### Account Source Tests:
- [ ] Amazon orders show "Amazon" badge
- [ ] eBay orders show "eBay - {account_name}" badge
- [ ] ECWID orders show "ECWID" badge
- [ ] FBA orders show "FBA" badge
- [ ] Badge positioned correctly next to Order ID
- [ ] Badge styling matches design (blue, rounded, uppercase)

---

## Example Order ID Patterns

### Amazon
- `113-1234567-1234567` → **Amazon**
- `123-9876543-2109876` → **Amazon**

### eBay
- `12-34567-89012` → **eBay - {account_source}**
- `45-67890-12345` → **eBay - usavretail**

### ECWID
- `1234` → **ECWID**
- `5678` → **ECWID**

### FBA
- Any order with "FBA" in ID → **FBA**

---

## Files Modified

1. `/src/components/shipped/ShippedDetailsPanel.tsx`
   - Added photo gallery section (always visible)
   - Added empty state for no photos
   - Added full-screen photo viewer modal
   - Added account source badge logic
   - Updated Order ID field layout

2. `/src/lib/neon/orders-queries.ts`
   - Added `account_source` to `ShippedOrder` interface
   - Updated all 4 SQL queries to select `o.account_source`

---

## Dependencies

No new dependencies needed. Uses existing:
- `framer-motion` for animations
- `AnimatePresence` for modal transitions
- Inline SVG for camera icon
