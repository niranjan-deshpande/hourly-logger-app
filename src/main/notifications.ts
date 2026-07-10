import { Notification } from 'electron';

// Silent notifications — the full-screen break cover is the loud part;
// these just leave a trace in Notification Center.

export function notifyWorkComplete(): void {
  new Notification({
    title: 'Pomodoro',
    body: 'Focus session complete — break started.',
    silent: true,
  }).show();
}

export function notifyBreakComplete(): void {
  new Notification({
    title: 'Pomodoro',
    body: 'Break is over. Ready to focus?',
    silent: true,
  }).show();
}
