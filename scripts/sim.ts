/**
 * npm run sim -- --teams 3 --seed 42
 *   Creates N bot teams with random formations, runs the whole bot auction, simulates the season and
 *   prints the pool size, prices paid, final lineups and the table.
 *
 * Options:
 *   --teams N        auction teams, 2 to 12 (default 3)
 *   --seed S         seed (default 42)
 *   --bots LEVEL     easy | medium | hard | mixed (default mixed)
 *   --budget M       starting budget in $M (default 1000)
 *   --runs R         run R games on seeds S..S+R-1 and print realism stats instead (for tuning)
 *   --montecarlo K   also run K seasons of Monte Carlo on the final league
 *   --sensitivity X, --base-goals X, --home-advantage X, --chaos X   override simulation parameters
 */
import {
  FORMATIONS,
  MAX_TEAMS,
  MIN_TEAMS,
  purchaseTag,
  rankLeague,
  monteCarlo,
  runTestGame,
  withSimDefaults,
  type BotLevel,
  type SimParams,
  type TestGameResult,
} from '@deadline-day/engine';
import { loadData } from '@deadline-day/server/data';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function num(name: string, fallback: number): number {
  const v = arg(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

const teams = num('teams', 3);
if (!Number.isInteger(teams) || teams < MIN_TEAMS || teams > MAX_TEAMS) {
  console.error(`--teams must be a whole number from ${MIN_TEAMS} to ${MAX_TEAMS}`);
  process.exit(1);
}
const seed = num('seed', 42) >>> 0;
const runs = num('runs', 1);
const bots = (arg('bots') ?? 'mixed') as BotLevel | 'mixed';
if (!['easy', 'medium', 'hard', 'mixed'].includes(bots)) {
  console.error('--bots must be easy, medium, hard or mixed');
  process.exit(1);
}
const budgetM = num('budget', 1000);
const overrides: Partial<SimParams> = {};
if (arg('sensitivity')) overrides.sensitivity = num('sensitivity', 0);
if (arg('base-goals')) overrides.baseGoals = num('base-goals', 0);
if (arg('home-advantage')) overrides.homeAdvantage = num('home-advantage', 0);
if (arg('chaos')) overrides.chaos = num('chaos', 0);
const simParams = withSimDefaults(overrides);

const data = loadData();
if (data.report.errors.length) {
  console.error('Data validation failed. Run npm run data:validate.');
  process.exit(1);
}

const play = (s: number): TestGameResult =>
  runTestGame({
    master: data.masterPlayers,
    clubs: data.clubs,
    seedPlayers: data.seedPlayers,
    teams,
    seed: s,
    budgetM,
    botLevel: bots,
    simParams,
  });

const pad = (v: string | number, n: number) => String(v).padEnd(n);
const lpad = (v: string | number, n: number) => String(v).padStart(n);
const f1 = (v: number) => v.toFixed(1);

if (runs > 1) {
  const champ: number[] = [];
  const bottom: number[] = [];
  const gpm: number[] = [];
  const homeWin: number[] = [];
  const drawRate: number[] = [];
  const auctionPos: number[] = [];
  const spentShare: number[] = [];
  const started = Date.now();
  for (let i = 0; i < runs; i++) {
    const g = play(seed + i);
    const t = g.season.table;
    champ.push(t[0]!.points);
    bottom.push(t[t.length - 1]!.points);
    gpm.push(g.season.goalsPerMatch);
    homeWin.push(g.season.homeWins / g.season.fixtures.length);
    drawRate.push(g.season.draws / g.season.fixtures.length);
    for (const team of g.auction.teams) {
      auctionPos.push(t.find((r) => r.teamId === team.id)!.position);
      spentShare.push((budgetM - team.budgetM) / budgetM);
    }
  }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const within = (a: number[], lo: number, hi: number) => `${Math.round((100 * a.filter((v) => v >= lo && v <= hi).length) / a.length)}%`;
  console.log(`Deadline Day realism check: ${runs} games, ${teams} auction teams, bots ${bots}, seeds ${seed}..${seed + runs - 1}`);
  console.log(`params: base_goals ${simParams.baseGoals}, home_advantage ${simParams.homeAdvantage}, sensitivity ${simParams.sensitivity}, chaos ${simParams.chaos}\n`);
  console.log(`champion points   avg ${f1(avg(champ))}  range ${Math.min(...champ)}-${Math.max(...champ)}  in 80-95: ${within(champ, 80, 95)}`);
  console.log(`bottom points     avg ${f1(avg(bottom))}  range ${Math.min(...bottom)}-${Math.max(...bottom)}  in 20-40: ${within(bottom, 20, 40)}`);
  console.log(`goals per match   avg ${avg(gpm).toFixed(3)}  range ${Math.min(...gpm).toFixed(2)}-${Math.max(...gpm).toFixed(2)}  in 2.6-2.9: ${within(gpm, 2.6, 2.9)}`);
  console.log(`home win ${(100 * avg(homeWin)).toFixed(1)}%  draws ${(100 * avg(drawRate)).toFixed(1)}%`);
  console.log(`auction teams     avg finish ${f1(avg(auctionPos))}  budget spent ${(100 * avg(spentShare)).toFixed(1)}%`);
  console.log(`\n${((Date.now() - started) / runs).toFixed(0)} ms per game`);
  process.exit(0);
}

const started = Date.now();
const g = play(seed);
const elapsed = Date.now() - started;
const { auction, season } = g;
const nameOf = new Map(g.league.map((t) => [t.id, t.name]));
const clubName = new Map(g.clubRanking.map((c) => [c.clubId, c.name]));

console.log(`Deadline Day simulation: ${teams} bot teams, seed ${seed}, bots ${bots}, budget $${budgetM}M\n`);
console.log('Formations: ' + auction.teams.map((t) => `${t.name} ${t.formation} (${t.botLevel})`).join(', '));
console.log(`\nAuction pool: ${g.pool.plan.totalSize} players (${g.pool.plan.totalNeed} needed + ${g.pool.plan.totalExtra} extra)`);
console.log('group  need  extra  pool  overall range');
for (const gr of g.pool.groups.filter((x) => x.size > 0)) {
  console.log(`${pad(gr.group, 5)}  ${lpad(gr.need, 4)}  ${lpad(gr.extra, 5)}  ${lpad(gr.size, 4)}  ${gr.minOverall}-${gr.maxOverall}`);
}
console.log(`\nAI clubs (${g.aiClubIds.length}): ${g.aiClubIds.map((id) => clubName.get(id)).join(', ')}`);
const left = g.clubRanking.filter((c) => !g.aiClubIds.includes(c.clubId)).map((c) => c.name);
console.log(`Left out: ${left.length ? left.join(', ') : 'none'}`);
console.log(`\nAuction: ${g.lots} lots, ${g.bids} bids, ${auction.sales.filter((s) => s.autoFilled).length} auto-filled`);

for (const team of auction.teams) {
  const spent = team.roster.reduce((s, r) => s + r.priceM, 0);
  console.log(`\n${team.name} (${team.botLevel}, ${team.formation}): spent $${spent}M, $${team.budgetM}M left`);
  for (const slot of FORMATIONS[team.formation].slots) {
    const id = team.lineup[slot.key]!;
    const p = auction.players[id]!;
    const r = team.roster.find((x) => x.playerId === id)!;
    const out = p.position !== slot.type && !(slot.type === 'LWB' && p.position === 'LB') && !(slot.type === 'RWB' && p.position === 'RB');
    console.log(
      `  ${pad(slot.key, 5)} ${pad(p.name, 26)} ${pad(p.position + (out ? '*' : ''), 5)} ${lpad(p.overall, 3)}  $${lpad(r.priceM, 3)}M  (value ${lpad(p.marketValueM, 3)}, ${purchaseTag(r.priceM, p.marketValueM)}${r.autoFilled ? ', auto-filled' : ''})`,
    );
  }
}

const prices = auction.sales.map((s) => s.priceM);
const unsold = Object.values(auction.status).filter((s) => s === 'unsold').length;
console.log(`\nPrices: total $${prices.reduce((s, v) => s + v, 0)}M, highest $${Math.max(...prices)}M, lowest $${Math.min(...prices)}M, ${unsold} players unsold`);

console.log('\nPre-season strength:');
for (const r of rankLeague(g.league, simParams)) {
  console.log(`  ${lpad(r.rank, 2)}. ${pad(r.name, 26)} ${pad(r.kind === 'ai' ? 'AI' : 'Auction', 8)} att ${f1(r.attack)}  def ${f1(r.defense)}`);
}

console.log('\nFinal table:');
console.log('  Pos  Team                        P   W   D   L   GF  GA   GD  Pts  Form');
for (const row of season.table) {
  const kind = g.league.find((t) => t.id === row.teamId)!.kind;
  console.log(
    `  ${lpad(row.position, 3)}  ${pad((kind === 'ai' ? '' : '* ') + nameOf.get(row.teamId), 26)} ${lpad(row.played, 3)} ${lpad(row.won, 3)} ${lpad(row.drawn, 3)} ${lpad(row.lost, 3)}  ${lpad(row.goalsFor, 3)} ${lpad(row.goalsAgainst, 3)}  ${lpad(row.goalDifference > 0 ? '+' + row.goalDifference : row.goalDifference, 3)}  ${lpad(row.points, 3)}  ${row.form}`,
  );
}
console.log(`\n* auction team. ${season.fixtures.length} matches, ${season.goalsPerMatch.toFixed(2)} goals per match, home wins ${season.homeWins}, draws ${season.draws}, away wins ${season.awayWins}.`);
const scorers = [...season.playerStats].sort((a, b) => b.goals - a.goals).slice(0, 5);
console.log('Top scorers: ' + scorers.map((s) => `${s.name} (${nameOf.get(s.teamId)}) ${s.goals}`).join(', '));

const mc = num('montecarlo', 0);
if (mc > 0) {
  const res = monteCarlo(g.league, { seed, runs: mc, params: simParams });
  console.log(`\nExpected Strength (${mc} seasons):`);
  for (const t of res.teams) {
    console.log(`  ${pad(t.name, 26)} pts ${f1(t.avgPoints)}  pos ${f1(t.avgPosition)}  title ${(100 * t.titleChance).toFixed(1)}%  top4 ${(100 * t.top4Chance).toFixed(1)}%  bottom3 ${(100 * t.bottom3Chance).toFixed(1)}%`);
  }
}
console.log(`\nDone in ${elapsed} ms.`);
