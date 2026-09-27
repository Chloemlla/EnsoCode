import { describe, expect, it } from 'vitest';
import {
  CANCEL_DISTANCE,
  inCancelZone,
  MIN_HOLD_MS,
  pushLevel,
  releaseAction,
  WAVE_BARS,
} from './holdGesture';

describe('releaseAction', () => {
  const long = MIN_HOLD_MS + 1;

  it('finishes a normal hold', () => {
    expect(releaseAction({ phase: 'recording', heldMs: long, cancelZone: false })).toBe('finish');
  });

  it('cancels when released in the cancel zone, however long it was held', () => {
    expect(releaseAction({ phase: 'recording', heldMs: long, cancelZone: true })).toBe('cancel');
    expect(releaseAction({ phase: 'starting', heldMs: 10, cancelZone: true })).toBe('cancel');
  });

  it('rejects a tap or a release before the microphone is ready as too short', () => {
    expect(releaseAction({ phase: 'recording', heldMs: MIN_HOLD_MS - 1, cancelZone: false })).toBe(
      'too-short'
    );
    expect(releaseAction({ phase: 'starting', heldMs: long, cancelZone: false })).toBe('too-short');
  });

  it('leaves an automatic finish at the time limit alone', () => {
    expect(releaseAction({ phase: 'transcribing', heldMs: long, cancelZone: true })).toBe('none');
    expect(releaseAction({ phase: 'idle', heldMs: long, cancelZone: false })).toBe('none');
  });
});

describe('inCancelZone', () => {
  it('only counts sliding up far enough', () => {
    expect(inCancelZone(700, 700 - CANCEL_DISTANCE + 1)).toBe(false);
    expect(inCancelZone(700, 700 - CANCEL_DISTANCE)).toBe(true);
    expect(inCancelZone(700, 790)).toBe(false);
  });
});

describe('pushLevel', () => {
  it('scrolls a fixed-width history, newest on the right', () => {
    let levels = pushLevel([], 0.5);
    expect(levels).toHaveLength(WAVE_BARS);
    expect(levels.at(-1)).toBe(0.5);
    levels = pushLevel(levels, 0.8);
    expect(levels.slice(-2)).toEqual([0.5, 0.8]);
    expect(levels).toHaveLength(WAVE_BARS);
  });
});
