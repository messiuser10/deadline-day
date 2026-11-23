/**
 * Admin: the master auction pool (section 11, tab 2). Prices always follow the price curve and
 * position ranks are recomputed after every change, so the pool never drifts from the rules.
 */
import { count, eq, inArray } from 'drizzle-orm';
import {
  GROUPS,
  normalizeName,
  parseCsvRecords,
  parseMasterRows,
  prices,
  unwrapPlayers,
  worstCaseNeeds,
  planFromNeeds,
  MAX_TEAMS,
  type Group,
  type PriceParams,
} from '@deadline-day/engine';
import {
  poolIdSchema,
  type AdminPoolPlayer,
  type AdminPoolView,
  type FieldChange,
  type PoolBulkInput,
  type PoolImportPreview,
  type PoolPlayerCreate,
  type PoolPlayerPatch,
  type RepricePreview,
} from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { appSettings, clubs, gamePool, poolPlayers } from '../db/schema';
import { badRequest, conflict, notFound } from '../errors';
import { toCsv } from '../games/results';
import type { GameService } from '../games/service';

type PoolRow = typeof poolPlayers.$inferSelect;
type PoolInsert = typeof poolPlayers.$inferInsert;

const EXPORT_COLUMNS = [
  'id',
  'name',
  'position',
  'alt_positions',
  'alt_source',
  'overall',
  'position_rank',
  'market_value_m',
  'base_price_m',
  'seed_club',
  'club_now',
  'nationality',
  'is_active',
] as const;

const GROUP_ORDER = new Map(GROUPS.map((g, i) => [g, i]));
const MAX_LISTED = 40;
const isGroup = (v: string): v is Group => GROUP_ORDER.has(v as Group);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
/** Exports defuse spreadsheet formulas with a leading apostrophe; imports take it off again. */
const undefuse = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
const parseBool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null;
};

/** Fields an import can change, as stored on the row. */
interface ImportFields {
  name: string;
  position: Group;
  altPositions: Group[];
  altSource: 'ea' | 'rule';
  overall: number;
  seedClub: string | null;
  clubNow: string | null;
  nationality: string | null;
  isActive: boolean | null;
}

interface ParsedImport {
  preview: PoolImportPreview;
  /** id -> new field values (only for added or changed rows). */
  writes: Map<string, ImportFields>;
  deactivate: string[];
}

export class PoolAdmin {
  constructor(
    private readonly db: Db,
    private readonly games: GameService,
  ) {}

  private curve(): PriceParams {
    return this.games.appSettings().price_curve;
  }

  private rows(): PoolRow[] {
    return this.db.select().from(poolPlayers).all();
  }

  private clubIndex(): { byKey: Map<string, string>; list: { id: string; name: string }[] } {
    const list = this.db.select({ id: clubs.id, name: clubs.name }).from(clubs).all();
    const byKey = new Map<string, string>();
    for (const c of list) {
      byKey.set(c.id, c.id);
      byKey.set(c.name.toLowerCase(), c.id);
      byKey.set(normalizeName(c.name), c.id);
    }
    return { byKey, list: list.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  private resolveClub(value: string | null, index: Map<string, string>): string | null | undefined {
    if (!value) return null;
    return index.get(value) ?? index.get(value.toLowerCase()) ?? index.get(normalizeName(value));
  }

  private gameCounts(): Map<string, number> {
    return new Map(
      this.db
        .select({ id: gamePool.poolPlayerId, n: count() })
        .from(gamePool)
        .groupBy(gamePool.poolPlayerId)
        .all()
        .map((r) => [r.id, r.n]),
    );
  }

  private view(r: PoolRow, games: Map<string, number>): AdminPoolPlayer {
    return {
      id: r.id,
      name: r.name,
      position: r.position as Group,
      altPositions: r.altPositions as Group[],
      altSource: r.altSource,
      overall: r.overall,
      positionRank: r.positionRank,
      marketValueM: r.marketValueM,
      basePriceM: r.basePriceM,
      seedClub: r.seedClub,
      clubNow: r.clubNow,
      nationality: r.nationality,
      isActive: r.isActive,
      games: games.get(r.id) ?? 0,
    };
  }

  list(): AdminPoolView {
    const games = this.gameCounts();
    const rows = this.rows().sort(
      (a, b) => (GROUP_ORDER.get(a.position as Group) ?? 99) - (GROUP_ORDER.get(b.position as Group) ?? 99) || a.positionRank - b.positionRank,
    );
    // Same normalized name and position: two real players can share a name (e.g. a keeper and a midfielder).
    const byName = new Map<string, string[]>();
    for (const r of rows) {
      const key = `${normalizeName(r.name)}|${r.position}`;
      byName.set(key, [...(byName.get(key) ?? []), r.id]);
    }
    return {
      players: rows.map((r) => this.view(r, games)),
      duplicates: [...byName.values()].filter((ids) => ids.length > 1),
      clubs: this.clubIndex().list,
    };
  }

  private get(id: string): PoolRow {
    const row = this.db.select().from(poolPlayers).where(eq(poolPlayers.id, id)).get();
    if (!row) throw notFound('PLAYER_NOT_FOUND', 'No pool player with that id');
    return row;
  }

  /** Position ranks: overall (high first), then the previous rank, then id. Only rows that move are written. */
  private rerank(tx: Pick<Db, 'select' | 'update'>): void {
    const all = tx.select({ id: poolPlayers.id, position: poolPlayers.position, overall: poolPlayers.overall, rank: poolPlayers.positionRank }).from(poolPlayers).all();
    for (const g of GROUPS) {
      const rows = all.filter((r) => r.position === g).sort((a, b) => b.overall - a.overall || a.rank - b.rank || a.id.localeCompare(b.id));
      rows.forEach((r, i) => {
        if (r.rank !== i + 1) tx.update(poolPlayers).set({ positionRank: i + 1 }).where(eq(poolPlayers.id, r.id)).run();
      });
    }
  }

  private changed(admin: UserRow, action: string, target: string | null, details: Record<string, unknown>): void {
    audit(this.db, { actorUserId: admin.id, action, target, details });
    this.games.reference.invalidate();
  }

  create(admin: UserRow, input: PoolPlayerCreate & { altPositions: Group[] }): AdminPoolPlayer {
    if (this.db.select({ id: poolPlayers.id }).from(poolPlayers).where(eq(poolPlayers.id, input.id)).get()) {
      throw conflict('DUPLICATE_ID', `A pool player with id ${input.id} already exists`);
    }
    const index = this.clubIndex().byKey;
    const seedClub = this.resolveClub(input.seedClub ?? null, index);
    if (seedClub === undefined) throw badRequest('UNKNOWN_CLUB', `${input.seedClub} is not one of the 20 clubs`);
    const row: PoolInsert = {
      id: input.id,
      name: input.name,
      position: input.position,
      altPositions: input.altPositions,
      altSource: input.altSource,
      overall: input.overall,
      positionRank: 1_000_000,
      ...prices(input.overall, this.curve()),
      seedClub,
      clubNow: input.clubNow ?? null,
      nationality: input.nationality ?? null,
      isActive: input.isActive,
    };
    this.db.transaction((tx) => {
      tx.insert(poolPlayers).values(row).run();
      this.rerank(tx);
    });
    this.changed(admin, 'admin.pool.create', input.id, { name: input.name, position: input.position, overall: input.overall });
    return this.view(this.get(input.id), this.gameCounts());
  }

  update(admin: UserRow, id: string, patch: PoolPlayerPatch & { altPositions?: Group[] }): AdminPoolPlayer {
    const row = this.get(id);
    const index = this.clubIndex().byKey;
    const next = { ...row };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.position !== undefined) next.position = patch.position;
    if (patch.altPositions !== undefined) next.altPositions = patch.altPositions;
    if (patch.altSource !== undefined) next.altSource = patch.altSource;
    if (patch.overall !== undefined) next.overall = patch.overall;
    if (patch.clubNow !== undefined) next.clubNow = patch.clubNow;
    if (patch.nationality !== undefined) next.nationality = patch.nationality;
    if (patch.isActive !== undefined) next.isActive = patch.isActive;
    if (patch.seedClub !== undefined) {
      const club = this.resolveClub(patch.seedClub, index);
      if (club === undefined) throw badRequest('UNKNOWN_CLUB', `${patch.seedClub} is not one of the 20 clubs`);
      next.seedClub = club;
    }
    if ((next.altPositions as string[]).includes(next.position)) throw badRequest('ALT_IS_MAIN', 'An alternate cannot be the main position');
    Object.assign(next, prices(next.overall, this.curve()));
    const changes = diffRows(row, next);
    if (!changes.length) return this.view(row, this.gameCounts());
    this.db.transaction((tx) => {
      const { id: _id, ...set } = next;
      tx.update(poolPlayers).set(set).where(eq(poolPlayers.id, id)).run();
      if (row.overall !== next.overall || row.position !== next.position) this.rerank(tx);
    });
    this.changed(admin, 'admin.pool.update', id, { changes });
    return this.view(this.get(id), this.gameCounts());
  }

  remove(admin: UserRow, id: string): void {
    const row = this.get(id);
    if ((this.gameCounts().get(id) ?? 0) > 0) {
      throw conflict('PLAYER_IN_USE', `${row.name} is in a game's auction pool. Deactivate him instead.`);
    }
    this.db.transaction((tx) => {
      tx.delete(poolPlayers).where(eq(poolPlayers.id, id)).run();
      this.rerank(tx);
    });
    this.changed(admin, 'admin.pool.delete', id, { name: row.name });
  }

  bulk(admin: UserRow, input: PoolBulkInput): { changed: number; skipped: { id: string; reason: string }[] } {
    const ids = [...new Set(input.ids)];
    const rows = this.db.select().from(poolPlayers).where(inArray(poolPlayers.id, ids)).all();
    const skipped: { id: string; reason: string }[] = ids.filter((id) => !rows.some((r) => r.id === id)).map((id) => ({ id, reason: 'Not found' }));
    let changed = 0;
    const curve = this.curve();
    const used = this.gameCounts();
    this.db.transaction((tx) => {
      for (const r of rows) {
        switch (input.action) {
          case 'activate':
          case 'deactivate': {
            const isActive = input.action === 'activate';
            if (r.isActive !== isActive) {
              tx.update(poolPlayers).set({ isActive }).where(eq(poolPlayers.id, r.id)).run();
              changed++;
            }
            break;
          }
          case 'delete':
            if ((used.get(r.id) ?? 0) > 0) skipped.push({ id: r.id, reason: 'In a game pool; deactivate instead' });
            else {
              tx.delete(poolPlayers).where(eq(poolPlayers.id, r.id)).run();
              changed++;
            }
            break;
          case 'set_alt_source':
            if (r.altSource !== input.altSource) {
              tx.update(poolPlayers).set({ altSource: input.altSource }).where(eq(poolPlayers.id, r.id)).run();
              changed++;
            }
            break;
          case 'shift_overall': {
            const overall = Math.max(40, Math.min(99, r.overall + input.by));
            if (overall !== r.overall) {
              tx.update(poolPlayers)
                .set({ overall, ...prices(overall, curve) })
                .where(eq(poolPlayers.id, r.id))
                .run();
              changed++;
            }
            break;
          }
        }
      }
      if (input.action === 'delete' || input.action === 'shift_overall') this.rerank(tx);
    });
    this.changed(admin, 'admin.pool.bulk', null, { action: input.action, requested: ids.length, changed, skipped: skipped.length });
    return { changed, skipped };
  }

  // -------------------------------------------------------------------------
  // Export and import

  exportFile(format: 'csv' | 'json'): { filename: string; contentType: string; body: string } {
    const clubNames = new Map(this.clubIndex().list.map((c) => [c.id, c.name]));
    const rows = this.list().players.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      alt_positions: p.altPositions.join('|'),
      alt_source: p.altSource,
      overall: p.overall,
      position_rank: p.positionRank,
      market_value_m: p.marketValueM,
      base_price_m: p.basePriceM,
      seed_club: p.seedClub ? (clubNames.get(p.seedClub) ?? p.seedClub) : '',
      club_now: p.clubNow ?? '',
      nationality: p.nationality ?? '',
      is_active: p.isActive,
    }));
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const c = this.curve();
      const body = JSON.stringify(
        {
          source: 'Deadline Day admin export',
          exported_at: new Date().toISOString(),
          price_formula: `market_value_m = floor(${c.anchor} * ${c.growth}^(overall-80) + 0.5); base_price_m = floor(${c.baseFraction} * market_value_m + 0.5); $ millions`,
          players: rows,
        },
        null,
        2,
      );
      return { filename: `auction-players-${date}.json`, contentType: 'application/json; charset=utf-8', body };
    }
    const body = toCsv([[...EXPORT_COLUMNS], ...rows.map((r) => EXPORT_COLUMNS.map((k) => (typeof r[k] === 'boolean' ? String(r[k]) : r[k])))]);
    return { filename: `auction-players-${date}.csv`, contentType: 'text/csv; charset=utf-8', body };
  }

  private readRecords(format: 'csv' | 'json', content: string): Record<string, unknown>[] {
    const text = content.replace(/^\uFEFF/, '');
    try {
      const raw = format === 'csv' ? parseCsvRecords(text) : unwrapPlayers(JSON.parse(text));
      return raw.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}));
    } catch (err) {
      throw badRequest('IMPORT_UNREADABLE', `Could not read the ${format.toUpperCase()} file: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  private parseImport(input: { format: 'csv' | 'json'; mode: 'upsert' | 'replace' | 'alt_positions'; content: string }): ParsedImport {
    const records = this.readRecords(input.format, input.content);
    const existing = new Map(this.rows().map((r) => [r.id, r]));
    const errors: string[] = [];
    const warnings: string[] = [];
    const writes = new Map<string, ImportFields>();
    const seen = new Set<string>();
    const curve = this.curve();
    const clubIndex = this.clubIndex().byKey;
    let priceMismatches = 0;
    const err = (i: number, id: unknown, msg: string) => errors.push(`Row ${i + 2}${id ? ` (${String(id)})` : ''}: ${msg}`);

    if (!records.length) errors.push('The file has no rows');

    records.forEach((rec, i) => {
      const id = String(rec.id ?? '').trim();
      if (!poolIdSchema.safeParse(id).success) return err(i, id, 'id must be lowercase letters, digits and dashes');
      if (seen.has(id)) return err(i, id, 'the same id appears twice in the file');
      seen.add(id);
      const current = existing.get(id);

      if (input.mode === 'alt_positions') {
        if (!current) return err(i, id, 'no pool player has this id');
        const alts = String(Array.isArray(rec.alt_positions) ? rec.alt_positions.join('|') : (rec.alt_positions ?? ''))
          .split('|')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        if (!alts.every(isGroup)) return err(i, id, `alt_positions must use ${GROUPS.join(', ')}`);
        if ((alts as string[]).includes(current.position)) return err(i, id, 'an alternate cannot be the main position');
        if (new Set(alts).size !== alts.length) return err(i, id, 'an alternate appears twice');
        const source = rec.alt_source === undefined || rec.alt_source === '' ? 'ea' : String(rec.alt_source).trim();
        if (source !== 'ea' && source !== 'rule') return err(i, id, 'alt_source must be ea or rule');
        writes.set(id, {
          ...fieldsOf(current),
          altPositions: alts as Group[],
          altSource: source,
        });
        return;
      }

      // Ranks and prices are recomputed, so blank cells there are fine.
      const orZero = (k: string) => (rec[k] === undefined || rec[k] === null || rec[k] === '' ? '0' : rec[k]);
      const filled = {
        alt_source: 'rule',
        ...rec,
        position_rank: orZero('position_rank'),
        market_value_m: orZero('market_value_m'),
        base_price_m: orZero('base_price_m'),
        name: undefuse(String(rec.name ?? '')),
      };
      const parsed = parseMasterRows([filled]);
      const row = parsed.rows[0];
      if (!row) return err(i, id, parsed.errors[0]?.replace(/^pool row \S+: /, '') ?? 'unreadable row');
      const position = row.position.toUpperCase();
      const alts = row.altPositions.map((a) => a.toUpperCase());
      if (!isGroup(position)) return err(i, id, `position must be one of ${GROUPS.join(', ')}`);
      if (!alts.every(isGroup)) return err(i, id, `alt_positions must use ${GROUPS.join(', ')}`);
      if (alts.includes(position)) return err(i, id, 'an alternate cannot be the main position');
      if (new Set(alts).size !== alts.length) return err(i, id, 'an alternate appears twice');
      if (row.altSource !== 'ea' && row.altSource !== 'rule') return err(i, id, 'alt_source must be ea or rule');
      if (!Number.isInteger(row.overall) || row.overall < 40 || row.overall > 99) return err(i, id, 'overall must be a whole number from 40 to 99');
      if (row.name.length < 2 || row.name.length > 60) return err(i, id, 'name must be 2 to 60 characters');
      const seedClub = this.resolveClub(row.seedClub, clubIndex);
      if (seedClub === undefined) return err(i, id, `seed_club "${row.seedClub}" is not one of the 20 clubs`);
      const isActive = rec.is_active === undefined || rec.is_active === '' ? null : parseBool(rec.is_active);
      if (rec.is_active !== undefined && rec.is_active !== '' && isActive === null) return err(i, id, 'is_active must be true or false');
      const expected = prices(row.overall, curve);
      if ((row.marketValueM && row.marketValueM !== expected.marketValueM) || (row.basePriceM && row.basePriceM !== expected.basePriceM)) priceMismatches++;
      writes.set(id, {
        name: row.name,
        position,
        altPositions: alts as Group[],
        altSource: row.altSource,
        overall: row.overall,
        seedClub,
        clubNow: row.clubNow,
        nationality: row.nationality,
        isActive: isActive ?? (input.mode === 'replace' ? true : null),
      });
    });

    const added: PoolImportPreview['added'] = [];
    const changed: PoolImportPreview['changed'] = [];
    let unchanged = 0;
    for (const [id, f] of writes) {
      const current = existing.get(id);
      if (!current) {
        added.push({ id, name: f.name, position: f.position, overall: f.overall });
        continue;
      }
      const changes = diffRows(current, { ...current, ...withoutNull(f), ...prices(f.overall, curve) });
      if (changes.length) changed.push({ id, name: current.name, changes });
      else {
        unchanged++;
        writes.delete(id);
      }
    }
    const deactivate =
      input.mode === 'replace' && !errors.length ? [...existing.values()].filter((r) => r.isActive && !seen.has(r.id)).map((r) => r.id) : [];

    // Possible duplicates: same normalized name and position under another id.
    const key = (name: string, position: string) => `${normalizeName(name)}|${position}`;
    const owners = new Map<string, string>();
    for (const r of existing.values()) if (!deactivate.includes(r.id)) owners.set(key(r.name, r.position), r.id);
    const dupes: string[] = [];
    for (const [id, f] of writes) {
      const other = owners.get(key(f.name, f.position));
      if (other && other !== id) dupes.push(`${f.name} (${id} and ${other})`);
      owners.set(key(f.name, f.position), id);
    }
    if (dupes.length) warnings.push(`Possible duplicates: ${dupes.slice(0, 10).join('; ')}${dupes.length > 10 ? ` and ${dupes.length - 10} more` : ''}`);
    if (priceMismatches) warnings.push(`${priceMismatches} row(s) list prices that do not match the current price curve; prices are always recomputed from overall.`);

    // Would every group still cover a 12-team game?
    if (!errors.length) {
      const active = new Map<string, Group>();
      for (const r of existing.values()) if (r.isActive) active.set(r.id, r.position as Group);
      for (const id of deactivate) active.delete(id);
      for (const [id, f] of writes) {
        const on = f.isActive ?? existing.get(id)?.isActive ?? true;
        if (on) active.set(id, f.position);
        else active.delete(id);
      }
      const counts = new Map<Group, number>();
      for (const g of active.values()) counts.set(g, (counts.get(g) ?? 0) + 1);
      const plan = planFromNeeds(worstCaseNeeds(MAX_TEAMS, this.games.appSettings().formations_enabled), this.games.appSettings().pool_params);
      const short = plan.groups.filter((g) => (counts.get(g.group) ?? 0) < g.size);
      if (short.length) {
        warnings.push(`After this import a 12-team game could run short of ${short.map((g) => `${g.group} (${counts.get(g.group) ?? 0} of ${g.size})`).join(', ')}.`);
      }
    }

    return {
      preview: {
        mode: input.mode,
        rows: records.length,
        added: added.slice(0, 500),
        changed: changed.slice(0, 500),
        deactivated: deactivate.map((id) => ({ id, name: existing.get(id)!.name })),
        unchanged,
        errors: errors.length > MAX_LISTED ? [...errors.slice(0, MAX_LISTED), `...and ${errors.length - MAX_LISTED} more errors`] : errors,
        warnings,
      },
      writes,
      deactivate,
    };
  }

  previewImport(input: { format: 'csv' | 'json'; mode: 'upsert' | 'replace' | 'alt_positions'; content: string }): PoolImportPreview {
    return this.parseImport(input).preview;
  }

  applyImport(admin: UserRow, input: { format: 'csv' | 'json'; mode: 'upsert' | 'replace' | 'alt_positions'; content: string }): PoolImportPreview {
    const { preview, writes, deactivate } = this.parseImport(input);
    if (preview.errors.length) throw badRequest('IMPORT_INVALID', 'Fix the errors in the file first', preview);
    const curve = this.curve();
    const existing = new Set(this.rows().map((r) => r.id));
    this.db.transaction((tx) => {
      for (const [id, f] of writes) {
        const values = { ...withoutNull(f), ...prices(f.overall, curve) };
        if (existing.has(id)) tx.update(poolPlayers).set(values).where(eq(poolPlayers.id, id)).run();
        else tx.insert(poolPlayers).values({ id, ...values, isActive: f.isActive ?? true, positionRank: 1_000_000 }).run();
      }
      if (deactivate.length) tx.update(poolPlayers).set({ isActive: false }).where(inArray(poolPlayers.id, deactivate)).run();
      this.rerank(tx);
    });
    this.changed(admin, 'admin.pool.import', null, {
      mode: input.mode,
      format: input.format,
      added: preview.added.length,
      changed: preview.changed.length,
      deactivated: preview.deactivated.length,
    });
    return preview;
  }

  // -------------------------------------------------------------------------
  // Reprice

  previewReprice(params: PriceParams): RepricePreview {
    const current = this.curve();
    const rows = this.rows();
    const curve = [];
    for (let overall = 60; overall <= 95; overall++) {
      const now = prices(overall, params);
      const old = prices(overall, current);
      curve.push({ overall, marketValueM: now.marketValueM, basePriceM: now.basePriceM, oldMarketValueM: old.marketValueM, oldBasePriceM: old.basePriceM });
    }
    let changedPlayers = 0;
    const active = { before: 0, after: 0 };
    for (const r of rows) {
      const p = prices(r.overall, params);
      if (p.marketValueM !== r.marketValueM || p.basePriceM !== r.basePriceM) changedPlayers++;
      if (r.isActive) {
        active.before += r.marketValueM;
        active.after += p.marketValueM;
      }
    }
    return { params, current, curve, changedPlayers, activeMarketValueM: active };
  }

  applyReprice(admin: UserRow, params: PriceParams): RepricePreview {
    const preview = this.previewReprice(params);
    const before = this.curve();
    this.db.transaction((tx) => {
      tx.insert(appSettings)
        .values({ key: 'price_curve', value: params, updatedAt: Date.now() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: params, updatedAt: Date.now() } })
        .run();
      for (const r of tx.select().from(poolPlayers).all()) {
        const p = prices(r.overall, params);
        if (p.marketValueM !== r.marketValueM || p.basePriceM !== r.basePriceM) tx.update(poolPlayers).set(p).where(eq(poolPlayers.id, r.id)).run();
      }
    });
    this.changed(admin, 'admin.pool.reprice', null, { from: before, to: params, changedPlayers: preview.changedPlayers });
    return preview;
  }
}

function fieldsOf(r: PoolRow): ImportFields {
  return {
    name: r.name,
    position: r.position as Group,
    altPositions: r.altPositions as Group[],
    altSource: r.altSource,
    overall: r.overall,
    seedClub: r.seedClub,
    clubNow: r.clubNow,
    nationality: r.nationality,
    isActive: r.isActive,
  };
}

/** Import fields without a null isActive (null means "leave as is"). */
function withoutNull(f: ImportFields): Omit<ImportFields, 'isActive'> & { isActive?: boolean } {
  const { isActive, ...rest } = f;
  return isActive === null ? rest : { ...rest, isActive };
}

const DIFF_FIELDS = ['name', 'position', 'altPositions', 'altSource', 'overall', 'marketValueM', 'basePriceM', 'seedClub', 'clubNow', 'nationality', 'isActive'] as const;

function diffRows(a: PoolRow, b: PoolRow): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of DIFF_FIELDS) {
    const x = a[f];
    const y = b[f];
    if (Array.isArray(x) && Array.isArray(y)) {
      if (!sameList(x, y)) out.push({ field: f, from: x.join('|') || null, to: y.join('|') || null });
    } else if (x !== y) out.push({ field: f, from: (x ?? null) as FieldChange['from'], to: (y ?? null) as FieldChange['to'] });
  }
  return out;
}
