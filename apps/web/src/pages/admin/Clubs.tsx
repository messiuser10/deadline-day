import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAX_TEAMS, MIN_TEAMS, POSITIONS, type Position } from '@deadline-day/engine';
import type { AdminClubsView, AdminClubView, SquadPlayerView } from '@deadline-day/protocol';
import { del, get, patch, post, put } from '../../lib/api';
import { inkOn } from '../../lib/format';
import { Button, Card, cx, Field, Input, Modal, Pill, Skeleton } from '../../components/ui';
import { AdminHeader, ConfirmButton, NumberInput, Select, useAdminMutation } from './parts';

const CLUBS_KEY = ['admin', 'clubs'];
const LEAGUE = 20;

/** The clubs the AI would field with N human teams (mirrors the server's selection rule). */
function aiClubIds(view: AdminClubsView, humans: number): Set<string> | null {
  const count = LEAGUE - humans;
  const { method, manualClubIds } = view.selection;
  if (method === 'random') return null;
  const ranked = view.clubs.map((c) => c.id);
  const picked = method === 'manual' ? manualClubIds.filter((id) => ranked.includes(id)).slice(0, count) : [];
  for (const id of ranked) if (picked.length < count && !picked.includes(id)) picked.push(id);
  return new Set(picked);
}

function Crest({ c, size = 'md' }: { c: Pick<AdminClubView, 'primaryColor' | 'secondaryColor' | 'monogram'>; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-lg font-display font-bold ring-2', size === 'lg' ? 'size-12 text-base' : 'size-9 text-xs')}
      style={{ background: c.primaryColor, color: inkOn(c.primaryColor), boxShadow: `inset 0 0 0 2px ${c.secondaryColor}` }}
    >
      {c.monogram}
    </span>
  );
}

function SquadEditor({ club }: { club: AdminClubView }) {
  const key = ['admin', 'squad', club.id];
  const q = useQuery({ queryKey: key, queryFn: async () => (await get<{ squad: SquadPlayerView[] }>(`/api/admin/clubs/${club.id}/squad`)).squad });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (q.isPending) return <Skeleton className="h-40" />;
  if (!q.data) return <p className="text-sm text-red-300">Could not load the squad.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white/80">Squad ({q.data.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          Add player
        </Button>
      </div>
      {editing === 'new' && <SquadPlayerForm clubId={club.id} onDone={() => setEditing(null)} />}
      <ul className="flex flex-col divide-y divide-white/5 rounded-xl bg-night-950/40 ring-1 ring-white/5">
        {q.data.map((p) => (
          <li key={p.id} className="px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-10 shrink-0 font-semibold text-white/70">{p.position}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.name}
                {p.altPositions.length > 0 && <span className="ml-1 text-xs text-white/40">{p.altPositions.join(' ')}</span>}
              </span>
              <span className="w-8 text-right font-display font-bold tabular-nums">{p.overall}</span>
              <button type="button" className="min-h-9 rounded-lg px-2 text-xs font-semibold text-pitch-400 hover:bg-white/10" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                {editing === p.id ? 'Close' : 'Edit'}
              </button>
            </div>
            {editing === p.id && <SquadPlayerForm clubId={club.id} player={p} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SquadPlayerForm({ clubId, player, onDone }: { clubId: string; player?: SquadPlayerView; onDone: () => void }) {
  const [name, setName] = useState(player?.name ?? '');
  const [position, setPosition] = useState<Position>(player?.position ?? 'CM');
  const [alts, setAlts] = useState<Position[]>(player?.altPositions ?? []);
  const [overall, setOverall] = useState<number | null>(player?.overall ?? 70);
  const [nationality, setNationality] = useState(player?.nationality ?? '');
  const inval = [['admin', 'squad', clubId], CLUBS_KEY, ['admin', 'overview']];
  const body = { name, position, altPositions: alts.filter((a) => a !== position), overall: overall ?? 0, nationality };
  const save = useAdminMutation(() => (player ? put(`/api/admin/clubs/${clubId}/squad/${player.id}`, body) : post(`/api/admin/clubs/${clubId}/squad`, body)), {
    invalidate: inval,
    success: player ? 'Player saved' : 'Player added',
    onSuccess: onDone,
  });
  const remove = useAdminMutation(() => del(`/api/admin/clubs/${clubId}/squad/${player!.id}`), { invalidate: inval, success: 'Player removed', onSuccess: onDone });
  return (
    <form
      className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-night-950/60 p-3 ring-1 ring-pitch-500/30"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="col-span-2">
        <Field label="Name">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
      </div>
      <Field label="Position">
        {(id) => (
          <Select id={id} value={position} onChange={(e) => setPosition(e.target.value as Position)}>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Overall">{(id) => <NumberInput id={id} value={overall} min={40} max={99} onChange={setOverall} />}</Field>
      <div className="col-span-2">
        <p className="mb-1 text-sm font-medium text-white/80">Can also play</p>
        <div className="flex flex-wrap gap-1">
          {POSITIONS.filter((p) => p !== position).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={alts.includes(p)}
              onClick={() => setAlts(alts.includes(p) ? alts.filter((a) => a !== p) : [...alts, p])}
              className={cx('min-h-8 rounded-lg px-2 text-xs font-semibold ring-1 ring-inset', alts.includes(p) ? 'bg-pitch-500 text-ink ring-pitch-500' : 'text-white/70 ring-white/15')}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="col-span-2">
        <Field label="Nationality">{(id) => <Input id={id} value={nationality} maxLength={40} onChange={(e) => setNationality(e.target.value)} />}</Field>
      </div>
      <div className="col-span-2 flex flex-wrap justify-end gap-2">
        {player && <ConfirmButton label="Remove" confirm="Tap to remove" onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} />}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" loading={save.isPending} disabled={name.trim().length < 2 || overall === null}>
          Save
        </Button>
      </div>
    </form>
  );
}

function ClubModal({ club, onClose }: { club: AdminClubView; onClose: () => void }) {
  const [primary, setPrimary] = useState(club.primaryColor);
  const [secondary, setSecondary] = useState(club.secondaryColor);
  const [monogram, setMonogram] = useState(club.monogram);
  const [override, setOverride] = useState<number | null>(club.override);
  const [notes, setNotes] = useState(club.notes ?? '');
  const save = useAdminMutation(
    () => patch(`/api/admin/clubs/${club.id}`, { primaryColor: primary, secondaryColor: secondary, monogram: monogram.toUpperCase(), strengthOverride: override, notes }),
    { invalidate: [CLUBS_KEY], success: `${club.name} saved` },
  );
  return (
    <Modal open onClose={onClose} title={club.name}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Crest c={{ primaryColor: primary, secondaryColor: secondary, monogram: monogram.toUpperCase() || '?' }} size="lg" />
          <p className="text-sm text-white/60">
            Rank {club.rank} · strength {club.strength} (computed {club.computedStrength}) · XI {club.xiAverage} in {club.formation}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary colour">
            {(id) => (
              <span className="flex items-center gap-2">
                <input id={id} type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-11 w-12 shrink-0 cursor-pointer rounded-lg bg-transparent" />
                <Input aria-label="Primary hex" value={primary} maxLength={7} onChange={(e) => setPrimary(e.target.value)} />
              </span>
            )}
          </Field>
          <Field label="Secondary colour">
            {(id) => (
              <span className="flex items-center gap-2">
                <input id={id} type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-11 w-12 shrink-0 cursor-pointer rounded-lg bg-transparent" />
                <Input aria-label="Secondary hex" value={secondary} maxLength={7} onChange={(e) => setSecondary(e.target.value)} />
              </span>
            )}
          </Field>
          <Field label="Monogram" hint="2 or 3 letters">
            {(id) => <Input id={id} value={monogram} maxLength={3} onChange={(e) => setMonogram(e.target.value)} />}
          </Field>
          <Field label="Strength override" hint="Empty uses the computed value">
            {(id) => <NumberInput id={id} value={override} min={0} max={100} step={0.5} placeholder={String(club.computedStrength)} onChange={setOverride} />}
          </Field>
          <div className="col-span-2">
            <Field label="Notes">{(id) => <Input id={id} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />}</Field>
          </div>
        </div>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
          Save club
        </Button>
        <SquadEditor club={club} />
      </div>
    </Modal>
  );
}

export function ClubsTab() {
  const q = useQuery({ queryKey: CLUBS_KEY, queryFn: () => get<AdminClubsView>('/api/admin/clubs') });
  const [humans, setHumans] = useState(6);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <p className="text-sm text-red-300">Could not load the clubs. Reload to try again.</p>;
  const ai = aiClubIds(q.data, humans);
  const club = q.data.clubs.find((c) => c.id === open);
  const method = q.data.selection.method;
  return (
    <>
      <AdminHeader title="Clubs and squads" description="Strength picks which clubs fill the league as AI teams. Edit colours, monograms, overrides and the AI squads." />
      <Card className="mb-4">
        <label htmlFor="n-slider" className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>
            With <span className="font-display text-xl font-bold text-pitch-400">{humans}</span> teams in the auction, {LEAGUE - humans} clubs are AI teams
          </span>
          <Pill tone="neutral">{method === 'top_by_strength' ? 'Top by strength' : method === 'manual' ? 'Manual list' : 'Random'}</Pill>
        </label>
        <input
          id="n-slider"
          type="range"
          min={MIN_TEAMS}
          max={MAX_TEAMS}
          value={humans}
          onChange={(e) => setHumans(Number(e.target.value))}
          className="mt-3 h-11 w-full accent-pitch-500"
        />
        <div className="flex justify-between text-xs text-white/40">
          <span>{MIN_TEAMS}</span>
          <span>{MAX_TEAMS}</span>
        </div>
        {method === 'random' && <p className="mt-2 text-xs text-gold">Random selection draws the AI clubs from each game's seed, so no fixed list applies.</p>}
      </Card>
      <Card className="!p-0 sm:!p-0">
        <ol className="divide-y divide-white/5">
          {q.data.clubs.map((c) => {
            const isAi = ai?.has(c.id) ?? false;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setOpen(c.id)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 sm:px-4', ai && !isAi && 'opacity-45')}>
                  <span className="w-6 shrink-0 text-right font-display text-base font-bold tabular-nums text-white/60">{c.rank}</span>
                  <Crest c={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-xs text-white/45">
                      XI {c.xiAverage} · {c.formation} · {c.squadSize} players
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block font-display text-lg font-bold">{c.strength}</span>
                    {c.override !== null ? <span className="block text-[0.7rem] text-gold">override</span> : <span className="block text-[0.7rem] text-white/40">computed</span>}
                  </span>
                  <span className="hidden w-16 shrink-0 text-right sm:block">{ai && (isAi ? <Pill tone="green">AI</Pill> : <Pill>out</Pill>)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>
      {club && <ClubModal key={club.id} club={club} onClose={() => setOpen(null)} />}
    </>
  );
}
