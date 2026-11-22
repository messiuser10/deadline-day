CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target` text,
	`game_id` text,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_game_idx` ON `audit_log` (`game_id`);--> statement-breakpoint
CREATE TABLE `bids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`amount_m` integer NOT NULL,
	`created_at` integer NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bids_lot_idx` ON `bids` (`lot_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_game_idx` ON `chat_messages` (`game_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `clubs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`country` text NOT NULL,
	`league_name` text NOT NULL,
	`primary_color` text NOT NULL,
	`secondary_color` text NOT NULL,
	`monogram` text,
	`strength_rating` real,
	`strength_override` real,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_name_unique` ON `clubs` (`name`);--> statement-breakpoint
CREATE TABLE `fixtures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` text NOT NULL,
	`matchday` integer NOT NULL,
	`home_team_id` text NOT NULL,
	`away_team_id` text NOT NULL,
	`home_goals` integer,
	`away_goals` integer,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`away_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fixtures_season_matchday_idx` ON `fixtures` (`season_id`,`matchday`);--> statement-breakpoint
CREATE TABLE `game_pool` (
	`game_id` text NOT NULL,
	`pool_player_id` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`sold_to_participant_id` text,
	`price_m` integer,
	`snapshot` text NOT NULL,
	PRIMARY KEY(`game_id`, `pool_player_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_player_id`) REFERENCES `pool_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sold_to_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`join_code` text NOT NULL,
	`name` text NOT NULL,
	`host_user_id` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`settings` text NOT NULL,
	`seed` integer,
	`nomination_order` text,
	`nomination_index` integer DEFAULT 0 NOT NULL,
	`current_lot_id` text,
	`nomination_deadline` integer,
	`lot_deadline` integer,
	`countdown_deadline` integer,
	`paused_remaining_ms` integer,
	`paused_timer` text,
	`paused_by_user_id` text,
	`pool_summary` text,
	`strength_snapshot` text,
	`ai_club_ids` text,
	`playback_state` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paused_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_join_code_unique` ON `games` (`join_code`);--> statement-breakpoint
CREATE INDEX `games_status_idx` ON `games` (`status`);--> statement-breakpoint
CREATE TABLE `lineup_slots` (
	`participant_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`pool_player_id` text,
	`price_m` integer,
	`lot_id` text,
	`auto_filled` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`participant_id`, `slot_key`),
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_player_id`) REFERENCES `pool_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`pool_player_id` text NOT NULL,
	`nominator_id` text NOT NULL,
	`opening_bid_m` integer NOT NULL,
	`current_bid_m` integer NOT NULL,
	`leader_participant_id` text,
	`status` text DEFAULT 'live' NOT NULL,
	`final_price_m` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`auto_nominated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_player_id`) REFERENCES `pool_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nominator_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leader_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lots_game_sequence_uq` ON `lots` (`game_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_id` integer NOT NULL,
	`minute` integer NOT NULL,
	`type` text NOT NULL,
	`player_ref` text NOT NULL,
	`season_team_id` text NOT NULL,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `match_events_fixture_idx` ON `match_events` (`fixture_id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text,
	`team_name` text,
	`color` text,
	`monogram` text,
	`formation` text,
	`budget_remaining_m` integer DEFAULT 0 NOT NULL,
	`is_ready` integer DEFAULT false NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`bot_level` text,
	`is_connected` integer DEFAULT false NOT NULL,
	`is_spectator` integer DEFAULT false NOT NULL,
	`disconnected_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_game_team_name_uq` ON `participants` (`game_id`,`team_name`);--> statement-breakpoint
CREATE INDEX `participants_user_idx` ON `participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `player_season_stats` (
	`season_id` text NOT NULL,
	`player_ref` text NOT NULL,
	`season_team_id` text NOT NULL,
	`appearances` integer DEFAULT 0 NOT NULL,
	`goals` integer DEFAULT 0 NOT NULL,
	`assists` integer DEFAULT 0 NOT NULL,
	`clean_sheets` integer DEFAULT 0 NOT NULL,
	`yellows` integer DEFAULT 0 NOT NULL,
	`reds` integer DEFAULT 0 NOT NULL,
	`rating_sum` real DEFAULT 0 NOT NULL,
	`avg_rating` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`season_id`, `player_ref`),
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pool_players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`alt_positions` text DEFAULT '[]' NOT NULL,
	`alt_source` text DEFAULT 'rule' NOT NULL,
	`overall` integer NOT NULL,
	`position_rank` integer NOT NULL,
	`market_value_m` integer NOT NULL,
	`base_price_m` integer NOT NULL,
	`seed_club` text,
	`nationality` text,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`seed_club`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pool_players_position_idx` ON `pool_players` (`position`,`overall`);--> statement-breakpoint
CREATE TABLE `season_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`kind` text NOT NULL,
	`participant_id` text,
	`club_id` text,
	`name` text NOT NULL,
	`primary_color` text NOT NULL,
	`secondary_color` text NOT NULL,
	`lineup` text NOT NULL,
	`formation` text NOT NULL,
	`attack_rating` real NOT NULL,
	`defense_rating` real NOT NULL,
	`chemistry_bonus` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `season_teams_season_idx` ON `season_teams` (`season_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`seed` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`parameters_snapshot` text NOT NULL,
	`champion_season_team_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_game_number_uq` ON `seasons` (`game_id`,`season_number`);--> statement-breakpoint
CREATE TABLE `seed_players` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`full_name` text NOT NULL,
	`primary_position` text NOT NULL,
	`alt_positions` text DEFAULT '[]' NOT NULL,
	`overall` integer NOT NULL,
	`nationality` text,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seed_players_club_idx` ON `seed_players` (`club_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `standing_rows` (
	`season_id` text NOT NULL,
	`matchday` integer NOT NULL,
	`season_team_id` text NOT NULL,
	`played` integer NOT NULL,
	`won` integer NOT NULL,
	`drawn` integer NOT NULL,
	`lost` integer NOT NULL,
	`goals_for` integer NOT NULL,
	`goals_against` integer NOT NULL,
	`goal_difference` integer NOT NULL,
	`points` integer NOT NULL,
	`position` integer NOT NULL,
	`form` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`season_id`, `matchday`, `season_team_id`),
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`is_guest` integer DEFAULT false NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`participant_id` text NOT NULL,
	`pool_player_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`participant_id`, `pool_player_id`),
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_player_id`) REFERENCES `pool_players`(`id`) ON UPDATE no action ON DELETE cascade
);
