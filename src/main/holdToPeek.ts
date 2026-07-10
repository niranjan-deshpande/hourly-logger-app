import { globalShortcut } from 'electron';

// Ctrl+Option+P: plain Ctrl+P would be swallowed system-wide, breaking the
// ubiquitous "previous line/command" binding in terminals and text fields.
const ACCELERATOR = 'Control+Alt+P';

// Key-repeat events arrive every ~30-100ms while held; macOS's initial repeat
// delay can be ~500-700ms, so 900ms reliably means "released" without the
// overlay lingering for seconds. Requires key repeat to be enabled.
const RELEASE_THRESHOLD_MS = 900;

let isHeld = false;
let lastCallbackTime = 0;
let pollInterval: NodeJS.Timeout | null = null;

export function registerHoldToPeek({
  onKeyDown,
  onKeyUp,
}: {
  onKeyDown: () => void;
  onKeyUp: () => void;
}): void {
  try {
    const ok = globalShortcut.register(ACCELERATOR, () => {
      lastCallbackTime = Date.now();

      if (!isHeld) {
        isHeld = true;
        onKeyDown();

        pollInterval = setInterval(() => {
          if (Date.now() - lastCallbackTime > RELEASE_THRESHOLD_MS) {
            isHeld = false;
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = null;
            onKeyUp();
          }
        }, 100);
      }
    });
    if (!ok) {
      // Another app owns the chord. The overlay is a nicety — degrade.
      console.warn(`Could not register global shortcut ${ACCELERATOR}`);
    }
  } catch (err) {
    console.warn(`Global shortcut registration failed:`, err);
  }
}

export function unregisterHoldToPeek(): void {
  globalShortcut.unregisterAll();
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isHeld = false;
}
