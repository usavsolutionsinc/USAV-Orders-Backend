# USAV Orders - Simple Google Sheets Embed

This is a simplified Next.js application that embeds an editable Google Sheet directly in the browser.

## Features
- Direct Google Sheet embedding with full editing capabilities
- No database required
- No API integrations
- Clean, minimal UI

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

## How It Works

The application displays an embedded Google Sheet iframe with editing capabilities. The sheet is configured to be publicly editable, so anyone with the link can make changes directly.

### Google Sheet URL
The embedded sheet URL is configured in `src/app/page.tsx`:
- Sheet ID: `1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE`
- Parameters used for clean view:
  - `rm=minimal` - Hides toolbar/title
  - `single=true` - Shows only one sheet (no tab bar)
  - `widget=false` - Removes extra widgets/footer
  - `headers=false` - Hides row/column headers

### Changing the Sheet

To embed a different Google Sheet:
1. Share your sheet with "Anyone with the link can edit"
2. Copy the sheet ID from the URL
3. Update the `sheetId` variable in `src/app/page.tsx`

## Deployment

This app can be deployed to Vercel:

```bash
vercel
```

## What Was Removed

This is a simplified version that removed:
- PostgreSQL/Neon Database integration
- Google Sheets API sync logic
- All API routes for orders, SKUs, packing slips, etc.
- Database migration scripts
- Complex table management
- Navigation and multi-page components

All of the above functionality now lives directly in the Google Sheet.
