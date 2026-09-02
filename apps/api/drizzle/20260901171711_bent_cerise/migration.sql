CREATE TABLE "circle_parent" (
	"circle_id" text,
	"parent_id" text,
	CONSTRAINT "circle_parent_pkey" PRIMARY KEY("circle_id","parent_id")
);
--> statement-breakpoint
CREATE TABLE "circle_template" (
	"circle_id" text,
	"template_key" text,
	"enabled_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circle_template_pkey" PRIMARY KEY("circle_id","template_key")
);
--> statement-breakpoint
CREATE TABLE "circle" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"visibility" text NOT NULL,
	"is_dm" boolean DEFAULT false NOT NULL,
	"dm_key" text,
	"depth" integer,
	"is_official" boolean DEFAULT false NOT NULL,
	"invite_code" text,
	"dormancy_days" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hibernation_deadline" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"circle_id" text,
	"user_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_pkey" PRIMARY KEY("circle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY,
	"circle_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" text PRIMARY KEY,
	"circle_id" text NOT NULL,
	"template_key" text NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"fields" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"matched_response_id" text,
	"author_confirmed_at" timestamp with time zone,
	"responder_confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response" (
	"id" text PRIMARY KEY,
	"post_id" text NOT NULL,
	"responder_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" text PRIMARY KEY,
	"post_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"reviewee_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "circle_parent_parent_idx" ON "circle_parent" ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_dm_key_uidx" ON "circle" ("dm_key");--> statement-breakpoint
CREATE INDEX "circle_lifecycle_idx" ON "circle" ("archived_at","last_activity_at");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" ("user_id");--> statement-breakpoint
CREATE INDEX "message_circle_created_idx" ON "message" ("circle_id","created_at");--> statement-breakpoint
CREATE INDEX "post_circle_status_idx" ON "post" ("circle_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "response_post_responder_uidx" ON "response" ("post_id","responder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_post_reviewer_uidx" ON "review" ("post_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "review_reviewee_idx" ON "review" ("reviewee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "circle_parent" ADD CONSTRAINT "circle_parent_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "circle_parent" ADD CONSTRAINT "circle_parent_parent_id_circle_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "circle_template" ADD CONSTRAINT "circle_template_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "circle_template" ADD CONSTRAINT "circle_template_enabled_by_user_id_fkey" FOREIGN KEY ("enabled_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "circle" ADD CONSTRAINT "circle_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "response" ADD CONSTRAINT "response_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id");--> statement-breakpoint
ALTER TABLE "response" ADD CONSTRAINT "response_responder_id_user_id_fkey" FOREIGN KEY ("responder_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id");--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_reviewer_id_user_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_reviewee_id_user_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;