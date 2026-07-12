import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Popovers anchored to sidebar rows can't be position:absolute — the
// category list is a scroll container, so it clips (and grows a horizontal
// scrollbar around) anything wider than the sidebar. This renders the card
// into a body portal, position:fixed against the anchor's viewport rect:
// below the anchor when there's room, flipped above when there isn't,
// clamped so it never leaves the window. Also owns the dismiss behavior
// every popover otherwise duplicates (outside mousedown, Escape) and
// repositions when the list scrolls, the window resizes, or the card's own
// content grows.

const MARGIN = 8; // min gap to the viewport edges
const GAP = 4; // gap between anchor and card

interface Props {
  anchor: HTMLElement | null;
  onClose: () => void;
  // Fixed card width in px — exact clamping needs it known up front.
  width: number;
  // Which anchor edge the card lines up with (before clamping).
  align?: 'start' | 'end';
  // Card classes beyond `.popover` (padding etc.).
  className?: string;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}

export function AnchoredPopover({
  anchor,
  onClose,
  width,
  align = 'start',
  className = 'p-3',
  onMouseLeave,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // null until the first measure — the card renders hidden for that one
  // frame so it never flashes at a wrong position.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!anchor || !card) return;

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = card.offsetHeight;
      let left = align === 'end' ? r.right - width : r.left;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN));
      let top = r.bottom + GAP;
      if (top + h > window.innerHeight - MARGIN) {
        top = Math.max(MARGIN, r.top - GAP - h);
      }
      setPos({ left, top });
    };

    place();
    // Capture phase so the sidebar list scrolling (not just the window)
    // retriggers placement; ResizeObserver follows content growth (e.g. an
    // error line or extra field appearing).
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const ro = new ResizeObserver(place);
    ro.observe(card);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro.disconnect();
    };
  }, [anchor, width, align]);

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

  return createPortal(
    <div
      ref={ref}
      className={`popover fixed z-50 ${className}`}
      style={{
        width,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
