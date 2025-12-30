# Vercel Deployment Guide

## Prerequisites
- GitHub repository connected to your codebase
- Vercel account (sign up at https://vercel.com)

## Deployment Steps

### 1. Push Your Code to GitHub
```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

### 2. Deploy to Vercel

#### Option A: Via Vercel Dashboard (Recommended)
1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Vercel will auto-detect Next.js
4. Configure environment variables (see below)
5. Click "Deploy"

#### Option B: Via Vercel CLI
```bash
# Install Vercel CLI globally
npm i -g vercel

# Login to Vercel
vercel login

# Deploy (from project root)
cd USAV-Orders-Backend
vercel

# Follow the prompts
```

### 3. Environment Variables

In Vercel Dashboard → Your Project → Settings → Environment Variables, add:

- **DATABASE_URL**: Your Neon Postgres connection string
  - Format: `postgresql://user:password@host/database?sslmode=require`
  - Get this from your Neon dashboard

### 4. Run Database Migrations

After deployment, you'll need to run the database migrations. You can do this:

**Option A: Run locally pointing to production DB**
```bash
# Temporarily set DATABASE_URL to production
export DATABASE_URL="your-production-db-url"
node scripts/migrate-daily-tasks.js
```

**Option B: Use Vercel CLI to run a one-time script**
```bash
vercel env pull .env.local
# Then run migration script
```

**Option C: Use Neon's SQL Editor**
- Copy the SQL from `scripts/migrate-daily-tasks.js`
- Run it in Neon's SQL Editor

### 5. Verify Deployment

- Visit your Vercel deployment URL
- Test the application
- Check that API routes are working
- Verify database connections

## Post-Deployment

### Custom Domain (Optional)
1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions

### Environment-Specific Deployments
- **Production**: Auto-deploys from `main` branch
- **Preview**: Auto-deploys from pull requests
- **Development**: Can set up separate branch deployments

## Troubleshooting

### Build Fails
- Check that all dependencies are in `package.json`
- Ensure `node_modules` is in `.gitignore` (it is)
- Check build logs in Vercel dashboard

### Database Connection Issues
- Verify `DATABASE_URL` is set correctly in Vercel
- Ensure Neon database allows connections from Vercel IPs
- Check SSL settings match your Neon configuration

### API Routes Not Working
- Verify Next.js API routes are in `src/app/api/` directory
- Check that routes export proper HTTP methods (GET, POST, etc.)
- Review Vercel function logs

## Notes

- Vercel automatically detects Next.js and configures builds
- The `vercel.json` file is minimal - Vercel handles Next.js automatically
- Database migrations need to be run separately (not part of Vercel build)
- QZ Tray printing will only work locally (browser-based printing)
