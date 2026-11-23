import { describe, expect, it } from 'vitest';
import { FULL_TIME, MATCHDAY_MS, matchClock, playbackEndsAt, playbackPos, reanchor, type PlaybackClock } from '../src';

const clock = (over: Partial<PlaybackClock> = {}): PlaybackClock => ({ playing: true, speed: '1x', anchorPos: 0, anchorAt: 1_000, ...over });

describe('playback clock', () => {
  it('advances one matchday per MATCHDAY_MS while playing and stops at the end', () => {
    const c = clock();
    expect(playbackPos(c, 1_000)).toBe(0);
    expect(playbackPos(c, 1_000 + MATCHDAY_MS['1x'] * 2.5)).toBeCloseTo(2.5);
    expect(playbackPos(c, 1_000 + MATCHDAY_MS['1x'] * 100)).toBe(38);
    expect(playbackPos({ ...c, playing: false, anchorPos: 4 }, 99_999_999)).toBe(4);
    expect(playbackPos({ ...c, speed: '5x' }, 1_000 + 2_000)).toBeCloseTo(1);
  });

  it('knows when a playing clock finishes', () => {
    expect(playbackEndsAt(clock({ anchorPos: 36, speed: '2x' }))).toBe(1_000 + 2 * MATCHDAY_MS['2x']);
    expect(playbackEndsAt(clock({ playing: false }))).toBeNull();
    expect(playbackEndsAt(clock({ anchorPos: 38 }))).toBeNull();
  });

  it('re-anchors at the current position and never plays past the end', () => {
    const c = clock();
    const paused = reanchor(c, 1_000 + MATCHDAY_MS['1x'] * 3, { playing: false });
    expect(paused).toEqual({ playing: false, speed: '1x', anchorPos: 3, anchorAt: 1_000 + MATCHDAY_MS['1x'] * 3 });
    const faster = reanchor(paused, 50_000, { playing: true, speed: '5x' });
    expect(faster).toMatchObject({ playing: true, speed: '5x', anchorPos: 3, anchorAt: 50_000 });
    expect(reanchor(faster, 60_000, { anchorPos: 38 }).playing).toBe(false);
  });

  it('maps a position to the matchday, minute and completed matchdays', () => {
    expect(matchClock(0, '1x')).toEqual({ matchday: 1, minute: 0, fullTime: false, completed: 0, finished: false });
    const mid = matchClock(4.425, '1x');
    expect(mid).toMatchObject({ matchday: 5, fullTime: false, completed: 4 });
    expect(mid.minute).toBe(47);
    expect(matchClock(4.9, '1x')).toMatchObject({ matchday: 5, minute: FULL_TIME, fullTime: true, completed: 5 });
    expect(matchClock(5, '1x')).toMatchObject({ matchday: 5, fullTime: true, completed: 5 });
    expect(matchClock(4.01, 'instant')).toMatchObject({ matchday: 5, fullTime: true, completed: 5 });
    expect(matchClock(38, '1x')).toMatchObject({ matchday: 38, fullTime: true, completed: 38, finished: true });
  });
});
