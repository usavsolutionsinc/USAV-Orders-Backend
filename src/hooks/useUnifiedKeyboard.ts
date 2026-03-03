import { useCallback, useState } from 'react';

export type UnifiedKeyboardTarget = string | number | null;

type UseUnifiedKeyboardOptions = {
  initialValue?: string;
  onSubmit?: (value: string, target: UnifiedKeyboardTarget) => void | Promise<void>;
};

export function useUnifiedKeyboard(options: UseUnifiedKeyboardOptions = {}) {
  const { initialValue = '', onSubmit } = options;
  const [target, setTarget] = useState<UnifiedKeyboardTarget>(null);
  const [value, setValue] = useState(initialValue);

  const openKeyboard = useCallback((nextTarget: UnifiedKeyboardTarget, nextValue = '') => {
    setTarget(nextTarget);
    setValue(nextValue);
  }, []);

  const closeKeyboard = useCallback(() => {
    setTarget(null);
    setValue(initialValue);
  }, [initialValue]);

  const submitKeyboard = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || !onSubmit) return;
    await onSubmit(trimmed, target);
    closeKeyboard();
  }, [closeKeyboard, onSubmit, target, value]);

  return {
    keyboardTarget: target,
    keyboardValue: value,
    setKeyboardValue: setValue,
    isKeyboardOpen: target !== null,
    openKeyboard,
    closeKeyboard,
    submitKeyboard,
  };
}
