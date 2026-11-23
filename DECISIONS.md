# Decisions

Choices the spec leaves open, one line each, newest milestone last.

## M0: scaffold and data

- The five data files arrived in the repo root; they were moved byte for byte into `data/` as the spec's layout requires, not edited or regenerated.
- Node 22 LTS is the target (`engines >=22`, `.nvmrc`); it was installed user-locally in `~/.local/node` on the dev machine, outside the repo.
- The engine is consumed as TypeScript source through its package `exports` (no build step for dev, tests and Vite); how the production server bundles it is decided in M7.
- TypeScript uses `moduleResolution: Bundler` everywhere; scripts run through `tsx`.
- Formation slots: 4-2-3-1 is CDM CDM / LM CAM RM / ST; 4-3-2-1 is CM CDM CM / CAM CAM / ST; 4-4-1-1 puts a CAM behind the ST (there is no CF slot type); 3-5-2 and 5-3-2 play CM CDM CM; 3-4-3 is LM CM CM RM / LW ST RW.
- Slot keys are the slot type, numbered when a formation repeats it (CB1, CB2, ST1, ST2); these are `lineup_slots.slot_key`.
- Pitch coordinates are 0 to 100: x from left touchline to right, y from the opponent's goal line (0) to the team's own (100).
- `extra[g]` rounds `extra_pct * need` to 9 decimals before `ceil`, so float noise can never add a player (0.15 x 20 = 3, not 4).
- Postgres support: `schema.pg.ts` mirrors `schema.ts` with Postgres-native types and its own migrations in `apps/server/drizzle/pg`; a test fails if tables, columns, nullability, keys, indexes or foreign keys drift. The runtime driver is SQLite only for now; a `postgres://` DATABASE_URL fails with a clear message. Revisit in M7 (deploy).
- Portable column types: text UUID ids, integer epoch-millisecond timestamps, whole-million integer money, JSON as text (jsonb on Postgres), booleans as 0/1.
- High-volume, ordered tables (bids, fixtures, match_events, audit_log, chat_messages) use autoincrement integer ids so insertion order is the id order.
- Columns added beyond section 3: `sessions` table (cookie sessions); `clubs.monogram` and `clubs.strength_override` (admin edits); `games.countdown_deadline`, `paused_timer`, `paused_by_user_id`, `updated_at` (pause banner and post-auction countdown); `participants.disconnected_at`, `created_at` (60-second disconnect rule); `game_pool.snapshot` (player row frozen at auction start so admin edits never change a running game); `audit_log.game_id` (filter by game); `seasons.created_at`.
- `participants.team_name` and `formation` are nullable so spectators can be participants without a team.
- `games.current_lot_id` and `seasons.champion_season_team_id` have no foreign key, to avoid circular references between tables.
- Club id is the slug of its name (`atletico-madrid`); AI squad player id is `<club-slug>--<name-slug>`; `player_ref` uses these (`seed:<id>`, `pool:<id>`).
- `pool_players.seed_club` stores the club id rather than the display name; import and export map it back to the name.
- `clubs.strength_rating` stays empty after the M0 seed; the engine computes and caches it in M1. The strength numbers in `clubs.json` are not read by the app; a test checks the engine reproduces them.
- Default club monogram: initials of up to three words of the name, skipping "and" (Brighton and Hove Albion is BHA).
- Seed mode: insert missing rows, keep existing ones (admin edits survive); `--reset` overwrites clubs, squads and pool players from `data/` but keeps monogram, notes and strength override, deletes squad players no longer in `data/` and marks pool players no longer in `data/` inactive (game history references them); a plain seed only reports such stale rows; `app_settings` keys are only ever inserted when missing.
- The seed refuses to write anything when data validation reports an error.
- Data refresh (squads as of 22 Nov 2026): `pool_players.club_now` added (migration `0001_pool_club_now`) and frozen into `game_pool.snapshot`; it is display only. `data:validate` warns, never fails, when `club_now` differs from a filled `seed_club` (none do).
- `data:validate` also fails on: the CSV and JSON disagreeing, `players.csv` and `players.seed.json` disagreeing, club count not 20, squad count not 609, a club colour that is not `#RRGGBB`, a pool id that is not lowercase-dash, a `seed_club` that does not resolve to exactly one squad player, and any group short of players for the 12-team worst case.
- `data:validate` only warns (does not fail) on: master depth per position differing from the spec's list, a `rule` player whose alternates differ from the rule default, and a repeated `position_rank` within a position.
- Tooling: Vite 7 (one copy shared with Vitest), ESLint 9 flat config with typescript-eslint, zod 4, Vitest 3.
- `maintenance_banner` is stored as `{ "message": null }` because settings values are never SQL NULL.

## M1: engine

- Club strength is `best-XI average + 0.1 x min(15, players outside the XI rated 70 or more)`; the best XI is picked over every enabled formation by main position only. This is the formula behind `strength_rating` in the 22 Nov 2026 `clubs.json` (it matches all 20 clubs to 2 decimals) and reproduces the spec's expected order; Bayern, Barcelona and Arsenal share an 86.18 XI and are split only by depth (87.58, 87.48, 87.38). It replaced the M1 blend `0.825 x XI + 0.175 x next 11`, which fit the old squads but not the new order.
- Simulation defaults are tuned away from the spec's table: `base_goals` 1.25 (spec 1.35) and `sensitivity` 0.075 (spec 0.05). With the spec values the champion averaged about 80 points and goals ran about 2.9 per match. Tuned, over 100 three-team games: champion 86.6 avg (86% in 80-95), bottom 30.1 (99% in 20-40), 2.74 goals per match (91% in 2.6-2.9), home wins 41%, draws 24%. Rechecked on the 22 Nov 2026 squads: champion 85.9 (88%), bottom 30.1 (100%), 2.74 goals (91%). Both stay admin-editable.
- The "top 20 of every position are in the pool" line is read as: the pool always takes each group's best players first, by overall then `position_rank`. A 12-team all-4-3-3 game needs only 14 players in one-slot groups (CDM, LW, RW), so it cannot hold 20 there.
- Pool ties on overall are broken by `position_rank`, then by id.
- Lineups use a min-cost Hungarian assignment: a forbidden cell costs 1e9, moving a player away from his previous slot 100, an alternate position 1. This maximises main positions and keeps players where they were.
- The whole-game feasibility check (`WOULD_STRAND_TEAM`) is a bipartite matching of every team's open slots to available players. The reserve is computed with one Hungarian run: roster plus candidate must be placed, and each other open slot costs the cheapest available base price for its group.
- Error codes beyond the spec's `NO_SLOT`, `WOULD_STRAND_TEAM` and `OUTBID`: `AUCTION_COMPLETE`, `NO_LOT`, `LOT_IN_PROGRESS`, `NOT_YOUR_TURN`, `UNKNOWN_TEAM`, `UNKNOWN_PLAYER`, `PLAYER_UNAVAILABLE`, `NOT_WHOLE_NUMBER`, `BID_TOO_LOW`, `ALREADY_LEADING`, `OVER_MAX_BID` (reserve rule), `NOTHING_TO_UNDO`, `ILLEGAL_SWAP`. `PAUSED` belongs to the server (M3).
- Undo last sale is allowed while no lot is live, or while the next lot has only the nominator's opening bid (that lot is voided). It refunds the money, returns the player, puts unsold players back and rewinds the nomination turn.
- End auction early voids any live lot, auto-fills every open slot with the cheapest eligible player at `min(base price, money left)`, then marks the rest unsold. The stall guard uses the same auto-fill.
- Bot valuation. Easy: market value x U(0.7, 1.0). Medium: market value x U(0.85, 1.05) x scarcity `1 + 0.35 x clamp((open slots league-wide / available players - 0.4) / 0.6, 0, 1)` for his groups, x 1.1 when he fills the team's scarcest open group. Hard: Medium x a gap factor `clamp(1 + 0.05 x (gap - 2), 0.75, 1.35)`, where gap is his overall minus the best cheaper alternative for the same slots. Its value is also capped at `cheapest base for his group + 1.5 x (budget above reserve) x (this slot's quality spread / sum of spreads over open slots)`, which saves money for the slots where the gap is biggest. Every level is also held to the reserve rule's max bid.
- Bots raise by `max(min increment, round(current x U(0.02, 0.06)))` and never above their valuation or max bid. They nominate by best `(overall - replacement level) / base price`, falling back to the auto-nomination rule.
- Fixtures: the circle method in Berger orientation, then a seeded search over rotations, reversals and home/away flips until no team has more than 2 home or 2 away games in a row. It works for every even league size from 6 up; 4 teams cannot satisfy it. Team order is shuffled by the seed.
- RNG: mulberry32, seeded per match from `hash(game seed, matchday, home id, away id)`. Scores, events and injuries use separate streams, so turning events on never changes a score.
- Cards are flavour only: yellows Poisson(1.7) per team, a red with 5% chance per team. The match-rating noise is N(0, 0.4).
- AI XI fallback: a non-GK outfielder may play any slot out of position at -8 (`out_of_position_penalty`). A goalkeeper never plays outfield. An empty slot gets an "Academy Reserve" rated 62.
- Bought players are removed from AI squads by matching the seed club, normalised name and overall.
- Injuries replace a player with a reserve rated 10 lower (ref `reserve:<club>:<slot>`) for 1 to 5 matches.
- Awards. Player of the Season and the Team of the Season need at least 50% of the top appearance count. The Team of the Season is a 4-3-3 picked by Hungarian assignment on average rating.
- Best Buy and Biggest Overpay compare the season rating with the rating a regression on overall predicts, against the overall implied by the price (the price curve inverted).
- Auction grade score = 35% pre-season strength rank + 45% final position + 20% (XI market value / starting budget, capped at 1). Grade floors: A+ 90, A 83, A- 77, B+ 71, B 65, B- 59, C+ 53, C 47, C- 41, D 33, else F. The Team Reveal preview uses the strength rank as the finish.
- Monte Carlo seeds run `i` with `hash(seed, 'montecarlo', i)`; multi-season season `k` uses `hash(seed, 'season', k)` and keeps a cumulative titles table.
- The final tiebreak ("seeded random draw") gives each team one fixed random key per season from `hash(seed, 'tiebreak', team id)`.

## M2: server foundation

- Passwords use bcryptjs (pure JS, cost 10; tests use 4) so there is no native build step. Login compares against a dummy hash when the username does not exist, so timing does not reveal which usernames exist.
- Sessions are random tokens in a signed httpOnly cookie (`dd_session`, SameSite Lax, Secure in production); the database stores only the token's SHA-256. 30 days, sliding. A ban deletes the user's sessions.
- Guests are real `users` rows (`guest_<10 hex>`, no password). Registering while signed in as a guest upgrades that row in place, so their games stay theirs. Usernames starting `guest_` are reserved.
- The admin is whoever registers with `ADMIN_USERNAME`, even when registrations are closed. Admins pass every host check.
- REST carries every change; Socket.IO only subscribes (`game:watch` answers with the full snapshot) and pushes. A mutation answers with the new lobby state too, so the acting client updates without waiting for the socket. Clients keep the newer of the two by `serverTime`.
- Anyone may watch a game by code; spectators have no `participants` row. After joining, the client watches again so its presence is tracked.
- Join codes are 6 characters from an alphabet without look-alikes (no I, L, O, 0, 1).
- Join order is stored as strictly increasing `participants.created_at` per game, so teams that join in the same millisecond never swap places.
- The host never has to press Ready; bots are always ready. "Not ready" is the only start blocker Force start overrides. Fewer than 2 teams, a missing or disallowed formation, or a short pool always block.
- The 5-second start countdown is owned by the server (`games.countdown_deadline` plus a timer, restored after a restart). The lobby locks while it runs. If the start then fails, the countdown clears and everyone gets a notice.
- With the forced formation rule and no formation picked, the host's formation is used; forcing sets every team to it.
- Changing the budget in the lobby resets every team's remaining budget. Max teams cannot drop below the teams already in. Bots cannot be switched off while bots are in the game.
- Kicked players get a `game:kicked` event and drop to spectator; they may rejoin while the lobby is open (a ban list can come later).
- When the host leaves, the earliest-joined human becomes host; with no humans left the game is cancelled.
- Chat: 50 messages of history, at most 280 characters, at most one message every 0.4 seconds per user. Profanity is masked to the first letter. Team, game and user names with profanity are rejected. Matching is whole words after lowercasing, removing accents and mapping leetspeak, plus common suffixes and spaced-out letters, so "Scunthorpe" stays clean.
- The nomination order uses up and down buttons instead of drag. They work the same on touch, keyboard and mouse. Randomize plays a short shuffle unless reduced motion is on.
- Public settings (`GET /api/settings/public`) include `gameLimits`, so the create form shows the real allowed ranges.
- AI clubs in the lobby preview follow the admin's selection method; with the random method the clubs are drawn only at start, from the game seed.
- `npm audit` reports dev-only advisories in drizzle-kit's bundled esbuild and in Vitest's dependencies. Fixing them needs breaking major upgrades, and none of it ships in the app, so they are left for now.
- The web app imports the engine only for formation drawings and the shared protocol schemas for form validation; game rules run on the server.

- The web bundle is one chunk: 522 KB (162 KB gzipped) after M2, 581 KB (178 KB gzipped) after M3. Route-level code splitting is left for M7 polish.

## M3: live auction

- The server keeps no auction state in memory. Each action loads the game from the database, applies one engine transition and writes the difference in one transaction. A per-game promise queue runs bids, nominations, host actions and timer callbacks one at a time, so two bids at the same moment can never both win.
- Every auction change gets a version `max(now, previous + 1)`. Clients apply a full `auction:state` or a small `auction:bid` only when its version is newer, so a late socket message never rolls the screen back.
- A bid that arrives at or after the lot deadline, or names an old lot sequence, gets `LOT_CLOSED`. Timer callbacks re-check the stored deadline (15 ms early tolerance), so a stale timer does nothing.
- Engine rule errors (`OUTBID`, `ALREADY_LEADING`, `NO_SLOT`, `OVER_MAX_BID` and so on) are HTTP 409 with the engine's code, plus `details` such as `minBidM` or `maxBidM` for the UI.
- Anti-snipe: a bid with less than the anti-snipe time left resets the clock to exactly the anti-snipe time; it never shortens a longer clock.
- Pause stores which timer was running and the exact milliseconds left; resume restarts that timer with the same remainder. A paused game stays paused after a server restart.
- Pausing during the post-auction countdown holds the countdown ("Hold" on the reveal screen); resuming continues it.
- Undo also reverts the auto-filled slots that sale triggered (those rows store the lot that triggered them; end-early fills store none). Undo is not allowed once the auction is complete. Undo while paused leaves the game paused on a fresh nomination timer.
- Team control is `human`, `bot` or `auto` (auto-nominate only). The host may hand a team to a bot or auto only while its manager is disconnected; the host is prompted after 60 seconds away. The owner (or the host) can switch back to human at any time.
- Bot bids wait a random 1 to 4 seconds; "auto" teams nominate after 1.5 seconds. Tests switch bot scheduling off (`botDelayMs: null`) and drive bots step by step.
- Bot valuations are drawn once per lot from `hash(seed, 'value', lot sequence, team id)`, so a bot does not change its mind mid-lot. Lot eligibility per team is also computed once per lot.
- The reveal countdown is `teams x 4 s + 8 s` of reveal plus 10 seconds of visible countdown, and runs only when "auto start season" is on.
- Starting the season is a placeholder until M4: it clears the countdown, records the request, writes an audit entry and tells players the simulation arrives in the next update.
- "Can buy" in the pool and the max-bid hints are an engine preview in the browser, recomputed only when the market changes. The server re-checks every bid and nomination.
- Price and SOLD animations scale or slide without fading, so they stay readable if the browser pauses animations in a background tab.

## M4: season

- Playback position is counted in matchdays (0 = kick-off of matchday 1, 38 = final whistle). One matchday lasts 10 s at 1x, 5 s at 2x and 2 s at 5x. "Instant" shows each matchday straight at full time, one per second; "Skip to end" is a separate control.
- Within a matchday the minutes tick over the first 85% of its time (`LIVE_SHARE`), then the results hold at full time so they can be read.
- The client receives the whole simulated season at once and works out what to show from the clock. A determined user could read ahead in the network data; the screens never show anything early.
- The latest season's champion is hidden on screen (history, banner) until playback reaches the final whistle, even though the lobby data names it.
- Synchronized mode: the host's clock is stored in `games.playback_state` with a version, and the server timer moves the game from `simulating` to `completed` when playback ends. Own-pace mode: the game becomes `completed` at once and each browser keeps its own clock in localStorage.
- Replaying a finished season (play from the start, seek back) never moves a completed game back to `simulating`.
- In synchronized mode, non-host players can still step to any matchday to look around; "Back to live" returns them to the host's clock.
- Every host playback control is written to the audit log as `game.playback.<action>`; the season finishing is `game.season.complete`.
- A game cannot be cancelled once a season has been simulated.
- Seeds: season n uses `deriveSeed(game seed, 'season', n)`, Expected Strength uses `deriveSeed(game seed, 'expected')`, and multi-season run r uses `deriveSeed(game seed, 'multiseason', r)`.
- Each season team stores its engine id and its order in the league, so any season can be re-simulated exactly from the stored seed and lineups.
- Run It Back keeps the same 20 teams and uses the current simulation settings. A game can have at most 25 seasons.
- Multi-season (2 to 10 seasons) and Expected Strength are not stored. Expected Strength runs 1,000 seasons in slices of 100 so other games keep running, and the result is cached in memory per season. Stored season views are cached in memory too (at most 40).
- New app settings `sim_params` and `table_bands` (admin UI in M6). Default bands: Champions (1), Top four (2-4), Europe (5-6), Bottom three (18-20).
- Key Moments: a derby (two auction teams meet) appears at kick-off; a hat-trick appears at the minute of the third goal; a 4+ goal margin, an upset and a new leader appear at full time.
- An upset is a team at least 6 places lower beating a top-5 side, using the table before that matchday, or the pre-season strength ranks on matchday 1.
- The League Teams page opens when the auction starts. During the auction, auction teams are rated on the players bought so far and marked provisional until they have 11.
- Chemistry is off by default in the simulation settings, so the Chem column shows "-" with a note.
- The Expected Strength bar colour is pitch-600 (#179a53), checked with the dataviz palette validator against the card surface.
- On a phone, the table drops the "Auction" tag and marks auction teams with a bold name on a tinted row, explained in the key under the table.

## M5: results

- Season 1 is a game's official result. It goes into `game_results` once, when the game first reaches `completed` (end of playback in synchronized mode, at once in own-pace mode). Games finished before M5 are backfilled at server start. Run It Back seasons never count for profiles, the Hall of Fame, the leaderboard or records.
- Awards are worked out from the stored player stats and lineups (no re-simulation) and cached on the season row (`seasons.awards`).
- Auction grade weights: pre-season strength rank 35%, final position 45%, market value bought per budget 20%. Purchases use market values frozen when the auction started.
- Best bargain is the purchase with the lowest price to market value ratio, ignoring players auto-filled at base price. Auto-filled players are still tagged (Steal, Fair or Overpay).
- Head to head covers every pair of auction teams: both meetings this season, plus the all-time record across every season of the game when there is more than one.
- Results, team stats, awards and grades stay hidden until the viewer's playback reaches the final whistle, like the champion. The results header says "Season N results" so it gives nothing away before then.
- Confetti plays once per browser session per season (sessionStorage) and never under reduced motion.
- The share image is drawn on a canvas in the browser (1080x1350 PNG, no libraries). Copy Summary is plain text: champion, every auction team's finish, points and grade, and the awards.
- Rematch opens a new lobby with the same name, settings (checked against the current app settings) and host, and adds the same managers and bots. Humans start not ready, banned users are left out and a disabled formation falls back to the first enabled one. Pressing it again returns the same lobby. The old game links to it.
- Export (JSON or CSV for table, fixtures, players or grades) is for the host and admins, is audited as `game.export`, and CSV cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets do not run them.
- A private game's code and name are shown only to its participants and admins. Its results still count in the leaderboard and record book, with the game unnamed; the Hall of Fame lists only games the viewer may see.
- The leaderboard ranks registered, unbanned users by titles, then average finish (then more games); equal titles and average share a rank. It shows the top 100. Guests can see their own profile but are not ranked.
- Profile trophies: each league title, plus Golden Boot, Playmaker, Golden Glove, Player of the Season and Best Buy when the winning player was on your team.
- The record book keeps the top 5 for most points in a season, most goals by a bought player and best goal difference, counting auction teams only.
- Team page links use the participant id (auction teams) or club id (AI clubs), so the same link works for every season of a game; `?s=N` picks the season.
- The form timeline is league position after each matchday plus a W/D/L strip, in the same validated green (#179a53) as the other single-series charts.

## M6: admin

- Every admin endpoint is registered through one loop that calls `requireAdmin` before parsing anything, so a normal user always gets `403 ADMIN_ONLY` and a visitor `401`; a test tries every route as a visitor, a user and a guest. The web `/admin` guard only hides the page.
- Most game actions in the Games tab reuse the host endpoints, which already let an admin act as host in any game. "Open as spectator" is a link to the game's current page; "Re-run simulation" is Run It Back; "Force complete (auto-fill)" is End auction early.
- Admins may replace a connected manager with a bot (hosts can only take over teams that dropped). A mid-auction reorder keeps the team that is due to nominate on the clock, and the new order continues from there.
- Change seed is allowed after the auction starts and not while a season is playing back. Played seasons keep their stored seeds; the new seed drives later seasons, Expected Strength and multi-season runs.
- Deleting a game removes everything in it (cascade); watchers get a notice. Its audit entry keeps the join code in `target` so the audit filter still finds it.
- Test Auction games are flagged `games.is_test`: private, own-pace, every team a bot, the auction fast-forwarded on the server, then the season simulated. They never reach game_results (no Hall of Fame, leaderboard or records) and show under the "Test games" filter.
- Pool prices always follow the price curve: edits and imports recompute them from overall (a mismatched price in a file is only a warning). The curve changes only through the Reprice tool, which saves `price_curve` and reprices every pool player; frozen game pools keep their snapshot prices.
- Position ranks are recomputed after every pool change: by overall, then the old rank, then id. Blank rank and price cells are fine in an import.
- A pool player who is in any game's auction pool cannot be deleted (409 PLAYER_IN_USE); deactivate them instead.
- Import modes: add or update (upsert), replace (also deactivates active players missing from the file) and alt positions (reads only id, alt_positions and alt_source, which defaults to ea). Any error blocks Apply. Exports defuse cells starting with `= + - @` with a leading `'`, and imports strip it again.
- Possible duplicates are pool players with the same normalized name and position; two different players can share a name (for example a goalkeeper and a midfielder both called Ederson).
- Strength overrides replace the computed value in the ranking that picks AI clubs. AI squad players keep their id when edited, so stored seasons that name them still resolve; a new squad player gets an id from club and name, with a number added if it is taken.
- Each settings key is saved on its own and checked against the others: new limits must still fit the default game settings, the forced default formation must stay enabled, default public visibility needs public lobbies, manual AI clubs must exist, and enabled table bands cannot overlap. Saving the default game settings also updates the `pool_params` and `remove_bought_from_ai` mirrors.
- The banner is the `maintenance_banner` setting; setting and clearing it are audited as `admin.announcement.set` / `.clear`. Changes to the profanity list are audited as counts (added, removed, total), not the full list.
- Simulation Lab runs are not saved or audited. Run 0 uses the seed itself and keeps a loaded game's stored team ids (tiebreaks are seeded by team id), so one run with a game's 20 teams and season seed reproduces that season exactly; later runs use `deriveSeed(seed, 'lab', i)`. Seeds are any uint32.
- Deleting a user's data: refused for yourself and while the user is in an unfinished game (replace them with a bot first). Sessions and chat messages are deleted, games they host pass to the acting admin, and finished teams and results stay with the account link cleared. Confirmation is typing the username.
- The overview's data health checks: pool supply for a 12-team game in the worst case, prices off the curve, possible duplicates, clubs with fewer than 11 squad players, the banner being on and registrations being closed.
- The audit CSV export holds the newest 10,000 matching entries, oldest first.
- The admin panel is a lazy-loaded chunk (about 86 kB), so players never download it.

## M7: polish

- The light theme flips the night surface colours and the "white" ink through CSS variables, so every existing utility follows. Text on accent fills uses a fixed `ink` colour, gold text uses a darker `gold` token in light mode, and the pitch stays a dark surface in both themes. Dark is the default; the choice is applied before the first paint.
- Theme, sound and "walkthrough seen" are per-device preferences in localStorage (guarded, so blocked storage falls back to the defaults), not account settings.
- Sounds are synthesised with the Web Audio API (gavel knock on each sale, one whistle at kick-off, three at full time), so there are no audio files to license. Off by default; turning sound on plays the gavel once so the player knows it works.
- Both switches sit in the header on every page. On a phone the account button shows only the initial to make room (the menu shows the full name).
- The first-visit walkthrough reuses the five How to Play steps. It opens once per device on the first page that is not an auction, reveal, season, results, admin or login page, so a player following an invite link mid-auction is not interrupted.
- Pool keyboard navigation uses a roving focus: one row is in the tab order; arrows, Home, End, Page Up and Page Down move; Enter nominates on your turn; W stars; `/` focuses the search.
- On a phone, "Your turn: choose a player" opens the pool in a bottom sheet; the Pool tab stays for browsing between turns.
- A reconnecting banner appears after the live connection has been down for 2 seconds (only once it has connected at least once).
- Production runs the TypeScript sources with `tsx` (now a server runtime dependency) instead of a separate compile step. The workspaces export `.ts` files and the startup cost is small.
- The server serves `apps/web/dist` only when `NODE_ENV=production`; in development Vite serves the client. Missing files and `/api` paths keep their 404s; every other GET without a file extension gets `index.html`. A small Vite plugin writes `.br` and `.gz` copies at build time, and the libraries are split into `react` and `vendor` chunks for longer caching.
- An empty database is seeded from `data/` when the server starts, so a new deployment needs no separate seed step. A seeded database is left alone (admin edits survive restarts).
- `COOKIE_SECURE` (default `auto`, Secure in production) exists because browsers drop Secure cookies over plain HTTP on anything but localhost. Without it, a game hosted on a home network IP would fail at login.
- The production `SESSION_SECRET` check also rejects the `.env.example` value.
- Basic security headers (`nosniff`, `SAMEORIGIN` framing, a referrer policy) are added when serving the web app. A Content Security Policy is left out for now: the inline theme script and the inline styles for team colours would need nonces or hashes.
- The Docker image builds with the full dependency set, then reinstalls runtime dependencies only. It runs as the `node` user with the database on a `/data` volume. Docker is not installed on the development machine, so the image itself was not built here; the same steps (install, build, `npm ci --omit=dev`, start) were run in a clean copy of the repo and served the app.
- The Playwright smoke test runs at a phone size (Pixel 7 in Chromium) against the production build through `e2e/server.ts`. That harness lowers the admin-editable game limits (3 s lots, 5 s nominations) and uses quick bots, so a full game takes about two minutes. It is not part of `npm test`: it needs a downloaded browser and a build.
