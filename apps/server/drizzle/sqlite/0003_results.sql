CREATE TABLE `game_results` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`season_id` text NOT NULL,
	`season_team_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`user_id` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`team_name` text NOT NULL,
	`color` text NOT NULL,
	`monogram` text NOT NULL,
	`position` integer NOT NULL,
	`points` integer NOT NULL,
	`won` integer NOT NULL,
	`drawn` integer NOT NULL,
	`lost` integer NOT NULL,
	`goals_for` integer NOT NULL,
	`goals_against` integer NOT NULL,
	`goal_difference` integer NOT NULL,
	`pre_rank` integer NOT NULL,
	`grade` text NOT NULL,
	`grade_score` real NOT NULL,
	`spent_m` integer NOT NULL,
	`budget_m` integer NOT NULL,
	`champion` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_results_game_participant_uq` ON `game_results` (`game_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `game_results_user_idx` ON `game_results` (`user_id`);--> statement-breakpoint
ALTER TABLE `games` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `rematch_code` text;--> statement-breakpoint
ALTER TABLE `seasons` ADD `awards` text;