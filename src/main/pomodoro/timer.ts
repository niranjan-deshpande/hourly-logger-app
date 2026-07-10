import type { PomodoroTimerState } from '@shared/types';

type TimerType = 'work' | 'break';

interface TimerCallbacks {
  onTick: (state: PomodoroTimerState) => void;
  onComplete: (type: TimerType) => void;
}

// Countdown timer with wall-clock drift correction: `remaining` is
// recomputed from Date.now() on every tick rather than decremented, so
// setInterval jitter never accumulates. Ported from the standalone
// Pomodoro app's timer.js.
export class Timer {
  private onTick: TimerCallbacks['onTick'];
  private onComplete: TimerCallbacks['onComplete'];
  private interval: NodeJS.Timeout | null = null;
  private state: PomodoroTimerState = {
    remaining: 0,
    total: 0,
    type: 'idle',
    isPaused: false,
  };
  private startTime = 0;
  private pausedAt = 0;
  private pausedElapsed = 0;

  constructor({ onTick, onComplete }: TimerCallbacks) {
    this.onTick = onTick;
    this.onComplete = onComplete;
  }

  start(durationSeconds: number, type: TimerType): void {
    this.stop();
    this.state = {
      remaining: durationSeconds,
      total: durationSeconds,
      type,
      isPaused: false,
    };
    this.startTime = Date.now();
    this.pausedElapsed = 0;

    this.interval = setInterval(() => this.tick(), 1000);
    this.onTick(this.getState());
  }

  pause(): void {
    if (this.state.type === 'idle' || this.state.isPaused) return;
    this.state.isPaused = true;
    this.pausedAt = Date.now();
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.onTick(this.getState());
  }

  resume(): void {
    if (this.state.type === 'idle' || !this.state.isPaused) return;
    this.pausedElapsed += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.state.isPaused = false;
    this.interval = setInterval(() => this.tick(), 1000);
    this.onTick(this.getState());
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.state = { remaining: 0, total: 0, type: 'idle', isPaused: false };
    this.startTime = 0;
    this.pausedAt = 0;
    this.pausedElapsed = 0;
  }

  getState(): PomodoroTimerState {
    return { ...this.state };
  }

  private tick(): void {
    const elapsed = (Date.now() - this.startTime - this.pausedElapsed) / 1000;
    this.state.remaining = Math.max(0, this.state.total - Math.floor(elapsed));

    if (this.state.remaining <= 0) {
      const completedType = this.state.type as TimerType;
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      this.state.remaining = 0;
      this.onTick(this.getState());
      this.state = { remaining: 0, total: 0, type: 'idle', isPaused: false };
      this.onComplete(completedType);
    } else {
      this.onTick(this.getState());
    }
  }
}
