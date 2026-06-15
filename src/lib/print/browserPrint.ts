/**
 * Browser-native silent printing — WebUSB / Web Serial — with named PROFILES.
 *
 * A workstation can pair several printers, each saved as a PrinterProfile with a
 * role (label / paper / receipt), a connection (usb / serial / os), a command
 * language (tspl / zpl / escpos / none), a paper size, and a copy count. Job
 * sites resolve a profile by role (`getProfileForRole('label')`) and never sniff
 * the device — the operator assigns roles once in Settings.
 *
 * Profiles persist per-origin/per-device in localStorage, which means they are
 * inherently per-workstation (a printer is wired to one PC). Chromium only; HTTPS
 * (or localhost) only — guard with `isBrowserPrintSupported()`.
 *
 * Connection kinds:
 *   - usb / serial → raw bytes (TSPL/ZPL/ESC-POS) straight to a thermal printer.
 *     Fully silent. This is the WebUSB / Web Serial path.
 *   - os → a regular OS/office printer. Browsers cannot silently drive these via
 *     WebUSB; callers fall back to the HTML print path (silent only in the
 *     desktop shell, dialog in a plain browser tab). Stored for size/name so the
 *     desktop preset and the dialog default line up.
 */

const PROFILES_KEY = 'usav.printerProfiles';
const LEGACY_SINGLE_KEY = 'usav.browserPrinter';

export type PrinterRole = 'label' | 'paper' | 'receipt';
export type PrinterKind = 'usb' | 'serial' | 'os';
export type LabelLanguage = 'tspl' | 'zpl' | 'escpos' | 'none';

export const PRINTER_ROLES: { id: PrinterRole; label: string; hint: string }[] = [
  { id: 'label', label: 'Labels', hint: 'Receiving + product labels (thermal)' },
  { id: 'paper', label: 'Paper / documents', hint: 'Pickup reports, full-page docs' },
  { id: 'receipt', label: 'Receipts', hint: '80mm receipt roll (ESC/POS)' },
];

export interface PaperSize {
  id: string;
  label: string;
  widthIn: number;
  /** 0 = continuous roll (receipt). */
  heightIn: number;
  /** Which connection kinds this size is offered for. */
  kinds: PrinterKind[];
}

/** Common stock to start with — extend as needed. */
export const PAPER_SIZES: PaperSize[] = [
  { id: '2x1', label: '2" × 1" label', widthIn: 2, heightIn: 1, kinds: ['usb', 'serial'] },
  { id: '3x1', label: '3" × 1" label', widthIn: 3, heightIn: 1, kinds: ['usb', 'serial'] },
  { id: '2.25x1.25', label: '2.25" × 1.25" Dymo', widthIn: 2.25, heightIn: 1.25, kinds: ['usb', 'serial'] },
  { id: '4x6', label: '4" × 6" shipping', widthIn: 4, heightIn: 6, kinds: ['usb', 'serial'] },
  { id: '80mm', label: '80mm receipt roll', widthIn: 3.15, heightIn: 0, kinds: ['usb', 'serial'] },
  { id: 'letter', label: 'Letter 8.5" × 11"', widthIn: 8.5, heightIn: 11, kinds: ['os'] },
  { id: 'a4', label: 'A4 210 × 297 mm', widthIn: 8.27, heightIn: 11.69, kinds: ['os'] },
];

export function resolvePaperSize(id: string): PaperSize {
  return PAPER_SIZES.find((p) => p.id === id) ?? PAPER_SIZES[0];
}

export interface PrinterProfile {
  id: string;
  /** Operator-facing name, e.g. "Front label printer". */
  name: string;
  role: PrinterRole;
  kind: PrinterKind;
  /** usb/serial only — device identity for re-acquiring the granted handle. */
  vendorId?: number;
  productId?: number;
  serialNumber?: string | null;
  /** os only — OS printer name (matches the Electron preset deviceName). */
  deviceName?: string | null;
  language: LabelLanguage;
  paperSizeId: string;
  baudRate?: number;
  copies: number;
}

interface ProfileStore {
  version: 2;
  profiles: PrinterProfile[];
  /** role → profile id. The default profile used for each job role. */
  routing: Partial<Record<PrinterRole, string>>;
}

const EMPTY_STORE: ProfileStore = { version: 2, profiles: [], routing: {} };

// --- Minimal WebUSB / Web Serial typings (not in the default TS DOM lib) ------
interface USBEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}
interface USBInterfaceLike {
  interfaceNumber: number;
  alternate: { endpoints: USBEndpointLike[] };
}
interface USBDeviceLike {
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  productName?: string | null;
  manufacturerName?: string | null;
  opened: boolean;
  configuration: { interfaces: USBInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface?(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<unknown>;
}
interface USBLike {
  requestDevice(options: { filters: unknown[] }): Promise<USBDeviceLike>;
  getDevices(): Promise<USBDeviceLike[]>;
}
interface SerialPortLike {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(d: Uint8Array): Promise<void>; releaseLock(): void } } | null;
}
interface SerialLike {
  requestPort(options?: unknown): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function usb(): USBLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { usb?: USBLike }).usb ?? null;
}
function serial(): SerialLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

export function isWebUsbSupported(): boolean {
  return !!usb();
}
export function isWebSerialSupported(): boolean {
  return !!serial();
}
export function isBrowserPrintSupported(): boolean {
  return isWebUsbSupported() || isWebSerialSupported();
}

function hex(n: number | undefined): string {
  return `0x${(n ?? 0).toString(16).padStart(4, '0')}`;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for older engines — uniqueness is per-device, low collision risk.
    return `p_${Math.abs(Math.floor(Math.random() * 1e9))}`;
  }
}

// --- Store -------------------------------------------------------------------
function readStore(): ProfileStore {
  if (typeof window === 'undefined') return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProfileStore;
      if (Array.isArray(parsed.profiles)) {
        return { version: 2, profiles: parsed.profiles, routing: parsed.routing ?? {} };
      }
    }
    // Migrate the v1 single-printer key into a one-profile label store.
    const legacy = window.localStorage.getItem(LEGACY_SINGLE_KEY);
    if (legacy) {
      const p = JSON.parse(legacy) as Partial<PrinterProfile> & { transport?: string };
      if (typeof p.vendorId === 'number') {
        const profile: PrinterProfile = {
          id: newId(),
          name: p.name || 'Label printer',
          role: 'label',
          kind: p.transport === 'serial' ? 'serial' : 'usb',
          vendorId: p.vendorId,
          productId: p.productId,
          serialNumber: p.serialNumber ?? null,
          language: (p.language as LabelLanguage) || 'tspl',
          paperSizeId: '2x1',
          baudRate: p.baudRate,
          copies: typeof p.copies === 'number' ? p.copies : 1,
        };
        const store: ProfileStore = { version: 2, profiles: [profile], routing: { label: profile.id } };
        writeStore(store);
        window.localStorage.removeItem(LEGACY_SINGLE_KEY);
        return store;
      }
    }
  } catch {
    /* fall through */
  }
  return EMPTY_STORE;
}

function writeStore(store: ProfileStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / private mode */
  }
}

export function listProfiles(): PrinterProfile[] {
  return readStore().profiles;
}

export function getProfile(id: string): PrinterProfile | null {
  return readStore().profiles.find((p) => p.id === id) ?? null;
}

export function getRouting(): Partial<Record<PrinterRole, string>> {
  return readStore().routing;
}

/** The profile to use for a job role: explicit routing, else first of that role. */
export function getProfileForRole(role: PrinterRole): PrinterProfile | null {
  const store = readStore();
  const routedId = store.routing[role];
  if (routedId) {
    const found = store.profiles.find((p) => p.id === routedId);
    if (found) return found;
  }
  return store.profiles.find((p) => p.role === role) ?? null;
}

/** Create or update a profile. Auto-routes its role to it if that role is unset. */
export function upsertProfile(profile: PrinterProfile): ProfileStore {
  const store = readStore();
  const idx = store.profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) store.profiles[idx] = profile;
  else store.profiles.push(profile);
  if (!store.routing[profile.role]) store.routing[profile.role] = profile.id;
  writeStore(store);
  return store;
}

export function deleteProfile(id: string): ProfileStore {
  const store = readStore();
  store.profiles = store.profiles.filter((p) => p.id !== id);
  for (const role of Object.keys(store.routing) as PrinterRole[]) {
    if (store.routing[role] === id) delete store.routing[role];
  }
  writeStore(store);
  return store;
}

export function setRoute(role: PrinterRole, profileId: string | null): ProfileStore {
  const store = readStore();
  if (profileId) store.routing[role] = profileId;
  else delete store.routing[role];
  writeStore(store);
  return store;
}

// --- Device selection (must be called from a user gesture) --------------------
export interface PairedDevice {
  kind: 'usb' | 'serial';
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  suggestedName: string;
}

export async function requestUsbDevice(): Promise<PairedDevice> {
  const u = usb();
  if (!u) throw new Error('WebUSB is not supported in this browser');
  const device = await u.requestDevice({ filters: [] });
  return {
    kind: 'usb',
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber ?? null,
    suggestedName:
      device.productName ||
      [device.manufacturerName, hex(device.vendorId)].filter(Boolean).join(' ') ||
      `USB ${hex(device.vendorId)}:${hex(device.productId)}`,
  };
}

export async function requestSerialDevice(): Promise<PairedDevice> {
  const s = serial();
  if (!s) throw new Error('Web Serial is not supported in this browser');
  const port = await s.requestPort();
  const info = port.getInfo();
  return {
    kind: 'serial',
    vendorId: info.usbVendorId ?? 0,
    productId: info.usbProductId ?? 0,
    serialNumber: null,
    suggestedName: info.usbVendorId != null ? `Serial ${hex(info.usbVendorId)}` : 'Serial printer',
  };
}

// --- Sending ------------------------------------------------------------------
function findBulkOut(device: USBDeviceLike): { interfaceNumber: number; endpointNumber: number } {
  const config = device.configuration;
  if (!config) throw new Error('USB device has no active configuration');
  for (const iface of config.interfaces) {
    const alt = iface.alternate;
    if (!alt) continue;
    for (const ep of alt.endpoints) {
      if (ep.direction === 'out' && ep.type === 'bulk') {
        return { interfaceNumber: iface.interfaceNumber, endpointNumber: ep.endpointNumber };
      }
    }
  }
  throw new Error('No bulk OUT endpoint on this device — it may not be a printer');
}

async function sendUsb(profile: PrinterProfile, bytes: Uint8Array): Promise<void> {
  const u = usb();
  if (!u) throw new Error('WebUSB is not supported in this browser');
  const devices = await u.getDevices();
  const device =
    devices.find(
      (d) =>
        d.vendorId === profile.vendorId &&
        d.productId === profile.productId &&
        (!profile.serialNumber || d.serialNumber === profile.serialNumber),
    ) ?? devices.find((d) => d.vendorId === profile.vendorId && d.productId === profile.productId);
  if (!device) {
    throw new Error('Printer not connected (or permission revoked) — re-pair it in Settings');
  }
  if (!device.opened) await device.open();
  if (device.configuration == null) await device.selectConfiguration(1);
  const { interfaceNumber, endpointNumber } = findBulkOut(device);
  await device.claimInterface(interfaceNumber);
  try {
    await device.transferOut(endpointNumber, bytes);
  } finally {
    try {
      await device.releaseInterface?.(interfaceNumber);
    } catch {
      /* best effort */
    }
  }
}

async function sendSerial(profile: PrinterProfile, bytes: Uint8Array): Promise<void> {
  const s = serial();
  if (!s) throw new Error('Web Serial is not supported in this browser');
  const ports = await s.getPorts();
  // A Bluetooth / SPP COM port reports no usbVendorId, so only match on it when
  // the port actually exposes one; otherwise fall back to the first (usually
  // only) granted port.
  const port =
    ports.find((p) => {
      const i = p.getInfo();
      return (
        i.usbVendorId != null &&
        i.usbVendorId === profile.vendorId &&
        i.usbProductId === profile.productId
      );
    }) ?? ports[0];
  if (!port) throw new Error('Serial port not available — re-pair it in Settings');
  // A prior print that didn't fully release leaves the port open; reopening
  // throws "The port is already open." Treat that as already-connected and
  // reuse it rather than failing the whole print.
  try {
    await port.open({ baudRate: profile.baudRate ?? 9600 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already open/i.test(msg)) throw err;
  }
  if (!port.writable) {
    try {
      await port.close();
    } catch {
      /* best effort */
    }
    throw new Error('Serial port is not writable');
  }
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    try {
      writer.releaseLock();
    } catch {
      /* best effort */
    }
    try {
      await port.close();
    } catch {
      /* best effort */
    }
  }
}

/**
 * Send raw command bytes to a thermal profile (usb/serial). Returns a result
 * object (never throws) so callers can fall back. `os` profiles are rejected —
 * office paper goes through the HTML print path, not raw bytes.
 */
export async function printRawToProfile(
  commands: string | Uint8Array,
  profile: PrinterProfile,
): Promise<{ success: boolean; reason: string | null }> {
  if (profile.kind === 'os') {
    return { success: false, reason: 'OS/paper profiles print via the document path, not raw' };
  }
  const bytes = typeof commands === 'string' ? new TextEncoder().encode(commands) : commands;
  try {
    if (profile.kind === 'serial') await sendSerial(profile, bytes);
    else await sendUsb(profile, bytes);
    return { success: true, reason: null };
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function profileSummary(p: PrinterProfile): string {
  if (p.kind === 'os') return `OS · ${p.deviceName || 'system default'}`;
  return `${p.kind === 'serial' ? 'Serial' : 'USB'} · ${hex(p.vendorId)}:${hex(p.productId)
    .replace(/^0x/, '')}`;
}

export { newId as newProfileId };
