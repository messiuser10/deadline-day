import { useCallback, useEffect, useState } from 'react';
import {
  SEASON_MATCHDAYS,
  matchClock,
  playbackPos,
  reanchor,
  type MatchClock,
  type PlaybackAction,
  type PlaybackClock,
  type PlaybackSpeed,
  type PlaybackView,
} from '@deadline-day/protocol';
import { post } from '../lib/api';
import { useAction } from './useAction';
import { useServerNow } from './useClock';

export interface Playback {
  pos: number;
  clock: MatchClock;
  playing: boolean;
  speed: PlaybackSpeed;
  /** This viewer can press the controls (the host in synchronized mode; everyone in own-pace mode). */
  canControl: boolean;
  /** Looking at a matchday of your own choice instead of the clock (viewers in synchronized mode, or an earlier season). */
  browsing: boolean;
  /** Viewing an earlier season: everything is shown, there is no clock. */
  archived: boolean;
  shared: boolean;
  pending: string | null;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  /** Show matchday N at full time. */
  seek: (matchday: number) => void;
  end: () => void;
  backToLive: () => void;
}

const storageKey = (code: string, season: number) => `dd:playback:${code}:${season}`;

function loadLocal(code: string, season: number, now: number): PlaybackClock {
  try {
    const raw = localStorage.getItem(storageKey(code, season));
    if (raw) {
      const c = JSON.parse(raw) as PlaybackClock;
      if (typeof c.anchorPos === 'number' && typeof c.anchorAt === 'number') return c;
    }
  } catch {
    // Private mode or blocked storage: start from kick-off.
  }
  return { playing: true, speed: '1x', anchorPos: 0, anchorAt: now };
}

function saveLocal(code: string, season: number, c: PlaybackClock): void {
  try {
    localStorage.setItem(storageKey(code, season), JSON.stringify(c));
  } catch {
    // Not saved: the clock still works for this visit.
  }
}

/**
 * The season clock on this screen. Synchronized mode follows the server clock (only the host can move it;
 * others may browse other matchdays and come back). Own-pace mode keeps a clock in this browser.
 */
export function usePlayback({ code, shared, viewing, isHost }: { code: string; shared: PlaybackView; viewing: number; isHost: boolean }): Playback {
  const now = useServerNow(150);
  const archived = viewing !== shared.season;
  const ownPace = shared.mode === 'own_pace';
  const [local, setLocal] = useState<PlaybackClock>(() => loadLocal(code, viewing, now));
  const [browse, setBrowse] = useState<number | null>(null);
  const { run, pending } = useAction();

  useEffect(() => {
    setLocal(loadLocal(code, viewing, Date.now()));
    setBrowse(null);
  }, [code, viewing]);

  const updateLocal = useCallback(
    (changes: Parameters<typeof reanchor>[2]) => {
      setLocal((cur) => {
        const next = reanchor(cur, now, changes);
        saveLocal(code, viewing, next);
        return next;
      });
    },
    [code, viewing, now],
  );

  const send = useCallback(
    (action: PlaybackAction) => void run(`playback-${action.action}`, () => post(`/api/games/${code}/season/playback`, action)),
    [run, code],
  );

  let clock: PlaybackClock;
  if (archived) clock = { playing: false, speed: 'instant', anchorPos: SEASON_MATCHDAYS, anchorAt: now };
  else if (ownPace) clock = local;
  else clock = shared;

  const viewOnly = archived || (!ownPace && !isHost);
  const browsing = viewOnly && browse !== null;
  const pos = browsing ? browse : playbackPos(clock, now);
  const speed = browsing ? 'instant' : clock.speed;
  const canControl = !archived && (ownPace || isHost);

  const control = (action: PlaybackAction) => {
    if (viewOnly) {
      if (action.action === 'seek') setBrowse(action.matchday);
      else if (action.action === 'end') setBrowse(null);
      return;
    }
    if (ownPace) {
      const p = playbackPos(local, now);
      if (action.action === 'play') updateLocal({ playing: true, anchorPos: p >= SEASON_MATCHDAYS ? 0 : p });
      else if (action.action === 'pause') updateLocal({ playing: false });
      else if (action.action === 'speed') updateLocal({ speed: action.speed });
      else if (action.action === 'seek') updateLocal({ anchorPos: action.matchday });
      else updateLocal({ anchorPos: SEASON_MATCHDAYS, playing: false });
      return;
    }
    send(action);
  };

  return {
    pos,
    clock: matchClock(pos, speed),
    playing: !browsing && clock.playing && pos < SEASON_MATCHDAYS,
    speed: clock.speed,
    canControl,
    browsing,
    archived,
    shared: !ownPace,
    pending,
    play: () => control({ action: 'play' }),
    pause: () => control({ action: 'pause' }),
    setSpeed: (s) => control({ action: 'speed', speed: s }),
    seek: (matchday) => control({ action: 'seek', matchday: Math.max(0, Math.min(SEASON_MATCHDAYS, matchday)) }),
    end: () => control({ action: 'end' }),
    backToLive: () => setBrowse(null),
  };
}
