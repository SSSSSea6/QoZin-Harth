CREATE TABLE "circle_notify" (
	"circle_id" text,
	"user_id" text,
	"level" text NOT NULL,
	CONSTRAINT "circle_notify_pkey" PRIMARY KEY("circle_id","user_id"),
	CONSTRAINT "circle_notify_level" CHECK ("level" IN ('all', 'none'))
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"provider" text NOT NULL,
	"token" text NOT NULL,
	"apns_env" text,
	"app_version" text,
	"session_id" text,
	"binding_version" integer DEFAULT 1 NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "device_platform_provider" CHECK (("platform" = 'ios' AND "provider" = 'apns') OR ("platform" = 'android' AND "provider" = 'emas')),
	CONSTRAINT "device_apns_env" CHECK ("provider" <> 'apns' OR "apns_env" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"notification_id" text,
	"device_id" text,
	"binding_version" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_pkey" PRIMARY KEY("notification_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"circle_id" text,
	"actor_id" text,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_kind" CHECK ("kind" IN ('dm', 'tool_post', 'circle_dying', 'application', 'report', 'moderation', 'appeal'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "device_provider_token_uidx" ON "device" ("provider","token");--> statement-breakpoint
CREATE INDEX "device_user_idx" ON "device" ("user_id","disabled_at");--> statement-breakpoint
CREATE INDEX "device_seen_idx" ON "device" ("last_seen_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_updated_idx" ON "notification_delivery" ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_unread_event_uidx" ON "notification" ("user_id","event_key") WHERE "read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_updated_idx" ON "notification" ("updated_at");--> statement-breakpoint
ALTER TABLE "circle_notify" ADD CONSTRAINT "circle_notify_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "circle_notify" ADD CONSTRAINT "circle_notify_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");