/**
 * Admin: Overview (section 11, tab 1). Headline counts, the latest audit entries and data health checks.
 */
import { count, eq, inArray } from 'drizzle-orm';
import { MAX_TEAMS, planFromNeeds, prices, worstCaseNeeds, type Group } from '@deadline-day/engine';
import type { AdminOverview, HealthWarning } from '@deadline-day/protocol';
import type { Db } from '../db/client';
import { games, poolPlayers, seasons, seedPlayers, users, clubs } from '../db/schema';
import type { GameService } from '../games/service';
import type { AuditAdmin } from './audit';
import type { PoolAdmin } from './pool';

/** An AI club needs a full XI before reserves (rated at reserve_rating) fill the gaps. */
const MIN_SQUAD = 11;

export class OverviewAdmin {
  constructor(
    private readonly db: Db,
    private readonly games: GameService,
    private readonly pool: PoolAdmin,
    private readonly audit: AuditAdmin,
  ) {}

  private n(rows: { n: number }[]): number {
    return rows[0]?.n ?? 0;
  }

  health(): HealthWarning[] {
    const app = this.games.appSettings();
    const out: HealthWarning[] = [];
    const pool = this.db.select().from(poolPlayers).all();
    const active = pool.filter((p) => p.isActive);

    const byGroup = new Map<Group, number>();
    for (const p of active) byGroup.set(p.position as Group, (byGroup.get(p.position as Group) ?? 0) + 1);
    const plan = planFromNeeds(worstCaseNeeds(MAX_TEAMS, app.formations_enabled), app.pool_params);
    const short = plan.groups.filter((g) => (byGroup.get(g.group) ?? 0) < g.size);
    if (short.length) {
      out.push({
        level: 'error',
        code: 'POOL_SHORT',
        message: `A ${MAX_TEAMS}-team game could run short of ${short.map((g) => `${g.group} (${byGroup.get(g.group) ?? 0} of ${g.size})`).join(', ')}. Add or reactivate pool players.`,
      });
    }

    const mismatched = pool.filter((p) => {
      const want = prices(p.overall, app.price_curve);
      return want.marketValueM !== p.marketValueM || want.basePriceM !== p.basePriceM;
    }).length;
    if (mismatched) {
      out.push({ level: 'warning', code: 'PRICE_MISMATCH', message: `${mismatched} pool player(s) have prices that do not match the price curve. Apply the Reprice tool to fix them.` });
    }

    const duplicates = this.pool.list().duplicates;
    if (duplicates.length) {
      out.push({ level: 'warning', code: 'POOL_DUPLICATES', message: `${duplicates.length} possible duplicate player(s) in the pool, e.g. ${duplicates[0]!.join(' and ')}.` });
    }

    const sizes = new Map(this.db.select({ id: seedPlayers.clubId, n: count() }).from(seedPlayers).groupBy(seedPlayers.clubId).all().map((r) => [r.id, r.n]));
    const thin = this.db
      .select({ id: clubs.id, name: clubs.name })
      .from(clubs)
      .all()
      .filter((c) => (sizes.get(c.id) ?? 0) < MIN_SQUAD);
    if (thin.length) {
      out.push({ level: 'warning', code: 'THIN_SQUADS', message: `${thin.map((c) => `${c.name} (${sizes.get(c.id) ?? 0})`).join(', ')} have fewer than ${MIN_SQUAD} squad players; reserves will fill their XI.` });
    }

    if (app.maintenance_banner.message) out.push({ level: 'warning', code: 'BANNER_ON', message: `The site banner is showing: "${app.maintenance_banner.message}"` });
    if (!app.registrations_open) out.push({ level: 'warning', code: 'REGISTRATIONS_CLOSED', message: 'Registrations are closed. New visitors can only play as guests.' });
    return out;
  }

  view(): AdminOverview {
    const allUsers = this.db.select({ isGuest: users.isGuest, role: users.role, banned: users.banned }).from(users).all();
    const statusCount = (statuses: (typeof games.$inferSelect)['status'][]) =>
      this.n(this.db.select({ n: count() }).from(games).where(inArray(games.status, statuses)).all());
    return {
      counts: {
        users: allUsers.length,
        registered: allUsers.filter((u) => !u.isGuest).length,
        guests: allUsers.filter((u) => u.isGuest).length,
        admins: allUsers.filter((u) => u.role === 'admin').length,
        banned: allUsers.filter((u) => u.banned).length,
        activeLobbies: statusCount(['lobby']),
        auctionsInProgress: statusCount(['auctioning', 'paused']),
        seasonsSimulated: this.n(this.db.select({ n: count() }).from(seasons).all()),
        gamesCompleted: statusCount(['completed']),
        poolPlayers: this.n(this.db.select({ n: count() }).from(poolPlayers).all()),
        activePoolPlayers: this.n(this.db.select({ n: count() }).from(poolPlayers).where(eq(poolPlayers.isActive, true)).all()),
      },
      recent: this.audit.recent(12),
      health: this.health(),
    };
  }
}
