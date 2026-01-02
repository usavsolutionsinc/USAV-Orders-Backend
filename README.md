# USAV Orders Backend

A Next.js application that combines Google Sheets embeds with a custom checklist management system for order processing workflows.

## Features

- **Navigation**: Easy navigation between different workflow pages (Orders, Tech stations, Packer stations, Shipped, SKU management)
- **Collapsible Sidebar**: KPI dashboard with mock data (ready for real implementation)
- **Editable Checklists**: Task management with double-click editing, stored in Neon DB
- **Google Sheets Integration**: Each page embeds the shared Google Sheet for real-time collaboration
- **Responsive Layout**: Optimized for warehouse workstations

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Database

Create a `.env` file in the root directory:

```env
DATABASE_URL=postgresql://username:password@host:5432/database?sslmode=require
```

Replace with your Neon DB connection string.

### 3. Initialize Database

The database table will be automatically created. To manually trigger setup:

```bash
curl -X POST http://localhost:3000/api/setup-db
```

This creates the `checklist_items` table with the following schema:
- `id`: Serial primary key
- `page_id`: String identifier for the page (e.g., "tech_1", "packer_2")
- `title`: Task title
- `description`: Optional task description
- `is_completed`: Boolean completion status
- `completed_at`: Timestamp when task was completed
- `order_index`: For custom ordering
- `created_at`: Creation timestamp

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Pages

- **/** - Home/Dashboard
- **/orders** - Orders overview with Google Sheet
- **/tech/1, /tech/2, /tech/3** - Technician workstations with checklists
- **/packer/1, /packer/2** - Packer workstations with checklists
- **/shipped** - Shipped orders tracking
- **/sku-stock** - Stock inventory management
- **/sku** - SKU database

## Components

### PageLayout
Reusable layout component that includes:
- Collapsible sidebar with KPI widgets
- Optional checklist section
- Google Sheet iframe taking remaining height

### Checklist
Interactive task management component:
- Double-click any item to edit title and description
- Click checkbox to mark complete (shows timestamp)
- Add new tasks with the "Add Task" button
- Delete tasks with the trash icon
- All changes sync to Neon DB

### Sidebar
Collapsible KPI dashboard with:
- Daily orders count
- Processing time metrics
- Stock items count
- Low stock alerts
- Weekly trend chart (mock data)

## Google Sheet Configuration

The embedded sheet is configured with these URL parameters for a clean view:
- `rm=minimal` - Hides toolbar/title
- `single=true` - Shows only one sheet tab
- `widget=false` - Removes extra widgets
- `headers=false` - Hides row/column headers

To change the embedded sheet, update the `sheetId` prop in each page component.

**Important**: The Google Sheet must be shared with "Anyone with the link can edit" for public editing.

## Deployment

### Deploy to Vercel

```bash
vercel
```

Make sure to add your `DATABASE_URL` environment variable in the Vercel dashboard.

## Development Notes

- Checklists are page-specific (each Tech/Packer station has its own list)
- Sidebar state (open/closed) persists during navigation
- All checklist operations are optimistic for better UX
- Google Sheet changes save automatically to Google's servers

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **TanStack Query** - Data fetching and caching
- **PostgreSQL (Neon)** - Database for checklists
- **Google Sheets** - Collaborative data management
