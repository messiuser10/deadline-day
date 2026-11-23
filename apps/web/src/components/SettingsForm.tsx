import { useId } from 'react';
import { FORMATION_IDS, MAX_TEAMS, MIN_TEAMS, type FormationId } from '@deadline-day/engine';
import type { GameLimits, GameSettings } from '@deadline-day/protocol';
import { money } from '../lib/format';
import { cx, Segmented, Toggle } from './ui';

type NumKey = 'maxTeams' | 'budgetM' | 'nominationTimerS' | 'lotTimerS' | 'antiSnipeS' | 'minIncrementM' | 'extraMin';

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn = 'grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 text-lg font-bold hover:bg-white/15 disabled:opacity-30';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-white/80">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Less ${label}`}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10);
            if (Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => onChange(clamp(value))}
          className="min-h-11 w-full min-w-0 rounded-xl bg-night-950/70 text-center text-base font-semibold ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-2 focus:ring-pitch-400"
          aria-describedby={`${id}-hint`}
        />
        <button type="button" className={btn} onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More ${label}`}>
          +
        </button>
      </div>
      <p id={`${id}-hint`} className={cx('text-xs', value < min || value > max ? 'text-red-300' : 'text-white/50')}>
        {value < min || value > max ? `Between ${format(min)} and ${format(max)}` : (hint ?? format(value))}
      </p>
    </div>
  );
}

export function SettingsForm({
  value,
  onChange,
  limits,
  formationsEnabled,
  publicLobbiesEnabled,
  minTeams = MIN_TEAMS,
}: {
  value: GameSettings;
  onChange: (s: GameSettings) => void;
  limits: GameLimits;
  formationsEnabled: readonly FormationId[];
  publicLobbiesEnabled: boolean;
  /** In a lobby, max teams cannot go below the teams already in. */
  minTeams?: number;
}) {
  const set = <K extends keyof GameSettings>(key: K, v: GameSettings[K]) => onChange({ ...value, [key]: v });
  const num = (key: NumKey, label: string, range: [number, number], extra: Partial<Parameters<typeof Stepper>[0]> = {}) => (
    <Stepper label={label} value={value[key]} min={range[0]} max={range[1]} onChange={(v) => set(key, v)} {...extra} />
  );
  const enabled = FORMATION_IDS.filter((f) => formationsEnabled.includes(f));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {num('maxTeams', 'Max teams', [Math.max(MIN_TEAMS, minTeams), MAX_TEAMS], { hint: `${20 - value.maxTeams} AI clubs at full house` })}
        {num('budgetM', 'Budget per team', limits.budgetM, { step: 50, format: money })}
        {num('nominationTimerS', 'Nomination timer', limits.nominationTimerS, { format: (v) => `${v} s` })}
        {num('lotTimerS', 'Lot timer', limits.lotTimerS, { format: (v) => `${v} s` })}
        {num('antiSnipeS', 'Anti-snipe reset', limits.antiSnipeS, { format: (v) => `${v} s`, hint: 'A late bid resets the clock to this' })}
        {num('minIncrementM', 'Minimum raise', limits.minIncrementM, { format: money })}
        {num('extraMin', 'Extra players per group (min)', limits.extraMin, { hint: 'Spare players so the last picks still have a choice' })}
        <Stepper
          label="Extra players (% of need)"
          value={Math.round(value.extraPct * 100)}
          min={Math.round(limits.extraPct[0] * 100)}
          max={Math.round(limits.extraPct[1] * 100)}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => set('extraPct', v / 100)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-white/80">Formations</span>
        <Segmented
          label="Formation rule"
          value={value.formationRule}
          onChange={(v) => onChange({ ...value, formationRule: v, forcedFormation: v === 'forced' ? (value.forcedFormation ?? enabled[0] ?? '4-3-3') : null })}
          options={[
            { value: 'each', label: 'Each team chooses' },
            { value: 'forced', label: 'Host sets one' },
          ]}
        />
        {value.formationRule === 'forced' && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Formation for every team">
            {enabled.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={value.forcedFormation === f}
                onClick={() => set('forcedFormation', f)}
                className={cx(
                  'min-h-10 rounded-lg px-3 font-display text-sm tracking-wide ring-1 ring-inset',
                  value.forcedFormation === f ? 'bg-pitch-500 text-ink ring-pitch-500' : 'ring-white/15 hover:ring-white/40',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-white/80">Season playback</span>
        <Segmented
          label="Playback mode"
          value={value.playbackMode}
          onChange={(v) => set('playbackMode', v)}
          options={[
            { value: 'synchronized', label: 'Together' },
            { value: 'own_pace', label: 'Own pace' },
          ]}
        />
      </div>

      <div className="flex flex-col divide-y divide-white/5">
        <Toggle
          checked={value.visibility === 'public'}
          onChange={(v) => set('visibility', v ? 'public' : 'private')}
          label="Public lobby"
          description={publicLobbiesEnabled ? 'Listed on the home page. Off: join by code only.' : 'Public lobbies are switched off by the admin.'}
        />
        <Toggle checked={value.botsAllowed} onChange={(v) => set('botsAllowed', v)} label="Bots allowed" description="The host can add Easy, Medium and Hard bots." />
        <Toggle
          checked={value.removeBoughtFromAi}
          onChange={(v) => set('removeBoughtFromAi', v)}
          label="Remove bought players from AI clubs"
          description="Buy Mbappé and Real Madrid lose him."
        />
        <Toggle checked={value.autoStartSeason} onChange={(v) => set('autoStartSeason', v)} label="Start the season after the auction" />
      </div>
    </div>
  );
}

export function SettingsSummary({ s }: { s: GameSettings }) {
  const rows: [string, string][] = [
    ['Budget', money(s.budgetM)],
    ['Max teams', String(s.maxTeams)],
    ['Nomination', `${s.nominationTimerS} s`],
    ['Lot timer', `${s.lotTimerS} s (+${s.antiSnipeS} s anti-snipe)`],
    ['Min raise', money(s.minIncrementM)],
    ['Formations', s.formationRule === 'forced' ? `Everyone plays ${s.forcedFormation}` : 'Each team chooses'],
    ['Extras', `max(${s.extraMin}, ${Math.round(s.extraPct * 100)}% of need)`],
    ['AI squads', s.removeBoughtFromAi ? 'Lose players you buy' : 'Keep full squads'],
    ['Bots', s.botsAllowed ? 'Allowed' : 'Off'],
    ['Playback', s.playbackMode === 'synchronized' ? 'Together' : 'Own pace'],
    ['Visibility', s.visibility === 'public' ? 'Public' : 'Private (code)'],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-white/50">{k}</dt>
          <dd className="text-right font-medium text-white/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
