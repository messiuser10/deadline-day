/**
 * Builds the 20 league teams (section 9, steps 1 and 2): one per auction team (its bought XI in its
 * formation) and one per AI club in ai_club_ids (best XI from its remaining squad).
 */
import { FORMATIONS } from './formations';
import { isMainPosition } from './lineup';
import { pickBestXi, removeBoughtPlayers, type BestXi, type ClubSquad, type XiOptions } from './clubs';
import { overallStrength } from './ratings';
import { rateTeams, type LeagueTeam, type RatedTeam, type TeamKind } from './season';
import { withSimDefaults, type SimParams } from './params';
import type { AuctionPlayer, AuctionTeam } from './auction';

export function leagueTeamFromAuction(
  team: AuctionTeam,
  players: Readonly<Record<string, AuctionPlayer>>,
  kind: Exclude<TeamKind, 'ai'>,
): LeagueTeam {
  const slots = FORMATIONS[team.formation].slots;
  return {
    id: team.id,
    name: team.name,
    kind,
    formation: team.formation,
    players: slots.map((slot) => {
      const id = team.lineup[slot.key];
      const p = id ? players[id] : undefined;
      if (!p) throw new Error(`${team.name} has no player in ${slot.key}`);
      return {
        ref: `pool:${p.id}`,
        name: p.name,
        slotKey: slot.key,
        slotType: slot.type,
        overall: p.overall,
        baseOverall: p.overall,
        positions: [p.position, ...p.altPositions],
        club: p.seedClub ?? null,
        nationality: p.nationality ?? null,
        outOfPosition: !isMainPosition(p, slot.type),
        reserve: false,
      };
    }),
  };
}

export function leagueTeamFromClub(club: ClubSquad, xi: BestXi): LeagueTeam {
  return {
    id: club.id,
    name: club.name,
    kind: 'ai',
    formation: xi.formation,
    players: xi.slots.map((s) =>
      s.player
        ? {
            ref: `seed:${s.player.id}`,
            name: s.player.name,
            slotKey: s.slotKey,
            slotType: s.slotType,
            overall: s.effectiveOverall,
            baseOverall: s.player.overall,
            positions: [s.player.position, ...s.player.altPositions],
            club: club.id,
            nationality: s.player.nationality ?? null,
            outOfPosition: s.outOfPosition,
            reserve: false,
          }
        : {
            ref: `reserve:${club.id}:${s.slotKey}`,
            name: 'Academy Reserve',
            slotKey: s.slotKey,
            slotType: s.slotType,
            overall: s.effectiveOverall,
            baseOverall: s.effectiveOverall,
            positions: [s.slotType],
            club: null,
            nationality: null,
            outOfPosition: false,
            reserve: true,
          },
    ),
  };
}

export interface BuildLeagueInput {
  auctionTeams: readonly { team: AuctionTeam; kind: Exclude<TeamKind, 'ai'> }[];
  players: Readonly<Record<string, AuctionPlayer>>;
  clubs: readonly ClubSquad[];
  aiClubIds: readonly string[];
  /** Remove bought players from AI squads (default on). */
  removeBought?: boolean;
  xiOptions?: XiOptions;
}

export interface BuiltLeague {
  teams: LeagueTeam[];
  aiXis: Record<string, BestXi>;
}

export function buildLeague(input: BuildLeagueInput): BuiltLeague {
  const removeBought = input.removeBought ?? true;
  const bought = input.auctionTeams.flatMap(({ team }) =>
    team.roster.map((r) => {
      const p = input.players[r.playerId]!;
      return { name: p.name, overall: p.overall, seedClubId: p.seedClub ?? null };
    }),
  );
  const clubs = removeBought ? removeBoughtPlayers(input.clubs, bought) : input.clubs;
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const aiXis: Record<string, BestXi> = {};
  const aiTeams = input.aiClubIds.map((id) => {
    const club = byId.get(id);
    if (!club) throw new Error(`Unknown AI club ${id}`);
    const xi = pickBestXi(club.squad, input.xiOptions);
    aiXis[id] = xi;
    return leagueTeamFromClub(club, xi);
  });
  const auctionTeams = input.auctionTeams.map(({ team, kind }) => leagueTeamFromAuction(team, input.players, kind));
  return { teams: [...auctionTeams, ...aiTeams], aiXis };
}

/** League preview: every team rated and ranked by strength (mean of attack and defense). */
export function rankLeague(teams: readonly LeagueTeam[], params?: Partial<SimParams>): (RatedTeam & { strength: number; rank: number })[] {
  return rateTeams(teams, withSimDefaults(params))
    .map((r) => ({ ...r, strength: overallStrength(r) }))
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
