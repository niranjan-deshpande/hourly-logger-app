import type {
  ActiveSession,
  ActiveSessionPomodoro,
  Block,
  CoverShowPayload,
  PomodoroCoverSession,
  PomodoroSnapshot,
  PomodoroTimerState,
} from '@shared/types';
import {
  clearActiveSession,
  readActiveSession,
  writeActiveSession,
} from '../activeSession';
import { Blocks, Categories } from '../db';
import { sendToMainWindow } from '../windows';
import {
  hideCovers,
  prewarmCovers,
  sendCoverTick,
  showCovers,
} from '../coverWindows';
import { flashOverlay, updateOverlayIfVisible } from '../overlayWindow';
import { notifyBreakComplete, notifyWorkComplete } from '../notifications';
import { Timer } from './timer';

// The pomodoro sequence engine. Owns the live session for pomodoro-mode
// recordings: work → auto break (full-screen covers) → break-over prompt
// ('awaiting') → next rep or finish, indefinitely until the user stops.
//
// A finished sequence writes ONE continuous actual block, breaks
// included — they count as the category's time. Finishing from
// 'awaiting' ends the block at the moment the last break ended
// (lastPhaseEndAt), not at "now": walking away after a break shouldn't
// log the walked-away time.
//
// Plain stopwatch recordings never touch this module — they keep using
// the activeSession.* IPC directly. The engine holds its session in
// memory and mirrors it to active-session.json on every transition
// (never per tick), so a crash mid-sequence is recoverable from disk
// by the existing SessionRecoveryDialog. The engine never auto-resumes
// a session found on launch — that's the recovery dialog's job.

let session: ActiveSession | null = null;

// Five-minute warning: fired at most once per work phase (reset when a
// phase starts). In-memory only — a crash mid-phase goes through the
// recovery dialog anyway.
let fiveMinWarningFired = false;
const FIVE_MIN = 5 * 60;

const timer = new Timer({
  onTick(state) {
    if (state.type === 'break') {
      sendCoverTick(state);
    }
    updateOverlayIfVisible(state);
    // Tasteful heads-up that a focus is almost over: flash the small
    // overlay pill on every display for a few seconds. Only for focus
    // phases long enough that the warning isn't immediate.
    if (
      state.type === 'work' &&
      !fiveMinWarningFired &&
      state.total >= FIVE_MIN + 60 &&
      state.remaining > 0 &&
      state.remaining <= FIVE_MIN
    ) {
      fiveMinWarningFired = true;
      flashOverlay('5 min left in this focus');
    }
    broadcast();
  },
  onComplete(type) {
    const p = session?.pomodoro;
    if (!session || !p) return;
    const now = new Date().toISOString();
    if (type === 'work') {
      // Extensions (+5/+10/+15 from the break cover) belong to the
      // already-counted rep; they never increment.
      if (!p.isExtension) p.repsCompleted += 1;
      p.isExtension = false;
      p.lastPhaseEndAt = now;
      notifyWorkComplete();
      startBreakPhase();
    } else {
      p.phase = 'awaiting';
      p.phaseEndsAt = null;
      p.lastPhaseEndAt = now;
      persist();
      notifyBreakComplete();
      showCovers({
        mode: 'breakOver',
        session: coverSession(),
        focusMinutes: p.nextWorkMinutes ?? p.workMinutes,
      });
      broadcast();
    }
  },
});

function pomo(): ActiveSessionPomodoro {
  const p = session?.pomodoro;
  if (!p) throw new Error('No pomodoro session is running');
  return p;
}

function persist(): void {
  if (session) session = writeActiveSession(session);
}

function broadcast(): void {
  sendToMainWindow('pomodoro.tick', getSnapshot());
}

function coverSession(): PomodoroCoverSession {
  const p = pomo();
  const category = session ? Categories.get(session.categoryId) : undefined;
  return {
    repsCompleted: p.repsCompleted,
    pomodorosPerCycle: p.pomodorosPerCycle,
    categoryName: category?.name ?? '',
    categoryColor: category?.color ?? '#A89F8A',
    note: session?.note ?? null,
  };
}

function startWorkPhase(seconds: number, { extension = false } = {}): void {
  const p = pomo();
  p.phase = 'work';
  p.isExtension = extension;
  p.isPaused = false;
  p.pausedRemainingSeconds = null;
  p.phaseEndsAt = new Date(Date.now() + seconds * 1000).toISOString();
  fiveMinWarningFired = false;
  persist();
  hideCovers();
  timer.start(seconds, 'work');
  broadcast();
}

// Start the next counted rep. Length priority: explicit one-shot from
// the caller (e.g. a length chip on the break-over cover) → the
// session's pending nextWorkMinutes override → the session default.
// The override is one-shot: consumed here, cleared either way.
function startRep(oneShotMinutes?: number): void {
  const p = pomo();
  const minutes = oneShotMinutes ?? p.nextWorkMinutes ?? p.workMinutes;
  p.nextWorkMinutes = null;
  startWorkPhase(minutes * 60);
}

function startBreakPhase(): void {
  const p = pomo();
  const isLong =
    p.repsCompleted > 0 && p.repsCompleted % p.pomodorosPerCycle === 0;
  // A pending next-break override beats the long/short logic — the user
  // set it deliberately, mid-sequence. One-shot: cleared on use.
  const baseMinutes = isLong ? p.longBreakMinutes : p.breakMinutes;
  const minutes = p.nextBreakMinutes ?? baseMinutes;
  p.nextBreakMinutes = null;
  const seconds = minutes * 60;
  p.phase = 'break';
  p.isPaused = false;
  p.pausedRemainingSeconds = null;
  p.phaseEndsAt = new Date(Date.now() + seconds * 1000).toISOString();
  persist();
  timer.start(seconds, 'break');
  showCovers({
    mode: 'break',
    breakType: isLong ? 'long' : 'short',
    state: timer.getState(),
    session: coverSession(),
    focusMinutes: p.nextWorkMinutes ?? p.workMinutes,
  });
  broadcast();
}

export function startSequence(input: {
  categoryId: number;
  note?: string | null;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  pomodorosPerCycle: number;
  planBlockId?: number | null;
}): ActiveSession {
  // One live session at a time, of either kind. A leftover file from a
  // crash also blocks here — the recovery dialog must resolve it first.
  if (session || readActiveSession()) {
    throw new Error('A session is already running — finish or discard it first.');
  }
  if (!Categories.get(input.categoryId)) {
    throw new Error(`Category ${input.categoryId} not found`);
  }
  session = {
    startAt: new Date().toISOString(),
    categoryId: input.categoryId,
    note: input.note ?? null,
    pomodoro: {
      workMinutes: input.workMinutes,
      breakMinutes: input.breakMinutes,
      longBreakMinutes: input.longBreakMinutes,
      pomodorosPerCycle: input.pomodorosPerCycle,
      phase: 'work',
      phaseEndsAt: null,
      isPaused: false,
      pausedRemainingSeconds: null,
      repsCompleted: 0,
      lastPhaseEndAt: null,
      isExtension: false,
      planBlockId: input.planBlockId ?? null,
      nextWorkMinutes: null,
      nextBreakMinutes: null,
    },
  };
  // Create the cover windows now so their renderers are loaded long
  // before the first break shows them.
  prewarmCovers();
  startWorkPhase(input.workMinutes * 60);
  return session;
}

export function pause(): PomodoroSnapshot {
  const p = pomo();
  if (p.phase === 'work' && !p.isPaused) {
    timer.pause();
    p.isPaused = true;
    p.pausedRemainingSeconds = timer.getState().remaining;
    p.phaseEndsAt = null;
    persist();
    broadcast();
  }
  return getSnapshot();
}

export function resume(): PomodoroSnapshot {
  const p = pomo();
  if (p.phase === 'work' && p.isPaused) {
    timer.resume();
    p.isPaused = false;
    p.pausedRemainingSeconds = null;
    p.phaseEndsAt = new Date(
      Date.now() + timer.getState().remaining * 1000
    ).toISOString();
    persist();
    broadcast();
  }
  return getSnapshot();
}

// Skip break = back to work NOW. The donor app went idle here, but in
// the merged model the sequence is continuous, so skipping a break
// means starting the next rep immediately.
export function skipBreak(): PomodoroSnapshot {
  const p = pomo();
  if (p.phase === 'break') {
    timer.stop();
    p.lastPhaseEndAt = new Date().toISOString();
    startRep();
  }
  return getSnapshot();
}

// "+N min more focus" from the break cover: cancel the break, run a
// short work phase that doesn't count as a rep, then the full break
// restarts.
export function extendWork(minutes: number): PomodoroSnapshot {
  const p = pomo();
  if (p.phase === 'break' || p.phase === 'awaiting') {
    const m = Math.max(1, Math.min(60, Math.round(minutes)));
    timer.stop();
    startWorkPhase(m * 60, { extension: true });
  }
  return getSnapshot();
}

export function startNextRep(oneShotMinutes?: number): PomodoroSnapshot {
  const p = pomo();
  if (p.phase === 'awaiting') {
    startRep(oneShotMinutes);
  }
  return getSnapshot();
}

// Set/clear the one-shot next-phase overrides from the renderer.
// undefined leaves a field untouched; null clears it back to the
// session default chosen at start.
export function setNextOverrides(input: {
  workMinutes?: number | null;
  breakMinutes?: number | null;
}): PomodoroSnapshot {
  const p = pomo();
  if (input.workMinutes !== undefined) p.nextWorkMinutes = input.workMinutes;
  if (input.breakMinutes !== undefined) p.nextBreakMinutes = input.breakMinutes;
  persist();
  broadcast();
  return getSnapshot();
}

export function dismissBreakOver(): PomodoroSnapshot {
  hideCovers();
  return getSnapshot();
}

export function finish(): Block | null {
  if (!session?.pomodoro) {
    throw new Error('No pomodoro session to finish');
  }
  const p = session.pomodoro;
  const startAt = session.startAt;
  // Walk-away rule: finishing from 'awaiting' ends the block when the
  // last break ended, not now.
  const endAt =
    p.phase === 'awaiting' && p.lastPhaseEndAt
      ? p.lastPhaseEndAt
      : new Date().toISOString();

  timer.stop();
  hideCovers();

  let block: Block | null = null;
  // Same guard as the plain-recording path: a <1s sequence is a
  // misclick, not a block.
  if (new Date(endAt).getTime() - new Date(startAt).getTime() >= 1000) {
    block = Blocks.create({
      categoryId: session.categoryId,
      startAt,
      endAt,
      note: session.note,
      kind: 'actual',
      pomodoro: {
        source: 'pomodoro',
        repsCompleted: p.repsCompleted,
        workMinutes: p.workMinutes,
        breakMinutes: p.breakMinutes,
      },
    });
  }
  clearActiveSession();
  session = null;
  broadcast();
  return block;
}

export function discard(): boolean {
  if (!session?.pomodoro) {
    throw new Error('No pomodoro session to discard');
  }
  timer.stop();
  hideCovers();
  clearActiveSession();
  session = null;
  broadcast();
  return true;
}

export function getSnapshot(): PomodoroSnapshot {
  return { session, timer: timer.getState() };
}

export function getTimerState(): PomodoroTimerState {
  return timer.getState();
}

// Called by the activeSession.update IPC handler so category/note edits
// made through the generic path (RecordingEditor) don't go stale in the
// engine's in-memory copy — the next persist() would clobber them.
export function noteSessionUpdated(updated: ActiveSession): void {
  if (session && session.pomodoro) {
    session.categoryId = updated.categoryId;
    session.note = updated.note;
  }
}

// Auto-pause focus on system sleep so a 25-min timer doesn't "complete"
// the moment the lid opens. Breaks are left running: sleeping through a
// break just ends it, which is the desired outcome anyway.
export function pauseIfWorking(): void {
  const p = session?.pomodoro;
  if (p && p.phase === 'work' && !p.isPaused) {
    pause();
  }
}
