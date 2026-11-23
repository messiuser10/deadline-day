/**
 * The live auction (section 8). The rules are the engine's pure functions; this service loads the
 * authoritative state from the database, applies one transition per request inside a transaction,
 * owns the timers (nomination, lot, season countdown), drives the bots and pushes every change.
 *
 * Every mutation for a game runs through one serialized queue, so two bids that arrive together are
 * applied one after the other: the first wins and the second is answered with OUTBID.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  AuctionRuleError,
  FORMATIONS,
  Rng,
  SQUAD_SIZE,
  auctionGrade,
  autoNominationPick,
  botBidDecision,
  botNominationPick,
  botValuation,
  buildLeague,
  createAuctionState,
  currentNominator,
  endAuctionEarly,
  evaluateCandidate,
  isAuctionComplete,
  isMainPosition,
  isTeamFull,
  markUnsold,
  maxBidSummary,
  nominate,
  placeBid,
  rankLeague,
  runStallGuard,
  sellLot,
  swapTeamSlots,
  type AuctionPlayer,
  type AuctionState,
  type BotLevel,
  type FormationId,
  type Group,
  type Sale,
} from '@deadline-day/engine';
import {
  BOT_DELAY_MS,
  EXTEND_TIMER_MS,
  REVEAL_STEP_MS,
  SEASON_COUNTDOWN_MS,
  revealDurationMs,
  type AuctionPlayerView,
  type AuctionTeamView,
  type AuctionView,
  type BidEvent,
  type BidInput,
  type GameSettings,
  type LotEligibility,
  type NominateInput,
  type PauseView,
  type RevealView,
  type SaleView,
  type SwapSlotsInput,
  type TeamControlInput,
} from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { bids, clubs, gamePool, games, lineupSlots, lots, participants, users, watchlist } from '../db/schema';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../errors';
import type { ReferenceData } from './reference';
import { normalizeOrder, type GameRow, type GameService, type ParticipantRow } from './service';
import type { Timers } from './timers';

type PoolRow = typeof gamePool.$inferSelect;
type LotRow = typeof lots.$inferSelect;
type SlotRow = typeof lineupSlots.$inferSelect;
type BidRow = typeof bids.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Frozen copy of a pool player written to game_pool.snapshot at auction start. */
interface PoolSnapshot {
  id: string;
  name: string;
  position: string;
  altPositions: string[];
  overall: number;
  positionRank: number;
  marketValueM: number;
  basePriceM: number;
  seedClub: string | null;
  clubNow: string | null;
  nationality: string | null;
}

/** Everything one auction transition needs, read fresh from the database. */
interface Loaded {
  game: GameRow;
  settings: GameSettings;
  teams: ParticipantRow[];
  order: string[];
  pool: PoolRow[];
  lots: LotRow[];
  liveLot: LotRow | null;
  liveBids: BidRow[];
  slots: SlotRow[];
  state: AuctionState;
}

interface BotPlan {
  ok: boolean;
  maxBidM: number;
  valueM: number;
}

export interface AuctionServiceOptions {
  db: Db;
  reference: ReferenceData;
  timers: Timers;
  /** Bot think time; null switches automatic bot and auto-nominate actions off (tests call botTick). */
  botDelayMs?: readonly [number, number] | null;
  /** Delay before an auto-nominate-only team nominates. */
  autoNominateDelayMs?: number;
}

const LIVE_STATUSES = new Set(['auctioning', 'paused', 'auction_complete', 'simulating', 'completed']);
/** setTimeout can fire a hair early relative to Date.now(). */
const EARLY_MS = 15;

/** Runs tasks for one key strictly one after another. */
class SerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

export class AuctionService {
  private readonly db: Db;
  private readonly queue = new SerialQueue();
  private readonly versions = new Map<string, number>();
  /** Per game, the live lot's eligibility and bot plans (availability is frozen while a lot is live). */
  private readonly lotCache = new Map<string, { lotId: string; eligibility?: Record<string, LotEligibility>; plans: Map<string, BotPlan> }>();

  constructor(
    private readonly games: GameService,
    private readonly opts: AuctionServiceOptions,
  ) {
    this.db = opts.db;
  }

  // -------------------------------------------------------------------------
  // Loading and views

  private load(gameId: string): Loaded {
    const game = this.games.gameById(gameId);
    const settings = this.games.gameSettings(game);
    const teams = this.games.teams(gameId);
    const order = normalizeOrder(game.nominationOrder, teams);
    const pool = this.db.select().from(gamePool).where(eq(gamePool.gameId, gameId)).all();
    const lotRows = this.db.select().from(lots).where(eq(lots.gameId, gameId)).orderBy(asc(lots.sequence)).all();
    const teamIds = teams.map((t) => t.id);
    const slots = teamIds.length ? this.db.select().from(lineupSlots).where(inArray(lineupSlots.participantId, teamIds)).all() : [];
    const liveLot = game.currentLotId ? (lotRows.find((l) => l.id === game.currentLotId) ?? null) : null;
    const liveBids = liveLot ? this.db.select().from(bids).where(eq(bids.lotId, liveLot.id)).orderBy(asc(bids.id)).all() : [];

    const base = createAuctionState({
      players: pool.map((r) => toAuctionPlayer(r.snapshot as unknown as PoolSnapshot)),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.teamName ?? 'Team',
        formation: (t.formation ?? '4-3-3') as FormationId,
        budgetM: t.budgetRemainingM,
        botLevel: botLevelOf(t),
      })),
      nominationOrder: order,
      minIncrementM: settings.minIncrementM,
    });
    const seqByLot = new Map(lotRows.map((l) => [l.id, l.sequence]));
    const state: AuctionState = {
      ...base,
      status: Object.fromEntries(pool.map((r) => [r.poolPlayerId, r.status])),
      teams: base.teams.map((t) => {
        const own = slots.filter((s) => s.participantId === t.id);
        const byKey = new Map(own.map((s) => [s.slotKey, s]));
        const lineup = Object.fromEntries(FORMATIONS[t.formation].slots.map((s) => [s.key, byKey.get(s.key)?.poolPlayerId ?? null]));
        const roster = own
          .filter((s) => s.poolPlayerId)
          .map((s) => ({
            playerId: s.poolPlayerId!,
            priceM: s.priceM ?? 0,
            autoFilled: s.autoFilled,
            lotSequence: !s.autoFilled && s.lotId ? (seqByLot.get(s.lotId) ?? null) : null,
          }))
          .sort((a, b) => (a.lotSequence ?? Infinity) - (b.lotSequence ?? Infinity));
        return { ...t, lineup, roster };
      }),
      nominationIndex: game.nominationIndex,
      lotSequence: lotRows.reduce((m, l) => Math.max(m, l.sequence), 0),
      lot: liveLot
        ? {
            sequence: liveLot.sequence,
            playerId: liveLot.poolPlayerId,
            nominatorId: liveLot.nominatorId,
            openingBidM: liveLot.openingBidM,
            currentBidM: liveLot.currentBidM,
            leaderId: liveLot.leaderParticipantId ?? liveLot.nominatorId,
            bids: liveBids.map((b) => ({ teamId: b.participantId, amountM: b.amountM })),
            autoNominated: liveLot.autoNominated,
          }
        : null,
    };
    return { game, settings, teams, order, pool, lots: lotRows, liveLot, liveBids, slots, state };
  }

  private bump(gameId: string): number {
    const v = Math.max(Date.now(), (this.versions.get(gameId) ?? 0) + 1);
    this.versions.set(gameId, v);
    return v;
  }

  /** The auction view for a snapshot, or null before the auction starts. */
  viewFor(game: GameRow): AuctionView | null {
    if (!LIVE_STATUSES.has(game.status) && !(game.status === 'cancelled' && game.poolSummary)) return null;
    if (!game.poolSummary) return null;
    return this.view(this.load(game.id));
  }

  private view(l: Loaded): AuctionView {
    const { game, state, settings } = l;
    const slotByPlayer = new Map(l.slots.filter((s) => s.poolPlayerId).map((s) => [s.poolPlayerId!, s]));
    const players: AuctionPlayerView[] = l.pool
      .map((r) => {
        const snap = r.snapshot as unknown as PoolSnapshot;
        return {
          id: r.poolPlayerId,
          name: snap.name,
          position: snap.position as Group,
          altPositions: snap.altPositions as Group[],
          overall: snap.overall,
          marketValueM: snap.marketValueM,
          basePriceM: snap.basePriceM,
          positionRank: snap.positionRank,
          clubNow: snap.clubNow ?? null,
          nationality: snap.nationality ?? null,
          status: r.status,
          soldTo: r.soldToParticipantId,
          priceM: r.priceM,
          autoFilled: slotByPlayer.get(r.poolPlayerId)?.autoFilled ?? false,
        };
      })
      .sort((a, b) => b.overall - a.overall || a.positionRank - b.positionRank || a.name.localeCompare(b.name));

    const running = game.status === 'auctioning' || (game.status === 'paused' && game.pausedTimer !== 'countdown');
    const teams: AuctionTeamView[] = l.order.map((id) => {
      const team = state.teams.find((t) => t.id === id)!;
      const byPlayer = new Map(team.roster.map((r) => [r.playerId, r]));
      const spentM = team.roster.reduce((s, r) => s + r.priceM, 0);
      const overalls = team.roster.map((r) => state.players[r.playerId]!.overall);
      return {
        participantId: id,
        budgetM: team.budgetM,
        spentM,
        maxBidM: running && !isTeamFull(team) ? Math.floor(maxBidSummary(state, id)) : 0,
        filled: team.roster.length,
        averageOverall: overalls.length ? Math.round((overalls.reduce((s, o) => s + o, 0) / overalls.length) * 10) / 10 : null,
        slots: FORMATIONS[team.formation].slots.map((s) => {
          const pid = team.lineup[s.key] ?? null;
          const entry = pid ? byPlayer.get(pid) : undefined;
          const player = pid ? state.players[pid] : undefined;
          return {
            key: s.key,
            type: s.type,
            playerId: pid,
            priceM: entry?.priceM ?? null,
            autoFilled: entry?.autoFilled ?? false,
            outOfPosition: player ? !isMainPosition(player, s.type) : false,
          };
        }),
      };
    });

    const complete = ['auction_complete', 'simulating', 'completed'].includes(game.status) || (game.status === 'paused' && game.pausedTimer === 'countdown');
    const phase: AuctionView['phase'] = complete ? 'complete' : l.liveLot ? 'bidding' : 'nominating';
    const lastSold = [...l.lots].reverse().find((x) => x.status === 'sold');
    const playback = (game.playbackState ?? {}) as { revealStartedAt?: number };
    const version = this.versions.get(game.id) ?? this.bump(game.id);

    return {
      version,
      phase,
      nominatorId: phase === 'nominating' ? (currentNominator(state)?.teamId ?? null) : null,
      nominationDeadline: game.nominationDeadline,
      lotDeadline: game.lotDeadline,
      countdownDeadline: complete ? game.countdownDeadline : null,
      paused: this.pauseView(game),
      lot:
        l.liveLot && state.lot
          ? {
              id: l.liveLot.id,
              sequence: l.liveLot.sequence,
              playerId: l.liveLot.poolPlayerId,
              nominatorId: l.liveLot.nominatorId,
              openingBidM: l.liveLot.openingBidM,
              currentBidM: l.liveLot.currentBidM,
              leaderId: state.lot.leaderId,
              autoNominated: l.liveLot.autoNominated,
              startedAt: l.liveLot.startedAt,
              bids: l.liveBids.map((b) => ({ participantId: b.participantId, amountM: b.amountM, at: b.createdAt, isBot: b.isBot })),
              eligibility: this.eligibility(l),
            }
          : null,
      players,
      teams,
      sales: this.salesOf(l),
      bought: state.teams.reduce((s, t) => s + t.roster.length, 0),
      totalSlots: state.teams.length * SQUAD_SIZE,
      canUndo: running && !!lastSold && l.liveBids.length <= 1,
      revealStartedAt: playback.revealStartedAt ?? null,
      timers: {
        nominationMs: settings.nominationTimerS * 1000,
        lotMs: settings.lotTimerS * 1000,
        antiSnipeMs: settings.antiSnipeS * 1000,
        minIncrementM: settings.minIncrementM,
      },
    };
  }

  private pauseView(game: GameRow): PauseView | null {
    if (game.status !== 'paused' || !game.pausedTimer) return null;
    const by = game.pausedByUserId ? this.db.select({ name: users.displayName }).from(users).where(eq(users.id, game.pausedByUserId)).get() : undefined;
    return { byUserId: game.pausedByUserId, byName: by?.name ?? 'The host', timer: game.pausedTimer, remainingMs: game.pausedRemainingMs ?? 0 };
  }

  private salesOf(l: Loaded): SaleView[] {
    const lotById = new Map(l.lots.map((x) => [x.id, x]));
    const sold: (SaleView & { order: number })[] = l.lots
      .filter((x) => x.status === 'sold')
      .map((x) => ({
        sequence: x.sequence,
        playerId: x.poolPlayerId,
        participantId: x.leaderParticipantId ?? x.nominatorId,
        priceM: x.finalPriceM ?? x.currentBidM,
        autoFilled: false,
        autoNominated: x.autoNominated,
        at: x.endedAt ?? x.startedAt,
        order: 0,
      }));
    const fills = l.slots
      .filter((s) => s.poolPlayerId && s.autoFilled)
      .map((s) => ({
        sequence: null,
        playerId: s.poolPlayerId!,
        participantId: s.participantId,
        priceM: s.priceM ?? 0,
        autoFilled: true,
        autoNominated: false,
        at: (s.lotId ? lotById.get(s.lotId)?.endedAt : null) ?? l.game.updatedAt,
        order: 1,
      }));
    return [...sold, ...fills].sort((a, b) => a.at - b.at || a.order - b.order).map(({ order: _order, ...sale }) => sale);
  }

  private lotEntry(l: Loaded) {
    const lotId = l.liveLot!.id;
    let entry = this.lotCache.get(l.game.id);
    if (!entry || entry.lotId !== lotId) {
      entry = { lotId, plans: new Map() };
      this.lotCache.set(l.game.id, entry);
    }
    return entry;
  }

  private eligibility(l: Loaded): Record<string, LotEligibility> {
    const entry = this.lotEntry(l);
    if (entry.eligibility) return entry.eligibility;
    const playerId = l.state.lot!.playerId;
    const out: Record<string, LotEligibility> = {};
    for (const team of l.state.teams) {
      if (isTeamFull(team)) {
        out[team.id] = { ok: false, code: 'TEAM_FULL', maxBidM: 0 };
        continue;
      }
      const ev = evaluateCandidate(l.state, team.id, playerId);
      out[team.id] = {
        ok: ev.fits && ev.feasible,
        code: !ev.fits ? 'NO_SLOT' : !ev.feasible ? 'WOULD_STRAND_TEAM' : null,
        maxBidM: Number.isFinite(ev.maxBidM) ? Math.max(0, Math.floor(ev.maxBidM)) : 0,
      };
    }
    entry.eligibility = out;
    return out;
  }

  // -------------------------------------------------------------------------
  // Guards

  private ruleCheck<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof AuctionRuleError) {
        const { code, message, ...rest } = err.violation;
        throw conflict(code, message, Object.keys(rest).length ? rest : undefined);
      }
      throw err;
    }
  }

  private requireRunning(game: GameRow): void {
    if (game.status === 'paused') throw conflict('PAUSED', 'The auction is paused');
    if (game.status !== 'auctioning') throw conflict('NOT_AUCTIONING', 'The auction is not running');
  }

  private requireTeam(game: GameRow, user: UserRow): ParticipantRow {
    const me = this.games.participantRow(game.id, user.id);
    if (!me || me.isSpectator) throw forbidden('NOT_IN_GAME', 'You do not manage a team in this game');
    return me;
  }

  // -------------------------------------------------------------------------
  // Player actions

  nominate(user: UserRow, code: string, input: NominateInput): Promise<AuctionView> {
    const game = this.games.findGame(code);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      this.requireRunning(l.game);
      const me = this.requireTeam(l.game, user);
      return this.doNominate(l, me.id, input.playerId, input.openingBidM, { auto: false, isBot: false });
    });
  }

  bid(user: UserRow, code: string, input: BidInput): Promise<BidEvent> {
    const game = this.games.findGame(code);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      this.requireRunning(l.game);
      const me = this.requireTeam(l.game, user);
      if (!l.liveLot) throw conflict('NO_LOT', 'No player is up for auction');
      if (input.lotSequence !== undefined && input.lotSequence !== l.liveLot.sequence) {
        throw conflict('LOT_CLOSED', 'That player is no longer up for auction');
      }
      if (l.game.lotDeadline !== null && Date.now() >= l.game.lotDeadline) {
        // The clock already hit zero; the sale is about to run.
        throw conflict('LOT_CLOSED', 'Too late: the clock ran out');
      }
      return this.doBid(l, me.id, input.amountM, input.seenBidM, false);
    });
  }

  swap(user: UserRow, code: string, input: SwapSlotsInput): Promise<AuctionView> {
    const game = this.games.findGame(code);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      if (!['auctioning', 'paused', 'auction_complete'].includes(l.game.status)) throw conflict('NOT_AUCTIONING', 'Lineups are locked now');
      const me = this.requireTeam(l.game, user);
      const next = this.ruleCheck(() => swapTeamSlots(l.state, me.id, input.slotA, input.slotB));
      const lineup = next.teams.find((t) => t.id === me.id)!.lineup;
      const rows = new Map(l.slots.filter((s) => s.participantId === me.id).map((s) => [s.slotKey, s]));
      this.db.transaction((tx) => {
        for (const key of [input.slotA, input.slotB]) {
          const source = [...rows.values()].find((r) => r.poolPlayerId === lineup[key] && lineup[key] !== null);
          tx.update(lineupSlots)
            .set({
              poolPlayerId: lineup[key] ?? null,
              priceM: source?.priceM ?? null,
              lotId: source?.lotId ?? null,
              autoFilled: source?.autoFilled ?? false,
            })
            .where(and(eq(lineupSlots.participantId, me.id), eq(lineupSlots.slotKey, key)))
            .run();
        }
      });
      return this.afterChange(game.id);
    });
  }

  // Watchlist -----------------------------------------------------------------

  watchlist(user: UserRow, code: string): string[] {
    const game = this.games.findGame(code);
    const me = this.games.participantRow(game.id, user.id);
    if (!me) return [];
    return this.db
      .select({ id: watchlist.poolPlayerId })
      .from(watchlist)
      .where(eq(watchlist.participantId, me.id))
      .orderBy(asc(watchlist.sortOrder))
      .all()
      .map((r) => r.id);
  }

  star(user: UserRow, code: string, playerId: string, on: boolean): string[] {
    const game = this.games.findGame(code);
    const me = this.requireTeam(game, user);
    if (on) {
      const inPool = this.db
        .select({ id: gamePool.poolPlayerId })
        .from(gamePool)
        .where(and(eq(gamePool.gameId, game.id), eq(gamePool.poolPlayerId, playerId)))
        .get();
      if (!inPool) throw notFound('UNKNOWN_PLAYER', 'That player is not in this auction');
      const count = this.db.select({ id: watchlist.poolPlayerId }).from(watchlist).where(eq(watchlist.participantId, me.id)).all().length;
      this.db.insert(watchlist).values({ participantId: me.id, poolPlayerId: playerId, sortOrder: count }).onConflictDoNothing().run();
    } else {
      this.db
        .delete(watchlist)
        .where(and(eq(watchlist.participantId, me.id), eq(watchlist.poolPlayerId, playerId)))
        .run();
    }
    return this.watchlist(user, code);
  }

  // -------------------------------------------------------------------------
  // Host and admin controls

  pause(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      const g = l.game;
      const now = Date.now();
      let timer: PauseView['timer'];
      let deadline: number | null;
      if (g.status === 'paused') throw conflict('ALREADY_PAUSED', 'The auction is already paused');
      if (g.status === 'auctioning') {
        timer = l.liveLot ? 'lot' : 'nomination';
        deadline = timer === 'lot' ? g.lotDeadline : g.nominationDeadline;
      } else if (g.status === 'auction_complete' && g.countdownDeadline !== null) {
        timer = 'countdown';
        deadline = g.countdownDeadline;
      } else {
        throw conflict('NOTHING_TO_PAUSE', 'There is no running clock to pause');
      }
      const remainingMs = Math.max(0, (deadline ?? now) - now);
      this.db.transaction((tx) => {
        tx.update(games)
          .set({
            status: 'paused',
            pausedTimer: timer,
            pausedRemainingMs: remainingMs,
            pausedByUserId: user.id,
            nominationDeadline: null,
            lotDeadline: null,
            countdownDeadline: null,
            updatedAt: now,
          })
          .where(eq(games.id, g.id))
          .run();
        audit(tx, { actorUserId: user.id, action: 'game.pause', target: g.joinCode, gameId: g.id, details: { timer, remainingMs } });
      });
      return this.afterChange(g.id);
    });
  }

  resume(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const g = this.games.gameById(game.id);
      if (g.status !== 'paused') throw conflict('NOT_PAUSED', 'The auction is not paused');
      const now = Date.now();
      const timer = g.pausedTimer ?? 'nomination';
      const deadline = now + (g.pausedRemainingMs ?? 0);
      this.db.transaction((tx) => {
        tx.update(games)
          .set({
            status: timer === 'countdown' ? 'auction_complete' : 'auctioning',
            nominationDeadline: timer === 'nomination' ? deadline : null,
            lotDeadline: timer === 'lot' ? deadline : null,
            countdownDeadline: timer === 'countdown' ? deadline : null,
            pausedTimer: null,
            pausedRemainingMs: null,
            pausedByUserId: null,
            updatedAt: now,
          })
          .where(eq(games.id, g.id))
          .run();
        audit(tx, { actorUserId: user.id, action: 'game.resume', target: g.joinCode, gameId: g.id, details: { timer, remainingMs: g.pausedRemainingMs } });
      });
      return this.afterChange(g.id);
    });
  }

  /** Skip the current nomination: the server auto-nominates for the team on the clock. */
  skip(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      this.requireRunning(l.game);
      if (l.liveLot) throw conflict('LOT_IN_PROGRESS', 'A player is already up for auction');
      audit(this.db, { actorUserId: user.id, action: 'game.nomination.skip', target: l.game.joinCode, gameId: l.game.id });
      return this.autoNominate(l);
    });
  }

  /** Add 10 seconds to whichever clock is running (or to the frozen one while paused). */
  extend(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const g = this.games.gameById(game.id);
      const set: Partial<GameRow> = { updatedAt: Date.now() };
      if (g.status === 'paused') set.pausedRemainingMs = (g.pausedRemainingMs ?? 0) + EXTEND_TIMER_MS;
      else if (g.status === 'auctioning' && g.currentLotId && g.lotDeadline !== null) set.lotDeadline = g.lotDeadline + EXTEND_TIMER_MS;
      else if (g.status === 'auctioning' && g.nominationDeadline !== null) set.nominationDeadline = g.nominationDeadline + EXTEND_TIMER_MS;
      else if (g.status === 'auction_complete' && g.countdownDeadline !== null) set.countdownDeadline = g.countdownDeadline + EXTEND_TIMER_MS;
      else throw conflict('NOTHING_TO_EXTEND', 'There is no running clock to extend');
      this.db.transaction((tx) => {
        tx.update(games).set(set).where(eq(games.id, g.id)).run();
        audit(tx, { actorUserId: user.id, action: 'game.timer.extend', target: g.joinCode, gameId: g.id, details: { ms: EXTEND_TIMER_MS } });
      });
      return this.afterChange(g.id);
    });
  }

  /**
   * Undo the last sale while the next lot has no bids beyond the opening one: refund, return the
   * player (and any auto-fills that sale triggered), void the next lot and give the nominator the turn back.
   */
  undo(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      const g = l.game;
      if (g.status !== 'auctioning' && !(g.status === 'paused' && g.pausedTimer !== 'countdown')) {
        throw conflict('NOT_AUCTIONING', 'Sales can only be undone while the auction is running');
      }
      if (l.liveLot && l.liveBids.length > 1) throw conflict('LOT_IN_PROGRESS', 'Cannot undo once the next lot has bids');
      const last = [...l.lots].reverse().find((x) => x.status === 'sold');
      if (!last) throw conflict('NOTHING_TO_UNDO', 'No sale to undo');
      const revert = l.slots.filter(
        (s) => s.poolPlayerId && ((!s.autoFilled && s.poolPlayerId === last.poolPlayerId) || (s.autoFilled && s.lotId === last.id)),
      );
      const refunds = new Map<string, number>();
      for (const r of revert) refunds.set(r.participantId, (refunds.get(r.participantId) ?? 0) + (r.priceM ?? 0));
      const now = Date.now();
      const nomMs = l.settings.nominationTimerS * 1000;
      const paused = g.status === 'paused';
      const playerName = l.state.players[last.poolPlayerId]?.name ?? last.poolPlayerId;

      this.db.transaction((tx) => {
        if (l.liveLot) {
          tx.update(lots).set({ status: 'void', endedAt: now }).where(eq(lots.id, l.liveLot.id)).run();
          this.setPoolStatus(tx, g.id, l.liveLot.poolPlayerId, 'available', null, null);
        }
        tx.update(lots).set({ status: 'void' }).where(eq(lots.id, last.id)).run();
        for (const r of revert) {
          tx.update(lineupSlots)
            .set({ poolPlayerId: null, priceM: null, lotId: null, autoFilled: false })
            .where(and(eq(lineupSlots.participantId, r.participantId), eq(lineupSlots.slotKey, r.slotKey)))
            .run();
          this.setPoolStatus(tx, g.id, r.poolPlayerId!, 'available', null, null);
        }
        for (const [teamId, refund] of refunds) {
          const t = l.teams.find((x) => x.id === teamId)!;
          tx.update(participants).set({ budgetRemainingM: t.budgetRemainingM + refund }).where(eq(participants.id, teamId)).run();
        }
        tx.update(games)
          .set({
            currentLotId: null,
            lotDeadline: null,
            nominationIndex: Math.max(0, l.order.indexOf(last.nominatorId)),
            nominationDeadline: paused ? null : now + nomMs,
            ...(paused ? { pausedTimer: 'nomination' as const, pausedRemainingMs: nomMs } : {}),
            updatedAt: now,
          })
          .where(eq(games.id, g.id))
          .run();
        audit(tx, {
          actorUserId: user.id,
          action: 'game.sale.undo',
          target: last.poolPlayerId,
          gameId: g.id,
          details: { player: playerName, participantId: last.leaderParticipantId, priceM: last.finalPriceM, autoFillsReverted: revert.length - 1 },
        });
      });
      this.games.broadcaster.notice(g.id, { code: 'SALE_UNDONE', level: 'info', message: `The host undid the sale of ${playerName}` });
      return this.afterChange(g.id);
    });
  }

  /** End early: void the live lot and auto-fill every open slot with the cheapest matching players. */
  endEarly(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      const g = l.game;
      if (g.status !== 'auctioning' && !(g.status === 'paused' && g.pausedTimer !== 'countdown')) {
        throw conflict('NOT_AUCTIONING', 'The auction is not running');
      }
      const { state: final, fills } = this.ruleCheck(() => endAuctionEarly(l.state));
      const now = Date.now();
      this.db.transaction((tx) => {
        if (l.liveLot) tx.update(lots).set({ status: 'void', endedAt: now }).where(eq(lots.id, l.liveLot.id)).run();
        this.writeDiff(tx, l, final, null);
        tx.update(games)
          .set({ currentLotId: null, lotDeadline: null, nominationDeadline: null, pausedTimer: null, pausedRemainingMs: null, pausedByUserId: null, updatedAt: now })
          .where(eq(games.id, g.id))
          .run();
        this.complete(tx, l, now);
        audit(tx, { actorUserId: user.id, action: 'game.auction.end_early', target: g.joinCode, gameId: g.id, details: { autoFills: fills.length } });
      });
      for (const f of fills) this.games.broadcaster.auctionSold(g.id, toSaleView(f, now));
      return this.afterChange(g.id);
    });
  }

  /** Reset the auction to its first nomination: same pool and order, every purchase cancelled. */
  reset(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      const g = l.game;
      if (!['auctioning', 'paused', 'auction_complete'].includes(g.status)) throw conflict('NOT_AUCTIONING', 'The auction cannot be reset now');
      const now = Date.now();
      const teamIds = l.teams.map((t) => t.id);
      this.db.transaction((tx) => {
        tx.update(lineupSlots).set({ poolPlayerId: null, priceM: null, lotId: null, autoFilled: false }).where(inArray(lineupSlots.participantId, teamIds)).run();
        tx.delete(lots).where(eq(lots.gameId, g.id)).run();
        tx.update(gamePool).set({ status: 'available', soldToParticipantId: null, priceM: null }).where(eq(gamePool.gameId, g.id)).run();
        tx.update(participants).set({ budgetRemainingM: l.settings.budgetM }).where(inArray(participants.id, teamIds)).run();
        tx.update(games)
          .set({
            status: 'auctioning',
            currentLotId: null,
            nominationIndex: 0,
            nominationDeadline: now + l.settings.nominationTimerS * 1000,
            lotDeadline: null,
            countdownDeadline: null,
            pausedTimer: null,
            pausedRemainingMs: null,
            pausedByUserId: null,
            playbackState: null,
            updatedAt: now,
          })
          .where(eq(games.id, g.id))
          .run();
        audit(tx, { actorUserId: user.id, action: 'game.auction.reset', target: g.joinCode, gameId: g.id, details: { lots: l.lots.length } });
      });
      this.lotCache.delete(g.id);
      this.games.broadcaster.notice(g.id, { code: 'AUCTION_RESET', level: 'info', message: 'The host reset the auction' });
      return this.afterChange(g.id);
    });
  }

  /**
   * Who runs a human team: the host hands a disconnected manager's team to a bot or to
   * auto-nominate only; the host or the manager hands it back.
   */
  setControl(user: UserRow, code: string, participantId: string, input: TeamControlInput): Promise<AuctionView> {
    const game = this.games.findGame(code);
    return this.queue.run(game.id, () => {
      const g = this.games.gameById(game.id);
      if (!['auctioning', 'paused'].includes(g.status)) throw conflict('NOT_AUCTIONING', 'The auction is not running');
      const target = this.games.teams(g.id).find((t) => t.id === participantId);
      if (!target) throw notFound('PARTICIPANT_NOT_FOUND', 'No such team in this game');
      if (target.isBot) throw badRequest('NOT_HUMAN', 'Bots are always run by the server');
      const isOwner = target.userId === user.id;
      if (input.mode === 'human') {
        if (!isOwner) this.games.requireHost(g, user);
      } else {
        this.games.requireHost(g, user);
        if (target.isConnected) throw conflict('MANAGER_CONNECTED', `${target.teamName ?? 'That team'}'s manager is still connected`);
      }
      const level: BotLevel = input.level ?? target.botLevel ?? 'medium';
      this.db.transaction((tx) => {
        tx.update(participants)
          .set({ control: input.mode, botLevel: input.mode === 'bot' ? level : target.botLevel })
          .where(eq(participants.id, target.id))
          .run();
        audit(tx, { actorUserId: user.id, action: 'game.team.control', target: target.id, gameId: g.id, details: { mode: input.mode, level, teamName: target.teamName } });
      });
      this.lotCache.get(g.id)?.plans.delete(target.id);
      this.games.broadcastLobby(g.id);
      return this.afterChange(g.id);
    });
  }

  /** Start the season now (host), or when the post-auction countdown runs out. */
  startSeason(user: UserRow, code: string): Promise<AuctionView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.queue.run(game.id, () => {
      const l = this.load(game.id);
      if (l.game.status === 'paused') throw conflict('PAUSED', 'Resume the countdown first');
      if (l.game.status !== 'auction_complete') throw conflict('NOT_COMPLETE', 'The auction is not finished yet');
      return this.seasonStart(l, user.id);
    });
  }

  // -------------------------------------------------------------------------
  // Transitions (always called inside the game's queue)

  private doNominate(l: Loaded, teamId: string, playerId: string, openingBidM: number, opts: { auto: boolean; isBot: boolean }): AuctionView {
    const next = this.ruleCheck(() => nominate(l.state, teamId, playerId, openingBidM, { auto: opts.auto }));
    const now = Date.now();
    this.db.transaction((tx) => {
      const lot = tx
        .insert(lots)
        .values({
          gameId: l.game.id,
          sequence: next.lot!.sequence,
          poolPlayerId: playerId,
          nominatorId: teamId,
          openingBidM,
          currentBidM: openingBidM,
          leaderParticipantId: teamId,
          status: 'live',
          startedAt: now,
          autoNominated: opts.auto,
        })
        .returning()
        .get();
      tx.insert(bids).values({ lotId: lot.id, participantId: teamId, amountM: openingBidM, createdAt: now, isBot: opts.isBot }).run();
      tx.update(gamePool)
        .set({ status: 'live' })
        .where(and(eq(gamePool.gameId, l.game.id), eq(gamePool.poolPlayerId, playerId)))
        .run();
      tx.update(games)
        .set({ currentLotId: lot.id, nominationDeadline: null, lotDeadline: now + l.settings.lotTimerS * 1000, updatedAt: now })
        .where(eq(games.id, l.game.id))
        .run();
    });
    return this.afterChange(l.game.id);
  }

  private doBid(l: Loaded, teamId: string, amountM: number, seenBidM: number | undefined, isBot: boolean): BidEvent {
    const lot = l.liveLot!;
    this.ruleCheck(() => placeBid(l.state, teamId, amountM, seenBidM));
    const now = Date.now();
    const antiSnipeMs = l.settings.antiSnipeS * 1000;
    const deadline = l.game.lotDeadline ?? now;
    const lotDeadline = antiSnipeMs > 0 && deadline - now < antiSnipeMs ? now + antiSnipeMs : deadline;
    this.db.transaction((tx) => {
      tx.insert(bids).values({ lotId: lot.id, participantId: teamId, amountM, createdAt: now, isBot }).run();
      tx.update(lots).set({ currentBidM: amountM, leaderParticipantId: teamId }).where(eq(lots.id, lot.id)).run();
      tx.update(games).set({ lotDeadline, updatedAt: now }).where(eq(games.id, l.game.id)).run();
    });
    const event: BidEvent = {
      version: this.bump(l.game.id),
      lotId: lot.id,
      sequence: lot.sequence,
      bid: { participantId: teamId, amountM, at: now, isBot },
      currentBidM: amountM,
      leaderId: teamId,
      lotDeadline,
    };
    this.games.broadcaster.auctionBid(l.game.id, event);
    this.syncTimers(this.load(l.game.id));
    return event;
  }

  /** The lot clock hit zero: sell to the leader, run the stall guard, and finish the auction when every team is full. */
  private sell(l: Loaded): AuctionView {
    const lot = l.liveLot!;
    const { state: sold, sale } = sellLot(l.state);
    const guard = runStallGuard(sold);
    const done = isAuctionComplete(guard.state);
    const final = done ? markUnsold(guard.state) : guard.state;
    const now = Date.now();
    this.db.transaction((tx) => {
      tx.update(lots).set({ status: 'sold', finalPriceM: sale.priceM, endedAt: now }).where(eq(lots.id, lot.id)).run();
      this.writeDiff(tx, l, final, lot.id);
      tx.update(games)
        .set({
          currentLotId: null,
          lotDeadline: null,
          nominationIndex: final.nominationIndex,
          nominationDeadline: done ? null : now + l.settings.nominationTimerS * 1000,
          updatedAt: now,
        })
        .where(eq(games.id, l.game.id))
        .run();
      if (done) this.complete(tx, l, now);
    });
    this.games.broadcaster.auctionSold(l.game.id, toSaleView(sale, now));
    for (const f of guard.fills) this.games.broadcaster.auctionSold(l.game.id, toSaleView(f, now));
    return this.afterChange(l.game.id);
  }

  /** Auto-nominate for the team on the clock (timer expiry, host skip, or an auto-nominate-only team). */
  private autoNominate(l: Loaded): AuctionView {
    const turn = currentNominator(l.state);
    if (!turn) return this.afterChange(l.game.id);
    const pick = autoNominationPick(l.state, turn.teamId);
    if (pick) return this.doNominate(l, turn.teamId, pick.playerId, pick.openingBidM, { auto: true, isBot: false });
    // Nothing legal to nominate: the stall guard fills the stuck teams, then try again.
    const guard = runStallGuard(l.state);
    if (!guard.fills.length) throw new ApiError(500, 'STALLED', 'No team can nominate a player');
    const done = isAuctionComplete(guard.state);
    const final = done ? markUnsold(guard.state) : guard.state;
    const now = Date.now();
    const lastSold = [...l.lots].reverse().find((x) => x.status === 'sold');
    this.db.transaction((tx) => {
      this.writeDiff(tx, l, final, lastSold?.id ?? null);
      if (done) this.complete(tx, l, now);
    });
    for (const f of guard.fills) this.games.broadcaster.auctionSold(l.game.id, toSaleView(f, now));
    const fresh = this.load(l.game.id);
    return done ? this.afterChange(l.game.id) : this.autoNominate(fresh);
  }

  /** Every team is full: unsold players are marked (by writeDiff), the reveal starts, and the season countdown with it. */
  private complete(tx: Tx, l: Loaded, now: number): void {
    const countdown = l.settings.autoStartSeason ? now + revealDurationMs(l.teams.length) + SEASON_COUNTDOWN_MS : null;
    tx.update(games)
      .set({ status: 'auction_complete', countdownDeadline: countdown, playbackState: { revealStartedAt: now }, updatedAt: now })
      .where(eq(games.id, l.game.id))
      .run();
    audit(tx, { actorUserId: null, action: 'game.auction.complete', target: l.game.joinCode, gameId: l.game.id, details: { lots: l.lots.length + 1 } });
  }

  /** M3 stops at the Team Reveal; the season simulation (M4) plugs in here. */
  private seasonStart(l: Loaded, actorUserId: string | null): AuctionView {
    const now = Date.now();
    const playback = { ...((l.game.playbackState ?? {}) as Record<string, unknown>), seasonRequestedAt: now };
    this.db.update(games).set({ countdownDeadline: null, playbackState: playback, updatedAt: now }).where(eq(games.id, l.game.id)).run();
    audit(this.db, { actorUserId, action: 'game.season.start', target: l.game.joinCode, gameId: l.game.id, details: { simulated: false } });
    this.games.broadcaster.notice(l.game.id, {
      code: 'SEASON_PENDING',
      level: 'info',
      message: 'The season simulation is not built yet. It arrives with the next update.',
    });
    return this.afterChange(l.game.id);
  }

  /** Write every player status, budget and lineup slot that differs between the loaded state and `next`. */
  private writeDiff(tx: Tx, l: Loaded, next: AuctionState, fillLotId: string | null): void {
    const gameId = l.game.id;
    const lotIdBySeq = new Map(l.lots.map((x) => [x.sequence, x.id]));
    const buyer = new Map<string, { teamId: string; priceM: number }>();
    for (const t of next.teams) for (const r of t.roster) buyer.set(r.playerId, { teamId: t.id, priceM: r.priceM });
    for (const [id, status] of Object.entries(next.status)) {
      if (l.state.status[id] === status) continue;
      const b = status === 'sold' ? buyer.get(id) : undefined;
      this.setPoolStatus(tx, gameId, id, status, b?.teamId ?? null, b?.priceM ?? null);
    }
    for (const t of next.teams) {
      const prev = l.state.teams.find((x) => x.id === t.id)!;
      if (prev === t) continue;
      if (prev.budgetM !== t.budgetM) tx.update(participants).set({ budgetRemainingM: t.budgetM }).where(eq(participants.id, t.id)).run();
      for (const [key, pid] of Object.entries(t.lineup)) {
        if (prev.lineup[key] === pid) continue;
        const entry = pid ? t.roster.find((r) => r.playerId === pid) : undefined;
        const prevRow = pid ? l.slots.find((s) => s.participantId === t.id && s.poolPlayerId === pid) : undefined;
        const lotId = prevRow
          ? prevRow.lotId
          : entry?.autoFilled
            ? fillLotId
            : entry && entry.lotSequence !== null
              ? (lotIdBySeq.get(entry.lotSequence) ?? null)
              : null;
        tx.update(lineupSlots)
          .set({ poolPlayerId: pid ?? null, priceM: entry?.priceM ?? null, lotId: pid ? lotId : null, autoFilled: entry?.autoFilled ?? false })
          .where(and(eq(lineupSlots.participantId, t.id), eq(lineupSlots.slotKey, key)))
          .run();
      }
    }
  }

  private setPoolStatus(tx: Tx, gameId: string, playerId: string, status: PoolRow['status'], soldTo: string | null, priceM: number | null): void {
    tx.update(gamePool)
      .set({ status, soldToParticipantId: soldTo, priceM })
      .where(and(eq(gamePool.gameId, gameId), eq(gamePool.poolPlayerId, playerId)))
      .run();
  }

  /** After a committed change: push the new state, then re-arm the timers and the bots. */
  private afterChange(gameId: string): AuctionView {
    this.bump(gameId);
    const l = this.load(gameId);
    const view = this.view(l);
    this.games.broadcaster.auctionState(gameId, view);
    this.syncTimers(l);
    return view;
  }

  // -------------------------------------------------------------------------
  // Timers

  /** Called by the phase timer; also lets tests run an expiry after moving a deadline into the past. */
  tick(gameId: string): Promise<void> {
    return this.queue.run(gameId, () => {
      this.expire(gameId);
    });
  }

  private expire(gameId: string): void {
    const l = this.load(gameId);
    const g = l.game;
    const now = Date.now() + EARLY_MS;
    if (g.status === 'auction_complete') {
      if (g.countdownDeadline !== null && now >= g.countdownDeadline) this.seasonStart(l, null);
      else this.syncTimers(l);
      return;
    }
    if (g.status !== 'auctioning') return;
    if (l.liveLot) {
      if (g.lotDeadline === null || now < g.lotDeadline) return this.syncTimers(l);
      this.sell(l);
    } else {
      if (g.nominationDeadline === null || now < g.nominationDeadline) return this.syncTimers(l);
      this.autoNominate(l);
    }
  }

  private syncTimers(l: Loaded): void {
    const g = l.game;
    const key = `auction:${g.id}`;
    const deadline =
      g.status === 'auctioning' ? (l.liveLot ? g.lotDeadline : g.nominationDeadline) : g.status === 'auction_complete' ? g.countdownDeadline : null;
    if (deadline === null) this.opts.timers.cancel(key);
    else this.opts.timers.schedule(key, deadline - Date.now(), () => this.fire(g.id, () => this.expire(g.id)));
    this.scheduleBots(l);
  }

  private fire(gameId: string, task: () => void): void {
    this.queue.run(gameId, task).catch((err: unknown) => {
      console.error(`[auction ${gameId}]`, err);
    });
  }

  /** Re-arm timers after a restart or at the start of the auction. Paused games stay paused. */
  resumeTimers(gameId: string): void {
    this.fire(gameId, () => this.syncTimers(this.load(gameId)));
  }

  stopTimers(gameId: string): void {
    this.opts.timers.cancel(`auction:${gameId}`);
    this.opts.timers.cancel(`bots:${gameId}`);
    this.lotCache.delete(gameId);
  }

  // -------------------------------------------------------------------------
  // Bots

  private actorOf(l: Loaded, teamId: string): 'human' | 'bot' | 'auto' {
    const t = l.teams.find((x) => x.id === teamId);
    if (!t) return 'human';
    if (t.isBot) return 'bot';
    return t.control;
  }

  private scheduleBots(l: Loaded): void {
    const key = `bots:${l.game.id}`;
    this.opts.timers.cancel(key);
    const delays = this.opts.botDelayMs === undefined ? BOT_DELAY_MS : this.opts.botDelayMs;
    if (!delays || l.game.status !== 'auctioning') return;
    const now = Date.now();
    const think = () => delays[0] + Math.random() * (delays[1] - delays[0]);
    if (!l.liveLot) {
      const turn = currentNominator(l.state);
      if (!turn) return;
      const actor = this.actorOf(l, turn.teamId);
      if (actor === 'human') return;
      const delay = actor === 'bot' ? think() : (this.opts.autoNominateDelayMs ?? 1500);
      this.opts.timers.schedule(key, delay, () => this.fire(l.game.id, () => this.botTickNow(l.game.id)));
      return;
    }
    if (!this.botOffers(l).length) return;
    const remaining = (l.game.lotDeadline ?? now) - now;
    const delay = Math.min(think(), Math.max(150, remaining - 400));
    this.opts.timers.schedule(key, delay, () => this.fire(l.game.id, () => this.botTickNow(l.game.id)));
  }

  /** One bot action: nominate when a bot (or auto team) is on the clock, else the best bot offer on the live lot. */
  botTick(gameId: string): Promise<boolean> {
    return this.queue.run(gameId, () => this.botTickNow(gameId));
  }

  private botTickNow(gameId: string): boolean {
    const l = this.load(gameId);
    if (l.game.status !== 'auctioning') return false;
    const seed = l.game.seed ?? 1;
    if (!l.liveLot) {
      const turn = currentNominator(l.state);
      if (!turn) return false;
      const actor = this.actorOf(l, turn.teamId);
      if (actor === 'human') return false;
      if (actor === 'auto') {
        this.autoNominate(l);
        return true;
      }
      const pick = botNominationPick(l.state, turn.teamId);
      if (!pick) {
        this.autoNominate(l);
        return true;
      }
      this.doNominate(l, turn.teamId, pick.playerId, pick.openingBidM, { auto: false, isBot: true });
      return true;
    }
    const offers = this.botOffers(l);
    if (!offers.length) return false;
    const choice = Rng.from(seed, 'pick', l.liveLot.sequence, l.liveBids.length).pick(offers);
    try {
      this.doBid(l, choice.teamId, choice.amountM, l.liveLot.currentBidM, true);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return false;
      throw err;
    }
  }

  private botOffers(l: Loaded): { teamId: string; amountM: number }[] {
    const lot = l.state.lot;
    if (!lot) return [];
    const seed = l.game.seed ?? 1;
    const entry = this.lotEntry(l);
    const out: { teamId: string; amountM: number }[] = [];
    for (const team of l.state.teams) {
      if (!team.botLevel || team.id === lot.leaderId || isTeamFull(team)) continue;
      let plan = entry.plans.get(team.id);
      if (!plan) {
        const ev = evaluateCandidate(l.state, team.id, lot.playerId);
        plan = {
          ok: ev.fits && ev.feasible,
          maxBidM: ev.maxBidM,
          valueM: botValuation(l.state, team.id, lot.playerId, team.botLevel, Rng.from(seed, 'value', lot.sequence, team.id)),
        };
        entry.plans.set(team.id, plan);
      }
      if (!plan.ok) continue;
      const amountM = botBidDecision(l.state, team.id, plan.valueM, plan.maxBidM, Rng.from(seed, 'bid', lot.sequence, lot.bids.length, team.id));
      if (amountM !== null) out.push({ teamId: team.id, amountM });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Team Reveal (section 10)

  reveal(code: string): RevealView {
    const game = this.games.findGame(code);
    const countdownPause = game.status === 'paused' && game.pausedTimer === 'countdown';
    if (!['auction_complete', 'simulating', 'completed'].includes(game.status) && !countdownPause) {
      throw conflict('NOT_COMPLETE', 'The Team Reveal starts when the auction is finished');
    }
    const l = this.load(game.id);
    const app = this.games.appSettings();
    const rows = new Map(l.teams.map((t) => [t.id, t]));
    const { teams: league } = buildLeague({
      auctionTeams: l.state.teams.map((team) => ({ team, kind: rows.get(team.id)!.isBot ? ('bot' as const) : ('human' as const) })),
      players: l.state.players,
      clubs: this.opts.reference.clubSquads(),
      aiClubIds: game.aiClubIds ?? [],
      removeBought: l.settings.removeBoughtFromAi,
      xiOptions: { formations: app.formations_enabled, compatibility: app.slot_compatibility },
    });
    const ranked = rankLeague(league);
    const rankById = new Map(ranked.map((r) => [r.id, r]));
    const clubRows = new Map(this.db.select().from(clubs).all().map((c) => [c.id, c]));
    const views = this.games.participantViewsFor(game);
    const viewById = new Map(views.map((v) => [v.id, v]));
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const teams = l.state.teams
      .map((team) => {
        const r = rankById.get(team.id)!;
        const v = viewById.get(team.id)!;
        const byPlayer = new Map(team.roster.map((e) => [e.playerId, e]));
        const slots = FORMATIONS[team.formation].slots.map((s) => {
          const p = l.state.players[team.lineup[s.key]!]!;
          const e = byPlayer.get(p.id)!;
          return {
            key: s.key,
            type: s.type,
            playerId: p.id,
            name: p.name,
            position: p.position,
            overall: p.overall,
            priceM: e.priceM,
            marketValueM: p.marketValueM,
            autoFilled: e.autoFilled,
            outOfPosition: !isMainPosition(p, s.type),
          };
        });
        const spentM = team.roster.reduce((s, e) => s + e.priceM, 0);
        const grade = auctionGrade({
          preRank: r.rank,
          startingBudgetM: l.settings.budgetM,
          xiMarketValueM: slots.reduce((s, x) => s + x.marketValueM, 0),
          leagueSize: ranked.length,
        });
        return {
          participantId: team.id,
          teamName: v.teamName,
          managerName: v.managerName,
          color: v.color,
          monogram: v.monogram,
          formation: team.formation,
          isBot: v.isBot,
          slots,
          spentM,
          leftM: team.budgetM,
          attack: round1(r.attack),
          defense: round1(r.defense),
          strength: round1(r.strength),
          rank: r.rank,
          grade: grade.grade,
          gradeScore: grade.score,
        };
      })
      .sort((a, b) => b.rank - a.rank);

    return {
      revealStartedAt: ((game.playbackState ?? {}) as { revealStartedAt?: number }).revealStartedAt ?? game.updatedAt,
      stepMs: REVEAL_STEP_MS,
      teams,
      unsold: l.pool
        .filter((p) => p.status === 'unsold')
        .map((p) => {
          const s = p.snapshot as unknown as PoolSnapshot;
          return { id: p.poolPlayerId, name: s.name, position: s.position as Group, overall: s.overall, basePriceM: s.basePriceM };
        })
        .sort((a, b) => b.overall - a.overall),
      league: ranked.map((r) => {
        const v = viewById.get(r.id);
        const c = clubRows.get(r.id);
        return {
          id: r.id,
          name: r.name,
          kind: r.kind,
          participantId: v ? v.id : null,
          color: v?.color ?? c?.primaryColor ?? '#888888',
          monogram: v?.monogram ?? c?.monogram ?? r.name.slice(0, 3).toUpperCase(),
          attack: round1(r.attack),
          defense: round1(r.defense),
          strength: round1(r.strength),
          rank: r.rank,
        };
      }),
    };
  }
}

function botLevelOf(t: ParticipantRow): BotLevel | null {
  if (t.isBot) return t.botLevel ?? 'medium';
  if (t.control === 'bot') return t.botLevel ?? 'medium';
  return null;
}

function toAuctionPlayer(s: PoolSnapshot): AuctionPlayer {
  return {
    id: s.id,
    name: s.name,
    position: s.position as Group,
    altPositions: s.altPositions as Group[],
    overall: s.overall,
    marketValueM: s.marketValueM,
    basePriceM: s.basePriceM,
    positionRank: s.positionRank,
    seedClub: s.seedClub,
    nationality: s.nationality,
  };
}

function toSaleView(sale: Sale, at: number): SaleView {
  return {
    sequence: sale.sequence,
    playerId: sale.playerId,
    participantId: sale.teamId,
    priceM: sale.priceM,
    autoFilled: sale.autoFilled,
    autoNominated: sale.autoNominated,
    at,
  };
}
