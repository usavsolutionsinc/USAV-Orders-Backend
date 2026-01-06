-- Enhanced Database Schema for Multi-User Task Management

-- Staff/Users Table
CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL, -- 'technician' or 'packer'
    employee_id VARCHAR(50) UNIQUE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tags Table (macOS-style tags with colors)
CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(20) NOT NULL, -- 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced Task Templates Table
CREATE TABLE IF NOT EXISTS task_templates (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    role VARCHAR(50) NOT NULL,
    order_number VARCHAR(100), -- Optional order number
    tracking_number VARCHAR(100), -- Optional tracking number
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL
);

-- Task-Tags Relationship (many-to-many)
CREATE TABLE IF NOT EXISTS task_tags (
    task_template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_template_id, tag_id)
);

-- Enhanced Daily Task Instances Table
CREATE TABLE IF NOT EXISTS daily_task_instances (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
    staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
    task_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed'
    started_at TIMESTAMP, -- When work started
    completed_at TIMESTAMP, -- When completed
    duration_minutes INTEGER, -- Calculated duration
    notes TEXT, -- Additional notes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(template_id, staff_id, task_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active);
CREATE INDEX IF NOT EXISTS idx_task_templates_role ON task_templates(role);
CREATE INDEX IF NOT EXISTS idx_daily_instances_date ON daily_task_instances(task_date);
CREATE INDEX IF NOT EXISTS idx_daily_instances_staff ON daily_task_instances(staff_id);
CREATE INDEX IF NOT EXISTS idx_daily_instances_status ON daily_task_instances(status);

-- Default Tags (macOS-style)
INSERT INTO tags (name, color) VALUES
    ('Urgent', 'red'),
    ('Important', 'orange'),
    ('Follow Up', 'yellow'),
    ('In Review', 'green'),
    ('Ready', 'blue'),
    ('Waiting', 'purple'),
    ('Archive', 'gray')
ON CONFLICT (name) DO NOTHING;

-- Sample Staff (Tech 1-3, Packer 1-2)
INSERT INTO staff (name, role, employee_id) VALUES
    ('Tech Station 1', 'technician', 'TECH001'),
    ('Tech Station 2', 'technician', 'TECH002'),
    ('Tech Station 3', 'technician', 'TECH003'),
    ('Packer Station 1', 'packer', 'PACK001'),
    ('Packer Station 2', 'packer', 'PACK002')
ON CONFLICT (employee_id) DO NOTHING;

-- Migration: Link existing data
-- Update daily_task_instances to use staff_id instead of user_id (if user_id column exists)
-- This will be handled by the migration script

