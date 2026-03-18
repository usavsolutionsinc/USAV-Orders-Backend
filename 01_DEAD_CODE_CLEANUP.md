# 01 — Dead Code & Empty Wrapper Cleanup

---

## Goals

- Remove all unused imports, variables, functions, and components
- Eliminate empty wrapper components that add no logic or styling
- Remove commented-out code blocks that have been dormant > 30 days
- Prune unused Tailwind class strings and Framer Motion variants
- Establish tooling to prevent regression

---

## 1. Tooling Setup

### Install `knip` (dead code detector)

```bash
npm install --save-dev knip
```

### `knip.config.ts`

```ts
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main.tsx', 'src/App.tsx'],
  project: ['src/**/*.{ts,tsx}'],
  ignore: ['src/**/*.test.*', 'src/types/**'],
  ignoreDependencies: ['@types/*'],
};

export default config;
```

### Run audit

```bash
npx knip
# outputs: unused files, exports, types, dependencies
```

### Add to CI (GitHub Actions example)

```yaml
- name: Dead code check
  run: npx knip --reporter compact
```

---

## 2. Empty Wrapper Pattern — Identification & Removal

### ❌ Anti-pattern: Empty passthrough wrapper

```tsx
// components/Wrapper.tsx  — DELETE THIS
const Wrapper = ({ children }: { children: React.ReactNode }) => {
  return <div>{children}</div>;
};
```

### ❌ Anti-pattern: Fragment wrapper with no logic

```tsx
const Section = ({ children }: Props) => <>{children}</>;
```

### ✅ Replacement strategy

If the wrapper adds **no** className, no animation, no context, no logic — remove it and inline the child directly at the call site.

If it wraps a Framer Motion `<motion.div>` but the variant is never used, strip to plain `<div>`.

---

## 3. Unused Import Cleanup

### ESLint rule (add to `.eslintrc`)

```json
{
  "rules": {
    "no-unused-vars": ["error", { "varsIgnorePattern": "^_" }],
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
  }
}
```

### Install plugin

```bash
npm install --save-dev eslint-plugin-unused-imports
```

### Auto-fix

```bash
npx eslint src --fix
```

---

## 4. Unused Framer Motion Variants

### Pattern to search for

```bash
# Find variant objects that are defined but never referenced in animate/initial/exit
grep -rn "variants=" src/ | awk '{print $1}' | sort | uniq
```

Manually audit each `variants` object. Remove any `initial`, `animate`, or `exit` keys that are defined in a variants object but not referenced in the corresponding `<motion.*>` component.

### ❌ Dead variant example

```tsx
const variants = {
  hidden: { opacity: 0 },       // used
  visible: { opacity: 1 },      // used
  slideLeft: { x: -100 },       // NEVER referenced — DELETE
};
```

---

## 5. Commented-Out Code Policy

**Rule:** Commented-out code older than 30 days must be deleted, not kept.

Use this grep to find blocks:

```bash
grep -rn "// " src/ | grep -v "TODO\|FIXME\|NOTE\|HACK\|eslint" | wc -l
```

For large blocks:

```bash
grep -rn -A 3 "/\*" src/ --include="*.tsx"
```

Remove all multi-line commented blocks that are not explanatory documentation.

---

## 6. Tailwind Purge Audit

Ensure `tailwind.config.ts` content array covers all file types:

```ts
content: [
  './src/**/*.{js,ts,jsx,tsx}',
  './index.html',
],
```

Run the Tailwind build to confirm unused classes are purged in production. Do **not** use `safelist` unless absolutely required for dynamic class generation.

For dynamic classes, use a lookup object instead of string interpolation:

```tsx
// ❌ Bad — Tailwind can't statically analyse this
const cls = `text-${color}-500`;

// ✅ Good — static strings, Tailwind can purge correctly
const colorMap = {
  red: 'text-red-500',
  blue: 'text-blue-500',
};
const cls = colorMap[color];
```

---

## 7. Checklist

- [ ] `knip` installed and configured
- [ ] `knip` added to CI pipeline
- [ ] `eslint-plugin-unused-imports` installed and enabled
- [ ] All empty passthrough wrappers removed
- [ ] All unused Framer Motion variants removed
- [ ] All commented-out code blocks > 30 days deleted
- [ ] Tailwind content array verified
- [ ] Dynamic class string interpolation replaced with maps
- [ ] Full `knip` run returns zero unused exports
