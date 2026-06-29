// Icons.tsx — the nav-icon source of truth (memory: icon-system-and-duplicate-glyphs).
//
// Thin barrel: the glyphs are grouped into category modules under ./icons/* and
// re-exported here verbatim, so every `import { X } from '@/components/Icons'`
// keeps resolving identically. Add a new glyph to the matching ./icons/* module
// (never duplicate a name across modules — `export *` would collide).
export * from './icons/arrows';
export * from './icons/actions';
export * from './icons/status';
export * from './icons/media';
export * from './icons/commerce';
export * from './icons/nav';
export * from './icons/voice';
