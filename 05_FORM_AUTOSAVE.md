# 05 — Form Auto-Save: localStorage + Async DB Sync

---

## Goals

- Every form persists its state to `localStorage` on every `onChange` (zero data loss)
- Async DB writes are fire-and-forget with retry, never blocking the UI
- Forms restore their draft on mount (survive page refresh)
- Forms clear their localStorage draft on successful submit
- Provide a single `useAutoSaveForm` hook that handles everything

---

## 1. `useAutoSaveForm` Hook

**Location:** `src/hooks/_form.ts`

```ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from './_storage';
import { retry, safeAwait } from '@/utils';

interface UseAutoSaveFormOptions<T extends Record<string, unknown>> {
  /** Unique key for localStorage draft (e.g. 'new-post-form', 'profile-edit:42') */
  storageKey: string;
  /** Initial form values (used only if no draft exists) */
  initialValues: T;
  /** Async function that persists data to the backend */
  onSave: (values: T) => Promise<unknown>;
  /** Called after a FINAL submit (clears draft) */
  onSubmit?: (values: T) => Promise<unknown>;
  /** Debounce delay for async saves in ms. Default: 1500 */
  saveDebounceMs?: number;
}

interface UseAutoSaveFormReturn<T> {
  values: T;
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  setValues: (values: Partial<T>) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  saveError: Error | null;
  clearDraft: () => void;
}

export function useAutoSaveForm<T extends Record<string, unknown>>({
  storageKey,
  initialValues,
  onSave,
  onSubmit,
  saveDebounceMs = 1500,
}: UseAutoSaveFormOptions<T>): UseAutoSaveFormReturn<T> {
  const [draft, setDraft, clearDraft] = useLocalStorage<T>(storageKey, initialValues);
  const [values, setValuesState] = useState<T>(draft ?? initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const latestValues = useRef(values);
  latestValues.current = values;

  // Restore draft on mount
  useEffect(() => {
    if (draft) setValuesState(draft);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Persist to localStorage + schedule async DB write */
  const persist = useCallback((nextValues: T) => {
    // 1. Instant localStorage write
    setDraft(nextValues);
    setIsDirty(true);

    // 2. Debounced async DB write
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setIsSaving(true);
      setSaveError(null);
      const [, err] = await safeAwait(
        retry(() => onSave(latestValues.current), 3, 500),
      );
      if (err) setSaveError(err);
      setIsSaving(false);
    }, saveDebounceMs);
  }, [setDraft, onSave, saveDebounceMs]);

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValuesState(prev => {
      const next = { ...prev, [field]: value };
      persist(next);
      return next;
    });
  }, [persist]);

  const setValues = useCallback((partial: Partial<T>) => {
    setValuesState(prev => {
      const next = { ...prev, ...partial };
      persist(next);
      return next;
    });
  }, [persist]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    clearTimeout(saveTimer.current);

    // Final save
    if (onSubmit) {
      setIsSaving(true);
      const [, err] = await safeAwait(retry(() => onSubmit(latestValues.current), 3, 500));
      setIsSaving(false);
      if (err) { setSaveError(err); return; }
    }

    // Clear draft on success
    clearDraft();
    setIsDirty(false);
  }, [onSubmit, clearDraft]);

  return {
    values,
    setField,
    setValues,
    handleSubmit,
    isDirty,
    isSaving,
    saveError,
    clearDraft,
  };
}
```

---

## 2. Usage in a Component

```tsx
import { useAutoSaveForm } from '@/hooks';
import { savePostDraft, publishPost } from '@/api/posts';

interface PostForm {
  title: string;
  body: string;
  tags: string[];
}

function NewPostForm() {
  const {
    values,
    setField,
    handleSubmit,
    isDirty,
    isSaving,
    saveError,
    clearDraft,
  } = useAutoSaveForm<PostForm>({
    storageKey: 'new-post-draft',
    initialValues: { title: '', body: '', tags: [] },
    onSave: savePostDraft,      // called automatically on each change (debounced)
    onSubmit: publishPost,       // called only when user clicks Publish
    saveDebounceMs: 1500,
  });

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={values.title}
        onChange={e => setField('title', e.target.value)}
        placeholder="Title"
      />
      <textarea
        value={values.body}
        onChange={e => setField('body', e.target.value)}
        placeholder="Write something..."
      />

      {/* Status indicators */}
      <div className="text-sm text-gray-400">
        {isSaving && <span>Saving draft…</span>}
        {!isSaving && isDirty && <span>Draft saved</span>}
        {saveError && <span className="text-red-400">Save failed — will retry</span>}
      </div>

      <button type="button" onClick={clearDraft}>Discard draft</button>
      <button type="submit">Publish</button>
    </form>
  );
}
```

---

## 3. ID-Scoped Storage Keys

For edit forms (existing entities), scope the key to the entity ID to avoid cross-record conflicts:

```ts
// Editing post with id = 42
storageKey: `edit-post-draft:42`

// Editing user profile
storageKey: `edit-profile-draft:${userId}`
```

---

## 4. Window `beforeunload` Warning

Add to `useAutoSaveForm` or as a standalone hook for forms with unsaved changes:

```ts
// In _form.ts
export function useUnsavedWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
```

Usage:

```tsx
const { isDirty, ...form } = useAutoSaveForm({ ... });
useUnsavedWarning(isDirty);
```

---

## 5. LocalStorage Key Management

Maintain a central registry to prevent key collisions:

**`src/lib/storageKeys.ts`**

```ts
export const STORAGE_KEYS = {
  // Form drafts
  NEW_POST_DRAFT: 'new-post-draft',
  editPostDraft: (id: string | number) => `edit-post-draft:${id}`,
  editProfileDraft: (id: string | number) => `edit-profile-draft:${id}`,
  newCommentDraft: (postId: string | number) => `new-comment-draft:${postId}`,

  // App preferences
  THEME: 'app-theme',
  SIDEBAR_COLLAPSED: 'sidebar-collapsed',
} as const;
```

---

## 6. Async Save Architecture

```
User types
    │
    ▼
setField() called
    │
    ├──► localStorage.setItem() ← INSTANT (synchronous)
    │    (UI always has latest state)
    │
    └──► setTimeout (debounced 1500ms)
              │
              ▼ (after user stops typing)
         onSave(values) ← async API call
              │
         retry(3) with exponential backoff
              │
         ┌───┴───┐
         │ OK    │ Error
         │       └──► setSaveError (UI shows retry indicator)
         └──► isSaving = false
```

---

## 7. Checklist

- [ ] `useAutoSaveForm` hook created in `src/hooks/_form.ts`
- [ ] `useUnsavedWarning` hook created
- [ ] `src/lib/storageKeys.ts` created with all keys registered
- [ ] All existing forms migrated to `useAutoSaveForm`
- [ ] Forms with entity IDs use scoped storage keys
- [ ] `beforeunload` warning active on all edit forms
- [ ] `saveError` state surfaces in UI on all forms
- [ ] localStorage draft clears on successful submit
- [ ] Draft restore on mount verified for all forms
