/**
 * Admin: Simulation Lab (section 11, tab 6). Any 20 teams, from the clubs or a played game, can be run
 * for one season or up to 1,000 seasons with any seed and parameters. Nothing here is saved.
 */
import { inArray } from 'drizzle-orm';
import {
  deriveSeed,
  leagueTeamFromClub,
  pickBestXi,
  rateTeams,
  simulateSeason,
  withSimDefaults,
  type LeagueTeam,
  type SimParams,
} from '@deadline-day/engine';
import type { Distribution, LabResult, LabRunInput, LabTeamResult, LabTeamsView, LabTeamView, TestAuctionInput, TestAuctionResult } from '@deadline-day/protocol';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { clubs, seasonTeams } from '../db/schema';
import { badRequest, conflict } from '../errors';
import type { GameService } from '../games/service';

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Equal-width bins. Whole numbers over a small range get one bin per value. */
export function distribution(values: readonly number[], opts: { integer?: boolean; maxBins?: number } = {}): Distribution {
  if (!values.length) return { mean: 0, min: 0, max: 0, bins: [] };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const maxBins = opts.maxBins ?? 20;
  let width: number;
  if (opts.integer) width = Math.max(1, Math.ceil((max - min + 1) / maxBins));
  else width = max === min ? 1 : (max - min) / Math.min(maxBins, Math.max(4, Math.ceil(Math.sqrt(values.length))));
  const count = opts.integer ? Math.ceil((max - min + 1) / width) : Math.max(1, Math.ceil((max - min) / width - 1e-9));
  const bins = Array.from({ length: count }, (_, i) => ({ from: round(min + i * width, 3), to: round(min + (i + 1) * width, 3), count: 0 }));
  for (const v of values) bins[Math.min(count - 1, Math.floor((v - min) / width + 1e-9))]!.count++;
  return { mean: round(sum / values.length, 3), min: round(min, 3), max: round(max, 3), bins };
}

export class LabAdmin {
  constructor(
    private readonly db: Db,
    private readonly games: GameService,
  ) {}

  private clubTeams(params: SimParams): { team: LeagueTeam; color: string; monogram: string }[] {
    const app = this.games.appSettings();
    const rows = new Map(this.db.select().from(clubs).all().map((c) => [c.id, c]));
    const ranking = new Map(this.games.reference.clubRanking({ formations: app.formations_enabled, compatibility: app.slot_compatibility }).map((c) => [c.id, c]));
    return this.games.reference
      .clubSquads()
      .map((club) => {
        const xi = pickBestXi(club.squad, {
          formations: app.formations_enabled,
          compatibility: app.slot_compatibility,
          outOfPositionPenalty: params.outOfPositionPenalty,
          reserveRating: params.reserveRating,
        });
        const row = rows.get(club.id);
        const team = { ...leagueTeamFromClub(club, xi), id: `club:${club.id}` };
        return { team, color: row?.primaryColor ?? '#888888', monogram: ranking.get(club.id)?.monogram ?? club.name.slice(0, 3).toUpperCase(), rank: ranking.get(club.id)?.rank ?? 99 };
      })
      .sort((a, b) => a.rank - b.rank);
  }

  /** The league teams of the given season team ids, keyed by "team:<season team id>". */
  private gameTeams(seasonTeamIds: string[]): Map<string, { team: LeagueTeam; color: string; monogram: string }> {
    const out = new Map<string, { team: LeagueTeam; color: string; monogram: string }>();
    if (!seasonTeamIds.length) return out;
    const seasonIds = new Set(
      this.db.select({ seasonId: seasonTeams.seasonId }).from(seasonTeams).where(inArray(seasonTeams.id, seasonTeamIds)).all().map((r) => r.seasonId),
    );
    for (const seasonId of seasonIds) {
      const { teams, meta, seasonTeamId } = this.games.season.leagueFromSeason(seasonId);
      // The engine id stays the stored one: tiebreaks are seeded by team id, so this keeps a season reproducible.
      for (const t of teams) {
        const id = `team:${seasonTeamId.get(t.id)!}`;
        out.set(id, { team: t, color: meta[t.id]?.color ?? '#888888', monogram: meta[t.id]?.monogram ?? t.name.slice(0, 3).toUpperCase() });
      }
    }
    return out;
  }

  private view(list: { team: LeagueTeam; color: string; monogram: string }[], params: SimParams, source: LabTeamView['source']): LabTeamView[] {
    const rated = new Map(rateTeams(list.map((l) => l.team), params).map((r) => [r.id, r]));
    return list.map(({ team, color, monogram }) => ({
      id: team.id,
      name: team.name,
      kind: team.kind,
      color,
      monogram,
      attack: round(rated.get(team.id)!.attack, 1),
      defense: round(rated.get(team.id)!.defense, 1),
      source,
    }));
  }

  teams(code: string | undefined): LabTeamsView {
    const params = withSimDefaults(this.games.appSettings().sim_params);
    const out = this.view(this.clubTeams(params), params, 'club');
    if (!code) return { teams: out, game: null };
    const game = this.games.findGame(code);
    const last = this.games.season.seasonRows(game.id).at(-1);
    if (!last) throw conflict('NO_SEASON', 'That game has no season yet');
    const { teams, meta, seasonTeamId } = this.games.season.leagueFromSeason(last.id);
    const list = teams.map((t) => {
      const id = `team:${seasonTeamId.get(t.id)!}`;
      return { team: { ...t, id }, color: meta[t.id]?.color ?? '#888888', monogram: meta[t.id]?.monogram ?? t.name.slice(0, 3).toUpperCase() };
    });
    return {
      teams: [...out, ...this.view(list, params, 'game')],
      game: { code: game.joinCode, name: game.name, seasonNumber: last.seasonNumber, seed: last.seed, teamIds: list.map((l) => l.team.id) },
    };
  }

  async run(input: Required<Pick<LabRunInput, 'teamIds' | 'seed'>> & { params: Partial<SimParams>; runs: number }): Promise<LabResult> {
    const started = Date.now();
    const params = withSimDefaults({ ...this.games.appSettings().sim_params, ...input.params });
    const clubTeams = new Map(this.clubTeams(params).map((c) => [c.team.id, c.team]));
    const gameTeams = this.gameTeams(input.teamIds.filter((id) => id.startsWith('team:')).map((id) => id.slice(5)));
    // Engine id -> lab id. Game teams keep their stored id unless two loaded seasons share one (an AI club).
    const labId = new Map<string, string>();
    const teams = input.teamIds.map((id) => {
      const found = clubTeams.get(id) ?? gameTeams.get(id)?.team;
      if (!found) throw badRequest('UNKNOWN_TEAM', `Unknown team: ${id}`);
      const t = labId.has(found.id) ? { ...found, id } : found;
      labId.set(t.id, id);
      return t;
    });

    const acc = new Map(teams.map((t) => [t.id, { points: 0, positions: 0, titles: 0, top4: 0, bottom3: 0 }]));
    const seasonGoals: number[] = [];
    const matchGoals: number[] = [];
    const spread: number[] = [];
    const champion: number[] = [];
    let home = 0;
    let draws = 0;
    let away = 0;
    let matches = 0;
    let goals = 0;
    let last: ReturnType<typeof simulateSeason> | null = null;
    for (let i = 0; i < input.runs; i++) {
      // Run 0 uses the seed itself, so one run reproduces a stored season with the same teams and seed.
      const seed = i === 0 ? input.seed : deriveSeed(input.seed, 'lab', i);
      const s = simulateSeason({ teams, seed, params, options: { events: false, snapshots: false } });
      last = s;
      home += s.homeWins;
      draws += s.draws;
      away += s.awayWins;
      matches += s.fixtures.length;
      goals += s.totalGoals;
      seasonGoals.push(s.goalsPerMatch);
      if (input.runs === 1) for (const f of s.fixtures) matchGoals.push(f.homeGoals + f.awayGoals);
      spread.push(s.table[0]!.points - s.table.at(-1)!.points);
      champion.push(s.table[0]!.points);
      for (const row of s.table) {
        const a = acc.get(row.teamId)!;
        a.points += row.points;
        a.positions += row.position;
        if (row.position === 1) a.titles++;
        if (row.position <= 4) a.top4++;
        if (row.position > s.table.length - 3) a.bottom3++;
      }
      if (i % 25 === 24) await tick();
    }
    const finalRows = new Map(last!.table.map((r) => [r.teamId, r]));
    const n = input.runs;
    const results: LabTeamResult[] = teams
      .map((t) => {
        const a = acc.get(t.id)!;
        const r = finalRows.get(t.id)!;
        return {
          id: labId.get(t.id)!,
          name: t.name,
          avgPoints: round(a.points / n, 1),
          avgPosition: round(a.positions / n, 2),
          titleChance: round(a.titles / n, 4),
          top4Chance: round(a.top4 / n, 4),
          bottom3Chance: round(a.bottom3 / n, 4),
          last: { position: r.position, points: r.points, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst },
        };
      })
      .sort((a, b) => (n === 1 ? a.last.position - b.last.position : a.avgPosition - b.avgPosition || b.avgPoints - a.avgPoints));
    return {
      runs: n,
      seed: input.seed,
      params,
      goals: n === 1 ? distribution(matchGoals, { integer: true }) : distribution(seasonGoals),
      goalsPerMatch: round(goals / matches, 3),
      homeWinRate: round(home / matches, 4),
      drawRate: round(draws / matches, 4),
      awayWinRate: round(away / matches, 4),
      pointsSpread: distribution(spread, { integer: true }),
      championPoints: distribution(champion, { integer: true }),
      teams: results,
      ms: Date.now() - started,
    };
  }

  testAuction(admin: UserRow, input: TestAuctionInput & { teams: number }): Promise<TestAuctionResult> {
    return this.games.createTestGame(admin, input);
  }
}

