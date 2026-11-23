CREATE TABLE "game_results" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"season_id" text NOT NULL,
	"season_team_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"user_id" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"team_name" text NOT NULL,
	"color" text NOT NULL,
	"monogram" text NOT NULL,
	"position" integer NOT NULL,
	"points" integer NOT NULL,
	"won" integer NOT NULL,
	"drawn" integer NOT NULL,
	"lost" integer NOT NULL,
	"goals_for" integer NOT NULL,
	"goals_against" integer NOT NULL,
	"goal_difference" integer NOT NULL,
	"pre_rank" integer NOT NULL,
	"grade" text NOT NULL,
	"grade_score" double precision NOT NULL,
	"spent_m" integer NOT NULL,
	"budget_m" integer NOT NULL,
	"champion" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "completed_at" bigint;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rematch_code" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "awards" jsonb;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_season_team_id_season_teams_id_fk" FOREIGN KEY ("season_team_id") REFERENCES "public"."season_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_results_game_participant_uq" ON "game_results" USING btree ("game_id","participant_id");--> statement-breakpoint
CREATE INDEX "game_results_user_idx" ON "game_results" USING btree ("user_id");