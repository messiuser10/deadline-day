import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appSettings, auditLog, users } from '../src/db/schema';
import { ADMIN_NAME, Client, guest, signUp, testApp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe('accounts', () => {
  it('registers, remembers the session, logs out and logs back in', async () => {
    const c = new Client(t.app);
    const reg = await c.post('/api/auth/register', { username: 'Reyansh', password: 'password123', displayName: 'Rey' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ username: 'reyansh', displayName: 'Rey', role: 'user', isGuest: false });
    expect(c.cookie).toMatch(/^dd_session=/);

    expect((await c.get('/api/auth/me')).body.user.username).toBe('reyansh');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.user).toBeNull();

    expect((await c.post('/api/auth/login', { username: 'reyansh', password: 'wrong-password' })).status).toBe(401);
    const login = await c.post('/api/auth/login', { username: 'REYANSH', password: 'password123' });
    expect(login.status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user.displayName).toBe('Rey');
  });

  it('never stores the password in plain text and never returns the hash', async () => {
    const c = await signUp(t.app, 'secretive');
    const row = t.db.select().from(users).where(eq(users.username, 'secretive')).get()!;
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify((await c.get('/api/auth/me')).body)).not.toContain('passwordHash');
  });

  it('rejects taken, reserved, invalid and offensive usernames', async () => {
    await signUp(t.app, 'taken');
    const c = new Client(t.app);
    expect((await c.post('/api/auth/register', { username: 'Taken', password: 'password123' })).body.error.code).toBe('USERNAME_TAKEN');
    expect((await c.post('/api/auth/register', { username: 'guest_abc', password: 'password123' })).body.error.code).toBe('USERNAME_RESERVED');
    const bad = await c.post('/api/auth/register', { username: 'x', password: 'password123' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await c.post('/api/auth/register', { username: 'shit_kicker', password: 'password123' })).body.error.code).toBe('PROFANITY');
  });

  it('makes the configured admin username an admin', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    expect((await admin.get('/api/auth/me')).body.user.role).toBe('admin');
  });

  it('honours registrations_open but always lets the admin name register', async () => {
    t.db.update(appSettings).set({ value: false }).where(eq(appSettings.key, 'registrations_open')).run();
    const c = new Client(t.app);
    expect((await c.post('/api/auth/register', { username: 'late', password: 'password123' })).body.error.code).toBe('REGISTRATIONS_CLOSED');
    expect((await c.post('/api/auth/register', { username: ADMIN_NAME, password: 'password123' })).status).toBe(201);
  });
});

describe('guests', () => {
  it('plays as a guest, renames, then upgrades in place to an account', async () => {
    const c = await guest(t.app, 'Sunday Sam');
    const me = (await c.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ displayName: 'Sunday Sam', isGuest: true });
    expect(me.username).toMatch(/^guest_[0-9a-f]{10}$/);

    const renamed = await c.post('/api/auth/guest', { displayName: 'Sam' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.id).toBe(me.id);

    const up = await c.post('/api/auth/register', { username: 'samuel', password: 'password123' });
    expect(up.status).toBe(201);
    expect(up.body.user).toMatchObject({ id: me.id, username: 'samuel', displayName: 'Sam', isGuest: false });
  });
});

describe('admin', () => {
  it('lets only admins list and change users, and a ban ends sessions', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const user = await signUp(t.app, 'player1');
    const userId = (await user.get('/api/auth/me')).body.user.id as string;

    expect((await user.get('/api/admin/users')).status).toBe(403);
    expect((await new Client(t.app).get('/api/admin/users')).status).toBe(401);

    const list = await admin.get('/api/admin/users?q=play');
    expect(list.status).toBe(200);
    expect(list.body.users.map((u: { username: string }) => u.username)).toEqual(['player1']);

    expect((await user.patch(`/api/admin/users/${userId}`, { role: 'admin' })).status).toBe(403);
    expect((await admin.patch(`/api/admin/users/${userId}`, { banned: true })).status).toBe(200);
    expect((await user.get('/api/auth/me')).body.user).toBeNull();
    expect((await user.post('/api/auth/login', { username: 'player1', password: 'password123' })).body.error.code).toBe('BANNED');
    expect(t.db.select().from(auditLog).where(eq(auditLog.action, 'admin.user.update')).all()).toHaveLength(1);
  });

  it('stops an admin demoting themself', async () => {
    const admin = await signUp(t.app, ADMIN_NAME);
    const id = (await admin.get('/api/auth/me')).body.user.id as string;
    expect((await admin.patch(`/api/admin/users/${id}`, { role: 'user' })).body.error.code).toBe('SELF_DEMOTE');
  });
});
