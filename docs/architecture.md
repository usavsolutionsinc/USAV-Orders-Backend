# Frontend Architecture

## Goals
- Keep route files thin and predictable.
- Group feature-owned UI and logic together.
- Reserve shared folders for truly shared code.

## Folder Conventions
- `src/app/**`: route entrypoints (`page.tsx`, route metadata, route-level wiring only).
- `src/features/<feature>/**`: feature-owned components, hooks, types, and helpers.
- `src/components/ui/**`: shared presentational primitives used by multiple features.
- `src/lib/**`: cross-feature infrastructure (db, api clients, realtime, cache, etc.).

## Naming Conventions
- Use explicit feature names for feature components.
- Prefer `OperationsHeader` over generic names like `TopBar`.
- Export feature entrypoints from `src/features/<feature>/index.ts`.

## Import Rules
- Route files import from `@/features/<feature>` when possible.
- Feature code may import from `@/components/ui` and `@/lib`.
- Shared UI should not import from `@/features/*`.

## Migration Approach
1. Move one feature at a time.
2. Rename generic component names during move.
3. Add/update feature barrel export.
4. Update route imports.
5. Run typecheck and ship.
