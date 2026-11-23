# Deadline Day

A multiplayer web game. Friends (2 to 12 teams) each get a $1 billion budget and bid in a live auction for real footballers. Every team must finish with a valid starting XI, then the app simulates a full 38-matchday season against the strongest AI clubs.

> Deadline Day is an unofficial fan game. It is not affiliated with, endorsed by or connected to any club, league or player. No official crests, logos or player photos are used.

**Status:** milestones M0 (scaffold and data), M1 (game engine), M2 (server foundation: accounts, guests, lobby, live updates, auction start) and M3 (live auction and Team Reveal) are done. The season simulation and results screens are next (M4). See `AUCTION_SPEC.md` section 13 for the milestone plan and `DECISIONS.md` for choices the spec left open.

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
| `auction_players.csv` / `.json` | Master auction pool, 571 men's players (the CSV is authoritative; the JSON must agree). `club_now` is the player's real club as of 22 Nov 2026, shown in the UI only |
| `clubs.json` | The 20 AI-capable clubs |
| `players.seed.json` / `players.csv` | The 609 players in those clubs' squads (as of 22 Nov 2026) |

```bash
npm run data:validate                  # checks data/, exits 1 on any error
npm run data:validate -- --dir <path>  # checks another folder with the same five files
```

The check covers row counts, duplicate ids, positions and alternates, ratings, the price formula, `seed_club` links (all 264 must resolve to exactly one squad player), CSV and JSON agreement, and that every position group has enough players for 12 teams in the worst case.

## Database and seed

```bash
npm run seed            # applies migrations, then loads clubs, squads, pool and default settings
npm run seed -- --reset # also overwrites clubs, squads and pool players from data/, deletes squad players
                        # no longer in data/ and marks pool players no longer in data/ inactive
npm run db:migrate      # applies pending migrations only
```

Seeding is idempotent: by default it inserts missing rows and leaves existing ones alone, so admin edits survive. Settings keys are only ever added when missing. The SQLite file lives at `var/deadline-day.sqlite` (gitignored).

After changing `apps/server/src/db/schema.ts`, mirror the change in `schema.pg.ts` (a test fails if they drift) and run:

```bash
npm run db:generate     # writes SQLite migrations to apps/server/drizzle/sqlite and Postgres ones to drizzle/pg
```

## Run

```bash
npm run dev             # API server on :3001 and web app on http://localhost:5173 (proxies /api and /socket.io)
```

Open http://localhost:5173 on a laptop or a phone-sized window. What works now: sign up, log in or play as a guest; create a game or a one-click solo game against three bots; join by code, link, QR or the public lobby list; edit your team (name, colour, badge, formation); watch the live pool preview and AI club list change as teams join; host controls (rules, bots, kick, transfer host, nomination order, cancel); lobby chat; Ready and Start with a 5-second countdown; and the kickoff screen with the frozen pool and AI clubs.

The live auction room: nominate on your turn (with an opening bid), bid with quick buttons, a custom amount or your max bid, and watch the server-run lot timer with anti-snipe, "Going once / Going twice" and a SOLD stamp. The pool panel filters by position, rating, price, club and "Only players I can buy"; your pitch fills as you buy and you can swap players between legal slots. Rival budgets and max bids, a sales log, a watchlist with an alert when a starred player comes up, and chat sit in tabs. The host can pause, resume, skip a nomination, add 10 seconds, undo the last sale, end early (auto-fills every open slot) or reset, and hand a disconnected team to a bot. Bots bid and nominate on their own. When every team is full the auction ends by itself and the Team Reveal plays: each team's XI, prices, strength and a grade preview, then the league preview, then a short countdown to the season (the season itself arrives in M4). On a phone the room becomes one column with tabs and a fixed bid bar at the bottom.

## Accounts and admin

- Accounts use a username and password (bcrypt). Guests get a session with just a display name and can later turn it into an account without losing their games.
- Sessions are an httpOnly cookie `dd_session` that lasts 30 days and slides on use.
- Register with the username in `ADMIN_USERNAME` to become an admin. Admins can act as host in any game and use `GET /api/admin/users` and `PATCH /api/admin/users/:id` (role, ban). The admin panel UI arrives in M6.

## API and realtime

All changes go through REST (JSON, validated with the zod schemas in `packages/protocol`); errors look like `{ "error": { "code", "message" } }`. Auction rule errors are `409` and may add `details` (for example `minBidM`, `maxBidM`, `currentBidM`). Every lobby change answers with the new lobby state and also pushes it over Socket.IO to everyone watching the game. Every host action is checked on the server.

| Area | Routes |
| --- | --- |
| Auth | `GET /api/auth/me`, `POST /api/auth/register`, `/login`, `/guest`, `/logout` |
| Games | `POST /api/games`, `POST /api/games/solo`, `GET /api/games/public`, `GET /api/games/:code` |
| Players | `POST :code/join`, `PATCH :code/team`, `POST :code/leave`, `POST :code/chat` |
| Host | `PATCH :code/settings`, `POST :code/bots`, `PATCH`/`DELETE :code/participants/:id`, `POST :code/host`, `PUT :code/order`, `POST :code/order/randomize`, `POST :code/start`, `POST :code/cancel` |
| Auction | `POST :code/auction/nominate`, `POST :code/auction/bid`, `POST :code/lineup/swap`, `GET :code/watchlist`, `PUT`/`DELETE :code/watchlist/:playerId`, `GET :code/reveal` |
| Auction host | `POST :code/auction/pause`, `/resume`, `/skip`, `/extend`, `/undo`, `/end`, `/reset`, `POST :code/participants/:id/control` (bot, auto-nominate or human), `POST :code/season/start` |

Socket.IO (path `/socket.io`, same cookie): the client emits `game:watch { code }` and gets the full snapshot in the reply, then receives `lobby:update`, `presence`, `chat:message`, `game:snapshot` (on start), `game:kicked`, `game:notice`, and during the auction `auction:state` (the full versioned auction view), `auction:bid` (a small delta per bid) and `auction:sold`. `time:sync` returns the server clock so countdowns agree across devices.

## Simulation CLI

Runs a whole game with bot teams and no server: random formations, pool build, bot auction, AI club selection, season sim and the final table.

```bash
npm run sim -- --teams 3 --seed 42
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--teams N` | 3 | Auction teams, 2 to 12 |
| `--seed S` | 42 | Game seed; the same seed always gives the same game |
| `--bots LEVEL` | mixed | `easy`, `medium`, `hard` or `mixed` |
| `--budget M` | 1000 | Starting budget in $M |
| `--montecarlo K` | off | Also simulate K seasons of the final league and print the expected-strength table |
| `--runs R` | off | Run R games on seeds S to S+R-1 and print realism stats (champion and bottom points, goals per match) instead |
| `--base-goals`, `--home-advantage`, `--sensitivity`, `--chaos` | see DECISIONS.md | Override simulation parameters for tuning |

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
| `PORT` | `3001` | API server port. The web dev server reads the same variable to know where to proxy |
| `HOST` | `0.0.0.0` | API server bind address |
| `DATABASE_URL` | `file:./var/deadline-day.sqlite` | `file:<path>` for SQLite (relative to the repo root) or `:memory:`. Postgres URLs are recognised, but the Postgres runtime driver is not wired yet (see DECISIONS.md) |
| `ADMIN_USERNAME` | `admin` | A user who registers with this username becomes admin |
| `SESSION_SECRET` | dev-only value | Signs the `dd_session` cookie. Required in production (at least 16 characters); cookies are also marked Secure there |
| `WEB_ORIGIN` | `http://localhost:5173` | Reserved, not read yet: in development Vite proxies `/api` and `/socket.io`, so the app is same-origin |

M3 adds no environment variables. `.env` in the repo root is loaded automatically. Never commit it.

## Layout

```
packages/engine   pure game logic: positions, formations, prices, pool, lineups, auction rules, bots, clubs, fixtures, match and season sim, Monte Carlo, awards; Vitest tests
packages/protocol API contract shared by server and web: zod request schemas, view types, socket events, limits
apps/server       Fastify server: auth, games and lobby service, live auction service (serialized per game, server timers, bots), Socket.IO hub, admin routes, Drizzle schema (SQLite + Postgres mirror), migrations, seed
apps/web          React + Vite + Tailwind client, mobile first: home, login, create, lobby, kickoff, auction room, Team Reveal, how to play
scripts/          seed, data validation, migrations, simulation CLI
data/             supplied player and club data
```
