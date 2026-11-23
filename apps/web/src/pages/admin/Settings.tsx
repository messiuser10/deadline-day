import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormationId, SimParams, Tiebreaker } from '@deadline-day/engine';
import type { AdminClubsView, AdminSettingsView, AppSettings, EditableSettingKey, GameLimits, TableBand } from '@deadline-day/protocol';
import { get, put } from '../../lib/api';
import { SettingsForm } from '../../components/SettingsForm';
import { Button, Card, CardTitle, cx, Field, Input, Segmented, Skeleton, Toggle } from '../../components/ui';
import { AdminHeader, NumberInput, Select, Textarea, useAdminMutation } from './parts';

export const SETTINGS_KEY = ['admin', 'settings'];

export function useAdminSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => get<AdminSettingsView>('/api/admin/settings') });
}

/** Saves one settings key; refreshes the admin view and the public settings every page reads. */
export function useSaveSetting(label: string) {
  const qc = useQueryClient();
  return useAdminMutation(({ key, value }: { key: EditableSettingKey; value: unknown }) => put<AdminSettingsView>('/api/admin/settings', { key, value }), {
    invalidate: [['public-settings'], ['admin', 'overview'], ['admin', 'clubs']],
    success: `${label} saved`,
    onSuccess: (view) => qc.setQueryData(SETTINGS_KEY, view),
  });
}

/** A card holding a draft of one setting, with Save and Reset to default. */
function Section<K extends EditableSettingKey>({
  k,
  title,
  description,
  view,
  children,
}: {
  k: K;
  title: string;
  description?: ReactNode;
  view: AdminSettingsView;
  children: (value: AppSettings[K], set: (v: AppSettings[K]) => void) => ReactNode;
}) {
  const saved = view.settings[k];
  const [draft, setDraft] = useState<AppSettings[K]>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const save = useSaveSetting(title);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const isDefault = JSON.stringify(saved) === JSON.stringify(view.defaults[k]);
  return (
    <Card id={`setting-${k}`}>
      <CardTitle
        action={
          <span className="flex gap-1">
            {!isDefault && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(view.defaults[k])}>
                Default
              </Button>
            )}
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
                Undo
              </Button>
            )}
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ key: k, value: draft })}>
              Save
            </Button>
          </span>
        }
      >
        {title}
      </CardTitle>
      {description && <p className="-mt-1 mb-3 text-xs text-white/50">{description}</p>}
      {children(draft, setDraft)}
    </Card>
  );
}

const LIMIT_LABELS: Record<keyof GameLimits, [string, number]> = {
  budgetM: ['Budget ($M)', 1],
  nominationTimerS: ['Nomination timer (s)', 1],
  lotTimerS: ['Lot timer (s)', 1],
  antiSnipeS: ['Anti-snipe reset (s)', 1],
  minIncrementM: ['Minimum increment ($M)', 1],
  extraMin: ['extra_min', 1],
  extraPct: ['extra_pct', 0.05],
};

const TIEBREAK_LABEL: Record<Tiebreaker, string> = { goal_difference: 'Goal difference', goals_for: 'Goals scored', head_to_head: 'Head to head' };
const ALL_TIEBREAKERS: Tiebreaker[] = ['goal_difference', 'goals_for', 'head_to_head'];

function SimParamsEditor({ value, set }: { value: SimParams; set: (v: SimParams) => void }) {
  const num = (k: 'baseGoals' | 'homeAdvantage' | 'sensitivity' | 'chaos' | 'outOfPositionPenalty' | 'reserveRating', label: string, min: number, max: number, step: number, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => <NumberInput id={id} value={value[k]} min={min} max={max} step={step} onChange={(v) => v !== null && set({ ...value, [k]: v })} />}
    </Field>
  );
  const order = value.tiebreakers;
  const move = (i: number, by: number) => {
    const next = [...order];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ ...value, tiebreakers: next });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {num('baseGoals', 'Base goals', 0.3, 4, 0.05, 'Expected goals per side')}
        {num('homeAdvantage', 'Home advantage', 0.7, 1.6, 0.01, 'Multiplier, 1 = none')}
        {num('sensitivity', 'Sensitivity', 0, 0.5, 0.005, 'How much strength matters')}
        {num('chaos', 'Chaos', 0, 1, 0.05, 'Randomness, 0 to 1')}
        {num('outOfPositionPenalty', 'Out-of-position penalty', 0, 40, 1, 'Overall points lost')}
        {num('reserveRating', 'Reserve rating', 40, 90, 1, 'Academy fill-in for AI clubs')}
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <Toggle checked={value.chemistry} onChange={(v) => set({ ...value, chemistry: v })} label="Chemistry" description="Small boost for shared clubs and nations" />
        <Toggle checked={value.injuries} onChange={(v) => set({ ...value, injuries: v })} label="Injuries" description="Players can miss matches" />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-white/80">Points system</p>
        <div className="grid grid-cols-3 gap-2">
          {(['win', 'draw', 'loss'] as const).map((k) => (
            <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
              {(id) => <NumberInput id={id} value={value.points[k]} min={-5} max={10} onChange={(v) => v !== null && set({ ...value, points: { ...value.points, [k]: v } })} />}
            </Field>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-white/80">Tiebreakers after points, in order (a seeded draw always comes last)</p>
        <ol className="flex flex-col gap-1">
          {order.map((t, i) => (
            <li key={t} className="flex items-center gap-2 rounded-xl px-2 py-1 ring-1 ring-inset ring-white/5">
              <span className="w-5 text-right text-xs text-white/45">{i + 1}</span>
              <span className="flex-1 text-sm">{TIEBREAK_LABEL[t]}</span>
              <button type="button" aria-label={`Move ${TIEBREAK_LABEL[t]} up`} disabled={i === 0} onClick={() => move(i, -1)} className="grid size-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-25">
                ↑
              </button>
              <button type="button" aria-label={`Move ${TIEBREAK_LABEL[t]} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="grid size-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-25">
                ↓
              </button>
              <button type="button" onClick={() => set({ ...value, tiebreakers: order.filter((x) => x !== t) })} className="min-h-9 rounded-lg px-2 text-xs text-red-300 hover:bg-white/10">
                Remove
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_TIEBREAKERS.filter((t) => !order.includes(t)).map((t) => (
            <Button key={t} size="sm" variant="secondary" onClick={() => set({ ...value, tiebreakers: [...order, t] })}>
              + {TIEBREAK_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

const TONES: TableBand['tone'][] = ['gold', 'green', 'blue', 'red'];
const TONE_SWATCH: Record<TableBand['tone'], string> = { gold: 'bg-gold-400', green: 'bg-pitch-500', blue: 'bg-sky-400', red: 'bg-red-400' };

function BandsEditor({ value, set }: { value: TableBand[]; set: (v: TableBand[]) => void }) {
  const update = (i: number, patch: Partial<TableBand>) => set(value.map((b, j) => (i === j ? { ...b, ...patch } : b)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((b, i) => (
        <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-end gap-2 rounded-xl p-2 ring-1 ring-inset ring-white/5 sm:grid-cols-[auto_5rem_5rem_1fr_7rem_auto]">
          <span className={cx('mb-3 size-4 rounded-full', TONE_SWATCH[b.tone], !b.enabled && 'opacity-30')} aria-hidden="true" />
          <Field label="From">{(id) => <NumberInput id={id} value={b.from} min={1} max={20} onChange={(v) => v !== null && update(i, { from: v })} />}</Field>
          <Field label="To">{(id) => <NumberInput id={id} value={b.to} min={1} max={20} onChange={(v) => v !== null && update(i, { to: v })} />}</Field>
          <div className="col-span-3 sm:col-span-1">
            <Field label="Label">{(id) => <Input id={id} value={b.label} maxLength={24} onChange={(e) => update(i, { label: e.target.value })} />}</Field>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Field label="Colour">
              {(id) => (
                <Select id={id} value={b.tone} onChange={(e) => update(i, { tone: e.target.value as TableBand['tone'] })}>
                  {TONES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <span className="flex items-center gap-1">
            <label className="flex min-h-11 items-center gap-1.5 px-1 text-xs">
              <input type="checkbox" checked={b.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} className="size-4 accent-pitch-500" />
              On
            </label>
            <button type="button" onClick={() => set(value.filter((_, j) => j !== i))} className="min-h-11 rounded-lg px-2 text-xs text-red-300 hover:bg-white/10">
              Remove
            </button>
          </span>
        </div>
      ))}
      {value.length < 8 && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => set([...value, { from: 7, to: 7, label: 'New band', tone: 'blue', enabled: true }])}>
          Add band
        </Button>
      )}
    </div>
  );
}

function ProfanityEditor({ value, set }: { value: string[]; set: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  const emitted = useRef(value);
  // Resync only when the list changes from outside (Undo, Default, a save), not while typing.
  useEffect(() => {
    if (value !== emitted.current) setText(value.join('\n'));
  }, [value]);
  return (
    <Field label={`Blocked words (${value.length})`} hint="One per line. Checked in team names, display names, game names and chat.">
      {(id) => (
        <Textarea
          id={id}
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const next = [...new Set(e.target.value.split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean))].sort();
            emitted.current = next;
            set(next);
          }}
        />
      )}
    </Field>
  );
}

export function SettingsTab() {
  const q = useAdminSettings();
  const clubs = useQuery({ queryKey: ['admin', 'clubs'], queryFn: () => get<AdminClubsView>('/api/admin/clubs') });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <p className="text-sm text-red-300">Could not load the settings. Reload to try again.</p>;
  const view = q.data;
  const s = view.settings;
  return (
    <>
      <AdminHeader
        title="Settings"
        description={
          <>
            Each section saves on its own and is checked against the others. The banner is under{' '}
            <Link to="/admin/announcements" className="text-pitch-400 hover:underline">
              Announcements
            </Link>
            ; the price curve is edited with the{' '}
            <Link to="/admin/pool" className="text-pitch-400 hover:underline">
              Reprice tool
            </Link>
            .
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section k="league_name" title="League name" view={view}>
          {(v, set) => <Input aria-label="League name" value={v} maxLength={40} onChange={(e) => set(e.target.value)} />}
        </Section>

        <Section k="public_lobbies_enabled" title="Public lobbies" view={view}>
          {(v, set) => <Toggle checked={v} onChange={set} label="Allow public lobbies" description="Off hides the public list and makes hosts keep games private" />}
        </Section>

        <Section k="registrations_open" title="Registrations" view={view}>
          {(v, set) => <Toggle checked={v} onChange={set} label="Registrations open" description="Off stops new accounts; guests can still play" />}
        </Section>

        <Section k="formations_enabled" title="Enabled formations" view={view}>
          {(v, set) => (
            <div className="flex flex-wrap gap-2">
              {view.formations.map((f: FormationId) => {
                const on = v.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set(on ? v.filter((x) => x !== f) : view.formations.filter((x) => x === f || v.includes(x)))}
                    className={cx('min-h-11 rounded-xl px-4 font-display text-base font-bold ring-1 ring-inset', on ? 'bg-pitch-500 text-ink ring-pitch-500' : 'text-white/60 ring-white/15')}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        <div className="xl:col-span-2">
          <Section k="game_defaults" title="Default game settings" description="What a new game starts with. Hosts can change these within the limits." view={view}>
            {(v, set) => <SettingsForm value={v} onChange={set} limits={s.game_limits} formationsEnabled={s.formations_enabled} publicLobbiesEnabled={s.public_lobbies_enabled} />}
          </Section>
        </div>

        <Section k="game_limits" title="Ranges hosts can choose" view={view}>
          {(v, set) => (
            <div className="flex flex-col gap-2">
              {(Object.keys(LIMIT_LABELS) as (keyof GameLimits)[]).map((k) => {
                const [label, step] = LIMIT_LABELS[k];
                return (
                  <div key={k} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2">
                    <span className="text-sm text-white/80">{label}</span>
                    <NumberInput aria-label={`${label} minimum`} value={v[k][0]} step={step} onChange={(n) => n !== null && set({ ...v, [k]: [n, v[k][1]] })} />
                    <NumberInput aria-label={`${label} maximum`} value={v[k][1]} step={step} onChange={(n) => n !== null && set({ ...v, [k]: [v[k][0], n] })} />
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section k="ai_club_selection" title="AI club selection" description="How the clubs that fill the league are chosen." view={view}>
          {(v, set) => (
            <div className="flex flex-col gap-3">
              <Segmented
                label="Method"
                value={v.method}
                onChange={(method) => set({ ...v, method })}
                options={[
                  { value: 'top_by_strength', label: 'Strongest' },
                  { value: 'manual', label: 'Manual' },
                  { value: 'random', label: 'Random' },
                ]}
              />
              {v.method === 'manual' && (
                <div>
                  <p className="mb-2 text-xs text-white/50">Picked first, in this order; the strongest others fill any gap.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(clubs.data?.clubs ?? []).map((c) => {
                      const at = v.manualClubIds.indexOf(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={at >= 0}
                          onClick={() => set({ ...v, manualClubIds: at >= 0 ? v.manualClubIds.filter((x) => x !== c.id) : [...v.manualClubIds, c.id] })}
                          className={cx('min-h-9 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset', at >= 0 ? 'bg-pitch-500 text-ink ring-pitch-500' : 'text-white/70 ring-white/15')}
                        >
                          {at >= 0 && `${at + 1}. `}
                          {c.shortName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>

        <div className="xl:col-span-2">
          <Section k="sim_params" title="Simulation" description="Snapshotted into every new season. Try changes in the Simulation Lab first." view={view}>
            {(v, set) => <SimParamsEditor value={v} set={set} />}
          </Section>
        </div>

        <Section k="table_bands" title="Final table colour bands" description="Enabled bands cannot overlap." view={view}>
          {(v, set) => <BandsEditor value={v} set={set} />}
        </Section>

        <Section k="profanity_words" title="Profanity list" view={view}>
          {(v, set) => <ProfanityEditor value={v} set={set} />}
        </Section>
      </div>
    </>
  );
}
