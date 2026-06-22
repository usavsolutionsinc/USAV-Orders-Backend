/**
 * Station scan bar — master module.
 *
 * Layers (outer → inner):
 *   1. {@link ThemedStationScanBar} — staff theme border + focus ring + right inset
 *   2. {@link StationScanBar} — input, icon slot, hotkey gear, sweep
 *   3. {@link ./tokens.ts} — padding, height, icon geometry (single knob)
 *
 * Domain wrappers (TestingScanBar, ReceivingUnboxScanBar, StationTesting) supply
 * mode lists + submit logic; they should not re-declare chrome classes.
 */

export { StationScanBar, type StationScanBarProps } from './StationScanBar';
export { ThemedStationScanBar, type ThemedStationScanBarProps } from './ThemedStationScanBar';
export { StationScanLeadingIcon } from './StationScanLeadingIcon';
export { StationScanModeRail, type StationScanModeDefinition } from './StationScanModeRail';
export * from './tokens';
