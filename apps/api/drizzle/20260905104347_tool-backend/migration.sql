CREATE TABLE "tool_run" (
	"id" text PRIMARY KEY,
	"tool_id" text NOT NULL,
	"circle_id" text NOT NULL,
	"version_id" text,
	"schedule_id" text,
	"environment" text NOT NULL,
	"trigger" text NOT NULL,
	"action" text NOT NULL,
	"input" jsonb,
	"user_id" text,
	"scheduled_for" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"error" text,
	"logs" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "tool_schedule" (
	"id" text PRIMARY KEY,
	"circle_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"action" text NOT NULL,
	"input" jsonb,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_scheduled_for" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "circle_tool" ADD COLUMN "version_id" text;--> statement-breakpoint
ALTER TABLE "circle_tool" ADD COLUMN "schedules" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_dev_session" ADD COLUMN "backend" text;--> statement-breakpoint
ALTER TABLE "tool_dev_session" ADD COLUMN "backend_hash" text;--> statement-breakpoint
ALTER TABLE "tool_storage" ADD COLUMN "namespace" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "tool_version" ADD COLUMN "backend_hash" text;--> statement-breakpoint
ALTER TABLE "tool_storage" DROP CONSTRAINT "tool_storage_pkey";--> statement-breakpoint
ALTER TABLE "tool_storage" ADD PRIMARY KEY ("tool_id","circle_id","namespace","key");--> statement-breakpoint
ALTER TABLE "post" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "tool_run_install_created_idx" ON "tool_run" ("tool_id","circle_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_run_status_idx" ON "tool_run" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_run_occurrence_uidx" ON "tool_run" ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_schedule_install_name_uidx" ON "tool_schedule" ("circle_id","tool_id","name");--> statement-breakpoint
CREATE INDEX "tool_schedule_due_idx" ON "tool_schedule" ("next_run_at");--> statement-breakpoint
ALTER TABLE "tool_run" ADD CONSTRAINT "tool_run_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "tool_run" ADD CONSTRAINT "tool_run_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "tool_run" ADD CONSTRAINT "tool_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "tool_schedule" ADD CONSTRAINT "tool_schedule_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "tool_schedule" ADD CONSTRAINT "tool_schedule_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_author_or_tool" CHECK ("author_id" IS NOT NULL OR "tool_id" IS NOT NULL);