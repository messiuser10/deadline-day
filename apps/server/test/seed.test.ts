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
    expect(result.seedPlayers.after).toBe(618);
    expect(result.poolPlayers.after).toBe(570);
    expect(result.appSettings.after).toBeGreaterThan(0);

    const messi = db.select().from(poolPlayers).where(eq(poolPlayers.name, 'Lionel Messi')).get();
    expect(messi).toMatchObject({ position: 'CAM', altPositions: ['ST', 'RW', 'RM'], altSource: 'ea', overall: expect.any(Number) });

    const atleti = db.select().from(clubs).where(eq(clubs.id, 'atletico-madrid')).get();
    expect(atleti?.name).toBe('Atlético Madrid');
    const linked = db.select().from(poolPlayers).all().filter((p) => p.seedClub !== null);
    expect(linked).toHaveLength(265);
    expect(new Set(linked.map((p) => p.seedClub)).size).toBeLessThanOrEqual(20);
  });

  it('is idempotent', () => {
    seedDatabase(db, data);
    const second = seedDatabase(db, data);
    expect(second.clubs.inserted).toBe(0);
    expect(second.seedPlayers.inserted).toBe(0);
    expect(second.poolPlayers.inserted).toBe(0);
    expect(second.appSettings.inserted).toBe(0);
    expect(second.poolPlayers.after).toBe(570);
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
    expect(db.select().from(seedPlayers).all()).toHaveLength(618);
  });

  it('refuses to seed data that fails validation', () => {
    const broken = { ...data, report: { ...data.report, errors: ['boom'] } };
    expect(() => seedDatabase(db, broken)).toThrow(/validation failed/);
  });
});
