import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, openDb, runMigrations, seedDatabase, type Db } from '../src/db';
import { appSettings, clubs, poolPlayers, seedPlayers } from '../src/db/schema';
import { loadData } from '../src/data/load';

const data = loadData();
let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
});

afterEach(() => closeDb(db));

describe('seed', () => {
  it('loads the supplied data', () => {
    const result = seedDatabase(db, data);
    expect(result.clubs.after).toBe(20);
    expect(result.seedPlayers.after).toBe(609);
    expect(result.poolPlayers.after).toBe(571);
    expect(result.appSettings.after).toBeGreaterThan(0);

    const messi = db.select().from(poolPlayers).where(eq(poolPlayers.name, 'Lionel Messi')).get();
    expect(messi).toMatchObject({ position: 'CAM', altPositions: ['ST', 'RW', 'RM'], altSource: 'ea', overall: expect.any(Number) });

    const atleti = db.select().from(clubs).where(eq(clubs.id, 'atletico-madrid')).get();
    expect(atleti?.name).toBe('Atlético Madrid');
    const linked = db.select().from(poolPlayers).all().filter((p) => p.seedClub !== null);
    expect(linked).toHaveLength(264);
    expect(new Set(linked.map((p) => p.seedClub)).size).toBeLessThanOrEqual(20);
  });

  it('is idempotent', () => {
    seedDatabase(db, data);
    const second = seedDatabase(db, data);
    expect(second.clubs.inserted).toBe(0);
    expect(second.seedPlayers.inserted).toBe(0);
    expect(second.poolPlayers.inserted).toBe(0);
    expect(second.appSettings.inserted).toBe(0);
    expect(second.poolPlayers.after).toBe(571);
  });

  it('keeps admin edits unless reset is asked for', () => {
    seedDatabase(db, data);
    const id = data.masterPlayers[0]!.id;
    db.update(poolPlayers).set({ overall: 50 }).where(eq(poolPlayers.id, id)).run();
    db.update(appSettings).set({ value: 'Custom League' }).where(eq(appSettings.key, 'league_name')).run();

    seedDatabase(db, data);
    expect(db.select().from(poolPlayers).where(eq(poolPlayers.id, id)).get()?.overall).toBe(50);

    seedDatabase(db, data, { reset: true });
    expect(db.select().from(poolPlayers).where(eq(poolPlayers.id, id)).get()?.overall).toBe(data.masterPlayers[0]!.overall);
    expect(db.select().from(appSettings).where(eq(appSettings.key, 'league_name')).get()?.value).toBe('Custom League');
    expect(db.select().from(seedPlayers).all()).toHaveLength(609);
  });

  it('stores club_now for display', () => {
    seedDatabase(db, data);
    const rows = db.select().from(poolPlayers).all();
    expect(rows.filter((p) => p.clubNow !== null).length).toBe(data.masterPlayers.filter((p) => p.clubNow !== null).length);
    const courtois = rows.find((p) => p.id === 'thibaut-courtois-gk');
    expect(courtois?.clubNow).toBe('Real Madrid');
  });

  it('removes squad players and retires pool players that left the files, only on reset', () => {
    seedDatabase(db, data);
    const squad = data.seedPlayers[0]!;
    db.insert(seedPlayers)
      .values({ id: 'real-madrid--old-player', clubId: 'real-madrid', fullName: 'Old Player', primaryPosition: 'CB', altPositions: [], overall: 80, nationality: null })
      .run();
    db.insert(poolPlayers)
      .values({ id: 'old-player-cb', name: 'Old Player', position: 'CB', overall: 70, positionRank: 99, marketValueM: 1, basePriceM: 1 })
      .run();

    const plain = seedDatabase(db, data);
    expect(plain.stale).toEqual({ seedPlayers: 1, poolPlayers: 1 });
    expect(db.select().from(seedPlayers).all()).toHaveLength(610);

    const reset = seedDatabase(db, data, { reset: true });
    expect(reset.stale).toEqual({ seedPlayers: 1, poolPlayers: 1 });
    expect(db.select().from(seedPlayers).all()).toHaveLength(609);
    expect(db.select().from(seedPlayers).where(eq(seedPlayers.id, squad.id)).get()).toBeDefined();
    expect(db.select().from(poolPlayers).where(eq(poolPlayers.id, 'old-player-cb')).get()?.isActive).toBe(false);
    expect(db.select().from(poolPlayers).where(eq(poolPlayers.isActive, true)).all()).toHaveLength(571);
    expect(seedDatabase(db, data).stale).toEqual({ seedPlayers: 0, poolPlayers: 0 });
  });

  it('refuses to seed data that fails validation', () => {
    const broken = { ...data, report: { ...data.report, errors: ['boom'] } };
    expect(() => seedDatabase(db, broken)).toThrow(/validation failed/);
  });
});
