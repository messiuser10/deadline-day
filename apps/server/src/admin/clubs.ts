/**
 * Admin: the 20 clubs and their AI squads (section 11, tab 3). Strength overrides replace the
 * computed value in the ranking that picks the AI clubs; squad edits change the AI teams' XIs.
 */
import { and, count, eq } from 'drizzle-orm';
import { POSITIONS, seedPlayerId, type Position } from '@deadline-day/engine';
import type { AdminClubView, AdminClubsView, ClubPatch, SquadPlayerInput, SquadPlayerView } from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { clubs, seedPlayers } from '../db/schema';
import { notFound } from '../errors';
import type { GameService } from '../games/service';

const POSITION_ORDER = new Map(POSITIONS.map((p, i) => [p, i]));

export class ClubsAdmin {
  constructor(
    private readonly db: Db,
    private readonly games: GameService,
  ) {}

  list(): AdminClubsView {
    const app = this.games.appSettings();
    const ranking = this.games.reference.clubRanking({ formations: app.formations_enabled, compatibility: app.slot_compatibility });
    const rows = new Map(this.db.select().from(clubs).all().map((c) => [c.id, c]));
    const sizes = new Map(
      this.db
        .select({ id: seedPlayers.clubId, n: count() })
        .from(seedPlayers)
        .groupBy(seedPlayers.clubId)
        .all()
        .map((r) => [r.id, r.n]),
    );
    const out: AdminClubView[] = ranking.map((c) => {
      const row = rows.get(c.id)!;
      return {
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        country: row.country,
        primaryColor: c.primaryColor,
        secondaryColor: c.secondaryColor,
        monogram: c.monogram,
        notes: row.notes,
        strength: c.strength,
        computedStrength: Math.round(c.computedStrength * 100) / 100,
        override: c.override,
        rank: c.rank,
        xiAverage: Math.round(c.xiAverage * 10) / 10,
        formation: c.formation,
        squadSize: sizes.get(c.id) ?? 0,
      };
    });
    return { clubs: out, selection: app.ai_club_selection };
  }

  private club(id: string) {
    const row = this.db.select().from(clubs).where(eq(clubs.id, id)).get();
    if (!row) throw notFound('CLUB_NOT_FOUND', 'No such club');
    return row;
  }

  patch(admin: UserRow, id: string, patch: ClubPatch): AdminClubView {
    const before = this.club(id);
    const set = {
      ...(patch.primaryColor !== undefined ? { primaryColor: patch.primaryColor } : {}),
      ...(patch.secondaryColor !== undefined ? { secondaryColor: patch.secondaryColor } : {}),
      ...(patch.monogram !== undefined ? { monogram: patch.monogram } : {}),
      ...(patch.strengthOverride !== undefined ? { strengthOverride: patch.strengthOverride } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    this.db.update(clubs).set(set).where(eq(clubs.id, id)).run();
    const changes = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { from: before[k as keyof typeof before] ?? null, to: v }]));
    audit(this.db, { actorUserId: admin.id, action: 'admin.club.update', target: id, details: { club: before.name, changes } });
    this.games.reference.invalidate();
    return this.list().clubs.find((c) => c.id === id)!;
  }

  squad(clubId: string): SquadPlayerView[] {
    this.club(clubId);
    return this.db
      .select()
      .from(seedPlayers)
      .where(eq(seedPlayers.clubId, clubId))
      .all()
      .map((p) => ({
        id: p.id,
        name: p.fullName,
        position: p.primaryPosition as Position,
        altPositions: p.altPositions as Position[],
        overall: p.overall,
        nationality: p.nationality,
      }))
      .sort((a, b) => (POSITION_ORDER.get(a.position) ?? 99) - (POSITION_ORDER.get(b.position) ?? 99) || b.overall - a.overall);
  }

  private player(clubId: string, playerId: string) {
    const row = this.db
      .select()
      .from(seedPlayers)
      .where(and(eq(seedPlayers.id, playerId), eq(seedPlayers.clubId, clubId)))
      .get();
    if (!row) throw notFound('PLAYER_NOT_FOUND', 'No such player in this squad');
    return row;
  }

  addPlayer(admin: UserRow, clubId: string, input: SquadPlayerInput & { altPositions: Position[] }): SquadPlayerView[] {
    const club = this.club(clubId);
    const base = seedPlayerId(club.name, input.name);
    let id = base;
    for (let n = 2; this.db.select({ id: seedPlayers.id }).from(seedPlayers).where(eq(seedPlayers.id, id)).get(); n++) id = `${base}-${n}`;
    const altPositions = input.altPositions.filter((a) => a !== input.position);
    this.db
      .insert(seedPlayers)
      .values({ id, clubId, fullName: input.name, primaryPosition: input.position, altPositions, overall: input.overall, nationality: input.nationality ?? null })
      .run();
    audit(this.db, { actorUserId: admin.id, action: 'admin.squad.add', target: id, details: { club: club.name, name: input.name, position: input.position, overall: input.overall } });
    this.games.reference.invalidate();
    return this.squad(clubId);
  }

  /** The player keeps his id, so stored seasons that name him still resolve. */
  updatePlayer(admin: UserRow, clubId: string, playerId: string, input: SquadPlayerInput & { altPositions: Position[] }): SquadPlayerView[] {
    const club = this.club(clubId);
    const before = this.player(clubId, playerId);
    const altPositions = input.altPositions.filter((a) => a !== input.position);
    this.db
      .update(seedPlayers)
      .set({ fullName: input.name, primaryPosition: input.position, altPositions, overall: input.overall, nationality: input.nationality ?? null })
      .where(eq(seedPlayers.id, playerId))
      .run();
    audit(this.db, {
      actorUserId: admin.id,
      action: 'admin.squad.update',
      target: playerId,
      details: {
        club: club.name,
        from: { name: before.fullName, position: before.primaryPosition, altPositions: before.altPositions, overall: before.overall },
        to: { name: input.name, position: input.position, altPositions, overall: input.overall },
      },
    });
    this.games.reference.invalidate();
    return this.squad(clubId);
  }

  removePlayer(admin: UserRow, clubId: string, playerId: string): SquadPlayerView[] {
    const club = this.club(clubId);
    const before = this.player(clubId, playerId);
    this.db.delete(seedPlayers).where(eq(seedPlayers.id, playerId)).run();
    audit(this.db, { actorUserId: admin.id, action: 'admin.squad.delete', target: playerId, details: { club: club.name, name: before.fullName } });
    this.games.reference.invalidate();
    return this.squad(clubId);
  }
}
