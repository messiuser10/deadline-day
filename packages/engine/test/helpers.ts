// Shared builders for engine tests.
import {
  assignLineup,
  createAuctionState,
  parseClubs,
  parseMasterRows,
  parseSeedPlayers,
  prices,
  toMasterPlayer,
  toSeedPlayer,
  type AuctionPlayer,
  type AuctionState,
  type FormationId,
  type Group,
  type LeaguePlayer,
  type LeagueTeam,
  FORMATIONS,
} from '../src';
import { loadDataInput } from './fixtures';

let counter = 0;

/** A synthetic auction player with formula prices. */
export function mk(position: Group, altPositions: Group[] = [], overall = 80, id?: string): AuctionPlayer {
  const { marketValueM, basePriceM } = prices(overall);
  const pid = id ?? `${position.toLowerCase()}-${++counter}`;
  return { id: pid, name: pid, position, altPositions, overall, marketValueM, basePriceM, positionRank: counter };
}

/** Give a team players directly (as if bought at base price) and assign its lineup. */
export function giveRoster(state: AuctionState, teamId: string, playerIds: string[]): AuctionState {
  const status = { ...state.status };
  const teams = state.teams.map((t) => {
    if (t.id !== teamId) return t;
    const roster = [
      ...t.roster,
      ...playerIds.map((id) => ({ playerId: id, priceM: state.players[id]!.basePriceM, autoFilled: false, lotSequence: null })),
    ];
    const res = assignLineup(t.formation, roster.map((r) => state.players[r.playerId]!));
    if (!res.valid) throw new Error(`test roster does not fit ${t.formation}`);
    for (const id of playerIds) status[id] = 'sold';
    const spent = playerIds.reduce((s, id) => s + state.players[id]!.basePriceM, 0);
    return { ...t, roster, lineup: res.lineup, budgetM: t.budgetM - spent };
  });
  return { ...state, teams, status };
}

/** Players that fill every slot of a formation in their main position. */
export function fullSquad(formation: FormationId, overall = 80): AuctionPlayer[] {
  return FORMATIONS[formation].slots.map((s) => {
    const g = s.type === 'LWB' ? 'LB' : s.type === 'RWB' ? 'RB' : s.type;
    return mk(g as Group, [], overall);
  });
}

export function twoTeamState(players: AuctionPlayer[], formations: [FormationId, FormationId], budgetM = 1000): AuctionState {
  return createAuctionState({
    players,
    teams: [
      { id: 'A', name: 'Team A', formation: formations[0], budgetM },
      { id: 'B', name: 'Team B', formation: formations[1], budgetM },
    ],
    nominationOrder: ['A', 'B'],
  });
}

export function realData() {
  const input = loadDataInput();
  return {
    master: parseMasterRows(input.masterCsv).rows.map(toMasterPlayer),
    clubs: parseClubs(input.clubs).rows,
    seedPlayers: parseSeedPlayers(input.seedPlayers).rows.map(toSeedPlayer),
  };
}

/** A league team where every slot is one player of the given overall. */
export function flatTeam(id: string, overall: number, formation: FormationId = '4-3-3'): LeagueTeam {
  const players: LeaguePlayer[] = FORMATIONS[formation].slots.map((s) => ({
    ref: `pool:${id}-${s.key}`,
    name: `${id} ${s.key}`,
    slotKey: s.key,
    slotType: s.type,
    overall,
    baseOverall: overall,
    positions: [s.type === 'LWB' ? 'LB' : s.type === 'RWB' ? 'RB' : s.type],
    club: null,
    nationality: null,
    outOfPosition: false,
    reserve: false,
  }));
  return { id, name: id, kind: 'ai', formation, players };
}

/** 20 teams rated 76..86 in steps. */
export function syntheticLeague(): LeagueTeam[] {
  return Array.from({ length: 20 }, (_, i) => flatTeam(`T${String(i + 1).padStart(2, '0')}`, 86 - i * 0.5));
}

/** Cheap filler players (default overall 76) covering every slot of each formation, main positions only. */
export function basePool(formations: FormationId[], overall = 76): AuctionPlayer[] {
  return formations.flatMap((f) => fullSquad(f, overall));
}

export function threeTeamState(players: AuctionPlayer[], formations: [FormationId, FormationId, FormationId], budgetM = 1000): AuctionState {
  return createAuctionState({
    players,
    teams: [
      { id: 'A', name: 'Team A', formation: formations[0], budgetM },
      { id: 'B', name: 'Team B', formation: formations[1], budgetM },
      { id: 'C', name: 'Team C', formation: formations[2], budgetM },
    ],
    nominationOrder: ['A', 'B', 'C'],
  });
}
