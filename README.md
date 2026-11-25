# Deadline Day

A multiplayer web game. Friends (2 to 12 teams) each get a $1 billion budget and bid in a live auction for real footballers. Every team must finish with a valid starting XI, then the app simulates a full 38-matchday season against the strongest AI clubs.

> Deadline Day is an unofficial fan game. It is not affiliated with, endorsed by or connected to any club, league or player. No official crests, logos or player photos are used.

**Status:** milestones M0 (scaffold and data), M1 (game engine), M2 (server foundation: accounts, guests, lobby, live updates, auction start), M3 (live auction and Team Reveal), M4 (season simulation and playback), M5 (results, awards, profiles and history) M6 (admin panel and audit log) and M7 (polish, Docker, single-process production build, smoke test) are done, and `ACCEPTANCE.md` maps every item of the section 14 acceptance checklist to the test that proves it. See `AUCTION_SPEC.md` section 13 for the milestone plan and `DECISIONS.md` for choices the spec left open.

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

The server also applies pending migrations when it starts (M6 adds `0004_test_games`, a `games.is_test` flag), and fills an empty database from `data/` (a fresh deployment needs no separate seed step). Seeding is idempotent: by default it inserts missing rows and leaves existing ones alone, so admin edits survive. Settings keys are only ever added when missing. The SQLite file lives at `var/deadline-day.sqlite` (gitignored).

After changing `apps/server/src/db/schema.ts`, mirror the change in `schema.pg.ts` (a test fails if they drift) and run:

```bash
npm run db:generate     # writes SQLite migrations to apps/server/drizzle/sqlite and Postgres ones to drizzle/pg
```

## Run

```bash
npm run dev             # API server on :3001 and web app on http://localhost:5173 (proxies /api and /socket.io)
```

Open http://localhost:5173 on a laptop or a phone-sized window. What works now: sign up, log in or play as a guest; create a game or a one-click solo game against three bots; join by code, link, QR or the public lobby list; edit your team (name, colour, badge, formation); watch the live pool preview and AI club list change as teams join; host controls (rules, bots, kick, transfer host, nomination order, cancel); lobby chat; Ready and Start with a 5-second countdown; and the kickoff screen with the frozen pool and AI clubs.

The live auction room: nominate on your turn (with an opening bid), bid with quick buttons, a custom amount or your max bid, and watch the server-run lot timer with anti-snipe, "Going once / Going twice" and a SOLD stamp. The pool panel filters by position, rating, price, club and "Only players I can buy"; your pitch fills as you buy and you can swap players between legal slots. Rival budgets and max bids, a sales log, a watchlist with an alert when a starred player comes up, and chat sit in tabs. The host can pause, resume, skip a nomination, add 10 seconds, undo the last sale, end early (auto-fills every open slot) or reset, and hand a disconnected team to a bot. Bots bid and nominate on their own. When every team is full the auction ends by itself and the Team Reveal plays: each team's XI, prices, strength and a grade preview, then the league preview, then a short countdown to the season. On a phone the room becomes one column with tabs and a fixed bid bar at the bottom.

The season (`/season/:code`): the server simulates and saves all 38 matchdays, then everyone watches them play out. Play, pause, 1x/2x/5x/Instant, jump to any matchday or skip to the end. In synchronized mode the host drives one shared clock; in own-pace mode each player has their own. Each matchday shows 10 result cards with live scores and scorers (auction teams first and highlighted); tap one for the minute-by-minute ticker. The live table has position arrows, form and coloured bands; Key Moments lists derbies, hat-tricks, big wins, upsets and new leaders. The host can Run It Back (same teams, new seed; earlier seasons stay viewable), anyone can simulate 2 to 10 more seasons for a titles table, and Expected Strength shows average points and title, top four and bottom three chances over 1,000 seasons. League Teams (`/league/:code`) ranks all 20 teams by strength from the moment the auction starts, and each links to its XI (`/team/:code/:teamId`). On a phone the season page becomes swipeable tabs (Results, Table, Moments, Seasons) with the playback bar fixed at the bottom.

Around the whole app: a dark matchday theme with a light theme switch in the header (dark is the default), optional sound effects (a gavel on each sale, a whistle at kick-off and full time; off by default, synthesised in the browser), a short How to Play walkthrough on the first visit (replay it from `/how-to-play`), keyboard navigation in the auction pool (`/` to search, arrow keys, Enter to nominate, `W` to star), a reconnecting banner when the live connection drops, skeleton loaders, empty states and plain error messages. Reduced motion turns the animations and confetti off. Both theme and sound are stored per device.

Season Complete (`/results/:code`, opens at each viewer's final whistle): the final table with bands, a champion banner and confetti; awards (Champion, Golden Boot, Playmaker, Golden Glove, Player of the Season, Best Buy, Biggest Overpay) and the Team of the Season on a pitch; an auction grade (A+ to F) for every auction team with money spent and left, most expensive signing, best bargain and a Steal / Fair / Overpay tag on each purchase; head to head for every pair of auction teams; Copy Summary and Download Image (a season card). The host can Run It Back, Rematch (new lobby, same people, fresh auction) and export the season as JSON or CSV. Team pages (`/team/:code/:id?s=N`) show the XI on a pitch with each player's rating, goals, assists and clean sheets, a league position timeline with W/D/L, home and away splits, biggest win, longest unbeaten run and top scorer. Profiles (`/profile`, `/profile/:username`) show games, titles, top fours, average finish, best grade, a trophy cabinet and every game played. The Hall of Fame (`/hall-of-fame`) lists finished games with the record book beside it, and the leaderboard (`/leaderboard`) ranks registered players by titles, then average finish. Season 1 of each game is the official result; Run It Back seasons do not count.

## Accounts and admin

- Accounts use a username and password (bcrypt). Guests get a session with just a display name and can later turn it into an account without losing their games.
- Sessions are an httpOnly cookie `dd_session` that lasts 30 days and slides on use.
- Register with the username in `ADMIN_USERNAME` to become an admin; admins can promote others from the panel. Admins can act as host in any game.
- The admin panel lives at `/admin` (an Admin link appears in the header and account menu for admins). Tabs: Overview (counts, data health, recent activity), Pool players (search, filter, inline edit, add, bulk actions, CSV/JSON export, import with a diff preview, duplicate detection, Reprice tool), Clubs (colours, monograms, strength overrides, AI squads, a live ranking with an N slider showing which clubs become AI teams), Games (every game; spectate, force start, pause/resume, skip, extend, undo, end with auto-fill, reset, replace a manager with a bot, reorder nominations, re-run the season, change seed, export, cancel, delete), Settings, Simulation Lab (any 20 teams, 1 or up to 1,000 seasons, plus a one-click Test Auction), Users (search, promote, ban, see games, delete a user's data), Audit log (filters, CSV export) and Announcements (site banner).
- Every `/api/admin/*` route checks the admin role on the server before anything else (a normal user gets `403 ADMIN_ONLY`), and every admin and host action is written to `audit_log`. The web guard only hides the page.

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
| Season | `GET :code/season?number=N` (full season: fixtures, events, tables, key moments), `GET :code/season/expected`, `GET :code/season/multi?seasons=2..10&run=R`, `GET :code/league` (no login needed for these) |
| Season host | `POST :code/season/playback` (`play`, `pause`, `speed`, `seek`, `end`), `POST :code/season/rerun` (Run It Back) |
| Results | `GET :code/results?number=N` (awards, grades, player stats, team reports, head to head; no login needed) |
| Results host | `POST :code/rematch`, `GET :code/export?format=json\|csv&table=table\|fixtures\|players\|grades&number=N` |
| History | `GET /api/profile` (signed in), `GET /api/profiles/:username`, `GET /api/hall-of-fame?before=<ms>`, `GET /api/leaderboard`, `GET /api/records` |
| Admin | All under `/api/admin`, admin only. `GET /overview`; `GET`/`POST /pool`, `PATCH`/`DELETE /pool/:id`, `POST /pool/bulk`, `GET /pool/export?format=csv\|json`, `POST /pool/import/preview`, `/pool/import/apply`, `/pool/reprice/preview`, `/pool/reprice/apply`; `GET /clubs`, `PATCH /clubs/:id`, `GET`/`POST /clubs/:id/squad`, `PUT`/`DELETE /clubs/:id/squad/:playerId`; `GET /games?status=&q=&before=`, `GET /games/:code`, `PUT /games/:code/order`, `POST /games/:code/seed`, `DELETE /games/:code`; `GET`/`PUT /settings` (`{ key, value }`); `GET /lab/teams?game=`, `POST /lab/run`, `POST /lab/test-auction`; `GET /users?q=&filter=`, `GET`/`PATCH /users/:id`, `POST /users/:id/delete`; `GET /audit?actor=&action=&game=&from=&to=&before=`, `GET /audit/export` |

Socket.IO (path `/socket.io`, same cookie): the client emits `game:watch { code }` and gets the full snapshot in the reply, then receives `lobby:update`, `presence`, `chat:message`, `game:snapshot` (on start), `game:kicked`, `game:notice`, during the auction `auction:state` (the full versioned auction view), `auction:bid` (a small delta per bid) and `auction:sold`, and during the season `season:playback` (the versioned shared playback clock). `time:sync` returns the server clock so countdowns agree across devices.

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
npm test                # Vitest: engine, server and web unit and integration tests
npm run typecheck
npm run lint
npm run e2e             # Playwright smoke test (builds the web app first)
```

The smoke test (`e2e/smoke.spec.ts`) runs in Chromium at a phone size against the production build: a guest dismisses the first-visit walkthrough, creates a game with short timers, adds two bots, plays the whole auction (nominating on their turns), watches the reveal, plays the season to the end and opens the results. `e2e/server.ts` starts that server on port 3199 (`E2E_PORT`) with a fresh seeded database in `e2e/.tmp/` and fast bots. The first run needs a browser: `npx playwright install chromium`. A full run takes about two minutes. Failures leave a trace and screenshot in `test-results/` and a report in `playwright-report/`.

## Deploy

In production one Node process serves the API, the realtime socket and the built web app (hashed assets cached for a year, pre-compressed with Brotli and gzip; any page route gets `index.html`).

```bash
npm ci
npm run build                                   # web app into apps/web/dist
NODE_ENV=production npm start                   # http://localhost:3001
```

With Docker (one container, the SQLite database on a named volume `/data`, seeded from `data/` on first start):

```bash
docker compose up --build -d
```

Then open http://localhost:3001 and register the `ADMIN_USERNAME` account (default `admin`) to get the admin panel. `docker compose down` keeps the volume; `docker compose down -v` deletes the database. The image runs the server as the unprivileged `node` user (its entrypoint starts as root only to take ownership of the mounted `/data` disk) and has a health check on `/api/health`.

### Deploy on Render (Web Service, no settings needed)

1. Push the repository to GitHub.
2. In the Render dashboard choose **New > Web Service** and pick the repository. Render detects the `Dockerfile`; keep the defaults (any instance type, including Free) and click **Deploy**.
3. When it is live, open `https://<service-name>.onrender.com` and register the username `admin` first to get the admin panel.

Nothing has to be set: Render supplies `PORT`, the server generates a session secret on first start and keeps it beside the database, and the empty database is filled from `data/`. Without a disk the service's filesystem is wiped on every deploy and restart (and Free services sleep after 15 minutes idle), so accounts and games last only until then. To keep them, add a disk in the service's **Disks** settings with mount path `/data` (needs a paid instance), or use the Blueprint below.

### Deploy on Render with a persistent disk (Blueprint)

`render.yaml` is a Render Blueprint: one Docker web service with the SQLite database on a 1 GB persistent disk at `/data`. Disks need a paid instance type (the Blueprint uses `starter`). Postgres hosts such as Neon do not work yet: the server's runtime database layer is SQLite only (see DECISIONS.md).

1. Put the repository on GitHub (or GitLab). A private repository is fine.
2. Optionally change `region` in `render.yaml` to the one nearest your players. It cannot change after the first deploy.
3. In the Render dashboard choose **New > Blueprint**, connect the repository and apply. Render builds the Dockerfile, creates the disk, generates `SESSION_SECRET` and sets `ADMIN_USERNAME=admin`.
4. When the deploy is live, open `https://<service-name>.onrender.com` and register the username `admin` first to get the admin panel. The first start fills the database from `data/`.

Every push to the default branch redeploys. A service with a disk restarts in place, so a deploy briefly interrupts live games; they carry on from the database when it is back. Keep the service at one instance. Render takes daily snapshots of the disk; you can also download `/data/deadline-day.sqlite` from the service shell.

Put HTTPS in front (Caddy, nginx, a platform load balancer) and forward WebSocket upgrades on `/socket.io`. Session cookies are Secure in production, so plain-HTTP play only works on `localhost`; to host a game on a home network over plain HTTP, set `COOKIE_SECURE=false`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3001` | API server port. The web dev server reads the same variable to know where to proxy |
| `HOST` | `0.0.0.0` | API server bind address |
| `DATABASE_URL` | `file:./var/deadline-day.sqlite` | `file:<path>` for SQLite (relative to the repo root) or `:memory:`. Postgres URLs are recognised, but the Postgres runtime driver is not wired yet (see DECISIONS.md) |
| `ADMIN_USERNAME` | `admin` | A user who registers with this username becomes admin |
| `SESSION_SECRET` | generated | Signs the `dd_session` cookie (at least 16 characters). When unset, production generates one on first start and saves it as `session-secret` beside the SQLite file; development uses a dev-only value. The dev-only and `.env.example` values are refused in production |
| `COOKIE_SECURE` | `auto` | `auto` marks the session cookie Secure in production only; `true` or `false` force it. Use `false` only for plain-HTTP play on a home network |
| `WEB_DIST_DIR` | `apps/web/dist` | Built web app the server serves when `NODE_ENV=production` (relative to the repo root unless absolute) |
| `WEB_ORIGIN` | `http://localhost:5173` | Reserved, not read yet: in development Vite proxies `/api` and `/socket.io`, so the app is same-origin |
| `E2E_PORT` | `3199` | Port of the smoke-test server (`npm run e2e` only) |

M3 to M6 add no environment variables; M7 adds `COOKIE_SECURE`, `WEB_DIST_DIR` and `E2E_PORT`. `.env` in the repo root is loaded automatically. Never commit it. In Docker, `NODE_ENV=production`, `PORT=3001` and `DATABASE_URL=file:/data/deadline-day.sqlite` are set by the image.

## Layout

```
packages/engine   pure game logic: positions, formations, prices, pool, lineups, auction rules, bots, clubs, fixtures, match and season sim, Monte Carlo, awards, team reports and head to head; Vitest tests
packages/protocol API contract shared by server and web: zod request schemas, view types, socket events, limits
apps/server       Fastify server: auth, games and lobby service, live auction service (serialized per game, server timers, bots), season service (simulate and store, playback clock, Run It Back, Monte Carlo), results service (awards, grades, reports, publishing, rematch, export), history service (profiles, Hall of Fame, leaderboard, records), Socket.IO hub, admin panel API (pool, clubs, games, settings, lab, users, audit, overview), Drizzle schema (SQLite + Postgres mirror), migrations, seed
apps/web          React + Vite + Tailwind client, mobile first: home, login, create, lobby, kickoff, auction room, Team Reveal, season, League Teams, team pages, Season Complete, profiles, Hall of Fame, leaderboard, how to play, admin panel (its own lazy-loaded chunk); dark and light themes, sound effects
scripts/          seed, data validation, migrations, simulation CLI
e2e/              Playwright smoke test and the server it runs against
Dockerfile        multi-stage image (build the web app, keep runtime dependencies only); docker-compose.yml runs it with a data volume
deploy/           container entrypoint; render.yaml is the Render Blueprint
data/             supplied player and club data
```
