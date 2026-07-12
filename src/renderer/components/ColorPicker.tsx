import { useState } from 'react';
import { isValidHex, PALETTE } from '../lib/colors';
import { AnchoredPopover } from './AnchoredPopover';

interface Props {
  anchor: HTMLElement | null;
  value: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}

export function ColorPicker({ anchor, value, onPick, onClose }: Props) {
  const [custom, setCustom] = useState(value);
  const valid = isValidHex(custom);

  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} width={220}>
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
    </AnchoredPopover>
  );
}
