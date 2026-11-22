# Deadline Day

A multiplayer web game. Friends (2 to 12 teams) each get a $1 billion budget and bid in a live auction for real footballers. Every team must finish with a valid starting XI, then the app simulates a full 38-matchday season against the strongest AI clubs.

> Deadline Day is an unofficial fan game. It is not affiliated with, endorsed by or connected to any club, league or player. No official crests, logos or player photos are used.

**Status:** milestone M0 (scaffold and data) is done. See `AUCTION_SPEC.md` section 13 for the milestone plan and `DECISIONS.md` for choices the spec left open.

## Requirements

- Node.js 22 or newer (`.nvmrc` says 22) and npm 10+
- No database server needed: SQLite is the default

## Install

```bash
npm install
cp .env.example .env    # optional, every variable has a development default
```

## Data

The player data is supplied in `data/` and must not be regenerated:

| File | Contents |
| --- | --- |
| `auction_players.csv` / `.json` | Master auction pool, 570 men's players (the CSV is authoritative; the JSON must agree) |
| `clubs.json` | The 20 AI-capable clubs |
| `players.seed.json` / `players.csv` | The 618 players in those clubs' squads |

```bash
npm run data:validate                  # checks data/, exits 1 on any error
npm run data:validate -- --dir <path>  # checks another folder with the same five files
```

The check covers row counts, duplicate ids, positions and alternates, ratings, the price formula, `seed_club` links (all 265 must resolve to exactly one squad player), CSV and JSON agreement, and that every position group has enough players for 12 teams in the worst case.

## Database and seed

```bash
npm run seed            # applies migrations, then loads clubs, squads, pool and default settings
npm run seed -- --reset # also overwrites existing clubs, squads and pool players from data/
npm run db:migrate      # applies pending migrations only
```

Seeding is idempotent: by default it inserts missing rows and leaves existing ones alone, so admin edits survive. Settings keys are only ever added when missing. The SQLite file lives at `var/deadline-day.sqlite` (gitignored).

After changing `apps/server/src/db/schema.ts`, mirror the change in `schema.pg.ts` (a test fails if they drift) and run:

```bash
npm run db:generate     # writes SQLite migrations to apps/server/drizzle/sqlite and Postgres ones to drizzle/pg
```

## Run

```bash
npm run dev             # API server on :3001 and web app on http://localhost:5173 (proxies /api)
```

## Test, typecheck, lint

```bash
npm test
npm run typecheck
npm run lint
```

## Deploy

A Dockerfile, docker-compose file and single-process production build (server serving the web assets) arrive in milestone M7. Until then, `npm run build` builds the web app into `apps/web/dist`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3001` | API server port (the web dev server proxies to it) |
| `HOST` | `0.0.0.0` | API server bind address |
| `DATABASE_URL` | `file:./var/deadline-day.sqlite` | `file:<path>` for SQLite (relative to the repo root) or `:memory:`. Postgres URLs are recognised, but the Postgres runtime driver is not wired yet (see DECISIONS.md) |
| `ADMIN_USERNAME` | `admin` | A user who registers with this username becomes admin |
| `SESSION_SECRET` | dev-only value | Signs session cookies. Required in production (at least 16 characters) |
| `WEB_ORIGIN` | `http://localhost:5173` | Web app origin, for CORS in development |

`.env` in the repo root is loaded automatically. Never commit it.

## Layout

```
packages/engine   pure game logic (positions, formations, prices, pool sizing, data validation; more in M1), Vitest tests
apps/server       Fastify server, Drizzle schema (SQLite + Postgres mirror), migrations, seed
apps/web          React + Vite + Tailwind client
scripts/          seed, data validation, migrations (simulation CLI in M1)
data/             supplied player and club data
```
