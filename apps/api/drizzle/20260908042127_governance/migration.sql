CREATE TABLE "appeal" (
	"id" text PRIMARY KEY,
	"moderation_id" text NOT NULL UNIQUE,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_status" CHECK ("status" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "banned_phone" (
	"phone_hmac" text PRIMARY KEY,
	"moderation_id" text NOT NULL,
	"until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_rule" (
	"id" text PRIMARY KEY,
	"pattern" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_rule_kind" CHECK ("kind" IN ('reject', 'flag'))
);
--> statement-breakpoint
CREATE TABLE "moderation" (
	"id" text PRIMARY KEY,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"subject_user_id" text,
	"report_id" text,
	"reason" text NOT NULL,
	"until" timestamp with time zone,
	"by" text NOT NULL,
	"reversal_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_action" CHECK ("action" IN ('hide', 'restore', 'mute', 'unmute', 'ban', 'unban', 'tool_suspend', 'tool_restore'))
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" text PRIMARY KEY,
	"reporter_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"snapshot" text,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"moderation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_status" CHECK ("status" IN ('pending', 'handled', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "user_block" (
	"blocker_id" text,
	"blocked_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_block_pkey" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_block_not_self" CHECK ("blocker_id" <> "blocked_id")
);
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "hidden_moderation_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "hidden_moderation_id" text;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "hidden_moderation_id" text;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN "hidden_moderation_id" text;--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "hidden_moderation_id" text;--> statement-breakpoint
ALTER TABLE "tool" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "appeal_status_idx" ON "appeal" ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_target_idx" ON "moderation" ("target_type","target_id","created_at","id");--> statement-breakpoint
CREATE INDEX "moderation_subject_idx" ON "moderation" ("subject_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_pending_uidx" ON "report" ("reporter_id","target_type","target_id") WHERE "status" = 'pending' AND "reporter_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "report_rule_pending_uidx" ON "report" ("target_type","target_id") WHERE "status" = 'pending' AND "reporter_id" IS NULL;--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "report_reporter_idx" ON "report" ("reporter_id","created_at","id");--> statement-breakpoint
CREATE INDEX "user_block_blocked_idx" ON "user_block" ("blocked_id","blocker_id");--> statement-breakpoint
ALTER TABLE "appeal" ADD CONSTRAINT "appeal_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "appeal" ADD CONSTRAINT "appeal_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "content_rule" ADD CONSTRAINT "content_rule_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "moderation" ADD CONSTRAINT "moderation_subject_user_id_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "moderation" ADD CONSTRAINT "moderation_by_user_id_fkey" FOREIGN KEY ("by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_handled_by_user_id_fkey" FOREIGN KEY ("handled_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocker_id_user_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocked_id_user_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "user"("id");