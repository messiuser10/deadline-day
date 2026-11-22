/**
 * Supplied data (section 5): parsing and validation. Pure functions; callers read the files.
 */
import { z } from 'zod';
import { FORMATION_IDS, type FormationId } from './formations';
import { GROUPS, POSITIONS, RULE_ALTERNATES, isGroup, isPosition, type Group, type Position } from './positions';
import { DEFAULT_POOL_PARAMS, MAX_TEAMS, planFromNeeds, supplyShortfalls, worstCaseNeeds, type PoolParams } from './pool';
import { DEFAULT_PRICE_PARAMS, prices, type PriceParams } from './pricing';
import { normalizeName, slugify } from './text';

export const EXPECTED_MASTER_COUNT = 570;
export const EXPECTED_CLUB_COUNT = 20;
export const EXPECTED_SEED_PLAYER_COUNT = 618;
export const EXPECTED_SEED_CLUB_LINKS = 265;
export const EXPECTED_MASTER_DEPTH: Record<Group, number> = {
  GK: 45,
  CB: 60,
  RB: 45,
  LB: 45,
  CDM: 50,
  CM: 60,
  CAM: 50,
  ST: 50,
  RM: 40,
  LM: 40,
  RW: 40,
  LW: 45,
};
export const MIN_RATING = 40;
export const MAX_RATING = 99;

// ---------------------------------------------------------------------------
// Types

export type AltSource = 'ea' | 'rule';

/** A master pool row after structural parsing, before semantic validation. */
export interface MasterRow {
  id: string;
  name: string;
  position: string;
  altPositions: string[];
  altSource: string;
  overall: number;
  positionRank: number;
  marketValueM: number;
  basePriceM: number;
  seedClub: string | null;
  nationality: string | null;
}

/** A validated master pool player. */
export interface MasterPlayer extends MasterRow {
  position: Group;
  altPositions: Group[];
  altSource: AltSource;
}

export interface ClubData {
  name: string;
  shortName: string;
  country: string;
  leagueName: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface SeedPlayerRow {
  club: string;
  name: string;
  primaryPosition: string;
  altPositions: string[];
  overall: number;
  nationality: string | null;
}

export interface SeedPlayer extends SeedPlayerRow {
  id: string;
  primaryPosition: Position;
  altPositions: Position[];
}

// ---------------------------------------------------------------------------
// Structural parsing (zod)

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const numeric = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number());

const altList = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split('|').map((s) => s.trim()).filter(Boolean);
  if (v === null || v === undefined) return [];
  return v;
}, z.array(z.string()));

const masterRowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    position: z.string(),
    alt_positions: altList,
    alt_source: z.string(),
    overall: numeric,
    position_rank: numeric,
    market_value_m: numeric,
    base_price_m: numeric,
    seed_club: z.preprocess(blankToNull, z.string().nullable()).optional(),
    nationality: z.preprocess(blankToNull, z.string().nullable()).optional(),
  })
  .transform(
    (r): MasterRow => ({
      id: r.id.trim(),
      name: r.name.trim(),
      position: r.position.trim(),
      altPositions: r.alt_positions,
      altSource: r.alt_source.trim(),
      overall: r.overall,
      positionRank: r.position_rank,
      marketValueM: r.market_value_m,
      basePriceM: r.base_price_m,
      seedClub: r.seed_club ?? null,
      nationality: r.nationality ?? null,
    }),
  );

const clubSchema = z
  .object({
    name: z.string().min(1),
    short_name: z.string().min(1),
    country: z.string().min(1),
    league_name: z.string().min(1),
    primary_color: z.string(),
    secondary_color: z.string(),
  })
  .transform(
    (c): ClubData => ({
      name: c.name,
      shortName: c.short_name,
      country: c.country,
      leagueName: c.league_name,
      primaryColor: c.primary_color,
      secondaryColor: c.secondary_color,
    }),
  );

const seedPlayerSchema = z
  .object({
    club: z.string().min(1),
    name: z.string().min(1),
    primary_position: z.string().optional(),
    position: z.string().optional(),
    alt_positions: altList.optional(),
    overall: numeric,
    nationality: z.preprocess(blankToNull, z.string().nullable()).optional(),
  })
  .transform(
    (p): SeedPlayerRow => ({
      club: p.club,
      name: p.name,
      primaryPosition: (p.primary_position ?? p.position ?? '').trim(),
      altPositions: p.alt_positions ?? [],
      overall: p.overall,
      nationality: p.nationality ?? null,
    }),
  );

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
}

function parseRows<T>(schema: z.ZodType<T>, raw: unknown[], label: string, keyOf: (r: unknown, i: number) => string): ParseResult<T> {
  const rows: T[] = [];
  const errors: string[] = [];
  raw.forEach((r, i) => {
    const res = schema.safeParse(r);
    if (res.success) rows.push(res.data);
    else
      errors.push(
        `${label} ${keyOf(r, i)}: ${res.error.issues.map((iss) => `${iss.path.join('.') || 'row'} ${iss.message}`).join('; ')}`,
      );
  });
  return { rows, errors };
}

const rowKey = (field: string) => (r: unknown, i: number) => {
  const v = r && typeof r === 'object' ? (r as Record<string, unknown>)[field] : undefined;
  return typeof v === 'string' && v ? v : `#${i + 1}`;
};

export function parseMasterRows(raw: unknown[]): ParseResult<MasterRow> {
  return parseRows(masterRowSchema, raw, 'pool row', rowKey('id'));
}

export function parseClubs(raw: unknown[]): ParseResult<ClubData> {
  return parseRows(clubSchema, raw, 'club', rowKey('name'));
}

export function parseSeedPlayers(raw: unknown[]): ParseResult<SeedPlayerRow> {
  return parseRows(seedPlayerSchema, raw, 'seed player', rowKey('name'));
}

/** Pull the player array out of auction_players.json or players.seed.json ({ players: [...] } or a bare array). */
export function unwrapPlayers(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object' && Array.isArray((json as { players?: unknown }).players)) {
    return (json as { players: unknown[] }).players;
  }
  throw new Error('Expected an array or an object with a players array');
}

// ---------------------------------------------------------------------------
// Identity helpers

/** Stable id for an AI club: "Atlético Madrid" -> "atletico-madrid". */
export function clubId(name: string): string {
  return slugify(name);
}

/** Stable id for an AI club squad player: "<club-slug>--<name-slug>". */
export function seedPlayerId(club: string, name: string): string {
  return `${slugify(club)}--${slugify(name)}`;
}

/**
 * Seed players a pool player refers to: same club, same normalized name, same overall.
 * A valid data set gives exactly one match for every pool player with a seed_club.
 */
export function findSeedMatches<T extends Pick<SeedPlayerRow, 'club' | 'name' | 'overall'>>(
  player: Pick<MasterRow, 'name' | 'overall' | 'seedClub'>,
  seedPlayers: readonly T[],
): T[] {
  if (!player.seedClub) return [];
  const name = normalizeName(player.name);
  return seedPlayers.filter(
    (s) => s.club === player.seedClub && s.overall === player.overall && normalizeName(s.name) === name,
  );
}

export function toMasterPlayer(row: MasterRow): MasterPlayer {
  return row as MasterPlayer;
}

export function toSeedPlayer(row: SeedPlayerRow): SeedPlayer {
  return { ...row, id: seedPlayerId(row.club, row.name) } as SeedPlayer;
}

// ---------------------------------------------------------------------------
// Validation

export interface DataInput {
  /** Rows of data/auction_players.csv (authoritative). */
  masterCsv: unknown[];
  /** Players of data/auction_players.json (must agree with the CSV). */
  masterJson?: unknown[];
  /** data/clubs.json */
  clubs: unknown[];
  /** Players of data/players.seed.json */
  seedPlayers: unknown[];
  /** Rows of data/players.csv (must agree with players.seed.json). */
  seedCsv?: unknown[];
  priceParams?: PriceParams;
  poolParams?: PoolParams;
  enabledFormations?: readonly FormationId[];
  expectedMasterCount?: number;
}

export interface GroupSupply {
  group: Group;
  master: number;
  worstCaseNeed: number;
  worstCaseSize: number;
  spare: number;
}

export interface DataReport {
  errors: string[];
  warnings: string[];
  masterCount: number;
  masterByGroup: Record<Group, number>;
  clubCount: number;
  seedPlayerCount: number;
  seedClubLinks: number;
  seedClubLinksResolved: number;
  supply: GroupSupply[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function validateData(input: DataInput): DataReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const priceParams = input.priceParams ?? DEFAULT_PRICE_PARAMS;
  const poolParams = input.poolParams ?? DEFAULT_POOL_PARAMS;
  const enabled = input.enabledFormations ?? FORMATION_IDS;
  const expectedCount = input.expectedMasterCount ?? EXPECTED_MASTER_COUNT;

  // Clubs
  const clubs = parseClubs(input.clubs);
  errors.push(...clubs.errors);
  const clubNames = new Set<string>();
  for (const c of clubs.rows) {
    if (clubNames.has(c.name)) errors.push(`club ${c.name}: duplicate name`);
    clubNames.add(c.name);
    if (!HEX_COLOR.test(c.primaryColor)) errors.push(`club ${c.name}: primary_color ${c.primaryColor} is not #RRGGBB`);
    if (!HEX_COLOR.test(c.secondaryColor)) errors.push(`club ${c.name}: secondary_color ${c.secondaryColor} is not #RRGGBB`);
  }
  const clubSlugs = new Set(clubs.rows.map((c) => clubId(c.name)));
  if (clubSlugs.size !== clubs.rows.length) errors.push('clubs: two club names produce the same id');
  if (input.clubs.length !== EXPECTED_CLUB_COUNT) {
    errors.push(`clubs: expected ${EXPECTED_CLUB_COUNT} clubs, found ${input.clubs.length}`);
  }

  // Seed players
  const seed = parseSeedPlayers(input.seedPlayers);
  errors.push(...seed.errors);
  const seedIds = new Map<string, number>();
  for (const p of seed.rows) {
    const label = `seed player ${p.name} (${p.club})`;
    if (!clubNames.has(p.club)) errors.push(`${label}: club does not exist in clubs.json`);
    if (!isPosition(p.primaryPosition)) errors.push(`${label}: position ${p.primaryPosition} is not one of ${POSITIONS.join(', ')}`);
    for (const alt of p.altPositions) {
      if (!isPosition(alt)) errors.push(`${label}: alternate ${alt} is not a known position`);
      if (alt === p.primaryPosition) errors.push(`${label}: alternate ${alt} equals the main position`);
    }
    if (!Number.isInteger(p.overall) || p.overall < MIN_RATING || p.overall > MAX_RATING) {
      errors.push(`${label}: overall ${p.overall} outside ${MIN_RATING} to ${MAX_RATING}`);
    }
    const id = seedPlayerId(p.club, p.name);
    seedIds.set(id, (seedIds.get(id) ?? 0) + 1);
  }
  for (const [id, n] of seedIds) if (n > 1) errors.push(`seed player id ${id} is not unique (${n} players)`);
  if (input.seedPlayers.length !== EXPECTED_SEED_PLAYER_COUNT) {
    errors.push(`seed players: expected ${EXPECTED_SEED_PLAYER_COUNT}, found ${input.seedPlayers.length}`);
  }
  if (input.seedCsv) {
    const csv = parseSeedPlayers(input.seedCsv);
    errors.push(...csv.errors.map((e) => `players.csv ${e}`));
    const key = (p: SeedPlayerRow) => `${p.club}|${p.name}|${p.primaryPosition}|${p.overall}|${p.nationality ?? ''}`;
    const jsonKeys = new Set(seed.rows.map(key));
    const csvKeys = new Set(csv.rows.map(key));
    if (csv.rows.length !== seed.rows.length) {
      errors.push(`players.csv has ${csv.rows.length} rows but players.seed.json has ${seed.rows.length}`);
    }
    for (const k of csvKeys) if (!jsonKeys.has(k)) errors.push(`players.csv row not in players.seed.json: ${k}`);
    for (const k of jsonKeys) if (!csvKeys.has(k)) errors.push(`players.seed.json row not in players.csv: ${k}`);
  }

  // Master pool
  const master = parseMasterRows(input.masterCsv);
  errors.push(...master.errors);
  if (input.masterCsv.length !== expectedCount) {
    errors.push(`master pool: expected ${expectedCount} rows, found ${input.masterCsv.length}`);
  }
  const ids = new Set<string>();
  const ranks = new Map<string, Set<number>>();
  const masterByGroup = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  let seedClubLinks = 0;
  let seedClubLinksResolved = 0;
  for (const p of master.rows) {
    const label = `pool player ${p.id}`;
    if (ids.has(p.id)) errors.push(`${label}: duplicate id`);
    ids.add(p.id);
    if (!ID_PATTERN.test(p.id)) errors.push(`${label}: id must be lowercase letters, digits and dashes`);

    if (isGroup(p.position)) masterByGroup[p.position] += 1;
    else errors.push(`${label}: position ${p.position} is not one of ${GROUPS.join(', ')}`);
    const seenAlts = new Set<string>();
    for (const alt of p.altPositions) {
      if (!isGroup(alt)) errors.push(`${label}: alternate position ${alt} is not one of ${GROUPS.join(', ')}`);
      if (alt === p.position) errors.push(`${label}: alternate position ${alt} equals the main position`);
      if (seenAlts.has(alt)) errors.push(`${label}: alternate position ${alt} listed twice`);
      seenAlts.add(alt);
    }
    if (p.altSource !== 'ea' && p.altSource !== 'rule') errors.push(`${label}: alt_source must be ea or rule, got ${p.altSource}`);
    if (p.altSource === 'rule' && isGroup(p.position) && !sameList([...p.altPositions].sort(), [...RULE_ALTERNATES[p.position]].sort())) {
      warnings.push(`${label}: alt_source is rule but alternates ${p.altPositions.join('|') || '(none)'} differ from the rule default`);
    }

    if (!Number.isInteger(p.overall) || p.overall < MIN_RATING || p.overall > MAX_RATING) {
      errors.push(`${label}: overall ${p.overall} outside ${MIN_RATING} to ${MAX_RATING}`);
    } else {
      const expected = prices(p.overall, priceParams);
      if (p.marketValueM !== expected.marketValueM) {
        errors.push(`${label}: market_value_m ${p.marketValueM} does not match the formula (${expected.marketValueM} for overall ${p.overall})`);
      }
      if (p.basePriceM !== expected.basePriceM) {
        errors.push(`${label}: base_price_m ${p.basePriceM} does not match the formula (${expected.basePriceM} for overall ${p.overall})`);
      }
    }

    if (!Number.isInteger(p.positionRank) || p.positionRank < 1) {
      errors.push(`${label}: position_rank must be a positive whole number`);
    } else {
      const set = ranks.get(p.position) ?? new Set<number>();
      if (set.has(p.positionRank)) warnings.push(`${label}: position_rank ${p.positionRank} repeated within ${p.position}`);
      set.add(p.positionRank);
      ranks.set(p.position, set);
    }

    if (p.seedClub !== null) {
      seedClubLinks += 1;
      if (!clubNames.has(p.seedClub)) {
        errors.push(`${label}: seed_club ${p.seedClub} does not exist in clubs.json`);
      } else {
        const matches = findSeedMatches(p, seed.rows);
        if (matches.length === 1) seedClubLinksResolved += 1;
        else errors.push(`${label}: seed_club ${p.seedClub} resolves to ${matches.length} seed players (expected exactly 1)`);
      }
    }
  }
  for (const g of GROUPS) {
    if (masterByGroup[g] !== EXPECTED_MASTER_DEPTH[g]) {
      warnings.push(`master depth for ${g} is ${masterByGroup[g]}, the spec lists ${EXPECTED_MASTER_DEPTH[g]}`);
    }
  }

  if (input.masterJson) {
    const json = parseMasterRows(input.masterJson);
    errors.push(...json.errors.map((e) => `auction_players.json ${e}`));
    if (json.rows.length !== master.rows.length) {
      errors.push(`auction_players.json has ${json.rows.length} players but auction_players.csv has ${master.rows.length}`);
    }
    const byId = new Map(master.rows.map((r) => [r.id, r]));
    for (const j of json.rows) {
      const c = byId.get(j.id);
      if (!c) {
        errors.push(`auction_players.json player ${j.id} is missing from auction_players.csv`);
        continue;
      }
      const diffs = (Object.keys(c) as (keyof MasterRow)[]).filter((k) =>
        Array.isArray(c[k]) ? !sameList(c[k] as string[], j[k] as string[]) : c[k] !== j[k],
      );
      if (diffs.length) errors.push(`auction_players.json player ${j.id} differs from the CSV in ${diffs.join(', ')}`);
    }
  }

  // Worst case for the maximum team count: every group must still have enough master players.
  const plan = planFromNeeds(worstCaseNeeds(MAX_TEAMS, enabled), poolParams);
  for (const s of supplyShortfalls(plan, masterByGroup)) {
    errors.push(`group ${s.group}: ${MAX_TEAMS}-team worst case needs ${s.required} players but the master pool has ${s.available}`);
  }
  const supply = plan.groups.map((g) => ({
    group: g.group,
    master: masterByGroup[g.group],
    worstCaseNeed: g.need,
    worstCaseSize: g.size,
    spare: masterByGroup[g.group] - g.size,
  }));

  return {
    errors,
    warnings,
    masterCount: input.masterCsv.length,
    masterByGroup,
    clubCount: input.clubs.length,
    seedPlayerCount: input.seedPlayers.length,
    seedClubLinks,
    seedClubLinksResolved,
    supply,
  };
}
