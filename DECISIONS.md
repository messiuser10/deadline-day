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
- `clubs.strength_rating` stays empty after the M0 seed; the engine computes and caches it in M1. The strength numbers in `clubs.json` are not used.
- Default club monogram: initials of up to three words of the name, skipping "and" (Brighton and Hove Albion is BHA).
- Seed mode: insert missing rows, keep existing ones (admin edits survive); `--reset` overwrites clubs, squads and pool players from `data/` but keeps monogram, notes and strength override; `app_settings` keys are only ever inserted when missing.
- The seed refuses to write anything when data validation reports an error.
- `data:validate` also fails on: the CSV and JSON disagreeing, `players.csv` and `players.seed.json` disagreeing, club count not 20, squad count not 618, a club colour that is not `#RRGGBB`, a pool id that is not lowercase-dash, a `seed_club` that does not resolve to exactly one squad player, and any group short of players for the 12-team worst case.
- `data:validate` only warns (does not fail) on: master depth per position differing from the spec's list, a `rule` player whose alternates differ from the rule default, and a repeated `position_rank` within a position.
- Tooling: Vite 7 (one copy shared with Vitest), ESLint 9 flat config with typescript-eslint, zod 4, Vitest 3.
- `maintenance_banner` is stored as `{ "message": null }` because settings values are never SQL NULL.
