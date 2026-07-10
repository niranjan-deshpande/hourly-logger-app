import { useEffect } from 'react';

export type ShortcutHandler = (
  e: KeyboardEvent
) => void | boolean | Promise<void | boolean>;

export interface ShortcutMap {
  [key: string]: ShortcutHandler;
}

function isTextField(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// Returns a canonical key string like "cmd+e", "n", "arrowleft", "1", "?".
// For symbol keys produced by Shift (?, !, @, etc.) the shift modifier is
// dropped because the resulting character already encodes that the user
// pressed Shift — that's how typists think about "?", not "shift+/".
export function keyOf(e: KeyboardEvent): string {
  const k = e.key.toLowerCase();
  const parts: string[] = [];
  if (e.metaKey) parts.push('cmd');
  if (e.ctrlKey && !e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  const isShiftedSymbol = e.shiftKey && k.length === 1 && !/[a-z0-9]/.test(k);
  if (e.shiftKey && !isShiftedSymbol) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}

export function useGlobalShortcuts(
  map: ShortcutMap,
  opts: { allowInTextFields?: string[] } = {}
) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = keyOf(e);
      const inText = isTextField(document.activeElement);
      if (inText && !(opts.allowInTextFields ?? []).includes(k)) {
        if (k !== 'escape' && k !== 'cmd+,' && k !== 'cmd+e') return;
      }
      const handler = map[k];
      if (handler) {
        const result = handler(e);
        if (result !== false) e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, opts.allowInTextFields]);
}
