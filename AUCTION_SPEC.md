# Deadline Day: Build Spec for Claude Code

The app is called **Deadline Day**. Use that name in the home page hero, page titles, the README and the footer.

A multiplayer web game. Friends (2 to 12 teams) each get a $1 billion budget and bid in a live auction for real footballers from a world-wide player pool. Every team must end up with a valid starting XI in a formation. When everyone has 11 players the auction ends by itself and the app simulates a full 38-matchday Premier League style season, where the auction teams compete against (20 minus N) AI-controlled top clubs.

---
## 0. Working agreements (read first)

1. Read this whole spec before writing code. Then propose a short plan for M0 and M1 and wait for approval. After that, continue through all milestones (section 13) without stopping, unless a decision cannot be undone.
2. Build milestone by milestone. After each one: typecheck, lint, run all tests, fix failures, and commit with a message like `M3: live auction`.
3. All game rules live in one pure TypeScript package (`packages/engine`) with no I/O: pool sizing, prices, bid validation, bots, lineups, fixtures, match sim. The server is authoritative: it validates every nomination and bid and runs every simulation. The web app may import the engine only for previews.
4. The player data is supplied in `data/` (section 5). Do not regenerate or "improve" it from memory. If you think a row is wrong, add a note to `DECISIONS.md` and leave the row alone.
5. Record any choice this spec leaves open in `DECISIONS.md`, one line each. Do not stop to ask about reversible choices.
6. Keep a `README.md` with install, run, test, seed, deploy instructions and every environment variable.
7. Validate all inputs with zod. Check roles on the server for every admin and host action. Never commit secrets.

---
## 1. Product overview and core rules

Rules, all enforced on the server:

1. N is the number of auction teams in a game (humans plus optional bots). Minimum 2, maximum 12 (the hard cap). Each team has one manager.
2. Every team starts with the same budget, default $1,000M (host and admin can change it). Money is whole millions of dollars.
3. Each team must end with exactly 11 players that fill a chosen formation. **A player can fill a slot of his main position or of any of his alternate positions** (`alt_positions`), with no rating penalty, as in EA FC. Example: Messi is a CAM with alternates ST, RW and RM, so he can fill a CAM, ST, RW or RM slot, but not a CB slot. A lineup is valid when the 11 players can be matched one to one to the 11 slots (section 4). No other out-of-position signings.
4. Each team picks its formation in the lobby. Formations are locked when the host starts the auction, because the pool is sized from them.
5. **The player pool is built when the auction starts**, from the formations everyone chose (section 5 has the exact formula). It always contains enough players for every team to fill every slot, plus a few extras per position that go unsold. More teams means a bigger pool.
6. Players have a market value and a base price decided by their overall rating (section 5). The base price is the lowest opening bid.
7. The auction is a live nomination auction (section 8). A player is sold to exactly one team.
8. **Pause and unpause:** the host can pause and unpause the auction at any moment, including in the middle of a lot. Everything freezes while paused.
9. **The auction ends automatically the moment every team has 11 players.** After a short reveal the season simulation starts by itself (the host can hold the countdown).
10. The league always has exactly 20 teams: N auction teams plus (20 minus N) AI clubs. The AI clubs are the strongest (20 minus N) of the 20 clubs in `data/clubs.json`, ranked by pre-auction squad strength. Example: 3 teams means the 17 strongest clubs plus the 3 auction teams. 12 teams means 8 AI clubs.
11. AI clubs use the squads in `data/players.seed.json`. A player bought at the auction who also appears in an AI club's squad is removed from that club (default on, admin toggle), so an AI club can lose its star.
12. The season is a double round robin: 38 matchdays, 380 matches, fully deterministic from a stored seed.
13. Roles: Admin (app administrator), Host (creator of a game), Player (manager), and Spectator (anyone with the game code).

---
## 2. Tech stack and repo layout

Use TypeScript everywhere (strict mode), npm workspaces.

```
/
  packages/engine     pure game logic: formations, slot groups, pool sizing, prices, bid rules, bots, lineups, fixtures, match sim, season sim, Monte Carlo, awards. Vitest tests.
  apps/server         Fastify + Socket.IO, Drizzle ORM, SQLite via better-sqlite3 (schema must also work on Postgres via DATABASE_URL), zod, argon2 or bcrypt.
  apps/web            React + Vite + Tailwind CSS, React Router, TanStack Query, socket.io-client, Zustand for local UI state.
  data/               clubs.json, players.seed.json, players.csv, auction_players.csv, auction_players.json (supplied, see section 5)
  scripts/            seed, data validation, simulation CLI
  Dockerfile, docker-compose.yml, README.md, DECISIONS.md
```

Scripts to provide: `npm run dev` (server and web together), `npm test`, `npm run typecheck`, `npm run lint`, `npm run seed`, `npm run data:validate`, and `npm run sim -- --teams 3 --seed 42` (a CLI that creates N bot teams with random formations, runs the whole bot auction, simulates the season and prints the pool size, prices paid, final lineups and the table; used to tune realism). The production build serves the web assets from the server in one process.

Realtime: Socket.IO rooms per game. On connect or reconnect, the server pushes a full authoritative game snapshot, then small events. **The server owns all timers**: store `lot_deadline` (or `nomination_deadline`) in the database, rebuild timers on boot, and have clients compute countdowns from the server deadline plus a clock offset. All bids for a game go through one serialized queue (or a database transaction with a row lock), so two simultaneous bids are always ordered and exactly one is first.

Auth: username and password with an httpOnly cookie session, plus guest sessions (just a display name) so friends can join from an invite link. A user whose username equals the `ADMIN_USERNAME` environment variable becomes admin on registration, and admins can promote others.

---
## 3. Data model

Tables (Drizzle schema, with migrations):

- **users:** id, username (unique), password_hash (nullable for guests), display_name, role (admin or user), is_guest, banned, created_at.
- **clubs:** id, name, short_name, country, league_name, primary_color, secondary_color, strength_rating (computed and cached), notes. The 20 AI-capable clubs from `data/clubs.json`.
- **seed_players:** id, club_id, full_name, primary_position, alt_positions (JSON), overall, nationality. The AI clubs' squads from `data/players.seed.json`.
- **pool_players:** id (text, for example `gabriel-cb`), name, position (main), alt_positions (JSON array), alt_source (ea or rule), overall, position_rank, market_value_m, base_price_m, seed_club (nullable), nationality (nullable), is_active. The master world-wide auction pool from `data/auction_players.csv`. Overall is the only rating: no attributes, no ages.
- **games:** id, join_code (6 characters, unique), name, host_user_id, status (lobby, auctioning, paused, auction_complete, simulating, completed, cancelled), settings (JSON snapshot including budget, timers and pool parameters), seed, nomination_order (JSON), nomination_index, current_lot_id, nomination_deadline, lot_deadline, paused_remaining_ms, pool_summary (JSON: need, extra and pool size per position), strength_snapshot (JSON), ai_club_ids (JSON), playback_state (JSON), created_at.
- **participants:** id, game_id, user_id (null for bots), team_name (unique per game), color, monogram, formation, budget_remaining_m, is_ready, is_bot, bot_level, is_connected, is_spectator.
- **game_pool:** game_id, pool_player_id, status (available, live, sold, unsold), sold_to_participant_id, price_m. Unique on (game_id, pool_player_id). Written once when the auction starts.
- **lots:** id, game_id, sequence, pool_player_id, nominator_id, opening_bid_m, current_bid_m, leader_participant_id, status (live, sold, void), final_price_m, started_at, ended_at, auto_nominated.
- **bids:** id, lot_id, participant_id, amount_m, created_at, is_bot.
- **lineup_slots:** participant_id, slot_key, pool_player_id (nullable), price_m, lot_id, auto_filled. The slot assignment is recomputed after every sale (section 8); the roster itself is the set of bought players.
- **watchlist:** participant_id, pool_player_id, sort_order.
- **seasons:** id, game_id, season_number, seed, status, parameters_snapshot (JSON), champion_season_team_id.
- **season_teams:** id, season_id, kind (human, bot or ai), participant_id or club_id, name, primary_color, secondary_color, lineup (JSON slot to player ref), formation, attack_rating, defense_rating, chemistry_bonus.
- **fixtures:** id, season_id, matchday, home_team_id, away_team_id, home_goals, away_goals.
- **match_events:** id, fixture_id, minute, type (goal, assist, yellow, red), player_ref, season_team_id.
- **standing_rows:** season_id, matchday, season_team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, position, form (last 5). One row per team per matchday so playback works.
- **player_season_stats:** season_id, player_ref, season_team_id, appearances, goals, assists, clean_sheets, yellows, reds, rating_sum, avg_rating.
- **app_settings:** key and JSON value. **audit_log:** actor, action, target, details, created_at. **chat_messages:** game_id, user_id, body, created_at.

A `player_ref` is a string: `seed:<id>` for an AI club player, `pool:<id>` for an auction player.

---
## 4. Positions, slots and formations

Positions: GK, RB, CB, LB, RWB, LWB, CDM, CM, CAM, RM, LM, RW, LW, CF, ST. Each formation slot accepts specific player positions. Store this map in app_settings so the admin can edit it.

| Slot | Accepts players listed as |
| --- | --- |
| GK | GK |
| RB | RB, RWB |
| LB | LB, LWB |
| CB | CB |
| RWB | RWB, RB |
| LWB | LWB, LB |
| CDM | CDM, CM |
| CM | CM, CDM, CAM |
| CAM | CAM, CM |
| RM | RM, RW |
| LM | LM, LW |
| RW | RW, RM |
| LW | LW, LM |
| ST | ST, CF |

Formations (each is 11 slots with x and y pitch coordinates): 4-3-3, 4-4-2, 4-2-3-1, 4-1-4-1, 4-3-2-1, 4-4-1-1, 3-5-2, 3-4-3, 5-3-2, 5-4-1. The admin can enable or disable each.

**Slot groups and eligibility (used by the auction).** Every slot has a position group: GK, RB (slots RB and RWB), LB (slots LB and LWB), CB, CDM, CM, CAM, RM, LM, RW, LW, ST. A player is **eligible** for a slot when the slot's group is his main position or one of his `alt_positions` (a listed RWB or LWB counts as RB or LB, a listed CF counts as ST). Eligibility is the only rule: no penalty, no other mismatches. The wider compatibility table above is still used by the simulation for AI club lineups (section 9) and to derive the default alternates in `data/auction_players.csv`.

A team's roster is **valid** when its players can be matched one to one to the 11 slots of its formation (a bipartite matching problem, solved with a simple augmenting-path or Hungarian routine in the engine). Example: with a 4-3-3 and Messi (CAM, alt ST, RW, RM), Messi can be the RW, the ST, or sit where a CAM would be if the formation has one, and the engine finds the assignment that makes the whole roster fit. When several assignments are valid, the engine picks the one that puts the most players in their main position, then shows it on the pitch; the manager can swap two players between slots both can legally fill.

Example group needs for one team (used only for pool sizing): 4-3-3 needs GK 1, LB 1, RB 1, CB 2, CDM 1, CM 2, LW 1, RW 1, ST 1. 3-5-2 needs GK 1, CB 3, LB 1 (the LWB slot), RB 1 (the RWB slot), CM 2, CDM 1, ST 2.

---
## 5. Data, pool sizing and prices

**Supplied data, do not regenerate it.** Five files in `data/`. `npm run seed` loads them (idempotent).

- `auction_players.csv` and `auction_players.json`: the master world-wide pool, **570 men's players** from EA SPORTS FC 27 position rating pages (women's players excluded). Columns: id, name, position (main), alt_positions (pipe separated, for example `ST|RW|RM`), alt_source, overall, position_rank, market_value_m, base_price_m, seed_club (blank unless the player is in one of the 20 AI clubs), nationality (only filled for players in the 20 clubs). Master depth per position: GK 45, CB 60, RB 45, LB 45, CDM 50, CM 60, CAM 50, ST 50, RM 40, LM 40, RW 40, LW 45. This includes at least the world's top 40 of every position, so the top 20 of every position are always in the master data.
- `clubs.json`, `players.seed.json`, `players.csv`: the 20 clubs and their 618 squad players, used for the AI clubs. Club names: Real Madrid, FC Barcelona, Manchester United, Liverpool, Paris Saint-Germain, Bayern Munich, Manchester City, Arsenal, Chelsea, Tottenham Hotspur, Atletico Madrid (written Atlético Madrid), Juventus, Borussia Dortmund, AC Milan, Inter Milan, Aston Villa, Inter Miami, Newcastle United, Al-Nassr, Brighton and Hove Albion.
- Expected club strength order (best first): PSG, Real Madrid, Arsenal, Bayern Munich, Manchester City, Barcelona, Liverpool, Inter Milan, Atletico Madrid, Manchester United, Chelsea, Dortmund, AC Milan, Juventus, Tottenham, Aston Villa, Newcastle, Brighton, Al-Nassr, Inter Miami. A test must confirm the engine's own strength calculation reproduces this order.
- **Alternate positions.** `alt_positions` says which other slots a player can fill. Only Lionel Messi's are verified on EA's player page (alt ST, RW, RM, `alt_source = ea`). Every other player has a rule-based default (`alt_source = rule`): CDM gets CM; CM gets CDM and CAM; CAM gets CM; RM gets RW; LM gets LW; RW gets RM; LW gets LM; GK, CB, RB, LB and ST get none. Admin can import a corrected `alt_positions` column at any time (id, alt_positions) with a diff preview, so real EA alternates can be added later without code changes. Do not invent alternates.
- 265 pool players carry a `seed_club`. To remove a bought player from an AI squad, find the seed player in that club with the same normalized name (lowercase, accents and punctuation stripped) and the same overall. Add a test that all 265 resolve to exactly one seed player.

**Pool sizing counts main positions only. Alternate positions add flexibility for buyers, never extra supply.** (The pool is decided after looking at how many teams there are and which formations they chose).** When the host starts the auction:

```
group of a slot   = LWB -> LB, RWB -> RB, every other slot is its own group
need[g]           = total number of slots of group g across every team's chosen formation
extra[g]          = max(extra_min, ceil(extra_pct * need[g]))      defaults: extra_min = 2, extra_pct = 0.15
pool[g]           = the best (need[g] + extra[g]) players of position g in the master pool, by overall (ties by position_rank)
auction pool size = sum of pool[g]          players left unsold at the end = sum of extra[g]
```

Examples, all teams in 4-3-3: 2 teams give 22 needed plus 18 extra, a 40-player pool. 3 teams give 51. 6 teams give 84. 12 teams give 132 needed plus 22 extra, a 154-player pool. `npm run data:validate` and a unit test must prove that for 12 teams in the worst case (every team in the formation that is heaviest for each group) every group still has enough master players. The lobby shows this table live (section 7). Host can change extra_min and extra_pct before the start.

**Prices (all in $ millions, already in the data file and recomputed by the engine from `app_settings`):**

```
market_value_m = floor(60 * 1.075 ^ (overall - 80) + 0.5)     min 1   (round half up, not banker's rounding)
base_price_m   = floor(0.5 * market_value_m + 0.5)            min 1   (round half up)
```

| Overall | 76 | 78 | 80 | 82 | 84 | 86 | 88 | 90 | 91 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Market value | 45 | 52 | 60 | 69 | 80 | 93 | 107 | 124 | 133 |
| Base price | 23 | 26 | 30 | 35 | 40 | 47 | 54 | 62 | 67 |

With the default $1,000M budget, if every team chased the best players of its formation the total fair value would be roughly 1.0 to 1.25 times the total budget, so money is tight and bidding wars matter. Admin can edit the anchor (60), growth (1.075) and base fraction (0.5).

- `npm run data:validate` fails on: master row count not 570, duplicate ids, positions or alternate positions outside the 12 allowed, an alternate equal to the main position, ratings outside 40 to 99, prices not matching the formula, or a `seed_club` that does not exist.
- Admin can import and export the master pool as CSV or JSON with a diff preview and confirmation.
- Branding rule: no official club crests, league logos or player photos anywhere. Show clubs as monogram shields in their two colors and players as a flag (when nationality is known) plus initials avatar. Footer: unofficial fan game, not affiliated with any club, league or player.

---
## 6. Accounts and home page

- Home page: hero with the app name, then Create Game, Join with Code, Play Solo vs Bots (a one-click game with you plus 3 bots), How to Play, a list of public open lobbies, and a Hall of Fame strip of recent champions.
- Creating or joining requires either an account or a guest session. Anyone can spectate by code.
- Create Game form (defaults from app_settings): game name, visibility (private by code or public), maximum teams (2 to 12), budget (default 1000), nomination timer (default 30 s), lot timer (default 20 s), anti-snipe reset (default 10 s), minimum bid increment (default 1), formation rule (each chooses their own, or host forces one), extra_min and extra_pct, remove bought players from AI squads (on), bots allowed, playback mode (synchronized or own pace), auto-start season after the auction (on).

---
## 7. Lobby and starting the game

Join flow: enter the code or tap a public lobby, choose a team name (3 to 24 characters, unique in the game, profanity filtered), color, monogram and formation. Players can change these until the auction starts.

Lobby screen (live):

- Participant list with avatars, team names, chosen formations, ready toggles, connection dots and a crown on the host.
- Invite panel: code, copy link, QR code.
- Settings summary the host can edit until start.
- **Live pool preview:** a table per position group showing need, extra, pool size and the rating range of the players that would be included, recalculated every time someone joins, leaves or changes formation, with the total pool size and the number of players that will go unsold. Also shows how many AI clubs will join (20 minus N) and which they are.
- Nomination order: Randomize (animated shuffle) or manual drag by the host, locked at start.
- Host controls: add a bot (Easy, Medium, Hard), kick, transfer host, cancel game.
- Lightweight chat.

Start Auction (host only, re-validated on the server):

1. Enabled when at least 2 teams exist (humans plus bots), all humans are ready (host can force start), every team has a formation, and the data check passes (every group has enough master players).
2. Show a 5-second countdown to everyone.
3. The server then freezes the nomination order and formations, computes need, extra and the auction pool, writes `game_pool`, saves `strength_snapshot` of all 20 clubs from their full squads, selects the (20 minus N) strongest as `ai_club_ids` (admin can override), stores the seed, gives every team its budget, and sets status to auctioning.
4. Show a kickoff screen: the pool size and unsold extras, the AI clubs in the league, the clubs left out, and the teams.

Reconnection: all state is in the database, so a refresh restores the exact screen, including the live lot and its remaining time. If a human is disconnected for more than 60 seconds during the auction, the host chooses whether a bot takes over or the team is only auto-nominated (it never bids on its own).

---
## 8. The auction

**Format: nomination auction.** Teams take turns nominating a player; everyone with a legal interest bids until the clock runs out; the highest bidder wins; repeat until every team has 11 players.

Order of play:

1. Nomination order is the frozen order from the lobby and loops. Teams whose lineup is already full are skipped.
2. **Nomination.** The team on the clock picks any available player (not sold, not live) who passes the lineup and feasibility checks below, and sets an opening bid: at least the player's base price, at most its own max bid. The opening bid counts as the nominator's first bid, so every nominated player is sold to someone. Nomination timer default 30 s. On expiry the server auto-nominates (flagged in the feed): the available player with the highest overall who passes the checks and whose base price is affordable under the reserve rule, at base price.
3. **Bidding.** Every team that is eligible (below) can bid at any time while the lot is live. Min increment default $1M. Quick buttons +1, +5, +10, +25 and a custom amount. A team cannot outbid itself. Lot timer default 20 s from the opening bid. Anti-snipe: a valid bid placed when less than 10 s remain resets the clock to 10 s.
4. **Sold.** When the clock hits zero the lot is sold to the leader at the current bid. The server, in one transaction: marks the player sold, deducts the money, adds the player to that team's roster and recomputes its slot assignment (section 4), writes the lot and bids, advances the nomination index, and starts the next nomination timer. Show a SOLD animation with the price.
5. **Auto end.** After every sale the server checks whether all N teams have 11 players. If yes: status becomes auction_complete, the unsold players are marked unsold, and the Team Reveal starts (section 10). With auto-start on, the season simulation runs after a 10 second countdown that the host can hold.

Server rules for a bid or nomination (all checked on the server, return clear error codes):

- The game is auctioning and not paused, a lot is live, and the user manages a team in this game.
- **Lineup check.** The team's roster plus this player can still be matched one to one to its formation's slots (section 4), so the player must be eligible for at least one slot that can still be freed up. A player who cannot fit any open slot is rejected with `NO_SLOT`.
- **Feasibility check (whole game).** After the hypothetical sale, every team's remaining open slots must still be matchable to distinct available players (not sold, not the lot being sold), counting main and alternate positions. This is a bipartite matching over at most 12 teams times 11 slots and a few hundred players, cheap to run. A bid or nomination that would leave another team unable to fill a slot is rejected with `WOULD_STRAND_TEAM`. This is what keeps the pool big enough when players can fill several positions.
- Amount is at least the opening bid for a nomination, or at least current bid plus the min increment for a bid, and a whole number.
- **Reserve rule.** `max_bid = budget_remaining - reserve`, where `reserve` is the sum, over the team's other open slots, of the cheapest base price still available (not sold, not live) among players eligible for that slot. A bid above `max_bid` is rejected. This keeps every team able to finish its XI. The UI always shows each team's current max bid.
- Race handling: bids are processed in order. If two arrive together, the first wins and the second gets `OUTBID` with the new price and keeps the chance to bid again.

Stall guard: after every sale, if a team still has open slots but cannot legally nominate or bid on anything (no eligible player left, or nothing affordable), the server auto-fills those slots with the cheapest available eligible players at base price (money cannot go below zero, so it pays what it has left), flagged as auto-filled. This guarantees the auction always finishes.

**Pause and unpause (host, and admin).** Available at any moment while the status is auctioning, including during a nomination or a live lot, and during the post-auction countdown.

- Pause: status becomes paused, the server stores `paused_remaining_ms` for whichever timer is running (nomination or lot) and cancels it. All bids, nominations and auto-actions are rejected with `PAUSED`. Every screen shows a Paused banner, who paused, and a frozen timer.
- Unpause: the server sets the deadline to now plus `paused_remaining_ms`, restores status auctioning and broadcasts the new deadline. Bots resume.
- If the server restarts while paused it stays paused. Pause and resume are written to the audit log.

Screen layout:

- Top bar: game name, players bought of the total, who is nominating, Pause or Resume for the host, and a Paused banner.
- **Live lot panel:** large player card (overall, position, club or nationality if known, market value, base price), current bid, the leader, countdown ring that turns red under 5 seconds, bid buttons, your max bid, and a bid history list. Going once and going twice cues in the last seconds.
- **My team:** pitch with the chosen formation. Filled slots show a badge with overall, surname, price paid and a small tag when the player is out of his main position. Dragging one player onto another swaps them when both can legally play the other's slot. Budget bar, money left, slots left, team rating.
- **Pool:** searchable, sortable list or grid with filters for position (matches main or alternate), overall range, price range and club (when known), plus a toggle Show only players I can buy. Each player card lists his main position and alternates. Sold players stay visible, greyed, with the buyer's team tag and price. Nominate button when it is your turn.
- Tabs: Rivals (every other team's pitch, budget and max bid, live), Sales log and activity feed, Watchlist, Chat.

Watchlist: users star players. When a starred player goes live the user gets a highlight and a vibration or toast. A starred player taken by someone else is crossed out live.

Rating tiers by color and label: Elite (88 and above), Gold (82 to 87), Silver (78 to 81), Bronze (below 78). Use generic styling, not any existing game's card design.

Bots (count as teams, appear in the league as auction teams): they bid after a human-feeling delay of 1 to 4 seconds. Easy values a player at market value times a random 0.7 to 1.0 and bids while the price is below that value. Medium also raises its valuation for scarce groups and open slots it needs most, and always respects the reserve rule. Hard also compares the player's overall with the best cheaper alternative still available for the same slots and saves money for the positions where the gap is biggest. Bots nominate the player with the best (overall minus the replacement level for his slots) per dollar.

Host and admin controls during the auction: pause or resume, skip the current nomination (triggers auto-nominate), extend the timer by 10 s, undo the last sale (only while the next lot has no bids; refunds the money and returns the player, audit logged), replace a disconnected human with a bot, end the auction early (remaining slots auto-fill with the cheapest matching players), reset the auction.

---
## 9. Simulation engine (`packages/engine`)

All functions are pure and deterministic given a seed. Use a seeded PRNG (for example mulberry32) and derive each match's seed from the game seed, matchday, home team id and away team id.

**Step 1, build the 20 teams.** One season team per auction team (its bought XI in its chosen formation, every player in a slot he can play, main or alternate position, no penalty) and one per AI club in `ai_club_ids`, always totaling 20. Because the AI clubs come from the pre-auction snapshot, buying stars away never changes which clubs get in.

**Step 2, pick each AI club's XI.** If remove-bought-players is on, use the club's remaining players. Try every enabled formation, assign players to slots to maximize total overall under the compatibility map, and keep the best. If a slot has no compatible player, use the best remaining outfield player with an out-of-position penalty (default minus 8 overall). If the club has nobody left, use a generic Academy Reserve rated 62. Label reserves and out-of-position players in the UI.

**Step 3, rate every team identically** (auction teams and AI clubs use the same rules):

| Slot | Attack weight | Defense weight |
| --- | --- | --- |
| GK | 0 | 1.6 |
| CB | 0.1 | 1.0 |
| LB, RB, LWB, RWB | 0.35 | 0.7 |
| CDM | 0.2 | 0.8 |
| CM | 0.5 | 0.5 |
| CAM | 0.8 | 0.2 |
| LM, RM | 0.7 | 0.3 |
| LW, RW | 0.9 | 0.1 |
| ST | 1.0 | 0 |

Attack rating is the weighted average of overall using attack weights; defense rating is the same with defense weights. Then add the chemistry bonus (admin toggle, default OFF in this game, because most pool players have no club or nationality data; keep the code and tests) to both: 0.25 per pair of teammates from the same real club (capped at +2.0 total) plus 0.1 per pair with the same nationality (capped at +1.0).

**Step 4, fixtures.** Shuffle the 20 teams with the seed. Use the circle method for 19 matchdays (each team plays once per matchday), then mirror them with home and away swapped, for 38 matchdays and 380 matches. Make sure no team has more than 2 home or 2 away matches in a row.

**Step 5, simulate each match.** Let league_att and league_def be the league-wide average ratings.

- Home expected goals = base_goals x home_advantage x exp(sensitivity x ((home attack minus league_att) minus (away defense minus league_def))).
- Away expected goals = base_goals x exp(sensitivity x ((away attack minus league_att) minus (home defense minus league_def))).
- Multiply each by a log-normal random factor with sigma = chaos x 0.2, clamp to 0.15 to 4.5, then draw goals from a Poisson distribution.

| Parameter (admin-editable) | Default |
| --- | --- |
| base_goals | 1.35 |
| home_advantage | 1.10 |
| sensitivity | 0.05 |
| chaos (0 to 1) | 0.5 |
| out_of_position_penalty | 8 |
| chemistry | off |
| injuries | off |
| points for win, draw, loss | 3, 1, 0 |

If injuries are on, each player has a 1 percent chance per match of missing the next 1 to 5 matches, replaced by a generic reserve rated 10 below that player.

**Step 6, events and stats.** For each goal pick a minute (1 to 94) and a scorer weighted by position (ST and CF 10, wingers 6, CAM 5, wide mids 4.5, CM 2.5, CDM 1, fullbacks 1, CB 0.8, GK 0.02) times (overall divided by 100) squared. Give an assist to a teammate 75 percent of the time, weighted toward CAM, wingers and CM. Add flavor yellow and red cards (no effect on results). Credit a clean sheet to the GK and defenders when the opponent scores 0. Match rating per player: 6.0 base, plus 1.0 per goal, 0.6 per assist, 0.3 for a win, 0.6 for a clean sheet (GK and defenders), plus seeded noise of about 0.4, clamped to 4.0 to 10.0.

**Step 7, table.** Points 3, 1, 0. Tiebreakers in order: goal difference, goals scored, head-to-head points, then a seeded random draw. Store a standings snapshot after every matchday.

**Extra engine functions:** Monte Carlo (simulate 1,000 seasons and return per-team average points, average position, title chance, top-4 chance and bottom-3 chance), multi-season runs, awards, and auction grades (section 10). Unit-test the invariants: 380 fixtures, each team plays every opponent twice, 19 home and 19 away each, points equal 3 times wins plus draws, total goals for equal total goals against, same seed gives identical output, and different seeds differ.

---
## 10. Season playback, results, awards and history

After the auction ends, the server shows the Team Reveal and then runs `simulate_season` once (automatically after a 10 second countdown, or when the host starts it) and saves everything. The UI then plays it back so it feels live. Before that, the **Team Reveal** (right after the auction ends) shows each team's XI one at a time with every price paid, total spent, money left, team rating, auction grade preview, the unsold players, and a ranked league preview of all 20 teams with auction teams highlighted. A 10 second countdown then starts the season automatically (host can hold it).

Playback:

- Controls: Play, Pause, speeds 1x, 2x, 5x, Instant, jump to any matchday, skip to the end.
- Matchday view: all 10 results as cards with scorers, auction teams highlighted. Live league table beside it with position-change arrows and a form guide.
- Key Moments feed: hat-tricks, 4-goal margins, upsets (a team at least 6 places lower beating a top-5 side), new league leaders, fixtures between two auction teams.
- Click any fixture for a minute-by-minute match ticker built from stored events.
- Synchronized mode: the host controls playback via `games.playback_state` and every screen follows. Own-pace mode: each player controls their own view.
- Run It Back (same teams, new seed, kept in history), Multi-season (2 to 10 seasons with a cumulative titles table), and Monte Carlo (labeled Expected Strength, shown as a table and bar chart).
- League Teams page, available after the auction starts: all 20 teams ranked by strength with attack, defense, chemistry and Auction or AI tags, linking to each team's XI.

Season Complete screen:

- Final table with color bands (admin can rename or switch off): 1st gold, 2nd to 4th top four, 5th to 6th next tier, 18th to 20th bottom three. Auction teams carry a badge. Champion gets a trophy icon and a confetti moment.
- Awards: Champion, Golden Boot, Playmaker (assists), Golden Glove (clean sheets), Player of the Season (highest average rating), Team of the Season (best XI by average rating on a pitch), Best Buy (biggest positive gap between his season average rating and what his price implied) and Biggest Overpay (the reverse).
- Auction grades: each team gets a letter grade A+ to F from pre-season strength rank among the 20, actual finish and how much of its budget it turned into rating. Each purchase gets a Steal (paid at most 80 percent of market value), Fair, or Overpay (paid at least 130 percent) tag. Also show total spent, money left, most expensive signing and the best bargain.
- Team pages (auction teams and AI clubs): XI on a pitch with each player's goals, assists, clean sheets and rating, form timeline, home and away splits, biggest win, longest unbeaten run, top scorer.
- Head to head for every pair of auction teams.
- Share: Copy Summary (plain text) and Download Image (season card).
- Host actions: Run It Back, Rematch (new lobby, same people, fresh auction), Export Results (JSON and CSV).

Profiles and history: profile with games played, titles, average finish, best auction grade and a trophy cabinet. Hall of Fame of completed games. Global leaderboard by titles then average finish. Record book (most points in a season, most goals by a bought player, best goal difference). Reopen and replay any finished game.

---
## 11. Admin panel (/admin)

Only role admin can open it, and every admin endpoint re-checks the role on the server. Log every admin and host action to audit_log.

1. **Overview:** counts of users, active lobbies, auctions in progress, seasons simulated, pool players; recent activity; data health warnings.
2. **Pool players:** searchable, filterable table with inline edit, add, deactivate, delete, bulk edit, CSV and JSON import and export with diff preview, duplicate detection, and a Reprice tool (edit the price curve and see the new prices before applying).
3. **Clubs and squads:** edit colors and monograms, edit AI squads, override strength, and a live strength ranking showing which clubs would become AI teams for a chosen N (slider 2 to 12).
4. **Games:** list every game with status, host, team count and age. Actions: open as spectator, force start, pause or resume, skip nomination, undo last sale, reassign nomination order, replace with a bot, extend timer, reset auction, force complete (auto-fill), re-run simulation, change seed, export, delete.
5. **Settings:** league name, maximum teams (up to 12), default budget, default timers and allowed ranges, min bid increment, extra_min and extra_pct, price curve parameters, enabled formations, remove-bought-from-AI toggle, AI club selection method (top by strength, manual list, or random), every simulation parameter from section 9, points system, tiebreaker order, table color bands, auto-start season, public lobbies on or off, registrations open or closed, profanity word list, maintenance banner.
6. **Simulation Lab:** pick any 20 teams or load a game, set a seed and parameters, run a season or a 1,000-season Monte Carlo, and see distributions of goals per match, home win rate and points spread. Include a one-click Test Auction that creates a game with N bots, fast-forwards the whole auction and simulates the season, and shows the pool size, total money spent and the biggest and smallest prices paid.
7. **Users:** list, search, promote or demote admin, ban or unban, view a user's games, delete a user's data.
8. **Audit Log:** filter by actor, action, game and date, with CSV export.
9. **Announcements:** set or clear a site-wide banner.

Host powers inside their own game (no admin role needed): edit settings until the auction starts, randomize or edit nomination order, add or remove bots, kick (lobby only), start, pause, resume, skip a nomination, undo the last sale, hold or release the post-auction countdown, start the season, control synchronized playback, cancel.

---
## 12. UI and design

- Dark matchday theme: near-black navy backgrounds, pitch-green accent, crisp white text, gold for winners and prices. Bold condensed display font for headings and scores, clean sans-serif for body. Cards with soft shadows and rounded corners.
- The pitch graphic has subtle mowing stripes and clean white markings. Player tokens are circular badges showing overall, with a ring in the club's primary color (grey when the club is unknown) and the position label underneath. Rating tiers use distinct colors plus a text label so color is never the only signal.
- Routes: `/`, `/how-to-play`, `/login`, `/lobby/:code`, `/auction/:code`, `/reveal/:code`, `/season/:code`, `/results/:code`, `/league/:code`, `/team/:code/:teamId`, `/profile`, `/hall-of-fame`, `/leaderboard`, `/admin/*`.
- Mobile first. The auction room must work on a phone: sticky live-lot bar with the timer and one-tap bid buttons, collapsible pitch, pool in a bottom sheet with filter chips, large tap targets. Season playback gets a compact layout with the table and results as swipeable tabs.
- Motion: bid flash, SOLD stamp with the price, countdown ring that turns red under 5 seconds, confetti for the champion, position-change arrows, toasts for key events. Optional sound toggle (gavel, whistle), off by default. Respect reduced motion.
- Quality: skeleton loaders, friendly empty states, clear errors (for example, You were outbid, the price is now 45), a connection indicator, light and dark toggle (dark default), accessible contrast, keyboard navigation in the pool, and a short How to Play walkthrough on first visit.

---
## 13. Milestones

- **M0, scaffold and data:** monorepo, TypeScript, lint, test runner, Drizzle schema and migrations, `data/` files, `npm run seed`, `npm run data:validate`.
- **M1, engine:** sections 4, 5 and 9 complete with unit tests: slot groups, pool sizing, prices, reserve and bid validation, auto-fill, bots, lineup assignment, fixtures, match and season sim, Monte Carlo, and the `npm run sim` CLI. Tune the parameters so a 3-team game gives realistic tables (champion usually 80 to 95 points, bottom team usually 20 to 40, around 2.6 to 2.9 goals per match).
- **M2, server foundation:** auth (accounts, guests, admin), game lifecycle, lobby with the live pool preview, Socket.IO snapshots and events, start-auction flow with pool building, strength snapshot and AI club selection.
- **M3, live auction:** nomination, bidding, serialized bid queue, server timers, anti-snipe, sale transaction, auto end, pause and unpause, stall guard, watchlist, bots, host controls, team reveal. Integration tests for simultaneous bids, out-of-turn nominations, wrong-position bids, reserve rule, timer expiry, pause in the middle of a lot, and the auto end.
- **M4, season:** persist the simulation, playback state, matchday and table views, match tickers, League Teams page, Run It Back, multi-season, Monte Carlo.
- **M5, results:** awards, auction grades, team pages, head to head, share image and text, profiles, Hall of Fame, leaderboard, record book.
- **M6, admin:** every admin tab and the audit log, with server-side role checks tested.
- **M7, polish:** mobile layouts, motion, accessibility, How to Play, error states, Dockerfile and docker-compose, README, a Playwright smoke test that creates a game, adds bots, runs the auction and plays a season.

---
## 14. Acceptance checklist

- [ ] A 2-team all-4-3-3 game builds a 40-player pool (22 needed plus 18 extra); a 12-team all-4-3-3 game builds 154 (132 plus 22). Mixed formations give the pool the formula says.
- [ ] Changing a formation or adding a team in the lobby updates the pool preview live.
- [ ] A 12-team game works with exactly 8 AI clubs, and a 2-team game with 18, always 20 teams and 380 fixtures over 38 matchdays.
- [ ] The pool never contains a woman's player, a duplicate id, or fewer players in a group than need plus extra.
- [ ] The world's top 20 of every position are in the master data and, for 12 teams, in the auction pool.
- [ ] Prices match the formula (a 91 has market value 133 and base 67, an 80 has 60 and 30).
- [ ] Every team starts with the budget; money never goes below zero.
- [ ] A bid for a player who cannot fit any open slot on your team is rejected (`NO_SLOT`).
- [ ] A striker cannot fill a goalkeeper slot, and a left-back cannot fill a CB slot.
- [ ] Messi (CAM, alternates ST, RW, RM) can be bought for a CAM, ST, RW or RM slot and can be placed in any of them, but not in a CB slot.
- [ ] A purchase that would leave another team unable to fill a slot is rejected (`WOULD_STRAND_TEAM`), and the auction always finishes with every team holding a valid 11.
- [ ] The engine's slot assignment puts the most players in their main position, and swapping two players between slots both can play works.
- [ ] The reserve rule blocks a bid that would leave a team unable to afford its remaining slots, and the UI shows the correct max bid.
- [ ] Two simultaneous bids are ordered; exactly one is first and the other gets OUTBID without losing its turn.
- [ ] A nomination out of turn is rejected.
- [ ] Anti-snipe: a bid with 3 seconds left resets the lot clock to 10 seconds.
- [ ] Nomination timer expiry auto-nominates a legal player at base price.
- [ ] **The host can pause and unpause at any moment, including mid-lot. While paused, bids, nominations and timers are frozen for everyone, and on unpause the exact remaining time is restored.**
- [ ] A non-host cannot pause.
- [ ] **When the last team reaches 11 players the auction ends automatically, unsold players are marked, and the season simulation starts by itself after the reveal countdown.**
- [ ] The stall guard auto-fills a team that cannot proceed, and the auction still finishes.
- [ ] Refreshing mid-auction restores the exact state, including the live lot and remaining time.
- [ ] A disconnected human is replaced by a bot or only auto-nominated, per the host's choice.
- [ ] With remove-bought-players on, a bought star never appears in an AI club's XI, and every AI club still fields 11 players.
- [ ] The same seed gives identical results; a different seed gives different ones.
- [ ] Every team's points equal 3 times wins plus draws, and total goals for equal total goals against.
- [ ] Every team plays 38 matches, 19 at home and 19 away, and plays every opponent twice.
- [ ] Monte Carlo (1,000 seasons) finishes and gives plausible title chances.
- [ ] A normal user who opens /admin or calls an admin endpoint directly is refused.
- [ ] The auction room and season playback are usable on a phone-sized screen.
- [ ] No official club logos or player photos are used, and the unofficial fan game footer is present.
- [ ] `npm test`, `npm run typecheck` and `npm run lint` all pass.

---

## 15. Stretch ideas (only after everything above works)

A 5-player bench with substitutions, an in-season transfer window with trades between teams, a rookie draft, a domestic cup with knockout rounds, multi-season careers with player aging and budget carry-over, achievements and badges, a live spectator view with emoji reactions, and an optional Refresh pool with AI admin button that calls the Anthropic API when `ANTHROPIC_API_KEY` is set (always with a diff preview before applying).
