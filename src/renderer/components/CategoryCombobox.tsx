import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category } from '@shared/types';

interface Props {
  categories: Category[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onTabOut?: () => void;
}

export function CategoryCombobox({
  categories,
  value,
  onChange,
  placeholder = 'Pick category…',
  autoFocus,
  onTabOut,
}: Props) {
  const sel = categories.find((c) => c.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  // The visible wrapper is now keyboard-focusable (tabIndex=0). The
  // input ref is for the search box that appears once the dropdown is
  // open. Two refs because we want Tab navigation to land on the
  // wrapper directly — pressing a number there picks a category
  // without needing to open the dropdown first.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // autoFocus now lands on the WRAPPER, not the input. That input
  // doesn't exist until the dropdown is open, so the previous
  // implementation was a no-op. Focusing the wrapper means the user
  // can immediately press a number key (1–9) to pick a category, or
  // press Enter to open the dropdown for search.
  useEffect(() => {
    if (autoFocus) wrapperRef.current?.focus();
  }, [autoFocus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function commit(id: number) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={ref} className="relative">
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="input-bare w-full flex items-center gap-2 cursor-text focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)] focus-visible:outline-offset-[1px]"
        onClick={() => {
          setOpen(true);
          // The input isn't mounted until after this render. Defer the
          // focus call so it actually lands.
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onKeyDown={(e) => {
          // When the dropdown is open and focus has moved to the input,
          // the input's onKeyDown handles everything. Only the wrapper-
          // closed case needs handling here.
          if (open) return;
          if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
            // Direct pick — no need to open the dropdown. The label
            // shown next to each row in the dropdown matches: pressing
            // 3 picks the 3rd category in the list.
            const idx = parseInt(e.key, 10) - 1;
            if (categories[idx]) {
              e.preventDefault();
              e.stopPropagation();
              commit(categories[idx].id);
            }
          } else if (
            e.key === 'Enter' ||
            e.key === ' ' ||
            e.key === 'ArrowDown'
          ) {
            // Open the dropdown for search / arrow navigation. Stop
            // propagation so a parent's Enter-to-save handler doesn't
            // also fire.
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
      >
        {sel && !open && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: sel.color }}
          />
        )}
        {open ? (
          <input
            ref={inputRef}
            className="bg-transparent outline-none flex-1 min-w-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={sel ? sel.name : placeholder}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const c = filtered[activeIdx];
                if (c) commit(c.id);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              } else if (e.key === 'Tab' && onTabOut) {
                onTabOut();
              } else if (/^[1-9]$/.test(e.key) && query === '') {
                // Number keys pick the Nth filtered result, but only when
                // the search box is empty so typing "1:30" still works.
                const idx = parseInt(e.key, 10) - 1;
                if (filtered[idx]) {
                  e.preventDefault();
                  e.stopPropagation();
                  commit(filtered[idx].id);
                }
              }
            }}
          />
        ) : sel ? (
          <span className="flex-1 truncate text-sm">{sel.name}</span>
        ) : (
          <span className="flex-1 text-sm text-faint">{placeholder}</span>
        )}
        {sel && open && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: sel.color }}
          />
        )}
      </div>
      {open && (
        <div className="popover absolute z-40 left-0 right-0 mt-1 max-h-[220px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-faint">No matches</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                i === activeIdx ? 'bg-[var(--hover)]' : ''
              }`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => commit(c.id)}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: c.color }}
              />
              <span className="truncate flex-1">{c.name}</span>
              {i < 9 && (
                <span className="text-[10px] text-faint tabular-nums">{i + 1}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
