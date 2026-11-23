import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, secureCookies } from '../src/config';
import { findWebBuild } from '../src/web';
import { testApp, type TestApp } from './helpers';

describe('production web serving (one process)', () => {
  let dir: string;
  let t: TestApp;
  const js = 'console.log("deadline day");'.repeat(80);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dd-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Deadline Day</title><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), js);
    writeFileSync(join(dir, 'assets', 'index-abc123.js.gz'), gzipSync(js));
    t = await testApp({ webDir: dir });
  });
  afterAll(async () => {
    await t.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html for the home page and every client route, never cached', async () => {
    for (const url of ['/', '/lobby/ABC123', '/season/ABC123?s=2', '/admin/pool']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('<div id="root">');
    }
  });

  it('serves hashed assets for a year, pre-compressed when the browser accepts it', async () => {
    const plain = await t.app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(plain.body).toBe(js);
    const gz = await t.app.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
  });

  it('keeps JSON 404s for the API and real 404s for missing files', async () => {
    const api = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const post = await t.app.inject({ method: 'POST', url: '/lobby/ABC123' });
    expect(post.statusCode).toBe(404);
    const file = await t.app.inject({ method: 'GET', url: '/missing.png' });
    expect(file.statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ status: 'ok' });
  });

  it('adds basic security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('finds a build only when it has an index.html', () => {
    expect(findWebBuild(dir)).toBe(dir);
    expect(findWebBuild(join(dir, 'assets'))).toBeNull();
  });
});

describe('production config', () => {
  const base = { NODE_ENV: 'production', SESSION_SECRET: 'a-long-random-production-secret' } as NodeJS.ProcessEnv;

  it('refuses the development and example session secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'change-me-to-a-long-random-string' } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(loadConfig(base).SESSION_SECRET).toBe('a-long-random-production-secret');
  });

  it('uses Secure cookies in production unless COOKIE_SECURE=false', () => {
    expect(secureCookies(loadConfig(base))).toBe(true);
    expect(secureCookies(loadConfig({ ...base, COOKIE_SECURE: 'false' }))).toBe(false);
    expect(secureCookies(loadConfig({ SESSION_SECRET: 'x'.repeat(20) } as NodeJS.ProcessEnv))).toBe(false);
  });
});
