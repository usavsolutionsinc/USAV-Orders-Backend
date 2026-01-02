# USAV Orders Backend

A Next.js application that combines Google Sheets embeds with a custom checklist management system for order processing workflows.

## Features

- **Navigation**: Easy navigation between different workflow pages
- **Dashboard**: Overview with KPI sidebar (no specific sheet tab)
- **Sheet Tab Routing**: Each page opens the specific Google Sheet tab automatically
- **Collapsible Sidebar**: KPI dashboard with mock data (ready for real implementation)
- **Editable Checklists**: Task management with double-click editing, stored in Neon DB
- **Google Sheets Integration**: Full-width sheet embeds for real-time collaboration
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

### 3. Database Schema

The application uses two existing tables:

**`task_templates`**
- `id` (SERIAL PRIMARY KEY)
- `title` (TEXT NOT NULL)
- `description` (TEXT)
- `role` (VARCHAR(50) NOT NULL) - 'technician' or 'packer'
- `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)

**`daily_task_instances`**
- `id` (SERIAL PRIMARY KEY)
- `template_id` (INTEGER) - Foreign key to task_templates
- `user_id` (VARCHAR(50) NOT NULL)
- `role` (VARCHAR(50) NOT NULL)
- `task_date` (DATE NOT NULL)
- `completed` (BOOLEAN DEFAULT false)
- `completed_at` (TIMESTAMP)
- `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - redirects to Dashboard

## Pages & Sheet Tabs

Each page opens a specific Google Sheet tab (gid):

| Page | Route | Sheet Tab | Checklist |
|------|-------|-----------|-----------|
| **Dashboard** | `/dashboard` | Default (no gid) | No |
| **Orders** | `/orders` | Orders (gid=719315456) | No |
| **Tech_1** | `/tech/1` | Tech_1 (gid=1309948852) | Yes |
| **Tech_2** | `/tech/2` | Tech_2 (gid=486128229) | Yes |
| **Tech_3** | `/tech/3` | Tech_3 (gid=1376429630) | Yes |
| **Packer_1** | `/packer/1` | Packer_1 (gid=0) | Yes |
| **Packer_2** | `/packer/2` | Packer_2 (gid=797238258) | Yes |
| **Shipped** | `/shipped` | Shipped (gid=316829503) | No |
| **Sku-Stock** | `/sku-stock` | Sku-Stock (gid=527136135) | No |
| **Sku** | `/sku` | Sku (gid=1817455143) | No |

## Components

### PageLayout
Reusable layout component that includes:
- Optional collapsible sidebar with KPI widgets
- Optional checklist section (for Tech/Packer stations)
- Full-width Google Sheet iframe with specific tab
- `showSidebar` prop to hide sidebar (Dashboard only shows sidebar + sheet)

### Checklist
Interactive task management component:
- Double-click any item to edit title and description
- Click checkbox to mark complete (shows timestamp)
- Add new tasks with the "Add Task" button
- Delete tasks with the trash icon
- All changes sync to Neon DB
- Separate checklists per role (technician/packer) and user ID

### Sidebar
Collapsible KPI dashboard with:
- Daily orders count
- Processing time metrics
- Stock items count
- Low stock alerts
- Weekly trend chart (mock data)

## Google Sheet Configuration

The embedded sheet uses these URL parameters for a clean view:
- `gid` - Specific sheet tab ID
- `rm=minimal` - Hides toolbar/title
- `single=true` - Shows only one sheet tab
- `widget=false` - Removes extra widgets

Sheet URL: https://docs.google.com/spreadsheets/d/1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE/edit

**Important**: The Google Sheet must be shared with "Anyone with the link can edit" for public editing.

## How Checklists Work

1. **Templates**: Master task list stored in `task_templates` table
   - One template per task type
   - Assigned to either 'technician' or 'packer' role

2. **Daily Instances**: Completion tracking in `daily_task_instances` table
   - Created when user checks/unchecks a task
   - Unique per (user_id, template_id, task_date)
   - Stores completion status and timestamp

3. **User IDs**: 
   - Tech stations use user_id: 1, 2, or 3
   - Packer stations use user_id: 1 or 2

## Deployment

### Deploy to Vercel

```bash
vercel
```

Make sure to add your `DATABASE_URL` environment variable in the Vercel dashboard.

## Development Notes

- Home route (`/`) redirects to `/dashboard`
- Checklists are role and user-specific
- Sidebar state (open/closed) persists during navigation
- All checklist operations use optimistic updates
- Google Sheet changes save automatically to Google's servers
- Full-width iframe ensures sheet is not cut off

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **TanStack Query** - Data fetching and caching
- **PostgreSQL (Neon)** - Database for checklists
- **Google Sheets** - Collaborative data management
