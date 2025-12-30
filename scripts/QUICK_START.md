# Quick Start: Run Migrations with Vercel DATABASE_URL

Since your `DATABASE_URL` is stored in Vercel dashboard, here's how to run migrations:

## Option 1: Pass DATABASE_URL Directly (Easiest)

1. **Get DATABASE_URL from Vercel:**
   - Go to Vercel Dashboard
   - Select your project
   - Go to Settings > Environment Variables
   - Copy the `DATABASE_URL` value

2. **Run migrations with the URL:**
   ```bash
   cd USAV-Orders-Backend
   DATABASE_URL='postgresql://user:password@host.neon.tech/dbname?sslmode=require' python3 scripts/run_migrations_with_env.py
   ```

## Option 2: Use Vercel CLI (If Installed)

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Login and pull environment variables:**
   ```bash
   cd USAV-Orders-Backend
   vercel login
   vercel env pull .env.local
   ```

3. **Run migrations:**
   ```bash
   python3 scripts/run_all_migrations.py
   ```

## Option 3: Create Local .env.local

1. **Create `.env.local` file:**
   ```bash
   cd USAV-Orders-Backend
   echo 'DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require' > .env.local
   ```

2. **Run migrations:**
   ```bash
   python3 scripts/run_all_migrations.py
   ```

## What Gets Created

The migrations will create:
- ✅ `orders` - Main orders table
- ✅ `shipped` - Shipped orders
- ✅ `receiving` - Receiving items
- ✅ `sku_stock` - SKU inventory
- ✅ `technician_logs` - Technician activity logs
- ✅ `packer_logs` - Packer activity logs
- ✅ `receiving_logs` - Receiving logs
- ✅ `skus` - SKU information
- ✅ `task_templates` - Daily task templates
- ✅ `daily_task_instances` - Daily task tracking
- ✅ `tech_0`, `tech_1`, `tech_2` - Technician tables
- ✅ `Packer_0`, `Packer_1` - Packer tables

## Troubleshooting

### "DATABASE_URL not set"
Use Option 1 above to pass it directly.

### "Module not found: psycopg2"
```bash
pip3 install --user psycopg2-binary python-dotenv
```

### Connection errors
- Verify DATABASE_URL is correct
- Check Neon database is accessible
- Ensure SSL is enabled (`?sslmode=require`)
