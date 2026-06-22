export interface RoleDetail {
  role: {
    id: number;
    key: string;
    label: string;
    color: string;
    position: number;
    permissions: string[];
    is_system: boolean;
    mobile_defaults: unknown;
    created_at: string;
    updated_at: string;
    member_count: number;
  };
  members: Array<{
    id: number;
    name: string;
    role: string;
    status: string;
    granted_at: string;
    granted_by: number | null;
  }>;
}

export interface StaffPickerRow {
  id: number;
  name: string;
  role: string;
  status: string;
}

export interface AuditEntry {
  id: number;
  event: string;
  result: string;
  created_at: string;
  detail: Record<string, unknown>;
}

export interface RoleEditorProps {
  roleId: number;
}
