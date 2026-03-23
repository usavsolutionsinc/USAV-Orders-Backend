'use client';

import type { ReactNode } from 'react';
import { SIDEBAR_INTAKE_LABEL_CLASS } from './intakeFormClasses';

export interface SidebarIntakeFormFieldProps {
  label: ReactNode;
  required?: boolean;
  optionalHint?: ReactNode;
  children: ReactNode;
  hintBelow?: ReactNode;
}

export function SidebarIntakeFormField({
  label,
  required,
  optionalHint,
  children,
  hintBelow,
}: SidebarIntakeFormFieldProps) {
  return (
    <div className="space-y-2">
      <label className={SIDEBAR_INTAKE_LABEL_CLASS}>
        {label}{' '}
        {required ? <span className="text-red-500">*</span> : null}
        {optionalHint != null ? <span className="text-gray-400"> {optionalHint}</span> : null}
      </label>
      {children}
      {hintBelow}
    </div>
  );
}
