/**
 * A complete all-bot game: random formations, pool built from them, bot auction, AI clubs chosen
 * from the pre-auction strength snapshot, season simulated. Shared by the sim CLI, the admin
 * Test Auction and tests.
 */
import { createAuctionState, BOT_LEVELS, type AuctionPlayer, type AuctionState, type BotLevel } from './auction';
import { runBotAuction } from './botAuction';
import { rankClubs, selectAiClubs, type ClubSquad, type ClubStrength } from './clubs';
import { clubId, type ClubData, type MasterPlayer, type SeedPlayer } from './data';
import { FORMATION_IDS, type FormationId } from './formations';
import { buildLeague } from './league';
import { withSimDefaults, type SimParams } from './params';
import { buildAuctionPool, DEFAULT_POOL_PARAMS, LEAGUE_SIZE, type AuctionPoolBuild, type PoolParams } from './pool';
import { Rng, deriveSeed } from './rng';
import { simulateSeason, type LeagueTeam, type SeasonResult } from './season';

export type PooledPlayer = AuctionPlayer & { positionRank: number };

export function toAuctionPlayer(p: MasterPlayer): PooledPlayer {
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    altPositions: [...p.altPositions],
    overall: p.overall,
    marketValueM: p.marketValueM,
    basePriceM: p.basePriceM,
    positionRank: p.positionRank,
    seedClub: p.seedClub ? clubId(p.seedClub) : null,
    nationality: p.nationality,
  };
}

export function clubSquads(clubs: readonly ClubData[], seedPlayers: readonly SeedPlayer[]): ClubSquad[] {
  return clubs.map((c) => ({
    id: clubId(c.name),
    name: c.name,
    squad: seedPlayers
      .filter((p) => p.club === c.name)
      .map((p) => ({
        id: p.id,
        name: p.name,
        position: p.primaryPosition,
        altPositions: p.altPositions,
        overall: p.overall,
        nationality: p.nationality,
      })),
  }));
}

export interface TestGameInput {
  master: readonly MasterPlayer[];
  clubs: readonly ClubData[];
  seedPlayers: readonly SeedPlayer[];
  teams: number;
  seed: number;
  budgetM?: number;
  /** Bot level for every team, or 'mixed' for a seeded random mix. */
  botLevel?: BotLevel | 'mixed';
  formations?: readonly FormationId[];
  poolParams?: PoolParams;
  simParams?: Partial<SimParams>;
  minIncrementM?: number;
  removeBought?: boolean;
}

export interface TestGameResult {
  formations: FormationId[];
  pool: AuctionPoolBuild<PooledPlayer>;
  clubRanking: ClubStrength[];
  aiClubIds: string[];
  auction: AuctionState;
  lots: number;
  bids: number;
  league: LeagueTeam[];
  season: SeasonResult;
}

export function runTestGame(input: TestGameInput): TestGameResult {
  const rng = Rng.from(input.seed, 'test-game');
  const enabled = input.formations?.length ? input.formations : FORMATION_IDS;
  const formations = Array.from({ length: input.teams }, () => rng.pick(enabled));
  const pool = buildAuctionPool(input.master.map(toAuctionPlayer), formations, input.poolParams ?? DEFAULT_POOL_PARAMS);
  if (pool.shortfalls.length) throw new Error(`Master pool too small for ${pool.shortfalls.map((s) => s.group).join(', ')}`);

  const squads = clubSquads(input.clubs, input.seedPlayers);
  const clubRanking = rankClubs(squads);
  const aiClubIds = selectAiClubs(clubRanking, input.teams, LEAGUE_SIZE);

  const levelFor = (i: number): BotLevel =>
    !input.botLevel || input.botLevel === 'mixed' ? BOT_LEVELS[(i + rng.int(0, 2)) % BOT_LEVELS.length]! : input.botLevel;
  const teams = formations.map((formation, i) => ({
    id: `team-${i + 1}`,
    name: `Bot ${i + 1}`,
    formation,
    budgetM: input.budgetM ?? 1000,
    botLevel: levelFor(i),
  }));
  const state = createAuctionState({
    players: pool.players,
    teams,
    nominationOrder: rng.shuffle(teams.map((t) => t.id)),
    minIncrementM: input.minIncrementM ?? 1,
  });
  const auction = runBotAuction(state, deriveSeed(input.seed, 'auction'));
  const { teams: league } = buildLeague({
    auctionTeams: auction.state.teams.map((team) => ({ team, kind: 'bot' as const })),
    players: auction.state.players,
    clubs: squads,
    aiClubIds,
    removeBought: input.removeBought ?? true,
  });
  const season = simulateSeason({ teams: league, seed: deriveSeed(input.seed, 'season', 1), params: withSimDefaults(input.simParams) });
  return { formations, pool, clubRanking, aiClubIds, auction: auction.state, lots: auction.lots, bids: auction.bids, league, season };
}

