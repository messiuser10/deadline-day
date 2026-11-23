/**
 * Season playback clock (section 10), shared by the server (end-of-season timer) and the web app.
 * Playback position is measured in matchdays: 0 is the kick-off of matchday 1, 38 is the final whistle.
 * Each matchday plays its minutes over the first LIVE_SHARE of its slot, then sits at full time.
 */

export const SEASON_MATCHDAYS = 38;

export const PLAYBACK_SPEEDS = ['1x', '2x', '5x', 'instant'] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Real time for one matchday at each speed. "Instant" shows each matchday straight at full time. */
export const MATCHDAY_MS: Record<PlaybackSpeed, number> = {
  '1x': 10_000,
  '2x': 5_000,
  '5x': 2_000,
  instant: 1_000,
};

/** Share of a matchday's slot spent ticking through the minutes; the rest shows full time. */
export const LIVE_SHARE = 0.85;
/** Minute shown at full time (events go up to 94). */
export const FULL_TIME = 95;

export interface PlaybackClock {
  playing: boolean;
  speed: PlaybackSpeed;
  /** Position (in matchdays) at anchorAt. */
  anchorPos: number;
  anchorAt: number;
}

/** Position now, in matchdays from 0 to `matchdays`. */
export function playbackPos(p: PlaybackClock, now: number, matchdays = SEASON_MATCHDAYS): number {
  const pos = p.playing ? p.anchorPos + Math.max(0, now - p.anchorAt) / MATCHDAY_MS[p.speed] : p.anchorPos;
  return Math.min(matchdays, Math.max(0, pos));
}

/** When a playing clock reaches the end, or null when paused or already there. */
export function playbackEndsAt(p: PlaybackClock, matchdays = SEASON_MATCHDAYS): number | null {
  if (!p.playing || p.anchorPos >= matchdays) return null;
  return p.anchorAt + (matchdays - p.anchorPos) * MATCHDAY_MS[p.speed];
}

/** Re-anchor a clock at `now` (used by every control: play, pause, speed, seek). */
export function reanchor(p: PlaybackClock, now: number, changes: Partial<Pick<PlaybackClock, 'playing' | 'speed' | 'anchorPos'>>, matchdays = SEASON_MATCHDAYS): PlaybackClock {
  const pos = changes.anchorPos ?? playbackPos(p, now, matchdays);
  const anchorPos = Math.min(matchdays, Math.max(0, pos));
  const playing = (changes.playing ?? p.playing) && anchorPos < matchdays;
  return { playing, speed: changes.speed ?? p.speed, anchorPos, anchorAt: now };
}

export interface MatchClock {
  /** Matchday on screen, 1 to 38. */
  matchday: number;
  /** Minute of that matchday's matches (0 before kick-off, FULL_TIME at full time). */
  minute: number;
  fullTime: boolean;
  /** Matchdays whose results (and table) are final. */
  completed: number;
  /** The whole season has been shown. */
  finished: boolean;
}

export function matchClock(pos: number, speed: PlaybackSpeed, matchdays = SEASON_MATCHDAYS): MatchClock {
  const p = Math.min(matchdays, Math.max(0, pos));
  if (p === 0) return { matchday: 1, minute: 0, fullTime: false, completed: 0, finished: false };
  const matchday = Math.min(matchdays, Math.ceil(p));
  const frac = p - (matchday - 1);
  const fullTime = speed === 'instant' || frac >= LIVE_SHARE;
  const minute = fullTime ? FULL_TIME : Math.min(FULL_TIME - 1, Math.floor((frac / LIVE_SHARE) * FULL_TIME));
  return { matchday, minute, fullTime, completed: fullTime ? matchday : matchday - 1, finished: fullTime && matchday === matchdays };
}
