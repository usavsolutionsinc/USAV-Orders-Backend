/**
 * Frame-quality gating invariants. Pure functions, so we synthesize ImageData-like
 * fixtures: a sharp checkerboard, a flat (blurry/featureless) field, a dark field,
 * and a shifted copy for motion. Guards the live-scan funnel: a regression here would
 * either flood the vision box with junk frames or starve it of good ones.
 */
import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import {
  toGray,
  meanLuma,
  sharpnessScore,
  motionScore,
  gateFrame,
  DEFAULT_GATE_THRESHOLDS,
  type ImageDataLike,
} from './frame-quality';

const W = 32;
const H = 32;

/** Build an RGBA ImageDataLike from a per-pixel grayscale function (0..255). */
function makeImage(fn: (x: number, y: number) => number, w = W, h = H): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const checkerboard = makeImage((x, y) => ((x + y) % 2 === 0 ? 255 : 0)); // max edges → sharp
const flatGray = makeImage(() => 128); // no edges → blurry
const dark = makeImage(() => 10);
const blownOut = makeImage(() => 252);

test('sharpness: high-frequency content scores far above a flat field', () => {
  const sharp = sharpnessScore(toGray(checkerboard), W, H);
  const flat = sharpnessScore(toGray(flatGray), W, H);
  ok(sharp > flat, `expected sharp(${sharp}) > flat(${flat})`);
  ok(sharp > DEFAULT_GATE_THRESHOLDS.sharpnessMin, 'checkerboard clears the sharpness floor');
  ok(flat < DEFAULT_GATE_THRESHOLDS.sharpnessMin, 'flat field is below the sharpness floor');
});

test('meanLuma reflects brightness', () => {
  strictEqual(Math.round(meanLuma(toGray(flatGray))), 128);
  ok(meanLuma(toGray(dark)) < DEFAULT_GATE_THRESHOLDS.lumaMin);
});

test('motion: NaN with no previous frame, ~0 for identical, large for a shift', () => {
  const a = toGray(checkerboard);
  ok(Number.isNaN(motionScore(null, a)), 'no prev ⇒ NaN');
  strictEqual(motionScore(a, a), 0, 'identical frames ⇒ no motion');
  // Shift the checkerboard by one pixel → every pixel flips → large diff.
  const shifted = toGray(makeImage((x, y) => ((x + 1 + y) % 2 === 0 ? 255 : 0)));
  ok(motionScore(a, shifted) > DEFAULT_GATE_THRESHOLDS.motionMax, 'one-pixel shift reads as motion');
});

test('gateFrame: a steady, sharp, well-lit frame passes', () => {
  const prev = toGray(checkerboard);
  const res = gateFrame(checkerboard, prev); // identical prev ⇒ motion 0
  strictEqual(res.ok, true);
  strictEqual(res.reason, 'ok');
});

test('gateFrame: rejects dark before anything else', () => {
  const res = gateFrame(dark, toGray(dark));
  strictEqual(res.ok, false);
  strictEqual(res.reason, 'dark');
});

test('gateFrame: rejects blown-out frames', () => {
  const res = gateFrame(blownOut, toGray(blownOut));
  strictEqual(res.reason, 'too-bright');
});

test('gateFrame: first frame (no prev) is treated as moving', () => {
  const res = gateFrame(checkerboard, null);
  strictEqual(res.ok, false);
  strictEqual(res.reason, 'moving');
});

test('gateFrame: sharp scene but moving is rejected as moving, not blurry', () => {
  const prev = toGray(makeImage((x, y) => ((x + 1 + y) % 2 === 0 ? 255 : 0)));
  const res = gateFrame(checkerboard, prev);
  strictEqual(res.ok, false);
  strictEqual(res.reason, 'moving');
});

test('gateFrame: steady but featureless frame is rejected as blurry', () => {
  const res = gateFrame(flatGray, toGray(flatGray));
  strictEqual(res.ok, false);
  strictEqual(res.reason, 'blurry');
});
