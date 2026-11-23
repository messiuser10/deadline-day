import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GROUPS, type Group } from '@deadline-day/engine';
import type { AdminPoolPlayer, AdminPoolView, PoolImportMode, PoolImportPreview, RepricePreview } from '@deadline-day/protocol';
import { del, get, patch, post } from '../../lib/api';
import { money } from '../../lib/format';
import { Button, Card, cx, ErrorText, Field, Input, Modal, Pill, Segmented, Skeleton, Toggle } from '../../components/ui';
import { AdminHeader, ConfirmButton, DownloadLink, EmptyRow, NumberInput, Select, Textarea, useAdminMutation } from './parts';

const POOL_KEY = ['admin', 'pool'];
const PAGE = 60;

function usePool() {
  return useQuery({ queryKey: POOL_KEY, queryFn: async () => (await get<{ pool: AdminPoolView }>('/api/admin/pool')).pool });
}

interface Draft {
  id: string;
  name: string;
  position: Group;
  altPositions: Group[];
  altSource: 'ea' | 'rule';
  overall: number | null;
  seedClub: string | null;
  clubNow: string;
  nationality: string;
  isActive: boolean;
}

const toDraft = (p: AdminPoolPlayer): Draft => ({
  id: p.id,
  name: p.name,
  position: p.position,
  altPositions: p.altPositions,
  altSource: p.altSource,
  overall: p.overall,
  seedClub: p.seedClub,
  clubNow: p.clubNow ?? '',
  nationality: p.nationality ?? '',
  isActive: p.isActive,
});

const blank: Draft = { id: '', name: '', position: 'ST', altPositions: [], altSource: 'rule', overall: 75, seedClub: null, clubNow: '', nationality: '', isActive: true };

/** Suggested id for a new player: name and position as lowercase words with dashes. */
const suggestId = (name: string, position: string) =>
  `${name} ${position}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function PlayerEditor({ initial, isNew, clubs, onDone }: { initial: Draft; isNew: boolean; clubs: AdminPoolView['clubs']; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [idTouched, setIdTouched] = useState(!isNew);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const body = {
    name: d.name,
    position: d.position,
    altPositions: d.altPositions.filter((a) => a !== d.position),
    altSource: d.altSource,
    overall: d.overall ?? 0,
    seedClub: d.seedClub,
    clubNow: d.clubNow,
    nationality: d.nationality,
    isActive: d.isActive,
  };
  const save = useAdminMutation(
    () => (isNew ? post('/api/admin/pool', { id: d.id, ...body }) : patch(`/api/admin/pool/${initial.id}`, body)),
    { invalidate: [POOL_KEY, ['admin', 'overview']], success: isNew ? `${d.name} added` : `${d.name} saved`, onSuccess: onDone },
  );
  const toggleAlt = (g: Group) => set('altPositions', d.altPositions.includes(g) ? d.altPositions.filter((a) => a !== g) : [...d.altPositions, g]);
  return (
    <form
      className="grid gap-3 rounded-2xl bg-night-950/60 p-3 ring-1 ring-pitch-500/30 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={d.name}
            maxLength={60}
            onChange={(e) => {
              const name = e.target.value;
              setD((x) => ({ ...x, name, id: idTouched ? x.id : suggestId(name, x.position) }));
            }}
          />
        )}
      </Field>
      <Field label="Id" hint={isNew ? 'Lowercase words and dashes; cannot change later' : 'Fixed'}>
        {(id) => (
          <Input
            id={id}
            value={d.id}
            disabled={!isNew}
            onChange={(e) => {
              setIdTouched(true);
              set('id', e.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Position">
        {(id) => (
          <Select
            id={id}
            value={d.position}
            onChange={(e) => {
              const position = e.target.value as Group;
              setD((x) => ({ ...x, position, id: idTouched ? x.id : suggestId(x.name, position) }));
            }}
          >
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Overall" hint="Prices follow the price curve">
        {(id) => <NumberInput id={id} value={d.overall} min={40} max={99} onChange={(v) => set('overall', v)} />}
      </Field>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-sm font-medium text-white/80">Alternate positions</p>
        <div className="flex flex-wrap gap-1">
          {GROUPS.filter((g) => g !== d.position).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={d.altPositions.includes(g)}
              onClick={() => toggleAlt(g)}
              className={cx('min-h-9 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset', d.altPositions.includes(g) ? 'bg-pitch-500 text-ink ring-pitch-500' : 'text-white/70 ring-white/15 hover:text-white')}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <Field label="Alternates from">
        {(id) => (
          <Select id={id} value={d.altSource} onChange={(e) => set('altSource', e.target.value as 'ea' | 'rule')}>
            <option value="ea">EA data</option>
            <option value="rule">Rule</option>
          </Select>
        )}
      </Field>
      <Field label="AI club" hint="Removed from that club's AI squad when bought">
        {(id) => (
          <Select id={id} value={d.seedClub ?? ''} onChange={(e) => set('seedClub', e.target.value || null)}>
            <option value="">None</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Club now">{(id) => <Input id={id} value={d.clubNow} maxLength={60} onChange={(e) => set('clubNow', e.target.value)} />}</Field>
      <Field label="Nationality">{(id) => <Input id={id} value={d.nationality} maxLength={40} onChange={(e) => set('nationality', e.target.value)} />}</Field>
      <div className="flex items-end">
        <Toggle checked={d.isActive} onChange={(v) => set('isActive', v)} label="Active" description="Inactive players never enter a new auction" />
      </div>
      <div className="flex flex-wrap items-end justify-end gap-2 sm:col-span-2 lg:col-span-1">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={!d.name.trim() || d.overall === null}>
          {isNew ? 'Add player' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [mode, setMode] = useState<PoolImportMode>('upsert');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PoolImportPreview | null>(null);
  const reset = () => setPreview(null);
  const body = { format, mode, content };
  const run = useAdminMutation(async () => (await post<{ preview: PoolImportPreview }>('/api/admin/pool/import/preview', body)).preview, { onSuccess: setPreview });
  const apply = useAdminMutation(async () => (await post<{ preview: PoolImportPreview }>('/api/admin/pool/import/apply', body)).preview, {
    invalidate: [POOL_KEY, ['admin', 'overview']],
    success: (p) => `Imported: ${p.added.length} added, ${p.changed.length} changed, ${p.deactivated.length} deactivated`,
    onSuccess: () => {
      setPreview(null);
      setContent('');
      setFileName(null);
      onClose();
    },
  });
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
    setContent(await file.text());
    reset();
  };
  const nothing = preview && !preview.added.length && !preview.changed.length && !preview.deactivated.length;
  return (
    <Modal open={open} onClose={onClose} title="Import pool players">
      <div className="flex flex-col gap-3">
        <Segmented
          label="Mode"
          value={mode}
          onChange={(m) => {
            setMode(m);
            reset();
          }}
          options={[
            { value: 'upsert', label: 'Add or update' },
            { value: 'replace', label: 'Replace all' },
            { value: 'alt_positions', label: 'Alt positions' },
          ]}
        />
        <p className="text-xs text-white/50">
          {mode === 'upsert' && 'Adds new ids and updates existing ones. Players not in the file stay as they are.'}
          {mode === 'replace' && 'Like add or update, and also deactivates every active player missing from the file.'}
          {mode === 'alt_positions' && 'Only reads id and alt_positions (and alt_source, default ea), e.g. from an EA data refresh.'}
          {' '}Prices are always recomputed from overall with the current curve.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center rounded-xl bg-white/10 px-3 text-sm font-semibold ring-1 ring-inset ring-white/10 hover:bg-white/15">
            Choose file
            <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" onChange={(e) => void onFile(e)} />
          </label>
          <span className="min-w-0 truncate text-sm text-white/60">{fileName ?? 'or paste below'}</span>
          <Select aria-label="Format" value={format} onChange={(e) => (setFormat(e.target.value as 'csv' | 'json'), reset())} className="ml-auto w-24">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
        </div>
        <Textarea
          aria-label="File contents"
          rows={5}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setFileName(null);
            reset();
          }}
          placeholder="id,name,position,alt_positions,alt_source,overall,..."
        />
        <Button variant="secondary" onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={!content.trim()}>
          Preview changes
        </Button>

        {preview && (
          <div className="flex flex-col gap-2 rounded-2xl bg-night-950/50 p-3 ring-1 ring-white/5">
            <p className="text-sm">
              <span className="font-semibold">{preview.rows} rows:</span> <span className="text-pitch-400">{preview.added.length} new</span>, <span className="text-gold">{preview.changed.length} changed</span>,{' '}
              <span className="text-red-300">{preview.deactivated.length} deactivated</span>, {preview.unchanged} unchanged
            </p>
            {preview.errors.length > 0 && (
              <ErrorText>
                <span className="font-semibold">{preview.errors.length} error(s) block the import:</span>
                <span className="mt-1 block max-h-32 overflow-y-auto text-xs">
                  {preview.errors.map((e) => (
                    <span key={e} className="block">
                      {e}
                    </span>
                  ))}
                </span>
              </ErrorText>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="rounded-xl bg-gold-400/10 px-3 py-2 text-xs text-gold ring-1 ring-inset ring-gold-400/20">
                {w}
              </p>
            ))}
            {preview.added.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-pitch-400">New players</summary>
                <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-white/70">
                  {preview.added.map((a) => (
                    <li key={a.id}>
                      {a.name} · {a.position} {a.overall} <span className="text-white/40">{a.id}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.changed.length > 0 && (
              <details open={preview.changed.length <= 10}>
                <summary className="cursor-pointer text-sm font-semibold text-gold">Changes</summary>
                <ul className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
                  {preview.changed.map((c) => (
                    <li key={c.id} className="rounded-lg bg-white/5 px-2 py-1">
                      <span className="font-semibold">{c.name}</span>
                      {c.changes.map((f) => (
                        <span key={f.field} className="block text-white/60">
                          {f.field}: <span className="text-red-300 line-through">{String(f.from ?? '–')}</span> → <span className="text-pitch-400">{String(f.to ?? '–')}</span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.deactivated.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-red-300">Deactivated</summary>
                <p className="mt-1 max-h-32 overflow-y-auto text-xs text-white/60">{preview.deactivated.map((d) => d.name).join(', ')}</p>
              </details>
            )}
            <Button onClick={() => apply.mutate(undefined)} loading={apply.isPending} disabled={preview.errors.length > 0 || !!nothing}>
              {nothing ? 'Nothing to change' : 'Apply import'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RepriceModal({ open, onClose, current }: { open: boolean; onClose: () => void; current: { anchor: number; growth: number; baseFraction: number } }) {
  const [p, setP] = useState(current);
  const [preview, setPreview] = useState<RepricePreview | null>(null);
  const valid = p.anchor >= 1 && p.growth >= 1 && p.growth <= 1.5 && p.baseFraction >= 0.05 && p.baseFraction <= 1;
  const run = useAdminMutation(async () => (await post<{ preview: RepricePreview }>('/api/admin/pool/reprice/preview', p)).preview, { onSuccess: setPreview });
  const apply = useAdminMutation(async () => (await post<{ preview: RepricePreview }>('/api/admin/pool/reprice/apply', p)).preview, {
    invalidate: [POOL_KEY, ['admin', 'overview'], ['admin', 'settings']],
    success: (r) => `Repriced ${r.changedPlayers} players`,
    onSuccess: onClose,
  });
  const set = (k: keyof typeof p, v: number | null) => {
    setP((x) => ({ ...x, [k]: v ?? 0 }));
    setPreview(null);
  };
  const rows = preview?.curve.filter((c) => c.overall % 5 === 0 || c.overall >= 90) ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Reprice tool">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-white/60">
          market value = round(anchor × growth^(overall − 80)); base price = round(base fraction × market value). In $ millions. Applying saves the curve and reprices every pool player; frozen game pools are not touched.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Anchor">{(id) => <NumberInput id={id} value={p.anchor} min={1} max={1000} onChange={(v) => set('anchor', v)} />}</Field>
          <Field label="Growth">{(id) => <NumberInput id={id} value={p.growth} min={1} max={1.5} step={0.005} onChange={(v) => set('growth', v)} />}</Field>
          <Field label="Base fraction">{(id) => <NumberInput id={id} value={p.baseFraction} min={0.05} max={1} step={0.05} onChange={(v) => set('baseFraction', v)} />}</Field>
        </div>
        <Button variant="secondary" onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={!valid}>
          Preview new prices
        </Button>
        {preview && (
          <>
            <p className="text-sm">
              <span className="font-semibold">{preview.changedPlayers}</span> players change. Active pool value {money(preview.activeMarketValueM.before)} → <span className="font-semibold">{money(preview.activeMarketValueM.after)}</span>
            </p>
            <div className="max-h-64 overflow-y-auto rounded-xl ring-1 ring-white/5">
              <table className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 bg-night-800">
                  <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                    <th className="px-2 py-1.5 font-medium" scope="col">OVR</th>
                    <th className="px-2 py-1.5 text-right font-medium" scope="col">Value</th>
                    <th className="px-2 py-1.5 text-right font-medium" scope="col">Base price</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.overall} className="border-t border-white/5">
                      <td className="px-2 py-1">{c.overall}</td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-white/40">{money(c.oldMarketValueM)} → </span>
                        <span className={c.marketValueM !== c.oldMarketValueM ? 'font-semibold' : ''}>{money(c.marketValueM)}</span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-white/40">{money(c.oldBasePriceM)} → </span>
                        <span className={c.basePriceM !== c.oldBasePriceM ? 'font-semibold' : ''}>{money(c.basePriceM)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button onClick={() => apply.mutate(undefined)} loading={apply.isPending}>
              Apply to every pool player
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function BulkBar({ ids, clear }: { ids: string[]; clear: () => void }) {
  const [shift, setShift] = useState<number | null>(1);
  const bulk = useAdminMutation((body: Record<string, unknown>) => post<{ changed: number; skipped: { id: string; reason: string }[] }>('/api/admin/pool/bulk', { ids, ...body }), {
    invalidate: [POOL_KEY, ['admin', 'overview']],
    success: (r) => `${r.changed} changed${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped[0]!.reason})` : ''}`,
    onSuccess: clear,
  });
  return (
    <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-night-700 p-2 shadow-xl ring-1 ring-pitch-500/40">
      <span className="px-1 text-sm font-semibold">{ids.length} selected</span>
      <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ action: 'activate' })}>
        Activate
      </Button>
      <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ action: 'deactivate' })}>
        Deactivate
      </Button>
      <span className="flex items-center gap-1">
        <NumberInput aria-label="Change overall by" value={shift} min={-20} max={20} onChange={setShift} className="!min-h-9 w-16" />
        <Button size="sm" variant="secondary" disabled={!shift} onClick={() => bulk.mutate({ action: 'shift_overall', by: shift })}>
          Shift OVR
        </Button>
      </span>
      <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ action: 'set_alt_source', altSource: 'ea' })}>
        Alts: EA
      </Button>
      <ConfirmButton label="Delete" confirm={`Tap again to delete ${ids.length}`} onConfirm={() => bulk.mutate({ action: 'delete' })} loading={bulk.isPending} />
      <Button size="sm" variant="ghost" onClick={clear} className="ml-auto">
        Clear
      </Button>
    </div>
  );
}

export function PoolTab() {
  const q = usePool();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => get<{ settings: { price_curve: { anchor: number; growth: number; baseFraction: number } } }>('/api/admin/settings') });
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<Group | ''>('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive' | 'duplicates'>('active');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [repriceOpen, setRepriceOpen] = useState(false);
  const remove = useAdminMutation((id: string) => del(`/api/admin/pool/${id}`), { invalidate: [POOL_KEY, ['admin', 'overview']], success: 'Player deleted' });

  const dupIds = useMemo(() => new Set(q.data?.duplicates.flat() ?? []), [q.data]);
  const clubName = useMemo(() => new Map(q.data?.clubs.map((c) => [c.id, c.name]) ?? []), [q.data]);
  const rows = useMemo(() => {
    if (!q.data) return [];
    const s = search.trim().toLowerCase();
    return q.data.players
      .filter((p) => (status === 'all' ? true : status === 'active' ? p.isActive : status === 'inactive' ? !p.isActive : dupIds.has(p.id)))
      .filter((p) => !position || p.position === position)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.id.includes(s) || (p.clubNow ?? '').toLowerCase().includes(s))
      .sort((a, b) => b.overall - a.overall || a.position.localeCompare(b.position) || a.positionRank - b.positionRank);
  }, [q.data, search, position, status, dupIds]);

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <p className="text-sm text-red-300">Could not load the pool. Reload to try again.</p>;
  const shown = rows.slice(0, limit);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = shown.length > 0 && shown.every((p) => selected.has(p.id));

  return (
    <>
      <AdminHeader
        title="Pool players"
        description={`${q.data.players.filter((p) => p.isActive).length} active of ${q.data.players.length}. Prices always follow the price curve; ranks are recomputed after every change.`}
        actions={
          <>
            <Button size="sm" onClick={() => (setAdding(true), setEditing(null))}>
              Add player
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <DownloadLink href="/api/admin/pool/export?format=csv">CSV</DownloadLink>
            <DownloadLink href="/api/admin/pool/export?format=json">JSON</DownloadLink>
            <Button size="sm" variant="secondary" onClick={() => setRepriceOpen(true)} disabled={!settings.data}>
              Reprice
            </Button>
          </>
        }
      />

      {q.data.duplicates.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 text-sm text-gold ring-1 ring-inset ring-gold-400/20">
          {q.data.duplicates.length} possible duplicate{q.data.duplicates.length === 1 ? '' : 's'} (same name and position).
          <button type="button" className="font-semibold underline" onClick={() => setStatus('duplicates')}>
            Show them
          </button>
        </p>
      )}

      {adding && (
        <div className="mb-3">
          <PlayerEditor initial={blank} isNew clubs={q.data.clubs} onDone={() => setAdding(false)} />
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input aria-label="Search players" placeholder="Search name, id or club" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} className="col-span-2 sm:col-span-1" />
        <Select aria-label="Position" value={position} onChange={(e) => (setPosition(e.target.value as Group | ''), setLimit(PAGE))} className="sm:w-32">
          <option value="">All positions</option>
          {GROUPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setLimit(PAGE))} className="sm:w-36">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
          <option value="duplicates">Duplicates</option>
        </Select>
      </div>

      {selected.size > 0 && <BulkBar ids={[...selected]} clear={() => setSelected(new Set())} />}

      <Card className="!p-0 sm:!p-0">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyRow>No players match.</EmptyRow>
          </div>
        ) : (
          <table className="w-full table-fixed text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-white/45">
                <th className="w-10 py-2 pl-3" scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShown}
                    onChange={() => setSelected(allShown ? new Set() : new Set([...selected, ...shown.map((p) => p.id)]))}
                    className="size-4 accent-pitch-500"
                  />
                </th>
                <th className="py-2 font-medium" scope="col">Player</th>
                <th className="w-12 py-2 font-medium" scope="col">Pos</th>
                <th className="hidden w-24 py-2 font-medium md:table-cell" scope="col">Alts</th>
                <th className="w-11 py-2 text-right font-medium" scope="col">OVR</th>
                <th className="hidden w-12 py-2 text-right font-medium sm:table-cell" scope="col">Rank</th>
                <th className="hidden w-16 py-2 text-right font-medium sm:table-cell" scope="col">Value</th>
                <th className="w-14 py-2 text-right font-medium" scope="col">Base</th>
                <th className="hidden w-36 py-2 pl-3 font-medium lg:table-cell" scope="col">AI club</th>
                <th className="w-16 py-2 pr-3 text-right font-medium sm:w-28" scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <PoolRow
                  key={p.id}
                  p={p}
                  club={p.seedClub ? (clubName.get(p.seedClub) ?? p.seedClub) : null}
                  dup={dupIds.has(p.id)}
                  selected={selected.has(p.id)}
                  onSelect={() => toggle(p.id)}
                  editing={editing === p.id}
                  onEdit={() => (setEditing(editing === p.id ? null : p.id), setAdding(false))}
                  onDelete={() => remove.mutate(p.id)}
                  editor={<PlayerEditor initial={toDraft(p)} isNew={false} clubs={q.data.clubs} onDone={() => setEditing(null)} />}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {rows.length > shown.length && (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Show more ({rows.length - shown.length} left)
          </Button>
        </div>
      )}

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      {settings.data && repriceOpen && <RepriceModal open onClose={() => setRepriceOpen(false)} current={settings.data.settings.price_curve} />}
    </>
  );
}

function PoolRow({
  p,
  club,
  dup,
  selected,
  onSelect,
  editing,
  onEdit,
  onDelete,
  editor,
}: {
  p: AdminPoolPlayer;
  club: string | null;
  dup: boolean;
  selected: boolean;
  onSelect: () => void;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  editor: ReactNode;
}) {
  return (
    <>
      <tr className={cx('border-t border-white/5', !p.isActive && 'text-white/45', selected && 'bg-pitch-500/10')}>
        <td className="py-2 pl-3">
          <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected} onChange={onSelect} className="size-4 accent-pitch-500" />
        </td>
        <td className="py-2 pr-2">
          <span className="block truncate font-semibold">
            {p.name}
            {dup && (
              <span className="ml-1.5 align-middle">
                <Pill tone="gold">dup?</Pill>
              </span>
            )}
            {!p.isActive && (
              <span className="ml-1.5 align-middle">
                <Pill>off</Pill>
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-white/40">
            {p.id}
            {p.games > 0 && ` · in ${p.games} game${p.games === 1 ? '' : 's'}`}
          </span>
        </td>
        <td className="py-2 font-semibold">{p.position}</td>
        <td className="hidden truncate py-2 text-xs text-white/60 md:table-cell" title={`${p.altPositions.join(', ')} (${p.altSource})`}>
          {p.altPositions.join(' ') || '–'}
        </td>
        <td className="py-2 text-right font-display text-base font-bold">{p.overall}</td>
        <td className="hidden py-2 text-right text-white/60 sm:table-cell">{p.positionRank}</td>
        <td className="hidden py-2 text-right sm:table-cell">{money(p.marketValueM)}</td>
        <td className="py-2 text-right">{money(p.basePriceM)}</td>
        <td className="hidden truncate py-2 pl-3 text-xs text-white/60 lg:table-cell">{club ?? '–'}</td>
        <td className="py-2 pr-3 text-right">
          <span className="inline-flex gap-1">
            <button type="button" onClick={onEdit} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-pitch-400 hover:bg-white/10" aria-expanded={editing}>
              {editing ? 'Close' : 'Edit'}
            </button>
            <span className="hidden sm:inline">
              {p.games === 0 && <ConfirmButton label="Delete" confirm="Sure?" onConfirm={onDelete} />}
            </span>
          </span>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={10} className="px-2 pb-3">
            {editor}
          </td>
        </tr>
      )}
    </>
  );
}
