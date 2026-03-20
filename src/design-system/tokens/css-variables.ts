import { motionDurations, motionEasings } from '../foundations/motion';
import { borderStyles, borderWidths } from './borders';
import { baseColors, semanticColors } from './colors';
import { radii } from './radii';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { fontFamilies } from './typography/families';
import { fontSizes, letterSpacings, lineHeights } from './typography/sizes';
import { fontWeights } from './typography/weights';
import { zIndex } from './z-index';

type FlattenableTokenTree = Record<string, unknown>;

const designSystemTokenTree = {
  color: {
    base: baseColors,
    semantic: semanticColors,
  },
  typography: {
    family: fontFamilies,
    size: fontSizes,
    weight: fontWeights,
    lineHeight: lineHeights,
    letterSpacing: letterSpacings,
  },
  spacing,
  radius: radii,
  border: {
    width: borderWidths,
    style: borderStyles,
  },
  shadow: shadows,
  motion: {
    duration: motionDurations,
    easing: motionEasings,
  },
  zIndex,
} as const;

function flattenTokenTree(source: FlattenableTokenTree, path: string[] = []): Record<string, string> {
  return Object.entries(source).reduce<Record<string, string>>((accumulator, [key, value]) => {
    const nextPath = [...path, key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(accumulator, flattenTokenTree(value as FlattenableTokenTree, nextPath));
      return accumulator;
    }
    accumulator[`--ds-${nextPath.join('-')}`] = String(value);
    return accumulator;
  }, {});
}

export const designSystemCssVariables = flattenTokenTree(designSystemTokenTree as FlattenableTokenTree);

export const designSystemTokenStyleText = `:root {\n${Object.entries(designSystemCssVariables)
  .map(([name, value]) => `  ${name}: ${value};`)
  .join('\n')}\n}`;

export type DesignSystemCssVariables = typeof designSystemCssVariables;
