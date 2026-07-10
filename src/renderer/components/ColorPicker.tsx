import { useEffect, useRef, useState } from 'react';
import { isValidHex, PALETTE } from '../lib/colors';

interface Props {
  value: string;
  onPick: (hex: string) => void;
  onClose: () => void;
  anchor?: 'center' | 'left';
}

export function ColorPicker({ value, onPick, onClose, anchor = 'left' }: Props) {
  const [custom, setCustom] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const valid = isValidHex(custom);

  return (
    <div
      ref={ref}
      className={`popover absolute z-40 p-3 w-[220px] ${
        anchor === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-2'
      } top-9`}
    >
      <div className="grid grid-cols-6 gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c.hex}
            title={c.name}
            onClick={() => onPick(c.hex)}
            className={`w-6 h-6 rounded-full border ${
              value.toLowerCase() === c.hex.toLowerCase()
                ? 'border-[var(--ink)]'
                : 'border-line'
            }`}
            style={{ backgroundColor: c.hex }}
            aria-label={c.name}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span
          className="w-5 h-5 rounded-full border border-line shrink-0"
          style={{ backgroundColor: valid ? custom : '#ddd' }}
        />
        <input
          className="input-bare flex-1 text-xs uppercase tracking-wider"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onPick(custom);
          }}
          placeholder="#A89F8A"
          spellCheck={false}
        />
        <button
          className="btn btn-primary text-xs"
          disabled={!valid}
          onClick={() => valid && onPick(custom)}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
