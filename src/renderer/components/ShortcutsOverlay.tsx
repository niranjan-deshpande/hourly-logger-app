import { X } from 'lucide-react';

interface Row {
  keys: string[];
  description: string;
}

const ROWS: Row[] = [
  { keys: ['N'], description: 'Open quick capture' },
  { keys: ['←', '→'], description: 'Previous / next day or week' },
  { keys: ['T'], description: 'Jump to today / this week' },
  { keys: ['1', '2', '3'], description: 'Switch to Day / Week / Aggregate view' },
  { keys: ['Esc'], description: 'Close any open popover or editor' },
  { keys: ['⌘', 'E'], description: 'Export current data as JSON' },
  { keys: ['⌘', ','], description: 'Open settings' },
  { keys: ['?'], description: 'Show this overlay' },
  {
    keys: ['1', '–', '9'],
    description: 'Pick the Nth filtered result in a category combobox',
  },
  {
    keys: ['⌘', 'Enter'],
    description: 'Add the parsed blocks (in quick capture)',
  },
  { keys: ['Alt + drag'], description: '1-minute snap when dragging on timeline' },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/15"
      onClick={onClose}
    >
      <div
        className="popover w-[480px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-medium">Keyboard shortcuts</div>
          <button
            className="btn btn-ghost p-1"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
        <table className="w-full mt-4">
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={i} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-4 align-top w-[150px]">
                  <span className="flex items-center gap-1 flex-wrap">
                    {r.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className="text-[11px] tracking-wide px-1.5 py-0.5 border border-line rounded bg-[var(--surface)] text-ink"
                        style={{ fontFamily: 'inherit' }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </td>
                <td className="py-2 text-sm text-muted">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-xs text-faint">
          Shortcuts that conflict with text input (like single letters) are
          suppressed while typing.
        </div>
      </div>
    </div>
  );
}
