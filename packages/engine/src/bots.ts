/**
 * Bots (section 8). They count as teams, follow every server rule, and only differ in how they
 * value players:
 * - Easy: market value x random 0.7..1.0, bids while the price is below that.
 * - Medium: also values scarce groups and the open slots it needs most higher.
 * - Hard: also compares the player with the best cheaper alternative for the same slots and saves
 *   money for the positions where that gap is biggest.
 * All bots nominate the player with the best (overall - replacement level for his slots) per dollar.
 */
import { FORMATIONS } from './formations';
import { isEligible, playerGroups } from './lineup';
import { GROUPS, slotGroup, type Group } from './positions';
import { type Rng } from './rng';
import {
  autoNominationPick,
  availablePlayers,
  evaluateCandidate,
  getTeam,
  isTeamFull,
  minBaseByGroup,
  type AuctionPlayer,
  type AuctionState,
  type AuctionTeam,
  type BotLevel,
} from './auction';

/** Groups of the team's currently open slots, with how many of each. */
export function openGroupCounts(team: AuctionTeam): Map<Group, number> {
  const out = new Map<Group, number>();
  for (const slot of FORMATIONS[team.formation].slots) {
    if (team.lineup[slot.key] !== null) continue;
    const g = slotGroup(slot.type);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Open slots per group across every team (demand). */
export function demandByGroup(state: AuctionState): Record<Group, number> {
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const t of state.teams) for (const [g, n] of openGroupCounts(t)) out[g] += n;
  return out;
}

/** Available players eligible for each group (supply, alternates included). */
export function supplyByGroup(players: readonly AuctionPlayer[]): Record<Group, number> {
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const p of players) for (const g of playerGroups(p)) out[g] += 1;
  return out;
}

/** Open groups of this team the player could fill (falls back to all his groups if a reshuffle is needed). */
function relevantGroups(team: AuctionTeam, player: AuctionPlayer): Group[] {
  const open = openGroupCounts(team);
  const groups = [...playerGroups(player)];
  const direct = groups.filter((g) => open.has(g));
  return direct.length ? direct : groups;
}

/** The player's value to this bot, in $M (before the reserve cap the server enforces anyway). */
export function botValuation(state: AuctionState, teamId: string, playerId: string, level: BotLevel, rng: Rng): number {
  const team = getTeam(state, teamId);
  const player = state.players[playerId];
  if (!team || !player) return 0;
  if (level === 'easy') return player.marketValueM * rng.float(0.7, 1.0);

  // Medium: scarcity of the groups he fills, plus a bump for the team's neediest open slot.
  const others = availablePlayers(state, playerId);
  const supply = supplyByGroup([...others, player]);
  const demand = demandByGroup(state);
  const groups = relevantGroups(team, player);
  const ratio = Math.max(...groups.map((g) => demand[g] / Math.max(1, supply[g])));
  const scarcity = 1 + 0.35 * Math.min(1, Math.max(0, (ratio - 0.4) / 0.6));
  const open = openGroupCounts(team);
  let neediest: Group | null = null;
  let neediestRatio = Infinity;
  for (const [g, n] of open) {
    const r = supply[g] / n;
    if (r < neediestRatio) {
      neediestRatio = r;
      neediest = g;
    }
  }
  const need = neediest && groups.includes(neediest) ? 1.1 : 1;
  let value = player.marketValueM * rng.float(0.85, 1.05) * scarcity * need;
  if (level === 'medium') return value;

  // Hard: pay for the gap over the best cheaper alternative, and budget by where gaps are biggest.
  const alternatives = others.filter(
    (p) => p.marketValueM < player.marketValueM && groups.some((g) => playerGroups(p).has(g)),
  );
  const bestAlt = alternatives.reduce((m, p) => Math.max(m, p.overall), 0);
  const gap = bestAlt > 0 ? player.overall - bestAlt : 6;
  value *= Math.min(1.35, Math.max(0.75, 1 + 0.05 * (gap - 2)));

  const minBase = minBaseByGroup(others);
  const slotGaps = new Map<Group, number>();
  let reserveAll = 0;
  for (const slot of FORMATIONS[team.formation].slots) {
    if (team.lineup[slot.key] !== null) continue;
    const g = slotGroup(slot.type);
    reserveAll += Number.isFinite(minBase[g]) ? minBase[g] : 0;
    const eligible = others.filter((p) => isEligible(p, slot.type));
    if (!eligible.length) continue;
    const best = Math.max(...eligible.map((p) => p.overall));
    const cheapest = eligible.reduce((a, b) => (b.basePriceM < a.basePriceM || (b.basePriceM === a.basePriceM && b.overall > a.overall) ? b : a));
    slotGaps.set(g, Math.max(slotGaps.get(g) ?? 0, best - cheapest.overall + 1));
  }
  const totalGap = [...slotGaps.values()].reduce((s, v) => s + v, 0);
  const premium = Math.max(0, team.budgetM - reserveAll);
  const myGap = Math.max(0, ...groups.map((g) => slotGaps.get(g) ?? 0));
  const ownBase = Math.min(...groups.map((g) => (Number.isFinite(minBase[g]) ? minBase[g] : player.basePriceM)));
  if (totalGap > 0) {
    const cap = ownBase + premium * (myGap / totalGap) * 1.5;
    value = Math.min(value, Math.max(cap, player.basePriceM));
  }
  return value;
}

/** Bid amount a bot would place now, or null to pass. */
export function botBidDecision(state: AuctionState, teamId: string, valuationM: number, maxBidM: number, rng: Rng): number | null {
  const lot = state.lot;
  if (!lot || lot.leaderId === teamId) return null;
  const minNext = lot.currentBidM + state.minIncrementM;
  const ceiling = Math.min(Math.floor(valuationM), Math.floor(maxBidM));
  if (minNext > ceiling) return null;
  const step = Math.max(state.minIncrementM, Math.round(lot.currentBidM * rng.float(0.02, 0.06)));
  return Math.max(minNext, Math.min(ceiling, lot.currentBidM + step));
}

/**
 * Nomination: best (overall - replacement level) per dollar among players the bot may legally
 * nominate at base price. Replacement level of a group is the overall of the cheapest available
 * player eligible for it.
 */
export function botNominationPick(state: AuctionState, teamId: string): { playerId: string; openingBidM: number } | null {
  const team = getTeam(state, teamId);
  if (!team || isTeamFull(team)) return null;
  const available = availablePlayers(state);
  const replacement = new Map<Group, number>();
  for (const g of GROUPS) {
    let best: AuctionPlayer | null = null;
    for (const p of available) {
      if (!playerGroups(p).has(g)) continue;
      if (!best || p.basePriceM < best.basePriceM || (p.basePriceM === best.basePriceM && p.overall > best.overall)) best = p;
    }
    if (best) replacement.set(g, best.overall);
  }
  const scored = available
    .filter((p) => p.basePriceM <= team.budgetM)
    .map((p) => {
      const groups = relevantGroups(team, p);
      const repl = Math.min(...groups.map((g) => replacement.get(g) ?? p.overall));
      return { p, score: (p.overall - repl) / Math.max(1, p.basePriceM) };
    })
    .sort((a, b) => b.score - a.score || b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id));
  for (const { p } of scored) {
    const ev = evaluateCandidate(state, teamId, p.id);
    if (ev.fits && ev.feasible && p.basePriceM <= ev.maxBidM) return { playerId: p.id, openingBidM: p.basePriceM };
  }
  return autoNominationPick(state, teamId);
}
