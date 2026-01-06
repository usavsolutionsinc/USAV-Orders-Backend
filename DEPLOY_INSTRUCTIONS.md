# 🚀 Deploy to Vercel - Quick Guide

## Step 1: Configure Environment Variables

1. Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**
2. Add this variable:

```
Name:  DATABASE_URL
Value: postgresql://username:password@host:5432/database?sslmode=require
```

**Get your Neon connection string:**
- https://console.neon.tech
- Your Project → Connection Details
- Copy the connection string

3. Select all environments: ✅ Production ✅ Preview ✅ Development
4. Click **Save**

## Step 2: Deploy

```bash
vercel --prod
```

Wait for deployment to complete. You'll get a URL like:
```
https://your-app.vercel.app
```

## Step 3: Setup Database (One Time)

**Just visit this URL in your browser:**

```
https://your-app.vercel.app/api/drizzle-setup
```

**Or use curl:**

```bash
curl -X POST https://your-app.vercel.app/api/drizzle-setup
```

**Expected Result:**
```json
{
  "success": true,
  "message": "✅ Drizzle schema setup completed successfully!",
  "tables_created": 19,
  "database_url_configured": true
}
```

## Step 4: Verify

**Check if all tables exist:**

```
https://your-app.vercel.app/api/drizzle-setup
```

(GET request - just open in browser)

Should show:
```json
{
  "success": true,
  "schema_complete": true,
  "total_tables": 19,
  "missing_tables": []
}
```

## Step 5: Test Your App

Navigate to:
- Main app: `https://your-app.vercel.app`
- Receiving page: `https://your-app.vercel.app/receiving`
- Admin panel: `https://your-app.vercel.app/admin`

---

## What Gets Created

The setup endpoint creates:

### Task Management Tables (6)
- `staff` - Staff members
- `tags` - Custom tags
- `task_templates` - Task templates
- `task_tags` - Tag relationships
- `daily_task_instances` - Daily tasks
- `receiving_tasks` - Receiving tasks ⭐ NEW

### Source of Truth Tables (13)
- `orders` (10 columns)
- `tech_1`, `tech_2`, `tech_3`, `tech_4` (7 columns each)
- `packer_1`, `packer_2`, `packer_3` (5 columns each)
- `receiving` (5 columns)
- `shipped` (10 columns)
- `sku_stock` (5 columns)
- `sku` (8 columns)
- `rs` (10 columns)

### Default Data
- 7 tags (Urgent, Important, Follow Up, etc.)
- 5 staff members (Tech 1-3, Packer 1-2)

### Indexes
- 9 performance indexes on frequently queried columns

---

## Troubleshooting

### ❌ "DATABASE_URL is not set"

**Fix:** Add DATABASE_URL in Vercel dashboard, then redeploy.

### ❌ Connection timeout

**Fix:** Check Neon database is running. Verify connection string.

### ❌ Some tables missing

**Fix:** Run the setup endpoint again. It's safe to run multiple times.

---

## Local Development

For local testing:

1. Create `.env.local`:
```env
DATABASE_URL=your_connection_string_here
```

2. Run locally:
```bash
npm run dev
curl -X POST http://localhost:3000/api/drizzle-setup
```

---

## That's It!

✅ Environment variables configured  
✅ Deployed to Vercel  
✅ Database schema created  
✅ App is live!

Your USAV Orders Backend is now running on Vercel with a fully configured database. 🎉

