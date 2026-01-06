# USAV Orders Backend

A Next.js application that combines Google Sheets embeds with a custom multi-user task management system for order processing workflows.

## Features

### Core Features
- **Navigation**: Easy navigation between different workflow pages
- **Dashboard**: Overview with KPI sidebar (no specific sheet tab)
- **Sheet Tab Routing**: Each page opens the specific Google Sheet tab automatically
- **Google Sheets Integration**: Full-width sheet embeds for real-time collaboration
- **Responsive Layout**: Optimized for warehouse workstations

### Task Management (v2.0)
- **Multi-User Support**: Each technician and packer has their own task list
- **Staff Management**: Add, activate/deactivate staff members with employee IDs
- **Custom Tags**: macOS-style tags with 7 colors (red, orange, yellow, green, blue, purple, gray)
- **Task Status Tracking**: Pending → In Progress → Completed workflow
- **Time Tracking**: Automatic tracking of when tasks start and complete
- **Duration Calculation**: Shows how long each task took to complete
- **Order Numbers**: Optional order number field for each task
- **Tracking Numbers**: Optional tracking number field for each task
- **Rich Editing**: Double-click to edit tasks with full details
- **Real-time Updates**: Changes sync instantly across all sessions

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

Run the setup script to initialize the database:

```bash
curl -X POST http://localhost:3000/api/setup-db
```

The application uses the following tables:

**`staff`** - Staff members
- `id` (SERIAL PRIMARY KEY)
- `name` (VARCHAR(100) NOT NULL)
- `role` (VARCHAR(50) NOT NULL) - 'technician' or 'packer'
- `employee_id` (VARCHAR(50) UNIQUE)
- `active` (BOOLEAN DEFAULT true)
- `created_at` (TIMESTAMP)

**`tags`** - Task tags with macOS-style colors
- `id` (SERIAL PRIMARY KEY)
- `name` (VARCHAR(50) NOT NULL UNIQUE)
- `color` (VARCHAR(20) NOT NULL) - red, orange, yellow, green, blue, purple, gray
- `created_at` (TIMESTAMP)

**`task_templates`** - Task templates
- `id` (SERIAL PRIMARY KEY)
- `title` (TEXT NOT NULL)
- `description` (TEXT)
- `role` (VARCHAR(50) NOT NULL)
- `order_number` (VARCHAR(100)) - Optional
- `tracking_number` (VARCHAR(100)) - Optional
- `created_by` (INTEGER) - Foreign key to staff
- `created_at` (TIMESTAMP)

**`task_tags`** - Many-to-many relationship
- `task_template_id` (INTEGER) - Foreign key to task_templates
- `tag_id` (INTEGER) - Foreign key to tags

**`daily_task_instances`** - Daily task completion tracking
- `id` (SERIAL PRIMARY KEY)
- `template_id` (INTEGER) - Foreign key to task_templates
- `staff_id` (INTEGER) - Foreign key to staff
- `task_date` (DATE NOT NULL)
- `status` (VARCHAR(20)) - 'pending', 'in_progress', 'completed'
- `started_at` (TIMESTAMP) - When work started
- `completed_at` (TIMESTAMP) - When completed
- `duration_minutes` (INTEGER) - Calculated duration
- `notes` (TEXT)
- `created_at` (TIMESTAMP)

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
| **Admin** | `/admin` | N/A (Staff & Tags Management) | No |
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

### Checklist (v2.0)
Advanced multi-user task management:
- **Staff Selection**: Choose which staff member is at the station
- **Task Status**: Click to cycle through Pending → In Progress → Completed
- **Time Tracking**: Automatically tracks start time and completion time
- **Duration Display**: Shows how long each task took
- **Tags**: Add multiple colored tags to tasks (macOS-style)
- **Order/Tracking Numbers**: Optional fields for order management
- **Edit Mode**: Double-click to edit all task details
- **Notes**: Add notes to task instances
- **Visual States**: 
  - Pending: Gray with white border
  - In Progress: Blue with pulsing animation
  - Completed: Green with strikethrough and timestamp
- All changes sync to Neon DB in real-time
- Separate task lists per staff member

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

## How the Task System Works

1. **Staff Management**:
   - Create staff members in the Admin panel
   - Each staff has a name, role, and employee ID
   - Staff can be activated/deactivated
   - Staff selection persists per station via localStorage

2. **Templates**: Master task list stored in `task_templates` table
   - One template per task type
   - Assigned to either 'technician' or 'packer' role
   - Can include order numbers and tracking numbers
   - Can have multiple tags

3. **Tags**: Organize and categorize tasks
   - Create custom tags in Admin panel
   - 7 macOS-style colors available
   - Multiple tags per task
   - Tags persist across all tasks

4. **Daily Instances**: Real-time tracking in `daily_task_instances` table
   - Created when staff member changes task status
   - Unique per (staff_id, template_id, task_date)
   - Tracks status, start time, completion time, duration
   - Stores optional notes per instance

5. **Task Lifecycle**:
   - **Pending**: Task is created but not started
   - **In Progress**: Staff clicks once - starts timer
   - **Completed**: Staff clicks again - stops timer, calculates duration
   - Can click again to reset to Pending

## Deployment

### Deploy to Vercel

```bash
vercel
```

Make sure to add your `DATABASE_URL` environment variable in the Vercel dashboard.

## Development Notes

- Home route (`/`) redirects to `/dashboard`
- Checklists are role and staff-specific
- Staff selection persists via localStorage per role
- Sidebar state (open/closed) persists during navigation
- All task operations use optimistic updates via TanStack Query
- Google Sheet changes save automatically to Google's servers
- Full-width iframe ensures sheet is not cut off
- Duration is calculated automatically when task completes
- Tags and staff management available at `/admin`

## API Routes

### Staff Management
- `GET /api/staff?role={role}&active={true|false}` - List staff
- `POST /api/staff` - Create staff
- `PUT /api/staff` - Update staff
- `DELETE /api/staff?id={id}` - Deactivate staff (soft delete)

### Tags Management
- `GET /api/tags` - List all tags
- `POST /api/tags` - Create tag
- `PUT /api/tags` - Update tag
- `DELETE /api/tags?id={id}` - Delete tag

### Task Tags
- `GET /api/task-tags?taskTemplateId={id}` - Get tags for task
- `POST /api/task-tags` - Add tag to task
- `DELETE /api/task-tags?taskTemplateId={id}&tagId={id}` - Remove tag from task

### Checklist
- `GET /api/checklist?role={role}&staffId={id}` - Get tasks with instances
- `POST /api/checklist/toggle` - Update task status
- `POST /api/checklist/template` - Create task template
- `PUT /api/checklist/template` - Update task template
- `DELETE /api/checklist/template?id={id}` - Delete task template

### Database Setup
- `POST /api/setup-db` - Run database migration

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **TanStack Query** - Data fetching and caching
- **PostgreSQL (Neon)** - Database for checklists
- **Google Sheets** - Collaborative data management
