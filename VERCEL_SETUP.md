# Vercel Deployment Setup

## Prerequisites

Make sure you have `DATABASE_URL` configured in your Vercel environment variables.

### Add Environment Variable in Vercel Dashboard:

1. Go to your Vercel project
2. Navigate to **Settings** → **Environment Variables**
3. Add:
   - **Key**: `DATABASE_URL`
   - **Value**: Your Neon PostgreSQL connection string
   ```
   postgresql://username:password@host:5432/database?sslmode=require
   ```
4. Select environments: **Production**, **Preview**, **Development**
5. Click **Save**

## Deployment Steps

### 1. Deploy to Vercel

```bash
# If not already connected
vercel

# Or deploy
vercel --prod
```

### 2. Run Database Setup

After deployment, run the setup endpoint **once**:

```bash
# Replace with your actual Vercel domain
curl -X POST https://your-app.vercel.app/api/drizzle-setup
```

**Or visit in browser:**
```
https://your-app.vercel.app/api/drizzle-setup
```
(Just navigate to it - it will run automatically)

### 3. Verify Setup

Check if all tables were created:

```bash
curl https://your-app.vercel.app/api/drizzle-setup
```

**Expected Response:**
```json
{
  "success": true,
  "database_url_configured": true,
  "total_tables": 19,
  "schema_complete": true,
  "missing_tables": []
}
```

## What the Endpoint Does

The `/api/drizzle-setup` endpoint:

✅ Creates all 19 database tables:
- Task management tables (staff, tags, task_templates, etc.)
- Source of truth tables (orders, tech_1-4, packer_1-3, etc.)
- Receiving tasks table

✅ Creates all necessary indexes for performance

✅ Inserts default data:
- 7 default tags (Urgent, Important, Follow Up, etc.)
- 5 sample staff members (Tech 1-3, Packer 1-2)

✅ Uses Vercel's environment variables automatically

✅ Safe to run multiple times (uses `IF NOT EXISTS`)

## Endpoints Available

### POST /api/drizzle-setup
**Run this once after deployment**
```bash
curl -X POST https://your-app.vercel.app/api/drizzle-setup
```

Creates all tables, indexes, and default data.

### GET /api/drizzle-setup
**Check schema status**
```bash
curl https://your-app.vercel.app/api/drizzle-setup
```

Returns information about existing tables and what's missing.

### GET /api/test-db
**Test database connection**
```bash
curl https://your-app.vercel.app/api/test-db
```

Verifies DATABASE_URL is configured correctly.

## Troubleshooting

### "DATABASE_URL is not set"

**Problem:** Environment variable not configured in Vercel

**Solution:**
1. Go to Vercel Dashboard
2. Project Settings → Environment Variables
3. Add `DATABASE_URL` with your Neon connection string
4. Redeploy: `vercel --prod`

### "Connection timeout"

**Problem:** Neon database IP restrictions or connection issues

**Solution:**
1. Check Neon dashboard - ensure database is running
2. Verify connection string is correct
3. Check if IP restrictions are blocking Vercel

### "Table already exists"

**Not a problem!** The endpoint uses `IF NOT EXISTS`, so it's safe to run multiple times.

### Some tables missing

**Run the endpoint again:**
```bash
curl -X POST https://your-app.vercel.app/api/drizzle-setup
```

The transaction might have been interrupted. Running again will create missing tables.

## Local Development

For local development, create `.env.local`:

```env
DATABASE_URL=postgresql://username:password@host:5432/database?sslmode=require
```

Then run:
```bash
npm run dev

# Setup database
curl -X POST http://localhost:3000/api/drizzle-setup
```

## Vercel Functions Considerations

### Timeout
- Vercel Hobby plan: 10 second timeout
- Vercel Pro: 60 second timeout
- The setup endpoint should complete within 5-10 seconds

### Cold Starts
- First request after deployment may be slow
- Subsequent requests will be faster
- Database connection is pooled

### Environment Variables
- Variables are loaded automatically by Vercel
- No need for dotenv or manual loading
- Access via `process.env.DATABASE_URL`

## Production Checklist

Before going live:

- [ ] DATABASE_URL configured in Vercel
- [ ] Deployed to production: `vercel --prod`
- [ ] Run setup endpoint: `POST /api/drizzle-setup`
- [ ] Verify schema: `GET /api/drizzle-setup`
- [ ] Test database: `GET /api/test-db`
- [ ] Test main app: Navigate to your domain
- [ ] Test receiving page: `/receiving`
- [ ] Test admin panel: `/admin`

## Database Backup

Before making schema changes:

```bash
# Backup from Neon
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Or use Neon's built-in backup features
```

## Updating Schema

If you need to add new tables or modify schema:

1. Update the `/api/drizzle-setup/route.ts` file
2. Deploy changes: `vercel --prod`
3. Run setup endpoint again (existing tables won't be affected)

## Performance Tips

1. **Connection Pooling**: Already configured in `src/lib/db.ts`
2. **Indexes**: Created automatically by setup endpoint
3. **SSL**: Configured for Neon (`sslmode=require`)
4. **Prepared Statements**: Disabled for Transaction mode compatibility

## Support

### Check Logs
```bash
# View Vercel logs
vercel logs

# Or in Vercel dashboard:
Project → Deployments → [Latest] → Functions
```

### Test Locally First
```bash
# Always test locally before deploying
npm run dev
curl -X POST http://localhost:3000/api/drizzle-setup
```

### Verify Environment
```bash
# Check environment variables are set
curl https://your-app.vercel.app/api/test-db
```

## Quick Commands Reference

```bash
# Deploy
vercel --prod

# Setup database (do this once after deployment)
curl -X POST https://your-app.vercel.app/api/drizzle-setup

# Verify schema
curl https://your-app.vercel.app/api/drizzle-setup

# Test connection
curl https://your-app.vercel.app/api/test-db

# View logs
vercel logs --follow
```

---

**That's it!** Your database is ready to use on Vercel. 🚀

