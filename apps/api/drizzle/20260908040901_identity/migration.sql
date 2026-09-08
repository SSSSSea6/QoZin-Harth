CREATE TABLE "sms_send" (
	"id" text PRIMARY KEY,
	"phone" text NOT NULL,
	"user_id" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_restriction" (
	"user_id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"until" timestamp with time zone,
	"reason" text NOT NULL,
	"moderation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_restriction_kind" CHECK ("kind" IN ('mute', 'ban')),
	CONSTRAINT "user_restriction_mute_until" CHECK ("kind" <> 'mute' OR "until" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_key" UNIQUE("phone_number");--> statement-breakpoint
CREATE INDEX "sms_send_phone_idx" ON "sms_send" ("phone","created_at");--> statement-breakpoint
CREATE INDEX "sms_send_user_idx" ON "sms_send" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_send_ip_idx" ON "sms_send" ("ip","created_at");--> statement-breakpoint
ALTER TABLE "sms_send" ADD CONSTRAINT "sms_send_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "user_restriction" ADD CONSTRAINT "user_restriction_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");