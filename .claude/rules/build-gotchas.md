# Build / dev gotchas

Silent-failure traps specific to this stack (Next 16, Turbopack dev, Tailwind). Summarized in root `CLAUDE.md`.

## tailwind.config.ts must import the z-index token with an explicit `.ts` extension

- `tailwind.config.ts` imports the z-index token (see `.claude/rules/source-of-truth.md`).
- The import **must** use an explicit `.ts` extension. Next 16 dev uses Turbopack, whose resolver won't guess `.ts`
  → it fails as a silent "Module not found" and **all `z-*` utilities are dropped in DEV only**.
- Production build (webpack/jiti) resolves fine, so this bug is invisible in CI/prod and only bites locally.
- Requires `allowImportingTsExtensions` in `tsconfig`.

## Tailwind content globs: a class used only in an un-scanned file renders invisible

- A Tailwind class referenced **only** inside a file not covered by the `content` globs (this bit us when logic moved
  into newer `src/lib` paths, e.g. `outbound-state.ts`) is silently not generated — no error, the style just doesn't apply.
- Prefer already-generated shades. If you must add a class in a new path, update `content`/`safelist`
  and **restart the dev server** (glob changes aren't picked up hot).
