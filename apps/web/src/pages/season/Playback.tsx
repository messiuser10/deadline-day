import { FULL_TIME, PLAYBACK_SPEEDS, SEASON_MATCHDAYS, type PlaybackSpeed } from '@deadline-day/protocol';
import { Button, cx, Segmented } from '../../components/ui';
import type { Playback } from '../../hooks/usePlayback';

const SPEED_LABEL: Record<PlaybackSpeed, string> = { '1x': '1x', '2x': '2x', '5x': '5x', instant: 'Instant' };

export function clockLabel(p: Playback, short = false): string {
  const c = p.clock;
  const md = short ? `MD ${c.matchday}` : `Matchday ${c.matchday}`;
  if (p.pos === 0) return short ? 'Kick-off' : 'Before kick-off';
  if (c.fullTime) return `${md} · FT`;
  return `${md} · ${c.minute}'`;
}

function Icon({ name }: { name: 'play' | 'pause' | 'prev' | 'next' | 'end' }) {
  const d = {
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    prev: 'M6 5h2v14H6zM20 5v14L9 12z',
    next: 'M16 5h2v14h-2zM4 5v14l11-7z',
    end: 'M4 5v14l8-7zM12 5v14l8-7z',
  }[name];
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Matchday the prev/next buttons step from: the one on screen, counted as finished at full time. */
const shownMatchday = (p: Playback) => (p.pos === 0 ? 0 : p.clock.fullTime ? p.clock.matchday : p.clock.matchday - 1);

function Scrubber({ p, className }: { p: Playback; className?: string }) {
  const value = Math.round(shownMatchday(p));
  return (
    <label className={cx('flex items-center gap-3', className)}>
      <span className="sr-only">Jump to matchday</span>
      <input
        type="range"
        min={0}
        max={SEASON_MATCHDAYS}
        step={1}
        value={value}
        onChange={(e) => p.seek(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-pitch-500"
        aria-valuetext={value === 0 ? 'Before kick-off' : `Matchday ${value}`}
      />
    </label>
  );
}

function Status({ p, short = false }: { p: Playback; short?: boolean }) {
  const live = p.playing && !p.clock.fullTime && p.clock.minute > 0 && p.clock.minute < FULL_TIME;
  return (
    <p className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide" role="status" aria-live="off">
      {live && <span className="size-2 shrink-0 rounded-full bg-red-500 motion-safe:animate-pulse" aria-hidden="true" />}
      <span className="truncate">{clockLabel(p, short)}</span>
    </p>
  );
}

function Who({ p }: { p: Playback }) {
  if (p.archived) return <span>Earlier season: pick any matchday.</span>;
  if (!p.shared) return <span>Own pace: your playback is yours alone.</span>;
  if (p.canControl) return <span>You control playback for everyone.</span>;
  return <span>The host controls playback. {p.browsing ? 'You are looking back.' : 'Drag to look back.'}</span>;
}

/** Controls as a card (laptop). */
export function PlaybackCard({ p }: { p: Playback }) {
  const md = shownMatchday(p);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-night-800/80 p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Status p={p} />
        <div className="flex flex-wrap items-center gap-2">
          {p.canControl ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => p.seek(md - 1)} disabled={md <= 0} aria-label="Previous matchday">
                <Icon name="prev" />
              </Button>
              {p.playing ? (
                <Button size="sm" onClick={p.pause} loading={p.pending === 'playback-pause'} aria-label="Pause">
                  <Icon name="pause" /> Pause
                </Button>
              ) : (
                <Button size="sm" onClick={p.play} loading={p.pending === 'playback-play'} aria-label="Play">
                  <Icon name="play" /> Play
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => p.seek(md + 1)} disabled={md >= SEASON_MATCHDAYS} aria-label="Next matchday">
                <Icon name="next" />
              </Button>
              <Button variant="ghost" size="sm" onClick={p.end} disabled={p.pos >= SEASON_MATCHDAYS} aria-label="Skip to the end">
                <Icon name="end" /> Skip to end
              </Button>
            </>
          ) : (
            p.browsing && (
              <Button size="sm" onClick={p.backToLive}>
                {p.archived ? 'Show final day' : 'Back to live'}
              </Button>
            )
          )}
        </div>
      </div>
      <Scrubber p={p} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/55">
        <Who p={p} />
        {p.canControl && (
          <div className="w-72 max-w-full">
            <Segmented label="Playback speed" value={p.speed} onChange={p.setSpeed} options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: SPEED_LABEL[s] }))} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Controls as a fixed bottom bar (phones). */
export function PlaybackBar({ p }: { p: Playback }) {
  const md = shownMatchday(p);
  const nextSpeed = PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(p.speed) + 1) % PLAYBACK_SPEEDS.length]!;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night-900/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl backdrop-blur lg:hidden">
      <Scrubber p={p} className="mb-1.5" />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Status p={p} short />
          {!p.canControl && <p className="truncate text-[0.7rem] text-white/50">{p.archived ? 'Earlier season' : p.shared ? 'Host controls playback' : ''}</p>}
        </div>
        {p.canControl ? (
          <>
            <button type="button" onClick={() => p.seek(md - 1)} disabled={md <= 0} className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 disabled:opacity-40" aria-label="Previous matchday">
              <Icon name="prev" />
            </button>
            <button
              type="button"
              onClick={p.playing ? p.pause : p.play}
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-pitch-500 text-ink"
              aria-label={p.playing ? 'Pause' : 'Play'}
            >
              <Icon name={p.playing ? 'pause' : 'play'} />
            </button>
            <button type="button" onClick={() => p.seek(md + 1)} disabled={md >= SEASON_MATCHDAYS} className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 disabled:opacity-40" aria-label="Next matchday">
              <Icon name="next" />
            </button>
            <button
              type="button"
              onClick={() => p.setSpeed(nextSpeed)}
              className="h-10 min-w-12 shrink-0 rounded-xl bg-white/10 px-2 text-sm font-semibold"
              aria-label={`Speed ${SPEED_LABEL[p.speed]}. Change to ${SPEED_LABEL[nextSpeed]}`}
            >
              {SPEED_LABEL[p.speed]}
            </button>
            <button type="button" onClick={p.end} disabled={p.pos >= SEASON_MATCHDAYS} className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 disabled:opacity-40" aria-label="Skip to the end">
              <Icon name="end" />
            </button>
          </>
        ) : (
          p.browsing && (
            <Button size="sm" onClick={p.backToLive}>
              {p.archived ? 'Final day' : 'Live'}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
