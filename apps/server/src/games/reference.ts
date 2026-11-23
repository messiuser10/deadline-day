/**
 * Reference data the lobby and the start flow need: the active master pool and the 20 clubs ranked
 * by pre-auction strength. Both are cached in memory; call invalidate() after admin edits (M6).
 */
import {
  Rng,
  defaultMonogram,
  rankClubs,
  type ClubSquad,
  type FormationId,
  type Group,
  type PoolCandidate,
  type Position,
  type SlotCompatibility,
} from '@deadline-day/engine';
import type { ClubPreview } from '@deadline-day/protocol';
import type { Db } from '../db/client';
import { clubs, poolPlayers, seedPlayers } from '../db/schema';
import type { AiClubSelectionMethod } from '../settings/defaults';

export type PoolPlayerRow = typeof poolPlayers.$inferSelect;
export type PoolEntry = PoolCandidate & { row: PoolPlayerRow };

export interface RankedClub extends ClubPreview {
  computedStrength: number;
  override: number | null;
  xiAverage: number;
  depthCount: number;
  formation: FormationId;
}

export interface RankingOptions {
  formations: readonly FormationId[];
  compatibility: SlotCompatibility;
}

export class ReferenceData {
  private pool: PoolEntry[] | null = null;
  private ranking: { key: string; clubs: RankedClub[] } | null = null;
  private squads: ClubSquad[] | null = null;

  constructor(private readonly db: Db) {}

  invalidate(): void {
    this.pool = null;
    this.ranking = null;
    this.squads = null;
  }

  /** The 20 clubs with their full squads (seed players). */
  clubSquads(): ClubSquad[] {
    if (this.squads) return this.squads;
    const clubRows = this.db.select().from(clubs).all();
    const players = this.db.select().from(seedPlayers).all();
    this.squads = clubRows.map((c) => ({
      id: c.id,
      name: c.name,
      squad: players
        .filter((p) => p.clubId === c.id)
        .map((p) => ({
          id: p.id,
          name: p.fullName,
          position: p.primaryPosition as Position,
          altPositions: p.altPositions as Position[],
          overall: p.overall,
          nationality: p.nationality,
        })),
    }));
    return this.squads;
  }

  /** Active master-pool players as engine pool candidates. */
  activePool(): PoolEntry[] {
    this.pool ??= this.db
      .select()
      .from(poolPlayers)
      .all()
      .filter((r) => r.isActive)
      .map((row) => ({ id: row.id, position: row.position as Group, overall: row.overall, positionRank: row.positionRank, row }));
    return this.pool;
  }

  /** All clubs ranked by strength (an admin override replaces the computed value), strongest first. */
  clubRanking(options: RankingOptions): RankedClub[] {
    const key = JSON.stringify(options);
    if (this.ranking?.key === key) return this.ranking.clubs;
    const clubRows = this.db.select().from(clubs).all();
    const squads = this.clubSquads();
    const computed = new Map(rankClubs(squads, { formations: options.formations, compatibility: options.compatibility }).map((s) => [s.clubId, s]));
    const ranked = clubRows
      .map((c) => {
        const s = computed.get(c.id)!;
        return {
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          monogram: c.monogram ?? defaultMonogram(c.name),
          primaryColor: c.primaryColor,
          secondaryColor: c.secondaryColor,
          strength: round2(c.strengthOverride ?? s.strength),
          computedStrength: s.strength,
          override: c.strengthOverride,
          xiAverage: s.xiAverage,
          depthCount: s.depthCount,
          formation: s.formation,
          rank: 0,
        };
      })
      .sort((a, b) => b.strength - a.strength || b.computedStrength - a.computedStrength || a.name.localeCompare(b.name))
      .map((c, i) => ({ ...c, rank: i + 1 }));
    this.ranking = { key, clubs: ranked };
    return ranked;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The (20 - N) AI clubs. top_by_strength takes the strongest; manual takes the admin's list in order
 * and tops it up with the strongest others; random needs the game seed (null in the lobby preview).
 */
export function selectAiClubIds(
  ranking: readonly RankedClub[],
  count: number,
  method: AiClubSelectionMethod,
  manualIds: readonly string[],
  seed: number | null,
): string[] {
  const n = Math.max(0, Math.min(count, ranking.length));
  if (method === 'random') {
    if (seed === null) return [];
    return new Rng(seed).shuffle(ranking.map((c) => c.id)).slice(0, n);
  }
  const chosen: string[] = [];
  if (method === 'manual') {
    const known = new Set(ranking.map((c) => c.id));
    for (const id of manualIds) if (known.has(id) && !chosen.includes(id) && chosen.length < n) chosen.push(id);
  }
  for (const c of ranking) if (chosen.length < n && !chosen.includes(c.id)) chosen.push(c.id);
  return chosen;
}
