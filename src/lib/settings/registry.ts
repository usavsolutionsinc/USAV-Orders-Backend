/**
 * Settings Registry — the single source of truth for configurable behavior.
 *
 * Modeled on src/lib/auth/permission-registry.ts: one flat array; storage,
 * validation, UI, plan gating, and audit are all derived from it. Add a setting
 * by adding a row here (+ a typed accessor in ./accessors.ts if server code
 * reads it). No migration is needed — values live as flat namespaced keys in the
 * existing organizations.settings / staff_preferences.prefs JSONB bags.
 *
 * See docs/settings-registry.md. Guard test: ./registry.test.ts.
 */

import { z } from 'zod';
import type { SettingDef, SettingPage } from './types';

export const SETTING_PAGES = [
  { id: 'receiving', label: 'Receiving', description: 'Unboxing & intake behavior' },
] as const satisfies readonly { id: SettingPage; label: string; description: string }[];

export const SETTINGS: readonly SettingDef[] = [
  // ─── Organization · Photos ──────────────────────────────────────────────
  {
    key: 'receiving.photoPolicy',
    page: 'receiving',
    group: 'Photos',
    scope: 'org',
    label: 'Photo requirement',
    description: 'Whether unboxing photos are required before a line can be marked received.',
    control: 'segmented',
    schema: z.enum(['optional', 'require_one', 'require_per_item']).default('optional'),
    options: [
      { value: 'optional', label: 'Optional', hint: 'Photos never block.' },
      { value: 'require_one', label: 'Require one', hint: 'At least one photo per carton.' },
      { value: 'require_per_item', label: 'Per item', hint: 'A photo for every line.' },
    ],
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.nasBackup',
    page: 'receiving',
    group: 'Photos',
    scope: 'org',
    label: 'NAS backup',
    description: 'How receiving photos are archived to the office NAS.',
    control: 'segmented',
    schema: z.enum(['off', 'mirror', 'direct']).default('mirror'),
    options: [
      { value: 'off', label: 'Off', hint: 'No NAS copy.' },
      { value: 'mirror', label: 'Mirror', hint: 'Background copy from cloud storage.' },
      { value: 'direct', label: 'Direct', hint: 'Browser writes straight to the NAS.' },
    ],
    optionEntitlements: { direct: 'nasArchive' },
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.autoPushPhoneCamera',
    page: 'receiving',
    group: 'Photos',
    scope: 'org',
    personalizable: true,
    label: 'Open phone camera on scan',
    description: 'When a tracking scan matches, auto-open the paired phone camera for photos.',
    control: 'toggle',
    schema: z.boolean().default(true),
    permission: 'admin.manage_features',
  },

  // ─── Organization · Claims ──────────────────────────────────────────────
  {
    key: 'receiving.autoTicket',
    page: 'receiving',
    group: 'Claims',
    scope: 'org',
    label: 'Auto-create support ticket',
    description: 'Automatically open a Zendesk claim on certain receiving outcomes.',
    control: 'segmented',
    schema: z.enum(['off', 'on_qa_fail', 'on_unfound']).default('off'),
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on_qa_fail', label: 'On QA fail' },
      { value: 'on_unfound', label: 'On unfound' },
    ],
    entitlement: 'automations',
    permission: 'admin.manage_features',
    comingSoon: true,
  },

  // ─── Organization · Putaway / Labels / Safety ───────────────────────────
  {
    key: 'receiving.defaultPutawayBin',
    page: 'receiving',
    group: 'Putaway',
    scope: 'org',
    label: 'Default putaway bin',
    description: 'Bin barcode used when a unit is received without a scanned destination.',
    control: 'text',
    schema: z.string().trim().min(1).max(64).default('UNSORTED'),
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.autoPrintLabel',
    page: 'receiving',
    group: 'Labels',
    scope: 'org',
    label: 'Auto-print label on receive',
    description: 'Print the internal label automatically when a line is marked received.',
    control: 'toggle',
    schema: z.boolean().default(false),
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.confirmSerialRemoval',
    page: 'receiving',
    group: 'Safety',
    scope: 'org',
    label: 'Confirm before removing a serial',
    description: 'Show a confirmation prompt when an operator deletes a scanned serial.',
    control: 'toggle',
    schema: z.boolean().default(true),
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.requireSerialConfirmation',
    page: 'receiving',
    group: 'Safety',
    scope: 'org',
    label: 'Require serial confirmation to receive',
    description:
      'Block Receive until the operator either captures a serial or explicitly marks the item as having no serial number.',
    control: 'toggle',
    schema: z.boolean().default(false),
    permission: 'admin.manage_features',
  },

  // ─── Organization · Vision (advanced, plan-gated) ───────────────────────
  {
    key: 'receiving.vision.consensusNeeded',
    page: 'receiving',
    group: 'Vision',
    scope: 'org',
    advanced: true,
    label: 'Label OCR consensus',
    description: 'How many matching reads lock a label scan.',
    control: 'number',
    schema: z.number().int().min(1).max(5).default(2),
    min: 1,
    max: 5,
    step: 1,
    unit: 'reads',
    entitlement: 'advancedVision',
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.vision.scanIntervalMs',
    page: 'receiving',
    group: 'Vision',
    scope: 'org',
    advanced: true,
    label: 'Label OCR scan interval',
    description: 'Delay between live label-scan frames.',
    control: 'number',
    schema: z.number().int().min(120).max(1000).default(280),
    min: 120,
    max: 1000,
    step: 20,
    unit: 'ms',
    entitlement: 'advancedVision',
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.vision.sendMaxDim',
    page: 'receiving',
    group: 'Vision',
    scope: 'org',
    advanced: true,
    label: 'Vision frame resolution',
    description: 'Max dimension of frames sent to the LAN vision box.',
    control: 'number',
    schema: z.number().int().min(640).max(2400).default(1600),
    min: 640,
    max: 2400,
    step: 80,
    unit: 'px',
    entitlement: 'advancedVision',
    permission: 'admin.manage_features',
  },

  // ─── Personal (+ org default) · Scanning ────────────────────────────────
  {
    key: 'receiving.defaultScanMode',
    page: 'receiving',
    group: 'Scanning',
    scope: 'org',
    personalizable: true,
    label: 'Default scan mode',
    description: 'Which mode the unbox scan bar arms on open.',
    control: 'segmented',
    schema: z.enum(['tracking', 'order']).default('tracking'),
    options: [
      { value: 'tracking', label: 'Tracking #' },
      { value: 'order', label: 'Order #' },
    ],
    permission: 'admin.manage_features',
  },
  {
    key: 'receiving.autoFocusSerial',
    page: 'receiving',
    group: 'Scanning',
    scope: 'staff',
    label: 'Auto-focus serial after scan',
    description: 'Move the cursor to the serial field as soon as a tracking scan resolves.',
    control: 'toggle',
    schema: z.boolean().default(true),
  },
  {
    key: 'receiving.autoAdvanceSerial',
    page: 'receiving',
    group: 'Scanning',
    scope: 'staff',
    label: 'Auto-advance to next serial',
    description: 'After a serial is entered, jump to the next empty slot.',
    control: 'toggle',
    schema: z.boolean().default(true),
  },

  // ─── Organization · Feedback ────────────────────────────────────────────
  {
    key: 'receiving.scanSoundsEnabled',
    page: 'receiving',
    group: 'Feedback',
    scope: 'org',
    label: 'Scan sounds',
    description: 'Master switch for scan confirmation tones across the org. Operators can still opt out individually.',
    control: 'toggle',
    schema: z.boolean().default(false),
    permission: 'admin.manage_features',
  },

  // ─── Personal · Feedback ────────────────────────────────────────────────
  {
    key: 'receiving.scanSound',
    page: 'receiving',
    group: 'Feedback',
    scope: 'staff',
    label: 'Scan sound',
    description: 'Play a confirmation tone on scan success and failure.',
    control: 'toggle',
    schema: z.boolean().default(true),
  },
  {
    key: 'receiving.scanHaptics',
    page: 'receiving',
    group: 'Feedback',
    scope: 'staff',
    label: 'Scan haptics',
    description: 'Vibrate on scan (supported devices only).',
    control: 'toggle',
    schema: z.boolean().default(false),
  },

  // ─── Personal · Layout ──────────────────────────────────────────────────
  {
    key: 'receiving.defaultLandingMode',
    page: 'receiving',
    group: 'Layout',
    scope: 'staff',
    label: 'Default landing mode',
    description: 'Which receiving mode opens first.',
    control: 'select',
    schema: z.enum(['receive', 'incoming', 'triage', 'pickup', 'history']).default('receive'),
    options: [
      { value: 'receive', label: 'Unbox' },
      { value: 'incoming', label: 'Incoming' },
      { value: 'triage', label: 'Triage' },
      { value: 'pickup', label: 'Local pickup' },
      { value: 'history', label: 'History' },
    ],
  },
  {
    key: 'receiving.accordionExpand',
    page: 'receiving',
    group: 'Layout',
    scope: 'staff',
    label: 'Carton lines on open',
    description: 'Expand just the active line or every line when a carton opens.',
    control: 'segmented',
    schema: z.enum(['active', 'all']).default('active'),
    options: [
      { value: 'active', label: 'Active only' },
      { value: 'all', label: 'Expand all' },
    ],
  },
];

const BY_KEY = new Map<string, SettingDef>(SETTINGS.map((s) => [s.key, s]));

export function settingByKey(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export function settingsForPage(page: SettingPage): SettingDef[] {
  return SETTINGS.filter((s) => s.page === page);
}

export function isSettingPage(raw: unknown): raw is SettingPage {
  return typeof raw === 'string' && SETTING_PAGES.some((p) => p.id === raw);
}
