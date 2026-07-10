import { useEffect, useRef, useState } from 'react';
import { isValidHex, nextColor, PALETTE } from '../lib/colors';
import type { Category } from '@shared/types';

interface Props {
  existing: Category[];
  onClose: () => void;
  onCreated: (c: Category) => void;
}

export function NewCategoryDialog({ existing, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(() =>
    nextColor(existing.map((c) => c.color))
  );
  const [customMode, setCustomMode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    if (!isValidHex(color)) {
      setErr('Invalid color hex');
      return;
    }
    if (
      existing.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())
    ) {
      setErr('A category with this name already exists');
      return;
    }
    try {
      const created = await window.api.categories.create({
        name: name.trim(),
        color,
      });
      onCreated(created);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not create category');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15">
      <div
        className="popover w-[360px] p-4"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Enter') {
            e.stopPropagation();
            submit();
          }
        }}
      >
        <div className="text-sm font-medium mb-3">New category</div>
        <label className="block text-xs text-muted mb-1">Name</label>
        <input
          ref={nameRef}
          className="input-bare w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Deep work"
        />
        <div className="mt-3 flex items-baseline justify-between">
          <label className="text-xs text-muted">Color</label>
          <button
            className="text-xs text-muted hover:text-ink"
            onClick={() => setCustomMode((m) => !m)}
          >
            {customMode ? 'Use palette' : 'Custom hex…'}
          </button>
        </div>
        {customMode ? (
          <div className="mt-2 flex items-center gap-2">
            <span
              className="w-5 h-5 rounded-full border border-line shrink-0"
              style={{ backgroundColor: isValidHex(color) ? color : '#ddd' }}
            />
            <input
              className="input-bare flex-1 uppercase tracking-wider"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#A89F8A"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                title={c.name}
                onClick={() => setColor(c.hex)}
                className={`w-7 h-7 rounded-full border ${
                  color.toLowerCase() === c.hex.toLowerCase()
                    ? 'border-[var(--ink)]'
                    : 'border-line'
                }`}
                style={{ backgroundColor: c.hex }}
                aria-label={c.name}
              />
            ))}
          </div>
        )}
        {err && <div className="mt-3 text-xs text-[#A66E5C]">{err}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
